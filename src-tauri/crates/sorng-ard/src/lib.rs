//! # sorng-ard
//!
//! Apple Remote Desktop (ARD) protocol crate for SortOfRemoteNG.
//!
//! Implements the ARD protocol (built on RFB/VNC with Apple extensions)
//! including DH+AES authentication, framebuffer encodings, clipboard,
//! file transfer, curtain mode, and retina display support.

pub mod ard;

pub use ard::commands::*;
pub use ard::diagnostics::*;
pub use ard::ArdServiceState;
