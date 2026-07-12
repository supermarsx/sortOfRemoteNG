// DovecotSubTab — self-contained "Dovecot (IMAP/POP3)" sub-tab for the unified
// Mail Server panel (t42 Wave M, t42-mail-dovecot). Unlike the cpanel/php shells,
// this tab owns its ENTIRE lifecycle: an SSH connect/config form (shown until
// connected) that persists via `useIntegrationConfigStore` under the namespaced
// key `"mail.dovecot"`, then a section-nav management surface that drives the 70
// `dovecot_*` commands (via `dovecotApi`) grouped by concern — mailboxes, users &
// auth, sieve, quota, config/plugins, ACL, replication, service, and logs.
//
// serde: the config passed to `dovecot_connect` is snake_case verbatim; the SSH
// password is never persisted directly — the config store vaults it and keeps
// only a reference (see `useIntegrationConfigStore`).

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Plug,
  PlugZap,
  Inbox,
  Users,
  FileCode2,
  Gauge,
  Settings2,
  Shield,
  Copy,
  ServerCog,
  ScrollText,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MailSubTabProps } from "./registry";
import type {
  DovecotConnectionConfig,
  DovecotConnectionSummary,
} from "../../../types/mail/dovecot";
import { useDovecot } from "../../../hooks/integration/mail/useDovecot";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";

const INTEGRATION_KEY = "mail.dovecot";
const DEFAULT_PORT = 22;
const DEFAULT_TIMEOUT_SECS = 30;

const emptyForm = {
  name: "",
  host: "",
  port: String(DEFAULT_PORT),
  ssh_user: "",
  ssh_password: "",
  ssh_key: "",
  doveadm_bin: "",
  dovecot_bin: "",
  config_dir: "",
  timeout_secs: String(DEFAULT_TIMEOUT_SECS),
};

type FormState = typeof emptyForm;

type SectionKey =
  | "service"
  | "mailboxes"
  | "users"
  | "sieve"
  | "quota"
  | "config"
  | "acl"
  | "replication"
  | "logs";

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const labelCls =
  "flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]";
const btnCls =
  "flex items-center justify-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const ghostBtnCls =
  "flex items-center gap-1.5 rounded border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";

const DovecotSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const { isLoading: storeLoading, instancesFor, createInstance, updateInstance, readSecret } =
    useIntegrationConfigStore();
  const {
    connectionId,
    summary,
    connecting,
    error,
    connect,
    disconnect,
    setError,
    api,
  } = useDovecot();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("service");

  // Prefill from the single persisted "mail.dovecot" instance, if one exists.
  useEffect(() => {
    if (storeLoading) return;
    const instance = instancesFor(INTEGRATION_KEY)[0];
    if (!instance) return;
    setInstanceId(instance.id);
    let cancelled = false;
    (async () => {
      const secret = (await readSecret(instance)) ?? "";
      if (cancelled) return;
      const f = instance.fields ?? {};
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        port: f.port ?? String(DEFAULT_PORT),
        ssh_user: f.ssh_user ?? "",
        ssh_password: secret,
        ssh_key: f.ssh_key ?? "",
        doveadm_bin: f.doveadm_bin ?? "",
        dovecot_bin: f.dovecot_bin ?? "",
        config_dir: f.config_dir ?? "",
        timeout_secs: f.timeout_secs ?? String(DEFAULT_TIMEOUT_SECS),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [storeLoading, instancesFor, readSecret]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const buildConfig = useCallback((): DovecotConnectionConfig => {
    const port = Number.parseInt(form.port, 10);
    const timeout = Number.parseInt(form.timeout_secs, 10);
    const cfg: DovecotConnectionConfig = {
      host: form.host.trim(),
      port: Number.isFinite(port) ? port : DEFAULT_PORT,
      timeout_secs: Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_SECS,
    };
    if (form.ssh_user.trim()) cfg.ssh_user = form.ssh_user.trim();
    if (form.ssh_password) cfg.ssh_password = form.ssh_password;
    if (form.ssh_key.trim()) cfg.ssh_key = form.ssh_key.trim();
    if (form.doveadm_bin.trim()) cfg.doveadm_bin = form.doveadm_bin.trim();
    if (form.dovecot_bin.trim()) cfg.dovecot_bin = form.dovecot_bin.trim();
    if (form.config_dir.trim()) cfg.config_dir = form.config_dir.trim();
    return cfg;
  }, [form]);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const config = buildConfig();
      const name = form.name.trim() || config.host || "dovecot";
      const fields: Record<string, string> = {
        port: String(config.port ?? DEFAULT_PORT),
        timeout_secs: String(config.timeout_secs ?? DEFAULT_TIMEOUT_SECS),
      };
      if (config.ssh_user) fields.ssh_user = config.ssh_user;
      if (config.ssh_key) fields.ssh_key = config.ssh_key;
      if (config.doveadm_bin) fields.doveadm_bin = config.doveadm_bin;
      if (config.dovecot_bin) fields.dovecot_bin = config.dovecot_bin;
      if (config.config_dir) fields.config_dir = config.config_dir;

      // Persist non-secret config + vault the SSH password; reuse the instance id
      // as the stable connection id so reconnecting a saved instance keeps its id.
      let id = instanceId;
      if (id) {
        await updateInstance(id, {
          integrationKey: INTEGRATION_KEY,
          name,
          host: config.host,
          fields,
          secret: config.ssh_password,
        });
      } else {
        const created = await createInstance({
          integrationKey: INTEGRATION_KEY,
          name,
          host: config.host,
          fields,
          secret: config.ssh_password,
        });
        id = created.id;
        setInstanceId(id);
      }

      await connect(id, config);
      setSection("service");
    } catch {
      // `connect` surfaced the error via the hook; leave the form editable.
    }
  }, [buildConfig, form, instanceId, createInstance, updateInstance, connect, setError]);

  if (connectionId) {
    return (
      <ConnectedView
        connectionId={connectionId}
        summary={summary}
        section={section}
        setSection={setSection}
        onDisconnect={disconnect}
        error={error}
        api={api}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-md flex-col gap-3">
        <p className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.mail.dovecot.connectHint",
            "Manage a Dovecot IMAP/POP3 server over SSH via doveadm. Provide the SSH host and credentials for the machine running Dovecot.",
          )}
        </p>

        {error && (
          <div className="rounded bg-[var(--color-dangerBg,#3a1a1a)] px-3 py-2 text-xs text-[var(--color-danger,#f87171)]">
            {error}
          </div>
        )}

        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.name", "Name")}
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="mail-imap-01"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className={`${labelCls} col-span-2`}>
            {t("integrations.mail.dovecot.fields.host", "SSH host")}
            <input
              className={inputCls}
              value={form.host}
              onChange={(e) => setField("host", e.target.value)}
              placeholder="imap.example.com"
            />
          </label>
          <label className={labelCls}>
            {t("integrations.mail.dovecot.fields.port", "Port")}
            <input
              className={inputCls}
              value={form.port}
              onChange={(e) => setField("port", e.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>

        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.sshUser", "SSH user")}
          <input
            className={inputCls}
            value={form.ssh_user}
            onChange={(e) => setField("ssh_user", e.target.value)}
            placeholder="root"
            autoComplete="off"
          />
        </label>

        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.sshPassword", "SSH password")}
          <input
            type="password"
            className={inputCls}
            value={form.ssh_password}
            onChange={(e) => setField("ssh_password", e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.sshKey", "SSH private key path")}
          <input
            className={inputCls}
            value={form.ssh_key}
            onChange={(e) => setField("ssh_key", e.target.value)}
            placeholder="~/.ssh/id_ed25519"
            autoComplete="off"
          />
        </label>

        <details className="text-xs text-[var(--color-textSecondary)]">
          <summary className="cursor-pointer select-none py-1">
            {t("integrations.mail.dovecot.advanced", "Advanced (binary & config paths)")}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <label className={labelCls}>
              {t("integrations.mail.dovecot.fields.doveadmBin", "doveadm path")}
              <input
                className={inputCls}
                value={form.doveadm_bin}
                onChange={(e) => setField("doveadm_bin", e.target.value)}
                placeholder="/usr/bin/doveadm"
              />
            </label>
            <label className={labelCls}>
              {t("integrations.mail.dovecot.fields.dovecotBin", "dovecot binary path")}
              <input
                className={inputCls}
                value={form.dovecot_bin}
                onChange={(e) => setField("dovecot_bin", e.target.value)}
                placeholder="/usr/sbin/dovecot"
              />
            </label>
            <label className={labelCls}>
              {t("integrations.mail.dovecot.fields.configDir", "Config directory")}
              <input
                className={inputCls}
                value={form.config_dir}
                onChange={(e) => setField("config_dir", e.target.value)}
                placeholder="/etc/dovecot"
              />
            </label>
            <label className={labelCls}>
              {t("integrations.mail.dovecot.fields.timeoutSecs", "Timeout (s)")}
              <input
                className={inputCls}
                value={form.timeout_secs}
                onChange={(e) => setField("timeout_secs", e.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>
        </details>

        <button
          onClick={handleConnect}
          disabled={connecting || !form.host.trim()}
          className={`${btnCls} mt-2 py-2`}
        >
          {connecting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Plug size={16} />
          )}
          {t("integrations.mail.dovecot.connect", "Connect")}
        </button>
      </div>
    </div>
  );
};

// ── Connected management surface ─────────────────────────────────────────────

interface ConnectedViewProps {
  connectionId: string;
  summary: DovecotConnectionSummary | null;
  section: SectionKey;
  setSection: (s: SectionKey) => void;
  onDisconnect: () => void;
  error: string | null;
  api: ReturnType<typeof useDovecot>["api"];
}

const SECTIONS: { key: SectionKey; labelKey: string; label: string; Icon: typeof Inbox }[] = [
  { key: "service", labelKey: "integrations.mail.dovecot.sections.service", label: "Service", Icon: ServerCog },
  { key: "mailboxes", labelKey: "integrations.mail.dovecot.sections.mailboxes", label: "Mailboxes", Icon: Inbox },
  { key: "users", labelKey: "integrations.mail.dovecot.sections.users", label: "Users & auth", Icon: Users },
  { key: "sieve", labelKey: "integrations.mail.dovecot.sections.sieve", label: "Sieve", Icon: FileCode2 },
  { key: "quota", labelKey: "integrations.mail.dovecot.sections.quota", label: "Quota", Icon: Gauge },
  { key: "config", labelKey: "integrations.mail.dovecot.sections.config", label: "Config & plugins", Icon: Settings2 },
  { key: "acl", labelKey: "integrations.mail.dovecot.sections.acl", label: "ACL", Icon: Shield },
  { key: "replication", labelKey: "integrations.mail.dovecot.sections.replication", label: "Replication", Icon: Copy },
  { key: "logs", labelKey: "integrations.mail.dovecot.sections.logs", label: "Logs", Icon: ScrollText },
];

const ConnectedView: React.FC<ConnectedViewProps> = ({
  connectionId,
  summary,
  section,
  setSection,
  onDisconnect,
  error,
  api,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <Inbox className="h-4 w-4 text-primary" />
          <span className="font-medium">{summary?.host ?? connectionId}</span>
          {summary?.version && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {summary.version}
            </span>
          )}
          {summary?.protocols && summary.protocols.length > 0 && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {summary.protocols.join(", ")}
            </span>
          )}
        </div>
        <button onClick={onDisconnect} className={ghostBtnCls}>
          <PlugZap size={14} />
          {t("integrations.mail.dovecot.disconnect", "Disconnect")}
        </button>
      </div>

      {error && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-4 py-2 text-xs text-[var(--color-danger,#f87171)]">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2">
        {SECTIONS.map(({ key, labelKey, label, Icon }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm ${
              section === key
                ? "border-b-2 border-primary text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
          >
            <Icon size={14} />
            {t(labelKey, label)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {section === "service" && <ServiceSection id={connectionId} api={api} />}
        {section === "mailboxes" && <MailboxesSection id={connectionId} api={api} />}
        {section === "users" && <UsersSection id={connectionId} api={api} />}
        {section === "sieve" && <SieveSection id={connectionId} api={api} />}
        {section === "quota" && <QuotaSection id={connectionId} api={api} />}
        {section === "config" && <ConfigSection id={connectionId} api={api} />}
        {section === "acl" && <AclSection id={connectionId} api={api} />}
        {section === "replication" && <ReplicationSection id={connectionId} api={api} />}
        {section === "logs" && <LogsSection id={connectionId} api={api} />}
      </div>
    </div>
  );
};

// ── Shared section helpers ───────────────────────────────────────────────────

type Api = ReturnType<typeof useDovecot>["api"];
interface SectionProps {
  id: string;
  api: Api;
}

/** Small hook: run an async api call while tracking busy + error locally. */
function useRunner() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr(typeof e === "string" ? e : (e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, err, setErr, run };
}

const SectionShell: React.FC<{
  title: string;
  busy?: boolean;
  err?: string | null;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, busy, err, children, actions }) => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
        {title}
        {busy && <Loader2 size={14} className="animate-spin text-primary" />}
      </h3>
      {actions}
    </div>
    {err && (
      <div className="rounded bg-[var(--color-dangerBg,#3a1a1a)] px-3 py-2 text-xs text-[var(--color-danger,#f87171)]">
        {err}
      </div>
    )}
    {children}
  </div>
);

const Pre: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <pre className="max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 text-xs text-[var(--color-text)]">
    {children}
  </pre>
);

// ── Service section ──────────────────────────────────────────────────────────

const ServiceSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [output, setOutput] = useState<string>("");

  const show = useCallback((v: unknown) => setOutput(JSON.stringify(v, null, 2)), []);

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.service", "Service")} busy={busy} err={err}>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} onClick={() => run(() => api.start(id))} disabled={busy}>
          <Play size={14} /> {t("integrations.mail.dovecot.actions.start", "Start")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.stop(id))} disabled={busy}>
          <Square size={14} /> {t("integrations.mail.dovecot.actions.stop", "Stop")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.restart(id))} disabled={busy}>
          <RotateCcw size={14} /> {t("integrations.mail.dovecot.actions.restart", "Restart")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.reload(id))} disabled={busy}>
          <RefreshCw size={14} /> {t("integrations.mail.dovecot.actions.reload", "Reload")}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} onClick={() => run(() => api.status(id).then(show))} disabled={busy}>
          {t("integrations.mail.dovecot.actions.status", "Status")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.version(id).then(show))} disabled={busy}>
          {t("integrations.mail.dovecot.actions.version", "Version")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.info(id).then(show))} disabled={busy}>
          {t("integrations.mail.dovecot.actions.info", "Info")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.testConfig(id).then(show))} disabled={busy}>
          {t("integrations.mail.dovecot.actions.testConfig", "Test config")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.processTestConfig(id).then(show))} disabled={busy}>
          {t("integrations.mail.dovecot.actions.processTestConfig", "Process test config")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.processWho(id).then(show))} disabled={busy}>
          {t("integrations.mail.dovecot.actions.processWho", "Process who")}
        </button>
        <button className={ghostBtnCls} onClick={() => run(() => api.processStats(id).then(show))} disabled={busy}>
          {t("integrations.mail.dovecot.actions.processStats", "Process stats")}
        </button>
      </div>
      {output && <Pre>{output}</Pre>}
    </SectionShell>
  );
};

// ── Mailboxes section ────────────────────────────────────────────────────────

const MailboxesSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [user, setUser] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [output, setOutput] = useState<unknown>(null);

  const show = useCallback((v: unknown) => setOutput(v), []);

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.mailboxes", "Mailboxes")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.user", "User")}
          <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.mailbox", "Mailbox")}
          <input className={inputCls} value={mailbox} onChange={(e) => setMailbox(e.target.value)} placeholder="INBOX" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.listMailboxes(id, user).then(show))}>
          {t("integrations.mail.dovecot.actions.list", "List")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox} onClick={() => run(() => api.mailboxStatus(id, user, mailbox).then(show))}>
          {t("integrations.mail.dovecot.actions.mailboxStatus", "Status")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox} onClick={() => run(() => api.createMailbox(id, user, mailbox))}>
          {t("integrations.mail.dovecot.actions.create", "Create")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox} onClick={() => run(() => api.deleteMailbox(id, user, mailbox))}>
          {t("integrations.mail.dovecot.actions.delete", "Delete")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox} onClick={() => run(() => api.subscribeMailbox(id, user, mailbox))}>
          {t("integrations.mail.dovecot.actions.subscribe", "Subscribe")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox} onClick={() => run(() => api.unsubscribeMailbox(id, user, mailbox))}>
          {t("integrations.mail.dovecot.actions.unsubscribe", "Unsubscribe")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.listSubscriptions(id, user).then(show))}>
          {t("integrations.mail.dovecot.actions.subscriptions", "Subscriptions")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.syncMailbox(id, user))}>
          {t("integrations.mail.dovecot.actions.sync", "Sync")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox} onClick={() => run(() => api.forceResync(id, user, mailbox))}>
          {t("integrations.mail.dovecot.actions.forceResync", "Force resync")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

// ── Users & auth section ─────────────────────────────────────────────────────

const UsersSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const show = useCallback((v: unknown) => setOutput(v), []);

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.users", "Users & auth")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.username", "Username")}
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="user@example.com" autoComplete="off" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.password", "Password")}
          <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.listUsers(id).then(show))}>
          {t("integrations.mail.dovecot.actions.list", "List")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !username} onClick={() => run(() => api.getUser(id, username).then(show))}>
          {t("integrations.mail.dovecot.actions.getUser", "Get")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !username} onClick={() => run(() => api.createUser(id, { username, password: password || undefined }).then(show))}>
          {t("integrations.mail.dovecot.actions.create", "Create")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !username} onClick={() => run(() => api.updateUser(id, username, { password: password || undefined }).then(show))}>
          {t("integrations.mail.dovecot.actions.update", "Update")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !username} onClick={() => run(() => api.deleteUser(id, username))}>
          {t("integrations.mail.dovecot.actions.delete", "Delete")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !username || !password} onClick={() => run(() => api.authTest(id, username, password).then((ok) => show({ authenticated: ok })))}>
          {t("integrations.mail.dovecot.actions.authTest", "Auth test")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !username} onClick={() => run(() => api.kickUser(id, username))}>
          {t("integrations.mail.dovecot.actions.kick", "Kick")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.who(id).then(show))}>
          {t("integrations.mail.dovecot.actions.who", "Who")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

// ── Sieve section ────────────────────────────────────────────────────────────

const SieveSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [user, setUser] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const show = useCallback((v: unknown) => setOutput(v), []);

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.sieve", "Sieve")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.user", "User")}
          <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.scriptName", "Script name")}
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="default" />
        </label>
      </div>
      <label className={labelCls}>
        {t("integrations.mail.dovecot.fields.scriptContent", "Script content")}
        <textarea
          className={`${inputCls} h-24 font-mono`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'require "fileinto";\n# ...'}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.listSieve(id, user).then(show))}>
          {t("integrations.mail.dovecot.actions.list", "List")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !name} onClick={() => run(() => api.getSieve(id, user, name).then(show))}>
          {t("integrations.mail.dovecot.actions.getScript", "Get")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !name || !content} onClick={() => run(() => api.createSieve(id, user, { name, content }).then(show))}>
          {t("integrations.mail.dovecot.actions.create", "Create")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !name} onClick={() => run(() => api.updateSieve(id, user, name, { content }).then(show))}>
          {t("integrations.mail.dovecot.actions.update", "Update")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !name} onClick={() => run(() => api.deleteSieve(id, user, name))}>
          {t("integrations.mail.dovecot.actions.delete", "Delete")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !name} onClick={() => run(() => api.activateSieve(id, user, name))}>
          {t("integrations.mail.dovecot.actions.activate", "Activate")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.deactivateSieve(id, user))}>
          {t("integrations.mail.dovecot.actions.deactivate", "Deactivate")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !name} onClick={() => run(() => api.compileSieve(id, user, name).then(show))}>
          {t("integrations.mail.dovecot.actions.compile", "Compile")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

// ── Quota section ────────────────────────────────────────────────────────────

const QuotaSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [user, setUser] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [storageMb, setStorageMb] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const show = useCallback((v: unknown) => setOutput(v), []);

  const buildRule = () => {
    const mb = Number.parseInt(storageMb, 10);
    return {
      rule: ruleName || "*",
      storage_limit_mb: Number.isFinite(mb) ? mb : undefined,
    };
  };

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.quota", "Quota")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.user", "User")}
          <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.ruleName", "Rule name")}
          <input className={inputCls} value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="*" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.storageMb", "Storage (MB)")}
          <input className={inputCls} value={storageMb} onChange={(e) => setStorageMb(e.target.value)} inputMode="numeric" placeholder="1024" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.getQuota(id, user).then(show))}>
          {t("integrations.mail.dovecot.actions.getQuota", "Get quota")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.setQuota(id, user, buildRule()))}>
          {t("integrations.mail.dovecot.actions.setQuota", "Set quota")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.recalculateQuota(id, user))}>
          {t("integrations.mail.dovecot.actions.recalculate", "Recalculate")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.listQuotaRules(id).then(show))}>
          {t("integrations.mail.dovecot.actions.listRules", "List rules")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.setQuotaRule(id, buildRule()))}>
          {t("integrations.mail.dovecot.actions.setRule", "Set rule")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !ruleName} onClick={() => run(() => api.deleteQuotaRule(id, ruleName))}>
          {t("integrations.mail.dovecot.actions.deleteRule", "Delete rule")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

// ── Config & plugins section ─────────────────────────────────────────────────

const ConfigSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [paramName, setParamName] = useState("");
  const [paramValue, setParamValue] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const show = useCallback((v: unknown) => setOutput(v), []);

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.config", "Config & plugins")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.paramName", "Parameter")}
          <input className={inputCls} value={paramName} onChange={(e) => setParamName(e.target.value)} placeholder="mail_location" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.paramValue", "Value")}
          <input className={inputCls} value={paramValue} onChange={(e) => setParamValue(e.target.value)} />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.pluginName", "Plugin")}
          <input className={inputCls} value={pluginName} onChange={(e) => setPluginName(e.target.value)} placeholder="quota" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.getConfig(id).then(show))}>
          {t("integrations.mail.dovecot.actions.getConfig", "Get config")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !paramName} onClick={() => run(() => api.getConfigParam(id, paramName).then((v) => show({ [paramName]: v })))}>
          {t("integrations.mail.dovecot.actions.getParam", "Get param")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !paramName} onClick={() => run(() => api.setConfigParam(id, paramName, paramValue))}>
          {t("integrations.mail.dovecot.actions.setParam", "Set param")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.listNamespaces(id).then(show))}>
          {t("integrations.mail.dovecot.actions.listNamespaces", "Namespaces")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !paramName} onClick={() => run(() => api.getNamespace(id, paramName).then(show))}>
          {t("integrations.mail.dovecot.actions.getNamespace", "Get namespace")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.listServices(id).then(show))}>
          {t("integrations.mail.dovecot.actions.listServices", "Services")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.getAuthConfig(id).then(show))}>
          {t("integrations.mail.dovecot.actions.authConfig", "Auth config")}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.listPlugins(id).then(show))}>
          {t("integrations.mail.dovecot.actions.listPlugins", "List plugins")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !pluginName} onClick={() => run(() => api.enablePlugin(id, pluginName))}>
          {t("integrations.mail.dovecot.actions.enablePlugin", "Enable plugin")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !pluginName} onClick={() => run(() => api.disablePlugin(id, pluginName))}>
          {t("integrations.mail.dovecot.actions.disablePlugin", "Disable plugin")}
        </button>
        <button
          className={ghostBtnCls}
          disabled={busy || !pluginName || !paramName}
          onClick={() => run(() => api.configurePlugin(id, pluginName, { [paramName]: paramValue }))}
        >
          {t("integrations.mail.dovecot.actions.configurePlugin", "Configure plugin")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

// ── ACL section ──────────────────────────────────────────────────────────────

const AclSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [user, setUser] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [rights, setRights] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const show = useCallback((v: unknown) => setOutput(v), []);

  const rightsList = () => rights.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean);

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.acl", "ACL")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.user", "User")}
          <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.mailbox", "Mailbox")}
          <input className={inputCls} value={mailbox} onChange={(e) => setMailbox(e.target.value)} placeholder="INBOX" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.identifier", "Identifier")}
          <input className={inputCls} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="user=other@example.com" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.rights", "Rights")}
          <input className={inputCls} value={rights} onChange={(e) => setRights(e.target.value)} placeholder="lookup read write" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox} onClick={() => run(() => api.listAcls(id, user, mailbox).then(show))}>
          {t("integrations.mail.dovecot.actions.list", "List")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox || !identifier} onClick={() => run(() => api.getAcl(id, user, mailbox, identifier).then(show))}>
          {t("integrations.mail.dovecot.actions.getAcl", "Get")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox || !identifier} onClick={() => run(() => api.setAcl(id, user, mailbox, identifier, rightsList()))}>
          {t("integrations.mail.dovecot.actions.setAcl", "Set")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !mailbox || !identifier} onClick={() => run(() => api.deleteAcl(id, user, mailbox, identifier))}>
          {t("integrations.mail.dovecot.actions.delete", "Delete")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

// ── Replication section ──────────────────────────────────────────────────────

const ReplicationSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [user, setUser] = useState("");
  const [priority, setPriority] = useState("low");
  const [remote, setRemote] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const show = useCallback((v: unknown) => setOutput(v), []);

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.replication", "Replication")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.user", "User")}
          <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.priority", "Priority")}
          <input className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="low | high" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.remote", "Remote")}
          <input className={inputCls} value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="backup.example.com" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.replicationStatus(id).then(show))}>
          {t("integrations.mail.dovecot.actions.replicationStatus", "Status")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user} onClick={() => run(() => api.replicateUser(id, user, priority))}>
          {t("integrations.mail.dovecot.actions.replicateUser", "Replicate user")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !remote} onClick={() => run(() => api.dsyncBackup(id, user, remote))}>
          {t("integrations.mail.dovecot.actions.dsyncBackup", "dsync backup")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !user || !remote} onClick={() => run(() => api.dsyncMirror(id, user, remote))}>
          {t("integrations.mail.dovecot.actions.dsyncMirror", "dsync mirror")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

// ── Logs section ─────────────────────────────────────────────────────────────

const LogsSection: React.FC<SectionProps> = ({ id, api }) => {
  const { t } = useTranslation();
  const { busy, err, run } = useRunner();
  const [lines, setLines] = useState("100");
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState("info");
  const [output, setOutput] = useState<unknown>(null);
  const show = useCallback((v: unknown) => setOutput(v), []);

  const linesNum = () => {
    const n = Number.parseInt(lines, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <SectionShell title={t("integrations.mail.dovecot.sections.logs", "Logs")} busy={busy} err={err}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.lines", "Lines")}
          <input className={inputCls} value={lines} onChange={(e) => setLines(e.target.value)} inputMode="numeric" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.filter", "Filter")}
          <input className={inputCls} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="error" />
        </label>
        <label className={labelCls}>
          {t("integrations.mail.dovecot.fields.logLevel", "Log level")}
          <input className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)} placeholder="info | debug" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.queryLog(id, linesNum(), filter || undefined).then(show))}>
          {t("integrations.mail.dovecot.actions.queryLog", "Query log")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.listLogFiles(id).then(show))}>
          {t("integrations.mail.dovecot.actions.listLogFiles", "Log files")}
        </button>
        <button className={ghostBtnCls} disabled={busy} onClick={() => run(() => api.getLogLevel(id).then((v) => show({ level: v })))}>
          {t("integrations.mail.dovecot.actions.getLogLevel", "Get level")}
        </button>
        <button className={ghostBtnCls} disabled={busy || !level} onClick={() => run(() => api.setLogLevel(id, level))}>
          {t("integrations.mail.dovecot.actions.setLogLevel", "Set level")}
        </button>
      </div>
      {output != null && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
    </SectionShell>
  );
};

export default DovecotSubTab;
