//! Pipeline execution for multi-step hook workflows.

use std::collections::HashMap;
use std::time::Instant;

use log;
use serde::{Deserialize, Serialize};

use crate::error::HookError;
use crate::types::*;

// ─── Context & Result Types ─────────────────────────────────────────

/// Mutable context threaded through every step of a pipeline run.
#[derive(Debug, Clone, Default)]
pub struct PipelineContext {
    /// Arbitrary key-value variables that steps can read/write.
    pub variables: HashMap<String, serde_json::Value>,
    /// Results accumulated from each executed step.
    pub results: Vec<PipelineStepResult>,
}

/// The outcome of a single pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStepResult {
    pub step_id: String,
    pub success: bool,
    pub output: Option<serde_json::Value>,
    pub duration_ms: u64,
}

// ─── Executor ───────────────────────────────────────────────────────

/// Stateless executor that runs a [`HookPipeline`] against an event.
pub struct PipelineExecutor;

impl PipelineExecutor {
    /// Execute every step of `pipeline` in order, threading a
    /// [`PipelineContext`] through all steps.  Returns the per-step
    /// results or the first fatal error.
    pub fn execute_pipeline(
        pipeline: &HookPipeline,
        event: &HookEventData,
    ) -> Result<Vec<PipelineStepResult>, HookError> {
        if !pipeline.enabled {
            return Ok(Vec::new());
        }

        let mut ctx = PipelineContext::default();
        // Seed context with the event payload.
        ctx.variables
            .insert("event_payload".to_string(), event.payload.clone());
        ctx.variables.insert(
            "event_type".to_string(),
            serde_json::Value::String(event.event_type.to_string()),
        );
        ctx.variables.insert(
            "source".to_string(),
            serde_json::Value::String(event.source.clone()),
        );

        for step in &pipeline.steps {
            let result = Self::execute_step(step, event, &mut ctx)?;
            ctx.results.push(result);
        }

        Ok(ctx.results)
    }

    /// Execute a single pipeline step.
    pub fn execute_step(
        step: &PipelineStep,
        event: &HookEventData,
        context: &mut PipelineContext,
    ) -> Result<PipelineStepResult, HookError> {
        // Evaluate optional condition – skip when it evaluates to false.
        if let Some(ref cond) = step.condition {
            if !Self::evaluate_condition(cond, event) {
                return Ok(PipelineStepResult {
                    step_id: step.step_id.clone(),
                    success: true,
                    output: Some(serde_json::json!({ "skipped": true })),
                    duration_ms: 0,
                });
            }
        }

        let start = Instant::now();
        let output = Self::run_action(&step.action, event, context)?;
        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(PipelineStepResult {
            step_id: step.step_id.clone(),
            success: true,
            output: Some(output),
            duration_ms,
        })
    }

    /// Evaluate a simple condition string against the event.
    ///
    /// Supported forms:
    /// - `"true"` / `"false"` – literal booleans
    /// - `"event_type:xxx"` – matches if the event type serialized
    ///   name equals `xxx`
    /// - `"has_connection"` – matches when `connection_id` is present
    /// - `"has_session"` – matches when `session_id` is present
    /// - `"source:xxx"` – matches when `source` equals `xxx`
    /// - `"metadata:key=value"` – matches a specific metadata entry
    ///
    /// Anything else evaluates to `true` (permissive by default).
    pub fn evaluate_condition(condition: &str, event: &HookEventData) -> bool {
        let cond = condition.trim();

        if cond.eq_ignore_ascii_case("true") {
            return true;
        }
        if cond.eq_ignore_ascii_case("false") {
            return false;
        }
        if cond == "has_connection" {
            return event.connection_id.is_some();
        }
        if cond == "has_session" {
            return event.session_id.is_some();
        }
        if let Some(expected) = cond.strip_prefix("event_type:") {
            return event.event_type.to_string() == expected;
        }
        if let Some(expected) = cond.strip_prefix("source:") {
            return event.source == expected;
        }
        if let Some(kv) = cond.strip_prefix("metadata:") {
            if let Some((key, value)) = kv.split_once('=') {
                return event.metadata.get(key).is_some_and(|v| v == value);
            }
        }

        // Unknown condition format – default to allow.
        true
    }

    // ── Internal action dispatch ────────────────────────────────

    /// Dispatch a single [`PipelineAction`], returning its JSON output.
    fn run_action(
        action: &PipelineAction,
        event: &HookEventData,
        context: &mut PipelineContext,
    ) -> Result<serde_json::Value, HookError> {
        match action {
            PipelineAction::LogEvent => {
                log::info!(
                    "pipeline: log_event – {} from {} (id={})",
                    event.event_type,
                    event.source,
                    event.event_id,
                );
                Ok(serde_json::json!({
                    "logged": true,
                    "event_id": event.event_id,
                }))
            }

            PipelineAction::ExecuteScript(script) => {
                // In a real deployment this would invoke the script
                // runtime.  Here we record the invocation.
                log::info!("pipeline: execute_script – {script}");
                context.variables.insert(
                    "last_script".to_string(),
                    serde_json::Value::String(script.clone()),
                );
                Ok(serde_json::json!({
                    "script": script,
                    "executed": true,
                }))
            }

            PipelineAction::SendNotification(target) => {
                let target_json = serde_json::to_value(target).unwrap_or(serde_json::Value::Null);
                log::info!("pipeline: send_notification – {:?}", target);
                Ok(serde_json::json!({
                    "notification_sent": true,
                    "target": target_json,
                }))
            }

            PipelineAction::TransformPayload(expression) => {
                // Minimal transform: store the expression result as a
                // context variable.  A production implementation would
                // support JSONPath / JMESPath.
                log::info!("pipeline: transform_payload – {expression}");
                context.variables.insert(
                    "transform_result".to_string(),
                    serde_json::Value::String(expression.clone()),
                );
                Ok(serde_json::json!({
                    "transformed": true,
                    "expression": expression,
                }))
            }

            PipelineAction::Delay(ms) => {
                // Synchronous sleep – in the async service the caller
                // should wrap this in `tokio::time::sleep`.
                std::thread::sleep(std::time::Duration::from_millis(*ms));
                Ok(serde_json::json!({
                    "delayed_ms": ms,
                }))
            }

            PipelineAction::HttpWebhook(cfg) => {
                log::info!("pipeline: http_webhook – {} {}", cfg.method, cfg.url);
                // Actual HTTP calls are delegated to an external HTTP
                // client; here we record the intent.
                Ok(serde_json::json!({
                    "webhook_triggered": true,
                    "url": cfg.url,
                    "method": cfg.method,
                }))
            }

            PipelineAction::Chain(pipeline_id) => {
                log::info!("pipeline: chain – {pipeline_id}");
                context.variables.insert(
                    "chained_pipeline".to_string(),
                    serde_json::Value::String(pipeline_id.clone()),
                );
                Ok(serde_json::json!({
                    "chained": true,
                    "pipeline_id": pipeline_id,
                }))
            }
        }
    }
}
