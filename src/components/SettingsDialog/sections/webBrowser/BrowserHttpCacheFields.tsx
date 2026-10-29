import React, { useState } from "react";
import type {
  BrowserHttpCacheSettings,
  BrowserHttpDiskCacheCapability,
  BrowserTlsInterception,
} from "../../../../types/settings/browserSession";
import { BrowserNumberRow } from "../../BrowserSettingsFields";
import { Toggle } from "../../../ui/settings/SettingsPrimitives";
import {
  clearAllHttpCache,
  formatCacheBytes,
} from "../../../../services/originBrowserData";
import {
  httpCacheUnavailableText,
  originBrowserDataErrorText,
  useHttpCacheUsage,
} from "../../../../hooks/protocol/useHttpCacheUsage";
import {
  HTTP_CACHE_DIRECT_TLS_DEFAULT,
  HTTP_CACHE_NEEDS_INSPECTION,
} from "./browserTlsInterceptionCopy";

/** Global page-cache settings. The cache is device-local and never synced;
 * capability and usage come from native, never from these saved values. */
export default function BrowserHttpCacheFields({
  value,
  onChange,
  capability,
  nativeEngine = true,
  tlsInterception = "auto",
}: {
  value: BrowserHttpCacheSettings;
  onChange: (value: BrowserHttpCacheSettings) => void;
  capability?: BrowserHttpDiskCacheCapability;
  /** False for the legacy engine: no native usage probe. */
  nativeEngine?: boolean;
  /** Global HTTPS handling default; the disk cache needs HTTPS inspection. */
  tlsInterception?: BrowserTlsInterception;
}) {
  const { usage, refresh } = useHttpCacheUsage(
    undefined,
    nativeEngine && capability?.available === true,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unavailable =
    capability === undefined
      ? httpCacheUnavailableText("unavailable")
      : capability.available
        ? null
        : httpCacheUnavailableText(capability.reason);
  const clearAll = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const outcome = await clearAllHttpCache();
      setStatus(
        !outcome.ok
          ? originBrowserDataErrorText(outcome.error)
          : outcome.value.pendingRestart
            ? "Page caches cleared. Caches in use are removed when their tabs close or on next start."
            : "All page caches cleared.",
      );
      refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Page cache (this device only, never synced, follows site cache rules).
        Each connection keeps its own cache so later visits load faster. Sites
        decide what may be cached through their cache headers. Caches are never
        included in cloud sync, backups or exports, and caches unused for 30
        days are deleted. {HTTP_CACHE_NEEDS_INSPECTION}
      </p>
      {tlsInterception === "off" && (
        <p className="text-sm text-warning">{HTTP_CACHE_DIRECT_TLS_DEFAULT}</p>
      )}
      <Toggle
        settingKey="webBrowser.httpCache.enabled"
        label="Use a page cache for web connections"
        description="Applies to new browser attempts. A second tab of the same connection uses a temporary in-memory cache."
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      <BrowserNumberRow
        settingKey="webBrowser.httpCache.perConnectionMb"
        label="Page cache size per connection (MB)"
        description="From 16 to 1024 MB. Connections can override whether they use the cache."
        value={value.perConnectionMb}
        min={16}
        max={1024}
        disabled={!value.enabled}
        onChange={(perConnectionMb) => onChange({ ...value, perConnectionMb })}
      />
      <BrowserNumberRow
        settingKey="webBrowser.httpCache.totalMb"
        label="Total page cache size (MB)"
        description="From 128 to 8192 MB across all connections. The least recently used caches are removed first."
        value={value.totalMb}
        min={128}
        max={8192}
        disabled={!value.enabled}
        onChange={(totalMb) => onChange({ ...value, totalMb })}
      />
      <Toggle
        settingKey="webBrowser.httpCache.clearOnDatabaseLock"
        label="Clear cache on database lock"
        description="When a database locks, remove the page caches of its connections. Off keeps them on this device for faster loading after unlock; the cache holds page content, not your saved sign-in."
        checked={value.clearOnDatabaseLock}
        onChange={(clearOnDatabaseLock) =>
          onChange({ ...value, clearOnDatabaseLock })
        }
      />
      {unavailable && <p className="text-sm text-warning">{unavailable}</p>}
      {usage?.available && (
        <p className="text-sm text-[var(--color-textSecondary)]">
          Page cache in use: {formatCacheBytes(usage.bytes)} of{" "}
          {formatCacheBytes(usage.limitBytes)}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={busy || !nativeEngine}
          onClick={() => void clearAll()}
        >
          Clear all page caches
        </button>
        {status && (
          <span role="status" className="text-sm">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
