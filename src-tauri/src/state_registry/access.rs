use super::*;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>) {
    // ── AI Agent service ─────────────────────────────────────────────
    // e01 wired sorng-ai-agent to dispatch through its own LlmProvider
    // implementations (openai/anthropic/gemini/ollama/…) via
    // `providers::create_provider` — no Tauri-state plumbing changes were
    // required. e21 bootstraps an optional default provider from env
    // (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) so `ai_chat_completion` /
    // `ai_run_agent` / `ai_code_assist` work out-of-the-box when a key is
    // set. If neither env var is present, the service starts empty and we
    // log an actionable warning — the user can still register a provider
    // at runtime via the `ai_add_provider` command from the UI/REST API.
    let mut ai_service = ai_agent::service::AiAgentService::new();
    bootstrap_default_ai_provider(&mut ai_service);
    let ai_agent_service: AiAgentServiceState = Arc::new(Mutex::new(ai_service));
    app.manage(ai_agent_service);

    let onepassword_service: OnePasswordServiceState =
        Arc::new(Mutex::new(onepassword::service::OnePasswordService::new()));
    app.manage(onepassword_service);

    let lastpass_service: LastPassServiceState =
        Arc::new(Mutex::new(lastpass::service::LastPassService::new()));
    app.manage(lastpass_service);

    let google_passwords_service: GooglePasswordsServiceState = Arc::new(Mutex::new(
        google_passwords::service::GooglePasswordsService::new(),
    ));
    app.manage(google_passwords_service);

    let dashlane_service: DashlaneServiceState =
        Arc::new(Mutex::new(dashlane::service::DashlaneService::new()));
    app.manage(dashlane_service);
}

/// Seed the AI Agent service with a default provider if the user has exported
/// an API-key env var. Picks Anthropic first (`ANTHROPIC_API_KEY`), then OpenAI
/// (`OPENAI_API_KEY`). When a provider is registered, `default_provider_id` is
/// also set so `ai_run_agent` / `ai_code_assist` work without further
/// configuration. When neither is set, the service stays empty and we log a
/// warning; the user can still add a provider at runtime via `ai_add_provider`.
fn bootstrap_default_ai_provider(service: &mut ai_agent::service::AiAgentService) {
    use ai_agent::types::{AiProvider, ProviderConfig};
    use std::collections::HashMap;

    fn build_config(provider: AiProvider, api_key: String) -> ProviderConfig {
        ProviderConfig {
            provider,
            api_key: Some(api_key),
            base_url: None,
            deployment_id: None,
            api_version: None,
            organization: None,
            extra_headers: HashMap::new(),
            // Match the `default_*` helpers in
            // `sorng-ai-agent/src/ai_agent/types.rs` so behaviour is identical
            // to a serde-deserialised config with only `provider` + `apiKey` set.
            timeout_secs: 120,
            max_retries: 3,
            retry_delay_ms: 1000,
            ollama_port: 11434,
        }
    }

    let (provider_id, config) = if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.trim().is_empty() {
            (
                "env-anthropic".to_string(),
                build_config(AiProvider::Anthropic, key),
            )
        } else {
            log::warn!(
                "AI Agent: ANTHROPIC_API_KEY is set but empty. No default provider registered; \
                 call `ai_add_provider` from the UI or set a non-empty key."
            );
            return;
        }
    } else if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.trim().is_empty() {
            (
                "env-openai".to_string(),
                build_config(AiProvider::OpenAi, key),
            )
        } else {
            log::warn!(
                "AI Agent: OPENAI_API_KEY is set but empty. No default provider registered; \
                 call `ai_add_provider` from the UI or set a non-empty key."
            );
            return;
        }
    } else {
        log::warn!(
            "AI Agent: no provider API key found in environment \
             (ANTHROPIC_API_KEY / OPENAI_API_KEY). Service started with zero providers; \
             `ai_chat_completion` / `ai_run_agent` / `ai_code_assist` will fail until the \
             user calls `ai_add_provider` (UI: Settings → AI Agent)."
        );
        return;
    };

    service.add_provider(&provider_id, config);

    // Set as the default so callers that don't pass a provider_id get this one.
    let mut settings = service.get_settings();
    if settings.default_provider_id.is_none() {
        settings.default_provider_id = Some(provider_id.clone());
        service.update_settings(settings);
    }
    log::info!(
        "AI Agent: registered default provider `{}` from environment",
        provider_id
    );
}
