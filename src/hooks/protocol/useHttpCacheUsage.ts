import { useCallback, useEffect, useState } from "react";
import type { BrowserHttpCacheUnavailableReason } from "../../types/settings/browserSession";
import {
  getHttpCacheUsage,
  type HttpCacheUsage,
  type OriginBrowserDataError,
} from "../../services/originBrowserData";

/** Fixed explanations only; never native text, paths or ids. */
export function httpCacheUnavailableText(
  reason: BrowserHttpCacheUnavailableReason | undefined,
): string {
  switch (reason) {
    case "disabled":
      return "Page cache is turned off.";
    case "cache-location-not-local":
      return "Page cache is in memory only because the browser data folder is not a local, non-synced folder. Choose a folder under local app data to enable it.";
    case "engine-unsupported":
      return "The installed browser engine does not support a page cache on disk yet. Pages are cached in memory only.";
    default:
      return "Page cache status is unavailable in this build.";
  }
}

/** Fixed text for a refused clear request. */
export function originBrowserDataErrorText(
  error: OriginBrowserDataError,
): string {
  switch (error) {
    case "browser-session-open":
      return "Close this connection's tab first.";
    case "unavailable":
      return "Not available in this build yet.";
    default:
      return "Clearing failed. Try again.";
  }
}

/** Read-only usage probe; `enabled` false performs no native call. */
export function useHttpCacheUsage(
  connectionId: string | undefined,
  enabled: boolean,
): { usage: HttpCacheUsage | null; refresh: () => void } {
  const [usage, setUsage] = useState<HttpCacheUsage | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setUsage(null);
    if (!enabled) return;
    let disposed = false;
    void getHttpCacheUsage(connectionId).then((next) => {
      if (!disposed) setUsage(next);
    });
    return () => {
      disposed = true;
    };
  }, [connectionId, enabled, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { usage, refresh };
}
