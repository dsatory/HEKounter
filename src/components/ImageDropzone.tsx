import { useCallback, useRef, useState } from "react";
import { Upload, ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoadedImage } from "@/lib/types";

interface ImageDropzoneProps {
  images: LoadedImage[];
  onImagesAdded: (files: File[]) => void;
  onImageRemove: (id: string) => void;
  onImageSelect: (id: string) => void;
  selectedId?: string;
  customParamsIds?: Set<string>;
}

export function ImageDropzone({
  images,
  onImagesAdded,
  onImageRemove,
  onImageSelect,
  selectedId,
  customParamsIds,
}: ImageDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length > 0) onImagesAdded(files);
    },
    [onImagesAdded]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onImagesAdded(files);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onImagesAdded]
  );

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          {images.length === 0 ? (
            <>
              <Upload className="h-8 w-8" />
              <p className="text-sm font-medium">
                Drop microscopy images here or click to browse
              </p>
              <p className="text-xs">
                Supports PNG, JPEG, TIFF
              </p>
            </>
          ) : (
            <>
              <ImagePlus className="h-6 w-6" />
              <p className="text-xs font-medium">Add more images</p>
            </>
          )}
        </div>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-8 gap-2 max-h-80 overflow-y-auto pr-1">
          {images.map((img) => (
            <div
              key={img.id}
              className={cn(
                "relative group rounded-md overflow-hidden border-2 cursor-pointer transition-all aspect-square",
                selectedId === img.id
                  ? "border-primary ring-1 ring-primary"
                  : "border-transparent hover:border-muted-foreground/30"
              )}
              onClick={() => onImageSelect(img.id)}
            >
              <img
                src={img.normalizedUrl || img.previewUrl}
                alt={img.name}
                className="w-full h-full object-cover bg-black"
              />
              {img.analysisStatus === "analyzing" && (
                <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                  <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {img.analysisStatus === "failed" && (
                <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                  <span className="text-[10px] text-danger font-medium">Failed</span>
                </div>
              )}
              {img.result && (
                <div className="absolute bottom-0 left-0 right-0 bg-background/80 px-1 py-0.5 text-[10px] font-mono flex justify-between">
                  <span className="text-success">{img.result.green}</span>
                  <span className="text-danger">{img.result.red}</span>
                </div>
              )}
              {customParamsIds?.has(img.id) && (
                <div className="absolute top-0.5 left-0.5 h-4 w-4 bg-primary rounded-full flex items-center justify-center" title="Custom thresholds">
                  <span className="text-[8px] font-bold text-primary-foreground">C</span>
                </div>
              )}
              <button
                className="absolute top-0.5 right-0.5 h-4 w-4 bg-background/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onImageRemove(img.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-background/60 px-1 py-0.5 text-[9px] truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
