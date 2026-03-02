use async_trait::async_trait;
use reqwest::Client;
use std::time::Instant;

use crate::config::ProviderConfig;
use crate::error::{LlmError, LlmResult};
use crate::provider::LlmProvider;
use crate::types::*;

/// Google Gemini provider
pub struct GoogleProvider {
    config: ProviderConfig,
    client: Client,
}

impl GoogleProvider {
    pub fn new(config: ProviderConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .unwrap_or_default();
        Self { config, client }
    }

    fn base_url(&self) -> &str {
        self.config.base_url.as_deref().unwrap_or("https://generativelanguage.googleapis.com/v1beta")
    }

    fn build_contents(&self, messages: &[ChatMessage]) -> (Option<serde_json::Value>, Vec<serde_json::Value>) {
        let mut system_instruction = None;
        let mut contents = Vec::new();

        for msg in messages {
            match msg.role {
                MessageRole::System => {
                    system_instruction = Some(serde_json::json!({
                        "parts": [{"text": msg.text_content()}]
                    }));
                }
                MessageRole::User => {
                    contents.push(serde_json::json!({
                        "role": "user",
                        "parts": [{"text": msg.text_content()}]
                    }));
                }
                MessageRole::Assistant => {
                    contents.push(serde_json::json!({
                        "role": "model",
                        "parts": [{"text": msg.text_content()}]
                    }));
                }
                MessageRole::Tool => {
                    contents.push(serde_json::json!({
                        "role": "function",
                        "parts": [{"functionResponse": {
                            "name": msg.name.as_deref().unwrap_or("tool"),
                            "response": {"content": msg.text_content()}
                        }}]
                    }));
                }
            }
        }

        (system_instruction, contents)
    }
}

#[async_trait]
impl LlmProvider for GoogleProvider {
    fn provider_type(&self) -> ProviderType { ProviderType::Google }
    fn display_name(&self) -> String { self.config.display_name.clone() }

    async fn chat_completion(&self, request: &ChatCompletionRequest) -> LlmResult<ChatCompletionResponse> {
        let api_key = self.config.api_key.as_deref().unwrap_or("");
        let url = format!(
            "{}/models/{}:generateContent?key={}",
            self.base_url(), request.model, api_key
        );
        let start = Instant::now();
        let (system_instruction, contents) = self.build_contents(&request.messages);

        let mut body = serde_json::json!({ "contents": contents });
        if let Some(si) = system_instruction { body["systemInstruction"] = si; }

        let mut gen_config = serde_json::Map::new();
        if let Some(t) = request.temperature { gen_config.insert("temperature".into(), serde_json::json!(t)); }
        if let Some(tp) = request.top_p { gen_config.insert("topP".into(), serde_json::json!(tp)); }
        if let Some(mt) = request.max_tokens { gen_config.insert("maxOutputTokens".into(), serde_json::json!(mt)); }
        if let Some(ref stop) = request.stop { gen_config.insert("stopSequences".into(), serde_json::json!(stop)); }
        if !gen_config.is_empty() {
            body["generationConfig"] = serde_json::Value::Object(gen_config);
        }

        if let Some(ref tools) = request.tools {
            body["tools"] = crate::tools::tools_to_gemini(tools);
        }

        let resp = self.client.post(&url).json(&body).send().await?;
        let status = resp.status();
        let latency = start.elapsed().as_millis() as u64;

        if !status.is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error("Google", &err, Some(status.as_u16())));
        }

        let response: serde_json::Value = resp.json().await?;
        let candidate = &response["candidates"][0];
        let parts = candidate["content"]["parts"].as_array();

        let mut text = String::new();
        let mut tool_calls = Vec::new();

        if let Some(parts) = parts {
            for part in parts {
                if let Some(t) = part["text"].as_str() {
                    text.push_str(t);
                }
                if let Some(fc) = part.get("functionCall") {
                    tool_calls.push(ToolCall {
                        id: uuid::Uuid::new_v4().to_string(),
                        call_type: "function".to_string(),
                        function: FunctionCall {
                            name: fc["name"].as_str().unwrap_or("").to_string(),
                            arguments: fc["args"].to_string(),
                        },
                    });
                }
            }
        }

        let usage_meta = &response["usageMetadata"];
        let usage = TokenUsage {
            prompt_tokens: usage_meta["promptTokenCount"].as_u64().unwrap_or(0) as u32,
            completion_tokens: usage_meta["candidatesTokenCount"].as_u64().unwrap_or(0) as u32,
            total_tokens: usage_meta["totalTokenCount"].as_u64().unwrap_or(0) as u32,
            cache_read_tokens: usage_meta["cachedContentTokenCount"].as_u64().map(|v| v as u32),
            cache_creation_tokens: None,
        };

        let finish_reason = candidate["finishReason"].as_str().map(|r| match r {
            "STOP" => "stop".to_string(),
            "MAX_TOKENS" => "length".to_string(),
            other => other.to_lowercase(),
        });

        Ok(ChatCompletionResponse {
            id: uuid::Uuid::new_v4().to_string(),
            model: request.model.clone(),
            choices: vec![Choice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: MessageContent::Text(text),
                    name: None,
                    tool_calls: if tool_calls.is_empty() { None } else { Some(tool_calls) },
                    tool_call_id: None,
                },
                finish_reason,
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
        let api_key = self.config.api_key.clone().unwrap_or_default();
        let url = format!(
            "{}/models/{}:streamGenerateContent?key={}&alt=sse",
            self.base_url(), request.model, api_key
        );
        let (tx, rx) = tokio::sync::mpsc::channel(128);
        let (system_instruction, contents) = self.build_contents(&request.messages);

        let mut body = serde_json::json!({ "contents": contents });
        if let Some(si) = system_instruction { body["systemInstruction"] = si; }
        if let Some(ref tools) = request.tools {
            body["tools"] = crate::tools::tools_to_gemini(tools);
        }

        let provider_name = self.config.id.clone();
        let model = request.model.clone();

        let resp = self.client.post(&url).json(&body).send().await?;
        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(LlmError::provider_error("Google", &err, None));
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
                        while let Some(pos) = buffer.find("\n\n") {
                            let line = buffer[..pos].to_string();
                            buffer = buffer[pos + 2..].to_string();
                            if let Some(data) = line.strip_prefix("data: ") {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                                    if let Some(parts) = val["candidates"][0]["content"]["parts"].as_array() {
                                        for part in parts {
                                            let content = part["text"].as_str().map(String::from);
                                            let chunk = StreamChunk {
                                                id: stream_id.clone(),
                                                model: model.clone(),
                                                provider: provider_name.clone(),
                                                delta: StreamDelta { role: None, content, tool_calls: None },
                                                finish_reason: val["candidates"][0]["finishReason"].as_str().map(String::from),
                                                usage: None,
                                                index: 0,
                                            };
                                            let _ = tx.send(Ok(chunk)).await;
                                        }
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
            .filter(|m| m.provider == "google")
            .collect())
    }

    async fn health_check(&self) -> LlmResult<bool> {
        let api_key = self.config.api_key.as_deref().unwrap_or("");
        let url = format!("{}/models?key={}", self.base_url(), api_key);
        let resp = self.client.get(&url).send().await;
        Ok(resp.map(|r| r.status().is_success()).unwrap_or(false))
    }

    fn supports_tools(&self) -> bool { true }
    fn supports_streaming(&self) -> bool { true }
    fn supports_vision(&self) -> bool { true }
    fn config(&self) -> &ProviderConfig { &self.config }
}
