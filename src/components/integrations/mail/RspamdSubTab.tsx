// Rspamd (spam filter) sub-tab for the unified Mail Server panel (t42 Wave M,
// crate `sorng-rspamd`).
//
// Self-contained mini-panel: owns its own connect form (rspamd talks to its HTTP
// controller — base_url + optional controller password, NOT SSH), connection
// lifecycle, persistence (`useIntegrationConfigStore`, key "mail.rspamd"), and a
// grouped management surface that exercises all 44 `rspamd_*` commands via
// `useRspamd()`. No `connectionId` is passed in — this tab connects itself.

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Cpu,
  History as HistoryIcon,
  Loader2,
  Map as MapIcon,
  Plug,
  PlugZap,
  Puzzle,
  RefreshCw,
  ScanLine,
  Shield,
  Tags,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRspamd, type RspamdManager } from "../../../hooks/integration/mail/useRspamd";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import type { MailSubTabProps } from "./registry";
import type {
  RspamdAction,
  RspamdHistoryEntry,
  RspamdMap,
  RspamdPlugin,
  RspamdScanResult,
  RspamdSymbol,
  RspamdSymbolGroup,
  RspamdWorker,
} from "../../../types/mail/rspamd";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

const INTEGRATION_KEY = "mail.rspamd";

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

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  baseUrl: string;
  password: string;
  timeoutSecs: string;
  tlsSkipVerify: boolean;
  name: string;
}

const emptyConnect: ConnectState = {
  baseUrl: "http://localhost:11334",
  password: "",
  timeoutSecs: "30",
  tlsSkipVerify: false,
  name: "",
};

const ConnectForm: React.FC<{
  mgr: RspamdManager;
  onConnected: (id: string) => void;
}> = ({ mgr, onConnected }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(undefined);

  // Prefill from the first persisted rspamd instance (host/fields + vault secret).
  useEffect(() => {
    if (store.isLoading) return;
    const inst = store.instancesFor(INTEGRATION_KEY)[0];
    if (!inst) return;
    setSavedId(inst.id);
    setForm((f) => ({
      ...f,
      name: inst.name,
      baseUrl: inst.host ?? f.baseUrl,
      timeoutSecs: inst.fields?.timeoutSecs ?? f.timeoutSecs,
      tlsSkipVerify: inst.fields?.tlsSkipVerify === "true",
    }));
    store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, password: secret }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? generateId();
    const ok = await mgr.connect(id, {
      base_url: form.baseUrl.trim(),
      password: form.password || undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
      tls_skip_verify: form.tlsSkipVerify,
    });
    if (ok) onConnected(id);
  }, [mgr, form, savedId, onConnected]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      timeoutSecs: form.timeoutSecs,
      tlsSkipVerify: String(form.tlsSkipVerify),
    };
    const secret = form.password || undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.baseUrl,
        host: form.baseUrl,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: INTEGRATION_KEY,
        name: form.name || form.baseUrl,
        host: form.baseUrl,
        fields,
        secret,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.mail.rspamd.baseUrl", "Controller URL")}>
          <input
            className={field}
            value={form.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder="http://localhost:11334"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.rspamd.password", "Controller password")}
        >
          <input
            className={field}
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder={t("integrations.mail.rspamd.optional", "optional")}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.rspamd.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.rspamd.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.baseUrl}
          />
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.tlsSkipVerify}
            onChange={(e) => set("tlsSkipVerify", e.target.checked)}
          />
          {t(
            "integrations.mail.rspamd.tlsSkipVerify",
            "Skip TLS certificate verification",
          )}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isConnecting || !form.baseUrl}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.mail.rspamd.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.baseUrl}>
          {t("integrations.mail.rspamd.save", "Save instance")}
        </button>
      </div>
      {mgr.error && (
        <p className="mt-2 text-xs text-red-500">{mgr.error}</p>
      )}
    </div>
  );
};

// ─── Scanning & learning section ─────────────────────────────────────────────

const ScanSection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fuzzyFlag, setFuzzyFlag] = useState("1");
  const [fuzzyWeight, setFuzzyWeight] = useState("10");
  const [result, setResult] = useState<RspamdScanResult | null>(null);
  const [detail, setDetail] = useState<unknown>(null);

  const checkMessage = useCallback(async () => {
    if (!message) return;
    try {
      setResult(await mgr.run(() => mgr.api.checkMessage(cid, message)));
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr, cid, message]);

  const checkFile = useCallback(async () => {
    if (!filePath) return;
    try {
      setResult(await mgr.run(() => mgr.api.checkFile(cid, filePath)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, filePath]);

  const learn = useCallback(
    async (spam: boolean) => {
      if (!message) return;
      try {
        const r = await mgr.run(() =>
          spam
            ? mgr.api.learnSpam(cid, message)
            : mgr.api.learnHam(cid, message),
        );
        setDetail(r);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, message],
  );

  const fuzzyAdd = useCallback(async () => {
    if (!message) return;
    try {
      await mgr.run(() =>
        mgr.api.fuzzyAdd(cid, message, Number(fuzzyFlag), Number(fuzzyWeight)),
      );
      setDetail({ ok: true, op: "fuzzy_add" });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, message, fuzzyFlag, fuzzyWeight]);

  const fuzzyDelete = useCallback(async () => {
    if (!message) return;
    try {
      await mgr.run(() => mgr.api.fuzzyDelete(cid, message, Number(fuzzyFlag)));
      setDetail({ ok: true, op: "fuzzy_delete" });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, message, fuzzyFlag]);

  const fuzzyCheck = useCallback(async () => {
    if (!message) return;
    try {
      setDetail(await mgr.run(() => mgr.api.fuzzyCheck(cid, message)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, message]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.rspamd.rawMessage", "Raw message (RFC 822)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t(
            "integrations.mail.rspamd.messagePlaceholder",
            "Paste a full raw email to scan, learn, or fuzzy-train...",
          )}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={checkMessage} disabled={mgr.isLoading || !message}>
            <ScanLine size={12} />
            {t("integrations.mail.rspamd.checkMessage", "Scan")}
          </button>
          <button className={btn} onClick={() => learn(true)} disabled={mgr.isLoading || !message}>
            {t("integrations.mail.rspamd.learnSpam", "Learn spam")}
          </button>
          <button className={btn} onClick={() => learn(false)} disabled={mgr.isLoading || !message}>
            {t("integrations.mail.rspamd.learnHam", "Learn ham")}
          </button>
          <button className={btn} onClick={fuzzyCheck} disabled={mgr.isLoading || !message}>
            {t("integrations.mail.rspamd.fuzzyCheck", "Fuzzy check")}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Labeled label={t("integrations.mail.rspamd.flag", "Flag")}>
            <input
              className={field}
              style={{ width: 80 }}
              inputMode="numeric"
              value={fuzzyFlag}
              onChange={(e) => setFuzzyFlag(e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.mail.rspamd.weight", "Weight")}>
            <input
              className={field}
              style={{ width: 80 }}
              inputMode="numeric"
              value={fuzzyWeight}
              onChange={(e) => setFuzzyWeight(e.target.value)}
            />
          </Labeled>
          <button className={btn} onClick={fuzzyAdd} disabled={mgr.isLoading || !message}>
            {t("integrations.mail.rspamd.fuzzyAdd", "Fuzzy add")}
          </button>
          <button className={btn} onClick={fuzzyDelete} disabled={mgr.isLoading || !message}>
            {t("integrations.mail.rspamd.fuzzyDelete", "Fuzzy delete")}
          </button>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.rspamd.scanFile", "Scan server-side file")}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={field}
            style={{ width: 320 }}
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="/var/spool/mail/sample.eml"
          />
          <button className={btn} onClick={checkFile} disabled={mgr.isLoading || !filePath}>
            <ScanLine size={12} />
            {t("integrations.mail.rspamd.checkFile", "Scan file")}
          </button>
        </div>
      </div>

      {result && (
        <div className={card}>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span
              className={
                result.is_spam ? "font-semibold text-red-500" : "font-semibold text-green-500"
              }
            >
              {result.action}
            </span>
            <span className="text-[var(--color-textSecondary)]">
              {t("integrations.mail.rspamd.score", "Score")}: {result.score.toFixed(2)} /{" "}
              {result.required_score.toFixed(2)}
            </span>
            {result.subject && (
              <span className="text-[var(--color-textSecondary)]">{result.subject}</span>
            )}
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--color-textMuted)]">
                <tr>
                  <th className="px-2 py-1">{t("integrations.mail.rspamd.symbol", "Symbol")}</th>
                  <th className="px-2 py-1">{t("integrations.mail.rspamd.score", "Score")}</th>
                  <th className="px-2 py-1">{t("integrations.mail.rspamd.options", "Options")}</th>
                </tr>
              </thead>
              <tbody>
                {result.symbols.map((s) => (
                  <tr key={s.name} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                    <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                      {s.score.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                      {s.options.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <JsonView value={detail} />
    </div>
  );
};

// ─── Statistics section ──────────────────────────────────────────────────────

const StatsSection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<unknown>(null);
  const [graphType, setGraphType] = useState("hourly");
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setStats(await mgr.run(() => mgr.api.getStats(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const graph = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.getGraph(cid, graphType)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, graphType]);

  const throughput = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.getThroughput(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const errors = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.getErrors(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const reset = useCallback(async () => {
    if (!window.confirm(t("integrations.mail.rspamd.resetStatsConfirm", "Reset all statistics?")))
      return;
    try {
      await mgr.run(() => mgr.api.resetStats(cid));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, refresh, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.rspamd.refresh", "Refresh")}
        </button>
        <select
          className={field}
          style={{ width: 120 }}
          value={graphType}
          onChange={(e) => setGraphType(e.target.value)}
        >
          <option value="hourly">{t("integrations.mail.rspamd.hourly", "Hourly")}</option>
          <option value="daily">{t("integrations.mail.rspamd.daily", "Daily")}</option>
          <option value="weekly">{t("integrations.mail.rspamd.weekly", "Weekly")}</option>
          <option value="monthly">{t("integrations.mail.rspamd.monthly", "Monthly")}</option>
        </select>
        <button className={btn} onClick={graph} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.graph", "Graph")}
        </button>
        <button className={btn} onClick={throughput} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.throughput", "Throughput")}
        </button>
        <button className={btn} onClick={errors} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.errors", "Errors")}
        </button>
        <button className={btn} onClick={reset} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.resetStats", "Reset stats")}
        </button>
      </div>
      <JsonView value={stats} />
      <JsonView value={detail} />
    </div>
  );
};

// ─── Symbols section ─────────────────────────────────────────────────────────

const SymbolsSection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [symbols, setSymbols] = useState<RspamdSymbol[]>([]);
  const [groups, setGroups] = useState<RspamdSymbolGroup[]>([]);
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
        safe(mgr.api.listSymbols(cid), setSymbols),
        safe(mgr.api.listSymbolGroups(cid), setGroups),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const viewSymbol = useCallback(
    async (name: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getSymbol(cid, name)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const viewGroup = useCallback(
    async (name: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getSymbolGroup(cid, name)));
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
        {t("integrations.mail.rspamd.refresh", "Refresh")}
      </button>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.name}
            className={btn}
            onClick={() => viewGroup(g.name)}
            title={g.description ?? undefined}
          >
            {g.name} ({g.symbols.length})
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.symbol", "Symbol")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.group", "Group")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.weight", "Weight")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => (
              <tr key={s.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{s.group ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {s.weight ?? s.score ?? "—"}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    <button className={btn} onClick={() => viewSymbol(s.name)}>
                      {t("integrations.mail.rspamd.view", "View")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {symbols.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.rspamd.noSymbols", "No symbols")}
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

// ─── Actions section ─────────────────────────────────────────────────────────

const ActionsSection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [actions, setActions] = useState<RspamdAction[]>([]);
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await mgr.run(() => mgr.api.listActions(cid));
      setActions(rows);
      setThresholds(
        Object.fromEntries(rows.map((a) => [a.name, a.threshold?.toString() ?? ""])),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (name: string) => {
      const raw = thresholds[name];
      if (raw == null || raw === "") return;
      try {
        await mgr.run(() => mgr.api.setAction(cid, name, Number(raw)));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, thresholds, refresh],
  );

  const toggle = useCallback(
    async (a: RspamdAction) => {
      try {
        await mgr.run(() =>
          a.enabled
            ? mgr.api.disableAction(cid, a.name)
            : mgr.api.enableAction(cid, a.name),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const viewConfig = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.getActionsConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const saveConfig = useCallback(async () => {
    try {
      await mgr.run(() => mgr.api.saveActionsConfig(cid, actions));
      setDetail({ ok: true, op: "save_actions_config" });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, actions]);

  const viewAction = useCallback(
    async (name: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getAction(cid, name)));
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
          {t("integrations.mail.rspamd.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={viewConfig} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.actionsConfig", "View config")}
        </button>
        <button className={btn} onClick={saveConfig} disabled={mgr.isLoading || actions.length === 0}>
          {t("integrations.mail.rspamd.saveActionsConfig", "Save config")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.action", "Action")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.threshold", "Threshold")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.enabled", "Enabled")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{a.name}</td>
                <td className="px-2 py-1">
                  <input
                    className={field}
                    style={{ width: 90 }}
                    inputMode="numeric"
                    value={thresholds[a.name] ?? ""}
                    onChange={(e) =>
                      setThresholds((m) => ({ ...m, [a.name]: e.target.value }))
                    }
                  />
                </td>
                <td className="px-2 py-1">
                  <span className={a.enabled ? "text-green-500" : "text-[var(--color-textMuted)]"}>
                    {a.enabled
                      ? t("integrations.mail.rspamd.yes", "Yes")
                      : t("integrations.mail.rspamd.no", "No")}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => save(a.name)} disabled={mgr.isLoading}>
                      {t("integrations.mail.rspamd.setThreshold", "Set")}
                    </button>
                    <button className={btn} onClick={() => toggle(a)} disabled={mgr.isLoading}>
                      {a.enabled
                        ? t("integrations.mail.rspamd.disable", "Disable")
                        : t("integrations.mail.rspamd.enable", "Enable")}
                    </button>
                    <button className={btn} onClick={() => viewAction(a.name)}>
                      {t("integrations.mail.rspamd.view", "View")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {actions.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.rspamd.noActions", "No actions")}
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

// ─── Maps section ────────────────────────────────────────────────────────────

const MapsSection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [maps, setMaps] = useState<RspamdMap[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [entryKey, setEntryKey] = useState("");
  const [entryValue, setEntryValue] = useState("");
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setMaps(await mgr.run(() => mgr.api.listMaps(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (mapId: number) => {
      setSelected(mapId);
      try {
        const [map, entries] = await mgr.run(() =>
          Promise.all([mgr.api.getMap(cid, mapId), mgr.api.getMapEntries(cid, mapId)]),
        );
        setDetail(map);
        setContent(
          entries
            .map((e) => (e.value != null ? `${e.key} ${e.value}` : e.key))
            .join("\n"),
        );
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const save = useCallback(async () => {
    if (selected == null) return;
    try {
      await mgr.run(() => mgr.api.saveMapEntries(cid, selected, content));
      await open(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, content, open]);

  const addEntry = useCallback(async () => {
    if (selected == null || !entryKey) return;
    try {
      await mgr.run(() =>
        mgr.api.addMapEntry(cid, selected, entryKey, entryValue || undefined),
      );
      setEntryKey("");
      setEntryValue("");
      await open(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, entryKey, entryValue, open]);

  const removeEntry = useCallback(async () => {
    if (selected == null || !entryKey) return;
    try {
      await mgr.run(() => mgr.api.removeMapEntry(cid, selected, entryKey));
      setEntryKey("");
      await open(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, entryKey, open]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.rspamd.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.uri", "URI")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.type", "Type")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.entries", "Entries")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {maps.map((m) => (
              <tr key={m.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">{m.uri}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{m.map_type ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {m.entries_count ?? "—"}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    <button className={btn} onClick={() => open(m.id)}>
                      {t("integrations.mail.rspamd.edit", "Edit")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {maps.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.rspamd.noMaps", "No maps")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected != null && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.mail.rspamd.mapContent", "Map content")} (#{selected})
          </h4>
          <textarea
            className={`${field} font-mono`}
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <button className={btn} onClick={save} disabled={mgr.isLoading}>
              {t("integrations.mail.rspamd.saveMap", "Save map")}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Labeled label={t("integrations.mail.rspamd.key", "Key")}>
              <input
                className={field}
                style={{ width: 160 }}
                value={entryKey}
                onChange={(e) => setEntryKey(e.target.value)}
              />
            </Labeled>
            <Labeled label={t("integrations.mail.rspamd.value", "Value")}>
              <input
                className={field}
                style={{ width: 160 }}
                value={entryValue}
                onChange={(e) => setEntryValue(e.target.value)}
              />
            </Labeled>
            <button className={btn} onClick={addEntry} disabled={mgr.isLoading || !entryKey}>
              {t("integrations.mail.rspamd.addEntry", "Add entry")}
            </button>
            <button className={btn} onClick={removeEntry} disabled={mgr.isLoading || !entryKey}>
              {t("integrations.mail.rspamd.removeEntry", "Remove entry")}
            </button>
          </div>
        </div>
      )}
      <JsonView value={detail} />
    </div>
  );
};

// ─── History section ─────────────────────────────────────────────────────────

const HistorySection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RspamdHistoryEntry[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const h = await mgr.run(() => mgr.api.getHistory(cid, 100, 0));
      setRows(h.rows);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (entryId: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getHistoryEntry(cid, entryId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const reset = useCallback(async () => {
    if (!window.confirm(t("integrations.mail.rspamd.resetHistoryConfirm", "Reset scan history?")))
      return;
    try {
      await mgr.run(() => mgr.api.resetHistory(cid));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, refresh, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.rspamd.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={reset} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.resetHistory", "Reset history")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.action", "Action")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.score", "Score")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.ip", "IP")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.subject", "Subject")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{r.action ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {r.score != null ? r.score.toFixed(2) : "—"}
                </td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{r.ip ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{r.subject ?? "—"}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    <button className={btn} onClick={() => r.id && void view(r.id)} disabled={!r.id}>
                      {t("integrations.mail.rspamd.view", "View")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.mail.rspamd.noHistory", "No history")}
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

// ─── Workers & neighbours section ────────────────────────────────────────────

const WorkersSection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [workers, setWorkers] = useState<RspamdWorker[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setWorkers(await mgr.run(() => mgr.api.listWorkers(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const viewWorker = useCallback(
    async (workerId: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getWorker(cid, workerId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const neighbours = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.listNeighbours(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const fuzzyStatus = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.fuzzyStatus(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.rspamd.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={neighbours} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.neighbours", "Neighbours")}
        </button>
        <button className={btn} onClick={fuzzyStatus} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.fuzzyStatus", "Fuzzy storages")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.workerId", "Worker")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.type", "Type")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.pid", "PID")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{w.id}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{w.worker_type ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{w.pid ?? "—"}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    <button className={btn} onClick={() => viewWorker(w.id)}>
                      {t("integrations.mail.rspamd.view", "View")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {workers.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.mail.rspamd.noWorkers", "No workers")}
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

// ─── Config & plugins section ────────────────────────────────────────────────

const ConfigSection: React.FC<{ mgr: RspamdManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<RspamdPlugin[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setPlugins(await mgr.run(() => mgr.api.getPlugins(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (p: RspamdPlugin) => {
      try {
        await mgr.run(() =>
          p.enabled
            ? mgr.api.disablePlugin(cid, p.name)
            : mgr.api.enablePlugin(cid, p.name),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const reload = useCallback(async () => {
    if (!window.confirm(t("integrations.mail.rspamd.reloadConfirm", "Reload Rspamd configuration?")))
      return;
    try {
      await mgr.run(() => mgr.api.reloadConfig(cid));
      setDetail({ ok: true, op: "reload_config" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, refresh, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.rspamd.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={reload} disabled={mgr.isLoading}>
          {t("integrations.mail.rspamd.reloadConfig", "Reload config")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.plugin", "Plugin")}</th>
              <th className="px-2 py-1">{t("integrations.mail.rspamd.enabled", "Enabled")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {plugins.map((p) => (
              <tr key={p.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]" title={p.description ?? undefined}>
                  {p.name}
                </td>
                <td className="px-2 py-1">
                  <span className={p.enabled ? "text-green-500" : "text-[var(--color-textMuted)]"}>
                    {p.enabled
                      ? t("integrations.mail.rspamd.yes", "Yes")
                      : t("integrations.mail.rspamd.no", "No")}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    <button className={btn} onClick={() => toggle(p)} disabled={mgr.isLoading}>
                      {p.enabled
                        ? t("integrations.mail.rspamd.disable", "Disable")
                        : t("integrations.mail.rspamd.enable", "Enable")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {plugins.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.mail.rspamd.noPlugins", "No plugins")}
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

// ─── Section nav ─────────────────────────────────────────────────────────────

type SectionKey =
  | "scan"
  | "stats"
  | "symbols"
  | "actions"
  | "maps"
  | "history"
  | "workers"
  | "config";

const SECTIONS: {
  key: SectionKey;
  icon: typeof ScanLine;
  labelKey: string;
  fallback: string;
}[] = [
  { key: "scan", icon: ScanLine, labelKey: "integrations.mail.rspamd.tabScan", fallback: "Scan & learn" },
  { key: "stats", icon: BarChart3, labelKey: "integrations.mail.rspamd.tabStats", fallback: "Statistics" },
  { key: "symbols", icon: Tags, labelKey: "integrations.mail.rspamd.tabSymbols", fallback: "Symbols" },
  { key: "actions", icon: Shield, labelKey: "integrations.mail.rspamd.tabActions", fallback: "Actions" },
  { key: "maps", icon: MapIcon, labelKey: "integrations.mail.rspamd.tabMaps", fallback: "Maps" },
  { key: "history", icon: HistoryIcon, labelKey: "integrations.mail.rspamd.tabHistory", fallback: "History" },
  { key: "workers", icon: Cpu, labelKey: "integrations.mail.rspamd.tabWorkers", fallback: "Workers" },
  { key: "config", icon: Puzzle, labelKey: "integrations.mail.rspamd.tabConfig", fallback: "Config & plugins" },
];

// ─── Sub-tab root ────────────────────────────────────────────────────────────

const RspamdSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const mgr = useRspamd();
  const [cid, setCid] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("scan");

  const disconnect = useCallback(async () => {
    await mgr.disconnect();
    setCid(null);
  }, [mgr]);

  if (!mgr.isConnected || !cid) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Shield size={16} />
          {t("integrations.mail.rspamd.title", "Rspamd (spam filter)")}
        </div>
        <p className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.mail.rspamd.intro",
            "Connect to the Rspamd HTTP controller to scan messages, train the classifier, and manage symbols, actions, maps and plugins.",
          )}
        </p>
        <ConnectForm mgr={mgr} onConnected={setCid} />
      </div>
    );
  }

  const activeCid = cid;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Shield size={16} />
          {t("integrations.mail.rspamd.title", "Rspamd (spam filter)")}
          {mgr.summary && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {mgr.summary.host}
              {mgr.summary.version ? ` · v${mgr.summary.version}` : ""}
              {mgr.summary.scanned != null
                ? ` · ${mgr.summary.scanned} ${t("integrations.mail.rspamd.scanned", "scanned")}`
                : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => void mgr.ping()} disabled={mgr.isLoading}>
            <Activity size={12} />
            {t("integrations.mail.rspamd.ping", "Ping")}
          </button>
          <button className={btn} onClick={disconnect}>
            <PlugZap size={12} />
            {t("integrations.mail.rspamd.disconnect", "Disconnect")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] pb-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              className={`${btn} ${
                section === s.key ? "bg-[var(--color-surface)] text-[var(--color-text)]" : ""
              }`}
              onClick={() => setSection(s.key)}
            >
              <Icon size={12} />
              {t(s.labelKey, s.fallback)}
            </button>
          );
        })}
      </div>

      {mgr.error && <p className="text-xs text-red-500">{mgr.error}</p>}

      {section === "scan" && <ScanSection mgr={mgr} cid={activeCid} />}
      {section === "stats" && <StatsSection mgr={mgr} cid={activeCid} />}
      {section === "symbols" && <SymbolsSection mgr={mgr} cid={activeCid} />}
      {section === "actions" && <ActionsSection mgr={mgr} cid={activeCid} />}
      {section === "maps" && <MapsSection mgr={mgr} cid={activeCid} />}
      {section === "history" && <HistorySection mgr={mgr} cid={activeCid} />}
      {section === "workers" && <WorkersSection mgr={mgr} cid={activeCid} />}
      {section === "config" && <ConfigSection mgr={mgr} cid={activeCid} />}
    </div>
  );
};

export default RspamdSubTab;
