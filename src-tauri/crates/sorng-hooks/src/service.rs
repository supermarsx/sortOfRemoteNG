//! Service façade for the hook engine.
//!
//! Wraps [`HookEngine`] and [`SubscriberRegistry`] behind a single
//! `Arc<Mutex<..>>` state compatible with Tauri's managed-state model.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::engine::HookEngine;
use crate::error::HookError;
use crate::pipeline::{PipelineExecutor, PipelineStepResult};
use crate::subscribers::SubscriberRegistry;
use crate::types::*;

/// Type alias for the Tauri managed state.
pub type HookServiceState = Arc<Mutex<HookService>>;

/// Top-level façade combining the engine and registry.
#[derive(Default)]
pub struct HookService {
    pub engine: HookEngine,
    pub registry: SubscriberRegistry,
}

impl HookService {
    /// Create a new `HookService` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> HookServiceState {
        let service = Self {
            engine: HookEngine::new(),
            registry: SubscriberRegistry::new(),
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with custom configuration.
    pub fn with_config(config: HooksConfig) -> HookServiceState {
        let mut engine = HookEngine::new();
        engine.update_config(config);
        let service = Self {
            engine,
            registry: SubscriberRegistry::new(),
        };
        Arc::new(Mutex::new(service))
    }

    // ── Subscription Delegation ─────────────────────────────────

    /// Register a new subscription in both the engine and the registry.
    pub fn subscribe(&mut self, sub: HookSubscription) -> Result<String, HookError> {
        let id = self.engine.subscribe(sub.clone())?;
        self.registry.add(sub);
        Ok(id)
    }

    /// Remove a subscription from both the engine and the registry.
    pub fn unsubscribe(&mut self, id: &str) -> Result<(), HookError> {
        self.engine.unsubscribe(id)?;
        let _ = self.registry.remove(id);
        Ok(())
    }

    /// List all subscriptions from the registry.
    pub fn list_subscriptions(&self) -> Vec<HookSubscription> {
        self.registry.get_all().into_iter().cloned().collect()
    }

    /// Retrieve a single subscription by ID.
    pub fn get_subscription(&self, id: &str) -> Result<HookSubscription, HookError> {
        self.registry
            .get(id)
            .cloned()
            .ok_or_else(|| HookError::SubscriptionNotFound(id.to_string()))
    }

    /// Enable a subscription.
    pub fn enable_subscription(&mut self, id: &str) -> Result<(), HookError> {
        self.registry.enable(id)?;
        if let Some(sub) = self.engine.subscribers.get_mut(id) {
            sub.enabled = true;
        }
        Ok(())
    }

    /// Disable a subscription.
    pub fn disable_subscription(&mut self, id: &str) -> Result<(), HookError> {
        self.registry.disable(id)?;
        if let Some(sub) = self.engine.subscribers.get_mut(id) {
            sub.enabled = false;
        }
        Ok(())
    }

    // ── Dispatch Delegation ─────────────────────────────────────

    /// Dispatch an event through the engine.
    pub fn dispatch_event(&mut self, event: HookEventData) -> Vec<HookExecutionResult> {
        self.engine.dispatch(event)
    }

    // ── Event Buffer Delegation ─────────────────────────────────

    /// Retrieve recent events from the buffer.
    pub fn get_recent_events(&self, count: usize) -> Vec<HookEventData> {
        self.engine
            .get_recent_events(count)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Retrieve events by type.
    pub fn get_events_by_type(&self, event_type: &HookEvent) -> Vec<HookEventData> {
        self.engine
            .get_events_by_type(event_type)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Get engine stats.
    pub fn get_stats(&self) -> HookStats {
        self.engine.get_stats()
    }

    /// Clear the event buffer.
    pub fn clear_events(&mut self) {
        self.engine.clear_buffer();
    }

    // ── Pipeline Delegation ─────────────────────────────────────

    /// Create a new pipeline.
    pub fn create_pipeline(&mut self, pipeline: HookPipeline) -> String {
        self.engine.add_pipeline(pipeline)
    }

    /// Delete a pipeline.
    pub fn delete_pipeline(&mut self, id: &str) -> Result<HookPipeline, HookError> {
        self.engine.remove_pipeline(id)
    }

    /// List all pipelines.
    pub fn list_pipelines(&self) -> Vec<HookPipeline> {
        self.engine.list_pipelines().into_iter().cloned().collect()
    }

    /// Execute a pipeline against a given event.
    pub fn execute_pipeline(
        &self,
        pipeline_id: &str,
        event: &HookEventData,
    ) -> Result<Vec<PipelineStepResult>, HookError> {
        let pipeline = self
            .engine
            .get_pipeline(pipeline_id)
            .ok_or_else(|| HookError::PipelineNotFound(pipeline_id.to_string()))?;
        PipelineExecutor::execute_pipeline(pipeline, event)
    }

    // ── Config Delegation ───────────────────────────────────────

    /// Get the current configuration.
    pub fn get_config(&self) -> HooksConfig {
        self.engine.config.clone()
    }

    /// Update the configuration.
    pub fn update_config(&mut self, config: HooksConfig) {
        self.engine.update_config(config);
    }
}
