// t5-e3: adapter for the `sorng-docker-compose` command wrappers in `inner.rs`.
//
// The wrappers use `super::service::*` and `super::types::*`.
// We provide those as shim sub-modules re-exporting from the aliased crate
// `docker_compose_v2` (see `lib.rs`), so each `#[tauri::command]` is
// type-checked in this crate's coherence domain.

mod service {
    pub use crate::docker_compose_v2::service::*;
}

mod types {
    pub use crate::docker_compose_v2::types::*;
}

#[allow(dead_code)]
mod inner;

pub(crate) use inner::*;
