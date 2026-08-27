//! Trust Center store handle for the VoIP phone TLS client.
//!
//! Mirrors `sorng-supermicro/src/trust.rs`. Management clients used to call
//! `reqwest::ClientBuilder::danger_accept_invalid_certs(true)` unconditionally —
//! sending phone credentials to a server whose certificate was never checked or
//! memorized. That blind skip is replaced by Trust-On-First-Use (TOFU) routed
//! through the backend Trust Center (see [`sorng_tls_trust`]).
//!
//! Since t62 the Trust Center is **per user database**: records live in
//! `databases/<id>.trust.json` next to the connections payload, written through
//! the same SDBF ladder and the same master-DEK envelope. Which database is
//! active is process-global state owned by
//! [`sorng_storage::trust_store::TrustRuntime`], installed at startup, so this
//! crate no longer derives — or is told — any store path. It simply asks for
//! the shared handle; when no database is open the verifier fails closed.

use std::sync::Arc;

use sorng_storage::trust_store::SyncTrustStore;
use sorng_tls_trust::BlockingTrustStore;

/// Blocking Trust Center handle over the **active database's** trust store.
///
/// Cheap (`Arc`-backed) and re-resolved through the process-global trust
/// runtime on every operation, so it stays coherent with the async
/// `TrustStoreService` and the Trust Center UI — and follows the user from one
/// database to the next. With no active database every verify/persist returns
/// an error and the effective policy reads `Strict`: a phone handshake fails
/// rather than silently trusting an unpinned certificate.
pub fn trust_store_handle() -> Arc<dyn BlockingTrustStore> {
    Arc::new(SyncTrustStore::shared())
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
            subject: Some("CN=phone.example".into()),
            issuer: Some("CN=phone.example".into()),
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

    #[test]
    fn pins_into_the_active_database_trust_file() {
        let dir = tempfile::tempdir().unwrap();
        let databases = dir.path().join("databases");
        let _guard = install_active_runtime_for_tests(databases.clone(), "voip-db");

        trust_store_handle()
            .trust(
                "phone.example:443".into(),
                "tls".into(),
                tls_identity("aa11"),
                false,
            )
            .expect("pin into the active database");

        assert!(
            databases.join("voip-db.trust.json").exists(),
            "the pin must land in databases/<id>.trust.json"
        );
    }

    #[test]
    fn fails_closed_without_an_active_database() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = install_runtime_for_tests(dir.path().join("databases"), None);

        let store = trust_store_handle();
        assert!(store
            .verify("phone.example:443", "tls", tls_identity("aa11"))
            .is_err());
    }
}
