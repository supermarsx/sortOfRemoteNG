//! VNC/RFB crate: sub-modules.

pub mod auth;
pub mod encoding;
pub mod protocol;
pub mod service;
pub mod session;
pub mod types;

// Re-export top-level items for convenience.
pub use service::{VncService, VncServiceState};
pub use types::*;
