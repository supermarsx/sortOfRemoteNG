// AI settings — LLM router / provider configuration (t42-llm).
//
// Folds the sorng-llm crate (the router/aggregator over many LLM providers)
// into a first-class "AI" settings tab. Binds the FULL 20-command surface of
// `sorng-llm/src/commands.rs` through `useLlm()` / `llmApi`, grouped into
// collapsible sub-panels: Providers (add/update/remove/list/default/health),
// Router (get/update config, balancer strategy, cache, usage tracking), Models
// (list / by-provider / info), Usage & Cache (usage summary, status, cache
// stats, clear), and a Playground (chat completion, embeddings, token
// estimate).
//
// Secrets: a provider's `api_key` is NEVER written to settings JSON. It is
// stored through the encrypted integration credential store
// (`useIntegrationConfigStore`, keyed integrationKey "llm") and only the
// non-secret provider config is persisted alongside; on mount, persisted
// providers are re-hydrated into the (volatile, in-memory) backend router.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BrainCircuit,
  CircuitBoard,
  Cpu,
  Gauge,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import SectionHeading from "../../ui/SectionHeading";
import { SettingsCollapsibleSection } from "../../ui/settings/SettingsPrimitives";
import { useLlm, type LlmManager } from "../../../hooks/integration/useLlm";
import {
  useIntegrationConfigStore,
  type IntegrationConfigStore,
  type IntegrationInstance,
} from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import {
  BALANCER_STRATEGIES,
  PROVIDER_TYPES,
  defaultProviderConfig,
  providerTypeMeta,
  type BalancerStrategy,
  type CacheStats,
  type LlmConfig,
  type LlmStatus,
  type ModelInfo,
  type ProviderConfig,
  type ProviderHealth,
  type ProviderType,
  type UsageSummary,
} from "../../../types/llm";

// ─── Shared UI helpers (mirrors the integration-panel idiom) ─────────────────

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

const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

// ─── Store <-> provider persistence helpers ──────────────────────────────────

const LLM_KEY = "llm";

/** The non-secret ProviderConfig persisted in an instance's `fields.config`. */
function providerFromInstance(inst: IntegrationInstance): ProviderConfig | null {
  const raw = inst.fields?.config;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProviderConfig;
  } catch {
    return null;
  }
}

function instanceForProvider(
  store: IntegrationConfigStore,
  providerId: string,
): IntegrationInstance | undefined {
  return store.instances.find(
    (i) => i.integrationKey === LLM_KEY && providerFromInstance(i)?.id === providerId,
  );
}

// ─── Provider add / edit form ────────────────────────────────────────────────

interface ProviderFormState {
  id: string;
  providerType: ProviderType;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  orgId: string;
  region: string;
  priority: string;
  timeoutSeconds: string;
  maxRetries: string;
  enabled: boolean;
}

function toFormState(p?: ProviderConfig): ProviderFormState {
  const base = p ?? defaultProviderConfig();
  return {
    id: base.id || generateId(),
    providerType: base.provider_type,
    displayName: base.display_name,
    apiKey: "",
    baseUrl: base.base_url ?? "",
    defaultModel: base.default_model ?? "",
    orgId: base.org_id ?? "",
    region: base.region ?? "",
    priority: String(base.priority ?? 0),
    timeoutSeconds: String(base.timeout_seconds ?? 120),
    maxRetries: String(base.max_retries ?? 3),
    enabled: base.enabled ?? true,
  };
}

const ProviderForm: React.FC<{
  mgr: LlmManager;
  store: IntegrationConfigStore;
  editing?: ProviderConfig;
  onDone: () => void;
}> = ({ mgr, store, editing, onDone }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<ProviderFormState>(() => toFormState(editing));
  const [saving, setSaving] = useState(false);

  // Prefill the api key from the vault when editing an existing provider.
  useEffect(() => {
    if (!editing) return;
    const inst = instanceForProvider(store, editing.id);
    if (!inst) return;
    void store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, apiKey: secret }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, store.isLoading]);

  const set = <K extends keyof ProviderFormState>(
    k: K,
    v: ProviderFormState[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const meta = providerTypeMeta(form.providerType);

  const buildConfig = useCallback((): ProviderConfig => {
    const existing = editing;
    return {
      ...(existing ?? defaultProviderConfig()),
      id: form.id,
      provider_type: form.providerType,
      display_name: form.displayName || meta.displayName,
      api_key: form.apiKey || null,
      base_url: form.baseUrl || null,
      default_model: form.defaultModel || null,
      org_id: form.orgId || null,
      region: form.region || null,
      priority: Number(form.priority) || 0,
      timeout_seconds: Number(form.timeoutSeconds) || 120,
      max_retries: Number(form.maxRetries) || 3,
      enabled: form.enabled,
      custom_headers: existing?.custom_headers ?? {},
      deployments: existing?.deployments ?? {},
    };
  }, [editing, form, meta.displayName]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const config = buildConfig();
      if (editing) {
        await mgr.run(() => mgr.api.updateProvider(config));
      } else {
        await mgr.run(() => mgr.api.addProvider(config));
      }
      // Persist non-secret config + api key (vault) for rehydration on restart.
      const persistConfig: ProviderConfig = { ...config, api_key: null };
      const fields = { config: JSON.stringify(persistConfig) };
      const existingInst = instanceForProvider(store, config.id);
      if (existingInst) {
        await store.updateInstance(existingInst.id, {
          name: config.display_name,
          host: config.base_url ?? undefined,
          fields,
          secret: form.apiKey || undefined,
        });
      } else {
        await store.createInstance({
          integrationKey: LLM_KEY,
          name: config.display_name,
          host: config.base_url ?? undefined,
          fields,
          secret: form.apiKey || undefined,
        });
      }
      await mgr.refreshProviders();
      onDone();
    } catch {
      /* surfaced via mgr.error */
    } finally {
      setSaving(false);
    }
  }, [buildConfig, editing, mgr, store, form.apiKey, onDone]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.llm.providerType", "Provider")}>
          <select
            className={field}
            value={form.providerType}
            onChange={(e) => {
              const pt = e.target.value as ProviderType;
              setForm((f) => ({
                ...f,
                providerType: pt,
                baseUrl: f.baseUrl || providerTypeMeta(pt).defaultBaseUrl,
              }));
            }}
          >
            {PROVIDER_TYPES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.displayName}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={t("integrations.llm.displayName", "Display name")}>
          <input
            className={field}
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            placeholder={meta.displayName}
          />
        </Labeled>
        {meta.requiresApiKey && (
          <Labeled label={t("integrations.llm.apiKey", "API key")}>
            <input
              className={field}
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder={
                editing
                  ? t("integrations.llm.apiKeyUnchanged", "leave blank to keep")
                  : "sk-..."
              }
            />
          </Labeled>
        )}
        <Labeled label={t("integrations.llm.baseUrl", "Base URL")}>
          <input
            className={field}
            value={form.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder={meta.defaultBaseUrl || "https://..."}
          />
        </Labeled>
        <Labeled label={t("integrations.llm.defaultModel", "Default model")}>
          <input
            className={field}
            value={form.defaultModel}
            onChange={(e) => set("defaultModel", e.target.value)}
            placeholder="gpt-4o"
          />
        </Labeled>
        {form.providerType === "aws_bedrock" && (
          <Labeled label={t("integrations.llm.region", "Region")}>
            <input
              className={field}
              value={form.region}
              onChange={(e) => set("region", e.target.value)}
              placeholder="us-east-1"
            />
          </Labeled>
        )}
        {(form.providerType === "open_ai" ||
          form.providerType === "azure_open_ai") && (
          <Labeled label={t("integrations.llm.orgId", "Organization ID")}>
            <input
              className={field}
              value={form.orgId}
              onChange={(e) => set("orgId", e.target.value)}
            />
          </Labeled>
        )}
        <Labeled label={t("integrations.llm.priority", "Priority")}>
          <input
            className={field}
            inputMode="numeric"
            value={form.priority}
            onChange={(e) => set("priority", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.llm.timeout", "Timeout (seconds)")}>
          <input
            className={field}
            inputMode="numeric"
            value={form.timeoutSeconds}
            onChange={(e) => set("timeoutSeconds", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.llm.maxRetries", "Max retries")}>
          <input
            className={field}
            inputMode="numeric"
            value={form.maxRetries}
            onChange={(e) => set("maxRetries", e.target.value)}
          />
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          {t("integrations.llm.enabled", "Enabled")}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={save}
          disabled={saving || !form.displayName && !providerTypeMeta(form.providerType).displayName}
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {editing
            ? t("integrations.llm.update", "Update provider")
            : t("integrations.llm.add", "Add provider")}
        </button>
        <button className={btn} onClick={onDone} disabled={saving}>
          {t("integrations.llm.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
};

// ─── Providers sub-panel ─────────────────────────────────────────────────────

const ProvidersPanel: React.FC<{
  mgr: LlmManager;
  store: IntegrationConfigStore;
}> = ({ mgr, store }) => {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProviderConfig | undefined>();
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({});

  const defaultProvider = mgr.config?.default_provider ?? null;

  const remove = useCallback(
    async (p: ProviderConfig) => {
      if (
        !window.confirm(
          t("integrations.llm.removeConfirm", "Remove this provider?"),
        )
      )
        return;
      try {
        await mgr.run(() => mgr.api.removeProvider(p.id));
        const inst = instanceForProvider(store, p.id);
        if (inst) await store.deleteInstance(inst.id);
        await mgr.refreshProviders();
      } catch {
        /* surfaced */
      }
    },
    [mgr, store, t],
  );

  const setDefault = useCallback(
    async (p: ProviderConfig) => {
      try {
        await mgr.run(() => mgr.api.setDefaultProvider(p.id));
        await mgr.refreshConfig();
      } catch {
        /* surfaced */
      }
    },
    [mgr],
  );

  const checkOne = useCallback(
    async (p: ProviderConfig) => {
      try {
        const h = await mgr.run(() => mgr.api.healthCheck(p.id));
        setHealth((prev) => ({ ...prev, [p.id]: h }));
      } catch {
        /* surfaced */
      }
    },
    [mgr],
  );

  const checkAll = useCallback(async () => {
    try {
      const all = await mgr.run(() => mgr.api.healthCheckAll());
      setHealth(Object.fromEntries(all.map((h) => [h.provider_id, h])));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={() => {
            setEditing(undefined);
            setShowForm(true);
          }}
        >
          <Plus size={12} />
          {t("integrations.llm.addProvider", "Add provider")}
        </button>
        <button className={btn} onClick={() => void mgr.refreshProviders()} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.llm.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={checkAll} disabled={mgr.isLoading}>
          <Gauge size={12} />
          {t("integrations.llm.healthCheckAll", "Health check all")}
        </button>
      </div>

      {showForm && (
        <ProviderForm
          mgr={mgr}
          store={store}
          editing={editing}
          onDone={() => {
            setShowForm(false);
            setEditing(undefined);
          }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.llm.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.llm.providerType", "Provider")}</th>
              <th className="px-2 py-1">{t("integrations.llm.priority", "Priority")}</th>
              <th className="px-2 py-1">{t("integrations.llm.status", "Status")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {mgr.providers.map((p) => {
              const h = health[p.id];
              const isDefault = defaultProvider === p.id;
              return (
                <tr key={p.id} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 text-[var(--color-text)]">
                    {p.display_name || p.id}
                    {isDefault && (
                      <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                        {t("integrations.llm.default", "default")}
                      </span>
                    )}
                    {!p.enabled && (
                      <span className="ml-2 text-[10px] text-[var(--color-textMuted)]">
                        ({t("integrations.llm.disabled", "disabled")})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {providerTypeMeta(p.provider_type).displayName}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">{p.priority}</td>
                  <td className="px-2 py-1">
                    {h ? (
                      <span className={h.healthy ? "text-green-500" : "text-red-500"}>
                        {h.healthy
                          ? `${t("integrations.llm.healthy", "healthy")}${h.latency_ms != null ? ` · ${h.latency_ms}ms` : ""}`
                          : t("integrations.llm.unhealthy", "unhealthy")}
                      </span>
                    ) : (
                      <span className="text-[var(--color-textMuted)]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end gap-1">
                      <button className={btn} onClick={() => void checkOne(p)}>
                        {t("integrations.llm.check", "Check")}
                      </button>
                      {!isDefault && (
                        <button className={btn} onClick={() => void setDefault(p)}>
                          {t("integrations.llm.makeDefault", "Set default")}
                        </button>
                      )}
                      <button
                        className={btn}
                        onClick={() => {
                          setEditing(p);
                          setShowForm(true);
                        }}
                      >
                        {t("integrations.llm.edit", "Edit")}
                      </button>
                      <button className={btn} onClick={() => void remove(p)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {mgr.providers.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.llm.noProviders", "No providers configured")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Router config sub-panel ─────────────────────────────────────────────────

const RouterPanel: React.FC<{ mgr: LlmManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const cfg = mgr.config;

  const patch = useCallback(
    async (updater: (c: LlmConfig) => LlmConfig) => {
      if (!cfg) return;
      const next = updater(cfg);
      mgr.setConfig(next);
      try {
        await mgr.run(() => mgr.api.updateConfig(next));
      } catch {
        await mgr.refreshConfig();
      }
    },
    [cfg, mgr],
  );

  const setStrategy = useCallback(
    async (strategy: BalancerStrategy) => {
      try {
        await mgr.run(() => mgr.api.setBalancerStrategy(strategy));
        await mgr.refreshConfig();
      } catch {
        /* surfaced */
      }
    },
    [mgr],
  );

  if (!cfg) {
    return (
      <div className="text-xs text-[var(--color-textMuted)]">
        {t("integrations.llm.noConfig", "Router config unavailable")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.llm.balancerStrategy", "Balancer strategy")}>
          <select
            className={field}
            value={cfg.balancer.strategy}
            onChange={(e) => void setStrategy(e.target.value as BalancerStrategy)}
          >
            {BALANCER_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {t(`integrations.llm.strategy.${s}`, s)}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={t("integrations.llm.defaultModel", "Default model")}>
          <input
            className={field}
            value={cfg.default_model ?? ""}
            onChange={(e) =>
              void patch((c) => ({ ...c, default_model: e.target.value || null }))
            }
            placeholder="gpt-4o"
          />
        </Labeled>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={cfg.balancer.failover_enabled}
            onChange={(e) =>
              void patch((c) => ({
                ...c,
                balancer: { ...c.balancer, failover_enabled: e.target.checked },
              }))
            }
          />
          {t("integrations.llm.failover", "Failover enabled")}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={cfg.balancer.sticky_sessions}
            onChange={(e) =>
              void patch((c) => ({
                ...c,
                balancer: { ...c.balancer, sticky_sessions: e.target.checked },
              }))
            }
          />
          {t("integrations.llm.stickySessions", "Sticky sessions")}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={cfg.usage_tracking_enabled}
            onChange={(e) =>
              void patch((c) => ({ ...c, usage_tracking_enabled: e.target.checked }))
            }
          />
          {t("integrations.llm.usageTracking", "Usage tracking")}
        </label>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.cache", "Response cache")}
        </h4>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={cfg.cache.enabled}
              onChange={(e) =>
                void patch((c) => ({
                  ...c,
                  cache: { ...c.cache, enabled: e.target.checked },
                }))
              }
            />
            {t("integrations.llm.cacheEnabled", "Cache enabled")}
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={cfg.cache.cache_embeddings}
              onChange={(e) =>
                void patch((c) => ({
                  ...c,
                  cache: { ...c.cache, cache_embeddings: e.target.checked },
                }))
              }
            />
            {t("integrations.llm.cacheEmbeddings", "Cache embeddings")}
          </label>
          <Labeled label={t("integrations.llm.cacheTtl", "TTL (seconds)")}>
            <input
              className={field}
              style={{ width: 120 }}
              inputMode="numeric"
              value={String(cfg.cache.ttl_seconds)}
              onChange={(e) =>
                void patch((c) => ({
                  ...c,
                  cache: { ...c.cache, ttl_seconds: Number(e.target.value) || 0 },
                }))
              }
            />
          </Labeled>
        </div>
      </div>
    </div>
  );
};

// ─── Models sub-panel ────────────────────────────────────────────────────────

const ModelsPanel: React.FC<{ mgr: LlmManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [providerFilter, setProviderFilter] = useState("");
  const [modelId, setModelId] = useState("");
  const [info, setInfo] = useState<ModelInfo | null>(null);

  const loadAll = useCallback(async () => {
    try {
      setModels(await mgr.run(() => mgr.api.listModels()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  const loadForProvider = useCallback(async () => {
    if (!providerFilter) return void loadAll();
    try {
      setModels(await mgr.run(() => mgr.api.modelsForProvider(providerFilter)));
    } catch {
      /* surfaced */
    }
  }, [mgr, providerFilter, loadAll]);

  const lookup = useCallback(async () => {
    if (!modelId) return;
    try {
      setInfo(await mgr.run(() => mgr.api.modelInfo(modelId)));
    } catch {
      /* surfaced */
    }
  }, [mgr, modelId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <button className={btn} onClick={loadAll} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.llm.listModels", "List all models")}
        </button>
        <Labeled label={t("integrations.llm.providerFilter", "Provider (id)")}>
          <input
            className={field}
            style={{ width: 160 }}
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            placeholder="openai"
          />
        </Labeled>
        <button className={`${btn} self-end`} onClick={loadForProvider} disabled={mgr.isLoading}>
          {t("integrations.llm.modelsForProvider", "By provider")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.llm.modelId", "Model")}</th>
              <th className="px-2 py-1">{t("integrations.llm.providerType", "Provider")}</th>
              <th className="px-2 py-1">{t("integrations.llm.context", "Context")}</th>
              <th className="px-2 py-1">{t("integrations.llm.cost", "In / Out ($/M)")}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{m.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{m.provider}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {m.context_window.toLocaleString()}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {m.input_cost_per_million} / {m.output_cost_per_million}
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.llm.noModels", "No models loaded")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.modelInfo", "Model details")}
        </h4>
        <div className="flex flex-wrap items-end gap-2">
          <Labeled label={t("integrations.llm.modelId", "Model")}>
            <input
              className={field}
              style={{ width: 220 }}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="gpt-4o"
            />
          </Labeled>
          <button className={`${btn} self-end`} onClick={lookup} disabled={mgr.isLoading || !modelId}>
            {t("integrations.llm.lookup", "Look up")}
          </button>
        </div>
        <JsonView value={info} />
      </div>
    </div>
  );
};

// ─── Usage & cache sub-panel ─────────────────────────────────────────────────

const UsagePanel: React.FC<{ mgr: LlmManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [days, setDays] = useState("30");

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await mgr.run(() => mgr.api.usageSummary(Number(days) || undefined)));
    } catch {
      /* surfaced */
    }
  }, [mgr, days]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await mgr.run(() => mgr.api.status()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  const loadCache = useCallback(async () => {
    try {
      setCache(await mgr.run(() => mgr.api.cacheStats()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  const clearCache = useCallback(async () => {
    try {
      await mgr.run(() => mgr.api.clearCache());
      await loadCache();
    } catch {
      /* surfaced */
    }
  }, [mgr, loadCache]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label={t("integrations.llm.days", "Window (days)")}>
          <input
            className={field}
            style={{ width: 100 }}
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Labeled>
        <button className={`${btn} self-end`} onClick={loadUsage} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.llm.usageSummary", "Usage summary")}
        </button>
        <button className={`${btn} self-end`} onClick={loadStatus} disabled={mgr.isLoading}>
          {t("integrations.llm.routerStatus", "Router status")}
        </button>
        <button className={`${btn} self-end`} onClick={loadCache} disabled={mgr.isLoading}>
          {t("integrations.llm.cacheStats", "Cache stats")}
        </button>
        <button className={`${btn} self-end text-red-500`} onClick={clearCache} disabled={mgr.isLoading}>
          <Trash2 size={12} />
          {t("integrations.llm.clearCache", "Clear cache")}
        </button>
      </div>

      {status && (
        <div className={card}>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label={t("integrations.llm.providersCount", "Providers")} value={`${status.healthy_providers}/${status.total_providers}`} />
            <Stat label={t("integrations.llm.modelsCount", "Models")} value={status.total_models} />
            <Stat label={t("integrations.llm.requests", "Requests")} value={status.total_requests} />
            <Stat label={t("integrations.llm.cost", "Cost ($)")} value={status.total_cost_usd.toFixed(4)} />
          </div>
        </div>
      )}

      {cache && (
        <div className={card}>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label={t("integrations.llm.entries", "Entries")} value={cache.entries} />
            <Stat label={t("integrations.llm.hits", "Hits")} value={cache.hits} />
            <Stat label={t("integrations.llm.misses", "Misses")} value={cache.misses} />
            <Stat label={t("integrations.llm.hitRate", "Hit rate")} value={`${(cache.hit_rate * 100).toFixed(1)}%`} />
          </div>
        </div>
      )}

      <JsonView value={usage} />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded bg-[var(--color-surface)] p-2">
    <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">{label}</div>
    <div className="text-sm font-semibold text-[var(--color-text)]">{value}</div>
  </div>
);

// ─── Playground sub-panel (chat / embeddings / token estimate) ───────────────

const PlaygroundPanel: React.FC<{ mgr: LlmManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [model, setModel] = useState("");
  const [providerId, setProviderId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [tokenText, setTokenText] = useState("");
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [embedInput, setEmbedInput] = useState("");

  const runChat = useCallback(async () => {
    if (!model || !prompt) return;
    try {
      const res = await mgr.run(() =>
        mgr.api.chatCompletion({
          model,
          messages: [{ role: "user", content: prompt }],
          provider_id: providerId || undefined,
        }),
      );
      setResult(res);
    } catch {
      /* surfaced */
    }
  }, [mgr, model, prompt, providerId]);

  const runEmbedding = useCallback(async () => {
    if (!model || !embedInput) return;
    try {
      const res = await mgr.run(() =>
        mgr.api.createEmbedding({
          model,
          input: embedInput.split("\n").map((s) => s.trim()).filter(Boolean),
          provider_id: providerId || undefined,
        }),
      );
      // Embeddings are large; show shape + first vector head only.
      setResult({
        model: res.model,
        provider: res.provider,
        count: res.embeddings.length,
        dimensions: res.embeddings[0]?.length ?? 0,
        head: res.embeddings[0]?.slice(0, 8) ?? [],
        usage: res.usage,
      });
    } catch {
      /* surfaced */
    }
  }, [mgr, model, embedInput, providerId]);

  const estimate = useCallback(async () => {
    try {
      setTokenCount(
        await mgr.run(() => mgr.api.estimateTokens(tokenText, model || undefined)),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, tokenText, model]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.llm.modelId", "Model")}>
          <input
            className={field}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o"
          />
        </Labeled>
        <Labeled label={t("integrations.llm.providerOverride", "Provider (optional)")}>
          <input
            className={field}
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            placeholder={t("integrations.llm.useDefault", "use default")}
          />
        </Labeled>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.chatTest", "Chat completion")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("integrations.llm.promptPlaceholder", "Say hello...")}
        />
        <button className={`${btn} mt-2`} onClick={runChat} disabled={mgr.isLoading || !model || !prompt}>
          {mgr.isLoading ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />}
          {t("integrations.llm.send", "Send")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.embedTest", "Embeddings (one per line)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={3}
          value={embedInput}
          onChange={(e) => setEmbedInput(e.target.value)}
          placeholder={"hello world\nfoo bar"}
        />
        <button className={`${btn} mt-2`} onClick={runEmbedding} disabled={mgr.isLoading || !model || !embedInput}>
          {t("integrations.llm.embed", "Embed")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.tokenEstimate", "Estimate tokens")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={2}
          value={tokenText}
          onChange={(e) => setTokenText(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <button className={btn} onClick={estimate} disabled={mgr.isLoading || !tokenText}>
            {t("integrations.llm.estimate", "Estimate")}
          </button>
          {tokenCount != null && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {t("integrations.llm.tokens", "tokens")}: {tokenCount}
            </span>
          )}
        </div>
      </div>

      <JsonView value={result} />
    </div>
  );
};

// ─── Section root ────────────────────────────────────────────────────────────

const AiSettings: React.FC = () => {
  const { t } = useTranslation();
  const mgr = useLlm();
  const store = useIntegrationConfigStore();
  const hydrated = useRef(false);

  // On mount: load the live router state, then re-hydrate any persisted
  // providers whose config survived a restart but whose in-memory backend
  // registration did not (Risk R1 — the backend registry is volatile).
  useEffect(() => {
    if (store.isLoading || hydrated.current) return;
    hydrated.current = true;
    void (async () => {
      const live = await mgr.refreshProviders();
      await mgr.refreshConfig();
      const liveIds = new Set(live.map((p) => p.id));
      const persisted = store.instances.filter((i) => i.integrationKey === LLM_KEY);
      let added = false;
      for (const inst of persisted) {
        const cfg = providerFromInstance(inst);
        if (!cfg || liveIds.has(cfg.id)) continue;
        const secret = await store.readSecret(inst);
        try {
          await mgr.api.addProvider({ ...cfg, api_key: secret ?? null });
          added = true;
        } catch {
          /* leave surfaced errors alone; skip this provider */
        }
      }
      if (added) await mgr.refreshProviders();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isLoading]);

  return (
    <div className="space-y-6" data-testid="section-ai">
      <SectionHeading
        icon={<BrainCircuit className="w-5 h-5 text-primary" />}
        title={t("integrations.llm.tabTitle", "AI / LLM Router")}
        description={t(
          "integrations.llm.description",
          "Configure the LLM router: add API providers, pick a load-balancing strategy, inspect the model catalog and usage, and test completions. API keys are stored in the encrypted credential vault, never in plaintext settings.",
        )}
      />

      {mgr.error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{mgr.error}</span>
          <button
            type="button"
            onClick={mgr.clearError}
            className="ml-auto text-error/70 hover:text-error"
            aria-label={t("common.dismiss", "Dismiss")}
          >
            x
          </button>
        </div>
      )}

      <SettingsCollapsibleSection
        title={t("integrations.llm.providers", "Providers")}
        icon={<Server size={14} />}
        defaultOpen
      >
        <ProvidersPanel mgr={mgr} store={store} />
      </SettingsCollapsibleSection>

      <SettingsCollapsibleSection
        title={t("integrations.llm.router", "Router & load balancing")}
        icon={<CircuitBoard size={14} />}
        defaultOpen={false}
      >
        <RouterPanel mgr={mgr} />
      </SettingsCollapsibleSection>

      <SettingsCollapsibleSection
        title={t("integrations.llm.models", "Model catalog")}
        icon={<Cpu size={14} />}
        defaultOpen={false}
      >
        <ModelsPanel mgr={mgr} />
      </SettingsCollapsibleSection>

      <SettingsCollapsibleSection
        title={t("integrations.llm.usageAndCache", "Usage & cache")}
        icon={<Gauge size={14} />}
        defaultOpen={false}
      >
        <UsagePanel mgr={mgr} />
      </SettingsCollapsibleSection>

      <SettingsCollapsibleSection
        title={t("integrations.llm.playground", "Playground")}
        icon={<BrainCircuit size={14} />}
        defaultOpen={false}
      >
        <PlaygroundPanel mgr={mgr} />
      </SettingsCollapsibleSection>
    </div>
  );
};

export default AiSettings;
