import type { OriginBrowserIdentity } from "./originBrowser";

export const ORIGIN_CERTIFICATE_REVIEW_EVENT =
  "origin-browser-certificate-review";
export type OriginCertificateDecision = "allow-once" | "remember" | "cancel";
/** Public leaf-certificate details for display, never approval authority. */
export interface OriginCertificateDetails {
  readonly subject: string;
  readonly issuer: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly dnsNames: readonly string[];
  readonly ipAddresses: readonly string[];
}
export interface OriginCertificatePrompt {
  readonly requestId: string;
  readonly identity: OriginBrowserIdentity;
  readonly origin: string;
  readonly fingerprint: string;
  readonly reason: string;
  readonly temporary: boolean;
  readonly expiresAtUnixMs: number;
  readonly certificate?: OriginCertificateDetails;
}
export interface OriginCertificateReviewSnapshot {
  readonly revision: number;
  readonly prompt: OriginCertificatePrompt | null;
}
export type OriginCertificateReviewRequest =
  | { action: "pending" }
  | {
      action: "respond";
      requestId: string;
      identity: OriginBrowserIdentity;
      decision: OriginCertificateDecision;
    };
export interface OriginCertificateReviewTransport {
  listen(listener: (snapshot: unknown) => void): Promise<() => void>;
  request(request: OriginCertificateReviewRequest): Promise<unknown>;
}

const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value);

function readCertificate(value: unknown): OriginCertificateDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = (value: unknown) =>
    typeof value === "string" &&
    value.length <= 8192 &&
    (value === "" || text(value, 8192));
  const date = (value: unknown) =>
    value === null ||
    (typeof value === "string" &&
      value.length <= 64 &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(
        value,
      ) &&
      Number.isFinite(Date.parse(value)));
  const names = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((name) => text(name, 253));
  if (
    !name(row.subject) ||
    !name(row.issuer) ||
    !date(row.validFrom) ||
    !date(row.validTo) ||
    !names(row.dnsNames) ||
    !names(row.ipAddresses)
  )
    return null;
  return Object.freeze({
    subject: row.subject as string,
    issuer: row.issuer as string,
    validFrom: row.validFrom as string | null,
    validTo: row.validTo as string | null,
    dnsNames: Object.freeze([...row.dnsNames]),
    ipAddresses: Object.freeze([...row.ipAddresses]),
  });
}

/** Display validation only. Approval authority and certificate evidence stay native. */
export function readOriginCertificateReview(
  value: unknown,
): OriginCertificateReviewSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 0)
    return null;
  if (row.prompt === null)
    return { revision: row.revision as number, prompt: null };
  if (!row.prompt || typeof row.prompt !== "object") return null;
  const prompt = row.prompt as Record<string, unknown>;
  const identity = prompt.identity as OriginBrowserIdentity | undefined;
  if (
    !text(prompt.requestId, 256) ||
    !identity ||
    ![
      identity.ownerDatabaseId,
      identity.connectionId,
      identity.sessionId,
      identity.attemptId,
    ].every((part) => text(part, 256)) ||
    !text(prompt.origin, 2048) ||
    !text(prompt.fingerprint, 256) ||
    !/^[0-9a-f]{64}$/.test(prompt.fingerprint) ||
    !text(prompt.reason, 2048) ||
    typeof prompt.temporary !== "boolean" ||
    !Number.isSafeInteger(prompt.expiresAtUnixMs) ||
    (prompt.expiresAtUnixMs as number) <= 0 ||
    (prompt.expiresAtUnixMs as number) > 8_640_000_000_000_000
  )
    return null;
  try {
    const origin = new URL(prompt.origin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== prompt.origin ||
      origin.username ||
      origin.password
    )
      return null;
  } catch {
    return null;
  }
  const certificate =
    prompt.certificate === undefined
      ? undefined
      : readCertificate(prompt.certificate);
  if (certificate === null) return null;
  return {
    revision: row.revision as number,
    prompt: Object.freeze({
      requestId: prompt.requestId,
      identity: Object.freeze({
        ownerDatabaseId: identity.ownerDatabaseId,
        connectionId: identity.connectionId,
        sessionId: identity.sessionId,
        attemptId: identity.attemptId,
      }),
      origin: prompt.origin,
      fingerprint: prompt.fingerprint,
      reason: prompt.reason,
      temporary: prompt.temporary,
      expiresAtUnixMs: prompt.expiresAtUnixMs as number,
      ...(certificate === undefined ? {} : { certificate }),
    }),
  };
}
