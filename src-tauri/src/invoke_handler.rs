pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    // Always-on command crates
    let core_handler = sorng_commands_core::build();
    let sessions_handler = sorng_commands_sessions::build();
    let access_handler = sorng_commands_access::build();

    // Feature-gated command crates — compiled in separate coherence domains
    // to reduce type-check time in the app crate.
    #[cfg(feature = "cloud")]
    let cloud_handler = sorng_commands_cloud::build();
    #[cfg(any(feature = "collab", feature = "platform"))]
    let collab_handler = sorng_commands_collab::build();
    #[cfg(feature = "platform")]
    let platform_handler = sorng_commands_platform::build();
    #[cfg(feature = "ops")]
    let ops_handler = sorng_commands_ops::build();
    #[cfg(feature = "ops")]
    let infra_handler = sorng_commands_infra::build();
    #[cfg(feature = "ops")]
    let mail_handler = sorng_commands_mail::build();
    #[cfg(feature = "ops")]
    let services_handler = sorng_commands_services::build();
    #[cfg(feature = "ops")]
    let tools_handler = sorng_commands_tools::build();
    #[cfg(feature = "ops")]
    let webservers_handler = sorng_commands_webservers::build();

    move |invoke| {
        let command = invoke.message.command();
        if sorng_commands_core::is_command(command) {
            return core_handler(invoke);
        }

        if sorng_commands_access::is_command(command) {
            return access_handler(invoke);
        }

        if sorng_commands_sessions::is_command(command) {
            return sessions_handler(invoke);
        }

        #[cfg(feature = "cloud")]
        if sorng_commands_cloud::is_command(command) {
            return cloud_handler(invoke);
        }

        #[cfg(any(feature = "collab", feature = "platform"))]
        if sorng_commands_collab::is_command(command) {
            return collab_handler(invoke);
        }

        #[cfg(feature = "platform")]
        if sorng_commands_platform::is_command(command) {
            return platform_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if sorng_commands_ops::is_command(command) {
            return ops_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if sorng_commands_infra::is_command(command) {
            return infra_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if sorng_commands_mail::is_command(command) {
            return mail_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if sorng_commands_services::is_command(command) {
            return services_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if sorng_commands_tools::is_command(command) {
            return tools_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if sorng_commands_webservers::is_command(command) {
            return webservers_handler(invoke);
        }

        false
    }
}
