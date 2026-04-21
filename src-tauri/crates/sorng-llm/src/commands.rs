use tauri::State;

use super::config::*;
use super::error::LlmError;
use super::service::LlmServiceState;
use super::types::*;

type Res<T> = Result<T, LlmError>;

// ── Provider Management ────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_add_provider(
    state: State<'_, LlmServiceState>,
    config: ProviderConfig,
) -> Res<()> {
    let mut svc = state.0.write().await;
    svc.add_provider(config)
}

#[tauri::command]
pub async fn llm_remove_provider(
    state: State<'_, LlmServiceState>,
    provider_id: String,
) -> Res<bool> {
    let mut svc = state.0.write().await;
    Ok(svc.remove_provider(&provider_id))
}

#[tauri::command]
pub async fn llm_update_provider(
    state: State<'_, LlmServiceState>,
    config: ProviderConfig,
) -> Res<()> {
    let mut svc = state.0.write().await;
    svc.update_provider(config)
}

#[tauri::command]
pub async fn llm_list_providers(state: State<'_, LlmServiceState>) -> Res<Vec<ProviderConfig>> {
    let svc = state.0.read().await;
    Ok(svc.list_providers())
}

#[tauri::command]
pub async fn llm_set_default_provider(
    state: State<'_, LlmServiceState>,
    provider_id: String,
) -> Res<()> {
    let mut svc = state.0.write().await;
    svc.set_default_provider(&provider_id)
}

// ── Chat Completion ────────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_chat_completion(
    state: State<'_, LlmServiceState>,
    request: ChatCompletionRequest,
) -> Res<ChatCompletionResponse> {
    let mut svc = state.0.write().await;
    svc.chat_completion(request).await
}

// ── Embeddings ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_create_embedding(
    state: State<'_, LlmServiceState>,
    request: EmbeddingRequest,
) -> Res<EmbeddingResponse> {
    let svc = state.0.read().await;
    svc.create_embedding(request).await
}

// ── Model Catalog ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_list_models(state: State<'_, LlmServiceState>) -> Res<Vec<ModelInfo>> {
    let svc = state.0.read().await;
    Ok(svc.list_models().to_vec())
}

#[tauri::command]
pub async fn llm_models_for_provider(
    state: State<'_, LlmServiceState>,
    provider: String,
) -> Res<Vec<ModelInfo>> {
    let svc = state.0.read().await;
    Ok(svc
        .models_for_provider(&provider)
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn llm_model_info(
    state: State<'_, LlmServiceState>,
    model_id: String,
) -> Res<Option<ModelInfo>> {
    let svc = state.0.read().await;
    Ok(svc.model_info(&model_id).cloned())
}

// ── Health ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_health_check(
    state: State<'_, LlmServiceState>,
    provider_id: String,
) -> Res<ProviderHealth> {
    let svc = state.0.read().await;
    svc.health_check(&provider_id).await
}

#[tauri::command]
pub async fn llm_health_check_all(state: State<'_, LlmServiceState>) -> Res<Vec<ProviderHealth>> {
    let svc = state.0.read().await;
    Ok(svc.health_check_all().await)
}

// ── Usage & Stats ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_usage_summary(
    state: State<'_, LlmServiceState>,
    days: Option<u32>,
) -> Res<super::usage::UsageSummary> {
    let svc = state.0.read().await;
    Ok(svc.usage_summary(days))
}

#[tauri::command]
pub async fn llm_cache_stats(state: State<'_, LlmServiceState>) -> Res<super::cache::CacheStats> {
    let svc = state.0.read().await;
    Ok(svc.cache_stats())
}

#[tauri::command]
pub async fn llm_clear_cache(state: State<'_, LlmServiceState>) -> Res<()> {
    let mut svc = state.0.write().await;
    svc.clear_cache();
    Ok(())
}

#[tauri::command]
pub async fn llm_status(state: State<'_, LlmServiceState>) -> Res<LlmStatus> {
    let svc = state.0.read().await;
    Ok(svc.status())
}

// ── Config ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_get_config(state: State<'_, LlmServiceState>) -> Res<LlmConfig> {
    let svc = state.0.read().await;
    Ok(svc.config().clone())
}

#[tauri::command]
pub async fn llm_update_config(state: State<'_, LlmServiceState>, config: LlmConfig) -> Res<()> {
    let mut svc = state.0.write().await;
    svc.update_config(config);
    Ok(())
}

#[tauri::command]
pub async fn llm_set_balancer_strategy(
    state: State<'_, LlmServiceState>,
    strategy: BalancerStrategy,
) -> Res<()> {
    let mut svc = state.0.write().await;
    svc.set_balancer_strategy(strategy);
    Ok(())
}

// ── Token Estimation ───────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_estimate_tokens(text: String, model: Option<String>) -> Res<u32> {
    let count = if let Some(ref m) = model {
        super::tokens::TokenCounter::estimate_for_model(&text, m)
    } else {
        super::tokens::TokenCounter::estimate(&text)
    };
    Ok(count)
}
