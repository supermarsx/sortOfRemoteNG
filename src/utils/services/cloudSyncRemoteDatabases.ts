import type { ConnectionDatabase } from "../../types/connection/connection";
import type { DatabaseProtectionTarget } from "../../types/encryption/databaseProtection";
import type {
  CloudSyncConfig,
  CloudSyncTarget,
} from "../../types/settings/cloudSyncSettings";
import { DatabaseManager } from "../connection/databaseManager";
import { FullDatabaseRestoreIncompleteError } from "../connection/fullDatabaseArchive";
import { getInvoke } from "../tauri/invoke";
import {
  beginCloudSyncActivity,
  cloudSyncTargetIdentity,
} from "./cloudSyncActivity";
import {
  canonicalSyncJson,
  decodeCloudSnapshot,
  syncHash,
} from "./cloudSyncCodec";
import {
  cloudSyncTransportOptions,
  serializeCloudSync,
} from "./cloudSyncEngine";
import { upgradeCloudSyncPayload } from "./cloudSyncPayload";

export interface RemoteDatabaseCatalog {
  targetId: string;
  requestIdentity: symbol;
  revision: string | null;
  snapshotHash: string | null;
  modifiedAt: number | null;
  databases: Array<{
    id: string;
    label: string;
    nameAvailable: boolean;
    bytes: number;
    existsLocally: boolean;
  }>;
}

interface Source {
  target: CloudSyncTarget;
  config: CloudSyncConfig;
  identity: symbol;
}
interface Receipt extends Source {
  revision: string | null;
  snapshotHash: string | null;
  ids: Set<string>;
}
// Receipts are transient, bound to this inspection, and contain no archive data.
// A caller cannot manufacture or edit a catalog to authorize an unreviewed pull.
const receipts = new WeakMap<RemoteDatabaseCatalog, Receipt>();

function sourceSettings(target: CloudSyncTarget, config: CloudSyncConfig) {
  return {
    id: target.id,
    enabled: target.enabled,
    provider: target.provider,
    destination: target.provider === "none" ? null : target[target.provider],
    syncEnabled: config.enabled,
    encrypted: config.encryptBeforeSync,
    password: config.syncEncryptionPassword,
    maxFileSizeMB: config.maxFileSizeMB,
    downloadLimitKBs: config.downloadLimitKBs,
  };
}

/** In-memory comparison only; never log or persist these credential-bearing values. */
export function sameRemoteDatabaseSource(
  targetA: CloudSyncTarget,
  configA: CloudSyncConfig,
  targetB: CloudSyncTarget,
  configB: CloudSyncConfig,
): boolean {
  return (
    canonicalSyncJson(sourceSettings(targetA, configA)) ===
    canonicalSyncJson(sourceSettings(targetB, configB))
  );
}

function source(target: CloudSyncTarget, config: CloudSyncConfig): Source {
  return {
    target: structuredClone(target),
    config: structuredClone(config),
    identity: cloudSyncTargetIdentity(target.id),
  };
}

function guard(request: Source, assertCurrent?: () => void) {
  return () => {
    assertCurrent?.();
    if (request.identity !== cloudSyncTargetIdentity(request.target.id))
      throw new Error(
        "Sync settings changed. Refresh Remote databases before pulling.",
      );
    if (!request.target.enabled || request.target.provider === "none")
      throw new Error(
        "Enable and configure a sync target before browsing its remote databases.",
      );
  };
}

async function localDatabases() {
  try {
    return await DatabaseManager.getInstance().getAllDatabases();
  } catch {
    throw new Error(
      "The local database list could not be read. Reload Databases before pulling; existing data was not replaced.",
    );
  }
}

async function read(request: Source, check: () => void) {
  check();
  const invoke = await getInvoke();
  check();
  if (!invoke)
    throw new Error("Remote database downloads require the desktop backend.");
  const options = cloudSyncTransportOptions(request.config);
  let remote: { data: string | null; revision: string | null };
  try {
    remote = await invoke("cloud_sync_read", {
      target: request.target,
      options,
    });
  } catch {
    // Provider errors can contain URLs, usernames or tokens. Do not expose them.
    throw new Error(
      "Could not read this target's sync snapshot. Check its connection settings and access permissions, then refresh.",
    );
  }
  check();
  if (
    !remote ||
    (remote.data !== null && typeof remote.data !== "string") ||
    (remote.data !== null &&
      (typeof remote.revision !== "string" || !remote.revision))
  )
    throw new Error(
      "The target did not return a valid snapshot revision. Refresh before pulling.",
    );
  if (remote.data === null)
    return { snapshot: null, revision: null, hash: null };
  let snapshot;
  try {
    snapshot = await decodeCloudSnapshot(remote.data, request.config);
    // Explicit pull keeps and hashes exact capsule bytes. Native import performs
    // authentication in its atomic commit; this does not authorize sync merging.
    snapshot.payload = await upgradeCloudSyncPayload(
      snapshot.payload,
      "atomic-restore",
    );
  } catch {
    throw new Error(
      "Could not decrypt or validate the remote snapshot. Use the same cloud encryption password as the source device and check Maximum Sync Snapshot Size. No local or remote data was changed.",
    );
  }
  check();
  if (
    !request.config.encryptBeforeSync &&
    Object.keys(snapshot.payload.sections).some((id) =>
      id.startsWith("database:"),
    )
  )
    throw new Error(
      "Remote databases must be stored in an encrypted sync snapshot. Enable Encrypt Before Sync on the source device and sync again.",
    );
  const hash = await syncHash(snapshot);
  check();
  return { snapshot, revision: remote.revision, hash };
}

/** Reads the target's snapshot even on a new device with no local selections. */
export async function discoverRemoteDatabases(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
  assertCurrent?: () => void,
): Promise<RemoteDatabaseCatalog> {
  const request = source(target, config);
  const check = guard(request, assertCurrent);
  const finish = beginCloudSyncActivity({
    ...target,
    requestIdentity: request.identity,
  });
  try {
    return await serializeCloudSync(async () => {
      const { snapshot, revision, hash } = await read(request, check);
      const local = await localDatabases();
      check();
      const databases: RemoteDatabaseCatalog["databases"] = [];
      for (const [key, archive] of Object.entries(
        snapshot?.payload.sections ?? {},
      )) {
        if (!key.startsWith("database:")) continue;
        const id = key.slice(9);
        const existing = local.find((db) => db.id === id);
        const name = snapshot?.databaseNames?.[id];
        databases.push({
          id,
          label: existing?.name || name || `Database ${id}`,
          nameAvailable: Boolean(existing?.name || name),
          bytes: new TextEncoder().encode(JSON.stringify(archive)).byteLength,
          existsLocally: Boolean(existing),
        });
      }
      const catalog: RemoteDatabaseCatalog = {
        targetId: target.id,
        requestIdentity: request.identity,
        revision,
        snapshotHash: hash,
        modifiedAt: snapshot?.modifiedAt ?? null,
        databases,
      };
      receipts.set(catalog, {
        ...request,
        revision,
        snapshotHash: hash,
        ids: new Set(databases.map((db) => db.id)),
      });
      return catalog;
    });
  } finally {
    finish();
  }
}

/** Explicit restore, not bidirectional sync: neither discovery nor pull uploads. */
export async function pullRemoteDatabase(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
  catalog: RemoteDatabaseCatalog,
  databaseId: string,
  options: {
    name: string;
    protectionTarget: DatabaseProtectionTarget;
    confirmDeviceBoundOnly?: boolean;
    assertCurrent?: () => void;
  },
): Promise<ConnectionDatabase> {
  const receipt = receipts.get(catalog);
  if (
    !receipt ||
    !receipt.ids.has(databaseId) ||
    !sameRemoteDatabaseSource(receipt.target, receipt.config, target, config)
  )
    throw new Error(
      "Refresh Remote databases and select the database again before pulling.",
    );
  const check = guard(receipt, options.assertCurrent);
  const localOptions = structuredClone({
    name: options.name,
    protectionTarget: options.protectionTarget,
    confirmDeviceBoundOnly: options.confirmDeviceBoundOnly,
  });
  const finish = beginCloudSyncActivity({
    ...target,
    requestIdentity: receipt.identity,
  });
  try {
    return await serializeCloudSync(async () => {
      const { snapshot, revision, hash } = await read(receipt, check);
      if (
        !snapshot ||
        revision !== receipt.revision ||
        hash !== receipt.snapshotHash
      )
        throw new Error(
          "The cloud snapshot changed since it was listed. Refresh Remote databases and review the latest copy before pulling.",
        );
      const manager = DatabaseManager.getInstance();
      const existing = await localDatabases();
      check();
      if (existing.some((db) => db.id === databaseId))
        throw new Error(
          "This database is already on this device. Use normal sync or conflict review to update it; pulling will not overwrite it.",
        );
      try {
        return await manager.importCloudSyncDatabase(
          snapshot.payload.sections[`database:${databaseId}`],
          {
            ...localOptions,
            assertCurrent: check,
            browserSessionsPassword: receipt.config.syncEncryptionPassword,
          },
        );
      } catch (error) {
        if (error instanceof FullDatabaseRestoreIncompleteError) throw error;
        // Preserve deliberate cancellation messages without forwarding arbitrary
        // native I/O errors (which can include credential-bearing paths).
        check();
        throw new Error(
          "The database could not be fully created. Check its local unlock protection and the database list before retrying; any data already created was retained.",
        );
      }
    });
  } finally {
    finish();
  }
}
