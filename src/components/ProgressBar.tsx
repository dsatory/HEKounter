import { Progress } from "@/components/ui/progress";
import type { ProcessingProgress } from "@/lib/types";

interface ProgressBarProps {
  progress: ProcessingProgress | null;
}

export function ProgressBar({ progress }: ProgressBarProps) {
  if (!progress) return null;

  const pct = (progress.current / progress.total) * 100;

  return (
    <div className="space-y-2 p-3 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Processing <span className="font-mono text-foreground">{progress.currentName}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {progress.current}/{progress.total}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}
