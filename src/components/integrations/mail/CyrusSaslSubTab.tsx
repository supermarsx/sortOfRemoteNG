// Cyrus SASL (auth) sub-tab for the unified Mail Server panel (t42-mail-cyrussasl).
//
// Self-contained mini-panel: owns its own connect form + connection lifecycle +
// management views + persistence — the mail shell provides NO connection. Binds
// all 51 `sasl_*` commands (prefix `sasl_`, backing crate sorng-cyrus-sasl) via
// `useCyrusSasl()` / `cyrusSaslApi`, grouped into sections (Service, Mechanisms,
// Users & Realms, saslauthd, App config, auxprop, sasldb).
//
// Persistence uses `useIntegrationConfigStore` with integrationKey
// `"mail.cyrusSasl"`; the SSH password is stored via the OS vault (never in the
// config blob). No `connectionId` prop is passed — this tab connects itself.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  Database,
  Puzzle,
  Server,
  Cog,
  Play,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MailSubTabProps } from "./registry";
import { useCyrusSasl, type CyrusSaslManager } from "../../../hooks/integration/mail/useCyrusSasl";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import type {
  AuxpropPlugin,
  SaslAppConfig,
  SaslDbEntry,
  SaslInfo,
  SaslMechanism,
  SaslTestResult,
  SaslUser,
  SaslauthConfig,
  SaslauthStatus,
} from "../../../types/mail/cyrusSasl";

const INTEGRATION_KEY = "mail.cyrusSasl";

// ─── Shared UI helpers ─────────────────────────────────────────────────────────

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

function TestBadge({ result }: { result: SaslTestResult | null }) {
  const { t } = useTranslation();
  if (!result) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
        result.success
          ? "bg-green-500/15 text-green-500"
          : "bg-red-500/15 text-red-500"
      }`}
    >
      {result.success
        ? t("integrations.mail.cyrusSasl.testOk", "OK")
        : t("integrations.mail.cyrusSasl.testFail", "Failed")}
      {result.mechanism_used ? ` · ${result.mechanism_used}` : ""}
      {result.message ? ` · ${result.message}` : ""}
    </span>
  );
}

type SectionKey =
  | "service"
  | "mechanisms"
  | "users"
  | "saslauthd"
  | "apps"
  | "auxprop"
  | "sasldb";

// ─── Connect form ───────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  ssh_user: string;
  ssh_password: string;
  ssh_key: string;
  saslauthd_bin: string;
  sasldblistusers_bin: string;
  saslpasswd_bin: string;
  config_dir: string;
  timeout_secs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "22",
  ssh_user: "",
  ssh_password: "",
  ssh_key: "",
  saslauthd_bin: "",
  sasldblistusers_bin: "",
  saslpasswd_bin: "",
  config_dir: "",
  timeout_secs: "30",
  name: "",
};

const ConnectForm: React.FC<{
  mgr: CyrusSaslManager;
  onConnected: (id: string) => void;
}> = ({ mgr, onConnected }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(undefined);

  // Prefill from the first persisted "mail.cyrusSasl" instance (+ vault secret).
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
      ssh_user: inst.fields?.ssh_user ?? "",
      ssh_key: inst.fields?.ssh_key ?? "",
      saslauthd_bin: inst.fields?.saslauthd_bin ?? "",
      sasldblistusers_bin: inst.fields?.sasldblistusers_bin ?? "",
      saslpasswd_bin: inst.fields?.saslpasswd_bin ?? "",
      config_dir: inst.fields?.config_dir ?? "",
      timeout_secs: inst.fields?.timeout_secs ?? "30",
    }));
    store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, ssh_password: secret }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? generateId();
    const ok = await mgr.connect(id, {
      host: form.host.trim(),
      port: form.port ? Number(form.port) : undefined,
      ssh_user: form.ssh_user || undefined,
      ssh_password: form.ssh_password || undefined,
      ssh_key: form.ssh_key || undefined,
      saslauthd_bin: form.saslauthd_bin || undefined,
      sasldblistusers_bin: form.sasldblistusers_bin || undefined,
      saslpasswd_bin: form.saslpasswd_bin || undefined,
      config_dir: form.config_dir || undefined,
      timeout_secs: form.timeout_secs ? Number(form.timeout_secs) : undefined,
    });
    if (ok) onConnected(id);
  }, [mgr, form, savedId, onConnected]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      ssh_user: form.ssh_user,
      ssh_key: form.ssh_key,
      saslauthd_bin: form.saslauthd_bin,
      sasldblistusers_bin: form.sasldblistusers_bin,
      saslpasswd_bin: form.saslpasswd_bin,
      config_dir: form.config_dir,
      timeout_secs: form.timeout_secs,
    };
    const secret = form.ssh_password || undefined;
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
        <Labeled label={t("integrations.mail.cyrusSasl.host", "SSH host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="mail.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.cyrusSasl.port", "SSH port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.cyrusSasl.sshUser", "SSH user")}>
          <input
            className={field}
            value={form.ssh_user}
            onChange={(e) => set("ssh_user", e.target.value)}
            placeholder="root"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.cyrusSasl.sshPassword", "SSH password")}
        >
          <input
            className={field}
            type="password"
            value={form.ssh_password}
            onChange={(e) => set("ssh_password", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.cyrusSasl.sshKey", "SSH private key path")}
        >
          <input
            className={field}
            value={form.ssh_key}
            onChange={(e) => set("ssh_key", e.target.value)}
            placeholder="~/.ssh/id_ed25519"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.cyrusSasl.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeout_secs}
            onChange={(e) => set("timeout_secs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.cyrusSasl.configDir", "Config dir")}
        >
          <input
            className={field}
            value={form.config_dir}
            onChange={(e) => set("config_dir", e.target.value)}
            placeholder="/etc/sasl2"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.cyrusSasl.saslauthdBin", "saslauthd binary")}
        >
          <input
            className={field}
            value={form.saslauthd_bin}
            onChange={(e) => set("saslauthd_bin", e.target.value)}
            placeholder="/usr/sbin/saslauthd"
          />
        </Labeled>
        <Labeled
          label={t(
            "integrations.mail.cyrusSasl.saslpasswdBin",
            "saslpasswd2 binary",
          )}
        >
          <input
            className={field}
            value={form.saslpasswd_bin}
            onChange={(e) => set("saslpasswd_bin", e.target.value)}
            placeholder="/usr/sbin/saslpasswd2"
          />
        </Labeled>
        <Labeled
          label={t(
            "integrations.mail.cyrusSasl.sasldblistusersBin",
            "sasldblistusers2 binary",
          )}
        >
          <input
            className={field}
            value={form.sasldblistusers_bin}
            onChange={(e) => set("sasldblistusers_bin", e.target.value)}
            placeholder="/usr/sbin/sasldblistusers2"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.cyrusSasl.instanceName", "Saved name")}
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
          {t("integrations.mail.cyrusSasl.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.mail.cyrusSasl.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Service section (info / status / version / test_config / start·stop·restart·reload) ──

const ServiceSection: React.FC<{ mgr: CyrusSaslManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SaslInfo | null>(null);
  const [version, setVersion] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [test, setTest] = useState<SaslTestResult | null>(null);

  const refresh = useCallback(async () => {
    const safe = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch {
        /* surfaced via mgr.error */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(async () => setInfo(await mgr.api.info(cid))),
        safe(async () => setVersion(await mgr.api.version(cid))),
        safe(async () => setStatus(await mgr.api.status(cid))),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const action = useCallback(
    async (fn: (id: string) => Promise<unknown>) => {
      try {
        await mgr.run(() => fn(cid));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const runTestConfig = useCallback(async () => {
    try {
      setTest(await mgr.run(() => mgr.api.testConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} /> {t("integrations.mail.cyrusSasl.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={() => void action(mgr.api.start)} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.start", "Start")}
        </button>
        <button className={btn} onClick={() => void action(mgr.api.stop)} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.stop", "Stop")}
        </button>
        <button className={btn} onClick={() => void action(mgr.api.restart)} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.restart", "Restart")}
        </button>
        <button className={btn} onClick={() => void action(mgr.api.reload)} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.reload", "Reload")}
        </button>
        <button className={btn} onClick={runTestConfig} disabled={mgr.isLoading}>
          <ShieldCheck size={12} /> {t("integrations.mail.cyrusSasl.testConfig", "Test config")}
        </button>
        <TestBadge result={test} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [t("integrations.mail.cyrusSasl.version", "Version"), info?.version ?? (version || "—")],
          [
            t("integrations.mail.cyrusSasl.saslauthd", "saslauthd"),
            info
              ? info.saslauthd_running
                ? t("integrations.mail.cyrusSasl.running", "running")
                : t("integrations.mail.cyrusSasl.stopped", "stopped")
              : "—",
          ],
          [t("integrations.mail.cyrusSasl.pluginDir", "Plugin dir"), info?.plugin_dir ?? "—"],
          [t("integrations.mail.cyrusSasl.configDir", "Config dir"), info?.config_dir ?? "—"],
        ].map(([label, value]) => (
          <div key={String(label)} className={card}>
            <div className="truncate text-sm font-semibold text-[var(--color-text)]">{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">{label}</div>
          </div>
        ))}
      </div>

      {info && info.available_mechanisms.length > 0 && (
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.mail.cyrusSasl.availableMechanisms", "Available mechanisms")}
          </h4>
          <p className="break-words text-xs text-[var(--color-textSecondary)]">
            {info.available_mechanisms.join(", ")}
          </p>
        </section>
      )}

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.status", "Status")}
        </h4>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {status || "—"}
        </pre>
      </section>
    </div>
  );
};

// ─── Mechanisms section ─────────────────────────────────────────────────────────

const MechanismsSection: React.FC<{ mgr: CyrusSaslManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [mechs, setMechs] = useState<SaslMechanism[]>([]);
  const [available, setAvailable] = useState<SaslMechanism[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [detailName, setDetailName] = useState("");
  const [detail, setDetail] = useState<SaslMechanism | null>(null);

  const refresh = useCallback(async () => {
    const safe = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(async () => setMechs(await mgr.api.listMechanisms(cid))),
        safe(async () => setAvailable(await mgr.api.listAvailableMechanisms(cid))),
        safe(async () => setEnabled(await mgr.api.listEnabledMechanisms(cid))),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (name: string, on: boolean) => {
      try {
        await mgr.run(() =>
          on ? mgr.api.enableMechanism(cid, name) : mgr.api.disableMechanism(cid, name),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const loadDetail = useCallback(async () => {
    if (!detailName) return;
    try {
      setDetail(await mgr.run(() => mgr.api.getMechanism(cid, detailName)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, detailName]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} /> {t("integrations.mail.cyrusSasl.refresh", "Refresh")}
        </button>
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t("integrations.mail.cyrusSasl.enabledList", "Enabled")}: {enabled.join(", ") || "—"}
        </span>
      </div>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.configuredMechanisms", "Configured mechanisms")}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.name", "Name")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.enabled", "Enabled")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.description", "Description")}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {mechs.map((m) => (
                <tr key={m.name} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{m.name}</td>
                  <td className="px-2 py-1">{m.enabled ? "✓" : "—"}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{m.description}</td>
                  <td className="px-2 py-1">
                    <button
                      className={btn}
                      onClick={() => void toggle(m.name, !m.enabled)}
                      disabled={mgr.isLoading}
                    >
                      {m.enabled
                        ? t("integrations.mail.cyrusSasl.disable", "Disable")
                        : t("integrations.mail.cyrusSasl.enable", "Enable")}
                    </button>
                  </td>
                </tr>
              ))}
              {mechs.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                    {t("integrations.mail.cyrusSasl.none", "None")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.mechanismDetail", "Mechanism detail")}
        </h4>
        <div className="flex flex-wrap items-end gap-2">
          <Labeled label={t("integrations.mail.cyrusSasl.name", "Name")}>
            <input
              className={field}
              value={detailName}
              onChange={(e) => setDetailName(e.target.value)}
              placeholder="PLAIN"
            />
          </Labeled>
          <button className={btn} onClick={loadDetail} disabled={mgr.isLoading || !detailName}>
            {t("integrations.mail.cyrusSasl.load", "Load")}
          </button>
        </div>
        {detail && (
          <p className="mt-2 break-words text-xs text-[var(--color-textSecondary)]">
            <span className="font-mono text-[var(--color-text)]">{detail.name}</span> ·{" "}
            {detail.enabled ? t("integrations.mail.cyrusSasl.enabled", "Enabled") : t("integrations.mail.cyrusSasl.disabled", "Disabled")}
            {detail.security_flags.length > 0 ? ` · ${detail.security_flags.join(", ")}` : ""}
            {detail.features.length > 0 ? ` · ${detail.features.join(", ")}` : ""}
          </p>
        )}
        {available.length > 0 && (
          <p className="mt-2 break-words text-[10px] text-[var(--color-textMuted)]">
            {t("integrations.mail.cyrusSasl.available", "Available")}: {available.map((m) => m.name).join(", ")}
          </p>
        )}
      </section>
    </div>
  );
};

// ─── Users & realms section ─────────────────────────────────────────────────────

const UsersSection: React.FC<{ mgr: CyrusSaslManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<SaslUser[]>([]);
  const [realms, setRealms] = useState<string[]>([]);
  const [form, setForm] = useState({ username: "", realm: "", password: "" });
  const [test, setTest] = useState<SaslTestResult | null>(null);
  const [detail, setDetail] = useState<SaslUser | null>(null);

  const refresh = useCallback(async () => {
    const safe = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(async () => setUsers(await mgr.api.listUsers(cid))),
        safe(async () => setRealms(await mgr.api.listRealms(cid))),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setF = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = useCallback(async () => {
    if (!form.username || !form.password) return;
    try {
      await mgr.run(() =>
        mgr.api.createUser(cid, {
          username: form.username,
          realm: form.realm || undefined,
          password: form.password,
        }),
      );
      setForm({ username: "", realm: "", password: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const setPassword = useCallback(
    async (u: SaslUser) => {
      const pw = window.prompt(
        t("integrations.mail.cyrusSasl.newPassword", "New password for {{u}}", {
          u: `${u.username}@${u.realm}`,
        }),
      );
      if (!pw) return;
      try {
        await mgr.run(() => mgr.api.updateUser(cid, u.username, u.realm, { password: pw }));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  const remove = useCallback(
    async (u: SaslUser) => {
      if (
        !window.confirm(
          t("integrations.mail.cyrusSasl.deleteUserConfirm", "Delete user {{u}}?", {
            u: `${u.username}@${u.realm}`,
          }),
        )
      )
        return;
      try {
        await mgr.run(() => mgr.api.deleteUser(cid, u.username, u.realm));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  const viewUser = useCallback(
    async (u: SaslUser) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getUser(cid, u.username, u.realm)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const testAuth = useCallback(async () => {
    if (!form.username || !form.password) return;
    try {
      setTest(
        await mgr.run(() =>
          mgr.api.testAuth(cid, form.username, form.realm, form.password),
        ),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} /> {t("integrations.mail.cyrusSasl.refresh", "Refresh")}
        </button>
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t("integrations.mail.cyrusSasl.realms", "Realms")}: {realms.join(", ") || "—"}
        </span>
      </div>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.createUser", "Create user / test auth")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Labeled label={t("integrations.mail.cyrusSasl.username", "Username")}>
            <input className={field} value={form.username} onChange={(e) => setF("username", e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.realm", "Realm")}>
            <input className={field} value={form.realm} onChange={(e) => setF("realm", e.target.value)} placeholder="example.com" />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.password", "Password")}>
            <input className={field} type="password" value={form.password} onChange={(e) => setF("password", e.target.value)} />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={create} disabled={mgr.isLoading || !form.username || !form.password}>
            {t("integrations.mail.cyrusSasl.create", "Create")}
          </button>
          <button className={btn} onClick={testAuth} disabled={mgr.isLoading || !form.username || !form.password}>
            {t("integrations.mail.cyrusSasl.testAuth", "Test auth")}
          </button>
          <TestBadge result={test} />
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.users", "Users")}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.username", "Username")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.realm", "Realm")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.password", "Password")}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={`${u.username}@${u.realm}`} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{u.username}</td>
                  <td className="px-2 py-1">{u.realm}</td>
                  <td className="px-2 py-1">{u.password_exists ? "✓" : "—"}</td>
                  <td className="px-2 py-1">
                    <div className="flex gap-1">
                      <button className={btn} onClick={() => void viewUser(u)} disabled={mgr.isLoading}>
                        {t("integrations.mail.cyrusSasl.details", "Details")}
                      </button>
                      <button className={btn} onClick={() => void setPassword(u)} disabled={mgr.isLoading}>
                        {t("integrations.mail.cyrusSasl.setPassword", "Set password")}
                      </button>
                      <button className={btn} onClick={() => void remove(u)} disabled={mgr.isLoading}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                    {t("integrations.mail.cyrusSasl.none", "None")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {detail && (
          <p className="mt-2 text-xs text-[var(--color-textSecondary)]">
            {detail.username}@{detail.realm} ·{" "}
            {detail.password_exists
              ? t("integrations.mail.cyrusSasl.passwordSet", "password set")
              : t("integrations.mail.cyrusSasl.noPassword", "no password")}
          </p>
        )}
      </section>
    </div>
  );
};

// ─── saslauthd section ──────────────────────────────────────────────────────────

const SaslauthdSection: React.FC<{ mgr: CyrusSaslManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SaslauthConfig | null>(null);
  const [status, setStatus] = useState<SaslauthStatus | null>(null);
  const [flagsText, setFlagsText] = useState("");
  const [mech, setMech] = useState("");
  const [auth, setAuth] = useState({ username: "", password: "", service: "smtp", realm: "" });
  const [test, setTest] = useState<SaslTestResult | null>(null);

  const refresh = useCallback(async () => {
    const safe = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await safe(async () => {
        const c = await mgr.api.getSaslauthdConfig(cid);
        setConfig(c);
        setMech(c.mech);
        setFlagsText(c.flags.join(" "));
      });
      await safe(async () => setStatus(await mgr.api.getSaslauthdStatus(cid)));
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveConfig = useCallback(async () => {
    if (!config) return;
    try {
      await mgr.run(() =>
        mgr.api.setSaslauthdConfig(cid, {
          ...config,
          mech,
          flags: flagsText.split(/\s+/).filter(Boolean),
        }),
      );
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, config, mech, flagsText, refresh]);

  const setDaemonMech = useCallback(async () => {
    if (!mech) return;
    try {
      await mgr.run(() => mgr.api.setSaslauthdMechanism(cid, mech));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, mech, refresh]);

  const setDaemonFlags = useCallback(async () => {
    try {
      await mgr.run(() =>
        mgr.api.setSaslauthdFlags(cid, flagsText.split(/\s+/).filter(Boolean)),
      );
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, flagsText, refresh]);

  const service = useCallback(
    async (fn: (id: string) => Promise<unknown>) => {
      try {
        await mgr.run(() => fn(cid));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const runTest = useCallback(async () => {
    if (!auth.username) return;
    try {
      setTest(
        await mgr.run(() =>
          mgr.api.testSaslauthdAuth(cid, auth.username, auth.password, auth.service, auth.realm),
        ),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, auth]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} /> {t("integrations.mail.cyrusSasl.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={() => void service(mgr.api.startSaslauthd)} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.start", "Start")}
        </button>
        <button className={btn} onClick={() => void service(mgr.api.stopSaslauthd)} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.stop", "Stop")}
        </button>
        <button className={btn} onClick={() => void service(mgr.api.restartSaslauthd)} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.restart", "Restart")}
        </button>
      </div>

      {status && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [
              t("integrations.mail.cyrusSasl.state", "State"),
              status.running ? t("integrations.mail.cyrusSasl.running", "running") : t("integrations.mail.cyrusSasl.stopped", "stopped"),
            ],
            [t("integrations.mail.cyrusSasl.pid", "PID"), status.pid ?? "—"],
            [t("integrations.mail.cyrusSasl.threads", "Threads (act/idle)"), `${status.threads_active ?? "—"}/${status.threads_idle ?? "—"}`],
            [t("integrations.mail.cyrusSasl.cache", "Cache (hit/miss)"), `${status.cache_hits ?? "—"}/${status.cache_misses ?? "—"}`],
          ].map(([label, value]) => (
            <div key={String(label)} className={card}>
              <div className="truncate text-sm font-semibold text-[var(--color-text)]">{value}</div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">{label}</div>
            </div>
          ))}
        </div>
      )}

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.saslauthdConfig", "saslauthd config")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.mail.cyrusSasl.mechanism", "Mechanism")}>
            <input className={field} value={mech} onChange={(e) => setMech(e.target.value)} placeholder="pam" />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.flags", "Flags (space-separated)")}>
            <input className={field} value={flagsText} onChange={(e) => setFlagsText(e.target.value)} />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={saveConfig} disabled={mgr.isLoading || !config}>
            {t("integrations.mail.cyrusSasl.saveConfig", "Save config")}
          </button>
          <button className={btn} onClick={setDaemonMech} disabled={mgr.isLoading || !mech}>
            {t("integrations.mail.cyrusSasl.setMechanism", "Set mechanism")}
          </button>
          <button className={btn} onClick={setDaemonFlags} disabled={mgr.isLoading}>
            {t("integrations.mail.cyrusSasl.setFlags", "Set flags")}
          </button>
        </div>
        {config && (
          <p className="mt-2 text-[10px] text-[var(--color-textMuted)]">
            {t("integrations.mail.cyrusSasl.runDir", "run dir")}: {config.run_dir ?? "—"} ·{" "}
            {t("integrations.mail.cyrusSasl.threadCount", "threads")}: {config.threads ?? "—"} ·{" "}
            {t("integrations.mail.cyrusSasl.cacheTimeout", "cache timeout")}: {config.cache_timeout ?? "—"} ·{" "}
            {t("integrations.mail.cyrusSasl.logLevel", "log level")}: {config.log_level ?? "—"}
          </p>
        )}
      </section>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.testSaslauthd", "Test saslauthd auth")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Labeled label={t("integrations.mail.cyrusSasl.username", "Username")}>
            <input className={field} value={auth.username} onChange={(e) => setAuth((a) => ({ ...a, username: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.password", "Password")}>
            <input className={field} type="password" value={auth.password} onChange={(e) => setAuth((a) => ({ ...a, password: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.service", "Service")}>
            <input className={field} value={auth.service} onChange={(e) => setAuth((a) => ({ ...a, service: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.realm", "Realm")}>
            <input className={field} value={auth.realm} onChange={(e) => setAuth((a) => ({ ...a, realm: e.target.value }))} />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={runTest} disabled={mgr.isLoading || !auth.username}>
            {t("integrations.mail.cyrusSasl.testAuth", "Test auth")}
          </button>
          <TestBadge result={test} />
        </div>
      </section>
    </div>
  );
};

// ─── App config section ─────────────────────────────────────────────────────────

const AppsSection: React.FC<{ mgr: CyrusSaslManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [apps, setApps] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [config, setConfig] = useState<SaslAppConfig | null>(null);
  const [param, setParam] = useState({ key: "", value: "" });

  const refreshApps = useCallback(async () => {
    try {
      setApps(await mgr.run(() => mgr.api.listApps(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refreshApps();
  }, [refreshApps]);

  const loadConfig = useCallback(
    async (app: string) => {
      setSelected(app);
      try {
        setConfig(await mgr.run(() => mgr.api.getAppConfig(cid, app)));
      } catch {
        setConfig(null);
      }
    },
    [mgr, cid],
  );

  const setConfigField = <K extends keyof SaslAppConfig>(k: K, v: SaslAppConfig[K]) =>
    setConfig((c) => (c ? { ...c, [k]: v } : c));

  const saveConfig = useCallback(async () => {
    if (!config || !selected) return;
    try {
      await mgr.run(() => mgr.api.setAppConfig(cid, selected, config));
      await refreshApps();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, config, selected, refreshApps]);

  const deleteConfig = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm(t("integrations.mail.cyrusSasl.deleteAppConfirm", "Delete config for {{a}}?", { a: selected }))) return;
    try {
      await mgr.run(() => mgr.api.deleteAppConfig(cid, selected));
      setConfig(null);
      setSelected("");
      await refreshApps();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, refreshApps, t]);

  const getParam = useCallback(async () => {
    if (!selected || !param.key) return;
    try {
      const v = await mgr.run(() => mgr.api.getAppParam(cid, selected, param.key));
      setParam((p) => ({ ...p, value: v }));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, param.key]);

  const setParamValue = useCallback(async () => {
    if (!selected || !param.key) return;
    try {
      await mgr.run(() => mgr.api.setAppParam(cid, selected, param.key, param.value));
      await loadConfig(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, param, loadConfig]);

  const deleteParam = useCallback(async () => {
    if (!selected || !param.key) return;
    try {
      await mgr.run(() => mgr.api.deleteAppParam(cid, selected, param.key));
      await loadConfig(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, param.key, loadConfig]);

  const configRows: [keyof SaslAppConfig, string][] = [
    ["pwcheck_method", "pwcheck_method"],
    ["mech_list", "mech_list"],
    ["log_level", "log_level"],
    ["auxprop_plugin", "auxprop_plugin"],
    ["sql_engine", "sql_engine"],
    ["sql_hostnames", "sql_hostnames"],
    ["sql_database", "sql_database"],
    ["sql_user", "sql_user"],
    ["sql_passw", "sql_passw"],
    ["ldapdb_uri", "ldapdb_uri"],
    ["ldapdb_id", "ldapdb_id"],
    ["ldapdb_pw", "ldapdb_pw"],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refreshApps} disabled={mgr.isLoading}>
          <RefreshCw size={12} /> {t("integrations.mail.cyrusSasl.refresh", "Refresh")}
        </button>
        <select
          className={field}
          style={{ width: 200 }}
          value={selected}
          onChange={(e) => void loadConfig(e.target.value)}
        >
          <option value="">{t("integrations.mail.cyrusSasl.selectApp", "Select application…")}</option>
          {apps.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {config && (
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.mail.cyrusSasl.appConfig", "App config")}: {selected}
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {configRows.map(([key, label]) => (
              <Labeled key={key} label={label}>
                <input
                  className={field}
                  value={(config[key] as string | null | undefined) ?? ""}
                  onChange={(e) => setConfigField(key, (e.target.value || null) as SaslAppConfig[typeof key])}
                />
              </Labeled>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className={btn} onClick={saveConfig} disabled={mgr.isLoading}>
              {t("integrations.mail.cyrusSasl.saveConfig", "Save config")}
            </button>
            <button className={btn} onClick={deleteConfig} disabled={mgr.isLoading}>
              <Trash2 size={12} /> {t("integrations.mail.cyrusSasl.deleteConfig", "Delete config")}
            </button>
          </div>
          {Object.keys(config.extra).length > 0 && (
            <p className="mt-2 break-words text-[10px] text-[var(--color-textMuted)]">
              {t("integrations.mail.cyrusSasl.extra", "Extra")}:{" "}
              {Object.entries(config.extra).map(([k, v]) => `${k}=${v}`).join(", ")}
            </p>
          )}
        </section>
      )}

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.appParam", "App parameter")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.mail.cyrusSasl.key", "Key")}>
            <input className={field} value={param.key} onChange={(e) => setParam((p) => ({ ...p, key: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.value", "Value")}>
            <input className={field} value={param.value} onChange={(e) => setParam((p) => ({ ...p, value: e.target.value }))} />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={getParam} disabled={mgr.isLoading || !selected || !param.key}>
            {t("integrations.mail.cyrusSasl.get", "Get")}
          </button>
          <button className={btn} onClick={setParamValue} disabled={mgr.isLoading || !selected || !param.key}>
            {t("integrations.mail.cyrusSasl.set", "Set")}
          </button>
          <button className={btn} onClick={deleteParam} disabled={mgr.isLoading || !selected || !param.key}>
            <Trash2 size={12} /> {t("integrations.mail.cyrusSasl.delete", "Delete")}
          </button>
        </div>
      </section>
    </div>
  );
};

// ─── auxprop section ────────────────────────────────────────────────────────────

const AuxpropSection: React.FC<{ mgr: CyrusSaslManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<AuxpropPlugin[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [settingsText, setSettingsText] = useState("");
  const [test, setTest] = useState<SaslTestResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPlugins(await mgr.run(() => mgr.api.listAuxprop(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadPlugin = useCallback(
    async (name: string) => {
      setSelected(name);
      setTest(null);
      try {
        await mgr.run(() => mgr.api.getAuxprop(cid, name));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const configure = useCallback(async () => {
    if (!selected) return;
    const settings: Record<string, string> = {};
    for (const line of settingsText.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) settings[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    try {
      await mgr.run(() => mgr.api.configureAuxprop(cid, selected, settings));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, settingsText, refresh]);

  const runTest = useCallback(async () => {
    if (!selected) return;
    try {
      setTest(await mgr.run(() => mgr.api.testAuxprop(cid, selected)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} /> {t("integrations.mail.cyrusSasl.refresh", "Refresh")}
        </button>
      </div>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.auxpropPlugins", "auxprop plugins")}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.name", "Name")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.type", "Type")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.available", "Available")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.description", "Description")}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {plugins.map((p) => (
                <tr key={p.name} className={`border-t border-[var(--color-border)] ${selected === p.name ? "bg-[var(--color-surface)]" : ""}`}>
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{p.name}</td>
                  <td className="px-2 py-1">{p.plugin_type}</td>
                  <td className="px-2 py-1">{p.available ? "✓" : "—"}</td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{p.description}</td>
                  <td className="px-2 py-1">
                    <button className={btn} onClick={() => void loadPlugin(p.name)} disabled={mgr.isLoading}>
                      {t("integrations.mail.cyrusSasl.select", "Select")}
                    </button>
                  </td>
                </tr>
              ))}
              {plugins.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                    {t("integrations.mail.cyrusSasl.none", "None")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.configureAuxprop", "Configure")}: {selected || "—"}
        </h4>
        <Labeled label={t("integrations.mail.cyrusSasl.settings", "Settings (key=value per line)")}>
          <textarea
            className={`${field} font-mono`}
            rows={4}
            value={settingsText}
            onChange={(e) => setSettingsText(e.target.value)}
            placeholder={"sql_engine=mysql\nsql_hostnames=127.0.0.1"}
          />
        </Labeled>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={configure} disabled={mgr.isLoading || !selected}>
            {t("integrations.mail.cyrusSasl.configure", "Configure")}
          </button>
          <button className={btn} onClick={runTest} disabled={mgr.isLoading || !selected}>
            {t("integrations.mail.cyrusSasl.test", "Test")}
          </button>
          <TestBadge result={test} />
        </div>
      </section>
    </div>
  );
};

// ─── sasldb section ─────────────────────────────────────────────────────────────

const SasldbSection: React.FC<{ mgr: CyrusSaslManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SaslDbEntry[]>([]);
  const [lookup, setLookup] = useState({ username: "", realm: "" });
  const [pwForm, setPwForm] = useState({ username: "", realm: "", password: "" });
  const [dump, setDump] = useState("");
  const [importText, setImportText] = useState("");

  const refresh = useCallback(async () => {
    try {
      setEntries(await mgr.run(() => mgr.api.listDbEntries(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doLookup = useCallback(async () => {
    if (!lookup.username) return;
    try {
      setEntries(await mgr.run(() => mgr.api.getDbEntry(cid, lookup.username, lookup.realm)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, lookup]);

  const setPassword = useCallback(async () => {
    if (!pwForm.username || !pwForm.password) return;
    try {
      await mgr.run(() => mgr.api.setDbPassword(cid, pwForm.username, pwForm.realm, pwForm.password));
      setPwForm({ username: "", realm: "", password: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, pwForm, refresh]);

  const remove = useCallback(
    async (e: SaslDbEntry) => {
      if (!window.confirm(t("integrations.mail.cyrusSasl.deleteDbConfirm", "Delete DB entry {{u}}?", { u: `${e.username}@${e.realm}` }))) return;
      try {
        await mgr.run(() => mgr.api.deleteDbEntry(cid, e.username, e.realm));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  const doDump = useCallback(async () => {
    try {
      setDump(await mgr.run(() => mgr.api.dumpDb(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const doImport = useCallback(async () => {
    if (!importText) return;
    try {
      await mgr.run(() => mgr.api.importDb(cid, importText));
      setImportText("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, importText, refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} /> {t("integrations.mail.cyrusSasl.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={doDump} disabled={mgr.isLoading}>
          {t("integrations.mail.cyrusSasl.dump", "Dump DB")}
        </button>
      </div>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.lookup", "Lookup / set password")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.mail.cyrusSasl.username", "Username")}>
            <input className={field} value={lookup.username} onChange={(e) => setLookup((l) => ({ ...l, username: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.realm", "Realm")}>
            <input className={field} value={lookup.realm} onChange={(e) => setLookup((l) => ({ ...l, realm: e.target.value }))} />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={doLookup} disabled={mgr.isLoading || !lookup.username}>
            {t("integrations.mail.cyrusSasl.lookupBtn", "Lookup")}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Labeled label={t("integrations.mail.cyrusSasl.username", "Username")}>
            <input className={field} value={pwForm.username} onChange={(e) => setPwForm((p) => ({ ...p, username: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.realm", "Realm")}>
            <input className={field} value={pwForm.realm} onChange={(e) => setPwForm((p) => ({ ...p, realm: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.mail.cyrusSasl.password", "Password")}>
            <input className={field} type="password" value={pwForm.password} onChange={(e) => setPwForm((p) => ({ ...p, password: e.target.value }))} />
          </Labeled>
        </div>
        <div className="mt-2">
          <button className={btn} onClick={setPassword} disabled={mgr.isLoading || !pwForm.username || !pwForm.password}>
            {t("integrations.mail.cyrusSasl.setDbPassword", "Set DB password")}
          </button>
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.dbEntries", "DB entries")}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.username", "Username")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.realm", "Realm")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.property", "Property")}</th>
                <th className="px-2 py-1">{t("integrations.mail.cyrusSasl.value", "Value")}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.username}@${e.realm}:${e.property}:${i}`} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">{e.username}</td>
                  <td className="px-2 py-1">{e.realm}</td>
                  <td className="px-2 py-1">{e.property}</td>
                  <td className="px-2 py-1 font-mono">{e.value}</td>
                  <td className="px-2 py-1">
                    <button className={btn} onClick={() => void remove(e)} disabled={mgr.isLoading}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                    {t("integrations.mail.cyrusSasl.none", "None")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {dump && (
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.mail.cyrusSasl.dbDump", "DB dump")}
          </h4>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
            {dump}
          </pre>
        </section>
      )}

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.cyrusSasl.importDb", "Import DB")}
        </h4>
        <Labeled label={t("integrations.mail.cyrusSasl.importData", "Dump data")}>
          <textarea
            className={`${field} font-mono`}
            rows={4}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
        </Labeled>
        <div className="mt-2">
          <button className={btn} onClick={doImport} disabled={mgr.isLoading || !importText}>
            {t("integrations.mail.cyrusSasl.import", "Import")}
          </button>
        </div>
      </section>
    </div>
  );
};

// ─── Sub-tab shell ──────────────────────────────────────────────────────────────

const SECTIONS: {
  key: SectionKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "service", labelKey: "integrations.mail.cyrusSasl.sectionService", labelDefault: "Service", icon: Server },
  { key: "mechanisms", labelKey: "integrations.mail.cyrusSasl.sectionMechanisms", labelDefault: "Mechanisms", icon: KeyRound },
  { key: "users", labelKey: "integrations.mail.cyrusSasl.sectionUsers", labelDefault: "Users & Realms", icon: Users },
  { key: "saslauthd", labelKey: "integrations.mail.cyrusSasl.sectionSaslauthd", labelDefault: "saslauthd", icon: Play },
  { key: "apps", labelKey: "integrations.mail.cyrusSasl.sectionApps", labelDefault: "App config", icon: Cog },
  { key: "auxprop", labelKey: "integrations.mail.cyrusSasl.sectionAuxprop", labelDefault: "auxprop", icon: Puzzle },
  { key: "sasldb", labelKey: "integrations.mail.cyrusSasl.sectionSasldb", labelDefault: "sasldb", icon: Database },
];

const CyrusSaslSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const mgr = useCyrusSasl();
  const [section, setSection] = useState<SectionKey>("service");

  const cid = mgr.connectionId;

  const ping = useCallback(async () => {
    if (!cid) return;
    try {
      await mgr.run(() => mgr.api.ping(cid));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const header = useMemo(
    () => (
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <KeyRound className="h-4 w-4 text-primary" />
          {t("integrations.mail.cyrusSasl.title", "Cyrus SASL")}
        </h3>
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
              ? mgr.summary?.host ?? t("integrations.mail.cyrusSasl.connected", "Connected")
              : t("integrations.mail.cyrusSasl.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.isConnected && (
            <>
              <button className={btn} onClick={() => void ping()}>
                {t("integrations.mail.cyrusSasl.ping", "Ping")}
              </button>
              <button className={btn} onClick={() => void mgr.disconnect()}>
                {t("integrations.mail.cyrusSasl.disconnect", "Disconnect")}
              </button>
            </>
          )}
        </div>
      </div>
    ),
    [mgr, t, ping],
  );

  return (
    <div className="flex h-full flex-col p-4">
      {header}

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected || !cid ? (
        <ConnectForm mgr={mgr} onConnected={() => setSection("service")} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
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
            {section === "service" && <ServiceSection mgr={mgr} cid={cid} />}
            {section === "mechanisms" && <MechanismsSection mgr={mgr} cid={cid} />}
            {section === "users" && <UsersSection mgr={mgr} cid={cid} />}
            {section === "saslauthd" && <SaslauthdSection mgr={mgr} cid={cid} />}
            {section === "apps" && <AppsSection mgr={mgr} cid={cid} />}
            {section === "auxprop" && <AuxpropSection mgr={mgr} cid={cid} />}
            {section === "sasldb" && <SasldbSection mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default CyrusSaslSubTab;
