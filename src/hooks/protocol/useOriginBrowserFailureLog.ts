import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserState } from "./useOriginBrowser";

let nextSample = 0;

/** Fixed metadata only. Never send a browser URL, owner ID or error message. */
export function browserClientFailure(state: OriginBrowserState) {
  if (state.configurationFailure?.issues.length)
    return state.configurationFailure.issues.map((issue) => ({
      kind: "configuration" as const,
      issue,
    }));
  if (state.operationFailure)
    return [{ kind: "operation" as const, operation: state.operationFailure }];
  const startup = state.startupFailure;
  // Known native failures are logged at their native source, with route detail.
  // These cases exist only in the shell (IPC, deadline, local owner proof).
  if (
    startup &&
    (!startup.code ||
      ["start-timeout", "attempt-limit", "owner-proof"].includes(startup.code))
  )
    return [
      {
        kind: "startup" as const,
        stage: startup.stage,
        category: startup.category,
        ...(startup.code ? { code: startup.code } : {}),
      },
    ];
  return [];
}

export function useOriginBrowserFailureLog(
  state: OriginBrowserState,
  scope: string,
) {
  const [sample] = useState(
    () => (nextSample = Math.min(nextSample + 1, 0xffff_ffff)),
  );
  const last = useRef("");
  const failures = browserClientFailure(state);
  const serialized = JSON.stringify(failures);
  useEffect(() => {
    const key = JSON.stringify([scope, serialized]);
    if (last.current === key) return;
    last.current = key;
    for (const failure of JSON.parse(serialized) as ReturnType<
      typeof browserClientFailure
    >) {
      // Diagnostics cannot change browser state or recursively report a logger failure.
      try {
        void Promise.resolve(
          invoke("application_logs_browser_failure", {
            event: { sample, failure, timestampUnixMs: Date.now() },
          }),
        ).catch(() => {});
      } catch {
        // The IPC bridge may also be unavailable synchronously during teardown.
      }
    }
  }, [sample, scope, serialized]);
}
