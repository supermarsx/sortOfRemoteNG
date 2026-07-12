// LLM router types — camelCase-free 1:1 mirror of the sorng-llm crate wire shape.
//
// Source: `src-tauri/crates/sorng-llm/src/{types,config,usage,cache}.rs`.
// IMPORTANT serde note: unlike most integration crates, sorng-llm does NOT put
// `#[serde(rename_all = "camelCase")]` on its structs, so the JSON wire shape is
// the raw Rust field names — snake_case (`provider_type`, `base_url`,
// `default_model`, `timeout_seconds`, ...). Enums use `rename_all` as noted per
// type below. Keep these field names snake_case so `invoke` payloads
// (de)serialize against the Rust structs unchanged.

// ── Provider types ─────────────────────────────────────────────────────
// Rust: enum ProviderType, #[serde(rename_all = "snake_case")]
export type ProviderType =
  | "open_ai"
  | "anthropic"
  | "google"
  | "ollama"
  | "azure_open_ai"
  | "groq"
  | "mistral"
  | "cohere"
  | "deep_seek"
  | "together"
  | "fireworks"
  | "perplexity"
  | "hugging_face"
  | "aws_bedrock"
  | "open_router"
  | "local"
  | "custom";

/** UI-side mirror of the Rust `ProviderType` helper methods
 *  (`display_name`, `default_base_url`, `requires_api_key`). */
export interface ProviderTypeMeta {
  value: ProviderType;
  displayName: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
}

export const PROVIDER_TYPES: ProviderTypeMeta[] = [
  { value: "open_ai", displayName: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", requiresApiKey: true },
  { value: "anthropic", displayName: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", requiresApiKey: true },
  { value: "google", displayName: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", requiresApiKey: true },
  { value: "ollama", displayName: "Ollama", defaultBaseUrl: "http://localhost:11434", requiresApiKey: false },
  { value: "azure_open_ai", displayName: "Azure OpenAI", defaultBaseUrl: "", requiresApiKey: true },
  { value: "groq", displayName: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1", requiresApiKey: true },
  { value: "mistral", displayName: "Mistral AI", defaultBaseUrl: "https://api.mistral.ai/v1", requiresApiKey: true },
  { value: "cohere", displayName: "Cohere", defaultBaseUrl: "https://api.cohere.ai/v1", requiresApiKey: true },
  { value: "deep_seek", displayName: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1", requiresApiKey: true },
  { value: "together", displayName: "Together AI", defaultBaseUrl: "https://api.together.xyz/v1", requiresApiKey: true },
  { value: "fireworks", displayName: "Fireworks AI", defaultBaseUrl: "https://api.fireworks.ai/inference/v1", requiresApiKey: true },
  { value: "perplexity", displayName: "Perplexity", defaultBaseUrl: "https://api.perplexity.ai", requiresApiKey: true },
  { value: "hugging_face", displayName: "Hugging Face", defaultBaseUrl: "https://api-inference.huggingface.co", requiresApiKey: true },
  { value: "aws_bedrock", displayName: "AWS Bedrock", defaultBaseUrl: "", requiresApiKey: true },
  { value: "open_router", displayName: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", requiresApiKey: true },
  { value: "local", displayName: "Local (GGUF)", defaultBaseUrl: "", requiresApiKey: false },
  { value: "custom", displayName: "Custom", defaultBaseUrl: "", requiresApiKey: true },
];

export function providerTypeMeta(t: ProviderType): ProviderTypeMeta {
  return PROVIDER_TYPES.find((p) => p.value === t) ?? PROVIDER_TYPES[0];
}

// ── Provider configuration (config.rs) ─────────────────────────────────

export interface RateLimitConfig {
  requests_per_minute: number;
  tokens_per_minute: number;
  requests_per_day: number | null;
  concurrent_requests: number;
}

export interface ProviderConfig {
  id: string;
  provider_type: ProviderType;
  display_name: string;
  /** Write-only: sent on add/update, never returned by `llm_list_providers`
   *  (Rust field is `#[serde(skip_serializing)]`). */
  api_key?: string | null;
  base_url?: string | null;
  org_id?: string | null;
  project_id?: string | null;
  default_model?: string | null;
  enabled: boolean;
  priority: number;
  rate_limit?: RateLimitConfig | null;
  timeout_seconds: number;
  max_retries: number;
  custom_headers: Record<string, string>;
  /** Azure-only: model_id -> deployment_name. */
  deployments: Record<string, string>;
  /** AWS Bedrock region. */
  region?: string | null;
}

/** A sensible default matching Rust `ProviderConfig::default()`. */
export function defaultProviderConfig(): ProviderConfig {
  return {
    id: "",
    provider_type: "open_ai",
    display_name: "",
    api_key: null,
    base_url: null,
    org_id: null,
    project_id: null,
    default_model: null,
    enabled: true,
    priority: 0,
    rate_limit: null,
    timeout_seconds: 120,
    max_retries: 3,
    custom_headers: {},
    deployments: {},
    region: null,
  };
}

// ── Cache / balancer / global config ───────────────────────────────────

export interface CacheConfig {
  enabled: boolean;
  max_entries: number;
  ttl_seconds: number;
  max_memory_mb: number;
  cache_embeddings: boolean;
  cache_tool_calls: boolean;
}

// Rust: enum BalancerStrategy, #[serde(rename_all = "snake_case")]
export type BalancerStrategy =
  | "priority"
  | "round_robin"
  | "least_latency"
  | "least_cost"
  | "random"
  | "weighted_random";

export const BALANCER_STRATEGIES: BalancerStrategy[] = [
  "priority",
  "round_robin",
  "least_latency",
  "least_cost",
  "random",
  "weighted_random",
];

export interface BalancerConfig {
  strategy: BalancerStrategy;
  health_check_interval_seconds: number;
  failover_enabled: boolean;
  sticky_sessions: boolean;
}

// Rust: enum AlertPeriod, #[serde(rename_all = "snake_case")]
export type AlertPeriod = "daily" | "weekly" | "monthly";

export interface CostAlert {
  threshold_usd: number;
  period: AlertPeriod;
  enabled: boolean;
}

export interface LlmConfig {
  default_provider?: string | null;
  default_model?: string | null;
  cache: CacheConfig;
  balancer: BalancerConfig;
  usage_tracking_enabled: boolean;
  cost_alerts: CostAlert[];
  model_aliases: Record<string, string>;
  fallback_chain: string[];
}

// ── Model catalog (types.rs) ───────────────────────────────────────────
// Rust: enum ModelCapability, #[serde(rename_all = "snake_case")]
export type ModelCapability =
  | "chat"
  | "completion"
  | "embedding"
  | "image_generation"
  | "image_analysis"
  | "code_generation"
  | "function_calling"
  | "reasoning"
  | "long_context"
  | "multilingual"
  | "audio"
  | "realtime";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  context_window: number;
  max_output_tokens: number | null;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_streaming: boolean;
  supports_json_mode: boolean;
  supports_system_message: boolean;
  input_cost_per_million: number;
  output_cost_per_million: number;
  capabilities: ModelCapability[];
  knowledge_cutoff: string | null;
  deprecated: boolean;
}

// ── Health / status ────────────────────────────────────────────────────

export interface ProviderHealth {
  provider_id: string;
  provider_type: ProviderType;
  healthy: boolean;
  latency_ms: number | null;
  error: string | null;
  models_available: number;
  checked_at: string;
}

export interface LlmStatus {
  total_providers: number;
  healthy_providers: number;
  total_models: number;
  total_requests: number;
  total_tokens_used: number;
  total_cost_usd: number;
  cache_hit_rate: number;
  providers: ProviderHealth[];
}

// ── Usage & cache stats (usage.rs / cache.rs) ──────────────────────────

export interface ProviderUsageSummary {
  requests: number;
  tokens: number;
  cost_usd: number;
  errors: number;
}

export interface ModelUsageSummary {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export interface DailyUsage {
  date: string;
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
  by_provider: Record<string, ProviderUsageSummary>;
  by_model: Record<string, ModelUsageSummary>;
}

export interface UsageSummary {
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_tokens_per_request: number;
  avg_cost_per_request: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
  by_provider: Record<string, ProviderUsageSummary>;
  by_model: Record<string, ModelUsageSummary>;
  daily_usage: DailyUsage[];
}

export interface CacheStats {
  entries: number;
  size_bytes: number;
  hits: number;
  misses: number;
  hit_rate: number;
}

// ── Chat completion / embeddings ───────────────────────────────────────
// Rust: enum MessageRole, #[serde(rename_all = "lowercase")]
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** `MessageContent` is `#[serde(untagged)]` Text(String) | Parts(...). For the
 *  UI playground we only send/receive plain text, so a `string` covers it. */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  seed?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  /** Route this request to a specific provider; omit to use the default. */
  provider_id?: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
}

export interface Choice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Choice[];
  usage: TokenUsage;
  created: number;
  provider: string;
  cached: boolean;
  latency_ms: number;
}

export interface EmbeddingRequest {
  model: string;
  input: string[];
  dimensions?: number;
  provider_id?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: TokenUsage;
  provider: string;
}
