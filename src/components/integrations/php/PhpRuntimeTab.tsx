// PhpRuntimeTab — "Runtime & FPM" sub-tab (t42-php-c1).
//
// Binds all 43 runtime commands across five grouped, collapsible sections:
//   Versions (8) · FPM Pools (9) · FPM Process/Service (13) · OPcache (7) · Sessions (6)
// Mounted only when the panel shell is connected, so `connectionId` is always a
// live PHP connection id — it is passed as the `id` arg to every command. Almost
// every command additionally takes a `version` string; the tab owns a shared PHP
// version selector (a read-only `php_list_versions` fetch, defaulting to the
// installed default) whose value flows into each section.

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Database,
  Layers,
  Loader2,
  Play,
  Pause,
  RefreshCw,
  RotateCw,
  Server,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import {
  usePhpRuntime,
  type PhpRuntimeManager,
} from "../../../hooks/integration/php/usePhpRuntime";
import type { PhpTabProps } from "./registry";
import type {
  CachedScript,
  ConfigTestResult,
  CreateFpmPoolRequest,
  FpmWorkerProcess,
  OpcacheConfig,
  OpcacheStatus,
  PhpFpmMasterProcess,
  PhpFpmPool,
  PhpFpmPoolStatus,
  PhpFpmServiceStatus,
  PhpSapi,
  PhpSessionConfig,
  PhpVersion,
  PhpVersionDetail,
  SessionStats,
  UpdateFpmPoolRequest,
  UpdateSessionConfigRequest,
} from "../../../types/php/runtime";

// ─── Shared styling (mirrors the panel shell + sibling tabs) ────────────────────

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-[11px] font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";
const primaryBtn =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50";
const dangerBtn =
  "flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-500 hover:bg-red-500/10 disabled:opacity-50";

/** Build the i18n key for a `runtime.*` fragment leaf. Pair with an English
 *  default at the call site so a missing key degrades gracefully pre-merge. */
const t9 = (key: string) => `integrations.php.runtime.${key}`;

const CREATE_POOL_TEMPLATE: CreateFpmPoolRequest = {
  name: "www",
  version: "8.3",
  user: "www-data",
  group: "www-data",
  listen: "/run/php/php8.3-fpm.sock",
  pm: "dynamic",
  max_children: 5,
  start_servers: 2,
  min_spare_servers: 1,
  max_spare_servers: 3,
};

const UPDATE_POOL_TEMPLATE: UpdateFpmPoolRequest = {
  max_children: 10,
  pm: "dynamic",
};

const OPCACHE_CONFIG_TEMPLATE: OpcacheConfig = {
  enable: true,
  memory_consumption: 128,
  max_accelerated_files: 10000,
  validate_timestamps: true,
  revalidate_freq: 2,
};

const SESSION_CONFIG_TEMPLATE: UpdateSessionConfigRequest = {
  version: "8.3",
  gc_maxlifetime: 1440,
  cookie_secure: true,
  cookie_httponly: true,
};

const PhpRuntimeTab: React.FC<PhpTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const mgr = usePhpRuntime();
  const { run, isLoading, error, clearError } = mgr;

  // Shared PHP version selector — read-only `php_list_versions`, defaulting to
  // the installed default. Its value is the `version` arg for every section.
  const [versions, setVersions] = useState<PhpVersion[]>([]);
  const [version, setVersion] = useState("");

  const reloadVersions = useCallback(async () => {
    const list = await run((a) => a.listVersions(connectionId));
    if (list) {
      setVersions(list);
      setVersion(
        (prev) =>
          prev || list.find((v) => v.is_default)?.version || list[0]?.version || "",
      );
    }
  }, [run, connectionId]);

  useEffect(() => {
    void reloadVersions();
  }, [reloadVersions]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Version selector + refresh */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label className={labelClass}>
            {t(t9("version"), "PHP version")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              list="php-runtime-versions"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder={t(t9("versionPlaceholder"), "8.3")}
            />
            <datalist id="php-runtime-versions">
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.is_default ? `${v.version} (default)` : v.version}
                </option>
              ))}
            </datalist>
            <button
              className={btnClass}
              onClick={() => void reloadVersions()}
              disabled={isLoading}
              title={t(t9("reloadVersions"), "Reload versions")}
            >
              {isLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </button>
          </div>
        </div>
        <span className="pb-1 text-[10px] text-[var(--color-textSecondary)]">
          {versions.length} {t(t9("versionsLoaded"), "versions installed")}
        </span>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          <span className="break-all">{error}</span>
          <button onClick={clearError}>
            <X size={12} />
          </button>
        </div>
      )}

      <VersionsSection mgr={mgr} id={connectionId} version={version} versions={versions} />
      <FpmPoolsSection mgr={mgr} id={connectionId} version={version} />
      <FpmProcessSection mgr={mgr} id={connectionId} version={version} />
      <OpcacheSection mgr={mgr} id={connectionId} version={version} />
      <SessionsSection mgr={mgr} id={connectionId} version={version} />
    </div>
  );
};

// ─── Collapsible titled group ───────────────────────────────────────────────---

const Group: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen, children }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded border border-[var(--color-border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-[var(--color-text)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-2">
          {children}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Versions (8)
// ═══════════════════════════════════════════════════════════════════════════════

const VersionsSection: React.FC<{
  mgr: PhpRuntimeManager;
  id: string;
  version: string;
  versions: PhpVersion[];
}> = ({ mgr, id, version, versions }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [defaultVersion, setDefaultVersion] = useState<PhpVersion | null>(null);
  const [detail, setDetail] = useState<PhpVersionDetail | null>(null);
  const [sapis, setSapis] = useState<PhpSapi[] | null>(null);
  const [sapi, setSapi] = useState("fpm");
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [extDir, setExtDir] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);

  return (
    <Group title={t(t9("versions.title"), "PHP Versions")} icon={<Layers size={12} />} defaultOpen>
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getDefaultVersion(id)).then((v) => v && setDefaultVersion(v))
          }
        >
          {t(t9("versions.default"), "Default version")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getVersionDetail(id, version)).then((d) => d && setDetail(d))
          }
        >
          {t(t9("versions.detail"), "Version detail")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.listSapis(id, version)).then((s) => s && setSapis(s))
          }
        >
          {t(t9("versions.sapis"), "List SAPIs")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getExtensionDir(id, version)).then(
              (d) => d !== undefined && setExtDir(d),
            )
          }
        >
          {t(t9("versions.extDir"), "Extension dir")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.checkVersionInstalled(id, version)).then(
              (b) => b !== undefined && setInstalled(b),
            )
          }
        >
          {t(t9("versions.check"), "Check installed")}
        </button>
        <button
          className={primaryBtn}
          disabled={!version}
          onClick={() => void run((a) => a.setDefaultVersion(id, version))}
        >
          {t(t9("versions.setDefault"), "Set as default")}
        </button>
      </div>

      {versions.length > 0 && (
        <RowList
          items={versions.map((v) => ({
            key: v.version,
            primary: v.version,
            secondary: `${v.sapis.join(", ")}${v.is_default ? " · default" : ""}`,
          }))}
        />
      )}

      {defaultVersion && (
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("versions.currentDefault"), "Current default")}: {defaultVersion.version}
        </p>
      )}
      {installed !== null && (
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          {version}: {installed ? t(t9("versions.yes"), "installed") : t(t9("versions.no"), "not installed")}
        </p>
      )}
      {extDir !== null && (
        <p className="break-all text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("versions.extDir"), "Extension dir")}: {extDir || "—"}
        </p>
      )}

      {sapis && (
        <div className="flex flex-col gap-1">
          <RowList
            items={sapis.map((s) => ({
              key: s.name,
              primary: s.name,
              secondary: s.config_file ?? s.binary_path ?? s.version,
              onClick: () => setSapi(s.name),
            }))}
          />
          <div>
            <label className={labelClass}>
              {t(t9("versions.configPath"), "php.ini path (by SAPI)")}
            </label>
            <div className="flex gap-1">
              <input
                className={`${inputClass} max-w-[160px]`}
                value={sapi}
                onChange={(e) => setSapi(e.target.value)}
                placeholder="fpm"
              />
              <button
                className={btnClass}
                disabled={!version || !sapi.trim()}
                onClick={() =>
                  run((a) => a.getConfigPath(id, version, sapi.trim())).then(
                    (p) => p !== undefined && setConfigPath(p),
                  )
                }
              >
                {t(t9("versions.resolvePath"), "Resolve")}
              </button>
            </div>
            {configPath !== null && (
              <p className="mt-1 break-all text-[11px] text-[var(--color-textSecondary)]">
                {configPath || "—"}
              </p>
            )}
          </div>
        </div>
      )}

      {detail && <Json value={detail} />}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// FPM Pools (9)
// ═══════════════════════════════════════════════════════════════════════════════

const FpmPoolsSection: React.FC<{
  mgr: PhpRuntimeManager;
  id: string;
  version: string;
}> = ({ mgr, id, version }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [pools, setPools] = useState<PhpFpmPool[] | null>(null);
  const [name, setName] = useState("");
  const [pool, setPool] = useState<PhpFpmPool | null>(null);
  const [status, setStatus] = useState<PhpFpmPoolStatus | null>(null);
  const [procs, setProcs] = useState<FpmWorkerProcess[] | null>(null);
  const [createJson, setCreateJson] = useState(() =>
    JSON.stringify(CREATE_POOL_TEMPLATE, null, 2),
  );
  const [updateJson, setUpdateJson] = useState(() =>
    JSON.stringify(UPDATE_POOL_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const reloadPools = useCallback(() => {
    if (!version) return Promise.resolve();
    return run((a) => a.listFpmPools(id, version)).then((p) => {
      if (p) {
        setPools(p);
        setName((prev) => prev || p[0]?.name || "");
      }
    });
  }, [run, id, version]);

  return (
    <Group title={t(t9("pools.title"), "FPM Pools")} icon={<Database size={12} />}>
      <div className="flex flex-wrap items-end gap-1">
        <button className={btnClass} disabled={!version} onClick={() => void reloadPools()}>
          <RefreshCw size={12} />
          {t(t9("pools.list"), "List pools")}
        </button>
        <input
          className={`${inputClass} max-w-[180px]`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(t9("pools.name"), "pool name (www)")}
          list="php-fpm-pool-names"
        />
        <datalist id="php-fpm-pool-names">
          {(pools ?? []).map((p) => (
            <option key={p.name} value={p.name} />
          ))}
        </datalist>
        <button
          className={btnClass}
          disabled={!version || !name.trim()}
          onClick={() =>
            run((a) => a.getFpmPool(id, version, name.trim())).then((p) => p && setPool(p))
          }
        >
          {t(t9("pools.load"), "Load")}
        </button>
        <button
          className={btnClass}
          disabled={!version || !name.trim()}
          onClick={() =>
            run((a) => a.getFpmPoolStatus(id, version, name.trim())).then(
              (s) => s && setStatus(s),
            )
          }
        >
          {t(t9("pools.status"), "Status")}
        </button>
        <button
          className={btnClass}
          disabled={!version || !name.trim()}
          onClick={() =>
            run((a) => a.listFpmPoolProcesses(id, version, name.trim())).then(
              (p) => p && setProcs(p),
            )
          }
        >
          {t(t9("pools.processes"), "Workers")}
        </button>
        <button
          className={btnClass}
          disabled={!version || !name.trim()}
          onClick={() =>
            run((a) => a.enableFpmPool(id, version, name.trim())).then(reloadPools)
          }
        >
          <Play size={12} />
          {t(t9("pools.enable"), "Enable")}
        </button>
        <button
          className={btnClass}
          disabled={!version || !name.trim()}
          onClick={() =>
            run((a) => a.disableFpmPool(id, version, name.trim())).then(reloadPools)
          }
        >
          <Pause size={12} />
          {t(t9("pools.disable"), "Disable")}
        </button>
        <button
          className={dangerBtn}
          disabled={!version || !name.trim()}
          onClick={() =>
            run((a) => a.deleteFpmPool(id, version, name.trim())).then(reloadPools)
          }
        >
          <Trash2 size={12} />
          {t(t9("pools.delete"), "Delete")}
        </button>
      </div>

      {pools && (
        <RowList
          items={pools.map((p) => ({
            key: p.name,
            primary: p.name,
            secondary: `${p.pm} · ${p.listen}${p.enabled ? "" : " · disabled"}`,
            onClick: () => setName(p.name),
          }))}
        />
      )}

      {status && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("pools.stat.active"), "Active")} value={status.active_processes} />
          <Stat label={t(t9("pools.stat.idle"), "Idle")} value={status.idle_processes} />
          <Stat label={t(t9("pools.stat.total"), "Total")} value={status.total_processes} />
          <Stat label={t(t9("pools.stat.accepted"), "Accepted")} value={status.accepted_conn} />
          <Stat label={t(t9("pools.stat.queue"), "Queue")} value={status.listen_queue} />
          <Stat label={t(t9("pools.stat.maxQueue"), "Max queue")} value={status.max_listen_queue} />
          <Stat label={t(t9("pools.stat.reached"), "Max reached")} value={status.max_children_reached} />
          <Stat label={t(t9("pools.stat.slow"), "Slow reqs")} value={status.slow_requests} />
        </div>
      )}
      {procs && (
        <RowList
          items={procs.map((p) => ({
            key: String(p.pid),
            primary: `PID ${p.pid} · ${p.state}`,
            secondary: `${p.requests} reqs${p.request_uri ? ` · ${p.request_uri}` : ""}`,
          }))}
        />
      )}
      {pool && <Json value={pool} />}

      {/* Create + update (JSON request bodies — snake_case struct fields) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t(t9("pools.createReq"), "Create pool (JSON)")}</label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={8}
            value={createJson}
            onChange={(e) => setCreateJson(e.target.value)}
          />
          <button
            className={`${primaryBtn} mt-1`}
            onClick={() => {
              let req: CreateFpmPoolRequest;
              try {
                req = JSON.parse(createJson) as CreateFpmPoolRequest;
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) => a.createFpmPool(id, req)).then(reloadPools);
            }}
          >
            {t(t9("pools.create"), "Create")}
          </button>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("pools.updateReq"), "Update selected pool (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={8}
            value={updateJson}
            onChange={(e) => setUpdateJson(e.target.value)}
          />
          <button
            className={`${btnClass} mt-1`}
            disabled={!version || !name.trim()}
            onClick={() => {
              let req: UpdateFpmPoolRequest;
              try {
                req = JSON.parse(updateJson) as UpdateFpmPoolRequest;
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) => a.updateFpmPool(id, version, name.trim(), req)).then(
                reloadPools,
              );
            }}
          >
            {t(t9("pools.update"), "Apply changes")}
          </button>
        </div>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// FPM Process / Service (13)
// ═══════════════════════════════════════════════════════════════════════════════

const FpmProcessSection: React.FC<{
  mgr: PhpRuntimeManager;
  id: string;
  version: string;
}> = ({ mgr, id, version }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [svc, setSvc] = useState<PhpFpmServiceStatus | null>(null);
  const [master, setMaster] = useState<PhpFpmMasterProcess | null>(null);
  const [pids, setPids] = useState<number[] | null>(null);
  const [test, setTest] = useState<ConfigTestResult | null>(null);
  const [services, setServices] = useState<PhpFpmServiceStatus[] | null>(null);

  const reloadStatus = useCallback(() => {
    if (!version) return Promise.resolve();
    return run((a) => a.getFpmServiceStatus(id, version)).then((s) => s && setSvc(s));
  }, [run, id, version]);

  const lifecycle = (
    fn: (api: PhpRuntimeManager["api"]) => Promise<void>,
  ) => run(fn).then(reloadStatus);

  return (
    <Group title={t(t9("process.title"), "FPM Process & Service")} icon={<Server size={12} />}>
      <div className="flex flex-wrap gap-1">
        <button className={btnClass} disabled={!version} onClick={() => void reloadStatus()}>
          <RefreshCw size={12} />
          {t(t9("process.status"), "Service status")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getFpmMasterProcess(id, version)).then((m) => m && setMaster(m))
          }
        >
          {t(t9("process.master"), "Master process")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.listFpmWorkerPids(id, version)).then((p) => p && setPids(p))
          }
        >
          {t(t9("process.pids"), "Worker PIDs")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.testFpmConfig(id, version)).then((r) => r && setTest(r))
          }
        >
          {t(t9("process.test"), "Test config")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.listAllFpmServices(id)).then((s) => s && setServices(s))
          }
        >
          {t(t9("process.listAll"), "All FPM services")}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        <button className={primaryBtn} disabled={!version} onClick={() => void lifecycle((a) => a.startFpm(id, version))}>
          <Play size={12} />
          {t(t9("process.start"), "Start")}
        </button>
        <button className={dangerBtn} disabled={!version} onClick={() => void lifecycle((a) => a.stopFpm(id, version))}>
          <Pause size={12} />
          {t(t9("process.stop"), "Stop")}
        </button>
        <button className={btnClass} disabled={!version} onClick={() => void lifecycle((a) => a.restartFpm(id, version))}>
          <RotateCw size={12} />
          {t(t9("process.restart"), "Restart")}
        </button>
        <button className={btnClass} disabled={!version} onClick={() => void lifecycle((a) => a.reloadFpm(id, version))}>
          {t(t9("process.reload"), "Reload")}
        </button>
        <button className={btnClass} disabled={!version} onClick={() => void lifecycle((a) => a.gracefulRestartFpm(id, version))}>
          {t(t9("process.graceful"), "Graceful restart")}
        </button>
        <button className={btnClass} disabled={!version} onClick={() => void run((a) => a.reopenFpmLogs(id, version))}>
          {t(t9("process.reopenLogs"), "Reopen logs")}
        </button>
        <button className={btnClass} disabled={!version} onClick={() => void lifecycle((a) => a.enableFpm(id, version))}>
          {t(t9("process.enable"), "Enable on boot")}
        </button>
        <button className={btnClass} disabled={!version} onClick={() => void lifecycle((a) => a.disableFpm(id, version))}>
          {t(t9("process.disable"), "Disable on boot")}
        </button>
      </div>

      {svc && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("process.stat.service"), "Service")} value={svc.service_name} />
          <Stat label={t(t9("process.stat.active"), "Active")} value={svc.active ? "yes" : "no"} />
          <Stat label={t(t9("process.stat.enabled"), "Enabled")} value={svc.enabled ? "yes" : "no"} />
          <Stat label={t(t9("process.stat.pid"), "Main PID")} value={svc.main_pid ?? svc.pid} />
          <Stat label={t(t9("process.stat.mem"), "Memory")} value={svc.memory_bytes} />
          <Stat label={t(t9("process.stat.cpu"), "CPU%")} value={svc.cpu_percent} />
          <Stat label={t(t9("process.stat.uptime"), "Uptime s")} value={svc.uptime_secs} />
          <Stat label={t(t9("process.stat.tasks"), "Tasks")} value={svc.tasks} />
        </div>
      )}
      {master && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("process.stat.masterPid"), "Master PID")} value={master.pid} />
          <Stat label={t(t9("process.stat.workers"), "Workers")} value={master.worker_count} />
          <Stat label={t(t9("process.stat.pools"), "Pools")} value={master.pool_count} />
          <Stat label={t(t9("process.stat.rss"), "RSS")} value={master.memory_rss} />
        </div>
      )}
      {pids && (
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("process.workerPids"), "Worker PIDs")}: {pids.join(", ") || "—"}
        </p>
      )}
      {test && (
        <div>
          <p className={`text-[11px] ${test.success ? "text-green-500" : "text-red-500"}`}>
            {test.success ? t(t9("process.testOk"), "Config OK") : t(t9("process.testFail"), "Config invalid")}
          </p>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
            {[test.output, ...test.errors].filter(Boolean).join("\n")}
          </pre>
        </div>
      )}
      {services && (
        <RowList
          items={services.map((s) => ({
            key: s.version,
            primary: `PHP ${s.version} · ${s.service_name}`,
            secondary: `${s.active ? "active" : "inactive"}${s.enabled ? " · enabled" : ""}`,
          }))}
        />
      )}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// OPcache (7)
// ═══════════════════════════════════════════════════════════════════════════════

const OpcacheSection: React.FC<{
  mgr: PhpRuntimeManager;
  id: string;
  version: string;
}> = ({ mgr, id, version }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [status, setStatus] = useState<OpcacheStatus | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [scripts, setScripts] = useState<CachedScript[] | null>(null);
  const [invalidatePath, setInvalidatePath] = useState("");
  const [configJson, setConfigJson] = useState(() =>
    JSON.stringify(OPCACHE_CONFIG_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <Group title={t(t9("opcache.title"), "OPcache")} icon={<Zap size={12} />}>
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getOpcacheStatus(id, version)).then((s) => s && setStatus(s))
          }
        >
          {t(t9("opcache.status"), "Status")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getOpcacheConfig(id, version)).then(
              (c) => c && setConfigJson(JSON.stringify(c, null, 2)),
            )
          }
        >
          {t(t9("opcache.loadConfig"), "Load config")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.isOpcacheEnabled(id, version)).then(
              (b) => b !== undefined && setEnabled(b),
            )
          }
        >
          {t(t9("opcache.check"), "Enabled?")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.listCachedScripts(id, version)).then((s) => s && setScripts(s))
          }
        >
          {t(t9("opcache.scripts"), "Cached scripts")}
        </button>
        <button
          className={dangerBtn}
          disabled={!version}
          onClick={() => void run((a) => a.resetOpcache(id, version))}
        >
          <RotateCw size={12} />
          {t(t9("opcache.reset"), "Reset cache")}
        </button>
      </div>

      {enabled !== null && (
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("opcache.state"), "OPcache")}:{" "}
          {enabled ? t(t9("opcache.on"), "enabled") : t(t9("opcache.off"), "disabled")}
        </p>
      )}
      {status && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("opcache.stat.enabled"), "Enabled")} value={status.enabled ? "yes" : "no"} />
          <Stat label={t(t9("opcache.stat.full"), "Full")} value={status.full ? "yes" : "no"} />
          <Stat label={t(t9("opcache.stat.hitRate"), "Hit rate")} value={status.statistics.hit_rate} />
          <Stat label={t(t9("opcache.stat.scripts"), "Scripts")} value={status.statistics.num_cached_scripts} />
          <Stat label={t(t9("opcache.stat.hits"), "Hits")} value={status.statistics.hits} />
          <Stat label={t(t9("opcache.stat.misses"), "Misses")} value={status.statistics.misses} />
          <Stat label={t(t9("opcache.stat.used"), "Used mem")} value={status.memory_usage.used_memory} />
          <Stat label={t(t9("opcache.stat.free"), "Free mem")} value={status.memory_usage.free_memory} />
        </div>
      )}
      {scripts && (
        <RowList
          items={scripts.map((s) => ({
            key: s.full_path,
            primary: s.full_path,
            secondary: `${s.hits} hits · ${s.memory_consumption} B`,
            onClick: () => setInvalidatePath(s.full_path),
          }))}
        />
      )}

      <div>
        <label className={labelClass}>
          {t(t9("opcache.invalidate"), "Invalidate cached script")}
        </label>
        <div className="flex gap-1">
          <input
            className={inputClass}
            value={invalidatePath}
            onChange={(e) => setInvalidatePath(e.target.value)}
            placeholder="/var/www/app/index.php"
          />
          <button
            className={btnClass}
            disabled={!version || !invalidatePath.trim()}
            onClick={() =>
              run((a) => a.invalidateCachedScript(id, version, invalidatePath.trim()))
            }
          >
            {t(t9("opcache.invalidateBtn"), "Invalidate")}
          </button>
        </div>
      </div>

      <div>
        <label className={labelClass}>
          {t(t9("opcache.configReq"), "Update OPcache config (JSON)")}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={8}
          value={configJson}
          onChange={(e) => setConfigJson(e.target.value)}
        />
        <button
          className={`${primaryBtn} mt-1`}
          disabled={!version}
          onClick={() => {
            let config: OpcacheConfig;
            try {
              config = JSON.parse(configJson) as OpcacheConfig;
            } catch (e) {
              setParseError((e as Error).message);
              return;
            }
            setParseError(null);
            void run((a) => a.updateOpcacheConfig(id, version, config));
          }}
        >
          {t(t9("opcache.apply"), "Apply config")}
        </button>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Sessions (6)
// ═══════════════════════════════════════════════════════════════════════════════

const SessionsSection: React.FC<{
  mgr: PhpRuntimeManager;
  id: string;
  version: string;
}> = ({ mgr, id, version }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [config, setConfig] = useState<PhpSessionConfig | null>(null);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [savePath, setSavePath] = useState<string | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const [maxAge, setMaxAge] = useState("");
  const [cleaned, setCleaned] = useState<number | null>(null);
  const [updateJson, setUpdateJson] = useState(() =>
    JSON.stringify(SESSION_CONFIG_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <Group title={t(t9("sessions.title"), "Sessions")} icon={<Activity size={12} />}>
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getSessionConfig(id, version)).then((c) => c && setConfig(c))
          }
        >
          {t(t9("sessions.config"), "Config")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getSessionStats(id, version)).then((s) => s && setStats(s))
          }
        >
          {t(t9("sessions.stats"), "Stats")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getSessionSavePath(id, version)).then(
              (p) => p !== undefined && setSavePath(p),
            )
          }
        >
          {t(t9("sessions.savePath"), "Save path")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.listSessionFiles(id, version)).then((f) => f && setFiles(f))
          }
        >
          {t(t9("sessions.files"), "List files")}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("sessions.stat.handler"), "Handler")} value={stats.handler} />
          <Stat label={t(t9("sessions.stat.active"), "Active")} value={stats.active_sessions} />
          <Stat label={t(t9("sessions.stat.size"), "Size B")} value={stats.total_size_bytes} />
          <Stat label={t(t9("sessions.stat.path"), "Path")} value={stats.save_path} />
        </div>
      )}
      {savePath !== null && (
        <p className="break-all text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("sessions.savePath"), "Save path")}: {savePath || "—"}
        </p>
      )}
      {files && (
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          {files.length} {t(t9("sessions.fileCount"), "session files")}
        </p>
      )}
      {config && <Json value={config} />}

      <div>
        <label className={labelClass}>
          {t(t9("sessions.cleanup"), "Garbage-collect sessions")}
        </label>
        <div className="flex gap-1">
          <input
            className={`${inputClass} max-w-[180px]`}
            type="number"
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            placeholder={t(t9("sessions.maxAge"), "max age secs (optional)")}
          />
          <button
            className={btnClass}
            disabled={!version}
            onClick={() =>
              run((a) =>
                a.cleanupSessions(
                  id,
                  version,
                  maxAge.trim() ? Number(maxAge) : undefined,
                ),
              ).then((n) => n !== undefined && setCleaned(n))
            }
          >
            <Trash2 size={12} />
            {t(t9("sessions.cleanupBtn"), "Clean up")}
          </button>
        </div>
        {cleaned !== null && (
          <p className="mt-1 text-[11px] text-[var(--color-textSecondary)]">
            {t(t9("sessions.cleaned"), "Removed")}: {cleaned}
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>
          {t(t9("sessions.updateReq"), "Update session config (JSON)")}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={7}
          value={updateJson}
          onChange={(e) => setUpdateJson(e.target.value)}
        />
        <button
          className={`${primaryBtn} mt-1`}
          onClick={() => {
            let req: UpdateSessionConfigRequest;
            try {
              req = JSON.parse(updateJson) as UpdateSessionConfigRequest;
            } catch (e) {
              setParseError((e as Error).message);
              return;
            }
            setParseError(null);
            void run((a) => a.updateSessionConfig(id, req));
          }}
        >
          {t(t9("sessions.update"), "Apply changes")}
        </button>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ─── Small presentational helpers ──────────────────────────────────────────────

const Stat: React.FC<{ label: string; value?: number | string | null }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] px-1.5 py-1">
    <div className="text-[10px] text-[var(--color-textSecondary)]">{label}</div>
    <div className="truncate text-[11px] font-medium text-[var(--color-text)]">
      {value ?? "—"}
    </div>
  </div>
);

interface Row {
  key: string;
  primary: string;
  secondary?: string;
  onClick?: () => void;
}

const RowList: React.FC<{ items: Row[] }> = ({ items }) => (
  <ul className="flex flex-col gap-0.5">
    {items.length === 0 && (
      <li className="px-1 py-1 text-[11px] text-[var(--color-textSecondary)]">—</li>
    )}
    {items.map((r) => (
      <li key={r.key}>
        <button
          onClick={r.onClick}
          disabled={!r.onClick}
          className="flex w-full items-center justify-between gap-2 rounded border border-[var(--color-border)] px-1.5 py-1 text-left text-[11px] hover:bg-[var(--color-surfaceHover)] disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="truncate font-medium text-[var(--color-text)]">{r.primary}</span>
          {r.secondary && (
            <span className="truncate text-[var(--color-textSecondary)]">
              {r.secondary}
            </span>
          )}
        </button>
      </li>
    ))}
  </ul>
);

const Json: React.FC<{ value: unknown }> = ({ value }) => (
  <pre className="max-h-48 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
    {JSON.stringify(value, null, 2)}
  </pre>
);

export default PhpRuntimeTab;
