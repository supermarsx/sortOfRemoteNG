/**
 * TypeScript surface for the `sorng-nx` backend crate (NX protocol /
 * NoMachine / FreeNX).
 *
 * Mirrors `src-tauri/crates/sorng-nx/src/nx/types.rs`.
 *
 * Rust types use default serde naming (snake_case fields, PascalCase
 * enum variants).
 */

// ── Protocol & Session ──────────────────────────────────────────────────────

export type NxVersion = 'V3' | 'V4' | 'V5';

export type NxSessionType =
  | 'UnixDesktop'
  | 'UnixGnome'
  | 'UnixKde'
  | 'UnixXfce'
  | 'UnixCustom'
  | 'Shadow'
  | 'Windows'
  | 'Vnc'
  | 'Application'
  | 'Console';

export type NxSessionState =
  | 'Starting'
  | 'Running'
  | 'Suspended'
  | 'Resuming'
  | 'Terminating'
  | 'Terminated'
  | 'Failed';

// ── Compression & Quality ───────────────────────────────────────────────────

export type NxCompression = 'None' | 'Zlib' | 'Jpeg' | 'Png' | 'Adaptive';

/** Compression level 0-9 (0 = no compression, 9 = maximum). */
export type CompressionLevel = number;

export type LinkSpeed = 'Modem' | 'Isdn' | 'Adsl' | 'Wan' | 'Lan';

export type ImageQuality = 'Low' | 'Medium' | 'High' | 'Lossless';

// ── Keyboard ────────────────────────────────────────────────────────────────

export interface KeyboardLayout {
  model: string;
  layout: string;
  variant?: string;
  options?: string;
}

// ── Audio ───────────────────────────────────────────────────────────────────

export type NxAudioCodec = 'Pcm' | 'Esd' | 'Pulse' | 'Opus' | 'Mp3';

export interface NxAudioConfig {
  enabled: boolean;
  codec: NxAudioCodec;
  sample_rate: number;
  channels: number;
  bit_depth: number;
}

// ── Printing ────────────────────────────────────────────────────────────────

export type PrinterDriver = 'Cups' | 'PostScript' | 'Pdf' | 'Smb';

export interface NxPrintConfig {
  enabled: boolean;
  driver: PrinterDriver;
  paper_size: string;
  default_printer?: string;
}

// ── Connection Config ───────────────────────────────────────────────────────

export interface NxConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  private_key?: string;
  label?: string;

  // Session
  session_type?: NxSessionType;
  custom_command?: string;
  version?: NxVersion;

  // Display
  resolution_width?: number;
  resolution_height?: number;
  fullscreen?: boolean;
  color_depth?: number;

  // Compression
  compression?: NxCompression;
  compression_level?: number;
  image_quality?: ImageQuality;
  link_speed?: LinkSpeed;

  // Features
  audio?: NxAudioConfig;
  printing?: NxPrintConfig;
  clipboard?: boolean;
  file_sharing?: boolean;
  shared_folder?: string;
  media_forwarding?: boolean;

  // Keyboard
  keyboard?: KeyboardLayout;

  // Network
  ssh_port?: number;
  proxy_host?: string;
  proxy_port?: number;
  connect_timeout?: number;
  keepalive_interval?: number;

  // nxproxy
  nxproxy_path?: string;
  nxproxy_extra_args?: string[];

  // Resume
  resume_session_id?: string;
  auto_resume?: boolean;
}

// ── Session Info ────────────────────────────────────────────────────────────

export interface NxSession {
  id: string;
  host: string;
  port: number;
  username?: string;
  label?: string;
  session_type: string;
  state: NxSessionState;
  display?: number;
  resolution_width: number;
  resolution_height: number;
  connected_at: string;
  last_activity: string;
  suspended_at?: string;
  server_session_id?: string;
}

// ── Statistics ──────────────────────────────────────────────────────────────

export interface NxStats {
  session_id: string;
  bytes_sent: number;
  bytes_received: number;
  frame_count: number;
  connected_at: string;
  last_activity: string;
  uptime_secs: number;
  display_width: number;
  display_height: number;
  compression_ratio: number;
  round_trip_ms: number;
  bandwidth_kbps: number;
  suspended_count: number;
  resumed_count: number;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type NxErrorKind =
  | 'ConnectionFailed'
  | 'AuthenticationFailed'
  | 'SessionNotFound'
  | 'SessionAlreadyExists'
  | 'AlreadyConnected'
  | 'ProxyError'
  | 'ProtocolError'
  | 'Timeout'
  | 'SshError'
  | 'DisplayError'
  | 'AudioError'
  | 'PrintError'
  | 'Disconnected'
  | 'ResumeError'
  | 'ConfigError'
  | 'IoError'
  | 'Unknown';

export interface NxError {
  kind: NxErrorKind;
  message: string;
}

// ── Proxy & Resume ──────────────────────────────────────────────────────────

export interface NxProxyInfo {
  path: string;
  version?: string;
  capabilities: string[];
}

export interface ResumableSession {
  session_id: string;
  display: number;
  session_type: string;
  state: string;
  created_at: string;
  user: string;
  geometry: string;
}
