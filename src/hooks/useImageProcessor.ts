import { useRef, useState, useCallback, useEffect } from "react";
import * as Comlink from "comlink";
import UTIF from "utif2";
import type { WorkerApi } from "../workers/cellCounter.worker";
import type { ProcessingParams } from "../lib/types";

const MAX_DIM = 2048;

function bufferToDataUrl(buffer: ArrayBuffer, width: number, height: number): string {
  const clamped = new Uint8ClampedArray(buffer);
  const imgData = new ImageData(clamped, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function isTiff(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".tif") || name.endsWith(".tiff") || file.type === "image/tiff";
}

function decodeTiff(buffer: ArrayBuffer): ImageData {
  const ifds = UTIF.decode(buffer);
  if (ifds.length === 0) throw new Error("Empty TIFF file");
  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  return new ImageData(new Uint8ClampedArray(rgba), ifds[0].width, ifds[0].height);
}

function scaleDown(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, srcWidth: number, srcHeight: number): { width: number; height: number } {
  if (srcWidth <= MAX_DIM && srcHeight <= MAX_DIM) return { width: srcWidth, height: srcHeight };

  const scale = Math.min(MAX_DIM / srcWidth, MAX_DIM / srcHeight);
  const w = Math.round(srcWidth * scale);
  const h = Math.round(srcHeight * scale);

  const tmp = document.createElement("canvas");
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  tmp.getContext("2d")!.drawImage(canvas, 0, 0);

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, w, h);

  return { width: w, height: h };
}

function createWorker() {
  return new Worker(
    new URL("../workers/cellCounter.worker.ts", import.meta.url),
    { type: "module" }
  );
}

export interface FastPreviewResult {
  annotatedDataUrl: string;
  normalizedDataUrl: string;
  green: number;
  red: number;
  total: number;
  viabilityPct: number;
  confidence: number;
  greenCells: Array<{ x: number; y: number; area: number }>;
  redCells: Array<{ x: number; y: number; area: number }>;
}

export function useImageProcessor() {
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<WorkerApi> | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initWorker = useCallback(async (retries = 2) => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    setReady(false);
    setLoading(true);
    setError(null);

    for (let attempt = 0; attempt <= retries; attempt++) {
      const worker = createWorker();
      workerRef.current = worker;
      const api = Comlink.wrap<WorkerApi>(worker);
      apiRef.current = api;

      try {
        await Promise.race([
          api.init(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("OpenCV init timed out")), 15000)
          ),
        ]);
        setReady(true);
        setLoading(false);
        return;
      } catch (e: unknown) {
        console.warn(`Worker init attempt ${attempt + 1} failed:`, e);
        worker.terminate();
        workerRef.current = null;
        apiRef.current = null;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 500));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setError(`Failed to initialize OpenCV: ${msg}. Try refreshing the page.`);
          setLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    initWorker();
    return () => { workerRef.current?.terminate(); };
  }, [initWorker]);

  const loadImageData = useCallback(async (file: File): Promise<ImageData> => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas ctx");

    if (isTiff(file)) {
      const buf = await file.arrayBuffer();
      const imgData = decodeTiff(buf);
      canvas.width = imgData.width;
      canvas.height = imgData.height;
      ctx.putImageData(imgData, 0, 0);
    } else {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`Failed to load: ${file.name}`));
        el.src = URL.createObjectURL(file);
      });
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
    }

    const { width, height } = scaleDown(canvas, ctx, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, width, height);
  }, []);

  const normalizeImage = useCallback(async (file: File): Promise<string> => {
    if (!apiRef.current || !ready) throw new Error("OpenCV not ready");
    const imageData = await loadImageData(file);
    const { buffer, width, height } = await apiRef.current.normalizeImage(imageData);
    return bufferToDataUrl(buffer, width, height);
  }, [ready, loadImageData]);

  const cacheAndPreview = useCallback(async (
    file: File,
    params: ProcessingParams
  ): Promise<FastPreviewResult> => {
    if (!apiRef.current || !ready) throw new Error("OpenCV not ready");
    const imageData = await loadImageData(file);

    const { buffer, width, height } = await apiRef.current.cacheNormalized(imageData, file.name);
    const normalizedDataUrl = bufferToDataUrl(buffer, width, height);

    const result = await apiRef.current.fastReThreshold(params);
    if (!result) throw new Error("Cache miss");

    return {
      normalizedDataUrl,
      annotatedDataUrl: bufferToDataUrl(result.annotatedBuffer, result.width, result.height),
      green: result.green,
      red: result.red,
      total: result.total,
      viabilityPct: result.viabilityPct,
      confidence: result.confidence,
      greenCells: result.greenCells,
      redCells: result.redCells,
    };
  }, [ready, loadImageData]);

  const fastReThreshold = useCallback(async (
    params: ProcessingParams
  ): Promise<FastPreviewResult | null> => {
    if (!apiRef.current || !ready) return null;

    const result = await apiRef.current.fastReThreshold(params);
    if (!result) return null;

    return {
      normalizedDataUrl: "",
      annotatedDataUrl: bufferToDataUrl(result.annotatedBuffer, result.width, result.height),
      green: result.green,
      red: result.red,
      total: result.total,
      viabilityPct: result.viabilityPct,
      confidence: result.confidence,
      greenCells: result.greenCells,
      redCells: result.redCells,
    };
  }, [ready]);

  const clearCache = useCallback(async () => {
    if (apiRef.current) {
      await apiRef.current.clearCache();
    }
  }, []);

  const restartWorker = useCallback(async () => {
    await initWorker();
  }, [initWorker]);

  return {
    ready, loading, error,
    normalizeImage, cacheAndPreview, fastReThreshold, clearCache, restartWorker,
  };
}
