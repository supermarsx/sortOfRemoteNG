use super::*;

const ALIAS: &str = "https://example.quickconnect.to/";
const NAS: &str = "https://example.fr3.quickconnect.to/";

fn config() -> BasicAuthProxyConfig {
    serde_json::from_value(serde_json::json!({
        "target_url":ALIAS, "username":"synthetic-user", "password":"synthetic-password",
        "upstream_auth_mode":"synology-form", "http_auto_login":true,
        "connection_id":"synthetic-owner", "redirect_profile":"synology"
    }))
    .unwrap()
}

fn defaults() -> SynologyQuickConnectDefaults {
    SynologyQuickConnectDefaults {
        version: 1,
        original_origin: ALIAS.trim_end_matches('/').into(),
    }
}

fn intent() -> DeferredSynologyLogin {
    DeferredSynologyLogin::capture(&config(), &defaults(), &Url::parse(ALIAS).unwrap())
        .unwrap()
        .unwrap()
}

#[test]
fn captures_only_original_explicit_staged_consent_and_bounded_credentials() {
    for mode in [
        UpstreamAuthMode::None,
        UpstreamAuthMode::Basic,
        UpstreamAuthMode::BitwardenForm,
    ] {
        let mut config = config();
        config.upstream_auth_mode = mode;
        assert!(
            DeferredSynologyLogin::capture(&config, &defaults(), &Url::parse(ALIAS).unwrap())
                .unwrap()
                .is_none()
        );
    }
    let mut manual = config();
    manual.http_auto_login = false;
    assert!(
        DeferredSynologyLogin::capture(&manual, &defaults(), &Url::parse(ALIAS).unwrap())
            .unwrap()
            .is_none()
    );
    for mutation in 0..5 {
        let mut config = config();
        match mutation {
            0 => config.username.clear(),
            1 => config.password.clear(),
            2 => config.password = "x".repeat(16 * 1024 + 1),
            3 => config.continuation_id = Some("untrusted-ticket".into()),
            _ => config.target_url = "http://example.quickconnect.to/".into(),
        }
        assert!(DeferredSynologyLogin::capture(
            &config,
            &defaults(),
            &Url::parse(&config.target_url).unwrap()
        )
        .is_err());
    }
    assert!(
        DeferredSynologyLogin::capture(&config(), &defaults(), &Url::parse(NAS).unwrap()).is_err()
    );
}

#[test]
fn proof_is_required_and_origin_capacity_and_login_paths_are_bounded() {
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    assert!(!intent.bind("nas", 1, &target));
    for index in 0..MAX_VERIFIED_ORIGINS {
        intent.record_probe(format!("https://example.ab{index}.quickconnect.to"));
    }
    intent.record_probe(target.origin().ascii_serialization());
    assert_eq!(intent.verified_origins.len(), MAX_VERIFIED_ORIGINS);
    assert!(!intent.bind("nas", 1, &target));
    let mut fresh = self::intent();
    fresh.record_probe(target.origin().ascii_serialization());
    assert!(!fresh.bind("nas", 0, &target));
    assert!(!fresh.bind("nas", 1, &target.join("webapi/auth.cgi").unwrap()));
    assert!(fresh.bind("nas", 1, &target.join("webman/index.cgi").unwrap()));
}

#[test]
fn staged_single_use_grants_never_fall_back_to_combined_credentials() {
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    intent.record_probe(target.origin().ascii_serialization());
    assert!(intent.bind("nas", 7, &target));
    let nonce = intent.nonce("nas", 7).unwrap();
    assert!(intent.nonce("other", 7).is_none());
    for (session, document, token, phase) in [
        ("other", 7, nonce.as_str(), None),
        ("nas", 8, nonce.as_str(), None),
        ("nas", 7, "wrong", None),
        ("nas", 7, nonce.as_str(), Some("password")),
    ] {
        assert!(intent.dispense(session, document, token, phase).is_err());
    }
    let account = intent.dispense("nas", 7, &nonce, None).unwrap();
    assert_eq!(account["loginFlow"], "synology");
    assert_eq!(account["username"], "synthetic-user");
    assert!(account.get("password").is_none());
    assert!(intent.username.is_none());
    assert!(intent.dispense("nas", 7, &nonce, None).is_err());
    let token = account["continuation"].as_str().unwrap();
    let password = intent.dispense("nas", 7, token, Some("password")).unwrap();
    assert_eq!(password["password"], "synthetic-password");
    assert!(password.get("username").is_none());
    assert!(intent.password.is_none());
    assert!(intent.dispense("nas", 7, token, Some("password")).is_err());
    assert!(!intent.bind("nas", 9, &target));
}

#[test]
fn expiry_and_cancellation_erase_secrets_and_never_rearm() {
    for pending in [true, false] {
        let mut intent = intent();
        let target = Url::parse(NAS).unwrap();
        intent.record_probe(target.origin().ascii_serialization());
        if pending {
            intent.created = Instant::now() - INTENT_LIFETIME;
        } else {
            assert!(intent.bind("nas", 1, &target));
            if let Phase::Account { issued, .. } = &mut intent.phase {
                *issued = Instant::now() - READINESS_LIFETIME;
            }
        }
        intent.expire();
        assert!(intent.username.is_none() && intent.password.is_none());
        assert!(matches!(intent.phase, Phase::Spent(_)));
        assert!(!intent.bind("nas", 1, &target));
    }
    let mut pending = intent();
    pending.cancel_issued();
    assert!(pending.password.is_some()); // Anonymous handoffs preserve pending intent.
    let target = Url::parse(NAS).unwrap();
    pending.record_probe(target.origin().ascii_serialization());
    assert!(pending.bind("nas", 1, &target));
    pending.cancel_issued();
    assert!(pending.username.is_none() && pending.password.is_none());
}

#[test]
fn original_explicit_nas_target_does_not_need_provider_probe_but_alias_does() {
    let mut config = config();
    config.target_url = NAS.into();
    let defaults = SynologyQuickConnectDefaults {
        version: 1,
        original_origin: NAS.trim_end_matches('/').into(),
    };
    let target = Url::parse(NAS).unwrap();
    let mut intent = DeferredSynologyLogin::capture(&config, &defaults, &target)
        .unwrap()
        .unwrap();
    assert!(intent.bind("original-nas", 1, &target));
}

#[test]
fn late_landing_has_independent_readiness_and_password_windows() {
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    intent.created = Instant::now() - Duration::from_secs(119);
    intent.record_probe(target.origin().ascii_serialization());
    assert!(intent.bind("nas", 7, &target));
    let nonce = intent.nonce("nas", 7).unwrap();
    // Simulate the old routing timer firing after a late successful landing.
    // It must inspect the current phase, not destroy the fresh page grant.
    intent.created = Instant::now() - Duration::from_secs(180);
    if let Phase::Account { issued, .. } = &mut intent.phase {
        *issued = Instant::now() - Duration::from_secs(61);
    }
    intent.expire();
    assert!(intent.username.is_some() && intent.password.is_some());
    assert_eq!(intent.nonce("nas", 7).as_deref(), Some(nonce.as_str()));
    let reply = intent.dispense("nas", 7, &nonce, None).unwrap();
    assert!(reply.get("password").is_none());
    let next = reply["continuation"].as_str().unwrap();
    if let Phase::Password { issued, .. } = &mut intent.phase {
        *issued = Instant::now() - Duration::from_secs(29);
    }
    intent.expire();
    assert!(intent.password.is_some());
    let password = intent.dispense("nas", 7, next, Some("password")).unwrap();
    assert_eq!(password["password"], "synthetic-password");
    assert!(intent.spent_for_test());
}

#[test]
fn repeated_binding_or_readiness_reads_cannot_extend_page_deadline() {
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    intent.record_probe(target.origin().ascii_serialization());
    assert!(intent.bind("nas", 1, &target));
    let issued = Instant::now() - Duration::from_secs(119);
    if let Phase::Account {
        issued: current, ..
    } = &mut intent.phase
    {
        *current = issued;
    }
    for _ in 0..4 {
        assert!(intent.bind("nas", 1, &target));
        assert!(intent.nonce("nas", 1).is_some());
        assert_eq!(intent.status(), DeferredSynologyLoginStatus::WaitingForForm);
        assert!(
            matches!(&intent.phase, Phase::Account { issued: current, .. } if *current == issued)
        );
    }
    if let Phase::Account { issued, .. } = &mut intent.phase {
        *issued = Instant::now() - READINESS_LIFETIME;
    }
    assert!(intent.nonce("nas", 1).is_none());
    assert!(intent.spent_for_test());
    assert!(!intent.bind("nas", 1, &target));
}

#[test]
fn password_deadline_still_expires_at_thirty_seconds_without_replay() {
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    intent.record_probe(target.origin().ascii_serialization());
    assert!(intent.bind("nas", 1, &target));
    let nonce = intent.nonce("nas", 1).unwrap();
    let account = intent.dispense("nas", 1, &nonce, None).unwrap();
    let token = account["continuation"].as_str().unwrap();
    if let Phase::Password { issued, .. } = &mut intent.phase {
        *issued = Instant::now() - STAGE_LIFETIME;
    }
    assert!(intent.dispense("nas", 1, token, Some("password")).is_err());
    assert!(intent.spent_for_test());
    assert!(intent.dispense("nas", 1, &nonce, None).is_err());
}

#[test]
fn status_tracks_native_handout_without_claiming_sign_in_or_releasing_credentials() {
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::AwaitingNas);
    assert!(intent.username.is_some() && intent.password.is_some());
    assert!(!intent.bind("nas", 1, &target));
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::AwaitingNas);
    intent.record_probe(target.origin().ascii_serialization());
    assert!(intent.bind("nas", 1, &target));
    let nonce = intent.nonce("nas", 1).unwrap();
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::WaitingForForm);
    assert!(intent.username.is_some() && intent.password.is_some());
    let account = intent.dispense("nas", 1, &nonce, None).unwrap();
    assert_eq!(
        intent.status(),
        DeferredSynologyLoginStatus::WaitingForPassword
    );
    assert!(intent.username.is_none() && intent.password.is_some());
    let continuation = account["continuation"].as_str().unwrap();
    let _password = intent
        .dispense("nas", 1, continuation, Some("password"))
        .unwrap();
    for _ in 0..3 {
        intent.cancel_issued();
        assert_eq!(
            intent.status(),
            DeferredSynologyLoginStatus::CredentialsReleased
        );
        assert!(intent.spent_for_test());
        assert!(intent.dispense("nas", 1, &nonce, None).is_err());
        assert!(!intent.bind("nas", 2, &target));
    }
}

#[test]
fn status_preserves_actual_expiry_or_cancellation_without_renewal() {
    let mut pending = intent();
    pending.created = Instant::now() - INTENT_LIFETIME;
    assert_eq!(pending.status(), DeferredSynologyLoginStatus::Expired);
    pending.cancel_issued();
    assert_eq!(pending.status(), DeferredSynologyLoginStatus::Expired);
    assert!(pending.spent_for_test());

    let mut bound = intent();
    let target = Url::parse(NAS).unwrap();
    bound.record_probe(target.origin().ascii_serialization());
    assert!(bound.bind("nas", 1, &target));
    bound.cancel_issued();
    assert_eq!(bound.status(), DeferredSynologyLoginStatus::Cancelled);
    bound.created = Instant::now() - INTENT_LIFETIME;
    assert_eq!(bound.status(), DeferredSynologyLoginStatus::Cancelled);
    assert!(bound.spent_for_test());
}

#[test]
fn status_serialization_is_a_closed_scalar_and_old_session_responses_remain_readable() {
    for (status, expected) in [
        (DeferredSynologyLoginStatus::AwaitingNas, "awaiting_nas"),
        (
            DeferredSynologyLoginStatus::WaitingForForm,
            "waiting_for_form",
        ),
        (
            DeferredSynologyLoginStatus::WaitingForPassword,
            "waiting_for_password",
        ),
        (
            DeferredSynologyLoginStatus::CredentialsReleased,
            "credentials_released",
        ),
        (DeferredSynologyLoginStatus::Expired, "expired"),
        (DeferredSynologyLoginStatus::Cancelled, "cancelled"),
    ] {
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json, expected);
        assert_eq!(
            serde_json::from_value::<DeferredSynologyLoginStatus>(json).unwrap(),
            status
        );
    }
    assert!(serde_json::from_str::<DeferredSynologyLoginStatus>("\"signed_in\"").is_err());
    let legacy = serde_json::json!({
        "local_port": 1234, "session_id": "fixture", "proxy_url": "http://fixture.localhost:1234/"
    });
    let response: crate::http::ProxyMediatorResponse =
        serde_json::from_value(legacy.clone()).unwrap();
    assert!(response.deferred_login_status.is_none());
    assert_eq!(serde_json::to_value(response).unwrap(), legacy);
    let status = intent().status();
    let response = crate::http::ProxyMediatorResponse {
        local_port: 1234,
        session_id: "fixture".into(),
        proxy_url: "http://fixture.localhost:1234/".into(),
        deferred_login_status: Some(status),
    };
    let json = serde_json::to_value(response).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 4);
    assert_eq!(json["deferred_login_status"], "awaiting_nas");
    let text = json.to_string();
    for private in [
        "synthetic-user",
        "synthetic-password",
        "nonce",
        "continuation",
    ] {
        assert!(!text.contains(private));
    }
}
