import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FolderTree,
  Leaf,
  Pencil,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToastContext } from "../../contexts/ToastContext";
import {
  formatMongoJson,
  useMongoDBClient,
} from "../../hooks/protocol/useMongoDBClient";
import type { ConnectionSession } from "../../types/connection/connection";
import { MongoAggregateTab } from "./mongodb/MongoAggregateTab";
import { MongoDocumentViewer } from "./mongodb/MongoDocumentViewer";
import { MongoFindForm } from "./mongodb/MongoFindForm";
import { MongoIndexesTab } from "./mongodb/MongoIndexesTab";
import { MongoResultsGrid } from "./mongodb/MongoResultsGrid";

interface MongoDBClientProps {
  session: ConnectionSession;
}

type WriteKind = "insert" | "update" | "delete" | "dropIndex";

interface PendingWrite {
  kind: WriteKind;
  summary: string;
  run: () => Promise<unknown>;
}

const formatBytes = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

/** Download the given JSON text through a transient anchor. */
export const downloadJson = (fileName: string, text: string) => {
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const jsonTextarea = (invalid: boolean) =>
  `w-full rounded border bg-[var(--color-input)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] ${invalid ? "border-error" : "border-[var(--color-border)]"}`;

export function MongoDBClient({ session }: MongoDBClientProps) {
  const { t } = useTranslation();
  const client = useMongoDBClient(session);
  const toast = useContext(ToastContext)?.toast;
  const [jsonView, setJsonView] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [insertText, setInsertText] = useState("{}");
  const [updateFilterText, setUpdateFilterText] = useState("{}");
  const [updateText, setUpdateText] = useState('{"$set": {}}');
  const [updateMulti, setUpdateMulti] = useState(false);
  const [updateUpsert, setUpdateUpsert] = useState(false);
  const [deleteFilterText, setDeleteFilterText] = useState("{}");
  const [deleteMulti, setDeleteMulti] = useState(false);

  const connected = client.status === "connected";
  const hasTarget = Boolean(
    client.selectedDatabase && client.selectedCollection,
  );
  const target = hasTarget
    ? `${client.selectedDatabase}.${client.selectedCollection}`
    : "";
  const actionsDisabled = !connected || !hasTarget || client.isExecuting;
  const activeResult =
    client.lastRunKind === "aggregate"
      ? client.aggregateResult
      : client.results;
  const showingFind = client.lastRunKind === "find" && client.results !== null;

  useEffect(() => {
    setSelectedDocument(null);
  }, [activeResult]);

  useEffect(() => {
    if (!client.lastWrite) return;
    toast?.success(client.lastWrite);
  }, [client.lastWrite, toast]);

  const runFind = () => {
    void client.runFind().catch(() => undefined);
  };

  const confirmWrite = (write: PendingWrite) => setPending(write);

  const acceptPending = () => {
    const write = pending;
    setPending(null);
    if (!write) return;
    void write
      .run()
      .then(() => {
        if (write.kind !== "dropIndex") {
          void client.runFind().catch(() => undefined);
          void client.loadCollectionStats().catch(() => undefined);
        }
      })
      .catch(() => undefined);
  };

  const exportJson = () => {
    if (!activeResult) return;
    downloadJson(
      `${client.selectedDatabase ?? "mongodb"}.${client.selectedCollection ?? "documents"}-${Date.now()}.json`,
      formatMongoJson(activeResult.documents),
    );
  };

  const scopeLabel = (multi: boolean) =>
    multi
      ? t("mongoClient.confirm.allMatches", "all matching documents")
      : t("mongoClient.confirm.firstMatch", "the first matching document");

  const selectedDoc =
    selectedDocument !== null && activeResult
      ? (activeResult.documents[selectedDocument] ?? null)
      : null;

  return (
    <section
      data-testid="mongodb-client"
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-background)]"
      aria-label={t("mongoClient.ariaLabel", "MongoDB client for {{host}}", {
        host: session.hostname,
      })}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Leaf className="shrink-0 text-success" size={20} />
          <div className="min-w-0">
            <h2 className="truncate font-medium text-[var(--color-text)]">
              MongoDB — {session.hostname}
            </h2>
            <p className="truncate text-xs text-[var(--color-textSecondary)]">
              {client.sessionInfo?.hosts.join(", ") || session.hostname}
              {client.sessionInfo?.server_version
                ? ` · ${client.sessionInfo.server_version}`
                : ""}
              {client.sessionInfo?.replica_set
                ? ` · ${client.sessionInfo.replica_set}`
                : ""}
            </p>
          </div>
          <span
            data-testid="mongodb-status"
            data-status={client.status}
            className={`rounded-full px-2 py-0.5 text-xs ${
              connected
                ? "bg-success/15 text-success"
                : client.status === "error"
                  ? "bg-error/15 text-error"
                  : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
            }`}
          >
            {t(`mongoClient.status.${client.status}`, client.status)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="mongodb-edit-mode"
            aria-pressed={editMode}
            className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs ${editMode ? "border-warning bg-warning/10 text-warning" : "border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"}`}
            title={t(
              "mongoClient.editMode.hint",
              "Enable insert, update, delete and index changes",
            )}
            onClick={() => setEditMode((value) => !value)}
          >
            <Pencil size={14} />
            {t("mongoClient.editMode.label", "Edit mode")}
          </button>
          <button
            type="button"
            className="sor-icon-btn-sm"
            data-testid="mongodb-refresh"
            title={t("mongoClient.refresh", "Refresh databases")}
            aria-label={t("mongoClient.refresh", "Refresh databases")}
            disabled={!connected || client.isBusy}
            onClick={() =>
              void client.refreshDatabases().catch(() => undefined)
            }
          >
            <RefreshCw
              size={16}
              className={client.isBusy ? "animate-spin" : ""}
            />
          </button>
          <button
            type="button"
            data-testid="mongodb-reconnect"
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            onClick={() => void client.reconnect().catch(() => undefined)}
          >
            {t("mongoClient.reconnect", "Reconnect")}
          </button>
          <button
            type="button"
            data-testid="mongodb-disconnect"
            className="flex items-center gap-1.5 rounded border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10"
            disabled={!client.backendSessionId}
            onClick={() => void client.disconnect().catch(() => undefined)}
          >
            <Unplug size={14} />
            {t("mongoClient.disconnect", "Disconnect")}
          </button>
        </div>
      </header>

      {client.error && (
        <div
          role="alert"
          data-testid="mongodb-error"
          className="shrink-0 border-b border-error/30 bg-error/10 px-4 py-2 text-sm text-error"
        >
          {client.error}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)]"
          aria-label={t("mongoClient.browser.ariaLabel", "MongoDB browser")}
        >
          <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
            <Database size={14} />
            {t("mongoClient.browser.databases", "Databases")}
          </div>
          <div
            className="max-h-48 shrink-0 space-y-0.5 overflow-y-auto px-2 pb-2"
            data-testid="mongodb-databases"
          >
            {client.databases.map((database) => {
              const active = database.name === client.selectedDatabase;
              return (
                <button
                  key={database.name}
                  type="button"
                  data-testid="mongodb-database"
                  data-name={database.name}
                  aria-pressed={active}
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-xs ${active ? "bg-primary/10 text-primary" : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"}`}
                  onClick={() =>
                    void client
                      .selectDatabase(database.name)
                      .catch(() => undefined)
                  }
                >
                  {database.name}
                </button>
              );
            })}
            {connected && client.databases.length === 0 && (
              <p className="px-2 py-1 text-[10px] text-[var(--color-textMuted)]">
                {t("mongoClient.browser.noDatabases", "No databases visible")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
            <FolderTree size={14} />
            {t("mongoClient.browser.collections", "Collections")}
          </div>
          <div
            className="max-h-64 space-y-0.5 overflow-y-auto px-2 pb-2"
            data-testid="mongodb-collections"
          >
            {client.collections.map((collection) => {
              const active = collection.name === client.selectedCollection;
              return (
                <button
                  key={collection.name}
                  type="button"
                  data-testid="mongodb-collection"
                  data-name={collection.name}
                  aria-pressed={active}
                  title={collection.collection_type}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${active ? "bg-primary/10 text-primary" : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"}`}
                  onClick={() =>
                    void client
                      .selectCollection(collection.name)
                      .catch(() => undefined)
                  }
                >
                  <span className="truncate">{collection.name}</span>
                  {active && client.documentCount !== null && (
                    <span className="shrink-0 text-[10px] opacity-75">
                      {client.documentCount}
                    </span>
                  )}
                </button>
              );
            })}
            {client.selectedDatabase && client.collections.length === 0 && (
              <p className="px-2 py-1 text-[10px] text-[var(--color-textMuted)]">
                {t("mongoClient.browser.noCollections", "No collections")}
              </p>
            )}
            {!client.selectedDatabase && (
              <p className="px-2 py-1 text-[10px] text-[var(--color-textMuted)]">
                {t("mongoClient.browser.pickDatabase", "Select a database")}
              </p>
            )}
          </div>

          <MongoIndexesTab
            indexes={client.indexes}
            errors={client.formErrors}
            disabled={actionsDisabled}
            editMode={editMode}
            hasTarget={hasTarget}
            onRefresh={() => void client.loadIndexes().catch(() => undefined)}
            onCreate={(keysText, optionsText) =>
              void client
                .createIndex(keysText, optionsText)
                .catch(() => undefined)
            }
            onDrop={(name) =>
              confirmWrite({
                kind: "dropIndex",
                summary: t(
                  "mongoClient.confirm.dropIndex",
                  "Drop index {{name}}?",
                  { name },
                ),
                run: () => client.dropIndex(name),
              })
            }
          />

          <div className="border-t border-[var(--color-border)]">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
                <BarChart3 size={14} />
                {t("mongoClient.stats.title", "Statistics")}
              </span>
              <button
                type="button"
                className="sor-icon-btn-sm"
                data-testid="mongodb-stats-refresh"
                aria-label={t(
                  "mongoClient.stats.refresh",
                  "Refresh statistics",
                )}
                disabled={actionsDisabled}
                onClick={() =>
                  void client.loadCollectionStats().catch(() => undefined)
                }
              >
                <RefreshCw size={12} />
              </button>
            </div>
            <dl
              className="grid grid-cols-2 gap-x-2 gap-y-1 px-3 pb-3 text-[11px]"
              data-testid="mongodb-stats"
            >
              {client.collectionStats ? (
                [
                  [
                    t("mongoClient.stats.count", "Documents"),
                    String(client.collectionStats.count),
                  ],
                  [
                    t("mongoClient.stats.size", "Data size"),
                    formatBytes(client.collectionStats.size),
                  ],
                  [
                    t("mongoClient.stats.storageSize", "Storage size"),
                    formatBytes(client.collectionStats.storage_size),
                  ],
                  [
                    t("mongoClient.stats.indexes", "Indexes"),
                    String(client.collectionStats.num_indexes),
                  ],
                  [
                    t("mongoClient.stats.indexSize", "Index size"),
                    formatBytes(client.collectionStats.total_index_size),
                  ],
                  [
                    t("mongoClient.stats.capped", "Capped"),
                    client.collectionStats.capped
                      ? t("mongoClient.common.yes", "Yes")
                      : t("mongoClient.common.no", "No"),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-[var(--color-textSecondary)]">
                      {label}
                    </dt>
                    <dd className="truncate font-mono text-[var(--color-text)]">
                      {value}
                    </dd>
                  </div>
                ))
              ) : (
                <dd className="col-span-2 text-[10px] text-[var(--color-textMuted)]">
                  {hasTarget
                    ? t(
                        "mongoClient.stats.loading",
                        "Collection statistics are not loaded yet.",
                      )
                    : t("mongoClient.noTarget", "Select a collection")}
                </dd>
              )}
            </dl>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[11px] text-[var(--color-textMuted)]">
            <span className="truncate font-mono" data-testid="mongodb-target">
              {hasTarget
                ? target
                : t("mongoClient.noTarget", "Select a collection")}
            </span>
          </div>

          <MongoFindForm
            sessionId={session.id}
            form={client.form}
            errors={client.formErrors}
            disabled={actionsDisabled}
            isExecuting={client.isExecuting}
            onChange={client.setFormField}
            onRun={runFind}
            onCount={() => void client.countDocuments().catch(() => undefined)}
          />

          <MongoAggregateTab
            sessionId={session.id}
            pipelineText={client.pipelineText}
            error={client.formErrors.pipeline}
            disabled={actionsDisabled}
            isExecuting={client.isExecuting}
            onChange={client.setPipelineText}
            onRun={() => void client.runAggregate().catch(() => undefined)}
          />

          {editMode && (
            <div
              className="shrink-0 border-b border-warning/40 bg-warning/5 p-3"
              data-testid="mongodb-edit-panel"
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                    {t("mongoClient.edit.insert", "Insert document(s)")}
                    <textarea
                      data-testid="mongodb-insert-editor"
                      rows={3}
                      className={`mt-1 ${jsonTextarea(Boolean(client.formErrors.insert))}`}
                      value={insertText}
                      spellCheck={false}
                      onChange={(event) => setInsertText(event.target.value)}
                    />
                  </label>
                  {client.formErrors.insert && (
                    <p role="alert" className="mt-1 text-[11px] text-error">
                      {client.formErrors.insert}
                    </p>
                  )}
                  <button
                    type="button"
                    data-testid="mongodb-insert"
                    className="mt-1 rounded bg-primary px-3 py-1 text-xs text-white disabled:opacity-50"
                    disabled={actionsDisabled}
                    onClick={() =>
                      confirmWrite({
                        kind: "insert",
                        summary: t(
                          "mongoClient.confirm.insert",
                          "Insert the given document(s) into {{target}}?",
                          { target },
                        ),
                        run: () => client.insertDocuments(insertText),
                      })
                    }
                  >
                    {t("mongoClient.edit.insertAction", "Insert")}
                  </button>
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                    {t("mongoClient.edit.updateFilter", "Update filter")}
                    <textarea
                      data-testid="mongodb-update-filter"
                      rows={1}
                      className={`mt-1 ${jsonTextarea(false)}`}
                      value={updateFilterText}
                      spellCheck={false}
                      onChange={(event) =>
                        setUpdateFilterText(event.target.value)
                      }
                    />
                  </label>
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                    {t("mongoClient.edit.update", "Update document")}
                    <textarea
                      data-testid="mongodb-update-editor"
                      rows={2}
                      className={`mt-1 ${jsonTextarea(Boolean(client.formErrors.update))}`}
                      value={updateText}
                      spellCheck={false}
                      onChange={(event) => setUpdateText(event.target.value)}
                    />
                  </label>
                  {client.formErrors.update && (
                    <p role="alert" className="mt-1 text-[11px] text-error">
                      {client.formErrors.update}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-textSecondary)]">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        data-testid="mongodb-update-multi"
                        checked={updateMulti}
                        onChange={(event) =>
                          setUpdateMulti(event.target.checked)
                        }
                      />
                      {t("mongoClient.edit.multi", "All matches")}
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        data-testid="mongodb-update-upsert"
                        checked={updateUpsert}
                        onChange={(event) =>
                          setUpdateUpsert(event.target.checked)
                        }
                      />
                      {t("mongoClient.edit.upsert", "Upsert")}
                    </label>
                    <button
                      type="button"
                      data-testid="mongodb-update"
                      className="rounded bg-primary px-3 py-1 text-xs text-white disabled:opacity-50"
                      disabled={actionsDisabled}
                      onClick={() =>
                        confirmWrite({
                          kind: "update",
                          summary: t(
                            "mongoClient.confirm.update",
                            "Apply this update to {{scope}} in {{target}}?",
                            { scope: scopeLabel(updateMulti), target },
                          ),
                          run: () =>
                            client.updateDocuments(
                              updateFilterText,
                              updateText,
                              { multi: updateMulti, upsert: updateUpsert },
                            ),
                        })
                      }
                    >
                      {t("mongoClient.edit.updateAction", "Update")}
                    </button>
                  </div>
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                    {t("mongoClient.edit.delete", "Delete filter")}
                    <textarea
                      data-testid="mongodb-delete-filter"
                      rows={3}
                      className={`mt-1 ${jsonTextarea(Boolean(client.formErrors.delete))}`}
                      value={deleteFilterText}
                      spellCheck={false}
                      onChange={(event) =>
                        setDeleteFilterText(event.target.value)
                      }
                    />
                  </label>
                  {client.formErrors.delete && (
                    <p role="alert" className="mt-1 text-[11px] text-error">
                      {client.formErrors.delete}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-textSecondary)]">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        data-testid="mongodb-delete-multi"
                        checked={deleteMulti}
                        onChange={(event) =>
                          setDeleteMulti(event.target.checked)
                        }
                      />
                      {t("mongoClient.edit.multi", "All matches")}
                    </label>
                    <button
                      type="button"
                      data-testid="mongodb-delete"
                      className="rounded border border-error/40 px-3 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
                      disabled={actionsDisabled}
                      onClick={() =>
                        confirmWrite({
                          kind: "delete",
                          summary: t(
                            "mongoClient.confirm.delete",
                            "Delete {{scope}} from {{target}}? This cannot be undone.",
                            { scope: scopeLabel(deleteMulti), target },
                          ),
                          run: () =>
                            client.deleteDocuments(
                              deleteFilterText,
                              deleteMulti,
                            ),
                        })
                      }
                    >
                      {t("mongoClient.edit.deleteAction", "Delete")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              data-testid="mongodb-results"
              data-source={client.lastRunKind ?? "none"}
            >
              {activeResult ? (
                <>
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                    <span data-testid="mongodb-result-summary">
                      {showingFind
                        ? t(
                            "mongoClient.results.range",
                            "Showing {{from}}–{{to}}",
                            {
                              from:
                                activeResult.returned === 0
                                  ? 0
                                  : client.form.skip + 1,
                              to: client.form.skip + activeResult.returned,
                            },
                          )
                        : t(
                            "mongoClient.results.pipelineCount",
                            "Pipeline returned {{count}}",
                            { count: activeResult.returned },
                          )}
                      {showingFind && client.documentCount !== null
                        ? ` ${t("mongoClient.results.of", "of {{count}}", { count: client.documentCount })}`
                        : ""}
                      {activeResult.has_more
                        ? ` · ${t("mongoClient.results.truncated", "more available")}`
                        : ""}
                      {` · ${activeResult.elapsed_ms} ms`}
                    </span>
                    <div className="flex items-center gap-1">
                      {showingFind && (
                        <>
                          <button
                            type="button"
                            data-testid="mongodb-prev"
                            className="sor-icon-btn-sm"
                            aria-label={t(
                              "mongoClient.results.prev",
                              "Previous page",
                            )}
                            disabled={actionsDisabled || client.form.skip <= 0}
                            onClick={() =>
                              void client.prevPage().catch(() => undefined)
                            }
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            type="button"
                            data-testid="mongodb-next"
                            className="sor-icon-btn-sm"
                            aria-label={t(
                              "mongoClient.results.next",
                              "Next page",
                            )}
                            disabled={actionsDisabled || !activeResult.has_more}
                            onClick={() =>
                              void client.nextPage().catch(() => undefined)
                            }
                          >
                            <ChevronRight size={14} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        data-testid="mongodb-json-toggle"
                        aria-pressed={jsonView}
                        className={`rounded border px-2 py-1 text-xs ${jsonView ? "border-primary text-primary" : "border-[var(--color-border)]"}`}
                        onClick={() => setJsonView((value) => !value)}
                      >
                        {t("mongoClient.results.jsonToggle", "JSON")}
                      </button>
                      <button
                        type="button"
                        data-testid="mongodb-export"
                        className="sor-icon-btn-sm"
                        aria-label={t(
                          "mongoClient.results.export",
                          "Export JSON",
                        )}
                        title={t("mongoClient.results.export", "Export JSON")}
                        disabled={activeResult.documents.length === 0}
                        onClick={exportJson}
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                  {jsonView ? (
                    <pre
                      data-testid="mongodb-json-view"
                      className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-[var(--color-text)]"
                    >
                      {formatMongoJson(activeResult.documents)}
                    </pre>
                  ) : (
                    <MongoResultsGrid
                      documents={activeResult.documents}
                      selectedIndex={selectedDocument}
                      onSelect={(index) =>
                        setSelectedDocument((current) =>
                          current === index ? null : index,
                        )
                      }
                    />
                  )}
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-[var(--color-textSecondary)]">
                  <div>
                    <Leaf size={40} className="mx-auto mb-3 opacity-50" />
                    <p>
                      {hasTarget
                        ? t(
                            "mongoClient.results.placeholder",
                            "Run Find or a pipeline to load documents.",
                          )
                        : t(
                            "mongoClient.results.pickCollection",
                            "Pick a collection to browse its documents.",
                          )}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <MongoDocumentViewer
              document={selectedDoc}
              index={selectedDocument}
              onClose={() => setSelectedDocument(null)}
            />
          </div>
        </main>
      </div>

      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="mongodb-confirm"
          aria-label={t("mongoClient.confirm.title", "Confirm change")}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl">
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
              {t("mongoClient.confirm.title", "Confirm change")}
            </h3>
            <p className="mb-4 text-sm text-[var(--color-textSecondary)]">
              {pending.summary}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="mongodb-confirm-cancel"
                className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)]"
                onClick={() => setPending(null)}
              >
                {t("mongoClient.common.cancel", "Cancel")}
              </button>
              <button
                type="button"
                data-testid="mongodb-confirm-accept"
                className={`rounded px-3 py-1.5 text-xs text-white ${pending.kind === "delete" || pending.kind === "dropIndex" ? "bg-error" : "bg-primary"}`}
                onClick={acceptPending}
              >
                {t("mongoClient.common.confirm", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default MongoDBClient;
