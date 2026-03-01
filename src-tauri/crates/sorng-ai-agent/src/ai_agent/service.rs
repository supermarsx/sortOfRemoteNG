// ── AI Agent Service ──────────────────────────────────────────────────────────
//
// Central orchestrator that owns all sub-stores and exposes high-level APIs.
// Wrapped in `Arc<tokio::sync::Mutex<AiAgentService>>` as Tauri managed state.

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

use super::types::*;
use super::conversation::ConversationStore;
use super::memory::MemoryStore;
use super::templates::TemplateRegistry;
use super::embeddings::VectorStore;
use super::rag::RagStore;
use super::workflows::{WorkflowRegistry, WorkflowExecutor};
use super::tokens;

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

    pub fn get_settings(&self) -> AiAgentSettings { self.settings.clone() }

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
        self.providers.get(provider_id)
            .map(|c| c.provider.clone())
            .unwrap_or(AiProvider::Custom)
    }

    pub async fn check_provider_health(&self, id: &str) -> ProviderHealthInfo {
        let config = self.providers.get(id);
        let info = self.provider_info.get(id);

        ProviderHealthInfo {
            provider: config.map(|c| c.provider.clone()).unwrap_or(AiProvider::Custom),
            provider_id: id.to_string(),
            connected: info.map(|i| i.connected).unwrap_or(false),
            latency_ms: None, // Would do a real ping in production
            error: if config.is_none() { Some("Provider not configured".into()) } else { None },
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
        self.conversations.list_summaries(&|pid: &str| self.resolve_provider_type(pid))
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

    pub fn fork_conversation(&mut self, req: ForkConversationRequest) -> Result<Conversation, String> {
        self.conversations.fork(req)
    }

    pub fn add_message(&mut self, conversation_id: &str, message: ChatMessage) -> Result<(), String> {
        self.conversations.add_message(conversation_id, message)
    }

    pub fn add_user_message(&mut self, conversation_id: &str, text: &str) -> Result<ChatMessage, String> {
        self.conversations.add_user_message(conversation_id, text)
    }

    pub fn add_assistant_message(
        &mut self, conversation_id: &str, text: &str, usage: Option<&TokenUsage>,
    ) -> Result<ChatMessage, String> {
        self.conversations.add_assistant_message(conversation_id, text, usage)
    }

    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
        self.conversations.get_messages(conversation_id)
    }

    pub fn clear_messages(&mut self, conversation_id: &str) -> Result<(), String> {
        self.conversations.clear_messages(conversation_id)
    }

    pub fn search_conversations(&self, query: &str) -> Vec<ConversationSummary> {
        self.conversations.search(query).into_iter().map(|c| {
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
        }).collect()
    }

    pub fn export_conversation(&self, id: &str) -> Result<serde_json::Value, String> {
        self.conversations.export_conversation(id)
    }

    pub fn import_conversation(&mut self, data: serde_json::Value) -> Result<String, String> {
        self.conversations.import_conversation(data)
    }

    pub fn conversation_count(&self) -> usize { self.conversations.count() }

    // ═══════════════════════════════════════════════════════════════════════════
    // Chat Completion (simplified – real impl would call LlmProvider)
    // ═══════════════════════════════════════════════════════════════════════════

    pub async fn chat_completion(&mut self, req: ChatRequest) -> Result<ChatResponse, String> {
        self.request_count += 1;

        // In production, dispatch to the correct LlmProvider
        let response_text = format!(
            "[AI response placeholder from provider '{}' model '{}']",
            req.provider_id, req.model
        );

        let usage = TokenUsage {
            prompt_tokens: req.messages.iter().filter_map(|m| m.token_count).sum(),
            completion_tokens: 0,
            total_tokens: 0,
            estimated_cost: 0.0,
        };

        self.total_tokens_used += usage.total_tokens as u64;
        self.total_cost_usd += usage.estimated_cost;

        // If conversation_id is set, add the response
        if let Some(ref conv_id) = req.conversation_id {
            let _ = self.conversations.add_assistant_message(conv_id, &response_text, Some(&usage));
        }

        let msg = ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::Assistant,
            content: vec![ContentBlock::Text { text: response_text }],
            tool_call_id: None,
            tool_calls: Vec::new(),
            name: None,
            created_at: Utc::now(),
            token_count: Some(usage.total_tokens),
            metadata: HashMap::new(),
        };

        Ok(ChatResponse {
            id: Uuid::new_v4().to_string(),
            provider: self.resolve_provider_type(&req.provider_id),
            model: req.model,
            message: msg,
            finish_reason: FinishReason::Stop,
            usage,
            created_at: Utc::now(),
            latency_ms: 0,
            metadata: req.metadata,
        })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Agent Engine
    // ═══════════════════════════════════════════════════════════════════════════

    pub async fn run_agent(&mut self, config: AgentConfig, prompt: &str) -> Result<AgentRunResult, String> {
        self.request_count += 1;
        // Build initial messages from prompt
        let messages = vec![ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::User,
            content: vec![ContentBlock::Text { text: prompt.to_string() }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        }];
        // Create a placeholder result — real impl would resolve an LlmProvider
        // from config.provider_id and call engine::run_agent()
        let _ = messages; // suppress unused
        let result = AgentRunResult {
            run_id: Uuid::new_v4().to_string(),
            strategy: config.strategy.clone(),
            final_answer: Some(format!("[Agent placeholder for {:?} strategy]", config.strategy)),
            steps: Vec::new(),
            total_iterations: 0,
            total_tokens: TokenUsage::default(),
            total_duration_ms: 0,
            status: AgentRunStatus::Completed,
            created_at: Utc::now(),
            completed_at: Some(Utc::now()),
            metadata: HashMap::new(),
        };
        self.total_tokens_used += result.total_tokens.total_tokens as u64;
        self.total_cost_usd += result.total_tokens.estimated_cost;
        Ok(result)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Code Assist
    // ═══════════════════════════════════════════════════════════════════════════

    pub async fn run_code_assist(&mut self, req: CodeAssistRequest) -> Result<CodeAssistResult, String> {
        self.request_count += 1;
        // Real implementation would resolve an LlmProvider from req.provider_id
        // and call code_assist::run_code_assist(&req, &provider)
        let result = CodeAssistResult {
            id: Uuid::new_v4().to_string(),
            action: req.action.clone(),
            result: format!("[Code assist placeholder for {:?}]", req.action),
            language: req.language.clone(),
            suggestions: Vec::new(),
            usage: TokenUsage::default(),
            latency_ms: 0,
        };
        self.total_tokens_used += result.usage.total_tokens as u64;
        self.total_cost_usd += result.usage.estimated_cost;
        Ok(result)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Templates
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn list_templates(&self) -> Vec<&PromptTemplate> { self.templates.list() }
    pub fn get_template(&self, id: &str) -> Option<&PromptTemplate> { self.templates.get(id) }

    pub fn create_template(
        &mut self, name: &str, template: &str, description: &str,
        variables: Vec<TemplateVariable>, tags: Vec<String>,
    ) -> String {
        self.templates.create(name, template, description, variables, tags)
    }

    pub fn delete_template(&mut self, id: &str) -> bool { self.templates.remove(id) }

    pub fn render_template(&self, req: RenderTemplateRequest) -> Result<String, String> {
        let tmpl = self.templates.get(&req.template_id)
            .ok_or_else(|| format!("Template {} not found", req.template_id))?;
        super::templates::render_prompt_template(tmpl, &req.variables)
    }

    pub fn template_count(&self) -> usize { self.templates.list().len() }

    // ═══════════════════════════════════════════════════════════════════════════
    // Memory
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn add_memory_entry(
        &mut self, content: &str, namespace: Option<&str>,
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

    pub fn clear_memory(&mut self) { self.memory.clear(); }

    pub fn memory_count(&self) -> usize { self.memory.count() }

    pub fn get_memory_config(&self) -> &MemoryConfig { self.memory.config() }

    pub fn update_memory_config(&mut self, config: MemoryConfig) {
        self.memory.update_config(config);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Embeddings / Vectors
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn add_vector(&mut self, text: &str, embedding: Vec<f32>, metadata: HashMap<String, serde_json::Value>) -> String {
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

    pub fn search_vectors(&self, query_embedding: &[f32], top_k: usize, threshold: f32) -> Vec<SimilarityResult> {
        self.vectors.search("default", query_embedding, top_k, Some(threshold))
    }

    pub fn vector_count(&self) -> usize { self.vectors.total_entries() }

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

    pub fn list_rag_collections(&self) -> Vec<String> { self.rag.collection_names() }
    pub fn rag_document_count(&self) -> usize { self.rag.document_count() }
    pub fn rag_collection_count(&self) -> usize { self.rag.collection_count() }

    // ═══════════════════════════════════════════════════════════════════════════
    // Workflows
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn create_workflow(
        &mut self, name: &str, description: &str, steps: Vec<WorkflowStep>, tags: Vec<String>,
    ) -> String {
        self.workflows.create(name, description, steps, tags)
    }

    pub fn get_workflow(&self, id: &str) -> Option<&WorkflowDefinition> { self.workflows.get(id) }
    pub fn delete_workflow(&mut self, id: &str) -> bool { self.workflows.remove(id) }
    pub fn list_workflows(&self) -> Vec<&WorkflowDefinition> { self.workflows.list() }
    pub fn workflow_count(&self) -> usize { self.workflows.count() }

    pub async fn run_workflow(&mut self, req: RunWorkflowRequest) -> Result<WorkflowRunResult, String> {
        self.request_count += 1;
        let wf = self.workflows.get(&req.workflow_id)
            .ok_or_else(|| format!("Workflow {} not found", req.workflow_id))?
            .clone();
        let result = WorkflowExecutor::run(&wf, req.variables, &req.provider_id, &req.model).await?;
        self.total_tokens_used += result.total_tokens.total_tokens as u64;
        self.total_cost_usd += result.total_tokens.estimated_cost;
        Ok(result)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Token Counting & Budget
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn count_tokens(&self, text: &str, model: &str) -> TokenCountResult {
        // Resolve provider from settings or default to OpenAI for tokenization
        let provider = self.settings.default_provider_id.as_deref()
            .and_then(|pid| self.providers.get(pid))
            .map(|c| c.provider.clone())
            .unwrap_or(AiProvider::OpenAi);
        tokens::count_tokens(text, &provider, model)
    }

    pub fn get_budget_status(&self) -> BudgetStatus {
        let budget = &self.settings.budget;
        let remaining_usd = budget.as_ref().map(|b| {
            if b.max_cost_usd > 0.0 { b.max_cost_usd - self.total_cost_usd } else { f64::INFINITY }
        });
        let remaining_tokens = budget.as_ref().and_then(|b| {
            if b.max_total_tokens > 0 { Some(b.max_total_tokens.saturating_sub(self.total_tokens_used)) } else { None }
        });
        let utilization = budget.as_ref().map(|b| {
            if b.max_cost_usd > 0.0 {
                (self.total_cost_usd / b.max_cost_usd * 100.0).min(100.0)
            } else { 0.0 }
        }).unwrap_or(0.0);
        let warning_threshold = budget.as_ref().and_then(|b| b.warning_threshold);
        let is_over = budget.as_ref().map(|b| {
            b.enforce_hard_limit && b.max_cost_usd > 0.0 && self.total_cost_usd >= b.max_cost_usd
        }).unwrap_or(false);
        let is_warning = warning_threshold.map(|wt| utilization >= wt * 100.0).unwrap_or(false);

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
        for (id, _cfg) in &self.providers {
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
