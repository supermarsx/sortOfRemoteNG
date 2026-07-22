//! Grouped vendor dependencies for the RDP stack.
//!
//! This crate keeps the heavy IronRDP ecosystem behind one first-party crate
//! boundary. Downstream crates (`sorng-rdp`) access these dependencies through
//! `pub extern crate` re-exports. The crate intentionally emits only an `rlib`:
//! application executables already selected that form, while the unused Rust
//! dylib exceeded MSVC's import-library member limit in release builds.

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
