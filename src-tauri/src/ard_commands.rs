// Wrapper for sorng-ard Tauri commands. Mirrors the pattern used by
// `spice_commands.rs` / `nx_commands.rs` / `x2go_commands.rs` /
// `xdmcp_commands.rs` — include the crate-level `commands.rs` via
// `include!` and alias the modules it references (`super::service`,
// `super::types`, `super::session_runner`, `super::ArdServiceState`).

mod service {
    pub use crate::ard::service::*;
}

mod types {
    pub use crate::ard::types::*;
}

mod session_runner {
    pub use crate::ard::session_runner::*;
}

// The include!d commands.rs references `super::ArdServiceState` directly
// (not via `service::`). Bring it into scope at this module level so
// `super::ArdServiceState` resolves from inside `mod inner`.
#[allow(unused_imports)]
pub use crate::ard::ArdServiceState;

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-ard/src/ard/commands.rs");
}

pub(crate) use inner::*;
