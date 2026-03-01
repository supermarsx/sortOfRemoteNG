// ── Groq Provider ────────────────────────────────────────────────────────────
//
// Groq uses an OpenAI-compatible API, so this is a thin wrapper that re-uses
// the same request/response shapes with the Groq base URL and model catalog.

use async_trait::async_trait;
use chrono::Utc;
use log::warn;
use reqwest::Client;
use uuid::Uuid;

use crate::ai_agent::types::*;
use super::LlmProvider;

const GROQ_API_BASE: &str = "https://api.groq.com/openai/v1";

pub struct GroqProvider {
    client: Client,
    base_url: String,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl GroqProvider {
    pub fn new(config: &ProviderConfig) -> Result<Self, String> {
        let api_key = config.api_key.clone().ok_or("Groq requires an API key")?;
        let base_url = config.base_url.clone().unwrap_or_else(|| GROQ_API_BASE.to_string());

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
                MessageRole::System => "system", MessageRole::User => "user",
                MessageRole::Assistant => "assistant", MessageRole::Tool => "tool",
                MessageRole::Function => "function",
            };
            let text = msg.content.iter().filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.clone()), _ => None,
            }).collect::<Vec<_>>().join("\n");
            let mut obj = serde_json::json!({ "role": role, "content": text });
            if let Some(ref tc_id) = msg.tool_call_id { obj["tool_call_id"] = serde_json::json!(tc_id); }
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
impl LlmProvider for GroqProvider {
    fn provider_type(&self) -> AiProvider { AiProvider::Groq }

    async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
        let url = format!("{}/models", self.base_url);
        let resp = self.client.get(&url).send().await.map_err(|e| format!("{}", e))?;
        let body: serde_json::Value = resp.json().await.map_err(|e| format!("{}", e))?;
        let mut models = Vec::new();
        if let Some(data) = body["data"].as_array() {
            for m in data {
                let id = m["id"].as_str().unwrap_or("").to_string();
                let ctx = m["context_window"].as_u64().unwrap_or(8192) as u32;
                models.push(ModelSpec {
                    provider: AiProvider::Groq, model_id: id.clone(),
                    display_name: Some(id.clone()), context_window: ctx,
                    supports_tools: true, supports_vision: id.contains("vision"),
                    supports_streaming: true, input_cost_per_1k: 0.0, output_cost_per_1k: 0.0,
                });
            }
        }
        Ok(models)
    }

    async fn chat_completion(
        &self, messages: &[ChatMessage], model: &str,
        params: &InferenceParams, tools: &[ToolDefinition],
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/chat/completions", self.base_url);
        let start = std::time::Instant::now();
        let mut body = serde_json::json!({
            "model": model, "messages": self.build_messages(messages),
            "temperature": params.temperature, "max_tokens": params.max_tokens,
            "top_p": params.top_p,
        });
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools.iter().map(|t| serde_json::json!({
                "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.parameters }
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
                    let c = rb["choices"].get(0).ok_or("No choices")?;
                    let m = &c["message"];
                    let txt = m["content"].as_str().unwrap_or("").to_string();
                    let content = if txt.is_empty() { Vec::new() } else { vec![ContentBlock::Text { text: txt }] };
                    let mut tcs = Vec::new();
                    if let Some(arr) = m["tool_calls"].as_array() {
                        for tc in arr {
                            tcs.push(ToolCall {
                                id: tc["id"].as_str().unwrap_or("").into(), call_type: "function".into(),
                                function: FunctionCall { name: tc["function"]["name"].as_str().unwrap_or("").into(), arguments: tc["function"]["arguments"].as_str().unwrap_or("{}").into() },
                            });
                        }
                    }
                    let u = &rb["usage"];
                    let usage = TokenUsage {
                        prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                        completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
                        total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
                        estimated_cost: 0.0,
                    };
                    let fr = match c["finish_reason"].as_str().unwrap_or("stop") {
                        "stop" => FinishReason::Stop, "length" => FinishReason::Length,
                        "tool_calls" => FinishReason::ToolCalls, _ => FinishReason::Unknown,
                    };
                    return Ok(ChatResponse {
                        id: rb["id"].as_str().unwrap_or("").into(), provider: AiProvider::Groq,
                        model: model.into(), message: ChatMessage {
                            id: Uuid::new_v4().to_string(), role: MessageRole::Assistant,
                            content, tool_call_id: None, tool_calls: tcs, name: None,
                            created_at: Utc::now(), token_count: Some(usage.completion_tokens),
                            metadata: std::collections::HashMap::new(),
                        }, finish_reason: fr, usage, created_at: Utc::now(),
                        latency_ms: start.elapsed().as_millis() as u64, metadata: std::collections::HashMap::new(),
                    });
                }
                Ok(resp) => {
                    let s = resp.status(); let e = resp.text().await.unwrap_or_default();
                    last_err = format!("Groq API error {}: {}", s, e);
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
        let url = format!("{}/chat/completions", self.base_url);
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let rid = request_id.to_string();
        let model_str = model.to_string();
        let mut body = serde_json::json!({
            "model": model, "messages": self.build_messages(messages),
            "temperature": params.temperature, "max_tokens": params.max_tokens, "stream": true,
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
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data.trim() == "[DONE]" {
                            let _ = tx.send(StreamEvent::Done { request_id: rid.clone(), finish_reason: fr.clone(), usage: usage.clone(), latency_ms: start.elapsed().as_millis() as u64 }).await; return;
                        }
                        if let Ok(p) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(c) = p["choices"].get(0) {
                                if let Some(txt) = c["delta"]["content"].as_str() {
                                    acc.push_str(txt);
                                    let _ = tx.send(StreamEvent::Delta { request_id: rid.clone(), content: txt.to_string(), accumulated: acc.clone() }).await;
                                }
                                if let Some(f) = c["finish_reason"].as_str() {
                                    fr = match f { "stop" => FinishReason::Stop, "length" => FinishReason::Length, "tool_calls" => FinishReason::ToolCalls, _ => FinishReason::Unknown };
                                }
                            }
                            if let Some(u) = p.get("x_groq") { if let Some(uu) = u.get("usage") {
                                usage.prompt_tokens = uu["prompt_tokens"].as_u64().unwrap_or(0) as u32;
                                usage.completion_tokens = uu["completion_tokens"].as_u64().unwrap_or(0) as u32;
                                usage.total_tokens = uu["total_tokens"].as_u64().unwrap_or(0) as u32;
                            }}
                        }
                    }
                }
            }
            let _ = tx.send(StreamEvent::Done { request_id: rid, finish_reason: fr, usage, latency_ms: start.elapsed().as_millis() as u64 }).await;
        });
        Ok(rx)
    }

    async fn generate_embeddings(&self, _texts: &[String], _model: Option<&str>, _dim: Option<usize>) -> Result<EmbeddingResponse, String> {
        Err("Groq does not provide an embeddings API".into())
    }

    async fn health_check(&self) -> Result<u64, String> {
        let start = std::time::Instant::now();
        self.client.get(&format!("{}/models", self.base_url)).send().await.map_err(|e| format!("{}", e))?;
        Ok(start.elapsed().as_millis() as u64)
    }
}
