import * as Comlink from "comlink";
import type { ProcessingParams } from "../lib/types";

declare const self: Record<string, any>;

let cvReady = false;
let cvReadyPromise: Promise<void>;

let cachedNormalized: any = null; // cv.Mat RGB
let cachedWidth = 0;
let cachedHeight = 0;

function loadOpenCV(): Promise<void> {
  if (cvReady) return Promise.resolve();
  if (cvReadyPromise) return cvReadyPromise;

  cvReadyPromise = new Promise<void>((resolve, reject) => {
    self.Module = {
      onRuntimeInitialized: () => {
        cvReady = true;
        resolve();
      },
    };
    fetch(`${import.meta.env.BASE_URL}opencv.js`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((scriptText) => {
        (0, eval)(scriptText);
      })
      .catch((e) => reject(new Error(`Failed to load OpenCV.js: ${e}`)));
  });
  return cvReadyPromise;
}

function deleteSafe(...mats: any[]) {
  for (const m of mats) {
    try { m.delete(); } catch { /* already freed or invalid */ }
  }
}

// ── Background subtraction ─────────────────────────────────────────────
function subtractBackground(cv: any, rgb: any): any {
  const origW = rgb.cols;
  const origH = rgb.rows;

  const SCALE = 4;
  const smallW = Math.round(origW / SCALE);
  const smallH = Math.round(origH / SCALE);

  const small = new cv.Mat();
  cv.resize(rgb, small, new cv.Size(smallW, smallH), 0, 0, cv.INTER_AREA);

  const channels = new cv.MatVector();
  cv.split(small, channels);

  const kSize = Math.max(13, Math.round(51 / SCALE) | 1);
  const bgKernel = cv.getStructuringElement(
    cv.MORPH_ELLIPSE,
    new cv.Size(kSize, kSize)
  );

  const bgChannelsSmall = new cv.MatVector();
  for (let i = 0; i < 3; i++) {
    const ch = channels.get(i);
    const bg = new cv.Mat();
    cv.morphologyEx(ch, bg, cv.MORPH_OPEN, bgKernel);
    cv.GaussianBlur(bg, bg, new cv.Size(kSize, kSize), 0);
    bgChannelsSmall.push_back(bg);
    bg.delete();
  }

  const bgSmall = new cv.Mat();
  cv.merge(bgChannelsSmall, bgSmall);

  const bgFull = new cv.Mat();
  cv.resize(bgSmall, bgFull, new cv.Size(origW, origH), 0, 0, cv.INTER_LINEAR);
  cv.GaussianBlur(bgFull, bgFull, new cv.Size(15, 15), 0);

  const sub = new cv.Mat();
  cv.subtract(rgb, bgFull, sub);

  const subChannels = new cv.MatVector();
  cv.split(sub, subChannels);
  const stretchedChannels = new cv.MatVector();
  for (let i = 0; i < 3; i++) {
    const ch = subChannels.get(i);
    const stretched = new cv.Mat();
    ch.copyTo(stretched);
    const minMax = cv.minMaxLoc(stretched);
    if (minMax.maxVal > 0) {
      stretched.convertTo(stretched, cv.CV_8U, 255.0 / minMax.maxVal, 0);
    }
    stretchedChannels.push_back(stretched);
    stretched.delete();
  }
  const dst = new cv.Mat();
  cv.merge(stretchedChannels, dst);

  deleteSafe(small, bgSmall, bgFull, sub, bgKernel);
  deleteSafe(channels, bgChannelsSmall, subChannels, stretchedChannels);

  return dst;
}

// ── Fast detection (contour-based, no watershed) ────────────────────────
interface DetectedCell {
  x: number;
  y: number;
  area: number;
  circularity: number;
}

function detectCellsFast(
  cv: any,
  hsv: any,
  hueRanges: Array<[number, number]>,
  threshold: number,
  minArea: number,
  maxArea: number
): DetectedCell[] {
  let mask = cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8U);

  for (const [hLow, hHigh] of hueRanges) {
    const lo = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(hLow, threshold, threshold));
    const hi = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(hHigh, 255, 255));
    const partial = new cv.Mat();
    cv.inRange(hsv, lo, hi, partial);
    cv.bitwise_or(mask, partial, mask);
    deleteSafe(lo, hi, partial);
  }

  const morphK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, morphK);
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, morphK);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const cells: DetectedCell[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area >= minArea && area <= maxArea) {
      const moments = cv.moments(cnt);
      if (moments.m00 > 0) {
        const perimeter = cv.arcLength(cnt, true);
        const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
        cells.push({
          x: Math.round(moments.m10 / moments.m00),
          y: Math.round(moments.m01 / moments.m00),
          area,
          circularity: Math.min(circularity, 1),
        });
      }
    }
    cnt.delete();
  }

  deleteSafe(mask, morphK, contours, hierarchy);

  return cells;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeConfidence(allCells: DetectedCell[], estimatedCount: number): number {
  if (allCells.length === 0) return 100;

  // 1. Circularity: avg circularity across all contours (0–1, 1 = perfect circle)
  const avgCirc = allCells.reduce((s, c) => s + c.circularity, 0) / allCells.length;

  // 2. Size uniformity: 1 - coefficient of variation of areas (clamped to 0–1)
  const areas = allCells.map((c) => c.area);
  const meanArea = areas.reduce((s, a) => s + a, 0) / areas.length;
  const variance = areas.reduce((s, a) => s + (a - meanArea) ** 2, 0) / areas.length;
  const cv = meanArea > 0 ? Math.sqrt(variance) / meanArea : 1;
  const sizeUniformity = Math.max(0, 1 - cv);

  // 3. Non-clump ratio: how many of the estimated cells were direct detections vs inferred from clumps
  const rawCount = allCells.length;
  const nonClumpRatio = estimatedCount > 0 ? Math.min(rawCount / estimatedCount, 1) : 1;

  const score = avgCirc * 0.3 + sizeUniformity * 0.3 + nonClumpRatio * 0.4;
  return Math.round(Math.max(0, Math.min(100, score * 100)));
}

function estimateWithClumps(cells: Array<{ x: number; y: number; area: number }>): number {
  if (cells.length === 0) return 0;
  if (cells.length <= 2) return cells.length;

  const areas = cells.map((c) => c.area);
  const sorted = [...areas].sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const singles = sorted.filter((a) => a <= p75);
  const avgSingle = singles.length > 0
    ? singles.reduce((s, v) => s + v, 0) / singles.length
    : median(areas);

  if (avgSingle <= 0) return cells.length;

  let total = 0;
  for (const c of cells) {
    if (c.area > avgSingle * 1.8) {
      total += Math.round(c.area / avgSingle);
    } else {
      total += 1;
    }
  }
  return total;
}

function applyCLAHE(cv: any, rgb: any, clipLimit: number): any {
  const lab = new cv.Mat();
  cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
  const labCh = new cv.MatVector();
  cv.split(lab, labCh);

  const clahe = new cv.CLAHE(clipLimit, new cv.Size(8, 8));
  const lEnh = new cv.Mat();
  const lCh = labCh.get(0);
  clahe.apply(lCh, lEnh);

  const mergedCh = new cv.MatVector();
  mergedCh.push_back(lEnh);
  mergedCh.push_back(labCh.get(1));
  mergedCh.push_back(labCh.get(2));

  const labEnh = new cv.Mat();
  cv.merge(mergedCh, labEnh);
  const enhanced = new cv.Mat();
  cv.cvtColor(labEnh, enhanced, cv.COLOR_Lab2RGB);

  deleteSafe(lab, lEnh, labEnh, clahe);
  deleteSafe(labCh, mergedCh);

  return enhanced;
}

// ── Worker API ──────────────────────────────────────────────────────────
const workerApi = {
  async init() {
    await loadOpenCV();
    return true;
  },

  async cacheNormalized(
    imageData: ImageData,
    _imageName: string
  ): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
    await loadOpenCV();
    const cv = self.cv;

    if (cachedNormalized) { deleteSafe(cachedNormalized); cachedNormalized = null; }

    let src: any = null, rgb: any = null, rgba: any = null;
    try {
      src = cv.matFromImageData(imageData);
      rgb = new cv.Mat();
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      const normalized = subtractBackground(cv, rgb);

      cachedNormalized = normalized;
      cachedWidth = normalized.cols;
      cachedHeight = normalized.rows;

      rgba = new cv.Mat();
      cv.cvtColor(normalized, rgba, cv.COLOR_RGB2RGBA);
      const buffer = new Uint8ClampedArray(rgba.data).buffer.slice(0);
      return { buffer, width: cachedWidth, height: cachedHeight };
    } finally {
      deleteSafe(src, rgb, rgba);
    }
  },

  clearCache() {
    if (cachedNormalized) { deleteSafe(cachedNormalized); cachedNormalized = null; }
    cachedWidth = 0;
    cachedHeight = 0;
  },

  async fastReThreshold(
    params: ProcessingParams
  ): Promise<{
    annotatedBuffer: ArrayBuffer;
    width: number;
    height: number;
    green: number;
    red: number;
    total: number;
    viabilityPct: number;
    confidence: number;
    greenCells: Array<{ x: number; y: number; area: number }>;
    redCells: Array<{ x: number; y: number; area: number }>;
  } | null> {
    if (!cachedNormalized) return null;
    const cv = self.cv;

    const enhanced = applyCLAHE(cv, cachedNormalized, params.claheClipLimit);

    const ksize = params.blurKernelSize % 2 === 0 ? params.blurKernelSize + 1 : params.blurKernelSize;
    const blurred = new cv.Mat();
    cv.GaussianBlur(enhanced, blurred, new cv.Size(ksize, ksize), 0);

    const hsv = new cv.Mat();
    cv.cvtColor(blurred, hsv, cv.COLOR_RGB2HSV);

    const greenCells = detectCellsFast(cv, hsv, [[35, 85]], params.greenThreshold, params.minCellArea, params.maxCellArea);
    const redCells = detectCellsFast(cv, hsv, [[0, 10], [170, 180]], params.redThreshold, params.minCellArea, params.maxCellArea);

    const greenCount = estimateWithClumps(greenCells);
    const redCount = estimateWithClumps(redCells);
    const total = greenCount + redCount;
    const viabilityPct = total > 0 ? (greenCount / total) * 100 : 0;

    const allCells = [...greenCells, ...redCells];
    const confidence = computeConfidence(allCells, total);

    const annotated = new cv.Mat();
    cv.cvtColor(cachedNormalized, annotated, cv.COLOR_RGB2RGBA);
    for (const c of greenCells) {
      const r = Math.max(8, Math.round(Math.sqrt(c.area / Math.PI)));
      cv.circle(annotated, new cv.Point(c.x, c.y), r, new cv.Scalar(0, 255, 0, 255), 2);
    }
    for (const c of redCells) {
      const r = Math.max(8, Math.round(Math.sqrt(c.area / Math.PI)));
      cv.circle(annotated, new cv.Point(c.x, c.y), r, new cv.Scalar(255, 0, 0, 255), 2);
    }

    const annotatedBuffer = new Uint8ClampedArray(annotated.data).buffer.slice(0);
    deleteSafe(enhanced, blurred, hsv, annotated);

    return {
      annotatedBuffer,
      width: cachedWidth,
      height: cachedHeight,
      green: greenCount,
      red: redCount,
      total,
      viabilityPct,
      confidence,
      greenCells,
      redCells,
    };
  },

};

export type WorkerApi = typeof workerApi;

Comlink.expose(workerApi);
