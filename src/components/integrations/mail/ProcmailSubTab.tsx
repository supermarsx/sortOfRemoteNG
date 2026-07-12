// Procmail (delivery) sub-tab for the unified Mail Server panel (t42 Wave M,
// exec t42-mail-procmail).
//
// Self-contained mini-panel: owns its own connect form + connection lifecycle
// (via `useProcmail`) + persistence (via `useIntegrationConfigStore`, key
// `mail.procmail`). Binds all 40 `procmail_*` commands grouped into internal
// sections (Recipes, Rules, Variables, Includes, Config, Logs). procmail has NO
// ping — the lifecycle is connect / disconnect / list_connections only, and every
// management command is keyed by `(id, user)` where `user` selects whose
// `~/.procmailrc` (or the global rc) is operated on.

import React, { useCallback, useEffect, useState } from "react";
import {
  FileCog,
  FileText,
  Filter,
  FolderInput,
  ListTree,
  Loader2,
  Plug,
  RefreshCw,
  ScrollText,
  Trash2,
  Variable,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useProcmail,
  type ProcmailManager,
} from "../../../hooks/integration/mail/useProcmail";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import type { MailSubTabProps } from "./registry";
import type {
  ProcmailConfig,
  ProcmailInclude,
  ProcmailLogEntry,
  ProcmailRecipe,
  ProcmailRule,
  ProcmailVariable,
  RecipeTestResult,
} from "../../../types/mail/procmail";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

const INTEGRATION_KEY = "mail.procmail";

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
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

/** Parse JSON from a textarea, alerting on failure. Returns `undefined` on error. */
function parseJson<T>(raw: string, onInvalid: () => void): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    onInvalid();
    return undefined;
  }
}

const csvLines = (s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

type SectionKey =
  | "recipes"
  | "rules"
  | "variables"
  | "includes"
  | "config"
  | "logs";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  sshUser: string;
  sshPassword: string;
  sshKey: string;
  procmailBin: string;
  procmailrcPath: string;
  logPath: string;
  timeoutSecs: string;
  /** Managed mailbox user whose `~/.procmailrc` is operated on. */
  user: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "22",
  sshUser: "root",
  sshPassword: "",
  sshKey: "",
  procmailBin: "",
  procmailrcPath: "",
  logPath: "",
  timeoutSecs: "30",
  user: "root",
  name: "",
};

const ConnectForm: React.FC<{
  mgr: ProcmailManager;
  onUserChange: (user: string) => void;
}> = ({ mgr, onUserChange }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>();

  // Prefill from the first persisted `mail.procmail` instance (host/fields +
  // vault secret), if any.
  useEffect(() => {
    if (store.isLoading) return;
    const inst = store.instancesFor(INTEGRATION_KEY)[0];
    if (!inst) return;
    setSavedId(inst.id);
    setForm((f) => ({
      ...f,
      name: inst.name,
      host: inst.host ?? f.host,
      port: inst.fields?.port ?? f.port,
      sshUser: inst.fields?.sshUser ?? f.sshUser,
      sshKey: inst.fields?.sshKey ?? "",
      procmailBin: inst.fields?.procmailBin ?? "",
      procmailrcPath: inst.fields?.procmailrcPath ?? "",
      logPath: inst.fields?.logPath ?? "",
      timeoutSecs: inst.fields?.timeoutSecs ?? f.timeoutSecs,
      user: inst.fields?.user ?? f.user,
    }));
    void store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, sshPassword: secret }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? generateId();
    onUserChange(form.user.trim() || "root");
    await mgr.connect(id, {
      host: form.host.trim(),
      port: form.port ? Number(form.port) : undefined,
      ssh_user: form.sshUser || undefined,
      ssh_password: form.sshPassword || undefined,
      ssh_key: form.sshKey || undefined,
      procmail_bin: form.procmailBin || undefined,
      procmailrc_path: form.procmailrcPath || undefined,
      log_path: form.logPath || undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId, onUserChange]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      sshUser: form.sshUser,
      sshKey: form.sshKey,
      procmailBin: form.procmailBin,
      procmailrcPath: form.procmailrcPath,
      logPath: form.logPath,
      timeoutSecs: form.timeoutSecs,
      user: form.user,
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
        <Labeled label={t("integrations.mail.procmail.host", "SSH host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="mail.example.com"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.procmail.port", "SSH port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
            placeholder="22"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.procmail.sshUser", "SSH username")}>
          <input
            className={field}
            value={form.sshUser}
            onChange={(e) => set("sshUser", e.target.value)}
            placeholder="root"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.procmail.sshPassword", "SSH password")}
        >
          <input
            className={field}
            type="password"
            value={form.sshPassword}
            onChange={(e) => set("sshPassword", e.target.value)}
            placeholder={t(
              "integrations.mail.procmail.sshPasswordHint",
              "omit when using a key",
            )}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.procmail.sshKey", "SSH private key path")}
        >
          <input
            className={field}
            value={form.sshKey}
            onChange={(e) => set("sshKey", e.target.value)}
            placeholder="~/.ssh/id_ed25519"
          />
        </Labeled>
        <Labeled
          label={t(
            "integrations.mail.procmail.user",
            "Managed user (whose procmailrc)",
          )}
        >
          <input
            className={field}
            value={form.user}
            onChange={(e) => set("user", e.target.value)}
            placeholder="root"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.procmail.procmailBin", "procmail binary")}
        >
          <input
            className={field}
            value={form.procmailBin}
            onChange={(e) => set("procmailBin", e.target.value)}
            placeholder="/usr/bin/procmail"
          />
        </Labeled>
        <Labeled
          label={t(
            "integrations.mail.procmail.procmailrcPath",
            "Global procmailrc path",
          )}
        >
          <input
            className={field}
            value={form.procmailrcPath}
            onChange={(e) => set("procmailrcPath", e.target.value)}
            placeholder="/etc/procmailrc"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.procmail.logPath", "Log file path")}
        >
          <input
            className={field}
            value={form.logPath}
            onChange={(e) => set("logPath", e.target.value)}
            placeholder="/var/log/procmail.log"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.procmail.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.procmail.instanceName", "Saved name")}
        >
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={t(
              "integrations.mail.procmail.instanceNameHint",
              "optional label",
            )}
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
          {t("integrations.mail.procmail.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.mail.procmail.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Recipes section ─────────────────────────────────────────────────────────

const RecipesSection: React.FC<{
  mgr: ProcmailManager;
  cid: string;
  user: string;
}> = ({ mgr, cid, user }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProcmailRecipe[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({
    conditions: "",
    action: "",
    flags: "",
    lockfile: "",
    comment: "",
  });
  const [testBody, setTestBody] = useState("");
  const [testResult, setTestResult] = useState<RecipeTestResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listRecipes(cid, user)));
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr, cid, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (recipeId: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getRecipe(cid, user, recipeId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user],
  );

  const create = useCallback(async () => {
    if (!form.action) return;
    try {
      await mgr.run(() =>
        mgr.api.createRecipe(cid, user, {
          condition_lines: csvLines(form.conditions),
          action: form.action,
          flags: form.flags || undefined,
          lockfile: form.lockfile || undefined,
          comment: form.comment || undefined,
        }),
      );
      setForm({ conditions: "", action: "", flags: "", lockfile: "", comment: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, form, refresh]);

  const toggle = useCallback(
    async (r: ProcmailRecipe) => {
      try {
        await mgr.run(() =>
          r.enabled
            ? mgr.api.disableRecipe(cid, user, r.id)
            : mgr.api.enableRecipe(cid, user, r.id),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh],
  );

  const reorder = useCallback(
    async (r: ProcmailRecipe, delta: number) => {
      const next = r.position + delta;
      if (next < 0) return;
      try {
        await mgr.run(() => mgr.api.reorderRecipe(cid, user, r.id, next));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh],
  );

  const remove = useCallback(
    async (recipeId: string) => {
      if (
        !window.confirm(
          t("integrations.mail.procmail.deleteRecipeConfirm", "Delete this recipe?"),
        )
      )
        return;
      try {
        await mgr.run(() => mgr.api.deleteRecipe(cid, user, recipeId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh, t],
  );

  const runTest = useCallback(async () => {
    try {
      setTestResult(await mgr.run(() => mgr.api.testRecipe(cid, user, testBody)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, testBody]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.procmail.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">#</th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.action", "Action")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.flags", "Flags")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.enabled", "Enabled")}
              </th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.position}
                </td>
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                  {r.action}
                </td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                  {r.flags || "—"}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.enabled ? "✓" : "—"}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void reorder(r, -1)}>
                      ↑
                    </button>
                    <button className={btn} onClick={() => void reorder(r, 1)}>
                      ↓
                    </button>
                    <button className={btn} onClick={() => void view(r.id)}>
                      {t("integrations.mail.procmail.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void toggle(r)}>
                      {r.enabled
                        ? t("integrations.mail.procmail.disable", "Disable")
                        : t("integrations.mail.procmail.enable", "Enable")}
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
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={5}
                >
                  {t("integrations.mail.procmail.noRecipes", "No recipes")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.procmail.createRecipe", "Create recipe")}
        </h4>
        <Labeled
          label={t(
            "integrations.mail.procmail.conditions",
            "Conditions (one per line, each starting with *)",
          )}
        >
          <textarea
            className={`${field} font-mono`}
            rows={3}
            value={form.conditions}
            onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
            placeholder="* ^From.*spammer@"
          />
        </Labeled>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.mail.procmail.action", "Action")}>
            <input
              className={field}
              value={form.action}
              onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
              placeholder="$HOME/Mail/spam"
            />
          </Labeled>
          <Labeled label={t("integrations.mail.procmail.flags", "Flags")}>
            <input
              className={field}
              value={form.flags}
              onChange={(e) => setForm((f) => ({ ...f, flags: e.target.value }))}
              placeholder="HB"
            />
          </Labeled>
          <Labeled label={t("integrations.mail.procmail.lockfile", "Lockfile")}>
            <input
              className={field}
              value={form.lockfile}
              onChange={(e) => setForm((f) => ({ ...f, lockfile: e.target.value }))}
            />
          </Labeled>
          <Labeled label={t("integrations.mail.procmail.comment", "Comment")}>
            <input
              className={field}
              value={form.comment}
              onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
            />
          </Labeled>
        </div>
        <button
          className={`${btn} mt-2`}
          onClick={create}
          disabled={mgr.isLoading || !form.action}
        >
          {t("integrations.mail.procmail.create", "Create")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(
            "integrations.mail.procmail.testRecipe",
            "Test against a message (dry run)",
          )}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={5}
          value={testBody}
          onChange={(e) => setTestBody(e.target.value)}
          placeholder={"From: someone@example.com\nSubject: hi\n\nbody"}
        />
        <button
          className={`${btn} mt-2`}
          onClick={runTest}
          disabled={mgr.isLoading || !testBody}
        >
          {t("integrations.mail.procmail.test", "Test")}
        </button>
        <JsonView value={testResult} />
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Rules section ───────────────────────────────────────────────────────────

const RulesSection: React.FC<{
  mgr: ProcmailManager;
  cid: string;
  user: string;
}> = ({ mgr, cid, user }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProcmailRule[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({ name: "", description: "", priority: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listRules(cid, user)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (ruleId: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getRule(cid, user, ruleId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user],
  );

  const create = useCallback(async () => {
    if (!form.name) return;
    try {
      await mgr.run(() =>
        mgr.api.createRule(cid, user, {
          name: form.name,
          description: form.description || undefined,
          recipes: [],
          priority: form.priority ? Number(form.priority) : undefined,
        }),
      );
      setForm({ name: "", description: "", priority: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, form, refresh]);

  const toggle = useCallback(
    async (r: ProcmailRule) => {
      try {
        await mgr.run(() =>
          r.enabled
            ? mgr.api.disableRule(cid, user, r.id)
            : mgr.api.enableRule(cid, user, r.id),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh],
  );

  const rename = useCallback(
    async (r: ProcmailRule) => {
      const name = window.prompt(
        t("integrations.mail.procmail.renameRule", "New rule name"),
        r.name,
      );
      if (name == null || name === r.name) return;
      try {
        await mgr.run(() => mgr.api.updateRule(cid, user, r.id, { name }));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh, t],
  );

  const remove = useCallback(
    async (ruleId: string) => {
      if (
        !window.confirm(
          t("integrations.mail.procmail.deleteRuleConfirm", "Delete this rule?"),
        )
      )
        return;
      try {
        await mgr.run(() => mgr.api.deleteRule(cid, user, ruleId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.procmail.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.name", "Name")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.priority", "Priority")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.recipes", "Recipes")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.enabled", "Enabled")}
              </th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{r.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.priority}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.recipes.length}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.enabled ? "✓" : "—"}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(r.id)}>
                      {t("integrations.mail.procmail.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void rename(r)}>
                      {t("integrations.mail.procmail.rename", "Rename")}
                    </button>
                    <button className={btn} onClick={() => void toggle(r)}>
                      {r.enabled
                        ? t("integrations.mail.procmail.disable", "Disable")
                        : t("integrations.mail.procmail.enable", "Enable")}
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
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={5}
                >
                  {t("integrations.mail.procmail.noRules", "No rules")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.procmail.createRule", "Create rule")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Labeled label={t("integrations.mail.procmail.name", "Name")}>
            <input
              className={field}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Labeled>
          <Labeled
            label={t("integrations.mail.procmail.description", "Description")}
          >
            <input
              className={field}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </Labeled>
          <Labeled label={t("integrations.mail.procmail.priority", "Priority")}>
            <input
              className={field}
              inputMode="numeric"
              value={form.priority}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: e.target.value }))
              }
            />
          </Labeled>
        </div>
        <button
          className={`${btn} mt-2`}
          onClick={create}
          disabled={mgr.isLoading || !form.name}
        >
          {t("integrations.mail.procmail.create", "Create")}
        </button>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Variables section ───────────────────────────────────────────────────────

const VariablesSection: React.FC<{
  mgr: ProcmailManager;
  cid: string;
  user: string;
}> = ({ mgr, cid, user }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProcmailVariable[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({ name: "", value: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listVariables(cid, user)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getVariable(cid, user, name)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user],
  );

  const save = useCallback(async () => {
    if (!form.name) return;
    try {
      await mgr.run(() =>
        mgr.api.setVariable(cid, user, form.name, form.value),
      );
      setForm({ name: "", value: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, form, refresh]);

  const remove = useCallback(
    async (name: string) => {
      try {
        await mgr.run(() => mgr.api.deleteVariable(cid, user, name));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.procmail.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.name", "Name")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.value", "Value")}
              </th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                  {v.name}
                </td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                  {v.value}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(v.name)}>
                      {t("integrations.mail.procmail.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={() =>
                        setForm({ name: v.name, value: v.value })
                      }
                    >
                      {t("integrations.mail.procmail.edit", "Edit")}
                    </button>
                    <button className={btn} onClick={() => void remove(v.name)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={3}
                >
                  {t("integrations.mail.procmail.noVariables", "No variables")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.procmail.setVariable", "Set variable")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.mail.procmail.name", "Name")}>
            <input
              className={field}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="MAILDIR"
            />
          </Labeled>
          <Labeled label={t("integrations.mail.procmail.value", "Value")}>
            <input
              className={field}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder="$HOME/Mail"
            />
          </Labeled>
        </div>
        <button
          className={`${btn} mt-2`}
          onClick={save}
          disabled={mgr.isLoading || !form.name}
        >
          {t("integrations.mail.procmail.save", "Save")}
        </button>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Includes section ────────────────────────────────────────────────────────

const IncludesSection: React.FC<{
  mgr: ProcmailManager;
  cid: string;
  user: string;
}> = ({ mgr, cid, user }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProcmailInclude[]>([]);
  const [path, setPath] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listIncludes(cid, user)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async () => {
    if (!path) return;
    try {
      await mgr.run(() => mgr.api.addInclude(cid, user, path));
      setPath("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, path, refresh]);

  const toggle = useCallback(
    async (inc: ProcmailInclude) => {
      try {
        await mgr.run(() =>
          inc.enabled
            ? mgr.api.disableInclude(cid, user, inc.path)
            : mgr.api.enableInclude(cid, user, inc.path),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh],
  );

  const remove = useCallback(
    async (p: string) => {
      try {
        await mgr.run(() => mgr.api.removeInclude(cid, user, p));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, user, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.procmail.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.path", "Path")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.enabled", "Enabled")}
              </th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((inc) => (
              <tr key={inc.path} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                  {inc.path}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {inc.enabled ? "✓" : "—"}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void toggle(inc)}>
                      {inc.enabled
                        ? t("integrations.mail.procmail.disable", "Disable")
                        : t("integrations.mail.procmail.enable", "Enable")}
                    </button>
                    <button className={btn} onClick={() => void remove(inc.path)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={3}
                >
                  {t("integrations.mail.procmail.noIncludes", "No includes")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.procmail.addInclude", "Add include (INCLUDERC)")}
        </h4>
        <div className="flex items-end gap-2">
          <Labeled label={t("integrations.mail.procmail.path", "Path")}>
            <input
              className={field}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="$HOME/.procmailrc.d/spam.rc"
            />
          </Labeled>
          <button
            className={btn}
            onClick={add}
            disabled={mgr.isLoading || !path}
          >
            {t("integrations.mail.procmail.add", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Config section ──────────────────────────────────────────────────────────

const ConfigSection: React.FC<{
  mgr: ProcmailManager;
  cid: string;
  user: string;
}> = ({ mgr, cid, user }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<unknown>(null);
  const [configBody, setConfigBody] = useState("");
  const [rawBody, setRawBody] = useState("");
  const [validateBody, setValidateBody] = useState("");
  const [restoreBody, setRestoreBody] = useState("");

  const invalidJson = () =>
    window.alert(t("integrations.mail.procmail.invalidJson", "Invalid JSON"));

  const getConfig = useCallback(async () => {
    try {
      const cfg = await mgr.run(() => mgr.api.getConfig(cid, user));
      setDetail(cfg);
      setConfigBody(JSON.stringify(cfg, null, 2));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  const setConfig = useCallback(async () => {
    const cfg = parseJson<ProcmailConfig>(configBody, invalidJson);
    if (cfg === undefined) return;
    try {
      await mgr.run(() => mgr.api.setConfig(cid, user, cfg));
      setDetail({ ok: true });
    } catch {
      /* surfaced */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr, cid, user, configBody]);

  const getRaw = useCallback(async () => {
    try {
      const raw = await mgr.run(() => mgr.api.getRawConfig(cid, user));
      setRawBody(raw);
      setDetail(null);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  const setRaw = useCallback(async () => {
    try {
      await mgr.run(() => mgr.api.setRawConfig(cid, user, rawBody));
      setDetail({ ok: true });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, rawBody]);

  const backup = useCallback(async () => {
    try {
      const content = await mgr.run(() => mgr.api.backupConfig(cid, user));
      setRestoreBody(content);
      setDetail({ backedUp: content.length });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  const restore = useCallback(async () => {
    if (
      !window.confirm(
        t(
          "integrations.mail.procmail.restoreConfirm",
          "Restore this procmailrc, overwriting the current one?",
        ),
      )
    )
      return;
    try {
      await mgr.run(() => mgr.api.restoreConfig(cid, user, restoreBody));
      setDetail({ restored: true });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, restoreBody, t]);

  const validate = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.validateConfig(cid, user, validateBody)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, validateBody]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={getConfig} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.procmail.getConfig", "Load config")}
        </button>
        <button className={btn} onClick={getRaw} disabled={mgr.isLoading}>
          {t("integrations.mail.procmail.getRaw", "Load raw")}
        </button>
        <button className={btn} onClick={backup} disabled={mgr.isLoading}>
          {t("integrations.mail.procmail.backup", "Backup")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(
            "integrations.mail.procmail.structuredConfig",
            "Structured config (JSON — recipes / variables / includes)",
          )}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={6}
          value={configBody}
          onChange={(e) => setConfigBody(e.target.value)}
          placeholder='{"recipes":[],"variables":[],"includes":[],"raw_content":""}'
        />
        <button
          className={`${btn} mt-2`}
          onClick={setConfig}
          disabled={mgr.isLoading || !configBody}
        >
          {t("integrations.mail.procmail.setConfig", "Save config")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.procmail.rawConfig", "Raw procmailrc")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={8}
          value={rawBody}
          onChange={(e) => setRawBody(e.target.value)}
        />
        <button
          className={`${btn} mt-2`}
          onClick={setRaw}
          disabled={mgr.isLoading}
        >
          {t("integrations.mail.procmail.setRaw", "Save raw")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.procmail.validate", "Validate config text")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={5}
          value={validateBody}
          onChange={(e) => setValidateBody(e.target.value)}
        />
        <button
          className={`${btn} mt-2`}
          onClick={validate}
          disabled={mgr.isLoading || !validateBody}
        >
          {t("integrations.mail.procmail.validateBtn", "Validate")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t(
            "integrations.mail.procmail.restore",
            "Restore procmailrc from backup",
          )}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={6}
          value={restoreBody}
          onChange={(e) => setRestoreBody(e.target.value)}
        />
        <button
          className={`${btn} mt-2 text-red-500`}
          onClick={restore}
          disabled={mgr.isLoading || !restoreBody}
        >
          {t("integrations.mail.procmail.restoreBtn", "Restore")}
        </button>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Logs section ────────────────────────────────────────────────────────────

const LogsSection: React.FC<{
  mgr: ProcmailManager;
  cid: string;
  user: string;
}> = ({ mgr, cid, user }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProcmailLogEntry[]>([]);
  const [lines, setLines] = useState("100");
  const [filter, setFilter] = useState("");
  const [files, setFiles] = useState<string[] | null>(null);
  const [logPath, setLogPath] = useState("");

  const query = useCallback(async () => {
    try {
      setRows(
        await mgr.run(() =>
          mgr.api.queryLog(
            cid,
            user,
            lines ? Number(lines) : undefined,
            filter || undefined,
          ),
        ),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, lines, filter]);

  useEffect(() => {
    void query();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, user]);

  const loadFiles = useCallback(async () => {
    try {
      setFiles(await mgr.run(() => mgr.api.listLogFiles(cid, user)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  const loadPath = useCallback(async () => {
    try {
      setLogPath(await mgr.run(() => mgr.api.getLogPath(cid, user)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user]);

  useEffect(() => {
    void loadPath();
  }, [loadPath]);

  const savePath = useCallback(async () => {
    try {
      await mgr.run(() => mgr.api.setLogPath(cid, user, logPath));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, logPath]);

  const clear = useCallback(async () => {
    if (
      !window.confirm(
        t("integrations.mail.procmail.clearLogConfirm", "Clear the procmail log?"),
      )
    )
      return;
    try {
      await mgr.run(() => mgr.api.clearLog(cid, user));
      setRows([]);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, user, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label={t("integrations.mail.procmail.lines", "Lines")}>
          <input
            className={field}
            style={{ width: 90 }}
            inputMode="numeric"
            value={lines}
            onChange={(e) => setLines(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.mail.procmail.filter", "Filter")}>
          <input
            className={field}
            style={{ width: 200 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </Labeled>
        <button className={btn} onClick={query} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.procmail.query", "Query")}
        </button>
        <button className={btn} onClick={loadFiles} disabled={mgr.isLoading}>
          {t("integrations.mail.procmail.listLogFiles", "Log files")}
        </button>
        <button
          className={`${btn} text-red-500`}
          onClick={clear}
          disabled={mgr.isLoading}
        >
          <Trash2 size={12} />
          {t("integrations.mail.procmail.clearLog", "Clear log")}
        </button>
      </div>

      {files && (
        <div className={card}>
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.mail.procmail.listLogFiles", "Log files")}:{" "}
          </span>
          <span className="font-mono text-xs text-[var(--color-text)]">
            {files.length ? files.join(", ") : "—"}
          </span>
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.procmail.logPath", "Active log path")}
        </h4>
        <div className="flex items-end gap-2">
          <input
            className={field}
            value={logPath}
            onChange={(e) => setLogPath(e.target.value)}
            placeholder="/var/log/procmail.log"
          />
          <button className={btn} onClick={loadPath} disabled={mgr.isLoading}>
            {t("integrations.mail.procmail.reload", "Reload")}
          </button>
          <button
            className={btn}
            onClick={savePath}
            disabled={mgr.isLoading || !logPath}
          >
            {t("integrations.mail.procmail.save", "Save")}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.time", "Time")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.from", "From")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.folder", "Folder")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.subject", "Subject")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mail.procmail.result", "Result")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.timestamp ?? "—"}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.from_address ?? "—"}
                </td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                  {r.to_folder ?? "—"}
                </td>
                <td className="px-2 py-1 text-[var(--color-text)]">
                  {r.subject ?? "—"}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.result ?? "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={5}
                >
                  {t("integrations.mail.procmail.noLogs", "No log entries")}
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
  {
    key: "recipes",
    labelKey: "integrations.mail.procmail.sectionRecipes",
    labelDefault: "Recipes",
    icon: ListTree,
  },
  {
    key: "rules",
    labelKey: "integrations.mail.procmail.sectionRules",
    labelDefault: "Rules",
    icon: Filter,
  },
  {
    key: "variables",
    labelKey: "integrations.mail.procmail.sectionVariables",
    labelDefault: "Variables",
    icon: Variable,
  },
  {
    key: "includes",
    labelKey: "integrations.mail.procmail.sectionIncludes",
    labelDefault: "Includes",
    icon: FolderInput,
  },
  {
    key: "config",
    labelKey: "integrations.mail.procmail.sectionConfig",
    labelDefault: "Config",
    icon: FileCog,
  },
  {
    key: "logs",
    labelKey: "integrations.mail.procmail.sectionLogs",
    labelDefault: "Logs",
    icon: ScrollText,
  },
];

const ProcmailSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const mgr = useProcmail();
  const [section, setSection] = useState<SectionKey>("recipes");
  const [user, setUser] = useState("root");
  const [connections, setConnections] = useState<string[] | null>(null);

  const cid = mgr.connectionId;

  const listConnections = () =>
    void mgr
      .run(() => mgr.api.listConnections())
      .then(setConnections)
      .catch(() => {});

  return (
    <div className="flex h-full flex-col overflow-y-auto p-1">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <FileText className="h-4 w-4 text-primary" />
          {t("integrations.mail.procmail.title", "Procmail (delivery)")}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
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
              ? (mgr.summary?.host ??
                t("integrations.mail.procmail.connected", "Connected"))
              : t("integrations.mail.procmail.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">
              v{mgr.summary.version}
            </span>
          )}
          {mgr.isConnected && (
            <>
              <button className={btn} onClick={listConnections}>
                {t(
                  "integrations.mail.procmail.listConnections",
                  "Active connections",
                )}
              </button>
              <button className={btn} onClick={() => void mgr.disconnect()}>
                {t("integrations.mail.procmail.disconnect", "Disconnect")}
              </button>
            </>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {connections && mgr.isConnected && (
        <div className={`${card} mb-3`}>
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.mail.procmail.listConnections", "Active connections")}
            :{" "}
          </span>
          <span className="font-mono text-xs text-[var(--color-text)]">
            {connections.length ? connections.join(", ") : "—"}
          </span>
        </div>
      )}

      {!mgr.isConnected || !cid ? (
        <ConnectForm mgr={mgr} onUserChange={setUser} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
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
            <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.mail.procmail.user", "User")}
              <input
                className={`${field} w-32`}
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="root"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1">
            {section === "recipes" && (
              <RecipesSection mgr={mgr} cid={cid} user={user} />
            )}
            {section === "rules" && (
              <RulesSection mgr={mgr} cid={cid} user={user} />
            )}
            {section === "variables" && (
              <VariablesSection mgr={mgr} cid={cid} user={user} />
            )}
            {section === "includes" && (
              <IncludesSection mgr={mgr} cid={cid} user={user} />
            )}
            {section === "config" && (
              <ConfigSection mgr={mgr} cid={cid} user={user} />
            )}
            {section === "logs" && (
              <LogsSection mgr={mgr} cid={cid} user={user} />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ProcmailSubTab;
