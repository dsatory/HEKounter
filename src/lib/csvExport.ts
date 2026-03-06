import type { CellCountResult } from "./types";

function csvField(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCSV(results: CellCountResult[]): string {
  const hasNlr = results.some((r) => r.nlrData);

  if (!hasNlr) {
    const header = "image_name,green,red,total,viability_pct,confidence_pct";
    const rows = results.map(
      (r) =>
        `${csvField(r.imageName)},${r.green},${r.red},${r.total},${r.viabilityPct.toFixed(1)},${r.confidence}`
    );
    return [header, ...rows].join("\n");
  }

  const sections: string[] = [];

  const summaryHeader = "image_name,nlr_count,avg_green,avg_red,avg_total,avg_viability_pct,std_viability_pct,confidence_pct";
  const summaryRows = results.map((r) => {
    const d = r.nlrData;
    if (d) {
      return `${csvField(r.imageName)},${d.nlrCount},${d.avgGreen.toFixed(1)},${d.avgRed.toFixed(1)},${d.avgTotal.toFixed(1)},${d.avgViabilityPct.toFixed(1)},${d.stdViabilityPct.toFixed(1)},${r.confidence}`;
    }
    return `${csvField(r.imageName)},0,${r.green},${r.red},${r.total},${r.viabilityPct.toFixed(1)},0.0,${r.confidence}`;
  });
  sections.push([summaryHeader, ...summaryRows].join("\n"));

  const nlrResults = results.filter((r) => r.nlrData && r.nlrData.nlrs.length > 0);
  if (nlrResults.length > 0) {
    const detailHeader = "\nimage_name,nlr_id,green,red,total,viability_pct,integrity_pct";
    const detailRows = nlrResults.flatMap((r) =>
      r.nlrData!.nlrs.map(
        (n) => `${csvField(r.imageName)},${n.id},${n.green},${n.red},${n.total},${n.viabilityPct.toFixed(1)},${n.integrity}`
      )
    );
    sections.push([detailHeader, ...detailRows].join("\n"));
  }

  return sections.join("\n");
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
