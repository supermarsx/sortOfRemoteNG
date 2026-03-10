mod access;
mod core;
#[cfg(feature = "cloud")]
mod cloud;
#[cfg(any(feature = "collab", feature = "platform"))]
mod collab;
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
            core_handler(invoke)
        }
        #[cfg(feature = "cloud")]
        else if cloud::is_command(command) {
            cloud_handler(invoke)
        }
        else if access::is_command(command) {
            access_handler(invoke)
        } else if sessions::is_command(command) {
            sessions_handler(invoke)
        }
        #[cfg(feature = "ops")]
        else if infra::is_command(command) {
            infra_handler(invoke)
        }
        #[cfg(any(feature = "collab", feature = "platform"))]
        else if collab::is_command(command) {
            collab_handler(invoke)
        }
        #[cfg(feature = "platform")]
        else if platform::is_command(command) {
            platform_handler(invoke)
        }
        #[cfg(feature = "ops")]
        else if services::is_command(command) {
            services_handler(invoke)
        }
        #[cfg(feature = "ops")]
        else if mail::is_command(command) {
            mail_handler(invoke)
        }
        #[cfg(feature = "ops")]
        else if ops::is_command(command) {
            ops_handler(invoke)
        } else {
            false
        }
    }
}
