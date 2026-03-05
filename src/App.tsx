import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Microscope, Download, Loader2, Trash2, MousePointer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageDropzone } from "@/components/ImageDropzone";
import { ProcessingControls } from "@/components/ProcessingControls";
import { ImagePreview } from "@/components/ImagePreview";
import { ResultsTable } from "@/components/ResultsTable";
import { useImageProcessor } from "@/hooks/useImageProcessor";
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
  const [clickMode, setClickMode] = useState<"off" | "green" | "red">("off");
  const [manualCells, setManualCells] = useState<Map<string, ManualCell[]>>(new Map());
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | undefined>();
  const [liveResult, setLiveResult] = useState<CellCountResult | undefined>();
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);

  const normalizeQueueRef = useRef<LoadedImage[]>([]);
  const normalizingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedForImageRef = useRef<string>("");
  const globalParamsRef = useRef(globalParams);
  globalParamsRef.current = globalParams;
  const imageParamsMapRef = useRef(imageParamsMap);
  imageParamsMapRef.current = imageParamsMap;

  const {
    ready, loading, error,
    normalizeImage, cacheAndPreview, fastReThreshold,
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

  // Derive results from images + manual cells for CSV/table
  const allResults = useMemo(() => {
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

  // ── Auto normalize + analyze queue ─────────────────────────────
  const processNormalizeQueue = useCallback(async () => {
    if (normalizingRef.current || !ready) return;
    normalizingRef.current = true;

    const total = normalizeQueueRef.current.length;
    let processed = 0;

    while (normalizeQueueRef.current.length > 0) {
      const img = normalizeQueueRef.current.shift()!;
      processed++;
      setAnalysisProgress({ current: processed, total });

      try {
        setImages((prev) =>
          prev.map((i) => (i.id === img.id ? { ...i, normalizing: true } : i))
        );

        const params = getParamsForImage(img.id);
        const res = await cacheAndPreview(img.file, params);

        const result: CellCountResult = {
          imageName: img.name,
          green: res.green,
          red: res.red,
          total: res.total,
          viabilityPct: res.viabilityPct,
        };

        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? { ...i, normalizedUrl: res.normalizedDataUrl, normalizing: false, result }
              : i
          )
        );
      } catch (e) {
        console.error(`Analysis failed for ${img.name}:`, e);
        // Fallback: try normalize-only
        try {
          const url = await normalizeImage(img.file);
          setImages((prev) =>
            prev.map((i) =>
              i.id === img.id ? { ...i, normalizedUrl: url, normalizing: false } : i
            )
          );
        } catch {
          setImages((prev) =>
            prev.map((i) => (i.id === img.id ? { ...i, normalizing: false } : i))
          );
        }
      }
    }

    cachedForImageRef.current = "";
    normalizingRef.current = false;
    setAnalysisProgress(null);
  }, [ready, normalizeImage, cacheAndPreview, getParamsForImage]);

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

        const result: CellCountResult = {
          imageName: selectedImage.name,
          green: res.green, red: res.red,
          total: res.total, viabilityPct: res.viabilityPct,
        };
        setLiveResult(result);
        setImages((prev) =>
          prev.map((i) => (i.id === selectedImage.id ? { ...i, result } : i))
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
        };
        setLiveResult(result);
        setImages((prev) =>
          prev.map((i) => (i.id === selectedImage.id ? { ...i, result } : i))
        );
      }
    } catch (e) {
      console.error("Fast re-threshold failed:", e);
    }
  }, [selectedImage, ready, cacheAndPreview, fastReThreshold]);

  useEffect(() => {
    if (!selectedImage || !ready || normalizingRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runFastPreview(activeParams);
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeParams, selectedImage?.id, ready, runFastPreview]);

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
    setManualCells((prev) => { const n = new Map(prev); n.delete(id); return n; });
    setImageParamsMap((prev) => { const n = new Map(prev); n.delete(id); return n; });
    normalizeQueueRef.current = normalizeQueueRef.current.filter((i) => i.id !== id);
  }, [selectedId]);

  const handleImageSelect = useCallback((id: string) => {
    setSelectedId(id);
    const img = images.find((i) => i.id === id);
    if (!img) return;

    setNormalizedUrl(img.normalizedUrl);
    cachedForImageRef.current = "";
    setAnnotatedUrl(undefined);
    setLiveResult(img.result || undefined);
  }, [images]);

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

  const handleExportCSV = useCallback(() => {
    if (allResults.length === 0) return;
    downloadCSV(allResults);
  }, [allResults]);

  const handleClearAll = useCallback(() => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    normalizeQueueRef.current = [];
    cachedForImageRef.current = "";
    setImages([]);
    setSelectedId(undefined);
    setAnnotatedUrl(undefined);
    setNormalizedUrl(undefined);
    setLiveResult(undefined);
    setManualCells(new Map());
    setImageParamsMap(new Map());
    setClickMode("off");
    setAnalysisProgress(null);
  }, [images]);

  const displayResult = liveResult || selectedImage?.result;
  const customCount = imageParamsMap.size;
  const analyzedCount = images.filter((i) => i.result).length;

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
            {analysisProgress && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing {analysisProgress.current}/{analysisProgress.total}...
              </div>
            )}
            {error && <span className="text-sm text-danger mr-2">{error}</span>}
            {customCount > 0 && (
              <span className="text-[11px] text-muted-foreground mr-1">
                {customCount} custom
              </span>
            )}
            {images.length > 0 && !analysisProgress && analyzedCount > 0 && (
              <span className="text-[11px] text-muted-foreground mr-1">
                {analyzedCount}/{images.length} analyzed
              </span>
            )}
            {images.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearAll} disabled={!!analysisProgress}>
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={allResults.length === 0}>
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

            {allResults.length > 0 && <ResultsTable results={allResults} />}
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
