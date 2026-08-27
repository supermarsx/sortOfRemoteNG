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
//!
//! Since t62 the Trust Center is **per user database**: records live in
//! `databases/<id>.trust.json` beside the connections payload. The active
//! database is process-global state owned by the trust runtime installed at
//! startup, so this crate derives no store path at all — it asks
//! [`TofuTlsContext::shared`] for a handle, and with no database open the
//! handshake fails closed.

use std::sync::Arc;

use sorng_tls_trust::{
    build_tofu_client, skip_flag_to_override, BlockingTrustStore, TofuTlsContext,
};

use crate::test_support::WinRmTestTrust;
use crate::types::PsRemotingConfig;
use sorng_storage::trust_store::TrustPolicy;

/// The canonical `(host, port)` a WinRM/PowerShell connection dials, so the
/// Trust Center record is keyed `tls:host:port`.
fn endpoint_host_port(config: &PsRemotingConfig) -> Result<(String, u16), String> {
    let endpoint = config.try_endpoint_uri()?;
    let parsed = url::Url::parse(&endpoint)
        .map_err(|error| format!("Invalid WinRM TLS endpoint: {error}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "WinRM TLS endpoint has no host".to_string())?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "WinRM TLS endpoint has no effective port".to_string())?;
    Ok((host, port))
}

/// Build the [`TofuTlsContext`] for a WinRM/PowerShell connection against an
/// explicitly supplied store. Only the test path injects a store; production
/// uses [`tofu_context`], which resolves the active database.
fn tofu_context_with_store(
    config: &PsRemotingConfig,
    store: Arc<dyn BlockingTrustStore>,
    policy_override: Option<TrustPolicy>,
) -> Result<TofuTlsContext, String> {
    let (host, port) = endpoint_host_port(config)?;
    Ok(TofuTlsContext {
        store,
        host,
        port,
        policy_override,
    })
}

fn tofu_context(config: &PsRemotingConfig) -> Result<TofuTlsContext, String> {
    // The legacy escape hatch was "skip if the user disabled CA *or* CN
    // checking". Preserve that exact opt-out as an explicit AlwaysTrust
    // override; otherwise defer to the store's effective/global policy (TOFU).
    let skip = config.skip_ca_check || config.skip_cn_check;
    let (host, port) = endpoint_host_port(config)?;
    Ok(TofuTlsContext::shared(
        host,
        port,
        skip_flag_to_override(skip),
    ))
}

/// Finish a `reqwest::ClientBuilder` by installing the shared TOFU verifier in
/// place of the old `danger_accept_invalid_certs` skip. All non-TLS settings
/// (timeouts, compression, cookies, …) must already be applied to `builder`.
pub fn build_winrm_client(
    builder: reqwest::ClientBuilder,
    config: &PsRemotingConfig,
) -> Result<reqwest::Client, String> {
    build_tofu_client(builder, tofu_context(config)?)
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
        tofu_context_with_store(config, store, Some(TrustPolicy::Strict))?,
    )
}

#[cfg(test)]
mod trust_runtime_tests {
    use super::*;
    use sorng_storage::trust_store::test_support::{
        install_active_runtime_for_tests, install_runtime_for_tests,
    };
    use sorng_storage::trust_store::{CertIdentity, Identity};

    fn tls_identity(fingerprint: &str) -> Identity {
        Identity::Tls(Box::new(CertIdentity {
            fingerprint: fingerprint.to_string(),
            subject: Some("CN=winrm.example".into()),
            issuer: Some("CN=winrm.example".into()),
            first_seen: "2026-01-01T00:00:00Z".into(),
            last_seen: "2026-01-01T00:00:00Z".into(),
            valid_from: None,
            valid_to: None,
            pem: None,
            serial: None,
            signature_algorithm: None,
            san: None,
            chain_fingerprints: Vec::new(),
            subject_cn: None,
            subject_org: None,
            subject_ou: None,
            subject_country: None,
            subject_state: None,
            subject_locality: None,
            subject_email: None,
            issuer_cn: None,
            issuer_org: None,
            issuer_country: None,
            key_algorithm: None,
            key_size: None,
            version: None,
            chain: None,
        }))
    }

    /// The context the WinRM transport builds pins into the *active
    /// database's* trust file, keyed by the endpoint's `host:port`.
    #[test]
    fn pins_into_the_active_database_trust_file() {
        let dir = tempfile::tempdir().unwrap();
        let databases = dir.path().join("databases");
        let _guard = install_active_runtime_for_tests(databases.clone(), "powershell-db");

        let ctx = TofuTlsContext::shared("winrm.example", 5986, None);
        ctx.store
            .trust(
                "winrm.example:5986".into(),
                "tls".into(),
                tls_identity("ff66"),
                false,
            )
            .expect("pin into the active database");

        assert!(
            databases.join("powershell-db.trust.json").exists(),
            "the pin must land in databases/<id>.trust.json"
        );
    }

    #[test]
    fn fails_closed_without_an_active_database() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = install_runtime_for_tests(dir.path().join("databases"), None);

        let ctx = TofuTlsContext::shared("winrm.example", 5986, None);
        assert!(ctx
            .store
            .verify("winrm.example:5986", "tls", tls_identity("ff66"))
            .is_err());
    }
}
