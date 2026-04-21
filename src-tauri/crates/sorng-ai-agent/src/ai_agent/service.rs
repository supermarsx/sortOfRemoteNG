// ── AI Agent Service ──────────────────────────────────────────────────────────
//
// Central orchestrator that owns all sub-stores and exposes high-level APIs.
// Wrapped in `Arc<tokio::sync::Mutex<AiAgentService>>` as Tauri managed state.

use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

use super::code_assist;
use super::conversation::ConversationStore;
use super::embeddings::VectorStore;
use super::engine;
use super::memory::MemoryStore;
use super::providers::{create_provider, LlmProvider};
use super::rag::RagStore;
use super::templates::TemplateRegistry;
use super::tokens;
use super::tools::ToolRegistry;
use super::types::*;
use super::workflows::{WorkflowExecutor, WorkflowRegistry};

// ── Service ──────────────────────────────────────────────────────────────────

pub struct AiAgentService {
    settings: AiAgentSettings,
    providers: HashMap<String, ProviderConfig>,
    provider_info: HashMap<String, ProviderInfo>,
    conversations: ConversationStore,
    memory: MemoryStore,
    templates: TemplateRegistry,
    vectors: VectorStore,
    rag: RagStore,
    workflows: WorkflowRegistry,
    // tracking
    request_count: u64,
    total_tokens_used: u64,
    total_cost_usd: f64,
    started_at: chrono::DateTime<Utc>,
}

impl Default for AiAgentService {
    fn default() -> Self {
        Self::new()
    }
}

impl AiAgentService {
    pub fn new() -> Self {
        let mut tmpl = TemplateRegistry::new();
        for t in super::templates::builtin_templates() {
            tmpl.register(t);
        }
        Self {
            settings: AiAgentSettings {
                default_provider_id: None,
                default_model: None,
                default_params: InferenceParams::default(),
                budget: None,
                debug_logging: false,
                max_concurrent_requests: None,
                default_memory_config: None,
            },
            providers: HashMap::new(),
            provider_info: HashMap::new(),
            conversations: ConversationStore::new(),
            memory: MemoryStore::new(MemoryStore::default_config()),
            templates: tmpl,
            vectors: VectorStore::new(),
            rag: RagStore::new(),
            workflows: WorkflowRegistry::new(),
            request_count: 0,
            total_tokens_used: 0,
            total_cost_usd: 0.0,
            started_at: Utc::now(),
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Settings
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn get_settings(&self) -> AiAgentSettings {
        self.settings.clone()
    }

    pub fn update_settings(&mut self, settings: AiAgentSettings) {
        self.settings = settings;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Provider Management
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn add_provider(&mut self, id: &str, config: ProviderConfig) -> ProviderInfo {
        let now = Utc::now();
        let info = ProviderInfo {
            id: id.to_string(),
            provider: config.provider.clone(),
            connected: true,
            available_models: Vec::new(),
            default_model: None,
            connected_at: Some(now),
        };
        self.providers.insert(id.to_string(), config);
        self.provider_info.insert(id.to_string(), info.clone());
        info
    }

    pub fn remove_provider(&mut self, id: &str) -> bool {
        self.providers.remove(id);
        self.provider_info.remove(id).is_some()
    }

    pub fn get_provider_config(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.get(id)
    }

    pub fn list_providers(&self) -> Vec<ProviderInfo> {
        self.provider_info.values().cloned().collect()
    }

    pub fn resolve_provider_type(&self, provider_id: &str) -> AiProvider {
        self.providers
            .get(provider_id)
            .map(|c| c.provider.clone())
            .unwrap_or(AiProvider::Custom)
    }

    pub async fn check_provider_health(&self, id: &str) -> ProviderHealthInfo {
        let config = self.providers.get(id);
        let info = self.provider_info.get(id);

        ProviderHealthInfo {
            provider: config
                .map(|c| c.provider.clone())
                .unwrap_or(AiProvider::Custom),
            provider_id: id.to_string(),
            connected: info.map(|i| i.connected).unwrap_or(false),
            latency_ms: None, // Would do a real ping in production
            error: if config.is_none() {
                Some("Provider not configured".into())
            } else {
                None
            },
            models_available: info.map(|i| i.available_models.len()).unwrap_or(0),
            requests_made: 0,
            tokens_used: 0,
            cost_usd: 0.0,
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Conversations
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn create_conversation(&mut self, req: CreateConversationRequest) -> Conversation {
        self.conversations.create(req)
    }

    pub fn get_conversation(&self, id: &str) -> Option<&Conversation> {
        self.conversations.get(id)
    }

    pub fn delete_conversation(&mut self, id: &str) -> bool {
        self.conversations.delete(id)
    }

    pub fn list_conversations(&self) -> Vec<ConversationSummary> {
        self.conversations
            .list_summaries(&|pid: &str| self.resolve_provider_type(pid))
    }

    pub fn rename_conversation(&mut self, id: &str, title: &str) -> Result<(), String> {
        self.conversations.rename(id, title)
    }

    pub fn pin_conversation(&mut self, id: &str, pinned: bool) -> Result<(), String> {
        self.conversations.set_pinned(id, pinned)
    }

    pub fn archive_conversation(&mut self, id: &str, archived: bool) -> Result<(), String> {
        self.conversations.set_archived(id, archived)
    }

    pub fn set_conversation_tags(&mut self, id: &str, tags: Vec<String>) -> Result<(), String> {
        self.conversations.set_tags(id, tags)
    }

    pub fn fork_conversation(
        &mut self,
        req: ForkConversationRequest,
    ) -> Result<Conversation, String> {
        self.conversations.fork(req)
    }

    pub fn add_message(
        &mut self,
        conversation_id: &str,
        message: ChatMessage,
    ) -> Result<(), String> {
        self.conversations.add_message(conversation_id, message)
    }

    pub fn add_user_message(
        &mut self,
        conversation_id: &str,
        text: &str,
    ) -> Result<ChatMessage, String> {
        self.conversations.add_user_message(conversation_id, text)
    }

    pub fn add_assistant_message(
        &mut self,
        conversation_id: &str,
        text: &str,
        usage: Option<&TokenUsage>,
    ) -> Result<ChatMessage, String> {
        self.conversations
            .add_assistant_message(conversation_id, text, usage)
    }

    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
        self.conversations.get_messages(conversation_id)
    }

    pub fn clear_messages(&mut self, conversation_id: &str) -> Result<(), String> {
        self.conversations.clear_messages(conversation_id)
    }

    pub fn search_conversations(&self, query: &str) -> Vec<ConversationSummary> {
        self.conversations
            .search(query)
            .into_iter()
            .map(|c| {
                let last_preview = c.messages.last().and_then(|m| {
                    m.content.first().and_then(|b| match b {
                        ContentBlock::Text { text } => Some(text.chars().take(120).collect()),
                        _ => None,
                    })
                });
                ConversationSummary {
                    id: c.id.clone(),
                    title: c.title.clone(),
                    provider: self.resolve_provider_type(&c.provider_id),
                    model: c.model.clone(),
                    message_count: c.messages.len(),
                    total_tokens: c.total_tokens,
                    total_cost: c.total_cost,
                    created_at: c.created_at,
                    updated_at: c.updated_at,
                    tags: c.tags.clone(),
                    pinned: c.pinned,
                    archived: c.archived,
                    last_message_preview: last_preview,
                }
            })
            .collect()
    }

    pub fn export_conversation(&self, id: &str) -> Result<serde_json::Value, String> {
        self.conversations.export_conversation(id)
    }

    pub fn import_conversation(&mut self, data: serde_json::Value) -> Result<String, String> {
        self.conversations.import_conversation(data)
    }

    pub fn conversation_count(&self) -> usize {
        self.conversations.count()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Provider resolution (internal helper)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Resolve a `LlmProvider` instance for the given provider config ID, by
    /// looking up the stored `ProviderConfig` and constructing a fresh backend
    /// via `providers::create_provider`.
    fn resolve_provider(&self, provider_id: &str) -> Result<Box<dyn LlmProvider>, String> {
        let config = self
            .providers
            .get(provider_id)
            .ok_or_else(|| format!("Provider '{}' is not configured", provider_id))?;
        create_provider(config)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Chat Completion — dispatches through the configured LlmProvider backend.
    // ═══════════════════════════════════════════════════════════════════════════

    pub async fn chat_completion(&mut self, req: ChatRequest) -> Result<ChatResponse, String> {
        self.request_count += 1;

        // Resolve backend and dispatch. Network I/O happens here; the outer
        // Arc<Mutex<AiAgentService>> holds the lock for the round-trip (pre-existing
        // design; see engine.rs and code_assist.rs for the same pattern).
        let provider = self.resolve_provider(&req.provider_id)?;

        let response = provider
            .chat_completion(&req.messages, &req.model, &req.params, &req.tools)
            .await?;

        // Aggregate usage/cost tracking.
        self.total_tokens_used += response.usage.total_tokens as u64;
        self.total_cost_usd += response.usage.estimated_cost;

        // Persist the assistant reply to the conversation if requested.
        if let Some(ref conv_id) = req.conversation_id {
            let assistant_text = response
                .message
                .content
                .iter()
                .filter_map(|b| match b {
                    ContentBlock::Text { text } => Some(text.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("");
            let _ = self.conversations.add_assistant_message(
                conv_id,
                &assistant_text,
                Some(&response.usage),
            );
        }

        // Preserve caller-supplied metadata on the outbound response.
        let mut out = response;
        if !req.metadata.is_empty() {
            for (k, v) in req.metadata {
                out.metadata.entry(k).or_insert(v);
            }
        }

        Ok(out)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Agent Engine — delegates to the shared multi-strategy runner.
    // ═══════════════════════════════════════════════════════════════════════════

    pub async fn run_agent(
        &mut self,
        config: AgentConfig,
        prompt: &str,
    ) -> Result<AgentRunResult, String> {
        self.request_count += 1;

        let provider = self.resolve_provider(&config.provider_id)?;

        // Seed the run with the user prompt. Per-strategy system prompts are
        // injected inside `engine::run_agent` based on `config.strategy`.
        let initial_messages = vec![ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::User,
            content: vec![ContentBlock::Text {
                text: prompt.to_string(),
            }],
            tool_call_id: None,
            tool_calls: Vec::new(),
            name: None,
            created_at: Utc::now(),
            token_count: None,
            metadata: HashMap::new(),
        }];

        // The service has no global tool registry today; expose an empty one.
        // Adding tool plumbing is tracked as a separate concern.
        let tools = ToolRegistry::new();

        let result = engine::run_agent(
            &config,
            provider.as_ref(),
            &tools,
            initial_messages,
            None, // memory is tracked separately; summarise_recent handles LLM summaries
        )
        .await?;

        self.total_tokens_used += result.total_tokens.total_tokens as u64;
        self.total_cost_usd += result.total_tokens.estimated_cost;
        Ok(result)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Code Assist — delegates to the code_assist module with a real provider.
    // ═══════════════════════════════════════════════════════════════════════════

    pub async fn run_code_assist(
        &mut self,
        req: CodeAssistRequest,
    ) -> Result<CodeAssistResult, String> {
        self.request_count += 1;

        let provider = self.resolve_provider(&req.provider_id)?;
        let result = code_assist::run_code_assist(&req, provider.as_ref()).await?;

        self.total_tokens_used += result.usage.total_tokens as u64;
        self.total_cost_usd += result.usage.estimated_cost;
        Ok(result)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Templates
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn list_templates(&self) -> Vec<&PromptTemplate> {
        self.templates.list()
    }
    pub fn get_template(&self, id: &str) -> Option<&PromptTemplate> {
        self.templates.get(id)
    }

    pub fn create_template(
        &mut self,
        name: &str,
        template: &str,
        description: &str,
        variables: Vec<TemplateVariable>,
        tags: Vec<String>,
    ) -> String {
        self.templates
            .create(name, template, description, variables, tags)
    }

    pub fn delete_template(&mut self, id: &str) -> bool {
        self.templates.remove(id)
    }

    pub fn render_template(&self, req: RenderTemplateRequest) -> Result<String, String> {
        let tmpl = self
            .templates
            .get(&req.template_id)
            .ok_or_else(|| format!("Template {} not found", req.template_id))?;
        super::templates::render_prompt_template(tmpl, &req.variables)
    }

    pub fn template_count(&self) -> usize {
        self.templates.list().len()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Memory
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn add_memory_entry(
        &mut self,
        content: &str,
        namespace: Option<&str>,
        metadata: HashMap<String, serde_json::Value>,
    ) -> String {
        self.memory.add_entry(content, namespace, metadata)
    }

    pub fn get_memory_entry(&mut self, id: &str) -> Option<&MemoryEntry> {
        self.memory.get_entry(id)
    }

    pub fn remove_memory_entry(&mut self, id: &str) -> bool {
        self.memory.remove_entry(id)
    }

    pub fn list_memory_entries(&self, namespace: Option<&str>) -> Vec<&MemoryEntry> {
        self.memory.list_entries(namespace)
    }

    pub fn search_memory(&self, query: &str, limit: usize) -> Vec<&MemoryEntry> {
        self.memory.search_entries(query, limit)
    }

    pub fn clear_memory(&mut self) {
        self.memory.clear();
    }

    pub fn memory_count(&self) -> usize {
        self.memory.count()
    }

    pub fn get_memory_config(&self) -> &MemoryConfig {
        self.memory.config()
    }

    pub fn update_memory_config(&mut self, config: MemoryConfig) {
        self.memory.update_config(config);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Embeddings / Vectors
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn add_vector(
        &mut self,
        text: &str,
        embedding: Vec<f32>,
        metadata: HashMap<String, serde_json::Value>,
    ) -> String {
        use super::embeddings::VectorEntry;
        let id = Uuid::new_v4().to_string();
        self.vectors.upsert(VectorEntry {
            id: id.clone(),
            collection: "default".into(),
            text: text.to_string(),
            embedding,
            metadata,
            created_at: Utc::now(),
        });
        id
    }

    pub fn search_vectors(
        &self,
        query_embedding: &[f32],
        top_k: usize,
        threshold: f32,
    ) -> Vec<SimilarityResult> {
        self.vectors
            .search("default", query_embedding, top_k, Some(threshold))
    }

    pub fn vector_count(&self) -> usize {
        self.vectors.total_entries()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RAG
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn ingest_document(&mut self, req: IngestDocumentRequest) -> Result<String, String> {
        self.rag.ingest(req)
    }

    pub fn remove_document(&mut self, doc_id: &str) -> bool {
        self.rag.remove_document(doc_id)
    }

    pub fn search_rag(&self, req: &RagSearchRequest) -> Vec<RagSearchResult> {
        self.rag.search(req, None)
    }

    pub fn list_rag_collections(&self) -> Vec<String> {
        self.rag.collection_names()
    }
    pub fn rag_document_count(&self) -> usize {
        self.rag.document_count()
    }
    pub fn rag_collection_count(&self) -> usize {
        self.rag.collection_count()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Workflows
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn create_workflow(
        &mut self,
        name: &str,
        description: &str,
        steps: Vec<WorkflowStep>,
        tags: Vec<String>,
    ) -> String {
        self.workflows.create(name, description, steps, tags)
    }

    pub fn get_workflow(&self, id: &str) -> Option<&WorkflowDefinition> {
        self.workflows.get(id)
    }
    pub fn delete_workflow(&mut self, id: &str) -> bool {
        self.workflows.remove(id)
    }
    pub fn list_workflows(&self) -> Vec<&WorkflowDefinition> {
        self.workflows.list()
    }
    pub fn workflow_count(&self) -> usize {
        self.workflows.count()
    }

    pub async fn run_workflow(
        &mut self,
        req: RunWorkflowRequest,
    ) -> Result<WorkflowRunResult, String> {
        self.request_count += 1;
        let wf = self
            .workflows
            .get(&req.workflow_id)
            .ok_or_else(|| format!("Workflow {} not found", req.workflow_id))?
            .clone();

        // Instantiate the provider once per run; the workflow executor borrows it
        // as `&dyn LlmProvider` for every LLM-prompt step.
        let provider = self.resolve_provider(&req.provider_id)?;
        let result = WorkflowExecutor::run(
            &wf,
            req.variables,
            &req.provider_id,
            &req.model,
            Some(provider.as_ref()),
        )
        .await?;
        self.total_tokens_used += result.total_tokens.total_tokens as u64;
        self.total_cost_usd += result.total_tokens.estimated_cost;
        Ok(result)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Token Counting & Budget
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn count_tokens(&self, text: &str, model: &str) -> TokenCountResult {
        // Resolve provider from settings or default to OpenAI for tokenization
        let provider = self
            .settings
            .default_provider_id
            .as_deref()
            .and_then(|pid| self.providers.get(pid))
            .map(|c| c.provider.clone())
            .unwrap_or(AiProvider::OpenAi);
        tokens::count_tokens(text, &provider, model)
    }

    pub fn get_budget_status(&self) -> BudgetStatus {
        let budget = &self.settings.budget;
        let remaining_usd = budget.as_ref().map(|b| {
            if b.max_cost_usd > 0.0 {
                b.max_cost_usd - self.total_cost_usd
            } else {
                f64::INFINITY
            }
        });
        let remaining_tokens = budget.as_ref().and_then(|b| {
            if b.max_total_tokens > 0 {
                Some(b.max_total_tokens.saturating_sub(self.total_tokens_used))
            } else {
                None
            }
        });
        let utilization = budget
            .as_ref()
            .map(|b| {
                if b.max_cost_usd > 0.0 {
                    (self.total_cost_usd / b.max_cost_usd * 100.0).min(100.0)
                } else {
                    0.0
                }
            })
            .unwrap_or(0.0);
        let warning_threshold = budget.as_ref().and_then(|b| b.warning_threshold);
        let is_over = budget
            .as_ref()
            .map(|b| {
                b.enforce_hard_limit
                    && b.max_cost_usd > 0.0
                    && self.total_cost_usd >= b.max_cost_usd
            })
            .unwrap_or(false);
        let is_warning = warning_threshold
            .map(|wt| utilization >= wt * 100.0)
            .unwrap_or(false);

        BudgetStatus {
            total_cost_usd: self.total_cost_usd,
            total_tokens: self.total_tokens_used,
            request_count: self.request_count,
            budget_remaining_usd: remaining_usd,
            tokens_remaining: remaining_tokens,
            budget_utilization_pct: utilization,
            period_start: None,
            period_end: None,
            is_over_budget: is_over,
            is_warning,
        }
    }

    pub fn update_budget(&mut self, budget: BudgetConfig) {
        self.settings.budget = Some(budget);
    }

    pub fn reset_budget_counters(&mut self) {
        self.total_cost_usd = 0.0;
        self.total_tokens_used = 0;
        self.request_count = 0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Diagnostics
    // ═══════════════════════════════════════════════════════════════════════════

    pub async fn diagnostics(&self) -> AiDiagnosticsReport {
        let mut providers = Vec::new();
        for id in self.providers.keys() {
            providers.push(self.check_provider_health(id).await);
        }

        let uptime = (Utc::now() - self.started_at).num_seconds().max(0) as u64;

        AiDiagnosticsReport {
            timestamp: Utc::now(),
            providers,
            active_conversations: self.conversations.count(),
            active_agent_runs: 0,
            active_workflow_runs: 0,
            total_requests: self.request_count,
            total_tokens_used: self.total_tokens_used,
            total_cost_usd: self.total_cost_usd,
            vector_collections: self.rag.collection_count(),
            vector_documents: self.rag.document_count(),
            templates_count: self.templates.list().len(),
            workflows_count: self.workflows.count(),
            memory_entries: self.memory.count(),
            uptime_secs: uptime,
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::super::code_assist;
    use super::super::engine;
    use super::super::memory::MemoryStore;
    use super::super::providers::LlmProvider;
    use super::super::tools::ToolRegistry;
    use super::*;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// Mock LlmProvider that records how many times `chat_completion` was
    /// invoked and returns a canned response. Proves end-to-end dispatch
    /// without making any network calls.
    struct MockProvider {
        pub calls: Arc<AtomicUsize>,
        pub canned: String,
    }

    #[async_trait]
    impl LlmProvider for MockProvider {
        fn provider_type(&self) -> AiProvider {
            AiProvider::Custom
        }

        async fn list_models(&self) -> Result<Vec<ModelSpec>, String> {
            Ok(Vec::new())
        }

        async fn chat_completion(
            &self,
            _messages: &[ChatMessage],
            model: &str,
            _params: &InferenceParams,
            _tools: &[ToolDefinition],
        ) -> Result<ChatResponse, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(ChatResponse {
                id: Uuid::new_v4().to_string(),
                provider: AiProvider::Custom,
                model: model.to_string(),
                message: ChatMessage {
                    id: Uuid::new_v4().to_string(),
                    role: MessageRole::Assistant,
                    content: vec![ContentBlock::Text {
                        text: self.canned.clone(),
                    }],
                    tool_call_id: None,
                    tool_calls: Vec::new(),
                    name: None,
                    created_at: Utc::now(),
                    token_count: Some(12),
                    metadata: HashMap::new(),
                },
                finish_reason: FinishReason::Stop,
                usage: TokenUsage {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                    estimated_cost: 0.0,
                },
                created_at: Utc::now(),
                latency_ms: 1,
                metadata: HashMap::new(),
            })
        }

        async fn chat_completion_stream(
            &self,
            _messages: &[ChatMessage],
            _model: &str,
            _params: &InferenceParams,
            _tools: &[ToolDefinition],
            _request_id: &str,
        ) -> Result<tokio::sync::mpsc::Receiver<StreamEvent>, String> {
            let (_tx, rx) = tokio::sync::mpsc::channel(1);
            Ok(rx)
        }

        async fn generate_embeddings(
            &self,
            texts: &[String],
            _model: Option<&str>,
            _dimensions: Option<usize>,
        ) -> Result<EmbeddingResponse, String> {
            Ok(EmbeddingResponse {
                embeddings: texts.iter().map(|_| vec![0.0; 4]).collect(),
                model: "mock-embed".into(),
                usage: TokenUsage::default(),
                dimensions: 4,
            })
        }

        async fn health_check(&self) -> Result<u64, String> {
            Ok(1)
        }
    }

    fn user_msg(text: &str) -> ChatMessage {
        ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::User,
            content: vec![ContentBlock::Text {
                text: text.to_string(),
            }],
            tool_call_id: None,
            tool_calls: Vec::new(),
            name: None,
            created_at: Utc::now(),
            token_count: None,
            metadata: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn engine_dispatches_to_real_provider() {
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = MockProvider {
            calls: calls.clone(),
            canned: "final answer from mock".into(),
        };

        let config = AgentConfig {
            strategy: AgentStrategy::SingleShot,
            provider_id: "mock".into(),
            model: "mock-model".into(),
            system_prompt: None,
            params: InferenceParams::default(),
            tools: Vec::new(),
            max_iterations: 1,
            auto_stop_on_answer: true,
            include_reasoning: false,
            memory_config: None,
            rag_config: None,
            metadata: HashMap::new(),
        };

        let tools = ToolRegistry::new();
        let result = engine::run_agent(
            &config,
            &provider,
            &tools,
            vec![user_msg("hi")],
            None,
        )
        .await
        .expect("agent run should succeed");

        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "provider.chat_completion must be invoked exactly once"
        );
        assert_eq!(result.status, AgentRunStatus::Completed);
        assert_eq!(
            result.final_answer.as_deref(),
            Some("final answer from mock")
        );
        assert!(result.total_tokens.total_tokens > 0);
    }

    #[tokio::test]
    async fn code_assist_dispatches_to_real_provider() {
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = MockProvider {
            calls: calls.clone(),
            canned: "def foo(): pass".into(),
        };

        let req = CodeAssistRequest {
            provider_id: "mock".into(),
            model: "mock-model".into(),
            action: CodeAssistAction::Generate,
            code: String::new(),
            language: Some("python".into()),
            instructions: Some("write a no-op function".into()),
            context: Vec::new(),
            params: InferenceParams::default(),
        };

        let result = code_assist::run_code_assist(&req, &provider)
            .await
            .expect("code assist should succeed");

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(result.action, CodeAssistAction::Generate);
        assert!(result.result.contains("foo"));
    }

    #[tokio::test]
    async fn memory_summary_uses_provider() {
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = MockProvider {
            calls: calls.clone(),
            canned: "summary-of-entries".into(),
        };

        let mut mem = MemoryStore::new(MemoryStore::default_config());
        mem.add_entry("first memory", None, HashMap::new());
        mem.add_entry("second memory", None, HashMap::new());

        let summary = mem
            .summarize_recent(&provider, "mock-model", 10)
            .await
            .expect("summarize_recent should succeed");

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(summary, "summary-of-entries");
    }

    #[tokio::test]
    async fn resolve_provider_rejects_unknown_id() {
        let svc = AiAgentService::new();
        let Err(e) = svc.resolve_provider("nope") else {
            unreachable!("expected error for unknown provider id")
        };
        assert!(e.contains("not configured"), "unexpected error: {}", e);
    }
}
