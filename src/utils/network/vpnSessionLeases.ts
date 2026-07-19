import { invoke } from "@tauri-apps/api/core";
import type { VpnPreStep } from "../ssh/resolveChainConfig";

let vpnLeaseAttemptSequence = 0;

/** Create a process-unique owner so stale async attempts cannot release a replacement. */
export function createVpnLeaseAttemptOwnerId(
  sessionId: string,
  scope: "ssh" | "rdp",
): string {
  vpnLeaseAttemptSequence += 1;
  return `${sessionId}:${scope}:${vpnLeaseAttemptSequence}`;
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
