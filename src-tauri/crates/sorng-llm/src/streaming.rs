use tokio::sync::mpsc;
use serde::{Serialize, Deserialize};

use crate::types::{StreamChunk, StreamDelta, TokenUsage, ChatMessage, MessageRole, MessageContent, ToolCall, FunctionCall};
use crate::error::{LlmError, LlmResult};

/// Accumulates stream chunks into a complete response message
pub struct StreamAccumulator {
    pub id: String,
    pub model: String,
    pub provider: String,
    content_buffer: String,
    tool_call_buffers: std::collections::HashMap<u32, ToolCallAccumulator>,
    pub finish_reason: Option<String>,
    pub usage: Option<TokenUsage>,
    chunk_count: u32,
}

struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

impl StreamAccumulator {
    pub fn new() -> Self {
        Self {
            id: String::new(),
            model: String::new(),
            provider: String::new(),
            content_buffer: String::new(),
            tool_call_buffers: std::collections::HashMap::new(),
            finish_reason: None,
            usage: None,
            chunk_count: 0,
        }
    }

    /// Process a stream chunk and accumulate its content
    pub fn process_chunk(&mut self, chunk: &StreamChunk) {
        self.chunk_count += 1;

        if self.id.is_empty() {
            self.id = chunk.id.clone();
            self.model = chunk.model.clone();
            self.provider = chunk.provider.clone();
        }

        if let Some(ref content) = chunk.delta.content {
            self.content_buffer.push_str(content);
        }

        if let Some(ref tool_calls) = chunk.delta.tool_calls {
            for tc_delta in tool_calls {
                let entry = self
                    .tool_call_buffers
                    .entry(tc_delta.index)
                    .or_insert_with(|| ToolCallAccumulator {
                        id: String::new(),
                        name: String::new(),
                        arguments: String::new(),
                    });
                if let Some(ref id) = tc_delta.id {
                    entry.id = id.clone();
                }
                if let Some(ref func) = tc_delta.function {
                    if let Some(ref name) = func.name {
                        entry.name = name.clone();
                    }
                    if let Some(ref args) = func.arguments {
                        entry.arguments.push_str(args);
                    }
                }
            }
        }

        if let Some(ref reason) = chunk.finish_reason {
            self.finish_reason = Some(reason.clone());
        }
        if let Some(ref usage) = chunk.usage {
            self.usage = Some(usage.clone());
        }
    }

    /// Build the final accumulated message
    pub fn into_message(self) -> ChatMessage {
        let tool_calls = if self.tool_call_buffers.is_empty() {
            None
        } else {
            let mut calls: Vec<(u32, ToolCall)> = self
                .tool_call_buffers
                .into_iter()
                .map(|(idx, acc)| {
                    (
                        idx,
                        ToolCall {
                            id: acc.id,
                            call_type: "function".to_string(),
                            function: FunctionCall {
                                name: acc.name,
                                arguments: acc.arguments,
                            },
                        },
                    )
                })
                .collect();
            calls.sort_by_key(|(idx, _)| *idx);
            Some(calls.into_iter().map(|(_, tc)| tc).collect())
        };

        ChatMessage {
            role: MessageRole::Assistant,
            content: MessageContent::Text(self.content_buffer),
            name: None,
            tool_calls,
            tool_call_id: None,
        }
    }

    pub fn content_so_far(&self) -> &str {
        &self.content_buffer
    }

    pub fn chunk_count(&self) -> u32 {
        self.chunk_count
    }
}

/// Multiplexes a stream to multiple consumers (e.g., UI + accumulator)
pub struct StreamMultiplexer {
    senders: Vec<mpsc::Sender<LlmResult<StreamChunk>>>,
}

impl StreamMultiplexer {
    pub fn new() -> Self {
        Self {
            senders: Vec::new(),
        }
    }

    /// Add a consumer channel
    pub fn add_consumer(&mut self) -> mpsc::Receiver<LlmResult<StreamChunk>> {
        let (tx, rx) = mpsc::channel(64);
        self.senders.push(tx);
        rx
    }

    /// Broadcast a chunk to all consumers
    pub async fn broadcast(&self, chunk: LlmResult<StreamChunk>) {
        for sender in &self.senders {
            let _ = sender.send(chunk.clone()).await;
        }
    }

    /// Close all consumer channels
    pub fn close(self) {
        // Senders are dropped, closing the channels
    }
}

/// Events emitted during streaming for UI/frontend consumption
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    #[serde(rename = "start")]
    Start {
        id: String,
        model: String,
        provider: String,
    },
    #[serde(rename = "delta")]
    Delta {
        id: String,
        content: Option<String>,
        tool_call: Option<serde_json::Value>,
    },
    #[serde(rename = "done")]
    Done {
        id: String,
        finish_reason: String,
        usage: Option<TokenUsage>,
    },
    #[serde(rename = "error")]
    Error {
        id: String,
        error: String,
    },
}

/// Convert a stream receiver into StreamEvents for Tauri event emission
pub async fn stream_to_events(
    mut rx: mpsc::Receiver<LlmResult<StreamChunk>>,
    event_tx: mpsc::Sender<StreamEvent>,
) {
    let mut started = false;
    let mut stream_id = String::new();

    while let Some(result) = rx.recv().await {
        match result {
            Ok(chunk) => {
                if !started {
                    stream_id = chunk.id.clone();
                    let _ = event_tx
                        .send(StreamEvent::Start {
                            id: chunk.id.clone(),
                            model: chunk.model.clone(),
                            provider: chunk.provider.clone(),
                        })
                        .await;
                    started = true;
                }

                let tool_call = chunk.delta.tool_calls.as_ref().map(|tcs| {
                    serde_json::to_value(tcs).unwrap_or_default()
                });

                let _ = event_tx
                    .send(StreamEvent::Delta {
                        id: chunk.id.clone(),
                        content: chunk.delta.content.clone(),
                        tool_call,
                    })
                    .await;

                if let Some(ref reason) = chunk.finish_reason {
                    let _ = event_tx
                        .send(StreamEvent::Done {
                            id: chunk.id.clone(),
                            finish_reason: reason.clone(),
                            usage: chunk.usage.clone(),
                        })
                        .await;
                }
            }
            Err(e) => {
                let _ = event_tx
                    .send(StreamEvent::Error {
                        id: stream_id.clone(),
                        error: e.message.clone(),
                    })
                    .await;
                break;
            }
        }
    }
}
