/**
 * TypeScript surface for the `sorng-xdmcp` backend crate (X Display
 * Manager Control Protocol — RFC 1198).
 *
 * Mirrors `src-tauri/crates/sorng-xdmcp/src/xdmcp/types.rs`.
 *
 * Rust structs use default serde naming (snake_case fields). Enums
 * carrying payload (`XdmcpAuthType::Custom`, `XServerType::Custom`)
 * are externally tagged: unit variants serialise as PascalCase
 * strings; payload variants as `{ VariantName: payload }`.
 */

// ── Protocol Constants ──────────────────────────────────────────────────────

export const XDMCP_PORT = 177;
export const XDMCP_PROTOCOL_VERSION = 1;

// ── Opcodes ─────────────────────────────────────────────────────────────────

export type XdmcpOpcode =
  | 'Query'
  | 'BroadcastQuery'
  | 'IndirectQuery'
  | 'Willing'
  | 'Unwilling'
  | 'Request'
  | 'Accept'
  | 'Decline'
  | 'Manage'
  | 'Refuse'
  | 'Failed'
  | 'ForwardQuery'
  | 'KeepAlive'
  | 'Alive';

// ── Authentication ──────────────────────────────────────────────────────────

export type XdmcpAuthType =
  | 'None'
  | 'MitMagicCookie'
  | 'XdmAuthorization'
  | { Custom: string };

// ── Display Manager Info ────────────────────────────────────────────────────

export interface DisplayManagerInfo {
  address: string;
  hostname: string;
  status: string;
  auth_types: string[];
  willing: boolean;
  discovered_at: string;
}

// ── X Server Type ───────────────────────────────────────────────────────────

export type XServerType =
  | 'Xephyr'
  | 'Xorg'
  | 'XWayland'
  | 'Xvfb'
  | 'VcXsrv'
  | 'Xming'
  | 'MobaXterm'
  | { Custom: string };

// ── Session State & Query ───────────────────────────────────────────────────

export type XdmcpSessionState =
  | 'Discovering'
  | 'Requesting'
  | 'Accepted'
  | 'Running'
  | 'Ended'
  | 'Failed';

export type QueryType = 'Direct' | 'Broadcast' | 'Indirect';

// ── Configuration ───────────────────────────────────────────────────────────

export interface XdmcpConfig {
  host: string;
  port: number;
  label?: string;

  // Query
  query_type?: QueryType;
  broadcast_address?: string;

  // Authentication
  auth_type?: XdmcpAuthType;
  /** Raw auth bytes (Vec<u8> on the Rust side). */
  auth_data?: number[];

  // Display
  display_number?: number;
  resolution_width?: number;
  resolution_height?: number;
  color_depth?: number;
  fullscreen?: boolean;

  // X Server
  x_server_type?: XServerType;
  x_server_path?: string;
  x_server_extra_args?: string[];

  // Network
  connect_timeout?: number;
  keepalive_interval?: number;
  retry_count?: number;
}

// ── Session Info ────────────────────────────────────────────────────────────

export interface XdmcpSession {
  id: string;
  host: string;
  port: number;
  label?: string;
  state: XdmcpSessionState;
  display_number?: number;
  session_id?: number;
  display_manager?: string;
  resolution_width: number;
  resolution_height: number;
  x_server_type: string;
  connected_at: string;
  last_activity: string;
}

// ── Statistics ──────────────────────────────────────────────────────────────

export interface XdmcpStats {
  session_id: string;
  bytes_sent: number;
  bytes_received: number;
  packets_sent: number;
  packets_received: number;
  connected_at: string;
  last_activity: string;
  uptime_secs: number;
  display_width: number;
  display_height: number;
  keepalive_count: number;
  x_server_pid?: number;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type XdmcpErrorKind =
  | 'ConnectionFailed'
  | 'Timeout'
  | 'Declined'
  | 'Refused'
  | 'AuthenticationFailed'
  | 'SessionNotFound'
  | 'AlreadyConnected'
  | 'XServerError'
  | 'DiscoveryFailed'
  | 'ProtocolError'
  | 'Disconnected'
  | 'IoError'
  | 'Unknown';

export interface XdmcpError {
  kind: XdmcpErrorKind;
  message: string;
}
