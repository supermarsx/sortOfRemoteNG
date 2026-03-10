//! Telnet crate: sub-modules.

pub mod codec;
pub mod negotiation;
pub mod protocol;
pub mod service;
pub mod session;
pub mod types;

// Re-export top-level items for convenience.
pub use service::{TelnetService, TelnetServiceState};
pub use types::*;
