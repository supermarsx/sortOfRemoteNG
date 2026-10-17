import type { StorageData } from "../storage/storage";

export interface CloudSyncDependencyRepairIntent {
  kind: "dependency-repair";
  /** Exact loaded source and exact object committed by the repair CAS. */
  receipt?: { before: StorageData; after: StorageData };
  uncertain?: boolean;
}

type CloudSyncBarrier = (
  ids: readonly string[],
  restore: boolean,
  intent?: CloudSyncDependencyRepairIntent,
) => Promise<() => Promise<void>>;
const barriers = new Set<CloudSyncBarrier>();

export function registerCloudSyncDatabaseBarrier(
  barrier: CloudSyncBarrier,
): () => void {
  barriers.add(barrier);
  return () => {
    barriers.delete(barrier);
  };
}

/** Short-lived provider coordination, never retained across remote I/O. */
export async function acquireCloudSyncDatabaseBarrier(
  ids: readonly string[],
  restore = false,
  intent?: CloudSyncDependencyRepairIntent,
): Promise<() => Promise<void>> {
  const releases: Array<() => Promise<void>> = [];
  const release = async () => {
    const results = await Promise.allSettled(
      releases
        .splice(0)
        .reverse()
        .map((fn) => fn()),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error(
        "Cloud sync database refresh failed. Reload before editing.",
      );
  };
  try {
    for (const barrier of barriers)
      releases.push(await barrier(ids, restore, intent));
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
