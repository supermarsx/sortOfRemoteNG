use crate::config::ProviderConfig;
use crate::error::LlmResult;
use crate::provider::LlmProvider;
use crate::providers::openai::OpenAiProvider;
use crate::types::*;
use async_trait::async_trait;

/// Local GGUF model provider — uses Ollama or llama.cpp compatible server
pub struct LocalProvider {
    inner: OpenAiProvider,
    config: ProviderConfig,
}

impl LocalProvider {
    pub fn new(config: ProviderConfig) -> Self {
        let mut cfg = config.clone();
        if cfg.base_url.is_none() {
            cfg.base_url = Some("http://localhost:8080/v1".to_string());
        }
        Self {
            inner: OpenAiProvider::new(cfg),
            config,
        }
    }
}

#[async_trait]
impl LlmProvider for LocalProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Local
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
        self.inner.list_models().await
    }

    async fn health_check(&self) -> LlmResult<bool> {
        self.inner.health_check().await
    }

    fn supports_tools(&self) -> bool {
        false
    }
    fn supports_streaming(&self) -> bool {
        true
    }
    fn config(&self) -> &ProviderConfig {
        &self.config
    }
}
