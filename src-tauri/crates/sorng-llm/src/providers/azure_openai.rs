use async_trait::async_trait;
use reqwest::Client;
use std::time::Instant;

use crate::config::ProviderConfig;
use crate::error::{LlmError, LlmResult};
use crate::provider::LlmProvider;
use crate::types::*;

/// Azure OpenAI uses deployment-based URLs instead of model names
pub struct AzureOpenAiProvider {
    config: ProviderConfig,
    client: Client,
}

impl AzureOpenAiProvider {
    pub fn new(config: ProviderConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .unwrap_or_default();
        Self { config, client }
    }

    fn deployment_url(&self, model: &str) -> String {
        let base = self.config.base_url.as_deref().unwrap_or("");
        let deployment = self
            .config
            .deployments
            .get(model)
            .cloned()
            .unwrap_or(model.to_string());
        format!(
            "{}/openai/deployments/{}/chat/completions?api-version=2024-08-01-preview",
            base, deployment
        )
    }
}

#[async_trait]
impl LlmProvider for AzureOpenAiProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::AzureOpenAi
    }
    fn display_name(&self) -> String {
        self.config.display_name.clone()
    }

    async fn chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        let url = self.deployment_url(&request.model);
        let start = Instant::now();

        let mut body = serde_json::json!({
            "messages": request.messages,
            "stream": false,
        });
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(mt) = request.max_tokens {
            body["max_tokens"] = serde_json::json!(mt);
        }
        if let Some(ref tools) = request.tools {
            body["tools"] = serde_json::json!(tools);
        }

        let api_key = self.config.api_key.as_deref().unwrap_or("");
        let resp = self
            .client
            .post(&url)
            .header("api-key", api_key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let latency = start.elapsed().as_millis() as u64;

        if !status.is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error(
                "Azure OpenAI",
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
                    logprobs: None,
                }
            })
            .collect();

        let uv = &response["usage"];
        Ok(ChatCompletionResponse {
            id: response["id"].as_str().unwrap_or("").to_string(),
            model: request.model.clone(),
            choices,
            usage: TokenUsage {
                prompt_tokens: uv["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                completion_tokens: uv["completion_tokens"].as_u64().unwrap_or(0) as u32,
                total_tokens: uv["total_tokens"].as_u64().unwrap_or(0) as u32,
                cache_read_tokens: None,
                cache_creation_tokens: None,
            },
            created: response["created"].as_i64().unwrap_or(0),
            provider: self.config.id.clone(),
            cached: false,
            latency_ms: latency,
        })
    }

    async fn stream_chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<tokio::sync::mpsc::Receiver<LlmResult<StreamChunk>>> {
        // Reuse OpenAI streaming logic with Azure URL
        let url = self.deployment_url(&request.model);
        let (tx, rx) = tokio::sync::mpsc::channel(128);

        let mut body = serde_json::json!({
            "messages": request.messages,
            "stream": true,
        });
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(mt) = request.max_tokens {
            body["max_tokens"] = serde_json::json!(mt);
        }

        let api_key = self.config.api_key.clone().unwrap_or_default();
        let provider_name = self.config.id.clone();
        let model = request.model.clone();

        let resp = self
            .client
            .post(&url)
            .header("api-key", &api_key)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error("Azure OpenAI", &err, None));
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
                                    for c in choices {
                                        let chunk = StreamChunk {
                                            id: val["id"].as_str().unwrap_or("").to_string(),
                                            model: model.clone(),
                                            provider: provider_name.clone(),
                                            delta: StreamDelta {
                                                role: None,
                                                content: c["delta"]["content"]
                                                    .as_str()
                                                    .map(String::from),
                                                tool_calls: None,
                                            },
                                            finish_reason: c["finish_reason"]
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
        Ok(Vec::new())
    }
    async fn health_check(&self) -> LlmResult<bool> {
        Ok(true)
    }
    fn supports_tools(&self) -> bool {
        true
    }
    fn supports_streaming(&self) -> bool {
        true
    }
    fn config(&self) -> &ProviderConfig {
        &self.config
    }
}
