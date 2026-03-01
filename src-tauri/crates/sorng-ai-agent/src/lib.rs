//! # SortOfRemote NG – AI Agent
//!
//! Comprehensive AI agent engine providing multi-provider LLM integration,
//! conversation management, tool/function calling, and intelligent automation
//! for the SortOfRemote NG desktop application.
//!
//! ## Features
//!
//! - **Multi-Provider Backends** — OpenAI, Anthropic, Google Gemini, Ollama, Azure OpenAI,
//!   Groq, Mistral, and Cohere with unified interface and automatic failover
//! - **Conversation Management** — Persistent chat sessions with message history,
//!   role-based messaging, context windows, and conversation branching
//! - **Agent Engine** — ReAct-style reasoning loops, plan-and-execute orchestration,
//!   chain-of-thought prompting, and self-correcting execution
//! - **Tool/Function Calling** — Extensible tool registry with JSON schema validation,
//!   parallel tool execution, and result parsing
//! - **Streaming Responses** — Token-by-token delivery with progress callbacks,
//!   partial response accumulation, and cancellation support
//! - **Token Counting & Budgets** — Accurate token estimation per model family,
//!   budget enforcement, cost tracking, and context window management
//! - **Memory & Context** — Short-term working memory, long-term persistent memory,
//!   summarization, and sliding window context management
//! - **Prompt Templates** — Template engine with variable substitution, conditional
//!   sections, prompt versioning, and a built-in template library
//! - **RAG Pipeline** — Document ingestion, chunking strategies, embedding generation,
//!   vector similarity search, and context-aware retrieval
//! - **Embeddings** — Multi-provider embedding generation, cosine similarity,
//!   nearest-neighbor search, and in-memory vector store
//! - **Workflow Automation** — Multi-step AI workflows with conditional branching,
//!   loop constructs, human-in-the-loop checkpoints, and retry policies
//! - **Code Assistance** — Code generation, review, refactoring suggestions,
//!   explanation, and documentation generation
//! - **Connection-Aware AI** — Integration with SortOfRemote NG connection data
//!   for AI-assisted diagnostics, troubleshooting, and configuration

pub mod ai_agent;
