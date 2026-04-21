use async_trait::async_trait;
use reqwest::Client;
use std::time::Instant;

use crate::config::ProviderConfig;
use crate::error::{LlmError, LlmResult};
use crate::provider::LlmProvider;
use crate::types::*;

/// Anthropic Claude provider (Messages API)
pub struct AnthropicProvider {
    config: ProviderConfig,
    client: Client,
}

impl AnthropicProvider {
    pub fn new(config: ProviderConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .unwrap_or_default();
        Self { config, client }
    }

    fn base_url(&self) -> &str {
        self.config
            .base_url
            .as_deref()
            .unwrap_or("https://api.anthropic.com/v1")
    }

    fn build_messages(&self, messages: &[ChatMessage]) -> (Option<String>, Vec<serde_json::Value>) {
        let mut system_prompt = None;
        let mut api_messages = Vec::new();

        for msg in messages {
            match msg.role {
                MessageRole::System => {
                    system_prompt = Some(msg.text_content().to_string());
                }
                MessageRole::User | MessageRole::Assistant => {
                    let role = match msg.role {
                        MessageRole::User => "user",
                        MessageRole::Assistant => "assistant",
                        _ => continue,
                    };
                    api_messages.push(serde_json::json!({
                        "role": role,
                        "content": msg.text_content(),
                    }));
                }
                MessageRole::Tool => {
                    api_messages.push(serde_json::json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": msg.tool_call_id.as_deref().unwrap_or(""),
                            "content": msg.text_content(),
                        }],
                    }));
                }
            }
        }

        (system_prompt, api_messages)
    }
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Anthropic
    }
    fn display_name(&self) -> String {
        self.config.display_name.clone()
    }

    async fn chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        let url = format!("{}/messages", self.base_url());
        let start = Instant::now();
        let (system, messages) = self.build_messages(&request.messages);

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens.unwrap_or(4096),
        });

        if let Some(sys) = system {
            body["system"] = serde_json::json!(sys);
        }
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(tp) = request.top_p {
            body["top_p"] = serde_json::json!(tp);
        }
        if let Some(ref tools) = request.tools {
            body["tools"] = crate::tools::tools_to_anthropic(tools);
        }
        if let Some(ref stop) = request.stop {
            body["stop_sequences"] = serde_json::json!(stop);
        }

        let api_key = self.config.api_key.as_deref().unwrap_or("");
        let resp = self
            .client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let latency = start.elapsed().as_millis() as u64;

        if !status.is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error(
                "Anthropic",
                &err,
                Some(status.as_u16()),
            ));
        }

        let response: serde_json::Value = resp.json().await?;

        // Extract content + tool_use blocks
        let content_blocks = response["content"].as_array();
        let mut text_content = String::new();
        let mut tool_calls = Vec::new();

        if let Some(blocks) = content_blocks {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = block["text"].as_str() {
                            text_content.push_str(t);
                        }
                    }
                    Some("tool_use") => {
                        tool_calls.push(ToolCall {
                            id: block["id"].as_str().unwrap_or("").to_string(),
                            call_type: "function".to_string(),
                            function: FunctionCall {
                                name: block["name"].as_str().unwrap_or("").to_string(),
                                arguments: block["input"].to_string(),
                            },
                        });
                    }
                    _ => {}
                }
            }
        }

        let usage = TokenUsage {
            prompt_tokens: response["usage"]["input_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: response["usage"]["output_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: (response["usage"]["input_tokens"].as_u64().unwrap_or(0)
                + response["usage"]["output_tokens"].as_u64().unwrap_or(0))
                as u32,
            cache_read_tokens: response["usage"]["cache_read_input_tokens"]
                .as_u64()
                .map(|v| v as u32),
            cache_creation_tokens: response["usage"]["cache_creation_input_tokens"]
                .as_u64()
                .map(|v| v as u32),
        };

        Ok(ChatCompletionResponse {
            id: response["id"].as_str().unwrap_or("").to_string(),
            model: response["model"]
                .as_str()
                .unwrap_or(&request.model)
                .to_string(),
            choices: vec![Choice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: MessageContent::Text(text_content),
                    name: None,
                    tool_calls: if tool_calls.is_empty() {
                        None
                    } else {
                        Some(tool_calls)
                    },
                    tool_call_id: None,
                },
                finish_reason: response["stop_reason"].as_str().map(|r| match r {
                    "end_turn" => "stop".to_string(),
                    "tool_use" => "tool_calls".to_string(),
                    other => other.to_string(),
                }),
                logprobs: None,
            }],
            usage,
            created: chrono::Utc::now().timestamp(),
            provider: self.config.id.clone(),
            cached: false,
            latency_ms: latency,
        })
    }

    async fn stream_chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<tokio::sync::mpsc::Receiver<LlmResult<StreamChunk>>> {
        let url = format!("{}/messages", self.base_url());
        let (tx, rx) = tokio::sync::mpsc::channel(128);
        let (system, messages) = self.build_messages(&request.messages);

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "stream": true,
        });

        if let Some(sys) = system {
            body["system"] = serde_json::json!(sys);
        }
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(ref tools) = request.tools {
            body["tools"] = crate::tools::tools_to_anthropic(tools);
        }

        let api_key = self.config.api_key.clone().unwrap_or_default();
        let provider_name = self.config.id.clone();
        let model = request.model.clone();

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error("Anthropic", &err, None));
        }

        tokio::spawn(async move {
            use futures::StreamExt;
            let mut stream = resp.bytes_stream();
            let mut buffer = String::new();
            let mut msg_id = String::new();

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(pos) = buffer.find("\n\n") {
                            let line = buffer[..pos].to_string();
                            buffer = buffer[pos + 2..].to_string();

                            if let Some(data) = line.strip_prefix("data: ") {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                                    match val["type"].as_str() {
                                        Some("message_start") => {
                                            msg_id = val["message"]["id"]
                                                .as_str()
                                                .unwrap_or("")
                                                .to_string();
                                        }
                                        Some("content_block_delta") => {
                                            let delta = &val["delta"];
                                            let content = delta["text"].as_str().map(String::from);
                                            let chunk = StreamChunk {
                                                id: msg_id.clone(),
                                                model: model.clone(),
                                                provider: provider_name.clone(),
                                                delta: StreamDelta {
                                                    role: None,
                                                    content,
                                                    tool_calls: None,
                                                },
                                                finish_reason: None,
                                                usage: None,
                                                index: 0,
                                            };
                                            let _ = tx.send(Ok(chunk)).await;
                                        }
                                        Some("message_delta") => {
                                            let usage =
                                                val["usage"].as_object().map(|u| TokenUsage {
                                                    prompt_tokens: 0,
                                                    completion_tokens: u
                                                        .get("output_tokens")
                                                        .and_then(|v| v.as_u64())
                                                        .unwrap_or(0)
                                                        as u32,
                                                    total_tokens: u
                                                        .get("output_tokens")
                                                        .and_then(|v| v.as_u64())
                                                        .unwrap_or(0)
                                                        as u32,
                                                    cache_read_tokens: None,
                                                    cache_creation_tokens: None,
                                                });
                                            let chunk = StreamChunk {
                                                id: msg_id.clone(),
                                                model: model.clone(),
                                                provider: provider_name.clone(),
                                                delta: StreamDelta::default(),
                                                finish_reason: val["delta"]["stop_reason"]
                                                    .as_str()
                                                    .map(|r| r.to_string()),
                                                usage,
                                                index: 0,
                                            };
                                            let _ = tx.send(Ok(chunk)).await;
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(LlmError::stream_error(&e.to_string()))).await;
                        return;
                    }
                }
            }
        });

        Ok(rx)
    }

    async fn list_models(&self) -> LlmResult<Vec<ModelInfo>> {
        Ok(crate::config::build_model_catalog()
            .into_iter()
            .filter(|m| m.provider == "anthropic")
            .collect())
    }

    async fn health_check(&self) -> LlmResult<bool> {
        // Anthropic doesn't have a models endpoint; just check reachability
        let resp = self.client.get(self.base_url()).send().await;
        Ok(resp.is_ok())
    }

    fn supports_tools(&self) -> bool {
        true
    }
    fn supports_streaming(&self) -> bool {
        true
    }
    fn supports_vision(&self) -> bool {
        true
    }
    fn config(&self) -> &ProviderConfig {
        &self.config
    }
}
