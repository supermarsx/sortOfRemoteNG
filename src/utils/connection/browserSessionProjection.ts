import type { StorageData } from "../storage/storage";
import { normalizeBrowserSessions } from "../security/browserSessions";

export type BrowserSessionProjection = Pick<
  StorageData,
  "browserSessions" | "recordMetadata"
>;

export function browserSessionProjectionKey(value: unknown): string {
  return JSON.stringify(
    normalizeBrowserSessions(value ?? { version: 1, records: [] }),
  );
}

/** Never spread a refreshed database body over a pending user snapshot. */
export function applyBrowserSessionProjection(
  data: StorageData,
  projection: BrowserSessionProjection,
): StorageData {
  const next = { ...data };
  if (projection.browserSessions === undefined) delete next.browserSessions;
  else
    next.browserSessions = normalizeBrowserSessions(projection.browserSessions);
  if (projection.recordMetadata === undefined) delete next.recordMetadata;
  else next.recordMetadata = projection.recordMetadata;
  return next;
}
