// DrayTek — invoke slice + hook (t68 D2/D3).
//
// `draytekApi` is a thin 1:1 wrapper over the `draytek_*` Tauri commands
// (contract fixed in `.orchestration/plans/t68.md` §2 D2; wired by t68-e2).
// Every command takes `id` = the live DrayTek connection id owned by the panel
// shell. Argument names are camelCase exactly matching the Rust fn params after
// the `#[tauri::command]` snake→camel conversion; the nested `config` struct
// keeps its snake_case field names (see `src/types/draytek`).

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  DraytekActionResult,
  DraytekCliVerb,
  DraytekConnectionConfig,
  DraytekConnectionSummary,
  DraytekStatus,
} from "../../../types/draytek";

/** One thin wrapper per command. `id` is always the connection id. */
export const draytekApi = {
  // ── connection lifecycle (used by the shell) ───────────────────────────
  connect: (id: string, config: DraytekConnectionConfig) =>
    invoke<DraytekConnectionSummary>("draytek_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("draytek_disconnect", { id }),
  ping: (id: string) =>
    invoke<DraytekConnectionSummary>("draytek_ping", { id }),
  listConnections: () => invoke<string[]>("draytek_list_connections"),

  // ── status ─────────────────────────────────────────────────────────────
  getStatus: (id: string) =>
    invoke<DraytekStatus>("draytek_get_status", { id }),

  // ── actions (state-changing: the UI confirms before calling) ───────────
  reboot: (id: string) => invoke<DraytekActionResult>("draytek_reboot", { id }),
  runCli: (id: string, verb: DraytekCliVerb) =>
    invoke<DraytekActionResult>("draytek_run_cli", { id, verb }),
} as const;

export type DraytekApi = typeof draytekApi;

/** Shared `loading` / `error` request lifecycle for the sub-tabs (mirror of
 *  `usePfsenseServices`). Section view-state stays in the component. */
export function useDraytek() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Run an api call with shared loading/error handling. Returns the resolved
   *  value, or `undefined` if the call threw (the error is captured in state). */
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { api: draytekApi, loading, error, setError, clearError, run };
}

export type UseDraytek = ReturnType<typeof useDraytek>;

/** Build the device's web-admin base URL from the connection fields. */
export function buildDraytekWebUiUrl(device: {
  host: string;
  port: number;
  useTls: boolean;
}): string {
  const scheme = device.useTls ? "https" : "http";
  const defaultPort = device.useTls ? 443 : 80;
  const hostPart =
    device.host.includes(":") && !device.host.startsWith("[")
      ? `[${device.host}]`
      : device.host;
  const portPart = device.port === defaultPort ? "" : `:${device.port}`;
  return `${scheme}://${hostPart}${portPart}/`;
}

/** DrayOS login is a GET/POST to `/cgi-bin/wlogin.cgi` with `aa`=base64(user)
 *  and `ab`=base64(pass) (plan §1). This builds the best-effort pre-authenticated
 *  URL used when the admin opts in on "Open Web UI"; ≥4.4 firmware with
 *  `sFormAuthStr`/RSA will ignore it and show the normal login instead. */
export function buildDraytekAutoLoginUrl(
  baseUrl: string,
  username: string,
  password: string,
): string {
  const b64 = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const aa = encodeURIComponent(b64(username));
  const ab = encodeURIComponent(b64(password));
  return `${baseUrl.replace(/\/+$/, "")}/cgi-bin/wlogin.cgi?aa=${aa}&ab=${ab}`;
}
