//! Serial crate: sub-modules.

pub mod commands;
pub mod logging;
pub mod modem;
pub mod native_transport;
pub mod port_scanner;
pub mod protocols;
pub mod service;
pub mod session;
pub mod transport;
pub mod types;

// Re-export top-level items for convenience.
pub use commands::*;
pub use native_transport::NativeTransport;
pub use service::{SerialService, SerialServiceState};
pub use types::*;
