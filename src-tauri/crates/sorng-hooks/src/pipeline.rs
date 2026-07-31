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
        _context: &mut PipelineContext,
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
                let _ = script;
                log::warn!("pipeline: execute_script is unsupported and was not executed");
                Err(HookError::ScriptError(
                    "script action is unsupported and was not executed".to_string(),
                ))
            }

            PipelineAction::SendNotification(target) => {
                let _ = target;
                log::warn!("pipeline: send_notification is unsupported and was not executed");
                Err(HookError::EventDispatchFailed(
                    "notification action is unsupported and was not executed".to_string(),
                ))
            }

            PipelineAction::TransformPayload(expression) => {
                let _ = expression;
                log::warn!("pipeline: transform_payload is unsupported and was not executed");
                Err(HookError::ScriptError(
                    "payload transform is unsupported and was not executed".to_string(),
                ))
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
                let _ = cfg;
                log::warn!("pipeline: http_webhook is unsupported and was not executed");
                Err(HookError::WebhookError(
                    "HTTP webhook action is unsupported and was not executed".to_string(),
                ))
            }

            PipelineAction::Chain(pipeline_id) => {
                let _ = pipeline_id;
                log::warn!("pipeline: chain is unsupported and was not executed");
                Err(HookError::EventDispatchFailed(
                    "pipeline chain action is unsupported and was not executed".to_string(),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_event() -> HookEventData {
        HookEventData {
            event_id: "event-1".to_string(),
            event_type: HookEvent::AppStartup,
            timestamp: chrono::DateTime::from_timestamp(0, 0).expect("valid test timestamp"),
            source: "test".to_string(),
            connection_id: None,
            session_id: None,
            payload: serde_json::json!({}),
            metadata: HashMap::new(),
        }
    }

    fn test_step(action: PipelineAction) -> PipelineStep {
        PipelineStep {
            step_id: "step-1".to_string(),
            action,
            condition: None,
            timeout_ms: 1_000,
        }
    }

    fn webhook_action() -> PipelineAction {
        PipelineAction::HttpWebhook(WebhookConfig {
            url: "https://example.invalid/hooks".to_string(),
            method: "POST".to_string(),
            headers: HashMap::new(),
            body_template: None,
            timeout_ms: 1_000,
            retry_count: 1,
        })
    }

    #[test]
    fn http_webhook_action_fails_closed_without_mutating_context() {
        let mut context = PipelineContext::default();
        let error = PipelineExecutor::execute_step(
            &test_step(webhook_action()),
            &test_event(),
            &mut context,
        )
        .expect_err("unsupported HTTP webhook must fail closed");

        assert!(matches!(
            error,
            HookError::WebhookError(message)
                if message == "HTTP webhook action is unsupported and was not executed"
        ));
        assert!(context.variables.is_empty());
        assert!(context.results.is_empty());
    }

    #[test]
    fn all_unimplemented_pipeline_actions_fail_closed() {
        let cases = [
            (
                "execute_script",
                PipelineAction::ExecuteScript("ignored".to_string()),
            ),
            (
                "send_notification",
                PipelineAction::SendNotification(NotificationTarget::InApp),
            ),
            (
                "transform_payload",
                PipelineAction::TransformPayload("ignored".to_string()),
            ),
            ("http_webhook", webhook_action()),
            ("chain", PipelineAction::Chain("ignored".to_string())),
        ];

        for (case, action) in cases {
            let mut context = PipelineContext::default();
            let result =
                PipelineExecutor::execute_step(&test_step(action), &test_event(), &mut context);

            match (case, result) {
                ("execute_script", Err(HookError::ScriptError(message)))
                    if message == "script action is unsupported and was not executed" => {}
                ("send_notification", Err(HookError::EventDispatchFailed(message)))
                    if message == "notification action is unsupported and was not executed" => {}
                ("transform_payload", Err(HookError::ScriptError(message)))
                    if message == "payload transform is unsupported and was not executed" => {}
                ("http_webhook", Err(HookError::WebhookError(message)))
                    if message == "HTTP webhook action is unsupported and was not executed" => {}
                ("chain", Err(HookError::EventDispatchFailed(message)))
                    if message == "pipeline chain action is unsupported and was not executed" => {}
                (_, Err(unexpected)) => panic!("{case} returned unexpected error: {unexpected}"),
                (_, Ok(_)) => panic!("{case} unexpectedly succeeded"),
            }

            assert!(context.variables.is_empty());
            assert!(context.results.is_empty());
        }
    }
}
