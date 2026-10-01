import type {
  CloudSyncConfig,
  CloudSyncTarget,
} from "../../types/settings/cloudSyncSettings";
import { IndexedDbService } from "../storage/indexedDbService";
import { getInvoke } from "../tauri/invoke";
import { fullDatabaseArchiveErrorDetail } from "../connection/fullDatabaseArchive";
import { cloudSyncTargetIdentity } from "./cloudSyncActivity";
import {
  captureCloudSyncPayload,
  applyCloudSyncPayload,
  upgradeCloudSyncPayload,
  type CloudSyncPayload,
} from "./cloudSyncPayload";
import {
  decodeCloudSnapshot,
  encodeCloudSnapshot,
  syncHash,
  syncSizeLimit,
  canonicalSyncJson,
  type CloudSyncSnapshot,
} from "./cloudSyncCodec";

interface Checkpoint {
  version: 1;
  baseline: Record<string, string>;
  observedHash: string;
  localChangedAt: number;
}

export function cloudSyncTransportOptions(config: CloudSyncConfig) {
  return {
    maxBytes: syncSizeLimit(config),
    uploadLimitKbs: config.uploadLimitKBs,
    downloadLimitKbs: config.downloadLimitKBs,
  };
}

export class CloudSyncConflict extends Error {}

/** Serialize application mutations across providers, and across desktop windows. */
let queue: Promise<unknown> = Promise.resolve();
export function serializeCloudSync<T>(operation: () => Promise<T>): Promise<T> {
  const run = () =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("sorng-application-cloud-sync", operation)
      : operation();
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

async function checkpointKey(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
): Promise<string> {
  const provider =
    target.provider === "none" ? undefined : target[target.provider];
  // Credentials never enter checkpoint identities, status, or activity records.
  const destination = Object.fromEntries(
    Object.entries(provider ?? {}).filter(([key]) =>
      [
        "serverUrl",
        "host",
        "port",
        "username",
        "folderPath",
        "folderId",
        "driveId",
        "accountEmail",
      ].includes(key),
    ),
  );
  return `sorng-cloud-checkpoint-${await syncHash({ id: target.id, provider: target.provider, destination, items: [...(config.selectedItems ?? [])].sort() })}`;
}

export async function runCloudSync(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke)
    throw new Error("Application cloud sync requires the desktop backend.");
  if (!target.enabled || target.provider === "none")
    throw new Error("This cloud sync target is disabled.");
  if (!config.selectedItems?.length)
    throw new Error(
      "Choose the actual application items to sync in What to sync.",
    );
  if (config.encryptBeforeSync && !config.syncEncryptionPassword)
    throw new Error("Set a cloud sync encryption password before syncing.");
  const identity = cloudSyncTargetIdentity(target.id);
  const options = cloudSyncTransportOptions(config);
  const original = await captureCloudSyncPayload(config);
  if (!Object.keys(original.sections).length)
    throw new Error(
      "No selected items remain after applying exclusions. Nothing was transferred.",
    );
  const originalHash = await syncHash(original);
  const key = await checkpointKey(target, config);
  const saved = await IndexedDbService.getItemStrict<Checkpoint>(key);
  const checkpoint: Checkpoint =
    saved?.version === 1
      ? saved
      : {
          version: 1,
          baseline: {},
          observedHash: originalHash,
          localChangedAt: Date.now(),
        };
  if (checkpoint.observedHash !== originalHash) {
    checkpoint.observedHash = originalHash;
    checkpoint.localChangedAt = Date.now();
  }
  // Persist the observed change time even on a conflict, without application data.
  await IndexedDbService.setItemStrict(key, checkpoint);
  const remote = await invoke<{ data: string | null; revision: string | null }>(
    "cloud_sync_read",
    { target, options },
  );
  const snapshot = remote.data
    ? await decodeCloudSnapshot(remote.data, config)
    : null;
  if (snapshot)
    snapshot.payload = await upgradeCloudSyncPayload(snapshot.payload);
  if (remote.data && !remote.revision)
    throw new Error(
      "The provider did not return a safe revision for the remote snapshot.",
    );
  const combined: CloudSyncPayload = {
    version: 1,
    sections: { ...snapshot?.payload.sections },
  };
  const toApply: CloudSyncPayload = { version: 1, sections: {} };
  for (const [id, local] of Object.entries(original.sections)) {
    const remoteSection = snapshot?.payload.sections[id];
    const localHash = await syncHash(local);
    if (
      remoteSection === undefined ||
      canonicalSyncJson(remoteSection) === canonicalSyncJson(local)
    ) {
      combined.sections[id] = local;
      continue;
    }
    const remoteHash = await syncHash(remoteSection);
    const baseline = checkpoint.baseline[id];
    const localChanged = !baseline || baseline !== localHash;
    const remoteChanged = !baseline || baseline !== remoteHash;
    let chooseRemote = !localChanged && remoteChanged;
    if (localChanged && remoteChanged) {
      switch (config.conflictResolution) {
        case "keepLocal":
          chooseRemote = false;
          break;
        case "keepRemote":
          chooseRemote = true;
          break;
        case "keepNewer":
          // Snapshot upload time and first-observed local change time do not
          // establish which record causally supersedes the other (clock skew,
          // offline edits, migration and unrelated changes all invalidate it).
          throw new CloudSyncConflict(
            "Both copies changed. Timestamps cannot safely choose a winner; review and choose Keep local or Keep remote. Record-aware merging requires a shared revision baseline.",
          );
        default:
          // Independent items merge automatically; divergent edits to one item need review.
          throw new CloudSyncConflict(
            "The same application item changed locally and remotely. Review this target and choose Keep local or Keep remote.",
          );
      }
    }
    combined.sections[id] = chooseRemote ? remoteSection : local;
    if (chooseRemote) toApply.sections[id] = remoteSection;
  }
  const ensureUnchanged = async () => {
    if (identity !== cloudSyncTargetIdentity(target.id))
      throw new Error(
        "Sync target changed during the operation. Retry with its current settings.",
      );
    if (
      (await syncHash(await captureCloudSyncPayload(config))) !== originalHash
    )
      throw new CloudSyncConflict(
        "Local data changed while syncing. Retry; newer local edits were preserved.",
      );
  };
  const publish =
    !snapshot ||
    canonicalSyncJson(combined) !== canonicalSyncJson(snapshot.payload);
  let committed = false;
  try {
    if (publish) {
      const next: CloudSyncSnapshot = {
        format: "sortofremoteng-cloud-sync",
        version: 1,
        modifiedAt: Date.now(),
        payload: combined,
      };
      const data = await encodeCloudSnapshot(next, config);
      await ensureUnchanged();
      await invoke("cloud_sync_write", {
        target,
        options,
        data,
        expectedRevision: remote.revision,
      });
      committed = true;
    }
    if (Object.keys(toApply.sections).length) {
      await ensureUnchanged();
      await applyCloudSyncPayload(toApply, config, original);
      committed = true;
    }
    const finalPayload: CloudSyncPayload = {
      version: 1,
      sections: Object.fromEntries(
        Object.keys(original.sections).map((id) => [id, combined.sections[id]]),
      ),
    };
    if (
      identity !== cloudSyncTargetIdentity(target.id) ||
      (await syncHash(await captureCloudSyncPayload(config))) !==
        (await syncHash(finalPayload))
    ) {
      throw Object.assign(
        new Error(
          "Data or sync settings changed while the transfer completed. Some data may already have been saved; sync again to review the current state.",
        ),
        { kind: "partial" },
      );
    }
    const baseline = Object.fromEntries(
      await Promise.all(
        Object.entries(finalPayload.sections).map(async ([id, value]) => [
          id,
          await syncHash(value),
        ]),
      ),
    );
    await IndexedDbService.setItemStrict(key, {
      ...checkpoint,
      baseline,
      observedHash: await syncHash(finalPayload),
    });
    return publish
      ? "Selected application data uploaded and verified."
      : Object.keys(toApply.sections).length
        ? "Selected remote application data restored."
        : "Selected application data is already up to date.";
  } catch (error) {
    // An upload can succeed before a later local restore/checkpoint fails.
    // Do not present that as a wholly uncommitted operation.
    if (committed) {
      throw Object.assign(
        new Error(
          "Sync is incomplete after data was saved. Review local and remote data before retrying; no rollback was attempted." +
            fullDatabaseArchiveErrorDetail(error),
        ),
        { kind: "partial", cause: error },
      );
    }
    throw error;
  }
}
