import type {
  CloudSyncReviewDetails,
  SmartSyncConflictDetail,
} from "./cloudSyncReviewDetails";

/** Review receipts contain summaries and fingerprints, never record contents. */
export interface CloudSyncConflictReview {
  targetId: string;
  requestIdentity: symbol;
  reviewKey: string;
  items: CloudSyncReviewItem[];
}

export interface CloudSyncReviewItem {
  id: string;
  label: string;
  state: "same" | "local" | "remote" | "conflict";
  localBytes: number;
  remoteBytes: number;
  smartMergeAvailable: boolean;
  /** Explicit, one-time repair after content and both histories validate. */
  historyReconciliationAvailable?: boolean;
  reason?: string;
  details?: CloudSyncReviewDetails;
  conflicts?: SmartSyncConflictDetail[];
}

export type CloudSyncReviewChoice =
  "keepLocal" | "keepRemote" | "smartMerge" | "reconcileHistory";
export type CloudSyncReviewChoices = Record<string, CloudSyncReviewChoice>;

export interface CloudSyncReviewedResolution {
  review: CloudSyncConflictReview;
  choices: CloudSyncReviewChoices;
}
