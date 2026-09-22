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
            // The verified probe above renewed the intent; age both clocks.
            intent.age_for_test();
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
fn password_deadline_expires_at_ninety_seconds_without_replay() {
    assert_eq!(STAGE_LIFETIME, Duration::from_secs(90));
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    intent.record_probe(target.origin().ascii_serialization());
    assert!(intent.bind("nas", 1, &target));
    let nonce = intent.nonce("nas", 1).unwrap();
    let account = intent.dispense("nas", 1, &nonce, None).unwrap();
    let token = account["continuation"].as_str().unwrap();
    // A slow password panel inside the stage keeps the grant.
    if let Phase::Password { issued, .. } = &mut intent.phase {
        *issued = Instant::now() - Duration::from_secs(89);
    }
    assert_eq!(
        intent.status(),
        DeferredSynologyLoginStatus::WaitingForPassword
    );
    assert!(intent.password.is_some());
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
        google_routes: Vec::new(),
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

#[test]
fn status_wire_parity_between_start_and_session_details() {
    use crate::http::{ProxyMediatorResponse, ProxySessionDetail};

    for (status, wire) in [
        (
            Some(DeferredSynologyLoginStatus::AwaitingNas),
            Some("awaiting_nas"),
        ),
        (
            Some(DeferredSynologyLoginStatus::WaitingForForm),
            Some("waiting_for_form"),
        ),
        (
            Some(DeferredSynologyLoginStatus::WaitingForPassword),
            Some("waiting_for_password"),
        ),
        (
            Some(DeferredSynologyLoginStatus::CredentialsReleased),
            Some("credentials_released"),
        ),
        (Some(DeferredSynologyLoginStatus::Expired), Some("expired")),
        (
            Some(DeferredSynologyLoginStatus::Cancelled),
            Some("cancelled"),
        ),
        (None, None),
    ] {
        let start = ProxyMediatorResponse {
            local_port: 1234,
            session_id: "fixture-session".into(),
            proxy_url: "http://fixture.localhost:1234/".into(),
            google_routes: Vec::new(),
            deferred_login_status: status,
        };
        let details = vec![ProxySessionDetail {
            session_id: start.session_id.clone(),
            target_url: "https://fixture.invalid/".into(),
            username: String::new(),
            connection_id: "fixture-connection".into(),
            proxy_url: start.proxy_url.clone(),
            created_at: "2026-09-14T00:00:00Z".into(),
            request_count: 3,
            error_count: 0,
            last_error: None,
            deferred_login_status: status,
        }];
        let mut expected_start = serde_json::json!({
            "local_port": 1234,
            "session_id": "fixture-session",
            "proxy_url": "http://fixture.localhost:1234/"
        });
        let mut expected_detail = serde_json::json!({
            "session_id": "fixture-session",
            "target_url": "https://fixture.invalid/",
            "username": "",
            "connection_id": "fixture-connection",
            "proxy_url": "http://fixture.localhost:1234/",
            "created_at": "2026-09-14T00:00:00Z",
            "request_count": 3,
            "error_count": 0,
            "last_error": null
        });
        if let Some(wire) = wire {
            expected_start["deferred_login_status"] = wire.into();
            expected_detail["deferred_login_status"] = wire.into();
        }

        // Start returns one object; the details command returns an array. Both
        // preserve the same snake_case field and closed scalar without a wrapper.
        let start_wire = serde_json::to_value(&start).unwrap();
        let details_wire = serde_json::to_value(&details).unwrap();
        assert_eq!(start_wire, expected_start);
        assert_eq!(details_wire, serde_json::json!([expected_detail]));
        assert_eq!(
            start_wire.get("deferred_login_status"),
            details_wire[0].get("deferred_login_status")
        );
        assert_eq!(
            serde_json::from_value::<ProxyMediatorResponse>(start_wire)
                .unwrap()
                .deferred_login_status,
            status
        );
        assert_eq!(
            serde_json::from_value::<Vec<ProxySessionDetail>>(details_wire).unwrap()[0]
                .deferred_login_status,
            status
        );
    }
}

fn bound_intent(document: u64) -> (DeferredSynologyLogin, Url, String) {
    let mut intent = intent();
    let target = Url::parse(NAS).unwrap();
    intent.record_probe(target.origin().ascii_serialization());
    assert!(intent.bind("nas", document, &target));
    let nonce = intent.nonce("nas", document).unwrap();
    (intent, target, nonce)
}

#[test]
fn account_phase_successor_rebinds_with_fresh_nonce_and_old_page_nonce_dies() {
    let (mut intent, target, first) = bound_intent(1);
    let dsm = target.join("webman/index.cgi").unwrap();
    // A markerless successor response, not yet selected by the frontend.
    assert!(intent.record_successor("nas", 2, &dsm, Some(1)).is_some());
    let second = intent.nonce("nas", 2).unwrap();
    assert_ne!(first, second);
    // Recording the same document again neither re-mints nor renews.
    assert!(intent.record_successor("nas", 2, &dsm, Some(1)).is_none());
    assert_eq!(intent.nonce("nas", 2).as_deref(), Some(second.as_str()));
    // While the first page is selected, the successor cannot redeem.
    assert!(intent.dispense("nas", 1, &second, None).is_err());
    // Once the successor is selected, the old page nonce is dead.
    assert!(intent.dispense("nas", 2, &first, None).is_err());
    // Ineligible successors never bind and never cancel readiness.
    let other_origin = Url::parse("https://other.fr3.quickconnect.to/").unwrap();
    assert!(intent.record_successor("other", 3, &dsm, Some(2)).is_none());
    assert!(intent
        .record_successor("nas", 3, &target.join("webapi/entry.cgi").unwrap(), Some(2))
        .is_none());
    assert!(intent
        .record_successor("nas", 3, &other_origin, Some(2))
        .is_none());
    assert!(intent.record_successor("nas", 0, &dsm, Some(2)).is_none());
    for document in [3, 4] {
        assert!(intent.nonce("nas", document).is_none());
    }
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::WaitingForForm);
    assert!(intent.username.is_some() && intent.password.is_some());
    let account = intent.dispense("nas", 2, &second, None).unwrap();
    assert_eq!(account["username"], "synthetic-user");
    assert!(account.get("password").is_none());
    assert_eq!(intent.document("nas"), Some(2));
    let token = account["continuation"].as_str().unwrap();
    let password = intent.dispense("nas", 2, token, Some("password")).unwrap();
    assert_eq!(password["password"], "synthetic-password");
    assert!(intent.spent_for_test());
}

#[test]
fn selected_marked_primary_rebinds_account_phase_instead_of_cancelling() {
    let (mut intent, target, first) = bound_intent(1);
    assert!(intent.bind("nas", 2, &target));
    let second = intent.nonce("nas", 2).unwrap();
    assert_ne!(first, second);
    assert!(intent.nonce("nas", 1).is_none());
    assert_eq!(intent.document("nas"), Some(2));
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::WaitingForForm);
    assert!(intent.dispense("nas", 2, &first, None).is_err());
    assert!(intent.dispense("nas", 2, &second, None).is_ok());
}

#[test]
fn released_username_ignores_successors_and_selection_change_cancels() {
    let (mut intent, target, first) = bound_intent(1);
    let account = intent.dispense("nas", 1, &first, None).unwrap();
    let token = account["continuation"].as_str().unwrap().to_owned();
    let dsm = target.join("webman/index.cgi").unwrap();
    // A child or markerless successor response neither rebinds nor cancels.
    assert!(intent.record_successor("nas", 2, &dsm, Some(1)).is_none());
    assert!(intent.nonce("nas", 2).is_none());
    assert_eq!(
        intent.status(),
        DeferredSynologyLoginStatus::WaitingForPassword
    );
    assert!(intent.password.is_some());
    // The frontend selecting another document cancels the released username.
    assert!(intent.dispense("nas", 2, &token, Some("password")).is_err());
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::Cancelled);
    assert!(intent.spent_for_test());
    assert!(intent.dispense("nas", 1, &token, Some("password")).is_err());

    // A selected marked primary after release still cancels.
    let (mut marked, target, first) = bound_intent(1);
    marked.dispense("nas", 1, &first, None).unwrap();
    assert!(!marked.bind("nas", 2, &target));
    assert_eq!(marked.status(), DeferredSynologyLoginStatus::Cancelled);
    assert!(marked.spent_for_test());
}

#[test]
fn readiness_idles_from_latest_bind_with_absolute_cap() {
    assert_eq!(READINESS_LIFETIME, Duration::from_secs(300));
    assert_eq!(READINESS_CAP, Duration::from_secs(600));
    let secs = Duration::from_secs;
    for (latest, first, left) in [
        (0, 0, 300),
        (299, 299, 1),
        (300, 300, 0),
        (0, 450, 150),
        (120, 599, 1),
        (0, 600, 0),
        (10, 900, 0),
    ] {
        assert_eq!(readiness_left(secs(latest), secs(first)), secs(left));
    }

    let (mut intent, target, _) = bound_intent(1);
    let Phase::Account { first_bound, .. } = &intent.phase else {
        unreachable!()
    };
    let first_bound = *first_bound;
    if let Phase::Account { issued, .. } = &mut intent.phase {
        *issued = Instant::now() - secs(290);
    }
    assert!(intent.remaining().unwrap() <= secs(10));
    // A successor bind restarts the idle window but keeps the first bind.
    let renewed = intent.record_successor("nas", 2, &target, Some(1)).unwrap();
    assert!(renewed > secs(290));
    assert!(matches!(
        &intent.phase,
        Phase::Account { first_bound: kept, issued, .. }
            if *kept == first_bound && issued.elapsed() < secs(5)
    ));
    // The first bind still bounds the renewed window.
    if let Phase::Account { first_bound, .. } = &mut intent.phase {
        *first_bound = Instant::now() - secs(350);
    }
    let left = intent.remaining().unwrap();
    assert!(left <= secs(250) && left > secs(240));
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::WaitingForForm);
    // Where the monotonic clock can represent it, the cap expires a page
    // whose latest bind was just now.
    if let Some(capped) = Instant::now().checked_sub(READINESS_CAP) {
        if let Phase::Account {
            first_bound,
            issued,
            ..
        } = &mut intent.phase
        {
            *first_bound = capped;
            *issued = Instant::now();
        }
        assert_eq!(intent.status(), DeferredSynologyLoginStatus::Expired);
        assert!(intent.spent_for_test());
        assert!(intent
            .record_successor("nas", 3, &target, Some(2))
            .is_none());
    }
}

#[test]
fn intent_renews_on_verified_hop_up_to_cap() {
    assert_eq!(INTENT_LIFETIME, Duration::from_secs(120));
    assert_eq!(INTENT_RENEWAL, Duration::from_secs(300));
    assert_eq!(INTENT_CAP, Duration::from_secs(900));
    let secs = Duration::from_secs;
    for (capture, renewal, left) in [
        (0, None, 120),
        (120, None, 0),
        (119, Some(0), 300),
        (400, Some(299), 1),
        (800, Some(0), 100),
        (900, Some(0), 0),
        (10, Some(300), 0),
    ] {
        assert_eq!(intent_left(secs(capture), renewal.map(secs)), secs(left));
    }

    let target = Url::parse(NAS).unwrap();
    let mut intent = intent();
    intent.created = Instant::now() - secs(110);
    assert!(intent.remaining().unwrap() <= secs(10));
    // A verified probe renews the pending intent.
    let renewed = intent
        .record_probe(target.origin().ascii_serialization())
        .unwrap();
    assert!(renewed > secs(290));
    // Beyond the original capture window, the renewed intent is still pending.
    intent.created = Instant::now() - secs(180);
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::AwaitingNas);
    // A consumed handoff renews again.
    intent.renewed = Some(Instant::now() - secs(250));
    assert!(intent.renew_intent().unwrap() > secs(290));
    assert!(intent.renewed.unwrap().elapsed() < secs(5));
    // A lapsed renewal window expires and never revives.
    intent.renewed = Some(Instant::now() - INTENT_RENEWAL);
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::Expired);
    assert!(intent.spent_for_test());
    assert!(intent.renew_intent().is_none());
    assert!(intent
        .record_probe(target.origin().ascii_serialization())
        .is_none());
    assert!(!intent.bind("nas", 1, &target));
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::Expired);

    // A probe the origin capacity refuses does not renew.
    let mut full = self::intent();
    for index in 0..MAX_VERIFIED_ORIGINS {
        full.record_probe(format!("https://example.ab{index}.quickconnect.to"));
    }
    full.renewed = None;
    assert!(full
        .record_probe(target.origin().ascii_serialization())
        .is_none());
    assert!(full.renewed.is_none());
    // A known origin's repeated probe renews.
    assert!(full
        .record_probe("https://example.ab0.quickconnect.to".into())
        .is_some());

    // Readiness and password phases never renew the intent.
    let (mut bound, _, nonce) = bound_intent(1);
    assert!(bound.renew_intent().is_none());
    bound.dispense("nas", 1, &nonce, None).unwrap();
    assert!(bound.renew_intent().is_none());

    // Where the monotonic clock can represent it, the cap wins over renewal.
    if let Some(capped) = Instant::now().checked_sub(INTENT_CAP) {
        let mut capped_intent = self::intent();
        capped_intent.created = capped;
        capped_intent.renewed = Some(Instant::now());
        assert_eq!(capped_intent.status(), DeferredSynologyLoginStatus::Expired);
    }
}

#[test]
fn candidate_documents_are_bounded_and_never_evict_the_selected_page() {
    let (mut intent, target, first) = bound_intent(1);
    for document in 2..=20 {
        assert!(intent
            .record_successor("nas", document, &target, Some(1))
            .is_some());
    }
    let Phase::Account { candidates, .. } = &intent.phase else {
        unreachable!()
    };
    assert_eq!(candidates.len(), MAX_CANDIDATE_DOCUMENTS);
    assert!(candidates.contains_key(&1) && candidates.contains_key(&20));
    assert_eq!(intent.nonce("nas", 1).as_deref(), Some(first.as_str()));
    assert!(intent.nonce("nas", 2).is_none());
    // A response for a document older than the selection never binds.
    assert!(intent
        .record_successor("nas", 5, &target, Some(20))
        .is_none());
    assert!(intent.nonce("nas", 5).is_none());
    // A newly selected marked primary prunes every older page.
    assert!(intent.bind("nas", 21, &target));
    let Phase::Account {
        candidates,
        document,
        ..
    } = &intent.phase
    else {
        unreachable!()
    };
    assert_eq!(candidates.keys().copied().collect::<Vec<_>>(), vec![21]);
    assert_eq!(*document, 21);
    assert_eq!(intent.status(), DeferredSynologyLoginStatus::WaitingForForm);
}

#[test]
fn status_wire_snapshot_is_unchanged() {
    use DeferredSynologyLoginStatus as Status;
    // Exhaustive on purpose: a new native status must update this snapshot
    // and every IPC consumer together.
    fn wire(status: Status) -> &'static str {
        match status {
            Status::AwaitingNas => "\"awaiting_nas\"",
            Status::WaitingForForm => "\"waiting_for_form\"",
            Status::WaitingForPassword => "\"waiting_for_password\"",
            Status::CredentialsReleased => "\"credentials_released\"",
            Status::Expired => "\"expired\"",
            Status::Cancelled => "\"cancelled\"",
        }
    }
    let all = [
        Status::AwaitingNas,
        Status::WaitingForForm,
        Status::WaitingForPassword,
        Status::CredentialsReleased,
        Status::Expired,
        Status::Cancelled,
    ];
    let snapshot = all
        .iter()
        .map(|status| serde_json::to_string(status).unwrap())
        .collect::<Vec<_>>()
        .join(",");
    assert_eq!(
        snapshot,
        r#""awaiting_nas","waiting_for_form","waiting_for_password","credentials_released","expired","cancelled""#
    );
    for status in all {
        assert_eq!(serde_json::to_string(&status).unwrap(), wire(status));
    }

    // Renewal, successor rebinding, stale refusal and the longer password stage
    // surface only the existing scalars.
    let target = Url::parse(NAS).unwrap();
    let mut intent = intent();
    let mut seen = vec![intent.status()];
    intent.record_probe(target.origin().ascii_serialization());
    seen.push(intent.status());
    assert!(intent.bind("nas", 1, &target));
    let first = intent.nonce("nas", 1).unwrap();
    seen.push(intent.status());
    intent.record_successor("nas", 2, &target, Some(1)).unwrap();
    seen.push(intent.status());
    assert!(intent.dispense("nas", 2, &first, None).is_err());
    seen.push(intent.status());
    let second = intent.nonce("nas", 2).unwrap();
    let account = intent.dispense("nas", 2, &second, None).unwrap();
    seen.push(intent.status());
    let token = account["continuation"].as_str().unwrap();
    assert!(intent.dispense("nas", 3, token, Some("password")).is_err());
    seen.push(intent.status());
    assert_eq!(
        seen.into_iter().map(wire).collect::<Vec<_>>(),
        [
            "\"awaiting_nas\"",
            "\"awaiting_nas\"",
            "\"waiting_for_form\"",
            "\"waiting_for_form\"",
            "\"waiting_for_form\"",
            "\"waiting_for_password\"",
            "\"cancelled\"",
        ]
    );
    let response = crate::http::ProxyMediatorResponse {
        local_port: 1234,
        session_id: "fixture".into(),
        proxy_url: "http://fixture.localhost:1234/".into(),
        google_routes: Vec::new(),
        deferred_login_status: Some(Status::WaitingForForm),
    };
    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"local_port":1234,"session_id":"fixture","proxy_url":"http://fixture.localhost:1234/","deferred_login_status":"waiting_for_form"}"#
    );
}
