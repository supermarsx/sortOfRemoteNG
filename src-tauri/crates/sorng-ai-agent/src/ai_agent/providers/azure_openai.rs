// ── Azure OpenAI Provider ─────────────────────────────────────────────────────

use async_trait::async_trait;
use chrono::Utc;
use log::warn;
use reqwest::Client;
use uuid::Uuid;

use crate::ai_agent::types::*;
use super::LlmProvider;

pub struct AzureOpenAiProvider {
    client: Client,
    base_url: String,
    deployment_id: String,
    api_version: String,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl AzureOpenAiProvider {
    pub fn new(config: &ProviderConfig) -> Result<Self, String> {
        let api_key = config.api_key.clone()
            .ok_or("Azure OpenAI requires an API key")?;
        let base_url = config.base_url.clone()
            .ok_or("Azure OpenAI requires a base_url (e.g. https://<resource>.openai.azure.com)")?;
        let deployment_id = config.deployment_id.clone()
            .ok_or("Azure OpenAI requires a deployment_id")?;
        let api_version = config.api_version.clone()
            .unwrap_or_else(|| "2024-06-01".to_string());

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("api-key", api_key.parse().map_err(|e| format!("{}", e))?);
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
            base_url,
            deployment_id,
            api_version,
            max_retries: config.max_retries,
            retry_delay_ms: config.retry_delay_ms,
        })
    }

    fn chat_url(&self) -> String {
        format!(
            "{}/openai/deployments/{}/chat/completions?api-version={}",
            self.base_url, self.deployment_id, self.api_version
        )
    }

    fn build_messages_payload(&self, messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        // Reuse OpenAI format — Azure OpenAI is API-compatible
        messages.iter().map(|msg| {
            let role = match msg.role {
                MessageRole::System => "system",
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
                MessageRole::Function => "function",
            };
            let text = msg.content.iter().filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.clone()),
                _ => None,
            }).collect::<Vec<_>>().join("\n");
            let mut obj = serde_json::json!({ "role": role, "content": text });
            if let Some(ref tc_id) = msg.tool_call_id {
                obj["tool_call_id"] = serde_json::json!(tc_id);
            }
            if !msg.tool_calls.is_empty() {
                obj["tool_calls"] = serde_json::json!(msg.tool_calls.iter().map(|tc| serde_json::json!({
                    "id": tc.id, "type": tc.call_type,
                    "function": { "name": tc.function.name, "arguments": tc.function.arguments }
                })).collect::<Vec<_>>());
            }
            obj
        }).collect()
    }
}

#[async_trait]
impl LlmProvider for AzureOpenAiProvider {
    fn provider_type(&self) -> AiProvider { AiProvider::AzureOpenAi }

    async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
        // Azure doesn't have a unified list endpoint — return the deployment as a model
        Ok(vec![ModelSpec {
            provider: AiProvider::AzureOpenAi,
            model_id: self.deployment_id.clone(),
            display_name: Some(format!("Azure: {}", self.deployment_id)),
            context_window: 128_000,
            supports_tools: true,
            supports_vision: true,
            supports_streaming: true,
            input_cost_per_1k: 0.0,
            output_cost_per_1k: 0.0,
        }])
    }

    async fn chat_completion(
        &self, messages: &[ChatMessage], _model: &str,
        params: &InferenceParams, tools: &[ToolDefinition],
    ) -> Result<ChatResponse, String> {
        let url = self.chat_url();
        let start = std::time::Instant::now();

        let mut body = serde_json::json!({
            "messages": self.build_messages_payload(messages),
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "top_p": params.top_p,
        });
        if !tools.is_empty() {
            let tools_json: Vec<serde_json::Value> = tools.iter().map(|t| serde_json::json!({
                "type": "function",
                "function": { "name": t.name, "description": t.description, "parameters": t.parameters }
            })).collect();
            body["tools"] = serde_json::json!(tools_json);
        }

        let mut last_err = String::new();
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(self.retry_delay_ms * (attempt as u64))).await;
            }
            match self.client.post(&url).json(&body).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let resp_body: serde_json::Value = resp.json().await.map_err(|e| format!("{}", e))?;
                    let choice = resp_body["choices"].get(0).ok_or("No choices")?;
                    let msg_val = &choice["message"];
                    let content_text = msg_val["content"].as_str().unwrap_or("").to_string();
                    let content = if content_text.is_empty() { Vec::new() } else { vec![ContentBlock::Text { text: content_text }] };
                    let mut tool_calls = Vec::new();
                    if let Some(tcs) = msg_val["tool_calls"].as_array() {
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
                    let u = &resp_body["usage"];
                    let usage = TokenUsage {
                        prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                        completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
                        total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
                        estimated_cost: 0.0,
                    };
                    let fr = match choice["finish_reason"].as_str().unwrap_or("stop") {
                        "stop" => FinishReason::Stop, "length" => FinishReason::Length,
                        "tool_calls" => FinishReason::ToolCalls, "content_filter" => FinishReason::ContentFilter,
                        _ => FinishReason::Unknown,
                    };
                    return Ok(ChatResponse {
                        id: resp_body["id"].as_str().unwrap_or("").into(),
                        provider: AiProvider::AzureOpenAi,
                        model: self.deployment_id.clone(),
                        message: ChatMessage {
                            id: Uuid::new_v4().to_string(), role: MessageRole::Assistant,
                            content, tool_call_id: None, tool_calls, name: None,
                            created_at: Utc::now(), token_count: Some(usage.completion_tokens),
                            metadata: std::collections::HashMap::new(),
                        },
                        finish_reason: fr, usage, created_at: Utc::now(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        metadata: std::collections::HashMap::new(),
                    });
                }
                Ok(resp) => {
                    let s = resp.status();
                    let e = resp.text().await.unwrap_or_default();
                    last_err = format!("Azure OpenAI error {}: {}", s, e);
                    if s.as_u16() == 429 || s.is_server_error() { warn!("{}", last_err); continue; }
                    return Err(last_err);
                }
                Err(e) => { last_err = format!("{}", e); warn!("{}", last_err); }
            }
        }
        Err(last_err)
    }

    async fn chat_completion_stream(
        &self, messages: &[ChatMessage], _model: &str,
        params: &InferenceParams, tools: &[ToolDefinition], request_id: &str,
    ) -> Result<tokio::sync::mpsc::Receiver<StreamEvent>, String> {
        // Azure uses OpenAI-compatible streaming — delegate with stream=true
        let url = self.chat_url();
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let rid = request_id.to_string();
        let model_str = self.deployment_id.clone();

        let mut body = serde_json::json!({
            "messages": self.build_messages_payload(messages),
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "stream": true,
        });
        if !tools.is_empty() {
            let tools_json: Vec<serde_json::Value> = tools.iter().map(|t| serde_json::json!({
                "type": "function",
                "function": { "name": t.name, "description": t.description, "parameters": t.parameters }
            })).collect();
            body["tools"] = serde_json::json!(tools_json);
        }

        let client = self.client.clone();
        tokio::spawn(async move {
            let start = std::time::Instant::now();
            let _ = tx.send(StreamEvent::Start { request_id: rid.clone(), model: model_str }).await;
            let resp = match client.post(&url).json(&body).send().await {
                Ok(r) => r,
                Err(e) => { let _ = tx.send(StreamEvent::Error { request_id: rid, error: format!("{}", e) }).await; return; }
            };
            if !resp.status().is_success() {
                let e = resp.text().await.unwrap_or_default();
                let _ = tx.send(StreamEvent::Error { request_id: rid, error: e }).await; return;
            }
            let mut accumulated = String::new();
            let usage = TokenUsage::default();
            let mut finish = FinishReason::Unknown;
            let mut stream = resp.bytes_stream();
            use futures::StreamExt;
            let mut buf = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(nl) = buf.find('\n') {
                    let line = buf[..nl].trim().to_string();
                    buf = buf[nl+1..].to_string();
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data.trim() == "[DONE]" {
                            let _ = tx.send(StreamEvent::Done { request_id: rid.clone(), finish_reason: finish.clone(), usage: usage.clone(), latency_ms: start.elapsed().as_millis() as u64 }).await;
                            return;
                        }
                        if let Ok(p) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(c) = p["choices"].get(0) {
                                if let Some(d) = c.get("delta") {
                                    if let Some(txt) = d["content"].as_str() {
                                        accumulated.push_str(txt);
                                        let _ = tx.send(StreamEvent::Delta { request_id: rid.clone(), content: txt.to_string(), accumulated: accumulated.clone() }).await;
                                    }
                                }
                                if let Some(fr) = c["finish_reason"].as_str() {
                                    finish = match fr { "stop" => FinishReason::Stop, "length" => FinishReason::Length, "tool_calls" => FinishReason::ToolCalls, _ => FinishReason::Unknown };
                                }
                            }
                        }
                    }
                }
            }
            let _ = tx.send(StreamEvent::Done { request_id: rid, finish_reason: finish, usage, latency_ms: start.elapsed().as_millis() as u64 }).await;
        });
        Ok(rx)
    }

    async fn generate_embeddings(
        &self, texts: &[String], _model: Option<&str>, _dimensions: Option<usize>,
    ) -> Result<EmbeddingResponse, String> {
        let url = format!(
            "{}/openai/deployments/{}/embeddings?api-version={}",
            self.base_url, self.deployment_id, self.api_version
        );
        let body = serde_json::json!({ "input": texts });
        let resp = self.client.post(&url).json(&body).send().await.map_err(|e| format!("{}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Azure embedding error: {}", resp.text().await.unwrap_or_default()));
        }
        let rb: serde_json::Value = resp.json().await.map_err(|e| format!("{}", e))?;
        let mut embeddings = Vec::new();
        if let Some(data) = rb["data"].as_array() {
            for item in data {
                if let Some(emb) = item["embedding"].as_array() {
                    embeddings.push(emb.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect());
                }
            }
        }
        let dim = embeddings.first().map(|v: &Vec<f32>| v.len()).unwrap_or(0);
        Ok(EmbeddingResponse { embeddings, model: self.deployment_id.clone(), usage: TokenUsage::default(), dimensions: dim })
    }

    async fn health_check(&self) -> Result<u64, String> {
        let start = std::time::Instant::now();
        let url = format!("{}/openai/deployments?api-version={}", self.base_url, self.api_version);
        self.client.get(&url).send().await.map_err(|e| format!("{}", e))?;
        Ok(start.elapsed().as_millis() as u64)
    }
}
