import { useEffect, useState } from "react";
import type { BrowserSessionRetentionCapabilities } from "../../types/settings/browserSession";
import { getInvoke } from "../../utils/tauri/invoke";

type Capabilities = Required<BrowserSessionRetentionCapabilities>;
const UNAVAILABLE: Readonly<Capabilities> = Object.freeze({
  memory: false,
  encryptedDatabase: false,
  policyExpiration: false,
  clearOnDatabaseLock: false,
});
const POLL_MS = 30_000;
const UNAVAILABLE_POLL_MS = 60_000;
const RESPONSE_TIMEOUT_MS = 5_000;
const isHidden = () => document.visibilityState === "hidden";

function parseCapabilities(value: unknown): Capabilities {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return UNAVAILABLE;
  const row = value as Record<string, unknown>;
  if (Object.keys(UNAVAILABLE).some((key) => typeof row[key] !== "boolean"))
    return UNAVAILABLE;
  return {
    memory: row.memory as boolean,
    encryptedDatabase: row.encryptedDatabase as boolean,
    policyExpiration: row.policyExpiration as boolean,
    clearOnDatabaseLock: row.clearOnDatabaseLock as boolean,
  };
}

/** Backend feature support only: never an owner lease, unlock proof or active retention policy.
 * Mounted settings consumers opt in; browser-only/disabled consumers do not poll.
 */
export function useBrowserRetentionCapabilities(enabled = true): Capabilities {
  const [capabilities, setCapabilities] = useState<Capabilities>(UNAVAILABLE);
  useEffect(() => {
    setCapabilities(UNAVAILABLE);
    if (!enabled) return;
    let disposed = false;
    let pending = false;
    let noRuntime = false;
    let visibilityRevision = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    const clearPoll = () => {
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      pollTimer = undefined;
    };
    const refresh = async () => {
      clearPoll();
      if (disposed || pending || noRuntime || isHidden()) return;
      pending = true;
      const requestRevision = visibilityRevision;
      let timedOut = false;
      let next: Capabilities = UNAVAILABLE;
      responseTimer = setTimeout(() => {
        timedOut = true;
        if (!disposed) setCapabilities(UNAVAILABLE);
      }, RESPONSE_TIMEOUT_MS);
      try {
        const invoke = await getInvoke();
        if (disposed) return;
        if (!invoke) {
          noRuntime = true;
          return;
        }
        if (timedOut) return;
        const reply = await invoke<unknown>(
          "origin_browser_retention_capabilities",
        );
        if (
          !disposed &&
          !timedOut &&
          requestRevision === visibilityRevision &&
          !isHidden()
        )
          next = parseCapabilities(reply);
      } catch {
        // Older native builds, rejected commands and malformed results never enable support.
      } finally {
        if (responseTimer !== undefined) clearTimeout(responseTimer);
        responseTimer = undefined;
        pending = false;
        if (!disposed) {
          setCapabilities(next);
          if (!noRuntime && !isHidden()) {
            pollTimer = setTimeout(
              () => {
                void refresh();
              },
              requestRevision !== visibilityRevision
                ? 0
                : next.memory || next.encryptedDatabase
                  ? POLL_MS
                  : UNAVAILABLE_POLL_MS,
            );
          }
        }
      }
    };
    const onVisibility = () => {
      if (isHidden()) {
        visibilityRevision += 1;
        clearPoll();
        setCapabilities(UNAVAILABLE);
      } else if (pollTimer === undefined) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void refresh();
    return () => {
      disposed = true;
      clearPoll();
      if (responseTimer !== undefined) clearTimeout(responseTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
  return enabled ? capabilities : UNAVAILABLE;
}
