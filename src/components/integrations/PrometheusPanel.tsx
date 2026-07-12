// Prometheus integration panel (t42-prometheus).
//
// Full panel for the sorng-prometheus crate — binds every one of the 22
// Prometheus commands registered in the Tauri handler through `usePrometheus()`
// / `prometheusApi`. Connect form maps to `prometheus_connect`; sub-tabs cover
// queries, targets, rules & alerts, silences and server status.
//
// NOTE: the crate's `commands.rs` defines 16 additional functions (ping,
// exemplars, active/dropped targets, target metadata, alerting/recording-group
// rules, alertmanagers, TSDB snapshot/delete/clean, get_metadata, update/expire
// silence) that are NOT registered in `sorng-commands-ops/src/ops_handler.rs`.
// They are a backend wiring gap (t42 plan R4) and are deliberately not surfaced
// here — calling them would fail at runtime.

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BellRing,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Server,
  ShieldOff,
  Tags,
  Terminal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  usePrometheus,
  type PrometheusManager,
} from "../../hooks/integration/usePrometheus";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../utils/core/id";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  Alert,
  PromTarget,
  QuerySample,
  RuleGroup,
  Silence,
  SilenceMatcher,
} from "../../types/prometheus";

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

type TabKey = "query" | "targets" | "rules" | "silences" | "status";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  useTls: boolean;
  acceptInvalidCerts: boolean;
  authMode: "none" | "basic" | "bearer";
  username: string;
  password: string;
  bearerToken: string;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "9090",
  useTls: false,
  acceptInvalidCerts: false,
  authMode: "none",
  username: "",
  password: "",
  bearerToken: "",
  timeoutSecs: "30",
  name: "",
};

const ConnectForm: React.FC<{
  mgr: PrometheusManager;
  instanceId?: string;
}> = ({ mgr, instanceId }) => {
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
      port: inst.fields?.port ?? "9090",
      useTls: inst.fields?.useTls === "true",
      acceptInvalidCerts: inst.fields?.acceptInvalidCerts === "true",
      authMode: (inst.fields?.authMode as ConnectState["authMode"]) ?? "none",
      username: inst.fields?.username ?? "",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((secret) => {
      if (!secret) return;
      setForm((f) =>
        f.authMode === "bearer"
          ? { ...f, bearerToken: secret }
          : { ...f, password: secret },
      );
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
      use_tls: form.useTls,
      accept_invalid_certs: form.acceptInvalidCerts,
      username: form.authMode === "basic" ? form.username : undefined,
      password: form.authMode === "basic" ? form.password : undefined,
      bearer_token: form.authMode === "bearer" ? form.bearerToken : undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId, instanceId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      useTls: String(form.useTls),
      acceptInvalidCerts: String(form.acceptInvalidCerts),
      authMode: form.authMode,
      username: form.username,
      timeoutSecs: form.timeoutSecs,
    };
    const secret =
      form.authMode === "bearer"
        ? form.bearerToken || undefined
        : form.authMode === "basic"
          ? form.password || undefined
          : undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "prometheus",
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
        <Labeled label={t("integrations.prometheus.host", "Host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="prometheus.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.prometheus.port", "Port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.prometheus.authMode", "Authentication")}>
          <select
            className={field}
            value={form.authMode}
            onChange={(e) =>
              set("authMode", e.target.value as ConnectState["authMode"])
            }
          >
            <option value="none">
              {t("integrations.prometheus.authNone", "None")}
            </option>
            <option value="basic">
              {t("integrations.prometheus.authBasic", "Basic (user / password)")}
            </option>
            <option value="bearer">
              {t("integrations.prometheus.authBearer", "Bearer token")}
            </option>
          </select>
        </Labeled>
        <Labeled
          label={t("integrations.prometheus.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        {form.authMode === "basic" && (
          <>
            <Labeled label={t("integrations.prometheus.username", "Username")}>
              <input
                className={field}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </Labeled>
            <Labeled label={t("integrations.prometheus.password", "Password")}>
              <input
                className={field}
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Labeled>
          </>
        )}
        {form.authMode === "bearer" && (
          <Labeled
            label={t("integrations.prometheus.bearerToken", "Bearer token")}
          >
            <input
              className={field}
              type="password"
              value={form.bearerToken}
              onChange={(e) => set("bearerToken", e.target.value)}
            />
          </Labeled>
        )}
        <Labeled label={t("integrations.prometheus.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.host}
          />
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.useTls}
            onChange={(e) => set("useTls", e.target.checked)}
          />
          {t("integrations.prometheus.useTls", "Use HTTPS")}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.acceptInvalidCerts}
            onChange={(e) => set("acceptInvalidCerts", e.target.checked)}
          />
          {t(
            "integrations.prometheus.acceptInvalidCerts",
            "Accept self-signed certificates",
          )}
        </label>
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
          {t("integrations.prometheus.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.prometheus.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Query tab ───────────────────────────────────────────────────────────────

const QueryTab: React.FC<{ mgr: PrometheusManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("up");
  const [samples, setSamples] = useState<QuerySample[]>([]);
  const [resultType, setResultType] = useState<string>("");
  // Range params
  const [range, setRange] = useState({ start: "", end: "", step: "60s" });
  const [rangeSeries, setRangeSeries] = useState<number | null>(null);
  // Metadata browsing
  const [selectors, setSelectors] = useState("up");
  const [labelNames, setLabelNames] = useState<string[]>([]);
  const [labelName, setLabelName] = useState("job");
  const [labelValues, setLabelValues] = useState<string[]>([]);
  const [seriesRows, setSeriesRows] = useState<Record<string, string>[]>([]);
  const [federated, setFederated] = useState<string>("");

  const selArr = () =>
    selectors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const runInstant = useCallback(async () => {
    try {
      const r = await mgr.run(() => mgr.api.instantQuery(cid, query));
      setResultType(r.result_type);
      setSamples(r.data);
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr, cid, query]);

  const runRange = useCallback(async () => {
    if (!range.start || !range.end) return;
    try {
      const r = await mgr.run(() =>
        mgr.api.rangeQuery(cid, query, range.start, range.end, range.step),
      );
      setRangeSeries(r.data.length);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, query, range]);

  const runSeries = useCallback(async () => {
    try {
      setSeriesRows(await mgr.run(() => mgr.api.series(cid, selArr())));
    } catch {
      /* surfaced */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr, cid, selectors]);

  const runLabelNames = useCallback(async () => {
    try {
      setLabelNames(await mgr.run(() => mgr.api.labelNames(cid, selArr())));
    } catch {
      /* surfaced */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr, cid, selectors]);

  const runLabelValues = useCallback(async () => {
    try {
      setLabelValues(
        await mgr.run(() => mgr.api.labelValues(cid, labelName, selArr())),
      );
    } catch {
      /* surfaced */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr, cid, labelName, selectors]);

  const runFederate = useCallback(async () => {
    try {
      const r = await mgr.run(() => mgr.api.federate(cid, selArr()));
      setFederated(r.metrics);
    } catch {
      /* surfaced */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr, cid, selectors]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <Labeled label={t("integrations.prometheus.expression", "PromQL expression")}>
          <textarea
            className={`${field} font-mono`}
            rows={2}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Labeled>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={runInstant} disabled={mgr.isLoading}>
            <Search size={12} />
            {t("integrations.prometheus.runInstant", "Instant query")}
          </button>
          <input
            className={field}
            style={{ width: 190 }}
            placeholder={t("integrations.prometheus.start", "start (RFC3339 / unix)")}
            value={range.start}
            onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
          />
          <input
            className={field}
            style={{ width: 190 }}
            placeholder={t("integrations.prometheus.end", "end (RFC3339 / unix)")}
            value={range.end}
            onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
          />
          <input
            className={field}
            style={{ width: 80 }}
            placeholder={t("integrations.prometheus.step", "step")}
            value={range.step}
            onChange={(e) => setRange((r) => ({ ...r, step: e.target.value }))}
          />
          <button
            className={btn}
            onClick={runRange}
            disabled={mgr.isLoading || !range.start || !range.end}
          >
            {t("integrations.prometheus.runRange", "Range query")}
          </button>
          {rangeSeries != null && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {t("integrations.prometheus.seriesReturned", "series")}: {rangeSeries}
            </span>
          )}
        </div>
      </div>

      {samples.length > 0 && (
        <div className="overflow-x-auto">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
            {resultType}
          </div>
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.prometheus.metric", "Metric")}</th>
                <th className="px-2 py-1">{t("integrations.prometheus.value", "Value")}</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={i} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 font-mono text-[var(--color-text)]">
                    {s.metric.__name__ ?? ""}
                    {"{"}
                    {Object.entries(s.metric)
                      .filter(([k]) => k !== "__name__")
                      .map(([k, v]) => `${k}="${v}"`)
                      .join(", ")}
                    {"}"}
                  </td>
                  <td className="px-2 py-1 font-mono">{s.value[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.prometheus.metadataExplorer", "Series & label explorer")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled
            label={t(
              "integrations.prometheus.selectors",
              "Match selectors (comma-separated)",
            )}
          >
            <input
              className={field}
              value={selectors}
              onChange={(e) => setSelectors(e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.prometheus.labelName", "Label name")}>
            <input
              className={field}
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
            />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn} onClick={runSeries} disabled={mgr.isLoading}>
            {t("integrations.prometheus.series", "Series")}
          </button>
          <button className={btn} onClick={runLabelNames} disabled={mgr.isLoading}>
            {t("integrations.prometheus.labelNames", "Label names")}
          </button>
          <button className={btn} onClick={runLabelValues} disabled={mgr.isLoading}>
            {t("integrations.prometheus.labelValues", "Label values")}
          </button>
          <button className={btn} onClick={runFederate} disabled={mgr.isLoading}>
            {t("integrations.prometheus.federate", "Federate")}
          </button>
        </div>
        {labelNames.length > 0 && (
          <p className="mt-2 break-words text-xs text-[var(--color-textSecondary)]">
            <span className="text-[var(--color-textMuted)]">names: </span>
            {labelNames.join(", ")}
          </p>
        )}
        {labelValues.length > 0 && (
          <p className="mt-1 break-words text-xs text-[var(--color-textSecondary)]">
            <span className="text-[var(--color-textMuted)]">values: </span>
            {labelValues.join(", ")}
          </p>
        )}
        {seriesRows.length > 0 && (
          <div className="mt-2 max-h-48 overflow-auto text-xs">
            {seriesRows.map((row, i) => (
              <div key={i} className="font-mono text-[var(--color-textSecondary)]">
                {JSON.stringify(row)}
              </div>
            ))}
          </div>
        )}
        {federated && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
            {federated}
          </pre>
        )}
      </div>
    </div>
  );
};

// ─── Targets tab ─────────────────────────────────────────────────────────────

const TargetsTab: React.FC<{ mgr: PrometheusManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<PromTarget[]>([]);
  const [stateFilter, setStateFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      setTargets(
        await mgr.run(() =>
          mgr.api.listTargets(cid, stateFilter || undefined),
        ),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, stateFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          className={field}
          style={{ width: 140 }}
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">{t("integrations.prometheus.allStates", "All")}</option>
          <option value="active">{t("integrations.prometheus.active", "Active")}</option>
          <option value="dropped">{t("integrations.prometheus.dropped", "Dropped")}</option>
        </select>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.prometheus.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.prometheus.pool", "Pool")}</th>
              <th className="px-2 py-1">{t("integrations.prometheus.endpoint", "Endpoint")}</th>
              <th className="px-2 py-1">{t("integrations.prometheus.health", "Health")}</th>
              <th className="px-2 py-1">{t("integrations.prometheus.lastError", "Last error")}</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((tg, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{tg.scrapePool}</td>
                <td className="px-2 py-1 font-mono">{tg.scrapeUrl}</td>
                <td className="px-2 py-1">
                  <span
                    className={
                      tg.health === "up"
                        ? "text-green-500"
                        : tg.health === "down"
                          ? "text-red-500"
                          : "text-[var(--color-textSecondary)]"
                    }
                  >
                    {tg.health}
                  </span>
                </td>
                <td className="px-2 py-1 text-red-400">{tg.lastError}</td>
              </tr>
            ))}
            {targets.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.prometheus.noTargets", "No targets")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Rules & alerts tab ──────────────────────────────────────────────────────

const RulesTab: React.FC<{ mgr: PrometheusManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  const [recording, setRecording] = useState<RuleGroup[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [ruleType, setRuleType] = useState("");

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
        safe(mgr.api.listRules(cid, ruleType || undefined), setGroups),
        safe(mgr.api.listRecordingRules(cid), setRecording),
        safe(mgr.api.listAlerts(cid), setAlerts),
      ]);
    });
  }, [mgr, cid, ruleType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          className={field}
          style={{ width: 150 }}
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value)}
        >
          <option value="">{t("integrations.prometheus.allRules", "All rules")}</option>
          <option value="alert">{t("integrations.prometheus.alertingRules", "Alerting")}</option>
          <option value="record">{t("integrations.prometheus.recordingRules", "Recording")}</option>
        </select>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.prometheus.refresh", "Refresh")}
        </button>
      </div>

      <section className={card}>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
          <BellRing size={12} /> {t("integrations.prometheus.activeAlerts", "Active alerts")}
        </h4>
        <div className="flex flex-col gap-1">
          {alerts.map((a, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="font-mono text-[var(--color-textSecondary)]">
                {a.labels.alertname ?? "—"} · {Object.entries(a.labels).filter(([k]) => k !== "alertname").map(([k, v]) => `${k}=${v}`).join(", ")}
              </span>
              <span
                className={
                  a.state === "firing" ? "text-red-500" : "text-yellow-500"
                }
              >
                {a.state}
              </span>
            </div>
          ))}
          {alerts.length === 0 && (
            <span className="text-xs text-[var(--color-textMuted)]">
              {t("integrations.prometheus.noAlerts", "No active alerts")}
            </span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.prometheus.ruleGroups", "Rule groups")}
          </h4>
          {groups.map((g, i) => (
            <div key={i} className="text-xs text-[var(--color-textSecondary)]">
              {g.name} · {g.rules.length} {t("integrations.prometheus.rules", "rules")} · {g.file}
            </div>
          ))}
          {groups.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.prometheus.recordingGroups", "Recording groups")}
          </h4>
          {recording.map((g, i) => (
            <div key={i} className="text-xs text-[var(--color-textSecondary)]">
              {g.name} · {g.rules.length} {t("integrations.prometheus.rules", "rules")}
            </div>
          ))}
          {recording.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
      </div>
    </div>
  );
};

// ─── Silences tab ────────────────────────────────────────────────────────────

const SilencesTab: React.FC<{ mgr: PrometheusManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [silences, setSilences] = useState<Silence[]>([]);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({
    matcherName: "",
    matcherValue: "",
    isRegex: false,
    startsAt: "",
    endsAt: "",
    createdBy: "",
    comment: "",
  });

  const refresh = useCallback(async () => {
    try {
      setSilences(
        await mgr.run(() => mgr.api.listSilences(cid, filter || undefined)),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setF = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = useCallback(async () => {
    if (!form.matcherName || !form.startsAt || !form.endsAt) return;
    const matchers: SilenceMatcher[] = [
      {
        name: form.matcherName,
        value: form.matcherValue,
        isRegex: form.isRegex,
        isEqual: true,
      },
    ];
    try {
      await mgr.run(() =>
        mgr.api.createSilence(
          cid,
          matchers,
          form.startsAt,
          form.endsAt,
          form.createdBy || "sortofremoteng",
          form.comment,
        ),
      );
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const view = useCallback(
    async (silenceId: string) => {
      try {
        const s = await mgr.run(() => mgr.api.getSilence(cid, silenceId));
        window.alert(JSON.stringify(s, null, 2));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const remove = useCallback(
    async (silenceId: string) => {
      if (!window.confirm(t("integrations.prometheus.deleteSilenceConfirm", "Delete this silence?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteSilence(cid, silenceId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          className={field}
          style={{ width: 220 }}
          placeholder={t("integrations.prometheus.silenceFilter", "Filter (matcher)")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.prometheus.refresh", "Refresh")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
          <ShieldOff size={12} /> {t("integrations.prometheus.createSilence", "Create silence")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.prometheus.matcherName", "Matcher name")}>
            <input className={field} value={form.matcherName} onChange={(e) => setF("matcherName", e.target.value)} placeholder="alertname" />
          </Labeled>
          <Labeled label={t("integrations.prometheus.matcherValue", "Matcher value")}>
            <input className={field} value={form.matcherValue} onChange={(e) => setF("matcherValue", e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.prometheus.startsAt", "Starts at (RFC3339)")}>
            <input className={field} value={form.startsAt} onChange={(e) => setF("startsAt", e.target.value)} placeholder="2026-01-01T00:00:00Z" />
          </Labeled>
          <Labeled label={t("integrations.prometheus.endsAt", "Ends at (RFC3339)")}>
            <input className={field} value={form.endsAt} onChange={(e) => setF("endsAt", e.target.value)} placeholder="2026-01-01T01:00:00Z" />
          </Labeled>
          <Labeled label={t("integrations.prometheus.createdBy", "Created by")}>
            <input className={field} value={form.createdBy} onChange={(e) => setF("createdBy", e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.prometheus.comment", "Comment")}>
            <input className={field} value={form.comment} onChange={(e) => setF("comment", e.target.value)} />
          </Labeled>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input type="checkbox" checked={form.isRegex} onChange={(e) => setF("isRegex", e.target.checked)} />
            {t("integrations.prometheus.isRegex", "Regex matcher")}
          </label>
          <button className={btn} onClick={create} disabled={mgr.isLoading || !form.matcherName}>
            {t("integrations.prometheus.createSilence", "Create silence")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {silences.map((s) => (
          <div key={s.id} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {s.matchers.map((m) => `${m.name}${m.isRegex ? "=~" : "="}${m.value}`).join(", ")} · {s.status.state} · {s.endsAt}
            </span>
            <div className="flex gap-1">
              <button className={btn} onClick={() => void view(s.id)}>
                {t("integrations.prometheus.details", "Details")}
              </button>
              <button className={btn} onClick={() => void remove(s.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {silences.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.prometheus.noSilences", "No silences")}
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Status tab (config / flags / TSDB / metadata) ───────────────────────────

const StatusTab: React.FC<{ mgr: PrometheusManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [yaml, setYaml] = useState<string>("");
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [tsdb, setTsdb] = useState<import("../../types/prometheus").TsdbStatus | null>(null);
  const [metadata, setMetadata] = useState<Record<string, import("../../types/prometheus").MetricMetadata[]>>({});

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
        safe(async () => setYaml((await mgr.api.getConfig(cid)).yaml)),
        safe(async () => setFlags(await mgr.api.getFlags(cid))),
        safe(async () => setTsdb(await mgr.api.getTsdbStatus(cid))),
        safe(async () => setMetadata(await mgr.api.listMetadata(cid))),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reload = useCallback(async () => {
    try {
      const r = await mgr.run(() => mgr.api.reloadConfig(cid));
      window.alert(
        r.success
          ? t("integrations.prometheus.reloadOk", "Configuration reloaded")
          : t("integrations.prometheus.reloadFail", "Reload failed"),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, t]);

  const metadataEntries = Object.entries(metadata).slice(0, 200);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.prometheus.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={reload} disabled={mgr.isLoading}>
          {t("integrations.prometheus.reloadConfig", "Reload config")}
        </button>
      </div>

      {tsdb && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [t("integrations.prometheus.numSeries", "Series"), tsdb.headStats.numSeries],
            [t("integrations.prometheus.numLabelPairs", "Label pairs"), tsdb.headStats.numLabelPairs],
            [t("integrations.prometheus.chunkCount", "Chunks"), tsdb.headStats.chunkCount],
            [t("integrations.prometheus.numChunks", "Head chunks"), tsdb.headStats.numChunks],
          ].map(([label, value]) => (
            <div key={String(label)} className={card}>
              <div className="text-lg font-semibold text-[var(--color-text)]">{value}</div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">{label}</div>
            </div>
          ))}
        </div>
      )}

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.prometheus.runtimeFlags", "Runtime flags")}
        </h4>
        <div className="max-h-40 overflow-auto text-xs">
          {Object.entries(flags).map(([k, v]) => (
            <div key={k} className="font-mono text-[var(--color-textSecondary)]">
              {k} = {v}
            </div>
          ))}
          {Object.keys(flags).length === 0 && <span className="text-[var(--color-textMuted)]">—</span>}
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.prometheus.metricMetadata", "Metric metadata")}
        </h4>
        <div className="max-h-40 overflow-auto text-xs">
          {metadataEntries.map(([metric, entries]) => (
            <div key={metric} className="text-[var(--color-textSecondary)]">
              <span className="font-mono text-[var(--color-text)]">{metric}</span>
              {entries[0] ? ` · ${entries[0].type} · ${entries[0].help}` : ""}
            </div>
          ))}
          {metadataEntries.length === 0 && <span className="text-[var(--color-textMuted)]">—</span>}
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.prometheus.config", "Configuration (prometheus.yml)")}
        </h4>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {yaml || "—"}
        </pre>
      </section>
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
  { key: "query", labelKey: "integrations.prometheus.tabQuery", labelDefault: "Query", icon: Terminal },
  { key: "targets", labelKey: "integrations.prometheus.tabTargets", labelDefault: "Targets", icon: Server },
  { key: "rules", labelKey: "integrations.prometheus.tabRules", labelDefault: "Rules & Alerts", icon: BellRing },
  { key: "silences", labelKey: "integrations.prometheus.tabSilences", labelDefault: "Silences", icon: ShieldOff },
  { key: "status", labelKey: "integrations.prometheus.tabStatus", labelDefault: "Status", icon: Tags },
];

const PrometheusPanel: React.FC<IntegrationPanelProps> = ({
  isOpen,
  instanceId,
}) => {
  const { t } = useTranslation();
  const mgr = usePrometheus();
  const [tab, setTab] = useState<TabKey>("query");

  if (!isOpen) return null;

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Activity className="h-5 w-5 text-primary" />
          {t("integrations.prometheus.title", "Prometheus")}
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
              ? mgr.summary?.host ?? t("integrations.prometheus.connected", "Connected")
              : t("integrations.prometheus.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.prometheus.disconnect", "Disconnect")}
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
            {tab === "query" && <QueryTab mgr={mgr} cid={cid} />}
            {tab === "targets" && <TargetsTab mgr={mgr} cid={cid} />}
            {tab === "rules" && <RulesTab mgr={mgr} cid={cid} />}
            {tab === "silences" && <SilencesTab mgr={mgr} cid={cid} />}
            {tab === "status" && <StatusTab mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default PrometheusPanel;

/** Registry descriptor for the Prometheus integration (category: app-service).
 *  The Wave-3 app-service integrator appends this to `registry.appservice.ts`. */
export const prometheusDescriptor: IntegrationDescriptor = {
  key: "prometheus",
  label: "Prometheus",
  category: "app-service",
  icon: Activity,
  importPanel: () => import("./PrometheusPanel"),
};
