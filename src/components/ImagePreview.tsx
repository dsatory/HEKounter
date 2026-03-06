import { useCallback, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CellCountResult, ManualCell } from "@/lib/types";

interface ImagePreviewProps {
  originalUrl?: string;
  normalizedUrl?: string;
  annotatedUrl?: string;
  result?: CellCountResult;
  imageName?: string;
  processing?: boolean;
  clickMode: "off" | "green" | "red" | "remove-green" | "remove-red";
  manualCells: ManualCell[];
  onManualCellAdd?: (cell: ManualCell) => void;
  onManualCellRemove?: (index: number) => void;
  imageNaturalSize?: { width: number; height: number };
}

export function ImagePreview({
  originalUrl,
  normalizedUrl,
  annotatedUrl,
  result,
  imageName,
  processing,
  clickMode,
  manualCells,
  onManualCellAdd,
  onManualCellRemove,
  imageNaturalSize,
}: ImagePreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (clickMode === "off" || !svgRef.current) return;

      const svg = svgRef.current;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());

      const x = Math.round(svgPt.x);
      const y = Math.round(svgPt.y);

      const natW = imageNaturalSize?.width || imgRef.current?.naturalWidth || 1;
      const natH = imageNaturalSize?.height || imgRef.current?.naturalHeight || 1;
      if (x < 0 || y < 0 || x > natW || y > natH) return;

      if (clickMode === "green" || clickMode === "red") {
        onManualCellAdd?.({ x, y, type: clickMode });
      } else if (clickMode === "remove-green" || clickMode === "remove-red") {
        const targetType = clickMode === "remove-green" ? "green" : "red";
        const SNAP_RADIUS = 30;
        let bestIdx = -1;
        let bestDist = Infinity;
        manualCells.forEach((cell, idx) => {
          if (cell.type !== targetType) return;
          const dist = Math.hypot(cell.x - x, cell.y - y);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = idx;
          }
        });
        if (bestIdx >= 0 && bestDist <= SNAP_RADIUS) {
          onManualCellRemove?.(bestIdx);
        }
      }
    },
    [clickMode, onManualCellAdd, onManualCellRemove, imageNaturalSize, manualCells]
  );

  if (!originalUrl) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 flex items-center justify-center min-h-[300px]">
        <p className="text-sm text-muted-foreground">
          Select an image to preview
        </p>
      </div>
    );
  }

  const defaultTab = annotatedUrl ? "annotated" : normalizedUrl ? "normalized" : "original";
  const isAddMode = clickMode === "green" || clickMode === "red";
  const isRemoveMode = clickMode === "remove-green" || clickMode === "remove-red";
  const cursorClass = isAddMode ? "cursor-crosshair" : isRemoveMode ? "cursor-pointer" : "";

  const manualGreen = manualCells.filter((c) => c.type === "green").length;
  const manualRed = manualCells.filter((c) => c.type === "red").length;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium truncate min-w-0">
          {imageName}
        </span>
        {result && (
          <div className="flex items-center gap-3 text-sm font-mono">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              <span className="text-success">
                {result.green + manualGreen}
                {manualGreen > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-0.5">(+{manualGreen})</span>
                )}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger" />
              <span className="text-danger">
                {result.red + manualRed}
                {manualRed > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-0.5">(+{manualRed})</span>
                )}
              </span>
            </span>
            <span className="text-muted-foreground text-xs">
              {(((result.green + manualGreen) / Math.max(1, result.total + manualGreen + manualRed)) * 100).toFixed(1)}% viable
            </span>
          </div>
        )}
        {processing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Processing...
          </div>
        )}
      </div>

      <Tabs defaultValue={defaultTab} key={`${imageName}-${defaultTab}`} className="w-full">
        <div className="px-3 pt-2">
          <TabsList className="w-full">
            <TabsTrigger value="original" className="flex-1">Original</TabsTrigger>
            <TabsTrigger value="normalized" className="flex-1" disabled={!normalizedUrl}>Normalized</TabsTrigger>
            <TabsTrigger value="annotated" className="flex-1" disabled={!annotatedUrl}>Annotated</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="original" className="mt-0">
          <div className="p-2">
            <img src={originalUrl} alt="Original" className="w-full h-auto rounded max-h-[500px] object-contain bg-black" />
          </div>
        </TabsContent>

        <TabsContent value="normalized" className="mt-0">
          <div className="p-2">
            {normalizedUrl ? (
              <img src={normalizedUrl} alt="Normalized" className="w-full h-auto rounded max-h-[500px] object-contain bg-black" />
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">Normalizing...</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="annotated" className="mt-0">
          <div className="p-2">
            {annotatedUrl ? (
              <div className="relative">
                <img
                  ref={imgRef}
                  src={annotatedUrl}
                  alt="Annotated"
                  className="w-full h-auto rounded max-h-[500px] object-contain bg-black"
                />
                <svg
                  ref={svgRef}
                  className={`absolute inset-0 w-full h-full ${cursorClass}`}
                  viewBox={imageNaturalSize ? `0 0 ${imageNaturalSize.width} ${imageNaturalSize.height}` : undefined}
                  preserveAspectRatio="xMidYMid meet"
                  onClick={handleSvgClick}
                  style={imageNaturalSize ? undefined : { pointerEvents: "none" }}
                >
                  {manualCells.map((cell, idx) => (
                    <g key={idx}>
                      <circle
                        cx={cell.x}
                        cy={cell.y}
                        r={12}
                        fill="none"
                        stroke={cell.type === "green" ? "#00ff00" : "#ff0000"}
                        strokeWidth={3}
                      />
                      <line
                        x1={cell.x - 6} y1={cell.y}
                        x2={cell.x + 6} y2={cell.y}
                        stroke={cell.type === "green" ? "#00ff00" : "#ff0000"}
                        strokeWidth={2}
                      />
                      <line
                        x1={cell.x} y1={cell.y - 6}
                        x2={cell.x} y2={cell.y + 6}
                        stroke={cell.type === "green" ? "#00ff00" : "#ff0000"}
                        strokeWidth={2}
                      />
                    </g>
                  ))}
                </svg>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                Click Preview or adjust thresholds to see annotations
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
