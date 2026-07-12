// PostfixSubTab — self-contained Postfix (MTA) mini-panel for the unified Mail
// Server panel (t42 Wave M).
//
// Binds ALL 70 sorng-postfix commands (see usePostfix / postfixApi) full-depth.
// Unlike the cpanel/php shells this sub-tab is NOT handed a connectionId: it owns
// its own connect form + connection lifecycle + persistence (via
// useIntegrationConfigStore under integrationKey "mail.postfix"). The connect
// form shows until connected; once connected the body groups the command surface
// into sections (Overview, Config, Maps, Domains, Aliases, Transports, Queue,
// TLS, Restrictions, Milters, Logs) with a service-control bar in the header.

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  FileCode2,
  Inbox,
  Layers,
  ListTree,
  Loader2,
  Lock,
  Mail,
  Plug,
  Power,
  RefreshCw,
  RotateCw,
  ScrollText,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { usePostfix, type PostfixManager } from "../../../hooks/integration/mail/usePostfix";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import type { MailSubTabProps } from "./registry";
import type {
  AliasType,
  CertificateInfo,
  ConfigTestResult,
  DomainType,
  MailStatistics,
  PostfixAlias,
  PostfixDomain,
  PostfixInfo,
  PostfixMailLog,
  PostfixMainCfParam,
  PostfixMap,
  PostfixMapEntry,
  PostfixMasterCfEntry,
  PostfixMilter,
  PostfixQueue,
  PostfixQueueEntry,
  PostfixRestriction,
  PostfixTlsPolicy,
  PostfixTransport,
  QueueName,
  RestrictionStage,
  TlsPolicy,
} from "../../../types/mail/postfix";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

const DOMAIN_TYPES: DomainType[] = ["virtual", "relay", "local"];
const ALIAS_TYPES: AliasType[] = ["virtual", "local"];
const QUEUE_NAMES: QueueName[] = [
  "active",
  "deferred",
  "hold",
  "corrupt",
  "incoming",
];
const TLS_POLICIES: TlsPolicy[] = [
  "none",
  "may",
  "encrypt",
  "dane",
  "verify",
  "secure",
];
const RESTRICTION_STAGES: RestrictionStage[] = [
  "smtpd_relay",
  "smtpd_recipient",
  "smtpd_sender",
  "smtpd_client",
];

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

const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

const TextView: React.FC<{ value?: string | null }> = ({ value }) =>
  value == null || value === "" ? null : (
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {value}
    </pre>
  );

/** Await `p`, funnel through `mgr.run` for loading/error, store the result.
 *  Swallows the rejection (already surfaced via `mgr.error`). */
async function safeLoad<T>(
  mgr: PostfixManager,
  p: () => Promise<T>,
  set: (v: T) => void,
): Promise<void> {
  try {
    set(await mgr.run(p));
  } catch {
    /* surfaced via mgr.error */
  }
}

type SectionKey =
  | "overview"
  | "config"
  | "maps"
  | "domains"
  | "aliases"
  | "transports"
  | "queue"
  | "tls"
  | "restrictions"
  | "milters"
  | "logs";

// ─── Connect form (self-contained + persistence) ─────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  sshUser: string;
  sshPassword: string;
  sshKey: string;
  postfixBin: string;
  configDir: string;
  queueDir: string;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "22",
  sshUser: "root",
  sshPassword: "",
  sshKey: "",
  postfixBin: "/usr/sbin/postfix",
  configDir: "/etc/postfix",
  queueDir: "/var/spool/postfix",
  timeoutSecs: "30",
  name: "",
};

/** SSH password + key bundled into ONE opaque vault secret. */
interface PostfixSecrets {
  sshPassword?: string;
  sshKey?: string;
}

const INTEGRATION_KEY = "mail.postfix";

const ConnectForm: React.FC<{ mgr: PostfixManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>();

  // Prefill from the first persisted "mail.postfix" instance, if any.
  useEffect(() => {
    if (store.isLoading) return;
    const inst = store.instances.find(
      (i) => i.integrationKey === INTEGRATION_KEY,
    );
    if (!inst) return;
    setSavedId(inst.id);
    setForm((f) => ({
      ...f,
      name: inst.name,
      host: inst.host ?? "",
      port: inst.fields?.port ?? "22",
      sshUser: inst.fields?.sshUser ?? "root",
      postfixBin: inst.fields?.postfixBin ?? f.postfixBin,
      configDir: inst.fields?.configDir ?? f.configDir,
      queueDir: inst.fields?.queueDir ?? f.queueDir,
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((raw) => {
      if (!raw) return;
      try {
        const s = JSON.parse(raw) as PostfixSecrets;
        setForm((f) => ({
          ...f,
          sshPassword: s.sshPassword ?? "",
          sshKey: s.sshKey ?? "",
        }));
      } catch {
        setForm((f) => ({ ...f, sshPassword: raw }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? generateId();
    await mgr.connect(id, {
      host: form.host.trim(),
      port: form.port ? Number(form.port) : undefined,
      ssh_user: form.sshUser || undefined,
      ssh_password: form.sshPassword || undefined,
      ssh_key: form.sshKey || undefined,
      postfix_bin: form.postfixBin || undefined,
      config_dir: form.configDir || undefined,
      queue_dir: form.queueDir || undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      sshUser: form.sshUser,
      postfixBin: form.postfixBin,
      configDir: form.configDir,
      queueDir: form.queueDir,
      timeoutSecs: form.timeoutSecs,
    };
    const secrets: PostfixSecrets = {
      sshPassword: form.sshPassword || undefined,
      sshKey: form.sshKey || undefined,
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
        integrationKey: INTEGRATION_KEY,
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={`${card} m-3`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.mail.postfix.host", "SSH host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="mail.example.com"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.postfix.port", "SSH port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.postfix.sshUser", "SSH user")}>
          <input
            className={field}
            value={form.sshUser}
            onChange={(e) => set("sshUser", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.postfix.sshPassword", "SSH password")}
        >
          <input
            className={field}
            type="password"
            value={form.sshPassword}
            onChange={(e) => set("sshPassword", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.postfix.sshKey", "SSH private key")}
        >
          <textarea
            className={`${field} font-mono`}
            rows={2}
            value={form.sshKey}
            onChange={(e) => set("sshKey", e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.postfix.postfixBin", "postfix binary")}
        >
          <input
            className={field}
            value={form.postfixBin}
            onChange={(e) => set("postfixBin", e.target.value)}
            placeholder="/usr/sbin/postfix"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.postfix.configDir", "Config directory")}
        >
          <input
            className={field}
            value={form.configDir}
            onChange={(e) => set("configDir", e.target.value)}
            placeholder="/etc/postfix"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.postfix.queueDir", "Queue directory")}
        >
          <input
            className={field}
            value={form.queueDir}
            onChange={(e) => set("queueDir", e.target.value)}
            placeholder="/var/spool/postfix"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.postfix.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.postfix.instanceName", "Saved name")}
        >
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
          {t("integrations.mail.postfix.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.mail.postfix.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Overview (info / version / status / statistics / ping) ──────────────────

const OverviewSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<PostfixInfo | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stats, setStats] = useState<MailStatistics | null>(null);
  const [pong, setPong] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await mgr.run(async () => {
      await Promise.all([
        safeLoad(mgr, () => mgr.api.info(cid), setInfo),
        safeLoad(mgr, () => mgr.api.version(cid), setVersion),
        safeLoad(mgr, () => mgr.api.status(cid), setStatus),
        safeLoad(mgr, () => mgr.api.getStatistics(cid), setStats),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doPing = useCallback(async () => {
    setPong(await mgr.ping());
  }, [mgr]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.postfix.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={doPing} disabled={mgr.isLoading}>
          <Activity size={12} />
          {t("integrations.mail.postfix.ping", "Ping")}
        </button>
        {version && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.mail.postfix.version", "Version")}: {version}
          </span>
        )}
        {pong && (
          <span className="text-xs text-green-500">{pong}</span>
        )}
      </div>
      {info && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label={t("integrations.mail.postfix.version", "Version")}
            value={info.version}
          />
          <Stat
            label={t("integrations.mail.postfix.mailName", "Mail name")}
            value={info.mail_name}
          />
          <Stat
            label={t("integrations.mail.postfix.configDir", "Config dir")}
            value={info.config_directory}
          />
          <Stat
            label={t("integrations.mail.postfix.queueDir", "Queue dir")}
            value={info.queue_directory}
          />
          <Stat
            label={t("integrations.mail.postfix.daemonDir", "Daemon dir")}
            value={info.daemon_directory}
          />
        </div>
      )}
      {stats && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label={t("integrations.mail.postfix.sent", "Sent")} value={stats.sent} />
          <Stat label={t("integrations.mail.postfix.bounced", "Bounced")} value={stats.bounced} />
          <Stat label={t("integrations.mail.postfix.deferred", "Deferred")} value={stats.deferred} />
          <Stat label={t("integrations.mail.postfix.rejected", "Rejected")} value={stats.rejected} />
          <Stat label={t("integrations.mail.postfix.held", "Held")} value={stats.held} />
          <Stat label={t("integrations.mail.postfix.total", "Total")} value={stats.total} />
        </div>
      )}
      <TextView value={status} />
    </div>
  );
};

// ─── Config (main.cf / master.cf / check) ────────────────────────────────────

const ConfigSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [params, setParams] = useState<PostfixMainCfParam[]>([]);
  const [master, setMaster] = useState<PostfixMasterCfEntry[]>([]);
  const [check, setCheck] = useState<ConfigTestResult | null>(null);
  const [lookup, setLookup] = useState("");
  const [lookupResult, setLookupResult] = useState<PostfixMainCfParam | null>(
    null,
  );
  const [newParam, setNewParam] = useState({ name: "", value: "" });
  const [editEntry, setEditEntry] = useState<PostfixMasterCfEntry | null>(null);

  const refresh = useCallback(async () => {
    await mgr.run(async () => {
      await Promise.all([
        safeLoad(mgr, () => mgr.api.getMainCf(cid), setParams),
        safeLoad(mgr, () => mgr.api.getMasterCf(cid), setMaster),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doGetParam = useCallback(async () => {
    if (!lookup) return;
    await safeLoad(mgr, () => mgr.api.getParam(cid, lookup), setLookupResult);
  }, [mgr, cid, lookup]);

  const doSetParam = useCallback(
    async (name: string, value: string) => {
      if (!name) return;
      try {
        await mgr.run(() => mgr.api.setParam(cid, name, value));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const doDeleteParam = useCallback(
    async (name: string) => {
      try {
        await mgr.run(() => mgr.api.deleteParam(cid, name));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const doCheck = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.checkConfig(cid), setCheck);
  }, [mgr, cid]);

  const doUpdateMaster = useCallback(async () => {
    if (!editEntry) return;
    try {
      await mgr.run(() => mgr.api.updateMasterCf(cid, editEntry));
      setEditEntry(null);
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, editEntry, refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.postfix.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={doCheck} disabled={mgr.isLoading}>
          <ShieldCheck size={12} />
          {t("integrations.mail.postfix.checkConfig", "Check config")}
        </button>
        <input
          className={field}
          style={{ width: 180 }}
          placeholder={t("integrations.mail.postfix.paramName", "Parameter name")}
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void doGetParam()}
        />
        <button className={btn} onClick={doGetParam} disabled={!lookup}>
          {t("integrations.mail.postfix.getParam", "Get")}
        </button>
      </div>

      {check && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            check.success
              ? "border-green-500/40 bg-green-500/10 text-green-500"
              : "border-red-500/40 bg-red-500/10 text-red-500"
          }`}
        >
          <div className="font-semibold">
            {check.success
              ? t("integrations.mail.postfix.configValid", "Configuration OK")
              : t("integrations.mail.postfix.configInvalid", "Configuration errors")}
          </div>
          {check.output && <div className="font-mono">{check.output}</div>}
          {check.errors.map((e, i) => (
            <div key={i} className="font-mono">{e}</div>
          ))}
        </div>
      )}

      {lookupResult && <JsonView value={lookupResult} />}

      <div className={card}>
        <div className="mb-2 flex items-center gap-2">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.paramName", "Parameter name")}
            value={newParam.name}
            onChange={(e) => setNewParam((p) => ({ ...p, name: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.paramValue", "Value")}
            value={newParam.value}
            onChange={(e) => setNewParam((p) => ({ ...p, value: e.target.value }))}
          />
          <button
            className={btn}
            onClick={() => {
              void doSetParam(newParam.name, newParam.value);
              setNewParam({ name: "", value: "" });
            }}
            disabled={!newParam.name}
          >
            {t("integrations.mail.postfix.setParam", "Set")}
          </button>
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.mail.postfix.name", "Name")}</th>
                <th className="px-2 py-1">{t("integrations.mail.postfix.value", "Value")}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.name} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                    {p.name}
                    {p.is_default && (
                      <span className="ml-1 text-[10px] text-[var(--color-textMuted)]">
                        (default)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={field}
                      defaultValue={p.value}
                      onBlur={(ev) =>
                        ev.target.value !== p.value &&
                        void doSetParam(p.name, ev.target.value)
                      }
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button className={btn} onClick={() => void doDeleteParam(p.name)}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {params.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                    {t("integrations.mail.postfix.noParams", "No parameters loaded")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.postfix.masterCf", "master.cf services")}
        </h4>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.mail.postfix.service", "Service")}</th>
                <th className="px-2 py-1">{t("integrations.mail.postfix.type", "Type")}</th>
                <th className="px-2 py-1">{t("integrations.mail.postfix.command", "Command")}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {master.map((m, i) => (
                <tr key={`${m.service_name}-${i}`} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{m.service_name}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{m.service_type}</td>
                  <td className="px-2 py-1 font-mono text-[10px] text-[var(--color-textSecondary)]">{m.command}</td>
                  <td className="px-2 py-1 text-right">
                    <button className={btn} onClick={() => setEditEntry(m)}>
                      {t("integrations.mail.postfix.edit", "Edit")}
                    </button>
                  </td>
                </tr>
              ))}
              {master.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                    {t("integrations.mail.postfix.noServices", "No services loaded")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editEntry && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Labeled label={t("integrations.mail.postfix.service", "Service")}>
              <input
                className={field}
                value={editEntry.service_name}
                onChange={(e) =>
                  setEditEntry({ ...editEntry, service_name: e.target.value })
                }
              />
            </Labeled>
            <Labeled label={t("integrations.mail.postfix.type", "Type")}>
              <input
                className={field}
                value={editEntry.service_type}
                onChange={(e) =>
                  setEditEntry({ ...editEntry, service_type: e.target.value })
                }
              />
            </Labeled>
            <Labeled label={t("integrations.mail.postfix.chroot", "chroot")}>
              <input
                className={field}
                value={editEntry.chroot ?? ""}
                onChange={(e) =>
                  setEditEntry({ ...editEntry, chroot: e.target.value || null })
                }
              />
            </Labeled>
            <Labeled label={t("integrations.mail.postfix.maxproc", "maxproc")}>
              <input
                className={field}
                value={editEntry.maxproc ?? ""}
                onChange={(e) =>
                  setEditEntry({ ...editEntry, maxproc: e.target.value || null })
                }
              />
            </Labeled>
            <Labeled label={t("integrations.mail.postfix.command", "Command")}>
              <input
                className={`${field} font-mono`}
                value={editEntry.command}
                onChange={(e) =>
                  setEditEntry({ ...editEntry, command: e.target.value })
                }
              />
            </Labeled>
            <div className="flex items-end gap-2">
              <button className={btn} onClick={doUpdateMaster} disabled={mgr.isLoading}>
                {t("integrations.mail.postfix.saveEntry", "Save entry")}
              </button>
              <button className={btn} onClick={() => setEditEntry(null)}>
                {t("integrations.mail.postfix.cancel", "Cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Maps ────────────────────────────────────────────────────────────────────

const MapsSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [maps, setMaps] = useState<PostfixMap[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<PostfixMapEntry[]>([]);
  const [form, setForm] = useState({ key: "", value: "" });

  const refresh = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.getMaps(cid), setMaps);
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadEntries = useCallback(
    async (name: string) => {
      setSelected(name);
      await safeLoad(mgr, () => mgr.api.getMapEntries(cid, name), setEntries);
    },
    [mgr, cid],
  );

  const add = useCallback(async () => {
    if (!selected || !form.key) return;
    try {
      await mgr.run(() => mgr.api.setMapEntry(cid, selected, form.key, form.value));
      setForm({ key: "", value: "" });
      await loadEntries(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, form, loadEntries]);

  const del = useCallback(
    async (key: string) => {
      if (!selected) return;
      try {
        await mgr.run(() => mgr.api.deleteMapEntry(cid, selected, key));
        await loadEntries(selected);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, selected, loadEntries],
  );

  const rebuild = useCallback(
    async (name: string) => {
      try {
        await mgr.run(() => mgr.api.rebuildMap(cid, name));
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
        {t("integrations.mail.postfix.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {maps.map((m) => (
          <div
            key={m.name}
            className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
              selected === m.name
                ? "bg-[var(--color-surface)] text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
          >
            <button className="flex-1 text-left" onClick={() => void loadEntries(m.name)}>
              <span className="font-mono">{m.name}</span>
              <span className="ml-2 text-[var(--color-textMuted)]">
                {m.map_type} · {m.path} · {m.entries_count}
              </span>
            </button>
            <button className={btn} onClick={() => void rebuild(m.name)}>
              <RotateCw size={12} />
              {t("integrations.mail.postfix.rebuild", "Rebuild")}
            </button>
          </div>
        ))}
        {maps.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.mail.postfix.noMaps", "No maps")}
          </span>
        )}
      </div>

      {selected && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.mail.postfix.mapEntries", "Entries")}: {selected}
          </h4>
          <div className="mb-2 flex items-center gap-2">
            <input
              className={field}
              placeholder={t("integrations.mail.postfix.key", "Key")}
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            />
            <input
              className={field}
              placeholder={t("integrations.mail.postfix.value", "Value")}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
            <button className={btn} onClick={add} disabled={!form.key}>
              {t("integrations.mail.postfix.set", "Set")}
            </button>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <tbody>
                {entries.map((e) => (
                  <tr key={e.key} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{e.key}</td>
                    <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{e.value}</td>
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
                      {t("integrations.mail.postfix.noEntries", "No entries")}
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

// ─── Domains ─────────────────────────────────────────────────────────────────

const DomainsSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PostfixDomain[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({
    domain: "",
    domain_type: "virtual" as DomainType,
    transport: "",
    description: "",
  });

  const refresh = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.listDomains(cid), setRows);
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (domain: string) => {
      await safeLoad(mgr, () => mgr.api.getDomain(cid, domain), setDetail);
    },
    [mgr, cid],
  );

  const create = useCallback(async () => {
    if (!form.domain) return;
    try {
      await mgr.run(() =>
        mgr.api.createDomain(cid, {
          domain: form.domain,
          domain_type: form.domain_type,
          transport: form.transport || null,
          description: form.description || null,
        }),
      );
      setForm({ domain: "", domain_type: "virtual", transport: "", description: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const update = useCallback(
    async (d: PostfixDomain, domain_type: DomainType) => {
      try {
        await mgr.run(() =>
          mgr.api.updateDomain(cid, d.domain, {
            domain_type,
            transport: d.transport ?? null,
            description: d.description ?? null,
          }),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const del = useCallback(
    async (domain: string) => {
      if (!window.confirm(t("integrations.mail.postfix.deleteConfirm", "Delete {{n}}?").replace("{{n}}", domain))) return;
      try {
        await mgr.run(() => mgr.api.deleteDomain(cid, domain));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.postfix.refresh", "Refresh")}
      </button>
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.domain", "Domain")}
            value={form.domain}
            onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
          />
          <select
            className={field}
            value={form.domain_type}
            onChange={(e) =>
              setForm((f) => ({ ...f, domain_type: e.target.value as DomainType }))
            }
          >
            {DOMAIN_TYPES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.transport", "Transport")}
            value={form.transport}
            onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.description", "Description")}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={!form.domain}>
          {t("integrations.mail.postfix.createDomain", "Create domain")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.postfix.domain", "Domain")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.type", "Type")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.transport", "Transport")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.domain} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">{d.domain}</td>
                <td className="px-2 py-1">
                  <select
                    className={field}
                    value={d.domain_type}
                    onChange={(e) => void update(d, e.target.value as DomainType)}
                  >
                    {DOMAIN_TYPES.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{d.transport ?? "—"}</td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(d.domain)}>
                      {t("integrations.mail.postfix.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void del(d.domain)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.postfix.noDomains", "No domains")}
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

// ─── Aliases ─────────────────────────────────────────────────────────────────

const AliasesSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PostfixAlias[]>([]);
  const [scope, setScope] = useState<"all" | "virtual" | "local">("all");
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({
    address: "",
    recipients: "",
    alias_type: "virtual" as AliasType,
  });

  const refresh = useCallback(async () => {
    const call =
      scope === "virtual"
        ? () => mgr.api.listVirtualAliases(cid)
        : scope === "local"
          ? () => mgr.api.listLocalAliases(cid)
          : () => mgr.api.listAliases(cid);
    await safeLoad(mgr, call, setRows);
  }, [mgr, cid, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (address: string) => {
      await safeLoad(mgr, () => mgr.api.getAlias(cid, address), setDetail);
    },
    [mgr, cid],
  );

  const create = useCallback(async () => {
    if (!form.address) return;
    try {
      await mgr.run(() =>
        mgr.api.createAlias(cid, {
          address: form.address,
          recipients: form.recipients.split(",").map((r) => r.trim()).filter(Boolean),
          alias_type: form.alias_type,
        }),
      );
      setForm({ address: "", recipients: "", alias_type: "virtual" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const toggle = useCallback(
    async (a: PostfixAlias) => {
      try {
        await mgr.run(() =>
          mgr.api.updateAlias(cid, a.address, { enabled: !a.enabled }),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const del = useCallback(
    async (address: string) => {
      try {
        await mgr.run(() => mgr.api.deleteAlias(cid, address));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.postfix.refresh", "Refresh")}
        </button>
        <select
          className={field}
          style={{ width: 140 }}
          value={scope}
          onChange={(e) => setScope(e.target.value as "all" | "virtual" | "local")}
        >
          <option value="all">{t("integrations.mail.postfix.allAliases", "All")}</option>
          <option value="virtual">{t("integrations.mail.postfix.virtual", "Virtual")}</option>
          <option value="local">{t("integrations.mail.postfix.local", "Local")}</option>
        </select>
      </div>
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.address", "Address")}
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.recipientsCsv", "Recipients (comma-sep)")}
            value={form.recipients}
            onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))}
          />
          <select
            className={field}
            value={form.alias_type}
            onChange={(e) =>
              setForm((f) => ({ ...f, alias_type: e.target.value as AliasType }))
            }
          >
            {ALIAS_TYPES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={!form.address}>
          {t("integrations.mail.postfix.createAlias", "Create alias")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.postfix.address", "Address")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.recipients", "Recipients")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.type", "Type")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.address} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">{a.address}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{a.recipients.join(", ")}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{a.alias_type}</td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(a.address)}>
                      {t("integrations.mail.postfix.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void toggle(a)}>
                      {a.enabled
                        ? t("integrations.mail.postfix.disable", "Disable")
                        : t("integrations.mail.postfix.enable", "Enable")}
                    </button>
                    <button className={btn} onClick={() => void del(a.address)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.postfix.noAliases", "No aliases")}
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

// ─── Transports ──────────────────────────────────────────────────────────────

const TransportsSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PostfixTransport[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [form, setForm] = useState({
    domain: "",
    transport: "",
    nexthop: "",
    description: "",
  });

  const refresh = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.listTransports(cid), setRows);
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (domain: string) => {
      await safeLoad(mgr, () => mgr.api.getTransport(cid, domain), setDetail);
    },
    [mgr, cid],
  );

  const test = useCallback(
    async (domain: string) => {
      await safeLoad(mgr, () => mgr.api.testTransport(cid, domain), setTestOut);
    },
    [mgr, cid],
  );

  const create = useCallback(async () => {
    if (!form.domain || !form.transport) return;
    try {
      await mgr.run(() =>
        mgr.api.createTransport(cid, {
          domain: form.domain,
          transport: form.transport,
          nexthop: form.nexthop || null,
          description: form.description || null,
        }),
      );
      setForm({ domain: "", transport: "", nexthop: "", description: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const update = useCallback(
    async (tr: PostfixTransport, transport: string) => {
      try {
        await mgr.run(() =>
          mgr.api.updateTransport(cid, tr.domain, {
            transport,
            nexthop: tr.nexthop ?? null,
            description: tr.description ?? null,
          }),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const del = useCallback(
    async (domain: string) => {
      try {
        await mgr.run(() => mgr.api.deleteTransport(cid, domain));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.postfix.refresh", "Refresh")}
      </button>
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.domain", "Domain")}
            value={form.domain}
            onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.transport", "Transport")}
            value={form.transport}
            onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.nexthop", "Next hop")}
            value={form.nexthop}
            onChange={(e) => setForm((f) => ({ ...f, nexthop: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.description", "Description")}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <button
          className={`${btn} mt-2`}
          onClick={create}
          disabled={!form.domain || !form.transport}
        >
          {t("integrations.mail.postfix.createTransport", "Create transport")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.postfix.domain", "Domain")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.transport", "Transport")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.nexthop", "Next hop")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((tr) => (
              <tr key={tr.domain} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">{tr.domain}</td>
                <td className="px-2 py-1">
                  <input
                    className={field}
                    defaultValue={tr.transport}
                    onBlur={(ev) =>
                      ev.target.value !== tr.transport &&
                      void update(tr, ev.target.value)
                    }
                  />
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{tr.nexthop ?? "—"}</td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(tr.domain)}>
                      {t("integrations.mail.postfix.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void test(tr.domain)}>
                      <Send size={12} />
                      {t("integrations.mail.postfix.test", "Test")}
                    </button>
                    <button className={btn} onClick={() => void del(tr.domain)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.postfix.noTransports", "No transports")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TextView value={testOut} />
      <JsonView value={detail} />
    </div>
  );
};

// ─── Queue ───────────────────────────────────────────────────────────────────

const QueueSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [queues, setQueues] = useState<PostfixQueue[]>([]);
  const [selected, setSelected] = useState<QueueName>("deferred");
  const [entries, setEntries] = useState<PostfixQueueEntry[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.listQueues(cid), setQueues);
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadEntries = useCallback(
    async (q: QueueName) => {
      setSelected(q);
      await safeLoad(mgr, () => mgr.api.listQueueEntries(cid, q), setEntries);
    },
    [mgr, cid],
  );

  const view = useCallback(
    async (queueId: string) => {
      await safeLoad(mgr, () => mgr.api.getQueueEntry(cid, queueId), setDetail);
    },
    [mgr, cid],
  );

  const entryAction = useCallback(
    async (op: "delete" | "hold" | "release", queueId: string) => {
      try {
        await mgr.run(() =>
          op === "delete"
            ? mgr.api.deleteQueueEntry(cid, queueId)
            : op === "hold"
              ? mgr.api.holdQueueEntry(cid, queueId)
              : mgr.api.releaseQueueEntry(cid, queueId),
        );
        await loadEntries(selected);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, selected, loadEntries],
  );

  const bulk = useCallback(
    async (op: "flush" | "flushQueue" | "deleteAll" | "requeueAll" | "purge") => {
      const destructive = op === "deleteAll" || op === "purge";
      if (
        destructive &&
        !window.confirm(
          t("integrations.mail.postfix.queueBulkConfirm", "Run this on the whole queue?"),
        )
      )
        return;
      try {
        await mgr.run(() =>
          op === "flush"
            ? mgr.api.flush(cid)
            : op === "flushQueue"
              ? mgr.api.flushQueue(cid, selected)
              : op === "deleteAll"
                ? mgr.api.deleteAllQueued(cid)
                : op === "requeueAll"
                  ? mgr.api.requeueAll(cid)
                  : mgr.api.purgeQueues(cid),
        );
        await refresh();
        await loadEntries(selected);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, selected, refresh, loadEntries, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.postfix.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={() => void bulk("flush")}>
          {t("integrations.mail.postfix.flushAll", "Flush all")}
        </button>
        <button className={btn} onClick={() => void bulk("flushQueue")}>
          {t("integrations.mail.postfix.flushQueue", "Flush queue")}
        </button>
        <button className={btn} onClick={() => void bulk("requeueAll")}>
          {t("integrations.mail.postfix.requeueAll", "Requeue all")}
        </button>
        <button className={btn} onClick={() => void bulk("deleteAll")}>
          {t("integrations.mail.postfix.deleteAll", "Delete all")}
        </button>
        <button className={btn} onClick={() => void bulk("purge")}>
          {t("integrations.mail.postfix.purge", "Purge")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {queues.map((q) => (
          <button
            key={q.queue_name}
            onClick={() => void loadEntries(q.queue_name)}
            className={`rounded border px-2 py-1 text-left ${
              selected === q.queue_name
                ? "border-primary"
                : "border-[var(--color-border)]"
            }`}
          >
            <div className="text-[10px] uppercase text-[var(--color-textMuted)]">
              {q.queue_name}
            </div>
            <div className="text-sm text-[var(--color-text)]">{q.count}</div>
            <div className="text-[10px] text-[var(--color-textMuted)]">
              {q.size_bytes} B
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <select
          className={field}
          style={{ width: 160 }}
          value={selected}
          onChange={(e) => void loadEntries(e.target.value as QueueName)}
        >
          {QUEUE_NAMES.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
        <button className={btn} onClick={() => void loadEntries(selected)}>
          {t("integrations.mail.postfix.listEntries", "List entries")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.postfix.queueId", "Queue ID")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.sender", "Sender")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.recipients", "Recipients")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.status", "Status")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.queue_id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">{e.queue_id}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{e.sender}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{e.recipients.join(", ")}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{e.status}</td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(e.queue_id)}>
                      {t("integrations.mail.postfix.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void entryAction("hold", e.queue_id)}>
                      {t("integrations.mail.postfix.hold", "Hold")}
                    </button>
                    <button className={btn} onClick={() => void entryAction("release", e.queue_id)}>
                      {t("integrations.mail.postfix.release", "Release")}
                    </button>
                    <button className={btn} onClick={() => void entryAction("delete", e.queue_id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.mail.postfix.noQueueEntries", "No entries in this queue")}
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

// ─── TLS ─────────────────────────────────────────────────────────────────────

const TlsSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [policies, setPolicies] = useState<PostfixTlsPolicy[]>([]);
  const [param, setParam] = useState({ name: "", value: "" });
  const [policyForm, setPolicyForm] = useState({
    domain: "",
    policy: "may" as TlsPolicy,
    match_type: "",
    params: "",
  });
  const [certPath, setCertPath] = useState("");
  const [cert, setCert] = useState<CertificateInfo | null>(null);

  const refresh = useCallback(async () => {
    await mgr.run(async () => {
      await Promise.all([
        safeLoad(mgr, () => mgr.api.getTlsConfig(cid), setConfig),
        safeLoad(mgr, () => mgr.api.listTlsPolicies(cid), setPolicies),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyParam = useCallback(async () => {
    if (!param.name) return;
    try {
      await mgr.run(() => mgr.api.setTlsParam(cid, param.name, param.value));
      setParam({ name: "", value: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, param, refresh]);

  const applyPolicy = useCallback(async () => {
    if (!policyForm.domain) return;
    try {
      await mgr.run(() =>
        mgr.api.setTlsPolicy(cid, policyForm.domain, {
          domain: policyForm.domain,
          policy: policyForm.policy,
          match_type: policyForm.match_type || null,
          params: policyForm.params || null,
        }),
      );
      setPolicyForm({ domain: "", policy: "may", match_type: "", params: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, policyForm, refresh]);

  const delPolicy = useCallback(
    async (domain: string) => {
      try {
        await mgr.run(() => mgr.api.deleteTlsPolicy(cid, domain));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const checkCert = useCallback(async () => {
    if (!certPath) return;
    await safeLoad(mgr, () => mgr.api.checkCertificate(cid, certPath), setCert);
  }, [mgr, cid, certPath]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.postfix.refresh", "Refresh")}
      </button>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.postfix.tlsParams", "TLS parameters")}
        </h4>
        <div className="mb-2 flex items-center gap-2">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.paramName", "Parameter name")}
            value={param.name}
            onChange={(e) => setParam((p) => ({ ...p, name: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.paramValue", "Value")}
            value={param.value}
            onChange={(e) => setParam((p) => ({ ...p, value: e.target.value }))}
          />
          <button className={btn} onClick={applyParam} disabled={!param.name}>
            {t("integrations.mail.postfix.set", "Set")}
          </button>
        </div>
        <div className="max-h-52 overflow-auto">
          <table className="w-full text-left text-xs">
            <tbody>
              {Object.entries(config).map(([k, v]) => (
                <tr key={k} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{k}</td>
                  <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{v}</td>
                </tr>
              ))}
              {Object.keys(config).length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={2}>
                    {t("integrations.mail.postfix.noTlsConfig", "No TLS config loaded")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.postfix.tlsPolicies", "TLS policies (per-domain)")}
        </h4>
        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.domain", "Domain")}
            value={policyForm.domain}
            onChange={(e) => setPolicyForm((p) => ({ ...p, domain: e.target.value }))}
          />
          <select
            className={field}
            value={policyForm.policy}
            onChange={(e) =>
              setPolicyForm((p) => ({ ...p, policy: e.target.value as TlsPolicy }))
            }
          >
            {TLS_POLICIES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.matchType", "Match")}
            value={policyForm.match_type}
            onChange={(e) => setPolicyForm((p) => ({ ...p, match_type: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.params", "Params")}
            value={policyForm.params}
            onChange={(e) => setPolicyForm((p) => ({ ...p, params: e.target.value }))}
          />
        </div>
        <button className={btn} onClick={applyPolicy} disabled={!policyForm.domain}>
          {t("integrations.mail.postfix.setPolicy", "Set policy")}
        </button>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody>
              {policies.map((p) => (
                <tr key={p.domain} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{p.domain}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{p.policy}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{p.match_type ?? "—"}</td>
                  <td className="px-2 py-1 text-right">
                    <button className={btn} onClick={() => void delPolicy(p.domain)}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {policies.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                    {t("integrations.mail.postfix.noPolicies", "No policies")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.postfix.certCheck", "Certificate check")}
        </h4>
        <div className="flex items-center gap-2">
          <input
            className={field}
            placeholder="/etc/postfix/certs/server.pem"
            value={certPath}
            onChange={(e) => setCertPath(e.target.value)}
          />
          <button className={btn} onClick={checkCert} disabled={!certPath}>
            <ShieldCheck size={12} />
            {t("integrations.mail.postfix.check", "Check")}
          </button>
        </div>
        {cert && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Stat label={t("integrations.mail.postfix.subject", "Subject")} value={cert.subject} />
            <Stat label={t("integrations.mail.postfix.issuer", "Issuer")} value={cert.issuer} />
            <Stat label={t("integrations.mail.postfix.notBefore", "Not before")} value={cert.not_before} />
            <Stat label={t("integrations.mail.postfix.notAfter", "Not after")} value={cert.not_after} />
            <Stat label={t("integrations.mail.postfix.fingerprint", "Fingerprint")} value={cert.fingerprint} />
            <Stat label={t("integrations.mail.postfix.serial", "Serial")} value={cert.serial} />
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Restrictions ────────────────────────────────────────────────────────────

const RestrictionsSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [all, setAll] = useState<PostfixRestriction[]>([]);
  const [stage, setStage] = useState<RestrictionStage>("smtpd_recipient");
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [addValue, setAddValue] = useState("");

  const refreshAll = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.listRestrictions(cid), setAll);
  }, [mgr, cid]);

  const loadStage = useCallback(
    async (s: RestrictionStage) => {
      setStage(s);
      await safeLoad(mgr, () => mgr.api.getRestrictions(cid, s), (v) => {
        setList(v);
        setDraft(v.join("\n"));
      });
    },
    [mgr, cid],
  );

  useEffect(() => {
    void refreshAll();
    void loadStage("smtpd_recipient");
  }, [refreshAll, loadStage]);

  const save = useCallback(async () => {
    const arr = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    try {
      await mgr.run(() => mgr.api.setRestrictions(cid, stage, arr));
      await loadStage(stage);
      await refreshAll();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, stage, draft, loadStage, refreshAll]);

  const add = useCallback(async () => {
    if (!addValue) return;
    try {
      await mgr.run(() => mgr.api.addRestriction(cid, stage, addValue));
      setAddValue("");
      await loadStage(stage);
      await refreshAll();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, stage, addValue, loadStage, refreshAll]);

  const remove = useCallback(
    async (value: string) => {
      try {
        await mgr.run(() => mgr.api.removeRestriction(cid, stage, value));
        await loadStage(stage);
        await refreshAll();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, stage, loadStage, refreshAll],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={field}
          style={{ width: 200 }}
          value={stage}
          onChange={(e) => void loadStage(e.target.value as RestrictionStage)}
        >
          {RESTRICTION_STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className={btn} onClick={() => void loadStage(stage)} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.postfix.refresh", "Refresh")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.postfix.stageRestrictions", "Restrictions")}: {stage}
        </h4>
        <div className="mb-2 flex items-center gap-2">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.restriction", "Restriction, e.g. reject_unauth_destination")}
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <button className={btn} onClick={add} disabled={!addValue}>
            {t("integrations.mail.postfix.add", "Add")}
          </button>
        </div>
        <div className="mb-2 flex flex-col gap-1">
          {list.map((r, i) => (
            <div key={`${r}-${i}`} className="flex items-center justify-between text-xs">
              <span className="font-mono text-[var(--color-textSecondary)]">{r}</span>
              <button className={btn} onClick={() => void remove(r)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {list.length === 0 && (
            <span className="text-[var(--color-textMuted)]">
              {t("integrations.mail.postfix.noRestrictions", "None set")}
            </span>
          )}
        </div>
        <Labeled label={t("integrations.mail.postfix.editOrdered", "Edit full ordered list (one per line)")}>
          <textarea
            className={`${field} font-mono`}
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Labeled>
        <button className={`${btn} mt-2`} onClick={save} disabled={mgr.isLoading}>
          {t("integrations.mail.postfix.saveList", "Save list")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.postfix.allRestrictions", "All restrictions")}
        </h4>
        <div className="max-h-52 overflow-auto">
          <table className="w-full text-left text-xs">
            <tbody>
              {all.map((r, i) => (
                <tr key={`${r.stage}-${r.name}-${i}`} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{r.stage}</td>
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{r.name}</td>
                  <td className="px-2 py-1 text-[var(--color-textMuted)]">#{r.position}</td>
                </tr>
              ))}
              {all.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                    {t("integrations.mail.postfix.noRestrictions", "None set")}
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

// ─── Milters ─────────────────────────────────────────────────────────────────

const MiltersSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PostfixMilter[]>([]);
  const [form, setForm] = useState<PostfixMilter>({
    name: "",
    socket: "",
    flags: "",
    protocol: "",
  });

  const refresh = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.listMilters(cid), setRows);
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async () => {
    if (!form.name || !form.socket) return;
    try {
      await mgr.run(() =>
        mgr.api.addMilter(cid, {
          name: form.name,
          socket: form.socket,
          flags: form.flags || null,
          protocol: form.protocol || null,
        }),
      );
      setForm({ name: "", socket: "", flags: "", protocol: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const update = useCallback(
    async (m: PostfixMilter, socket: string) => {
      try {
        await mgr.run(() => mgr.api.updateMilter(cid, m.name, { ...m, socket }));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const remove = useCallback(
    async (name: string) => {
      try {
        await mgr.run(() => mgr.api.removeMilter(cid, name));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.postfix.refresh", "Refresh")}
      </button>
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.name", "Name")}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.socket", "Socket, e.g. inet:localhost:8891")}
            value={form.socket}
            onChange={(e) => setForm((f) => ({ ...f, socket: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.flags", "Flags")}
            value={form.flags ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, flags: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t("integrations.mail.postfix.protocol", "Protocol")}
            value={form.protocol ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, protocol: e.target.value }))}
          />
        </div>
        <button
          className={`${btn} mt-2`}
          onClick={add}
          disabled={!form.name || !form.socket}
        >
          {t("integrations.mail.postfix.addMilter", "Add milter")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.postfix.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.socket", "Socket")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.flags", "Flags")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">{m.name}</td>
                <td className="px-2 py-1">
                  <input
                    className={field}
                    defaultValue={m.socket}
                    onBlur={(ev) =>
                      ev.target.value !== m.socket && void update(m, ev.target.value)
                    }
                  />
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{m.flags ?? "—"}</td>
                <td className="px-2 py-1 text-right">
                  <button className={btn} onClick={() => void remove(m.name)}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.postfix.noMilters", "No milters")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Logs ────────────────────────────────────────────────────────────────────

const LogsSection: React.FC<{ mgr: PostfixManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<PostfixMailLog[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [lines, setLines] = useState("100");
  const [filter, setFilter] = useState("");

  const query = useCallback(async () => {
    await safeLoad(
      mgr,
      () =>
        mgr.api.queryMailLog(
          cid,
          lines ? Number(lines) : undefined,
          filter || undefined,
        ),
      setLogs,
    );
  }, [mgr, cid, lines, filter]);

  const loadFiles = useCallback(async () => {
    await safeLoad(mgr, () => mgr.api.listLogFiles(cid), setFiles);
  }, [mgr, cid]);

  useEffect(() => {
    void query();
    void loadFiles();
  }, [query, loadFiles]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 90 }}
          placeholder={t("integrations.mail.postfix.lines", "Lines")}
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          inputMode="numeric"
        />
        <input
          className={field}
          style={{ width: 220 }}
          placeholder={t("integrations.mail.postfix.filter", "Filter (queue id / text)")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void query()}
        />
        <button className={btn} onClick={query} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.postfix.query", "Query")}
        </button>
        {files.length > 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {files.join(", ")}
          </span>
        )}
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.postfix.time", "Time")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.process", "Process")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.queueId", "Queue ID")}</th>
              <th className="px-2 py-1">{t("integrations.mail.postfix.message", "Message")}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 whitespace-nowrap text-[var(--color-textMuted)]">{l.timestamp ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{l.process ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{l.queue_id ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-[10px] text-[var(--color-textSecondary)]">{l.message}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.postfix.noLogs", "No log lines")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Sub-tab shell ───────────────────────────────────────────────────────────

const SECTIONS: {
  key: SectionKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "overview", labelKey: "integrations.mail.postfix.secOverview", labelDefault: "Overview", icon: Activity },
  { key: "config", labelKey: "integrations.mail.postfix.secConfig", labelDefault: "Config", icon: FileCode2 },
  { key: "maps", labelKey: "integrations.mail.postfix.secMaps", labelDefault: "Maps", icon: Layers },
  { key: "domains", labelKey: "integrations.mail.postfix.secDomains", labelDefault: "Domains", icon: Mail },
  { key: "aliases", labelKey: "integrations.mail.postfix.secAliases", labelDefault: "Aliases", icon: Users },
  { key: "transports", labelKey: "integrations.mail.postfix.secTransports", labelDefault: "Transports", icon: Send },
  { key: "queue", labelKey: "integrations.mail.postfix.secQueue", labelDefault: "Queue", icon: Inbox },
  { key: "tls", labelKey: "integrations.mail.postfix.secTls", labelDefault: "TLS", icon: Lock },
  { key: "restrictions", labelKey: "integrations.mail.postfix.secRestrictions", labelDefault: "Restrictions", icon: ShieldAlert },
  { key: "milters", labelKey: "integrations.mail.postfix.secMilters", labelDefault: "Milters", icon: ListTree },
  { key: "logs", labelKey: "integrations.mail.postfix.secLogs", labelDefault: "Logs", icon: ScrollText },
];

const PostfixSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const mgr = usePostfix();
  const [section, setSection] = useState<SectionKey>("overview");

  const cid = mgr.connectionId;

  const control = useCallback(
    async (op: "start" | "stop" | "restart" | "reload") => {
      if (!cid) return;
      if (
        (op === "stop" || op === "restart") &&
        !window.confirm(
          t("integrations.mail.postfix.controlConfirm", "Run '{{op}}' on Postfix?").replace(
            "{{op}}",
            op,
          ),
        )
      )
        return;
      try {
        await mgr.run(() => mgr.api[op](cid));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, t],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"
              }`}
            />
            {mgr.isConnected
              ? mgr.summary?.host ?? t("integrations.mail.postfix.connected", "Connected")
              : t("integrations.mail.postfix.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.summary?.mydomain && (
            <span className="text-[var(--color-textMuted)]">{mgr.summary.mydomain}</span>
          )}
        </div>
        {mgr.isConnected && (
          <div className="flex items-center gap-1">
            <button className={btn} onClick={() => void control("reload")} disabled={mgr.isLoading}>
              <RotateCw size={12} />
              {t("integrations.mail.postfix.reload", "Reload")}
            </button>
            <button className={btn} onClick={() => void control("start")} disabled={mgr.isLoading}>
              <Power size={12} />
              {t("integrations.mail.postfix.start", "Start")}
            </button>
            <button className={btn} onClick={() => void control("restart")} disabled={mgr.isLoading}>
              <RotateCw size={12} />
              {t("integrations.mail.postfix.restart", "Restart")}
            </button>
            <button className={btn} onClick={() => void control("stop")} disabled={mgr.isLoading}>
              <Power size={12} />
              {t("integrations.mail.postfix.stop", "Stop")}
            </button>
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.mail.postfix.disconnect", "Disconnect")}
            </button>
          </div>
        )}
      </div>

      {mgr.error && (
        <div className="mx-3 mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected || !cid ? (
        <ConnectForm mgr={mgr} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2">
            {SECTIONS.map(({ key, labelKey, labelDefault, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                  section === key
                    ? "border-primary text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-textSecondary)]"
                }`}
              >
                <Icon size={12} />
                {t(labelKey, labelDefault)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {section === "overview" && <OverviewSection mgr={mgr} cid={cid} />}
            {section === "config" && <ConfigSection mgr={mgr} cid={cid} />}
            {section === "maps" && <MapsSection mgr={mgr} cid={cid} />}
            {section === "domains" && <DomainsSection mgr={mgr} cid={cid} />}
            {section === "aliases" && <AliasesSection mgr={mgr} cid={cid} />}
            {section === "transports" && <TransportsSection mgr={mgr} cid={cid} />}
            {section === "queue" && <QueueSection mgr={mgr} cid={cid} />}
            {section === "tls" && <TlsSection mgr={mgr} cid={cid} />}
            {section === "restrictions" && <RestrictionsSection mgr={mgr} cid={cid} />}
            {section === "milters" && <MiltersSection mgr={mgr} cid={cid} />}
            {section === "logs" && <LogsSection mgr={mgr} cid={cid} />}
          </div>
        </div>
      )}
    </div>
  );
};

export default PostfixSubTab;
