//! K3: the proxy HTTP cache (owner: x3).
//!
//! Private browser cache (RFC 9111 via `http-cache-semantics`), per
//! (database, connection), encrypted at rest. x3 declares its submodules here:
//! `store`, `policy`, `crypto`, `memory`.

use std::path::PathBuf;
use zeroize::Zeroizing;

/// Disk cache for one connection. No `Debug`/`Clone`: it carries the key.
pub struct DiskCacheConfig {
    /// `<connKey>/proxy-v1/` under the c3 lease.
    pub directory: PathBuf,
    pub max_bytes: u64,
    /// Per-connection cache master key (HKDF from the vault DEK).
    pub key: Zeroizing<[u8; 32]>,
    /// c3 `binding.v1` digest; a mismatch wipes the store.
    pub binding: [u8; 32],
}

pub enum CacheMode {
    Off,
    Memory { max_bytes: u64 },
    Disk(DiskCacheConfig),
}
