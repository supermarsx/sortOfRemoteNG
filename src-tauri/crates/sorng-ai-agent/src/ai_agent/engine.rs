// ── Agent Orchestration Engine ────────────────────────────────────────────────
//
// Implements multiple agentic strategies:
// - SingleShot (single LLM call, no loop)
// - ReAct (Reason + Act loop)
// - PlanAndExecute (plan steps, then execute sequentially)
// - ChainOfThought (structured reasoning)
// - Reflexion (defaults to ReAct)

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

use super::types::*;
use super::providers::LlmProvider;
use super::tools::{ToolRegistry, tool_results_to_messages};
use super::memory::MemoryStore;

// ── Agent Runner ─────────────────────────────────────────────────────────────

/// Runs a complete agent loop for a given configuration.
pub async fn run_agent(
    config: &AgentConfig,
    provider: &dyn LlmProvider,
    tools: &ToolRegistry,
    initial_messages: Vec<ChatMessage>,
    memory: Option<&mut MemoryStore>,
) -> Result<AgentRunResult, String> {
    match config.strategy {
        AgentStrategy::SingleShot => run_simple(config, provider, initial_messages).await,
        AgentStrategy::React => run_react(config, provider, tools, initial_messages, memory).await,
        AgentStrategy::PlanAndExecute => run_plan_and_execute(config, provider, tools, initial_messages, memory).await,
        AgentStrategy::ChainOfThought => run_chain_of_thought(config, provider, initial_messages).await,
        AgentStrategy::Reflexion => run_react(config, provider, tools, initial_messages, memory).await,
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn extract_text(msg: &ChatMessage) -> String {
    msg.content.iter().filter_map(|b| match b {
        ContentBlock::Text { text } => Some(text.clone()),
        _ => None,
    }).collect::<Vec<_>>().join("")
}

fn make_step(index: u32, step_type: AgentStepType, content: String, tool_calls: Vec<ToolCall>, tool_results: Vec<ToolResult>, usage: TokenUsage, duration_ms: u64) -> AgentStep {
    AgentStep {
        step_index: index,
        step_type,
        content,
        tool_calls,
        tool_results,
        token_usage: usage,
        duration_ms,
        timestamp: Utc::now(),
    }
}

fn make_result(run_id: String, strategy: AgentStrategy, status: AgentRunStatus, answer: Option<String>, steps: Vec<AgentStep>, usage: TokenUsage, duration_ms: u64) -> AgentRunResult {
    let iterations = steps.len() as u32;
    AgentRunResult {
        run_id,
        strategy,
        final_answer: answer,
        steps,
        total_iterations: iterations,
        total_tokens: usage,
        total_duration_ms: duration_ms,
        status,
        created_at: Utc::now(),
        completed_at: Some(Utc::now()),
        metadata: HashMap::new(),
    }
}

// ── Simple Strategy ──────────────────────────────────────────────────────────

async fn run_simple(
    config: &AgentConfig,
    provider: &dyn LlmProvider,
    messages: Vec<ChatMessage>,
) -> Result<AgentRunResult, String> {
    let start = std::time::Instant::now();
    let run_id = Uuid::new_v4().to_string();

    let response = provider.chat_completion(&messages, &config.model, &config.params, &[]).await?;
    let text = extract_text(&response.message);

    let step = make_step(0, AgentStepType::FinalAnswer, text.clone(), Vec::new(), Vec::new(), response.usage.clone(), response.latency_ms);

    Ok(make_result(run_id, config.strategy.clone(), AgentRunStatus::Completed, Some(text), vec![step], response.usage, start.elapsed().as_millis() as u64))
}

// ── ReAct Strategy ───────────────────────────────────────────────────────────

async fn run_react(
    config: &AgentConfig,
    provider: &dyn LlmProvider,
    tools: &ToolRegistry,
    initial_messages: Vec<ChatMessage>,
    memory: Option<&mut MemoryStore>,
) -> Result<AgentRunResult, String> {
    let start = std::time::Instant::now();
    let run_id = Uuid::new_v4().to_string();
    let max_iterations = config.max_iterations as usize;
    let tool_defs = tools.list_definitions();

    let mut messages = initial_messages;
    let mut steps: Vec<AgentStep> = Vec::new();
    let mut total_usage = TokenUsage::default();

    // Inject ReAct system prompt if not already present
    if !messages.iter().any(|m| matches!(m.role, MessageRole::System)) {
        let react_system = format!(
            "You are a helpful AI assistant with access to tools. \
            When you need information or need to perform actions, use the available tools. \
            Think step by step. When you have enough information to answer, respond directly. \
            {}", config.system_prompt.as_deref().unwrap_or("")
        );
        messages.insert(0, ChatMessage {
            id: "react-system".into(), role: MessageRole::System,
            content: vec![ContentBlock::Text { text: react_system }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        });
    }

    // Prepend memory context if available
    if let Some(mem) = memory {
        let mem_entries = mem.get_context_messages(20);
        let insert_pos = if matches!(messages.first().map(|m| &m.role), Some(MessageRole::System)) { 1 } else { 0 };
        for (i, entry) in mem_entries.into_iter().enumerate() {
            let msg = ChatMessage {
                id: format!("mem-{}", entry.id),
                role: MessageRole::User,
                content: vec![ContentBlock::Text { text: entry.content.clone() }],
                tool_call_id: None, tool_calls: Vec::new(), name: None,
                created_at: entry.created_at, token_count: None, metadata: HashMap::new(),
            };
            messages.insert(insert_pos + i, msg);
        }
    }

    for iteration in 0..max_iterations {
        let step_start = std::time::Instant::now();

        let response = provider.chat_completion(&messages, &config.model, &config.params, &tool_defs).await?;
        total_usage.prompt_tokens += response.usage.prompt_tokens;
        total_usage.completion_tokens += response.usage.completion_tokens;
        total_usage.total_tokens += response.usage.total_tokens;

        let assistant_text = extract_text(&response.message);

        if !response.message.tool_calls.is_empty() {
            let tool_results = tools.execute_tool_calls(&response.message.tool_calls);

            steps.push(make_step(
                iteration as u32, AgentStepType::Action, assistant_text.clone(),
                response.message.tool_calls.clone(), tool_results.clone(),
                response.usage.clone(), step_start.elapsed().as_millis() as u64,
            ));

            messages.push(response.message.clone());
            messages.extend(tool_results_to_messages(&tool_results));
            continue;
        }

        // No tool calls → final answer
        steps.push(make_step(
            iteration as u32, AgentStepType::FinalAnswer, assistant_text.clone(),
            Vec::new(), Vec::new(), response.usage.clone(),
            step_start.elapsed().as_millis() as u64,
        ));

        return Ok(make_result(run_id, config.strategy.clone(), AgentRunStatus::Completed, Some(assistant_text), steps, total_usage, start.elapsed().as_millis() as u64));
    }

    // Max iterations reached
    let last_output = steps.last().map(|s| s.content.clone()).unwrap_or_default();
    Ok(make_result(run_id, config.strategy.clone(), AgentRunStatus::MaxIterationsReached, Some(last_output), steps, total_usage, start.elapsed().as_millis() as u64))
}

// ── Plan-and-Execute Strategy ────────────────────────────────────────────────

async fn run_plan_and_execute(
    config: &AgentConfig,
    provider: &dyn LlmProvider,
    tools: &ToolRegistry,
    initial_messages: Vec<ChatMessage>,
    _memory: Option<&mut MemoryStore>,
) -> Result<AgentRunResult, String> {
    let start = std::time::Instant::now();
    let run_id = Uuid::new_v4().to_string();
    let tool_defs = tools.list_definitions();
    let mut total_usage = TokenUsage::default();
    let mut steps: Vec<AgentStep> = Vec::new();

    // Extract the user query
    let user_query = initial_messages.iter().rev()
        .find(|m| matches!(m.role, MessageRole::User))
        .and_then(|m| m.content.first())
        .and_then(|b| match b { ContentBlock::Text { text } => Some(text.clone()), _ => None })
        .unwrap_or_default();

    let tool_names: Vec<String> = tool_defs.iter().map(|t| format!("- {}: {}", t.name, t.description)).collect();

    let plan_prompt = format!(
        "You are a planning agent. Create a step-by-step plan to answer the user's query.\n\
        Available tools:\n{}\n\n\
        User query: {}\n\n\
        Respond with a numbered list of steps. Each step should be a clear, actionable instruction.\n\
        End with a step that synthesises the results into a final answer.",
        tool_names.join("\n"), user_query
    );

    let plan_messages = vec![
        ChatMessage {
            id: "plan-system".into(), role: MessageRole::System,
            content: vec![ContentBlock::Text { text: "You are a planning agent. Create detailed step-by-step plans.".into() }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        },
        ChatMessage {
            id: "plan-user".into(), role: MessageRole::User,
            content: vec![ContentBlock::Text { text: plan_prompt }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        },
    ];

    let plan_response = provider.chat_completion(&plan_messages, &config.model, &config.params, &[]).await?;
    total_usage.prompt_tokens += plan_response.usage.prompt_tokens;
    total_usage.completion_tokens += plan_response.usage.completion_tokens;
    total_usage.total_tokens += plan_response.usage.total_tokens;

    let plan_text = extract_text(&plan_response.message);

    steps.push(make_step(
        0, AgentStepType::Plan, plan_text.clone(),
        Vec::new(), Vec::new(), plan_response.usage.clone(), 0,
    ));

    // Step 2: Execute as a ReAct loop with the plan as context
    let execute_system = format!(
        "You have the following plan to answer the user's query:\n\n{}\n\n\
        Execute this plan step by step. Use tools when needed. \
        After completing all steps, provide the final answer.",
        plan_text
    );

    let mut exec_messages = vec![
        ChatMessage {
            id: "exec-system".into(), role: MessageRole::System,
            content: vec![ContentBlock::Text { text: execute_system }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        },
    ];
    exec_messages.extend(initial_messages.into_iter().filter(|m| matches!(m.role, MessageRole::User)));

    let max_iterations = config.max_iterations as usize;
    for _iteration in 0..max_iterations {
        let step_start = std::time::Instant::now();
        let response = provider.chat_completion(&exec_messages, &config.model, &config.params, &tool_defs).await?;
        total_usage.prompt_tokens += response.usage.prompt_tokens;
        total_usage.completion_tokens += response.usage.completion_tokens;
        total_usage.total_tokens += response.usage.total_tokens;

        let text = extract_text(&response.message);

        if !response.message.tool_calls.is_empty() {
            let tool_results = tools.execute_tool_calls(&response.message.tool_calls);
            steps.push(make_step(
                steps.len() as u32, AgentStepType::Action, text.clone(),
                response.message.tool_calls.clone(), tool_results.clone(),
                response.usage.clone(), step_start.elapsed().as_millis() as u64,
            ));
            exec_messages.push(response.message.clone());
            exec_messages.extend(tool_results_to_messages(&tool_results));
            continue;
        }

        steps.push(make_step(
            steps.len() as u32, AgentStepType::FinalAnswer, text.clone(),
            Vec::new(), Vec::new(), response.usage.clone(),
            step_start.elapsed().as_millis() as u64,
        ));

        return Ok(make_result(run_id, config.strategy.clone(), AgentRunStatus::Completed, Some(text), steps, total_usage, start.elapsed().as_millis() as u64));
    }

    Ok(make_result(run_id, config.strategy.clone(), AgentRunStatus::MaxIterationsReached, None, steps, total_usage, start.elapsed().as_millis() as u64))
}

// ── Chain-of-Thought Strategy ────────────────────────────────────────────────

async fn run_chain_of_thought(
    config: &AgentConfig,
    provider: &dyn LlmProvider,
    initial_messages: Vec<ChatMessage>,
) -> Result<AgentRunResult, String> {
    let start = std::time::Instant::now();
    let run_id = Uuid::new_v4().to_string();

    let mut messages = initial_messages;
    let cot_system = format!(
        "Think step by step. For each step, explain your reasoning clearly before stating your conclusion. \
        Structure your response as:\n\
        Step 1: [reasoning]\n\
        Step 2: [reasoning]\n\
        ...\n\
        Final Answer: [your answer]\n\n\
        {}",
        config.system_prompt.as_deref().unwrap_or("")
    );

    if let Some(first) = messages.first_mut() {
        if matches!(first.role, MessageRole::System) {
            first.content = vec![ContentBlock::Text { text: cot_system }];
        }
    } else {
        messages.insert(0, ChatMessage {
            id: "cot-system".into(), role: MessageRole::System,
            content: vec![ContentBlock::Text { text: cot_system }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        });
    }

    let response = provider.chat_completion(&messages, &config.model, &config.params, &[]).await?;
    let output = extract_text(&response.message);

    // Parse steps from the output
    let mut steps: Vec<AgentStep> = Vec::new();
    let mut current_reasoning = String::new();
    let mut step_num = 0u32;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Step ") || trimmed.starts_with("Final Answer") {
            if step_num > 0 && !current_reasoning.is_empty() {
                steps.push(make_step(
                    step_num - 1, AgentStepType::Thought, current_reasoning.trim().to_string(),
                    Vec::new(), Vec::new(), TokenUsage::default(), 0,
                ));
                current_reasoning.clear();
            }
            step_num += 1;
        }
        current_reasoning.push_str(trimmed);
        current_reasoning.push('\n');
    }
    // Last step
    if !current_reasoning.is_empty() {
        steps.push(make_step(
            step_num.max(1) - 1, AgentStepType::FinalAnswer, current_reasoning.trim().to_string(),
            Vec::new(), Vec::new(), response.usage.clone(),
            start.elapsed().as_millis() as u64,
        ));
    }

    Ok(make_result(run_id, config.strategy.clone(), AgentRunStatus::Completed, Some(output), steps, response.usage, start.elapsed().as_millis() as u64))
}
