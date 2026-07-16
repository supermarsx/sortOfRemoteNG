/** Renderer contract for the native virt-viewer-backed SPICE session. */

export interface SpiceSavedConnectionOptions {
  spiceTlsPort?: number;
  spiceNativeClientPath?: string;
  spiceFullscreen?: boolean;
  spiceViewOnly?: boolean;
  spiceShareClipboard?: boolean;
  spiceUsbRedirection?: boolean;
  spiceAudioPlayback?: boolean;
  spiceProxyUri?: string;
  spiceRequireTls?: boolean;
  spiceCaCertificatePath?: string;
  /** Certificate subject passed to remote-viewer's `host-subject` key. */
  spiceTlsHostSubject?: string;
  spiceAllowSelfSigned?: boolean;
}

export interface SpiceNativeConnectRequest {
  host: string;
  port: number;
  tlsPort: number | null;
  password: string | null;
  label: string | null;
  nativeClientPath: string | null;
  fullscreen: boolean;
  viewOnly: boolean;
  shareClipboard: boolean;
  usbRedirection: boolean;
  audioPlayback: boolean;
  preferredWidth: null;
  preferredHeight: null;
  proxy: string | null;
  requireTls: boolean;
  caCert: string | null;
  verifyHostname: string | null;
  allowSelfSigned: boolean;
}

/** Snake-case fields returned by `SpiceSession` in the Rust crate. */
export interface SpiceSessionInfo {
  id: string;
  host: string;
  port: number;
  tls_port?: number | null;
  connected: boolean;
  label?: string | null;
  tls_active: boolean;
  view_only: boolean;
  connected_at: string;
  last_activity: string;
}

export interface SpiceSessionStats {
  session_id: string;
  bytes_sent: number;
  bytes_received: number;
  frame_count: number;
  connected_at: string;
  last_activity: string;
  uptime_secs: number;
  display_width: number;
  display_height: number;
  channels_open: number;
  mouse_mode: "native-viewer" | string;
}
