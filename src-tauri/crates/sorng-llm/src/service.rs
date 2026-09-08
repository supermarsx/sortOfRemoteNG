use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::balancer::LoadBalancer;
use crate::cache::ResponseCache;
use crate::config::*;
use crate::error::{LlmError, LlmResult};
use crate::provider::ProviderRegistry;
use crate::providers;
use crate::rate_limit::RateLimitManager;
use crate::tokens::TokenCounter;
use crate::types::*;
use crate::usage::{RequestType, UsageTracker};

/// Tauri-managed state wrapper
#[derive(Clone)]
pub struct LlmServiceState(pub Arc<RwLock<LlmService>>);

/// Unified LLM service — routes requests through cache → rate limiter → load balancer → provider
pub struct LlmService {
    registry: ProviderRegistry,
    cache: ResponseCache,
    rate_limiter: RateLimitManager,
    balancer: LoadBalancer,
    usage_tracker: UsageTracker,
    model_catalog: Vec<ModelInfo>,
    config: LlmConfig,
}

impl LlmService {
    pub fn new(config: LlmConfig) -> Self {
        let model_catalog = build_model_catalog();
        Self {
            registry: ProviderRegistry::new(),
            cache: ResponseCache::new(config.cache.clone()),
            rate_limiter: RateLimitManager::new(),
            balancer: LoadBalancer::new(config.balancer.clone()),
            usage_tracker: UsageTracker::new(),
            model_catalog,
            config,
        }
    }

    // ── Provider Management ────────────────────────────────────────────

    #[allow(clippy::result_large_err)]
    pub fn add_provider(&mut self, config: ProviderConfig) -> LlmResult<()> {
        if self.registry.get_config(&config.id).is_some() {
            return self.update_provider(config);
        }
        let id = config.id.clone();
        let provider = providers::create_provider(&config);

        if let Some(ref rl) = config.rate_limit {
            self.rate_limiter.register(&id, rl.clone());
        }
        self.balancer.register(&id);
        self.registry.register(&id, provider, config);

        if self.registry.default_provider_id().is_none() {
            self.registry.set_default(&id);
        }
        self.config.default_provider = self.registry.default_provider_id().map(str::to_owned);
        self.cache.clear();

        Ok(())
    }

    pub fn remove_provider(&mut self, id: &str) -> bool {
        self.rate_limiter.unregister(id);
        self.balancer.unregister(id);
        let removed = self.registry.unregister(id);
        self.config.default_provider = self.registry.default_provider_id().map(str::to_owned);
        self.cache.clear();
        removed
    }

    #[allow(clippy::result_large_err)]
    pub fn update_provider(&mut self, mut config: ProviderConfig) -> LlmResult<()> {
        let id = config.id.clone();
        let existing = self
            .registry
            .get_config(&id)
            .ok_or_else(|| LlmError::provider_not_found(&id))?;
        // IPC redacts keys. Preserve blank edits only within the same auth scope;
        // never forward the old secret to a new provider, endpoint or tenant.
        if config
            .api_key
            .as_deref()
            .is_none_or(|key| key.trim().is_empty())
        {
            let same_scope = config.provider_type == existing.provider_type
                && config.base_url == existing.base_url
                && config.org_id == existing.org_id
                && config.project_id == existing.project_id
                && config.region == existing.region;
            if same_scope {
                config.api_key = existing.api_key.clone();
            } else if matches!(
                config.provider_type,
                ProviderType::Ollama | ProviderType::Local
            ) {
                config.api_key = None;
            } else {
                return Err(LlmError::invalid_config(
                    "Enter a replacement API key when changing the provider authentication scope",
                ));
            }
        }
        let provider = providers::create_provider(&config);
        self.rate_limiter.unregister(&id);
        if let Some(ref limit) = config.rate_limit {
            self.rate_limiter.register(&id, limit.clone());
        }
        self.balancer.register(&id);
        self.registry.register(&id, provider, config);
        self.cache.clear();
        Ok(())
    }

    pub fn list_providers(&self) -> Vec<ProviderConfig> {
        self.registry.list_configs().into_iter().cloned().collect()
    }

    #[allow(clippy::result_large_err)]
    pub fn set_default_provider(&mut self, id: &str) -> LlmResult<()> {
        if self.registry.get(id).is_some() {
            self.registry.set_default(id);
            self.config.default_provider = Some(id.to_string());
            self.cache.clear();
            Ok(())
        } else {
            Err(LlmError::provider_not_found(id))
        }
    }

    // ── Chat Completion ────────────────────────────────────────────────

    pub async fn chat_completion(
        &mut self,
        request: ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        // 1. Resolve model aliases
        let model = self
            .config
            .model_aliases
            .get(&request.model)
            .cloned()
            .unwrap_or_else(|| request.model.clone());

        let mut req = request.clone();
        req.model = model;

        // Resolve routing before cache lookup so an explicitly disabled provider
        // cannot be bypassed by another provider's cached response.
        let provider_id = if let Some(ref pid) = req.provider_id {
            self.require_enabled_provider(pid)?;
            pid.clone()
        } else {
            self.select_provider(&req.model)?
        };
        req.provider_id = Some(provider_id.clone());
        if let Some(cached) = self.cache.get(&req) {
            return Ok(cached);
        }

        // 4. Rate limit check
        let estimated_tokens = TokenCounter::estimate_messages(&req.messages);
        self.rate_limiter
            .try_acquire(&provider_id, estimated_tokens)?;

        // 5. Execute with fallback
        let start = Instant::now();
        let result = self.execute_with_fallback(&provider_id, &req).await;
        let latency = start.elapsed().as_millis() as u64;

        match result {
            Ok(mut response) => {
                response.latency_ms = latency;

                // 6. Record usage
                let model_info = self.find_model_info(&response.model);
                let cost = model_info
                    .map(|m| {
                        UsageTracker::calculate_cost(
                            &response.usage,
                            m.input_cost_per_million,
                            m.output_cost_per_million,
                        )
                    })
                    .unwrap_or(0.0);

                if self.config.usage_tracking_enabled {
                    self.usage_tracker.record(
                        &response.provider,
                        &response.model,
                        &response.usage,
                        cost,
                        false,
                        latency,
                        RequestType::Chat,
                    );
                }

                // 7. Release rate limiter
                self.rate_limiter
                    .release(&provider_id, response.usage.total_tokens);

                // 8. Update balancer
                self.balancer.record_success(&provider_id, latency);

                // 9. Cache response
                self.cache.put(&req, &response);

                Ok(response)
            }
            Err(e) => {
                self.rate_limiter.release(&provider_id, 0);
                self.balancer.record_failure(&provider_id);
                Err(e)
            }
        }
    }

    async fn execute_with_fallback(
        &self,
        primary_id: &str,
        request: &ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        self.require_enabled_provider(primary_id)?;
        let mut errors = Vec::new();
        // Try primary provider
        if let Some(provider) = self.registry.get(primary_id) {
            match provider.chat_completion(request).await {
                Ok(response) => return Ok(response),
                Err(e) if e.retryable && self.config.balancer.failover_enabled => {
                    log::warn!("Provider {} failed (retryable): {}", primary_id, e);
                    errors.push(e);
                }
                Err(e) => return Err(e),
            }
        }

        // Try fallback chain
        let fallback_ids: Vec<String> = self
            .config
            .fallback_chain
            .iter()
            .filter(|id| id.as_str() != primary_id)
            .cloned()
            .collect();

        for fallback_id in &fallback_ids {
            if self.require_enabled_provider(fallback_id).is_err() {
                continue;
            }
            if let Some(provider) = self.registry.get(fallback_id) {
                match provider.chat_completion(request).await {
                    Ok(mut response) => {
                        response.provider = fallback_id.clone();
                        return Ok(response);
                    }
                    Err(e) => {
                        log::warn!("Fallback provider {} failed: {}", fallback_id, e);
                        errors.push(e);
                    }
                }
            }
        }

        Err(LlmError::all_providers_failed(errors))
    }

    #[allow(clippy::result_large_err)]
    fn select_provider(&mut self, model: &str) -> LlmResult<String> {
        let mut enabled: Vec<_> = self
            .registry
            .list_configs()
            .into_iter()
            .filter(|config| config.enabled)
            .collect();
        enabled.sort_by(|a, b| a.priority.cmp(&b.priority).then_with(|| a.id.cmp(&b.id)));
        let matching: Vec<_> = enabled
            .iter()
            .filter(|config| config.default_model.as_deref() == Some(model))
            .map(|config| config.id.clone())
            .collect();
        // Preserve explicit model affinity. The default is the Priority fallback,
        // not an unconditional shortcut around RoundRobin/other chosen strategies.
        if matching.is_empty() && self.config.balancer.strategy == BalancerStrategy::Priority {
            if let Some(id) = self.registry.default_provider_id() {
                if enabled.iter().any(|config| config.id == id) && self.balancer.is_available(id) {
                    return Ok(id.to_string());
                }
            }
        }
        let available = if matching.is_empty() {
            enabled.iter().map(|config| config.id.clone()).collect()
        } else {
            matching
        };
        let priorities: HashMap<String, i32> = self
            .registry
            .list_configs()
            .iter()
            .map(|c| (c.id.clone(), c.priority))
            .collect();

        self.balancer.select(&available, &priorities)
    }

    #[allow(clippy::result_large_err)]
    fn require_enabled_provider(&self, id: &str) -> LlmResult<()> {
        let config = self
            .registry
            .get_config(id)
            .ok_or_else(|| LlmError::provider_not_found(id))?;
        if !config.enabled {
            return Err(LlmError::invalid_config(
                "The selected LLM provider is disabled",
            ));
        }
        Ok(())
    }

    // ── Embedding ──────────────────────────────────────────────────────

    pub async fn create_embedding(
        &self,
        request: EmbeddingRequest,
    ) -> LlmResult<EmbeddingResponse> {
        let provider_id = request
            .provider_id
            .as_deref()
            .or(self.registry.default_provider_id())
            .ok_or_else(|| LlmError::provider_not_found("none configured"))?
            .to_string();
        self.require_enabled_provider(&provider_id)?;

        let provider = self
            .registry
            .get(&provider_id)
            .ok_or_else(|| LlmError::provider_not_found(&provider_id))?;

        provider.create_embedding(&request).await
    }

    // ── Health ──────────────────────────────────────────────────────────

    pub async fn health_check(&self, provider_id: &str) -> LlmResult<ProviderHealth> {
        let provider = self
            .registry
            .get(provider_id)
            .ok_or_else(|| LlmError::provider_not_found(provider_id))?;

        let start = Instant::now();
        let result = provider.health_check().await;
        let latency = start.elapsed().as_millis() as u64;

        let (healthy, error_msg) = match result {
            Ok(h) => (h, None),
            Err(e) => (false, Some(e.message)),
        };

        Ok(ProviderHealth {
            provider_id: provider_id.to_string(),
            provider_type: provider.provider_type(),
            healthy,
            latency_ms: Some(latency),
            error: error_msg,
            models_available: 0,
            checked_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    pub async fn health_check_all(&self) -> Vec<ProviderHealth> {
        let mut results = Vec::new();
        for id in self.registry.list_ids() {
            if let Ok(health) = self.health_check(&id).await {
                results.push(health);
            }
        }
        results
    }

    // ── Model Catalog ──────────────────────────────────────────────────

    pub fn list_models(&self) -> &[ModelInfo] {
        &self.model_catalog
    }

    pub fn models_for_provider(&self, provider: &str) -> Vec<&ModelInfo> {
        self.model_catalog
            .iter()
            .filter(|m| m.provider == provider)
            .collect()
    }

    fn find_model_info(&self, model_id: &str) -> Option<&ModelInfo> {
        self.model_catalog.iter().find(|m| m.id == model_id)
    }

    pub fn model_info(&self, model_id: &str) -> Option<&ModelInfo> {
        self.find_model_info(model_id)
    }

    // ── Usage / Stats ──────────────────────────────────────────────────

    pub fn usage_summary(&self, days: Option<u32>) -> crate::usage::UsageSummary {
        self.usage_tracker.summary(days)
    }

    pub fn cache_stats(&self) -> crate::cache::CacheStats {
        self.cache.stats()
    }

    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }

    pub fn status(&self) -> LlmStatus {
        let health = self.balancer.health_snapshot();
        let summary = self.usage_tracker.summary(None);
        LlmStatus {
            total_providers: self.registry.provider_count() as u32,
            healthy_providers: health.iter().filter(|h| h.healthy).count() as u32,
            total_models: self.model_catalog.len() as u32,
            total_requests: summary.total_requests,
            total_tokens_used: summary.total_tokens,
            total_cost_usd: summary.total_cost_usd,
            cache_hit_rate: summary.cache_hit_rate,
            providers: health
                .iter()
                .map(|h| ProviderHealth {
                    provider_id: h.provider_id.clone(),
                    provider_type: self
                        .registry
                        .get(&h.provider_id)
                        .map(|p| p.provider_type())
                        .unwrap_or(ProviderType::Custom),
                    healthy: h.healthy,
                    latency_ms: Some(h.avg_latency_ms as u64),
                    error: None,
                    models_available: 0,
                    checked_at: chrono::Utc::now().to_rfc3339(),
                })
                .collect(),
        }
    }

    // ── Config ─────────────────────────────────────────────────────────

    pub fn config(&self) -> &LlmConfig {
        &self.config
    }

    #[allow(clippy::result_large_err)]
    pub fn update_config(&mut self, config: LlmConfig) -> LlmResult<()> {
        if let Some(id) = config.default_provider.as_deref() {
            if self.registry.get(id).is_none() {
                return Err(LlmError::provider_not_found(id));
            }
            self.registry.set_default(id);
        } else {
            self.registry.clear_default();
        }
        self.cache = ResponseCache::new(config.cache.clone());
        self.balancer = LoadBalancer::new(config.balancer.clone());
        for id in self.registry.list_ids() {
            self.balancer.register(&id);
        }
        self.config = config;
        Ok(())
    }

    pub fn set_balancer_strategy(&mut self, strategy: BalancerStrategy) {
        self.balancer.set_strategy(strategy.clone());
        self.config.balancer.strategy = strategy;
        self.cache.clear();
    }
}

/// Create a default LLM service state — convenience factory for Tauri setup.
pub fn create_llm_state() -> LlmServiceState {
    LlmServiceState(Arc::new(RwLock::new(LlmService::new(LlmConfig::default()))))
}

#[cfg(test)]
#[path = "service_settings_tests.rs"]
mod settings_tests;
