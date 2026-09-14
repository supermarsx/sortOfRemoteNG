//! Grouped Rust vendor dependencies for the AWS stack.
//!
//! This rlib re-exports the XML parser and signing primitives used by consumers.
//! Cargo already caches unchanged dependencies; this wrapper does not prevent
//! ordinary downstream recompilation or establish a runtime DLL boundary.

pub extern crate hex;
pub extern crate hmac;
pub extern crate percent_encoding;
pub extern crate quick_xml;
pub extern crate sha2;
