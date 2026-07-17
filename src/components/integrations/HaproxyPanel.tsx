// HAProxy integration panel (t42-haproxy).
//
// Full panel for the sorng-haproxy crate — binds every one of the 40 commands
// in src-tauri/crates/sorng-haproxy/src/commands.rs through `useHaproxy()` /
// `haproxyApi`. Connect form maps to `haproxy_connect` (SSH host + creds + stats
// socket/URL + Data-plane API URL + config path). Sub-tabs cover overview/stats,
// frontends, backends, servers, ACLs, maps, stick tables, the runtime API and
// config/process control.

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileCode2,
  Layers,
  List,
  ListTree,
  Loader2,
  Network,
  Play,
  Plug,
  Power,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
  Table2,
  Terminal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHaproxy, type HaproxyManager } from "../../hooks/integration/useHaproxy";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../utils/core/id";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  AclEntry,
  ConfigValidationResult,
  HaproxyAcl,
  HaproxyBackend,
  HaproxyFrontend,
  HaproxyInfo,
  HaproxyMap,
  HaproxyServer,
  MapEntry,
  ServerAction,
  SessionEntry,
  StickTable,
  StickTableEntry,
} from "../../types/haproxy";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Collapsible raw viewer used by "view / detail" actions. */
const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

/** Fixed-width text dump (CSV, runtime responses, servers-state). */
const TextView: React.FC<{ value?: string | null }> = ({ value }) =>
  value == null || value === "" ? null : (
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {value}
    </pre>
  );

type TabKey =
  | "overview"
  | "frontends"
  | "backends"
  | "servers"
  | "acls"
  | "maps"
  | "sticktables"
  | "runtime"
  | "config";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  sshUser: string;
  sshPassword: string;
  sshKey: string;
  statsSocket: string;
  statsUrl: string;
  statsUser: string;
  statsPassword: string;
  dataplaneUrl: string;
  dataplaneUser: string;
  dataplanePassword: string;
  configPath: string;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "22",
  sshUser: "",
  sshPassword: "",
  sshKey: "",
  statsSocket: "/var/run/haproxy/admin.sock",
  statsUrl: "",
  statsUser: "",
  statsPassword: "",
  dataplaneUrl: "",
  dataplaneUser: "",
  dataplanePassword: "",
  configPath: "/etc/haproxy/haproxy.cfg",
  timeoutSecs: "30",
  name: "",
};

/** The instance's several secrets are bundled into ONE opaque vault secret (the
 *  store keeps a single secret per instance). */
interface HaproxySecrets {
  sshPassword?: string;
  sshKey?: string;
  statsPassword?: string;
  dataplanePassword?: string;
}

const ConnectForm: React.FC<{ mgr: HaproxyManager; instanceId?: string }> = ({
  mgr,
  instanceId,
}) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(instanceId);

  // Prefill from a persisted instance (host/fields + bundled vault secret).
  useEffect(() => {
    if (!instanceId || store.isLoading) return;
    const inst = store.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setForm((f) => ({
      ...f,
      name: inst.name,
      host: inst.host ?? "",
      port: inst.fields?.port ?? "22",
      sshUser: inst.fields?.sshUser ?? "",
      statsSocket: inst.fields?.statsSocket ?? "",
      statsUrl: inst.fields?.statsUrl ?? "",
      statsUser: inst.fields?.statsUser ?? "",
      dataplaneUrl: inst.fields?.dataplaneUrl ?? "",
      dataplaneUser: inst.fields?.dataplaneUser ?? "",
      configPath: inst.fields?.configPath ?? "",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((raw) => {
      if (!raw) return;
      try {
        const s = JSON.parse(raw) as HaproxySecrets;
        setForm((f) => ({
          ...f,
          sshPassword: s.sshPassword ?? "",
          sshKey: s.sshKey ?? "",
          statsPassword: s.statsPassword ?? "",
          dataplanePassword: s.dataplanePassword ?? "",
        }));
      } catch {
        // Legacy / non-JSON secret — treat as the SSH password.
        setForm((f) => ({ ...f, sshPassword: raw }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? instanceId ?? generateId();
    await mgr.connect(id, {
      host: form.host.trim(),
      port: form.port ? Number(form.port) : undefined,
      ssh_user: form.sshUser || undefined,
      ssh_password: form.sshPassword || undefined,
      ssh_key: form.sshKey || undefined,
      stats_socket: form.statsSocket || undefined,
      stats_url: form.statsUrl || undefined,
      stats_user: form.statsUser || undefined,
      stats_password: form.statsPassword || undefined,
      dataplane_url: form.dataplaneUrl || undefined,
      dataplane_user: form.dataplaneUser || undefined,
      dataplane_password: form.dataplanePassword || undefined,
      config_path: form.configPath || undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId, instanceId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      sshUser: form.sshUser,
      statsSocket: form.statsSocket,
      statsUrl: form.statsUrl,
      statsUser: form.statsUser,
      dataplaneUrl: form.dataplaneUrl,
      dataplaneUser: form.dataplaneUser,
      configPath: form.configPath,
      timeoutSecs: form.timeoutSecs,
    };
    const secrets: HaproxySecrets = {
      sshPassword: form.sshPassword || undefined,
      sshKey: form.sshKey || undefined,
      statsPassword: form.statsPassword || undefined,
      dataplanePassword: form.dataplanePassword || undefined,
    };
    const hasSecret = Object.values(secrets).some(Boolean);
    const secret = hasSecret ? JSON.stringify(secrets) : undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "haproxy",
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.haproxy.host", "SSH host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="haproxy.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.port", "SSH port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.sshUser", "SSH user")}>
          <input
            className={field}
            value={form.sshUser}
            onChange={(e) => set("sshUser", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.sshPassword", "SSH password")}>
          <input
            className={field}
            type="password"
            value={form.sshPassword}
            onChange={(e) => set("sshPassword", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.sshKey", "SSH private key")}>
          <textarea
            className={`${field} font-mono`}
            rows={2}
            value={form.sshKey}
            onChange={(e) => set("sshKey", e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </Labeled>
        <Labeled
          label={t("integrations.haproxy.statsSocket", "Stats socket path")}
        >
          <input
            className={field}
            value={form.statsSocket}
            onChange={(e) => set("statsSocket", e.target.value)}
            placeholder="/var/run/haproxy/admin.sock"
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.statsUrl", "Stats HTTP URL")}>
          <input
            className={field}
            value={form.statsUrl}
            onChange={(e) => set("statsUrl", e.target.value)}
            placeholder="http://host:8404/stats"
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.statsUser", "Stats user")}>
          <input
            className={field}
            value={form.statsUser}
            onChange={(e) => set("statsUser", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.haproxy.statsPassword", "Stats password")}
        >
          <input
            className={field}
            type="password"
            value={form.statsPassword}
            onChange={(e) => set("statsPassword", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.haproxy.dataplaneUrl", "Data-plane API URL")}
        >
          <input
            className={field}
            value={form.dataplaneUrl}
            onChange={(e) => set("dataplaneUrl", e.target.value)}
            placeholder="http://host:5555"
          />
        </Labeled>
        <Labeled
          label={t("integrations.haproxy.dataplaneUser", "Data-plane user")}
        >
          <input
            className={field}
            value={form.dataplaneUser}
            onChange={(e) => set("dataplaneUser", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t(
            "integrations.haproxy.dataplanePassword",
            "Data-plane password",
          )}
        >
          <input
            className={field}
            type="password"
            value={form.dataplanePassword}
            onChange={(e) => set("dataplanePassword", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.configPath", "Config file path")}>
          <input
            className={field}
            value={form.configPath}
            onChange={(e) => set("configPath", e.target.value)}
            placeholder="/etc/haproxy/haproxy.cfg"
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.timeout", "Timeout (seconds)")}>
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.haproxy.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.host}
          />
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isConnecting || !form.host}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.haproxy.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.haproxy.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Overview tab (info / version / csv / ping) ──────────────────────────────

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
    <div className="text-[10px] uppercase text-[var(--color-textMuted)]">
      {label}
    </div>
    <div className="text-sm text-[var(--color-text)]">{value ?? "—"}</div>
  </div>
);

const OverviewTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<HaproxyInfo | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced via mgr.error */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.getInfo(cid), setInfo),
        safe(mgr.api.version(cid), setVersion),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadCsv = useCallback(async () => {
    try {
      setCsv(await mgr.run(() => mgr.api.getCsv(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.haproxy.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={loadCsv} disabled={mgr.isLoading}>
          <Table2 size={12} />
          {t("integrations.haproxy.loadCsv", "Load stats CSV")}
        </button>
        {version && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.haproxy.version", "Version")}: {version}
          </span>
        )}
      </div>
      {info && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t("integrations.haproxy.node", "Node")} value={info.node ?? info.name} />
          <Stat label={t("integrations.haproxy.pid", "PID")} value={info.pid} />
          <Stat label={t("integrations.haproxy.uptime", "Uptime")} value={info.uptime} />
          <Stat label={t("integrations.haproxy.threads", "Threads")} value={info.nbthread} />
          <Stat label={t("integrations.haproxy.currConns", "Current conns")} value={info.curr_conns} />
          <Stat label={t("integrations.haproxy.cumConns", "Total conns")} value={info.cum_conns} />
          <Stat label={t("integrations.haproxy.connRate", "Conn rate")} value={info.conn_rate} />
          <Stat label={t("integrations.haproxy.sessRate", "Session rate")} value={info.sess_rate} />
          <Stat label={t("integrations.haproxy.maxconn", "Max conn")} value={info.maxconn} />
          <Stat label={t("integrations.haproxy.currSsl", "Current SSL")} value={info.curr_ssl_conns} />
          <Stat label={t("integrations.haproxy.idlePct", "Idle %")} value={info.idle_pct} />
          <Stat label={t("integrations.haproxy.memMax", "Mem max (MB)")} value={info.mem_max_mb} />
        </div>
      )}
      <JsonView value={info} />
      <TextView value={csv} />
    </div>
  );
};

// ─── Frontends tab ───────────────────────────────────────────────────────────

const FrontendsTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HaproxyFrontend[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listFrontends(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getFrontend(cid, name)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.haproxy.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.haproxy.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.status", "Status")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.sessions", "Sessions")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.reqRate", "Req rate")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{f.name}</td>
                <td className="px-2 py-1">
                  <StatusBadge status={f.status} />
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {f.current_sessions} / {f.max_sessions}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{f.request_rate}</td>
                <td className="px-2 py-1 text-right">
                  <button className={btn} onClick={() => void view(f.name)}>
                    {t("integrations.haproxy.view", "View")}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.haproxy.noFrontends", "No frontends")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const up = /^(up|open|ok|no check)/i.test(status);
  const down = /^(down|maint|nolb|stop)/i.test(status);
  const cls = up
    ? "text-green-500"
    : down
      ? "text-red-500"
      : "text-[var(--color-textSecondary)]";
  return <span className={cls}>{status}</span>;
};

// ─── Backends tab ────────────────────────────────────────────────────────────

const BackendsTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HaproxyBackend[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.listBackends(cid), setRows),
        safe(mgr.api.showBackendList(cid), setNames),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getBackend(cid, name)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.haproxy.refresh", "Refresh")}
        </button>
        {names.length > 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.haproxy.backendCount", "Backends")}: {names.length}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.haproxy.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.status", "Status")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.activeServers", "Active srv")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.balance", "Balance")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{b.name}</td>
                <td className="px-2 py-1">
                  <StatusBadge status={b.status} />
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {b.active_servers} / {b.active_servers + b.backup_servers}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {b.balance_algorithm ?? "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <button className={btn} onClick={() => void view(b.name)}>
                    {t("integrations.haproxy.view", "View")}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.haproxy.noBackends", "No backends")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Servers tab (list / get / set-state / sessions) ─────────────────────────

const SERVER_ACTIONS: ServerAction[] = [
  "enable",
  "disable",
  "drain",
  "maint",
  "ready",
  "set_weight",
  "set_addr",
  "agent_up",
  "agent_down",
];

const ServersTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [backend, setBackend] = useState("");
  const [rows, setRows] = useState<HaproxyServer[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [action, setAction] = useState<ServerAction>("enable");
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  const load = useCallback(async () => {
    if (!backend) return;
    try {
      setRows(await mgr.run(() => mgr.api.listServers(cid, backend)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, backend]);

  const view = useCallback(
    async (server: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getServer(cid, backend, server)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, backend],
  );

  const apply = useCallback(
    async (server: string) => {
      try {
        await mgr.run(() =>
          mgr.api.setServerState(cid, backend, server, action),
        );
        await load();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, backend, action, load],
  );

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await mgr.run(() => mgr.api.showSessions(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 200 }}
          placeholder={t("integrations.haproxy.backendName", "Backend name")}
          value={backend}
          onChange={(e) => setBackend(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
        />
        <button className={btn} onClick={load} disabled={mgr.isLoading || !backend}>
          <List size={12} />
          {t("integrations.haproxy.listServers", "List servers")}
        </button>
        <select
          className={field}
          style={{ width: 150 }}
          value={action}
          onChange={(e) => setAction(e.target.value as ServerAction)}
        >
          {SERVER_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.haproxy.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.address", "Address")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.status", "Status")}</th>
              <th className="px-2 py-1">{t("integrations.haproxy.weight", "Weight")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                  {s.address}
                  {s.port != null ? `:${s.port}` : ""}
                </td>
                <td className="px-2 py-1">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{s.weight}</td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(s.name)}>
                      {t("integrations.haproxy.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void apply(s.name)}>
                      {t("integrations.haproxy.apply", "Apply")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.haproxy.noServers", "No servers — enter a backend and list")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />

      <div className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.haproxy.sessions", "Sessions")}
          </h4>
          <button className={btn} onClick={loadSessions} disabled={mgr.isLoading}>
            <RefreshCw size={12} />
            {t("integrations.haproxy.loadSessions", "Load sessions")}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.haproxy.id", "ID")}</th>
                <th className="px-2 py-1">{t("integrations.haproxy.frontend", "Frontend")}</th>
                <th className="px-2 py-1">{t("integrations.haproxy.backend", "Backend")}</th>
                <th className="px-2 py-1">{t("integrations.haproxy.source", "Source")}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{s.id}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{s.frontend}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {s.backend}/{s.server}
                  </td>
                  <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{s.source}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                    {t("integrations.haproxy.noSessions", "No sessions loaded")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── ACLs tab ────────────────────────────────────────────────────────────────

const AclsTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HaproxyAcl[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<AclEntry[]>([]);
  const [value, setValue] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listAcls(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadEntries = useCallback(
    async (aclId: string) => {
      setSelected(aclId);
      try {
        setEntries(await mgr.run(() => mgr.api.getAcl(cid, aclId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const add = useCallback(async () => {
    if (selected == null || !value) return;
    try {
      await mgr.run(() => mgr.api.addAclEntry(cid, selected, value));
      setValue("");
      await loadEntries(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, value, loadEntries]);

  const del = useCallback(
    async (v: string) => {
      if (selected == null) return;
      try {
        await mgr.run(() => mgr.api.delAclEntry(cid, selected, v));
        await loadEntries(selected);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, selected, loadEntries],
  );

  const clear = useCallback(async () => {
    if (selected == null) return;
    if (!window.confirm(t("integrations.haproxy.clearAclConfirm", "Clear all entries in this ACL?"))) return;
    try {
      await mgr.run(() => mgr.api.clearAcl(cid, selected));
      await loadEntries(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, loadEntries, t]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.haproxy.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {rows.map((a) => (
          <button
            key={a.id}
            onClick={() => void loadEntries(a.id)}
            className={`flex items-center justify-between rounded px-2 py-1 text-left text-xs ${
              selected === a.id
                ? "bg-[var(--color-surface)] text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
          >
            <span className="font-mono">#{a.id}</span>
            <span className="text-[var(--color-textMuted)]">
              {a.description ?? `${a.entries.length} ${t("integrations.haproxy.entries", "entries")}`}
            </span>
          </button>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.haproxy.noAcls", "No ACLs")}
          </span>
        )}
      </div>

      {selected != null && (
        <div className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {t("integrations.haproxy.aclEntries", "ACL entries")} #{selected}
            </h4>
            <button className={btn} onClick={clear}>
              <Trash2 size={12} />
              {t("integrations.haproxy.clear", "Clear")}
            </button>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input
              className={field}
              placeholder={t("integrations.haproxy.aclValue", "Value")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <button className={btn} onClick={add} disabled={!value}>
              {t("integrations.haproxy.add", "Add")}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-xs">
                <span className="font-mono text-[var(--color-textSecondary)]">{e.value}</span>
                <button className={btn} onClick={() => void del(e.value)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {entries.length === 0 && (
              <span className="text-xs text-[var(--color-textMuted)]">
                {t("integrations.haproxy.noEntries", "No entries")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Maps tab ────────────────────────────────────────────────────────────────

const MapsTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HaproxyMap[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<MapEntry[]>([]);
  const [form, setForm] = useState({ key: "", value: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listMaps(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadEntries = useCallback(
    async (mapId: string) => {
      setSelected(mapId);
      try {
        setEntries(await mgr.run(() => mgr.api.getMap(cid, mapId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const add = useCallback(async () => {
    if (selected == null || !form.key) return;
    try {
      await mgr.run(() => mgr.api.addMapEntry(cid, selected, form.key, form.value));
      setForm({ key: "", value: "" });
      await loadEntries(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, form, loadEntries]);

  const setEntry = useCallback(
    async (key: string, value: string) => {
      if (selected == null) return;
      try {
        await mgr.run(() => mgr.api.setMapEntry(cid, selected, key, value));
        await loadEntries(selected);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, selected, loadEntries],
  );

  const del = useCallback(
    async (key: string) => {
      if (selected == null) return;
      try {
        await mgr.run(() => mgr.api.delMapEntry(cid, selected, key));
        await loadEntries(selected);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, selected, loadEntries],
  );

  const clear = useCallback(async () => {
    if (selected == null) return;
    if (!window.confirm(t("integrations.haproxy.clearMapConfirm", "Clear all entries in this map?"))) return;
    try {
      await mgr.run(() => mgr.api.clearMap(cid, selected));
      await loadEntries(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, loadEntries, t]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.haproxy.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {rows.map((m) => (
          <button
            key={m.id}
            onClick={() => void loadEntries(m.id)}
            className={`flex items-center justify-between rounded px-2 py-1 text-left text-xs ${
              selected === m.id
                ? "bg-[var(--color-surface)] text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
          >
            <span className="font-mono">{m.id}</span>
            <span className="text-[var(--color-textMuted)]">
              {m.description ?? `${m.entries.length} ${t("integrations.haproxy.entries", "entries")}`}
            </span>
          </button>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.haproxy.noMaps", "No maps")}
          </span>
        )}
      </div>

      {selected != null && (
        <div className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {t("integrations.haproxy.mapEntries", "Map entries")} {selected}
            </h4>
            <button className={btn} onClick={clear}>
              <Trash2 size={12} />
              {t("integrations.haproxy.clear", "Clear")}
            </button>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input
              className={field}
              placeholder={t("integrations.haproxy.key", "Key")}
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            />
            <input
              className={field}
              placeholder={t("integrations.haproxy.value", "Value")}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
            <button className={btn} onClick={add} disabled={!form.key}>
              {t("integrations.haproxy.add", "Add")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--color-textMuted)]">
                <tr>
                  <th className="px-2 py-1">{t("integrations.haproxy.key", "Key")}</th>
                  <th className="px-2 py-1">{t("integrations.haproxy.value", "Value")}</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{e.key}</td>
                    <td className="px-2 py-1">
                      <input
                        className={field}
                        defaultValue={e.value}
                        onBlur={(ev) =>
                          ev.target.value !== e.value && void setEntry(e.key, ev.target.value)
                        }
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button className={btn} onClick={() => void del(e.key)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                      {t("integrations.haproxy.noEntries", "No entries")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Stick Tables tab ────────────────────────────────────────────────────────

const StickTablesTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StickTable[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<StickTableEntry[]>([]);
  const [form, setForm] = useState({ key: "", data: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listStickTables(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadEntries = useCallback(
    async (name: string) => {
      setSelected(name);
      try {
        setEntries(await mgr.run(() => mgr.api.getStickTable(cid, name)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const setEntry = useCallback(async () => {
    if (selected == null || !form.key) return;
    try {
      await mgr.run(() => mgr.api.setStickTableEntry(cid, selected, form.key, form.data));
      setForm({ key: "", data: "" });
      await loadEntries(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, form, loadEntries]);

  const clear = useCallback(async () => {
    if (selected == null) return;
    if (!window.confirm(t("integrations.haproxy.clearTableConfirm", "Clear this stick table?"))) return;
    try {
      await mgr.run(() => mgr.api.clearStickTable(cid, selected));
      await loadEntries(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, loadEntries, t]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.haproxy.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {rows.map((tbl) => (
          <button
            key={tbl.name}
            onClick={() => void loadEntries(tbl.name)}
            className={`flex items-center justify-between rounded px-2 py-1 text-left text-xs ${
              selected === tbl.name
                ? "bg-[var(--color-surface)] text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
          >
            <span className="font-mono">{tbl.name}</span>
            <span className="text-[var(--color-textMuted)]">
              {tbl.table_type} · {tbl.used}/{tbl.size}
            </span>
          </button>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.haproxy.noStickTables", "No stick tables")}
          </span>
        )}
      </div>

      {selected != null && (
        <div className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {t("integrations.haproxy.tableEntries", "Table entries")} {selected}
            </h4>
            <button className={btn} onClick={clear}>
              <Trash2 size={12} />
              {t("integrations.haproxy.clear", "Clear")}
            </button>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input
              className={field}
              placeholder={t("integrations.haproxy.key", "Key")}
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            />
            <input
              className={field}
              placeholder={t("integrations.haproxy.tableData", "Data (e.g. gpc0=1)")}
              value={form.data}
              onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
            />
            <button className={btn} onClick={setEntry} disabled={!form.key}>
              {t("integrations.haproxy.set", "Set")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--color-textMuted)]">
                <tr>
                  <th className="px-2 py-1">{t("integrations.haproxy.key", "Key")}</th>
                  <th className="px-2 py-1">{t("integrations.haproxy.useCount", "Use count")}</th>
                  <th className="px-2 py-1">{t("integrations.haproxy.data", "Data")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.key} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{e.key}</td>
                    <td className="px-2 py-1 text-[var(--color-textSecondary)]">{e.use_count}</td>
                    <td className="px-2 py-1 font-mono text-[10px] text-[var(--color-textSecondary)]">
                      {JSON.stringify(e.data)}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                      {t("integrations.haproxy.noEntries", "No entries")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Runtime tab (raw runtime API + servers-state dump) ──────────────────────

const RuntimeTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [command, setCommand] = useState("show info");
  const [response, setResponse] = useState<string | null>(null);
  const [serversState, setServersState] = useState<string | null>(null);

  const execute = useCallback(async () => {
    if (!command) return;
    try {
      setResponse(await mgr.run(() => mgr.api.runtimeExecute(cid, command)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, command]);

  const loadServersState = useCallback(async () => {
    try {
      setServersState(await mgr.run(() => mgr.api.showServersState(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.haproxy.runtimeApi", "Runtime API")}
        </h4>
        <div className="flex items-center gap-2">
          <input
            className={`${field} font-mono`}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void execute()}
            placeholder="show info"
          />
          <button className={btn} onClick={execute} disabled={mgr.isLoading || !command}>
            <Terminal size={12} />
            {t("integrations.haproxy.execute", "Execute")}
          </button>
        </div>
        <TextView value={response} />
      </div>
      <div className={card}>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.haproxy.serversState", "Servers state")}
          </h4>
          <button className={btn} onClick={loadServersState} disabled={mgr.isLoading}>
            <RefreshCw size={12} />
            {t("integrations.haproxy.load", "Load")}
          </button>
        </div>
        <TextView value={serversState} />
      </div>
    </div>
  );
};

// ─── Config tab (raw config + validate + process control) ────────────────────

const ConfigTab: React.FC<{ mgr: HaproxyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [validation, setValidation] = useState<ConfigValidationResult | null>(null);

  const load = useCallback(async () => {
    try {
      setContent(await mgr.run(() => mgr.api.getRawConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    try {
      await mgr.run(() => mgr.api.updateRawConfig(cid, content));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, content]);

  const validate = useCallback(async () => {
    try {
      setValidation(await mgr.run(() => mgr.api.validateConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const control = useCallback(
    async (op: "reload" | "start" | "stop" | "restart") => {
      const confirmMsg = t(
        "integrations.haproxy.controlConfirm",
        "Run '{{op}}' on HAProxy?",
      ).replace("{{op}}", op);
      if ((op === "stop" || op === "restart") && !window.confirm(confirmMsg)) {
        return;
      }
      try {
        await mgr.run(() => mgr.api[op](cid));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={load} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.haproxy.reloadConfig", "Reload from server")}
        </button>
        <button className={btn} onClick={save} disabled={mgr.isLoading}>
          <FileCode2 size={12} />
          {t("integrations.haproxy.saveConfig", "Save to server")}
        </button>
        <button className={btn} onClick={validate} disabled={mgr.isLoading}>
          <ShieldCheck size={12} />
          {t("integrations.haproxy.validate", "Validate")}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button className={btn} onClick={() => void control("reload")} disabled={mgr.isLoading}>
            <RotateCw size={12} />
            {t("integrations.haproxy.reload", "Reload")}
          </button>
          <button className={btn} onClick={() => void control("start")} disabled={mgr.isLoading}>
            <Play size={12} />
            {t("integrations.haproxy.start", "Start")}
          </button>
          <button className={btn} onClick={() => void control("restart")} disabled={mgr.isLoading}>
            <Power size={12} />
            {t("integrations.haproxy.restart", "Restart")}
          </button>
          <button className={btn} onClick={() => void control("stop")} disabled={mgr.isLoading}>
            <Power size={12} />
            {t("integrations.haproxy.stop", "Stop")}
          </button>
        </div>
      </div>
      {validation && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            validation.valid
              ? "border-green-500/40 bg-green-500/10 text-green-500"
              : "border-red-500/40 bg-red-500/10 text-red-500"
          }`}
        >
          <div className="font-semibold">
            {validation.valid
              ? t("integrations.haproxy.configValid", "Configuration is valid")
              : t("integrations.haproxy.configInvalid", "Configuration is invalid")}
          </div>
          {validation.errors.map((e, i) => (
            <div key={`e${i}`} className="font-mono">{e}</div>
          ))}
          {validation.warnings.map((w, i) => (
            <div key={`w${i}`} className="font-mono text-yellow-500">{w}</div>
          ))}
        </div>
      )}
      <textarea
        className={`${field} font-mono`}
        rows={18}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# haproxy.cfg"
      />
    </div>
  );
};

// ─── Panel shell ─────────────────────────────────────────────────────────────

const TABS: {
  key: TabKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "overview", labelKey: "integrations.haproxy.tabOverview", labelDefault: "Overview", icon: Activity },
  { key: "frontends", labelKey: "integrations.haproxy.tabFrontends", labelDefault: "Frontends", icon: ArrowDownToLine },
  { key: "backends", labelKey: "integrations.haproxy.tabBackends", labelDefault: "Backends", icon: ArrowUpFromLine },
  { key: "servers", labelKey: "integrations.haproxy.tabServers", labelDefault: "Servers", icon: Server },
  { key: "acls", labelKey: "integrations.haproxy.tabAcls", labelDefault: "ACLs", icon: ListTree },
  { key: "maps", labelKey: "integrations.haproxy.tabMaps", labelDefault: "Maps", icon: Layers },
  { key: "sticktables", labelKey: "integrations.haproxy.tabStickTables", labelDefault: "Stick tables", icon: Table2 },
  { key: "runtime", labelKey: "integrations.haproxy.tabRuntime", labelDefault: "Runtime", icon: Terminal },
  { key: "config", labelKey: "integrations.haproxy.tabConfig", labelDefault: "Config", icon: FileCode2 },
];

const HaproxyPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useHaproxy();
  const [tab, setTab] = useState<TabKey>("overview");

  if (!isOpen) return null;

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Network className="h-5 w-5 text-primary" />
          {t("integrations.haproxy.title", "HAProxy")}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`} />
            {mgr.isConnected
              ? mgr.summary?.host ?? t("integrations.haproxy.connected", "Connected")
              : t("integrations.haproxy.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.haproxy.disconnect", "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected || !cid ? (
        <ConnectForm mgr={mgr} instanceId={instanceId} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {TABS.map(({ key, labelKey, labelDefault, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                  tab === key
                    ? "border-primary text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-textSecondary)]"
                }`}
              >
                <Icon size={12} />
                {t(labelKey, labelDefault)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === "overview" && <OverviewTab mgr={mgr} cid={cid} />}
            {tab === "frontends" && <FrontendsTab mgr={mgr} cid={cid} />}
            {tab === "backends" && <BackendsTab mgr={mgr} cid={cid} />}
            {tab === "servers" && <ServersTab mgr={mgr} cid={cid} />}
            {tab === "acls" && <AclsTab mgr={mgr} cid={cid} />}
            {tab === "maps" && <MapsTab mgr={mgr} cid={cid} />}
            {tab === "sticktables" && <StickTablesTab mgr={mgr} cid={cid} />}
            {tab === "runtime" && <RuntimeTab mgr={mgr} cid={cid} />}
            {tab === "config" && <ConfigTab mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default HaproxyPanel;

/** Registry descriptor for the HAProxy integration (category: web).
 *  The Wave-4 web integrator appends this to `registry.web.ts`. */
export const haproxyDescriptor: IntegrationDescriptor = {
  key: "haproxy",
  label: "HAProxy",
  category: "web-server",
  icon: Network,
  importPanel: () => import("./HaproxyPanel"),
};
