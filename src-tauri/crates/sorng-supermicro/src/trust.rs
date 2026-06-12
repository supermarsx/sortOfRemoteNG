//! Trust Center store handle resolution for the legacy web TLS client.
//!
//! The legacy CGI web client (`legacy_web.rs`) used to call
//! `reqwest::ClientBuilder::danger_accept_invalid_certs(true)` unconditionally —
//! sending BMC credentials to a server whose certificate was never checked or
//! memorized. That blind skip is replaced by Trust-On-First-Use (TOFU) routed
//! through the backend Trust Center (see [`sorng_tls_trust`]).
//!
//! The rustls verifier needs a blocking handle to the persistent store
//! ([`sorng_storage::trust_store::SyncTrustStore`]), which is file-backed and
//! shares the same `trust_store.json` the async `TrustStoreService` (and the
//! Trust Center UI) uses. `LegacyWebClient::new` is built deep inside
//! `SmcClient::connect` with no access to Tauri app state, so the store path is
//! resolved here:
//!
//! 1. If the application explicitly installed a path via
//!    [`set_trust_store_path`] at startup (the clean wiring — the same
//!    `app_data_dir().join("trust_store.json")` passed to `TrustStoreService`),
//!    that path is used.
//! 2. Otherwise it falls back to the conventional location
//!    `<data_dir>/com.sortofremote.ng/trust_store.json`, which matches Tauri's
//!    `app_data_dir()` for this app's identifier on the common platforms. This
//!    keeps the sync façade coherent with the Trust Center even when the state
//!    layer has not (yet) called the setter.

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use sorng_storage::trust_store::SyncTrustStore;
use sorng_tls_trust::BlockingTrustStore;

/// Process-global override for the trust-store path. Set once by the app's
/// state layer at startup so the sync façade points at exactly the same
/// `trust_store.json` the async `TrustStoreService` was registered with.
static TRUST_STORE_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Tauri application identifier (mirrors `tauri.conf.json` `identifier`). Used
/// to reconstruct `app_data_dir()` when the app has not explicitly set a path.
const APP_IDENTIFIER: &str = "com.sortofremote.ng";

/// Install the canonical trust-store path. Call this once from the state layer
/// with the same path handed to `TrustStoreService::new`
/// (`app_data_dir().join("trust_store.json")`). Subsequent calls are ignored
/// (first writer wins), so the path stays stable for the process lifetime.
pub fn set_trust_store_path(path: impl Into<PathBuf>) {
    let _ = TRUST_STORE_PATH.set(path.into());
}

/// Resolve the path of the shared `trust_store.json`. Prefers an
/// explicitly-installed path; otherwise falls back to the conventional
/// app-data location for this app's identifier.
fn resolve_trust_store_path() -> PathBuf {
    if let Some(path) = TRUST_STORE_PATH.get() {
        return path.clone();
    }
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(APP_IDENTIFIER).join("trust_store.json")
}

/// Build the blocking Trust Center store handle the TOFU verifier consults.
/// Cheap (`Arc`-backed `SyncTrustStore`); re-reads the JSON file per operation
/// so it stays coherent with the async service.
pub fn trust_store_handle() -> Arc<dyn BlockingTrustStore> {
    Arc::new(SyncTrustStore::new(resolve_trust_store_path()))
}
