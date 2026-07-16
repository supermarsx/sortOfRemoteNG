/** Canonical frontend contract for the native Apple Remote Desktop runtime. */

export const ARD_SETTINGS_VERSION = 2 as const;
export const ARD_APPLE_ACCOUNT_IDENTIFIER_MAX_LENGTH = 320 as const;

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
  /**
   * Optional account metadata shown only for the native Screen Sharing
   * handoff. It is never an authentication credential and is not sent to
   * Apple or the embedded RFB engine.
   */
  appleAccountIdentifier?: string;
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

const isControlCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
};

export function normalizeAppleAccountIdentifier(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = Array.from(value)
    .filter((character) => !isControlCharacter(character))
    .join("")
    .trim()
    .slice(0, ARD_APPLE_ACCOUNT_IDENTIFIER_MAX_LENGTH);
  return normalized || undefined;
}

export function normalizeArdSettings(value: unknown): ArdSettings {
  const input = isRecord(value) ? value : {};
  const authMode = isArdAuthMode(input.authMode)
    ? input.authMode
    : DEFAULT_ARD_SETTINGS.authMode;
  const appleAccountIdentifier =
    authMode === "appleAccountNative"
      ? normalizeAppleAccountIdentifier(input.appleAccountIdentifier)
      : undefined;
  return {
    version: ARD_SETTINGS_VERSION,
    authMode,
    ...(appleAccountIdentifier ? { appleAccountIdentifier } : {}),
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

/** Verified boundary returned after macOS accepts the native app handoff. */
export interface ArdNativeHandoffResult {
  applicationOpened: true;
  application: "Screen Sharing";
  platform: "macos";
  connectionEstablished: false;
  acceptsPassword: false;
  targetPrefilled: false;
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
