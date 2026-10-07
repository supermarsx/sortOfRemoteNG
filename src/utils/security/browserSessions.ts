import type {
  BrowserSessionsDescriptor,
  BrowserSessionsTransfer,
} from "../../types/security/browserSessions";

export const MAX_BROWSER_SESSION_RECORDS = 1024;
export const MAX_BROWSER_SESSION_TRANSFER_BYTES = 48 * 1024 * 1024;

export function invalidBrowserSessions(): never {
  throw new Error(
    "Browser session data is invalid, unavailable or requires native protected transfer. No session data was applied.",
  );
}

function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidBrowserSessions();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return invalidBrowserSessions();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return (
        typeof key !== "string" ||
        !fields.includes(key) ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  )
    return invalidBrowserSessions();
  return value as Record<string, unknown>;
}

export function normalizeBrowserSessions(
  value: unknown,
): BrowserSessionsDescriptor {
  const raw = object(value, ["version", "records"]);
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.records) ||
    raw.records.length > MAX_BROWSER_SESSION_RECORDS ||
    Object.getPrototypeOf(raw.records) !== Array.prototype ||
    Reflect.ownKeys(raw.records).length !== raw.records.length + 1
  )
    return invalidBrowserSessions();
  const seen = new Set<string>();
  const records: BrowserSessionsDescriptor["records"] = [];
  for (let index = 0; index < raw.records.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw.records, index);
    if (!descriptor || !("value" in descriptor))
      return invalidBrowserSessions();
    const row = object(descriptor.value, ["connectionId", "revision"]);
    if (
      typeof row.connectionId !== "string" ||
      !row.connectionId.trim() ||
      row.connectionId.length > 256 ||
      new TextEncoder().encode(row.connectionId).length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(row.connectionId) ||
      ["__proto__", "constructor", "prototype"].includes(row.connectionId) ||
      seen.has(row.connectionId) ||
      typeof row.revision !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(row.revision)
    )
      return invalidBrowserSessions();
    seen.add(row.connectionId);
    records.push({ connectionId: row.connectionId, revision: row.revision });
  }
  // Native sorts UTF-8 connection IDs. Compare Unicode scalar values, not locale.
  records.sort((a, b) => {
    const left = [...a.connectionId],
      right = [...b.connectionId];
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const difference = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
      if (difference) return difference;
    }
    return left.length - right.length;
  });
  return { version: 1, records };
}

/** Structural validation is NOT authentication and grants no canonicalization privilege. */
export function normalizeBrowserSessionsTransfer(
  value: unknown,
): BrowserSessionsTransfer {
  const raw = object(value, ["version", "ciphertext"]);
  if (
    raw.version !== 1 ||
    typeof raw.ciphertext !== "string" ||
    !raw.ciphertext ||
    raw.ciphertext.length > MAX_BROWSER_SESSION_TRANSFER_BYTES ||
    new TextEncoder().encode(raw.ciphertext).length >
      MAX_BROWSER_SESSION_TRANSFER_BYTES
  )
    return invalidBrowserSessions();
  return { version: 1, ciphertext: raw.ciphertext };
}

/** Same bounded ID vocabulary as descriptors; deletions are authenticated by native. */
export function normalizeBrowserSessionDeletions(
  value: unknown,
  selected: BrowserSessionsDescriptor,
): string[] {
  if (!Array.isArray(value)) return invalidBrowserSessions();
  // Reuse dense-array/accessor/duplicate checks without reading accessor values.
  const records: BrowserSessionsDescriptor["records"] = [];
  if (
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1 ||
    value.length + selected.records.length > MAX_BROWSER_SESSION_RECORDS
  )
    return invalidBrowserSessions();
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, index);
    if (!entry || !("value" in entry)) return invalidBrowserSessions();
    records.push({ connectionId: entry.value, revision: "0".repeat(64) });
  }
  const normalized = normalizeBrowserSessions({ version: 1, records });
  const selectedIds = new Set(selected.records.map((row) => row.connectionId));
  if (normalized.records.some((row) => selectedIds.has(row.connectionId)))
    return invalidBrowserSessions();
  return normalized.records.map((row) => row.connectionId);
}

export function assertBrowserSessionTransferPassword(password: string): void {
  const bytes =
    typeof password === "string"
      ? new TextEncoder().encode(password).length
      : 0;
  if (bytes < 12 || bytes > 1024) invalidBrowserSessions();
}
