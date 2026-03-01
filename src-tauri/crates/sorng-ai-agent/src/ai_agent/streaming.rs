// ── Streaming Response Management ────────────────────────────────────────────
//
// Helpers for managing SSE streaming state, buffering partial chunks,
// accumulating content, and forwarding events to the front-end.

use std::collections::HashMap;
use log::warn;

use super::types::*;
use super::AI_STREAM_CHUNKS;

// ── Stream Session ───────────────────────────────────────────────────────────

pub struct StreamSession {
    pub request_id: String,
    pub model: String,
    pub accumulated_content: String,
    pub tool_call_buffer: HashMap<usize, PartialToolCall>,
    pub events: Vec<StreamEvent>,
    pub usage: TokenUsage,
    pub finish_reason: Option<FinishReason>,
    pub started_at: std::time::Instant,
    pub completed: bool,
}

#[derive(Default, Clone)]
pub struct PartialToolCall {
    pub index: usize,
    pub name: String,
    pub arguments_buffer: String,
}

impl StreamSession {
    pub fn new(request_id: &str) -> Self {
        Self {
            request_id: request_id.to_string(),
            model: String::new(),
            accumulated_content: String::new(),
            tool_call_buffer: HashMap::new(),
            events: Vec::new(),
            usage: TokenUsage::default(),
            finish_reason: None,
            started_at: std::time::Instant::now(),
            completed: false,
        }
    }

    pub fn apply_event(&mut self, event: &StreamEvent) {
        match event {
            StreamEvent::Start { model, .. } => {
                self.model = model.clone();
            }
            StreamEvent::Delta { content, accumulated, .. } => {
                self.accumulated_content = accumulated.clone();
                if let Ok(mut map) = AI_STREAM_CHUNKS.lock() {
                    let chunks = map.entry(self.request_id.clone()).or_insert_with(Vec::new);
                    chunks.push(content.clone());
                }
            }
            StreamEvent::ToolCallDelta { tool_call_index, name, arguments_delta, .. } => {
                let entry = self.tool_call_buffer.entry(*tool_call_index)
                    .or_insert_with(|| PartialToolCall { index: *tool_call_index, ..Default::default() });
                if let Some(n) = name { entry.name = n.clone(); }
                entry.arguments_buffer.push_str(arguments_delta);
            }
            StreamEvent::Done { finish_reason, usage, .. } => {
                self.finish_reason = Some(finish_reason.clone());
                self.usage = usage.clone();
                self.completed = true;
            }
            StreamEvent::Error { error, .. } => {
                warn!("Stream error for {}: {}", self.request_id, error);
                self.completed = true;
            }
        }
        self.events.push(event.clone());
    }

    pub fn finalise_tool_calls(&self) -> Vec<ToolCall> {
        self.tool_call_buffer.values().map(|ptc| ToolCall {
            id: format!("call_{}", ptc.index),
            call_type: "function".into(),
            function: FunctionCall { name: ptc.name.clone(), arguments: ptc.arguments_buffer.clone() },
        }).collect()
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}

// ── Global Stream Chunk Helpers ──────────────────────────────────────────────

pub fn drain_stream_chunks(request_id: &str) -> Vec<String> {
    match AI_STREAM_CHUNKS.lock() {
        Ok(mut m) => m.remove(request_id).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn clear_stream_chunks(request_id: &str) {
    if let Ok(mut map) = AI_STREAM_CHUNKS.lock() {
        map.remove(request_id);
    }
}

pub fn stream_chunk_count(request_id: &str) -> usize {
    match AI_STREAM_CHUNKS.lock() {
        Ok(m) => m.get(request_id).map(|v| v.len()).unwrap_or(0),
        Err(_) => 0,
    }
}

// ── SSE Line Parser ──────────────────────────────────────────────────────────

pub fn parse_sse_lines(buffer: &str) -> (Vec<String>, String) {
    let mut payloads = Vec::new();
    let mut remainder = String::new();

    for line in buffer.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        if trimmed == "data: [DONE]" {
            payloads.push("[DONE]".into());
            continue;
        }
        if let Some(data) = trimmed.strip_prefix("data: ") {
            payloads.push(data.to_string());
        } else if !trimmed.starts_with(':') {
            remainder.push_str(line);
        }
    }

    (payloads, remainder)
}

pub async fn consume_stream(
    mut rx: tokio::sync::mpsc::Receiver<StreamEvent>,
    session: &mut StreamSession,
    on_event: Option<&dyn Fn(&StreamEvent)>,
) {
    while let Some(event) = rx.recv().await {
        session.apply_event(&event);
        if let Some(cb) = on_event { cb(&event); }
        if session.completed { break; }
    }
}
