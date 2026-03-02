use async_trait::async_trait;
use reqwest::Client;
use std::time::Instant;

use crate::config::ProviderConfig;
use crate::error::{LlmError, LlmResult};
use crate::provider::LlmProvider;
use crate::types::*;

/// OpenAI-compatible provider (also used for Groq, Together, Fireworks, etc.)
pub struct OpenAiProvider {
    config: ProviderConfig,
    client: Client,
}

impl OpenAiProvider {
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
            .unwrap_or(self.config.provider_type.default_base_url())
    }

    fn auth_headers(&self) -> Vec<(&str, String)> {
        let mut headers = Vec::new();
        if let Some(ref key) = self.config.api_key {
            headers.push(("Authorization", format!("Bearer {}", key)));
        }
        if let Some(ref org) = self.config.org_id {
            headers.push(("OpenAI-Organization", org.clone()));
        }
        if let Some(ref project) = self.config.project_id {
            headers.push(("OpenAI-Project", project.clone()));
        }
        headers
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn provider_type(&self) -> ProviderType {
        self.config.provider_type.clone()
    }

    fn display_name(&self) -> String {
        self.config.display_name.clone()
    }

    async fn chat_completion(&self, request: &ChatCompletionRequest) -> LlmResult<ChatCompletionResponse> {
        let url = format!("{}/chat/completions", self.base_url());
        let start = Instant::now();

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "stream": false,
        });

        if let Some(t) = request.temperature { body["temperature"] = serde_json::json!(t); }
        if let Some(tp) = request.top_p { body["top_p"] = serde_json::json!(tp); }
        if let Some(mt) = request.max_tokens { body["max_tokens"] = serde_json::json!(mt); }
        if let Some(ref stop) = request.stop { body["stop"] = serde_json::json!(stop); }
        if let Some(ref tools) = request.tools { body["tools"] = serde_json::json!(tools); }
        if let Some(ref tc) = request.tool_choice { body["tool_choice"] = serde_json::json!(tc); }
        if let Some(ref rf) = request.response_format { body["response_format"] = serde_json::json!(rf); }
        if let Some(s) = request.seed { body["seed"] = serde_json::json!(s); }
        if let Some(fp) = request.frequency_penalty { body["frequency_penalty"] = serde_json::json!(fp); }
        if let Some(pp) = request.presence_penalty { body["presence_penalty"] = serde_json::json!(pp); }

        let mut req_builder = self.client.post(&url).json(&body);
        for (key, value) in self.auth_headers() {
            req_builder = req_builder.header(key, value);
        }
        for (key, value) in &self.config.custom_headers {
            req_builder = req_builder.header(key.as_str(), value.as_str());
        }

        let resp = req_builder.send().await?;
        let status = resp.status();
        let latency = start.elapsed().as_millis() as u64;

        if !status.is_success() {
            let body_text = resp.text().await.unwrap_or_default();
            let error_msg = serde_json::from_str::<serde_json::Value>(&body_text)
                .ok()
                .and_then(|v| v["error"]["message"].as_str().map(String::from))
                .unwrap_or(body_text);
            return Err(LlmError::provider_error(
                &self.config.display_name,
                &error_msg,
                Some(status.as_u16()),
            ));
        }

        let body: serde_json::Value = resp.json().await?;

        let choices: Vec<Choice> = body["choices"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let msg = &c["message"];
                let tool_calls = msg["tool_calls"].as_array().map(|tcs| {
                    tcs.iter()
                        .filter_map(|tc| {
                            Some(ToolCall {
                                id: tc["id"].as_str()?.to_string(),
                                call_type: "function".to_string(),
                                function: FunctionCall {
                                    name: tc["function"]["name"].as_str()?.to_string(),
                                    arguments: tc["function"]["arguments"].as_str()?.to_string(),
                                },
                            })
                        })
                        .collect()
                });

                Choice {
                    index: i as u32,
                    message: ChatMessage {
                        role: MessageRole::Assistant,
                        content: MessageContent::Text(
                            msg["content"].as_str().unwrap_or("").to_string(),
                        ),
                        name: None,
                        tool_calls,
                        tool_call_id: None,
                    },
                    finish_reason: c["finish_reason"].as_str().map(String::from),
                    logprobs: c.get("logprobs").cloned(),
                }
            })
            .collect();

        let usage_val = &body["usage"];
        let usage = TokenUsage {
            prompt_tokens: usage_val["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: usage_val["completion_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: usage_val["total_tokens"].as_u64().unwrap_or(0) as u32,
            cache_read_tokens: usage_val["prompt_tokens_details"]["cached_tokens"]
                .as_u64()
                .map(|v| v as u32),
            cache_creation_tokens: None,
        };

        Ok(ChatCompletionResponse {
            id: body["id"].as_str().unwrap_or("").to_string(),
            model: body["model"].as_str().unwrap_or(&request.model).to_string(),
            choices,
            usage,
            created: body["created"].as_i64().unwrap_or(0),
            provider: self.config.id.clone(),
            cached: false,
            latency_ms: latency,
        })
    }

    async fn stream_chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<tokio::sync::mpsc::Receiver<LlmResult<StreamChunk>>> {
        let url = format!("{}/chat/completions", self.base_url());
        let (tx, rx) = tokio::sync::mpsc::channel(128);

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "stream": true,
            "stream_options": {"include_usage": true},
        });

        if let Some(t) = request.temperature { body["temperature"] = serde_json::json!(t); }
        if let Some(tp) = request.top_p { body["top_p"] = serde_json::json!(tp); }
        if let Some(mt) = request.max_tokens { body["max_tokens"] = serde_json::json!(mt); }
        if let Some(ref tools) = request.tools { body["tools"] = serde_json::json!(tools); }
        if let Some(ref tc) = request.tool_choice { body["tool_choice"] = serde_json::json!(tc); }

        let mut req_builder = self.client.post(&url).json(&body);
        for (key, value) in self.auth_headers() {
            req_builder = req_builder.header(key, value);
        }
        for (key, value) in &self.config.custom_headers {
            req_builder = req_builder.header(key.as_str(), value.as_str());
        }

        let provider_name = self.config.id.clone();
        let model = request.model.clone();

        let resp = req_builder.send().await?;
        if !resp.status().is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error(&provider_name, &err_text, None));
        }

        tokio::spawn(async move {
            use futures::StreamExt;
            let mut stream = resp.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(pos) = buffer.find("\n\n") {
                            let line = buffer[..pos].to_string();
                            buffer = buffer[pos + 2..].to_string();
                            let data = line.strip_prefix("data: ").unwrap_or(&line);
                            if data.trim() == "[DONE]" {
                                return;
                            }
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(choices) = val["choices"].as_array() {
                                    for choice in choices {
                                        let delta = &choice["delta"];
                                        let tool_calls = delta["tool_calls"].as_array().map(|tcs| {
                                            tcs.iter().filter_map(|tc| {
                                                Some(ToolCallDelta {
                                                    index: tc["index"].as_u64()? as u32,
                                                    id: tc["id"].as_str().map(String::from),
                                                    function: Some(FunctionCallDelta {
                                                        name: tc["function"]["name"].as_str().map(String::from),
                                                        arguments: tc["function"]["arguments"].as_str().map(String::from),
                                                    }),
                                                })
                                            }).collect()
                                        });

                                        let chunk = StreamChunk {
                                            id: val["id"].as_str().unwrap_or("").to_string(),
                                            model: model.clone(),
                                            provider: provider_name.clone(),
                                            delta: StreamDelta {
                                                role: delta["role"].as_str().map(|_| MessageRole::Assistant),
                                                content: delta["content"].as_str().map(String::from),
                                                tool_calls,
                                            },
                                            finish_reason: choice["finish_reason"].as_str().map(String::from),
                                            usage: val.get("usage").and_then(|u| {
                                                Some(TokenUsage {
                                                    prompt_tokens: u["prompt_tokens"].as_u64()? as u32,
                                                    completion_tokens: u["completion_tokens"].as_u64()? as u32,
                                                    total_tokens: u["total_tokens"].as_u64()? as u32,
                                                    cache_read_tokens: None,
                                                    cache_creation_tokens: None,
                                                })
                                            }),
                                            index: choice["index"].as_u64().unwrap_or(0) as u32,
                                        };
                                        let _ = tx.send(Ok(chunk)).await;
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
        let url = format!("{}/models", self.base_url());
        let mut req = self.client.get(&url);
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            return Ok(Vec::new());
        }
        let body: serde_json::Value = resp.json().await?;
        let models = body["data"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|m| {
                let id = m["id"].as_str()?.to_string();
                Some(ModelInfo {
                    id: id.clone(),
                    name: id.clone(),
                    provider: self.config.id.clone(),
                    context_window: 0,
                    max_output_tokens: None,
                    supports_vision: false,
                    supports_tools: false,
                    supports_streaming: true,
                    supports_json_mode: false,
                    supports_system_message: true,
                    input_cost_per_million: 0.0,
                    output_cost_per_million: 0.0,
                    capabilities: vec![ModelCapability::Chat],
                    knowledge_cutoff: None,
                    deprecated: false,
                })
            })
            .collect();
        Ok(models)
    }

    async fn health_check(&self) -> LlmResult<bool> {
        let url = format!("{}/models", self.base_url());
        let mut req = self.client.get(&url);
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await?;
        Ok(resp.status().is_success())
    }

    async fn create_embedding(&self, request: &EmbeddingRequest) -> LlmResult<EmbeddingResponse> {
        let url = format!("{}/embeddings", self.base_url());
        let body = serde_json::json!({
            "model": request.model,
            "input": request.input,
        });
        let mut req = self.client.post(&url).json(&body);
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error(&self.config.display_name, &err, None));
        }
        let body: serde_json::Value = resp.json().await?;
        let embeddings: Vec<Vec<f32>> = body["data"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|d| {
                d["embedding"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect())
            })
            .collect();

        let usage = TokenUsage {
            prompt_tokens: body["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: 0,
            total_tokens: body["usage"]["total_tokens"].as_u64().unwrap_or(0) as u32,
            cache_read_tokens: None,
            cache_creation_tokens: None,
        };

        Ok(EmbeddingResponse {
            embeddings,
            model: request.model.clone(),
            usage,
            provider: self.config.id.clone(),
        })
    }

    fn supports_tools(&self) -> bool { true }
    fn supports_streaming(&self) -> bool { true }
    fn supports_vision(&self) -> bool { true }
    fn config(&self) -> &ProviderConfig { &self.config }
}
