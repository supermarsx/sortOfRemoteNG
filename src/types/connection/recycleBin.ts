import type { Connection } from "./connection";

export type RecycleBinPolicy =
  { mode: "days"; days: number } | { mode: "forever" };
export const DEFAULT_RECYCLE_BIN_POLICY: RecycleBinPolicy = {
  mode: "days",
  days: 15,
};

/** Private database payload; never pass archived connections to the bin UI. */
export interface RecycleBinEntry {
  id: string;
  batchId: string;
  deletedAt: number;
  connection: Connection;
}
export interface DatabaseRecycleBin {
  version: 1;
  revision: string;
  policy: RecycleBinPolicy;
  entries: RecycleBinEntry[];
}
export interface RecycleBinScope {
  databaseId: string;
  generation: number;
  revision: string;
}
export interface RecycleBinRow {
  id: string;
  batchId: string;
  connectionId: string;
  name: string;
  protocol: string;
  isGroup: boolean;
  deletedAt: number;
  expiresAt: number | null;
  parentName?: string;
  descendantCount: number;
}
export interface RecycleBinSnapshot {
  scope: RecycleBinScope;
  policy: RecycleBinPolicy;
  entries: RecycleBinRow[];
}
export interface RecycleBinReview {
  token: string;
  kind: "purge" | "retention";
  scope: RecycleBinScope;
  entryCount: number;
  expiresAt: number;
  policy?: RecycleBinPolicy;
}
export interface RecycleBinOutcome {
  committed: true;
  archived: number;
  restored: number;
  purged: number;
  skipped: number;
  warnings: string[];
}
export interface ConnectionRecycleBinApi {
  snapshot: RecycleBinSnapshot | null;
  busy: boolean;
  archive: (
    connectionIds: readonly string[],
    options?: { keepChildren?: boolean; expectedScope?: RecycleBinScope },
  ) => Promise<RecycleBinOutcome>;
  restore: (
    entryIds: readonly string[],
    scope: RecycleBinScope,
  ) => Promise<RecycleBinOutcome>;
  reviewPurge: (
    entryIds: readonly string[] | null,
    scope: RecycleBinScope,
  ) => Promise<RecycleBinReview>;
  reviewRetention: (
    policy: RecycleBinPolicy,
    scope: RecycleBinScope,
  ) => Promise<RecycleBinReview>;
  commitReview: (token: string) => Promise<RecycleBinOutcome>;
  cancelReview: (token: string) => void;
}
