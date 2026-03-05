import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import type { ProcessingParams } from "@/lib/types";
import { DEFAULT_PARAMS } from "@/lib/types";
import { RotateCcw, ChevronDown, ChevronRight, Copy, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProcessingControlsProps {
  params: ProcessingParams;
  onChange: (params: ProcessingParams) => void;
  isCustom: boolean;
  imageName?: string;
  onApplyToAll: () => void;
  onResetToGlobal: () => void;
  imageCount: number;
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className={`text-xs font-medium ${color || "text-muted-foreground"}`}>
          {label}
        </label>
        <span className="text-xs font-mono text-foreground tabular-nums">
          {step < 1 ? value.toFixed(1) : value}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

export function ProcessingControls({
  params,
  onChange,
  isCustom,
  imageName,
  onApplyToAll,
  onResetToGlobal,
  imageCount,
}: ProcessingControlsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = (key: keyof ProcessingParams, value: number) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Detection</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onChange(DEFAULT_PARAMS)}
          title="Reset to defaults"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Scope indicator */}
      {imageName && (
        <div className="space-y-2">
          <div className={`rounded-md px-2.5 py-1.5 text-xs border ${
            isCustom
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-border bg-muted/30 text-muted-foreground"
          }`}>
            {isCustom ? (
              <span className="font-medium">Custom for this image</span>
            ) : (
              <span>
                <Globe className="h-3 w-3 inline mr-1 -mt-px" />
                Global settings
              </span>
            )}
          </div>

          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-[11px] h-7 flex-1"
              onClick={onApplyToAll}
              disabled={imageCount < 2}
              title="Set these thresholds as the baseline for all images"
            >
              <Copy className="h-3 w-3 mr-1" />
              Apply to All
            </Button>
            {isCustom && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[11px] h-7"
                onClick={onResetToGlobal}
                title="Revert this image to global thresholds"
              >
                <Globe className="h-3 w-3 mr-1" />
                Use Global
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <ParamSlider
          label="Green Threshold (Live)"
          value={params.greenThreshold}
          min={10}
          max={200}
          step={5}
          onChange={(v) => update("greenThreshold", v)}
          color="text-success"
        />
        <ParamSlider
          label="Red Threshold (Dead)"
          value={params.redThreshold}
          min={10}
          max={200}
          step={5}
          onChange={(v) => update("redThreshold", v)}
          color="text-danger"
        />
      </div>

      <div className="border-t border-border pt-3">
        <button
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full cursor-pointer"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Advanced Parameters
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-4 pl-1">
            <ParamSlider
              label="CLAHE Clip Limit"
              value={params.claheClipLimit}
              min={1}
              max={10}
              step={0.5}
              onChange={(v) => update("claheClipLimit", v)}
            />
            <ParamSlider
              label="Blur Kernel"
              value={params.blurKernelSize}
              min={1}
              max={15}
              step={2}
              onChange={(v) => update("blurKernelSize", v)}
            />
            <ParamSlider
              label="Min Cell Area (px)"
              value={params.minCellArea}
              min={5}
              max={200}
              step={5}
              onChange={(v) => update("minCellArea", v)}
            />
            <ParamSlider
              label="Max Cell Area (px)"
              value={params.maxCellArea}
              min={500}
              max={20000}
              step={100}
              onChange={(v) => update("maxCellArea", v)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
