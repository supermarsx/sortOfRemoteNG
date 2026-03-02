#![allow(dead_code, non_snake_case)]
//! # sorng-llm — Unified LLM Backend Management
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                        sorng-llm                            │
//! │                                                             │
//! │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
//! │  │ Provider  │  │  Model   │  │   Rate    │  │  Cache    │ │
//! │  │ Registry  │  │ Catalog  │  │  Limiter  │  │  Layer    │ │
//! │  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └─────┬─────┘ │
//! │       │              │              │              │        │
//! │  ┌────┴──────────────┴──────────────┴──────────────┴─────┐ │
//! │  │                 Unified Chat API                       │ │
//! │  └───────────────────────┬───────────────────────────────┘ │
//! │                          │                                  │
//! │  ┌────────┬────────┬─────┴───┬─────────┬─────────┬───────┐│
//! │  │OpenAI  │Anthropic│Google  │Ollama   │Groq     │Mistral││
//! │  │        │         │Gemini  │(local)  │         │       ││
//! │  └────────┴─────────┴────────┴─────────┴─────────┴───────┘│
//! │                                                             │
//! │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
//! │  │  Token   │  │  Cost    │  │   Load    │  │   Tool    │ │
//! │  │ Counter  │  │ Tracker  │  │ Balancer  │  │  Calling  │ │
//! │  └──────────┘  └──────────┘  └───────────┘  └───────────┘ │
//! └─────────────────────────────────────────────────────────────┘
//! ```

pub mod error;
pub mod types;
pub mod config;
pub mod provider;
pub mod providers;
pub mod tokens;
pub mod cache;
pub mod rate_limit;
pub mod balancer;
pub mod streaming;
pub mod tools;
pub mod usage;
pub mod service;
pub mod commands;

pub use error::LlmError;
pub use types::*;
pub use config::*;
pub use provider::{LlmProvider, ProviderRegistry};
pub use service::{LlmService, LlmServiceState};
pub use commands::*;
