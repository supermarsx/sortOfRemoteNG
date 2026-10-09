import { getInvoke } from "../tauri/invoke";

export type CredentialClipboardKind = "username" | "password" | "totpCode";
export type CredentialClipboardWriter = (
  value: string,
  kind: CredentialClipboardKind,
  assertCurrent: () => void,
  options?: { connectionId?: string; expires?: number },
) => Promise<void>;

export class CredentialClipboardError extends Error {
  constructor() {
    super(
      "The clipboard could not be updated. Check the secure clipboard settings and try again.",
    );
  }
}

/** Resolve the transport before reading secrets. Native writes do not depend on
 * WebView focus or a browser clipboard permission, and respect app lock/clear
 * policy. A rejected native write must never fall back around that policy. */
export async function prepareCredentialClipboard(): Promise<CredentialClipboardWriter> {
  let invoke: Awaited<ReturnType<typeof getInvoke>>;
  try {
    invoke = await getInvoke();
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
  } catch {
    throw new CredentialClipboardError();
  }
  return async (value, kind, assertCurrent, options = {}) => {
    // No async gap between the caller's last owner/expiry check and disclosure.
    assertCurrent();
    if (options.expires !== undefined && Date.now() >= options.expires)
      throw new Error("This code has expired.");
    try {
      if (invoke) {
        await invoke("secure_clip_copy", {
          request: {
            value,
            kind,
            field: kind,
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
        });
      } else {
        // Only the ordinary web preview uses the web clipboard. A broken
        // native bridge is not a reason to bypass the desktop clipboard policy.
        const host = globalThis as typeof globalThis & {
          __TAURI_INTERNALS__?: unknown;
          __TAURI__?: unknown;
        };
        if (host.__TAURI_INTERNALS__ || host.__TAURI__)
          throw new CredentialClipboardError();
        await navigator.clipboard.writeText(value);
      }
    } catch {
      throw new CredentialClipboardError();
    }
  };
}
