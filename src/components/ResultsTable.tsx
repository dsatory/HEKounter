import React, { useState, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoadedImage, ManualCell, NLRData } from "@/lib/types";

interface ResultsTableProps {
  images: LoadedImage[];
  manualCells: Map<string, ManualCell[]>;
  selectedId?: string;
  onImageSelect: (id: string) => void;
}

type SortKey = "name" | "green" | "red" | "total" | "viability" | "confidence" | "nlrCount" | "stdViability";
type SortDir = "asc" | "desc";

function confidenceColor(pct: number): string {
  if (pct >= 75) return "text-success";
  if (pct >= 50) return "text-yellow-400";
  if (pct >= 30) return "text-orange-400";
  return "text-danger";
}

function confidenceBg(pct: number): string {
  if (pct >= 75) return "bg-success";
  if (pct >= 50) return "bg-yellow-400";
  if (pct >= 30) return "bg-orange-400";
  return "bg-danger";
}

interface Row {
  img: LoadedImage;
  green: number | undefined;
  red: number | undefined;
  total: number | undefined;
  viabilityPct: number | undefined;
  confidence: number | undefined;
  nlrData: NLRData | undefined;
}

function sortRows(rows: Row[], key: SortKey, dir: SortDir): Row[] {
  const sorted = [...rows];
  const mul = dir === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    let va: number | string;
    let vb: number | string;

    switch (key) {
      case "name":
        return mul * a.img.name.localeCompare(b.img.name);
      case "green":
        va = a.green ?? -1; vb = b.green ?? -1; break;
      case "red":
        va = a.red ?? -1; vb = b.red ?? -1; break;
      case "total":
        va = a.total ?? -1; vb = b.total ?? -1; break;
      case "viability":
        va = a.viabilityPct ?? -1; vb = b.viabilityPct ?? -1; break;
      case "confidence":
        va = a.confidence ?? -1; vb = b.confidence ?? -1; break;
      case "nlrCount":
        va = a.nlrData?.nlrCount ?? -1; vb = b.nlrData?.nlrCount ?? -1; break;
      case "stdViability":
        va = a.nlrData?.stdViabilityPct ?? -1; vb = b.nlrData?.stdViabilityPct ?? -1; break;
      default:
        return 0;
    }

    return mul * ((va as number) - (vb as number));
  });

  return sorted;
}

export function ResultsTable({ images, manualCells, selectedId, onImageSelect }: ResultsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedImages, setExpandedImages] = useState<Set<string>>(new Set());

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }, [sortKey]);

  const handleRowClick = useCallback((id: string) => {
    onImageSelect(id);
    requestAnimationFrame(() => {
      const el = document.getElementById("image-preview-section");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [onImageSelect]);

  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedImages(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (images.length === 0) return null;

  const rows: Row[] = images.map((img) => {
    const manual = manualCells.get(img.id) || [];
    const manualGreen = manual.filter((c) => c.type === "green").length;
    const manualRed = manual.filter((c) => c.type === "red").length;
    const base = img.result;
    const green = base ? base.green + manualGreen : undefined;
    const red = base ? base.red + manualRed : undefined;
    const total = green !== undefined && red !== undefined ? green + red : undefined;
    const viabilityPct = total && total > 0 ? (green! / total) * 100 : undefined;
    const confidence = base?.confidence;
    const nlrData = base?.nlrData;
    return { img, green, red, total, viabilityPct, confidence, nlrData };
  });

  const hasNlrData = rows.some((r) => r.nlrData !== undefined);

  const sortedRows = sortRows(rows, sortKey, sortDir);

  const analyzed = rows.filter((r) => r.total !== undefined);
  const totals = analyzed.reduce(
    (acc, r) => ({
      green: acc.green + (r.green || 0),
      red: acc.red + (r.red || 0),
      total: acc.total + (r.total || 0),
    }),
    { green: 0, red: 0, total: 0 }
  );
  const avgViability =
    totals.total > 0 ? (totals.green / totals.total) * 100 : 0;
  const avgConfidence = analyzed.length > 0
    ? Math.round(analyzed.reduce((s, r) => s + (r.confidence || 0), 0) / analyzed.length)
    : 0;

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="h-3 w-3 opacity-0 group-hover:opacity-40 inline ml-0.5" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 inline ml-0.5" />
      : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  const thClass = "px-4 py-2.5 font-medium cursor-pointer select-none group transition-colors hover:bg-muted/30";

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-6" />
                <th className={cn(thClass, "text-left text-muted-foreground")} onClick={() => handleSort("name")}>
                  Image Name <SortIcon col="name" />
                </th>
                {hasNlrData && (
                  <th className={cn(thClass, "text-right text-cyan-400")} onClick={() => handleSort("nlrCount")}>
                    NLRs <SortIcon col="nlrCount" />
                  </th>
                )}
                <th className={cn(thClass, "text-right text-success")} onClick={() => handleSort("green")}>
                  {hasNlrData ? "Avg Green" : "Green (Live)"} <SortIcon col="green" />
                </th>
                <th className={cn(thClass, "text-right text-danger")} onClick={() => handleSort("red")}>
                  {hasNlrData ? "Avg Red" : "Red (Dead)"} <SortIcon col="red" />
                </th>
                <th className={cn(thClass, "text-right text-muted-foreground")} onClick={() => handleSort("total")}>
                  {hasNlrData ? "Avg Total" : "Total"} <SortIcon col="total" />
                </th>
                <th className={cn(thClass, "text-right text-muted-foreground")} onClick={() => handleSort("viability")}>
                  {hasNlrData ? "Avg Viability" : "Viability"} <SortIcon col="viability" />
                </th>
                {hasNlrData && (
                  <th className={cn(thClass, "text-right text-muted-foreground")} onClick={() => handleSort("stdViability")}>
                    Std Viability <SortIcon col="stdViability" />
                  </th>
                )}
                <th className={cn(thClass, "text-right text-muted-foreground")} onClick={() => handleSort("confidence")}>
                  Confidence <SortIcon col="confidence" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const isExpanded = expandedImages.has(r.img.id);
                const hasNlrs = r.nlrData && r.nlrData.nlrs.length > 0;

                return (
                  <React.Fragment key={r.img.id}>
                    <tr
                      onClick={() => handleRowClick(r.img.id)}
                      className={cn(
                        "border-b border-border/50 transition-colors cursor-pointer",
                        selectedId === r.img.id
                          ? "bg-primary/5"
                          : "hover:bg-muted/30"
                      )}
                    >
                      <td className="pl-4 py-2">
                        {hasNlrs ? (
                          <button
                            onClick={(e) => toggleExpand(r.img.id, e)}
                            className="p-0 hover:text-cyan-400 transition-colors"
                          >
                            <ChevronRight className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              isExpanded && "rotate-90"
                            )} />
                          </button>
                        ) : (
                          <span className={cn(
                            "inline-block h-2 w-2 rounded-full",
                            r.img.analysisStatus === "done" && "bg-success",
                            r.img.analysisStatus === "analyzing" && "bg-primary animate-pulse",
                            r.img.analysisStatus === "pending" && "bg-muted-foreground/40",
                            r.img.analysisStatus === "failed" && "bg-danger",
                          )} />
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {r.img.name}
                        {r.img.analysisStatus === "failed" && (
                          <span className="ml-2 text-danger text-[10px]">
                            ({r.img.failureReason || "error"})
                          </span>
                        )}
                      </td>
                      {hasNlrData && (
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-cyan-400">
                          {r.nlrData?.nlrCount ?? "—"}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-success">
                        {r.green !== undefined ? (r.nlrData ? r.nlrData.avgGreen.toFixed(1) : r.green) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-danger">
                        {r.red !== undefined ? (r.nlrData ? r.nlrData.avgRed.toFixed(1) : r.red) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {r.total !== undefined ? (r.nlrData ? r.nlrData.avgTotal.toFixed(1) : r.total) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {r.viabilityPct !== undefined ? (
                          <span
                            className={
                              r.viabilityPct >= 80
                                ? "text-success"
                                : r.viabilityPct >= 50
                                ? "text-yellow-400"
                                : "text-danger"
                            }
                          >
                            {(r.nlrData ? r.nlrData.avgViabilityPct : r.viabilityPct).toFixed(1)}%
                          </span>
                        ) : "—"}
                      </td>
                      {hasNlrData && (
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {r.nlrData ? `${r.nlrData.stdViabilityPct.toFixed(1)}%` : "—"}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {r.confidence !== undefined ? (
                          <span className={confidenceColor(r.confidence)}>
                            {r.confidence}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>

                    {isExpanded && hasNlrs && r.nlrData!.nlrs.map((nlr) => (
                      <tr
                        key={`${r.img.id}-nlr-${nlr.id}`}
                        onClick={() => handleRowClick(r.img.id)}
                        className={cn(
                          "border-b border-border/30 transition-colors cursor-pointer bg-muted/10",
                          selectedId === r.img.id ? "bg-primary/3" : "hover:bg-muted/20"
                        )}
                      >
                        <td className="pl-4 py-1.5" />
                        <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground pl-8">
                          <span className="text-cyan-400/70">NLR #{nlr.id}</span>
                          <span className="ml-2 text-[10px] text-muted-foreground/60">
                            (r={nlr.radius}px, {nlr.integrity}% integrity)
                          </span>
                        </td>
                        {hasNlrData && (
                          <td className="px-4 py-1.5 text-right font-mono tabular-nums text-muted-foreground/40">
                            —
                          </td>
                        )}
                        <td className="px-4 py-1.5 text-right font-mono tabular-nums text-success/70 text-xs">
                          {nlr.green}
                        </td>
                        <td className="px-4 py-1.5 text-right font-mono tabular-nums text-danger/70 text-xs">
                          {nlr.red}
                        </td>
                        <td className="px-4 py-1.5 text-right font-mono tabular-nums text-xs">
                          {nlr.total}
                        </td>
                        <td className="px-4 py-1.5 text-right font-mono tabular-nums text-xs">
                          <span className={
                            nlr.viabilityPct >= 80
                              ? "text-success/70"
                              : nlr.viabilityPct >= 50
                              ? "text-yellow-400/70"
                              : "text-danger/70"
                          }>
                            {nlr.viabilityPct.toFixed(1)}%
                          </span>
                        </td>
                        {hasNlrData && (
                          <td className="px-4 py-1.5 text-right" />
                        )}
                        <td className="px-4 py-1.5 text-right" />
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            {analyzed.length > 1 && (
              <tfoot>
                <tr className="bg-muted/30 font-medium">
                  <td className="pl-4 py-2.5" />
                  <td className="px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground">
                    Summary ({analyzed.length}/{images.length} images)
                  </td>
                  {hasNlrData && (
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-cyan-400">
                      {analyzed.reduce((s, r) => s + (r.nlrData?.nlrCount ?? 0), 0)}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-success">
                    {totals.green}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-danger">
                    {totals.red}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {totals.total}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    <span
                      className={
                        avgViability >= 80
                          ? "text-success"
                          : avgViability >= 50
                          ? "text-yellow-400"
                          : "text-danger"
                      }
                    >
                      {avgViability.toFixed(1)}%
                    </span>
                  </td>
                  {hasNlrData && (
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground" />
                  )}
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    <span className={confidenceColor(avgConfidence)}>
                      {avgConfidence}%
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="flex items-center gap-4 px-1 text-xs text-muted-foreground">
        <span className="font-medium mr-0.5">Confidence:</span>
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", confidenceBg(75))} />
          &ge; 75% reliable
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", confidenceBg(50))} />
          50–74% acceptable
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", confidenceBg(30))} />
          30–49% review recommended
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", confidenceBg(0))} />
          &lt; 30% manual annotation likely needed
        </span>
      </div>
    </div>
  );
}
