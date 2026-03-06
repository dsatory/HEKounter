import { useRef, useState, useCallback, useEffect } from "react";
import * as Comlink from "comlink";
import type { WorkerApi } from "../workers/cellCounter.worker";
import type { ProcessingParams } from "../lib/types";

function bufferToDataUrl(buffer: ArrayBuffer, width: number, height: number): string {
  const clamped = new Uint8ClampedArray(buffer);
  const imgData = new ImageData(clamped, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
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
  greenCells: Array<{ x: number; y: number; area: number }>;
  redCells: Array<{ x: number; y: number; area: number }>;
}

export function useImageProcessor() {
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<WorkerApi> | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initWorker = useCallback(async () => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const worker = createWorker();
    workerRef.current = worker;
    const api = Comlink.wrap<WorkerApi>(worker);
    apiRef.current = api;

    setReady(false);
    setLoading(true);
    setError(null);

    try {
      await api.init();
      setReady(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to initialize OpenCV: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initWorker();
    return () => { workerRef.current?.terminate(); };
  }, [initWorker]);

  const loadImageData = useCallback(async (file: File): Promise<ImageData> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("No canvas ctx")); return; }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error(`Failed to load: ${file.name}`));
      img.src = URL.createObjectURL(file);
    });
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
