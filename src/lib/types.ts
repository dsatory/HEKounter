export interface ProcessingParams {
  claheClipLimit: number;
  blurKernelSize: number;
  minCellArea: number;
  maxCellArea: number;
  greenThreshold: number;
  redThreshold: number;
}

export const DEFAULT_PARAMS: ProcessingParams = {
  claheClipLimit: 3.0,
  blurKernelSize: 5,
  minCellArea: 30,
  maxCellArea: 5000,
  greenThreshold: 40,
  redThreshold: 40,
};

export interface CellCountResult {
  imageName: string;
  green: number;
  red: number;
  total: number;
  viabilityPct: number;
  annotatedImageData?: string;
}

export interface ManualCell {
  x: number;
  y: number;
  type: "green" | "red";
}

export interface LoadedImage {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  normalizedUrl?: string;
  normalizing?: boolean;
  result?: CellCountResult;
  processing?: boolean;
  manualCells?: ManualCell[];
}

export interface ProcessingProgress {
  current: number;
  total: number;
  currentName: string;
}
