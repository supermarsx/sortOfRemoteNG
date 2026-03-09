mod access;
mod cloud;
mod collab;
mod core;
mod infra;
mod mail;
mod ops;
mod platform;
mod services;
mod sessions;

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    let access_handler = access::build();
    let cloud_handler = cloud::build();
    let collab_handler = collab::build();
    let core_handler = core::build();
    let infra_handler = infra::build();
    let mail_handler = mail::build();
    let ops_handler = ops::build();
    let platform_handler = platform::build();
    let services_handler = services::build();
    let sessions_handler = sessions::build();

    move |invoke| {
        let command = invoke.message.command();
        if core::is_command(command) {
            core_handler(invoke)
        } else if cloud::is_command(command) {
            cloud_handler(invoke)
        } else if access::is_command(command) {
            access_handler(invoke)
        } else if sessions::is_command(command) {
            sessions_handler(invoke)
        } else if infra::is_command(command) {
            infra_handler(invoke)
        } else if collab::is_command(command) {
            collab_handler(invoke)
        } else if platform::is_command(command) {
            platform_handler(invoke)
        } else if services::is_command(command) {
            services_handler(invoke)
        } else if mail::is_command(command) {
            mail_handler(invoke)
        } else if ops::is_command(command) {
            ops_handler(invoke)
        } else {
            false
        }
    }
}
