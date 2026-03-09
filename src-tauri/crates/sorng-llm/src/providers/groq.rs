use crate::config::ProviderConfig;
use crate::error::LlmResult;
use crate::provider::LlmProvider;
use crate::providers::openai::OpenAiProvider;
use crate::types::*;
use async_trait::async_trait;

/// Groq provider — uses OpenAI-compatible API
pub struct GroqProvider {
    inner: OpenAiProvider,
    config: ProviderConfig,
}

impl GroqProvider {
    pub fn new(config: ProviderConfig) -> Self {
        let mut cfg = config.clone();
        if cfg.base_url.is_none() {
            cfg.base_url = Some("https://api.groq.com/openai/v1".to_string());
        }
        Self {
            inner: OpenAiProvider::new(cfg),
            config,
        }
    }
}

#[async_trait]
impl LlmProvider for GroqProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Groq
    }
    fn display_name(&self) -> String {
        self.config.display_name.clone()
    }

    async fn chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        self.inner.chat_completion(request).await
    }

    async fn stream_chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<tokio::sync::mpsc::Receiver<LlmResult<StreamChunk>>> {
        self.inner.stream_chat_completion(request).await
    }

    async fn list_models(&self) -> LlmResult<Vec<ModelInfo>> {
        Ok(crate::config::build_model_catalog()
            .into_iter()
            .filter(|m| m.provider == "groq")
            .collect())
    }

    async fn health_check(&self) -> LlmResult<bool> {
        self.inner.health_check().await
    }

    fn supports_tools(&self) -> bool {
        true
    }
    fn supports_streaming(&self) -> bool {
        true
    }
    fn config(&self) -> &ProviderConfig {
        &self.config
    }
}
