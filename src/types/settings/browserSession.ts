/** Cookie snapshots only; never implies localStorage, IndexedDB or full-profile retention. */
export type BrowserSessionRetentionMode =
  "ephemeral" | "memory" | "encrypted-database";

export interface BrowserSessionRetention {
  version: 1;
  mode: BrowserSessionRetentionMode;
  /** Zero expires retained data immediately when the attempt closes. */
  idleTimeoutMinutes: number;
  /** Absolute lifetime of retained data; activity must not extend this limit. */
  maxAgeHours: number;
  /** Applies only to retained cookie snapshots. Live attempts always stop on lock. */
  clearOnDatabaseLock: boolean;
}

/** Global per-connection HTTP disk cache settings (`webBrowser.httpCache`).
 * Device-local only: never synced, backed up or exported. Follows site cache headers. */
export interface BrowserHttpCacheSettings {
  enabled: boolean;
  /** Per-connection cache limit, 16–1024 MiB. */
  perConnectionMb: number;
  /** All connection caches together, 128–8192 MiB. */
  totalMb: number;
  /** Wipe the locked database's page caches when it locks. Default keeps them. */
  clearOnDatabaseLock: boolean;
}

/** Sparse per-connection cache override; missing values inherit the global settings. */
export interface BrowserHttpCacheOverride {
  enabled?: boolean;
  perConnectionMb?: number;
}

/** HTTPS handling for web connections (`tlsInterception`). "auto" lets the app's
 * proxy inspect HTTPS and check certificates itself (and enables the disk page
 * cache); "off" is Direct TLS: the browser engine verifies TLS and keeps its own
 * fingerprint, for sites with strict bot checks. */
export type BrowserTlsInterception = "auto" | "off";

/** Requested native features, not runtime availability or permission grants. */
export interface BrowserNativePreferences {
  /** Isolated, ephemeral site storage; not covered by cookie retention. */
  localStorageEnabled: boolean;
  /** Requested IndexedDB setting; current native runtime cannot configure it. Never WebSQL. */
  databasesEnabled: boolean;
  /** Page-canvas WebGL only; does not control OffscreenCanvas. */
  webglEnabled: boolean;
  cookiesEnabled: boolean;
  /** Camera/microphone requests prompt; never an automatic grant or screen capture. */
  mediaStreamEnabled: boolean;
  /** Normal requests remain subject to CORS/SOP and route permission. */
  crossOriginRequestsEnabled: boolean;
  /** App login/injected scripts; not global forced-dark styling or Chromium extensions. */
  websiteExtensionsEnabled: boolean;
  /** Legacy-only indicator suppression; native automation security is built in. */
  hideAutomationIndicator: boolean;
}

/** Requested preferences; UI must distinguish unsupported controls. No credential grants. */
export interface BrowserSessionPreferences extends BrowserNativePreferences {
  defaultZoomPercent: number;
  showBookmarksBar: boolean;
  showSecurityInfo: boolean;
  showLoadingProgress: boolean;
  initialLoadTimeoutSeconds: number;
  documentReadyTimeoutSeconds: number;
  minimumFormFillDelayMs: number;
  minimumFormSubmitDelayMs: number;
  manualFormSubmit: boolean;
  /** False uses a fresh temporary jar and leaves retained snapshots untouched. */
  restoreCookies?: boolean;
  sessionRetention: BrowserSessionRetention;
}

/** Missing fields inherit live app settings. Retention overrides replace the policy. */
export type BrowserSessionOverrides = {
  version: 1;
  /** Native support is announced by the `httpDiskCache` retention capability. */
  httpCache?: BrowserHttpCacheOverride;
  /** Missing inherits `webBrowser.tlsInterception`. */
  tlsInterception?: BrowserTlsInterception;
} & Partial<BrowserSessionPreferences>;

/** Native code must derive these from authenticated ownership, not accept profile paths. */
export interface BrowserSessionIdentity {
  owningDatabaseId: string;
  connectionId: string;
  attemptId: string;
}

export interface BrowserSessionRetentionCapabilities {
  memory: boolean;
  /** Cookies inside the owning encrypted database, included in its sync and exports. */
  encryptedDatabase: boolean;
  /** Expose policy controls only after the native implementation approves them. */
  policyExpiration?: boolean;
  clearOnDatabaseLock?: boolean;
  /** Absent on native builds that cannot parse page-cache settings yet. */
  httpDiskCache?: BrowserHttpDiskCacheCapability;
}

export type BrowserHttpCacheUnavailableReason =
  | "disabled"
  | "cache-location-not-local"
  | "engine-unsupported"
  | "unavailable";

export interface BrowserHttpDiskCacheCapability {
  available: boolean;
  reason?: BrowserHttpCacheUnavailableReason;
}

export interface EffectiveBrowserSessionRetention {
  requested: BrowserSessionRetention;
  effective: BrowserSessionRetention;
  supported: boolean;
  reason?: string;
}
