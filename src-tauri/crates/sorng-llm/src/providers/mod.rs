pub mod openai;
pub mod anthropic;
pub mod google;
pub mod ollama;
pub mod azure_openai;
pub mod groq;
pub mod mistral;
pub mod cohere;
pub mod deepseek;
pub mod local;

use std::sync::Arc;
use crate::config::ProviderConfig;
use crate::provider::LlmProvider;
use crate::types::ProviderType;

/// Factory to create a provider from config
pub fn create_provider(config: &ProviderConfig) -> Arc<dyn LlmProvider> {
    match config.provider_type {
        ProviderType::OpenAi => Arc::new(openai::OpenAiProvider::new(config.clone())),
        ProviderType::Anthropic => Arc::new(anthropic::AnthropicProvider::new(config.clone())),
        ProviderType::Google => Arc::new(google::GoogleProvider::new(config.clone())),
        ProviderType::Ollama => Arc::new(ollama::OllamaProvider::new(config.clone())),
        ProviderType::AzureOpenAi => Arc::new(azure_openai::AzureOpenAiProvider::new(config.clone())),
        ProviderType::Groq => Arc::new(groq::GroqProvider::new(config.clone())),
        ProviderType::Mistral => Arc::new(mistral::MistralProvider::new(config.clone())),
        ProviderType::Cohere => Arc::new(cohere::CohereProvider::new(config.clone())),
        ProviderType::DeepSeek => Arc::new(deepseek::DeepSeekProvider::new(config.clone())),
        ProviderType::Local => Arc::new(local::LocalProvider::new(config.clone())),
        // OpenAI-compatible providers use the OpenAI adapter
        ProviderType::Together | ProviderType::Fireworks | ProviderType::Perplexity
        | ProviderType::OpenRouter | ProviderType::HuggingFace | ProviderType::Custom => {
            Arc::new(openai::OpenAiProvider::new(config.clone()))
        }
        ProviderType::AwsBedrock => Arc::new(openai::OpenAiProvider::new(config.clone())),
    }
}
