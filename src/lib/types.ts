export interface ProcessingParams {
  claheClipLimit: number;
  blurKernelSize: number;
  minCellArea: number;
  maxCellArea: number;
  greenThreshold: number;
  redThreshold: number;
  nlrMode: boolean;
  nlrMinRadius: number;
  nlrMaxRadius: number;
  nlrEdgeMargin: number;
  nlrIntegrity: number;
  nlrSensitivity: number;
}

export const DEFAULT_PARAMS: ProcessingParams = {
  claheClipLimit: 3.0,
  blurKernelSize: 5,
  minCellArea: 30,
  maxCellArea: 2000,
  greenThreshold: 40,
  redThreshold: 40,
  nlrMode: false,
  nlrMinRadius: 30,
  nlrMaxRadius: 200,
  nlrEdgeMargin: 5,
  nlrIntegrity: 15,
  nlrSensitivity: 40,
};

export interface NLRResult {
  id: number;
  cx: number;
  cy: number;
  radius: number;
  integrity: number;
  green: number;
  red: number;
  total: number;
  viabilityPct: number;
}

export interface NLRData {
  nlrCount: number;
  nlrs: NLRResult[];
  avgGreen: number;
  avgRed: number;
  avgTotal: number;
  avgViabilityPct: number;
  stdViabilityPct: number;
}

export interface CellCountResult {
  imageName: string;
  green: number;
  red: number;
  total: number;
  viabilityPct: number;
  confidence: number;
  nlrData?: NLRData;
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