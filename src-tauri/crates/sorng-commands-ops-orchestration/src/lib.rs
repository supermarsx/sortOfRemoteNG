pub use sorng_ceph as ceph;
pub use sorng_cicd as cicd;
pub use sorng_consul as consul;
// t5-e3: `sorng-docker-compose` (`compose_*` commands: parser, graph,
// profiles, templates, lifecycle). Aliased as `docker_compose_v2` to
// disambiguate from the `docker_compose_*` entries that belong to
// `sorng-docker` and live in `sorng-commands-platform`.
pub use sorng_docker_compose as docker_compose_v2;
pub use sorng_etcd as etcd;

mod ceph_commands;
mod cicd_commands;
mod compose_commands;
mod consul_commands;
mod etcd_commands;
mod handler;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
