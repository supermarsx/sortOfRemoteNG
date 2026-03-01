// ── OpenAI Provider ───────────────────────────────────────────────────────────

use async_trait::async_trait;
use chrono::Utc;
use log::{info, warn};
use reqwest::Client;
use uuid::Uuid;

use crate::ai_agent::types::*;
use super::LlmProvider;

const OPENAI_API_BASE: &str = "https://api.openai.com/v1";

pub struct OpenAiProvider {
    client: Client,
    api_key: String,
    base_url: String,
    organization: Option<String>,
    timeout_secs: u64,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl OpenAiProvider {
    pub fn new(config: &ProviderConfig) -> Result<Self, String> {
        let api_key = config.api_key.clone()
            .ok_or("OpenAI requires an API key")?;
        let base_url = config.base_url.clone()
            .unwrap_or_else(|| OPENAI_API_BASE.to_string());

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("Authorization", format!("Bearer {}", api_key).parse().map_err(|e| format!("{}", e))?);
        if let Some(ref org) = config.organization {
            headers.insert("OpenAI-Organization", org.parse().map_err(|e| format!("{}", e))?);
        }
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
            organization: config.organization.clone(),
            timeout_secs: config.timeout_secs,
            max_retries: config.max_retries,
            retry_delay_ms: config.retry_delay_ms,
        })
    }

    fn build_messages_payload(&self, messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages.iter().map(|msg| {
            let role = match msg.role {
                MessageRole::System => "system",
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
                MessageRole::Function => "function",
            };

            let content = if msg.content.len() == 1 {
                if let ContentBlock::Text { ref text } = msg.content[0] {
                    serde_json::Value::String(text.clone())
                } else {
                    self.build_content_array(&msg.content)
                }
            } else if msg.content.is_empty() {
                serde_json::Value::Null
            } else {
                self.build_content_array(&msg.content)
            };

            let mut obj = serde_json::json!({
                "role": role,
                "content": content,
            });

            if !msg.tool_calls.is_empty() {
                obj["tool_calls"] = serde_json::json!(msg.tool_calls.iter().map(|tc| {
                    serde_json::json!({
                        "id": tc.id,
                        "type": tc.call_type,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    })
                }).collect::<Vec<_>>());
            }

            if let Some(ref tool_call_id) = msg.tool_call_id {
                obj["tool_call_id"] = serde_json::Value::String(tool_call_id.clone());
            }
            if let Some(ref name) = msg.name {
                obj["name"] = serde_json::Value::String(name.clone());
            }

            obj
        }).collect()
    }

    fn build_content_array(&self, blocks: &[ContentBlock]) -> serde_json::Value {
        serde_json::Value::Array(blocks.iter().map(|b| match b {
            ContentBlock::Text { text } => serde_json::json!({
                "type": "text",
                "text": text,
            }),
            ContentBlock::Image { data, media_type } => {
                if data.starts_with("http") {
                    serde_json::json!({
                        "type": "image_url",
                        "image_url": { "url": data }
                    })
                } else {
                    let mt = media_type.as_deref().unwrap_or("image/png");
                    serde_json::json!({
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{};base64,{}", mt, data)
                        }
                    })
                }
            }
        }).collect())
    }

    fn build_tools_payload(&self, tools: &[ToolDefinition]) -> Vec<serde_json::Value> {
        tools.iter().map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            })
        }).collect()
    }

    fn parse_response(&self, body: &serde_json::Value) -> Result<ChatResponse, String> {
        let choice = body["choices"].get(0)
            .ok_or("No choices in OpenAI response")?;

        let message = &choice["message"];
        let role_str = message["role"].as_str().unwrap_or("assistant");
        let role = match role_str {
            "system" => MessageRole::System,
            "user" => MessageRole::User,
            "assistant" => MessageRole::Assistant,
            "tool" => MessageRole::Tool,
            _ => MessageRole::Assistant,
        };

        let content_text = message["content"].as_str().unwrap_or("").to_string();
        let content = if content_text.is_empty() {
            Vec::new()
        } else {
            vec![ContentBlock::Text { text: content_text }]
        };

        let mut tool_calls = Vec::new();
        if let Some(tcs) = message["tool_calls"].as_array() {
            for tc in tcs {
                tool_calls.push(ToolCall {
                    id: tc["id"].as_str().unwrap_or("").to_string(),
                    call_type: tc["type"].as_str().unwrap_or("function").to_string(),
                    function: FunctionCall {
                        name: tc["function"]["name"].as_str().unwrap_or("").to_string(),
                        arguments: tc["function"]["arguments"].as_str().unwrap_or("{}").to_string(),
                    },
                });
            }
        }

        let finish_str = choice["finish_reason"].as_str().unwrap_or("stop");
        let finish_reason = match finish_str {
            "stop" => FinishReason::Stop,
            "length" => FinishReason::Length,
            "tool_calls" => FinishReason::ToolCalls,
            "content_filter" => FinishReason::ContentFilter,
            _ => FinishReason::Unknown,
        };

        let usage_obj = &body["usage"];
        let usage = TokenUsage {
            prompt_tokens: usage_obj["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: usage_obj["completion_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: usage_obj["total_tokens"].as_u64().unwrap_or(0) as u32,
            estimated_cost: 0.0,
        };

        let model = body["model"].as_str().unwrap_or("").to_string();

        Ok(ChatResponse {
            id: body["id"].as_str().unwrap_or("").to_string(),
            provider: AiProvider::OpenAi,
            model,
            message: ChatMessage {
                id: Uuid::new_v4().to_string(),
                role,
                content,
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
impl LlmProvider for OpenAiProvider {
    fn provider_type(&self) -> AiProvider {
        AiProvider::OpenAi
    }

    async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
        let url = format!("{}/models", self.base_url);
        let resp = self.client.get(&url)
            .send().await
            .map_err(|e| format!("Failed to list OpenAI models: {}", e))?;
        let body: serde_json::Value = resp.json().await
            .map_err(|e| format!("Failed to parse OpenAI models response: {}", e))?;

        let mut models = Vec::new();
        if let Some(data) = body["data"].as_array() {
            for m in data {
                let id = m["id"].as_str().unwrap_or("").to_string();
                // Only include GPT and o-series models
                if id.starts_with("gpt") || id.starts_with("o1") || id.starts_with("o3") || id.starts_with("o4") {
                    models.push(ModelSpec {
                        provider: AiProvider::OpenAi,
                        model_id: id.clone(),
                        display_name: Some(id.clone()),
                        context_window: Self::estimate_context_window(&id),
                        supports_tools: true,
                        supports_vision: id.contains("vision") || id.contains("gpt-4o") || id.contains("gpt-4-turbo"),
                        supports_streaming: true,
                        input_cost_per_1k: Self::estimate_input_cost(&id),
                        output_cost_per_1k: Self::estimate_output_cost(&id),
                    });
                }
            }
        }
        Ok(models)
    }

    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        model: &str,
        params: &InferenceParams,
        tools: &[ToolDefinition],
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/chat/completions", self.base_url);
        let start = std::time::Instant::now();

        let mut body = serde_json::json!({
            "model": model,
            "messages": self.build_messages_payload(messages),
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "top_p": params.top_p,
            "frequency_penalty": params.frequency_penalty,
            "presence_penalty": params.presence_penalty,
        });

        if !params.stop.is_empty() {
            body["stop"] = serde_json::json!(params.stop);
        }
        if let Some(seed) = params.seed {
            body["seed"] = serde_json::json!(seed);
        }
        if let Some(ref fmt) = params.response_format {
            body["response_format"] = serde_json::json!({"type": fmt});
        }
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(self.build_tools_payload(tools));
        }

        let mut last_err = String::new();
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                info!("OpenAI retry attempt {}/{}", attempt, self.max_retries);
                tokio::time::sleep(std::time::Duration::from_millis(
                    self.retry_delay_ms * (attempt as u64),
                )).await;
            }

            match self.client.post(&url).json(&body).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let resp_body: serde_json::Value = resp.json().await
                            .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;
                        let mut result = self.parse_response(&resp_body)?;
                        result.latency_ms = start.elapsed().as_millis() as u64;
                        return Ok(result);
                    } else {
                        let status = resp.status();
                        let err_body = resp.text().await.unwrap_or_default();
                        last_err = format!("OpenAI API error {}: {}", status, err_body);
                        if status.as_u16() == 429 || status.is_server_error() {
                            warn!("{}", last_err);
                            continue;
                        }
                        return Err(last_err);
                    }
                }
                Err(e) => {
                    last_err = format!("OpenAI request failed: {}", e);
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
        let url = format!("{}/chat/completions", self.base_url);
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let request_id = request_id.to_string();
        let model_str = model.to_string();

        let mut body = serde_json::json!({
            "model": model,
            "messages": self.build_messages_payload(messages),
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "top_p": params.top_p,
            "frequency_penalty": params.frequency_penalty,
            "presence_penalty": params.presence_penalty,
            "stream": true,
            "stream_options": { "include_usage": true },
        });

        if !params.stop.is_empty() {
            body["stop"] = serde_json::json!(params.stop);
        }
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(self.build_tools_payload(tools));
        }

        let client = self.client.clone();
        tokio::spawn(async move {
            let start = std::time::Instant::now();
            let _ = tx.send(StreamEvent::Start {
                request_id: request_id.clone(),
                model: model_str.clone(),
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

                // Process complete SSE lines
                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].trim().to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if line.is_empty() || line.starts_with(':') {
                        continue;
                    }

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data.trim() == "[DONE]" {
                            let _ = tx.send(StreamEvent::Done {
                                request_id: request_id.clone(),
                                finish_reason: finish_reason.clone(),
                                usage: usage.clone(),
                                latency_ms: start.elapsed().as_millis() as u64,
                            }).await;
                            return;
                        }

                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(choices) = parsed["choices"].as_array() {
                                if let Some(choice) = choices.first() {
                                    if let Some(delta) = choice.get("delta") {
                                        if let Some(content) = delta["content"].as_str() {
                                            accumulated.push_str(content);
                                            let _ = tx.send(StreamEvent::Delta {
                                                request_id: request_id.clone(),
                                                content: content.to_string(),
                                                accumulated: accumulated.clone(),
                                            }).await;
                                        }

                                        // Tool call deltas
                                        if let Some(tcs) = delta["tool_calls"].as_array() {
                                            for tc in tcs {
                                                let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                                                let name = tc["function"]["name"].as_str().map(|s| s.to_string());
                                                let args = tc["function"]["arguments"].as_str().unwrap_or("");
                                                let _ = tx.send(StreamEvent::ToolCallDelta {
                                                    request_id: request_id.clone(),
                                                    tool_call_index: idx,
                                                    name,
                                                    arguments_delta: args.to_string(),
                                                }).await;
                                            }
                                        }
                                    }

                                    if let Some(fr) = choice["finish_reason"].as_str() {
                                        finish_reason = match fr {
                                            "stop" => FinishReason::Stop,
                                            "length" => FinishReason::Length,
                                            "tool_calls" => FinishReason::ToolCalls,
                                            "content_filter" => FinishReason::ContentFilter,
                                            _ => FinishReason::Unknown,
                                        };
                                    }
                                }
                            }

                            if let Some(u) = parsed.get("usage") {
                                usage.prompt_tokens = u["prompt_tokens"].as_u64().unwrap_or(0) as u32;
                                usage.completion_tokens = u["completion_tokens"].as_u64().unwrap_or(0) as u32;
                                usage.total_tokens = u["total_tokens"].as_u64().unwrap_or(0) as u32;
                            }
                        }
                    }
                }
            }

            // Stream ended without [DONE]
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
        texts: &[String],
        model: Option<&str>,
        dimensions: Option<usize>,
    ) -> Result<EmbeddingResponse, String> {
        let url = format!("{}/embeddings", self.base_url);
        let model = model.unwrap_or("text-embedding-3-small");

        let mut body = serde_json::json!({
            "model": model,
            "input": texts,
        });

        if let Some(dim) = dimensions {
            body["dimensions"] = serde_json::json!(dim);
        }

        let resp = self.client.post(&url).json(&body).send().await
            .map_err(|e| format!("Embedding request failed: {}", e))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(format!("Embedding API error: {}", err));
        }

        let resp_body: serde_json::Value = resp.json().await
            .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

        let mut embeddings = Vec::new();
        let actual_dim;
        if let Some(data) = resp_body["data"].as_array() {
            for item in data {
                if let Some(emb) = item["embedding"].as_array() {
                    let vec: Vec<f32> = emb.iter()
                        .filter_map(|v| v.as_f64().map(|f| f as f32))
                        .collect();
                    embeddings.push(vec);
                }
            }
            actual_dim = embeddings.first().map(|v| v.len()).unwrap_or(0);
        } else {
            actual_dim = 0;
        }

        let usage_obj = &resp_body["usage"];
        let usage = TokenUsage {
            prompt_tokens: usage_obj["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: 0,
            total_tokens: usage_obj["total_tokens"].as_u64().unwrap_or(0) as u32,
            estimated_cost: 0.0,
        };

        Ok(EmbeddingResponse {
            embeddings,
            model: model.to_string(),
            usage,
            dimensions: actual_dim,
        })
    }

    async fn health_check(&self) -> Result<u64, String> {
        let url = format!("{}/models", self.base_url);
        let start = std::time::Instant::now();
        self.client.get(&url)
            .send().await
            .map_err(|e| format!("Health check failed: {}", e))?;
        Ok(start.elapsed().as_millis() as u64)
    }
}

impl OpenAiProvider {
    fn estimate_context_window(model_id: &str) -> u32 {
        if model_id.contains("gpt-4o") || model_id.contains("o1") || model_id.contains("o3") || model_id.contains("o4") {
            128_000
        } else if model_id.contains("gpt-4-turbo") || model_id.contains("gpt-4-1106") {
            128_000
        } else if model_id.contains("gpt-4-32k") {
            32_768
        } else if model_id.contains("gpt-4") {
            8_192
        } else if model_id.contains("gpt-3.5-turbo-16k") {
            16_384
        } else if model_id.contains("gpt-3.5") {
            4_096
        } else {
            4_096
        }
    }

    fn estimate_input_cost(model_id: &str) -> f64 {
        if model_id.contains("gpt-4o-mini") { 0.00015 }
        else if model_id.contains("gpt-4o") { 0.0025 }
        else if model_id.contains("gpt-4-turbo") { 0.01 }
        else if model_id.contains("gpt-4") { 0.03 }
        else if model_id.contains("gpt-3.5") { 0.0005 }
        else { 0.001 }
    }

    fn estimate_output_cost(model_id: &str) -> f64 {
        if model_id.contains("gpt-4o-mini") { 0.0006 }
        else if model_id.contains("gpt-4o") { 0.01 }
        else if model_id.contains("gpt-4-turbo") { 0.03 }
        else if model_id.contains("gpt-4") { 0.06 }
        else if model_id.contains("gpt-3.5") { 0.0015 }
        else { 0.002 }
    }
}
