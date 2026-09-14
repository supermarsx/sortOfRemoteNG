// Compatibility facade: each registrar is compiled in its own bounded crate.
pub use sorng_commands_bmc::{idrac, ilo, lenovo, supermicro};
pub use sorng_commands_nas::synology;
pub use sorng_commands_proxmox::proxmox;
pub use sorng_commands_remote::{meshcentral_dedicated, voip_phone};
pub use sorng_commands_virtualization::{hyperv, vmware};

mod infra_handler;

pub fn is_command(command: &str) -> bool {
    infra_handler::is_command(command)
}

pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    infra_handler::build()
}
