use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::config::RateLimitConfig;
use crate::error::{LlmError, LlmResult};

/// Sliding-window rate limiter for a single provider
struct ProviderLimiter {
    config: RateLimitConfig,
    request_timestamps: Vec<Instant>,
    token_timestamps: Vec<(Instant, u32)>,
    daily_count: u32,
    day_start: Instant,
    active_requests: u32,
}

impl ProviderLimiter {
    fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            request_timestamps: Vec::new(),
            token_timestamps: Vec::new(),
            daily_count: 0,
            day_start: Instant::now(),
            active_requests: 0,
        }
    }

    fn cleanup_window(&mut self) {
        let one_minute_ago = Instant::now() - Duration::from_secs(60);
        self.request_timestamps.retain(|t| *t > one_minute_ago);
        self.token_timestamps.retain(|(t, _)| *t > one_minute_ago);

        // Reset daily counter if 24h passed
        if self.day_start.elapsed() > Duration::from_secs(86_400) {
            self.daily_count = 0;
            self.day_start = Instant::now();
        }
    }

    #[allow(clippy::result_large_err)]
    fn check_capacity(&mut self, estimated_tokens: u32) -> LlmResult<()> {
        self.cleanup_window();

        // Check concurrent limit
        if self.active_requests >= self.config.concurrent_requests {
            return Err(LlmError::rate_limited("provider", None));
        }

        // Check RPM
        if self.request_timestamps.len() as u32 >= self.config.requests_per_minute {
            let oldest = self.request_timestamps.first().expect("checked len >= rpm_limit above");
            let wait = Duration::from_secs(60)
                .checked_sub(oldest.elapsed())
                .unwrap_or_default();
            return Err(LlmError::rate_limited("provider", Some(wait.as_secs())));
        }

        // Check TPM
        let tokens_used: u32 = self.token_timestamps.iter().map(|(_, t)| t).sum();
        if tokens_used + estimated_tokens > self.config.tokens_per_minute {
            return Err(LlmError::rate_limited("provider", Some(30)));
        }

        // Check daily limit
        if let Some(daily_limit) = self.config.requests_per_day {
            if self.daily_count >= daily_limit {
                return Err(LlmError::rate_limited("provider", Some(3600)));
            }
        }

        Ok(())
    }

    fn acquire(&mut self) {
        let now = Instant::now();
        self.request_timestamps.push(now);
        self.daily_count += 1;
        self.active_requests += 1;
    }

    fn release(&mut self, tokens_used: u32) {
        self.active_requests = self.active_requests.saturating_sub(1);
        self.token_timestamps.push((Instant::now(), tokens_used));
    }
}

/// Manages rate limiting across all providers
pub struct RateLimitManager {
    limiters: HashMap<String, ProviderLimiter>,
}

impl Default for RateLimitManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimitManager {
    pub fn new() -> Self {
        Self {
            limiters: HashMap::new(),
        }
    }

    /// Register a provider with its rate limit config
    pub fn register(&mut self, provider_id: &str, config: RateLimitConfig) {
        self.limiters
            .insert(provider_id.to_string(), ProviderLimiter::new(config));
    }

    /// Remove a provider
    pub fn unregister(&mut self, provider_id: &str) {
        self.limiters.remove(provider_id);
    }

    /// Check if a request can be made (and acquire the slot)
    #[allow(clippy::result_large_err)]
    pub fn try_acquire(&mut self, provider_id: &str, estimated_tokens: u32) -> LlmResult<()> {
        if let Some(limiter) = self.limiters.get_mut(provider_id) {
            limiter.check_capacity(estimated_tokens)?;
            limiter.acquire();
            Ok(())
        } else {
            Ok(()) // No limiter = no limiting
        }
    }

    /// Release a slot and record token usage
    pub fn release(&mut self, provider_id: &str, tokens_used: u32) {
        if let Some(limiter) = self.limiters.get_mut(provider_id) {
            limiter.release(tokens_used);
        }
    }

    /// Get current usage stats for a provider
    pub fn provider_stats(&mut self, provider_id: &str) -> Option<RateLimitStats> {
        if let Some(limiter) = self.limiters.get_mut(provider_id) {
            limiter.cleanup_window();
            let tokens_used: u32 = limiter.token_timestamps.iter().map(|(_, t)| t).sum();
            Some(RateLimitStats {
                requests_this_minute: limiter.request_timestamps.len() as u32,
                tokens_this_minute: tokens_used,
                requests_today: limiter.daily_count,
                active_requests: limiter.active_requests,
                rpm_limit: limiter.config.requests_per_minute,
                tpm_limit: limiter.config.tokens_per_minute,
            })
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitStats {
    pub requests_this_minute: u32,
    pub tokens_this_minute: u32,
    pub requests_today: u32,
    pub active_requests: u32,
    pub rpm_limit: u32,
    pub tpm_limit: u32,
}
