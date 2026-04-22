pub use sorng_about as about;
pub use sorng_bootloader as bootloader;
pub use sorng_ceph as ceph;
pub use sorng_cicd as cicd;
pub use sorng_consul as consul;
pub use sorng_cpanel as cpanel;
pub use sorng_cron as cron;
pub use sorng_cups as cups;
pub use sorng_fail2ban as fail2ban;
pub use sorng_freeipa as freeipa;
pub use sorng_grafana as grafana;
pub use sorng_hashicorp_vault as hashicorp_vault;
pub use sorng_ipmi as ipmi;
pub use sorng_kernel as kernel_mgmt;
pub use sorng_mac as mac_mgmt;
pub use sorng_mysql_admin as mysql_admin;
pub use sorng_netbox as netbox;
pub use sorng_os_detect as os_detect;
pub use sorng_pam as pam;
pub use sorng_pfsense as pfsense;
pub use sorng_postgres_admin as pg_admin;
pub use sorng_php as php_mgmt;
pub use sorng_port_knock as port_knock;
pub use sorng_proc as proc_mgmt;
pub use sorng_prometheus as prometheus;
pub use sorng_rabbitmq as rabbitmq;
pub use sorng_time_ntp as time_ntp;
pub use sorng_ups as ups_mgmt;
pub use sorng_zabbix as zabbix;

mod about_commands;
mod bootloader_commands;
mod ceph_commands;
mod cicd_commands;
#[path = "../../../src/consul_commands.rs"]
mod consul_commands;
mod cpanel_commands;
mod cron_commands;
mod cups_commands;
mod fail2ban_commands;
mod freeipa_commands;
mod grafana_commands;
mod hashicorp_vault_commands;
mod ipmi_commands;
mod kernel_mgmt_commands;
#[path = "../../../src/mac_mgmt_commands.rs"]
mod mac_mgmt_commands;
mod mysql_admin_commands;
mod netbox_commands;
mod os_detect_commands;
mod pam_commands;
mod pfsense_commands;
mod pg_admin_commands;
mod php_mgmt_commands;
mod port_knock_commands;
mod proc_mgmt_commands;
mod prometheus_commands;
mod rabbitmq_commands;
mod time_ntp_commands;
mod ups_mgmt_commands;
mod zabbix_commands;

mod ops_handler;

pub fn is_command(command: &str) -> bool {
    ops_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    ops_handler::build()
}
