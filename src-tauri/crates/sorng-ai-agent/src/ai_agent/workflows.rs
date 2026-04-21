// ── Workflow Engine ───────────────────────────────────────────────────────────

use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

use super::providers::LlmProvider;
use super::types::*;

// ── Workflow Registry ────────────────────────────────────────────────────────

pub struct WorkflowRegistry {
    workflows: HashMap<String, WorkflowDefinition>,
}

impl Default for WorkflowRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkflowRegistry {
    pub fn new() -> Self {
        Self {
            workflows: HashMap::new(),
        }
    }

    pub fn register(&mut self, workflow: WorkflowDefinition) {
        self.workflows.insert(workflow.id.clone(), workflow);
    }

    pub fn get(&self, id: &str) -> Option<&WorkflowDefinition> {
        self.workflows.get(id)
    }
    pub fn remove(&mut self, id: &str) -> bool {
        self.workflows.remove(id).is_some()
    }
    pub fn list(&self) -> Vec<&WorkflowDefinition> {
        self.workflows.values().collect()
    }
    pub fn count(&self) -> usize {
        self.workflows.len()
    }

    pub fn create(
        &mut self,
        name: &str,
        description: &str,
        steps: Vec<WorkflowStep>,
        tags: Vec<String>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let wf = WorkflowDefinition {
            id: id.clone(),
            name: name.into(),
            description: description.into(),
            steps,
            variables: HashMap::new(),
            retry_policy: None,
            created_at: now,
            updated_at: now,
            tags,
        };
        self.workflows.insert(id.clone(), wf);
        id
    }

    pub fn update_steps(&mut self, id: &str, steps: Vec<WorkflowStep>) -> Result<(), String> {
        let wf = self
            .workflows
            .get_mut(id)
            .ok_or_else(|| format!("Workflow {} not found", id))?;
        wf.steps = steps;
        wf.updated_at = Utc::now();
        Ok(())
    }
}

// ── Workflow Executor ────────────────────────────────────────────────────────

pub struct WorkflowExecutor;

impl WorkflowExecutor {
    /// Run a workflow definition with given input variables.
    ///
    /// When `provider` is `Some`, `LlmPrompt` steps dispatch to the real LLM
    /// backend and `model` / `provider_id` identify which model to invoke.
    /// When `provider` is `None`, `LlmPrompt` steps return an error indicating
    /// the workflow needs a provider — callers should always supply one from
    /// `AiAgentService::run_workflow`.
    pub async fn run(
        workflow: &WorkflowDefinition,
        input_variables: HashMap<String, serde_json::Value>,
        provider_id: &str,
        model: &str,
        provider: Option<&dyn LlmProvider>,
    ) -> Result<WorkflowRunResult, String> {
        let run_id = Uuid::new_v4().to_string();
        let started_at = Utc::now();

        // Merge workflow default variables with input
        let mut variables = workflow.variables.clone();
        for (k, v) in input_variables {
            variables.insert(k, v);
        }

        let mut step_results = Vec::new();
        let mut total_tokens = TokenUsage::default();
        let mut status = WorkflowRunStatus::Running;

        for step in &workflow.steps {
            // Evaluate condition if present
            if let Some(ref cond) = step.condition {
                if !evaluate_condition(cond, &variables) {
                    step_results.push(WorkflowStepResult {
                        step_id: step.id.clone(),
                        step_name: step.name.clone(),
                        status: WorkflowStepStatus::Skipped,
                        output: None,
                        error: None,
                        duration_ms: 0,
                        token_usage: TokenUsage::default(),
                    });
                    continue;
                }
            }

            let step_start = std::time::Instant::now();
            let result = execute_step(step, &mut variables, provider, provider_id, model).await;
            let duration_ms = step_start.elapsed().as_millis() as u64;

            match result {
                Ok((output, usage)) => {
                    // Store output variable if requested
                    if let Some(ref var_name) = step.output_variable {
                        if let Some(ref val) = output {
                            variables.insert(var_name.clone(), val.clone());
                        }
                    }
                    total_tokens.prompt_tokens += usage.prompt_tokens;
                    total_tokens.completion_tokens += usage.completion_tokens;
                    total_tokens.total_tokens += usage.total_tokens;
                    total_tokens.estimated_cost += usage.estimated_cost;

                    step_results.push(WorkflowStepResult {
                        step_id: step.id.clone(),
                        step_name: step.name.clone(),
                        status: WorkflowStepStatus::Completed,
                        output,
                        error: None,
                        duration_ms,
                        token_usage: usage,
                    });
                }
                Err(err) => {
                    let handled = handle_step_error(step, &err, &mut variables);
                    match handled {
                        StepErrorAction::Continue(fallback) => {
                            step_results.push(WorkflowStepResult {
                                step_id: step.id.clone(),
                                step_name: step.name.clone(),
                                status: WorkflowStepStatus::Completed,
                                output: fallback,
                                error: Some(err),
                                duration_ms,
                                token_usage: TokenUsage::default(),
                            });
                        }
                        StepErrorAction::Skip => {
                            step_results.push(WorkflowStepResult {
                                step_id: step.id.clone(),
                                step_name: step.name.clone(),
                                status: WorkflowStepStatus::Skipped,
                                output: None,
                                error: Some(err),
                                duration_ms,
                                token_usage: TokenUsage::default(),
                            });
                        }
                        StepErrorAction::Fail => {
                            step_results.push(WorkflowStepResult {
                                step_id: step.id.clone(),
                                step_name: step.name.clone(),
                                status: WorkflowStepStatus::Failed,
                                output: None,
                                error: Some(err),
                                duration_ms,
                                token_usage: TokenUsage::default(),
                            });
                            status = WorkflowRunStatus::Failed;
                            break;
                        }
                    }
                }
            }
        }

        if status == WorkflowRunStatus::Running {
            status = WorkflowRunStatus::Completed;
        }

        let completed_at = Utc::now();
        let total_duration_ms = (completed_at - started_at).num_milliseconds().max(0) as u64;

        Ok(WorkflowRunResult {
            run_id,
            workflow_id: workflow.id.clone(),
            status,
            step_results,
            output_variables: variables,
            total_tokens,
            total_duration_ms,
            started_at,
            completed_at: Some(completed_at),
        })
    }
}

// ── Step execution ───────────────────────────────────────────────────────────

async fn execute_step(
    step: &WorkflowStep,
    variables: &mut HashMap<String, serde_json::Value>,
    provider: Option<&dyn LlmProvider>,
    provider_id: &str,
    model: &str,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    match step.step_type {
        WorkflowStepType::LlmPrompt => {
            execute_llm_prompt(step, variables, provider, provider_id, model).await
        }
        WorkflowStepType::ToolExecution => execute_tool(step, variables).await,
        WorkflowStepType::Condition => execute_condition(step, variables).await,
        WorkflowStepType::Loop => execute_loop(step, variables).await,
        WorkflowStepType::Parallel => execute_parallel(step, variables).await,
        WorkflowStepType::HumanInTheLoop => {
            // Pause-point: the workflow runtime surfaces "awaiting_human_input"
            // so callers can checkpoint and resume with a human-supplied value.
            Ok((
                Some(serde_json::json!({"status": "awaiting_human_input", "step": step.name})),
                TokenUsage::default(),
            ))
        }
        WorkflowStepType::Transform => execute_transform(step, variables).await,
        WorkflowStepType::Delay => execute_delay(step).await,
        WorkflowStepType::RagSearch => execute_rag_search(step, variables).await,
        WorkflowStepType::Embedding => execute_embedding(step, variables).await,
        WorkflowStepType::SubWorkflow => {
            // Sub-workflow invocation requires the parent registry; callers that
            // need this should invoke AiAgentService::run_workflow recursively
            // from outside the executor.
            Ok((
                Some(serde_json::json!({"status": "sub_workflow_requires_registry"})),
                TokenUsage::default(),
            ))
        }
    }
}

async fn execute_llm_prompt(
    step: &WorkflowStep,
    variables: &HashMap<String, serde_json::Value>,
    provider: Option<&dyn LlmProvider>,
    _provider_id: &str,
    model: &str,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    // Extract prompt template from config, substitute variables
    let prompt_template = step
        .config
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let rendered = substitute_variables(prompt_template, variables);

    // Optional system prompt and model override in the step config.
    let system_prompt = step
        .config
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let step_model = step
        .config
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(model)
        .to_string();

    let provider = provider.ok_or_else(|| {
        format!(
            "Workflow step '{}' requires an LLM provider but none was supplied to WorkflowExecutor::run",
            step.name
        )
    })?;

    // Build the message list.
    let mut messages: Vec<ChatMessage> = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(ChatMessage {
            id: format!("wf-sys-{}", step.id),
            role: MessageRole::System,
            content: vec![ContentBlock::Text { text: sys }],
            tool_call_id: None,
            tool_calls: Vec::new(),
            name: None,
            created_at: Utc::now(),
            token_count: None,
            metadata: HashMap::new(),
        });
    }
    messages.push(ChatMessage {
        id: format!("wf-user-{}", step.id),
        role: MessageRole::User,
        content: vec![ContentBlock::Text { text: rendered.clone() }],
        tool_call_id: None,
        tool_calls: Vec::new(),
        name: None,
        created_at: Utc::now(),
        token_count: None,
        metadata: HashMap::new(),
    });

    // Pull optional inference-param overrides from the step config.
    let params = InferenceParams {
        temperature: step
            .config
            .get("temperature")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32)
            .unwrap_or(0.7),
        max_tokens: step
            .config
            .get("max_tokens")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(4096),
        ..Default::default()
    };

    let response = provider
        .chat_completion(&messages, &step_model, &params, &[])
        .await
        .map_err(|e| format!("LLM dispatch failed in workflow step '{}': {}", step.name, e))?;

    let response_text = response
        .message
        .content
        .iter()
        .filter_map(|b| match b {
            ContentBlock::Text { text } => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");

    let output = serde_json::json!({
        "prompt": rendered,
        "response": response_text,
        "model": response.model,
        "provider": format!("{:?}", response.provider),
        "finish_reason": format!("{:?}", response.finish_reason),
    });
    Ok((Some(output), response.usage))
}

async fn execute_tool(
    step: &WorkflowStep,
    _variables: &HashMap<String, serde_json::Value>,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let tool_name = step
        .config
        .get("tool")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let args = step
        .config
        .get("arguments")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    let output = serde_json::json!({
        "tool": tool_name,
        "arguments": args,
        "result": format!("[Tool '{}' execution result would go here]", tool_name),
    });
    Ok((Some(output), TokenUsage::default()))
}

async fn execute_condition(
    step: &WorkflowStep,
    variables: &HashMap<String, serde_json::Value>,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let cond_expr = step
        .config
        .get("condition")
        .and_then(|v| v.as_str())
        .unwrap_or("false");

    let result = evaluate_condition(cond_expr, variables);
    let branch = if result { "then" } else { "else" };
    let output = serde_json::json!({ "condition": cond_expr, "result": result, "branch": branch });
    Ok((Some(output), TokenUsage::default()))
}

async fn execute_loop(
    step: &WorkflowStep,
    variables: &HashMap<String, serde_json::Value>,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let items_key = step
        .config
        .get("items_variable")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let items = variables
        .get(items_key)
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let output = serde_json::json!({
        "loop_variable": items_key,
        "iterations": items.len(),
        "results": format!("[Loop over {} items for step '{}']", items.len(), step.name),
    });
    Ok((Some(output), TokenUsage::default()))
}

async fn execute_parallel(
    step: &WorkflowStep,
    _variables: &HashMap<String, serde_json::Value>,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let sub_steps = step
        .config
        .get("steps")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    let output = serde_json::json!({
        "parallel_steps": sub_steps,
        "status": "completed",
    });
    Ok((Some(output), TokenUsage::default()))
}

async fn execute_transform(
    step: &WorkflowStep,
    variables: &HashMap<String, serde_json::Value>,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let template = step
        .config
        .get("template")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let rendered = substitute_variables(template, variables);
    Ok((
        Some(serde_json::Value::String(rendered)),
        TokenUsage::default(),
    ))
}

async fn execute_delay(
    step: &WorkflowStep,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let ms = step
        .config
        .get("delay_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if ms > 0 && ms <= 60_000 {
        tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
    }
    Ok((
        Some(serde_json::json!({"delayed_ms": ms})),
        TokenUsage::default(),
    ))
}

async fn execute_rag_search(
    step: &WorkflowStep,
    variables: &HashMap<String, serde_json::Value>,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let query_template = step
        .config
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let query = substitute_variables(query_template, variables);
    let collection = step
        .config
        .get("collection")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    let output = serde_json::json!({
        "collection": collection,
        "query": query,
        "results": format!("[RAG search results for '{}' in '{}']", query, collection),
    });
    Ok((Some(output), TokenUsage::default()))
}

async fn execute_embedding(
    step: &WorkflowStep,
    variables: &HashMap<String, serde_json::Value>,
) -> Result<(Option<serde_json::Value>, TokenUsage), String> {
    let text_key = step
        .config
        .get("text_variable")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let text = variables
        .get(text_key)
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Embedding steps require a dedicated embedding provider that the executor
    // does not currently carry. Surface a structured pending status so callers
    // can route the text through AiAgentService::add_vector separately.
    let output = serde_json::json!({
        "text_preview": &text[..text.len().min(100)],
        "status": "embedding_pending_external_call",
    });
    Ok((Some(output), TokenUsage::default()))
}

// ── Error handling ───────────────────────────────────────────────────────────

enum StepErrorAction {
    Continue(Option<serde_json::Value>),
    Skip,
    Fail,
}

fn handle_step_error(
    step: &WorkflowStep,
    _error: &str,
    _variables: &mut HashMap<String, serde_json::Value>,
) -> StepErrorAction {
    match &step.on_error {
        Some(handler) => match handler.strategy {
            ErrorStrategy::Skip => StepErrorAction::Skip,
            ErrorStrategy::Fallback => StepErrorAction::Continue(handler.fallback_value.clone()),
            ErrorStrategy::Retry => {
                // In a real implementation, we'd retry with the policy
                // For now, fall through to Fail after "retry"
                StepErrorAction::Fail
            }
            ErrorStrategy::Fail => StepErrorAction::Fail,
        },
        None => StepErrorAction::Fail,
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn evaluate_condition(expr: &str, variables: &HashMap<String, serde_json::Value>) -> bool {
    // Simple expression evaluator: check if a variable is truthy
    // Supports: "varname", "varname == value", "!varname"
    let expr = expr.trim();

    if let Some(stripped) = expr.strip_prefix('!') {
        let var = stripped.trim();
        return !is_truthy(variables.get(var));
    }

    if let Some(pos) = expr.find("==") {
        let var = expr[..pos].trim();
        let val = expr[pos + 2..].trim().trim_matches('"');
        return match variables.get(var) {
            Some(serde_json::Value::String(s)) => s == val,
            Some(v) => v.to_string().trim_matches('"') == val,
            None => false,
        };
    }

    if let Some(pos) = expr.find("!=") {
        let var = expr[..pos].trim();
        let val = expr[pos + 2..].trim().trim_matches('"');
        return match variables.get(var) {
            Some(serde_json::Value::String(s)) => s != val,
            Some(v) => v.to_string().trim_matches('"') != val,
            None => true,
        };
    }

    is_truthy(variables.get(expr))
}

fn is_truthy(val: Option<&serde_json::Value>) -> bool {
    match val {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        Some(serde_json::Value::String(s)) => !s.is_empty() && s != "false" && s != "0",
        Some(serde_json::Value::Array(a)) => !a.is_empty(),
        Some(serde_json::Value::Object(o)) => !o.is_empty(),
    }
}

fn substitute_variables(template: &str, variables: &HashMap<String, serde_json::Value>) -> String {
    let mut result = template.to_string();
    for (key, val) in variables {
        let placeholder = format!("{{{{{}}}}}", key);
        let replacement = match val {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        result = result.replace(&placeholder, &replacement);
    }
    result
}
