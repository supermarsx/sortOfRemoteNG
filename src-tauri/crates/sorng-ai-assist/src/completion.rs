use crate::types::*;
use crate::context::ContextBuilder;
use crate::error::AiAssistError;
use crate::suggestions::SuggestionEngine;

use sorng_llm::{
    ChatMessage, MessageRole, ChatCompletionRequest, LlmServiceState,
};

/// AI-powered tab completion engine that combines heuristics with LLM intelligence.
pub struct CompletionEngine;

impl CompletionEngine {
    /// Get completions, using local heuristics first and falling back to AI.
    pub async fn complete(
        request: &CompletionRequest,
        ctx: &SessionContext,
        config: &AiAssistConfig,
        llm: Option<&LlmServiceState>,
    ) -> Result<CompletionResponse, AiAssistError> {
        let start = std::time::Instant::now();

        // Phase 1: Local heuristic suggestions
        let mut suggestions = SuggestionEngine::generate_suggestions(
            &request.input,
            request.cursor_position,
            ctx,
            config,
        );

        let mut from_cache = false;

        // Phase 2: AI-powered suggestions (if local suggestions are insufficient)
        if suggestions.len() < config.max_suggestions / 2 {
            if let Some(llm_state) = llm {
                match Self::ai_complete(request, ctx, config, llm_state).await {
                    Ok(ai_suggestions) => {
                        suggestions.extend(ai_suggestions);
                    }
                    Err(e) => {
                        log::warn!("AI completion failed, using local only: {}", e);
                    }
                }
            }
        }

        // Filter by minimum confidence and max risk
        suggestions.retain(|s| {
            s.confidence >= config.min_confidence
                && s.risk_level.numeric() <= config.max_risk_level.numeric()
        });

        // Sort and truncate
        suggestions.sort_by(|a, b| {
            b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal)
        });
        suggestions.truncate(request.max_suggestions);

        let context_used = vec![
            format!("shell:{}", ctx.shell.display_name()),
            format!("os:{}", ctx.os.display_name()),
            format!("cwd:{}", ctx.cwd),
            format!("history:{}", ctx.history.len()),
        ];

        Ok(CompletionResponse {
            suggestions,
            context_used,
            processing_time_ms: start.elapsed().as_millis() as u64,
            from_cache,
        })
    }

    /// Use the LLM to generate AI-powered completion suggestions.
    async fn ai_complete(
        request: &CompletionRequest,
        ctx: &SessionContext,
        config: &AiAssistConfig,
        llm_state: &LlmServiceState,
    ) -> Result<Vec<Suggestion>, AiAssistError> {
        let prompt = ContextBuilder::build_completion_prompt(
            &request.input,
            request.cursor_position,
            ctx,
            request.max_suggestions,
        );

        let system_msg = ChatMessage {
            role: MessageRole::System,
            content: sorng_llm::MessageContent::Text(
                "You are an SSH terminal assistant. Return only valid JSON arrays.".to_string()
            ),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };

        let user_msg = ChatMessage {
            role: MessageRole::User,
            content: sorng_llm::MessageContent::Text(prompt),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };

        let llm_request = ChatCompletionRequest {
            model: config.llm_model.clone().unwrap_or_else(|| "default".to_string()),
            messages: vec![system_msg, user_msg],
            temperature: Some(0.3),
            max_tokens: Some(1000),
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            stop: None,
            tools: None,
            tool_choice: None,
            stream: false,
            response_format: None,
            seed: None,
            logprobs: None,
            top_logprobs: None,
            provider_id: None,
            extra: None,
        };

        let mut service = llm_state.0.write().await;
        let response = service.chat_completion(llm_request).await?;

        let content = crate::extract_response_text(&response);
        Self::parse_completion_response(&content)
    }

    /// Parse the LLM's JSON array response into Suggestion objects.
    fn parse_completion_response(content: &str) -> Result<Vec<Suggestion>, AiAssistError> {
        // Extract JSON from possible markdown fencing
        let json_str = extract_json_from_response(content);

        let items: Vec<serde_json::Value> = serde_json::from_str(&json_str)
            .map_err(|e| AiAssistError::parse_error(
                &format!("Failed to parse AI completion response: {}", e)
            ))?;

        let suggestions: Vec<Suggestion> = items.iter().filter_map(|item| {
            let text = item.get("text")?.as_str()?;
            let description = item.get("description").and_then(|v| v.as_str());
            let kind_str = item.get("kind").and_then(|v| v.as_str()).unwrap_or("command");
            let confidence = item.get("confidence")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.5);

            let kind = match kind_str {
                "command" => SuggestionKind::Command,
                "flag" => SuggestionKind::Flag,
                "argument" => SuggestionKind::Argument,
                "path" => SuggestionKind::Path,
                "variable" => SuggestionKind::Variable,
                "pipe" => SuggestionKind::Pipe,
                "redirect" => SuggestionKind::Redirect,
                _ => SuggestionKind::Command,
            };

            Some(Suggestion {
                text: text.to_string(),
                display: text.to_string(),
                kind,
                description: description.map(|s| s.to_string()),
                confidence,
                source: SuggestionSource::Ai,
                insert_text: None,
                documentation: None,
                risk_level: RiskLevel::Safe,
                tags: vec!["ai".to_string()],
            })
        }).collect();

        Ok(suggestions)
    }
}

/// Extract JSON from a response that may contain markdown code fences.
pub fn extract_json_from_response(content: &str) -> String {
    let trimmed = content.trim();

    // Try to find JSON array or object
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        return trimmed.to_string();
    }

    // Check for markdown code fences
    if let Some(start) = trimmed.find("```json") {
        let after = &trimmed[start + 7..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        if let Some(end) = after.find("```") {
            let inner = after[..end].trim();
            if inner.starts_with('[') || inner.starts_with('{') {
                return inner.to_string();
            }
        }
    }

    // Last resort: find first [ or { to last ] or }
    if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            return trimmed[start..=end].to_string();
        }
    }
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            return trimmed[start..=end].to_string();
        }
    }

    trimmed.to_string()
}
