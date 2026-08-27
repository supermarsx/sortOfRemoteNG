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
//! Since t62 the Trust Center is **per user database**: records live in
//! `databases/<id>.trust.json` beside the connections payload, written through
//! the same SDBF ladder and the same master-DEK envelope. The transport is
//! constructed deep inside the crate with no access to Tauri app state, but it
//! no longer needs any: [`sorng_tls_trust::TofuTlsContext::shared`] resolves
//! the active database through the process-global trust runtime installed at
//! startup. Records pinned here appear in the Trust Center UI and vice-versa;
//! with no database open the handshake fails closed.

use sorng_tls_trust::{build_tofu_client, skip_flag_to_override, TofuTlsContext};

use crate::types::WmiConnectionConfig;

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
    let ctx = TofuTlsContext::shared(
        // `computer_name` is already a bare host (no scheme); pair it with the
        // effective port so the record is keyed `tls:host:port` exactly as the
        // connection dials it.
        config.computer_name.clone(),
        config.effective_port(),
        skip_flag_to_override(config.skip_ca_check || config.skip_cn_check),
    );

    build_tofu_client(builder, ctx).map_err(|e| format!("Failed to build HTTP client: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_storage::trust_store::test_support::{
        install_active_runtime_for_tests, install_runtime_for_tests,
    };
    use sorng_storage::trust_store::{CertIdentity, Identity};

    fn tls_identity(fingerprint: &str) -> Identity {
        Identity::Tls(Box::new(CertIdentity {
            fingerprint: fingerprint.to_string(),
            subject: Some("CN=wmi.example".into()),
            issuer: Some("CN=wmi.example".into()),
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

    /// The context the transport builds pins into the *active database's*
    /// trust file, keyed exactly as the connection dials it.
    #[test]
    fn pins_into_the_active_database_trust_file() {
        let dir = tempfile::tempdir().unwrap();
        let databases = dir.path().join("databases");
        let _guard = install_active_runtime_for_tests(databases.clone(), "winmgmt-db");

        let ctx = TofuTlsContext::shared("wmi.example", 5986, None);
        ctx.store
            .trust(
                "wmi.example:5986".into(),
                "tls".into(),
                tls_identity("ee55"),
                false,
            )
            .expect("pin into the active database");

        assert!(
            databases.join("winmgmt-db.trust.json").exists(),
            "the pin must land in databases/<id>.trust.json"
        );
    }

    #[test]
    fn fails_closed_without_an_active_database() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = install_runtime_for_tests(dir.path().join("databases"), None);

        let ctx = TofuTlsContext::shared("wmi.example", 5986, None);
        assert!(ctx
            .store
            .verify("wmi.example:5986", "tls", tls_identity("ee55"))
            .is_err());
    }
}
