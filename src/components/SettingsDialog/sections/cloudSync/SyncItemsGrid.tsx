import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Database, LockKeyhole } from "lucide-react";
import { ToastContext } from "../../../../contexts/ToastContext";
import type { DatabaseOpenObserver } from "../../../../types/connection/databaseOpening";
import { discoverCloudSyncItems } from "../../../../utils/services/cloudSyncPayload";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../../../utils/storage/appDataJsonStore";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
  onDatabaseAccessChange,
} from "../../../../utils/connection/databaseManager";
import type { DatabaseProtectionStatus } from "../../../../types/encryption/databaseProtection";
import { formatDatabaseBytes as formatBytes } from "../../../../utils/connection/databaseSize";
import { cloudSyncArtifactLabel } from "../../../../utils/settings/cloudSyncPresentation";
import { Checkbox } from "../../../ui/forms";
import { ManagedDatabaseUnlockDialog } from "../../../encryption/DatabaseUnlockDialog";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

type InventoryItem = Awaited<ReturnType<typeof discoverCloudSyncItems>>[number];

const sizeLabels = {
  "archive-estimate": "archive estimate",
  "portable-settings": "portable settings JSON",
  "stored-json": "stored JSON",
  "stored-encrypted": "stored encrypted database file",
  "stored-file": "stored database file",
};

const inventoryStoreKeys = new Set([
  "recording.managed-scripts",
  "recording.terminal-macros",
  "recording.web-automation.v1",
  "documents.app-wide.v1",
]);

/** Discovery is read-only; only explicit user actions change sync selections. */
function SyncItemsGrid({ mgr }: { mgr: Mgr }) {
  const toast = useContext(ToastContext)?.toast;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockDialog, setUnlockDialog] = useState<{
    id: string;
    name: string;
    status: DatabaseProtectionStatus;
    generation: number;
    notify: DatabaseOpenObserver;
  } | null>(null);
  const unlockRequest = useRef({
    generation: 0,
    busy: false,
    databaseId: null as string | null,
    notify: undefined as DatabaseOpenObserver | undefined,
  });
  const request = useRef({ generation: 0 });
  const refresh = useCallback(async () => {
    const generation = ++request.current.generation;
    setLoading(true);
    setError(false);
    try {
      const inventory = await discoverCloudSyncItems();
      if (generation !== request.current.generation) return;
      setItems([...new Map(inventory.map((item) => [item.id, item])).values()]);
      setLoaded(true);
    } catch {
      if (generation === request.current.generation) setError(true);
    } finally {
      if (generation === request.current.generation) setLoading(false);
    }
  }, []);
  const closeUnlock = useCallback(() => {
    unlockRequest.current.notify?.("cancelled");
    unlockRequest.current.notify = undefined;
    unlockRequest.current.generation++;
    unlockRequest.current.busy = false;
    unlockRequest.current.databaseId = null;
    setUnlockingId(null);
    setUnlockDialog(null);
  }, []);
  useEffect(() => {
    const lifecycle = unlockRequest.current;
    return () => {
      lifecycle.notify?.("cancelled");
      lifecycle.notify = undefined;
      lifecycle.generation++;
      lifecycle.busy = false;
      lifecycle.databaseId = null;
    };
  }, []);
  useEffect(() => {
    if (mgr.isBusy) closeUnlock();
  }, [mgr.isBusy, closeUnlock]);

  const startUnlock = async (item: InventoryItem) => {
    const id = item.unlockDatabaseId;
    if (
      !id ||
      item.id !== `database:${id}` ||
      item.available ||
      loading ||
      error ||
      mgr.isBusy ||
      unlockRequest.current.busy
    )
      return;
    const generation = ++unlockRequest.current.generation;
    const inventoryGeneration = request.current.generation;
    unlockRequest.current.busy = true;
    unlockRequest.current.databaseId = id;
    setUnlockingId(id);
    setUnlockError(null);
    try {
      const status =
        await DatabaseManager.getInstance().getDatabaseProtectionStatus(id);
      if (generation !== unlockRequest.current.generation) return;
      if (inventoryGeneration !== request.current.generation) {
        closeUnlock();
        return;
      }
      if (status.kind !== "managed")
        throw new Error("Database protection changed.");
      const toastId = toast?.loading(`Preparing to unlock “${item.label}”…`);
      let settled = false;
      const notify: DatabaseOpenObserver = (stage) => {
        if (settled || generation !== unlockRequest.current.generation) return;
        // A failed password attempt can be retried in the same dialog/toast.
        settled = ["success", "cancelled", "unconfirmed"].includes(stage);
        const messages = {
          "waiting-unlock": `Unlock “${item.label}” to make it available for cloud sync.`,
          unlocking: `Unlocking “${item.label}”…`,
          loading: `Checking unlock access for “${item.label}”…`,
          success: `Unlocked “${item.label}” for cloud sync.`,
          failed: `Could not unlock “${item.label}”. Review the unlock dialog and retry.`,
          cancelled: `Unlocking “${item.label}” was cancelled.`,
          unconfirmed: `Unlocking “${item.label}” finished without confirmation. Refresh the inventory.`,
        };
        if (toastId)
          toast?.update(toastId, {
            type:
              stage === "success"
                ? "success"
                : stage === "failed"
                  ? "error"
                  : settled || stage === "waiting-unlock"
                    ? "info"
                    : "loading",
            message: messages[stage],
            duration: settled ? 4000 : 0,
          });
      };
      unlockRequest.current.notify = notify;
      notify("waiting-unlock");
      setUnlockDialog({ id, name: item.label, status, generation, notify });
    } catch {
      if (generation !== unlockRequest.current.generation) return;
      unlockRequest.current.busy = false;
      unlockRequest.current.databaseId = null;
      setUnlockError(
        "Could not prepare this database's unlock methods. Refresh the inventory and try again; no sync was started.",
      );
    } finally {
      if (generation === unlockRequest.current.generation) setUnlockingId(null);
    }
  };
  useEffect(() => {
    const lifecycle = request.current;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      // Invalidate any pre-write discovery immediately; coalesce batch writes.
      lifecycle.generation++;
      setLoading(true);
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(), 250);
    };
    const changed = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && inventoryStoreKeys.has(key)) scheduleRefresh();
    };
    const unsubscribe = onCurrentDatabaseChange(scheduleRefresh);
    const unsubscribeAccess = onDatabaseAccessChange((state) => {
      // Includes non-active databases: unlocking for sync must not select them.
      if (
        state.status === "suspended" &&
        (state.databaseId === unlockRequest.current.databaseId ||
          state.reason === "global-lock")
      )
        closeUnlock();
      scheduleRefresh();
    });
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    window.addEventListener("sorng-database-data-saved", scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    void refresh();
    return () => {
      lifecycle.generation++;
      clearTimeout(refreshTimer);
      unsubscribe();
      unsubscribeAccess();
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
      window.removeEventListener("sorng-database-data-saved", scheduleRefresh);
      window.removeEventListener("focus", scheduleRefresh);
    };
  }, [refresh, mgr.isBusy, closeUnlock]);

  const selected = new Set(mgr.cloudSync.selectedItems ?? []);
  const missing: InventoryItem[] = [...selected]
    .filter((id) => !items.some((item) => item.id === id))
    .map((id) => ({
      id,
      label: cloudSyncArtifactLabel(id),
      kind: "unavailable",
      available: false,
      bytes: undefined,
      sensitive: false,
      unavailableReason: loaded
        ? "Selected item is no longer present in this inventory."
        : "Selected item has not been verified by inventory discovery.",
    }));
  // Empty stored libraries can carry deletion records that still need syncing.
  const listed = [...items, ...missing];
  const selectable = items.filter((item) => item.available);
  const visible = listed.filter((item) =>
    `${item.label} ${item.kind}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const groups = [...new Set(visible.map((item) => item.kind))];
  const write = (next: Set<string>) =>
    mgr.updateCloudSync({ selectedItems: [...next] });
  const selectedKnown = items.filter(
    (item) => selected.has(item.id) && item.available,
  );
  const sizedSelected = listed.filter(
    (item) => selected.has(item.id) && item.bytes !== undefined,
  );
  const estimates = sizedSelected.filter(
    (item) =>
      item.sizeKind === "archive-estimate" ||
      item.sizeKind === "portable-settings",
  );
  const stored = sizedSelected.filter((item) => !estimates.includes(item));
  const totalBytes = (rows: InventoryItem[]) =>
    rows.reduce((total, item) => total + item.bytes!, 0);
  const unknownSizeCount = selected.size - sizedSelected.length;
  const unavailableCount = listed.filter(
    (item) => selected.has(item.id) && !item.available,
  ).length;
  const disabled = loading || error;
  const buttonClass =
    "rounded border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";

  return (
    <div className="space-y-4" data-setting-key="cloudSync.selectedItems">
      {unlockDialog && (
        <ManagedDatabaseUnlockDialog
          key={`${unlockDialog.id}:${unlockDialog.status.securityRevision}`}
          databaseId={unlockDialog.id}
          databaseName={unlockDialog.name}
          status={unlockDialog.status}
          onClose={closeUnlock}
          onUnlockProgress={unlockDialog.notify}
          onUnlockComplete={async () => {
            if (unlockDialog.generation !== unlockRequest.current.generation)
              return;
            unlockDialog.notify("success");
            closeUnlock();
            await refresh();
          }}
        />
      )}
      <SectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title="What to Sync"
      />
      <Card>
        <Toggle
          settingKey="cloudSync.autoUnlockOsVaultDatabases"
          icon={<LockKeyhole size={16} />}
          label="Automatically unlock OS-vault databases for sync"
          description="Allow sync to unlock selected databases using this device's OS vault. Password-only databases still need manual unlock. This does not switch your active database or unlock the app's global lock."
          checked={mgr.cloudSync.autoUnlockOsVaultDatabases === true}
          onChange={(value) =>
            mgr.updateCloudSync({ autoUnlockOsVaultDatabases: value })
          }
          disabled={mgr.isBusy}
          infoTooltip="Off by default. Applies only when syncing selected, non-excluded databases with one OS-vault unlock method available on this device. Your operating system may require approval. Unlocking creates a normal expiring local session; no unlock credentials are uploaded."
        />
        <p className="text-sm text-[var(--color-textSecondary)]">
          Choose application archives and libraries found on this device. Newly
          discovered items are never selected automatically. This is not
          arbitrary file or folder sync.
        </p>
        <p className="text-sm text-[var(--color-textSecondary)]">
          Each database archive includes its connections, documents, password
          vault, trust records, and automation together. Selecting a database
          selects that complete archive, not individual records within it.
          Database-owned saved terminal scripts and terminal macros are included
          in that archive.
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          App-wide libraries appear separately and can be selected independently
          of databases. Stored empty libraries remain available so deletions can
          sync. Database-owned scripts and macros sync with their database.
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Database sizes measure the current file on disk, including encryption,
          even while locked. Backups, trust sidecars and unsaved changes are not
          counted. Browser-only sizes measure stored JSON. These are not final
          cloud archive sizes; portable settings sizes measure their JSON before
          cloud compression and encryption.
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Deselecting an item stops future synchronization but does not delete
          data already stored in the cloud.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search sync items"
            placeholder="Search archives and libraries…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="sor-settings-input flex-1"
          />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className={buttonClass}
          >
            Refresh inventory
          </button>
          <button
            type="button"
            disabled={disabled || !selectable.length}
            onClick={() =>
              write(
                new Set([...selected, ...selectable.map((item) => item.id)]),
              )
            }
            className={buttonClass}
          >
            Select all available
          </button>
          <button
            type="button"
            disabled={disabled || !selectedKnown.length}
            onClick={() =>
              write(
                new Set(
                  [...selected].filter(
                    (id) =>
                      !items.some((item) => item.id === id && item.available),
                  ),
                ),
              )
            }
            className={buttonClass}
          >
            Deselect available
          </button>
        </div>
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          {selected.size} selected
          {estimates.length > 0
            ? ` · ${formatBytes(totalBytes(estimates))} estimated sync data`
            : ""}
          {stored.length > 0
            ? ` · ${formatBytes(totalBytes(stored))} stored data`
            : ""}
          {unknownSizeCount > 0 ? ` · ${unknownSizeCount} size unknown` : ""}
          {unavailableCount > 0 ? ` · ${unavailableCount} unavailable` : ""}
        </p>
        {loading && <p role="status">Loading inventory…</p>}
        {error && (
          <p role="alert" className="text-sm text-error">
            Could not load the local inventory. Refresh to try again; selections
            have not changed.
          </p>
        )}
        {unlockError && (
          <p role="alert" className="text-sm text-error">
            {unlockError}
          </p>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-[var(--color-textSecondary)]">
            {query
              ? "No matching items."
              : "No syncable application archives or libraries found."}
          </p>
        )}
        <div className="max-h-96 overflow-y-auto space-y-3">
          {groups.map((kind) => (
            <fieldset key={kind} className="space-y-2">
              <legend className="text-sm font-medium text-[var(--color-text)]">
                {kind}
              </legend>
              {visible
                .filter((item) => item.kind === kind)
                .map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-[var(--color-border)] p-2 text-sm"
                  >
                    <label className="flex items-start gap-2">
                      <Checkbox
                        checked={selected.has(item.id)}
                        disabled={disabled || !item.available}
                        onChange={(checked) => {
                          const next = new Set(selected);
                          if (checked) next.add(item.id);
                          else next.delete(item.id);
                          write(next);
                        }}
                      />
                      <span className="min-w-0 break-words text-[var(--color-text)]">
                        {item.label}
                        <span
                          className="block text-xs text-[var(--color-textSecondary)]"
                          title={
                            item.bytes === undefined
                              ? item.sizeUnavailableReason
                              : `${item.bytes.toLocaleString()} bytes${item.sizeKind ? ` · ${sizeLabels[item.sizeKind]}` : ""}`
                          }
                        >
                          {item.bytes !== undefined
                            ? `${formatBytes(item.bytes)}${item.sizeKind ? ` · ${sizeLabels[item.sizeKind]}` : ""}`
                            : item.sizeStatus === "missing"
                              ? "Database file missing"
                              : "Size unavailable"}
                          {item.sensitive ? " · Sensitive data" : ""}
                        </span>
                      </span>
                    </label>
                    {item.bytes === undefined && item.sizeUnavailableReason && (
                      <p className="mt-1 text-xs text-warning">
                        {item.sizeUnavailableReason}
                      </p>
                    )}
                    {!item.available && (
                      <p className="mt-1 text-xs text-warning">
                        Unavailable:{" "}
                        {item.unavailableReason ||
                          "This item cannot currently be synced."}
                      </p>
                    )}
                    {!item.available &&
                      item.unlockDatabaseId &&
                      item.id === `database:${item.unlockDatabaseId}` && (
                        <button
                          type="button"
                          className={`${buttonClass} mt-2 mr-2 inline-flex items-center gap-2`}
                          disabled={
                            disabled ||
                            mgr.isBusy ||
                            unlockingId !== null ||
                            unlockDialog !== null
                          }
                          onClick={() => void startUnlock(item)}
                          aria-label={`Unlock database ${item.label}`}
                        >
                          <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
                          Unlock database
                        </button>
                      )}
                    {!item.available && selected.has(item.id) && (
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          const next = new Set(selected);
                          next.delete(item.id);
                          write(next);
                        }}
                        aria-label={`Remove unavailable selection ${item.label}`}
                      >
                        Remove selection
                      </button>
                    )}
                  </div>
                ))}
            </fieldset>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default SyncItemsGrid;
