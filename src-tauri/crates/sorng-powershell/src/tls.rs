//! Shared TOFU TLS plumbing for the WinRM/PowerShell management client.
//!
//! Historically the WinRM transport (`transport.rs`) and the connection
//! diagnostics (`diagnostics.rs`) called
//! `reqwest::ClientBuilder::danger_accept_invalid_certs(true)` whenever the
//! connection's `skip_ca_check` / `skip_cn_check` flags were set — sending
//! credentials to a server whose certificate was never checked or memorized.
//!
//! This module folds all of those skip sites onto the shared
//! [`sorng_tls_trust`] plumbing so the certificate decision routes through the
//! backend **Trust Center** with **Trust-On-First-Use (TOFU)** as the default
//! policy. The legacy skip flags become an explicit, visible, revocable
//! `AlwaysTrust` per-connection override (via [`skip_flag_to_override`]) rather
//! than a blind skip.
//!
//! The verifier still performs full signature/chain cryptography — TOFU pins
//! *identity* only (see `sorng-tls-trust`).

use std::path::PathBuf;
use std::sync::Arc;

use sorng_tls_trust::{
    build_tofu_client, skip_flag_to_override, BlockingTrustStore, TofuTlsContext,
};

use crate::test_support::WinRmTestTrust;
use crate::types::PsRemotingConfig;
use sorng_storage::trust_store::TrustPolicy;

/// The Tauri bundle identifier (`tauri.conf.json`). Tauri v2's
/// `PathResolver::app_data_dir()` resolves to `dirs::data_dir()/<identifier>`,
/// so re-deriving that path here keeps the sync trust-store façade coherent
/// with the async `TrustStoreService` and the Trust Center UI, which both use
/// `<app_data_dir>/trust_store.json`.
const APP_IDENTIFIER: &str = "com.sortofremote.ng";

/// Resolve the canonical `trust_store.json` path the app uses
/// (`<app_data_dir>/trust_store.json`). Deep inside this crate we have no Tauri
/// `AppHandle`, so we mirror Tauri's path resolution. Falls back to a
/// relative path if the platform data dir cannot be resolved (the JSON file is
/// the shared source of truth; an unresolved data dir only means a process-local
/// store, never a security downgrade — verification still runs).
fn default_trust_store_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(APP_IDENTIFIER).join("trust_store.json")
}

/// Build the [`TofuTlsContext`] for a WinRM/PowerShell connection: the canonical
/// `host:port` the connection dials (so the Trust Center record is keyed
/// `tls:host:port`) plus the legacy skip flags mapped to an explicit
/// `AlwaysTrust` override.
fn tofu_context_with_store(
    config: &PsRemotingConfig,
    store: Arc<dyn BlockingTrustStore>,
    policy_override: Option<TrustPolicy>,
) -> TofuTlsContext {
    TofuTlsContext {
        store,
        host: config.computer_name.clone(),
        port: config.effective_port(),
        policy_override,
    }
}

fn tofu_context(config: &PsRemotingConfig) -> TofuTlsContext {
    // The legacy escape hatch was "skip if the user disabled CA *or* CN
    // checking". Preserve that exact opt-out as an explicit AlwaysTrust
    // override; otherwise defer to the store's effective/global policy (TOFU).
    let skip = config.skip_ca_check || config.skip_cn_check;
    tofu_context_with_store(
        config,
        Arc::new(sorng_storage::trust_store::SyncTrustStore::new(
            default_trust_store_path(),
        )),
        skip_flag_to_override(skip),
    )
}

/// Finish a `reqwest::ClientBuilder` by installing the shared TOFU verifier in
/// place of the old `danger_accept_invalid_certs` skip. All non-TLS settings
/// (timeouts, compression, cookies, …) must already be applied to `builder`.
pub fn build_winrm_client(
    builder: reqwest::ClientBuilder,
    config: &PsRemotingConfig,
) -> Result<reqwest::Client, String> {
    build_tofu_client(builder, tofu_context(config))
}

/// Build the same strict WinRM client against an explicitly supplied test
/// store. The injected path is forced to Strict so only an exact pre-pinned
/// certificate is accepted; no skip override is introduced.
#[doc(hidden)]
pub(crate) fn build_winrm_client_with_test_trust(
    builder: reqwest::ClientBuilder,
    config: &PsRemotingConfig,
    trust: &WinRmTestTrust,
) -> Result<reqwest::Client, String> {
    let store: Arc<dyn BlockingTrustStore> = trust.store.clone();
    build_tofu_client(
        builder,
        tofu_context_with_store(config, store, Some(TrustPolicy::Strict)),
    )
}
