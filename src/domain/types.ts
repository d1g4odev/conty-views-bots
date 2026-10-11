export interface ViewSeriesInput {
  startAt: string;
  utcOffsetMinutes?: number;
  views: number[];
  likes?: number[];
}

export type Classification = "organic" | "suspicious" | "inconclusive";

export type SignalId =
  | "engagement_decoupling"
  | "flat_plateau"
  | "rhythm_mismatch"
  | "abrupt_onset"
  | "abrupt_stop";

export type SignalStatus = "fired" | "clear" | "unavailable";

export interface Signal {
  id: SignalId;
  label: string;
  status: SignalStatus;
  weight: number;
  value: number | null;
  threshold: string;
  detail: string;
}

export interface SpikeWindow {
  startAt: string;
  endAt: string;
  hours: number;
  peakAt: string;
  peakViews: number;
  peakExcess: number;
  excessViews: number;
}

export interface ClassificationResult {
  classification: Classification;
  reason: string;
  score: number;
  signalsUsed: SignalId[];
  signals: Signal[];
  spike: SpikeWindow | null;
  analyzedHours: number;
  ignoredIncompleteHours: number;
  analyzedAt: string;
}

export class InvalidSeriesError extends Error {
  override readonly name = "InvalidSeriesError";
}
