// AmavisSubTab — the "Amavis (content filter)" sub-tab of the unified Mail Server
// panel (t42 Wave M). Self-contained mini-panel: owns its own connect form,
// connection lifecycle, persistence (`useIntegrationConfigStore`, key
// `"mail.amavis"`), and grouped management views. Binds every one of the 52
// commands in src-tauri/crates/sorng-amavis/src/commands.rs through `useAmavis()`
// / `amavisApi`.
//
// amavisd-new is reached over SSH, but — unlike the 6 SSH-transport mail crates —
// its `AmavisConnectionConfig` uses `username` / `password` / `private_key`
// (NOT `ssh_*`-prefixed), so this tab does NOT use `MailSshConnectionFields`.

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Ban,
  FileCode2,
  FlaskConical,
  Gauge,
  Layers,
  ListChecks,
  Loader2,
  Play,
  Plug,
  Power,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAmavis, type AmavisManager } from "../../../hooks/integration/mail/useAmavis";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import type { MailSubTabProps } from "./registry";
import {
  AMAVIS_LIST_TYPES,
  type AmavisBannedRule,
  type AmavisChildProcess,
  type AmavisConfigSnippet,
  type AmavisListEntry,
  type AmavisListType,
  type AmavisMainConfig,
  type AmavisPolicyBank,
  type AmavisProcessInfo,
  type AmavisQuarantineItem,
  type AmavisQuarantineStats,
  type AmavisStats,
  type AmavisThroughput,
} from "../../../types/mail/amavis";

// ─── Shared UI helpers (local to the sub-tab, mirroring the panel idiom) ───────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

const K = "integrations.mail.amavis";

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

/** Swallow a rejected op — the error is surfaced via `mgr.error`. */
async function safe<T>(p: Promise<T>, set: (v: T) => void): Promise<void> {
  try {
    set(await p);
  } catch {
    /* surfaced via mgr.error */
  }
}

// ─── Connect form ────────────────────────────────────────────────────────────

const INTEGRATION_KEY = "mail.amavis";

interface ConnectState {
  host: string;
  port: string;
  username: string;
  password: string;
  privateKey: string;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "22",
  username: "",
  password: "",
  privateKey: "",
  timeoutSecs: "30",
  name: "",
};

/** The instance's SSH secrets are bundled into ONE opaque vault secret (the
 *  store keeps a single secret per instance). */
interface AmavisSecrets {
  password?: string;
  privateKey?: string;
}

const ConnectForm: React.FC<{ mgr: AmavisManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(undefined);

  // Prefill from the first persisted `mail.amavis` instance, if any.
  useEffect(() => {
    if (store.isLoading) return;
    const inst = store.instancesFor(INTEGRATION_KEY)[0];
    if (!inst) return;
    setSavedId(inst.id);
    setForm((f) => ({
      ...f,
      name: inst.name,
      host: inst.host ?? "",
      port: inst.fields?.port ?? "22",
      username: inst.fields?.username ?? "",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((raw) => {
      if (!raw) return;
      try {
        const s = JSON.parse(raw) as AmavisSecrets;
        setForm((f) => ({
          ...f,
          password: s.password ?? "",
          privateKey: s.privateKey ?? "",
        }));
      } catch {
        // Legacy / non-JSON secret — treat as the SSH password.
        setForm((f) => ({ ...f, password: raw }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isLoading]);

  const set = <Key extends keyof ConnectState>(k: Key, v: ConnectState[Key]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? generateId();
    await mgr.connect(id, {
      host: form.host.trim(),
      port: form.port ? Number(form.port) : undefined,
      username: form.username.trim(),
      password: form.password || undefined,
      private_key: form.privateKey || undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      username: form.username,
      timeoutSecs: form.timeoutSecs,
    };
    const secrets: AmavisSecrets = {
      password: form.password || undefined,
      privateKey: form.privateKey || undefined,
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
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t(`${K}.host`, "SSH host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="mail.lab.local"
          />
        </Labeled>
        <Labeled label={t(`${K}.port`, "SSH port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t(`${K}.username`, "SSH username")}>
          <input
            className={field}
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
          />
        </Labeled>
        <Labeled label={t(`${K}.password`, "SSH password")}>
          <input
            className={field}
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Labeled>
        <Labeled label={t(`${K}.privateKey`, "SSH private key")}>
          <textarea
            className={`${field} font-mono`}
            rows={2}
            value={form.privateKey}
            onChange={(e) => set("privateKey", e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </Labeled>
        <Labeled label={t(`${K}.timeout`, "Timeout (seconds)")}>
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t(`${K}.instanceName`, "Saved name")}>
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
          disabled={mgr.isConnecting || !form.host || !form.username}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t(`${K}.connect`, "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t(`${K}.save`, "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Overview section (process status / version / ping) ──────────────────────

const OverviewSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AmavisProcessInfo | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.processStatus(cid), setInfo),
        safe(mgr.api.version(cid), setVersion),
      ]);
    });
    void mgr.refreshSummary();
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.refresh`, "Refresh")}
        </button>
        {version && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t(`${K}.version`, "Version")}: {version}
          </span>
        )}
      </div>
      {info && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={t(`${K}.running`, "Running")}
            value={info.running ? t(`${K}.yes`, "Yes") : t(`${K}.no`, "No")}
          />
          <Stat label={t(`${K}.pid`, "PID")} value={info.pid} />
          <Stat
            label={t(`${K}.uptime`, "Uptime (s)")}
            value={info.uptime_secs}
          />
          <Stat
            label={t(`${K}.configFile`, "Config file")}
            value={info.config_file}
          />
        </div>
      )}
      <JsonView value={info} />
    </div>
  );
};

// ─── Config section (main config + test + snippets) ──────────────────────────

const MAIN_CONFIG_STR_FIELDS: (keyof AmavisMainConfig)[] = [
  "config_file_path",
  "daemon_user",
  "daemon_group",
  "syslog_facility",
  "myhostname",
  "mydomain",
  "virus_admin",
  "spam_admin",
  "final_virus_destiny",
  "final_banned_destiny",
  "final_spam_destiny",
  "final_bad_header_destiny",
];
const MAIN_CONFIG_NUM_FIELDS: (keyof AmavisMainConfig)[] = [
  "max_servers",
  "child_timeout",
  "log_level",
  "sa_tag_level_deflt",
  "sa_tag2_level_deflt",
  "sa_kill_level_deflt",
  "sa_dsn_cutoff_level",
];

const ConfigSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AmavisMainConfig | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [rawConfig, setRawConfig] = useState<string | null>(null);

  const [snippets, setSnippets] = useState<AmavisConfigSnippet[]>([]);
  const [selected, setSelected] = useState<AmavisConfigSnippet | null>(null);
  const [snipForm, setSnipForm] = useState({ name: "", content: "" });

  const loadConfig = useCallback(async () => {
    await safe(mgr.run(() => mgr.api.getMainConfig(cid)), setConfig);
  }, [mgr, cid]);

  const loadSnippets = useCallback(async () => {
    await safe(mgr.run(() => mgr.api.listSnippets(cid)), setSnippets);
  }, [mgr, cid]);

  useEffect(() => {
    void loadConfig();
    void loadSnippets();
  }, [loadConfig, loadSnippets]);

  const setField = (k: keyof AmavisMainConfig, v: string, numeric: boolean) =>
    setConfig((c) =>
      c
        ? {
            ...c,
            [k]: v === "" ? null : numeric ? Number(v) : v,
          }
        : c,
    );

  const saveConfig = useCallback(async () => {
    if (!config) return;
    await mgr.run(() => mgr.api.updateMainConfig(cid, config));
  }, [mgr, cid, config]);

  const test = useCallback(async () => {
    await safe(mgr.run(() => mgr.api.testConfig(cid)), setTestResult);
  }, [mgr, cid]);

  const showConfig = useCallback(async () => {
    await safe(mgr.run(() => mgr.api.showConfig(cid)), setRawConfig);
  }, [mgr, cid]);

  const viewSnippet = useCallback(
    async (name: string) => {
      try {
        const s = await mgr.run(() => mgr.api.getSnippet(cid, name));
        setSelected(s);
        setSnipForm({ name: s.name, content: s.content });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const createSnippet = useCallback(async () => {
    if (!snipForm.name) return;
    await mgr.run(() =>
      mgr.api.createSnippet(cid, snipForm.name, snipForm.content),
    );
    setSnipForm({ name: "", content: "" });
    setSelected(null);
    await loadSnippets();
  }, [mgr, cid, snipForm, loadSnippets]);

  const updateSnippet = useCallback(async () => {
    if (!selected) return;
    await mgr.run(() =>
      mgr.api.updateSnippet(cid, selected.name, snipForm.content),
    );
    await loadSnippets();
  }, [mgr, cid, selected, snipForm, loadSnippets]);

  const deleteSnippet = useCallback(
    async (name: string) => {
      if (!window.confirm(t(`${K}.deleteSnippetConfirm`, "Delete snippet?")))
        return;
      await mgr.run(() => mgr.api.deleteSnippet(cid, name));
      if (selected?.name === name) setSelected(null);
      await loadSnippets();
    },
    [mgr, cid, selected, loadSnippets, t],
  );

  const toggleSnippet = useCallback(
    async (s: AmavisConfigSnippet) => {
      await mgr.run(() =>
        s.enabled
          ? mgr.api.disableSnippet(cid, s.name)
          : mgr.api.enableSnippet(cid, s.name),
      );
      await loadSnippets();
    },
    [mgr, cid, loadSnippets],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={loadConfig} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.reloadConfig`, "Reload config")}
        </button>
        <button className={btn} onClick={saveConfig} disabled={mgr.isLoading || !config}>
          <FileCode2 size={12} />
          {t(`${K}.saveConfig`, "Save config")}
        </button>
        <button className={btn} onClick={test} disabled={mgr.isLoading}>
          <ShieldCheck size={12} />
          {t(`${K}.testConfig`, "Test config")}
        </button>
        <button className={btn} onClick={showConfig} disabled={mgr.isLoading}>
          <FlaskConical size={12} />
          {t(`${K}.showConfig`, "Show raw config")}
        </button>
      </div>

      {testResult != null && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
          {testResult}
        </div>
      )}

      {config && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t(`${K}.mainConfig`, "Main configuration")}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {MAIN_CONFIG_STR_FIELDS.map((k) => (
              <Labeled key={k} label={k}>
                <input
                  className={field}
                  value={(config[k] as string | null) ?? ""}
                  onChange={(e) => setField(k, e.target.value, false)}
                />
              </Labeled>
            ))}
            {MAIN_CONFIG_NUM_FIELDS.map((k) => (
              <Labeled key={k} label={k}>
                <input
                  className={field}
                  value={
                    config[k] == null ? "" : String(config[k] as number)
                  }
                  onChange={(e) => setField(k, e.target.value, true)}
                  inputMode="decimal"
                />
              </Labeled>
            ))}
          </div>
        </div>
      )}

      <div className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {t(`${K}.snippets`, "Config snippets")}
          </h4>
          <button className={btn} onClick={loadSnippets} disabled={mgr.isLoading}>
            <RefreshCw size={12} />
            {t(`${K}.refresh`, "Refresh")}
          </button>
        </div>
        <div className="mb-3 flex flex-col gap-1">
          {snippets.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between rounded px-2 py-1 text-xs"
            >
              <button
                className="flex-1 text-left font-mono text-[var(--color-textSecondary)]"
                onClick={() => void viewSnippet(s.name)}
              >
                {s.name}
                <span className="ml-2 text-[10px] text-[var(--color-textMuted)]">
                  {s.path}
                </span>
              </button>
              <div className="flex items-center gap-1">
                <button className={btn} onClick={() => void toggleSnippet(s)}>
                  {s.enabled
                    ? t(`${K}.disable`, "Disable")
                    : t(`${K}.enable`, "Enable")}
                </button>
                <button className={btn} onClick={() => void deleteSnippet(s.name)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {snippets.length === 0 && (
            <span className="text-xs text-[var(--color-textMuted)]">
              {t(`${K}.noSnippets`, "No snippets")}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder={t(`${K}.snippetName`, "Snippet name")}
            value={snipForm.name}
            onChange={(e) =>
              setSnipForm((f) => ({ ...f, name: e.target.value }))
            }
          />
          <textarea
            className={`${field} font-mono`}
            rows={4}
            placeholder="# 60-my_overrides"
            value={snipForm.content}
            onChange={(e) =>
              setSnipForm((f) => ({ ...f, content: e.target.value }))
            }
          />
          <div className="flex gap-2">
            <button
              className={btn}
              onClick={createSnippet}
              disabled={!snipForm.name}
            >
              {t(`${K}.createSnippet`, "Create")}
            </button>
            <button
              className={btn}
              onClick={updateSnippet}
              disabled={!selected}
            >
              {t(`${K}.updateSnippet`, "Update selected")}
            </button>
          </div>
        </div>
      </div>

      <TextView value={rawConfig} />
    </div>
  );
};

// ─── Policy banks section ────────────────────────────────────────────────────

const PolicyBanksSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AmavisPolicyBank[]>([]);
  const [detail, setDetail] = useState<AmavisPolicyBank | null>(null);
  const [name, setName] = useState("");

  const refresh = useCallback(async () => {
    await safe(mgr.run(() => mgr.api.listPolicyBanks(cid)), setRows);
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (n: string) => {
      await safe(mgr.run(() => mgr.api.getPolicyBank(cid, n)), setDetail);
    },
    [mgr, cid],
  );

  const create = useCallback(async () => {
    if (!name) return;
    await mgr.run(() => mgr.api.createPolicyBank(cid, { name }));
    setName("");
    await refresh();
  }, [mgr, cid, name, refresh]);

  const saveDetail = useCallback(async () => {
    if (!detail) return;
    await mgr.run(() =>
      mgr.api.updatePolicyBank(cid, detail.name, {
        description: detail.description,
        bypass_virus_checks: detail.bypass_virus_checks,
        bypass_spam_checks: detail.bypass_spam_checks,
        bypass_banned_checks: detail.bypass_banned_checks,
        bypass_header_checks: detail.bypass_header_checks,
        spam_tag_level: detail.spam_tag_level,
        spam_tag2_level: detail.spam_tag2_level,
        spam_kill_level: detail.spam_kill_level,
        spam_dsn_cutoff_level: detail.spam_dsn_cutoff_level,
        virus_quarantine_to: detail.virus_quarantine_to,
        spam_quarantine_to: detail.spam_quarantine_to,
        banned_quarantine_to: detail.banned_quarantine_to,
      }),
    );
    await refresh();
  }, [mgr, cid, detail, refresh]);

  const remove = useCallback(
    async (n: string) => {
      if (!window.confirm(t(`${K}.deleteBankConfirm`, "Delete policy bank?")))
        return;
      await mgr.run(() => mgr.api.deletePolicyBank(cid, n));
      if (detail?.name === n) setDetail(null);
      await refresh();
    },
    [mgr, cid, detail, refresh, t],
  );

  const toggle = useCallback(
    async (bank: AmavisPolicyBank, activate: boolean) => {
      await mgr.run(() =>
        activate
          ? mgr.api.activatePolicyBank(cid, bank.name)
          : mgr.api.deactivatePolicyBank(cid, bank.name),
      );
      await refresh();
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.refresh`, "Refresh")}
        </button>
        <input
          className={field}
          style={{ width: 200 }}
          placeholder={t(`${K}.newBankName`, "New policy-bank name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
        <button className={btn} onClick={create} disabled={!name}>
          {t(`${K}.create`, "Create")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t(`${K}.name`, "Name")}</th>
              <th className="px-2 py-1">{t(`${K}.description`, "Description")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                  {b.name}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {b.description ?? "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(b.name)}>
                      {t(`${K}.edit`, "Edit")}
                    </button>
                    <button className={btn} onClick={() => void toggle(b, true)}>
                      {t(`${K}.activate`, "Activate")}
                    </button>
                    <button className={btn} onClick={() => void toggle(b, false)}>
                      {t(`${K}.deactivate`, "Deactivate")}
                    </button>
                    <button className={btn} onClick={() => void remove(b.name)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t(`${K}.noBanks`, "No policy banks")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {t(`${K}.editBank`, "Edit policy bank")} — {detail.name}
            </h4>
            <button className={btn} onClick={saveDetail} disabled={mgr.isLoading}>
              {t(`${K}.save`, "Save")}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label={t(`${K}.description`, "Description")}>
              <input
                className={field}
                value={detail.description ?? ""}
                onChange={(e) =>
                  setDetail({ ...detail, description: e.target.value || null })
                }
              />
            </Labeled>
            {(
              [
                ["bypass_virus_checks", "Bypass virus"],
                ["bypass_spam_checks", "Bypass spam"],
                ["bypass_banned_checks", "Bypass banned"],
                ["bypass_header_checks", "Bypass header"],
              ] as const
            ).map(([k, lbl]) => (
              <label
                key={k}
                className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]"
              >
                <input
                  type="checkbox"
                  checked={!!detail[k]}
                  onChange={(e) => setDetail({ ...detail, [k]: e.target.checked })}
                />
                {lbl}
              </label>
            ))}
            {(
              [
                ["spam_tag_level", "Tag level"],
                ["spam_tag2_level", "Tag2 level"],
                ["spam_kill_level", "Kill level"],
                ["spam_dsn_cutoff_level", "DSN cutoff"],
              ] as const
            ).map(([k, lbl]) => (
              <Labeled key={k} label={lbl}>
                <input
                  className={field}
                  inputMode="decimal"
                  value={detail[k] == null ? "" : String(detail[k])}
                  onChange={(e) =>
                    setDetail({
                      ...detail,
                      [k]: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </Labeled>
            ))}
            {(
              [
                ["virus_quarantine_to", "Virus quarantine to"],
                ["spam_quarantine_to", "Spam quarantine to"],
                ["banned_quarantine_to", "Banned quarantine to"],
              ] as const
            ).map(([k, lbl]) => (
              <Labeled key={k} label={lbl}>
                <input
                  className={field}
                  value={detail[k] ?? ""}
                  onChange={(e) =>
                    setDetail({ ...detail, [k]: e.target.value || null })
                  }
                />
              </Labeled>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Banned rules section ────────────────────────────────────────────────────

const BannedSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AmavisBannedRule[]>([]);
  const [detail, setDetail] = useState<AmavisBannedRule | null>(null);
  const [form, setForm] = useState({ pattern: "", description: "" });
  const [filename, setFilename] = useState("");
  const [filenameResult, setFilenameResult] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    await safe(mgr.run(() => mgr.api.listBannedRules(cid)), setRows);
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (banId: string) => {
      await safe(mgr.run(() => mgr.api.getBannedRule(cid, banId)), setDetail);
    },
    [mgr, cid],
  );

  const create = useCallback(async () => {
    if (!form.pattern) return;
    await mgr.run(() =>
      mgr.api.createBannedRule(cid, {
        pattern: form.pattern,
        description: form.description || null,
      }),
    );
    setForm({ pattern: "", description: "" });
    await refresh();
  }, [mgr, cid, form, refresh]);

  const saveDetail = useCallback(async () => {
    if (!detail) return;
    await mgr.run(() =>
      mgr.api.updateBannedRule(cid, detail.id, {
        pattern: detail.pattern,
        description: detail.description,
        policy_bank: detail.policy_bank,
        enabled: detail.enabled,
      }),
    );
    await refresh();
  }, [mgr, cid, detail, refresh]);

  const remove = useCallback(
    async (banId: string) => {
      if (!window.confirm(t(`${K}.deleteRuleConfirm`, "Delete banned rule?")))
        return;
      await mgr.run(() => mgr.api.deleteBannedRule(cid, banId));
      if (detail?.id === banId) setDetail(null);
      await refresh();
    },
    [mgr, cid, detail, refresh, t],
  );

  const test = useCallback(async () => {
    if (!filename) return;
    await safe(
      mgr.run(() => mgr.api.testFilename(cid, filename)),
      setFilenameResult,
    );
  }, [mgr, cid, filename]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.refresh`, "Refresh")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(`${K}.testFilenameTitle`, "Test a filename against the ban rules")}
        </h4>
        <div className="flex items-center gap-2">
          <input
            className={`${field} font-mono`}
            placeholder="invoice.exe"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void test()}
          />
          <button className={btn} onClick={test} disabled={!filename}>
            <FlaskConical size={12} />
            {t(`${K}.test`, "Test")}
          </button>
          {filenameResult != null && (
            <span
              className={`text-xs ${filenameResult ? "text-red-500" : "text-green-500"}`}
            >
              {filenameResult
                ? t(`${K}.banned`, "Banned")
                : t(`${K}.allowed`, "Allowed")}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t(`${K}.pattern`, "Pattern")}</th>
              <th className="px-2 py-1">{t(`${K}.description`, "Description")}</th>
              <th className="px-2 py-1">{t(`${K}.enabled`, "Enabled")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                  {r.pattern}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.description ?? "—"}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.enabled ? "✓" : "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(r.id)}>
                      {t(`${K}.edit`, "Edit")}
                    </button>
                    <button className={btn} onClick={() => void remove(r.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t(`${K}.noRules`, "No banned rules")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(`${K}.newRule`, "New banned rule")}
        </h4>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={`${field} font-mono`}
            placeholder={t(`${K}.pattern`, "Pattern")}
            value={form.pattern}
            onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
          />
          <input
            className={field}
            placeholder={t(`${K}.description`, "Description")}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
          <button className={btn} onClick={create} disabled={!form.pattern}>
            {t(`${K}.create`, "Create")}
          </button>
        </div>
      </div>

      {detail && (
        <div className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {t(`${K}.editRule`, "Edit rule")} — {detail.id}
            </h4>
            <button className={btn} onClick={saveDetail} disabled={mgr.isLoading}>
              {t(`${K}.save`, "Save")}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label={t(`${K}.pattern`, "Pattern")}>
              <input
                className={`${field} font-mono`}
                value={detail.pattern}
                onChange={(e) =>
                  setDetail({ ...detail, pattern: e.target.value })
                }
              />
            </Labeled>
            <Labeled label={t(`${K}.description`, "Description")}>
              <input
                className={field}
                value={detail.description ?? ""}
                onChange={(e) =>
                  setDetail({ ...detail, description: e.target.value || null })
                }
              />
            </Labeled>
            <Labeled label={t(`${K}.policyBank`, "Policy bank")}>
              <input
                className={field}
                value={detail.policy_bank ?? ""}
                onChange={(e) =>
                  setDetail({ ...detail, policy_bank: e.target.value || null })
                }
              />
            </Labeled>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={detail.enabled}
                onChange={(e) =>
                  setDetail({ ...detail, enabled: e.target.checked })
                }
              />
              {t(`${K}.enabled`, "Enabled")}
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Lists section (whitelist / blacklist) ───────────────────────────────────

const ListsSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [listType, setListType] = useState<AmavisListType>("sender_whitelist");
  const [rows, setRows] = useState<AmavisListEntry[]>([]);
  const [address, setAddress] = useState("");
  const [detail, setDetail] = useState<AmavisListEntry | null>(null);
  const [sender, setSender] = useState("");
  const [checkResult, setCheckResult] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    await safe(mgr.run(() => mgr.api.listEntries(cid, listType)), setRows);
  }, [mgr, cid, listType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async () => {
    if (!address) return;
    await mgr.run(() =>
      mgr.api.addListEntry(cid, { list_type: listType, address }),
    );
    setAddress("");
    await refresh();
  }, [mgr, cid, listType, address, refresh]);

  const view = useCallback(
    async (entryId: string) => {
      await safe(mgr.run(() => mgr.api.getListEntry(cid, entryId)), setDetail);
    },
    [mgr, cid],
  );

  const saveDetail = useCallback(async () => {
    if (!detail) return;
    await mgr.run(() =>
      mgr.api.updateListEntry(cid, detail.id, {
        list_type: detail.list_type,
        address: detail.address,
        description: detail.description,
        enabled: detail.enabled,
      }),
    );
    await refresh();
  }, [mgr, cid, detail, refresh]);

  const remove = useCallback(
    async (entryId: string) => {
      await mgr.run(() => mgr.api.removeListEntry(cid, entryId));
      if (detail?.id === entryId) setDetail(null);
      await refresh();
    },
    [mgr, cid, detail, refresh],
  );

  const check = useCallback(async () => {
    if (!sender) return;
    await safe(mgr.run(() => mgr.api.checkSender(cid, sender)), setCheckResult);
  }, [mgr, cid, sender]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={field}
          style={{ width: 200 }}
          value={listType}
          onChange={(e) => setListType(e.target.value as AmavisListType)}
        >
          {AMAVIS_LIST_TYPES.map((lt) => (
            <option key={lt} value={lt}>
              {lt}
            </option>
          ))}
        </select>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.refresh`, "Refresh")}
        </button>
        <input
          className={field}
          style={{ width: 220 }}
          placeholder={t(`${K}.address`, "Address to add")}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        <button className={btn} onClick={add} disabled={!address}>
          {t(`${K}.add`, "Add")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(`${K}.checkSenderTitle`, "Check a sender against the lists")}
        </h4>
        <div className="flex items-center gap-2">
          <input
            className={field}
            placeholder="user@example.com"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void check()}
          />
          <button className={btn} onClick={check} disabled={!sender}>
            <ListChecks size={12} />
            {t(`${K}.check`, "Check")}
          </button>
        </div>
        <JsonView value={checkResult} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t(`${K}.address`, "Address")}</th>
              <th className="px-2 py-1">{t(`${K}.description`, "Description")}</th>
              <th className="px-2 py-1">{t(`${K}.enabled`, "Enabled")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                  {r.address}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.description ?? "—"}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.enabled ? "✓" : "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(r.id)}>
                      {t(`${K}.edit`, "Edit")}
                    </button>
                    <button className={btn} onClick={() => void remove(r.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t(`${K}.noEntries`, "No entries")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {t(`${K}.editEntry`, "Edit entry")} — {detail.id}
            </h4>
            <button className={btn} onClick={saveDetail} disabled={mgr.isLoading}>
              {t(`${K}.save`, "Save")}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label={t(`${K}.address`, "Address")}>
              <input
                className={field}
                value={detail.address}
                onChange={(e) =>
                  setDetail({ ...detail, address: e.target.value })
                }
              />
            </Labeled>
            <Labeled label={t(`${K}.listType`, "List type")}>
              <select
                className={field}
                value={detail.list_type}
                onChange={(e) =>
                  setDetail({
                    ...detail,
                    list_type: e.target.value as AmavisListType,
                  })
                }
              >
                {AMAVIS_LIST_TYPES.map((lt) => (
                  <option key={lt} value={lt}>
                    {lt}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label={t(`${K}.description`, "Description")}>
              <input
                className={field}
                value={detail.description ?? ""}
                onChange={(e) =>
                  setDetail({ ...detail, description: e.target.value || null })
                }
              />
            </Labeled>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={detail.enabled}
                onChange={(e) =>
                  setDetail({ ...detail, enabled: e.target.checked })
                }
              />
              {t(`${K}.enabled`, "Enabled")}
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Quarantine section ──────────────────────────────────────────────────────

const QuarantineSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AmavisQuarantineItem[]>([]);
  const [stats, setStats] = useState<AmavisQuarantineStats | null>(null);
  const [detail, setDetail] = useState<AmavisQuarantineItem | null>(null);
  const [typeFilter, setTypeFilter] = useState("");

  const refresh = useCallback(async () => {
    await mgr.run(async () => {
      await Promise.all([
        safe(
          mgr.api.listQuarantine(cid, {
            quarantine_type: typeFilter || null,
            limit: 200,
          }),
          setRows,
        ),
        safe(mgr.api.getQuarantineStats(cid), setStats),
      ]);
    });
  }, [mgr, cid, typeFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (mailId: string) => {
      await safe(mgr.run(() => mgr.api.getQuarantine(cid, mailId)), setDetail);
    },
    [mgr, cid],
  );

  const release = useCallback(
    async (mailId: string) => {
      await mgr.run(() => mgr.api.releaseQuarantine(cid, mailId));
      await refresh();
    },
    [mgr, cid, refresh],
  );

  const remove = useCallback(
    async (mailId: string) => {
      await mgr.run(() => mgr.api.deleteQuarantine(cid, mailId));
      if (detail?.mail_id === mailId) setDetail(null);
      await refresh();
    },
    [mgr, cid, detail, refresh],
  );

  const releaseAll = useCallback(async () => {
    if (
      !window.confirm(
        t(`${K}.releaseAllConfirm`, "Release ALL items of this type?"),
      )
    )
      return;
    await mgr.run(() =>
      mgr.api.releaseAllQuarantine(cid, typeFilter || "spam"),
    );
    await refresh();
  }, [mgr, cid, typeFilter, refresh, t]);

  const deleteAll = useCallback(async () => {
    if (
      !window.confirm(
        t(`${K}.deleteAllConfirm`, "Delete ALL items of this type?"),
      )
    )
      return;
    await mgr.run(() =>
      mgr.api.deleteAllQuarantine(cid, typeFilter || "spam"),
    );
    await refresh();
  }, [mgr, cid, typeFilter, refresh, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 160 }}
          placeholder={t(`${K}.typeFilter`, "Type (spam/virus/banned)")}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void refresh()}
        />
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.refresh`, "Refresh")}
        </button>
        <button className={btn} onClick={releaseAll} disabled={mgr.isLoading}>
          {t(`${K}.releaseAll`, "Release all")}
        </button>
        <button className={btn} onClick={deleteAll} disabled={mgr.isLoading}>
          <Trash2 size={12} />
          {t(`${K}.deleteAll`, "Delete all")}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t(`${K}.total`, "Total")} value={stats.total_items} />
          <Stat
            label={t(`${K}.sizeBytes`, "Size (bytes)")}
            value={stats.total_size_bytes}
          />
          <Stat label={t(`${K}.spam`, "Spam")} value={stats.spam_count} />
          <Stat label={t(`${K}.virus`, "Virus")} value={stats.virus_count} />
          <Stat label={t(`${K}.bannedCount`, "Banned")} value={stats.banned_count} />
          <Stat label={t(`${K}.oldest`, "Oldest")} value={stats.oldest_item_time} />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t(`${K}.mailId`, "Mail ID")}</th>
              <th className="px-2 py-1">{t(`${K}.sender`, "Sender")}</th>
              <th className="px-2 py-1">{t(`${K}.subject`, "Subject")}</th>
              <th className="px-2 py-1">{t(`${K}.type`, "Type")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.mail_id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                  {q.mail_id}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {q.sender}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {q.subject ?? "—"}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {q.quarantine_type}
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(q.mail_id)}>
                      {t(`${K}.view`, "View")}
                    </button>
                    <button className={btn} onClick={() => void release(q.mail_id)}>
                      {t(`${K}.release`, "Release")}
                    </button>
                    <button className={btn} onClick={() => void remove(q.mail_id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t(`${K}.noQuarantine`, "Quarantine is empty")}
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

// ─── Stats section (stats / children / throughput / reset) ───────────────────

const StatsSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AmavisStats | null>(null);
  const [children, setChildren] = useState<AmavisChildProcess[]>([]);
  const [throughput, setThroughput] = useState<AmavisThroughput | null>(null);

  const refresh = useCallback(async () => {
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.getStats(cid), setStats),
        safe(mgr.api.getChildProcesses(cid), setChildren),
        safe(mgr.api.getThroughput(cid), setThroughput),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reset = useCallback(async () => {
    if (!window.confirm(t(`${K}.resetStatsConfirm`, "Reset accumulated stats?")))
      return;
    await mgr.run(() => mgr.api.resetStats(cid));
    await refresh();
  }, [mgr, cid, refresh, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.refresh`, "Refresh")}
        </button>
        <button className={btn} onClick={reset} disabled={mgr.isLoading}>
          <RotateCw size={12} />
          {t(`${K}.resetStats`, "Reset stats")}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t(`${K}.msgsTotal`, "Total")} value={stats.msgs_total} />
          <Stat label={t(`${K}.msgsClean`, "Clean")} value={stats.msgs_clean} />
          <Stat label={t(`${K}.msgsSpam`, "Spam")} value={stats.msgs_spam} />
          <Stat label={t(`${K}.msgsVirus`, "Virus")} value={stats.msgs_virus} />
          <Stat label={t(`${K}.msgsBanned`, "Banned")} value={stats.msgs_banned} />
          <Stat
            label={t(`${K}.msgsBadHeader`, "Bad header")}
            value={stats.msgs_bad_header}
          />
          <Stat
            label={t(`${K}.msgsUnchecked`, "Unchecked")}
            value={stats.msgs_unchecked}
          />
          <Stat
            label={t(`${K}.avgMs`, "Avg (ms)")}
            value={stats.avg_process_time_ms}
          />
          <Stat
            label={t(`${K}.childrenActive`, "Active kids")}
            value={stats.children_active}
          />
          <Stat
            label={t(`${K}.childrenIdle`, "Idle kids")}
            value={stats.children_idle}
          />
        </div>
      )}

      {throughput && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat
            label={t(`${K}.msgsPerMin`, "Msgs/min")}
            value={throughput.msgs_per_minute}
          />
          <Stat
            label={t(`${K}.bytesPerMin`, "Bytes/min")}
            value={throughput.bytes_per_minute}
          />
          <Stat
            label={t(`${K}.avgLatency`, "Avg latency (ms)")}
            value={throughput.avg_latency_ms}
          />
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(`${K}.childProcesses`, "Child processes")}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t(`${K}.pid`, "PID")}</th>
                <th className="px-2 py-1">{t(`${K}.state`, "State")}</th>
                <th className="px-2 py-1">{t(`${K}.processed`, "Processed")}</th>
                <th className="px-2 py-1">{t(`${K}.startedAt`, "Started at")}</th>
              </tr>
            </thead>
            <tbody>
              {children.map((c) => (
                <tr key={c.pid} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                    {c.pid}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {c.state}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {c.msgs_processed}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {c.started_at ?? "—"}
                  </td>
                </tr>
              ))}
              {children.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                    {t(`${K}.noChildren`, "No child processes")}
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

// ─── Service section (start/stop/restart/reload + debug SA) ──────────────────

const ServiceSection: React.FC<{ mgr: AmavisManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AmavisProcessInfo | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [debugOut, setDebugOut] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.processStatus(cid), setInfo),
        safe(mgr.api.version(cid), setVersion),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const control = useCallback(
    async (op: "start" | "stop" | "restart" | "reload") => {
      const confirmMsg = t(
        `${K}.controlConfirm`,
        "Run '{{op}}' on Amavis?",
      ).replace("{{op}}", op);
      if ((op === "stop" || op === "restart") && !window.confirm(confirmMsg))
        return;
      await mgr.run(() => mgr.api[op](cid));
      await refresh();
    },
    [mgr, cid, refresh, t],
  );

  const debugSa = useCallback(async () => {
    if (!message) return;
    await safe(mgr.run(() => mgr.api.debugSa(cid, message)), setDebugOut);
  }, [mgr, cid, message]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t(`${K}.refresh`, "Refresh")}
        </button>
        <button className={btn} onClick={() => void control("start")} disabled={mgr.isLoading}>
          <Play size={12} />
          {t(`${K}.start`, "Start")}
        </button>
        <button className={btn} onClick={() => void control("reload")} disabled={mgr.isLoading}>
          <RotateCw size={12} />
          {t(`${K}.reload`, "Reload")}
        </button>
        <button className={btn} onClick={() => void control("restart")} disabled={mgr.isLoading}>
          <Power size={12} />
          {t(`${K}.restart`, "Restart")}
        </button>
        <button className={btn} onClick={() => void control("stop")} disabled={mgr.isLoading}>
          <Power size={12} />
          {t(`${K}.stop`, "Stop")}
        </button>
        {version && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t(`${K}.version`, "Version")}: {version}
          </span>
        )}
      </div>

      {info && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={t(`${K}.running`, "Running")}
            value={info.running ? t(`${K}.yes`, "Yes") : t(`${K}.no`, "No")}
          />
          <Stat label={t(`${K}.pid`, "PID")} value={info.pid} />
          <Stat label={t(`${K}.uptime`, "Uptime (s)")} value={info.uptime_secs} />
          <Stat label={t(`${K}.configFile`, "Config file")} value={info.config_file} />
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(`${K}.debugSaTitle`, "Run SpamAssassin debug on a raw message")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={4}
          placeholder="From: spammer@example.com\nSubject: ..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="mt-2">
          <button className={btn} onClick={debugSa} disabled={!message || mgr.isLoading}>
            <FlaskConical size={12} />
            {t(`${K}.debugSa`, "Debug SA")}
          </button>
        </div>
        <TextView value={debugOut} />
      </div>
    </div>
  );
};

// ─── Sub-tab shell ───────────────────────────────────────────────────────────

type SectionKey =
  | "overview"
  | "config"
  | "banks"
  | "banned"
  | "lists"
  | "quarantine"
  | "stats"
  | "service";

const SECTIONS: {
  key: SectionKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "overview", labelKey: `${K}.sectionOverview`, labelDefault: "Overview", icon: Activity },
  { key: "config", labelKey: `${K}.sectionConfig`, labelDefault: "Config", icon: FileCode2 },
  { key: "banks", labelKey: `${K}.sectionBanks`, labelDefault: "Policy banks", icon: Layers },
  { key: "banned", labelKey: `${K}.sectionBanned`, labelDefault: "Banned", icon: Ban },
  { key: "lists", labelKey: `${K}.sectionLists`, labelDefault: "Lists", icon: ListChecks },
  { key: "quarantine", labelKey: `${K}.sectionQuarantine`, labelDefault: "Quarantine", icon: ShieldAlert },
  { key: "stats", labelKey: `${K}.sectionStats`, labelDefault: "Stats", icon: Gauge },
  { key: "service", labelKey: `${K}.sectionService`, labelDefault: "Service", icon: Power },
];

const AmavisSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const mgr = useAmavis();
  const [section, setSection] = useState<SectionKey>("overview");

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t(`${K}.title`, "Amavis (content filter)")}
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`}
            />
            {mgr.isConnected
              ? mgr.summary?.host ?? t(`${K}.connected`, "Connected")
              : t(`${K}.disconnected`, "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">
              v{mgr.summary.version}
            </span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t(`${K}.disconnect`, "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected || !cid ? (
        <ConnectForm mgr={mgr} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
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
          <div className="min-h-0 flex-1 overflow-y-auto">
            {section === "overview" && <OverviewSection mgr={mgr} cid={cid} />}
            {section === "config" && <ConfigSection mgr={mgr} cid={cid} />}
            {section === "banks" && <PolicyBanksSection mgr={mgr} cid={cid} />}
            {section === "banned" && <BannedSection mgr={mgr} cid={cid} />}
            {section === "lists" && <ListsSection mgr={mgr} cid={cid} />}
            {section === "quarantine" && (
              <QuarantineSection mgr={mgr} cid={cid} />
            )}
            {section === "stats" && <StatsSection mgr={mgr} cid={cid} />}
            {section === "service" && <ServiceSection mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default AmavisSubTab;
