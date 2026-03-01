// ── Token Counting & Budget Management ───────────────────────────────────────

use std::collections::HashMap;
use chrono::Utc;

use super::types::*;
use super::AI_TOKEN_USAGE;

// ── Token Estimation ─────────────────────────────────────────────────────────

pub fn count_tokens_tiktoken(text: &str) -> u32 {
    match tiktoken_rs::cl100k_base() {
        Ok(bpe) => bpe.encode_ordinary(text).len() as u32,
        Err(_) => estimate_tokens_heuristic(text),
    }
}

pub fn estimate_tokens_heuristic(text: &str) -> u32 {
    ((text.len() as f64) / 3.5).ceil() as u32
}

pub fn count_message_tokens(messages: &[ChatMessage]) -> u32 {
    let mut total: u32 = 0;
    for msg in messages {
        total += 4;
        for block in &msg.content {
            match block {
                ContentBlock::Text { text } => total += count_tokens_tiktoken(text),
                ContentBlock::Image { .. } => total += 85,
            }
        }
        if let Some(name) = &msg.name {
            total += count_tokens_tiktoken(name);
        }
    }
    total += 2;
    total
}

pub fn count_tokens_for_provider(text: &str, provider: &AiProvider) -> u32 {
    match provider {
        AiProvider::OpenAi | AiProvider::AzureOpenAi | AiProvider::Groq => count_tokens_tiktoken(text),
        AiProvider::Anthropic => count_tokens_tiktoken(text),
        _ => estimate_tokens_heuristic(text),
    }
}

pub fn count_tokens(text: &str, provider: &AiProvider, model: &str) -> TokenCountResult {
    let token_count = count_tokens_for_provider(text, provider);
    TokenCountResult {
        text: text.to_string(),
        token_count,
        model: model.to_string(),
        encoding: match provider {
            AiProvider::OpenAi | AiProvider::AzureOpenAi | AiProvider::Groq | AiProvider::Anthropic => "cl100k_base".into(),
            _ => "heuristic".into(),
        },
    }
}

// ── Cost Estimation ──────────────────────────────────────────────────────────

pub fn estimate_cost(prompt_tokens: u32, completion_tokens: u32, input_cost_per_1k: f64, output_cost_per_1k: f64) -> f64 {
    (prompt_tokens as f64 / 1000.0) * input_cost_per_1k + (completion_tokens as f64 / 1000.0) * output_cost_per_1k
}

pub fn estimate_cost_for_model(usage: &TokenUsage, model: &str, provider: &AiProvider) -> f64 {
    let (ic, oc) = get_model_pricing(model, provider);
    estimate_cost(usage.prompt_tokens, usage.completion_tokens, ic, oc)
}

pub fn get_model_pricing(model: &str, provider: &AiProvider) -> (f64, f64) {
    match provider {
        AiProvider::OpenAi => match model {
            m if m.starts_with("gpt-4o-mini") => (0.00015, 0.0006),
            m if m.starts_with("gpt-4o") => (0.0025, 0.01),
            m if m.starts_with("gpt-4-turbo") => (0.01, 0.03),
            m if m.starts_with("o4-mini") => (0.0011, 0.0044),
            m if m.starts_with("o3") => (0.01, 0.04),
            _ => (0.005, 0.015),
        },
        AiProvider::Anthropic => match model {
            m if m.contains("opus") => (0.015, 0.075),
            m if m.contains("sonnet") => (0.003, 0.015),
            m if m.contains("haiku") => (0.0008, 0.004),
            _ => (0.003, 0.015),
        },
        AiProvider::GoogleGemini => match model {
            m if m.contains("2.5-pro") => (0.00125, 0.01),
            m if m.contains("2.5-flash") => (0.00015, 0.0035),
            m if m.contains("2.0-flash") => (0.0001, 0.0004),
            _ => (0.0005, 0.002),
        },
        AiProvider::Groq => (0.0003, 0.0003),
        AiProvider::Mistral => match model {
            m if m.contains("large") => (0.002, 0.006),
            m if m.contains("small") => (0.0002, 0.0006),
            _ => (0.001, 0.003),
        },
        AiProvider::Cohere => match model {
            m if m.contains("command-r-plus") | m.contains("command-a") => (0.0025, 0.01),
            _ => (0.00015, 0.0006),
        },
        AiProvider::Ollama => (0.0, 0.0),
        _ => (0.001, 0.003),
    }
}

// ── Budget Tracking ──────────────────────────────────────────────────────────

pub struct BudgetTracker {
    pub configs: HashMap<String, BudgetConfig>,
    pub usage: HashMap<String, BudgetUsageEntry>,
}

pub struct BudgetUsageEntry {
    pub total_tokens: u64,
    pub total_cost: f64,
    pub request_count: u64,
    pub period_start: chrono::DateTime<chrono::Utc>,
}

impl BudgetTracker {
    pub fn new() -> Self {
        Self { configs: HashMap::new(), usage: HashMap::new() }
    }

    pub fn set_budget(&mut self, key: &str, config: BudgetConfig) {
        self.configs.insert(key.to_string(), config);
    }

    pub fn record_usage(&mut self, key: &str, tokens: u32, cost: f64) -> Result<(), String> {
        let entry = self.usage.entry(key.to_string()).or_insert_with(|| BudgetUsageEntry {
            total_tokens: 0, total_cost: 0.0, request_count: 0, period_start: Utc::now(),
        });

        if let Some(config) = self.configs.get(key) {
            let elapsed = Utc::now().signed_duration_since(entry.period_start);
            let period_expired = match &config.reset_period {
                Some(BudgetPeriod::Daily) => elapsed.num_days() >= 1,
                Some(BudgetPeriod::Weekly) => elapsed.num_weeks() >= 1,
                Some(BudgetPeriod::Monthly) => elapsed.num_days() >= 30,
                Some(BudgetPeriod::Never) | None => false,
            };
            if period_expired {
                entry.total_tokens = 0;
                entry.total_cost = 0.0;
                entry.request_count = 0;
                entry.period_start = Utc::now();
            }

            if config.enforce_hard_limit {
                if config.max_total_tokens > 0 && entry.total_tokens + tokens as u64 > config.max_total_tokens {
                    return Err(format!("Token budget exceeded for '{}'", key));
                }
                if config.max_cost_usd > 0.0 && entry.total_cost + cost > config.max_cost_usd {
                    return Err(format!("Cost budget exceeded for '{}'", key));
                }
            }
        }

        entry.total_tokens += tokens as u64;
        entry.total_cost += cost;
        entry.request_count += 1;
        Ok(())
    }

    pub fn get_status(&self, key: &str) -> BudgetStatus {
        let config = self.configs.get(key);
        let usage = self.usage.get(key);
        let total_cost = usage.map(|u| u.total_cost).unwrap_or(0.0);
        let total_tokens = usage.map(|u| u.total_tokens).unwrap_or(0);
        let max_cost = config.map(|c| c.max_cost_usd).unwrap_or(0.0);
        let max_tokens = config.map(|c| c.max_total_tokens).unwrap_or(0);

        let budget_remaining = if max_cost > 0.0 { Some(max_cost - total_cost) } else { None };
        let tokens_remaining = if max_tokens > 0 { Some(max_tokens.saturating_sub(total_tokens)) } else { None };
        let utilization = if max_cost > 0.0 { (total_cost / max_cost * 100.0).min(100.0) } else { 0.0 };
        let warning_threshold = config.and_then(|c| c.warning_threshold).unwrap_or(0.8);

        BudgetStatus {
            total_cost_usd: total_cost,
            total_tokens,
            request_count: usage.map(|u| u.request_count).unwrap_or(0),
            budget_remaining_usd: budget_remaining,
            tokens_remaining,
            budget_utilization_pct: utilization,
            period_start: usage.map(|u| u.period_start),
            period_end: None,
            is_over_budget: (max_cost > 0.0 && total_cost >= max_cost) || (max_tokens > 0 && total_tokens >= max_tokens),
            is_warning: max_cost > 0.0 && total_cost >= max_cost * warning_threshold,
        }
    }
}

// ── Global Usage Tracking ────────────────────────────────────────────────────

pub fn record_global_usage(provider: &AiProvider, usage: &TokenUsage) {
    let key = format!("{:?}", provider);
    if let Ok(mut map) = AI_TOKEN_USAGE.lock() {
        let entry = map.entry(key).or_insert_with(TokenUsage::default);
        entry.prompt_tokens += usage.prompt_tokens;
        entry.completion_tokens += usage.completion_tokens;
        entry.total_tokens += usage.total_tokens;
        entry.estimated_cost += usage.estimated_cost;
    }
}

pub fn get_global_usage() -> HashMap<String, TokenUsage> {
    match AI_TOKEN_USAGE.lock() {
        Ok(map) => map.clone(),
        Err(_) => HashMap::new(),
    }
}

pub fn reset_global_usage(provider: Option<&AiProvider>) {
    if let Ok(mut map) = AI_TOKEN_USAGE.lock() {
        match provider {
            Some(p) => { map.remove(&format!("{:?}", p)); }
            None => map.clear(),
        }
    }
}
