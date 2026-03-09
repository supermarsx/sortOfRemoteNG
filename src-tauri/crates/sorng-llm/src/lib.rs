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

pub mod balancer;
pub mod cache;
pub mod commands;
pub mod config;
pub mod error;
pub mod provider;
pub mod providers;
pub mod rate_limit;
pub mod service;
pub mod streaming;
pub mod tokens;
pub mod tools;
pub mod types;
pub mod usage;

pub use commands::*;
pub use config::*;
pub use error::LlmError;
pub use provider::{LlmProvider, ProviderRegistry};
pub use service::{LlmService, LlmServiceState};
pub use types::*;
