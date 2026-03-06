import type { CellCountResult } from "./types";

export function generateCSV(results: CellCountResult[]): string {
  const header = "image_name,green,red,total,viability_pct,confidence_pct";
  const rows = results.map(
    (r) =>
      `${r.imageName},${r.green},${r.red},${r.total},${r.viabilityPct.toFixed(1)},${r.confidence}`
  );
  return [header, ...rows].join("\n");
}

function commonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) {
    const base = names[0].replace(/\.[^.]+$/, "");
    return base;
  }

  const stripped = names.map((n) => n.replace(/\.[^.]+$/, ""));
  let prefix = stripped[0];
  for (let i = 1; i < stripped.length; i++) {
    while (prefix.length > 0 && !stripped[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) break;
  }

  // Trim trailing separators/digits for a clean experiment name
  return prefix.replace(/[\s_\-.,;:]+$/, "").trim();
}

function buildFilename(results: CellCountResult[]): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;

  const names = results.map((r) => r.imageName);
  const experiment = commonPrefix(names);

  const parts = [timestamp];
  if (experiment.length > 0) parts.push(experiment);
  parts.push("HEKounter results");

  return parts.join(" ") + ".csv";
}

export function downloadCSV(results: CellCountResult[]) {
  const csv = generateCSV(results);
  const filename = buildFilename(results);
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
