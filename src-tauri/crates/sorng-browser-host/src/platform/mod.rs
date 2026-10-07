//! Native child-window integration. Parent handles must come from the trusted
//! app window, never remote-page messages or renderer-supplied integers.

pub use crate::bootstrap_platform as bootstrap;

#[cfg(all(test, target_os = "macos"))]
pub(crate) mod test_runtime;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
