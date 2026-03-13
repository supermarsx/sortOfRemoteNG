//! Dynamically linked vendor dependencies for compression.
//!
//! Wraps zstd (C library via zstd-sys) and flate2 so downstream crates
//! don't recompile these on every change.

pub extern crate zstd;
pub extern crate flate2;
