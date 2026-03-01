// ── Cohere Provider ──────────────────────────────────────────────────────────

use async_trait::async_trait;
use chrono::Utc;
use log::warn;
use reqwest::Client;
use uuid::Uuid;

use crate::ai_agent::types::*;
use super::LlmProvider;

const COHERE_API_BASE: &str = "https://api.cohere.com/v2";

pub struct CohereProvider {
    client: Client,
    base_url: String,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl CohereProvider {
    pub fn new(config: &ProviderConfig) -> Result<Self, String> {
        let api_key = config.api_key.clone().ok_or("Cohere requires an API key")?;
        let base_url = config.base_url.clone().unwrap_or_else(|| COHERE_API_BASE.to_string());

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("Authorization", format!("Bearer {}", api_key).parse().map_err(|e| format!("{}", e))?);
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

        Ok(Self { client, base_url, max_retries: config.max_retries, retry_delay_ms: config.retry_delay_ms })
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
                ContentBlock::Text { text } => Some(text.clone()), _ => None,
            }).collect::<Vec<_>>().join("\n");

            let mut obj = serde_json::json!({ "role": role });

            if role == "tool" {
                obj["tool_call_id"] = serde_json::json!(msg.tool_call_id.as_deref().unwrap_or(""));
                obj["content"] = serde_json::json!(text);
            } else {
                obj["content"] = serde_json::json!(text);
            }

            if !msg.tool_calls.is_empty() {
                obj["tool_calls"] = serde_json::json!(msg.tool_calls.iter().map(|tc| serde_json::json!({
                    "id": tc.id, "type": "function",
                    "function": { "name": tc.function.name, "arguments": tc.function.arguments }
                })).collect::<Vec<_>>());
            }

            obj
        }).collect()
    }
}

#[async_trait]
impl LlmProvider for CohereProvider {
    fn provider_type(&self) -> AiProvider { AiProvider::Cohere }

    async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
        Ok(vec![
            ModelSpec {
                provider: AiProvider::Cohere, model_id: "command-r-plus-08-2024".into(),
                display_name: Some("Command R+".into()), context_window: 128_000,
                supports_tools: true, supports_vision: false, supports_streaming: true,
                input_cost_per_1k: 0.0025, output_cost_per_1k: 0.01,
            },
            ModelSpec {
                provider: AiProvider::Cohere, model_id: "command-r-08-2024".into(),
                display_name: Some("Command R".into()), context_window: 128_000,
                supports_tools: true, supports_vision: false, supports_streaming: true,
                input_cost_per_1k: 0.00015, output_cost_per_1k: 0.0006,
            },
            ModelSpec {
                provider: AiProvider::Cohere, model_id: "command-a-03-2025".into(),
                display_name: Some("Command A".into()), context_window: 256_000,
                supports_tools: true, supports_vision: false, supports_streaming: true,
                input_cost_per_1k: 0.0025, output_cost_per_1k: 0.01,
            },
        ])
    }

    async fn chat_completion(
        &self, messages: &[ChatMessage], model: &str,
        params: &InferenceParams, tools: &[ToolDefinition],
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/chat", self.base_url);
        let start = std::time::Instant::now();

        let mut body = serde_json::json!({
            "model": model,
            "messages": self.build_messages(messages),
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "p": params.top_p,
            "frequency_penalty": params.frequency_penalty,
            "presence_penalty": params.presence_penalty,
        });

        if !params.stop.is_empty() {
            body["stop_sequences"] = serde_json::json!(params.stop);
        }
        if let Some(seed) = params.seed {
            body["seed"] = serde_json::json!(seed);
        }
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools.iter().map(|t| serde_json::json!({
                "type": "function",
                "function": { "name": t.name, "description": t.description, "parameters": t.parameters }
            })).collect::<Vec<_>>());
        }

        let mut last_err = String::new();
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(self.retry_delay_ms * attempt as u64)).await;
            }
            match self.client.post(&url).json(&body).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let rb: serde_json::Value = resp.json().await.map_err(|e| format!("{}", e))?;

                    let mut content_blocks = Vec::new();
                    let mut tool_calls = Vec::new();

                    // Cohere v2 chat returns message.content array
                    if let Some(msg) = rb.get("message") {
                        if let Some(content_arr) = msg["content"].as_array() {
                            for block in content_arr {
                                if block["type"].as_str() == Some("text") {
                                    if let Some(t) = block["text"].as_str() {
                                        content_blocks.push(ContentBlock::Text { text: t.to_string() });
                                    }
                                }
                            }
                        }
                        if let Some(tcs) = msg["tool_calls"].as_array() {
                            for tc in tcs {
                                tool_calls.push(ToolCall {
                                    id: tc["id"].as_str().unwrap_or("").into(),
                                    call_type: "function".into(),
                                    function: FunctionCall {
                                        name: tc["function"]["name"].as_str().unwrap_or("").into(),
                                        arguments: tc["function"]["arguments"].as_str().unwrap_or("{}").into(),
                                    },
                                });
                            }
                        }
                    }

                    let fr_str = rb["finish_reason"].as_str().unwrap_or("COMPLETE");
                    let finish_reason = match fr_str {
                        "COMPLETE" | "END_TURN" | "STOP_SEQUENCE" => FinishReason::Stop,
                        "MAX_TOKENS" => FinishReason::Length,
                        "TOOL_CALL" => FinishReason::ToolCalls,
                        _ => FinishReason::Unknown,
                    };

                    let u = &rb["usage"];
                    let billed = &u["billed_units"];
                    let tokens_obj = &u["tokens"];
                    let prompt_tokens = tokens_obj["input_tokens"].as_u64()
                        .or_else(|| billed["input_tokens"].as_u64())
                        .unwrap_or(0) as u32;
                    let completion_tokens = tokens_obj["output_tokens"].as_u64()
                        .or_else(|| billed["output_tokens"].as_u64())
                        .unwrap_or(0) as u32;

                    let usage = TokenUsage {
                        prompt_tokens,
                        completion_tokens,
                        total_tokens: prompt_tokens + completion_tokens,
                        estimated_cost: 0.0,
                    };

                    return Ok(ChatResponse {
                        id: rb["id"].as_str().unwrap_or("").into(),
                        provider: AiProvider::Cohere,
                        model: model.into(),
                        message: ChatMessage {
                            id: Uuid::new_v4().to_string(), role: MessageRole::Assistant,
                            content: content_blocks, tool_call_id: None, tool_calls,
                            name: None, created_at: Utc::now(),
                            token_count: Some(completion_tokens),
                            metadata: std::collections::HashMap::new(),
                        },
                        finish_reason, usage, created_at: Utc::now(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        metadata: std::collections::HashMap::new(),
                    });
                }
                Ok(resp) => {
                    let s = resp.status(); let e = resp.text().await.unwrap_or_default();
                    last_err = format!("Cohere API error {}: {}", s, e);
                    if s.as_u16() == 429 || s.is_server_error() { warn!("{}", last_err); continue; }
                    return Err(last_err);
                }
                Err(e) => { last_err = format!("{}", e); warn!("{}", last_err); }
            }
        }
        Err(last_err)
    }

    async fn chat_completion_stream(
        &self, messages: &[ChatMessage], model: &str,
        params: &InferenceParams, tools: &[ToolDefinition], request_id: &str,
    ) -> Result<tokio::sync::mpsc::Receiver<StreamEvent>, String> {
        let url = format!("{}/chat", self.base_url);
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let rid = request_id.to_string(); let model_str = model.to_string();
        let mut body = serde_json::json!({
            "model": model, "messages": self.build_messages(messages),
            "temperature": params.temperature, "max_tokens": params.max_tokens,
            "stream": true,
        });
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools.iter().map(|t| serde_json::json!({
                "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.parameters }
            })).collect::<Vec<_>>());
        }
        let client = self.client.clone();
        tokio::spawn(async move {
            let start = std::time::Instant::now();
            let _ = tx.send(StreamEvent::Start { request_id: rid.clone(), model: model_str }).await;
            let resp = match client.post(&url).json(&body).send().await {
                Ok(r) => r, Err(e) => { let _ = tx.send(StreamEvent::Error { request_id: rid, error: format!("{}", e) }).await; return; }
            };
            if !resp.status().is_success() {
                let _ = tx.send(StreamEvent::Error { request_id: rid, error: resp.text().await.unwrap_or_default() }).await; return;
            }
            let mut acc = String::new(); let mut usage = TokenUsage::default(); let mut fr = FinishReason::Unknown;
            let mut stream = resp.bytes_stream(); use futures::StreamExt; let mut buf = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(nl) = buf.find('\n') {
                    let line = buf[..nl].trim().to_string(); buf = buf[nl+1..].to_string();
                    if line.is_empty() { continue; }
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                        let event = parsed["type"].as_str().unwrap_or("");
                        match event {
                            "content-delta" => {
                                if let Some(delta) = parsed["delta"].get("message") {
                                    if let Some(c) = delta["content"]["text"].as_str() {
                                        acc.push_str(c);
                                        let _ = tx.send(StreamEvent::Delta { request_id: rid.clone(), content: c.to_string(), accumulated: acc.clone() }).await;
                                    }
                                }
                            }
                            "message-end" => {
                                if let Some(delta) = parsed.get("delta") {
                                    if let Some(u) = delta.get("usage") {
                                        let billed = &u["billed_units"];
                                        usage.prompt_tokens = billed["input_tokens"].as_u64().unwrap_or(0) as u32;
                                        usage.completion_tokens = billed["output_tokens"].as_u64().unwrap_or(0) as u32;
                                        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
                                    }
                                    let f = delta["finish_reason"].as_str().unwrap_or("COMPLETE");
                                    fr = match f {
                                        "COMPLETE" | "STOP_SEQUENCE" => FinishReason::Stop,
                                        "MAX_TOKENS" => FinishReason::Length,
                                        "TOOL_CALL" => FinishReason::ToolCalls,
                                        _ => FinishReason::Unknown,
                                    };
                                }
                                let _ = tx.send(StreamEvent::Done { request_id: rid.clone(), finish_reason: fr.clone(), usage: usage.clone(), latency_ms: start.elapsed().as_millis() as u64 }).await;
                                return;
                            }
                            _ => {}
                        }
                    }
                }
            }
            let _ = tx.send(StreamEvent::Done { request_id: rid, finish_reason: fr, usage, latency_ms: start.elapsed().as_millis() as u64 }).await;
        });
        Ok(rx)
    }

    async fn generate_embeddings(&self, texts: &[String], model: Option<&str>, _dim: Option<usize>) -> Result<EmbeddingResponse, String> {
        let url = format!("{}/embed", self.base_url);
        let model = model.unwrap_or("embed-english-v3.0");
        let body = serde_json::json!({
            "model": model, "texts": texts, "input_type": "search_document", "embedding_types": ["float"],
        });
        let resp = self.client.post(&url).json(&body).send().await.map_err(|e| format!("{}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Cohere embedding error: {}", resp.text().await.unwrap_or_default()));
        }
        let rb: serde_json::Value = resp.json().await.map_err(|e| format!("{}", e))?;
        let mut embeddings = Vec::new();
        if let Some(embs) = rb["embeddings"]["float"].as_array() {
            for emb in embs {
                if let Some(arr) = emb.as_array() {
                    embeddings.push(arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect());
                }
            }
        }
        let dim = embeddings.first().map(|v: &Vec<f32>| v.len()).unwrap_or(1024);
        Ok(EmbeddingResponse { embeddings, model: model.into(), usage: TokenUsage::default(), dimensions: dim })
    }

    async fn health_check(&self) -> Result<u64, String> {
        let start = std::time::Instant::now();
        // Cohere doesn't have a models list endpoint in v2, so we ping chat instead
        let body = serde_json::json!({
            "model": "command-r-08-2024",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
        });
        let resp = self.client.post(&format!("{}/chat", self.base_url))
            .json(&body).send().await.map_err(|e| format!("{}", e))?;
        if resp.status().is_success() || resp.status().as_u16() == 400 {
            Ok(start.elapsed().as_millis() as u64)
        } else {
            Err(format!("Health check returned status {}", resp.status()))
        }
    }
}
