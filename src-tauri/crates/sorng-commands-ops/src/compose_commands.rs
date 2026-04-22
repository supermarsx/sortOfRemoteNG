// t5-e3: include-wrapper for `sorng-docker-compose/src/commands.rs`.
//
// The embedded `commands.rs` uses `super::service::*` and `super::types::*`.
// We provide those as shim sub-modules re-exporting from the aliased crate
// `docker_compose_v2` (see `lib.rs`), then `include!` the source directly so
// each `#[tauri::command]` is type-checked in this crate's coherence domain.

mod service {
    pub use crate::docker_compose_v2::service::*;
}

mod types {
    pub use crate::docker_compose_v2::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-docker-compose/src/commands.rs");
}

pub(crate) use inner::*;
