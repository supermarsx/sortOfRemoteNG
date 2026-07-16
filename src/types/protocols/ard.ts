/** Canonical frontend contract for the native Apple Remote Desktop runtime. */

export const ARD_SETTINGS_VERSION = 1 as const;

/**
 * `macOsAccount` is an account on the remote Mac and maps to RFB security type
 * 30. It is deliberately named differently from an Apple Account.
 *
 * `appleAccountNative` never sends credentials to the embedded RFB engine. It
 * hands the user to Apple's Screen Sharing app, where sign-in/approval remains
 * under macOS control.
 */
export type ArdAuthMode = "macOsAccount" | "vncPassword" | "appleAccountNative";

export interface ArdSettings {
  version: typeof ARD_SETTINGS_VERSION;
  authMode: ArdAuthMode;
  autoReconnect: boolean;
  curtainOnConnect: boolean;
  localCursor: boolean;
  viewOnly: boolean;
}

export const DEFAULT_ARD_SETTINGS: Readonly<ArdSettings> = Object.freeze({
  version: ARD_SETTINGS_VERSION,
  authMode: "macOsAccount",
  autoReconnect: true,
  curtainOnConnect: false,
  localCursor: true,
  viewOnly: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isArdAuthMode = (value: unknown): value is ArdAuthMode =>
  value === "macOsAccount" ||
  value === "vncPassword" ||
  value === "appleAccountNative";

export function normalizeArdSettings(value: unknown): ArdSettings {
  const input = isRecord(value) ? value : {};
  return {
    version: ARD_SETTINGS_VERSION,
    authMode: isArdAuthMode(input.authMode)
      ? input.authMode
      : DEFAULT_ARD_SETTINGS.authMode,
    autoReconnect:
      typeof input.autoReconnect === "boolean"
        ? input.autoReconnect
        : DEFAULT_ARD_SETTINGS.autoReconnect,
    curtainOnConnect:
      typeof input.curtainOnConnect === "boolean"
        ? input.curtainOnConnect
        : DEFAULT_ARD_SETTINGS.curtainOnConnect,
    localCursor:
      typeof input.localCursor === "boolean"
        ? input.localCursor
        : DEFAULT_ARD_SETTINGS.localCursor,
    viewOnly:
      typeof input.viewOnly === "boolean"
        ? input.viewOnly
        : DEFAULT_ARD_SETTINGS.viewOnly,
  };
}

export interface ArdConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  connectionId?: string;
  authenticationMode: ArdAuthMode;
  autoReconnect?: boolean;
  curtainOnConnect?: boolean;
  localCursor?: boolean;
}

export interface ArdEmbeddedRuntimeCapabilities {
  available: boolean;
  authenticationModes: Array<Exclude<ArdAuthMode, "appleAccountNative">>;
  acceptsAppleAccountCredentials: false;
  supportsNetworkPath: false;
  networkPathReason: string;
}

export interface ArdAppleAccountNativeCapabilities {
  available: boolean;
  requiresMacOs: true;
  acceptsPassword: false;
  targetPrefillSupported: false;
  reason: string;
}

export interface ArdRuntimeCapabilities {
  embeddedRfb: ArdEmbeddedRuntimeCapabilities;
  appleAccountNative: ArdAppleAccountNativeCapabilities;
}

export interface ArdSessionStats {
  bytesSent: number;
  bytesReceived: number;
  framesDecoded: number;
  keyEventsSent: number;
  pointerEventsSent: number;
}

export interface ArdSessionInfo {
  sessionId: string;
  connectionId: string;
  host: string;
  port: number;
  username: string;
  authenticationMode: ArdAuthMode;
  connectedAt: string;
  stats: ArdSessionStats;
}

export type ArdFrontendStatus =
  | "connecting"
  | "authenticated"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface ArdStatusEvent {
  sessionId: string;
  status: ArdFrontendStatus | "clipboard" | "clipboard_update" | string;
  message?: string;
  timestamp: string;
}

export interface ArdFrameMetadata {
  sessionId: string;
  sequence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  byteLength: number;
  kind:
    | { type: "framebuffer" }
    | { type: "copyRect"; sourceX: number; sourceY: number }
    | { type: "cursor" }
    | { type: "desktopSize" };
}

export type ArdInputAction =
  | { type: "mouseMove"; x: number; y: number }
  | {
      type: "mouseButton";
      button: number;
      pressed: boolean;
      x: number;
      y: number;
    }
  | { type: "keyboardKey"; keysym: number; pressed: boolean }
  | { type: "scroll"; dx: number; dy: number; x: number; y: number };

export interface ArdLogEntry {
  level: string;
  message: string;
  sessionId?: string;
  timestamp: string;
}
