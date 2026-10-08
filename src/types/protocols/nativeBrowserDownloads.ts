import type { OriginBrowserIdentity } from "./originBrowser";

export const NATIVE_DOWNLOAD_EVENT = "origin-browser-download";
export type NativeDownloadAction = "pause" | "resume" | "cancel" | "reveal";
export interface NativeDownload {
  identity: OriginBrowserIdentity;
  downloadId: number;
  sequence: number;
  fileName: string;
  status:
    | "awaiting-destination"
    | "in-progress"
    | "paused"
    | "completed"
    | "cancelled"
    | "interrupted";
  receivedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canReveal: boolean;
}
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function nativeDownload(
  value: unknown,
  owner: OriginBrowserIdentity,
): NativeDownload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as NativeDownload;
  if (
    !row.identity ||
    !(
      ["ownerDatabaseId", "connectionId", "sessionId", "attemptId"] as const
    ).every((key) => row.identity[key] === owner[key]) ||
    !count(row.downloadId) ||
    row.downloadId === 0 ||
    row.downloadId > 0xffffffff ||
    !count(row.sequence) ||
    typeof row.fileName !== "string" ||
    row.fileName.length > 512 ||
    // eslint-disable-next-line no-control-regex -- Reject ASCII controls in native display filenames.
    /[\u0000-\u001f\u007f]/.test(row.fileName) ||
    ![
      "awaiting-destination",
      "in-progress",
      "paused",
      "completed",
      "cancelled",
      "interrupted",
    ].includes(row.status) ||
    !count(row.receivedBytes) ||
    (row.totalBytes !== null && !count(row.totalBytes)) ||
    !count(row.bytesPerSecond) ||
    ![row.canPause, row.canResume, row.canCancel, row.canReveal].every(
      (value) => typeof value === "boolean",
    )
  )
    return null;
  // Copy only display fields. Never propagate path/URL extensions into state.
  return {
    identity: { ...owner },
    downloadId: row.downloadId,
    sequence: row.sequence,
    fileName: row.fileName,
    status: row.status,
    receivedBytes: row.receivedBytes,
    totalBytes: row.totalBytes,
    bytesPerSecond: row.bytesPerSecond,
    canPause: row.canPause,
    canResume: row.canResume,
    canCancel: row.canCancel,
    canReveal: row.canReveal,
  };
}
