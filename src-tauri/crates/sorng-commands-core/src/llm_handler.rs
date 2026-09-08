//! Always-on, bounded LLM settings/router command group.
//!
//! One list defines both the dispatch predicate and generated IPC handler.
//! Keeping it generic lets startup tests exercise the real commands using
//! Tauri's mock runtime without a real WebView, network request or vault access.

macro_rules! define_llm_commands {
    ($($command:ident),+ $(,)?) => {
        pub const COMMAND_NAMES: &[&str] = &[$(stringify!($command)),+];

        pub fn is_command(command: &str) -> bool {
            matches!(command, $(stringify!($command))|+)
        }

        pub fn build<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$(crate::llm_commands::$command),+]
        }
    };
}

define_llm_commands!(
    llm_add_provider,
    llm_remove_provider,
    llm_update_provider,
    llm_list_providers,
    llm_set_default_provider,
    llm_chat_completion,
    llm_create_embedding,
    llm_list_models,
    llm_models_for_provider,
    llm_model_info,
    llm_health_check,
    llm_health_check_all,
    llm_usage_summary,
    llm_cache_stats,
    llm_clear_cache,
    llm_status,
    llm_get_config,
    llm_update_config,
    llm_set_balancer_strategy,
    llm_estimate_tokens,
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_frontend_llm_command_is_owned_by_the_always_on_group() {
        let frontend = include_str!("../../../../src/hooks/integration/useLlm.ts");
        let platform = include_str!("../../sorng-commands-platform/src/platform_handler.rs");
        let commands: std::collections::HashSet<_> = frontend
            .split('"')
            .filter(|part| part.starts_with("llm_") && !part.contains(char::is_whitespace))
            .collect();
        assert_eq!(commands.len(), 20);
        assert_eq!(commands, COMMAND_NAMES.iter().copied().collect());
        for command in COMMAND_NAMES {
            assert!(
                crate::is_command(command),
                "{command} missing from core routing"
            );
            assert!(is_command(command));
            assert!(!platform.contains(&format!("\"{command}\"")));
            assert!(!platform.contains(&format!("llm_commands::{command},")));
        }
        assert!(!is_command("llm_unknown"));
        assert!(!is_command("ai_assist_create_session"));
    }
}
