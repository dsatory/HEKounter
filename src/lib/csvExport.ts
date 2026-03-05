import type { CellCountResult } from "./types";

export function generateCSV(results: CellCountResult[]): string {
  const header = "image_name,green,red,total,viability_pct";
  const rows = results.map(
    (r) =>
      `${r.imageName},${r.green},${r.red},${r.total},${r.viabilityPct.toFixed(1)}`
  );
  return [header, ...rows].join("\n");
}

export function downloadCSV(results: CellCountResult[], filename = "hekounter_results.csv") {
  const csv = generateCSV(results);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
