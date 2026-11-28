import React from "react";
import type { GlobalSettings } from "../../../types/settings/settings";
import { normalizeWebBrowserSettings } from "../../../utils/settings/webBrowserSettings";
import {
  normalizeBrowserHttpCacheSettings,
  normalizeBrowserTlsInterception,
} from "../../../utils/settings/browserSessionSettings";
import { useBrowserRetentionCapabilities } from "../../../hooks/protocol/useBrowserRetentionCapabilities";
import BrowserHttpCacheFields from "./webBrowser/BrowserHttpCacheFields";

export default function InternalProxyCacheSettings({
  settings,
  updateSettings,
  disabled,
}: {
  settings: GlobalSettings;
  updateSettings: (patch: Partial<GlobalSettings>) => void;
  disabled: boolean;
}) {
  let config;
  try {
    config = normalizeWebBrowserSettings(settings.webBrowser);
  } catch {
    return (
      <p role="alert">
        Repair Web Browser settings before managing the page cache.
      </p>
    );
  }
  return (
    <CacheFields
      config={config}
      updateSettings={updateSettings}
      disabled={disabled}
    />
  );
}
function CacheFields({
  config,
  updateSettings,
  disabled,
}: {
  config: ReturnType<typeof normalizeWebBrowserSettings>;
  updateSettings: (patch: Partial<GlobalSettings>) => void;
  disabled: boolean;
}) {
  const capabilities = useBrowserRetentionCapabilities(
    !disabled && config.engine !== "legacy",
  );
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Internal proxy page cache</legend>
      <BrowserHttpCacheFields
        value={normalizeBrowserHttpCacheSettings(config.httpCache)}
        onChange={(httpCache) =>
          updateSettings({ webBrowser: { ...config, httpCache } })
        }
        capability={capabilities.httpDiskCache}
        nativeEngine={config.engine !== "legacy"}
        tlsInterception={normalizeBrowserTlsInterception(
          config.tlsInterception,
        )}
      />
    </fieldset>
  );
}
