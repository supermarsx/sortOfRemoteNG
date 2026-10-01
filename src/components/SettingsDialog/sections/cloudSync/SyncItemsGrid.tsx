import { useCallback, useEffect, useRef, useState } from "react";
import { Database } from "lucide-react";
import { discoverCloudSyncItems } from "../../../../utils/services/cloudSyncPayload";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../../../utils/storage/appDataJsonStore";
import { onCurrentDatabaseChange } from "../../../../utils/connection/databaseManager";
import { formatDatabaseBytes as formatBytes } from "../../../../utils/connection/databaseSize";
import { Checkbox } from "../../../ui/forms";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
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
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
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
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    window.addEventListener("sorng-database-data-saved", scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    void refresh();
    return () => {
      lifecycle.generation++;
      clearTimeout(refreshTimer);
      unsubscribe();
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
      window.removeEventListener("sorng-database-data-saved", scheduleRefresh);
      window.removeEventListener("focus", scheduleRefresh);
    };
  }, [refresh, mgr.isBusy]);

  const selected = new Set(mgr.cloudSync.selectedItems ?? []);
  const missing: InventoryItem[] = [...selected]
    .filter((id) => !items.some((item) => item.id === id))
    .map((id) => ({
      id,
      label: id,
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
      <SectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title="What to Sync"
      />
      <Card>
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
