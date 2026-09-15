// Compatibility facade: each registrar is compiled in its own bounded crate.
pub use sorng_commands_ops_databases::{mysql_admin, pg_admin};
pub use sorng_commands_ops_identity::{freeipa, hashicorp_vault, mac_mgmt, pam};
#[cfg(feature = "kafka")]
pub use sorng_commands_ops_messaging::kafka;
pub use sorng_commands_ops_messaging::rabbitmq;
pub use sorng_commands_ops_monitoring::{grafana, ipmi, prometheus, ups_mgmt, zabbix};
pub use sorng_commands_ops_network::{draytek, fail2ban, pfsense, port_knock};
pub use sorng_commands_ops_orchestration::{ceph, cicd, consul, docker_compose_v2, etcd};
pub use sorng_commands_ops_platform::{about, cups, netbox, remote_backup};
pub use sorng_commands_ops_system::{
    bootloader, cron, kernel_mgmt, os_detect, proc_mgmt, time_ntp,
};
pub use sorng_commands_ops_web::{cpanel, php_mgmt};

mod ops_handler;

pub fn is_command(command: &str) -> bool {
    ops_handler::is_command(command)
}

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    ops_handler::build()
}
