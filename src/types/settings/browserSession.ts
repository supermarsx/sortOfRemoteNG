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
  sessionRetention: BrowserSessionRetention;
}

/** Missing fields inherit live app settings. Retention overrides replace the policy. */
export type BrowserSessionOverrides = {
  version: 1;
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
}

export interface EffectiveBrowserSessionRetention {
  requested: BrowserSessionRetention;
  effective: BrowserSessionRetention;
  supported: boolean;
  reason?: string;
}
