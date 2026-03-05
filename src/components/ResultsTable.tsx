import type { CellCountResult } from "@/lib/types";

interface ResultsTableProps {
  results: CellCountResult[];
}

export function ResultsTable({ results }: ResultsTableProps) {
  if (results.length === 0) {
    return null;
  }

  const totals = results.reduce(
    (acc, r) => ({
      green: acc.green + r.green,
      red: acc.red + r.red,
      total: acc.total + r.total,
    }),
    { green: 0, red: 0, total: 0 }
  );
  const avgViability =
    totals.total > 0 ? (totals.green / totals.total) * 100 : 0;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                Image Name
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-success">
                Green (Live)
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-danger">
                Red (Dead)
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                Total
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                Viability %
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr
                key={i}
                className="border-b border-border/50 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-2 font-mono text-xs truncate max-w-[250px]">
                  {r.imageName}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-success">
                  {r.green}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-danger">
                  {r.red}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {r.total}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  <span
                    className={
                      r.viabilityPct >= 80
                        ? "text-success"
                        : r.viabilityPct >= 50
                        ? "text-yellow-400"
                        : "text-danger"
                    }
                  >
                    {r.viabilityPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          {results.length > 1 && (
            <tfoot>
              <tr className="bg-muted/30 font-medium">
                <td className="px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground">
                  Summary ({results.length} images)
                </td>
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
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
