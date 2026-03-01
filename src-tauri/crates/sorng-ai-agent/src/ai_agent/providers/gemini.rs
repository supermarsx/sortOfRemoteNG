// ── Google Gemini Provider ────────────────────────────────────────────────────

use async_trait::async_trait;
use chrono::Utc;
use log::{info, warn};
use reqwest::Client;
use uuid::Uuid;

use crate::ai_agent::types::*;
use super::LlmProvider;

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

pub struct GeminiProvider {
    client: Client,
    api_key: String,
    base_url: String,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl GeminiProvider {
    pub fn new(config: &ProviderConfig) -> Result<Self, String> {
        let api_key = config.api_key.clone()
            .ok_or("Google Gemini requires an API key")?;
        let base_url = config.base_url.clone()
            .unwrap_or_else(|| GEMINI_API_BASE.to_string());

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        Ok(Self {
            client,
            api_key,
            base_url,
            max_retries: config.max_retries,
            retry_delay_ms: config.retry_delay_ms,
        })
    }

    fn build_contents(&self, messages: &[ChatMessage]) -> (Option<serde_json::Value>, Vec<serde_json::Value>) {
        let mut system_instruction = None;
        let mut contents = Vec::new();

        for msg in messages {
            if msg.role == MessageRole::System {
                if let Some(ContentBlock::Text { ref text }) = msg.content.first() {
                    system_instruction = Some(serde_json::json!({
                        "parts": [{ "text": text }]
                    }));
                }
                continue;
            }

            let role = match msg.role {
                MessageRole::User | MessageRole::Tool => "user",
                MessageRole::Assistant => "model",
                _ => "user",
            };

            let parts: Vec<serde_json::Value> = msg.content.iter().map(|b| match b {
                ContentBlock::Text { text } => serde_json::json!({ "text": text }),
                ContentBlock::Image { data, media_type } => {
                    let mt = media_type.as_deref().unwrap_or("image/png");
                    serde_json::json!({
                        "inline_data": {
                            "mime_type": mt,
                            "data": data,
                        }
                    })
                }
            }).collect();

            contents.push(serde_json::json!({
                "role": role,
                "parts": parts,
            }));
        }

        (system_instruction, contents)
    }

    fn build_tools_payload(&self, tools: &[ToolDefinition]) -> serde_json::Value {
        let fns: Vec<serde_json::Value> = tools.iter().map(|t| serde_json::json!({
            "name": t.name,
            "description": t.description,
            "parameters": t.parameters,
        })).collect();
        serde_json::json!([{ "function_declarations": fns }])
    }

    fn parse_response(&self, body: &serde_json::Value, model: &str) -> Result<ChatResponse, String> {
        let candidate = body["candidates"].get(0)
            .ok_or("No candidates in Gemini response")?;
        let content = &candidate["content"];

        let mut text_parts = Vec::new();
        let mut tool_calls = Vec::new();

        if let Some(parts) = content["parts"].as_array() {
            for part in parts {
                if let Some(text) = part["text"].as_str() {
                    text_parts.push(ContentBlock::Text { text: text.to_string() });
                }
                if let Some(fc) = part.get("functionCall") {
                    tool_calls.push(ToolCall {
                        id: Uuid::new_v4().to_string(),
                        call_type: "function".to_string(),
                        function: FunctionCall {
                            name: fc["name"].as_str().unwrap_or("").to_string(),
                            arguments: fc["args"].to_string(),
                        },
                    });
                }
            }
        }

        let finish_str = candidate["finishReason"].as_str().unwrap_or("STOP");
        let finish_reason = match finish_str {
            "STOP" => FinishReason::Stop,
            "MAX_TOKENS" => FinishReason::Length,
            "SAFETY" => FinishReason::ContentFilter,
            _ if !tool_calls.is_empty() => FinishReason::ToolCalls,
            _ => FinishReason::Unknown,
        };

        let usage_obj = &body["usageMetadata"];
        let usage = TokenUsage {
            prompt_tokens: usage_obj["promptTokenCount"].as_u64().unwrap_or(0) as u32,
            completion_tokens: usage_obj["candidatesTokenCount"].as_u64().unwrap_or(0) as u32,
            total_tokens: usage_obj["totalTokenCount"].as_u64().unwrap_or(0) as u32,
            estimated_cost: 0.0,
        };

        Ok(ChatResponse {
            id: Uuid::new_v4().to_string(),
            provider: AiProvider::GoogleGemini,
            model: model.to_string(),
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
impl LlmProvider for GeminiProvider {
    fn provider_type(&self) -> AiProvider {
        AiProvider::GoogleGemini
    }

    async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
        Ok(vec![
            ModelSpec {
                provider: AiProvider::GoogleGemini,
                model_id: "gemini-2.5-pro".into(),
                display_name: Some("Gemini 2.5 Pro".into()),
                context_window: 1_000_000,
                supports_tools: true,
                supports_vision: true,
                supports_streaming: true,
                input_cost_per_1k: 0.00125,
                output_cost_per_1k: 0.01,
            },
            ModelSpec {
                provider: AiProvider::GoogleGemini,
                model_id: "gemini-2.5-flash".into(),
                display_name: Some("Gemini 2.5 Flash".into()),
                context_window: 1_000_000,
                supports_tools: true,
                supports_vision: true,
                supports_streaming: true,
                input_cost_per_1k: 0.00015,
                output_cost_per_1k: 0.0006,
            },
            ModelSpec {
                provider: AiProvider::GoogleGemini,
                model_id: "gemini-2.0-flash".into(),
                display_name: Some("Gemini 2.0 Flash".into()),
                context_window: 1_000_000,
                supports_tools: true,
                supports_vision: true,
                supports_streaming: true,
                input_cost_per_1k: 0.0001,
                output_cost_per_1k: 0.0004,
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
        let url = format!("{}/models/{}:generateContent?key={}", self.base_url, model, self.api_key);
        let start = std::time::Instant::now();

        let (system_instruction, contents) = self.build_contents(messages);

        let mut body = serde_json::json!({
            "contents": contents,
            "generationConfig": {
                "temperature": params.temperature,
                "maxOutputTokens": params.max_tokens,
                "topP": params.top_p,
            },
        });

        if let Some(ref sys) = system_instruction {
            body["systemInstruction"] = sys.clone();
        }
        if !params.stop.is_empty() {
            body["generationConfig"]["stopSequences"] = serde_json::json!(params.stop);
        }
        if !tools.is_empty() {
            body["tools"] = self.build_tools_payload(tools);
        }

        let mut last_err = String::new();
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                info!("Gemini retry attempt {}/{}", attempt, self.max_retries);
                tokio::time::sleep(std::time::Duration::from_millis(
                    self.retry_delay_ms * (attempt as u64),
                )).await;
            }

            match self.client.post(&url).json(&body).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let resp_body: serde_json::Value = resp.json().await
                            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;
                        let mut result = self.parse_response(&resp_body, model)?;
                        result.latency_ms = start.elapsed().as_millis() as u64;
                        return Ok(result);
                    } else {
                        let status = resp.status();
                        let err_body = resp.text().await.unwrap_or_default();
                        last_err = format!("Gemini API error {}: {}", status, err_body);
                        if status.as_u16() == 429 || status.is_server_error() {
                            warn!("{}", last_err);
                            continue;
                        }
                        return Err(last_err);
                    }
                }
                Err(e) => {
                    last_err = format!("Gemini request failed: {}", e);
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
        let url = format!("{}/models/{}:streamGenerateContent?key={}&alt=sse", self.base_url, model, self.api_key);
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let request_id = request_id.to_string();
        let model_str = model.to_string();

        let (system_instruction, contents) = self.build_contents(messages);

        let mut body = serde_json::json!({
            "contents": contents,
            "generationConfig": {
                "temperature": params.temperature,
                "maxOutputTokens": params.max_tokens,
                "topP": params.top_p,
            },
        });

        if let Some(ref sys) = system_instruction {
            body["systemInstruction"] = sys.clone();
        }
        if !tools.is_empty() {
            body["tools"] = self.build_tools_payload(tools);
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

                    if let Some(data) = line.strip_prefix("data: ") {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(candidates) = parsed["candidates"].as_array() {
                                if let Some(candidate) = candidates.first() {
                                    if let Some(parts) = candidate["content"]["parts"].as_array() {
                                        for part in parts {
                                            if let Some(text) = part["text"].as_str() {
                                                accumulated.push_str(text);
                                                let _ = tx.send(StreamEvent::Delta {
                                                    request_id: request_id.clone(),
                                                    content: text.to_string(),
                                                    accumulated: accumulated.clone(),
                                                }).await;
                                            }
                                        }
                                    }
                                }
                            }

                            if let Some(u) = parsed.get("usageMetadata") {
                                usage.prompt_tokens = u["promptTokenCount"].as_u64().unwrap_or(0) as u32;
                                usage.completion_tokens = u["candidatesTokenCount"].as_u64().unwrap_or(0) as u32;
                                usage.total_tokens = u["totalTokenCount"].as_u64().unwrap_or(0) as u32;
                            }
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
        let model = model.unwrap_or("text-embedding-004");
        let url = format!("{}/models/{}:batchEmbedContents?key={}", self.base_url, model, self.api_key);

        let requests: Vec<serde_json::Value> = texts.iter().map(|t| serde_json::json!({
            "model": format!("models/{}", model),
            "content": { "parts": [{ "text": t }] }
        })).collect();

        let body = serde_json::json!({ "requests": requests });

        let resp = self.client.post(&url).json(&body).send().await
            .map_err(|e| format!("Gemini embedding request failed: {}", e))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(format!("Gemini embedding API error: {}", err));
        }

        let resp_body: serde_json::Value = resp.json().await
            .map_err(|e| format!("Failed to parse Gemini embedding response: {}", e))?;

        let mut embeddings = Vec::new();
        if let Some(emb_list) = resp_body["embeddings"].as_array() {
            for emb in emb_list {
                if let Some(values) = emb["values"].as_array() {
                    let vec: Vec<f32> = values.iter()
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
        let url = format!("{}/models?key={}", self.base_url, self.api_key);
        let start = std::time::Instant::now();
        self.client.get(&url).send().await
            .map_err(|e| format!("Health check failed: {}", e))?;
        Ok(start.elapsed().as_millis() as u64)
    }
}
