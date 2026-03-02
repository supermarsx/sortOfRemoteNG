use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::config::{BalancerConfig, BalancerStrategy};
use crate::error::{LlmError, LlmResult};
use crate::provider::LlmProvider;
use crate::types::ProviderHealth;

/// Health state tracked per provider
struct ProviderState {
    healthy: bool,
    last_check: Instant,
    avg_latency_ms: f64,
    request_count: u64,
    error_count: u64,
    consecutive_failures: u32,
    circuit_open: bool,
    circuit_open_until: Option<Instant>,
    weight: f64,
}

impl Default for ProviderState {
    fn default() -> Self {
        Self {
            healthy: true,
            last_check: Instant::now(),
            avg_latency_ms: 0.0,
            request_count: 0,
            error_count: 0,
            consecutive_failures: 0,
            circuit_open: false,
            circuit_open_until: None,
            weight: 1.0,
        }
    }
}

impl ProviderState {
    fn is_available(&self) -> bool {
        if self.circuit_open {
            if let Some(until) = self.circuit_open_until {
                if Instant::now() > until {
                    return true; // half-open: allow one probe
                }
            }
            return false;
        }
        self.healthy
    }

    fn record_success(&mut self, latency_ms: u64) {
        self.request_count += 1;
        self.consecutive_failures = 0;
        self.circuit_open = false;
        self.circuit_open_until = None;
        self.healthy = true;
        // Exponential moving average
        let alpha = 0.1;
        self.avg_latency_ms = self.avg_latency_ms * (1.0 - alpha) + latency_ms as f64 * alpha;
    }

    fn record_failure(&mut self) {
        self.request_count += 1;
        self.error_count += 1;
        self.consecutive_failures += 1;
        // Open circuit after 3 consecutive failures
        if self.consecutive_failures >= 3 {
            self.circuit_open = true;
            // Exponential backoff: 30s, 60s, 120s, ...
            let backoff_secs =
                30u64 * 2u64.saturating_pow(self.consecutive_failures.saturating_sub(3));
            let backoff_secs = backoff_secs.min(600); // cap at 10 minutes
            self.circuit_open_until = Some(Instant::now() + Duration::from_secs(backoff_secs));
        }
    }
}

/// Load balancer / failover manager for LLM providers
pub struct LoadBalancer {
    config: BalancerConfig,
    states: HashMap<String, ProviderState>,
    round_robin_index: usize,
}

impl LoadBalancer {
    pub fn new(config: BalancerConfig) -> Self {
        Self {
            config,
            states: HashMap::new(),
            round_robin_index: 0,
        }
    }

    /// Register a provider for balancing
    pub fn register(&mut self, provider_id: &str) {
        self.states
            .entry(provider_id.to_string())
            .or_insert_with(ProviderState::default);
    }

    /// Remove a provider
    pub fn unregister(&mut self, provider_id: &str) {
        self.states.remove(provider_id);
    }

    /// Select the next provider based on strategy
    pub fn select(&mut self, available_ids: &[String], priorities: &HashMap<String, i32>) -> LlmResult<String> {
        let candidates: Vec<&String> = available_ids
            .iter()
            .filter(|id| {
                self.states
                    .get(id.as_str())
                    .map(|s| s.is_available())
                    .unwrap_or(true)
            })
            .collect();

        if candidates.is_empty() {
            return Err(LlmError::all_providers_failed(vec![]));
        }

        let selected = match self.config.strategy {
            BalancerStrategy::Priority => {
                candidates
                    .iter()
                    .min_by_key(|id| priorities.get(id.as_str()).copied().unwrap_or(i32::MAX))
                    .unwrap()
            }
            BalancerStrategy::RoundRobin => {
                self.round_robin_index = (self.round_robin_index) % candidates.len();
                let pick = candidates[self.round_robin_index];
                self.round_robin_index += 1;
                pick
            }
            BalancerStrategy::LeastLatency => {
                candidates
                    .iter()
                    .min_by(|a, b| {
                        let la = self.states.get(a.as_str()).map(|s| s.avg_latency_ms).unwrap_or(f64::MAX);
                        let lb = self.states.get(b.as_str()).map(|s| s.avg_latency_ms).unwrap_or(f64::MAX);
                        la.partial_cmp(&lb).unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .unwrap()
            }
            BalancerStrategy::LeastCost => {
                // Cost-based selection requires external info; fall back to priority
                candidates
                    .iter()
                    .min_by_key(|id| priorities.get(id.as_str()).copied().unwrap_or(i32::MAX))
                    .unwrap()
            }
            BalancerStrategy::Random => {
                let idx = rand::random::<usize>() % candidates.len();
                candidates[idx]
            }
            BalancerStrategy::WeightedRandom => {
                let total_weight: f64 = candidates
                    .iter()
                    .map(|id| self.states.get(id.as_str()).map(|s| s.weight).unwrap_or(1.0))
                    .sum();
                let mut r = rand::random::<f64>() * total_weight;
                let mut picked = candidates[0];
                for c in &candidates {
                    let w = self.states.get(c.as_str()).map(|s| s.weight).unwrap_or(1.0);
                    r -= w;
                    if r <= 0.0 {
                        picked = c;
                        break;
                    }
                }
                picked
            }
        };

        Ok(selected.to_string())
    }

    /// Record a successful request
    pub fn record_success(&mut self, provider_id: &str, latency_ms: u64) {
        if let Some(state) = self.states.get_mut(provider_id) {
            state.record_success(latency_ms);
        }
    }

    /// Record a failed request
    pub fn record_failure(&mut self, provider_id: &str) {
        if let Some(state) = self.states.get_mut(provider_id) {
            state.record_failure();
        }
    }

    /// Get failover candidates (excluding failed provider)
    pub fn failover_candidates(&self, failed_id: &str, available_ids: &[String]) -> Vec<String> {
        if !self.config.failover_enabled {
            return Vec::new();
        }
        available_ids
            .iter()
            .filter(|id| {
                id.as_str() != failed_id
                    && self
                        .states
                        .get(id.as_str())
                        .map(|s| s.is_available())
                        .unwrap_or(true)
            })
            .cloned()
            .collect()
    }

    /// Get health status for all providers
    pub fn health_snapshot(&self) -> Vec<ProviderHealthSnapshot> {
        self.states
            .iter()
            .map(|(id, state)| ProviderHealthSnapshot {
                provider_id: id.clone(),
                healthy: state.is_available(),
                avg_latency_ms: state.avg_latency_ms,
                request_count: state.request_count,
                error_count: state.error_count,
                circuit_open: state.circuit_open,
            })
            .collect()
    }

    /// Update strategy at runtime
    pub fn set_strategy(&mut self, strategy: BalancerStrategy) {
        self.config.strategy = strategy;
    }

    /// Set weight for a provider (used by WeightedRandom)
    pub fn set_weight(&mut self, provider_id: &str, weight: f64) {
        if let Some(state) = self.states.get_mut(provider_id) {
            state.weight = weight;
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderHealthSnapshot {
    pub provider_id: String,
    pub healthy: bool,
    pub avg_latency_ms: f64,
    pub request_count: u64,
    pub error_count: u64,
    pub circuit_open: bool,
}
