/**
 * TypeScript surface for the `sorng-ard` backend crate (Apple Remote
 * Desktop / RFB-based macOS remote control).
 *
 * Mirrors `src-tauri/crates/sorng-ard/src/ard/types.rs`.
 *
 * Serialisable Rust structs use `#[serde(rename_all = "camelCase")]`
 * — the TS mirrors therefore use camelCase fields. The input/command
 * enums use `#[serde(rename_all = "camelCase", tag = "type")]` and are
 * mirrored as internally-tagged discriminated unions keyed on `type`.
 */

// ── Connection parameters (from `connect_ard` Tauri command) ────────────────

/**
 * Arguments accepted by the `connect_ard` Tauri command. The command
 * takes individual positional args rather than a single config struct,
 * but this interface is the canonical request shape used by callers.
 */
export interface ArdConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  connectionId?: string;
  autoReconnect?: boolean;
  curtainOnConnect?: boolean;
}

// ── Capabilities & Session ──────────────────────────────────────────────────

export interface ArdCapabilities {
  rfbVersion: string;
  securityType: number;
  supportsClipboard: boolean;
  supportsFileTransfer: boolean;
  supportsCurtainMode: boolean;
  supportsRetina: boolean;
  pixelFormat: string;
  framebufferWidth: number;
  framebufferHeight: number;
  acceptedEncodings: string[];
}

export interface ArdSession {
  id: string;
  connectionId: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
  desktopWidth: number;
  desktopHeight: number;
  desktopName?: string;
  viewerAttached: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  capabilities: ArdCapabilities;
  curtainActive: boolean;
}

// ── Status & Stats events ───────────────────────────────────────────────────

export interface ArdStatusEvent {
  sessionId: string;
  status: string;
  message?: string;
  timestamp: string;
}

export interface ArdStatsEvent {
  sessionId: string;
  bytesSent: number;
  bytesReceived: number;
  framesDecoded: number;
}

// ── Input actions (internally tagged by `type`) ─────────────────────────────

export type ArdInputAction =
  | { type: 'mouseMove'; x: number; y: number }
  | {
      type: 'mouseButton';
      button: number;
      pressed: boolean;
      x: number;
      y: number;
    }
  | { type: 'keyboardKey'; keysym: number; pressed: boolean }
  | { type: 'scroll'; dx: number; dy: number; x: number; y: number };

// ── Commands (internally tagged by `type`) ──────────────────────────────────

/**
 * Commands sent from the frontend to a live session. Variants are
 * internally tagged by `type`. The `Input(ArdInputAction)` Rust variant
 * flattens the inner action's own `type` tag onto the outer object,
 * which means the `type` discriminator collapses — callers typically
 * drive input via the dedicated `ArdInputAction` shape rather than
 * constructing this variant directly from the frontend.
 */
export type ArdCommand =
  | { type: 'input'; action: ArdInputAction }
  | { type: 'attachViewer' }
  | { type: 'detachViewer' }
  | { type: 'setClipboard'; text: string }
  | { type: 'getClipboard' }
  | { type: 'setCurtainMode'; enabled: boolean }
  | { type: 'uploadFile'; localPath: string; remotePath: string }
  | { type: 'downloadFile'; remotePath: string; localPath: string }
  | { type: 'listRemoteDir'; path: string }
  | { type: 'shutdown' }
  | { type: 'reconnect' };

// ── Log ─────────────────────────────────────────────────────────────────────

export interface ArdLogEntry {
  level: string;
  message: string;
  sessionId?: string;
  timestamp: string;
}
