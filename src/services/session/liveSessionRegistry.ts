/**
 * Frontend adapter that lists backend sessions that are alive right now.
 *
 * Prefers the unified `list_live_sessions` backend command (ssh, rdp, vnc,
 * telnet, serial in one call) and falls back to the per-protocol list commands
 * (`list_sessions`, `list_rdp_sessions`) when it is unavailable. Extra sources
 * can still be plugged in through `registerLiveSessionSource`.
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
 * Unified backend registry (`list_live_sessions`): one call covers
 * ssh/rdp/vnc/telnet/serial. The payload carries no credentials and no
 * terminal/framebuffer data, but only the fields below are copied anyway.
 * Returns `null` when the command is unavailable (old backend / mocked
 * invoke) so the caller can fall back to the per-protocol list commands.
 */
export const listLiveSessionsFromRegistry = async (): Promise<
  LiveSessionDescriptor[] | null
> => {
  const raw = await invoke<unknown>("list_live_sessions");
  if (!Array.isArray(raw)) return null;
  const result: LiveSessionDescriptor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const protocol = str(entry.protocol);
    const id = str(entry.backendSessionId);
    if (!protocol || !id) continue;
    const buffer =
      entry.buffer && typeof entry.buffer === "object"
        ? (entry.buffer as Record<string, unknown>)
        : null;
    result.push({
      protocol,
      backendSessionId: id,
      // "detached" (RDP viewer gone) is still a live, adoptable session.
      alive: entry.state !== "disconnected",
      host: str(entry.target),
      port: num(entry.port),
      username: str(entry.username),
      frontendSessionId: str(entry.frontendSessionId),
      connectionId: str(entry.connectionId),
      title: str(entry.title),
      state: str(entry.state),
      ...(entry.orphan && typeof entry.orphan === "object"
        ? {
            orphan: {
              claimed:
                (entry.orphan as Record<string, unknown>).claimed === true,
              unclaimedForSecs:
                num(
                  (entry.orphan as Record<string, unknown>).unclaimedForSecs,
                ) ?? 0,
              reapInSecs:
                num((entry.orphan as Record<string, unknown>).reapInSecs) ??
                null,
            },
          }
        : {}),
      ...(buffer
        ? {
            buffer: {
              generation: num(buffer.generation) ?? 0,
              sequenceEnd: num(buffer.sequenceEnd) ?? 0,
            },
          }
        : {}),
    });
  }
  return result;
};

/**
 * Collect every live session. A failing source contributes nothing: boot must
 * never block on a backend that is not ready, and "unknown" is treated as
 * "not live" (the safe direction is a normal reconnect).
 *
 * The unified `list_live_sessions` is tried first and, when it answers,
 * replaces the per-protocol commands (one IPC call instead of several).
 *
 * Sources are queried sequentially (concurrent first-time dynamic imports of
 * the Tauri core can yield undefined under Vitest).
 */
export async function listLiveSessions(): Promise<LiveSessionDescriptor[]> {
  const all: LiveSessionDescriptor[] = [];
  let unified: LiveSessionDescriptor[] | null = null;
  try {
    unified = await listLiveSessionsFromRegistry();
  } catch {
    unified = null;
  }
  const sources: LiveSessionSource[] = [
    ...(unified ? [] : [listLiveSshSessions, listLiveRdpSessions]),
    ...extraSources,
  ];
  if (unified) all.push(...unified);
  for (const source of sources) {
    try {
      all.push(...(await source()));
    } catch {
      // unknown => not live
    }
  }
  return all;
}
