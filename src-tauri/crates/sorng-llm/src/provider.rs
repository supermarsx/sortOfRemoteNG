use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{LlmError, LlmResult};
use crate::types::*;
use crate::config::ProviderConfig;

/// Trait that every LLM provider backend must implement
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Unique provider type identifier
    fn provider_type(&self) -> ProviderType;

    /// Human-readable name
    fn display_name(&self) -> String;

    /// Send a chat completion request and receive a full response
    async fn chat_completion(&self, request: &ChatCompletionRequest) -> LlmResult<ChatCompletionResponse>;

    /// Start a streaming chat completion. Returns a stream receiver.
    async fn stream_chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<tokio::sync::mpsc::Receiver<LlmResult<StreamChunk>>>;

    /// List models available from this provider
    async fn list_models(&self) -> LlmResult<Vec<ModelInfo>>;

    /// Perform a health check
    async fn health_check(&self) -> LlmResult<bool>;

    /// Generate embeddings
    async fn create_embedding(&self, request: &EmbeddingRequest) -> LlmResult<EmbeddingResponse> {
        let _ = request;
        Err(LlmError::provider_error(
            &self.display_name(),
            "Embeddings not supported by this provider",
            None,
        ))
    }

    /// Whether this provider supports tool/function calling
    fn supports_tools(&self) -> bool { true }

    /// Whether this provider supports streaming
    fn supports_streaming(&self) -> bool { true }

    /// Whether this provider supports vision/image inputs
    fn supports_vision(&self) -> bool { false }

    /// Get the provider configuration
    fn config(&self) -> &ProviderConfig;
}

/// Registry managing all configured LLM providers
pub struct ProviderRegistry {
    providers: HashMap<String, Arc<dyn LlmProvider>>,
    configs: HashMap<String, ProviderConfig>,
    default_provider: Option<String>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
            configs: HashMap::new(),
            default_provider: None,
        }
    }

    /// Register a provider implementation
    pub fn register(&mut self, id: &str, provider: Arc<dyn LlmProvider>, config: ProviderConfig) {
        self.configs.insert(id.to_string(), config);
        self.providers.insert(id.to_string(), provider);
    }

    /// Remove a provider
    pub fn unregister(&mut self, id: &str) -> bool {
        self.configs.remove(id);
        self.providers.remove(id).is_some()
    }

    /// Get a provider by ID
    pub fn get(&self, id: &str) -> Option<&Arc<dyn LlmProvider>> {
        self.providers.get(id)
    }

    /// Get provider config by ID
    pub fn get_config(&self, id: &str) -> Option<&ProviderConfig> {
        self.configs.get(id)
    }

    /// Get mutable provider config
    pub fn get_config_mut(&mut self, id: &str) -> Option<&mut ProviderConfig> {
        self.configs.get_mut(id)
    }

    /// List all registered provider IDs
    pub fn list_ids(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }

    /// List all configs
    pub fn list_configs(&self) -> Vec<&ProviderConfig> {
        self.configs.values().collect()
    }

    /// Get enabled providers sorted by priority
    pub fn enabled_by_priority(&self) -> Vec<(&String, &Arc<dyn LlmProvider>)> {
        let mut entries: Vec<_> = self
            .providers
            .iter()
            .filter(|(id, _)| {
                self.configs
                    .get(*id)
                    .map(|c| c.enabled)
                    .unwrap_or(false)
            })
            .collect();
        entries.sort_by(|(a, _), (b, _)| {
            let pa = self.configs.get(*a).map(|c| c.priority).unwrap_or(0);
            let pb = self.configs.get(*b).map(|c| c.priority).unwrap_or(0);
            pa.cmp(&pb)
        });
        entries
    }

    /// Set default provider
    pub fn set_default(&mut self, id: &str) {
        self.default_provider = Some(id.to_string());
    }

    /// Get default provider
    pub fn default_provider(&self) -> Option<&Arc<dyn LlmProvider>> {
        self.default_provider
            .as_ref()
            .and_then(|id| self.providers.get(id))
    }

    pub fn default_provider_id(&self) -> Option<&str> {
        self.default_provider.as_deref()
    }

    /// Find the best provider for a given model
    pub fn find_provider_for_model(&self, model: &str) -> Option<(&String, &Arc<dyn LlmProvider>)> {
        for (id, provider) in self.enabled_by_priority() {
            let config = self.configs.get(id);
            if let Some(cfg) = config {
                if cfg.default_model.as_deref() == Some(model) {
                    return Some((id, provider));
                }
            }
        }
        // Fall back to default provider
        if let Some(ref default_id) = self.default_provider {
            if let Some(provider) = self.providers.get(default_id) {
                return Some((default_id, provider));
            }
        }
        // Fall back to first enabled
        self.enabled_by_priority().into_iter().next()
    }

    pub fn provider_count(&self) -> usize {
        self.providers.len()
    }

    pub fn enabled_count(&self) -> usize {
        self.configs.values().filter(|c| c.enabled).count()
    }
}

/// Thread-safe registry wrapper
pub type SharedRegistry = Arc<RwLock<ProviderRegistry>>;

pub fn new_shared_registry() -> SharedRegistry {
    Arc::new(RwLock::new(ProviderRegistry::new()))
}
