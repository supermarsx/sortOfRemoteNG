// Frontend types for the dedicated `sorng-openvpn` crate's `openvpn_*`
// commands (t3-e47). Kept deliberately permissive (Record<string, unknown>
// for nested shapes) to avoid duplicating the Rust types here; UI code
// can refine as needed.

export type ConnectionState =
  | 'Disconnected'
  | 'Connecting'
  | 'Authenticating'
  | 'Connected'
  | 'Reconnecting'
  | 'Disconnecting'
  | 'Failed';

export interface OpenVpnConfig {
  remote?: string;
  port?: number;
  proto?: string;
  [k: string]: unknown;
}

export interface ConnectionInfo {
  id: string;
  label: string;
  state: ConnectionState;
  config: OpenVpnConfig;
  [k: string]: unknown;
}

export interface ConnectionStats {
  bytes_in: number;
  bytes_out: number;
  [k: string]: unknown;
}

export interface RoutingPolicy {
  [k: string]: unknown;
}

export interface DnsConfig {
  [k: string]: unknown;
}

export interface ReconnectPolicy {
  [k: string]: unknown;
}

export interface HealthCheck {
  [k: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [k: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  [k: string]: unknown;
}

export interface ConfigTemplate {
  name: string;
  description: string;
  [k: string]: unknown;
}

export interface RouteTableEntry {
  [k: string]: unknown;
}

export interface DnsLeakResult {
  [k: string]: unknown;
}

export type ExportFormat = 'Plain' | 'Json' | 'Csv';
