// ── Provider backends ─────────────────────────────────────────────────────────
//
// Each sub-module implements the `LlmProvider` trait for a specific backend.
// The trait provides a unified interface for chat completions, embeddings,
// streaming, and model listing.

pub mod openai;
pub mod anthropic;
pub mod gemini;
pub mod ollama;
pub mod azure_openai;
pub mod groq;
pub mod mistral;
pub mod cohere;

use async_trait::async_trait;
use crate::ai_agent::types::*;

// ── Provider trait ───────────────────────────────────────────────────────────

/// Unified interface for LLM provider backends.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Provider identifier.
    fn provider_type(&self) -> AiProvider;

    /// List available models.
    async fn list_models(&self) -> Result<Vec<ModelSpec>, String>;

    /// Send a chat completion request (non-streaming).
    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        model: &str,
        params: &InferenceParams,
        tools: &[ToolDefinition],
    ) -> Result<ChatResponse, String>;

    /// Send a streaming chat completion request.
    /// Returns a receiver that yields stream events.
    async fn chat_completion_stream(
        &self,
        messages: &[ChatMessage],
        model: &str,
        params: &InferenceParams,
        tools: &[ToolDefinition],
        request_id: &str,
    ) -> Result<tokio::sync::mpsc::Receiver<StreamEvent>, String>;

    /// Generate embeddings for texts.
    async fn generate_embeddings(
        &self,
        texts: &[String],
        model: Option<&str>,
        dimensions: Option<usize>,
    ) -> Result<EmbeddingResponse, String>;

    /// Health check / ping the provider.
    async fn health_check(&self) -> Result<u64, String>;
}

/// Create a provider instance from configuration.
pub fn create_provider(config: &ProviderConfig) -> Result<Box<dyn LlmProvider>, String> {
    match config.provider {
        AiProvider::OpenAi => Ok(Box::new(openai::OpenAiProvider::new(config)?)),
        AiProvider::Anthropic => Ok(Box::new(anthropic::AnthropicProvider::new(config)?)),
        AiProvider::GoogleGemini => Ok(Box::new(gemini::GeminiProvider::new(config)?)),
        AiProvider::Ollama => Ok(Box::new(ollama::OllamaProvider::new(config)?)),
        AiProvider::AzureOpenAi => Ok(Box::new(azure_openai::AzureOpenAiProvider::new(config)?)),
        AiProvider::Groq => Ok(Box::new(groq::GroqProvider::new(config)?)),
        AiProvider::Mistral => Ok(Box::new(mistral::MistralProvider::new(config)?)),
        AiProvider::Cohere => Ok(Box::new(cohere::CohereProvider::new(config)?)),
        AiProvider::Custom => Err("Custom providers require explicit implementation".into()),
    }
}
