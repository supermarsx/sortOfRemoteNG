/**
 * Generates a unique identifier.
 *
 * Prefers the host's `crypto.randomUUID` implementation for RFC 4122 v4
 * identifiers when available. This provides strong entropy and collision
 * resistance as long as the runtime exposes a compliant `crypto` API.
 *
 * When `crypto.randomUUID` is unavailable, falls back to combining a
 * base36-encoded `Math.random` segment with the current timestamp. This
 * fallback offers limited entropy and does not guarantee global uniqueness,
 * especially across processes or machines.
 *
 * @returns {string} Best-effort unique identifier.
 * @remarks Requires a standards-compliant `crypto.randomUUID` for strong
 *          uniqueness guarantees; the fallback assumes a reasonably accurate
 *          clock and non-broken `Math.random` implementation.
 */
export function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const randomPart = Math.random().toString(36).slice(2);
  const timePart = Date.now().toString(36);
  return randomPart + timePart;
}
