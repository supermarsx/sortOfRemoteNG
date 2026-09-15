pub use sorng_grafana as grafana;
pub use sorng_ipmi as ipmi;
pub use sorng_prometheus as prometheus;
pub use sorng_ups as ups_mgmt;
pub use sorng_zabbix as zabbix;

mod grafana_commands;
mod handler;
mod ipmi_commands;
mod prometheus_commands;
mod ups_mgmt_commands;
mod zabbix_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
