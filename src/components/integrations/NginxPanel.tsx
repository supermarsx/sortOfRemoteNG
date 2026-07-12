// Nginx integration panel (t42-nginx).
//
// Full panel for the sorng-nginx crate — binds every one of the 38 nginx
// commands registered in `sorng-nginx/src/commands.rs` (connect prefix `ngx_*`)
// through `useNginx()` / `nginxApi`. Connect form maps to `ngx_connect`
// (host + SSH creds + binary/config/sites paths + stub_status URL); sub-tabs
// cover status/process control, sites (server blocks), upstreams, SSL, logs,
// main config and snippets.

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  FileCog,
  FileText,
  Globe,
  Layers,
  Loader2,
  Play,
  Plug,
  Power,
  RefreshCw,
  RotateCw,
  ScrollText,
  Server,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNginx, type NginxManager } from "../../hooks/integration/useNginx";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../utils/core/id";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  AccessLogEntry,
  ConfigTestResult,
  ErrorLogEntry,
  NginxHealthCheck,
  NginxSite,
  NginxSnippet,
  NginxUpstream,
} from "../../types/nginx";

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

/** Collapsible raw-JSON viewer used by the "view / detail" actions. */
const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

type TabKey =
  | "status"
  | "sites"
  | "upstreams"
  | "ssl"
  | "logs"
  | "config"
  | "snippets";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  sshUser: string;
  sshPassword: string;
  sshKey: string;
  nginxBin: string;
  configPath: string;
  sitesAvailableDir: string;
  sitesEnabledDir: string;
  confDDir: string;
  statusUrl: string;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "22",
  sshUser: "",
  sshPassword: "",
  sshKey: "",
  nginxBin: "",
  configPath: "",
  sitesAvailableDir: "",
  sitesEnabledDir: "",
  confDDir: "",
  statusUrl: "",
  timeoutSecs: "30",
  name: "",
};

const ConnectForm: React.FC<{ mgr: NginxManager; instanceId?: string }> = ({
  mgr,
  instanceId,
}) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(instanceId);

  // Prefill from a persisted instance (host/fields + vault secret).
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
      sshKey: inst.fields?.sshKey ?? "",
      nginxBin: inst.fields?.nginxBin ?? "",
      configPath: inst.fields?.configPath ?? "",
      sitesAvailableDir: inst.fields?.sitesAvailableDir ?? "",
      sitesEnabledDir: inst.fields?.sitesEnabledDir ?? "",
      confDDir: inst.fields?.confDDir ?? "",
      statusUrl: inst.fields?.statusUrl ?? "",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, sshPassword: secret }));
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
      nginx_bin: form.nginxBin || undefined,
      config_path: form.configPath || undefined,
      sites_available_dir: form.sitesAvailableDir || undefined,
      sites_enabled_dir: form.sitesEnabledDir || undefined,
      conf_d_dir: form.confDDir || undefined,
      status_url: form.statusUrl || undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId, instanceId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      sshUser: form.sshUser,
      sshKey: form.sshKey,
      nginxBin: form.nginxBin,
      configPath: form.configPath,
      sitesAvailableDir: form.sitesAvailableDir,
      sitesEnabledDir: form.sitesEnabledDir,
      confDDir: form.confDDir,
      statusUrl: form.statusUrl,
      timeoutSecs: form.timeoutSecs,
    };
    const secret = form.sshPassword || undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "nginx",
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
        <Labeled label={t("integrations.nginx.host", "Host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="web01.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.port", "SSH port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.sshUser", "SSH user")}>
          <input
            className={field}
            value={form.sshUser}
            onChange={(e) => set("sshUser", e.target.value)}
            placeholder="root"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.sshPassword", "SSH password")}>
          <input
            className={field}
            type="password"
            value={form.sshPassword}
            onChange={(e) => set("sshPassword", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.sshKey", "SSH private key (path or PEM)")}>
          <input
            className={field}
            value={form.sshKey}
            onChange={(e) => set("sshKey", e.target.value)}
            placeholder="~/.ssh/id_ed25519"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.statusUrl", "stub_status URL")}>
          <input
            className={field}
            value={form.statusUrl}
            onChange={(e) => set("statusUrl", e.target.value)}
            placeholder="http://web01/nginx_status"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.nginxBin", "nginx binary")}>
          <input
            className={field}
            value={form.nginxBin}
            onChange={(e) => set("nginxBin", e.target.value)}
            placeholder="/usr/sbin/nginx"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.configPath", "Main config path")}>
          <input
            className={field}
            value={form.configPath}
            onChange={(e) => set("configPath", e.target.value)}
            placeholder="/etc/nginx/nginx.conf"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.sitesAvailableDir", "sites-available dir")}>
          <input
            className={field}
            value={form.sitesAvailableDir}
            onChange={(e) => set("sitesAvailableDir", e.target.value)}
            placeholder="/etc/nginx/sites-available"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.sitesEnabledDir", "sites-enabled dir")}>
          <input
            className={field}
            value={form.sitesEnabledDir}
            onChange={(e) => set("sitesEnabledDir", e.target.value)}
            placeholder="/etc/nginx/sites-enabled"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.confDDir", "conf.d dir")}>
          <input
            className={field}
            value={form.confDDir}
            onChange={(e) => set("confDDir", e.target.value)}
            placeholder="/etc/nginx/conf.d"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.timeout", "Timeout (seconds)")}>
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.nginx.instanceName", "Saved name")}>
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
          {t("integrations.nginx.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.nginx.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Status tab (health, stub_status, process, info, process control) ─────────

const StatusTab: React.FC<{ mgr: NginxManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [health, setHealth] = useState<NginxHealthCheck | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [version, setVersion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHealth(await mgr.run(() => mgr.api.healthCheck(cid)));
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const show = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        setDetail(await mgr.run(op));
      } catch {
        /* surfaced */
      }
    },
    [mgr],
  );

  const control = useCallback(
    async (op: () => Promise<void>) => {
      try {
        await mgr.run(op);
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, refresh],
  );

  const loadVersion = useCallback(async () => {
    try {
      setVersion(await mgr.run(() => mgr.api.version(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.nginx.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={() => show(() => mgr.api.stubStatus(cid))}>
          {t("integrations.nginx.stubStatus", "stub_status")}
        </button>
        <button className={btn} onClick={() => show(() => mgr.api.processStatus(cid))}>
          {t("integrations.nginx.processStatus", "Process status")}
        </button>
        <button className={btn} onClick={() => show(() => mgr.api.info(cid))}>
          {t("integrations.nginx.info", "Build info")}
        </button>
        <button className={btn} onClick={loadVersion}>
          {t("integrations.nginx.version", "Version")}
        </button>
      </div>

      {health && (
        <div className={card}>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <span className="text-[var(--color-textMuted)]">
                {t("integrations.nginx.running", "Running")}
              </span>
              <div className={health.running ? "text-green-500" : "text-red-500"}>
                {health.running
                  ? t("integrations.nginx.yes", "Yes")
                  : t("integrations.nginx.no", "No")}
              </div>
            </div>
            <div>
              <span className="text-[var(--color-textMuted)]">
                {t("integrations.nginx.workers", "Workers")}
              </span>
              <div className="text-[var(--color-text)]">{health.worker_count}</div>
            </div>
            <div>
              <span className="text-[var(--color-textMuted)]">
                {t("integrations.nginx.configValid", "Config valid")}
              </span>
              <div className={health.config_valid ? "text-green-500" : "text-red-500"}>
                {health.config_valid
                  ? t("integrations.nginx.yes", "Yes")
                  : t("integrations.nginx.no", "No")}
              </div>
            </div>
            <div>
              <span className="text-[var(--color-textMuted)]">
                {t("integrations.nginx.pid", "PID")}
              </span>
              <div className="text-[var(--color-text)]">{health.pid ?? "—"}</div>
            </div>
          </div>
          {health.status && (
            <div className="mt-2 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.nginx.activeConnections", "Active connections")}:{" "}
              {health.status.active_connections} · req {health.status.requests}
            </div>
          )}
        </div>
      )}

      {version && (
        <div className="text-xs text-[var(--color-textSecondary)]">{version}</div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.nginx.processControl", "Process control")}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={() => control(() => mgr.api.start(cid))}>
            <Play size={12} />
            {t("integrations.nginx.start", "Start")}
          </button>
          <button className={btn} onClick={() => control(() => mgr.api.stop(cid))}>
            <Square size={12} />
            {t("integrations.nginx.stop", "Stop")}
          </button>
          <button className={btn} onClick={() => control(() => mgr.api.restart(cid))}>
            <Power size={12} />
            {t("integrations.nginx.restart", "Restart")}
          </button>
          <button className={btn} onClick={() => control(() => mgr.api.reload(cid))}>
            <RotateCw size={12} />
            {t("integrations.nginx.reload", "Reload")}
          </button>
        </div>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Sites tab ────────────────────────────────────────────────────────────────

const SitesTab: React.FC<{ mgr: NginxManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<NginxSite[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({ name: "", serverNames: "", listenPort: "80", root: "" });
  const [edit, setEdit] = useState<{ name: string; content: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listSites(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!form.name) return;
    try {
      await mgr.run(() =>
        mgr.api.createSite(cid, {
          name: form.name,
          server_names: form.serverNames
            ? form.serverNames.split(/[\s,]+/).filter(Boolean)
            : [],
          listen_port: form.listenPort ? Number(form.listenPort) : undefined,
          root: form.root || undefined,
          locations: [],
        }),
      );
      setForm({ name: "", serverNames: "", listenPort: "80", root: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        const site = await mgr.run(() => mgr.api.getSite(cid, name));
        setDetail(site);
        setEdit({ name: site.name, content: site.raw_content });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const saveEdit = useCallback(async () => {
    if (!edit) return;
    try {
      await mgr.run(() =>
        mgr.api.updateSite(cid, edit.name, { name: edit.name, content: edit.content }),
      );
      setEdit(null);
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, edit, refresh]);

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      try {
        await mgr.run(() =>
          enabled ? mgr.api.disableSite(cid, name) : mgr.api.enableSite(cid, name),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm(t("integrations.nginx.deleteSiteConfirm", "Delete this site?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteSite(cid, name));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.nginx.createSite", "Create site")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Labeled label={t("integrations.nginx.name", "Name")}>
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.nginx.serverNames", "Server names")}>
            <input className={field} value={form.serverNames} onChange={(e) => setForm((f) => ({ ...f, serverNames: e.target.value }))} placeholder="example.com www.example.com" />
          </Labeled>
          <Labeled label={t("integrations.nginx.listenPort", "Listen port")}>
            <input className={field} inputMode="numeric" value={form.listenPort} onChange={(e) => setForm((f) => ({ ...f, listenPort: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.nginx.root", "Root")}>
            <input className={field} value={form.root} onChange={(e) => setForm((f) => ({ ...f, root: e.target.value }))} placeholder="/var/www/html" />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.name}>
          {t("integrations.nginx.create", "Create")}
        </button>
      </div>
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.nginx.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.nginx.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.nginx.serverNames", "Server names")}</th>
              <th className="px-2 py-1">{t("integrations.nginx.enabled", "Enabled")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.filename} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{s.server_names.join(", ")}</td>
                <td className="px-2 py-1">
                  <span className={s.enabled ? "text-green-500" : "text-[var(--color-textMuted)]"}>
                    {s.enabled ? t("integrations.nginx.yes", "Yes") : t("integrations.nginx.no", "No")}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(s.name)}>
                      {t("integrations.nginx.edit", "Edit")}
                    </button>
                    <button className={btn} onClick={() => void toggle(s.name, s.enabled)}>
                      {s.enabled ? t("integrations.nginx.disable", "Disable") : t("integrations.nginx.enable", "Enable")}
                    </button>
                    <button className={btn} onClick={() => void remove(s.name)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.nginx.noSites", "No sites")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.nginx.editSite", "Edit site")}: {edit.name}
          </h4>
          <textarea
            className={`${field} font-mono`}
            rows={10}
            value={edit.content}
            onChange={(e) => setEdit((s) => (s ? { ...s, content: e.target.value } : s))}
          />
          <div className="mt-2 flex gap-2">
            <button className={btn} onClick={saveEdit} disabled={mgr.isLoading}>
              {t("integrations.nginx.save", "Save")}
            </button>
            <button className={btn} onClick={() => setEdit(null)}>
              {t("integrations.nginx.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
      <JsonView value={detail} />
    </div>
  );
};

// ─── Upstreams tab ────────────────────────────────────────────────────────────

const UpstreamsTab: React.FC<{ mgr: NginxManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<NginxUpstream[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({ name: "", servers: "", loadBalancing: "round_robin", keepalive: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listUpstreams(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!form.name || !form.servers) return;
    const servers = form.servers
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((addr) => ({ address: addr, backup: false, down: false }));
    try {
      await mgr.run(() =>
        mgr.api.createUpstream(cid, {
          name: form.name,
          servers,
          load_balancing: form.loadBalancing || undefined,
          keepalive: form.keepalive ? Number(form.keepalive) : undefined,
        }),
      );
      setForm({ name: "", servers: "", loadBalancing: "round_robin", keepalive: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getUpstream(cid, name)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const setLb = useCallback(
    async (u: NginxUpstream, lb: string) => {
      try {
        await mgr.run(() =>
          mgr.api.updateUpstream(cid, u.name, { name: u.name, load_balancing: lb }),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm(t("integrations.nginx.deleteUpstreamConfirm", "Delete this upstream?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteUpstream(cid, name));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.nginx.createUpstream", "Create upstream")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Labeled label={t("integrations.nginx.name", "Name")}>
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.nginx.servers", "Servers")}>
            <input className={field} value={form.servers} onChange={(e) => setForm((f) => ({ ...f, servers: e.target.value }))} placeholder="10.0.0.1:8080 10.0.0.2:8080" />
          </Labeled>
          <Labeled label={t("integrations.nginx.loadBalancing", "Load balancing")}>
            <select className={field} value={form.loadBalancing} onChange={(e) => setForm((f) => ({ ...f, loadBalancing: e.target.value }))}>
              <option value="round_robin">round_robin</option>
              <option value="least_conn">least_conn</option>
              <option value="ip_hash">ip_hash</option>
              <option value="hash">hash</option>
            </select>
          </Labeled>
          <Labeled label={t("integrations.nginx.keepalive", "Keepalive")}>
            <input className={field} inputMode="numeric" value={form.keepalive} onChange={(e) => setForm((f) => ({ ...f, keepalive: e.target.value }))} />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.name || !form.servers}>
          {t("integrations.nginx.create", "Create")}
        </button>
      </div>
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.nginx.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.nginx.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.nginx.servers", "Servers")}</th>
              <th className="px-2 py-1">{t("integrations.nginx.loadBalancing", "Load balancing")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{u.name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                  {u.servers.map((s) => s.address).join(", ")}
                </td>
                <td className="px-2 py-1">
                  <select
                    className={field}
                    value={u.load_balancing ?? "round_robin"}
                    onChange={(e) => void setLb(u, e.target.value)}
                  >
                    <option value="round_robin">round_robin</option>
                    <option value="least_conn">least_conn</option>
                    <option value="ip_hash">ip_hash</option>
                    <option value="hash">hash</option>
                  </select>
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(u.name)}>
                      {t("integrations.nginx.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void remove(u.name)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.nginx.noUpstreams", "No upstreams")}
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

// ─── SSL tab ──────────────────────────────────────────────────────────────────

const SslTab: React.FC<{ mgr: NginxManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [siteName, setSiteName] = useState("");
  const [certDir, setCertDir] = useState("/etc/nginx/ssl");
  const [certs, setCerts] = useState<string[]>([]);
  const [json, setJson] = useState("");
  const [detail, setDetail] = useState<unknown>(null);

  const listCerts = useCallback(async () => {
    try {
      setCerts(await mgr.run(() => mgr.api.listSslCertificates(cid, certDir)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, certDir]);

  const loadSsl = useCallback(async () => {
    if (!siteName) return;
    try {
      const ssl = await mgr.run(() => mgr.api.getSslConfig(cid, siteName));
      setDetail(ssl);
      setJson(ssl ? JSON.stringify(ssl, null, 2) : "");
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, siteName]);

  const saveSsl = useCallback(async () => {
    if (!siteName || !json) return;
    let ssl;
    try {
      ssl = JSON.parse(json);
    } catch {
      window.alert(t("integrations.nginx.invalidJson", "Invalid JSON"));
      return;
    }
    try {
      await mgr.run(() => mgr.api.updateSslConfig(cid, siteName, ssl));
      await loadSsl();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, siteName, json, loadSsl, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label={t("integrations.nginx.certDir", "Certificate directory")}>
          <input
            className={field}
            style={{ width: 240 }}
            value={certDir}
            onChange={(e) => setCertDir(e.target.value)}
          />
        </Labeled>
        <button className={btn} onClick={listCerts} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.nginx.listCerts", "List certificates")}
        </button>
      </div>
      {certs.length > 0 && (
        <div className={card}>
          <ul className="flex flex-col gap-1 font-mono text-xs text-[var(--color-textSecondary)]">
            {certs.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.nginx.siteSsl", "Per-site SSL config")}
        </h4>
        <div className="flex flex-wrap items-end gap-2">
          <Labeled label={t("integrations.nginx.siteName", "Site name")}>
            <input
              className={field}
              style={{ width: 200 }}
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
            />
          </Labeled>
          <button className={btn} onClick={loadSsl} disabled={mgr.isLoading || !siteName}>
            {t("integrations.nginx.loadSsl", "Load SSL")}
          </button>
        </div>
        <textarea
          className={`${field} mt-2 font-mono`}
          rows={8}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder='{"certificate":"/etc/ssl/cert.pem","certificate_key":"/etc/ssl/key.pem"}'
        />
        <button className={`${btn} mt-2`} onClick={saveSsl} disabled={mgr.isLoading || !siteName || !json}>
          {t("integrations.nginx.updateSsl", "Update SSL")}
        </button>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Logs tab ─────────────────────────────────────────────────────────────────

const LogsTab: React.FC<{ mgr: NginxManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [logDir, setLogDir] = useState("");
  const [query, setQuery] = useState({ path: "", lines: "100", filter: "", level: "" });
  const [access, setAccess] = useState<AccessLogEntry[]>([]);
  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);

  const listFiles = useCallback(async () => {
    try {
      setLogFiles(await mgr.run(() => mgr.api.listLogFiles(cid, logDir || undefined)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, logDir]);

  useEffect(() => {
    void listFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const queryObj = useCallback(
    () => ({
      path: query.path || undefined,
      lines: query.lines ? Number(query.lines) : undefined,
      filter: query.filter || undefined,
      level: query.level || undefined,
    }),
    [query],
  );

  const runAccess = useCallback(async () => {
    try {
      setAccess(await mgr.run(() => mgr.api.queryAccessLog(cid, queryObj())));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, queryObj]);

  const runError = useCallback(async () => {
    try {
      setErrors(await mgr.run(() => mgr.api.queryErrorLog(cid, queryObj())));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, queryObj]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label={t("integrations.nginx.logDir", "Log directory")}>
          <input className={field} style={{ width: 220 }} value={logDir} onChange={(e) => setLogDir(e.target.value)} placeholder="/var/log/nginx" />
        </Labeled>
        <button className={btn} onClick={listFiles} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.nginx.listLogFiles", "List log files")}
        </button>
      </div>
      {logFiles.length > 0 && (
        <div className={card}>
          <ul className="flex flex-col gap-1 font-mono text-xs text-[var(--color-textSecondary)]">
            {logFiles.map((f) => (
              <li key={f}>
                <button className="hover:underline" onClick={() => setQuery((q) => ({ ...q, path: f }))}>
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Labeled label={t("integrations.nginx.logPath", "Log path")}>
            <input className={field} value={query.path} onChange={(e) => setQuery((q) => ({ ...q, path: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.nginx.lines", "Lines")}>
            <input className={field} inputMode="numeric" value={query.lines} onChange={(e) => setQuery((q) => ({ ...q, lines: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.nginx.filter", "Filter")}>
            <input className={field} value={query.filter} onChange={(e) => setQuery((q) => ({ ...q, filter: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.nginx.level", "Level (error log)")}>
            <input className={field} value={query.level} onChange={(e) => setQuery((q) => ({ ...q, level: e.target.value }))} placeholder="warn" />
          </Labeled>
        </div>
        <div className="mt-2 flex gap-2">
          <button className={btn} onClick={runAccess} disabled={mgr.isLoading}>
            {t("integrations.nginx.queryAccess", "Query access log")}
          </button>
          <button className={btn} onClick={runError} disabled={mgr.isLoading}>
            {t("integrations.nginx.queryError", "Query error log")}
          </button>
        </div>
      </div>

      {access.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.nginx.remoteAddr", "Remote")}</th>
                <th className="px-2 py-1">{t("integrations.nginx.request", "Request")}</th>
                <th className="px-2 py-1">{t("integrations.nginx.status", "Status")}</th>
                <th className="px-2 py-1">{t("integrations.nginx.bytes", "Bytes")}</th>
              </tr>
            </thead>
            <tbody>
              {access.map((a, i) => (
                <tr key={i} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{a.remote_addr}</td>
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{a.request}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{a.status}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{a.body_bytes_sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <div className="flex flex-col gap-1 font-mono text-xs">
          {errors.map((e, i) => (
            <div key={i} className="text-[var(--color-textSecondary)]">
              <span className="text-[var(--color-textMuted)]">{e.timestamp}</span>{" "}
              <span className={e.level === "error" ? "text-red-500" : "text-yellow-500"}>[{e.level}]</span>{" "}
              {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Config tab ───────────────────────────────────────────────────────────────

const ConfigTab: React.FC<{ mgr: NginxManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState<unknown>(null);
  const [test, setTest] = useState<ConfigTestResult | null>(null);

  const load = useCallback(async () => {
    try {
      const cfg = await mgr.run(() => mgr.api.getMainConfig(cid));
      setContent(cfg.raw_content);
      setSummary(cfg);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    try {
      await mgr.run(() => mgr.api.updateMainConfig(cid, content));
      await load();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, content, load]);

  const runTest = useCallback(async () => {
    try {
      setTest(await mgr.run(() => mgr.api.testConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={load} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.nginx.reloadConfig", "Reload from server")}
        </button>
        <button className={btn} onClick={runTest} disabled={mgr.isLoading}>
          <ShieldCheck size={12} />
          {t("integrations.nginx.testConfig", "Test config")}
        </button>
        <button className={btn} onClick={save} disabled={mgr.isLoading || !content}>
          {t("integrations.nginx.save", "Save")}
        </button>
      </div>

      {test && (
        <div className={`${card} ${test.success ? "" : "border-red-500/40"}`}>
          <div className={test.success ? "text-green-500" : "text-red-500"}>
            {test.success
              ? t("integrations.nginx.configOk", "Configuration OK")
              : t("integrations.nginx.configFail", "Configuration test failed")}
          </div>
          {test.output && (
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-[var(--color-textSecondary)]">
              {test.output}
            </pre>
          )}
          {test.errors.map((err, i) => (
            <div key={i} className="text-xs text-red-500">{err}</div>
          ))}
        </div>
      )}

      <textarea
        className={`${field} font-mono`}
        rows={16}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <JsonView value={summary} />
    </div>
  );
};

// ─── Snippets tab ─────────────────────────────────────────────────────────────

const SnippetsTab: React.FC<{ mgr: NginxManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<NginxSnippet[]>([]);
  const [form, setForm] = useState({ name: "", description: "", content: "" });
  const [edit, setEdit] = useState<{ name: string; content: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listSnippets(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!form.name || !form.content) return;
    try {
      await mgr.run(() =>
        mgr.api.createSnippet(cid, {
          name: form.name,
          content: form.content,
          description: form.description || undefined,
        }),
      );
      setForm({ name: "", description: "", content: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        const snip = await mgr.run(() => mgr.api.getSnippet(cid, name));
        setEdit({ name: snip.name, content: snip.content });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const saveEdit = useCallback(async () => {
    if (!edit) return;
    try {
      await mgr.run(() => mgr.api.updateSnippet(cid, edit.name, edit.content));
      setEdit(null);
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, edit, refresh]);

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm(t("integrations.nginx.deleteSnippetConfirm", "Delete this snippet?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteSnippet(cid, name));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.nginx.createSnippet", "Create snippet")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.nginx.name", "Name")}>
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.nginx.description", "Description")}>
            <input className={field} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Labeled>
        </div>
        <textarea
          className={`${field} mt-2 font-mono`}
          rows={5}
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          placeholder="gzip on;"
        />
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.name || !form.content}>
          {t("integrations.nginx.create", "Create")}
        </button>
      </div>
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.nginx.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.nginx.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.nginx.path", "Path")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.path} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{s.path}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(s.name)}>
                      {t("integrations.nginx.edit", "Edit")}
                    </button>
                    <button className={btn} onClick={() => void remove(s.name)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.nginx.noSnippets", "No snippets")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.nginx.editSnippet", "Edit snippet")}: {edit.name}
          </h4>
          <textarea
            className={`${field} font-mono`}
            rows={8}
            value={edit.content}
            onChange={(e) => setEdit((s) => (s ? { ...s, content: e.target.value } : s))}
          />
          <div className="mt-2 flex gap-2">
            <button className={btn} onClick={saveEdit} disabled={mgr.isLoading}>
              {t("integrations.nginx.save", "Save")}
            </button>
            <button className={btn} onClick={() => setEdit(null)}>
              {t("integrations.nginx.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
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
  { key: "status", labelKey: "integrations.nginx.tabStatus", labelDefault: "Status", icon: Activity },
  { key: "sites", labelKey: "integrations.nginx.tabSites", labelDefault: "Sites", icon: Globe },
  { key: "upstreams", labelKey: "integrations.nginx.tabUpstreams", labelDefault: "Upstreams", icon: Layers },
  { key: "ssl", labelKey: "integrations.nginx.tabSsl", labelDefault: "SSL", icon: ShieldCheck },
  { key: "logs", labelKey: "integrations.nginx.tabLogs", labelDefault: "Logs", icon: ScrollText },
  { key: "config", labelKey: "integrations.nginx.tabConfig", labelDefault: "Config", icon: FileCog },
  { key: "snippets", labelKey: "integrations.nginx.tabSnippets", labelDefault: "Snippets", icon: FileText },
];

const NginxPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useNginx();
  const [tab, setTab] = useState<TabKey>("status");

  if (!isOpen) return null;

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Server className="h-5 w-5 text-primary" />
          {t("integrations.nginx.title", "Nginx")}
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
              ? mgr.summary?.host ?? t("integrations.nginx.connected", "Connected")
              : t("integrations.nginx.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.nginx.disconnect", "Disconnect")}
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
            {tab === "status" && <StatusTab mgr={mgr} cid={cid} />}
            {tab === "sites" && <SitesTab mgr={mgr} cid={cid} />}
            {tab === "upstreams" && <UpstreamsTab mgr={mgr} cid={cid} />}
            {tab === "ssl" && <SslTab mgr={mgr} cid={cid} />}
            {tab === "logs" && <LogsTab mgr={mgr} cid={cid} />}
            {tab === "config" && <ConfigTab mgr={mgr} cid={cid} />}
            {tab === "snippets" && <SnippetsTab mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default NginxPanel;

/** Registry descriptor for the Nginx integration (category: web).
 *  The Wave-4 web integrator appends this to `registry.web.ts`. */
export const nginxDescriptor: IntegrationDescriptor = {
  key: "nginx",
  label: "Nginx",
  category: "web",
  icon: Server,
  importPanel: () => import("./NginxPanel"),
};
