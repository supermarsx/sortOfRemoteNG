/** Ephemeral native peer capture. These details are not stored trust approvals. */
export interface CertificateNameAttribute {
  rdn: number;
  oid: string;
  name: string | null;
  value: string;
  value_der_base64: string;
}
export interface CertificateDetails {
  der_base64: string;
  pem: string;
  fingerprints: { sha256: string; sha384: string; sha512: string };
  subject_attributes: CertificateNameAttribute[];
  issuer_attributes: CertificateNameAttribute[];
  san_entries: {
    type: string;
    value: string;
    oid: string | null;
    value_der_base64: string | null;
  }[];
  serial: string | null;
  version: number | null;
  signature_algorithm_oid: string | null;
  signature_algorithm: string | null;
  signature_parameters_der_base64: string | null;
  signature_value_base64: string | null;
  public_key: {
    algorithm_oid: string;
    algorithm: string;
    parameter_oid: string | null;
    bits: number | null;
    spki_der_base64: string;
    spki_sha256: string;
  } | null;
  extensions: {
    oid: string;
    name: string | null;
    critical: boolean;
    value_der_base64: string;
    summary: string | null;
  }[];
  parse_error: string | null;
}
export interface NativeCertificateChainEntry {
  subject: string;
  issuer: string;
  fingerprint: string;
  valid_from: string;
  valid_to: string;
  details?: CertificateDetails;
}
export interface NativeTlsCertificateInfo {
  /** Advisory display plus opaque native-owned proof; never authorization by itself. */
  ca_validation?: {
    status: "verified" | "unverified" | "unavailable";
    proof_id?: string;
  };
  fingerprint: string;
  subject?: string | null;
  issuer?: string | null;
  pem?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  serial?: string | null;
  signature_algorithm?: string | null;
  san?: string[];
  subject_cn?: string | null;
  subject_org?: string | null;
  subject_ou?: string | null;
  subject_country?: string | null;
  subject_state?: string | null;
  subject_locality?: string | null;
  subject_email?: string | null;
  issuer_cn?: string | null;
  issuer_org?: string | null;
  issuer_country?: string | null;
  key_algorithm?: string | null;
  key_size?: number | null;
  version?: number | null;
  chain?: NativeCertificateChainEntry[] | null;
  details?: CertificateDetails;
  capture?: {
    source: "peer-presented";
    certificate_count: number;
    total_der_bytes: number;
    captured_at: string;
  };
  warnings?: string[];
}
export interface CertificateInspection {
  host: string;
  port: number;
  generation: number;
  certificate: NativeTlsCertificateInfo;
}

/** Native pipeline stage of a certificate inspection (IPC error wire). */
export type CertificateInspectionStage =
  | "target"
  | "resolve"
  | "connect"
  | "proxy_connect"
  | "proxy_tls"
  | "proxy_tunnel"
  | "tls_handshake"
  | "certificate"
  | "verifier";
export type CertificateInspectionFailureKind =
  | "invalid_target"
  | "dns_failure"
  | "connect_timeout"
  | "connection_refused"
  | "host_unreachable"
  | "connect_failed"
  | "proxy_invalid"
  | "proxy_unreachable"
  | "proxy_tls_failed"
  | "proxy_auth_rejected"
  | "proxy_tunnel_rejected"
  | "proxy_tunnel_timeout"
  | "proxy_protocol_error"
  | "tls_handshake_timeout"
  | "tls_handshake_failed"
  | "certificate_unreadable"
  | "inspection_unavailable"
  | "deadline_exceeded";
export type CertificateInspectionRoute = "direct" | "proxy";
export type CertificateTlsFailureReason =
  "not_tls" | "peer_closed" | "alert" | "certificate" | "other";
/**
 * Structured native rejection of `get_tls_certificate_info`. Timings are
 * measured natively; `message` is technical detail, never a proxy URL.
 */
export interface NativeCertificateInspectionError {
  kind: CertificateInspectionFailureKind;
  stage: CertificateInspectionStage;
  route: CertificateInspectionRoute;
  /** Requested authority, or "" for an invalid target. Display uses the hook's own host/port. */
  target: string;
  /** Last socket address dialled on the direct route. */
  address: string | null;
  addresses_tried: number;
  elapsed_ms: number;
  stage_elapsed_ms: number;
  /** The budget that expired, when one did. */
  timeout_ms: number | null;
  proxy_status: number | null;
  tls_reason: CertificateTlsFailureReason | null;
  completed: { stage: CertificateInspectionStage; elapsed_ms: number }[];
  message: string;
}

export type WebNavigationTimelineStepId =
  | "resolve"
  | "connect"
  | "proxy_connect"
  | "proxy_tls"
  | "proxy_tunnel"
  | "tls_handshake"
  | "certificate"
  | "trust"
  | "page";
export interface WebNavigationTimelineStep {
  id: WebNavigationTimelineStepId;
  label: string;
  status: "pass" | "fail" | "not_started";
  /** Measured native duration; null when not started or not measured. */
  durationMs: number | null;
  detail: string | null;
}
/** Measured timeline of one navigation attempt that failed before trust. */
export interface WebNavigationTimeline {
  /** Epoch milliseconds when the navigation attempt started. */
  startedAt: number;
  /** Monotonic milliseconds from attempt start to the failure. */
  failedAfterMs: number;
  route: CertificateInspectionRoute;
  /** Canonical order for the route; empty when the failing stage is unknown. */
  steps: WebNavigationTimelineStep[];
}
/** Live state of the pending HTTPS certificate trust check. */
export interface WebTrustCheck {
  /** Epoch milliseconds when the certificate check started. */
  startedAt: number;
  host: string;
  port: number;
  route: CertificateInspectionRoute;
}
