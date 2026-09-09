import type {
  CertificateDetails,
  NativeTlsCertificateInfo,
} from "../../src/types/security/certificateInspection";

export const certificateDetailsFixture: CertificateDetails = {
  der_base64: "U1lOVEhFVElDLURFUg==",
  pem: "-----BEGIN CERTIFICATE-----\nSYNTHETIC-ONLY\n-----END CERTIFICATE-----",
  fingerprints: {
    sha256: "ab".repeat(32),
    sha384: "de".repeat(48),
    sha512: "12".repeat(64),
  },
  subject_attributes: [
    {
      rdn: 0,
      oid: "2.5.4.3",
      name: "commonName",
      value: "dashboard.example.test",
      value_der_base64: "QUJD",
    },
  ],
  issuer_attributes: [
    {
      rdn: 0,
      oid: "2.5.4.10",
      name: "organizationName",
      value: "Demonstration CA",
      value_der_base64: "REVG",
    },
  ],
  san_entries: [
    {
      type: "DNS",
      value: "dashboard.example.test",
      oid: null,
      value_der_base64: null,
    },
    { type: "IP", value: "192.0.2.10", oid: null, value_der_base64: null },
  ],
  serial: "01:23:45",
  version: 3,
  signature_algorithm: "sha256WithRSAEncryption",
  signature_algorithm_oid: "1.2.840.113549.1.1.11",
  signature_parameters_der_base64: "BQA=",
  signature_value_base64: "U0lHTkFUVVJF",
  public_key: {
    algorithm: "RSA",
    algorithm_oid: "1.2.840.113549.1.1.1",
    parameter_oid: null,
    bits: 2048,
    spki_der_base64: "UFVCTElDLUtFWQ==",
    spki_sha256: "cd".repeat(32),
  },
  extensions: [
    {
      oid: "2.5.29.19",
      name: "basicConstraints",
      critical: true,
      value_der_base64: "MAMBAQA=",
      summary: "CA: false",
    },
  ],
  parse_error: null,
};
export const certificateInfoFixture: NativeTlsCertificateInfo = {
  fingerprint: "ab".repeat(32),
  subject: "CN=dashboard.example.test, O=Demonstration",
  issuer: "CN=Demonstration Issuer, O=Demonstration CA",
  subject_cn: "dashboard.example.test",
  issuer_cn: "Demonstration Issuer",
  valid_from: "2026-01-01T00:00:00Z",
  valid_to: "2027-01-01T00:00:00Z",
  san: ["DNS:dashboard.example.test", "IP:192.0.2.10"],
  serial: certificateDetailsFixture.serial,
  version: 3,
  key_algorithm: "RSA",
  key_size: 2048,
  signature_algorithm: certificateDetailsFixture.signature_algorithm,
  pem: certificateDetailsFixture.pem,
  details: certificateDetailsFixture,
  chain: [
    {
      subject: "CN=dashboard.example.test",
      issuer: "CN=Demonstration Issuer",
      fingerprint: "ab".repeat(32),
      valid_from: "2026-01-01T00:00:00Z",
      valid_to: "2027-01-01T00:00:00Z",
      details: certificateDetailsFixture,
    },
  ],
  capture: {
    source: "peer-presented",
    certificate_count: 1,
    total_der_bytes: 13,
    captured_at: "2026-09-09T12:00:00Z",
  },
  warnings: [],
};
