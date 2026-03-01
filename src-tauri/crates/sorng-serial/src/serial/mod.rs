//! Serial crate: sub-modules.

pub mod types;
pub mod transport;
pub mod port_scanner;
pub mod session;
pub mod modem;
pub mod protocols;
pub mod logging;
pub mod service;
pub mod commands;

// Re-export top-level items for convenience.
pub use types::*;
pub use service::{SerialService, SerialServiceState};
pub use commands::*;
