//! # SortOfRemote NG – SSH
//!
//! SSH connectivity, SSH3 (HTTP/3 QUIC), and script execution services.

#[cfg(feature = "script-engine")]
pub mod script;
#[cfg(not(feature = "script-engine"))]
#[path = "script_stub.rs"]
pub mod script;
pub mod ssh;
pub mod ssh3;
