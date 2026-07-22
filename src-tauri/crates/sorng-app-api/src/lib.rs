//! External REST API composition boundary.
//!
//! Keeping the Axum router and its handlers in a dedicated crate prevents the
//! application's Tauri composition crate from code-generating every Axum
//! handler and route monomorphization in the same LLVM unit as startup state.

// The shared source files remain beside the app integration sources so the
// existing path-included command-crate pattern and ownership remain obvious.
// They are compiled here (and no longer by `app_lib`). Re-exporting the domain
// facade preserves the `crate::<domain>` paths used by the router.
pub use sorng_app_domains::*;

#[path = "../../../src/api.rs"]
pub mod api;
#[path = "../../../src/api_capability.rs"]
pub mod api_capability;
#[path = "../../../src/api_config.rs"]
pub mod api_config;
