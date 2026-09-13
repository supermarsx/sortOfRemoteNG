//! Local capability observations are bounded metadata, not captured secrets or
//! a claim that browser-engine requests outside this listener were intercepted.
use super::*;

#[test]
fn bootstrap_reports_installed_network_capabilities_on_existing_readiness_payload() {
    let script = network::bootstrap(
        "fixture-session",
        1,
        "https://synthetic.invalid",
        "http://fixture.localhost:1234",
        &HttpProxyPolicy::default(),
    );
    assert!(script.contains("p.networkRouting = installWebNetworkClient("));
    assert!(script.ends_with(").capabilities;"));
}

#[tokio::test]
async fn reserved_route_failures_log_only_fixed_categories_without_network_or_body_secrets() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy = proxy(
        format!("http://{}/", listener.local_addr().unwrap()),
        client(),
    )
    .await;
    for (path, category, status) in [
        (
            format!(
                "{}private-name?credential=private-query",
                font_assets::PREFIX
            ),
            font_assets::PREFIX,
            404,
        ),
        (
            format!("{}?credential=private-query", quickconnect_control::PATH),
            quickconnect_control::PATH,
            400,
        ),
        (
            format!(
                "{}?destination=https%3A%2F%2Fprivate-host.invalid%2F%3Ftoken%3Dprivate-query",
                quickconnect::PATH
            ),
            quickconnect::PATH,
            400,
        ),
    ] {
        let response = client()
            .post(format!("{}{path}", proxy.base))
            .header("Host", &proxy.state.proxy_authority)
            .header("Origin", &proxy.state.proxy_origin)
            .header("Authorization", "Bearer private-header")
            .header("Cookie", "private-cookie=secret")
            .body("private-body")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), status);
        let manager = proxy.state.global_sessions.lock().unwrap();
        let entry = manager.request_log.back().unwrap();
        assert_eq!(entry.url, format!("{}{category}", proxy.state.proxy_origin));
        assert_eq!(entry.method, "POST");
        assert_eq!(entry.status, status);
        assert_eq!(entry.error, Some(format!("HTTP {status}")));
    }
    assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 3);
    assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 3);
    let log = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(
        log.iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        ["3", "2", "1"]
    );
    let captured = serde_json::to_string(&log).unwrap();
    assert!(!captured.contains("private-"));
    assert!(!proxy
        .state
        .last_error
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .contains("private-"));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), listener.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn local_observation_preserves_capacity_identity_and_expected_review_health() {
    let proxy = proxy("https://synthetic.invalid/".into(), client()).await;
    proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .set_request_log_capacity(2)
        .unwrap();
    for status in [200, 400, 403] {
        let mut response = Response::builder()
            .status(status)
            .body(Body::empty())
            .unwrap();
        if status == 403 {
            response
                .extensions_mut()
                .insert(quickconnect::ReviewPending);
        }
        let _ = observe_local_response(
            &proxy.state,
            &axum::http::Method::GET,
            ObservedLocalRoute::QuickConnectRedirect,
            response,
        );
    }
    assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 3);
    assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 1);
    assert!(proxy
        .state
        .last_error
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .starts_with("HTTP 400"));
    {
        let mut manager = proxy.state.global_sessions.lock().unwrap();
        let log = manager.request_log_newest_first();
        assert_eq!(log.len(), 2);
        assert_eq!(
            (&log[0].id, &log[1].id),
            (&"3".to_string(), &"2".to_string())
        );
        assert_eq!(log[0].status, 403);
        assert!(log[0].error.is_none());
        manager.set_request_log_capacity(0).unwrap();
    }
    let _ = observe_local_response(
        &proxy.state,
        &axum::http::Method::POST,
        ObservedLocalRoute::QuickConnectDiscovery,
        Response::builder().status(503).body(Body::empty()).unwrap(),
    );
    assert!(proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log
        .is_empty());
    assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 4);
    assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 2);
    proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .set_request_log_capacity(2)
        .unwrap();
    let _ = observe_local_response(
        &proxy.state,
        &axum::http::Method::from_bytes(b"PRIVATE-TOKEN").unwrap(),
        ObservedLocalRoute::Font,
        Response::builder().status(200).body(Body::empty()).unwrap(),
    );
    let manager = proxy.state.global_sessions.lock().unwrap();
    let entry = manager.request_log.back().unwrap();
    assert_eq!(entry.id, "4");
    assert_eq!(entry.method, "OTHER");
    assert!(proxy.state.last_error.lock().unwrap().is_none());
}
