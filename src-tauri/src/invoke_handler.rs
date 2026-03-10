mod access;
#[cfg(feature = "cloud")]
mod cloud;
#[cfg(any(feature = "collab", feature = "platform"))]
mod collab;
mod core;
#[cfg(feature = "ops")]
mod infra;
#[cfg(feature = "ops")]
mod mail;
#[cfg(feature = "ops")]
mod ops;
#[cfg(feature = "platform")]
mod platform;
#[cfg(feature = "ops")]
mod services;
mod sessions;

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    let access_handler = access::build();
    let core_handler = core::build();
    let sessions_handler = sessions::build();
    #[cfg(feature = "cloud")]
    let cloud_handler = cloud::build();
    #[cfg(any(feature = "collab", feature = "platform"))]
    let collab_handler = collab::build();
    #[cfg(feature = "ops")]
    let infra_handler = infra::build();
    #[cfg(feature = "ops")]
    let mail_handler = mail::build();
    #[cfg(feature = "ops")]
    let ops_handler = ops::build();
    #[cfg(feature = "platform")]
    let platform_handler = platform::build();
    #[cfg(feature = "ops")]
    let services_handler = services::build();

    move |invoke| {
        let command = invoke.message.command();
        if core::is_command(command) {
            return core_handler(invoke);
        }

        #[cfg(feature = "cloud")]
        if cloud::is_command(command) {
            return cloud_handler(invoke);
        }

        if access::is_command(command) {
            return access_handler(invoke);
        }

        if sessions::is_command(command) {
            return sessions_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if infra::is_command(command) {
            return infra_handler(invoke);
        }

        #[cfg(any(feature = "collab", feature = "platform"))]
        if collab::is_command(command) {
            return collab_handler(invoke);
        }

        #[cfg(feature = "platform")]
        if platform::is_command(command) {
            return platform_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if services::is_command(command) {
            return services_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if mail::is_command(command) {
            return mail_handler(invoke);
        }

        #[cfg(feature = "ops")]
        if ops::is_command(command) {
            return ops_handler(invoke);
        }

        false
    }
}
