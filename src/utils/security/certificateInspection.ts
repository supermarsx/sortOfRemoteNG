import type {
  CertificateDetails,
  NativeTlsCertificateInfo,
} from "../../types/security/certificateInspection";

const fail = (): never => {
  throw new Error("Malformed bounded certificate inspection details");
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 4096) => {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > max)
    fail();
};
const optionalText = (value: unknown, max = 4096) => {
  if (value !== null) text(value, max);
};
const number = (value: unknown, max = Number.MAX_SAFE_INTEGER) => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    fail();
};
const array = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) return fail();
  return value;
};
const fingerprint = (value: unknown, bytes: number): string => {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "i").test(value)
  )
    return fail();
  return value.toLowerCase();
};
function details(value: unknown): asserts value is CertificateDetails {
  const entry = object(value);
  text(entry.der_base64, 350000);
  text(entry.pem, 360000);
  const fingerprints = object(entry.fingerprints);
  fingerprint(fingerprints.sha256, 32);
  fingerprint(fingerprints.sha384, 48);
  fingerprint(fingerprints.sha512, 64);
  for (const key of ["subject_attributes", "issuer_attributes"]) {
    for (const value of array(entry[key], 128)) {
      const attribute = object(value);
      number(attribute.rdn, 127);
      text(attribute.oid);
      optionalText(attribute.name);
      text(attribute.value);
      text(attribute.value_der_base64, 350000);
    }
  }
  for (const value of array(entry.san_entries, 256)) {
    const san = object(value);
    text(san.type);
    text(san.value);
    optionalText(san.oid);
    optionalText(san.value_der_base64, 350000);
  }
  for (const key of [
    "serial",
    "signature_algorithm_oid",
    "signature_algorithm",
    "parse_error",
  ])
    optionalText(entry[key]);
  for (const key of [
    "signature_parameters_der_base64",
    "signature_value_base64",
  ])
    optionalText(entry[key], 350000);
  if (entry.version !== null) number(entry.version);
  if (entry.public_key !== null) {
    const key = object(entry.public_key);
    text(key.algorithm_oid);
    text(key.algorithm);
    optionalText(key.parameter_oid);
    text(key.spki_der_base64, 350000);
    fingerprint(key.spki_sha256, 32);
    if (key.bits !== null) number(key.bits);
  }
  for (const value of array(entry.extensions, 128)) {
    const extension = object(value);
    text(extension.oid);
    optionalText(extension.name);
    optionalText(extension.summary);
    text(extension.value_der_base64, 350000);
    if (typeof extension.critical !== "boolean") fail();
  }
}

/** Validate rich optional metadata separately from the existing persisted pin codec. */
export function validateCertificateInspection(
  info: NativeTlsCertificateInfo,
): NativeTlsCertificateInfo {
  object(info);
  if (info.ca_validation !== undefined) {
    const validation = object(info.ca_validation);
    if (
      Object.keys(validation).some(
        (key) => !["status", "proof_id"].includes(key),
      ) ||
      typeof validation.status !== "string" ||
      !["verified", "unverified", "unavailable"].includes(validation.status) ||
      (validation.proof_id !== undefined &&
        (validation.status !== "verified" ||
          typeof validation.proof_id !== "string" ||
          !/^[A-Za-z0-9_-]{16,256}$/.test(validation.proof_id)))
    )
      fail();
  }
  if (new TextEncoder().encode(JSON.stringify(info)).length > 2 * 1024 * 1024)
    fail();
  if (info.details !== undefined) details(info.details);
  if (
    info.details &&
    fingerprint(info.fingerprint, 32) !==
      info.details.fingerprints.sha256.toLowerCase()
  )
    fail();
  if (info.chain != null)
    for (const value of array(info.chain, 32)) {
      const entry = object(value);
      if (entry.details !== undefined) details(entry.details);
      if (
        entry.details &&
        fingerprint(entry.fingerprint, 32) !==
          (
            entry.details as CertificateDetails
          ).fingerprints.sha256.toLowerCase()
      )
        fail();
    }
  if (info.details || info.chain?.some((entry) => entry.details)) {
    if (
      !info.chain?.length ||
      fingerprint(info.chain[0].fingerprint, 32) !==
        fingerprint(info.fingerprint, 32)
    )
      fail();
  }
  if (info.capture !== undefined) {
    const capture = object(info.capture);
    if (capture.source !== "peer-presented") fail();
    number(capture.certificate_count, 32);
    number(capture.total_der_bytes, 2 * 1024 * 1024);
    text(capture.captured_at, 128);
    if (capture.certificate_count !== info.chain?.length) fail();
    if (
      !info.chain?.length ||
      fingerprint(info.chain[0].fingerprint, 32) !==
        fingerprint(info.fingerprint, 32)
    )
      fail();
  }
  if (info.warnings !== undefined)
    for (const warning of array(info.warnings, 256)) text(warning);
  return info;
}
