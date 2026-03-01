//! AI Agent module — orchestration hub for all AI functionality.
//!
//! Sub-modules provide the individual capabilities which are composed by the
//! [`service::AiAgentService`] and exposed as Tauri commands.

pub mod types;
pub mod service;
pub mod commands;
pub mod providers;
pub mod engine;
pub mod tools;
pub mod conversation;
pub mod memory;
pub mod streaming;
pub mod tokens;
pub mod templates;
pub mod rag;
pub mod embeddings;
pub mod workflows;
pub mod code_assist;

// ── Re-exports ───────────────────────────────────────────────────────────────

pub use types::*;
pub use service::AiAgentService;
pub use types::AiAgentServiceState;
pub use commands::*;

// ── Global state ─────────────────────────────────────────────────────────────

use std::collections::HashMap;

lazy_static::lazy_static! {
    /// Streaming response chunks keyed by request ID.
    pub static ref AI_STREAM_CHUNKS: std::sync::Mutex<HashMap<String, Vec<String>>> =
        std::sync::Mutex::new(HashMap::new());

    /// Active workflow execution progress keyed by workflow run ID.
    pub static ref AI_WORKFLOW_PROGRESS: std::sync::Mutex<HashMap<String, serde_json::Value>> =
        std::sync::Mutex::new(HashMap::new());

    /// In-memory vector store for RAG embeddings.
    pub static ref AI_VECTOR_STORE: std::sync::Mutex<embeddings::VectorStore> =
        std::sync::Mutex::new(embeddings::VectorStore::new());

    /// Token usage tracking per provider key.
    pub static ref AI_TOKEN_USAGE: std::sync::Mutex<HashMap<String, types::TokenUsage>> =
        std::sync::Mutex::new(HashMap::new());
}
