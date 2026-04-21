/**
 * TypeScript surface for the `sorng-x2go` backend crate.
 *
 * Mirrors `src-tauri/crates/sorng-x2go/src/x2go/types.rs`.
 *
 * Rust structs use default serde naming (snake_case field names). Unit
 * variant enums serialise as their variant name (PascalCase). Enums
 * carrying payload (e.g. `X2goDisplayMode`, `X2goSshAuth`) are
 * externally tagged — mirrored here as discriminated unions keyed by
 * the variant name.
 */

// ── Session types ───────────────────────────────────────────────────────────

export type X2goSessionType =
  | 'Kde'
  | 'Gnome'
  | 'Xfce'
  | 'Lxde'
  | 'Lxqt'
  | 'Mate'
  | 'Cinnamon'
  | 'Unity'
  | 'Trinity'
  | 'Custom'
  | 'Application'
  | 'Shadow'
  | 'Rdp';

export type X2goSessionState =
  | 'Connecting'
  | 'Authenticating'
  | 'Starting'
  | 'Resuming'
  | 'Running'
  | 'Suspended'
  | 'Terminating'
  | 'Ended'
  | 'Failed';

export type X2goCompression = 'None' | 'Modem' | 'Isdn' | 'Adsl' | 'Wan' | 'Lan';

// ── Audio ───────────────────────────────────────────────────────────────────

export type X2goAudioSystem = 'Pulse' | 'Esd' | 'Alsa' | 'None';

export interface X2goAudioConfig {
  system: X2goAudioSystem;
  enabled: boolean;
  port: number;
}

// ── File sharing ────────────────────────────────────────────────────────────

export interface X2goSharedFolder {
  local_path: string;
  remote_name: string;
  auto_mount: boolean;
}

// ── Printing ────────────────────────────────────────────────────────────────

export interface X2goPrintConfig {
  enabled: boolean;
  cups_server?: string;
  default_printer?: string;
}

// ── Display ─────────────────────────────────────────────────────────────────

export type X2goDisplayMode =
  | { Window: { width: number; height: number } }
  | 'Fullscreen'
  | { SingleApplication: { command: string } };

// ── Keyboard ────────────────────────────────────────────────────────────────

export interface X2goKeyboard {
  layout: string;
  model: string;
  variant?: string;
}

// ── SSH ─────────────────────────────────────────────────────────────────────

export type X2goSshAuth =
  | { Password: { password: string } }
  | { PrivateKey: { key_path: string; passphrase?: string } }
  | 'Agent'
  | 'Gssapi';

export interface X2goSshConfig {
  port: number;
  auth: X2goSshAuth;
  strict_host_key: boolean;
  known_hosts_file?: string;
  proxy_command?: string;
  ssh_config_file?: string;
  connect_timeout: number;
}

// ── Clipboard ───────────────────────────────────────────────────────────────

export type X2goClipboardMode =
  | 'Both'
  | 'ClientToServer'
  | 'ServerToClient'
  | 'None';

// ── Connection Config ───────────────────────────────────────────────────────

export interface X2goConfig {
  host: string;
  username: string;
  ssh: X2goSshConfig;
  session_type: X2goSessionType;
  command?: string;
  display: X2goDisplayMode;
  color_depth?: number;
  compression?: X2goCompression;
  dpi?: number;
  keyboard: X2goKeyboard;
  audio: X2goAudioConfig;
  printing: X2goPrintConfig;
  shared_folders: X2goSharedFolder[];
  clipboard: X2goClipboardMode;
  rootless: boolean;
  published_applications: boolean;
  resume_session?: string;
  broker_url?: string;
  use_broker: boolean;
  session_cookie?: string;
}

// ── Remote session info ─────────────────────────────────────────────────────

export interface X2goRemoteSession {
  agent_pid: number;
  session_id: string;
  display: number;
  server: string;
  status: string;
  session_type: string;
  username: string;
  geometry: string;
  color_depth: number;
  created_at: string;
  suspended: boolean;
  gr_port: number;
  snd_port: number;
  fs_port: number;
}

// ── Live session ────────────────────────────────────────────────────────────

export interface X2goSession {
  id: string;
  config: X2goConfig;
  state: X2goSessionState;
  remote_session_id?: string;
  display_number?: number;
  agent_pid?: number;
  gr_port?: number;
  snd_port?: number;
  fs_port?: number;
  ssh_pid?: number;
  started_at: string;
  bytes_sent: number;
  bytes_received: number;
}

// ── Statistics ──────────────────────────────────────────────────────────────

export interface X2goStats {
  bytes_sent: number;
  bytes_received: number;
  session_duration_secs: number;
  audio_bytes: number;
  fs_bytes: number;
  print_bytes: number;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type X2goErrorKind =
  | 'ConnectionFailed'
  | 'AuthenticationFailed'
  | 'SshError'
  | 'SessionStartFailed'
  | 'SessionResumeFailed'
  | 'SessionSuspendFailed'
  | 'SessionTerminateFailed'
  | 'BrokerError'
  | 'ProxyError'
  | 'AudioError'
  | 'PrintError'
  | 'FileSharingError'
  | 'ClipboardError'
  | 'Timeout'
  | 'NotFound'
  | 'AlreadyExists'
  | 'Disconnected'
  | 'CommandFailed'
  | 'InvalidConfig'
  | 'PermissionDenied';

export interface X2goError {
  kind: X2goErrorKind;
  message: string;
}
