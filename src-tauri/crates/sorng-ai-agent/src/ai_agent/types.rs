// ── Types ─────────────────────────────────────────────────────────────────────
//
// Shared data structures used across every AI-agent sub-module.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Serde default helpers ────────────────────────────────────────────────────

fn default_true() -> bool { true }
fn default_false() -> bool { false }
fn default_temperature() -> f32 { 0.7 }
fn default_max_tokens() -> u32 { 4096 }
fn default_top_p() -> f32 { 1.0 }
fn default_frequency_penalty() -> f32 { 0.0 }
fn default_presence_penalty() -> f32 { 0.0 }
fn default_timeout_secs() -> u64 { 120 }
fn default_max_retries() -> u32 { 3 }
fn default_retry_delay_ms() -> u64 { 1000 }
fn default_max_history() -> usize { 200 }
fn default_max_tool_iterations() -> u32 { 10 }
fn default_chunk_size() -> usize { 512 }
fn default_chunk_overlap() -> usize { 64 }
fn default_top_k() -> usize { 5 }
fn default_similarity_threshold() -> f32 { 0.7 }
fn default_embedding_dim() -> usize { 1536 }
fn default_max_context_tokens() -> u32 { 128_000 }
fn default_budget_limit() -> f64 { 10.0 }
fn default_port() -> u16 { 11434 }

// ── Managed state type alias ─────────────────────────────────────────────────

pub type AiAgentServiceState = Arc<Mutex<super::service::AiAgentService>>;

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/// Supported LLM providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    OpenAi,
    Anthropic,
    GoogleGemini,
    Ollama,
    AzureOpenAi,
    Groq,
    Mistral,
    Cohere,
    Custom,
}

impl std::fmt::Display for AiProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OpenAi => write!(f, "OpenAI"),
            Self::Anthropic => write!(f, "Anthropic"),
            Self::GoogleGemini => write!(f, "Google Gemini"),
            Self::Ollama => write!(f, "Ollama"),
            Self::AzureOpenAi => write!(f, "Azure OpenAI"),
            Self::Groq => write!(f, "Groq"),
            Self::Mistral => write!(f, "Mistral"),
            Self::Cohere => write!(f, "Cohere"),
            Self::Custom => write!(f, "Custom"),
        }
    }
}

/// Configuration for connecting to an LLM provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: AiProvider,
    /// API key or access token (not required for Ollama).
    #[serde(default)]
    pub api_key: Option<String>,
    /// Base URL override (required for Ollama, Azure, Custom).
    #[serde(default)]
    pub base_url: Option<String>,
    /// Azure-specific deployment name.
    #[serde(default)]
    pub deployment_id: Option<String>,
    /// Azure API version string.
    #[serde(default)]
    pub api_version: Option<String>,
    /// Organization / project ID (OpenAI).
    #[serde(default)]
    pub organization: Option<String>,
    /// Custom headers to add to every request.
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
    /// Request timeout in seconds.
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    /// Max retry attempts on transient failure.
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Delay between retries in ms.
    #[serde(default = "default_retry_delay_ms")]
    pub retry_delay_ms: u64,
    /// Ollama port (only for Ollama provider).
    #[serde(default = "default_port")]
    pub ollama_port: u16,
}

/// Resolved model identifier with provider context.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub provider: AiProvider,
    pub model_id: String,
    /// Human-readable label.
    #[serde(default)]
    pub display_name: Option<String>,
    /// Maximum context window in tokens.
    #[serde(default = "default_max_context_tokens")]
    pub context_window: u32,
    /// Whether the model supports function/tool calling.
    #[serde(default = "default_false")]
    pub supports_tools: bool,
    /// Whether the model supports vision/images.
    #[serde(default = "default_false")]
    pub supports_vision: bool,
    /// Whether the model supports streaming responses.
    #[serde(default = "default_true")]
    pub supports_streaming: bool,
    /// Cost per 1K input tokens (USD).
    #[serde(default)]
    pub input_cost_per_1k: f64,
    /// Cost per 1K output tokens (USD).
    #[serde(default)]
    pub output_cost_per_1k: f64,
}

/// Information about a configured provider connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub provider: AiProvider,
    pub connected: bool,
    pub available_models: Vec<ModelSpec>,
    pub default_model: Option<String>,
    pub connected_at: Option<DateTime<Utc>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chat / Conversation
// ═══════════════════════════════════════════════════════════════════════════════

/// Role of a message participant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
    Function,
}

/// Content block inside a message (supports text + images).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        /// Base-64 encoded image data or URL.
        data: String,
        #[serde(default)]
        media_type: Option<String>,
    },
}

/// A single message in a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: Vec<ContentBlock>,
    /// Optional tool-call ID this message responds to.
    #[serde(default)]
    pub tool_call_id: Option<String>,
    /// Tool calls the assistant wants to make.
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    /// Name of function/tool (for role=tool messages).
    #[serde(default)]
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Token count of this message (filled after send).
    #[serde(default)]
    pub token_count: Option<u32>,
    /// Arbitrary metadata.
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Parameters controlling inference behaviour.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceParams {
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_top_p")]
    pub top_p: f32,
    #[serde(default = "default_frequency_penalty")]
    pub frequency_penalty: f32,
    #[serde(default = "default_presence_penalty")]
    pub presence_penalty: f32,
    /// Stop sequences.
    #[serde(default)]
    pub stop: Vec<String>,
    /// Seed for deterministic generation.
    #[serde(default)]
    pub seed: Option<u64>,
    /// Response format hint ("text" | "json").
    #[serde(default)]
    pub response_format: Option<String>,
}

impl Default for InferenceParams {
    fn default() -> Self {
        Self {
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            top_p: default_top_p(),
            frequency_penalty: default_frequency_penalty(),
            presence_penalty: default_presence_penalty(),
            stop: Vec::new(),
            seed: None,
            response_format: None,
        }
    }
}

/// A chat-completion request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// Provider config ID to use.
    pub provider_id: String,
    /// Model identifier.
    pub model: String,
    /// Messages to send.
    pub messages: Vec<ChatMessage>,
    /// Inference parameters.
    #[serde(default)]
    pub params: InferenceParams,
    /// Tool definitions available for this request.
    #[serde(default)]
    pub tools: Vec<ToolDefinition>,
    /// Whether to stream the response.
    #[serde(default = "default_false")]
    pub stream: bool,
    /// Optional conversation ID to append to.
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// Metadata passed through to the response.
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// A chat-completion response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub id: String,
    pub provider: AiProvider,
    pub model: String,
    pub message: ChatMessage,
    pub finish_reason: FinishReason,
    pub usage: TokenUsage,
    pub created_at: DateTime<Utc>,
    /// Latency in milliseconds.
    pub latency_ms: u64,
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Reason the model stopped generating tokens.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FinishReason {
    Stop,
    Length,
    ToolCalls,
    ContentFilter,
    Error,
    Unknown,
}

/// Token usage for a single request.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    /// Estimated cost in USD.
    #[serde(default)]
    pub estimated_cost: f64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Conversation / Session
// ═══════════════════════════════════════════════════════════════════════════════

/// A persistent conversation session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub params: InferenceParams,
    pub tools: Vec<ToolDefinition>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub total_tokens: u32,
    pub total_cost: f64,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub archived: bool,
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Summary info for listing conversations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub provider: AiProvider,
    pub model: String,
    pub message_count: usize,
    pub total_tokens: u32,
    pub total_cost: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub archived: bool,
    pub last_message_preview: Option<String>,
}

/// Parameters for creating a new conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationRequest {
    #[serde(default)]
    pub title: Option<String>,
    pub provider_id: String,
    pub model: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub params: InferenceParams,
    #[serde(default)]
    pub tools: Vec<ToolDefinition>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Fork/branch a conversation at a specific message index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkConversationRequest {
    pub conversation_id: String,
    /// Index of the message to fork AFTER (inclusive).
    pub fork_after_index: usize,
    #[serde(default)]
    pub new_title: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool / Function Calling
// ═══════════════════════════════════════════════════════════════════════════════

/// Definition of a tool the model can call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    /// JSON Schema describing the parameters.
    pub parameters: serde_json::Value,
    /// Category/group for UI organisation.
    #[serde(default)]
    pub category: Option<String>,
    /// Whether the tool requires human confirmation before execution.
    #[serde(default = "default_false")]
    pub requires_confirmation: bool,
    /// Estimated token cost of the tool's output.
    #[serde(default)]
    pub estimated_output_tokens: Option<u32>,
    /// Maximum execution timeout in seconds.
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

/// A tool invocation requested by the assistant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

/// A function call inside a ToolCall.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionCall {
    pub name: String,
    /// JSON-encoded arguments string.
    pub arguments: String,
}

/// Result of executing a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub content: String,
    pub success: bool,
    pub execution_time_ms: u64,
    #[serde(default)]
    pub error: Option<String>,
}

/// Status of a tool execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ToolExecutionStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    TimedOut,
    AwaitingConfirmation,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent / Engine
// ═══════════════════════════════════════════════════════════════════════════════

/// Agent execution strategy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStrategy {
    /// Simple single-shot: send messages, get response.
    SingleShot,
    /// ReAct: Reason → Act → Observe loop.
    React,
    /// Plan-and-execute: generate plan, execute steps.
    PlanAndExecute,
    /// Chain-of-thought with explicit reasoning steps.
    ChainOfThought,
    /// Reflexion: self-reflecting agent that learns from mistakes.
    Reflexion,
}

/// Configuration for an agent run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub strategy: AgentStrategy,
    pub provider_id: String,
    pub model: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub params: InferenceParams,
    #[serde(default)]
    pub tools: Vec<ToolDefinition>,
    #[serde(default = "default_max_tool_iterations")]
    pub max_iterations: u32,
    /// Stop when the model says "FINAL ANSWER" or similar.
    #[serde(default = "default_true")]
    pub auto_stop_on_answer: bool,
    /// Whether to include reasoning traces in the output.
    #[serde(default = "default_true")]
    pub include_reasoning: bool,
    /// Optional memory configuration.
    #[serde(default)]
    pub memory_config: Option<MemoryConfig>,
    /// Optional RAG configuration.
    #[serde(default)]
    pub rag_config: Option<RagConfig>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// A single step in an agent execution trace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub step_index: u32,
    pub step_type: AgentStepType,
    pub content: String,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default)]
    pub tool_results: Vec<ToolResult>,
    pub token_usage: TokenUsage,
    pub duration_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// Type of an agent step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStepType {
    Thought,
    Action,
    Observation,
    Plan,
    PlanStep,
    Reflection,
    FinalAnswer,
    Error,
}

/// Outcome of a complete agent run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub strategy: AgentStrategy,
    pub final_answer: Option<String>,
    pub steps: Vec<AgentStep>,
    pub total_iterations: u32,
    pub total_tokens: TokenUsage,
    pub total_duration_ms: u64,
    pub status: AgentRunStatus,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Status of an agent run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentRunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    MaxIterationsReached,
    BudgetExceeded,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Streaming
// ═══════════════════════════════════════════════════════════════════════════════

/// A streaming event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum StreamEvent {
    #[serde(rename = "start")]
    Start {
        request_id: String,
        model: String,
    },
    #[serde(rename = "delta")]
    Delta {
        request_id: String,
        content: String,
        /// Accumulated content so far.
        accumulated: String,
    },
    #[serde(rename = "toolCallDelta")]
    ToolCallDelta {
        request_id: String,
        tool_call_index: usize,
        name: Option<String>,
        arguments_delta: String,
    },
    #[serde(rename = "done")]
    Done {
        request_id: String,
        finish_reason: FinishReason,
        usage: TokenUsage,
        latency_ms: u64,
    },
    #[serde(rename = "error")]
    Error {
        request_id: String,
        error: String,
    },
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memory
// ═══════════════════════════════════════════════════════════════════════════════

/// Memory configuration for an agent or conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConfig {
    /// Type of memory to use.
    pub memory_type: MemoryType,
    /// Maximum number of messages to keep in short-term memory.
    #[serde(default = "default_max_history")]
    pub max_messages: usize,
    /// Whether to auto-summarise older messages.
    #[serde(default = "default_true")]
    pub auto_summarize: bool,
    /// Token budget for the memory window.
    #[serde(default = "default_max_context_tokens")]
    pub max_tokens: u32,
    /// Namespace for long-term persistent storage.
    #[serde(default)]
    pub namespace: Option<String>,
}

/// Types of memory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MemoryType {
    /// Rolling window of recent messages.
    Buffer,
    /// Summarise older messages to fit context.
    Summary,
    /// Store message embeddings for semantic recall.
    Vector,
    /// Combined summary + vector hybrid.
    Hybrid,
}

/// A memory entry for long-term storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub namespace: String,
    pub content: String,
    pub embedding: Option<Vec<f32>>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub access_count: u32,
    pub last_accessed: DateTime<Utc>,
    pub relevance_score: Option<f32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Prompt Templates
// ═══════════════════════════════════════════════════════════════════════════════

/// A reusable prompt template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Template string with `{{variable}}` placeholders.
    pub template: String,
    /// Variable definitions and defaults.
    pub variables: Vec<TemplateVariable>,
    /// Category for organisation.
    #[serde(default)]
    pub category: Option<String>,
    /// Tags for searchability.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Version number.
    #[serde(default)]
    pub version: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A variable in a prompt template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVariable {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default = "default_false")]
    pub required: bool,
    /// Validation regex pattern.
    #[serde(default)]
    pub pattern: Option<String>,
}

/// Request to render a template with variables.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderTemplateRequest {
    pub template_id: String,
    pub variables: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAG (Retrieval-Augmented Generation)
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for a RAG pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagConfig {
    /// Name of the vector collection to query.
    pub collection: String,
    /// Embedding provider configuration ID.
    #[serde(default)]
    pub embedding_provider_id: Option<String>,
    /// Embedding model to use.
    #[serde(default)]
    pub embedding_model: Option<String>,
    /// Number of top results to retrieve.
    #[serde(default = "default_top_k")]
    pub top_k: usize,
    /// Minimum similarity threshold.
    #[serde(default = "default_similarity_threshold")]
    pub similarity_threshold: f32,
    /// Chunking strategy for document ingestion.
    #[serde(default)]
    pub chunking: ChunkingConfig,
    /// Whether to include source citations in responses.
    #[serde(default = "default_true")]
    pub include_citations: bool,
}

/// Configuration for document chunking.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkingConfig {
    pub strategy: ChunkingStrategy,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,
    #[serde(default = "default_chunk_overlap")]
    pub chunk_overlap: usize,
    /// Separator for split-based strategies.
    #[serde(default)]
    pub separator: Option<String>,
}

impl Default for ChunkingConfig {
    fn default() -> Self {
        Self {
            strategy: ChunkingStrategy::RecursiveCharacter,
            chunk_size: default_chunk_size(),
            chunk_overlap: default_chunk_overlap(),
            separator: None,
        }
    }
}

/// Document chunking strategies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChunkingStrategy {
    /// Fixed-size character chunks.
    FixedSize,
    /// Recursive character splitting (like LangChain).
    RecursiveCharacter,
    /// Split on sentences.
    Sentence,
    /// Split on paragraphs.
    Paragraph,
    /// Split on markdown headings.
    Markdown,
    /// Semantic chunking using embeddings.
    Semantic,
}

/// A document to ingest into the RAG collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestDocumentRequest {
    pub collection: String,
    pub document_id: String,
    pub content: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub chunking: Option<ChunkingConfig>,
}

/// A RAG search query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchRequest {
    pub collection: String,
    pub query: String,
    #[serde(default = "default_top_k")]
    pub top_k: usize,
    #[serde(default = "default_similarity_threshold")]
    pub similarity_threshold: f32,
    /// Optional metadata filter.
    #[serde(default)]
    pub filter: HashMap<String, serde_json::Value>,
}

/// A search result from the RAG pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResult {
    pub document_id: String,
    pub chunk_index: usize,
    pub content: String,
    pub score: f32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Embeddings
// ═══════════════════════════════════════════════════════════════════════════════

/// Request to generate embeddings for one or more texts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRequest {
    pub provider_id: String,
    #[serde(default)]
    pub model: Option<String>,
    pub texts: Vec<String>,
    #[serde(default = "default_embedding_dim")]
    pub dimensions: usize,
}

/// Response from an embedding request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingResponse {
    pub embeddings: Vec<Vec<f32>>,
    pub model: String,
    pub usage: TokenUsage,
    pub dimensions: usize,
}

/// Similarity comparison result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityResult {
    pub index: usize,
    pub text: String,
    pub score: f32,
    pub metadata: HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token Counting & Budget
// ═══════════════════════════════════════════════════════════════════════════════

/// Token-count estimate result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCountResult {
    pub text: String,
    pub token_count: u32,
    pub model: String,
    pub encoding: String,
}

/// Budget configuration for cost management.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetConfig {
    /// Maximum spend in USD (0 = unlimited).
    #[serde(default = "default_budget_limit")]
    pub max_cost_usd: f64,
    /// Maximum total tokens (0 = unlimited).
    #[serde(default)]
    pub max_total_tokens: u64,
    /// Period for budget reset.
    #[serde(default)]
    pub reset_period: Option<BudgetPeriod>,
    /// Whether to hard-stop when budget is exceeded.
    #[serde(default = "default_true")]
    pub enforce_hard_limit: bool,
    /// Warning threshold as fraction (0-1) of the budget.
    #[serde(default)]
    pub warning_threshold: Option<f64>,
}

/// Budget reset periods.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BudgetPeriod {
    Daily,
    Weekly,
    Monthly,
    Never,
}

/// Current budget status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatus {
    pub total_cost_usd: f64,
    pub total_tokens: u64,
    pub request_count: u64,
    pub budget_remaining_usd: Option<f64>,
    pub tokens_remaining: Option<u64>,
    pub budget_utilization_pct: f64,
    pub period_start: Option<DateTime<Utc>>,
    pub period_end: Option<DateTime<Utc>>,
    pub is_over_budget: bool,
    pub is_warning: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workflows
// ═══════════════════════════════════════════════════════════════════════════════

/// Definition of a multi-step AI workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub steps: Vec<WorkflowStep>,
    /// Global variables available to all steps.
    #[serde(default)]
    pub variables: HashMap<String, serde_json::Value>,
    /// Retry policy for failed steps.
    #[serde(default)]
    pub retry_policy: Option<RetryPolicy>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A single step in a workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub id: String,
    pub name: String,
    pub step_type: WorkflowStepType,
    /// Configuration specific to the step type.
    pub config: serde_json::Value,
    /// Condition that must be true for this step to execute.
    #[serde(default)]
    pub condition: Option<String>,
    /// Variable to store the step's output in.
    #[serde(default)]
    pub output_variable: Option<String>,
    /// Steps to execute if this step fails.
    #[serde(default)]
    pub on_error: Option<WorkflowErrorHandler>,
    /// Maximum execution time for this step.
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

/// Types of workflow steps.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkflowStepType {
    /// Send a prompt to an LLM.
    LlmPrompt,
    /// Execute a tool/function.
    ToolExecution,
    /// Conditional branch (if/else).
    Condition,
    /// Loop over items.
    Loop,
    /// Run sub-steps in parallel.
    Parallel,
    /// Pause for human review/input.
    HumanInTheLoop,
    /// Transform data with a template.
    Transform,
    /// Delay/wait.
    Delay,
    /// RAG search step.
    RagSearch,
    /// Embedding generation step.
    Embedding,
    /// Sub-workflow invocation.
    SubWorkflow,
}

/// Error handling strategy for a workflow step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowErrorHandler {
    pub strategy: ErrorStrategy,
    #[serde(default)]
    pub fallback_value: Option<serde_json::Value>,
    #[serde(default)]
    pub retry_policy: Option<RetryPolicy>,
}

/// Error handling strategies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorStrategy {
    Fail,
    Skip,
    Retry,
    Fallback,
}

/// Retry policy configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub initial_delay_ms: u64,
    /// Multiplier for exponential backoff.
    #[serde(default)]
    pub backoff_multiplier: Option<f64>,
    /// Maximum delay between retries.
    #[serde(default)]
    pub max_delay_ms: Option<u64>,
}

/// Request to execute a workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWorkflowRequest {
    pub workflow_id: String,
    /// Input variables for this run.
    #[serde(default)]
    pub variables: HashMap<String, serde_json::Value>,
    /// Provider config to use.
    pub provider_id: String,
    pub model: String,
}

/// Result of a workflow execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResult {
    pub run_id: String,
    pub workflow_id: String,
    pub status: WorkflowRunStatus,
    pub step_results: Vec<WorkflowStepResult>,
    pub output_variables: HashMap<String, serde_json::Value>,
    pub total_tokens: TokenUsage,
    pub total_duration_ms: u64,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Status of a workflow run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkflowRunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    PausedForHuman,
}

/// Result of an individual workflow step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepResult {
    pub step_id: String,
    pub step_name: String,
    pub status: WorkflowStepStatus,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub token_usage: TokenUsage,
}

/// Status of a workflow step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkflowStepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
    WaitingForHuman,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Code Assistance
// ═══════════════════════════════════════════════════════════════════════════════

/// Request for code assistance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAssistRequest {
    pub provider_id: String,
    pub model: String,
    pub action: CodeAssistAction,
    pub code: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub context: Vec<CodeContext>,
    #[serde(default)]
    pub params: InferenceParams,
}

/// Types of code assistance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodeAssistAction {
    Generate,
    Complete,
    Review,
    Refactor,
    Explain,
    Document,
    FindBugs,
    Optimize,
    ConvertLanguage,
    WriteTests,
    FixError,
}

/// Additional code context for the AI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeContext {
    pub filename: String,
    pub content: String,
    #[serde(default)]
    pub language: Option<String>,
    /// Selection range if only part of file is relevant.
    #[serde(default)]
    pub start_line: Option<u32>,
    #[serde(default)]
    pub end_line: Option<u32>,
}

/// Result of a code assist operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAssistResult {
    pub id: String,
    pub action: CodeAssistAction,
    pub result: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub suggestions: Vec<CodeSuggestion>,
    pub usage: TokenUsage,
    pub latency_ms: u64,
}

/// A granular code change suggestion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSuggestion {
    pub description: String,
    pub severity: SuggestionSeverity,
    #[serde(default)]
    pub start_line: Option<u32>,
    #[serde(default)]
    pub end_line: Option<u32>,
    #[serde(default)]
    pub original: Option<String>,
    #[serde(default)]
    pub replacement: Option<String>,
}

/// Severity of a code suggestion.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SuggestionSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Diagnostics & Health
// ═══════════════════════════════════════════════════════════════════════════════

/// Comprehensive AI-service health report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDiagnosticsReport {
    pub timestamp: DateTime<Utc>,
    pub providers: Vec<ProviderHealthInfo>,
    pub active_conversations: usize,
    pub active_agent_runs: usize,
    pub active_workflow_runs: usize,
    pub total_requests: u64,
    pub total_tokens_used: u64,
    pub total_cost_usd: f64,
    pub vector_collections: usize,
    pub vector_documents: usize,
    pub templates_count: usize,
    pub workflows_count: usize,
    pub memory_entries: usize,
    pub uptime_secs: u64,
}

/// Health information for a single provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealthInfo {
    pub provider: AiProvider,
    pub provider_id: String,
    pub connected: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
    pub models_available: usize,
    pub requests_made: u64,
    pub tokens_used: u64,
    pub cost_usd: f64,
}

/// Settings for the entire AI agent subsystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentSettings {
    /// Default provider config ID.
    #[serde(default)]
    pub default_provider_id: Option<String>,
    /// Default model to use.
    #[serde(default)]
    pub default_model: Option<String>,
    /// Default inference parameters.
    #[serde(default)]
    pub default_params: InferenceParams,
    /// Budget configuration.
    #[serde(default)]
    pub budget: Option<BudgetConfig>,
    /// Whether to log all requests/responses for debugging.
    #[serde(default = "default_false")]
    pub debug_logging: bool,
    /// Maximum concurrent requests across all providers.
    #[serde(default)]
    pub max_concurrent_requests: Option<u32>,
    /// Default memory configuration.
    #[serde(default)]
    pub default_memory_config: Option<MemoryConfig>,
}
