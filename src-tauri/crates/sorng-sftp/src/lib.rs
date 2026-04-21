//! # SortOfRemote NG – SFTP
//!
//! Comprehensive SFTP file-transfer and remote filesystem management.

pub mod sftp;

/// Build a structured tracing span for an SFTP connection (t3-e23).
///
/// See `sorng_ssh::conn_span` for the convention.
#[inline]
pub fn conn_span(conn_id: &str) -> tracing::Span {
    tracing::info_span!(target: "sorng_sftp::conn", "conn", proto = "sftp", conn_id = %conn_id)
}
