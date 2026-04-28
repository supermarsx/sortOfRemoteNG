//! Dynamically linked vendor dependencies for the RDP stack.
//!
//! This crate is built as a `dylib` (.dll / .so) so the heavy ironrdp
//! ecosystem is compiled once and linked dynamically.  Downstream crates
//! (sorng-rdp) access these deps through `pub extern crate` re-exports
//! without recompiling them on every change.

pub extern crate ironrdp;
pub extern crate ironrdp_blocking;
pub extern crate ironrdp_cliprdr;
pub extern crate ironrdp_cliprdr_native;
pub extern crate ironrdp_core;
pub extern crate ironrdp_dvc;
pub extern crate ironrdp_svc;
pub use ironrdp::displaycontrol as ironrdp_displaycontrol;

pub mod yuv_convert;

#[cfg(feature = "software-decode")]
pub extern crate openh264;
