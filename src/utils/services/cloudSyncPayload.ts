import {
  MAX_CLOUD_SYNC_FILE_SIZE_MIB,
  type CloudSyncConfig,
} from "../../types/settings/cloudSyncSettings";
import { DatabaseManager } from "../connection/databaseManager";
import { singleOsVaultUnlockSlot } from "../connection/databaseUnlockMethods";
import type { EncryptionStatus } from "../../types/encryption/encryption";
import { acquireCloudSyncDatabaseBarrier } from "./cloudSyncDatabaseBarrier";
import { utf8Bytes } from "./cloudSyncInventorySize";
import { readDatabaseSizes } from "../connection/databaseSize";
import {
  APP_DOCUMENTS_STORE_KEY,
  appDocumentsStore,
} from "../documents/appDocumentsStore";
import type { DatabaseDocuments } from "../../types/documents/document";
import { normalizeDatabaseDocuments } from "../documents/validation";
import { verifyDocumentAttachments } from "../documents/documentAttachments";
import { nativeManagedScriptsStore } from "../recording/managedScriptPersistence";
import {
  terminalMacrosStore,
  validateTerminalMacros,
} from "../recording/terminalMacroPersistence";
import {
  webAutomationStore,
  normalizeWebAutomationLibrary,
} from "../recording/webAutomationLibrary";
import {
  fullDatabaseArchiveErrorDetail,
  FullDatabaseArchiveError,
  normalizeFullDatabaseArchive,
  fullDatabaseArchiveData,
  type FullDatabaseArchive,
} from "../connection/fullDatabaseArchive";
import { getInvoke } from "../tauri/invoke";
import { SettingsManager } from "../settings/settingsManager";
import { normalizeManagedScript } from "../recording/automationLibraryValidation";
import { normalizeAutomationProvenanceMap } from "../recording/automationProvenance";
import { normalizeTerminalLibraryMigrationReceipt } from "../recording/terminalLibraryMigrationReceipt";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
} from "../storage/recordLedger";

// Presentation only. Never sync network/authentication policy, paths or identifiers.
const preferenceTypes: Record<string, "string" | "boolean" | "number"> = {
  language: "string",
  theme: "string",
  colorScheme: "string",
  animationsEnabled: "boolean",
  sidebarWidth: "number",
};
function portableSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) =>
        preferenceTypes[key] === typeof entry &&
        (typeof entry !== "string" || entry.length <= 64) &&
        (typeof entry !== "number" ||
          (Number.isFinite(entry) && entry >= 0 && entry <= 4096)),
    ),
  );
}

export interface CloudSyncItem {
  id: string;
  label: string;
  kind: string;
  available: boolean;
  unavailableReason?: string;
  /** Manual unlock action only for an existing, unavailable native database. */
  unlockDatabaseId?: string;
  bytes?: number;
  sizeKind?:
    | "archive-estimate"
    | "portable-settings"
    | "stored-json"
    | "stored-encrypted"
    | "stored-file";
  sizeUnavailableReason?: string;
  sizeStatus?: "measured" | "missing" | "unavailable";
  sensitive?: boolean;
}
export type CloudSyncPayload = {
  version: 1;
  sections: Record<string, unknown>;
};

export class CloudSyncPartialApplyError extends Error {
  readonly kind = "partial";
  constructor(public readonly cause?: unknown) {
    super(
      "Cloud apply is incomplete: some artifacts were saved. Inspect local data before retrying; no rollback was attempted." +
        fullDatabaseArchiveErrorDetail(cause),
    );
    this.name = "CloudSyncPartialApplyError";
  }
}

// These IDs own durable app-wide stores. Database-owned documents/automation
// belong to database:<id>; selections must keep their original source scope.
const appDocumentsId = `app:${APP_DOCUMENTS_STORE_KEY}`;
const libraries = [
  {
    id: "app:recording.managed-scripts",
    label: "Saved terminal scripts",
    previousScope: "legacy application-wide",
    store: nativeManagedScriptsStore,
    command: "read_app_data",
  },
  {
    id: "app:recording.terminal-macros",
    label: "Terminal macros",
    previousScope: "legacy application-wide",
    store: terminalMacrosStore,
    command: "read_macro_library",
  },
  {
    id: "app:recording.web-automation.v1",
    label: "Website scripts and macros",
    previousScope: "application-wide",
    store: webAutomationStore,
    command: "read_macro_library",
  },
  {
    id: appDocumentsId,
    label: "Documents",
    previousScope: "App-wide",
    store: appDocumentsStore,
    command: "read_app_data",
  },
] as const;
const databaseId = (id: string) =>
  id.startsWith("database:") ? id.slice(9) : undefined;
const known = (id: string) =>
  id === "app:settings" ||
  Boolean(databaseId(id)?.match(/^[a-zA-Z0-9_-]{1,128}$/)) ||
  libraries.some((item) => item.id === id);
const fail = (): never => {
  throw new Error("Invalid cloud sync payload.");
};

/** JSON-only, bounded and prototype-safe; never interpret section IDs as paths. */
function copyJson(value: unknown, depth = 0): unknown {
  if (depth > 64) return fail();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item) => copyJson(item, depth + 1));
  if (
    value &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        return fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value"))
        return fail();
      result[key] = copyJson(descriptor.value, depth + 1);
    }
    return result;
  }
  return fail();
}
const canonical = (value: unknown) => JSON.stringify(copyJson(value));

export function validateCloudSyncPayload(value: unknown): CloudSyncPayload {
  const clean = copyJson(value) as CloudSyncPayload;
  if (
    !clean ||
    clean.version !== 1 ||
    !clean.sections ||
    Array.isArray(clean.sections) ||
    typeof clean.sections !== "object" ||
    Object.keys(clean).some((key) => key !== "version" && key !== "sections")
  )
    return fail();
  if (
    utf8Bytes(JSON.stringify(clean)) >
    MAX_CLOUD_SYNC_FILE_SIZE_MIB * 1024 * 1024
  )
    return fail();
  for (const [id, section] of Object.entries(clean.sections)) {
    if (
      !known(id) ||
      !section ||
      typeof section !== "object" ||
      Array.isArray(section)
    )
      return fail();
    if (databaseId(id)) {
      const archive = section as {
        collection?: { id?: string };
        format?: string;
        version?: number;
      };
      if (
        archive.collection?.id !== databaseId(id) ||
        archive.format !== "sorng-full-database" ||
        archive.version !== 1
      )
        return fail();
      // Database index labels are local metadata, not restored body content.
      // Canonicalize them at both ingress and capture for stable round trips.
      const body = section as Record<string, unknown>;
      body.timestamp = 0;
      body.collection = {
        id: databaseId(id),
        name: databaseId(id),
        isEncrypted: true,
        exportDate: "1970-01-01T00:00:00.000Z",
      };
    } else if (id === "app:settings") {
      if (canonical(portableSettings(section)) !== canonical(section))
        return fail();
    } else {
      const library = section as Record<string, unknown>;
      normalizeRecordLedger(library.recordMetadata);
      if (id === appDocumentsId) {
        const documents = { ...library };
        delete documents.recordMetadata;
        const normalized = normalizeDatabaseDocuments(documents);
        if (
          canonical(normalized) !== canonical(documents) ||
          normalized.documents.some(
            (document) => document.parentFolderId !== null,
          )
        )
          return fail();
        continue;
      }
      if (library.databaseMigration !== undefined)
        normalizeTerminalLibraryMigrationReceipt(library.databaseMigration);
      if (
        library.provenance !== undefined &&
        canonical(normalizeAutomationProvenanceMap(library.provenance)) !==
          canonical(library.provenance)
      )
        return fail();
      if (id === "app:recording.terminal-macros") {
        if (
          Object.keys(library).some(
            (key) =>
              ![
                "version",
                "macros",
                "legacyDigest",
                "provenance",
                "recordMetadata",
                "databaseMigration",
              ].includes(key),
          )
        )
          return fail();
        if (
          library.version !== 1 ||
          !(
            library.legacyDigest === null ||
            (typeof library.legacyDigest === "string" &&
              /^[a-f0-9]{64}$/.test(library.legacyDigest))
          )
        )
          return fail();
        validateTerminalMacros(library.macros);
      } else if (id === "app:recording.web-automation.v1") {
        if (
          canonical(normalizeWebAutomationLibrary(library)) !==
          canonical(library)
        )
          return fail();
      } else {
        if (
          Object.keys(library).some(
            (key) =>
              ![
                "customScripts",
                "modifiedDefaults",
                "deletedDefaultIds",
                "provenance",
                "recordMetadata",
                "databaseMigration",
              ].includes(key),
          )
        )
          return fail();
        if (
          !["customScripts", "modifiedDefaults", "deletedDefaultIds"].every(
            (key) => Array.isArray(library[key]),
          )
        )
          return fail();
        for (const script of [
          ...(library.customScripts as unknown[]),
          ...(library.modifiedDefaults as unknown[]),
        ])
          normalizeManagedScript(script);
        if (
          !(library.deletedDefaultIds as unknown[]).every(
            (id) => typeof id === "string" && id.length <= 128,
          )
        )
          return fail();
      }
    }
  }
  return clean;
}

/** Deterministic upgrade of old snapshots before comparison, never clock-LWW. */
export async function upgradeCloudSyncPayload(
  payload: CloudSyncPayload,
  purpose: "compare" | "atomic-restore" = "compare",
): Promise<CloudSyncPayload> {
  const clean = validateCloudSyncPayload(payload);
  for (const [id, section] of Object.entries(clean.sections)) {
    if (id === appDocumentsId)
      await verifyDocumentAttachments(section as DatabaseDocuments);
    const incoming = normalizeRecordLedger(
      (section as Record<string, unknown>).recordMetadata,
    );
    if (databaseId(id)) {
      clean.sections[id] = await normalizeFullDatabaseArchive(section);
      const archive = clean.sections[id] as Awaited<
        ReturnType<typeof normalizeFullDatabaseArchive>
      >;
      // Restore preserves exact capsule bytes for native authentication at commit.
      // Comparison cannot yet ignore wrappers or merge capsules: the frozen
      // native API has no non-mutating verification/reselection operation.
      if (
        (purpose === "compare" &&
          (archive.browserSessions?.records.length ||
            archive.browserSessionsTransfer)) ||
        (archive.browserSessions?.records.length &&
          !archive.browserSessionsTransfer)
      )
        throw new FullDatabaseArchiveError("browser-sessions");
    } else if (id !== "app:settings") {
      const library = section as Record<string, unknown>;
      library.recordMetadata = await reconcileRecordLedger(
        library,
        normalizeRecordLedger(library.recordMetadata),
        { mode: "migrate" },
      );
    }
    // Old snapshots without metadata can be migrated deterministically. Once
    // history exists, ingress must verify it, not bless untracked remote edits
    // by silently appending repair revisions before the reviewed CAS.
    if (
      incoming &&
      canonical(incoming) !==
        canonical(
          (clean.sections[id] as Record<string, unknown>).recordMetadata,
        )
    )
      throw new Error(
        "Remote record metadata does not match the reviewed data.",
      );
  }
  // Domain normalizers may return optional undefined members; serialization
  // omits them exactly as the durable archive does.
  return validateCloudSyncPayload(JSON.parse(JSON.stringify(clean)));
}

export async function discoverCloudSyncItems({
  includeSizes = true,
}: { includeSizes?: boolean } = {}): Promise<CloudSyncItem[]> {
  const manager = DatabaseManager.getInstance();
  const invoke = await getInvoke();
  const items: CloudSyncItem[] = [];
  const databases = await manager.getExportableDatabases();
  const sizes = includeSizes
    ? await readDatabaseSizes(databases.map((db) => db.id))
    : {};
  for (const db of databases) {
    const item: CloudSyncItem = {
      id: `database:${db.id}`,
      label: db.name,
      kind: "database",
      sensitive: true,
      available: db.isExportable && db.protectionFormat === "sorng-db",
      ...(db.protectionFormat === "sorng-db" && !db.isExportable
        ? { unlockDatabaseId: db.id }
        : {}),
      unavailableReason:
        db.protectionFormat !== "sorng-db"
          ? `${db.isEncrypted ? "This database uses the older password-protected format." : "This database does not use native database protection."} Cloud sync currently requires the newer protected format. Open this database, go to Settings → Current Database → Native cipher and unlock-method options, and review the protection change. Then refresh this inventory.`
          : !db.isExportable
            ? "Unlock this database here before syncing. If it was already unlocked, its session may have expired."
            : undefined,
    };
    if (includeSizes) {
      const size = sizes[db.id];
      item.bytes = size.bytes;
      item.sizeStatus = size.status;
      item.sizeUnavailableReason = size.reason;
      if (size.bytes !== undefined)
        item.sizeKind =
          size.source === "browser-json"
            ? "stored-json"
            : db.isEncrypted || db.protectionFormat === "sorng-db"
              ? "stored-encrypted"
              : "stored-file";
    }
    items.push(item);
  }
  if (invoke)
    for (const item of libraries) {
      try {
        // Read only known keys. Do not call load(): it can migrate/create defaults.
        const raw = await invoke<string | null>(item.command, {
          key: item.store.key,
        });
        if (raw !== null) {
          items.push({
            id: item.id,
            label: `${item.label} (App-wide)`,
            kind: "library",
            available: true,
            sensitive: true,
            ...(includeSizes
              ? { bytes: utf8Bytes(raw), sizeKind: "stored-json" as const }
              : {}),
          });
        }
      } catch {
        items.push({
          id: item.id,
          label: `${item.label} (App-wide)`,
          kind: "library",
          available: false,
          sensitive: true,
          unavailableReason:
            "Store is locked or unavailable; unlock it before syncing.",
        });
      }
    }
  if (invoke) {
    const settingsItem = {
      id: "app:settings",
      label: "settings.json — portable appearance preferences",
      kind: "settings",
      sensitive: false,
    };
    try {
      const settings = await invoke("read_app_settings");
      if (settings !== null)
        items.push({
          ...settingsItem,
          available: true,
          ...(includeSizes
            ? {
                bytes: utf8Bytes(JSON.stringify(portableSettings(settings))),
                sizeKind: "portable-settings" as const,
              }
            : {}),
        });
    } catch {
      items.push({
        ...settingsItem,
        available: false,
        unavailableReason:
          "Settings are locked or unavailable; unlock them before syncing.",
      });
    }
  }
  return items;
}

function selected(config: CloudSyncConfig): Set<string> {
  const ids = config.selectedItems ?? [];
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string" || !known(id))
  )
    throw new Error("Select available cloud sync items.");
  if (ids.some((id) => id !== "app:settings") && !config.encryptBeforeSync)
    throw new Error("Selected artifacts require encrypted cloud sync.");
  return new Set(ids);
}

function excluded(id: string, label: string, config: CloudSyncConfig): boolean {
  const library = libraries.find((item) => item.id === id);
  const filename =
    id === "app:settings" ? "settings.json" : `${id.replace(":", "/")}.json`;
  return (config.excludePatterns ?? []).some((pattern) => {
    if (typeof pattern !== "string" || pattern.length > 256)
      throw new Error("Invalid cloud exclusion pattern.");
    const expression = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`,
      "i",
    );
    // Renaming a row must not change consent expressed by a label exclusion.
    return [
      id,
      filename,
      label,
      library?.label,
      library && `${library.label} (${library.previousScope})`,
    ].some((value) => value !== undefined && expression.test(value));
  });
}

async function readItem(
  id: string,
  browserSessionsPassword?: string,
): Promise<unknown> {
  if (id === "app:settings") {
    const invoke = await getInvoke();
    if (!invoke) throw new Error("Settings sync requires the desktop app.");
    const persisted = portableSettings(await invoke("read_app_settings"));
    const current =
      SettingsManager.getInstance().getSettings() as unknown as Record<
        string,
        unknown
      >;
    if (Object.keys(persisted).some((key) => current[key] !== persisted[key]))
      throw new Error(
        "Portable settings have unsaved edits. Save or discard them before syncing.",
      );
    return persisted;
  }
  const db = databaseId(id);
  if (db) {
    const archive = await DatabaseManager.getInstance().readFullDatabaseArchive(
      db,
      {
        materializeDefaults: true,
        ...(browserSessionsPassword === undefined
          ? {}
          : { browserSessionsPassword }),
      },
    );
    // Use the same canonical representation at capture AND apply preflight.
    // JSON serialization omits optional undefined fields in the archive API.
    return validateCloudSyncPayload({
      version: 1,
      sections: { [id]: JSON.parse(JSON.stringify(archive)) },
    }).sections[id];
  }
  const item = libraries.find((item) => item.id === id)!;
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Cloud artifact sync requires the desktop app.");
  // Explicit capture/load may perform the local CAS migration; inventory is
  // still read-only. Metadata stays in the same protected library artifact.
  const loaded = await item.store.load();
  if (loaded.value === null)
    throw new Error("Selected cloud sync artifact no longer exists.");
  return JSON.parse(JSON.stringify(loaded.value));
}

export interface CloudSyncCaptureOptions {
  /** Review and comparison captures must never acquire new unlock authority. */
  allowAutoUnlock?: boolean;
  /** The engine's target/settings invalidation guard, including during native unlock. */
  assertCurrent?: () => void;
  /** Explicit restore keeps exact transport bytes; never grants hash equivalence. */
  sessionTransferPurpose?: "atomic-restore";
}

/** Unlike an export guard, this permits initially locked/nonresident sources. */
function captureAutoUnlockGuard(
  manager: DatabaseManager,
  databaseIds: string[],
  assertOperation: () => void,
) {
  const isCurrent = manager.captureStartupRestoreGuard();
  const states = new Map(
    databaseIds.map((id) => [id, manager.getDatabaseAccessState(id)]),
  );
  let cancelled = false;
  let unlocking: string | undefined;
  const dispose = manager.onDatabaseAccessChange((state) => {
    if (!states.has(state.databaseId)) return;
    // Installing our grant advances its epoch. Every revocation remains fatal,
    // including a lock followed immediately by a different successful unlock.
    if (
      !cancelled &&
      state.databaseId === unlocking &&
      state.status === "ready" &&
      state.reason === "unlocked"
    )
      states.set(state.databaseId, state);
    else cancelled = true;
  });
  const assertCurrent = () => {
    assertOperation();
    if (
      cancelled ||
      !isCurrent() ||
      [...states].some(([id, before]) => {
        const now = manager.getDatabaseAccessState(id);
        return (
          now?.accessEpoch !== before?.accessEpoch ||
          now?.status !== before?.status
        );
      })
    )
      throw new Error(
        "Database access changed during cloud capture. Review and unlock the selected databases before retrying.",
      );
  };
  return {
    assertCurrent,
    dispose,
    async unlock(id: string, slotId: string) {
      assertCurrent();
      unlocking = id;
      try {
        await manager.unlockManagedDatabase(id, slotId, undefined, {
          isCurrent: () => {
            try {
              assertCurrent();
              return true;
            } catch {
              return false;
            }
          },
        });
        assertCurrent();
      } finally {
        unlocking = undefined;
      }
    },
  };
}

export async function captureCloudSyncPayload(
  config: CloudSyncConfig,
  options: CloudSyncCaptureOptions = {},
): Promise<CloudSyncPayload> {
  const ids = selected(config);
  const manager = DatabaseManager.getInstance();
  const current = manager.getCurrentDatabase();
  const owner = current?.id;
  const recoveryId = current ? `database:${current.id}` : undefined;
  // Only metadata for the already selected, unlocked protected database may
  // be refreshed. Pin its owner/access epoch before either asynchronous read.
  const recoveryGuard =
    current &&
    recoveryId &&
    ids.has(recoveryId) &&
    current.protectionFormat === "sorng-db" &&
    manager.getDatabaseAccessState(current.id)?.status === "ready"
      ? manager.captureDatabaseOperationGuard([current.id])
      : undefined;
  const assertOwner = () => {
    options.assertCurrent?.();
    if (manager.getCurrentDatabase()?.id !== owner)
      throw new Error("Database selection changed during cloud capture.");
  };
  const databaseIds = [...ids].flatMap((id) =>
    databaseId(id) ? [databaseId(id)!] : [],
  );
  const unlockGuard =
    config.autoUnlockOsVaultDatabases === true &&
    options.allowAutoUnlock !== false
      ? captureAutoUnlockGuard(
          manager,
          [...new Set([...databaseIds, ...(owner ? [owner] : [])])],
          assertOwner,
        )
      : undefined;
  const assertCurrent = () => {
    assertOwner();
    unlockGuard?.assertCurrent();
  };
  let release: (() => Promise<void>) | undefined;
  let captured = false;
  try {
    if (unlockGuard) {
      assertCurrent();
      const candidates = await discoverCloudSyncItems({ includeSizes: false });
      assertCurrent();
      for (const id of ids) {
        const item = candidates.find((candidate) => candidate.id === id);
        if (
          !item ||
          item.available ||
          !item.unlockDatabaseId ||
          excluded(item.id, item.label, config)
        )
          continue;
        assertCurrent();
        let encryption: EncryptionStatus | null = null;
        try {
          const invoke = await getInvoke();
          assertCurrent();
          if (invoke)
            encryption = await invoke<EncryptionStatus>("encryption_status");
        } catch {
          // Status probes must never surface native key-store error text.
        }
        assertCurrent();
        if (
          !encryption ||
          typeof encryption.unlocked !== "boolean" ||
          ![0, 2].includes(encryption.schemaVersion) ||
          encryption.criticalKeyFailure === true ||
          (encryption.unlocked !== true &&
            (encryption.schemaVersion === 2 ||
              encryption.vaultHasMasterDek ||
              encryption.passwordWrapPresent ||
              encryption.settingsEncryptedOnDisk ||
              encryption.recoveryRequired))
        )
          throw new Error(
            "Application storage is locked or its status could not be verified. Unlock application storage before automatically unlocking databases for cloud sync, then retry.",
          );
        const failure = () =>
          new Error(
            `Database “${item.label}” could not be automatically unlocked for cloud sync. Unlock it manually and retry. Automatic unlock requires exactly one OS-vault unlock method on this device; no password fallback was attempted.`,
          );
        try {
          const status = await manager.getDatabaseProtectionStatus(
            item.unlockDatabaseId,
          );
          assertCurrent();
          const slot = singleOsVaultUnlockSlot(status);
          if (!slot) throw failure();
          await unlockGuard.unlock(item.unlockDatabaseId, slot.id);
          assertCurrent();
          if (
            manager.getDatabaseAccessState(item.unlockDatabaseId)?.status !==
            "ready"
          )
            throw failure();
        } catch {
          // Neither native errors nor their causes may expose vault credentials.
          assertCurrent();
          throw failure();
        }
      }
    }
    // Unlocking can refresh the current database's provider state. Acquire its
    // short-lived writer barrier afterwards, never across the native unlock.
    release = await acquireCloudSyncDatabaseBarrier(databaseIds);
    assertCurrent();
    let inventory = await discoverCloudSyncItems({ includeSizes: false });
    assertCurrent();
    const recoveryItem = inventory.find((item) => item.id === recoveryId);
    if (
      !unlockGuard &&
      recoveryGuard &&
      recoveryId &&
      !recoveryItem?.available &&
      !excluded(recoveryId, recoveryItem?.label ?? recoveryId, config)
    ) {
      recoveryGuard.assertCurrent();
      // Inventory reloads the native database index. Do not force availability,
      // unlock, load a writer baseline, or retry any artifact read/write.
      inventory = await discoverCloudSyncItems({ includeSizes: false });
      recoveryGuard.assertCurrent();
      assertCurrent();
    }
    const sections: Record<string, unknown> = {};
    for (const id of ids) {
      assertCurrent();
      if (
        excluded(
          id,
          inventory.find((item) => item.id === id)?.label ?? id,
          config,
        )
      )
        continue;
      const item = inventory.find((item) => item.id === id);
      if (!item?.available) {
        const label = item?.label.trim();
        const subject = databaseId(id)
          ? label
            ? `Database “${label}”`
            : "A selected database"
          : label
            ? `Selected item “${label}”`
            : "A selected item";
        throw new Error(
          `${subject} is unavailable for cloud sync. ${item?.unavailableReason ?? "Review What to sync and select an existing, unlocked artifact."}`,
        );
      }
      sections[id] = await readItem(id, config.syncEncryptionPassword);
      assertCurrent();
    }
    const payload = await upgradeCloudSyncPayload(
      { version: 1, sections },
      options.sessionTransferPurpose,
    );
    assertCurrent();
    captured = true;
    return payload;
  } finally {
    try {
      await release?.();
      if (captured) assertCurrent();
    } finally {
      unlockGuard?.dispose();
    }
  }
}

export async function applyCloudSyncPayload(
  payload: CloudSyncPayload,
  config: CloudSyncConfig,
  expected?: CloudSyncPayload,
): Promise<void> {
  const ids = selected(config);
  let clean = validateCloudSyncPayload(payload);
  if (Object.keys(clean.sections).some((id) => !ids.has(id)))
    throw new Error("Cloud payload contains an unselected artifact.");
  clean = await upgradeCloudSyncPayload(clean, "atomic-restore");
  const inventory = await discoverCloudSyncItems({ includeSizes: false });
  if (
    Object.keys(clean.sections).some((id) =>
      excluded(
        id,
        inventory.find((item) => item.id === id)?.label ?? id,
        config,
      ),
    )
  )
    throw new Error("Cloud payload contains an excluded artifact.");
  const baseline = expected
    ? await upgradeCloudSyncPayload(expected, "atomic-restore")
    : await captureCloudSyncPayload(config, {
        allowAutoUnlock: false,
        sessionTransferPurpose: "atomic-restore",
      });
  const owner = DatabaseManager.getInstance().getCurrentDatabase()?.id;
  const assertOwner = () => {
    if (DatabaseManager.getInstance().getCurrentDatabase()?.id !== owner)
      throw new Error("Database selection changed during cloud apply.");
  };
  // Preflight all selected changes before the first mutation.
  const publicBaseline = (id: string, section: unknown) => {
    if (!databaseId(id)) return canonical(section);
    const archive = section as FullDatabaseArchive;
    // Compare public-body CAS only. Never use this projection as a sync hash:
    // native import still authenticates the exact incoming capsule and deletion set.
    return canonical({
      ...fullDatabaseArchiveData(archive),
      timestamp: 0,
      collection: { id: archive.collection.id },
      trustRecords: archive.trustRecords,
    });
  };
  for (const id of Object.keys(clean.sections)) {
    if (databaseId(id)) await normalizeFullDatabaseArchive(clean.sections[id]);
    if (
      !Object.prototype.hasOwnProperty.call(baseline.sections, id) ||
      publicBaseline(id, await readItem(id, config.syncEncryptionPassword)) !==
        publicBaseline(id, baseline.sections[id])
    )
      throw new Error("Local artifact changed since cloud capture.");
    assertOwner();
  }
  let completed = 0;
  try {
    for (const [id, value] of Object.entries(clean.sections)) {
      assertOwner();
      const db = databaseId(id);
      if (id === "app:settings")
        await SettingsManager.getInstance().saveCloudSyncSettings(
          value as Record<string, unknown>,
          baseline.sections[id] as Record<string, unknown>,
        );
      else if (db)
        await DatabaseManager.getInstance().restoreCloudSyncArchive(
          db,
          value,
          baseline.sections[id],
          { browserSessionsPassword: config.syncEncryptionPassword },
        );
      else {
        const item = libraries.find((item) => item.id === id)!;
        // Each retry rechecks the reviewed content; never bless a newer edit.
        await item.store.update(
          (current) => {
            assertOwner();
            if (canonical(current) !== canonical(baseline.sections[id]))
              throw new Error("Library changed since cloud capture.");
            return value as never;
          },
          undefined,
          { adoptRecordMetadata: true },
        );
      }
      completed++;
      assertOwner();
    }
  } catch (error) {
    if (
      completed ||
      (error !== null &&
        typeof error === "object" &&
        "kind" in error &&
        error.kind === "partial")
    )
      throw new CloudSyncPartialApplyError(error);
    throw error;
  }
}
