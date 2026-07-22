//! Connectivity-domain Tauri startup registration.
//!
//! This crate owns the connectivity `App::manage<T>` instantiations so the
//! root app composition crate only orchestrates already-code-generated domain
//! registrars.

pub use sorng_app_domains::*;

#[path = "../../../src/state_registry/connectivity.rs"]
mod registration;

pub use registration::{register, ApiHandles, MANAGED_STATE_REGISTRATIONS};
