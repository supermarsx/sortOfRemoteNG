use std::time::Duration;

use sorng_rdp::rdp::cert_trust::{
    classify_security_error_for_lifecycle, evaluate_certificate_trust,
    security_error_lifecycle_summary, CertTrustError, CertTrustStore, ChainStatus,
    PresentedCertificate, PromptDecision, PromptKind, ServerCertValidationMode, VerifyOutcome,
};
use sorng_rdp::rdp::session_state::FailureClass;

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
    let tempdir = tempfile::tempdir().expect("tempdir");
    let store = CertTrustStore::new(tempdir.path().join("rdp-cert-trust.json"));
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
    let tempdir = tempfile::tempdir().expect("tempdir");
    let store = CertTrustStore::new(tempdir.path().join("rdp-cert-trust.json"));
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
    let tempdir = tempfile::tempdir().expect("tempdir");
    let store = CertTrustStore::new(tempdir.path().join("rdp-cert-trust.json"));
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
}

#[test]
fn invalid_chain_in_validate_mode_rejects_without_prompt() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let store = CertTrustStore::new(tempdir.path().join("rdp-cert-trust.json"));
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
    let tempdir = tempfile::tempdir().expect("tempdir");
    let store = CertTrustStore::new(tempdir.path().join("rdp-cert-trust.json"));

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
