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
