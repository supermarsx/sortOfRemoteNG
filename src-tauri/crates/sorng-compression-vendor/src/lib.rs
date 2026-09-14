//! Grouped Rust vendor dependencies for compression.
//!
//! Re-exports zstd (native C via zstd-sys) and flate2 through an rlib. Cargo
//! already caches unchanged dependencies; the wrapper neither prevents ordinary
//! downstream recompilation nor changes the native libraries' linkage policy.

pub extern crate flate2;
pub extern crate zstd;
