use super::*;

pub(super) fn register(app: &mut tauri::App<tauri::Wry>) {
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
    let mut settings = service.get_settings();
    if settings.default_provider_id.is_none() {
        settings.default_provider_id = Some(provider_id.clone());
        service.update_settings(settings);
    }
    log::info!("AI Agent: registered default provider `{provider_id}` from environment");
}
