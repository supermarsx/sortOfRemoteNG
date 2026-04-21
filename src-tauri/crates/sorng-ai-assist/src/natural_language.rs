use crate::completion::extract_json_from_response;
use crate::context::ContextBuilder;
use crate::error::AiAssistError;
use crate::types::*;

use sorng_llm::{ChatCompletionRequest, ChatMessage, LlmServiceState, MessageRole};

/// Translates natural language descriptions into shell commands.
pub struct NaturalLanguageTranslator;

impl NaturalLanguageTranslator {
    /// Convert a natural language query to one or more shell commands.
    pub async fn translate(
        query: &NaturalLanguageQuery,
        ctx: &SessionContext,
        llm_state: &LlmServiceState,
    ) -> Result<NaturalLanguageResult, AiAssistError> {
        let prompt =
            ContextBuilder::build_nl_to_command_prompt(&query.query, ctx, &query.constraints);

        let system_msg = ChatMessage {
            role: MessageRole::System,
            content: sorng_llm::MessageContent::Text(
                "You are an expert shell command translator. Convert natural language to precise, safe shell commands. Respond only with valid JSON.".to_string()
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

        let request = ChatCompletionRequest {
            model: "default".to_string(),
            messages: vec![system_msg, user_msg],
            temperature: Some(0.2),
            max_tokens: Some(2000),
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
        let response = service.chat_completion(request).await?;
        let content = crate::extract_response_text(&response);

        Self::parse_response(&query.query, &content)
    }

    fn parse_response(query: &str, content: &str) -> Result<NaturalLanguageResult, AiAssistError> {
        let json_str = extract_json_from_response(content);
        let val: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| AiAssistError::parse_error(&e.to_string()))?;

        let commands: Vec<GeneratedCommand> = val
            .get("commands")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        let cmd = v.get("command")?.as_str()?.to_string();
                        let explanation = v.get("explanation")?.as_str()?.to_string();
                        let risk_str = v
                            .get("risk_level")
                            .and_then(|r| r.as_str())
                            .unwrap_or("low");
                        let risk = match risk_str {
                            "safe" => RiskLevel::Safe,
                            "low" => RiskLevel::Low,
                            "medium" => RiskLevel::Medium,
                            "high" => RiskLevel::High,
                            "critical" => RiskLevel::Critical,
                            _ => RiskLevel::Low,
                        };
                        let shell_specific = v
                            .get("shell_specific")
                            .and_then(|b| b.as_bool())
                            .unwrap_or(false);
                        Some(GeneratedCommand {
                            command: cmd,
                            explanation,
                            risk_level: risk,
                            shell_specific,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let explanation = val
            .get("explanation")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let confidence = val
            .get("confidence")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);

        let alternatives: Vec<String> = val
            .get("alternatives")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(NaturalLanguageResult {
            query: query.to_string(),
            commands,
            explanation,
            confidence,
            alternatives,
        })
    }
}
