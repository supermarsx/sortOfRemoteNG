/** Per-connection allow-list of plain-HTTP origins where credential typing is
 * permitted besides the saved source. HTTPS needs no entry. Entries are exact
 * `scheme://host[:port]` origins: never a wildcard, path or credential. */
export const MAX_HTTP_TYPING_ORIGINS = 32;

/** The exact origin of an HTTP page address, or null for anything else
 * (HTTPS, other schemes, embedded credentials, malformed text). */
export function httpTypingOrigin(address: unknown): string | null {
  if (typeof address !== "string" || address.length > 2048) return null;
  try {
    const url = new URL(address);
    if (url.protocol !== "http:" || url.username || url.password) return null;
    // Exact hosts only: a wildcard or escaped host is never an origin.
    if (/[*%]/.test(url.hostname) || /[*%]/.test(address.split("/")[2] ?? ""))
      return null;
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

/** The saved list as exact HTTP origins only; invalid entries are dropped. */
export function normalizeHttpTypingOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const origins: string[] = [];
  for (const item of value) {
    const origin = httpTypingOrigin(item);
    if (
      origin &&
      item === origin &&
      !origins.includes(origin) &&
      origins.length < MAX_HTTP_TYPING_ORIGINS
    )
      origins.push(origin);
  }
  return origins;
}

/** The list with `origin` appended, or null when it cannot be added. */
export function withHttpTypingOrigin(
  current: unknown,
  origin: string,
): string[] | null {
  const exact = httpTypingOrigin(origin);
  if (!exact || exact !== origin) return null;
  const list = normalizeHttpTypingOrigins(current);
  if (list.includes(exact)) return list;
  return list.length < MAX_HTTP_TYPING_ORIGINS ? [...list, exact] : null;
}

/** Persist one exact HTTP origin on a saved connection and wait for the write.
 * Only the allow-list changes. Rejects, writing nothing, when `current` (the
 * live saved row) is no longer the reviewed `connection` or the origin is not
 * an exact HTTP origin; a rejected write is passed on to the caller. */
export async function saveHttpTypingOrigin<
  T extends { httpTypingOrigins?: string[] },
>(options: {
  connection: T;
  current: T | undefined;
  origin: string;
  write: (updated: T) => Promise<void>;
}): Promise<void> {
  const next = withHttpTypingOrigin(
    options.connection.httpTypingOrigins,
    options.origin,
  );
  if (!next || options.current !== options.connection)
    throw new Error("The saved website changed.");
  await options.write({ ...options.connection, httpTypingOrigins: next });
}
