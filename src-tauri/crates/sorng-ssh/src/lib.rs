//! # SortOfRemote NG – SSH
//!
//! SSH connectivity, SSH3 (HTTP/3 QUIC), and script execution services.

/// Build a structured tracing span for an SSH connection (t3-e23).
///
/// Attach this at connection entry points so every log event emitted
/// within carries a `conn_id` field for correlation across the stack.
///
/// ```ignore
/// let _g = sorng_ssh::conn_span("ssh-42").entered();
/// tracing::info!("connecting");
/// ```
#[inline]
pub fn conn_span(conn_id: &str) -> tracing::Span {
    tracing::info_span!(target: "sorng_ssh::conn", "conn", proto = "ssh", conn_id = %conn_id)
}

#[cfg(feature = "script-engine")]
pub mod script;
#[cfg(not(feature = "script-engine"))]
#[path = "script_stub.rs"]
pub mod script;
pub mod ssh;
pub mod ssh3;
