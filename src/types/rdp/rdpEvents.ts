export interface RDPStatusEvent {
  session_id: string;
  status: string;
  message: string;
  desktop_width?: number;
  desktop_height?: number;
}

export interface RDPPointerEvent {
  session_id: string;
  pointer_type: string;
  x?: number;
  y?: number;
}

export interface RDPStatsEvent {
  session_id: string;
  uptime_secs: number;
  bytes_received: number;
  bytes_sent: number;
  pdus_received: number;
  pdus_sent: number;
  frame_count: number;
  fps: number;
  input_events: number;
  errors_recovered: number;
  reactivations: number;
  phase: string;
  last_error: string | null;
}

export interface RdpCertFingerprintEvent {
  session_id: string;
  fingerprint: string;
  host: string;
  port: number;
  /** X.509 Subject (RFC 4514 string) */
  subject?: string;
  /** X.509 Issuer (RFC 4514 string) */
  issuer?: string;
  /** Certificate validity start (ISO 8601) */
  valid_from?: string;
  /** Certificate validity end (ISO 8601) */
  valid_to?: string;
  /** Serial number (colon-separated hex) */
  serial?: string;
  /** Signature algorithm OID */
  signature_algorithm?: string;
  /** Subject Alternative Names */
  san?: string[];
  /** PEM-encoded certificate */
  pem?: string;
}

export interface RDPTimingEvent {
  session_id: string;
  dns_ms: number;
  tcp_ms: number;
  negotiate_ms: number;
  tls_ms: number;
  auth_ms: number;
  total_ms: number;
}
