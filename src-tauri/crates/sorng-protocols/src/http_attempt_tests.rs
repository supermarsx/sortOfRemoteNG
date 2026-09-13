use super::*;
use serde_json::json;
#[path = "http_attempt_provider_cookie_tests.rs"]
mod provider_cookie_tests;

#[test]
fn http_cycle_evidence_counts_consumption_not_peeks_and_resets_on_progress_or_scope_change() {
    const REGIONAL: &str = "https://example.fr3.quickconnect.to/";
    const PLAIN: &str = "http://example.quickconnect.to/";
    const SECURE: &str = "https://example.quickconnect.to/";
    let mut registry = AttemptRegistry::default();
    let mut current = start(&mut registry, &config(REGIONAL), "r0");
    for circuit in 0..2 {
        let exit = current
            .http_redirect_edge(&Url::parse(REGIONAL).unwrap(), &Url::parse(PLAIN).unwrap())
            .unwrap();
        // Inspecting/issuing duplicate responses does not advance anything.
        for _ in 0..8 {
            assert!(!current.http_redirect_cycle_blocked(Some(&exit)));
        }
        current.consume_http_redirect(Some(&exit));
        let plain = transfer(&mut registry, &current, PLAIN, &format!("p{circuit}"));
        let upgrade = plain
            .http_redirect_edge(&Url::parse(PLAIN).unwrap(), &Url::parse(SECURE).unwrap())
            .unwrap();
        plain.consume_http_redirect(Some(&upgrade));
        let secure = transfer(&mut registry, &plain, SECURE, &format!("s{circuit}"));
        let returning = secure
            .http_redirect_edge(&Url::parse(SECURE).unwrap(), &Url::parse(REGIONAL).unwrap())
            .unwrap();
        secure.consume_http_redirect(Some(&returning));
        current = transfer(
            &mut registry,
            &secure,
            REGIONAL,
            &format!("r{}", circuit + 1),
        );
        assert!(!secure.http_redirect_cycle_blocked(Some(&exit))); // Stale owner cannot block successor.
    }
    let exit = current
        .http_redirect_edge(&Url::parse(REGIONAL).unwrap(), &Url::parse(PLAIN).unwrap())
        .unwrap();
    assert!(current.http_redirect_cycle_blocked(Some(&exit)));
    let changed = HttpRedirectEdge::RegionalExit(REGIONAL.trim_end_matches('/').into(), [1; 32]);
    assert!(!current.http_redirect_cycle_blocked(Some(&changed)));
    current.consume_http_redirect(None); // An unrelated consumed handoff ends the exact circuit.
    assert!(!current.http_redirect_cycle_blocked(Some(&exit)));
    for (source, destination) in [
        ("https://example.fr3.quickconnect.to/login", PLAIN),
        (
            "https://example.fr3.quickconnect.to/?session=private",
            PLAIN,
        ),
        (REGIONAL, "http://example.quickconnect.to/?session=private"),
        (REGIONAL, "http://other.quickconnect.to/"),
        (REGIONAL, "http://example.quickconnect.to:8080/"),
        (REGIONAL, "http://user:private@example.quickconnect.to/"),
    ] {
        assert!(current
            .http_redirect_edge(
                &Url::parse(source).unwrap(),
                &Url::parse(destination).unwrap()
            )
            .is_none());
    }
    current.document_landed(&Url::parse(REGIONAL).unwrap(), 3);
    assert_eq!(current.root_document_sequence(), Some(3));
    current.document_landed(
        &Url::parse("https://example.fr3.quickconnect.to/webman/").unwrap(),
        4,
    );
    assert_eq!(current.root_document_sequence(), None);
}

fn config(target: &str) -> BasicAuthProxyConfig {
    serde_json::from_value(json!({
        "target_url": target, "username":"", "password":"", "connection_id":"fixture-owner",
        "redirect_profile":"synology", "upstream_auth_mode":"none",
        "proxy_policy": { "version":1,"pageScripts":"allow","httpsOnly":false,"sameOriginOnly":false,
            "cacheMode":"normal","queryParameters":[],"synologyQuickConnectDefaults": {
                "version":1,"originalOrigin":"https://example.quickconnect.to" }
        }
    })).unwrap()
}
fn start(
    registry: &mut AttemptRegistry,
    config: &BasicAuthProxyConfig,
    id: &str,
) -> AttemptSession {
    registry
        .start(config, &Url::parse(&config.target_url).unwrap(), id)
        .unwrap()
        .unwrap()
}
fn transfer(
    registry: &mut AttemptRegistry,
    source: &AttemptSession,
    target: &str,
    id: &str,
) -> AttemptSession {
    let mut next = config(target);
    let token = registry
        .prepare_transfer(source, &Url::parse(target).unwrap(), "native-receipt")
        .unwrap();
    registry.stop(source, Some(&token)).unwrap();
    next.continuation_id = Some(token);
    start(registry, &next, id)
}
fn set(session: &AttemptSession, url: &str, value: &str) {
    session.cookie_store().set_cookies(
        &mut [&HeaderValue::from_str(value).unwrap()].into_iter(),
        &Url::parse(url).unwrap(),
    );
}
fn cookies(session: &AttemptSession, url: &str) -> String {
    session
        .cookie_store()
        .cookies(&Url::parse(url).unwrap())
        .and_then(|header| header.to_str().ok().map(str::to_owned))
        .unwrap_or_default()
}

#[test]
fn alias_regional_alias_retains_only_exact_origin_state_and_blocks_old_response_mutations() {
    let mut registry = AttemptRegistry::default();
    let alias = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "alias-1",
    );
    let attempt_id = alias.diagnostic().unwrap().0;
    set(
        &alias,
        "https://example.quickconnect.to/",
        "sid=alias-session; Domain=.quickconnect.to; Path=/; Secure; HttpOnly",
    );
    alias.capture_route_cookies(&HeaderMap::from_iter([(
        COOKIE,
        HeaderValue::from_static(
            "previous=regional-cache; tunnel=route-hint; password=never-cache",
        ),
    )]));
    let regional = transfer(
        &mut registry,
        &alias,
        "https://example.fr3.quickconnect.to/webman/",
        "regional-1",
    );
    assert_eq!(
        cookies(&regional, "https://example.fr3.quickconnect.to/"),
        ""
    );
    assert!(regional.route_cookie_headers().is_empty());
    assert_eq!(
        regional
            .record_connector("https://example.fr3.quickconnect.to")
            .unwrap(),
        1
    );
    set(
        &regional,
        "https://example.fr3.quickconnect.to/",
        "regional=only-here; Path=/",
    );
    let back = transfer(
        &mut registry,
        &regional,
        "https://example.quickconnect.to/",
        "alias-2",
    );
    set(
        &alias,
        "https://example.quickconnect.to/",
        "sid=stale-response; Path=/",
    );
    alias.capture_route_cookies(&HeaderMap::from_iter([(
        COOKIE,
        HeaderValue::from_static("previous=stale"),
    )]));
    alias.revoke();
    assert_eq!(
        cookies(&back, "https://example.quickconnect.to/"),
        "sid=alias-session"
    );
    assert_eq!(cookies(&back, "http://example.quickconnect.to/"), "");
    assert_eq!(cookies(&back, "https://other.quickconnect.to/"), "");
    back.capture_route_cookies(&HeaderMap::new()); // New local origin has not received restored cookies yet.
    let restored: Vec<_> = back
        .route_cookie_headers()
        .into_iter()
        .map(|v| v.to_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        restored,
        [
            "previous=regional-cache; Path=/; SameSite=Lax",
            "tunnel=route-hint; Path=/; SameSite=Lax"
        ]
    );
    assert_eq!(back.diagnostic(), Some((attempt_id, 2)));
    assert_eq!(
        back.merged_request_cookies(
            &Url::parse("https://example.quickconnect.to/").unwrap(),
            &["previous=regional-cache"]
        )
        .unwrap(),
        "sid=alias-session; previous=regional-cache"
    );
    assert_eq!(
        back.merged_request_cookies(
            &Url::parse("https://example.quickconnect.to/").unwrap(),
            &["sid=browser-new"]
        )
        .unwrap(),
        "sid=browser-new"
    );
    back.capture_route_cookies(&HeaderMap::new());
    assert!(back.route_cookie_headers().is_empty());
}

#[test]
fn only_verified_connector_stage_repetitions_count_not_login_or_url_bounces() {
    let mut registry = AttemptRegistry::default();
    let mut session = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "a0",
    );
    for hop in 0..3 {
        session = transfer(
            &mut registry,
            &session,
            "https://example.fr3.quickconnect.to/",
            &format!("r{hop}"),
        );
        let result = session.record_connector("https://example.fr3.quickconnect.to");
        assert_eq!(result.is_err(), hop == 2);
        assert_eq!(
            session
                .record_connector("https://example.fr3.quickconnect.to")
                .is_err(),
            hop == 2
        ); // Same primary/hop is not a second visit.
           // Same origin's login pages do not call the classifier; requests and
           // cookie writes alone never increment the connector counter.
        set(
            &session,
            "https://example.fr3.quickconnect.to/",
            "login=bounce; Path=/",
        );
        session = transfer(
            &mut registry,
            &session,
            "https://example.quickconnect.to/",
            &format!("a{hop}"),
        );
    }
    assert!(session
        .record_connector("https://different.fr3.quickconnect.to")
        .is_err());
    assert!(session
        .record_connector("https://example.quickconnect.to")
        .is_err());
    assert_eq!(session.diagnostic().unwrap().1, 6);
    session.connector_ready("https://example.quickconnect.to");
    let fresh = transfer(
        &mut registry,
        &session,
        "https://example.fr3.quickconnect.to/",
        "fresh-cycle",
    );
    assert_eq!(
        fresh
            .record_connector("https://example.fr3.quickconnect.to")
            .unwrap(),
        1
    );
}

#[test]
fn native_twenty_handoff_budget_cannot_be_reset_by_new_frontend_connection_ids() {
    let mut registry = AttemptRegistry::default();
    let mut session = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "a0",
    );
    for hop in 1..=20 {
        let target = if hop % 2 == 0 {
            "https://example.quickconnect.to/"
        } else {
            "https://example.fr3.quickconnect.to/"
        };
        session = transfer(
            &mut registry,
            &session,
            target,
            &format!("fresh-runtime-id-{hop}"),
        );
        assert_eq!(session.diagnostic().unwrap().1, hop);
    }
    assert!(registry
        .prepare_transfer(
            &session,
            &Url::parse("https://example.fr3.quickconnect.to/").unwrap(),
            "receipt-21"
        )
        .is_err());
}

#[test]
fn transfer_requires_consumed_ticket_explicit_stop_exact_path_and_one_use() {
    let mut registry = AttemptRegistry::default();
    let source = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "source",
    );
    let target = "https://example.fr3.quickconnect.to/webman/";
    let token = registry
        .prepare_transfer(&source, &Url::parse(target).unwrap(), "receipt")
        .unwrap();
    assert!(registry
        .prepare_transfer(&source, &Url::parse(target).unwrap(), "second-receipt")
        .is_err());
    assert!(registry.stop(&source, Some("forged")).is_err());
    registry.stop(&source, Some(&token)).unwrap();
    let mut next = config(target);
    next.continuation_id = Some(token.clone());
    let destination = start(&mut registry, &next, "destination");
    assert!(registry
        .start(&next, &Url::parse(target).unwrap(), "replay")
        .is_err());
    assert!(registry.cancel(&token).is_none()); // An already-claimed ticket cannot revoke successor.
    assert!(destination.diagnostic().is_some());
    for (label, mutate) in [
        ("path", 0),
        ("origin", 1),
        ("password", 2),
        ("route", 3),
        ("optout", 4),
        ("minimum-tls", 5),
        ("page-policy", 6),
        ("no-explicit-stop", 7),
    ] {
        let source = start(
            &mut registry,
            &config("https://example.quickconnect.to/"),
            label,
        );
        let token = registry
            .prepare_transfer(&source, &Url::parse(target).unwrap(), "receipt")
            .unwrap();
        if mutate != 7 {
            registry.stop(&source, Some(&token)).unwrap();
        }
        let mut next = config(target);
        next.continuation_id = Some(token);
        match mutate {
            0 => next.target_url = "https://example.fr3.quickconnect.to/".into(),
            1 => next.target_url = "https://other.fr3.quickconnect.to/webman/".into(),
            2 => next.password = "do-not-transfer".into(),
            3 => next.upstream_proxy_url = Some("http://different-proxy.invalid:8080".into()),
            4 => {
                next.proxy_policy
                    .as_mut()
                    .unwrap()
                    .synology_quick_connect_defaults = None
            }
            5 => next.min_tls_version = "1.3".into(),
            6 => {
                next.proxy_policy.as_mut().unwrap().page_scripts = super::super::PageScripts::Block
            }
            _ => {}
        }
        assert!(
            registry
                .start(&next, &Url::parse(&next.target_url).unwrap(), "invalid")
                .is_err(),
            "{label}"
        );
        assert!(source.diagnostic().is_none());
    }
}

#[test]
fn ordinary_close_expiry_cancel_and_restart_have_generation_safe_lifetimes() {
    let mut registry = AttemptRegistry::default();
    let source = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "source",
    );
    let target = Url::parse("https://example.fr3.quickconnect.to/").unwrap();
    let token = registry
        .prepare_transfer(&source, &target, "receipt")
        .unwrap();
    let restarted = registry.restart(&source, "restarted").unwrap();
    assert!(registry.cancel(&token).is_none());
    assert!(restarted.diagnostic().is_some());
    assert!(source.diagnostic().is_none());
    let token = registry
        .prepare_transfer(&restarted, &target, "receipt")
        .unwrap();
    registry.stop(&restarted, None).unwrap();
    assert!(!registry.tickets.contains_key(&token));
    assert!(restarted.diagnostic().is_none());
    let source = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "new-source",
    );
    let token = registry
        .prepare_transfer(&source, &target, "receipt")
        .unwrap();
    registry.stop(&source, Some(&token)).unwrap();
    registry.tickets.get_mut(&token).unwrap().created = Instant::now() - Duration::from_secs(121);
    let mut next = config(target.as_str());
    next.continuation_id = Some(token);
    assert!(registry.start(&next, &target, "expired").is_err());
    assert!(source.attempt.state.lock().unwrap().origins.is_empty());
}

#[test]
fn cookie_storage_is_bounded_path_scoped_and_invalid_cache_never_restored() {
    let mut registry = AttemptRegistry::default();
    let source = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "source",
    );
    for index in 0..150 {
        set(
            &source,
            "https://example.quickconnect.to/",
            &format!("c{index}=v; Path=/"),
        );
    }
    assert_eq!(
        source.attempt.state.lock().unwrap().origins[&source.origin]
            .cookies
            .iter_unexpired()
            .count(),
        128
    );
    set(
        &source,
        "https://example.quickconnect.to/",
        "c0=updated; Path=/",
    );
    assert!(cookies(&source, "https://example.quickconnect.to/").contains("c0=updated"));
    for raw in [
        "previous=one; previous=two",
        "previous=\"quoted\"",
        "previous=space value",
    ] {
        source.capture_route_cookies(&HeaderMap::from_iter([(
            COOKIE,
            HeaderValue::from_str(raw).unwrap(),
        )]));
        assert!(source.route_cookie_headers().is_empty());
    }
    source.capture_route_cookies(&HeaderMap::from_iter([(
        COOKIE,
        HeaderValue::from_str(&format!("previous={}", "x".repeat(2049))).unwrap(),
    )]));
    assert!(source.route_cookie_headers().is_empty());
    let clean = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "clean",
    );
    set(
        &clean,
        "https://example.quickconnect.to/admin/",
        "admin=private; Path=/admin/; Secure",
    );
    assert_eq!(
        cookies(&clean, "https://example.quickconnect.to/public/"),
        ""
    );
    assert_eq!(
        cookies(&clean, "https://example.quickconnect.to/admin/"),
        "admin=private"
    );
    set(
        &clean,
        "https://example.quickconnect.to/admin/",
        "sid=admin; Path=/admin/",
    );
    set(
        &clean,
        "https://example.quickconnect.to/",
        "sid=root; Path=/",
    );
    let target = Url::parse("https://example.quickconnect.to/admin/").unwrap();
    let merged = clean
        .merged_request_cookies(&target, &["previous=route"])
        .unwrap();
    assert!(merged.to_str().unwrap().contains("sid=admin"));
    assert!(merged.to_str().unwrap().contains("sid=root"));
    let browser = clean
        .merged_request_cookies(&target, &["sid=browser-admin; sid=browser-root"])
        .unwrap();
    assert_eq!(browser.to_str().unwrap().matches("sid=").count(), 2);
    assert!(browser
        .to_str()
        .unwrap()
        .ends_with("sid=browser-admin; sid=browser-root"));
}

#[test]
fn new_approved_certificate_identity_does_not_reuse_old_origin_session_cookies() {
    let mut registry = AttemptRegistry::default();
    let source = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "source",
    );
    set(
        &source,
        "https://example.quickconnect.to/",
        "sid=old-cert; Path=/",
    );
    let regional = transfer(
        &mut registry,
        &source,
        "https://example.fr3.quickconnect.to/",
        "regional",
    );
    let target = Url::parse("https://example.quickconnect.to/").unwrap();
    let token = registry
        .prepare_transfer(&regional, &target, "receipt")
        .unwrap();
    registry.stop(&regional, Some(&token)).unwrap();
    let mut next = config(target.as_str());
    next.continuation_id = Some(token);
    next.accepted_cert_fingerprint = Some("new-currently-approved-fingerprint".into());
    let current = start(&mut registry, &next, "current");
    assert_eq!(cookies(&current, target.as_str()), "");
}

#[tokio::test]
async fn real_proxy_transport_reuses_alias_jar_after_regional_handoff_and_preserves_entry_path() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy = format!("http://{}", listener.local_addr().unwrap());
    let peer = tokio::spawn(async move {
        let mut requests = Vec::new();
        for index in 0..2 {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut byte = [0];
                if stream.read(&mut byte).await.unwrap() == 0 {
                    break;
                }
                bytes.push(byte[0]);
                if bytes.ends_with(b"\r\n\r\n") {
                    break;
                }
                assert!(bytes.len() < 16384);
            }
            requests.push(String::from_utf8(bytes).unwrap());
            let cookie = if index == 0 {
                "Set-Cookie: sid=verified-alias-session; Domain=.quickconnect.to; Path=/\r\n"
            } else {
                ""
            };
            stream.write_all(format!("HTTP/1.1 200 OK\r\n{cookie}Content-Length: 2\r\nConnection: close\r\n\r\nok").as_bytes()).await.unwrap();
        }
        requests
    });
    let mut registry = AttemptRegistry::default();
    let mut first_config = config("http://example.quickconnect.to/webman/");
    first_config.upstream_proxy_url = Some(proxy.clone());
    let first = start(&mut registry, &first_config, "alias-first");
    let client = |session: &AttemptSession| {
        reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::http(&proxy).unwrap())
            .redirect(reqwest::redirect::Policy::none())
            .cookie_provider(session.cookie_store())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
    };
    assert_eq!(
        client(&first)
            .get(&first_config.target_url)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "ok"
    );
    let mut regional_config = first_config.clone();
    regional_config.target_url = "https://example.fr3.quickconnect.to/".into();
    let token = registry
        .prepare_transfer(
            &first,
            &Url::parse(&regional_config.target_url).unwrap(),
            "r1",
        )
        .unwrap();
    registry.stop(&first, Some(&token)).unwrap();
    regional_config.continuation_id = Some(token);
    let regional = start(&mut registry, &regional_config, "regional");
    assert_eq!(cookies(&regional, &regional_config.target_url), "");
    let token = registry
        .prepare_transfer(
            &regional,
            &Url::parse(&first_config.target_url).unwrap(),
            "r2",
        )
        .unwrap();
    registry.stop(&regional, Some(&token)).unwrap();
    first_config.continuation_id = Some(token);
    let back = start(&mut registry, &first_config, "alias-back");
    let merged = back
        .merged_request_cookies(
            &Url::parse(&first_config.target_url).unwrap(),
            &["previous=route-cache"],
        )
        .unwrap();
    assert_eq!(
        client(&back)
            .get(&first_config.target_url)
            .header(COOKIE, merged)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "ok"
    );
    let captured = peer.await.unwrap();
    for request in &captured {
        assert!(request.starts_with("GET http://example.quickconnect.to/webman/ HTTP/1.1\r\n"));
    }
    assert!(!captured[0].to_ascii_lowercase().contains("cookie:"));
    assert!(captured[1].contains("sid=verified-alias-session"));
    assert!(captured[1].contains("previous=route-cache"));
    assert!(!captured[1].to_ascii_lowercase().contains("authorization:"));
}
