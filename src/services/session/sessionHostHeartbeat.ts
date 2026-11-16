/**
 * Frontend half of the backend orphan-grace policy.
 *
 * Each window periodically tells the backend which live sessions it holds.
 * The backend closes sessions that were claimed and then went unclaimed for
 * longer than the grace period (a crashed/reloaded UI that never came back),
 * and reports claims that no longer exist ("missing") so those tabs can be
 * shown dead instead of silently hanging.
 */

import { invoke } from "@tauri-apps/api/core";

/** Protocols whose backend sessions the registry tracks. */
const CLAIMABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  "ssh",
  "rdp",
  "vnc",
  "telnet",
  "serial",
]);

export const HEARTBEAT_INTERVAL_MS = 5_000;
/** Hidden windows still heartbeat (slower): a minimised app keeps its sessions. */
export const HEARTBEAT_HIDDEN_INTERVAL_MS = 15_000;
export const DEFAULT_SESSION_GRACE_SECONDS = 300;
const MAX_CLAIMS = 512;
const MAX_ID_BYTES = 128;

export interface SessionClaim {
  protocol: string;
  backendSessionId: string;
  frontendSessionId: string;
}

export interface HeartbeatAck {
  graceSeconds: number;
  reaperEnabled: boolean;
  heartbeatIntervalMs: number;
  missing: Array<{ protocol: string; backendSessionId: string }>;
}

interface ClaimableSession {
  id: string;
  protocol: string;
  backendSessionId?: string;
}

const withinIdLimit = (value: string): boolean =>
  new TextEncoder().encode(value).length <= MAX_ID_BYTES;

/**
 * Every backend session this window holds, hidden/background tabs included.
 * Deterministic order so an unchanged set produces an identical key.
 */
export function buildSessionClaims(
  sessions: readonly ClaimableSession[],
): SessionClaim[] {
  const seen = new Set<string>();
  const claims: SessionClaim[] = [];
  for (const session of sessions) {
    const backendSessionId = session.backendSessionId;
    if (
      !backendSessionId ||
      !CLAIMABLE_PROTOCOLS.has(session.protocol) ||
      !withinIdLimit(backendSessionId) ||
      !withinIdLimit(session.id)
    ) {
      continue;
    }
    const key = `${session.protocol}\0${backendSessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({
      protocol: session.protocol,
      backendSessionId,
      frontendSessionId: session.id,
    });
  }
  claims.sort((a, b) =>
    `${a.protocol}\0${a.backendSessionId}`.localeCompare(
      `${b.protocol}\0${b.backendSessionId}`,
    ),
  );
  return claims.slice(0, MAX_CLAIMS);
}

export const claimsKey = (claims: readonly SessionClaim[]): string =>
  claims
    .map((c) => `${c.protocol}\0${c.backendSessionId}\0${c.frontendSessionId}`)
    .join("\n");

/** 0 disables reaping; the backend clamps everything else to 30..86400. */
export function normalizeGraceSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SESSION_GRACE_SECONDS;
  }
  return Math.min(86_400, Math.max(0, Math.floor(value)));
}

function parseAck(raw: unknown): HeartbeatAck | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const missing: HeartbeatAck["missing"] = [];
  if (Array.isArray(entry.missing)) {
    for (const item of entry.missing) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      if (
        typeof m.protocol === "string" &&
        typeof m.backendSessionId === "string"
      ) {
        missing.push({
          protocol: m.protocol,
          backendSessionId: m.backendSessionId,
        });
      }
    }
  }
  return {
    graceSeconds:
      typeof entry.graceSeconds === "number" ? entry.graceSeconds : 0,
    reaperEnabled: entry.reaperEnabled === true,
    heartbeatIntervalMs:
      typeof entry.heartbeatIntervalMs === "number"
        ? entry.heartbeatIntervalMs
        : HEARTBEAT_INTERVAL_MS,
    missing,
  };
}

/** Send one heartbeat. Returns null when the backend has no such command. */
export async function sendSessionHostHeartbeat(
  claims: readonly SessionClaim[],
  graceSeconds: number,
): Promise<HeartbeatAck | null> {
  try {
    const raw = await invoke<unknown>("session_host_heartbeat", {
      sessions: claims,
      graceSeconds: normalizeGraceSeconds(graceSeconds),
    });
    return parseAck(raw);
  } catch {
    return null; // old backend or not ready: next tick retries
  }
}
