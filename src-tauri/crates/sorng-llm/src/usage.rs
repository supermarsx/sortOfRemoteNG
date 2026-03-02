use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use chrono::{Utc, DateTime};

use crate::types::TokenUsage;

/// Tracks token and cost usage across providers and models
pub struct UsageTracker {
    records: Vec<UsageRecord>,
    daily_totals: HashMap<String, DailyUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageRecord {
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub cost_usd: f64,
    pub cached: bool,
    pub latency_ms: u64,
    pub request_type: RequestType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestType {
    Chat,
    Streaming,
    Embedding,
    ToolCall,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DailyUsage {
    pub date: String,
    pub total_requests: u64,
    pub total_tokens: u64,
    pub total_cost_usd: f64,
    pub by_provider: HashMap<String, ProviderDailyUsage>,
    pub by_model: HashMap<String, ModelDailyUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderDailyUsage {
    pub requests: u64,
    pub tokens: u64,
    pub cost_usd: f64,
    pub errors: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelDailyUsage {
    pub requests: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    pub total_requests: u64,
    pub total_tokens: u64,
    pub total_cost_usd: f64,
    pub avg_tokens_per_request: f64,
    pub avg_cost_per_request: f64,
    pub avg_latency_ms: f64,
    pub cache_hit_rate: f64,
    pub by_provider: HashMap<String, ProviderUsageSummary>,
    pub by_model: HashMap<String, ModelUsageSummary>,
    pub daily_usage: Vec<DailyUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderUsageSummary {
    pub requests: u64,
    pub tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelUsageSummary {
    pub requests: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cost_usd: f64,
}

impl UsageTracker {
    pub fn new() -> Self {
        Self {
            records: Vec::new(),
            daily_totals: HashMap::new(),
        }
    }

    /// Record a completed request
    pub fn record(
        &mut self,
        provider: &str,
        model: &str,
        usage: &TokenUsage,
        cost_usd: f64,
        cached: bool,
        latency_ms: u64,
        request_type: RequestType,
    ) {
        let now = Utc::now();
        let date_key = now.format("%Y-%m-%d").to_string();

        let record = UsageRecord {
            timestamp: now.to_rfc3339(),
            provider: provider.to_string(),
            model: model.to_string(),
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cost_usd,
            cached,
            latency_ms,
            request_type,
        };
        self.records.push(record);

        // Update daily totals
        let daily = self.daily_totals.entry(date_key.clone()).or_insert_with(|| DailyUsage {
            date: date_key,
            ..Default::default()
        });
        daily.total_requests += 1;
        daily.total_tokens += usage.total_tokens as u64;
        daily.total_cost_usd += cost_usd;

        let prov = daily.by_provider.entry(provider.to_string()).or_default();
        prov.requests += 1;
        prov.tokens += usage.total_tokens as u64;
        prov.cost_usd += cost_usd;

        let mdl = daily.by_model.entry(model.to_string()).or_default();
        mdl.requests += 1;
        mdl.prompt_tokens += usage.prompt_tokens as u64;
        mdl.completion_tokens += usage.completion_tokens as u64;
        mdl.cost_usd += cost_usd;
    }

    /// Calculate cost for a given usage and model info
    pub fn calculate_cost(usage: &TokenUsage, input_cost_per_million: f64, output_cost_per_million: f64) -> f64 {
        let input_cost = (usage.prompt_tokens as f64 / 1_000_000.0) * input_cost_per_million;
        let output_cost = (usage.completion_tokens as f64 / 1_000_000.0) * output_cost_per_million;
        input_cost + output_cost
    }

    /// Get summary for a date range
    pub fn summary(&self, days: Option<u32>) -> UsageSummary {
        let cutoff = days.map(|d| {
            Utc::now() - chrono::Duration::days(d as i64)
        });

        let filtered: Vec<&UsageRecord> = self
            .records
            .iter()
            .filter(|r| {
                if let Some(cutoff) = cutoff {
                    if let Ok(ts) = r.timestamp.parse::<DateTime<Utc>>() {
                        return ts > cutoff;
                    }
                }
                true
            })
            .collect();

        let total_requests = filtered.len() as u64;
        let total_tokens: u64 = filtered.iter().map(|r| r.total_tokens as u64).sum();
        let total_cost: f64 = filtered.iter().map(|r| r.cost_usd).sum();
        let total_latency: u64 = filtered.iter().map(|r| r.latency_ms).sum();
        let cached_count = filtered.iter().filter(|r| r.cached).count() as u64;

        let mut by_provider: HashMap<String, ProviderUsageSummary> = HashMap::new();
        let mut by_model: HashMap<String, ModelUsageSummary> = HashMap::new();

        for r in &filtered {
            let p = by_provider.entry(r.provider.clone()).or_default();
            p.requests += 1;
            p.tokens += r.total_tokens as u64;
            p.cost_usd += r.cost_usd;

            let m = by_model.entry(r.model.clone()).or_default();
            m.requests += 1;
            m.prompt_tokens += r.prompt_tokens as u64;
            m.completion_tokens += r.completion_tokens as u64;
            m.cost_usd += r.cost_usd;
        }

        let mut daily_usage: Vec<DailyUsage> = self.daily_totals.values().cloned().collect();
        daily_usage.sort_by(|a, b| a.date.cmp(&b.date));

        UsageSummary {
            total_requests,
            total_tokens,
            total_cost_usd: total_cost,
            avg_tokens_per_request: if total_requests > 0 {
                total_tokens as f64 / total_requests as f64
            } else {
                0.0
            },
            avg_cost_per_request: if total_requests > 0 {
                total_cost / total_requests as f64
            } else {
                0.0
            },
            avg_latency_ms: if total_requests > 0 {
                total_latency as f64 / total_requests as f64
            } else {
                0.0
            },
            cache_hit_rate: if total_requests > 0 {
                cached_count as f64 / total_requests as f64
            } else {
                0.0
            },
            by_provider,
            by_model,
            daily_usage,
        }
    }

    /// Get today's total cost
    pub fn today_cost(&self) -> f64 {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        self.daily_totals
            .get(&today)
            .map(|d| d.total_cost_usd)
            .unwrap_or(0.0)
    }

    /// Clear all records
    pub fn clear(&mut self) {
        self.records.clear();
        self.daily_totals.clear();
    }

    /// Recent records (last N)
    pub fn recent(&self, count: usize) -> Vec<&UsageRecord> {
        self.records.iter().rev().take(count).collect()
    }
}
