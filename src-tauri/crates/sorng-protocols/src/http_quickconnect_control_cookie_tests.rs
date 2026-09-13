//! Actual protected routes over synthetic CONNECT/TLS only. Provider cookies
//! are purpose-private; captured strings below contain test values only.
use super::*;

fn http_requests(server: &Peer) -> Vec<String> {
    server
        .seen
        .lock()
        .unwrap()
        .iter()
        .filter(|value| !value.starts_with("CONNECT "))
        .cloned()
        .collect()
}
fn cookie(request: &str) -> Option<&str> {
    request.lines().find_map(|line| {
        line.split_once(':')
            .filter(|(name, _)| name.eq_ignore_ascii_case("cookie"))
            .map(|(_, value)| value.trim())
    })
}
fn assert_control_cookies(request: &str, expected: &[&str]) {
    let mut actual: Vec<_> = cookie(request)
        .into_iter()
        .flat_map(|value| value.split(';'))
        .map(str::trim)
        .collect();
    let mut expected = expected.to_vec();
    actual.sort_unstable();
    expected.sort_unstable();
    assert_eq!(actual, expected);
}
fn tunnel_payload() -> String {
    serde_json::json!([{"version":1,"command":"request_tunnel","stop_when_error":false,
        "stop_when_success":true,"id":"mainapp_https","serverID":"test-nas","is_gofile":false,"path":""}]).to_string()
}

#[tokio::test]
async fn control_cookies_roundtrip_only_to_same_provider_not_page_probe_or_other_session() {
    let server = scripted_peer(Arc::new(|request| {
        if request.starts_with("GET ") {
            (200, pong(), "Access-Control-Allow-Origin: *\r\nSet-Cookie: probe=must-not-store; Path=/\r\n".into(), Duration::ZERO)
        } else {
            let value = if request.to_ascii_lowercase().contains("host: global.quickconnect.to") { "global-provider" } else { "regional-provider" };
            (200, b"[]".to_vec(), format!("Set-Cookie: provider={value}; Domain=quickconnect.to; Path=/; Secure; HttpOnly\r\n"), Duration::ZERO)
        }
    }), false, false).await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    for _ in 0..2 {
        let response = request(&proxy)
            .header("Cookie", "browser=private-browser")
            .header("Authorization", "Bearer private-auth")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(!response.headers().contains_key("set-cookie"));
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"[]");
    }
    assert_eq!(
        routed(&proxy, REGIONAL, true)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        routed(&proxy, REGIONAL, true)
            .body(tunnel_payload())
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        routed(&proxy, PROBE, false).send().await.unwrap().status(),
        200
    );
    assert_eq!(
        routed(&proxy, REGIONAL, true)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let fresh = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    assert_eq!(request(&fresh).send().await.unwrap().status(), 200);
    let requests = http_requests(&server);
    assert_eq!(requests.len(), 7);
    assert!(cookie(&requests[0]).is_none());
    assert_control_cookies(
        &requests[1],
        &["provider=global-provider", "upstream-secret=blocked"],
    );
    assert!(cookie(&requests[2]).is_none());
    assert_control_cookies(
        &requests[3],
        &["provider=regional-provider", "upstream-secret=blocked"],
    );
    assert!(cookie(&requests[4]).is_none());
    assert_control_cookies(
        &requests[5],
        &["provider=regional-provider", "upstream-secret=blocked"],
    );
    assert!(cookie(&requests[6]).is_none());
    for request in &requests {
        assert!(
            !request.contains("private-browser")
                && !request.contains("private-auth")
                && !request.contains("source-private")
                && !request.to_ascii_lowercase().contains("authorization:")
        );
    }
    let logs = serde_json::to_string(
        &proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first(),
    )
    .unwrap();
    assert!(
        !logs.contains("global-provider")
            && !logs.contains("regional-provider")
            && !logs.contains("private-browser")
    );
}

#[tokio::test]
async fn provider_error_status_rotation_and_deletion_are_kept_without_automatic_retry() {
    let calls = Arc::new(AtomicU64::new(0));
    let captured = calls.clone();
    let server = scripted_peer(
        Arc::new(move |_| match captured.fetch_add(1, Ordering::SeqCst) {
            0 => (
                403,
                b"[]".to_vec(),
                "Set-Cookie: provider=challenge; Path=/\r\n".into(),
                Duration::ZERO,
            ),
            1 => (
                200,
                b"[]".to_vec(),
                "Set-Cookie: provider=; Path=/; Max-Age=0\r\n".into(),
                Duration::ZERO,
            ),
            _ => (200, b"[]".to_vec(), String::new(), Duration::ZERO),
        }),
        false,
        false,
    )
    .await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    assert_eq!(request(&proxy).send().await.unwrap().status(), 403);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(request(&proxy).send().await.unwrap().status(), 200);
    assert_eq!(request(&proxy).send().await.unwrap().status(), 200);
    let requests = http_requests(&server);
    assert_eq!(requests.len(), 3);
    assert!(cookie(&requests[0]).is_none());
    assert_control_cookies(
        &requests[1],
        &["provider=challenge", "upstream-secret=blocked"],
    );
    assert_control_cookies(&requests[2], &["upstream-secret=blocked"]);
}

#[tokio::test]
async fn stale_document_response_never_seeds_new_document_and_revocation_sends_nothing() {
    let calls = Arc::new(AtomicU64::new(0));
    let captured = calls.clone();
    let server = scripted_peer(
        Arc::new(move |_| {
            let first = captured.fetch_add(1, Ordering::SeqCst) == 0;
            (
                200,
                b"[]".to_vec(),
                if first {
                    "Set-Cookie: provider=late-private; Path=/\r\n".into()
                } else {
                    String::new()
                },
                if first {
                    Duration::from_millis(300)
                } else {
                    Duration::ZERO
                },
            )
        }),
        false,
        false,
    )
    .await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    let pending = tokio::spawn(request(&proxy).send());
    tokio::time::timeout(Duration::from_secs(2), async {
        while calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    proxy.state.network.document_issued(2, false);
    proxy.state.network.activate_document(2).unwrap();
    assert_ne!(pending.await.unwrap().unwrap().status(), 200);
    let mut next = request(&proxy).build().unwrap();
    next.headers_mut()
        .insert(control::DOCUMENT_HEADER, "2".parse().unwrap());
    assert_eq!(client().execute(next).await.unwrap().status(), 200);
    assert!(http_requests(&server)
        .iter()
        .all(|request| cookie(request).is_none()));
    proxy.state.network.revoke();
    assert!(request(&proxy)
        .send()
        .await
        .unwrap()
        .status()
        .is_client_error());
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn malformed_or_redirected_provider_reply_cannot_commit_cookies() {
    for status in [200, 302] {
        let calls = Arc::new(AtomicU64::new(0));
        let captured = calls.clone();
        let server = scripted_peer(Arc::new(move |_| {
            if captured.fetch_add(1, Ordering::SeqCst) == 0 {
                (status, b"not-json".to_vec(), "Set-Cookie: provider=bad-private; Path=/\r\nLocation: https://other.invalid/\r\n".into(), Duration::ZERO)
            } else {(200,b"[]".to_vec(),String::new(),Duration::ZERO)}
        }),false,false).await;
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            ORIGINAL,
            policy(),
        )
        .await;
        let first = request(&proxy).send().await.unwrap();
        assert_ne!(first.status(), 200);
        assert!(!first.headers().contains_key("set-cookie"));
        assert_eq!(request(&proxy).send().await.unwrap().status(), 200);
        assert!(http_requests(&server)
            .iter()
            .all(|request| cookie(request).is_none()));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
