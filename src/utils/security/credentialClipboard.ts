import { getInvoke } from "../tauri/invoke";
import {
  CredentialFailure,
  failedOutcome,
  settleWithin,
  toCredentialFailure,
  type CredentialFailureCode,
  type CredentialOutcome,
} from "./credentialFailure";

/** What is being copied. It selects the native auto-clear policy and history
 * label, never where the value goes. `recoveryCode` covers backup codes;
 * `secret` covers anything else secret, such as an authenticator seed. */
export type CredentialClipboardKind =
  "username" | "password" | "totpCode" | "apiKey" | "recoveryCode" | "secret";
export type CredentialClipboardWriter = (
  value: string,
  kind: CredentialClipboardKind,
  assertCurrent: () => void,
  options?: { connectionId?: string; expires?: number },
) => Promise<void>;

export type CredentialClipboardFailure = Extract<
  CredentialFailureCode,
  `clipboard-${string}` | "code-expired"
>;

export class CredentialClipboardError extends CredentialFailure {
  declare readonly code: CredentialClipboardFailure;
  constructor(code: CredentialClipboardFailure = "clipboard-unavailable") {
    super(code);
    this.name = "CredentialClipboardError";
  }
}

/** `SecretKind` and `field` as `secure_clip_copy` expects them. */
const wire: Record<CredentialClipboardKind, { kind: string; field: string }> = {
  username: { kind: "username", field: "username" },
  password: { kind: "password", field: "password" },
  totpCode: { kind: "totpCode", field: "totpCode" },
  apiKey: { kind: "apiKey", field: "apiKey" },
  recoveryCode: { kind: "genericSecret", field: "recoveryCode" },
  secret: { kind: "genericSecret", field: "secret" },
};

/** The fixed codes `secure_clip_copy` rejects with (contract K7). */
const nativeFailures = new Map<unknown, CredentialClipboardFailure>([
  ["locked", "clipboard-locked"],
  ["busy", "clipboard-busy"],
  ["too-large", "clipboard-too-large"],
  ["unavailable", "clipboard-unavailable"],
]);

/** Only an exact code is recognised, bare or as `{ code }`. Any other
 * rejection, native prose included, is reported as unavailable. */
function nativeFailure(error: unknown): CredentialClipboardFailure {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? error.code
      : error;
  return nativeFailures.get(code) ?? "clipboard-unavailable";
}

// The engine's own helpers give up after two seconds each; these only catch a
// bridge or command that never answers at all.
const prepareTimeoutMs = 10_000;
const writeTimeoutMs = 10_000;
const timedOut = () => new CredentialClipboardError("clipboard-timed-out");

/** Resolve the transport before reading secrets. Native writes do not depend on
 * WebView focus or a browser clipboard permission, and respect app lock/clear
 * policy. A rejected native write must never fall back around that policy.
 * Every rejection, here and from the writer, is a `CredentialClipboardError`
 * whose `code` names the cause; the caller's own `assertCurrent` error passes
 * through unchanged. */
export async function prepareCredentialClipboard(): Promise<CredentialClipboardWriter> {
  let invoke: Awaited<ReturnType<typeof getInvoke>>;
  try {
    invoke = await settleWithin(getInvoke(), prepareTimeoutMs, timedOut);
    if (!invoke) {
      const host = globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
      };
      // Fail before the caller resolves credentials. A missing desktop bridge
      // is a clipboard transport failure, never permission to use WebView copy.
      if (
        host.__TAURI_INTERNALS__ ||
        host.__TAURI__ ||
        typeof navigator === "undefined" ||
        typeof navigator.clipboard?.writeText !== "function"
      )
        throw new CredentialClipboardError();
    }
  } catch (error) {
    throw error instanceof CredentialClipboardError
      ? error
      : new CredentialClipboardError();
  }
  return async (value, kind, assertCurrent, options = {}) => {
    // No async gap between the caller's last owner/expiry check and disclosure.
    assertCurrent();
    if (options.expires !== undefined && Date.now() >= options.expires)
      throw new CredentialClipboardError("code-expired");
    if (typeof value !== "string" || !value.length)
      throw new CredentialClipboardError("clipboard-empty");
    try {
      if (invoke) {
        await settleWithin(
          invoke("secure_clip_copy", {
            request: {
              value,
              kind: wire[kind].kind,
              field: wire[kind].field,
              connectionId: options.connectionId ?? null,
              label: null,
              clearAfterSecs:
                options.expires === undefined
                  ? null
                  : Math.max(
                      1,
                      Math.min(
                        30,
                        Math.ceil((options.expires - Date.now()) / 1000),
                      ),
                    ),
              maxPastes: null,
              oneTime: false,
            },
          }),
          writeTimeoutMs,
          timedOut,
        );
      } else {
        // Only the ordinary web preview uses the web clipboard. A broken
        // native bridge is not a reason to bypass the desktop clipboard policy.
        const host = globalThis as typeof globalThis & {
          __TAURI_INTERNALS__?: unknown;
          __TAURI__?: unknown;
        };
        if (host.__TAURI_INTERNALS__ || host.__TAURI__)
          throw new CredentialClipboardError();
        await settleWithin(
          navigator.clipboard.writeText(value),
          writeTimeoutMs,
          timedOut,
        );
      }
    } catch (error) {
      throw error instanceof CredentialClipboardError
        ? error
        : new CredentialClipboardError(
            invoke ? nativeFailure(error) : "clipboard-unavailable",
          );
    }
  };
}

/**
 * Copy one secret that needs no ownership gate: an API key, a recovery code, a
 * code shown in a settings panel. It never rejects, and inside the desktop app
 * it never falls back to the web clipboard. Show "copied" only when `ok` is
 * true; otherwise show `message`, which names the cause and holds no secret.
 *
 * Leave the auto-clear time to the native policy. Pass `expires` (Unix
 * milliseconds) only for a one-time code, so it leaves the clipboard with its
 * time step. A copy that must be tied to an open database or vault uses
 * `prepareCredentialClipboard` and its `assertCurrent` gate instead.
 */
export async function copySecretToClipboard(
  value: string,
  kind: CredentialClipboardKind,
  options: { connectionId?: string; expires?: number } = {},
): Promise<CredentialOutcome> {
  try {
    // Nothing to copy is not a clipboard fault: say so before any bridge work.
    if (typeof value !== "string" || !value.length)
      throw new CredentialClipboardError("clipboard-empty");
    const write = await prepareCredentialClipboard();
    await write(value, kind, () => {}, options);
    return { ok: true };
  } catch (error) {
    return failedOutcome(toCredentialFailure(error, "clipboard-unavailable"));
  }
}
