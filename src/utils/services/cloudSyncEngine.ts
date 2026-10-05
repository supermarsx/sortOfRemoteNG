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
  discoverCloudSyncItems,
  type CloudSyncPayload,
} from "./cloudSyncPayload";
import {
  decodeCloudSnapshot,
  encodeCloudSnapshot,
  syncHash,
  syncSizeLimit,
  canonicalSyncJson,
  isCloudDatabaseName,
  type CloudSyncSnapshot,
} from "./cloudSyncCodec";
import {
  buildSmartSyncBaseline,
  smartMergeSyncSection,
  type SmartSyncBaseline,
} from "./cloudSyncSmartMerge";
import type {
  CloudSyncConflictReview,
  CloudSyncReviewedResolution,
  CloudSyncReviewItem,
} from "./cloudSyncConflictReview";
import { summarizeCloudSyncReview } from "./cloudSyncReviewDetails";

interface Checkpoint {
  version: 1;
  baseline: Record<string, string>;
  observedHash: string;
  localChangedAt: number;
  smartBaseline?: Record<string, SmartSyncBaseline>;
}

export function cloudSyncTransportOptions(config: CloudSyncConfig) {
  return {
    maxBytes: syncSizeLimit(config),
    uploadLimitKbs: config.uploadLimitKBs,
    downloadLimitKbs: config.downloadLimitKBs,
  };
}

export class CloudSyncConflict extends Error {
  readonly kind = "conflict";
}

class LocalSyncEdit extends CloudSyncConflict {
  constructor() {
    super(
      "Local data changed while syncing. Newer local edits were preserved. Open Cloud Sync → Conflict Resolution to review the current copies, or retry when editing has paused.",
    );
  }
}

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

async function checkpointKeys(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
): Promise<{ key: string; legacyKey: string }> {
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
  const identity = { id: target.id, provider: target.provider, destination };
  return {
    key: `sorng-cloud-checkpoint-v2-${await syncHash(identity)}`,
    legacyKey: `sorng-cloud-checkpoint-${await syncHash({ ...identity, items: [...(config.selectedItems ?? [])].sort() })}`,
  };
}

async function readSyncState(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
  readOnly = false,
  identity = cloudSyncTargetIdentity(target.id),
  allowAutoUnlock = !readOnly,
) {
  const ensureIdentity = () => {
    if (identity !== cloudSyncTargetIdentity(target.id))
      throw new CloudSyncConflict(
        "Sync target changed during the operation. Retry with its current settings.",
      );
  };
  ensureIdentity();
  const invoke = await getInvoke();
  ensureIdentity();
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
  const options = cloudSyncTransportOptions(config);
  const original = await captureCloudSyncPayload(config, {
    allowAutoUnlock,
    assertCurrent: ensureIdentity,
  });
  ensureIdentity();
  if (!Object.keys(original.sections).length)
    throw new Error(
      "No selected items remain after applying exclusions. Nothing was transferred.",
    );
  const originalHash = await syncHash(original);
  const { key, legacyKey } = await checkpointKeys(target, config);
  const saved = await IndexedDbService.getItemStrict<Checkpoint>(key);
  // Old keys hash the complete selection, so only this exact legacy scope can
  // be identified safely. Import its missing items, never overwrite a newer
  // destination checkpoint or guess a different selection/destination by date.
  const legacy = await IndexedDbService.getItemStrict<Checkpoint>(legacyKey);
  const checkpoint: Checkpoint =
    saved?.version === 1
      ? saved
      : {
          version: 1,
          baseline: {},
          observedHash: originalHash,
          localChangedAt: Date.now(),
        };
  if (legacy?.version === 1) {
    for (const id of Object.keys(original.sections)) {
      if (checkpoint.baseline[id] || !legacy.baseline[id]) continue;
      checkpoint.baseline[id] = legacy.baseline[id];
      if (checkpoint.smartBaseline) delete checkpoint.smartBaseline[id];
      if (legacy.smartBaseline?.[id]) {
        checkpoint.smartBaseline ??= {};
        checkpoint.smartBaseline[id] = legacy.smartBaseline[id];
      }
    }
  }
  if (checkpoint.observedHash !== originalHash) {
    checkpoint.observedHash = originalHash;
    checkpoint.localChangedAt = Date.now();
  }
  // Persist the observed change time even on a conflict, without application data.
  ensureIdentity();
  if (!readOnly) await IndexedDbService.setItemStrict(key, checkpoint);
  ensureIdentity();
  const remote = await invoke<{ data: string | null; revision: string | null }>(
    "cloud_sync_read",
    { target, options },
  );
  ensureIdentity();
  const snapshot = remote.data
    ? await decodeCloudSnapshot(remote.data, config)
    : null;
  if (snapshot)
    snapshot.payload = await upgradeCloudSyncPayload(snapshot.payload);
  if (remote.data && !remote.revision)
    throw new Error(
      "The provider did not return a safe revision for the remote snapshot.",
    );
  const ensureUnchanged = async () => {
    ensureIdentity();
    const currentHash = await syncHash(
      await captureCloudSyncPayload(config, {
        allowAutoUnlock: false,
        assertCurrent: ensureIdentity,
      }),
    );
    ensureIdentity();
    if (currentHash !== originalHash) throw new LocalSyncEdit();
  };
  await ensureUnchanged();
  // Bind review choices to both copies, the baseline, and the selected scope.
  // No record contents, credentials, or unencrypted backups enter the receipt.
  const reviewKey = await syncHash({
    key,
    items: [...config.selectedItems].sort(),
    originalHash,
    remoteRevision: remote.revision,
    remoteHash: snapshot ? await syncHash(snapshot.payload) : null,
    baseline: checkpoint.baseline,
    smartBaseline: checkpoint.smartBaseline ?? {},
    exclusions: config.excludePatterns,
    encrypted: config.encryptBeforeSync,
    autoUnlockOsVaultDatabases: config.autoUnlockOsVaultDatabases === true,
  });
  return {
    invoke,
    identity,
    options,
    original,
    originalHash,
    key,
    checkpoint,
    remote,
    snapshot,
    ensureUnchanged,
    ensureIdentity,
    reviewKey,
  };
}

type SyncState = Awaited<ReturnType<typeof readSyncState>>;

async function planSync(
  state: SyncState,
  config: CloudSyncConfig,
  resolution?: CloudSyncReviewedResolution,
  reviewOnly = false,
) {
  const { original, snapshot, checkpoint } = state;
  const combined: CloudSyncPayload = {
    version: 1,
    sections: { ...snapshot?.payload.sections },
  };
  const toApply: CloudSyncPayload = { version: 1, sections: {} };
  const items: CloudSyncReviewItem[] = [];
  const unresolved: string[] = [];
  for (const [id, local] of Object.entries(original.sections)) {
    const remoteSection = snapshot?.payload.sections[id];
    const localHash = await syncHash(local);
    const remoteHash =
      remoteSection === undefined ? undefined : await syncHash(remoteSection);
    const baseline = checkpoint.baseline[id];
    const localChanged = !baseline || baseline !== localHash;
    const remoteChanged = !baseline || baseline !== remoteHash;
    const equal = localHash === remoteHash;
    const conflict =
      remoteSection !== undefined && !equal && localChanged && remoteChanged;
    const item: CloudSyncReviewItem = {
      id,
      label: id.startsWith("database:")
        ? "Database"
        : ({
            "app:settings": "Appearance preferences",
            "app:recording.managed-scripts": "Saved terminal scripts",
            "app:recording.terminal-macros": "Terminal macros",
            "app:recording.web-automation.v1": "Website scripts and macros",
          }[id] ?? "App-wide documents"),
      state: equal
        ? "same"
        : conflict
          ? "conflict"
          : remoteSection !== undefined && !localChanged
            ? "remote"
            : "local",
      localBytes: new TextEncoder().encode(canonicalSyncJson(local)).byteLength,
      remoteBytes:
        remoteSection === undefined
          ? 0
          : new TextEncoder().encode(canonicalSyncJson(remoteSection))
              .byteLength,
      smartMergeAvailable: false,
    };
    if (reviewOnly)
      item.details = summarizeCloudSyncReview(
        id,
        local,
        remoteSection,
        Boolean(
          checkpoint.smartBaseline?.[id] &&
          !checkpoint.smartBaseline[id].disabled,
        ),
        snapshot?.modifiedAt,
      );
    items.push(item);
    let chosen = item.state === "remote" ? remoteSection : local;
    if (conflict) {
      let merged: unknown;
      if (
        reviewOnly ||
        config.conflictResolution === "smartMerge" ||
        resolution?.choices[id] === "smartMerge"
      ) {
        const result = await smartMergeSyncSection(
          local,
          remoteSection,
          checkpoint.smartBaseline?.[id],
        );
        item.reason = result.reason;
        item.conflicts = result.conflicts;
        if (result.conflictCount === 0 && result.value !== undefined) {
          try {
            // Validate archive references, attachments and ledger invariants
            // before either side is written. A structurally unsafe merge is a
            // review conflict, never a best-effort partial archive.
            const checked = await upgradeCloudSyncPayload({
              version: 1,
              sections: { [id]: result.value },
            });
            merged = checked.sections[id];
            item.smartMergeAvailable = true;
          } catch {
            item.reason =
              "The combined records have incompatible dependencies or metadata. Choose a complete copy after reviewing it locally.";
            item.conflicts = [
              { code: "dependencies", kind: "other", count: 1 },
            ];
          }
        }
      }
      const strategy = reviewOnly
        ? "askEveryTime"
        : resolution
          ? resolution.choices[id]
          : config.conflictResolution;
      switch (strategy) {
        case "keepLocal":
          chosen = local;
          break;
        case "keepRemote":
          chosen = remoteSection;
          break;
        case "smartMerge":
          if (item.smartMergeAvailable) chosen = merged;
          else
            unresolved.push(
              item.reason ??
                "Conflicting records need review; smart merge will not guess a winner.",
            );
          break;
        case "keepNewer":
          // Snapshot upload time and first-observed local change time do not
          // establish which record causally supersedes the other (clock skew,
          // offline edits, migration and unrelated changes all invalidate it).
          unresolved.push(
            "Both copies changed. Timestamps cannot safely choose a winner. Open Cloud Sync → Conflict Resolution to review this target.",
          );
          break;
        default:
          // Independent items merge automatically; divergent edits to one item need review.
          unresolved.push(
            "The same application item changed locally and remotely. Open Cloud Sync → Conflict Resolution, review this target, and choose a copy or a safe smart merge.",
          );
      }
    }
    combined.sections[id] = chosen;
    if (canonicalSyncJson(chosen) !== canonicalSyncJson(local))
      toApply.sections[id] = chosen;
  }
  return { combined, toApply, items, unresolved };
}

/** Fresh, read-only review. Decrypted records are discarded on return. */
export async function reviewCloudSync(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
  requestIdentity = cloudSyncTargetIdentity(target.id),
): Promise<CloudSyncConflictReview> {
  const state = await readSyncState(target, config, true, requestIdentity);
  const { items } = await planSync(state, config, undefined, true);
  const inventory = await discoverCloudSyncItems({ includeSizes: false });
  for (const item of items)
    item.label =
      inventory.find((entry) => entry.id === item.id)?.label ?? item.label;
  await state.ensureUnchanged();
  return {
    targetId: target.id,
    requestIdentity: state.identity,
    reviewKey: state.reviewKey,
    items,
  };
}

async function syncAttempt(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
  resolution?: CloudSyncReviewedResolution,
  requestIdentity = cloudSyncTargetIdentity(target.id),
  allowAutoUnlock = true,
): Promise<string> {
  const state = await readSyncState(
    target,
    config,
    false,
    requestIdentity,
    allowAutoUnlock && !resolution,
  );
  const {
    invoke,
    identity,
    options,
    original,
    key,
    checkpoint,
    remote,
    snapshot,
    ensureUnchanged,
    ensureIdentity,
  } = state;
  if (
    resolution &&
    (resolution.review.targetId !== target.id ||
      resolution.review.requestIdentity !== identity ||
      resolution.review.reviewKey !== state.reviewKey)
  )
    throw new CloudSyncConflict(
      "The reviewed local data, cloud copy, or sync settings changed. Refresh the conflict review and choose again; no reviewed choices were applied.",
    );
  const { combined, toApply, unresolved } = await planSync(
    state,
    config,
    resolution,
  );
  await ensureUnchanged();
  if (unresolved.length) throw new CloudSyncConflict(unresolved[0]);
  const publish =
    !snapshot ||
    canonicalSyncJson(combined) !== canonicalSyncJson(snapshot.payload);
  let committed = false;
  try {
    if (publish) {
      // Carry display names separately: index labels must not change database
      // record hashes or rename an existing local database during normal sync.
      const databaseNames = { ...snapshot?.databaseNames };
      if (
        Object.keys(original.sections).some((id) => id.startsWith("database:"))
      ) {
        const inventory = await discoverCloudSyncItems({ includeSizes: false });
        for (const item of inventory) {
          if (
            item.id.startsWith("database:") &&
            Object.prototype.hasOwnProperty.call(original.sections, item.id) &&
            isCloudDatabaseName(item.label)
          )
            databaseNames[item.id.slice(9)] = item.label;
        }
      }
      const next: CloudSyncSnapshot = {
        format: "sortofremoteng-cloud-sync",
        version: 1,
        modifiedAt: Date.now(),
        payload: combined,
        ...(Object.keys(databaseNames).length ? { databaseNames } : {}),
      };
      const data = await encodeCloudSnapshot(next, config);
      await ensureUnchanged();
      ensureIdentity();
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
      ensureIdentity();
      await applyCloudSyncPayload(toApply, config, original);
      committed = true;
    }
    const finalPayload: CloudSyncPayload = {
      version: 1,
      sections: Object.fromEntries(
        Object.keys(original.sections).map((id) => [id, combined.sections[id]]),
      ),
    };
    const matchesFinalPayload = async () => {
      ensureIdentity();
      const actual = await syncHash(
        await captureCloudSyncPayload(config, {
          allowAutoUnlock: false,
          assertCurrent: ensureIdentity,
        }),
      );
      const expected = await syncHash(finalPayload);
      ensureIdentity();
      return actual === expected;
    };
    if (!(await matchesFinalPayload())) {
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
    const smartBaseline = Object.fromEntries(
      await Promise.all(
        Object.entries(finalPayload.sections).map(
          async ([id, value]): Promise<
            [string, SmartSyncBaseline | undefined]
          > => [
            id,
            checkpoint.baseline[id] === baseline[id] &&
            checkpoint.smartBaseline?.[id]
              ? checkpoint.smartBaseline[id]
              : await buildSmartSyncBaseline(value),
          ],
        ),
      ),
    );
    const retainedSmartBaseline = { ...checkpoint.smartBaseline };
    // A selected item's new content baseline invalidates its previous index,
    // even when no replacement index was produced. Keep only unselected ones.
    for (const id of Object.keys(baseline)) delete retainedSmartBaseline[id];
    for (const [id, value] of Object.entries(smartBaseline))
      if (value !== undefined) retainedSmartBaseline[id] = value;
    if (!(await matchesFinalPayload()))
      throw Object.assign(
        new Error(
          "Data changed while sync verification completed. Newer edits were preserved; review this target before retrying.",
        ),
        { kind: "partial" },
      );
    const observedHash = await syncHash(finalPayload);
    ensureIdentity();
    await IndexedDbService.setItemStrict(key, {
      ...checkpoint,
      // Unselected/excluded artifacts retain their last successful baseline.
      baseline: { ...checkpoint.baseline, ...baseline },
      smartBaseline: retainedSmartBaseline,
      observedHash,
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

export async function runCloudSync(
  target: CloudSyncTarget,
  config: CloudSyncConfig,
  resolution?: CloudSyncReviewedResolution,
  requestIdentity = cloudSyncTargetIdentity(target.id),
): Promise<string> {
  // A normal edit during a slow read is not a data conflict. Re-capture and
  // re-plan once, but never replay explicit review decisions or partial writes.
  for (let attempt = 0; ; attempt++) {
    try {
      return await syncAttempt(
        target,
        config,
        resolution,
        requestIdentity,
        attempt === 0,
      );
    } catch (error) {
      if (!(error instanceof LocalSyncEdit) || resolution || attempt >= 1)
        throw error;
    }
  }
}
