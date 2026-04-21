/**
 * TypeScript surface for the `sorng-spice` backend crate (SPICE
 * remote-display protocol).
 *
 * Mirrors `src-tauri/crates/sorng-spice/src/spice/types.rs`.
 *
 * The Rust types do not apply a top-level rename_all; struct field
 * names stay snake_case. Externally-tagged Rust enums serialise either
 * as string literals (unit variants) or single-key objects (variants
 * with payload) — `DrawCommand` is the latter.
 */

// ── Protocol Constants & Version ────────────────────────────────────────────

export type SpiceVersion = 'V1' | 'V2' | 'V3';

// ── Channels ────────────────────────────────────────────────────────────────

export type SpiceChannelType =
  | 'Main'
  | 'Display'
  | 'Inputs'
  | 'Cursor'
  | 'Playback'
  | 'Record'
  | 'Tunnel'
  | 'SmartCard'
  | 'UsbRedir'
  | 'Port'
  | 'WebDav';

export type ChannelState =
  | 'Disconnected'
  | 'Connecting'
  | 'Authenticating'
  | 'Connected'
  | 'Error';

export interface ChannelStatus {
  channel_type: SpiceChannelType;
  channel_id: number;
  state: ChannelState;
  capabilities: number[];
  bytes_sent: number;
  bytes_received: number;
}

// ── Image / Display ─────────────────────────────────────────────────────────

export type ImageCompression =
  | 'Off'
  | 'Quic'
  | 'Lz'
  | 'Glz'
  | 'Lz4'
  | 'Jpeg'
  | 'Zlib'
  | 'AutoGlz'
  | 'AutoLz';

export type VideoCodec = 'Mjpeg' | 'Vp8' | 'Vp9' | 'H264' | 'H265';

export interface SpicePixelFormat {
  bits_per_pixel: number;
  depth: number;
  red_mask: number;
  green_mask: number;
  blue_mask: number;
  alpha_mask: number;
}

export interface SpiceSurface {
  surface_id: number;
  width: number;
  height: number;
  format: SpicePixelFormat;
  flags: number;
  is_primary: boolean;
}

// ── Draw Commands (externally tagged enum) ─────────────────────────────────

export type DrawCommand =
  | {
      Fill: {
        surface_id: number;
        x: number;
        y: number;
        width: number;
        height: number;
        color: number;
      };
    }
  | {
      Copy: {
        surface_id: number;
        src_x: number;
        src_y: number;
        dst_x: number;
        dst_y: number;
        width: number;
        height: number;
      };
    }
  | {
      Opaque: {
        surface_id: number;
        x: number;
        y: number;
        width: number;
        height: number;
        data: string;
        compression: ImageCompression;
      };
    }
  | {
      Inval: {
        surface_id: number;
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };

// ── Cursor ──────────────────────────────────────────────────────────────────

export type CursorType =
  | 'Alpha'
  | 'Mono'
  | 'Color4'
  | 'Color8'
  | 'Color16'
  | 'Color24'
  | 'Color32';

export interface SpiceCursor {
  cursor_type: CursorType;
  width: number;
  height: number;
  hot_x: number;
  hot_y: number;
  /** Base64-encoded cursor image data. */
  data: string;
}

// ── Input ───────────────────────────────────────────────────────────────────

export type KeyboardModifier = 'ScrollLock' | 'NumLock' | 'CapsLock';

// ── USB Redirection ─────────────────────────────────────────────────────────

export interface UsbDevice {
  vendor_id: number;
  product_id: number;
  device_class: number;
  device_subclass: number;
  device_protocol: number;
  manufacturer: string;
  product: string;
  serial: string;
  bus: number;
  address: number;
  redirected: boolean;
}

export interface UsbFilter {
  vendor_id?: number;
  product_id?: number;
  device_class?: number;
  device_subclass?: number;
  device_protocol?: number;
  allow: boolean;
}

// ── Streaming / Audio ───────────────────────────────────────────────────────

export interface VideoStream {
  stream_id: number;
  surface_id: number;
  codec: VideoCodec;
  x: number;
  y: number;
  width: number;
  height: number;
  fps: number;
  flags: number;
}

export interface AudioParams {
  channels: number;
  bits_per_sample: number;
  frequency: number;
}

// ── TLS / Security ──────────────────────────────────────────────────────────

export interface SpiceTlsConfig {
  require_tls: boolean;
  ca_cert?: string;
  client_cert?: string;
  client_key?: string;
  allow_self_signed: boolean;
  verify_hostname?: string;
  ciphers?: string;
}

export interface SpiceSaslConfig {
  enabled: boolean;
  mechanism?: string;
}

// ── Connection Configuration ────────────────────────────────────────────────

export interface SpiceConfig {
  host: string;
  port: number;
  tls_port?: number;
  password?: string;
  label?: string;

  // Display
  image_compression?: ImageCompression;
  video_codec?: VideoCodec;
  preferred_width?: number;
  preferred_height?: number;
  display_count: number;
  streaming: boolean;

  // Input
  view_only: boolean;
  share_clipboard: boolean;

  // Audio
  audio_playback: boolean;
  audio_record: boolean;
  audio_params?: AudioParams;

  // USB
  usb_redirection: boolean;
  usb_auto_redirect: boolean;
  usb_filters: UsbFilter[];

  // File sharing
  file_sharing: boolean;
  shared_folder?: string;

  // Security
  tls: SpiceTlsConfig;
  sasl: SpiceSaslConfig;

  // Network
  connect_timeout_secs: number;
  keepalive_secs: number;
  mini_header: boolean;

  // Proxy
  proxy?: string;

  // Misc
  channels: SpiceChannelType[];
  agent: boolean;
  color_depth?: number;
  disable_effects: string[];
}

// ── Session Metadata ────────────────────────────────────────────────────────

export interface SpiceSession {
  id: string;
  host: string;
  port: number;
  tls_port?: number;
  connected: boolean;
  label?: string;
  protocol_version?: string;
  tls_active: boolean;
  agent_connected: boolean;
  channels: ChannelStatus[];
  surfaces: SpiceSurface[];
  video_streams: VideoStream[];
  usb_devices: UsbDevice[];
  display_width: number;
  display_height: number;
  view_only: boolean;
  connected_at: string;
  last_activity: string;
  bytes_sent: number;
  bytes_received: number;
  frame_count: number;
}

// ── Frontend Events ─────────────────────────────────────────────────────────

export interface SpiceFrameEvent {
  session_id: string;
  surface_id: number;
  data: string;
  x: number;
  y: number;
  width: number;
  height: number;
  compression: string;
}

export interface SpiceCursorEvent {
  session_id: string;
  cursor: SpiceCursor;
  visible: boolean;
  x: number;
  y: number;
}

export interface SpiceClipboardEvent {
  session_id: string;
  mime_type: string;
  data: string;
}

export interface SpiceStateEvent {
  session_id: string;
  state: string;
  message: string;
}

export interface SpiceSurfaceEvent {
  session_id: string;
  surface: SpiceSurface;
  created: boolean;
}

export interface SpiceResizeEvent {
  session_id: string;
  width: number;
  height: number;
  surface_id: number;
}

export interface SpiceUsbEvent {
  session_id: string;
  device: UsbDevice;
  event: string;
}

export interface SpiceAudioEvent {
  session_id: string;
  params: AudioParams;
  event: string;
  data?: string;
}

export interface SpiceStreamEvent {
  session_id: string;
  stream: VideoStream;
  event: string;
  data?: string;
}

// ── Session Statistics ──────────────────────────────────────────────────────

export interface ChannelStats {
  channel_type: SpiceChannelType;
  messages_sent: number;
  messages_received: number;
  bytes_sent: number;
  bytes_received: number;
}

export interface SpiceStats {
  session_id: string;
  uptime_secs: number;
  bytes_sent: number;
  bytes_received: number;
  frame_count: number;
  connected_at: string;
  last_activity: string;
  display_width: number;
  display_height: number;
  channels_open: number;
  mouse_mode: string;
  channels: ChannelStats[];
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type SpiceErrorKind =
  | 'ConnectionRefused'
  | 'Timeout'
  | 'DnsResolution'
  | 'Io'
  | 'TlsError'
  | 'AuthFailed'
  | 'AuthUnsupported'
  | 'ProtocolViolation'
  | 'ChannelError'
  | 'SessionNotFound'
  | 'AlreadyConnected'
  | 'NotConnected'
  | 'UsbError'
  | 'ClipboardError'
  | 'UnsupportedFeature'
  | 'AgentError'
  | 'Internal';

export interface SpiceError {
  kind: SpiceErrorKind;
  message: string;
}
