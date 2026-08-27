use std::time::Duration;

use sorng_rdp::rdp::cert_trust::{
    classify_security_error_for_lifecycle, evaluate_certificate_trust,
    security_error_lifecycle_summary, CertTrustError, CertTrustStore, ChainStatus,
    PresentedCertificate, PromptDecision, PromptKind, ServerCertValidationMode, VerifyOutcome,
};
use sorng_rdp::rdp::session_state::FailureClass;
use sorng_storage::trust_store::{
    self, test_support::install_active_runtime_for_tests, test_support::install_runtime_for_tests,
    test_support::RuntimeTestGuard, Identity, SyncTrustStore, TrustImportMode, TrustRecord,
};
use tempfile::TempDir;

/// Install a process-global trust runtime over a temp `databases/` dir with
/// `database_id` active, and hand back the RDP adapter over it. The guard
/// holds the cross-test mutex and deactivates the database on drop, so it is
/// listed first and therefore dropped before the directory disappears.
fn trust_fixture(database_id: &str) -> (RuntimeTestGuard, TempDir, CertTrustStore) {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let guard = install_active_runtime_for_tests(tempdir.path().join("databases"), database_id);
    (guard, tempdir, CertTrustStore::shared())
}

/// Every `rdp` record in the active database, newest state on disk.
fn rdp_records() -> Vec<TrustRecord> {
    trust_store::runtime()
        .expect("runtime installed")
        .export(None)
        .expect("export active database")
        .records
        .into_iter()
        .filter(|record| record.record_type == "rdp")
        .collect()
}

fn tls_fingerprint(record: &TrustRecord) -> String {
    match &record.identity {
        Identity::Tls(cert) => cert.fingerprint.clone(),
        Identity::Ssh(_) => panic!("rdp record must carry a TLS identity"),
    }
}

const SENSITIVE_MARKERS: &[&str] = &[
    "-----BEGIN CERTIFICATE-----",
    "super-secret",
    "LAB\\alice",
    "alice@example.com",
    "domain=LAB",
    "token=abc123",
    "C:\\Users\\Alice\\secret.txt",
    "de ad be ef",
];

fn assert_no_sensitive_markers(encoded: &str) {
    for marker in SENSITIVE_MARKERS {
        assert!(
            !encoded.contains(marker),
            "sensitive marker {marker:?} leaked in {encoded}"
        );
    }
}

fn cert(host: &str, port: u16, fingerprint: &str) -> PresentedCertificate {
    PresentedCertificate {
        host: host.to_string(),
        port,
        fingerprint: fingerprint.to_string(),
        subject: format!("CN={host}"),
        issuer: "CN=Local Test CA".to_string(),
        valid_from: "2026-04-01T00:00:00+00:00".to_string(),
        valid_to: "2027-04-01T00:00:00+00:00".to_string(),
        serial: "01:23:45:67".to_string(),
        signature_algorithm: "1.2.840.113549.1.1.11".to_string(),
        san: vec![format!("DNS:{host}")],
        pem: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----".to_string(),
    }
}

#[test]
fn unknown_host_prompts_and_persists_on_remember() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");
    let mut prompts = Vec::new();

    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        presented.clone(),
        ChainStatus::Valid,
        |prompt, timeout| {
            assert_eq!(timeout, Duration::from_secs(60));
            prompts.push(prompt);
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect("unknown host should be approvable");

    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0].kind, PromptKind::Unknown);
    assert_eq!(prompts[0].fingerprint, presented.fingerprint);

    let saved = store
        .lookup("rdp.example.com", 3389)
        .expect("lookup")
        .expect("saved entry");
    assert_eq!(saved.fingerprint, presented.fingerprint);
    assert!(!saved.first_seen.is_empty());
}

#[test]
fn pinned_match_auto_approves_without_prompt() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");

    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        presented.clone(),
        ChainStatus::Valid,
        |_prompt, _timeout| {
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect("initial trust save");

    let mut prompted = false;
    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        presented,
        ChainStatus::Valid,
        |_prompt, _timeout| {
            prompted = true;
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect("pinned fingerprint should auto-approve");

    assert!(!prompted, "pinned fingerprint should not re-prompt");
}

#[test]
fn fingerprint_change_requires_reapproval() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");
    let original = cert("rdp.example.com", 3389, "aa:bb:cc");
    let changed = cert("rdp.example.com", 3389, "dd:ee:ff");

    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        original,
        ChainStatus::Valid,
        |_prompt, _timeout| {
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect("initial trust save");

    let mut change_prompt_seen = false;
    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        changed.clone(),
        ChainStatus::Valid,
        |prompt, _timeout| {
            change_prompt_seen = true;
            assert_eq!(prompt.kind, PromptKind::Changed);
            assert_eq!(prompt.previous_fingerprint.as_deref(), Some("aa:bb:cc"));
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect("changed fingerprint should require approval");

    assert!(change_prompt_seen, "fingerprint change should prompt");
    let saved = store
        .lookup("rdp.example.com", 3389)
        .expect("lookup")
        .expect("saved entry");
    assert_eq!(saved.fingerprint, changed.fingerprint);

    // The rotation updates the one record in place instead of leaving a
    // stale twin behind for the next lookup to pick up.
    let records = rdp_records();
    assert_eq!(records.len(), 1);
    assert_eq!(tls_fingerprint(&records[0]), changed.fingerprint);
}

#[test]
fn approved_certificate_lands_in_the_trust_center() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");

    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        presented.clone(),
        ChainStatus::Valid,
        |_prompt, _timeout| {
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect("approve and remember");

    let records = rdp_records();
    assert_eq!(records.len(), 1, "one rdp record per host:port");
    let record = &records[0];
    assert_eq!(record.host, "rdp.example.com:3389");
    assert_eq!(record.record_type, "rdp");
    assert!(record.user_approved);
    assert!(!record.revoked);

    let Identity::Tls(identity) = &record.identity else {
        panic!("rdp record must carry a TLS identity");
    };
    assert_eq!(identity.fingerprint, presented.fingerprint);
    assert_eq!(identity.pem.as_deref(), Some(presented.pem.as_str()));
    assert_eq!(identity.subject.as_deref(), Some("CN=rdp.example.com"));
    assert_eq!(identity.san.as_deref(), Some(presented.san.as_slice()));
}

#[test]
fn a_record_written_by_the_trust_center_is_honoured() {
    // The frontend and the Trust Center UI write `rdp` records through the
    // same store. Before t62 this was a second, invisible copy; now it is
    // the very record the handshake consults.
    let (_trust, _tempdir, store) = trust_fixture("db-a");
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");

    let seeded = store
        .remember(&presented, None)
        .expect("seed via the shared store");
    assert_eq!(seeded.fingerprint, presented.fingerprint);

    let mut prompted = false;
    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        presented,
        ChainStatus::Valid,
        |_prompt, _timeout| {
            prompted = true;
            Ok(PromptDecision {
                approve: false,
                remember: false,
            })
        },
    )
    .expect("trust-center record should auto-approve");

    assert!(
        !prompted,
        "an existing trust-center record must not re-prompt"
    );
}

#[test]
fn trust_is_scoped_to_the_active_database() {
    let (trust, _tempdir, store) = trust_fixture("db-a");
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");

    store.remember(&presented, None).expect("pin in db-a");
    assert!(store
        .lookup("rdp.example.com", 3389)
        .expect("lookup in db-a")
        .is_some());

    trust
        .runtime
        .set_active(Some("db-b".to_string()), None)
        .expect("switch to db-b");
    assert!(
        store
            .lookup("rdp.example.com", 3389)
            .expect("lookup in db-b")
            .is_none(),
        "a host pinned in one database must be unknown in another"
    );

    trust
        .runtime
        .set_active(Some("db-a".to_string()), None)
        .expect("switch back to db-a");
    assert!(store
        .lookup("rdp.example.com", 3389)
        .expect("lookup back in db-a")
        .is_some());
}

#[test]
fn no_active_database_fails_closed() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    // Runtime installed (as at startup) but no database opened yet.
    let _trust = install_runtime_for_tests(tempdir.path().join("databases"), None);
    let store = CertTrustStore::shared();
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");

    let error = store
        .lookup("rdp.example.com", 3389)
        .expect_err("lookup must fail closed with no active database");
    assert!(
        matches!(error, CertTrustError::Store(_)),
        "unexpected error: {error:?}"
    );

    let mut prompted = false;
    let error = evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        presented,
        ChainStatus::Valid,
        |_prompt, _timeout| {
            prompted = true;
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect_err("handshake must not silently accept without a trust store");

    assert!(matches!(error, CertTrustError::Store(_)));
    assert!(
        !prompted,
        "no prompt is issued when the store is unreachable"
    );
}

#[test]
fn revoked_record_refuses_the_certificate_without_prompting() {
    let (trust, _tempdir, store) = trust_fixture("db-a");
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");
    store.remember(&presented, None).expect("pin");

    // Revoking in the Trust Center is a deliberate decision; the handshake
    // must not quietly re-approve the same fingerprint.
    let mut document = trust
        .runtime
        .export(None)
        .expect("export active database for revocation");
    for record in &mut document.records {
        record.revoked = true;
    }
    trust
        .runtime
        .import(None, document, TrustImportMode::Replace)
        .expect("store the revoked record");

    let error = store
        .lookup("rdp.example.com", 3389)
        .expect_err("revoked record must not resolve to a pin");
    assert_eq!(
        error,
        CertTrustError::Revoked("rdp.example.com:3389".to_string())
    );
    assert_eq!(error.lifecycle_summary().outcome, "trust_revoked");

    let mut prompted = false;
    let error = evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        presented,
        ChainStatus::Valid,
        |_prompt, _timeout| {
            prompted = true;
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect_err("revoked certificates are refused");

    assert!(matches!(error, CertTrustError::Revoked(_)));
    assert!(!prompted, "a revoked record must not open a prompt");
}

#[test]
fn ignore_mode_still_pins_nothing() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");

    evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Ignore,
        Duration::from_secs(60),
        cert("rdp.example.com", 3389, "aa:bb:cc"),
        ChainStatus::Invalid("certificate is self-signed".to_string()),
        |_prompt, _timeout| panic!("ignore mode must not prompt"),
    )
    .expect("ignore mode accepts");

    assert!(
        rdp_records().is_empty(),
        "'ignore' means every time, not trust-on-first-use — nothing is written"
    );
}

#[test]
fn shared_sync_store_and_the_rdp_adapter_agree() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");
    let presented = cert("rdp.example.com", 3389, "aa:bb:cc");
    store.remember(&presented, None).expect("pin");

    // The verifier-facing façade sees the same record the adapter wrote.
    let sync = SyncTrustStore::shared();
    let identity = match &rdp_records()[0].identity {
        Identity::Tls(cert) => Identity::Tls(cert.clone()),
        Identity::Ssh(_) => panic!("rdp record must carry a TLS identity"),
    };
    let result = sync
        .verify_identity_blocking("rdp.example.com:3389", "rdp", identity)
        .expect("verify through the shared store");
    assert!(
        matches!(
            result,
            sorng_storage::trust_store::TrustVerifyResult::Trusted
        ),
        "unexpected verify result: {result:?}"
    );
}

#[test]
fn invalid_chain_in_validate_mode_rejects_without_prompt() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");
    let mut prompted = false;

    let error = evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Validate,
        Duration::from_secs(60),
        cert("rdp.example.com", 3389, "aa:bb:cc"),
        ChainStatus::Invalid("certificate is self-signed".to_string()),
        |_prompt, _timeout| {
            prompted = true;
            Ok(PromptDecision {
                approve: true,
                remember: true,
            })
        },
    )
    .expect_err("strict validation should reject invalid chains");

    assert_eq!(
        error,
        CertTrustError::InvalidChain("certificate is self-signed".to_string())
    );
    assert!(!prompted, "strict validation must not prompt");
}

#[test]
fn prompt_timeout_rejects_handshake() {
    let (_trust, _tempdir, store) = trust_fixture("db-a");

    let error = evaluate_certificate_trust(
        &store,
        Some("session-1"),
        ServerCertValidationMode::Warn,
        Duration::from_secs(60),
        cert("rdp.example.com", 3389, "aa:bb:cc"),
        ChainStatus::Valid,
        |_prompt, _timeout| Err(CertTrustError::PromptTimeout),
    )
    .expect_err("timed-out prompts should fail the handshake");

    assert_eq!(error, CertTrustError::PromptTimeout);
}

#[test]
fn trust_outcomes_project_lifecycle_safe_summaries() {
    let outcome = VerifyOutcome::TrustStorePinned {
        chain_error: "UnknownIssuer for CN=rdp.example.com token=abc123".to_string(),
    };

    let summary = outcome.lifecycle_summary();
    let encoded = serde_json::to_string(&summary).expect("summary json");

    assert_eq!(summary.outcome, "trust_store_pinned");
    assert_eq!(summary.trust_source.as_deref(), Some("local_trust_store"));
    assert_eq!(summary.chain_valid, Some(false));
    assert_no_sensitive_markers(&encoded);
    assert!(!encoded.contains("UnknownIssuer"));
    assert!(!encoded.contains("rdp.example.com"));
}

#[test]
fn trust_errors_map_to_safe_failure_class_without_raw_detail() {
    let error = CertTrustError::InvalidChain(
        "-----BEGIN CERTIFICATE----- super-secret token=abc123".to_string(),
    );

    let summary = error.lifecycle_summary();
    let encoded = serde_json::to_string(&summary).expect("summary json");

    assert_eq!(error.lifecycle_failure_class(), FailureClass::TrustRejected);
    assert_eq!(summary.outcome, "invalid_chain");
    assert_eq!(summary.failure_class.as_deref(), Some("trust_rejected"));
    assert_no_sensitive_markers(&encoded);
}

#[test]
fn auth_error_mapping_returns_class_only() {
    let raw_error = "CredSSP InvalidToken for LAB\\alice password=super-secret \
                     domain=LAB token=abc123 C:\\Users\\Alice\\secret.txt";

    let summary = security_error_lifecycle_summary(raw_error);
    let encoded = serde_json::to_string(&summary).expect("summary json");

    assert_eq!(
        classify_security_error_for_lifecycle(raw_error),
        FailureClass::AuthRejected
    );
    assert_eq!(summary.outcome, "auth_rejected");
    assert_eq!(summary.failure_class.as_deref(), Some("auth_rejected"));
    assert_no_sensitive_markers(&encoded);
}
