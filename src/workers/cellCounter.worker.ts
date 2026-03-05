import * as Comlink from "comlink";
import type { ProcessingParams, CellCountResult } from "../lib/types";

declare const self: Record<string, any>;

let cvReady = false;
let cvReadyPromise: Promise<void>;

// Cached data for real-time threshold preview
let cachedImageName = "";
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
    fetch("/opencv.js")
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

// ── Background subtraction ─────────────────────────────────────────────
// Uses downscale trick: estimate background at 1/4 resolution, then
// upscale and subtract from original. ~16x faster than full-res.
function subtractBackground(cv: any, rgb: any): any {
  const origW = rgb.cols;
  const origH = rgb.rows;

  const SCALE = 4;
  const smallW = Math.round(origW / SCALE);
  const smallH = Math.round(origH / SCALE);

  // Downscale
  const small = new cv.Mat();
  cv.resize(rgb, small, new cv.Size(smallW, smallH), 0, 0, cv.INTER_AREA);

  // Estimate background per-channel at small scale
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
  }

  const bgSmall = new cv.Mat();
  cv.merge(bgChannelsSmall, bgSmall);

  // Upscale background estimate to original resolution
  const bgFull = new cv.Mat();
  cv.resize(bgSmall, bgFull, new cv.Size(origW, origH), 0, 0, cv.INTER_LINEAR);
  // Extra blur to remove upscale artefacts
  cv.GaussianBlur(bgFull, bgFull, new cv.Size(15, 15), 0);

  // Subtract background from original
  const sub = new cv.Mat();
  cv.subtract(rgb, bgFull, sub);

  // Per-channel contrast stretch
  const subChannels = new cv.MatVector();
  cv.split(sub, subChannels);
  const stretchedChannels = new cv.MatVector();
  for (let i = 0; i < 3; i++) {
    const ch = subChannels.get(i);
    const minMax = cv.minMaxLoc(ch);
    if (minMax.maxVal > 0) {
      ch.convertTo(ch, cv.CV_8U, 255.0 / minMax.maxVal, 0);
    }
    stretchedChannels.push_back(ch);
  }
  const dst = new cv.Mat();
  cv.merge(stretchedChannels, dst);

  // Cleanup
  small.delete();
  bgSmall.delete();
  bgFull.delete();
  sub.delete();
  bgKernel.delete();
  channels.delete();
  bgChannelsSmall.delete();
  subChannels.delete();
  stretchedChannels.delete();

  return dst;
}

// ── Fast detection (contour-based, no watershed) ────────────────────────
// Used for real-time threshold preview. Much faster than watershed.
function detectCellsFast(
  cv: any,
  hsv: any,
  hueRanges: Array<[number, number]>,
  threshold: number,
  minArea: number,
  maxArea: number
): Array<{ x: number; y: number; area: number }> {
  let mask = cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8U);

  for (const [hLow, hHigh] of hueRanges) {
    const lo = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(hLow, threshold, threshold));
    const hi = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(hHigh, 255, 255));
    const partial = new cv.Mat();
    cv.inRange(hsv, lo, hi, partial);
    cv.bitwise_or(mask, partial, mask);
    lo.delete();
    hi.delete();
    partial.delete();
  }

  const morphK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, morphK);
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, morphK);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const cells: Array<{ x: number; y: number; area: number }> = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area >= minArea && area <= maxArea) {
      const moments = cv.moments(cnt);
      if (moments.m00 > 0) {
        cells.push({
          x: Math.round(moments.m10 / moments.m00),
          y: Math.round(moments.m01 / moments.m00),
          area,
        });
      }
    }
    cnt.delete();
  }

  mask.delete();
  morphK.delete();
  contours.delete();
  hierarchy.delete();

  return cells;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Estimate total cell count including clumps
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

// ── Full pipeline (for batch) ───────────────────────────────────────────
// Uses watershed for most accurate counting
function countCellsWatershed(
  cv: any,
  binaryMask: any,
  sourceForWatershed: any,
  minArea: number,
  maxArea: number
): { count: number; centroids: Array<{ x: number; y: number; area: number }> } {
  const morphKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  const cleaned = new cv.Mat();
  cv.morphologyEx(binaryMask, cleaned, cv.MORPH_OPEN, morphKernel);
  cv.morphologyEx(cleaned, cleaned, cv.MORPH_CLOSE, morphKernel);

  const dist = new cv.Mat();
  cv.distanceTransform(cleaned, dist, cv.DIST_L2, 5);
  const distNorm = new cv.Mat();
  cv.normalize(dist, distNorm, 0, 1, cv.NORM_MINMAX);

  const sureFg = new cv.Mat();
  cv.threshold(distNorm, sureFg, 0.35, 255, cv.THRESH_BINARY);
  sureFg.convertTo(sureFg, cv.CV_8U);

  const sureBg = new cv.Mat();
  const dilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.dilate(cleaned, sureBg, dilateKernel, new cv.Point(-1, -1), 2);

  const unknown = new cv.Mat();
  cv.subtract(sureBg, sureFg, unknown);

  const markers = new cv.Mat();
  cv.connectedComponents(sureFg, markers, 8);

  for (let r = 0; r < markers.rows; r++) {
    for (let c = 0; c < markers.cols; c++) {
      markers.intPtr(r, c)[0] = markers.intAt(r, c) + 1;
    }
  }
  for (let r = 0; r < unknown.rows; r++) {
    for (let c = 0; c < unknown.cols; c++) {
      if (unknown.ucharAt(r, c) === 255) {
        markers.intPtr(r, c)[0] = 0;
      }
    }
  }

  const wsInput = new cv.Mat();
  if (sourceForWatershed.channels() === 1) {
    cv.cvtColor(sourceForWatershed, wsInput, cv.COLOR_GRAY2BGR);
  } else if (sourceForWatershed.channels() === 4) {
    cv.cvtColor(sourceForWatershed, wsInput, cv.COLOR_BGRA2BGR);
  } else {
    sourceForWatershed.copyTo(wsInput);
  }

  cv.watershed(wsInput, markers);

  const centroidMap: Map<number, { sumX: number; sumY: number; count: number }> = new Map();
  for (let r = 0; r < markers.rows; r++) {
    for (let c = 0; c < markers.cols; c++) {
      const label = markers.intAt(r, c);
      if (label > 1) {
        const entry = centroidMap.get(label);
        if (entry) { entry.sumX += c; entry.sumY += r; entry.count++; }
        else { centroidMap.set(label, { sumX: c, sumY: r, count: 1 }); }
      }
    }
  }

  const centroids: Array<{ x: number; y: number; area: number }> = [];
  for (const [, v] of centroidMap) {
    if (v.count >= minArea && v.count <= maxArea) {
      centroids.push({
        x: Math.round(v.sumX / v.count),
        y: Math.round(v.sumY / v.count),
        area: v.count,
      });
    }
  }

  const totalCount = estimateWithClumps(centroids);

  [cleaned, dist, distNorm, sureFg, sureBg, unknown, markers, wsInput, morphKernel, dilateKernel].forEach(
    (m) => { try { m.delete(); } catch (_) { /* ok */ } }
  );

  return { count: totalCount, centroids };
}

function buildMask(cv: any, hsv: any, hueRanges: Array<[number, number]>, threshold: number): any {
  let mask = cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8U);
  for (const [hLow, hHigh] of hueRanges) {
    const lo = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(hLow, threshold, threshold));
    const hi = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(hHigh, 255, 255));
    const partial = new cv.Mat();
    cv.inRange(hsv, lo, hi, partial);
    cv.bitwise_or(mask, partial, mask);
    lo.delete(); hi.delete(); partial.delete();
  }
  return mask;
}

// ── Worker API ──────────────────────────────────────────────────────────
const workerApi = {
  async init() {
    await loadOpenCV();
    return true;
  },

  // Quick normalization for thumbnail display
  async normalizeImage(
    imageData: ImageData
  ): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
    await loadOpenCV();
    const cv = self.cv;
    const src = cv.matFromImageData(imageData);
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const normalized = subtractBackground(cv, rgb);
    const rgba = new cv.Mat();
    cv.cvtColor(normalized, rgba, cv.COLOR_RGB2RGBA);
    const buffer = new Uint8ClampedArray(rgba.data).buffer.slice(0);
    const w = rgba.cols, h = rgba.rows;
    src.delete(); rgb.delete(); normalized.delete(); rgba.delete();
    return { buffer, width: w, height: h };
  },

  // Cache a normalized image for fast real-time re-thresholding
  async cacheNormalized(
    imageData: ImageData,
    imageName: string
  ): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
    await loadOpenCV();
    const cv = self.cv;

    // Free previous cache
    if (cachedNormalized) { try { cachedNormalized.delete(); } catch (_) { /* ok */ } }

    const src = cv.matFromImageData(imageData);
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const normalized = subtractBackground(cv, rgb);

    cachedNormalized = normalized;
    cachedImageName = imageName;
    cachedWidth = normalized.cols;
    cachedHeight = normalized.rows;

    const rgba = new cv.Mat();
    cv.cvtColor(normalized, rgba, cv.COLOR_RGB2RGBA);
    const buffer = new Uint8ClampedArray(rgba.data).buffer.slice(0);
    src.delete(); rgb.delete(); rgba.delete();
    return { buffer, width: cachedWidth, height: cachedHeight };
  },

  // Fast re-threshold on cached image (contour-based, no watershed)
  // Returns annotated image + counts in ~50-150ms
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
    greenCells: Array<{ x: number; y: number; area: number }>;
    redCells: Array<{ x: number; y: number; area: number }>;
  } | null> {
    if (!cachedNormalized) return null;
    const cv = self.cv;

    // CLAHE enhancement
    const lab = new cv.Mat();
    cv.cvtColor(cachedNormalized, lab, cv.COLOR_RGB2Lab);
    const labCh = new cv.MatVector();
    cv.split(lab, labCh);
    const clahe = new cv.CLAHE(params.claheClipLimit, new cv.Size(8, 8));
    const lEnh = new cv.Mat();
    clahe.apply(labCh.get(0), lEnh);
    const mergedCh = new cv.MatVector();
    mergedCh.push_back(lEnh);
    mergedCh.push_back(labCh.get(1));
    mergedCh.push_back(labCh.get(2));
    const labEnh = new cv.Mat();
    cv.merge(mergedCh, labEnh);
    const enhanced = new cv.Mat();
    cv.cvtColor(labEnh, enhanced, cv.COLOR_Lab2RGB);

    const ksize = params.blurKernelSize % 2 === 0 ? params.blurKernelSize + 1 : params.blurKernelSize;
    const blurred = new cv.Mat();
    cv.GaussianBlur(enhanced, blurred, new cv.Size(ksize, ksize), 0);

    const hsv = new cv.Mat();
    cv.cvtColor(blurred, hsv, cv.COLOR_RGB2HSV);

    // Fast contour-based detection
    const greenCells = detectCellsFast(cv, hsv, [[35, 85]], params.greenThreshold, params.minCellArea, params.maxCellArea);
    const redCells = detectCellsFast(cv, hsv, [[0, 10], [170, 180]], params.redThreshold, params.minCellArea, params.maxCellArea);

    const greenCount = estimateWithClumps(greenCells);
    const redCount = estimateWithClumps(redCells);
    const total = greenCount + redCount;
    const viabilityPct = total > 0 ? (greenCount / total) * 100 : 0;

    // Draw annotations on normalized image
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

    lab.delete(); labCh.delete(); lEnh.delete(); mergedCh.delete();
    labEnh.delete(); enhanced.delete(); blurred.delete(); hsv.delete();
    annotated.delete();

    return {
      annotatedBuffer,
      width: cachedWidth,
      height: cachedHeight,
      green: greenCount,
      red: redCount,
      total,
      viabilityPct,
      greenCells,
      redCells,
    };
  },

  // Full batch processing (with watershed for accuracy)
  async processImage(
    imageData: ImageData,
    imageName: string,
    params: ProcessingParams
  ): Promise<CellCountResult> {
    await loadOpenCV();
    const cv = self.cv;

    const src = cv.matFromImageData(imageData);
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const bgSub = subtractBackground(cv, rgb);
    const rgbSrc = new cv.Mat();
    bgSub.copyTo(rgbSrc);

    const lab = new cv.Mat();
    cv.cvtColor(bgSub, lab, cv.COLOR_RGB2Lab);
    const labCh = new cv.MatVector();
    cv.split(lab, labCh);
    const clahe = new cv.CLAHE(params.claheClipLimit, new cv.Size(8, 8));
    const lEnh = new cv.Mat();
    clahe.apply(labCh.get(0), lEnh);
    const mergedCh = new cv.MatVector();
    mergedCh.push_back(lEnh);
    mergedCh.push_back(labCh.get(1));
    mergedCh.push_back(labCh.get(2));
    const labEnh = new cv.Mat();
    cv.merge(mergedCh, labEnh);
    const enhanced = new cv.Mat();
    cv.cvtColor(labEnh, enhanced, cv.COLOR_Lab2RGB);
    const ksize = params.blurKernelSize % 2 === 0 ? params.blurKernelSize + 1 : params.blurKernelSize;
    const blurred = new cv.Mat();
    cv.GaussianBlur(enhanced, blurred, new cv.Size(ksize, ksize), 0);
    const hsv = new cv.Mat();
    cv.cvtColor(blurred, hsv, cv.COLOR_RGB2HSV);

    const greenMask = buildMask(cv, hsv, [[35, 85]], params.greenThreshold);
    const redMask = buildMask(cv, hsv, [[0, 10], [170, 180]], params.redThreshold);

    const greenR = countCellsWatershed(cv, greenMask, rgbSrc, params.minCellArea, params.maxCellArea);
    const redR = countCellsWatershed(cv, redMask, rgbSrc, params.minCellArea, params.maxCellArea);

    const green = greenR.count;
    const red = redR.count;
    const total = green + red;
    const viabilityPct = total > 0 ? (green / total) * 100 : 0;

    [src, rgb, bgSub, rgbSrc, lab, labEnh, enhanced, blurred, hsv, greenMask, redMask, lEnh].forEach(
      (m) => { try { m.delete(); } catch (_) { /* ok */ } }
    );
    try { labCh.delete(); } catch (_) { /* ok */ }
    try { mergedCh.delete(); } catch (_) { /* ok */ }

    return { imageName, green, red, total, viabilityPct };
  },
};

export type WorkerApi = typeof workerApi;

Comlink.expose(workerApi);
