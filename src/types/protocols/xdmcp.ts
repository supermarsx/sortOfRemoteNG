/** Renderer contract for native-X-server-backed XDMCP sessions. */

export type XdmcpQueryType = "Direct" | "Broadcast" | "Indirect";
export type SupportedXdmcpServerType =
  | "Xephyr"
  | "VcXsrv"
  | "Xming"
  | { Custom: string };

export interface XdmcpSavedConnectionOptions {
  xdmcpQueryType?: XdmcpQueryType;
  xdmcpDisplayNumber?: number;
  xdmcpResolutionWidth?: number;
  xdmcpResolutionHeight?: number;
  xdmcpColorDepth?: 8 | 16 | 24 | 32;
  xdmcpFullscreen?: boolean;
  xdmcpXServerType?: SupportedXdmcpServerType;
  xdmcpXServerPath?: string;
  xdmcpAcknowledgeInsecureTransport?: boolean;
}

/** Exact snake-case DTO consumed by `XdmcpConfig`. */
export interface XdmcpConfig {
  host: string;
  port: number;
  label: string | null;
  acknowledge_insecure_transport: boolean;
  query_type: XdmcpQueryType;
  broadcast_address: null;
  auth_type: "None";
  auth_data: null;
  display_number: number | null;
  resolution_width: number;
  resolution_height: number;
  color_depth: 8 | 16 | 24 | 32;
  fullscreen: boolean;
  x_server_type: SupportedXdmcpServerType;
  x_server_path: string | null;
  x_server_extra_args: null;
  connect_timeout: 30;
  keepalive_interval: 60;
  retry_count: 3;
}

export interface XdmcpSessionInfo {
  id: string;
  host: string;
  port: number;
  state: "Running" | "Ended" | "Failed" | string;
  display_number: number | null;
  session_id: number | null;
  display_manager: string | null;
  display_width: number;
  display_height: number;
  bytes_sent: number;
  bytes_received: number;
  packets_sent: number;
  packets_received: number;
  keepalive_count: number;
  last_activity: string;
  x_server_pid: number | null;
}

export interface XdmcpSessionStats {
  bytes_sent: number;
  bytes_received: number;
  packets_sent: number;
  packets_received: number;
  keepalive_count: number;
  last_activity: string;
}

export interface XdmcpDiscoveredHost {
  address: string;
  hostname: string;
  status: string;
}
