//! K1: the per-attempt interception CA (owner: x1).
//!
//! Each browser attempt gets a fresh in-memory ECDSA P-256 CA that only that
//! attempt's CEF context trusts (`CUSTOM_ONLY` anchor). The key is never
//! serialised, logged, written to disk or exposed through IPC, and it drops
//! with the session. Skeleton: generation is unavailable, so nothing admits.

use super::unavailable;
use crate::private_forward_proxy::Authority;
use std::io;
use std::sync::Arc;

/// Deliberately no `Debug`, `Clone` or serde: it will hold a private key.
pub struct InterceptAuthority {
    anchor_der: Vec<u8>,
}

impl InterceptAuthority {
    /// Mints a fresh CA for one attempt.
    pub fn generate() -> io::Result<Arc<Self>> {
        Err(unavailable())
    }

    /// DER of the CA certificate: the single trust anchor of the attempt's
    /// CEF context.
    pub fn anchor_der(&self) -> &[u8] {
        &self.anchor_der
    }

    /// True only for a leaf this authority minted for exactly `host:port`.
    pub fn admits_leaf(&self, host: &str, port: u16, leaf_der: &[u8]) -> bool {
        let _ = (host, port, leaf_der);
        false
    }

    /// Server config for one tunnel: leaf for `authority`, ALPN restricted to
    /// the client's offer intersected with `h2`/`http/1.1`.
    // Wired by x1 (accept.rs); unused until then.
    #[allow(dead_code)]
    pub(crate) fn server_config(
        &self,
        authority: &Authority,
        client_alpn: &[Vec<u8>],
    ) -> io::Result<Arc<rustls::ServerConfig>> {
        let _ = (authority, client_alpn);
        Err(unavailable())
    }
}
