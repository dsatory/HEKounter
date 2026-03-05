import { useState, useCallback, useEffect, useRef } from "react";
import { Microscope, Play, Download, Loader2, Trash2, MousePointer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageDropzone } from "@/components/ImageDropzone";
import { ProcessingControls } from "@/components/ProcessingControls";
import { ImagePreview } from "@/components/ImagePreview";
import { ResultsTable } from "@/components/ResultsTable";
import { ProgressBar } from "@/components/ProgressBar";
import { useImageProcessor } from "@/hooks/useImageProcessor";
import { downloadCSV } from "@/lib/csvExport";
import { DEFAULT_PARAMS } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { LoadedImage, ProcessingParams, CellCountResult, ManualCell } from "@/lib/types";

let idCounter = 0;

function App() {
  const [images, setImages] = useState<LoadedImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  // Global baseline params
  const [globalParams, setGlobalParams] = useState<ProcessingParams>(DEFAULT_PARAMS);
  // Per-image overrides (image id -> params). Missing = use global.
  const [imageParamsMap, setImageParamsMap] = useState<Map<string, ProcessingParams>>(new Map());

  const [results, setResults] = useState<CellCountResult[]>([]);
  const [annotatedUrl, setAnnotatedUrl] = useState<string | undefined>();
  const [normalizedUrl, setNormalizedUrl] = useState<string | undefined>();
  const [previewProcessing, setPreviewProcessing] = useState(false);
  const [clickMode, setClickMode] = useState<"off" | "green" | "red">("off");
  const [manualCells, setManualCells] = useState<Map<string, ManualCell[]>>(new Map());
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | undefined>();
  const [liveResult, setLiveResult] = useState<CellCountResult | undefined>();

  const normalizeQueueRef = useRef<LoadedImage[]>([]);
  const normalizingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedForImageRef = useRef<string>("");

  const {
    ready, loading, processing, progress, error,
    normalizeImage, cacheAndPreview, fastReThreshold, processBatch,
  } = useImageProcessor();

  const selectedImage = images.find((img) => img.id === selectedId);
  const currentManualCells = selectedImage ? (manualCells.get(selectedImage.id) || []) : [];

  // Effective params for the currently selected image
  const activeParams = selectedImage
    ? (imageParamsMap.get(selectedImage.id) ?? globalParams)
    : globalParams;
  const isCustom = selectedImage ? imageParamsMap.has(selectedImage.id) : false;

  // Get effective params for any image by id
  const getParamsForImage = useCallback(
    (imgId: string) => imageParamsMap.get(imgId) ?? globalParams,
    [imageParamsMap, globalParams]
  );

  // ── Param changes ────────────────────────────────────────────────
  const handleParamsChange = useCallback(
    (newParams: ProcessingParams) => {
      if (!selectedImage) {
        setGlobalParams(newParams);
        return;
      }
      // Store as per-image override
      setImageParamsMap((prev) => {
        const next = new Map(prev);
        next.set(selectedImage.id, newParams);
        return next;
      });
    },
    [selectedImage]
  );

  const handleApplyToAll = useCallback(() => {
    // Set current active params as new global baseline
    setGlobalParams({ ...activeParams });
    // Clear all per-image overrides so all images use the new global
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

  // ── Auto-normalize queue ──────────────────────────────────────────
  const processNormalizeQueue = useCallback(async () => {
    if (normalizingRef.current || !ready) return;
    normalizingRef.current = true;

    while (normalizeQueueRef.current.length > 0) {
      const img = normalizeQueueRef.current.shift()!;
      try {
        setImages((prev) =>
          prev.map((i) => (i.id === img.id ? { ...i, normalizing: true } : i))
        );
        const url = await normalizeImage(img.file);
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id ? { ...i, normalizedUrl: url, normalizing: false } : i
          )
        );
      } catch (e) {
        console.error(`Normalization failed for ${img.name}:`, e);
        setImages((prev) =>
          prev.map((i) => (i.id === img.id ? { ...i, normalizing: false } : i))
        );
      }
    }
    normalizingRef.current = false;
  }, [ready, normalizeImage]);

  useEffect(() => {
    if (ready && normalizeQueueRef.current.length > 0) {
      processNormalizeQueue();
    }
  }, [ready, processNormalizeQueue]);

  // ── Debounced real-time threshold update ───────────────────────────
  const runFastPreview = useCallback(async (p: ProcessingParams) => {
    if (!selectedImage || !ready) return;

    if (cachedForImageRef.current !== selectedImage.name) {
      setPreviewProcessing(true);
      try {
        const res = await cacheAndPreview(selectedImage.file, p);
        cachedForImageRef.current = selectedImage.name;
        setNormalizedUrl(res.normalizedDataUrl);
        setAnnotatedUrl(res.annotatedDataUrl);
        setImageNaturalSize({ width: 0, height: 0 });
        setLiveResult({
          imageName: selectedImage.name,
          green: res.green, red: res.red,
          total: res.total, viabilityPct: res.viabilityPct,
        });
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
        setLiveResult({
          imageName: selectedImage.name,
          green: res.green, red: res.red,
          total: res.total, viabilityPct: res.viabilityPct,
        });
      }
    } catch (e) {
      console.error("Fast re-threshold failed:", e);
    }
  }, [selectedImage, ready, cacheAndPreview, fastReThreshold]);

  // Debounce threshold changes using the active params for the selected image
  useEffect(() => {
    if (!selectedImage || !ready || processing) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runFastPreview(activeParams);
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeParams, selectedImage?.id, ready, processing, runFastPreview]);

  // ── Image management ──────────────────────────────────────────────
  const handleImagesAdded = useCallback((files: File[]) => {
    const newImages: LoadedImage[] = files.map((f) => ({
      id: `img-${++idCounter}`,
      file: f,
      name: f.name,
      previewUrl: URL.createObjectURL(f),
    }));
    setImages((prev) => [...prev, ...newImages]);
    if (!selectedId && newImages.length > 0) {
      setSelectedId(newImages[0].id);
    }
    normalizeQueueRef.current.push(...newImages);
    if (ready) processNormalizeQueue();
  }, [selectedId, ready, processNormalizeQueue]);

  const handleImageRemove = useCallback((id: string) => {
    setImages((prev) => {
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
    setResults((prev) => {
      const removed = images.find((img) => img.id === id);
      return removed ? prev.filter((r) => r.imageName !== removed.name) : prev;
    });
    setManualCells((prev) => { const n = new Map(prev); n.delete(id); return n; });
    setImageParamsMap((prev) => { const n = new Map(prev); n.delete(id); return n; });
    normalizeQueueRef.current = normalizeQueueRef.current.filter((i) => i.id !== id);
  }, [selectedId, images]);

  const handleImageSelect = useCallback((id: string) => {
    setSelectedId(id);
    const img = images.find((i) => i.id === id);
    if (!img) return;

    setNormalizedUrl(img.normalizedUrl);
    cachedForImageRef.current = "";
    setAnnotatedUrl(undefined);
    setLiveResult(undefined);

    const existingResult = results.find((r) => r.imageName === img.name);
    if (existingResult?.annotatedImageData) {
      setAnnotatedUrl(existingResult.annotatedImageData);
    }
  }, [images, results]);

  useEffect(() => {
    if (selectedId) {
      const img = images.find((i) => i.id === selectedId);
      if (img?.normalizedUrl && !normalizedUrl) {
        setNormalizedUrl(img.normalizedUrl);
      }
    }
  }, [images, selectedId, normalizedUrl]);

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

  // ── Batch processing (uses per-image params) ──────────────────────
  const handleProcessAll = useCallback(async () => {
    if (images.length === 0 || !ready) return;
    setResults([]);
    setAnnotatedUrl(undefined);
    const files = images.map((img) => img.file);
    const paramsPerFile = images.map((img) => getParamsForImage(img.id));

    setImages((prev) => prev.map((img) => ({ ...img, processing: true, result: undefined })));

    await processBatch(files, paramsPerFile, (result, index) => {
      const img = images[index];
      const manual = manualCells.get(img.id) || [];
      const manualGreen = manual.filter((c) => c.type === "green").length;
      const manualRed = manual.filter((c) => c.type === "red").length;
      const merged: CellCountResult = {
        ...result,
        green: result.green + manualGreen,
        red: result.red + manualRed,
        total: result.total + manualGreen + manualRed,
        viabilityPct: 0,
      };
      merged.viabilityPct = merged.total > 0 ? (merged.green / merged.total) * 100 : 0;

      setResults((prev) => [...prev, merged]);
      setImages((prev) =>
        prev.map((img, i) =>
          i === index ? { ...img, processing: false, result: merged } : img
        )
      );
    });

    setImages((prev) => prev.map((img) => ({ ...img, processing: false })));
  }, [images, ready, getParamsForImage, processBatch, manualCells]);

  const handleExportCSV = useCallback(() => {
    if (results.length === 0) return;
    downloadCSV(results);
  }, [results]);

  const handleClearAll = useCallback(() => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    normalizeQueueRef.current = [];
    cachedForImageRef.current = "";
    setImages([]);
    setResults([]);
    setSelectedId(undefined);
    setAnnotatedUrl(undefined);
    setNormalizedUrl(undefined);
    setLiveResult(undefined);
    setManualCells(new Map());
    setImageParamsMap(new Map());
    setClickMode("off");
  }, [images]);

  const displayResult = liveResult || selectedImage?.result;
  const customCount = imageParamsMap.size;

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
                Fluorescence Cell Viability Counter
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
            {error && <span className="text-sm text-danger mr-2">{error}</span>}
            {customCount > 0 && (
              <span className="text-[11px] text-muted-foreground mr-1">
                {customCount} custom
              </span>
            )}
            {images.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearAll} disabled={processing}>
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
            <Button size="sm" onClick={handleProcessAll} disabled={!ready || images.length === 0 || processing}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Process All
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={results.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <ImageDropzone
              images={images}
              onImagesAdded={handleImagesAdded}
              onImageRemove={handleImageRemove}
              onImageSelect={handleImageSelect}
              selectedId={selectedId}
              customParamsIds={new Set(imageParamsMap.keys())}
            />

            {progress && <ProgressBar progress={progress} />}

            {selectedImage && annotatedUrl && (
              <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card">
                <span className="text-xs text-muted-foreground mr-1">
                  <MousePointer className="h-3.5 w-3.5 inline mr-1" />
                  Manual add:
                </span>
                <Button
                  size="sm"
                  variant={clickMode === "green" ? "default" : "outline"}
                  className={cn(
                    "text-xs h-7",
                    clickMode === "green" && "bg-green-600 hover:bg-green-700 text-white"
                  )}
                  onClick={() => setClickMode(clickMode === "green" ? "off" : "green")}
                >
                  Green (Live)
                </Button>
                <Button
                  size="sm"
                  variant={clickMode === "red" ? "default" : "outline"}
                  className={cn(
                    "text-xs h-7",
                    clickMode === "red" && "bg-red-600 hover:bg-red-700 text-white"
                  )}
                  onClick={() => setClickMode(clickMode === "red" ? "off" : "red")}
                >
                  Red (Dead)
                </Button>
                {currentManualCells.length > 0 && (
                  <>
                    <div className="h-4 w-px bg-border mx-1" />
                    <Button size="sm" variant="ghost" className="text-xs h-7" onClick={handleUndoManualCell}>
                      <Undo2 className="h-3 w-3 mr-1" />
                      Undo ({currentManualCells.length})
                    </Button>
                  </>
                )}
              </div>
            )}

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
              imageNaturalSize={imageNaturalSize}
            />

            {results.length > 0 && <ResultsTable results={results} />}
          </div>

          <div className="col-span-4">
            <div className="sticky top-20 rounded-lg border border-border bg-card p-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
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
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
