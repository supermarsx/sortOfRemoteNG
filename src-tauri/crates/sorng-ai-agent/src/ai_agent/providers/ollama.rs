// ── Ollama Provider (local LLM) ──────────────────────────────────────────────

use async_trait::async_trait;
use chrono::Utc;
use log::{info, warn};
use reqwest::Client;
use uuid::Uuid;

use crate::ai_agent::types::*;
use super::LlmProvider;

pub struct OllamaProvider {
    client: Client,
    base_url: String,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl OllamaProvider {
    pub fn new(config: &ProviderConfig) -> Result<Self, String> {
        let base_url = config.base_url.clone()
            .unwrap_or_else(|| format!("http://localhost:{}", config.ollama_port));

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        Ok(Self {
            client,
            base_url,
            max_retries: config.max_retries,
            retry_delay_ms: config.retry_delay_ms,
        })
    }

    fn build_messages(&self, messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages.iter().map(|msg| {
            let role = match msg.role {
                MessageRole::System => "system",
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
                MessageRole::Function => "tool",
            };
            let text = msg.content.iter().filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.clone()),
                _ => None,
            }).collect::<Vec<_>>().join("\n");

            let mut obj = serde_json::json!({
                "role": role,
                "content": text,
            });

            // Image support (Ollama supports base64 images)
            let images: Vec<String> = msg.content.iter().filter_map(|b| match b {
                ContentBlock::Image { data, .. } => Some(data.clone()),
                _ => None,
            }).collect();
            if !images.is_empty() {
                obj["images"] = serde_json::json!(images);
            }

            obj
        }).collect()
    }

    fn build_tools_payload(&self, tools: &[ToolDefinition]) -> Vec<serde_json::Value> {
        tools.iter().map(|t| serde_json::json!({
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            }
        })).collect()
    }
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn provider_type(&self) -> AiProvider {
        AiProvider::Ollama
    }

    async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
        let url = format!("{}/api/tags", self.base_url);
        let resp = self.client.get(&url).send().await
            .map_err(|e| format!("Failed to list Ollama models: {}", e))?;
        let body: serde_json::Value = resp.json().await
            .map_err(|e| format!("Failed to parse Ollama models response: {}", e))?;

        let mut models = Vec::new();
        if let Some(list) = body["models"].as_array() {
            for m in list {
                let name = m["name"].as_str().unwrap_or("").to_string();
                let _size = m["size"].as_u64().unwrap_or(0);
                models.push(ModelSpec {
                    provider: AiProvider::Ollama,
                    model_id: name.clone(),
                    display_name: Some(name.clone()),
                    context_window: 32_768, // Default for most Ollama models
                    supports_tools: true,
                    supports_vision: name.contains("llava") || name.contains("vision") || name.contains("bakllava"),
                    supports_streaming: true,
                    input_cost_per_1k: 0.0, // Local = free
                    output_cost_per_1k: 0.0,
                });
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
        let url = format!("{}/api/chat", self.base_url);
        let start = std::time::Instant::now();

        let mut body = serde_json::json!({
            "model": model,
            "messages": self.build_messages(messages),
            "stream": false,
            "options": {
                "temperature": params.temperature,
                "top_p": params.top_p,
                "num_predict": params.max_tokens,
                "frequency_penalty": params.frequency_penalty,
                "presence_penalty": params.presence_penalty,
            },
        });

        if !params.stop.is_empty() {
            body["options"]["stop"] = serde_json::json!(params.stop);
        }
        if let Some(seed) = params.seed {
            body["options"]["seed"] = serde_json::json!(seed);
        }
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(self.build_tools_payload(tools));
        }

        let mut last_err = String::new();
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                info!("Ollama retry attempt {}/{}", attempt, self.max_retries);
                tokio::time::sleep(std::time::Duration::from_millis(
                    self.retry_delay_ms * (attempt as u64),
                )).await;
            }

            match self.client.post(&url).json(&body).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let resp_body: serde_json::Value = resp.json().await
                            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

                        let content_text = resp_body["message"]["content"].as_str().unwrap_or("").to_string();
                        let content = if content_text.is_empty() {
                            Vec::new()
                        } else {
                            vec![ContentBlock::Text { text: content_text }]
                        };

                        let mut tool_calls = Vec::new();
                        if let Some(tcs) = resp_body["message"]["tool_calls"].as_array() {
                            for tc in tcs {
                                tool_calls.push(ToolCall {
                                    id: Uuid::new_v4().to_string(),
                                    call_type: "function".to_string(),
                                    function: FunctionCall {
                                        name: tc["function"]["name"].as_str().unwrap_or("").to_string(),
                                        arguments: tc["function"]["arguments"].to_string(),
                                    },
                                });
                            }
                        }

                        let finish_reason = if !tool_calls.is_empty() {
                            FinishReason::ToolCalls
                        } else if resp_body["done"].as_bool().unwrap_or(true) {
                            FinishReason::Stop
                        } else {
                            FinishReason::Length
                        };

                        let prompt_tokens = resp_body["prompt_eval_count"].as_u64().unwrap_or(0) as u32;
                        let completion_tokens = resp_body["eval_count"].as_u64().unwrap_or(0) as u32;

                        return Ok(ChatResponse {
                            id: Uuid::new_v4().to_string(),
                            provider: AiProvider::Ollama,
                            model: model.to_string(),
                            message: ChatMessage {
                                id: Uuid::new_v4().to_string(),
                                role: MessageRole::Assistant,
                                content,
                                tool_call_id: None,
                                tool_calls,
                                name: None,
                                created_at: Utc::now(),
                                token_count: Some(completion_tokens),
                                metadata: std::collections::HashMap::new(),
                            },
                            finish_reason,
                            usage: TokenUsage {
                                prompt_tokens,
                                completion_tokens,
                                total_tokens: prompt_tokens + completion_tokens,
                                estimated_cost: 0.0,
                            },
                            created_at: Utc::now(),
                            latency_ms: start.elapsed().as_millis() as u64,
                            metadata: std::collections::HashMap::new(),
                        });
                    } else {
                        let status = resp.status();
                        let err_body = resp.text().await.unwrap_or_default();
                        last_err = format!("Ollama API error {}: {}", status, err_body);
                        if status.is_server_error() {
                            warn!("{}", last_err);
                            continue;
                        }
                        return Err(last_err);
                    }
                }
                Err(e) => {
                    last_err = format!("Ollama request failed: {}", e);
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
        let url = format!("{}/api/chat", self.base_url);
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let request_id = request_id.to_string();
        let model_str = model.to_string();

        let mut body = serde_json::json!({
            "model": model,
            "messages": self.build_messages(messages),
            "stream": true,
            "options": {
                "temperature": params.temperature,
                "top_p": params.top_p,
                "num_predict": params.max_tokens,
            },
        });

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

                    if line.is_empty() { continue; }

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                        let done = parsed["done"].as_bool().unwrap_or(false);

                        if let Some(content) = parsed["message"]["content"].as_str() {
                            if !content.is_empty() {
                                accumulated.push_str(content);
                                let _ = tx.send(StreamEvent::Delta {
                                    request_id: request_id.clone(),
                                    content: content.to_string(),
                                    accumulated: accumulated.clone(),
                                }).await;
                            }
                        }

                        if done {
                            usage.prompt_tokens = parsed["prompt_eval_count"].as_u64().unwrap_or(0) as u32;
                            usage.completion_tokens = parsed["eval_count"].as_u64().unwrap_or(0) as u32;
                            usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

                            let _ = tx.send(StreamEvent::Done {
                                request_id: request_id.clone(),
                                finish_reason: FinishReason::Stop,
                                usage: usage.clone(),
                                latency_ms: start.elapsed().as_millis() as u64,
                            }).await;
                            return;
                        }
                    }
                }
            }

            let _ = tx.send(StreamEvent::Done {
                request_id,
                finish_reason: FinishReason::Stop,
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
        _dimensions: Option<usize>,
    ) -> Result<EmbeddingResponse, String> {
        let model = model.unwrap_or("nomic-embed-text");
        let url = format!("{}/api/embed", self.base_url);

        let body = serde_json::json!({
            "model": model,
            "input": texts,
        });

        let resp = self.client.post(&url).json(&body).send().await
            .map_err(|e| format!("Ollama embedding request failed: {}", e))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama embedding API error: {}", err));
        }

        let resp_body: serde_json::Value = resp.json().await
            .map_err(|e| format!("Failed to parse Ollama embedding response: {}", e))?;

        let mut embeddings = Vec::new();
        if let Some(emb_list) = resp_body["embeddings"].as_array() {
            for emb in emb_list {
                if let Some(arr) = emb.as_array() {
                    let vec: Vec<f32> = arr.iter()
                        .filter_map(|v| v.as_f64().map(|f| f as f32))
                        .collect();
                    embeddings.push(vec);
                }
            }
        }

        let dim = embeddings.first().map(|v| v.len()).unwrap_or(768);

        Ok(EmbeddingResponse {
            embeddings,
            model: model.to_string(),
            usage: TokenUsage::default(),
            dimensions: dim,
        })
    }

    async fn health_check(&self) -> Result<u64, String> {
        let url = format!("{}/api/tags", self.base_url);
        let start = std::time::Instant::now();
        self.client.get(&url).send().await
            .map_err(|e| format!("Ollama health check failed: {}. Is Ollama running?", e))?;
        Ok(start.elapsed().as_millis() as u64)
    }
}
