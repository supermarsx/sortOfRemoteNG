use async_trait::async_trait;
use reqwest::Client;
use std::time::Instant;

use crate::config::ProviderConfig;
use crate::error::{LlmError, LlmResult};
use crate::provider::LlmProvider;
use crate::types::*;

/// Ollama local model provider
pub struct OllamaProvider {
    config: ProviderConfig,
    client: Client,
}

impl OllamaProvider {
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
            .unwrap_or("http://localhost:11434")
    }
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Ollama
    }
    fn display_name(&self) -> String {
        self.config.display_name.clone()
    }

    async fn chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        // Use Ollama's OpenAI-compatible endpoint
        let url = format!("{}/v1/chat/completions", self.base_url());
        let start = Instant::now();

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "stream": false,
        });

        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(tp) = request.top_p {
            body["top_p"] = serde_json::json!(tp);
        }
        if let Some(mt) = request.max_tokens {
            body["max_tokens"] = serde_json::json!(mt);
        }
        if let Some(ref tools) = request.tools {
            body["tools"] = serde_json::json!(tools);
        }

        let resp = self.client.post(&url).json(&body).send().await?;
        let status = resp.status();
        let latency = start.elapsed().as_millis() as u64;

        if !status.is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error(
                "Ollama",
                &err,
                Some(status.as_u16()),
            ));
        }

        let response: serde_json::Value = resp.json().await?;

        let choices: Vec<Choice> = response["choices"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
            .map(|(i, c)| Choice {
                index: i as u32,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: MessageContent::Text(
                        c["message"]["content"].as_str().unwrap_or("").to_string(),
                    ),
                    name: None,
                    tool_calls: None,
                    tool_call_id: None,
                },
                finish_reason: c["finish_reason"].as_str().map(String::from),
                logprobs: None,
            })
            .collect();

        let uv = &response["usage"];
        let usage = TokenUsage {
            prompt_tokens: uv["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: uv["completion_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: uv["total_tokens"].as_u64().unwrap_or(0) as u32,
            cache_read_tokens: None,
            cache_creation_tokens: None,
        };

        Ok(ChatCompletionResponse {
            id: response["id"].as_str().unwrap_or("ollama").to_string(),
            model: request.model.clone(),
            choices,
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
        let url = format!("{}/v1/chat/completions", self.base_url());
        let (tx, rx) = tokio::sync::mpsc::channel(128);

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "stream": true,
        });
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(mt) = request.max_tokens {
            body["max_tokens"] = serde_json::json!(mt);
        }

        let provider_name = self.config.id.clone();
        let model = request.model.clone();

        let resp = self.client.post(&url).json(&body).send().await?;
        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error("Ollama", &err, None));
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
                                        let chunk = StreamChunk {
                                            id: val["id"].as_str().unwrap_or("").to_string(),
                                            model: model.clone(),
                                            provider: provider_name.clone(),
                                            delta: StreamDelta {
                                                role: None,
                                                content: choice["delta"]["content"]
                                                    .as_str()
                                                    .map(String::from),
                                                tool_calls: None,
                                            },
                                            finish_reason: choice["finish_reason"]
                                                .as_str()
                                                .map(String::from),
                                            usage: None,
                                            index: 0,
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
        let url = format!("{}/api/tags", self.base_url());
        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Ok(Vec::new());
        }
        let body: serde_json::Value = resp.json().await?;
        let models = body["models"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|m| {
                let name = m["name"].as_str()?.to_string();
                Some(ModelInfo {
                    id: name.clone(),
                    name: name.clone(),
                    provider: self.config.id.clone(),
                    context_window: m["details"]["parameter_size"]
                        .as_str()
                        .and_then(|s| s.replace("B", "").parse::<u32>().ok())
                        .map(|b| if b > 30 { 128_000 } else { 8_192 })
                        .unwrap_or(8_192),
                    max_output_tokens: Some(4_096),
                    supports_vision: name.contains("llava") || name.contains("vision"),
                    supports_tools: true,
                    supports_streaming: true,
                    supports_json_mode: true,
                    supports_system_message: true,
                    input_cost_per_million: 0.0,
                    output_cost_per_million: 0.0,
                    capabilities: vec![ModelCapability::Chat, ModelCapability::CodeGeneration],
                    knowledge_cutoff: None,
                    deprecated: false,
                })
            })
            .collect();
        Ok(models)
    }

    async fn health_check(&self) -> LlmResult<bool> {
        let url = format!("{}/api/tags", self.base_url());
        let resp = self.client.get(&url).send().await;
        Ok(resp.map(|r| r.status().is_success()).unwrap_or(false))
    }

    fn supports_tools(&self) -> bool {
        true
    }
    fn supports_streaming(&self) -> bool {
        true
    }
    fn supports_vision(&self) -> bool {
        false
    }
    fn config(&self) -> &ProviderConfig {
        &self.config
    }
}
