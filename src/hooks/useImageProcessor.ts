import { useRef, useState, useCallback, useEffect } from "react";
import * as Comlink from "comlink";
import type { WorkerApi } from "../workers/cellCounter.worker";
import type { ProcessingParams, CellCountResult, ProcessingProgress } from "../lib/types";

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
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cachedNameRef = useRef<string>("");

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/cellCounter.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    const api = Comlink.wrap<WorkerApi>(worker);
    apiRef.current = api;

    api.init()
      .then(() => { setReady(true); setLoading(false); })
      .catch((e: Error) => {
        setError(`Failed to initialize OpenCV: ${e.message}`);
        setLoading(false);
      });

    return () => { worker.terminate(); };
  }, []);

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

  // Cache the normalized image and return its data URL + initial fast preview
  const cacheAndPreview = useCallback(async (
    file: File,
    params: ProcessingParams
  ): Promise<FastPreviewResult> => {
    if (!apiRef.current || !ready) throw new Error("OpenCV not ready");
    const imageData = await loadImageData(file);

    // Cache the normalized image in worker
    const { buffer, width, height } = await apiRef.current.cacheNormalized(imageData, file.name);
    cachedNameRef.current = file.name;
    const normalizedDataUrl = bufferToDataUrl(buffer, width, height);

    // Run fast threshold detection
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

  // Fast re-threshold on already-cached image (for real-time slider updates)
  const fastReThreshold = useCallback(async (
    params: ProcessingParams
  ): Promise<FastPreviewResult | null> => {
    if (!apiRef.current || !ready) return null;

    const result = await apiRef.current.fastReThreshold(params);
    if (!result) return null;

    return {
      normalizedDataUrl: "",  // caller already has this
      annotatedDataUrl: bufferToDataUrl(result.annotatedBuffer, result.width, result.height),
      green: result.green,
      red: result.red,
      total: result.total,
      viabilityPct: result.viabilityPct,
      greenCells: result.greenCells,
      redCells: result.redCells,
    };
  }, [ready]);

  const processBatch = useCallback(async (
    files: File[],
    paramsPerFile: ProcessingParams[],
    onResult: (result: CellCountResult, index: number) => void
  ): Promise<CellCountResult[]> => {
    if (!apiRef.current || !ready) throw new Error("OpenCV not ready");
    setProcessing(true);
    const results: CellCountResult[] = [];

    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length, currentName: files[i].name });
      try {
        const imageData = await loadImageData(files[i]);
        const result = await apiRef.current.processImage(imageData, files[i].name, paramsPerFile[i]);
        results.push(result);
        onResult(result, i);
      } catch (e) {
        const errResult: CellCountResult = {
          imageName: files[i].name, green: 0, red: 0, total: 0, viabilityPct: 0,
        };
        results.push(errResult);
        onResult(errResult, i);
      }
    }

    setProcessing(false);
    setProgress(null);
    return results;
  }, [ready, loadImageData]);

  return {
    ready, loading, processing, progress, error,
    normalizeImage, cacheAndPreview, fastReThreshold, processBatch,
  };
}
