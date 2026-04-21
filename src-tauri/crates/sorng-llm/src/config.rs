use crate::types::{ModelCapability, ModelInfo, ProviderType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Provider Configuration ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub provider_type: ProviderType,
    pub display_name: String,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub org_id: Option<String>,
    pub project_id: Option<String>,
    pub default_model: Option<String>,
    pub enabled: bool,
    pub priority: i32,
    pub rate_limit: Option<RateLimitConfig>,
    pub timeout_seconds: u64,
    pub max_retries: u32,
    pub custom_headers: HashMap<String, String>,
    /// Azure-specific deployment mappings: model_id -> deployment_name
    pub deployments: HashMap<String, String>,
    /// AWS Bedrock region
    pub region: Option<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            provider_type: ProviderType::OpenAi,
            display_name: String::new(),
            api_key: None,
            base_url: None,
            org_id: None,
            project_id: None,
            default_model: None,
            enabled: true,
            priority: 0,
            rate_limit: None,
            timeout_seconds: 120,
            max_retries: 3,
            custom_headers: HashMap::new(),
            deployments: HashMap::new(),
            region: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    pub requests_per_minute: u32,
    pub tokens_per_minute: u32,
    pub requests_per_day: Option<u32>,
    pub concurrent_requests: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            requests_per_minute: 60,
            tokens_per_minute: 150_000,
            requests_per_day: None,
            concurrent_requests: 10,
        }
    }
}

// ── Cache Configuration ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheConfig {
    pub enabled: bool,
    pub max_entries: usize,
    pub ttl_seconds: u64,
    pub max_memory_mb: u64,
    pub cache_embeddings: bool,
    pub cache_tool_calls: bool,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_entries: 1000,
            ttl_seconds: 3600,
            max_memory_mb: 256,
            cache_embeddings: true,
            cache_tool_calls: false,
        }
    }
}

// ── Load Balancer Configuration ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalancerConfig {
    pub strategy: BalancerStrategy,
    pub health_check_interval_seconds: u64,
    pub failover_enabled: bool,
    pub sticky_sessions: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BalancerStrategy {
    Priority,
    RoundRobin,
    LeastLatency,
    LeastCost,
    Random,
    WeightedRandom,
}

impl Default for BalancerConfig {
    fn default() -> Self {
        Self {
            strategy: BalancerStrategy::Priority,
            health_check_interval_seconds: 300,
            failover_enabled: true,
            sticky_sessions: false,
        }
    }
}

// ── Global LLM Configuration ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub cache: CacheConfig,
    pub balancer: BalancerConfig,
    pub usage_tracking_enabled: bool,
    pub cost_alerts: Vec<CostAlert>,
    pub model_aliases: HashMap<String, String>,
    pub fallback_chain: Vec<String>,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            default_provider: None,
            default_model: None,
            cache: CacheConfig::default(),
            balancer: BalancerConfig::default(),
            usage_tracking_enabled: true,
            cost_alerts: Vec::new(),
            model_aliases: HashMap::new(),
            fallback_chain: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostAlert {
    pub threshold_usd: f64,
    pub period: AlertPeriod,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertPeriod {
    Daily,
    Weekly,
    Monthly,
}

// ── Model Catalog ──────────────────────────────────────────────────────

pub fn build_model_catalog() -> Vec<ModelInfo> {
    let mut models = Vec::new();

    // ─── OpenAI ────
    let openai_models = vec![
        (
            "gpt-4o",
            "GPT-4o",
            128_000,
            Some(16_384),
            true,
            true,
            2.50,
            10.00,
            "2024-10",
        ),
        (
            "gpt-4o-mini",
            "GPT-4o Mini",
            128_000,
            Some(16_384),
            true,
            true,
            0.15,
            0.60,
            "2024-10",
        ),
        (
            "gpt-4-turbo",
            "GPT-4 Turbo",
            128_000,
            Some(4_096),
            true,
            true,
            10.00,
            30.00,
            "2024-04",
        ),
        (
            "gpt-4",
            "GPT-4",
            8_192,
            Some(8_192),
            false,
            true,
            30.00,
            60.00,
            "2023-09",
        ),
        (
            "gpt-3.5-turbo",
            "GPT-3.5 Turbo",
            16_385,
            Some(4_096),
            false,
            true,
            0.50,
            1.50,
            "2021-09",
        ),
        (
            "o1",
            "o1",
            200_000,
            Some(100_000),
            true,
            true,
            15.00,
            60.00,
            "2024-10",
        ),
        (
            "o1-mini",
            "o1 Mini",
            128_000,
            Some(65_536),
            false,
            true,
            3.00,
            12.00,
            "2024-10",
        ),
        (
            "o1-pro",
            "o1 Pro",
            200_000,
            Some(100_000),
            true,
            true,
            150.00,
            600.00,
            "2024-10",
        ),
        (
            "o3-mini",
            "o3 Mini",
            200_000,
            Some(100_000),
            false,
            true,
            1.10,
            4.40,
            "2025-01",
        ),
    ];

    for (id, name, ctx, max_out, vision, tools, inp_cost, out_cost, cutoff) in openai_models {
        let mut caps = vec![
            ModelCapability::Chat,
            ModelCapability::CodeGeneration,
            ModelCapability::FunctionCalling,
        ];
        if vision {
            caps.push(ModelCapability::ImageAnalysis);
        }
        if id.starts_with("o1") || id.starts_with("o3") {
            caps.push(ModelCapability::Reasoning);
        }
        if ctx >= 100_000 {
            caps.push(ModelCapability::LongContext);
        }
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider: "openai".to_string(),
            context_window: ctx,
            max_output_tokens: max_out,
            supports_vision: vision,
            supports_tools: tools,
            supports_streaming: true,
            supports_json_mode: true,
            supports_system_message: true,
            input_cost_per_million: inp_cost,
            output_cost_per_million: out_cost,
            capabilities: caps,
            knowledge_cutoff: Some(cutoff.to_string()),
            deprecated: false,
        });
    }

    // ─── Anthropic ────
    let anthropic_models = vec![
        (
            "claude-sonnet-4-20250514",
            "Claude Sonnet 4",
            200_000,
            Some(64_000),
            true,
            true,
            3.00,
            15.00,
            "2025-04",
        ),
        (
            "claude-3-5-sonnet-20241022",
            "Claude 3.5 Sonnet",
            200_000,
            Some(8_192),
            true,
            true,
            3.00,
            15.00,
            "2024-04",
        ),
        (
            "claude-3-5-haiku-20241022",
            "Claude 3.5 Haiku",
            200_000,
            Some(8_192),
            true,
            true,
            0.80,
            4.00,
            "2024-07",
        ),
        (
            "claude-3-opus-20240229",
            "Claude 3 Opus",
            200_000,
            Some(4_096),
            true,
            true,
            15.00,
            75.00,
            "2024-02",
        ),
        (
            "claude-opus-4-20250514",
            "Claude Opus 4",
            200_000,
            Some(64_000),
            true,
            true,
            15.00,
            75.00,
            "2025-04",
        ),
    ];

    for (id, name, ctx, max_out, vision, tools, inp_cost, out_cost, cutoff) in anthropic_models {
        let mut caps = vec![
            ModelCapability::Chat,
            ModelCapability::CodeGeneration,
            ModelCapability::FunctionCalling,
            ModelCapability::LongContext,
        ];
        if vision {
            caps.push(ModelCapability::ImageAnalysis);
        }
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider: "anthropic".to_string(),
            context_window: ctx,
            max_output_tokens: max_out,
            supports_vision: vision,
            supports_tools: tools,
            supports_streaming: true,
            supports_json_mode: true,
            supports_system_message: true,
            input_cost_per_million: inp_cost,
            output_cost_per_million: out_cost,
            capabilities: caps,
            knowledge_cutoff: Some(cutoff.to_string()),
            deprecated: false,
        });
    }

    // ─── Google Gemini ────
    let google_models = vec![
        (
            "gemini-2.0-flash",
            "Gemini 2.0 Flash",
            1_048_576,
            Some(8_192),
            true,
            true,
            0.10,
            0.40,
            "2025-01",
        ),
        (
            "gemini-2.0-flash-lite",
            "Gemini 2.0 Flash Lite",
            1_048_576,
            Some(8_192),
            true,
            false,
            0.075,
            0.30,
            "2025-01",
        ),
        (
            "gemini-1.5-pro",
            "Gemini 1.5 Pro",
            2_097_152,
            Some(8_192),
            true,
            true,
            1.25,
            5.00,
            "2024-09",
        ),
        (
            "gemini-1.5-flash",
            "Gemini 1.5 Flash",
            1_048_576,
            Some(8_192),
            true,
            true,
            0.075,
            0.30,
            "2024-09",
        ),
    ];

    for (id, name, ctx, max_out, vision, tools, inp_cost, out_cost, cutoff) in google_models {
        let mut caps = vec![
            ModelCapability::Chat,
            ModelCapability::CodeGeneration,
            ModelCapability::LongContext,
            ModelCapability::Multilingual,
        ];
        if vision {
            caps.push(ModelCapability::ImageAnalysis);
        }
        if tools {
            caps.push(ModelCapability::FunctionCalling);
        }
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider: "google".to_string(),
            context_window: ctx,
            max_output_tokens: max_out,
            supports_vision: vision,
            supports_tools: tools,
            supports_streaming: true,
            supports_json_mode: true,
            supports_system_message: true,
            input_cost_per_million: inp_cost,
            output_cost_per_million: out_cost,
            capabilities: caps,
            knowledge_cutoff: Some(cutoff.to_string()),
            deprecated: false,
        });
    }

    // ─── Groq ────
    for (id, name, ctx) in [
        ("llama-3.3-70b-versatile", "Llama 3.3 70B", 128_000),
        ("llama-3.1-8b-instant", "Llama 3.1 8B", 131_072),
        ("mixtral-8x7b-32768", "Mixtral 8x7B", 32_768),
        ("gemma2-9b-it", "Gemma 2 9B", 8_192),
    ] {
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider: "groq".to_string(),
            context_window: ctx,
            max_output_tokens: Some(8_192),
            supports_vision: false,
            supports_tools: true,
            supports_streaming: true,
            supports_json_mode: true,
            supports_system_message: true,
            input_cost_per_million: 0.05,
            output_cost_per_million: 0.08,
            capabilities: vec![
                ModelCapability::Chat,
                ModelCapability::CodeGeneration,
                ModelCapability::FunctionCalling,
            ],
            knowledge_cutoff: None,
            deprecated: false,
        });
    }

    // ─── Mistral ────
    for (id, name, ctx, inp, out) in [
        ("mistral-large-latest", "Mistral Large", 128_000, 2.00, 6.00),
        (
            "mistral-medium-latest",
            "Mistral Medium",
            32_000,
            2.70,
            8.10,
        ),
        ("mistral-small-latest", "Mistral Small", 32_000, 0.20, 0.60),
        ("codestral-latest", "Codestral", 32_000, 0.20, 0.60),
        ("open-mixtral-8x22b", "Mixtral 8x22B", 65_536, 2.00, 6.00),
    ] {
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider: "mistral".to_string(),
            context_window: ctx,
            max_output_tokens: Some(8_192),
            supports_vision: false,
            supports_tools: true,
            supports_streaming: true,
            supports_json_mode: true,
            supports_system_message: true,
            input_cost_per_million: inp,
            output_cost_per_million: out,
            capabilities: vec![
                ModelCapability::Chat,
                ModelCapability::CodeGeneration,
                ModelCapability::FunctionCalling,
            ],
            knowledge_cutoff: None,
            deprecated: false,
        });
    }

    // ─── DeepSeek ────
    for (id, name, ctx, inp, out, reasoning) in [
        ("deepseek-chat", "DeepSeek V3", 64_000, 0.27, 1.10, false),
        ("deepseek-reasoner", "DeepSeek R1", 64_000, 0.55, 2.19, true),
    ] {
        let mut caps = vec![
            ModelCapability::Chat,
            ModelCapability::CodeGeneration,
            ModelCapability::FunctionCalling,
        ];
        if reasoning {
            caps.push(ModelCapability::Reasoning);
        }
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider: "deepseek".to_string(),
            context_window: ctx,
            max_output_tokens: Some(8_192),
            supports_vision: false,
            supports_tools: true,
            supports_streaming: true,
            supports_json_mode: true,
            supports_system_message: true,
            input_cost_per_million: inp,
            output_cost_per_million: out,
            capabilities: caps,
            knowledge_cutoff: None,
            deprecated: false,
        });
    }

    // ─── Cohere ────
    for (id, name, ctx, inp, out) in [
        ("command-r-plus", "Command R+", 128_000, 2.50, 10.00),
        ("command-r", "Command R", 128_000, 0.15, 0.60),
        ("command-light", "Command Light", 4_096, 0.30, 0.60),
    ] {
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider: "cohere".to_string(),
            context_window: ctx,
            max_output_tokens: Some(4_096),
            supports_vision: false,
            supports_tools: true,
            supports_streaming: true,
            supports_json_mode: false,
            supports_system_message: true,
            input_cost_per_million: inp,
            output_cost_per_million: out,
            capabilities: vec![ModelCapability::Chat, ModelCapability::FunctionCalling],
            knowledge_cutoff: None,
            deprecated: false,
        });
    }

    models
}
