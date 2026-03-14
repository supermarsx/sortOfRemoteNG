pub use sorng_hyperv as hyperv;
pub use sorng_idrac as idrac;
pub use sorng_ilo as ilo;
pub use sorng_lenovo as lenovo;
pub use sorng_meshcentral::meshcentral as meshcentral_dedicated;
pub use sorng_proxmox as proxmox;
pub use sorng_supermicro as supermicro;
pub use sorng_synology as synology;
pub use sorng_vmware as vmware;

// Use #[path] to reference the command files in the ops crate
#[path = "../../sorng-commands-ops/src/hyperv_commands.rs"]
mod hyperv_commands;
#[path = "../../sorng-commands-ops/src/idrac_commands.rs"]
mod idrac_commands;
#[path = "../../sorng-commands-ops/src/ilo_commands.rs"]
mod ilo_commands;
#[path = "../../sorng-commands-ops/src/lenovo_commands.rs"]
mod lenovo_commands;
#[path = "../../sorng-commands-ops/src/meshcentral_dedicated_commands.rs"]
mod meshcentral_dedicated_commands;
#[path = "../../sorng-commands-ops/src/proxmox_commands.rs"]
mod proxmox_commands;
#[path = "../../sorng-commands-ops/src/supermicro_commands.rs"]
mod supermicro_commands;
#[path = "../../sorng-commands-ops/src/synology_commands.rs"]
mod synology_commands;
#[path = "../../sorng-commands-ops/src/vmware_commands.rs"]
mod vmware_commands;

mod infra_handler;

pub fn is_command(command: &str) -> bool {
    infra_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    infra_handler::build()
}
