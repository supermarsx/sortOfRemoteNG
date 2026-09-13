use super::*;
use serde_json::json;
use std::cell::Cell;

fn identity(fingerprint: &str) -> Identity {
    serde_json::from_value(json!({"kind":"tls", "fingerprint":fingerprint,
        "first_seen":"2026-09-13", "last_seen":"2026-09-13"}))
    .unwrap()
}

fn add(data: &mut TrustStoreData, host: &str, fp: &str) {
    trust_identity_in_data(
        data,
        host.into(),
        "https".into(),
        identity(fp),
        true,
        IdentityChangeReason::Initial,
        None,
        None,
    );
}

fn service(path: &Path, data: &TrustStoreData) -> TrustStoreServiceState {
    persist_trust_store_data(path, data).unwrap();
    TrustStoreService::new(path.to_string_lossy().into_owned())
}

#[tokio::test]
async fn clean_ca_first_use_requires_native_proof_and_never_persists_a_pin() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("trust.json");
    let svc = service(&path, &TrustStoreData::default());
    let before = std::fs::read(&path).unwrap();
    let mut svc = svc.lock().await;
    let called = Cell::new(false);
    let (result, accepted) = svc
        .verify_https_with_ca(
            "@sorng/connection/v1/c/device.test/443",
            identity("aa"),
            TrustPolicy::Tofu,
            true,
            |host, port, fp| {
                called.set(true);
                assert_eq!((host, port, fp), ("device.test", 443, "aa"));
                Ok(())
            },
        )
        .unwrap();
    assert!(called.get());
    assert!(accepted);
    assert!(matches!(result, TrustVerifyResult::FirstUse { .. }));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(load_trust_store_data(&path).unwrap().records.is_empty());
    assert!(svc
        .verify_https_with_ca(
            "device.test:443",
            identity("aa"),
            TrustPolicy::Tofu,
            true,
            |_, _, _| Err("expired native proof".into())
        )
        .is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[tokio::test]
async fn review_mode_native_strict_and_explicit_ask_never_consume_ca_proof() {
    let dir = tempfile::tempdir().unwrap();
    for (native, requested, system) in [
        (TrustPolicy::Tofu, TrustPolicy::Tofu, false),
        (TrustPolicy::AlwaysAsk, TrustPolicy::Tofu, true),
        (TrustPolicy::Strict, TrustPolicy::Tofu, true),
        (TrustPolicy::Tofu, TrustPolicy::AlwaysAsk, true),
        (TrustPolicy::Tofu, TrustPolicy::Strict, true),
        (TrustPolicy::CaTrustOnly, TrustPolicy::Tofu, true),
        (TrustPolicy::CertificatePinning, TrustPolicy::Tofu, true),
    ] {
        let path = dir.path().join("trust.json");
        let svc = service(
            &path,
            &TrustStoreData {
                policy: native,
                ..Default::default()
            },
        );
        let (_, accepted) = svc
            .lock()
            .await
            .verify_https_with_ca(
                "device.test:443",
                identity("aa"),
                requested,
                system,
                |_, _, _| panic!("policy must block proof consumption"),
            )
            .unwrap();
        assert!(!accepted);
    }
}

#[tokio::test]
async fn native_records_revocation_forget_mismatch_and_pending_gates_win_over_ca() {
    let dir = tempfile::tempdir().unwrap();
    for scenario in [
        "matching",
        "mismatch",
        "revoked",
        "forgotten",
        "expired",
        "threshold",
        "verification",
        "pinning",
    ] {
        let mut data = TrustStoreData::default();
        add(
            &mut data,
            "device.test:443",
            if scenario == "mismatch" || scenario == "pinning" {
                "bb"
            } else {
                "aa"
            },
        );
        let key = "https:device.test:443";
        let record = data.records.get_mut(key).unwrap();
        match scenario {
            "revoked" => record.revoked = true,
            "expired" => {
                record.host_policy = Some(TrustPolicy::TofuWithExpiry);
                record.trust_expires = Some("2000-01-01T00:00:00Z".into());
            }
            "threshold" => record.host_policy = Some(TrustPolicy::ThresholdTrust),
            "verification" => {
                record.host_policy = Some(TrustPolicy::TrustOnVerify);
                record.user_approved = false;
            }
            "pinning" => record.host_policy = Some(TrustPolicy::CertificatePinning),
            "forgotten" => {
                data.records.clear();
                data.fresh_approval_required_keys = Some([key.into()].into_iter().collect());
            }
            _ => {}
        }
        let path = dir.path().join("trust.json");
        let svc = service(&path, &data);
        let (result, accepted) = svc
            .lock()
            .await
            .verify_https_with_ca(
                "@sorng/connection/v1/c/device.test/443",
                identity("aa"),
                TrustPolicy::Tofu,
                true,
                |_, _, _| panic!("existing decision must win"),
            )
            .unwrap();
        assert!(!accepted, "{scenario}");
        assert!(
            matches!(
                (scenario, result),
                ("matching", TrustVerifyResult::Trusted)
                    | ("mismatch", TrustVerifyResult::Mismatch { .. })
                    | ("revoked", TrustVerifyResult::Revoked { .. })
                    | (
                        "forgotten",
                        TrustVerifyResult::FirstUse {
                            requires_approval: true,
                            ..
                        },
                    )
                    | ("expired", TrustVerifyResult::Expired { .. })
                    | ("threshold", TrustVerifyResult::PendingThreshold { .. })
                    | (
                        "verification",
                        TrustVerifyResult::PendingVerification { .. }
                    )
                    | ("pinning", TrustVerifyResult::ChainMismatch { .. })
            ),
            "{scenario}"
        );
    }
}

#[tokio::test]
async fn fresh_native_read_observes_revocation_and_malformed_store_without_consuming_proof() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("trust.json");
    let svc = service(&path, &TrustStoreData::default());
    let mut data = TrustStoreData::default();
    add(&mut data, "device.test:443", "aa");
    data.records
        .get_mut("https:device.test:443")
        .unwrap()
        .revoked = true;
    persist_trust_store_data(&path, &data).unwrap();
    let (result, accepted) = svc
        .lock()
        .await
        .verify_https_with_ca(
            "device.test:443",
            identity("aa"),
            TrustPolicy::Tofu,
            true,
            |_, _, _| panic!("revocation wins"),
        )
        .unwrap();
    assert!(matches!(result, TrustVerifyResult::Revoked { .. }));
    assert!(!accepted);
    std::fs::write(&path, b"malformed").unwrap();
    assert!(svc
        .lock()
        .await
        .verify_https_with_ca(
            "device.test:443",
            identity("aa"),
            TrustPolicy::Tofu,
            true,
            |_, _, _| panic!("failed read cannot consume evidence")
        )
        .is_err());
}

#[tokio::test]
async fn scoped_ca_decision_refuses_wrong_closed_and_replaced_database_owners() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let dir = tempfile::tempdir().unwrap();
    let guard =
        test_support::install_active_runtime_for_tests(dir.path().join("databases"), "first");
    let service = TrustStoreService::shared();
    let service = service.lock().await;
    for active in [Some("second".to_string()), None] {
        let mut scoped = service.scoped_to_database(Some("first".into())).unwrap();
        guard.runtime.set_active(active, None).unwrap();
        assert!(scoped
            .verify_https_with_ca(
                "device.test:443",
                identity("aa"),
                TrustPolicy::Tofu,
                true,
                |_, _, _| panic!("owner mismatch must win")
            )
            .is_err());
    }
    guard
        .runtime
        .set_active(Some("first".into()), None)
        .unwrap();
    let mut scoped = service.scoped_to_database(Some("first".into())).unwrap();
    let (_, accepted) = scoped
        .verify_https_with_ca(
            "device.test:443",
            identity("aa"),
            TrustPolicy::Tofu,
            true,
            |_, _, _| Ok(()),
        )
        .unwrap();
    assert!(accepted);
    assert!(guard
        .runtime
        .export(Some("first"))
        .unwrap()
        .records
        .is_empty());
}
