// useLlm — real Tauri `invoke(...)` wrappers for the sorng-llm backend.
//
// Binds all 20 `llm_*` commands registered in `sorng-llm/src/commands.rs`.
// sorng-llm is a *router/aggregator* over many LLM providers (not a single
// connection): it owns a set of `ProviderConfig`s, a load balancer, a response
// cache and a usage tracker. Command arg names below are camelCase; Tauri v2
// maps them to the snake_case Rust `#[tauri::command]` params (`providerId`,
// `modelId`). The `config`/`request` payloads mirror the crate's serde wire
// shape, which — unlike most integration crates — has NO container rename, so
// its fields are snake_case (see `src/types/llm.ts`).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BalancerStrategy,
  CacheStats,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  LlmConfig,
  LlmStatus,
  ModelInfo,
  ProviderConfig,
  ProviderHealth,
  UsageSummary,
} from "../../types/llm";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const llmApi = {
  // Provider management
  addProvider: (config: ProviderConfig) =>
    invoke<void>("llm_add_provider", { config }),
  removeProvider: (providerId: string) =>
    invoke<boolean>("llm_remove_provider", { providerId }),
  updateProvider: (config: ProviderConfig) =>
    invoke<void>("llm_update_provider", { config }),
  listProviders: () => invoke<ProviderConfig[]>("llm_list_providers"),
  setDefaultProvider: (providerId: string) =>
    invoke<void>("llm_set_default_provider", { providerId }),

  // Chat completion
  chatCompletion: (request: ChatCompletionRequest) =>
    invoke<ChatCompletionResponse>("llm_chat_completion", { request }),

  // Embeddings
  createEmbedding: (request: EmbeddingRequest) =>
    invoke<EmbeddingResponse>("llm_create_embedding", { request }),

  // Model catalog
  listModels: () => invoke<ModelInfo[]>("llm_list_models"),
  modelsForProvider: (provider: string) =>
    invoke<ModelInfo[]>("llm_models_for_provider", { provider }),
  modelInfo: (modelId: string) =>
    invoke<ModelInfo | null>("llm_model_info", { modelId }),

  // Health
  healthCheck: (providerId: string) =>
    invoke<ProviderHealth>("llm_health_check", { providerId }),
  healthCheckAll: () => invoke<ProviderHealth[]>("llm_health_check_all"),

  // Usage & stats
  usageSummary: (days?: number) =>
    invoke<UsageSummary>("llm_usage_summary", { days }),
  cacheStats: () => invoke<CacheStats>("llm_cache_stats"),
  clearCache: () => invoke<void>("llm_clear_cache"),
  status: () => invoke<LlmStatus>("llm_status"),

  // Config
  getConfig: () => invoke<LlmConfig>("llm_get_config"),
  updateConfig: (config: LlmConfig) =>
    invoke<void>("llm_update_config", { config }),
  setBalancerStrategy: (strategy: BalancerStrategy) =>
    invoke<void>("llm_set_balancer_strategy", { strategy }),

  // Token estimation
  estimateTokens: (text: string, model?: string) =>
    invoke<number>("llm_estimate_tokens", { text, model }),
};

export type LlmApi = typeof llmApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful LLM-router hook. Keeps a live mirror of the registered providers and
 * the router config, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api`. The `run` wrapper funnels arbitrary ops
 * through the same loading/error handling. Unlike the connection-oriented
 * integration hooks there is no single connect id — the router holds many
 * providers, so callers refresh the provider/config lists after mutating.
 */
export function useLlm() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setIsLoading(false);
    }
  }, []);

  const refreshProviders = useCallback(async (): Promise<ProviderConfig[]> => {
    try {
      const list = await llmApi.listProviders();
      setProviders(list);
      return list;
    } catch (e) {
      setError(errMsg(e));
      return [];
    }
  }, []);

  const refreshConfig = useCallback(async (): Promise<LlmConfig | null> => {
    try {
      const cfg = await llmApi.getConfig();
      setConfig(cfg);
      return cfg;
    } catch (e) {
      setError(errMsg(e));
      return null;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    providers,
    config,
    isLoading,
    error,
    setError,
    clearError,
    // refreshers
    refreshProviders,
    refreshConfig,
    setProviders,
    setConfig,
    // full registered command surface + shared runner
    api: llmApi,
    run,
  };
}

export type LlmManager = ReturnType<typeof useLlm>;
