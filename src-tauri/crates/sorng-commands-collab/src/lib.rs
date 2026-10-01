pub use sorng_app_domains::*;
// These shims compile in collab-only builds too; do not rely on the app's
// optional platform feature to make their backends available via glob exports.
pub use sorng_mremoteng::mremoteng as mremoteng_dedicated;
pub use sorng_termserv as termserv;

mod dropbox_commands;
mod cloud_sync_commands;
mod gdrive_commands;
mod mremoteng_dedicated_commands;
mod nextcloud_commands;
mod onedrive_commands;
mod termserv_commands;
mod whatsapp_commands;

mod collab_handler;

pub fn is_command(command: &str) -> bool {
    collab_handler::is_command(command)
}

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(collab_handler::build())
}

#[cfg(test)]
mod tests {
    #[test]
    fn standalone_collab_keeps_backend_types_and_commands_available() {
        let _: Option<crate::mremoteng_dedicated::service::MremotengServiceState> = None;
        let _: Option<crate::termserv::service::TermServServiceState> = None;
        for command in [
            "mrng_detect_format",
            "ts_list_open_servers",
            "cloud_sync_read",
            "cloud_sync_write",
            "cloud_sync_test",
        ] {
            assert!(super::is_command(command), "missing collab command: {command}");
        }
    }
}
