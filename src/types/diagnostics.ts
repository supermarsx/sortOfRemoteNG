/* ── Connection Diagnostics Types ─────────────────────────────── */

export interface PingResult {
  success: boolean;
  time_ms?: number;
  error?: string;
}

export interface TracerouteHop {
  hop: number;
  ip?: string;
  hostname?: string;
  time_ms?: number;
  timeout: boolean;
}

export interface PortCheckResult {
  port: number;
  open: boolean;
  service?: string;
  time_ms?: number;
  banner?: string;
}

export interface DnsResult {
  success: boolean;
  resolved_ips: string[];
  reverse_dns?: string;
  resolution_time_ms: number;
  dns_server?: string;
  error?: string;
}

export interface IpClassification {
  ip: string;
  ip_type: string;
  ip_class?: string;
  is_ipv6: boolean;
  network_info?: string;
}

export interface TcpTimingResult {
  connect_time_ms: number;
  syn_ack_time_ms?: number;
  total_time_ms: number;
  success: boolean;
  slow_connection: boolean;
  error?: string;
}

export interface MtuTestPoint {
  size: number;
  success: boolean;
}

export interface MtuCheckResult {
  path_mtu?: number;
  fragmentation_needed: boolean;
  recommended_mtu: number;
  test_results: MtuTestPoint[];
  error?: string;
}

export interface IcmpBlockadeResult {
  icmp_allowed: boolean;
  tcp_reachable: boolean;
  likely_blocked: boolean;
  diagnosis: string;
}

export interface TlsCheckResult {
  tls_supported: boolean;
  tls_version?: string;
  certificate_valid: boolean;
  certificate_subject?: string;
  certificate_issuer?: string;
  certificate_expiry?: string;
  handshake_time_ms: number;
  error?: string;
}

export interface ServiceFingerprint {
  port: number;
  service: string;
  version?: string;
  banner?: string;
  protocol_detected?: string;
  response_preview?: string;
}

export interface TtlAnalysis {
  expected_ttl?: number;
  received_ttl?: number;
  estimated_hops?: number;
  ttl_consistent: boolean;
}

export interface AsymmetricRoutingResult {
  asymmetry_detected: boolean;
  confidence: string;
  outbound_hops: string[];
  ttl_analysis: TtlAnalysis;
  latency_variance?: number;
  path_stability: string;
  notes: string[];
}

export interface UdpProbeResult {
  port: number;
  reachable?: boolean;
  response_received: boolean;
  response_type?: string;
  response_data?: string;
  latency_ms?: number;
  error?: string;
}

export interface IpGeoInfo {
  ip: string;
  asn?: number;
  asn_org?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  isp?: string;
  is_proxy?: boolean;
  is_vpn?: boolean;
  is_tor?: boolean;
  is_datacenter?: boolean;
  source: string;
  error?: string;
}

export interface LeakageDetectionResult {
  dns_leak_detected: boolean;
  webrtc_leak_possible: boolean;
  ip_mismatch_detected: boolean;
  detected_public_ip?: string;
  expected_proxy_ip?: string;
  dns_servers_detected: string[];
  notes: string[];
  overall_status: string;
}

export interface DiagnosticResults {
  internetCheck: "pending" | "success" | "failed";
  gatewayCheck: "pending" | "success" | "failed";
  subnetCheck: "pending" | "success" | "failed";
  pings: PingResult[];
  traceroute: TracerouteHop[];
  portCheck: PortCheckResult | null;
  dnsResult: DnsResult | null;
  ipClassification: IpClassification | null;
  tcpTiming: TcpTimingResult | null;
  mtuCheck: MtuCheckResult | null;
  icmpBlockade: IcmpBlockadeResult | null;
  tlsCheck: TlsCheckResult | null;
  serviceFingerprint: ServiceFingerprint | null;
  asymmetricRouting: AsymmetricRoutingResult | null;
  udpProbe: UdpProbeResult | null;
  ipGeoInfo: IpGeoInfo | null;
  leakageDetection: LeakageDetectionResult | null;
}

/* ── Protocol-specific deep diagnostic types (match Rust DiagnosticStep/Report) ── */

export interface ProtocolDiagnosticStep {
  name: string;
  status: "pass" | "fail" | "skip" | "warn" | "info";
  message: string;
  durationMs: number;
  detail: string | null;
}

export interface ProtocolDiagnosticReport {
  host: string;
  port: number;
  protocol: string;
  resolvedIp: string | null;
  steps: ProtocolDiagnosticStep[];
  summary: string;
  rootCauseHint: string | null;
  totalDurationMs: number;
}

export const initialDiagnosticResults: DiagnosticResults = {
  internetCheck: "pending",
  gatewayCheck: "pending",
  subnetCheck: "pending",
  pings: [],
  traceroute: [],
  portCheck: null,
  dnsResult: null,
  ipClassification: null,
  tcpTiming: null,
  mtuCheck: null,
  icmpBlockade: null,
  tlsCheck: null,
  serviceFingerprint: null,
  asymmetricRouting: null,
  udpProbe: null,
  ipGeoInfo: null,
  leakageDetection: null,
};

/** Default port mapping for connection protocols */
export const DEFAULT_PROTOCOL_PORTS: Record<string, number> = {
  rdp: 3389,
  ssh: 22,
  vnc: 5900,
  telnet: 23,
  http: 80,
  https: 443,
  ftp: 21,
  smb: 445,
  mysql: 3306,
  postgresql: 5432,
  anydesk: 7070,
  rustdesk: 21116,
};
