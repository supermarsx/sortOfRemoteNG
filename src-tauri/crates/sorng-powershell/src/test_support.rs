//! Explicit dependency-injection handles for deterministic crate tests.
//!
//! These handles are intentionally excluded from the public documentation and
//! are not used by normal application constructors.

use std::fmt;
use std::sync::Arc;

use sorng_storage::trust_store::SyncTrustStore;

/// Isolated Trust Center handle for local WinRM TLS contract tests.
///
/// This token only selects the backing store. It cannot change the effective
/// TLS policy, enable skip flags, or replace signature verification.
#[doc(hidden)]
#[derive(Clone)]
pub struct WinRmTestTrust {
    pub(crate) store: Arc<SyncTrustStore>,
}

impl WinRmTestTrust {
    /// Wrap an explicitly provisioned test trust store.
    #[doc(hidden)]
    #[must_use]
    pub fn new(store: Arc<SyncTrustStore>) -> Self {
        Self { store }
    }
}

impl fmt::Debug for WinRmTestTrust {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WinRmTestTrust")
            .field("store", &"[isolated trust store]")
            .finish()
    }
}
