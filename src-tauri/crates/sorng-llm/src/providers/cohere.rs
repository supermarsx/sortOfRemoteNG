use async_trait::async_trait;
use reqwest::Client;
use std::time::Instant;

use crate::config::ProviderConfig;
use crate::error::{LlmError, LlmResult};
use crate::provider::LlmProvider;
use crate::types::*;

/// Cohere provider — uses its own Chat API
pub struct CohereProvider {
    config: ProviderConfig,
    client: Client,
}

impl CohereProvider {
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
            .unwrap_or("https://api.cohere.ai/v1")
    }
}

#[async_trait]
impl LlmProvider for CohereProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Cohere
    }
    fn display_name(&self) -> String {
        self.config.display_name.clone()
    }

    async fn chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        let url = format!("{}/chat", self.base_url());
        let start = Instant::now();

        // Convert messages to Cohere format
        let mut preamble = None;
        let mut chat_history: Vec<serde_json::Value> = Vec::new();
        let mut user_message = String::new();

        for msg in &request.messages {
            match msg.role {
                MessageRole::System => {
                    preamble = Some(msg.text_content().to_string());
                }
                MessageRole::User => {
                    user_message = msg.text_content().to_string();
                }
                MessageRole::Assistant => {
                    chat_history.push(serde_json::json!({
                        "role": "CHATBOT",
                        "message": msg.text_content(),
                    }));
                }
                _ => {}
            }
        }

        let mut body = serde_json::json!({
            "model": request.model,
            "message": user_message,
            "chat_history": chat_history,
        });

        if let Some(p) = preamble {
            body["preamble"] = serde_json::json!(p);
        }
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(mt) = request.max_tokens {
            body["max_tokens"] = serde_json::json!(mt);
        }
        if let Some(ref tools) = request.tools {
            body["tools"] = crate::tools::tools_to_cohere(tools);
        }

        let api_key = self.config.api_key.as_deref().unwrap_or("");
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let latency = start.elapsed().as_millis() as u64;

        if !status.is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error(
                "Cohere",
                &err,
                Some(status.as_u16()),
            ));
        }

        let response: serde_json::Value = resp.json().await?;
        let text = response["text"].as_str().unwrap_or("").to_string();

        let tool_calls = response["tool_calls"]
            .as_array()
            .map(|tcs| crate::tools::parse_cohere_tool_calls(tcs));

        let meta = &response["meta"];
        let usage = TokenUsage {
            prompt_tokens: meta["tokens"]["input_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: meta["tokens"]["output_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: (meta["tokens"]["input_tokens"].as_u64().unwrap_or(0)
                + meta["tokens"]["output_tokens"].as_u64().unwrap_or(0))
                as u32,
            cache_read_tokens: None,
            cache_creation_tokens: None,
        };

        Ok(ChatCompletionResponse {
            id: response["generation_id"].as_str().unwrap_or("").to_string(),
            model: request.model.clone(),
            choices: vec![Choice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: MessageContent::Text(text),
                    name: None,
                    tool_calls: tool_calls.filter(|tc| !tc.is_empty()),
                    tool_call_id: None,
                },
                finish_reason: response["finish_reason"].as_str().map(|r| match r {
                    "COMPLETE" => "stop".to_string(),
                    "MAX_TOKENS" => "length".to_string(),
                    other => other.to_lowercase(),
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
        let url = format!("{}/chat", self.base_url());
        let (tx, rx) = tokio::sync::mpsc::channel(128);

        let mut user_message = String::new();
        for msg in &request.messages {
            if msg.role == MessageRole::User {
                user_message = msg.text_content().to_string();
            }
        }

        let body = serde_json::json!({
            "model": request.model,
            "message": user_message,
            "stream": true,
        });

        let api_key = self.config.api_key.clone().unwrap_or_default();
        let provider_name = self.config.id.clone();
        let model = request.model.clone();

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error("Cohere", &err, None));
        }

        tokio::spawn(async move {
            use futures::StreamExt;
            let mut stream = resp.bytes_stream();
            let mut buffer = String::new();
            let stream_id = uuid::Uuid::new_v4().to_string();

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        for line in buffer.split('\n').filter(|l| !l.is_empty()) {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                                if val["event_type"].as_str() == Some("text-generation") {
                                    let chunk = StreamChunk {
                                        id: stream_id.clone(),
                                        model: model.clone(),
                                        provider: provider_name.clone(),
                                        delta: StreamDelta {
                                            role: None,
                                            content: val["text"].as_str().map(String::from),
                                            tool_calls: None,
                                        },
                                        finish_reason: None,
                                        usage: None,
                                        index: 0,
                                    };
                                    let _ = tx.send(Ok(chunk)).await;
                                }
                            }
                        }
                        buffer.clear();
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
            .filter(|m| m.provider == "cohere")
            .collect())
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
