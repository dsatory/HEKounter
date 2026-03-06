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
  maxCellArea: 2000,
  greenThreshold: 40,
  redThreshold: 40,
};

export interface CellCountResult {
  imageName: string;
  green: number;
  red: number;
  total: number;
  viabilityPct: number;
  confidence: number;
}

export interface ManualCell {
  x: number;
  y: number;
  type: "green" | "red";
}

export type AnalysisStatus = "pending" | "analyzing" | "done" | "failed";

export interface LoadedImage {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  normalizedUrl?: string;
  annotatedUrl?: string;
  analysisStatus: AnalysisStatus;
  result?: CellCountResult;
  failureReason?: string;
}