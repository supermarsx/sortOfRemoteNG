use std::time::Duration;

use sorng_rdp::rdp::cert_trust::{
    evaluate_certificate_trust, CertTrustError, CertTrustStore, ChainStatus, PresentedCertificate,
    PromptDecision, PromptKind, ServerCertValidationMode,
};

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