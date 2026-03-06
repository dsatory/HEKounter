import { useState, useCallback, useEffect, useRef } from "react";
import { Microscope, Download, Loader2, Trash2, MousePointer, Undo2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageDropzone } from "@/components/ImageDropzone";
import { ProcessingControls } from "@/components/ProcessingControls";
import { ImagePreview } from "@/components/ImagePreview";
import { ResultsTable } from "@/components/ResultsTable";
import { useImageProcessor, isTiff, tiffToDataUrl } from "@/hooks/useImageProcessor";
import { downloadCSV } from "@/lib/csvExport";
import { DEFAULT_PARAMS } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { LoadedImage, ProcessingParams, CellCountResult, ManualCell } from "@/lib/types";

let idCounter = 0;

function App() {
  const [images, setImages] = useState<LoadedImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const [globalParams, setGlobalParams] = useState<ProcessingParams>(DEFAULT_PARAMS);
  const [imageParamsMap, setImageParamsMap] = useState<Map<string, ProcessingParams>>(new Map());

  const [annotatedUrl, setAnnotatedUrl] = useState<string | undefined>();
  const [normalizedUrl, setNormalizedUrl] = useState<string | undefined>();
  const [previewProcessing, setPreviewProcessing] = useState(false);
  const [clickMode, setClickMode] = useState<"off" | "green" | "red" | "remove-green" | "remove-red">("off");
  const [manualCells, setManualCells] = useState<Map<string, ManualCell[]>>(new Map());
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | undefined>();
  const [liveResult, setLiveResult] = useState<CellCountResult | undefined>();

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const analyzeQueueRef = useRef<LoadedImage[]>([]);
  const analyzingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedForImageRef = useRef<string>("");
  const globalParamsRef = useRef(globalParams);
  globalParamsRef.current = globalParams;
  const imageParamsMapRef = useRef(imageParamsMap);
  imageParamsMapRef.current = imageParamsMap;

  const {
    ready, loading, error,
    cacheAndPreview, fastReThreshold, clearCache, restartWorker,
  } = useImageProcessor();

  const selectedImage = images.find((img) => img.id === selectedId);
  const currentManualCells = selectedImage ? (manualCells.get(selectedImage.id) || []) : [];

  const activeParams = selectedImage
    ? (imageParamsMap.get(selectedImage.id) ?? globalParams)
    : globalParams;
  const isCustom = selectedImage ? imageParamsMap.has(selectedImage.id) : false;

  const getParamsForImage = useCallback(
    (imgId: string) => imageParamsMapRef.current.get(imgId) ?? globalParamsRef.current,
    []
  );

  const buildExportResults = useCallback((): CellCountResult[] => {
    return images
      .filter((img) => img.result)
      .map((img) => {
        const manual = manualCells.get(img.id) || [];
        const manualGreen = manual.filter((c) => c.type === "green").length;
        const manualRed = manual.filter((c) => c.type === "red").length;
        const base = img.result!;
        const green = base.green + manualGreen;
        const red = base.red + manualRed;
        const total = green + red;
        return {
          ...base,
          green,
          red,
          total,
          viabilityPct: total > 0 ? (green / total) * 100 : 0,
        };
      });
  }, [images, manualCells]);

  // ── Param changes ────────────────────────────────────────────────
  const handleParamsChange = useCallback(
    (newParams: ProcessingParams) => {
      if (!selectedImage) {
        setGlobalParams(newParams);
        return;
      }
      setImageParamsMap((prev) => {
        const next = new Map(prev);
        next.set(selectedImage.id, newParams);
        return next;
      });
    },
    [selectedImage]
  );

  const handleApplyToAll = useCallback(() => {
    setGlobalParams({ ...activeParams });
    setImageParamsMap(new Map());
  }, [activeParams]);

  const handleResetToGlobal = useCallback(() => {
    if (!selectedImage) return;
    setImageParamsMap((prev) => {
      const next = new Map(prev);
      next.delete(selectedImage.id);
      return next;
    });
  }, [selectedImage]);

  // ── Auto analyze queue ─────────────────────────────────────────
  const processAnalyzeQueue = useCallback(async () => {
    if (analyzingRef.current || !ready) return;
    analyzingRef.current = true;
    setBatchRunning(true);

    const total = analyzeQueueRef.current.length;
    let processed = 0;

    while (analyzeQueueRef.current.length > 0) {
      const img = analyzeQueueRef.current.shift()!;
      processed++;
      setBatchProgress({ current: processed, total });

      setImages((prev) =>
        prev.map((i) => (i.id === img.id ? { ...i, analysisStatus: "analyzing" } : i))
      );

      try {
        const params = getParamsForImage(img.id);
        const res = await cacheAndPreview(img.file, params);

        const result: CellCountResult = {
          imageName: img.name,
          green: res.green,
          red: res.red,
          total: res.total,
          viabilityPct: res.viabilityPct,
          confidence: res.confidence,
        };

        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? {
                  ...i,
                  normalizedUrl: res.normalizedDataUrl,
                  annotatedUrl: res.annotatedDataUrl,
                  analysisStatus: "done" as const,
                  result,
                }
              : i
          )
        );
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const reason = raw.includes("memory")
          ? "Out of memory — image may be too large"
          : raw.includes("load")
          ? "Failed to load image file"
          : `Processing error: ${raw.slice(0, 80)}`;
        console.error(`Analysis failed for ${img.name}:`, raw);
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? { ...i, analysisStatus: "failed" as const, failureReason: reason }
              : i
          )
        );
      } finally {
        try { await clearCache(); } catch { /* worker may be recovering */ }
      }
    }

    cachedForImageRef.current = "";
    analyzingRef.current = false;
    setBatchRunning(false);
    setBatchProgress(null);

    // Restart worker to reclaim WASM memory after batch (non-blocking)
    restartWorker().catch((e) => console.warn("Worker restart failed:", e));
  }, [ready, cacheAndPreview, clearCache, getParamsForImage, restartWorker]);

  useEffect(() => {
    if (ready && analyzeQueueRef.current.length > 0 && !analyzingRef.current) {
      processAnalyzeQueue();
    }
  }, [ready, processAnalyzeQueue]);

  // ── Debounced real-time threshold update ───────────────────────────
  const runFastPreview = useCallback(async (p: ProcessingParams) => {
    if (!selectedImage || !ready || analyzingRef.current) return;

    if (cachedForImageRef.current !== selectedImage.name) {
      setPreviewProcessing(true);
      try {
        const res = await cacheAndPreview(selectedImage.file, p);
        cachedForImageRef.current = selectedImage.name;
        setNormalizedUrl(res.normalizedDataUrl);
        setAnnotatedUrl(res.annotatedDataUrl);
        setImageNaturalSize({ width: res.width, height: res.height });

        const result: CellCountResult = {
          imageName: selectedImage.name,
          green: res.green, red: res.red,
          total: res.total, viabilityPct: res.viabilityPct,
          confidence: res.confidence,
        };
        setLiveResult(result);
        setImages((prev) =>
          prev.map((i) => (i.id === selectedImage.id
            ? { ...i, result, annotatedUrl: res.annotatedDataUrl }
            : i))
        );
      } catch (e) {
        console.error("Cache+preview failed:", e);
      } finally {
        setPreviewProcessing(false);
      }
      return;
    }

    try {
      const res = await fastReThreshold(p);
      if (res) {
        setAnnotatedUrl(res.annotatedDataUrl);
        const result: CellCountResult = {
          imageName: selectedImage.name,
          green: res.green, red: res.red,
          total: res.total, viabilityPct: res.viabilityPct,
          confidence: res.confidence,
        };
        setLiveResult(result);
        setImages((prev) =>
          prev.map((i) => (i.id === selectedImage.id
            ? { ...i, result, annotatedUrl: res.annotatedDataUrl }
            : i))
        );
      }
    } catch (e) {
      console.error("Fast re-threshold failed:", e);
    }
  }, [selectedImage, ready, cacheAndPreview, fastReThreshold]);

  useEffect(() => {
    if (!selectedImage || !ready || batchRunning) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runFastPreview(activeParams);
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeParams, selectedImage?.id, ready, batchRunning, runFastPreview]);

  // ── Image management ──────────────────────────────────────────────
  const handleImagesAdded = useCallback(async (files: File[]) => {
    const newImages: LoadedImage[] = [];
    for (const f of files) {
      let previewUrl: string;
      if (isTiff(f)) {
        try {
          previewUrl = tiffToDataUrl(await f.arrayBuffer());
        } catch {
          previewUrl = "";
        }
      } else {
        previewUrl = URL.createObjectURL(f);
      }

      newImages.push({
        id: `img-${++idCounter}`,
        file: f,
        name: f.name,
        previewUrl,
        analysisStatus: "pending" as const,
      });
    }
    setImages((prev) => [...prev, ...newImages]);
    if (!selectedId && newImages.length > 0) {
      setSelectedId(newImages[0].id);
    }
    analyzeQueueRef.current.push(...newImages);
    if (ready && !analyzingRef.current) processAnalyzeQueue();
  }, [selectedId, ready, processAnalyzeQueue]);

  const handleImageRemove = useCallback((id: string) => {
    setImages((prev) => {
      const removed = prev.find((img) => img.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      const next = prev.filter((img) => img.id !== id);
      if (selectedId === id) {
        setSelectedId(next.length > 0 ? next[0].id : undefined);
        setAnnotatedUrl(undefined);
        setNormalizedUrl(undefined);
        setLiveResult(undefined);
        cachedForImageRef.current = "";
      }
      return next;
    });
    setManualCells((prev) => { const n = new Map(prev); n.delete(id); return n; });
    setImageParamsMap((prev) => { const n = new Map(prev); n.delete(id); return n; });
    analyzeQueueRef.current = analyzeQueueRef.current.filter((i) => i.id !== id);
  }, [selectedId]);

  const handleImageSelect = useCallback((id: string) => {
    setSelectedId(id);
    const img = images.find((i) => i.id === id);
    if (!img) return;

    setNormalizedUrl(img.normalizedUrl);
    setAnnotatedUrl(img.annotatedUrl);
    setLiveResult(img.result || undefined);
    cachedForImageRef.current = "";
  }, [images]);

  useEffect(() => {
    if (selectedId) {
      const img = images.find((i) => i.id === selectedId);
      if (img?.normalizedUrl && !normalizedUrl) {
        setNormalizedUrl(img.normalizedUrl);
      }
      if (img?.annotatedUrl && !annotatedUrl) {
        setAnnotatedUrl(img.annotatedUrl);
      }
    }
  }, [images, selectedId, normalizedUrl, annotatedUrl]);

  // ── Manual cell clicker ───────────────────────────────────────────
  const handleManualCellAdd = useCallback((cell: ManualCell) => {
    if (!selectedImage) return;
    setManualCells((prev) => {
      const next = new Map(prev);
      const existing = next.get(selectedImage.id) || [];
      next.set(selectedImage.id, [...existing, cell]);
      return next;
    });
  }, [selectedImage]);

  const handleManualCellRemove = useCallback((index: number) => {
    if (!selectedImage) return;
    setManualCells((prev) => {
      const next = new Map(prev);
      const existing = next.get(selectedImage.id) || [];
      if (index >= 0 && index < existing.length) {
        next.set(selectedImage.id, existing.filter((_, i) => i !== index));
      }
      return next;
    });
  }, [selectedImage]);

  const handleUndoManualCell = useCallback(() => {
    if (!selectedImage) return;
    setManualCells((prev) => {
      const next = new Map(prev);
      const existing = next.get(selectedImage.id) || [];
      if (existing.length > 0) {
        next.set(selectedImage.id, existing.slice(0, -1));
      }
      return next;
    });
  }, [selectedImage]);

  const handleRetryFailed = useCallback(async () => {
    const failed = images.filter((i) => i.analysisStatus === "failed");
    if (failed.length === 0 || batchRunning) return;

    setImages((prev) =>
      prev.map((i) =>
        i.analysisStatus === "failed"
          ? { ...i, analysisStatus: "pending" as const, failureReason: undefined }
          : i
      )
    );
    analyzeQueueRef.current.push(...failed);

    if (!ready) {
      await restartWorker();
    }
    if (!analyzingRef.current) processAnalyzeQueue();
  }, [images, batchRunning, ready, restartWorker, processAnalyzeQueue]);

  const handleExportCSV = useCallback(() => {
    const results = buildExportResults();
    if (results.length === 0) return;
    downloadCSV(results);
  }, [buildExportResults]);

  const handleClearAll = useCallback(() => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    analyzeQueueRef.current = [];
    cachedForImageRef.current = "";
    setImages([]);
    setSelectedId(undefined);
    setAnnotatedUrl(undefined);
    setNormalizedUrl(undefined);
    setLiveResult(undefined);
    setManualCells(new Map());
    setImageParamsMap(new Map());
    setClickMode("off");
    setBatchProgress(null);
  }, [images]);

  const displayResult = liveResult || selectedImage?.result;
  const customCount = imageParamsMap.size;

  const doneCount = images.filter((i) => i.analysisStatus === "done").length;
  const failedCount = images.filter((i) => i.analysisStatus === "failed").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Microscope className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">HEKounter</h1>
              <p className="text-[11px] text-muted-foreground -mt-0.5">
                Fluorescence Cell Viability Counter <span className="opacity-50">v1.0.0</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading OpenCV...
              </div>
            )}
            {batchProgress && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing {batchProgress.current}/{batchProgress.total}...
              </div>
            )}
            {error && <span className="text-sm text-danger mr-2">{error}</span>}
            {customCount > 0 && (
              <span className="text-[11px] text-muted-foreground mr-1">
                {customCount} custom
              </span>
            )}
            {images.length > 0 && !batchProgress && (
              <span className="text-[11px] text-muted-foreground mr-1">
                {doneCount}/{images.length} analyzed
              </span>
            )}
            {failedCount > 0 && !batchRunning && (
              <Button
                variant="outline"
                size="sm"
                className="text-danger border-danger/40 hover:bg-danger/10"
                onClick={handleRetryFailed}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Retry {failedCount} failed
              </Button>
            )}
            {images.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearAll} disabled={batchRunning}>
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={doneCount === 0}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
      </header>

      {failedCount > 0 && !batchRunning && (
        <div className="bg-danger/10 border-b border-danger/30 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
            <span className="text-danger font-medium">{failedCount} image{failedCount > 1 ? "s" : ""} failed to process</span>
            <span className="text-muted-foreground">
              — this is a browser memory limitation, not an issue with your images. Click "Retry failed" to try again with a fresh engine.
            </span>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <ImageDropzone
          images={images}
          onImagesAdded={handleImagesAdded}
          onImageRemove={handleImageRemove}
          onImageSelect={handleImageSelect}
          selectedId={selectedId}
          customParamsIds={new Set(imageParamsMap.keys())}
        />

        <div id="image-preview-section" className="grid grid-cols-12 gap-6">
          <div className="col-span-8">
            <ImagePreview
              originalUrl={selectedImage?.previewUrl}
              normalizedUrl={normalizedUrl}
              annotatedUrl={annotatedUrl}
              result={displayResult}
              imageName={selectedImage?.name}
              processing={previewProcessing}
              clickMode={clickMode}
              manualCells={currentManualCells}
              onManualCellAdd={handleManualCellAdd}
              onManualCellRemove={handleManualCellRemove}
              imageNaturalSize={imageNaturalSize}
            />
          </div>

          <div className="col-span-4">
            <div className="sticky top-20 space-y-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <ProcessingControls
                  params={activeParams}
                  onChange={handleParamsChange}
                  isCustom={isCustom}
                  imageName={selectedImage?.name}
                  onApplyToAll={handleApplyToAll}
                  onResetToGlobal={handleResetToGlobal}
                  imageCount={images.length}
                />
              </div>

              {selectedImage && annotatedUrl && (
                <div className="rounded-lg border border-border bg-card p-3 space-y-2.5">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <MousePointer className="h-3.5 w-3.5 text-muted-foreground" />
                    Manual annotation
                  </h3>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "text-xs h-7 px-2.5 flex-1 font-normal border-green-600 text-green-400 hover:text-white hover:bg-green-700",
                          clickMode === "green" && "bg-green-600 text-white ring-2 ring-green-400"
                        )}
                        onClick={() => setClickMode(clickMode === "green" ? "off" : "green")}
                      >
                        <span className="font-mono">+</span> Green
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "text-xs h-7 px-2.5 flex-1 font-normal border-red-600 text-red-400 hover:text-white hover:bg-red-700",
                          clickMode === "red" && "bg-red-600 text-white ring-2 ring-red-400"
                        )}
                        onClick={() => setClickMode(clickMode === "red" ? "off" : "red")}
                      >
                        <span className="font-mono">+</span> Red
                      </Button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "text-xs h-7 px-2.5 flex-1 font-normal border-green-600 text-green-400 hover:text-white hover:bg-green-700",
                          clickMode === "remove-green" && "bg-green-600 text-white ring-2 ring-green-400"
                        )}
                        onClick={() => setClickMode(clickMode === "remove-green" ? "off" : "remove-green")}
                      >
                        <span className="font-mono">&minus;</span> Green
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "text-xs h-7 px-2.5 flex-1 font-normal border-red-600 text-red-400 hover:text-white hover:bg-red-700",
                          clickMode === "remove-red" && "bg-red-600 text-white ring-2 ring-red-400"
                        )}
                        onClick={() => setClickMode(clickMode === "remove-red" ? "off" : "remove-red")}
                      >
                        <span className="font-mono">&minus;</span> Red
                      </Button>
                    </div>
                  </div>

                  {currentManualCells.length > 0 && (
                    <div className="pt-1 border-t border-border/50">
                      <Button size="sm" variant="ghost" className="text-xs h-7 w-full" onClick={handleUndoManualCell}>
                        <Undo2 className="h-3 w-3 mr-1" />
                        Undo ({currentManualCells.length})
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {images.length > 0 && (
          <ResultsTable
            images={images}
            manualCells={manualCells}
            selectedId={selectedId}
            onImageSelect={handleImageSelect}
          />
        )}
      </main>
    </div>
  );
}

export default App;
