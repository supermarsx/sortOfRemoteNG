//! VNC/RFB crate: sub-modules.

pub mod types;
pub mod protocol;
pub mod encoding;
pub mod auth;
pub mod session;
pub mod service;
pub mod commands;

// Re-export top-level items for convenience.
pub use types::*;
pub use service::{VncService, VncServiceState};
pub use commands::*;
