//! t-mitmproxy x2: the proxy's upstream evidence produces the same trust
//! decision the CEF bridge evidence produced for the same chain.
//!
//! Rows mirror `intercept/upstream_tests.rs` (sorng-protocols), which proves
//! with real handshakes and an injected "system" root what the proxy reports
//! for each row (CA validity, or a fatal kind). Here each row is fed through
//! both evidence builders: the CEF one (behind the real
//! `admissible_native_result`) and the proxy one. The saved-connection
//! decision runs the real Trust Center store (`verify_https_with_ca`, scoped
//! records, pins); the policy table on top is a transcription of
//! `action`/`combined_action`/`temporary_action` and the post-checks in
//! `NativeCertificateAuthority::evaluate` (origin_browser_certificates.rs,
//! private to sorng-commands-core). Expected cells for the plan's headline
//! table are asserted explicitly.

use super::super::tests::evidence as cef_fixture;
use super::super::{admissible_native_result, cef_certificate_evidence};
use super::*;
use sha2::{Digest, Sha256};
use sorng_browser_host::cef_tls_bridge::{NativeTlsCaMode, NativeTlsEvidence};
use sorng_protocols::origin_browser::OriginBrowserPolicy;
use sorng_protocols::private_forward_proxy::intercept::UpstreamFatal;
use sorng_protocols::private_forward_proxy::Authority;
use sorng_storage::trust_store::{
    CertIdentity, Identity, TrustPolicy, TrustStoreService, TrustVerifyResult,
    CONNECTION_SCOPE_PREFIX,
};

/// One attempt identity for every evidence built in a test (a new policy
/// would mint a new attempt id).
pub(crate) fn identity() -> BrowserIdentity {
    static IDENTITY: std::sync::LazyLock<BrowserIdentity> = std::sync::LazyLock::new(|| {
        OriginBrowserPolicy::new("db", "conn", "tab", "https://device.test")
            .unwrap()
            .identity()
            .clone()
    });
    IDENTITY.clone()
}

// ------------------------------------------------------------ verdicts ----

#[test]
fn admission_is_persistent_only_for_unprompted_saved_connections() {
    assert_eq!(
        admitted(false, false, true),
        UpstreamVerdict::Admit { persistent: true }
    );
    assert_eq!(
        admitted(false, false, false),
        UpstreamVerdict::Admit { persistent: true }
    );
    for (temporary_lease, reviewed) in [(true, false), (false, true), (true, true)] {
        assert_eq!(
            admitted(temporary_lease, reviewed, true),
            UpstreamVerdict::Admit { persistent: false }
        );
        assert_eq!(
            admitted(temporary_lease, reviewed, false),
            UpstreamVerdict::Deny,
            "a temporary admission is refused where it is not acceptable"
        );
    }
}

#[test]
fn an_unanswered_review_times_out_and_anything_else_denies() {
    assert_eq!(
        review_outcome(true, REVIEW_TIMEOUT),
        UpstreamVerdict::Timeout
    );
    assert_eq!(
        review_outcome(true, REVIEW_TIMEOUT - Duration::from_millis(1)),
        UpstreamVerdict::Deny
    );
    assert_eq!(
        review_outcome(false, REVIEW_TIMEOUT * 2),
        UpstreamVerdict::Deny
    );
}

#[test]
fn proxy_origin_matches_the_bridge_origin_for_every_authority_form() {
    for (authority, origin) in [
        ("device.test:443", "https://device.test"),
        ("device.test:8443", "https://device.test:8443"),
        ("127.0.0.1:443", "https://127.0.0.1"),
        ("[::1]:8443", "https://[::1]:8443"),
        ("[2001:db8::1]:443", "https://[2001:db8::1]"),
    ] {
        let evidence = UpstreamEvidence {
            authority: Authority::parse(authority).unwrap(),
            chain_der: vec![b"leaf".to_vec()],
            system_ca_valid: false,
            temporary_ok: true,
        };
        let built = upstream_certificate_evidence(identity(), &evidence).unwrap();
        assert_eq!(built.origin, origin, "{authority}");
    }
}

// ------------------------------------------------------------- matrix ----

#[derive(Clone, Copy, Debug, PartialEq)]
enum Validity {
    Current,
    Expired,
    NotYetValid,
}

/// One row: what CEF reported (`native_error`, fatal, mask, known root; None
/// when the handshake fails before evidence) and what the proxy reported
/// (CA validity, or fatal) for the same chain.
struct Row {
    name: &'static str,
    authority: &'static str,
    origin: &'static str,
    chain: Vec<Vec<u8>>,
    validity: Validity,
    stored: Option<Vec<Vec<u8>>>,
    cef: Option<(i32, bool, u32, bool)>,
    proxy: Result<bool, UpstreamFatal>,
}

fn der(name: &str) -> Vec<u8> {
    format!("synthetic certificate {name}").into_bytes()
}

fn rows() -> Vec<Row> {
    let leaf = der("leaf");
    let intermediate = der("intermediate");
    let valid = vec![leaf.clone(), intermediate.clone()];
    let row = |name, chain: Vec<Vec<u8>>, cef, proxy| Row {
        name,
        authority: "device.test:443",
        origin: "https://device.test",
        chain,
        validity: Validity::Current,
        stored: None,
        cef,
        proxy,
    };
    let ok = Some((0, false, 0, true));
    vec![
        row("valid-ca", valid.clone(), ok, Ok(true)),
        row(
            "self-signed",
            vec![der("self")],
            Some((-202, false, 4, false)),
            Ok(false),
        ),
        row(
            "unknown-ca",
            vec![der("unknown")],
            Some((-202, false, 4, false)),
            Ok(false),
        ),
        Row {
            validity: Validity::Expired,
            ..row(
                "expired",
                vec![der("expired"), intermediate.clone()],
                Some((-201, false, 2, false)),
                Ok(false),
            )
        },
        Row {
            validity: Validity::NotYetValid,
            ..row(
                "not-yet-valid",
                vec![der("future"), intermediate.clone()],
                Some((-201, false, 2, false)),
                Ok(false),
            )
        },
        row(
            "wrong-name",
            vec![der("other-name"), intermediate.clone()],
            Some((-200, false, 1, false)),
            Ok(false),
        ),
        Row {
            authority: "127.0.0.1:443",
            origin: "https://127.0.0.1",
            ..row(
                "ip-san-ok",
                vec![der("ip"), intermediate.clone()],
                ok,
                Ok(true),
            )
        },
        Row {
            authority: "127.0.0.1:443",
            origin: "https://127.0.0.1",
            ..row(
                "ip-san-mismatch",
                vec![der("ip-other"), intermediate.clone()],
                Some((-200, false, 1, false)),
                Ok(false),
            )
        },
        Row {
            stored: Some(valid.clone()),
            ..row(
                "changed-leaf-after-tofu",
                vec![der("rotated"), intermediate.clone()],
                ok,
                Ok(true),
            )
        },
        Row {
            stored: Some(valid.clone()),
            ..row(
                "changed-intermediate",
                vec![leaf.clone(), der("intermediate-2")],
                ok,
                Ok(true),
            )
        },
        Row {
            stored: Some(valid.clone()),
            ..row("pinned-match", valid.clone(), ok, Ok(true))
        },
        Row {
            stored: Some(valid.clone()),
            ..row(
                "pinned-mismatch",
                vec![der("attacker")],
                Some((-202, false, 4, false)),
                Ok(false),
            )
        },
        row(
            "revoked",
            valid.clone(),
            Some((-206, false, 0, true)),
            Err(UpstreamFatal::Revoked),
        ),
        row(
            "bad-handshake-signature",
            valid.clone(),
            None,
            Err(UpstreamFatal::BadSignature),
        ),
        row(
            "rsa-1024",
            vec![der("weak"), intermediate.clone()],
            Some((-208, false, 0, true)),
            Err(UpstreamFatal::WeakKey),
        ),
        row(
            "hsts-wrong-name",
            vec![der("other-name"), intermediate],
            Some((-200, true, 0, false)),
            Err(UpstreamFatal::HstsViolation),
        ),
    ]
}

const POLICIES: [TrustPolicy; 5] = [
    TrustPolicy::Tofu,
    TrustPolicy::AlwaysAsk,
    TrustPolicy::Strict,
    TrustPolicy::CertificatePinning,
    TrustPolicy::CaTrustOnly,
];

fn fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

/// The identity `evaluate` derives from a chain: SHA-256 of the leaf and of
/// every certificate as sent. (Real DER parsing is covered separately by
/// `a_record_approved_under_cef_evidence_admits_the_proxy_evidence`.)
fn certificate(chain: &[Vec<u8>], validity: Validity) -> CertIdentity {
    let (from, to) = match validity {
        Validity::Current => ("2020-01-01T00:00:00+00:00", "2090-01-01T00:00:00+00:00"),
        Validity::Expired => ("2020-01-01T00:00:00+00:00", "2021-01-01T00:00:00+00:00"),
        Validity::NotYetValid => ("2090-01-01T00:00:00+00:00", "2091-01-01T00:00:00+00:00"),
    };
    serde_json::from_value(serde_json::json!({
        "fingerprint": fingerprint(&chain[0]),
        "chain_fingerprints": chain.iter().map(|der| fingerprint(der)).collect::<Vec<_>>(),
        "first_seen": "2026-01-01T00:00:00Z",
        "last_seen": "2026-01-01T00:00:00Z",
        "valid_from": from,
        "valid_to": to,
    }))
    .unwrap()
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Cell {
    Allow,
    Remember,
    Review,
    Deny,
}

// Transcribed from origin_browser_certificates.rs `action`.
fn action(result: &TrustVerifyResult, policy: &TrustPolicy, ca: bool) -> Cell {
    use TrustPolicy::*;
    use TrustVerifyResult::*;
    if matches!(policy, AlwaysTrust | ConditionalTrust) {
        return Cell::Deny;
    }
    match result {
        Revoked { .. } | PendingThreshold { .. } | PendingVerification { .. } => Cell::Deny,
        Mismatch { .. } | ChainMismatch { .. } | RotationGrace { .. } => {
            if matches!(policy, Strict | CertificatePinning | CaTrustOnly) {
                Cell::Deny
            } else {
                Cell::Review
            }
        }
        Expired { .. } if matches!(policy, Strict | CertificatePinning | CaTrustOnly) => Cell::Deny,
        Expired { .. } => Cell::Review,
        Trusted if *policy == AlwaysAsk => Cell::Review,
        Trusted if *policy == CaTrustOnly && !ca => Cell::Deny,
        Trusted => Cell::Allow,
        FirstUse {
            requires_approval: true,
            ..
        } if matches!(policy, Strict | CertificatePinning | CaTrustOnly) => Cell::Deny,
        FirstUse {
            requires_approval: true,
            ..
        } => Cell::Review,
        FirstUse { .. } => match policy {
            Tofu if ca => Cell::Allow,
            Tofu => Cell::Remember,
            CaTrustOnly if ca => Cell::Allow,
            Strict | CertificatePinning | CaTrustOnly | AlwaysTrust => Cell::Deny,
            _ => Cell::Review,
        },
    }
}

// Transcribed from origin_browser_certificates.rs `combined_action`.
fn combined_action(
    result: &TrustVerifyResult,
    effective: &TrustPolicy,
    requested: &TrustPolicy,
    system_ca_valid: bool,
    ca_first_use: bool,
) -> Cell {
    let decide = |policy: &TrustPolicy| {
        action(
            result,
            policy,
            if *policy == TrustPolicy::Tofu {
                system_ca_valid && ca_first_use
            } else {
                system_ca_valid
            },
        )
    };
    let effective = decide(effective);
    let requested = decide(requested);
    if effective != Cell::Deny && matches!(requested, Cell::Deny | Cell::Review) {
        requested
    } else {
        effective
    }
}

// Transcribed from origin_browser_certificates.rs `temporary_action`.
fn temporary_action(
    pin: Option<&CertIdentity>,
    cert: &CertIdentity,
    policy: &TrustPolicy,
    system_ca: bool,
    system_ca_valid: bool,
    validity_valid: bool,
) -> Cell {
    use TrustPolicy::*;
    let matches = |pin: &CertIdentity| {
        pin.fingerprint == cert.fingerprint
            && pin.chain_fingerprints == cert.chain_fingerprints
            && !pin.chain_fingerprints.is_empty()
    };
    if *policy == CaTrustOnly && !(system_ca && system_ca_valid) {
        return Cell::Deny;
    }
    if matches!(policy, Strict | CertificatePinning | CaTrustOnly) {
        if !validity_valid || pin.is_some_and(|pin| !matches(pin)) {
            return Cell::Deny;
        }
        if pin.is_none() && *policy != CaTrustOnly {
            return Cell::Deny;
        }
    }
    if !validity_valid || pin.is_some_and(|pin| !matches(pin)) || *policy == AlwaysAsk {
        return Cell::Review;
    }
    if pin.is_some() {
        return Cell::Allow;
    }
    if *policy == Tofu && !system_ca {
        return Cell::Review;
    }
    Cell::Remember
}

/// Saved connection: the real scoped Trust Center store plus `evaluate`'s
/// pinning and validity post-checks.
async fn saved_cell(
    evidence: &NativeCertificateEvidence,
    validity: Validity,
    stored: Option<&[Vec<u8>]>,
    policy: &TrustPolicy,
    system_mode: bool,
) -> Cell {
    let dir = tempfile::tempdir().unwrap();
    let state =
        TrustStoreService::new(dir.path().join("trust.json").to_string_lossy().into_owned());
    let mut service = state.lock().await;
    service.set_trust_policy(TrustPolicy::Tofu).await.unwrap();
    let origin = url::Url::parse(&evidence.origin).unwrap();
    let host = format!(
        "{CONNECTION_SCOPE_PREFIX}conn/{}/{}",
        origin.host_str().unwrap(),
        origin.port_or_known_default().unwrap()
    );
    if let Some(stored) = stored {
        service
            .trust_identity(
                host.clone(),
                "https".into(),
                Identity::Tls(Box::new(certificate(stored, Validity::Current))),
                true,
            )
            .await
            .unwrap();
    }
    let existing = service
        .get_effective_stored_identity(&host, "https")
        .unwrap();
    let effective = existing
        .as_ref()
        .and_then(|record| record.host_policy.clone())
        .unwrap_or(service.get_trust_policy().await);
    let system_ca_valid = evidence.system_ca_valid && system_mode;
    let presented = certificate(&evidence.chain_der, validity);
    let (result, ca_first_use) = service
        .verify_https_with_ca(
            &host,
            Identity::Tls(Box::new(presented.clone())),
            policy.clone(),
            system_ca_valid,
            |_, _, _| Ok(()),
        )
        .unwrap();
    let mut decision = combined_action(&result, &effective, policy, system_ca_valid, ca_first_use);
    if effective == TrustPolicy::CertificatePinning || *policy == TrustPolicy::CertificatePinning {
        if let Some(record) = &existing {
            match &record.identity {
                Identity::Tls(stored)
                    if stored.chain_fingerprints == presented.chain_fingerprints
                        && !stored.chain_fingerprints.is_empty() => {}
                _ => decision = Cell::Deny,
            }
        }
    }
    if decision == Cell::Remember && validity != Validity::Current {
        decision = Cell::Review;
    }
    decision
}

fn temporary_cell(
    evidence: &NativeCertificateEvidence,
    validity: Validity,
    stored: Option<&[Vec<u8>]>,
    policy: &TrustPolicy,
    system_mode: bool,
) -> Cell {
    let pin = stored.map(|chain| certificate(chain, Validity::Current));
    temporary_action(
        pin.as_ref(),
        &certificate(&evidence.chain_der, validity),
        policy,
        system_mode,
        evidence.system_ca_valid,
        validity == Validity::Current,
    )
}

/// Evidence the CEF bridge produced, or None when CEF denied before the
/// authority (non-admissible native result, or no evidence at all).
fn cef_evidence(row: &Row) -> Option<NativeCertificateEvidence> {
    let (native_error, fatal, mask, known_root) = row.cef?;
    admissible_native_result(native_error, fatal, mask)?;
    let authority = Authority::parse(row.authority).unwrap();
    let mut evidence: NativeTlsEvidence = cef_fixture(row.chain.clone(), Vec::new());
    evidence.hostname = authority.host().into();
    evidence.port = authority.port();
    evidence.origin = row.origin.into();
    evidence.native_error = native_error;
    evidence.fatal_error = fatal;
    evidence.allowed_exception_mask = mask;
    evidence.issued_by_known_root = known_root;
    evidence.ca_mode = NativeTlsCaMode::System;
    Some(cef_certificate_evidence(identity(), &evidence))
}

/// Evidence the proxy produced, or None for a fatal upstream (no prompt).
fn proxy_evidence(row: &Row) -> Option<NativeCertificateEvidence> {
    let system_ca_valid = row.proxy.ok()?;
    upstream_certificate_evidence(
        identity(),
        &UpstreamEvidence {
            authority: Authority::parse(row.authority).unwrap(),
            chain_der: row.chain.clone(),
            system_ca_valid,
            temporary_ok: true,
        },
    )
}

#[test]
fn every_row_hands_the_authority_identical_evidence() {
    for row in rows() {
        match (cef_evidence(&row), proxy_evidence(&row)) {
            (None, None) => {}
            (Some(cef), Some(proxy)) => {
                assert!(cef.identity == proxy.identity, "{}", row.name);
                assert_eq!(cef.origin, row.origin, "{}", row.name);
                assert_eq!(proxy.origin, row.origin, "{}", row.name);
                assert_eq!(cef.chain_der, proxy.chain_der, "{}", row.name);
                assert_eq!(proxy.chain_der, row.chain, "{}", row.name);
                assert_eq!(cef.system_ca_valid, proxy.system_ca_valid, "{}", row.name);
            }
            (cef, proxy) => panic!(
                "{}: CEF evidence {} but proxy evidence {}",
                row.name,
                cef.is_some(),
                proxy.is_some()
            ),
        }
    }
}

#[tokio::test]
async fn certificate_error_matrix_matches_cef_era_outcomes() {
    let mut cells = std::collections::BTreeMap::new();
    for row in rows() {
        let cef = cef_evidence(&row);
        let proxy = proxy_evidence(&row);
        for policy in &POLICIES {
            for saved in [true, false] {
                for system_mode in [true, false] {
                    let stored = row.stored.as_deref();
                    let validity = row.validity;
                    let decide = |evidence: Option<&NativeCertificateEvidence>| {
                        let evidence = evidence.map(|evidence| NativeCertificateEvidence {
                            identity: evidence.identity.clone(),
                            origin: evidence.origin.clone(),
                            chain_der: evidence.chain_der.clone(),
                            system_ca_valid: evidence.system_ca_valid,
                        });
                        async move {
                            let Some(evidence) = evidence else {
                                return Cell::Deny;
                            };
                            if saved {
                                saved_cell(&evidence, validity, stored, policy, system_mode).await
                            } else {
                                temporary_cell(&evidence, validity, stored, policy, system_mode)
                            }
                        }
                    };
                    let cef_cell = decide(cef.as_ref()).await;
                    let proxy_cell = decide(proxy.as_ref()).await;
                    assert_eq!(
                        proxy_cell, cef_cell,
                        "{} {policy:?} saved={saved} system={system_mode}",
                        row.name
                    );
                    if row.proxy.is_err() {
                        assert_eq!(proxy_cell, Cell::Deny, "{}: fatal never prompts", row.name);
                    }
                    cells.insert(
                        (row.name, format!("{policy:?}"), saved, system_mode),
                        proxy_cell,
                    );
                }
            }
        }
    }
    let cell = |row: &'static str, policy: &str, saved: bool, system: bool| {
        cells[&(row, policy.to_owned(), saved, system)]
    };
    // Plan section 3 headline table (saved connections, httpsCaTrustMode=system).
    assert_eq!(
        cell("valid-ca", "Tofu", true, true),
        Cell::Allow,
        "TOFU first use, CA-valid"
    );
    assert_eq!(
        cell("self-signed", "Tofu", true, true),
        Cell::Remember,
        "TOFU first use, not CA-valid"
    );
    assert_eq!(
        cell("valid-ca", "Tofu", true, false),
        Cell::Remember,
        "review mode never auto-allows"
    );
    // Only the intermediate changed: the leaf record still matches, so only
    // certificate pinning (exact chain) refuses it; AlwaysAsk always asks.
    for (policy, expected) in [
        ("Tofu", Cell::Allow),
        ("AlwaysAsk", Cell::Review),
        ("Strict", Cell::Allow),
        ("CertificatePinning", Cell::Deny),
        ("CaTrustOnly", Cell::Allow),
    ] {
        assert_eq!(
            cell("changed-intermediate", policy, true, true),
            expected,
            "{policy}"
        );
    }
    for changed in ["changed-leaf-after-tofu", "pinned-mismatch"] {
        for policy in ["Tofu", "AlwaysAsk"] {
            assert_eq!(
                cell(changed, policy, true, true),
                Cell::Review,
                "{changed} {policy}"
            );
        }
        for policy in ["Strict", "CertificatePinning", "CaTrustOnly"] {
            assert_eq!(
                cell(changed, policy, true, true),
                Cell::Deny,
                "{changed} {policy}"
            );
        }
    }
    assert_eq!(cell("valid-ca", "AlwaysAsk", true, true), Cell::Review);
    assert_eq!(cell("pinned-match", "AlwaysAsk", true, true), Cell::Review);
    assert_eq!(
        cell("pinned-match", "CertificatePinning", true, true),
        Cell::Allow
    );
    assert_eq!(cell("pinned-match", "Strict", true, true), Cell::Allow);
    assert_eq!(
        cell("valid-ca", "Strict", true, true),
        Cell::Deny,
        "strict needs preapproval"
    );
    // Global Tofu stays the effective policy: a CA-valid first use under a
    // requested CaTrustOnly is remembered (pinned), not merely allowed.
    assert_eq!(cell("valid-ca", "CaTrustOnly", true, true), Cell::Remember);
    assert_eq!(cell("self-signed", "CaTrustOnly", true, true), Cell::Deny);
    assert_eq!(
        cell("expired", "Tofu", true, true),
        Cell::Review,
        "dates never auto-remember"
    );
    assert_eq!(cell("wrong-name", "Tofu", true, true), Cell::Remember);
    assert_eq!(cell("ip-san-ok", "Tofu", true, true), Cell::Allow);
    assert_eq!(
        cell("ip-san-mismatch", "CaTrustOnly", true, true),
        Cell::Deny
    );
    // Temporary connections.
    assert_eq!(cell("valid-ca", "Tofu", false, true), Cell::Remember);
    assert_eq!(cell("valid-ca", "Tofu", false, false), Cell::Review);
    assert_eq!(cell("pinned-match", "Tofu", false, true), Cell::Allow);
    assert_eq!(
        cell("changed-leaf-after-tofu", "Tofu", false, true),
        Cell::Review
    );
    assert_eq!(
        cell("changed-leaf-after-tofu", "Strict", false, true),
        Cell::Deny
    );
    assert_eq!(cell("expired", "Tofu", false, true), Cell::Review);
    assert_eq!(cell("valid-ca", "CaTrustOnly", false, true), Cell::Remember);
    assert_eq!(cell("self-signed", "CaTrustOnly", false, true), Cell::Deny);
    // Fatal rows deny everywhere, without a prompt.
    for fatal in [
        "revoked",
        "bad-handshake-signature",
        "rsa-1024",
        "hsts-wrong-name",
    ] {
        for policy in [
            "Tofu",
            "AlwaysAsk",
            "Strict",
            "CertificatePinning",
            "CaTrustOnly",
        ] {
            for saved in [true, false] {
                for system in [true, false] {
                    assert_eq!(cell(fatal, policy, saved, system), Cell::Deny, "{fatal}");
                }
            }
        }
    }
    assert_eq!(cells.len(), rows().len() * POLICIES.len() * 4);
}

/// Minimal standard-alphabet base64 for the PEM fixture (app has no base64
/// dependency).
fn pem_body(pem: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bits = 0u32;
    let mut count = 0;
    let mut out = Vec::new();
    for byte in pem
        .lines()
        .filter(|line| !line.starts_with("---"))
        .flat_map(|line| line.trim().bytes())
        .take_while(|byte| *byte != b'=')
    {
        let value = ALPHABET.iter().position(|c| *c == byte).unwrap() as u32;
        bits = (bits << 6) | value;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    out
}

/// Real DER: a record approved from CEF evidence admits the proxy evidence
/// for the same chain (same leaf and chain fingerprints).
#[tokio::test]
async fn a_record_approved_under_cef_evidence_admits_the_proxy_evidence() {
    let pem = include_str!("../vendor/tiberius-rustls/docker/certs/server.crt");
    let der = pem_body(pem);
    let chain = vec![der.clone(), der];
    // Built the way `evaluate` builds its identity.
    let identity_of = |evidence: &NativeCertificateEvidence| {
        let captured =
            sorng_protocols::http::capture_peer_certificate_chain(&evidence.chain_der).unwrap();
        let mut value = serde_json::to_value(&captured).unwrap();
        value["first_seen"] = "2026-01-01T00:00:00Z".into();
        value["last_seen"] = "2026-01-01T00:00:00Z".into();
        value["chain_fingerprints"] = captured
            .chain
            .iter()
            .map(|entry| serde_json::Value::String(entry.fingerprint.clone()))
            .collect::<Vec<_>>()
            .into();
        serde_json::from_value::<CertIdentity>(value).unwrap()
    };
    let mut native = cef_fixture(chain.clone(), Vec::new());
    native.native_error = -202;
    native.allowed_exception_mask = 4;
    native.ca_mode = NativeTlsCaMode::System;
    let cef = cef_certificate_evidence(identity(), &native);
    let proxy = upstream_certificate_evidence(
        identity(),
        &UpstreamEvidence {
            authority: Authority::parse("device.test:443").unwrap(),
            chain_der: chain,
            system_ca_valid: false,
            temporary_ok: true,
        },
    )
    .unwrap();
    let approved = identity_of(&cef);
    let presented = identity_of(&proxy);
    assert_eq!(approved.fingerprint, presented.fingerprint);
    assert_eq!(approved.chain_fingerprints, presented.chain_fingerprints);
    assert_eq!(approved.chain_fingerprints.len(), 2);

    let dir = tempfile::tempdir().unwrap();
    let state =
        TrustStoreService::new(dir.path().join("trust.json").to_string_lossy().into_owned());
    let mut service = state.lock().await;
    service.set_trust_policy(TrustPolicy::Tofu).await.unwrap();
    let host = format!("{CONNECTION_SCOPE_PREFIX}conn/device.test/443");
    service
        .trust_identity(
            host.clone(),
            "https".into(),
            Identity::Tls(Box::new(approved)),
            true,
        )
        .await
        .unwrap();
    for policy in [
        TrustPolicy::Tofu,
        TrustPolicy::CertificatePinning,
        TrustPolicy::Strict,
    ] {
        let (result, _) = service
            .verify_https_with_ca(
                &host,
                Identity::Tls(Box::new(presented.clone())),
                policy.clone(),
                false,
                |_, _, _| Ok(()),
            )
            .unwrap();
        assert!(matches!(result, TrustVerifyResult::Trusted), "{policy:?}");
    }
}

/// t-mitmproxy m4: only an approval that arrives after its proxy request
/// ended (a 502 or a cancelled navigation) reloads the main frame.
#[test]
fn only_a_late_review_approval_reloads_the_main_frame() {
    let admit = UpstreamVerdict::Admit { persistent: false };
    assert!(late_approval(false, true, admit));
    assert!(late_approval(
        false,
        true,
        UpstreamVerdict::Admit { persistent: true }
    ));
    // Delivered in time: the request itself proceeds, no reload.
    assert!(!late_approval(true, true, admit));
    // No review: nothing the user did to react to.
    assert!(!late_approval(false, false, admit));
    // Denied or expired reviews never reload.
    assert!(!late_approval(false, true, UpstreamVerdict::Deny));
    assert!(!late_approval(false, true, UpstreamVerdict::Timeout));
}
