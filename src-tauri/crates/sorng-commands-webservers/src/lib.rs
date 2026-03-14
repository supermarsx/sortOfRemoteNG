pub use sorng_lxd as lxd;
pub use sorng_vmware_desktop as vmware_desktop;
pub use sorng_nginx as nginx;
pub use sorng_traefik as traefik;
pub use sorng_haproxy as haproxy;
pub use sorng_apache as apache;
pub use sorng_caddy as caddy;
pub use sorng_nginx_proxy_mgr as nginx_proxy_mgr;
pub use sorng_ddns as ddns;

// Use #[path] to reference the command files in the ops crate
#[path = "../../sorng-commands-ops/src/lxd_commands.rs"]
mod lxd_commands;
#[path = "../../sorng-commands-ops/src/vmware_desktop_commands.rs"]
mod vmware_desktop_commands;
#[path = "../../sorng-commands-ops/src/nginx_commands.rs"]
mod nginx_commands;
#[path = "../../sorng-commands-ops/src/traefik_commands.rs"]
mod traefik_commands;
#[path = "../../sorng-commands-ops/src/haproxy_commands.rs"]
mod haproxy_commands;
#[path = "../../sorng-commands-ops/src/apache_commands.rs"]
mod apache_commands;
#[path = "../../sorng-commands-ops/src/caddy_commands.rs"]
mod caddy_commands;
#[path = "../../sorng-commands-ops/src/nginx_proxy_mgr_commands.rs"]
mod nginx_proxy_mgr_commands;
#[path = "../../sorng-commands-ops/src/ddns_commands.rs"]
mod ddns_commands;

mod webservers_handler;

pub fn is_command(command: &str) -> bool {
    webservers_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    webservers_handler::build()
}
