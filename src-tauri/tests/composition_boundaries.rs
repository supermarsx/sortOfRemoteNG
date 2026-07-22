//! Compile-time parity checks for the app's split composition crates.
//!
//! These checks make the public `app_lib` paths part of the test contract so
//! moving codegen out of the root crate cannot silently create duplicate API
//! types or bypass the operations state registrar.

use std::any::TypeId;

#[test]
fn app_api_reexports_are_the_dedicated_crate_types() {
    assert_eq!(
        TypeId::of::<app_lib::api::ApiService>(),
        TypeId::of::<sorng_app_api::api::ApiService>()
    );
    assert_eq!(
        TypeId::of::<app_lib::api::ApiState>(),
        TypeId::of::<sorng_app_api::api::ApiState>()
    );
    assert_eq!(
        TypeId::of::<app_lib::api_config::ApiRuntimeConfig>(),
        TypeId::of::<sorng_app_api::api_config::ApiRuntimeConfig>()
    );
}

#[test]
fn connectivity_startup_state_registrar_is_exported_by_its_crate() {
    let registrar: fn(
        &mut tauri::App<tauri::Wry>,
        std::sync::Arc<tokio::sync::Mutex<app_lib::ssh::SshService>>,
        sorng_core::events::DynEventEmitter,
    ) -> sorng_app_startup_connectivity::ApiHandles = sorng_app_startup_connectivity::register;
    assert_eq!(
        std::mem::size_of_val(&registrar),
        std::mem::size_of::<fn()>()
    );
    assert_eq!(
        sorng_app_startup_connectivity::MANAGED_STATE_REGISTRATIONS,
        40
    );
}

#[cfg(feature = "ops")]
#[test]
fn ops_startup_state_registrar_is_exported_by_the_domain_crate() {
    let registrar: fn(&mut tauri::App<tauri::Wry>, &std::path::Path) =
        sorng_app_domains::ops_startup_state::register;
    assert_eq!(
        std::mem::size_of_val(&registrar),
        std::mem::size_of::<fn()>()
    );
}
