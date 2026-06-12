//! Trust Center (TOFU) plumbing for the WMI/WinRM HTTPS transport.
//!
//! Historically this crate built its `reqwest` client with
//! `danger_accept_invalid_certs(true)` whenever the connection requested
//! `skip_ca_check` or `skip_cn_check` — sending Basic-auth credentials to a
//! server whose certificate was never checked or memorized.
//!
//! This module routes that decision through the backend **Trust Center**
//! (`sorng_storage::trust_store`) with **Trust-On-First-Use (TOFU)** as the
//! default, via the shared [`sorng_tls_trust`] verifier. The legacy skip flags
//! (`skip_ca_check || skip_cn_check`) map to an explicit, visible, revocable
//! `AlwaysTrust` per-connection override instead of a blind skip.
//!
//! The transport is constructed deep inside the crate with no access to Tauri
//! app state, so the store handle is built against the *same*
//! `<app_data_dir>/trust_store.json` file the async `TrustStoreService` uses
//! (see [`default_trust_store_path`]). The JSON file is the shared source of
//! truth, so records pinned here appear in the Trust Center UI and vice-versa.

use std::path::PathBuf;
use std::sync::Arc;

use sorng_tls_trust::{build_tofu_client, skip_flag_to_override, TofuTlsContext};
use sorng_storage::trust_store::SyncTrustStore;

use crate::types::WmiConnectionConfig;

/// Tauri bundle identifier — must match `tauri.conf.json` `identifier` so the
/// resolved path matches `app.path().app_data_dir()` used by the registry.
const APP_IDENTIFIER: &str = "com.sortofremote.ng";

/// The trust-store filename the async `TrustStoreService` is registered with
/// (`state_registry.rs`: `app_dir.join("trust_store.json")`).
const TRUST_STORE_FILE: &str = "trust_store.json";

/// Resolve the canonical `<app_data_dir>/trust_store.json` path that the async
/// `TrustStoreService` (and the Trust Center UI) use, so the sync façade reads
/// and writes the same shared file.
///
/// On every platform Tauri's `app_data_dir()` is `<data_dir>/<identifier>`,
/// where `<data_dir>` is `dirs::data_dir()` (Roaming AppData on Windows,
/// `~/.local/share` on Linux, `~/Library/Application Support` on macOS). When
/// the data dir cannot be resolved we fall back to a relative path so the
/// verifier still functions (it will simply start with an empty store).
pub fn default_trust_store_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(APP_IDENTIFIER).join(TRUST_STORE_FILE)
}

/// Build a blocking handle to the shared Trust Center store.
fn store_handle() -> Arc<SyncTrustStore> {
    Arc::new(SyncTrustStore::new(default_trust_store_path()))
}

/// Build the WMI transport's `reqwest::Client`, routing TLS certificate trust
/// through the Trust Center with TOFU as the default.
///
/// This replaces the old `danger_accept_invalid_certs(true)` block: the
/// legacy `skip_ca_check || skip_cn_check` flags map to an explicit per-host
/// `AlwaysTrust` override (the visible, revocable escape hatch), while the
/// default (`false`) defers to the store's effective/global policy (TOFU).
///
/// `builder` should already carry the transport's other settings (timeouts,
/// etc.) — this only installs the TLS verifier and builds.
pub fn build_wmi_client(
    builder: reqwest::ClientBuilder,
    config: &WmiConnectionConfig,
) -> Result<reqwest::Client, String> {
    let ctx = TofuTlsContext {
        store: store_handle(),
        // `computer_name` is already a bare host (no scheme); pair it with the
        // effective port so the record is keyed `tls:host:port` exactly as the
        // connection dials it.
        host: config.computer_name.clone(),
        port: config.effective_port(),
        policy_override: skip_flag_to_override(config.skip_ca_check || config.skip_cn_check),
    };

    build_tofu_client(builder, ctx)
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}
