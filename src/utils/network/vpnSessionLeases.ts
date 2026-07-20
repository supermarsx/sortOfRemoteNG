import { invoke } from "@tauri-apps/api/core";
import type { VpnPreStep } from "../ssh/resolveChainConfig";

function secureLeaseAttemptId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 v4 layout for webviews that expose getRandomValues but not UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  throw new Error("Secure randomness is unavailable for VPN lease ownership");
}

/** Create a cross-webview owner so reloads cannot collide with replacements. */
export function createVpnLeaseAttemptOwnerId(
  sessionId: string,
  scope: "ssh" | "rdp",
): string {
  return `${sessionId}:${scope}:${secureLeaseAttemptId()}`;
}

export interface AcquiredVpnLease {
  vpn_type: string;
  connection_id: string;
  was_already_connected: boolean;
  already_owned: boolean;
  started_by_lifecycle: boolean;
  lease_count: number;
}

export interface AcquireVpnLeasesResult {
  owner_id: string;
  leases: AcquiredVpnLease[];
}

export interface ReleasedVpnLease {
  vpn_type: string;
  connection_id: string;
  disconnected: boolean;
  remaining_leases: number;
}

export interface ReleaseVpnLeasesResult {
  owner_id: string;
  released: ReleasedVpnLease[];
  errors: string[];
}

/**
 * Acquire an ordered VPN path as one backend transaction.  The backend owns
 * rollback, refcounts, provider readiness checks, and cross-session
 * serialization; callers must not fall back to a direct target connection if
 * this rejects.
 */
export async function acquireSessionVpnLeases(
  ownerId: string,
  steps: readonly VpnPreStep[],
): Promise<AcquireVpnLeasesResult> {
  if (steps.length === 0) {
    return { owner_id: ownerId, leases: [] };
  }

  return invoke<AcquireVpnLeasesResult>("acquire_vpn_leases", {
    ownerId,
    requests: steps.map((step) => ({
      vpn_type: step.vpnType,
      connection_id: step.connectionId,
      auto_connect: true,
    })),
  });
}

/** Release every VPN resource held by a session owner. Safe to call repeatedly. */
export async function releaseSessionVpnLeases(
  ownerId: string,
): Promise<ReleaseVpnLeasesResult> {
  return invoke<ReleaseVpnLeasesResult>("release_vpn_leases", { ownerId });
}

export function vpnLeaseCleanupError(
  result: ReleaseVpnLeasesResult,
): string | null {
  return result.errors.length > 0 ? result.errors.join("; ") : null;
}
