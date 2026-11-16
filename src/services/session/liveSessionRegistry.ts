/**
 * Frontend adapter that lists backend sessions that are alive right now.
 *
 * Today it composes the per-protocol list commands that already exist
 * (`list_sessions` for SSH, `list_rdp_sessions` for RDP). A unified backend
 * registry command can be plugged in later through `registerLiveSessionSource`
 * without touching callers.
 *
 * Only non-secret fields are copied out: the SSH list payload carries the full
 * connection config (including credentials) over IPC, and none of that may
 * leave this module.
 */

import { invoke } from "@tauri-apps/api/core";
import type { LiveSessionDescriptor } from "./reconcileWorkspace";

export type LiveSessionSource = () => Promise<LiveSessionDescriptor[]>;

const extraSources = new Set<LiveSessionSource>();

/** Plug in an additional source (e.g. a future `list_live_sessions`). */
export function registerLiveSessionSource(
  source: LiveSessionSource,
): () => void {
  extraSources.add(source);
  return () => {
    extraSources.delete(source);
  };
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const listLiveSshSessions: LiveSessionSource = async () => {
  const raw = await invoke<unknown>("list_sessions");
  if (!Array.isArray(raw)) return [];
  const result: LiveSessionDescriptor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = str(entry.id);
    if (!id) continue;
    const config = (entry.config ?? {}) as Record<string, unknown>;
    result.push({
      protocol: "ssh",
      backendSessionId: id,
      alive: entry.is_alive !== false,
      host: str(config.host),
      port: num(config.port),
      username: str(config.username),
    });
  }
  return result;
};

export const listLiveRdpSessions: LiveSessionSource = async () => {
  const raw = await invoke<unknown>("list_rdp_sessions");
  if (!Array.isArray(raw)) return [];
  const result: LiveSessionDescriptor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = str(entry.id);
    if (!id) continue;
    result.push({
      protocol: "rdp",
      backendSessionId: id,
      alive: entry.connected !== false,
      host: str(entry.host),
      port: num(entry.port),
      connectionId: str(entry.connectionId),
    });
  }
  return result;
};

/**
 * Collect every live session. A failing source contributes nothing: boot must
 * never block on a backend that is not ready, and "unknown" is treated as
 * "not live" (the safe direction is a normal reconnect).
 *
 * Sources are queried sequentially (concurrent first-time dynamic imports of
 * the Tauri core can yield undefined under Vitest).
 */
export async function listLiveSessions(): Promise<LiveSessionDescriptor[]> {
  const sources: LiveSessionSource[] = [
    listLiveSshSessions,
    listLiveRdpSessions,
    ...extraSources,
  ];
  const all: LiveSessionDescriptor[] = [];
  for (const source of sources) {
    try {
      all.push(...(await source()));
    } catch {
      // unknown => not live
    }
  }
  return all;
}
