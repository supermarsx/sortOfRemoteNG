// LXD / Incus — "Instances" sub-tab (t42-lxd-c1).
//
// Binds all 37 compute-lifecycle commands across four grouped sections:
//   Instances (23) · Snapshots (6) · Backups (5) · Migration/Copy/Publish (3)
// The instance list loads via `list_instances` / `list_containers` /
// `list_virtual_machines` (filter). A selected instance opens a detail pane whose
// grouped action rows map 1:1 onto the remaining commands (lifecycle, state,
// exec/console, logs, files, snapshots, backups, migrate/copy/publish). Mounted
// only when the panel shell is connected, so every command targets the single
// active `LxdService` connection.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  Play,
  Square,
  RotateCw,
  Snowflake,
  Sun,
  Terminal,
  FileText,
  Camera,
  Archive,
  Send,
  Copy,
  UploadCloud,
  ChevronRight,
  ChevronDown,
  X,
} from "lucide-react";

import {
  useLxdInstances,
  type LxdInstancesManager,
} from "../../../hooks/integration/lxd/useLxdInstances";
import type { LxdTabProps } from "./registry";
import type {
  CreateInstanceRequest,
  Instance,
  InstanceBackup,
  InstanceExecResult,
  InstanceSnapshot,
  InstanceState,
} from "../../../types/lxd/instances";

// ─── Shared styling (mirrors the panel shell) ──────────────────────────────────

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-[11px] font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";
const primaryBtn =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50";

type ListFilter = "all" | "containers" | "vms";

const FILTER_LABELS: Record<ListFilter, string> = {
  all: "All",
  containers: "Containers",
  vms: "VMs",
};

const CREATE_TEMPLATE: CreateInstanceRequest = {
  name: "",
  source: { type: "image", alias: "ubuntu/22.04", server: "https://images.linuxcontainers.org", protocol: "simplestreams" },
  start: true,
  ephemeral: false,
};

const LxdInstancesTab: React.FC<LxdTabProps> = ({ connected }) => {
  const { t } = useTranslation();
  const mgr = useLxdInstances();
  const { run, isLoading, error, clearError } = mgr;

  const [filter, setFilter] = useState<ListFilter>("all");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async () => {
    const list = await run((a) =>
      filter === "containers"
        ? a.listContainers()
        : filter === "vms"
          ? a.listVirtualMachines()
          : a.listInstances(),
    );
    if (list) setInstances(list);
  }, [run, filter]);

  useEffect(() => {
    if (connected) void reload();
    else {
      setInstances([]);
      setSelected(null);
    }
  }, [connected, reload]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.name === selected) ?? null,
    [instances, selected],
  );

  if (!connected) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-textSecondary)]">
        {t(
          "integrations.lxd.instances.notConnected",
          "Connect to an LXD server to manage instances.",
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-[var(--color-border)]">
          {(["all", "containers", "vms"] as ListFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-[11px] ${
                filter === f
                  ? "bg-primary text-white"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
              }`}
            >
              {t(`integrations.lxd.instances.filter.${f}`, FILTER_LABELS[f])}
            </button>
          ))}
        </div>
        <button onClick={() => void reload()} className={btnClass} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("integrations.lxd.instances.refresh", "Refresh")}
        </button>
        <button onClick={() => setShowCreate((s) => !s)} className={primaryBtn}>
          <Plus size={12} />
          {t("integrations.lxd.instances.new", "New instance")}
        </button>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          <span className="break-all">{error}</span>
          <button onClick={clearError}>
            <X size={12} />
          </button>
        </div>
      )}

      {showCreate && (
        <CreateInstanceForm
          mgr={mgr}
          onDone={() => {
            setShowCreate(false);
            void reload();
          }}
        />
      )}

      {/* Instance list */}
      <div className="overflow-hidden rounded border border-[var(--color-border)]">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]">
            <tr>
              <th className="px-2 py-1"></th>
              <th className="px-2 py-1">
                {t("integrations.lxd.instances.col.name", "Name")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.lxd.instances.col.type", "Type")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.lxd.instances.col.status", "Status")}
              </th>
              <th className="px-2 py-1 text-right">
                {t("integrations.lxd.instances.col.actions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {instances.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-4 text-center text-[var(--color-textSecondary)]"
                >
                  {t("integrations.lxd.instances.empty", "No instances.")}
                </td>
              </tr>
            )}
            {instances.map((inst) => {
              const open = selected === inst.name;
              return (
                <React.Fragment key={inst.name}>
                  <tr className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1">
                      <button
                        onClick={() => setSelected(open ? null : inst.name)}
                        aria-label="toggle"
                      >
                        {open ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-1 font-medium text-[var(--color-text)]">
                      {inst.name}
                    </td>
                    <td className="px-2 py-1">{inst.type ?? "—"}</td>
                    <td className="px-2 py-1">
                      <StatusBadge status={inst.status} />
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex justify-end gap-1">
                        <IconBtn
                          title={t("integrations.lxd.instances.action.start", "Start")}
                          onClick={() =>
                            run((a) => a.startInstance(inst.name, false)).then(
                              reload,
                            )
                          }
                        >
                          <Play size={12} />
                        </IconBtn>
                        <IconBtn
                          title={t("integrations.lxd.instances.action.stop", "Stop")}
                          onClick={() =>
                            run((a) =>
                              a.stopInstance(inst.name, false, false),
                            ).then(reload)
                          }
                        >
                          <Square size={12} />
                        </IconBtn>
                        <IconBtn
                          title={t("integrations.lxd.instances.action.restart", "Restart")}
                          onClick={() =>
                            run((a) =>
                              a.restartInstance(inst.name, false),
                            ).then(reload)
                          }
                        >
                          <RotateCw size={12} />
                        </IconBtn>
                        <IconBtn
                          title={t("integrations.lxd.instances.action.freeze", "Freeze")}
                          onClick={() =>
                            run((a) => a.freezeInstance(inst.name)).then(reload)
                          }
                        >
                          <Snowflake size={12} />
                        </IconBtn>
                        <IconBtn
                          title={t("integrations.lxd.instances.action.unfreeze", "Unfreeze")}
                          onClick={() =>
                            run((a) => a.unfreezeInstance(inst.name)).then(
                              reload,
                            )
                          }
                        >
                          <Sun size={12} />
                        </IconBtn>
                        <IconBtn
                          title={t("integrations.lxd.instances.action.delete", "Delete")}
                          onClick={() =>
                            run((a) => a.deleteInstance(inst.name)).then(reload)
                          }
                        >
                          <Trash2 size={12} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                  {open && selectedInstance && (
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40">
                      <td colSpan={5} className="px-2 py-2">
                        <InstanceDetail
                          mgr={mgr}
                          instance={selectedInstance}
                          onChanged={reload}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Instance detail: grouped command sections ─────────────────────────────────

const InstanceDetail: React.FC<{
  mgr: LxdInstancesManager;
  instance: Instance;
  onChanged: () => Promise<void>;
}> = ({ mgr, instance, onChanged }) => {
  const { t } = useTranslation();
  const name = instance.name;

  return (
    <div className="flex flex-col gap-3">
      <LifecycleSection mgr={mgr} name={name} onChanged={onChanged} />
      <StateSection mgr={mgr} name={name} />
      <ExecConsoleSection mgr={mgr} name={name} />
      <LogsFilesSection mgr={mgr} name={name} />
      <SnapshotsSection mgr={mgr} name={name} />
      <BackupsSection mgr={mgr} name={name} />
      <MigrateSection mgr={mgr} name={name} onChanged={onChanged} />
      <div className="text-[10px] text-[var(--color-textSecondary)]">
        {t("integrations.lxd.instances.detail.hint", "Actions target")} {name}
      </div>
    </div>
  );
};

/** Collapsible titled group. */
const Group: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-[var(--color-border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[var(--color-text)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && <div className="border-t border-[var(--color-border)] p-2">{children}</div>}
    </div>
  );
};

// ── Lifecycle: rename, copy, patch, update, start/stop with options ──────────--
const LifecycleSection: React.FC<{
  mgr: LxdInstancesManager;
  name: string;
  onChanged: () => Promise<void>;
}> = ({ mgr, name, onChanged }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [newName, setNewName] = useState("");
  const [copyName, setCopyName] = useState("");
  const [description, setDescription] = useState("");
  const [patchJson, setPatchJson] = useState('{\n  "config": {}\n}');
  const [stopTimeout, setStopTimeout] = useState("30");

  return (
    <Group title={t("integrations.lxd.instances.group.lifecycle", "Lifecycle")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.instances.rename", "Rename to")}
          </label>
          <div className="flex gap-1">
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button
              className={btnClass}
              disabled={!newName.trim()}
              onClick={() =>
                run((a) => a.renameInstance(name, newName.trim()))
                  .then(() => setNewName(""))
                  .then(onChanged)
              }
            >
              {t("integrations.lxd.instances.apply", "Apply")}
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.instances.copyTo", "Copy to (stateless)")}
          </label>
          <div className="flex gap-1">
            <input className={inputClass} value={copyName} onChange={(e) => setCopyName(e.target.value)} />
            <button
              className={btnClass}
              disabled={!copyName.trim()}
              onClick={() =>
                run((a) => a.copyInstance(name, copyName.trim(), true, false))
                  .then(() => setCopyName(""))
                  .then(onChanged)
              }
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.instances.updateDesc", "Set description")}
          </label>
          <div className="flex gap-1">
            <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
            <button
              className={btnClass}
              onClick={() =>
                run((a) => a.updateInstance({ name, description })).then(onChanged)
              }
            >
              {t("integrations.lxd.instances.save", "Save")}
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.instances.stopTimeout", "Stop timeout (s)")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              type="number"
              value={stopTimeout}
              onChange={(e) => setStopTimeout(e.target.value)}
            />
            <button
              className={btnClass}
              onClick={() =>
                run((a) =>
                  a.stopInstance(name, true, false, Number(stopTimeout) || undefined),
                ).then(onChanged)
              }
            >
              {t("integrations.lxd.instances.forceStop", "Force stop")}
            </button>
            <button
              className={btnClass}
              onClick={() => run((a) => a.startInstance(name, true)).then(onChanged)}
            >
              {t("integrations.lxd.instances.startStateful", "Start (stateful)")}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2">
        <label className={labelClass}>
          {t("integrations.lxd.instances.patch", "Patch (JSON — partial config/devices)")}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={3}
          value={patchJson}
          onChange={(e) => setPatchJson(e.target.value)}
        />
        <button
          className={`${btnClass} mt-1`}
          onClick={() => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(patchJson);
            } catch {
              return;
            }
            void run((a) => a.patchInstance(name, parsed)).then(onChanged);
          }}
        >
          {t("integrations.lxd.instances.applyPatch", "Apply patch")}
        </button>
      </div>
    </Group>
  );
};

// ── State: get_instance + get_instance_state ─────────────────────────────────--
const StateSection: React.FC<{ mgr: LxdInstancesManager; name: string }> = ({
  mgr,
  name,
}) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [detail, setDetail] = useState<Instance | null>(null);
  const [state, setState] = useState<InstanceState | null>(null);

  return (
    <Group title={t("integrations.lxd.instances.group.state", "State & details")}>
      <div className="flex gap-1">
        <button
          className={btnClass}
          onClick={() => run((a) => a.getInstance(name)).then((d) => d && setDetail(d))}
        >
          {t("integrations.lxd.instances.loadDetail", "Load details")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getInstanceState(name)).then((s) => s && setState(s))
          }
        >
          {t("integrations.lxd.instances.loadState", "Load live state")}
        </button>
      </div>
      {state && (
        <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-[var(--color-textSecondary)] sm:grid-cols-4">
          <Stat label={t("integrations.lxd.instances.stat.status", "Status")} value={state.status} />
          <Stat label={t("integrations.lxd.instances.stat.pid", "PID")} value={state.pid} />
          <Stat
            label={t("integrations.lxd.instances.stat.procs", "Processes")}
            value={state.processes}
          />
          <Stat
            label={t("integrations.lxd.instances.stat.mem", "Memory (bytes)")}
            value={state.memory?.usage}
          />
        </div>
      )}
      {detail && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </Group>
  );
};

// ── Exec + console ───────────────────────────────────────────────────────────--
const ExecConsoleSection: React.FC<{ mgr: LxdInstancesManager; name: string }> = ({
  mgr,
  name,
}) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [command, setCommand] = useState("/bin/sh -c 'uname -a'");
  const [result, setResult] = useState<InstanceExecResult | string | null>(null);

  return (
    <Group
      title={t("integrations.lxd.instances.group.exec", "Exec & console")}
      icon={<Terminal size={12} />}
    >
      <label className={labelClass}>
        {t("integrations.lxd.instances.command", "Command")}
      </label>
      <div className="flex gap-1">
        <input className={inputClass} value={command} onChange={(e) => setCommand(e.target.value)} />
        <button
          className={primaryBtn}
          onClick={() =>
            run((a) =>
              a.execInstance(name, {
                command: command.trim().split(/\s+/),
                wait_for_websocket: false,
                record_output: true,
              }),
            ).then((op) => op && setResult(JSON.stringify(op.metadata ?? op)))
          }
        >
          {t("integrations.lxd.instances.exec", "Exec")}
        </button>
      </div>
      <div className="mt-2 flex gap-1">
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.consoleInstance(name, { type: "console" })).then(
              (op) => op && setResult(JSON.stringify(op)),
            )
          }
        >
          {t("integrations.lxd.instances.openConsole", "Open console")}
        </button>
        <button className={btnClass} onClick={() => run((a) => a.clearConsoleLog(name))}>
          {t("integrations.lxd.instances.clearConsole", "Clear console log")}
        </button>
      </div>
      {result && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
          {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </Group>
  );
};

// ── Logs + files ─────────────────────────────────────────────────────────────--
const LogsFilesSection: React.FC<{ mgr: LxdInstancesManager; name: string }> = ({
  mgr,
  name,
}) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [logs, setLogs] = useState<string[]>([]);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [filePath, setFilePath] = useState("/etc/hostname");
  const [fileContent, setFileContent] = useState("");

  return (
    <Group
      title={t("integrations.lxd.instances.group.logsFiles", "Logs & files")}
      icon={<FileText size={12} />}
    >
      <div className="flex gap-1">
        <button
          className={btnClass}
          onClick={() => run((a) => a.listInstanceLogs(name)).then((l) => l && setLogs(l))}
        >
          {t("integrations.lxd.instances.listLogs", "List logs")}
        </button>
      </div>
      {logs.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {logs.map((f) => (
            <li key={f}>
              <button
                className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] hover:bg-[var(--color-surfaceHover)]"
                onClick={() =>
                  run((a) => a.getInstanceLog(name, f)).then(
                    (c) => c != null && setLogContent(c),
                  )
                }
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
      )}
      {logContent && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
          {logContent}
        </pre>
      )}

      <div className="mt-3">
        <label className={labelClass}>
          {t("integrations.lxd.instances.filePath", "File path")}
        </label>
        <div className="flex gap-1">
          <input className={inputClass} value={filePath} onChange={(e) => setFilePath(e.target.value)} />
          <button
            className={btnClass}
            onClick={() =>
              run((a) => a.getInstanceFile(name, filePath)).then(
                (c) => c != null && setFileContent(c),
              )
            }
          >
            {t("integrations.lxd.instances.getFile", "Get")}
          </button>
          <button
            className={btnClass}
            onClick={() => run((a) => a.deleteInstanceFile(name, filePath))}
          >
            <Trash2 size={12} />
          </button>
        </div>
        <textarea
          className={`${inputClass} mt-1 font-mono`}
          rows={3}
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          placeholder={t("integrations.lxd.instances.fileContent", "File content")}
        />
        <button
          className={`${btnClass} mt-1`}
          onClick={() =>
            run((a) => a.pushInstanceFile(name, filePath, fileContent))
          }
        >
          <UploadCloud size={12} />
          {t("integrations.lxd.instances.pushFile", "Push file")}
        </button>
      </div>
    </Group>
  );
};

// ── Snapshots (6) ────────────────────────────────────────────────────────────--
const SnapshotsSection: React.FC<{ mgr: LxdInstancesManager; name: string }> = ({
  mgr,
  name,
}) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [snaps, setSnaps] = useState<InstanceSnapshot[]>([]);
  const [snapName, setSnapName] = useState("");
  const [renameTo, setRenameTo] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<InstanceSnapshot | null>(null);

  const reload = useCallback(
    () => run((a) => a.listSnapshots(name)).then((s) => s && setSnaps(s)),
    [run, name],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Group
      title={t("integrations.lxd.instances.group.snapshots", "Snapshots")}
      icon={<Camera size={12} />}
    >
      <div className="flex gap-1">
        <input
          className={inputClass}
          value={snapName}
          onChange={(e) => setSnapName(e.target.value)}
          placeholder={t("integrations.lxd.instances.snapName", "Snapshot name")}
        />
        <button
          className={primaryBtn}
          disabled={!snapName.trim()}
          onClick={() =>
            run((a) => a.createSnapshot({ instance: name, name: snapName.trim(), stateful: false }))
              .then(() => setSnapName(""))
              .then(reload)
          }
        >
          <Plus size={12} />
        </button>
        <button className={btnClass} onClick={reload}>
          <RefreshCw size={12} />
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {snaps.map((s) => (
          <li
            key={s.name}
            className="flex flex-wrap items-center gap-1 rounded border border-[var(--color-border)] px-1 py-1 text-[11px]"
          >
            <span className="font-medium text-[var(--color-text)]">{s.name}</span>
            <span className="text-[var(--color-textSecondary)]">{s.created_at ?? ""}</span>
            <div className="ml-auto flex items-center gap-1">
              <input
                className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-[10px]"
                value={renameTo[s.name] ?? ""}
                onChange={(e) => setRenameTo((m) => ({ ...m, [s.name]: e.target.value }))}
                placeholder={t("integrations.lxd.instances.newName", "new name")}
              />
              <IconBtn
                title={t("integrations.lxd.instances.rename", "Rename")}
                onClick={() =>
                  run((a) => a.renameSnapshot(name, s.name, (renameTo[s.name] ?? "").trim())).then(
                    reload,
                  )
                }
              >
                <Send size={11} />
              </IconBtn>
              <IconBtn
                title={t("integrations.lxd.instances.restore", "Restore")}
                onClick={() =>
                  run((a) => a.restoreSnapshot({ instance: name, snapshot: s.name, stateful: false }))
                }
              >
                <RotateCw size={11} />
              </IconBtn>
              <IconBtn
                title={t("integrations.lxd.instances.view", "View")}
                onClick={() =>
                  run((a) => a.getSnapshot(name, s.name)).then((d) => d && setDetail(d))
                }
              >
                <FileText size={11} />
              </IconBtn>
              <IconBtn
                title={t("integrations.lxd.instances.action.delete", "Delete")}
                onClick={() => run((a) => a.deleteSnapshot(name, s.name)).then(reload)}
              >
                <Trash2 size={11} />
              </IconBtn>
            </div>
          </li>
        ))}
      </ul>
      {detail && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </Group>
  );
};

// ── Backups (5) ──────────────────────────────────────────────────────────────--
const BackupsSection: React.FC<{ mgr: LxdInstancesManager; name: string }> = ({
  mgr,
  name,
}) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [backups, setBackups] = useState<InstanceBackup[]>([]);
  const [backupName, setBackupName] = useState("");
  const [renameTo, setRenameTo] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<InstanceBackup | null>(null);

  const reload = useCallback(
    () => run((a) => a.listBackups(name)).then((b) => b && setBackups(b)),
    [run, name],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Group
      title={t("integrations.lxd.instances.group.backups", "Backups")}
      icon={<Archive size={12} />}
    >
      <div className="flex gap-1">
        <input
          className={inputClass}
          value={backupName}
          onChange={(e) => setBackupName(e.target.value)}
          placeholder={t("integrations.lxd.instances.backupName", "Backup name")}
        />
        <button
          className={primaryBtn}
          disabled={!backupName.trim()}
          onClick={() =>
            run((a) =>
              a.createBackup({
                instance: name,
                name: backupName.trim(),
                instanceOnly: false,
                optimizedStorage: false,
              }),
            )
              .then(() => setBackupName(""))
              .then(reload)
          }
        >
          <Plus size={12} />
        </button>
        <button className={btnClass} onClick={reload}>
          <RefreshCw size={12} />
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {backups.map((b) => (
          <li
            key={b.name}
            className="flex flex-wrap items-center gap-1 rounded border border-[var(--color-border)] px-1 py-1 text-[11px]"
          >
            <span className="font-medium text-[var(--color-text)]">{b.name}</span>
            <span className="text-[var(--color-textSecondary)]">{b.created_at ?? ""}</span>
            <div className="ml-auto flex items-center gap-1">
              <input
                className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-[10px]"
                value={renameTo[b.name] ?? ""}
                onChange={(e) => setRenameTo((m) => ({ ...m, [b.name]: e.target.value }))}
                placeholder={t("integrations.lxd.instances.newName", "new name")}
              />
              <IconBtn
                title={t("integrations.lxd.instances.rename", "Rename")}
                onClick={() =>
                  run((a) => a.renameBackup(name, b.name, (renameTo[b.name] ?? "").trim())).then(
                    reload,
                  )
                }
              >
                <Send size={11} />
              </IconBtn>
              <IconBtn
                title={t("integrations.lxd.instances.view", "View")}
                onClick={() =>
                  run((a) => a.getBackup(name, b.name)).then((d) => d && setDetail(d))
                }
              >
                <FileText size={11} />
              </IconBtn>
              <IconBtn
                title={t("integrations.lxd.instances.action.delete", "Delete")}
                onClick={() => run((a) => a.deleteBackup(name, b.name)).then(reload)}
              >
                <Trash2 size={11} />
              </IconBtn>
            </div>
          </li>
        ))}
      </ul>
      {detail && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </Group>
  );
};

// ── Migrate / publish ────────────────────────────────────────────────────────--
const MigrateSection: React.FC<{
  mgr: LxdInstancesManager;
  name: string;
  onChanged: () => Promise<void>;
}> = ({ mgr, name, onChanged }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [targetServer, setTargetServer] = useState("");
  const [live, setLive] = useState(false);
  const [alias, setAlias] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  return (
    <Group
      title={t("integrations.lxd.instances.group.migrate", "Migrate & publish")}
      icon={<Send size={12} />}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.instances.targetServer", "Target server")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              value={targetServer}
              onChange={(e) => setTargetServer(e.target.value)}
              placeholder="https://other:8443"
            />
            <button
              className={btnClass}
              disabled={!targetServer.trim()}
              onClick={() =>
                run((a) =>
                  a.migrateInstance({ name, targetServer: targetServer.trim(), live }),
                ).then(onChanged)
              }
            >
              {t("integrations.lxd.instances.migrate", "Migrate")}
            </button>
          </div>
          <label className="mt-1 flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)]">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            {t("integrations.lxd.instances.live", "Live (stateful)")}
          </label>
        </div>
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.instances.publishAlias", "Publish as image (alias)")}
          </label>
          <div className="flex gap-1">
            <input className={inputClass} value={alias} onChange={(e) => setAlias(e.target.value)} />
            <button
              className={btnClass}
              onClick={() =>
                run((a) =>
                  a.publishInstance(name, alias.trim() || undefined, isPublic),
                )
              }
            >
              <UploadCloud size={12} />
            </button>
          </div>
          <label className="mt-1 flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)]">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            {t("integrations.lxd.instances.public", "Public image")}
          </label>
        </div>
      </div>
    </Group>
  );
};

// ─── Create instance form ──────────────────────────────────────────────────────

const CreateInstanceForm: React.FC<{
  mgr: LxdInstancesManager;
  onDone: () => void;
}> = ({ mgr, onDone }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [json, setJson] = useState(() => JSON.stringify(CREATE_TEMPLATE, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    let req: CreateInstanceRequest;
    try {
      req = JSON.parse(json) as CreateInstanceRequest;
    } catch (e) {
      setParseError((e as Error).message);
      return;
    }
    setParseError(null);
    const op = await run((a) => a.createInstance(req));
    if (op) onDone();
  }, [json, run, onDone]);

  return (
    <div className="rounded border border-[var(--color-border)] p-2">
      <label className={labelClass}>
        {t("integrations.lxd.instances.createReq", "Create instance request (JSON)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={10}
        value={json}
        onChange={(e) => setJson(e.target.value)}
      />
      {parseError && <p className="mt-1 text-[11px] text-red-500">{parseError}</p>}
      <div className="mt-2 flex gap-1">
        <button className={primaryBtn} onClick={() => void submit()} disabled={isLoading}>
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {t("integrations.lxd.instances.create", "Create")}
        </button>
        <button className={btnClass} onClick={onDone}>
          {t("integrations.lxd.instances.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
};

// ─── Small presentational helpers ──────────────────────────────────────────────

const StatusBadge: React.FC<{ status?: string | null }> = ({ status }) => {
  const s = (status ?? "").toLowerCase();
  const color =
    s === "running"
      ? "bg-green-500/15 text-green-500"
      : s === "frozen"
        ? "bg-blue-500/15 text-blue-500"
        : s === "stopped"
          ? "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          : "bg-yellow-500/15 text-yellow-600";
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${color}`}>
      {status ?? "—"}
    </span>
  );
};

const Stat: React.FC<{ label: string; value?: number | string | null }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] px-1.5 py-1">
    <div className="text-[10px] text-[var(--color-textSecondary)]">{label}</div>
    <div className="text-[11px] font-medium text-[var(--color-text)]">
      {value ?? "—"}
    </div>
  </div>
);

const IconBtn: React.FC<{
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ title, onClick, children }) => (
  <button
    title={title}
    onClick={onClick}
    className="rounded border border-[var(--color-border)] p-1 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
  >
    {children}
  </button>
);

export default LxdInstancesTab;
