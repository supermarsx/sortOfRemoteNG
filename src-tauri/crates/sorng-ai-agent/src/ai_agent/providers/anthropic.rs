// ── Anthropic Provider ────────────────────────────────────────────────────────

use async_trait::async_trait;
use chrono::Utc;
use log::{info, warn};
use reqwest::Client;
use uuid::Uuid;

use crate::ai_agent::types::*;
use super::LlmProvider;

const ANTHROPIC_API_BASE: &str = "https://api.anthropic.com/v1";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";

pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    base_url: String,
    timeout_secs: u64,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl AnthropicProvider {
    pub fn new(config: &ProviderConfig) -> Result<Self, String> {
        let api_key = config.api_key.clone()
            .ok_or("Anthropic requires an API key")?;
        let base_url = config.base_url.clone()
            .unwrap_or_else(|| ANTHROPIC_API_BASE.to_string());

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-api-key", api_key.parse().map_err(|e| format!("{}", e))?);
        headers.insert("anthropic-version", ANTHROPIC_API_VERSION.parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());
        for (k, v) in &config.extra_headers {
            headers.insert(
                reqwest::header::HeaderName::from_bytes(k.as_bytes()).map_err(|e| format!("{}", e))?,
                v.parse().map_err(|e| format!("{}", e))?,
            );
        }

        let client = Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        Ok(Self {
            client,
            api_key,
            base_url,
            timeout_secs: config.timeout_secs,
            max_retries: config.max_retries,
            retry_delay_ms: config.retry_delay_ms,
        })
    }

    fn build_messages_payload(&self, messages: &[ChatMessage]) -> (Option<String>, Vec<serde_json::Value>) {
        let mut system_prompt = None;
        let mut msgs = Vec::new();

        for msg in messages {
            if msg.role == MessageRole::System {
                // Anthropic takes system as a top-level parameter
                if let Some(ContentBlock::Text { ref text }) = msg.content.first() {
                    system_prompt = Some(text.clone());
                }
                continue;
            }

            let role = match msg.role {
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "user", // Tool results sent as user messages in Anthropic
                _ => "user",
            };

            let content = self.build_content_blocks(&msg.content, &msg.tool_call_id);
            msgs.push(serde_json::json!({
                "role": role,
                "content": content,
            }));
        }

        (system_prompt, msgs)
    }

    fn build_content_blocks(&self, blocks: &[ContentBlock], tool_call_id: &Option<String>) -> serde_json::Value {
        if let Some(ref tc_id) = tool_call_id {
            // This is a tool result message
            let text = blocks.iter().filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.clone()),
                _ => None,
            }).collect::<Vec<_>>().join("\n");
            return serde_json::json!([{
                "type": "tool_result",
                "tool_use_id": tc_id,
                "content": text,
            }]);
        }

        let arr: Vec<serde_json::Value> = blocks.iter().map(|b| match b {
            ContentBlock::Text { text } => serde_json::json!({
                "type": "text",
                "text": text,
            }),
            ContentBlock::Image { data, media_type } => {
                let mt = media_type.as_deref().unwrap_or("image/png");
                if data.starts_with("http") {
                    serde_json::json!({
                        "type": "image",
                        "source": { "type": "url", "url": data }
                    })
                } else {
                    serde_json::json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mt,
                            "data": data,
                        }
                    })
                }
            }
        }).collect();
        serde_json::Value::Array(arr)
    }

    fn build_tools_payload(&self, tools: &[ToolDefinition]) -> Vec<serde_json::Value> {
        tools.iter().map(|t| serde_json::json!({
            "name": t.name,
            "description": t.description,
            "input_schema": t.parameters,
        })).collect()
    }

    fn parse_response(&self, body: &serde_json::Value) -> Result<ChatResponse, String> {
        let mut text_parts = Vec::new();
        let mut tool_calls = Vec::new();

        if let Some(content) = body["content"].as_array() {
            for block in content {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = block["text"].as_str() {
                            text_parts.push(ContentBlock::Text { text: t.to_string() });
                        }
                    }
                    Some("tool_use") => {
                        let id = block["id"].as_str().unwrap_or("").to_string();
                        let name = block["name"].as_str().unwrap_or("").to_string();
                        let args = block["input"].to_string();
                        tool_calls.push(ToolCall {
                            id,
                            call_type: "function".to_string(),
                            function: FunctionCall { name, arguments: args },
                        });
                    }
                    _ => {}
                }
            }
        }

        let stop_reason = body["stop_reason"].as_str().unwrap_or("end_turn");
        let finish_reason = match stop_reason {
            "end_turn" | "stop_sequence" => FinishReason::Stop,
            "max_tokens" => FinishReason::Length,
            "tool_use" => FinishReason::ToolCalls,
            _ => FinishReason::Unknown,
        };

        let usage_obj = &body["usage"];
        let usage = TokenUsage {
            prompt_tokens: usage_obj["input_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: usage_obj["output_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: (usage_obj["input_tokens"].as_u64().unwrap_or(0)
                + usage_obj["output_tokens"].as_u64().unwrap_or(0)) as u32,
            estimated_cost: 0.0,
        };

        let model = body["model"].as_str().unwrap_or("").to_string();

        Ok(ChatResponse {
            id: body["id"].as_str().unwrap_or("").to_string(),
            provider: AiProvider::Anthropic,
            model,
            message: ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: MessageRole::Assistant,
                content: text_parts,
                tool_call_id: None,
                tool_calls,
                name: None,
                created_at: Utc::now(),
                token_count: Some(usage.completion_tokens),
                metadata: std::collections::HashMap::new(),
            },
            finish_reason,
            usage,
            created_at: Utc::now(),
            latency_ms: 0,
            metadata: std::collections::HashMap::new(),
        })
    }
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn provider_type(&self) -> AiProvider {
        AiProvider::Anthropic
    }

    async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
        Ok(vec![
            ModelSpec {
                provider: AiProvider::Anthropic,
                model_id: "claude-sonnet-4-20250514".into(),
                display_name: Some("Claude Sonnet 4".into()),
                context_window: 200_000,
                supports_tools: true,
                supports_vision: true,
                supports_streaming: true,
                input_cost_per_1k: 0.003,
                output_cost_per_1k: 0.015,
            },
            ModelSpec {
                provider: AiProvider::Anthropic,
                model_id: "claude-opus-4-20250514".into(),
                display_name: Some("Claude Opus 4".into()),
                context_window: 200_000,
                supports_tools: true,
                supports_vision: true,
                supports_streaming: true,
                input_cost_per_1k: 0.015,
                output_cost_per_1k: 0.075,
            },
            ModelSpec {
                provider: AiProvider::Anthropic,
                model_id: "claude-3-5-haiku-20241022".into(),
                display_name: Some("Claude 3.5 Haiku".into()),
                context_window: 200_000,
                supports_tools: true,
                supports_vision: true,
                supports_streaming: true,
                input_cost_per_1k: 0.001,
                output_cost_per_1k: 0.005,
            },
        ])
    }

    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        model: &str,
        params: &InferenceParams,
        tools: &[ToolDefinition],
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/messages", self.base_url);
        let start = std::time::Instant::now();

        let (system, msgs) = self.build_messages_payload(messages);

        let mut body = serde_json::json!({
            "model": model,
            "messages": msgs,
            "max_tokens": params.max_tokens,
            "temperature": params.temperature,
            "top_p": params.top_p,
        });

        if let Some(ref sys) = system {
            body["system"] = serde_json::json!(sys);
        }
        if !params.stop.is_empty() {
            body["stop_sequences"] = serde_json::json!(params.stop);
        }
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(self.build_tools_payload(tools));
        }

        let mut last_err = String::new();
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                info!("Anthropic retry attempt {}/{}", attempt, self.max_retries);
                tokio::time::sleep(std::time::Duration::from_millis(
                    self.retry_delay_ms * (attempt as u64),
                )).await;
            }

            match self.client.post(&url).json(&body).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let resp_body: serde_json::Value = resp.json().await
                            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;
                        let mut result = self.parse_response(&resp_body)?;
                        result.latency_ms = start.elapsed().as_millis() as u64;
                        return Ok(result);
                    } else {
                        let status = resp.status();
                        let err_body = resp.text().await.unwrap_or_default();
                        last_err = format!("Anthropic API error {}: {}", status, err_body);
                        if status.as_u16() == 429 || status.as_u16() == 529 || status.is_server_error() {
                            warn!("{}", last_err);
                            continue;
                        }
                        return Err(last_err);
                    }
                }
                Err(e) => {
                    last_err = format!("Anthropic request failed: {}", e);
                    warn!("{}", last_err);
                }
            }
        }
        Err(last_err)
    }

    async fn chat_completion_stream(
        &self,
        messages: &[ChatMessage],
        model: &str,
        params: &InferenceParams,
        tools: &[ToolDefinition],
        request_id: &str,
    ) -> Result<tokio::sync::mpsc::Receiver<StreamEvent>, String> {
        let url = format!("{}/messages", self.base_url);
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let request_id = request_id.to_string();
        let model_str = model.to_string();

        let (system, msgs) = self.build_messages_payload(messages);

        let mut body = serde_json::json!({
            "model": model,
            "messages": msgs,
            "max_tokens": params.max_tokens,
            "temperature": params.temperature,
            "top_p": params.top_p,
            "stream": true,
        });

        if let Some(ref sys) = system {
            body["system"] = serde_json::json!(sys);
        }
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(self.build_tools_payload(tools));
        }

        let client = self.client.clone();
        tokio::spawn(async move {
            let start = std::time::Instant::now();
            let _ = tx.send(StreamEvent::Start {
                request_id: request_id.clone(),
                model: model_str,
            }).await;

            let resp = match client.post(&url).json(&body).send().await {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(StreamEvent::Error {
                        request_id,
                        error: format!("Request failed: {}", e),
                    }).await;
                    return;
                }
            };

            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                let _ = tx.send(StreamEvent::Error {
                    request_id,
                    error: format!("API error: {}", err),
                }).await;
                return;
            }

            let mut accumulated = String::new();
            let mut usage = TokenUsage::default();
            let mut finish_reason = FinishReason::Unknown;
            let mut stream = resp.bytes_stream();
            use futures::StreamExt;
            let mut buffer = String::new();

            while let Some(chunk_result) = stream.next().await {
                let chunk = match chunk_result {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = tx.send(StreamEvent::Error {
                            request_id: request_id.clone(),
                            error: format!("Stream error: {}", e),
                        }).await;
                        return;
                    }
                };

                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].trim().to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if line.is_empty() || line.starts_with("event:") {
                        continue;
                    }

                    if let Some(data) = line.strip_prefix("data: ") {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                            let event_type = parsed["type"].as_str().unwrap_or("");

                            match event_type {
                                "content_block_delta" => {
                                    if let Some(delta) = parsed.get("delta") {
                                        if delta["type"].as_str() == Some("text_delta") {
                                            if let Some(text) = delta["text"].as_str() {
                                                accumulated.push_str(text);
                                                let _ = tx.send(StreamEvent::Delta {
                                                    request_id: request_id.clone(),
                                                    content: text.to_string(),
                                                    accumulated: accumulated.clone(),
                                                }).await;
                                            }
                                        } else if delta["type"].as_str() == Some("input_json_delta") {
                                            if let Some(json_delta) = delta["partial_json"].as_str() {
                                                let _ = tx.send(StreamEvent::ToolCallDelta {
                                                    request_id: request_id.clone(),
                                                    tool_call_index: 0,
                                                    name: None,
                                                    arguments_delta: json_delta.to_string(),
                                                }).await;
                                            }
                                        }
                                    }
                                }
                                "message_delta" => {
                                    if let Some(delta) = parsed.get("delta") {
                                        if let Some(sr) = delta["stop_reason"].as_str() {
                                            finish_reason = match sr {
                                                "end_turn" | "stop_sequence" => FinishReason::Stop,
                                                "max_tokens" => FinishReason::Length,
                                                "tool_use" => FinishReason::ToolCalls,
                                                _ => FinishReason::Unknown,
                                            };
                                        }
                                    }
                                    if let Some(u) = parsed.get("usage") {
                                        usage.completion_tokens = u["output_tokens"].as_u64().unwrap_or(0) as u32;
                                    }
                                }
                                "message_start" => {
                                    if let Some(msg) = parsed.get("message") {
                                        if let Some(u) = msg.get("usage") {
                                            usage.prompt_tokens = u["input_tokens"].as_u64().unwrap_or(0) as u32;
                                        }
                                    }
                                }
                                "message_stop" => {
                                    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
                                    let _ = tx.send(StreamEvent::Done {
                                        request_id: request_id.clone(),
                                        finish_reason: finish_reason.clone(),
                                        usage: usage.clone(),
                                        latency_ms: start.elapsed().as_millis() as u64,
                                    }).await;
                                    return;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }

            usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
            let _ = tx.send(StreamEvent::Done {
                request_id,
                finish_reason,
                usage,
                latency_ms: start.elapsed().as_millis() as u64,
            }).await;
        });

        Ok(rx)
    }

    async fn generate_embeddings(
        &self,
        _texts: &[String],
        _model: Option<&str>,
        _dimensions: Option<usize>,
    ) -> Result<EmbeddingResponse, String> {
        Err("Anthropic does not provide an embeddings API. Use OpenAI or Cohere for embeddings.".into())
    }

    async fn health_check(&self) -> Result<u64, String> {
        let url = format!("{}/messages", self.base_url);
        let start = std::time::Instant::now();
        // Lightweight validation: send a minimal request that will return quickly
        let body = serde_json::json!({
            "model": "claude-3-5-haiku-20241022",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        });
        let resp = self.client.post(&url).json(&body).send().await
            .map_err(|e| format!("Health check failed: {}", e))?;
        if resp.status().is_success() || resp.status().as_u16() == 400 {
            // 400 = valid connection but bad request is still "healthy"
            Ok(start.elapsed().as_millis() as u64)
        } else {
            Err(format!("Health check returned status {}", resp.status()))
        }
    }
}
