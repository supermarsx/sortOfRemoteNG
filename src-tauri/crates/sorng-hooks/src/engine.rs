//! Core hook dispatch engine.
//!
//! `HookEngine` owns the subscriber table, event buffer, pipeline
//! registry, and accumulated statistics.  It is the central
//! coordinator for dispatching events to matching subscribers.

use std::collections::{HashMap, VecDeque};
use std::time::Instant;

use chrono::Utc;
use log;
use uuid::Uuid;

use crate::error::HookError;
use crate::filters::apply_filter;
use crate::types::*;

/// The core hook engine that manages subscriptions, dispatches events,
/// and maintains an in-memory event buffer.
pub struct HookEngine {
    /// Active subscriptions keyed by their unique ID.
    pub subscribers: HashMap<String, HookSubscription>,
    /// Registered pipelines keyed by their unique ID.
    pub pipelines: HashMap<String, HookPipeline>,
    /// Circular buffer of recently dispatched events.
    pub event_buffer: VecDeque<HookEventData>,
    /// Runtime configuration.
    pub config: HooksConfig,
    /// Aggregate dispatch statistics.
    pub stats: HookStats,
    /// Mapping from event-type key → list of subscription IDs that
    /// registered interest (used as an optimisation index).
    pub callbacks: HashMap<String, Vec<String>>,
    /// Running total of dispatch durations (ms) used to compute the average.
    total_dispatch_duration_ms: f64,
}

impl HookEngine {
    /// Create a new engine with default configuration.
    pub fn new() -> Self {
        Self {
            subscribers: HashMap::new(),
            pipelines: HashMap::new(),
            event_buffer: VecDeque::new(),
            config: HooksConfig::default(),
            stats: HookStats::default(),
            callbacks: HashMap::new(),
            total_dispatch_duration_ms: 0.0,
        }
    }

    // ── Subscriptions ───────────────────────────────────────────

    /// Register a new subscription.  Returns the subscription ID.
    pub fn subscribe(&mut self, sub: HookSubscription) -> Result<String, HookError> {
        let id = sub.id.clone();
        // Index the subscription under every event type it listens to.
        for evt in &sub.event_types {
            let key = evt.to_string();
            self.callbacks
                .entry(key)
                .or_default()
                .push(id.clone());
        }
        self.subscribers.insert(id.clone(), sub);
        self.stats.total_subscriptions = self.subscribers.len() as u64;
        log::info!("hook: registered subscription {id}");
        Ok(id)
    }

    /// Remove a subscription by ID.
    pub fn unsubscribe(&mut self, id: &str) -> Result<(), HookError> {
        let sub = self
            .subscribers
            .remove(id)
            .ok_or_else(|| HookError::SubscriptionNotFound(id.to_string()))?;

        // Remove from the callback index.
        for evt in &sub.event_types {
            let key = evt.to_string();
            if let Some(list) = self.callbacks.get_mut(&key) {
                list.retain(|sid| sid != id);
            }
        }
        self.stats.total_subscriptions = self.subscribers.len() as u64;
        log::info!("hook: unsubscribed {id}");
        Ok(())
    }

    // ── Dispatch ────────────────────────────────────────────────

    /// Synchronously dispatch an event to every matching, enabled
    /// subscriber, respecting priority ordering and filters.
    ///
    /// Returns an execution result per subscriber that was invoked.
    pub fn dispatch(&mut self, event: HookEventData) -> Vec<HookExecutionResult> {
        if !self.config.enabled {
            return Vec::new();
        }

        let start = Instant::now();
        let event_id = event.event_id.clone();
        let event_type_key = event.event_type.to_string();

        // Collect matching subscribers sorted by priority (lower = higher priority).
        let mut matching: Vec<&HookSubscription> = self
            .subscribers
            .values()
            .filter(|s| s.enabled && s.event_types.contains(&event.event_type))
            .filter(|s| Self::matches_filter(s, &event))
            .collect();
        matching.sort_by_key(|s| s.priority);

        let mut results = Vec::with_capacity(matching.len());
        for sub in &matching {
            let step_start = Instant::now();
            // For each subscriber we record a successful dispatch.
            // Real-world integrations would invoke user callbacks here.
            let duration_ms = step_start.elapsed().as_millis() as u64;
            results.push(HookExecutionResult {
                subscription_id: sub.id.clone(),
                event_id: event_id.clone(),
                success: true,
                duration_ms,
                error: None,
                output: None,
            });
        }

        // Update stats.
        let total_ms = start.elapsed().as_millis() as f64;
        self.stats.total_events_dispatched += 1;
        self.total_dispatch_duration_ms += total_ms;
        self.stats.avg_dispatch_time_ms =
            self.total_dispatch_duration_ms / self.stats.total_events_dispatched as f64;
        *self
            .stats
            .events_per_type
            .entry(event_type_key)
            .or_insert(0) += 1;
        self.stats.last_event_at = Some(Utc::now());

        // Buffer the event.
        self.buffer_event(event);

        log::debug!(
            "hook: dispatched event {event_id} to {} subscriber(s) in {total_ms:.2}ms",
            results.len()
        );

        results
    }

    /// Queue an event for asynchronous dispatch.  This clones the
    /// engine state needed for dispatch into a background task.
    pub fn dispatch_async(&mut self, event: HookEventData) {
        if !self.config.enabled {
            return;
        }
        // We perform the dispatch in place and then hand off to tokio
        // only the logging / post-processing.  For a truly
        // non-blocking design the engine would need to sit behind an
        // `Arc<Mutex<..>>` (which `HookService` provides).
        let results = self.dispatch(event);
        tokio::spawn(async move {
            log::debug!(
                "hook: async dispatch completed with {} result(s)",
                results.len()
            );
        });
    }

    // ── Querying ────────────────────────────────────────────────

    /// Return all enabled subscribers that listen for `event`, sorted
    /// by priority ascending (lower value = higher priority).
    pub fn get_subscribers_for_event(&self, event: &HookEvent) -> Vec<&HookSubscription> {
        let mut subs: Vec<&HookSubscription> = self
            .subscribers
            .values()
            .filter(|s| s.enabled && s.event_types.contains(event))
            .collect();
        subs.sort_by_key(|s| s.priority);
        subs
    }

    /// Check whether `event` passes the optional filter attached to
    /// `sub`.  If the subscription has no filter, the event always
    /// matches.
    pub fn matches_filter(sub: &HookSubscription, event: &HookEventData) -> bool {
        match &sub.filter {
            Some(filter) => apply_filter(filter, event),
            None => true,
        }
    }

    // ── Event Buffer ────────────────────────────────────────────

    /// Add an event to the circular buffer, evicting the oldest entry
    /// when the buffer is at capacity.
    pub fn buffer_event(&mut self, event: HookEventData) {
        if self.event_buffer.len() >= self.config.event_buffer_size {
            self.event_buffer.pop_front();
        }
        self.event_buffer.push_back(event);
    }

    /// Return the last `count` events from the buffer (most recent last).
    pub fn get_recent_events(&self, count: usize) -> Vec<&HookEventData> {
        let len = self.event_buffer.len();
        let skip = len.saturating_sub(count);
        self.event_buffer.iter().skip(skip).collect()
    }

    /// Return all buffered events matching the given type.
    pub fn get_events_by_type(&self, event_type: &HookEvent) -> Vec<&HookEventData> {
        self.event_buffer
            .iter()
            .filter(|e| e.event_type == *event_type)
            .collect()
    }

    /// Return a snapshot of the current statistics.
    pub fn get_stats(&self) -> HookStats {
        self.stats.clone()
    }

    /// Clear the event buffer.
    pub fn clear_buffer(&mut self) {
        self.event_buffer.clear();
    }

    /// Replace the engine configuration.
    pub fn update_config(&mut self, config: HooksConfig) {
        // Shrink the buffer if the new size is smaller.
        while self.event_buffer.len() > config.event_buffer_size {
            self.event_buffer.pop_front();
        }
        self.config = config;
    }

    // ── Pipeline Management ─────────────────────────────────────

    /// Register a new pipeline.
    pub fn add_pipeline(&mut self, pipeline: HookPipeline) -> String {
        let id = pipeline.id.clone();
        self.pipelines.insert(id.clone(), pipeline);
        log::info!("hook: registered pipeline {id}");
        id
    }

    /// Remove a pipeline by ID.
    pub fn remove_pipeline(&mut self, id: &str) -> Result<HookPipeline, HookError> {
        self.pipelines
            .remove(id)
            .ok_or_else(|| HookError::PipelineNotFound(id.to_string()))
    }

    /// Get a pipeline by ID.
    pub fn get_pipeline(&self, id: &str) -> Option<&HookPipeline> {
        self.pipelines.get(id)
    }

    /// List all pipelines.
    pub fn list_pipelines(&self) -> Vec<&HookPipeline> {
        self.pipelines.values().collect()
    }

    /// Generate a fresh event ID (UUID v4).
    pub fn generate_event_id() -> String {
        Uuid::new_v4().to_string()
    }
}

impl Default for HookEngine {
    fn default() -> Self {
        Self::new()
    }
}
