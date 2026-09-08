// AI settings — LLM router / provider configuration (t42-llm).
//
// Folds the sorng-llm crate (the router/aggregator over many LLM providers)
// into a first-class "AI" settings tab. Binds the FULL 20-command surface of
// `sorng-llm/src/commands.rs` through `useLlm()` / `llmApi`, grouped into
// standard settings sections: Providers (add/update/remove/list/default/health),
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
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import SectionHeading from "../../ui/SectionHeading";
import { useSettingHighlight } from "../useSettingHighlight";
import { Select } from "../../ui/forms/Select";
import { PasswordInput } from "../../ui/forms/PasswordInput";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../ui/settings/SettingsPrimitives";
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

const field = "sor-settings-input w-full min-w-0";
const btn =
  "inline-flex w-fit max-w-full items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";
const primaryBtn = `${btn} !border-primary !bg-primary text-white hover:!bg-primary/90`;
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3 min-w-0";

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--color-textSecondary)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <details className="mt-3 rounded-md border border-[var(--color-border)] p-3">
      <summary className="cursor-pointer text-xs font-medium text-[var(--color-textSecondary)]">
        Technical details (JSON)
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--color-surface)] p-2 font-mono text-xs text-[var(--color-textSecondary)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );

// ─── Store <-> provider persistence helpers ──────────────────────────────────

const LLM_KEY = "llm";

/** The non-secret ProviderConfig persisted in an instance's `fields.config`. */
function providerFromInstance(
  inst: IntegrationInstance,
): ProviderConfig | null {
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
    (i) =>
      i.integrationKey === LLM_KEY &&
      providerFromInstance(i)?.id === providerId,
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
  const [form, setForm] = useState<ProviderFormState>(() =>
    toFormState(editing),
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      max_retries: form.maxRetries.trim() === "" ? 3 : Number(form.maxRetries),
      enabled: form.enabled,
      custom_headers: existing?.custom_headers ?? {},
      deployments: existing?.deployments ?? {},
    };
  }, [editing, form, meta.displayName]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    let applied = false;
    try {
      const config = buildConfig();
      if (
        !Number.isInteger(config.max_retries) ||
        config.max_retries < 0 ||
        !Number.isFinite(config.priority) ||
        !Number.isFinite(config.timeout_seconds) ||
        config.timeout_seconds <= 0
      )
        throw new Error(
          "Enter valid retry, priority and timeout values. Retries may be zero.",
        );
      const existingInst = instanceForProvider(store, config.id);
      // An empty edit means keep: resolve the saved key only at submission,
      // never prefill it into a field or overwrite a user's new input.
      if (editing && !form.apiKey) {
        const endpoint = (provider: ProviderConfig) =>
          (
            provider.base_url ||
            providerTypeMeta(provider.provider_type).defaultBaseUrl ||
            ""
          )
            .trim()
            .replace(/\/+$/, "");
        const scopeChanged =
          editing.provider_type !== config.provider_type ||
          endpoint(editing) !== endpoint(config) ||
          (editing.org_id || "") !== (config.org_id || "") ||
          (editing.region || "") !== (config.region || "") ||
          (editing.project_id || "") !== (config.project_id || "");
        if (scopeChanged && (existingInst?.credentialRefId || editing.api_key))
          throw new Error(
            "The provider or credential destination changed. Enter a replacement API key; the saved key will not be sent to a different endpoint or account.",
          );
        if (existingInst?.credentialRefId) {
          const secret = await store.readSecretState(existingInst);
          if (secret.status !== "loaded")
            throw new Error(
              "The saved API key could not be read. Unlock the credential store or enter a replacement key.",
            );
          config.api_key = secret.value;
        } else config.api_key = editing.api_key ?? null;
      }
      if (meta.requiresApiKey && !config.api_key)
        throw new Error("Enter an API key for this provider.");
      if (editing) {
        await mgr.run(() => mgr.api.updateProvider(config));
      } else {
        await mgr.run(() => mgr.api.addProvider(config));
      }
      applied = true;
      // Persist non-secret config + api key (vault) for rehydration on restart.
      const persistConfig: ProviderConfig = { ...config, api_key: null };
      const fields = { config: JSON.stringify(persistConfig) };
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
      await mgr.refreshConfig();
      setForm((current) => ({ ...current, apiKey: "" }));
      onDone();
    } catch (error) {
      setSaveError(
        `${applied ? "Provider applied to this running session, but could not be saved for restart. " : ""}${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    buildConfig,
    editing,
    mgr,
    store,
    form.apiKey,
    onDone,
    meta.requiresApiKey,
  ]);

  return (
    <div className={card}>
      <p className="text-xs text-[var(--color-textMuted)]">
        Choose a provider, then add its endpoint and credentials. Available
        adapters have different capabilities; use a health check and a test
        request to verify your setup. Saved keys stay in the credential store,
        not this form.
      </p>
      {form.providerType === "aws_bedrock" && (
        <p className="text-xs text-warning">
          This adapter currently uses an OpenAI-compatible endpoint, not native
          AWS request signing.
        </p>
      )}
      {form.providerType === "local" && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Start an OpenAI-compatible local server first. This app does not load
          model files in-process.
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-xs text-error">
          {saveError}
        </p>
      )}
      <fieldset disabled={saving} className="min-w-0 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={t("integrations.llm.providerType", "Provider")}>
            <Select
              settingKey="llm.provider.type"
              label="Provider"
              searchable
              value={form.providerType}
              onChange={(value) => {
                const pt = value as ProviderType;
                setForm((f) => ({
                  ...f,
                  providerType: pt,
                  baseUrl:
                    !f.baseUrl ||
                    f.baseUrl ===
                      providerTypeMeta(f.providerType).defaultBaseUrl
                      ? providerTypeMeta(pt).defaultBaseUrl
                      : f.baseUrl,
                }));
              }}
              options={PROVIDER_TYPES.map((p) => ({
                value: p.value,
                label: p.displayName,
              }))}
            />
          </Labeled>
          <Labeled label={t("integrations.llm.displayName", "Display name")}>
            <input
              className={field}
              data-setting-key="llm.provider.displayName"
              value={form.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              placeholder={meta.displayName}
            />
          </Labeled>
          {meta.requiresApiKey && (
            <Labeled label={t("integrations.llm.apiKey", "API key")}>
              <PasswordInput
                className={field}
                data-setting-key="llm.provider.apiKey"
                autoComplete="new-password"
                revealable={false}
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
                placeholder={
                  editing
                    ? t(
                        "integrations.llm.apiKeyUnchanged",
                        "leave blank to keep",
                      )
                    : "sk-..."
                }
              />
            </Labeled>
          )}
          <Labeled label={t("integrations.llm.baseUrl", "Base URL")}>
            <input
              className={field}
              data-setting-key="llm.provider.baseUrl"
              value={form.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              placeholder={meta.defaultBaseUrl || "https://..."}
            />
          </Labeled>
          <Labeled label={t("integrations.llm.defaultModel", "Default model")}>
            <input
              className={field}
              data-setting-key="llm.provider.defaultModel"
              value={form.defaultModel}
              onChange={(e) => set("defaultModel", e.target.value)}
              placeholder="gpt-4o"
            />
          </Labeled>
        </div>
        <details className="rounded-md border border-[var(--color-border)] p-3">
          <summary className="cursor-pointer text-xs font-medium">
            Advanced provider options
          </summary>
          <p className="my-3 text-xs text-[var(--color-textMuted)]">
            Optional organization, routing priority and request limits. Most
            providers work with these defaults.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {form.providerType === "aws_bedrock" && (
              <Labeled label={t("integrations.llm.region", "Region")}>
                <input
                  className={field}
                  data-setting-key="llm.provider.region"
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
                  data-setting-key="llm.provider.orgId"
                  value={form.orgId}
                  onChange={(e) => set("orgId", e.target.value)}
                />
              </Labeled>
            )}
            <Labeled label={t("integrations.llm.priority", "Priority")}>
              <input
                className={field}
                inputMode="numeric"
                data-setting-key="llm.provider.priority"
                value={form.priority}
                onChange={(e) => set("priority", e.target.value)}
              />
            </Labeled>
            <Labeled label={t("integrations.llm.timeout", "Timeout (seconds)")}>
              <input
                className={field}
                inputMode="numeric"
                data-setting-key="llm.provider.timeoutSeconds"
                value={form.timeoutSeconds}
                onChange={(e) => set("timeoutSeconds", e.target.value)}
              />
            </Labeled>
            <Labeled label={t("integrations.llm.maxRetries", "Max retries")}>
              <input
                className={field}
                inputMode="numeric"
                data-setting-key="llm.provider.maxRetries"
                value={form.maxRetries}
                onChange={(e) => set("maxRetries", e.target.value)}
              />
            </Labeled>
          </div>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              data-setting-key="llm.provider.enabled"
              type="checkbox"
              className="sor-settings-checkbox"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            {t("integrations.llm.enabled", "Enabled")}
          </label>
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={primaryBtn}
          onClick={save}
          disabled={
            saving ||
            (!form.displayName &&
              !providerTypeMeta(form.providerType).displayName)
          }
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {editing
            ? t("integrations.llm.update", "Update provider")
            : t("integrations.llm.saveProvider", "Save provider")}
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
  const [formVersion, setFormVersion] = useState(0);
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
        await mgr.refreshConfig();
      } catch (error) {
        mgr.setError(error instanceof Error ? error.message : String(error));
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
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-[var(--color-textMuted)]">
        Add your first provider, check its connection, then choose the default
        used for requests. Health checks may contact the provider.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={primaryBtn}
          onClick={() => {
            setEditing(undefined);
            setFormVersion((value) => value + 1);
            setShowForm(true);
          }}
        >
          <Plus size={12} />
          {t("integrations.llm.addProvider", "Add provider")}
        </button>
        <button
          className={btn}
          onClick={() => void mgr.refreshProviders()}
          disabled={mgr.isLoading}
        >
          <RefreshCw size={12} />
          {t("integrations.llm.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={checkAll}
          disabled={mgr.isLoading || mgr.providers.length === 0}
        >
          <Gauge size={12} />
          {t("integrations.llm.healthCheckAll", "Health check all")}
        </button>
      </div>

      <details
        open={showForm}
        onToggle={(event) => setShowForm(event.currentTarget.open)}
        className="rounded-lg border border-[var(--color-border)]"
      >
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          {editing
            ? `Edit ${editing.display_name || editing.id}`
            : "Provider connection details"}
        </summary>
        <ProviderForm
          key={`${editing?.id ?? "new"}-${formVersion}`}
          mgr={mgr}
          store={store}
          editing={editing}
          onDone={() => {
            setShowForm(false);
            setEditing(undefined);
            setFormVersion((value) => value + 1);
          }}
        />
      </details>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.llm.name", "Name")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.llm.providerType", "Provider")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.llm.priority", "Priority")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.llm.status", "Status")}
              </th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {mgr.providers.map((p) => {
              const h = health[p.id];
              const isDefault = defaultProvider === p.id;
              return (
                <tr
                  key={p.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-2 py-1 text-[var(--color-text)]">
                    {p.display_name || p.id}
                    <span className="mt-1 block text-xs font-normal text-[var(--color-textMuted)]">
                      {p.default_model || "No default model"}
                    </span>
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
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {p.priority}
                  </td>
                  <td className="px-2 py-1">
                    {h ? (
                      <span
                        className={h.healthy ? "text-success" : "text-error"}
                      >
                        {h.healthy && (
                          <CheckCircle2
                            aria-hidden="true"
                            className="mr-1 inline h-3.5 w-3.5"
                          />
                        )}
                        {h.healthy
                          ? `${t("integrations.llm.healthy", "healthy")}${h.latency_ms != null ? ` · ${h.latency_ms}ms` : ""}`
                          : t("integrations.llm.unhealthy", "unhealthy")}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-textMuted)]">
                        Not checked
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end gap-1">
                      <button
                        className={btn}
                        disabled={mgr.isLoading}
                        onClick={() => void checkOne(p)}
                      >
                        {t("integrations.llm.check", "Check")}
                      </button>
                      {!isDefault && (
                        <button
                          className={btn}
                          disabled={mgr.isLoading || !p.enabled}
                          onClick={() => void setDefault(p)}
                        >
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
                      <button
                        className={`${btn} text-error`}
                        disabled={mgr.isLoading}
                        aria-label={`Remove ${p.display_name || p.id}`}
                        onClick={() => void remove(p)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {mgr.providers.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={5}
                >
                  {t("integrations.llm.noProviders", "No providers configured")}
                  <p className="mt-1 text-xs">
                    Start with Add provider, then choose a model and try a
                    request.
                  </p>
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
  const [draft, setDraft] = useState<LlmConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState(false);
  const cfg = draft ?? mgr.config;

  const patch = useCallback(
    (updater: (c: LlmConfig) => LlmConfig) => {
      if (!cfg) return;
      const next = updater(cfg);
      setDraft(next);
      setApplied(false);
    },
    [cfg],
  );

  const setStrategy = useCallback(
    (strategy: BalancerStrategy) => {
      patch((config) => ({
        ...config,
        balancer: { ...config.balancer, strategy },
      }));
    },
    [patch],
  );
  const apply = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const next = {
        ...draft,
        default_provider: mgr.config?.default_provider ?? null,
      };
      await mgr.run(() => mgr.api.updateConfig(next));
      mgr.setConfig(next);
      setDraft(null);
      setApplied(true);
    } catch {
      /* Keep the draft visible; mgr.error explains the failure. */
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) {
    return (
      <div className="text-xs text-[var(--color-textMuted)]">
        {t("integrations.llm.noConfig", "Router config unavailable")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-textMuted)]">
        Choose how requests use your providers. Apply changes explicitly;
        routing and cache configuration are for the current app session and are
        not restored after restart.
      </p>
      <p className="text-xs text-[var(--color-textMuted)]">
        Compatibility fields: default model, sticky sessions and embedding
        caching are retained in configuration but are not currently applied by
        the router. Least-cost routing currently uses priority instead. Health
        checks run only when requested; scheduled checks and cost-alert actions
        are not active.
      </p>
      <fieldset
        disabled={saving || mgr.isLoading}
        className="min-w-0 space-y-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled
            label={t("integrations.llm.balancerStrategy", "Balancer strategy")}
          >
            <Select
              settingKey="llm.router.balancerStrategy"
              label="Balancer strategy"
              value={cfg.balancer.strategy}
              onChange={(value) => setStrategy(value as BalancerStrategy)}
              options={BALANCER_STRATEGIES.map((s) => ({
                value: s,
                label: t(
                  `integrations.llm.strategy.${s}`,
                  s.replace(/_/g, " "),
                ),
              }))}
            />
          </Labeled>
          <Labeled label={t("integrations.llm.defaultModel", "Default model")}>
            <input
              className={field}
              data-setting-key="llm.router.defaultModel"
              value={cfg.default_model ?? ""}
              onChange={(e) =>
                void patch((c) => ({
                  ...c,
                  default_model: e.target.value || null,
                }))
              }
              placeholder="gpt-4o"
            />
          </Labeled>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              data-setting-key="llm.router.failoverEnabled"
              checked={cfg.balancer.failover_enabled}
              onChange={(e) =>
                void patch((c) => ({
                  ...c,
                  balancer: {
                    ...c.balancer,
                    failover_enabled: e.target.checked,
                  },
                }))
              }
            />
            {t("integrations.llm.failover", "Failover enabled")}
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              data-setting-key="llm.router.stickySessions"
              checked={cfg.balancer.sticky_sessions}
              onChange={(e) =>
                void patch((c) => ({
                  ...c,
                  balancer: {
                    ...c.balancer,
                    sticky_sessions: e.target.checked,
                  },
                }))
              }
            />
            {t("integrations.llm.stickySessions", "Sticky sessions")}
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              data-setting-key="llm.router.usageTracking"
              checked={cfg.usage_tracking_enabled}
              onChange={(e) =>
                void patch((c) => ({
                  ...c,
                  usage_tracking_enabled: e.target.checked,
                }))
              }
            />
            {t("integrations.llm.usageTracking", "Usage tracking")}
          </label>
        </div>

        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium">
            Advanced routing and response cache
          </summary>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.llm.cache", "Response cache")}
          </h4>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                data-setting-key="llm.cache.enabled"
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
                data-setting-key="llm.cache.embeddings"
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
                data-setting-key="llm.cache.ttlSeconds"
                value={String(cfg.cache.ttl_seconds)}
                onChange={(e) =>
                  void patch((c) => ({
                    ...c,
                    cache: {
                      ...c.cache,
                      ttl_seconds: Number(e.target.value) || 0,
                    },
                  }))
                }
              />
            </Labeled>
          </div>
        </details>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primaryBtn}
          onClick={() => void apply()}
          disabled={!draft || saving || mgr.isLoading}
        >
          {saving ? "Applying…" : "Apply routing"}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            setDraft(null);
            setApplied(false);
          }}
          disabled={!draft || saving}
        >
          Reset changes
        </button>
        <span role="status" className="text-xs text-[var(--color-textMuted)]">
          {draft
            ? "Unapplied changes"
            : applied
              ? "Applied to this app session"
              : "No pending changes"}
        </span>
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
  const [lookedUp, setLookedUp] = useState(false);

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
      setLookedUp(true);
    } catch {
      /* surfaced */
    }
  }, [mgr, modelId]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-textMuted)]">
        Browse the catalog or filter by provider type. Pricing is catalog
        metadata, not a quote or billing statement.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <button className={btn} onClick={loadAll} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.llm.listModels", "List all models")}
        </button>
        <Labeled label={t("integrations.llm.providerFilter", "Provider (id)")}>
          <input
            className={field}
            data-setting-key="llm.models.providerFilter"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            placeholder="openai"
          />
        </Labeled>
        <button
          className={`${btn} self-end`}
          onClick={loadForProvider}
          disabled={mgr.isLoading}
        >
          {t("integrations.llm.modelsForProvider", "By provider")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.llm.modelId", "Model")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.llm.providerType", "Provider")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.llm.context", "Context")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.llm.cost", "In / Out ($/M)")}
              </th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{m.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {m.provider}
                </td>
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
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={4}
                >
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
              data-setting-key="llm.models.modelId"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="gpt-4o"
            />
          </Labeled>
          <button
            className={`${btn} self-end`}
            onClick={lookup}
            disabled={mgr.isLoading || !modelId}
          >
            {t("integrations.llm.lookup", "Look up")}
          </button>
        </div>
        {info && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Context window"
              value={info.context_window.toLocaleString()}
            />
            <Stat
              label="Input / output per million tokens"
              value={`$${info.input_cost_per_million} / $${info.output_cost_per_million}`}
            />
            <Stat
              label="Capabilities"
              value={
                info.capabilities.join(", ").replace(/_/g, " ") || "Not listed"
              }
            />
          </div>
        )}
        {lookedUp && !info && (
          <p role="status" className="text-xs text-warning">
            No matching model. Check the model ID or browse the catalog above.
          </p>
        )}
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
      setUsage(
        await mgr.run(() => mgr.api.usageSummary(Number(days) || undefined)),
      );
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
            inputMode="numeric"
            data-setting-key="llm.usage.windowDays"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Labeled>
        <button
          className={`${btn} self-end`}
          onClick={loadUsage}
          disabled={mgr.isLoading}
        >
          <RefreshCw size={12} />
          {t("integrations.llm.usageSummary", "Usage summary")}
        </button>
        <button
          className={`${btn} self-end`}
          onClick={loadStatus}
          disabled={mgr.isLoading}
        >
          {t("integrations.llm.routerStatus", "Router status")}
        </button>
        <button
          className={`${btn} self-end`}
          onClick={loadCache}
          disabled={mgr.isLoading}
        >
          {t("integrations.llm.cacheStats", "Cache stats")}
        </button>
        <button
          className={`${btn} self-end text-red-500`}
          onClick={clearCache}
          disabled={mgr.isLoading}
        >
          <Trash2 size={12} />
          {t("integrations.llm.clearCache", "Clear cache")}
        </button>
      </div>

      {status && (
        <div className={card}>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat
              label={t("integrations.llm.providersCount", "Providers")}
              value={`${status.healthy_providers}/${status.total_providers}`}
            />
            <Stat
              label={t("integrations.llm.modelsCount", "Models")}
              value={status.total_models}
            />
            <Stat
              label={t("integrations.llm.requests", "Requests")}
              value={status.total_requests}
            />
            <Stat
              label={t("integrations.llm.cost", "Cost ($)")}
              value={status.total_cost_usd.toFixed(4)}
            />
          </div>
        </div>
      )}

      {cache && (
        <div className={card}>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat
              label={t("integrations.llm.entries", "Entries")}
              value={cache.entries}
            />
            <Stat
              label={t("integrations.llm.hits", "Hits")}
              value={cache.hits}
            />
            <Stat
              label={t("integrations.llm.misses", "Misses")}
              value={cache.misses}
            />
            <Stat
              label={t("integrations.llm.hitRate", "Hit rate")}
              value={`${(cache.hit_rate * 100).toFixed(1)}%`}
            />
          </div>
        </div>
      )}

      {!usage && !status && !cache && (
        <p className="text-sm text-[var(--color-textMuted)]">
          Choose Usage summary, Router status or Cache stats to inspect this
          running session. No background polling is performed here.
        </p>
      )}
      {usage && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Requests" value={usage.total_requests} />
          <Stat label="Tokens" value={usage.total_tokens.toLocaleString()} />
          <Stat
            label="Estimated cost"
            value={`$${usage.total_cost_usd.toFixed(4)}`}
          />
          <Stat
            label="Average latency"
            value={`${Math.round(usage.avg_latency_ms)} ms`}
          />
        </div>
      )}
      <JsonView value={usage} />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="rounded bg-[var(--color-surface)] p-2">
    <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
      {label}
    </div>
    <div className="text-sm font-semibold text-[var(--color-text)]">
      {value}
    </div>
  </div>
);

// ─── Playground sub-panel (chat / embeddings / token estimate) ───────────────

const PlaygroundPanel: React.FC<{ mgr: LlmManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [model, setModel] = useState("");
  const [providerId, setProviderId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [responseText, setResponseText] = useState("");
  const [tokenText, setTokenText] = useState("");
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [embedInput, setEmbedInput] = useState("");
  useEffect(() => {
    if (
      providerId &&
      !mgr.providers.some((p) => p.id === providerId && p.enabled)
    ) {
      setProviderId("");
    }
  }, [providerId, mgr.providers]);

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
      setResponseText(
        res.choices.map((choice) => choice.message.content).join("\n\n"),
      );
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
          input: embedInput
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          provider_id: providerId || undefined,
        }),
      );
      // Embeddings are large; show shape + first vector head only.
      setResponseText(
        `${res.embeddings.length} embeddings created · ${res.embeddings[0]?.length ?? 0} dimensions`,
      );
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
        await mgr.run(() =>
          mgr.api.estimateTokens(tokenText, model || undefined),
        ),
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
            data-setting-key="llm.playground.model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o"
          />
        </Labeled>
        <Labeled
          label={t("integrations.llm.providerOverride", "Provider (optional)")}
        >
          <Select
            label={t(
              "integrations.llm.providerOverride",
              "Provider (optional)",
            )}
            settingKey="llm.playground.providerOverride"
            value={providerId}
            onChange={setProviderId}
            searchable
            options={[
              { value: "", label: "Automatic (default provider)" },
              ...mgr.providers
                .filter((p) => p.enabled)
                .map((p) => ({
                  value: p.id,
                  label: p.display_name || p.id,
                })),
            ]}
          />
        </Labeled>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.chatTest", "Chat completion")}
        </h4>
        <textarea
          aria-label="Chat prompt"
          className={`${field} font-mono`}
          rows={3}
          data-setting-key="llm.playground.prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("integrations.llm.promptPlaceholder", "Say hello...")}
        />
        <button
          className={`${btn} mt-2`}
          onClick={runChat}
          disabled={mgr.isLoading || !model || !prompt}
        >
          {mgr.isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Cpu size={12} />
          )}
          {t("integrations.llm.send", "Send")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.embedTest", "Embeddings (one per line)")}
        </h4>
        <textarea
          aria-label="Embedding input"
          className={`${field} font-mono`}
          rows={3}
          data-setting-key="llm.playground.embedInput"
          value={embedInput}
          onChange={(e) => setEmbedInput(e.target.value)}
          placeholder={"hello world\nfoo bar"}
        />
        <button
          className={`${btn} mt-2`}
          onClick={runEmbedding}
          disabled={mgr.isLoading || !model || !embedInput}
        >
          {t("integrations.llm.embed", "Embed")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.llm.tokenEstimate", "Estimate tokens")}
        </h4>
        <textarea
          aria-label="Text to estimate"
          className={`${field} font-mono`}
          rows={2}
          data-setting-key="llm.playground.tokenText"
          value={tokenText}
          onChange={(e) => setTokenText(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            className={btn}
            onClick={estimate}
            disabled={mgr.isLoading || !tokenText}
          >
            {t("integrations.llm.estimate", "Estimate")}
          </button>
          {tokenCount != null && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {t("integrations.llm.tokens", "tokens")}: {tokenCount}
            </span>
          )}
        </div>
      </div>

      {responseText && (
        <div className={card}>
          <h4 className="text-sm font-medium">Response</h4>
          <p className="whitespace-pre-wrap break-words text-sm">
            {responseText}
          </p>
        </div>
      )}
      <JsonView value={result} />
    </div>
  );
};

// ─── Section root ────────────────────────────────────────────────────────────

function AiDisclosure({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl">
        <span className="text-primary">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-1 block text-xs text-[var(--color-textMuted)]">
            {description}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-[var(--color-border)] p-4">
        <Card>{children}</Card>
      </div>
    </details>
  );
}

const AiSettings: React.FC<{ highlightKey?: string | null }> = ({
  highlightKey = null,
}) => {
  const { t } = useTranslation();
  const mgr = useLlm();
  const store = useIntegrationConfigStore();
  const latest = useRef({ mgr, store });
  latest.current = { mgr, store };
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useSettingHighlight(ready ? highlightKey : null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    // Settings search tags the exact anchor. Reveal only its local ancestors;
    // all controls stay mounted so drafts and search anchors survive disclosure.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (
          !(target instanceof HTMLElement) ||
          target.dataset.testid !== "settings-search-highlight"
        )
          continue;
        let parent = target.parentElement;
        while (parent && parent !== element) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() =>
          target.scrollIntoView({ block: "center", behavior: "smooth" }),
        );
      }
    });
    observer.observe(element, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-testid"],
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (store.isLoading) return;
    let cancelled = false;
    const { mgr: manager, store: saved } = latest.current;
    setBooting(true);
    setReady(false);
    setBootError(null);
    void (async () => {
      try {
        if (saved.error) throw new Error(saved.error);
        // Use throwing API calls, not refresh helpers that turn failed reads
        // into empty lists. No credentials are read until BOTH reads succeed.
        const [live, config] = await Promise.all([
          manager.api.listProviders(),
          manager.api.getConfig(),
        ]);
        if (!Array.isArray(live) || !config?.balancer || !config?.cache)
          throw new Error(
            "The AI backend returned an incomplete configuration.",
          );
        if (cancelled) return;
        const liveIds = new Set(live.map((provider) => provider.id));
        let added = false;
        for (const instance of saved.instances.filter(
          (item) => item.integrationKey === LLM_KEY,
        )) {
          const provider = providerFromInstance(instance);
          if (!provider || liveIds.has(provider.id)) continue;
          const secret = await saved.readSecretState(instance);
          if (cancelled) return;
          if (secret.status === "failed")
            throw new Error(
              "A saved provider key is unavailable. Unlock the credential store and retry.",
            );
          await manager.api.addProvider({
            ...provider,
            api_key: secret.status === "loaded" ? secret.value : null,
          });
          if (cancelled) return;
          liveIds.add(provider.id);
          added = true;
        }
        const providers = added ? await manager.api.listProviders() : live;
        const currentConfig = added ? await manager.api.getConfig() : config;
        if (cancelled) return;
        manager.setProviders(providers);
        manager.setConfig(currentConfig);
        manager.clearError();
        setReady(true);
      } catch (error) {
        if (!cancelled)
          setBootError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store.isLoading, retry]);

  const retrySetup = async () => {
    if (booting) return;
    try {
      if (store.error) await store.reload();
    } catch (error) {
      setBootError(error instanceof Error ? error.message : String(error));
      return;
    }
    setRetry((value) => value + 1);
  };
  return (
    <div
      ref={root}
      className="space-y-5 min-w-0 [&_input[type=checkbox]]:accent-primary"
      data-testid="section-ai"
    >
      <SectionHeading
        icon={<BrainCircuit className="w-5 h-5 text-primary" />}
        title={t("integrations.llm.tabTitle", "AI / LLM Router")}
        description="Connect an AI provider, choose how requests are routed, and test your setup. Provider keys are kept in the credential store, separate from settings."
      />
      {booting || store.isLoading ? (
        <Card>
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            Loading AI configuration…
          </p>
        </Card>
      ) : null}
      {bootError && (
        <Card>
          <div role="alert" className="flex items-start gap-3 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0 space-y-2">
              <p className="font-medium">AI backend unavailable</p>
              <p className="text-xs text-[var(--color-textMuted)]">
                No provider configuration was saved. Check that this desktop
                build includes the AI backend, then retry.
              </p>
              <p className="break-words text-xs text-warning">{bootError}</p>
              <button
                className={btn}
                onClick={() => void retrySetup()}
                disabled={booting}
              >
                <RefreshCw size={14} />
                Retry AI setup
              </button>
            </div>
          </div>
        </Card>
      )}
      {ready && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Configured providers" value={mgr.providers.length} />
            <Stat
              label="Default provider"
              value={
                mgr.providers.find(
                  (item) => item.id === mgr.config?.default_provider,
                )?.display_name || "Not selected"
              }
            />
            <Stat
              label="Routing"
              value={(
                mgr.config?.balancer.strategy ?? "Not configured"
              ).replace(/_/g, " ")}
            />
          </div>
          {(mgr.error || store.error) && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-error/30 bg-error/10 p-3 text-xs text-error"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words">
                {mgr.error || store.error}
              </span>
              {mgr.error && (
                <button type="button" className={btn} onClick={mgr.clearError}>
                  Dismiss
                </button>
              )}
            </div>
          )}
          <div className="space-y-3">
            <SectionHeader
              title="1. Connect your providers"
              icon={<Server className="h-4 w-4 text-primary" />}
            />
            <Card>
              <ProvidersPanel mgr={mgr} store={store} />
            </Card>
          </div>
          <AiDisclosure
            title="2. Routing & defaults"
            description="Default model, failover and response caching. Changes apply to this app session."
            icon={<CircuitBoard className="h-4 w-4" />}
          >
            <RouterPanel mgr={mgr} />
          </AiDisclosure>
          <AiDisclosure
            title="Model catalog"
            description="Browse models and inspect their context limits, capabilities and pricing metadata."
            icon={<Cpu className="h-4 w-4" />}
          >
            <ModelsPanel mgr={mgr} />
          </AiDisclosure>
          <AiDisclosure
            title="Usage & cache"
            description="Inspect request totals, cost estimates and the response cache."
            icon={<Gauge className="h-4 w-4" />}
          >
            <UsagePanel mgr={mgr} />
          </AiDisclosure>
          <AiDisclosure
            title="Test your setup"
            description="Send a chat request, create embeddings or estimate tokens. Provider requests may incur charges."
            icon={<BrainCircuit className="h-4 w-4" />}
          >
            <PlaygroundPanel mgr={mgr} />
          </AiDisclosure>
        </>
      )}
    </div>
  );
};

export default AiSettings;
