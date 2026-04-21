//! # SortOfRemote NG – VNC
//!
//! VNC / RFB protocol client.

pub mod vnc;

/// Build a structured tracing span for a VNC connection (t3-e23).
#[inline]
pub fn conn_span(conn_id: &str) -> tracing::Span {
    tracing::info_span!(target: "sorng_vnc::conn", "conn", proto = "vnc", conn_id = %conn_id)
}
