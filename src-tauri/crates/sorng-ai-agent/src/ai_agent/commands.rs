// ── Tauri Commands ────────────────────────────────────────────────────────────
//
// Every `#[tauri::command]` is registered in the main lib.rs `generate_handler!`.
// All commands acquire the service via `tauri::State<AiAgentServiceState>` and
// use `.lock().await` (tokio::sync::Mutex).

use std::collections::HashMap;
use tauri::State;

use super::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_get_settings(state: State<'_, AiAgentServiceState>) -> Result<AiAgentSettings, String> {
    let svc = state.lock().await;
    Ok(svc.get_settings())
}

#[tauri::command]
pub async fn ai_update_settings(state: State<'_, AiAgentServiceState>, settings: AiAgentSettings) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_settings(settings);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Management
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_add_provider(state: State<'_, AiAgentServiceState>, id: String, config: ProviderConfig) -> Result<ProviderInfo, String> {
    let mut svc = state.lock().await;
    Ok(svc.add_provider(&id, config))
}

#[tauri::command]
pub async fn ai_remove_provider(state: State<'_, AiAgentServiceState>, id: String) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.remove_provider(&id))
}

#[tauri::command]
pub async fn ai_list_providers(state: State<'_, AiAgentServiceState>) -> Result<Vec<ProviderInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_providers())
}

#[tauri::command]
pub async fn ai_check_provider_health(state: State<'_, AiAgentServiceState>, id: String) -> Result<ProviderHealthInfo, String> {
    let svc = state.lock().await;
    Ok(svc.check_provider_health(&id).await)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Conversations
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_create_conversation(state: State<'_, AiAgentServiceState>, req: CreateConversationRequest) -> Result<Conversation, String> {
    let mut svc = state.lock().await;
    Ok(svc.create_conversation(req))
}

#[tauri::command]
pub async fn ai_get_conversation(state: State<'_, AiAgentServiceState>, id: String) -> Result<Conversation, String> {
    let svc = state.lock().await;
    svc.get_conversation(&id).cloned().ok_or_else(|| format!("Conversation {} not found", id))
}

#[tauri::command]
pub async fn ai_delete_conversation(state: State<'_, AiAgentServiceState>, id: String) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.delete_conversation(&id))
}

#[tauri::command]
pub async fn ai_list_conversations(state: State<'_, AiAgentServiceState>) -> Result<Vec<ConversationSummary>, String> {
    let svc = state.lock().await;
    Ok(svc.list_conversations())
}

#[tauri::command]
pub async fn ai_rename_conversation(state: State<'_, AiAgentServiceState>, id: String, title: String) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rename_conversation(&id, &title)
}

#[tauri::command]
pub async fn ai_pin_conversation(state: State<'_, AiAgentServiceState>, id: String, pinned: bool) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.pin_conversation(&id, pinned)
}

#[tauri::command]
pub async fn ai_archive_conversation(state: State<'_, AiAgentServiceState>, id: String, archived: bool) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.archive_conversation(&id, archived)
}

#[tauri::command]
pub async fn ai_set_conversation_tags(state: State<'_, AiAgentServiceState>, id: String, tags: Vec<String>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_conversation_tags(&id, tags)
}

#[tauri::command]
pub async fn ai_fork_conversation(state: State<'_, AiAgentServiceState>, req: ForkConversationRequest) -> Result<Conversation, String> {
    let mut svc = state.lock().await;
    svc.fork_conversation(req)
}

#[tauri::command]
pub async fn ai_search_conversations(state: State<'_, AiAgentServiceState>, query: String) -> Result<Vec<ConversationSummary>, String> {
    let svc = state.lock().await;
    Ok(svc.search_conversations(&query))
}

#[tauri::command]
pub async fn ai_export_conversation(state: State<'_, AiAgentServiceState>, id: String) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.export_conversation(&id)
}

#[tauri::command]
pub async fn ai_import_conversation(state: State<'_, AiAgentServiceState>, data: serde_json::Value) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.import_conversation(data)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_send_message(state: State<'_, AiAgentServiceState>, conversation_id: String, text: String) -> Result<ChatMessage, String> {
    let mut svc = state.lock().await;
    svc.add_user_message(&conversation_id, &text)
}

#[tauri::command]
pub async fn ai_get_messages(state: State<'_, AiAgentServiceState>, conversation_id: String) -> Result<Vec<ChatMessage>, String> {
    let svc = state.lock().await;
    svc.get_messages(&conversation_id)
}

#[tauri::command]
pub async fn ai_clear_messages(state: State<'_, AiAgentServiceState>, conversation_id: String) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_messages(&conversation_id)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Completion
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_chat_completion(state: State<'_, AiAgentServiceState>, req: ChatRequest) -> Result<ChatResponse, String> {
    let mut svc = state.lock().await;
    svc.chat_completion(req).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_run_agent(state: State<'_, AiAgentServiceState>, config: AgentConfig, prompt: String) -> Result<AgentRunResult, String> {
    let mut svc = state.lock().await;
    svc.run_agent(config, &prompt).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Code Assist
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_code_assist(state: State<'_, AiAgentServiceState>, req: CodeAssistRequest) -> Result<CodeAssistResult, String> {
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_generate(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, instructions: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::Generate,
        code: String::new(), language, instructions: Some(instructions),
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_review(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::Review,
        code, language, instructions: None,
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_refactor(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, instructions: Option<String>, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::Refactor,
        code, language, instructions,
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_explain(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::Explain,
        code, language, instructions: None,
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_document(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::Document,
        code, language, instructions: None,
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_find_bugs(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::FindBugs,
        code, language, instructions: None,
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_optimize(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::Optimize,
        code, language, instructions: None,
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_write_tests(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::WriteTests,
        code, language, instructions: None,
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_convert(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, target_language: String) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::ConvertLanguage,
        code, language: Some(target_language.clone()),
        instructions: Some(format!("Convert to {}", target_language)),
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

#[tauri::command]
pub async fn ai_code_fix_error(state: State<'_, AiAgentServiceState>, provider_id: String, model: String, code: String, error_message: String, language: Option<String>) -> Result<CodeAssistResult, String> {
    let req = CodeAssistRequest {
        provider_id, model, action: CodeAssistAction::FixError,
        code, language, instructions: Some(format!("Fix this error: {}", error_message)),
        context: Vec::new(), params: InferenceParams::default(),
    };
    let mut svc = state.lock().await;
    svc.run_code_assist(req).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_list_templates(state: State<'_, AiAgentServiceState>) -> Result<Vec<PromptTemplate>, String> {
    let svc = state.lock().await;
    Ok(svc.list_templates().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_get_template(state: State<'_, AiAgentServiceState>, id: String) -> Result<PromptTemplate, String> {
    let svc = state.lock().await;
    svc.get_template(&id).cloned().ok_or_else(|| format!("Template {} not found", id))
}

#[tauri::command]
pub async fn ai_create_template(
    state: State<'_, AiAgentServiceState>,
    name: String, template: String, description: String,
    variables: Vec<TemplateVariable>, tags: Vec<String>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.create_template(&name, &template, &description, variables, tags))
}

#[tauri::command]
pub async fn ai_delete_template(state: State<'_, AiAgentServiceState>, id: String) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.delete_template(&id))
}

#[tauri::command]
pub async fn ai_render_template(state: State<'_, AiAgentServiceState>, req: RenderTemplateRequest) -> Result<String, String> {
    let svc = state.lock().await;
    svc.render_template(req)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memory
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_add_memory(state: State<'_, AiAgentServiceState>, content: String, namespace: Option<String>) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.add_memory_entry(&content, namespace.as_deref(), HashMap::new()))
}

#[tauri::command]
pub async fn ai_search_memory(state: State<'_, AiAgentServiceState>, query: String, limit: Option<usize>) -> Result<Vec<MemoryEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.search_memory(&query, limit.unwrap_or(10)).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_list_memory(state: State<'_, AiAgentServiceState>, namespace: Option<String>) -> Result<Vec<MemoryEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.list_memory_entries(namespace.as_deref()).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_remove_memory(state: State<'_, AiAgentServiceState>, id: String) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.remove_memory_entry(&id))
}

#[tauri::command]
pub async fn ai_clear_memory(state: State<'_, AiAgentServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_memory();
    Ok(())
}

#[tauri::command]
pub async fn ai_get_memory_config(state: State<'_, AiAgentServiceState>) -> Result<MemoryConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_memory_config().clone())
}

#[tauri::command]
pub async fn ai_update_memory_config(state: State<'_, AiAgentServiceState>, config: MemoryConfig) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_memory_config(config);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Embeddings / Vectors
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_add_vector(state: State<'_, AiAgentServiceState>, text: String, embedding: Vec<f32>) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.add_vector(&text, embedding, HashMap::new()))
}

#[tauri::command]
pub async fn ai_search_vectors(state: State<'_, AiAgentServiceState>, query_embedding: Vec<f32>, top_k: Option<usize>, threshold: Option<f32>) -> Result<Vec<SimilarityResult>, String> {
    let svc = state.lock().await;
    Ok(svc.search_vectors(&query_embedding, top_k.unwrap_or(5), threshold.unwrap_or(0.7)))
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAG
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_ingest_document(state: State<'_, AiAgentServiceState>, req: IngestDocumentRequest) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.ingest_document(req)
}

#[tauri::command]
pub async fn ai_remove_document(state: State<'_, AiAgentServiceState>, doc_id: String) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.remove_document(&doc_id))
}

#[tauri::command]
pub async fn ai_search_rag(state: State<'_, AiAgentServiceState>, req: RagSearchRequest) -> Result<Vec<RagSearchResult>, String> {
    let svc = state.lock().await;
    Ok(svc.search_rag(&req))
}

#[tauri::command]
pub async fn ai_list_rag_collections(state: State<'_, AiAgentServiceState>) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.list_rag_collections())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workflows
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_create_workflow(
    state: State<'_, AiAgentServiceState>,
    name: String, description: String, steps: Vec<WorkflowStep>, tags: Vec<String>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.create_workflow(&name, &description, steps, tags))
}

#[tauri::command]
pub async fn ai_get_workflow(state: State<'_, AiAgentServiceState>, id: String) -> Result<WorkflowDefinition, String> {
    let svc = state.lock().await;
    svc.get_workflow(&id).cloned().ok_or_else(|| format!("Workflow {} not found", id))
}

#[tauri::command]
pub async fn ai_delete_workflow(state: State<'_, AiAgentServiceState>, id: String) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.delete_workflow(&id))
}

#[tauri::command]
pub async fn ai_list_workflows(state: State<'_, AiAgentServiceState>) -> Result<Vec<WorkflowDefinition>, String> {
    let svc = state.lock().await;
    Ok(svc.list_workflows().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_run_workflow(state: State<'_, AiAgentServiceState>, req: RunWorkflowRequest) -> Result<WorkflowRunResult, String> {
    let mut svc = state.lock().await;
    svc.run_workflow(req).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token Counting & Budget
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_count_tokens(state: State<'_, AiAgentServiceState>, text: String, model: String) -> Result<TokenCountResult, String> {
    let svc = state.lock().await;
    Ok(svc.count_tokens(&text, &model))
}

#[tauri::command]
pub async fn ai_get_budget_status(state: State<'_, AiAgentServiceState>) -> Result<BudgetStatus, String> {
    let svc = state.lock().await;
    Ok(svc.get_budget_status())
}

#[tauri::command]
pub async fn ai_update_budget(state: State<'_, AiAgentServiceState>, budget: BudgetConfig) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_budget(budget);
    Ok(())
}

#[tauri::command]
pub async fn ai_reset_budget(state: State<'_, AiAgentServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reset_budget_counters();
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ai_diagnostics(state: State<'_, AiAgentServiceState>) -> Result<AiDiagnosticsReport, String> {
    let svc = state.lock().await;
    Ok(svc.diagnostics().await)
}
