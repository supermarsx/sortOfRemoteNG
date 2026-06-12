//! Unit tests for the TOFU decision core and the verifier's store interaction.
//!
//! The pure [`decide_tls_trust`] matrix is exercised directly. The verifier's
//! store-driven TOFU lifecycle (pin-on-first-use → accept-on-match →
//! reject-on-mismatch) is exercised through a [`StubStore`] that mimics the
//! persistent Trust Center without touching disk or the network.

use super::*;
use std::collections::HashMap;
use std::sync::Mutex;

// ── Pure decision matrix ────────────────────────────────────────────────────

#[test]
fn match_always_accepts() {
    for policy in [
        TrustPolicy::Tofu,
        TrustPolicy::AlwaysAsk,
        TrustPolicy::Strict,
    ] {
        assert_eq!(
            decide_tls_trust(StoreVerdict::Match, &policy, true),
            TlsTrustAction::Accept,
            "Match should accept under {policy:?}"
        );
        assert_eq!(
            decide_tls_trust(StoreVerdict::Match, &policy, false),
            TlsTrustAction::Accept,
            "Match should accept under {policy:?} even with invalid chain"
        );
    }
}

#[test]
fn changed_rejects_under_every_policy_except_always_trust() {
    for policy in [
        TrustPolicy::Tofu,
        TrustPolicy::AlwaysAsk,
        TrustPolicy::Strict,
        TrustPolicy::TofuWithExpiry,
    ] {
        assert!(
            matches!(
                decide_tls_trust(StoreVerdict::Changed, &policy, true),
                TlsTrustAction::Reject(_)
            ),
            "Changed must reject under {policy:?} (MITM)"
        );
    }
}

#[test]
fn unknown_under_tofu_persists() {
    assert_eq!(
        decide_tls_trust(StoreVerdict::Unknown, &TrustPolicy::Tofu, false),
        TlsTrustAction::AcceptAndPersist
    );
}

#[test]
fn unknown_under_always_ask_degrades_to_tofu_persist() {
    // Non-interactive backends cannot prompt; AlwaysAsk degrades to TOFU.
    assert_eq!(
        decide_tls_trust(StoreVerdict::Unknown, &TrustPolicy::AlwaysAsk, true),
        TlsTrustAction::AcceptAndPersist
    );
}

#[test]
fn unknown_under_strict_rejects() {
    assert!(matches!(
        decide_tls_trust(StoreVerdict::Unknown, &TrustPolicy::Strict, false),
        TlsTrustAction::Reject(_)
    ));
}

#[test]
fn always_trust_accepts_everything_without_persisting() {
    for verdict in [
        StoreVerdict::Unknown,
        StoreVerdict::Match,
        StoreVerdict::Changed,
    ] {
        assert_eq!(
            decide_tls_trust(verdict, &TrustPolicy::AlwaysTrust, false),
            TlsTrustAction::Accept,
            "AlwaysTrust accepts {verdict:?}"
        );
    }
}

// ── Stub store ──────────────────────────────────────────────────────────────

/// In-memory stand-in for the persistent Trust Center store. Records are keyed
/// `record_type:host` exactly like `SyncTrustStore`.
#[derive(Default)]
struct StubStore {
    records: Mutex<HashMap<String, String>>, // key -> stored fingerprint
    policy: TrustPolicy,
}

impl StubStore {
    fn with_policy(policy: TrustPolicy) -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            policy,
        }
    }

    fn key(record_type: &str, host: &str) -> String {
        format!("{record_type}:{host}")
    }

    fn record_count(&self) -> usize {
        self.records.lock().unwrap().len()
    }
}

impl BlockingTrustStore for StubStore {
    fn verify(
        &self,
        host: &str,
        record_type: &str,
        identity: Identity,
    ) -> Result<TrustVerifyResult, String> {
        let presented_fp = match &identity {
            Identity::Tls(c) => c.fingerprint.clone(),
            Identity::Ssh(s) => s.fingerprint.clone(),
        };
        let records = self.records.lock().unwrap();
        match records.get(&Self::key(record_type, host)) {
            None => Ok(TrustVerifyResult::FirstUse { identity }),
            Some(stored) if *stored == presented_fp => Ok(TrustVerifyResult::Trusted),
            Some(stored) => Ok(TrustVerifyResult::Mismatch {
                stored: Identity::Tls(CertIdentity {
                    fingerprint: stored.clone(),
                    subject: None,
                    issuer: None,
                    first_seen: String::new(),
                    last_seen: String::new(),
                    valid_from: None,
                    valid_to: None,
                    pem: None,
                    serial: None,
                    signature_algorithm: None,
                    san: None,
                    chain_fingerprints: Vec::new(),
                }),
                presented: identity,
            }),
        }
    }

    fn trust(
        &self,
        host: String,
        record_type: String,
        identity: Identity,
        _user_approved: bool,
    ) -> Result<(), String> {
        let fp = match &identity {
            Identity::Tls(c) => c.fingerprint.clone(),
            Identity::Ssh(s) => s.fingerprint.clone(),
        };
        self.records
            .lock()
            .unwrap()
            .insert(Self::key(&record_type, &host), fp);
        Ok(())
    }

    fn global_policy(&self) -> TrustPolicy {
        self.policy.clone()
    }
}

fn tls_identity(fp: &str) -> Identity {
    Identity::Tls(CertIdentity {
        fingerprint: fp.to_string(),
        subject: Some("CN=test".into()),
        issuer: Some("CN=test".into()),
        first_seen: "now".into(),
        last_seen: "now".into(),
        valid_from: None,
        valid_to: None,
        pem: None,
        serial: None,
        signature_algorithm: None,
        san: None,
        chain_fingerprints: Vec::new(),
    })
}

/// Drive the same decision flow the verifier uses, but against the stub store
/// and a synthetic identity (no live handshake required). Returns the action
/// and, on AcceptAndPersist, performs the persist so the lifecycle advances.
fn run_decision(store: &StubStore, host_key: &str, fp: &str) -> TlsTrustAction {
    let identity = tls_identity(fp);
    let policy = store.global_policy();
    let verdict = if matches!(policy, TrustPolicy::AlwaysTrust) {
        StoreVerdict::Unknown
    } else {
        let result = store
            .verify(host_key, TLS_RECORD_TYPE, identity.clone())
            .unwrap();
        StoreVerdict::from_verify_result(&result)
    };
    let action = decide_tls_trust(verdict, &policy, true);
    if action == TlsTrustAction::AcceptAndPersist {
        store
            .trust(host_key.to_string(), TLS_RECORD_TYPE.to_string(), identity, false)
            .unwrap();
    }
    action
}

// ── Store-driven TOFU lifecycle ─────────────────────────────────────────────

#[test]
fn tofu_pins_on_first_use() {
    let store = StubStore::with_policy(TrustPolicy::Tofu);
    assert_eq!(store.record_count(), 0);

    let action = run_decision(&store, "bmc.example.com:443", "aa11");
    assert_eq!(action, TlsTrustAction::AcceptAndPersist);
    assert_eq!(store.record_count(), 1, "first use must pin a record");
}

#[test]
fn tofu_accepts_on_subsequent_match() {
    let store = StubStore::with_policy(TrustPolicy::Tofu);
    run_decision(&store, "bmc.example.com:443", "aa11"); // pin

    let action = run_decision(&store, "bmc.example.com:443", "aa11"); // same fp
    assert_eq!(action, TlsTrustAction::Accept);
    assert_eq!(store.record_count(), 1, "no duplicate record on match");
}

#[test]
fn tofu_rejects_on_mismatch() {
    let store = StubStore::with_policy(TrustPolicy::Tofu);
    run_decision(&store, "bmc.example.com:443", "aa11"); // pin

    let action = run_decision(&store, "bmc.example.com:443", "bb22"); // rotated/MITM
    assert!(
        matches!(action, TlsTrustAction::Reject(_)),
        "a changed certificate must be rejected, got {action:?}"
    );
    // The stored identity must NOT be overwritten by a mismatch.
    assert_eq!(store.record_count(), 1);
}

#[test]
fn always_trust_override_accepts_unstored() {
    let store = StubStore::with_policy(TrustPolicy::AlwaysTrust);
    let action = run_decision(&store, "lab-bmc.local:443", "cc33");
    assert_eq!(action, TlsTrustAction::Accept);
    assert_eq!(
        store.record_count(),
        0,
        "AlwaysTrust must not write a record"
    );
}

// ── skip_flag mapping ───────────────────────────────────────────────────────

#[test]
fn skip_flag_maps_to_always_trust() {
    assert_eq!(skip_flag_to_override(true), Some(TrustPolicy::AlwaysTrust));
    assert_eq!(skip_flag_to_override(false), None);
}

// ── SyncTrustStore round-trip (real façade, temp file) ──────────────────────

#[test]
fn sync_facade_round_trips_through_disk() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("trust_store.json");
    let store = SyncTrustStore::new(path);

    let id = tls_identity("deadbeef");
    // First use → FirstUse
    let r1 = store
        .verify_identity_blocking("h:443", TLS_RECORD_TYPE, id.clone())
        .unwrap();
    assert!(matches!(r1, TrustVerifyResult::FirstUse { .. }));

    // Pin it
    store
        .trust_identity_blocking("h:443".into(), TLS_RECORD_TYPE.into(), id.clone(), false)
        .unwrap();

    // Now it matches
    let r2 = store
        .verify_identity_blocking("h:443", TLS_RECORD_TYPE, id)
        .unwrap();
    assert!(matches!(r2, TrustVerifyResult::Trusted), "got {r2:?}");

    // A different fingerprint mismatches
    let r3 = store
        .verify_identity_blocking("h:443", TLS_RECORD_TYPE, tls_identity("feedface"))
        .unwrap();
    assert!(matches!(r3, TrustVerifyResult::Mismatch { .. }), "got {r3:?}");
}
