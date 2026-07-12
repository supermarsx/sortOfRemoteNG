import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Boxes,
  Database,
  DownloadCloud,
  HardDrive,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExchangeTabProps } from "../../../types/exchange";
import type {
  DagReplicationStatus,
  DatabaseAvailabilityGroup,
  ExchangeServer,
  MailboxDatabase,
  MailboxImportExportRequest,
  MigrationBatch,
  MoveRequest,
  ServiceHealthStatus,
} from "../../../types/exchange/servers";
import {
  useExchangeServers,
  type ExchangeServersView,
} from "../../../hooks/integration/exchange/useExchangeServers";

// ─── View metadata ────────────────────────────────────────────────────────────

interface ViewMeta {
  key: ExchangeServersView;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const VIEWS: ViewMeta[] = [
  { key: "servers", labelKey: "integrations.exchange.servers.view.servers", labelDefault: "Servers", icon: Server },
  { key: "databases", labelKey: "integrations.exchange.servers.view.databases", labelDefault: "Databases", icon: Database },
  { key: "dags", labelKey: "integrations.exchange.servers.view.dags", labelDefault: "DAGs", icon: Boxes },
  { key: "replication", labelKey: "integrations.exchange.servers.view.replication", labelDefault: "Replication", icon: HardDrive },
  { key: "serviceHealth", labelKey: "integrations.exchange.servers.view.serviceHealth", labelDefault: "Service Health", icon: Activity },
  { key: "migrationBatches", labelKey: "integrations.exchange.servers.view.migrationBatches", labelDefault: "Migration Batches", icon: Boxes },
  { key: "moveRequests", labelKey: "integrations.exchange.servers.view.moveRequests", labelDefault: "Move Requests", icon: DownloadCloud },
  { key: "importRequests", labelKey: "integrations.exchange.servers.view.importRequests", labelDefault: "Import Requests", icon: UploadCloud },
  { key: "exportRequests", labelKey: "integrations.exchange.servers.view.exportRequests", labelDefault: "Export Requests", icon: DownloadCloud },
];

const INPUT_CLS =
  "exchange-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]";
const ICON_BTN =
  "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]";

const dash = (v: unknown): string =>
  v == null || v === "" ? "—" : String(v);

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * Exchange "Servers, Databases & Migration" tab (t42-exchange-c3). A nine-way
 * sub-view spanning servers, mailbox databases, DAGs & copy-status replication,
 * service health, migration batches, move requests, and mailbox import/export
 * requests. Every one of this category's 32 commands is reachable here via
 * `useExchangeServers` — list loads back the views; per-row buttons drive the
 * get/mount/dismount/start/stop/complete/remove/test/new actions, whose results
 * land in the detail drawer. Exchange is a singleton service, so no call takes a
 * connection id.
 */
const ExchangeServersTab: React.FC<ExchangeTabProps> = () => {
  const { t } = useTranslation();
  const state = useExchangeServers();
  const {
    servers,
    databases,
    dags,
    replication,
    serviceHealth,
    migrationBatches,
    moveRequests,
    importRequests,
    exportRequests,
    loading,
    error,
    load,
    clearError,
    reportError,
    api,
  } = state;

  const [view, setView] = useState<ExchangeServersView>("servers");
  const [busy, setBusy] = useState(false);
  // Ad-hoc result drawer for get/test/action command output.
  const [detail, setDetail] = useState<{ title: string; data: unknown } | null>(
    null,
  );
  // Which create-form (if any) is open for the current view.
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    void load(view);
    setDetail(null);
    setFormOpen(false);
    setForm({});
  }, [view, load]);

  /** Run an action command, capture its result into the drawer, then optionally
   *  reload the current view. */
  const run = useCallback(
    async (title: string, fn: () => Promise<unknown>, reload = false) => {
      setBusy(true);
      try {
        const data = await fn();
        setDetail({ title, data });
        if (reload) await load(view);
      } catch (e) {
        reportError(e);
      } finally {
        setBusy(false);
      }
    },
    [load, view, reportError],
  );

  const setField = useCallback((k: string, v: string) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  }, []);

  const submitForm = useCallback(async () => {
    setBusy(true);
    try {
      if (view === "moveRequests") {
        await api.newMoveRequest(
          form.identity?.trim() ?? "",
          form.targetDatabase?.trim() ?? "",
          form.batchName?.trim() || undefined,
        );
      } else if (view === "importRequests") {
        await api.newMailboxImportRequest(
          form.mailbox?.trim() ?? "",
          form.filePath?.trim() ?? "",
          form.targetRootFolder?.trim() || undefined,
        );
      } else if (view === "exportRequests") {
        const split = (s?: string) =>
          s && s.trim()
            ? s.split(",").map((x) => x.trim()).filter(Boolean)
            : undefined;
        await api.newMailboxExportRequest(
          form.mailbox?.trim() ?? "",
          form.filePath?.trim() ?? "",
          split(form.includeFolders),
          split(form.excludeFolders),
        );
      }
      setFormOpen(false);
      setForm({});
      await load(view);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }, [view, form, api, load, reportError]);

  const activeMeta = VIEWS.find((v) => v.key === view)!;
  const canCreate =
    view === "moveRequests" ||
    view === "importRequests" ||
    view === "exportRequests";

  return (
    <div className="flex h-full flex-col">
      {/* Sub-view selector */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-1">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = v.key === view;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
                active
                  ? "bg-primary/15 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {t(v.labelKey, v.labelDefault)}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <span className="text-sm font-medium text-[var(--color-text)]">
          {t(activeMeta.labelKey, activeMeta.labelDefault)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {view === "serviceHealth" && (
            <>
              <button
                onClick={() =>
                  void run(
                    t("integrations.exchange.servers.serviceIssues", "Service issues"),
                    () => api.serviceIssues(),
                  )
                }
                className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
              >
                <ShieldCheck size={12} />
                {t("integrations.exchange.servers.serviceIssues", "Service issues")}
              </button>
              <button
                onClick={() =>
                  void run(
                    t("integrations.exchange.servers.testMailflow", "Test mail flow"),
                    () => api.testMailflow(),
                  )
                }
                className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
              >
                <Activity size={12} />
                {t("integrations.exchange.servers.testMailflow", "Test mail flow")}
              </button>
            </>
          )}
          <button
            onClick={() => void load(view)}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.exchange.servers.refresh", "Refresh")}
          >
            <RefreshCw size={12} />
          </button>
          {canCreate && (
            <button
              onClick={() => {
                setForm({});
                setFormOpen(true);
              }}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white"
            >
              <Plus size={12} />
              {t("integrations.exchange.servers.new", "New")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 bg-[var(--color-error,#ef4444)]/10 px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          <span>{error}</span>
          <button onClick={clearError} className="opacity-70 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <ViewBody
            view={view}
            servers={servers}
            databases={databases}
            dags={dags}
            replication={replication}
            serviceHealth={serviceHealth}
            migrationBatches={migrationBatches}
            moveRequests={moveRequests}
            importRequests={importRequests}
            exportRequests={exportRequests}
            busy={busy}
            run={run}
            api={api}
            load={load}
            reportError={reportError}
          />
        )}
      </div>

      {/* Create form */}
      {formOpen && canCreate && (
        <CreateForm
          view={view}
          form={form}
          busy={busy}
          onField={setField}
          onCancel={() => setFormOpen(false)}
          onSubmit={() => void submitForm()}
        />
      )}

      {/* Detail / result drawer */}
      {detail && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {detail.title}
            </span>
            <button onClick={() => setDetail(null)} className={ICON_BTN}>
              <X size={14} />
            </button>
          </div>
          <pre className="max-h-64 overflow-auto rounded bg-[var(--color-surfaceHover)] p-3 text-xs text-[var(--color-text)]">
            {JSON.stringify(detail.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

// ─── View body (per-view tables + row actions) ────────────────────────────────

interface BodyProps {
  view: ExchangeServersView;
  servers: ExchangeServer[];
  databases: MailboxDatabase[];
  dags: DatabaseAvailabilityGroup[];
  replication: DagReplicationStatus[];
  serviceHealth: ServiceHealthStatus[];
  migrationBatches: MigrationBatch[];
  moveRequests: MoveRequest[];
  importRequests: MailboxImportExportRequest[];
  exportRequests: MailboxImportExportRequest[];
  busy: boolean;
  run: (title: string, fn: () => Promise<unknown>, reload?: boolean) => void;
  api: ReturnType<typeof useExchangeServers>["api"];
  load: (view: ExchangeServersView) => Promise<void>;
  reportError: (e: unknown) => void;
}

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="px-4 py-1.5 text-left font-medium">{children}</th>
);
const Td: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <td className="px-4 py-1.5">{children}</td>
);

const ViewBody: React.FC<BodyProps> = (props) => {
  const { t } = useTranslation();
  const {
    view,
    servers,
    databases,
    dags,
    replication,
    serviceHealth,
    migrationBatches,
    moveRequests,
    importRequests,
    exportRequests,
    busy,
    run,
    api,
    load,
    reportError,
  } = props;

  const empty = (
    <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
      {t("integrations.exchange.servers.empty", "No records.")}
    </div>
  );

  const removeThen = useCallback(
    async (fn: () => Promise<unknown>, reloadView: ExchangeServersView) => {
      try {
        await fn();
        await load(reloadView);
      } catch (e) {
        reportError(e);
      }
    },
    [load, reportError],
  );

  const wrap = (children: React.ReactNode) => (
    <table className="w-full border-collapse text-xs text-[var(--color-text)]">
      {children}
    </table>
  );
  const rowCls =
    "border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surfaceHover)]";
  const headCls =
    "sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)]";

  switch (view) {
    case "servers":
      if (servers.length === 0) return empty;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.name", "Name")}</Th>
              <Th>{t("integrations.exchange.servers.field.fqdn", "FQDN")}</Th>
              <Th>{t("integrations.exchange.servers.field.roles", "Roles")}</Th>
              <Th>{t("integrations.exchange.servers.field.version", "Version")}</Th>
              <Th>{t("integrations.exchange.servers.field.dag", "In DAG")}</Th>
              <th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.name} className={rowCls}>
                <Td>{dash(s.name)}</Td>
                <Td>{dash(s.fqdn)}</Td>
                <Td>{s.roles?.join(", ") || "—"}</Td>
                <Td>{dash(s.adminDisplayVersion)}</Td>
                <Td>{s.isMemberOfDag ? t("integrations.exchange.servers.yes", "Yes") : t("integrations.exchange.servers.no", "No")}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.serverDetail", "Server: {{name}}", { name: s.name }),
                          () => api.getServer(s.name),
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.detail", "Details")}
                    >
                      <Server size={13} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.componentState", "Component state: {{name}}", { name: s.name }),
                          () => api.getServerComponentState(s.name),
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.componentState", "Component state")}
                    >
                      <Boxes size={13} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.testReplication", "Replication health: {{name}}", { name: s.name }),
                          () => api.testReplicationHealth(s.name),
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.testReplication", "Test replication health")}
                    >
                      <HardDrive size={13} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.testServiceHealth", "Service health: {{name}}", { name: s.name }),
                          () => api.testServiceHealth(s.name),
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.testServiceHealth", "Test service health")}
                    >
                      <Activity size={13} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </>,
      );

    case "databases":
      if (databases.length === 0) return empty;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.name", "Name")}</Th>
              <Th>{t("integrations.exchange.servers.field.server", "Server")}</Th>
              <Th>{t("integrations.exchange.servers.field.mountStatus", "Mount status")}</Th>
              <Th>{t("integrations.exchange.servers.field.size", "Size")}</Th>
              <Th>{t("integrations.exchange.servers.field.mailboxCount", "Mailboxes")}</Th>
              <th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {databases.map((d) => (
              <tr key={d.name} className={rowCls}>
                <Td>{dash(d.name)}</Td>
                <Td>{dash(d.server)}</Td>
                <Td>{dash(d.mountStatus)}</Td>
                <Td>{dash(d.databaseSize)}</Td>
                <Td>{d.mailboxCount ?? 0}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.dbDetail", "Database: {{name}}", { name: d.name }),
                          () => api.getDatabase(d.name),
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.detail", "Details")}
                    >
                      <Database size={13} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.mount", "Mount"),
                          () => api.mountDatabase(d.name),
                          true,
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.mount", "Mount")}
                    >
                      <Play size={13} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.dismount", "Dismount"),
                          () => api.dismountDatabase(d.name),
                          true,
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.dismount", "Dismount")}
                    >
                      <Square size={13} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </>,
      );

    case "dags":
      if (dags.length === 0) return empty;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.name", "Name")}</Th>
              <Th>{t("integrations.exchange.servers.field.members", "Members")}</Th>
              <Th>{t("integrations.exchange.servers.field.witness", "Witness")}</Th>
              <th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {dags.map((g) => (
              <tr key={g.name} className={rowCls}>
                <Td>{dash(g.name)}</Td>
                <Td>{g.servers?.join(", ") || "—"}</Td>
                <Td>{dash(g.witnessServer)}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.dagDetail", "DAG: {{name}}", { name: g.name }),
                          () => api.getDag(g.name),
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.detail", "Details")}
                    >
                      <Boxes size={13} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          t("integrations.exchange.servers.copyStatus", "Copy status: {{name}}", { name: g.name }),
                          () => api.getDagCopyStatus(undefined, undefined),
                        )
                      }
                      className={ICON_BTN}
                      title={t("integrations.exchange.servers.copyStatus", "Copy status")}
                    >
                      <HardDrive size={13} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </>,
      );

    case "replication":
      if (replication.length === 0) return empty;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.database", "Database")}</Th>
              <Th>{t("integrations.exchange.servers.field.server", "Server")}</Th>
              <Th>{t("integrations.exchange.servers.field.status", "Status")}</Th>
              <Th>{t("integrations.exchange.servers.field.copyQueue", "Copy queue")}</Th>
              <Th>{t("integrations.exchange.servers.field.replayQueue", "Replay queue")}</Th>
              <Th>{t("integrations.exchange.servers.field.indexState", "Index state")}</Th>
            </tr>
          </thead>
          <tbody>
            {replication.map((r, i) => (
              <tr key={`${r.databaseName}-${r.server}-${i}`} className={rowCls}>
                <Td>{dash(r.databaseName)}</Td>
                <Td>{dash(r.server)}</Td>
                <Td>{dash(r.status)}</Td>
                <Td>{r.copyQueueLength ?? 0}</Td>
                <Td>{r.replayQueueLength ?? 0}</Td>
                <Td>{dash(r.contentIndexState)}</Td>
              </tr>
            ))}
          </tbody>
        </>,
      );

    case "serviceHealth":
      if (serviceHealth.length === 0) return empty;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.service", "Service")}</Th>
              <Th>{t("integrations.exchange.servers.field.status", "Status")}</Th>
              <Th>{t("integrations.exchange.servers.field.features", "Features")}</Th>
            </tr>
          </thead>
          <tbody>
            {serviceHealth.map((h, i) => (
              <tr key={`${h.service}-${i}`} className={rowCls}>
                <Td>{dash(h.service)}</Td>
                <Td>{dash(h.statusDisplayName ?? h.status)}</Td>
                <Td>{h.featureStatus?.length ?? 0}</Td>
              </tr>
            ))}
          </tbody>
        </>,
      );

    case "migrationBatches":
      if (migrationBatches.length === 0) return empty;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.identity", "Identity")}</Th>
              <Th>{t("integrations.exchange.servers.field.status", "Status")}</Th>
              <Th>{t("integrations.exchange.servers.field.type", "Type")}</Th>
              <Th>{t("integrations.exchange.servers.field.progress", "Synced / Total")}</Th>
              <th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {migrationBatches.map((b) => (
              <tr key={b.id || b.identity} className={rowCls}>
                <Td>{dash(b.identity)}</Td>
                <Td>{dash(b.status)}</Td>
                <Td>{dash(b.migrationType)}</Td>
                <Td>{`${b.syncedCount ?? 0} / ${b.totalCount ?? 0}`}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <button disabled={busy} onClick={() => run(t("integrations.exchange.servers.batchDetail", "Batch: {{id}}", { id: b.identity }), () => api.getMigrationBatch(b.identity))} className={ICON_BTN} title={t("integrations.exchange.servers.detail", "Details")}>
                      <Boxes size={13} />
                    </button>
                    <button disabled={busy} onClick={() => run(t("integrations.exchange.servers.migrationUsers", "Migration users"), () => api.listMigrationUsers(b.id || b.identity))} className={ICON_BTN} title={t("integrations.exchange.servers.migrationUsers", "Migration users")}>
                      <Users size={13} />
                    </button>
                    <button disabled={busy} onClick={() => run(t("integrations.exchange.servers.start", "Start"), () => api.startMigrationBatch(b.identity), true)} className={ICON_BTN} title={t("integrations.exchange.servers.start", "Start")}>
                      <Play size={13} />
                    </button>
                    <button disabled={busy} onClick={() => run(t("integrations.exchange.servers.stop", "Stop"), () => api.stopMigrationBatch(b.identity), true)} className={ICON_BTN} title={t("integrations.exchange.servers.stop", "Stop")}>
                      <Square size={13} />
                    </button>
                    <button disabled={busy} onClick={() => run(t("integrations.exchange.servers.complete", "Complete"), () => api.completeMigrationBatch(b.identity), true)} className={ICON_BTN} title={t("integrations.exchange.servers.complete", "Complete")}>
                      <ShieldCheck size={13} />
                    </button>
                    <button disabled={busy} onClick={() => void removeThen(() => api.removeMigrationBatch(b.identity), "migrationBatches")} className={ICON_BTN} title={t("integrations.exchange.servers.remove", "Remove")}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </>,
      );

    case "moveRequests":
      if (moveRequests.length === 0) return empty;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.identity", "Identity")}</Th>
              <Th>{t("integrations.exchange.servers.field.status", "Status")}</Th>
              <Th>{t("integrations.exchange.servers.field.percent", "Percent")}</Th>
              <Th>{t("integrations.exchange.servers.field.targetDb", "Target DB")}</Th>
              <th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {moveRequests.map((m) => (
              <tr key={m.identity} className={rowCls}>
                <Td>{dash(m.identity)}</Td>
                <Td>{dash(m.status)}</Td>
                <Td>{`${m.percentComplete ?? 0}%`}</Td>
                <Td>{dash(m.targetDatabase)}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <button disabled={busy} onClick={() => run(t("integrations.exchange.servers.moveStats", "Move statistics: {{id}}", { id: m.identity }), () => api.getMoveRequestStatistics(m.identity))} className={ICON_BTN} title={t("integrations.exchange.servers.statistics", "Statistics")}>
                      <Activity size={13} />
                    </button>
                    <button disabled={busy} onClick={() => void removeThen(() => api.removeMoveRequest(m.identity), "moveRequests")} className={ICON_BTN} title={t("integrations.exchange.servers.remove", "Remove")}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </>,
      );

    case "importRequests":
    case "exportRequests": {
      const rows = view === "importRequests" ? importRequests : exportRequests;
      if (rows.length === 0) return empty;
      const remove =
        view === "importRequests"
          ? api.removeMailboxImportRequest
          : api.removeMailboxExportRequest;
      return wrap(
        <>
          <thead className={headCls}>
            <tr>
              <Th>{t("integrations.exchange.servers.field.name", "Name")}</Th>
              <Th>{t("integrations.exchange.servers.field.mailbox", "Mailbox")}</Th>
              <Th>{t("integrations.exchange.servers.field.status", "Status")}</Th>
              <Th>{t("integrations.exchange.servers.field.percent", "Percent")}</Th>
              <Th>{t("integrations.exchange.servers.field.filePath", "File path")}</Th>
              <th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`} className={rowCls}>
                <Td>{dash(r.name)}</Td>
                <Td>{dash(r.mailbox)}</Td>
                <Td>{dash(r.status)}</Td>
                <Td>{`${r.percentComplete ?? 0}%`}</Td>
                <Td>{dash(r.filePath)}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <button disabled={busy} onClick={() => void removeThen(() => remove(r.name), view)} className={ICON_BTN} title={t("integrations.exchange.servers.remove", "Remove")}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </>,
      );
    }

    default:
      return empty;
  }
};

// ─── Create form (move / import / export requests) ────────────────────────────

interface FormField {
  name: string;
  labelKey: string;
  labelDefault: string;
  placeholder?: string;
}

const FORM_FIELDS: Record<
  "moveRequests" | "importRequests" | "exportRequests",
  FormField[]
> = {
  moveRequests: [
    { name: "identity", labelKey: "integrations.exchange.servers.field.mailbox", labelDefault: "Mailbox" },
    { name: "targetDatabase", labelKey: "integrations.exchange.servers.field.targetDb", labelDefault: "Target DB" },
    { name: "batchName", labelKey: "integrations.exchange.servers.field.batchName", labelDefault: "Batch name (optional)" },
  ],
  importRequests: [
    { name: "mailbox", labelKey: "integrations.exchange.servers.field.mailbox", labelDefault: "Mailbox" },
    { name: "filePath", labelKey: "integrations.exchange.servers.field.filePath", labelDefault: "File path", placeholder: "\\\\server\\share\\file.pst" },
    { name: "targetRootFolder", labelKey: "integrations.exchange.servers.field.targetRootFolder", labelDefault: "Target root folder (optional)" },
  ],
  exportRequests: [
    { name: "mailbox", labelKey: "integrations.exchange.servers.field.mailbox", labelDefault: "Mailbox" },
    { name: "filePath", labelKey: "integrations.exchange.servers.field.filePath", labelDefault: "File path", placeholder: "\\\\server\\share\\file.pst" },
    { name: "includeFolders", labelKey: "integrations.exchange.servers.field.includeFolders", labelDefault: "Include folders (comma-separated)" },
    { name: "excludeFolders", labelKey: "integrations.exchange.servers.field.excludeFolders", labelDefault: "Exclude folders (comma-separated)" },
  ],
};

interface CreateFormProps {
  view: ExchangeServersView;
  form: Record<string, string>;
  busy: boolean;
  onField: (k: string, v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

const CreateForm: React.FC<CreateFormProps> = ({
  view,
  form,
  busy,
  onField,
  onCancel,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const fields = useMemo(
    () =>
      FORM_FIELDS[view as "moveRequests" | "importRequests" | "exportRequests"],
    [view],
  );
  if (!fields) return null;

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-text)]">
          {t("integrations.exchange.servers.createTitle", "New request")}
        </span>
        <button onClick={onCancel} className={ICON_BTN}>
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {t(f.labelKey, f.labelDefault)}
            </span>
            <input
              className={INPUT_CLS}
              value={form[f.name] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => onField(f.name, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plus size={12} />
          )}
          {t("integrations.exchange.servers.create", "Create")}
        </button>
        <button
          onClick={onCancel}
          className="app-bar-button px-3 py-1.5 text-xs"
        >
          {t("integrations.exchange.servers.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
};

export default ExchangeServersTab;
