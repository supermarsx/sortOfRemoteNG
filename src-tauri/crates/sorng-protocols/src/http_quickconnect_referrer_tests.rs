//! Origin-only referrer mediation through protected routes and synthetic TLS.
use super::*;
use reqwest::header::{HeaderMap, HeaderValue};

const RELAY: &str =
    "https://test-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true";
const AGENT: &str = "SyntheticBrowser/1.0";

fn operation(proxy: &FixtureProxy, kind: usize) -> reqwest::RequestBuilder {
    match kind {
        0 => request(proxy),
        1 => routed(proxy, REGIONAL, true),
        2 => {
            let mut body = payload()[0].clone();
            body["command"] = serde_json::json!("request_tunnel");
            body["stop_when_success"] = serde_json::json!(true);
            routed(proxy, REGIONAL, true).body(serde_json::json!([body]).to_string())
        }
        3 => routed(proxy, PROBE, false),
        4 => routed(proxy, RELAY, false),
        _ => unreachable!(),
    }
}

async fn server() -> Peer {
    scripted_peer(
        Arc::new(|request| {
            if request.starts_with("GET ") {
                (
                    200,
                    pong(),
                    "Access-Control-Allow-Origin: *\r\n".into(),
                    Duration::ZERO,
                )
            } else {
                (200, b"[]".to_vec(), String::new(), Duration::ZERO)
            }
        }),
        false,
        false,
    )
    .await
}

fn record(proxy: &FixtureProxy, sequence: u64, policy: Option<&str>, html: &str) {
    let mut headers = HeaderMap::new();
    if let Some(policy) = policy {
        headers.insert("referrer-policy", policy.parse().unwrap());
    }
    proxy
        .state
        .network
        .record_document_referrer(sequence, &headers, html);
}

fn seen_requests(server: &Peer) -> Vec<String> {
    server
        .seen
        .lock()
        .unwrap()
        .iter()
        .filter(|request| !request.starts_with("CONNECT "))
        .cloned()
        .collect()
}

fn header<'a>(request: &'a str, wanted: &str) -> Option<&'a str> {
    request.lines().find_map(|line| {
        line.split_once(':')
            .filter(|(name, _)| name.eq_ignore_ascii_case(wanted))
            .map(|(_, value)| value.trim())
    })
}

#[tokio::test]
async fn all_five_routes_use_only_verified_source_origin_without_private_headers_or_queries() {
    let server = server().await;
    for source in [
        ORIGINAL,
        "https://test-nas.quickconnect.to",
        "https://global.quickconnect.to",
    ] {
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            source,
            policy(),
        )
        .await;
        record(
            &proxy,
            1,
            None,
            "<html><head><title>Fixture</title></head></html>",
        );
        let first = seen_requests(&server).len();
        for kind in 0..5 {
            let response = operation(&proxy, kind)
                .header(
                    "Referer",
                    format!(
                        "{}/private-path?private-query=secret",
                        proxy.state.proxy_origin
                    ),
                )
                .header("User-Agent", AGENT)
                .header("Authorization", "Bearer private-auth")
                .header("Cookie", "sid=private-cookie")
                .header("X-Source-Private", "private-header")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert!(!response.headers().contains_key("referer"));
            let body = response.text().await.unwrap();
            assert!(!body.contains("private-") && !body.contains(AGENT));
        }
        let seen = seen_requests(&server);
        assert_eq!(seen.len() - first, 5);
        for request in &seen[first..] {
            assert_eq!(
                header(request, "referer"),
                Some(format!("{source}/").as_str())
            );
            assert_eq!(header(request, "user-agent"), Some(AGENT));
            assert!(!request.contains("private-") && !request.contains(&proxy.state.proxy_origin));
            assert!(header(request, "authorization").is_none());
            if request.starts_with("GET ") {
                assert!(header(request, "cookie").is_none());
                assert_eq!(header(request, "origin"), Some(source));
            } else {
                assert!(header(request, "origin").is_none());
            }
        }
        let logs = proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        let logs = serde_json::to_string(&logs).unwrap();
        assert!(!logs.contains("private-") && !logs.contains(AGENT));
    }
}

#[tokio::test]
async fn absent_foreign_or_unrecorded_referrers_never_create_an_upstream_referrer() {
    let server = server().await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    // An issued document without a recorded response policy is not sufficient.
    let response = operation(&proxy, 4)
        .header("Referer", format!("{}/", proxy.state.proxy_origin))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    record(&proxy, 1, None, "<html></html>");
    for kind in 0..5 {
        for reference in [
            None,
            Some("https://private.invalid/private-path?private-query=secret"),
            Some("https://test-nas.quickconnect.to/"),
        ] {
            let request = operation(&proxy, kind);
            let request = if let Some(reference) = reference {
                request.header("Referer", reference)
            } else {
                request
            };
            assert_eq!(request.send().await.unwrap().status(), StatusCode::OK);
        }
    }
    let requests = seen_requests(&server);
    assert_eq!(requests.len(), 16);
    assert!(requests
        .iter()
        .all(|request| header(request, "referer").is_none() && !request.contains("private-")));
}

#[tokio::test]
async fn explicit_policy_suppresses_virtual_cross_origin_and_new_document_does_not_inherit_policy()
{
    let server = server().await;
    for (policy_header, html) in [
        (Some("no-referrer"), "<html></html>"),
        (
            None,
            "<html><head><meta name=\"referrer\" content=\"no-referrer\"></head></html>",
        ),
        (Some("same-origin"), "<html></html>"),
    ] {
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            "https://global.quickconnect.to",
            policy(),
        )
        .await;
        record(&proxy, 1, policy_header, html);
        let first = seen_requests(&server).len();
        for kind in 0..5 {
            assert_eq!(
                operation(&proxy, kind)
                    .header(
                        "Referer",
                        format!(
                            "{}/private-path?private-query=secret",
                            proxy.state.proxy_origin
                        )
                    )
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::OK
            );
        }
        for (kind, request) in seen_requests(&server)[first..].iter().enumerate() {
            let expected = (policy_header == Some("same-origin") && kind == 0)
                .then_some("https://global.quickconnect.to/");
            assert_eq!(header(request, "referer"), expected);
        }
    }
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    record(&proxy, 1, None, "<html></html>");
    proxy.state.network.document_issued(2, false);
    proxy.state.network.activate_document(2).unwrap();
    let count = server.seen.lock().unwrap().len();
    assert_eq!(
        operation(&proxy, 4)
            .header("Referer", format!("{}/", proxy.state.proxy_origin))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_GATEWAY
    );
    assert_eq!(server.seen.lock().unwrap().len(), count);
    let mut request = operation(&proxy, 4)
        .header("Referer", format!("{}/", proxy.state.proxy_origin))
        .build()
        .unwrap();
    request
        .headers_mut()
        .insert(control::DOCUMENT_HEADER, HeaderValue::from_static("2"));
    assert_eq!(
        client().execute(request).await.unwrap().status(),
        StatusCode::OK
    );
    assert!(header(seen_requests(&server).last().unwrap(), "referer").is_none());
    proxy.state.network.revoke();
    let count = server.seen.lock().unwrap().len();
    let mut request = operation(&proxy, 4)
        .header("Referer", format!("{}/", proxy.state.proxy_origin))
        .build()
        .unwrap();
    request
        .headers_mut()
        .insert(control::DOCUMENT_HEADER, HeaderValue::from_static("2"));
    assert!(client()
        .execute(request)
        .await
        .unwrap()
        .status()
        .is_client_error());
    assert_eq!(server.seen.lock().unwrap().len(), count);
}

#[tokio::test]
async fn malformed_duplicate_and_oversize_referrers_are_fixed_local_refusals_before_outbound() {
    let server = server().await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    record(&proxy, 1, None, "<html></html>");
    let invalid = [
        "".to_string(),
        "/private-relative".into(),
        "https://user:private-secret@private.invalid/".into(),
        "https://private.invalid/#private-secret".into(),
        "https://private.invalid/\tprivate-secret".into(),
        format!("{}/{}", proxy.state.proxy_origin, "x".repeat(8192)),
    ];
    for kind in 0..5 {
        for value in &invalid {
            let response = operation(&proxy, kind)
                .header("Referer", value)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let body = response.text().await.unwrap();
            assert!(body.contains("referrer") && !body.contains("private-"));
            assert!(server.seen.lock().unwrap().is_empty());
        }
        let response = operation(&proxy, kind)
            .header("Referer", format!("{}/", proxy.state.proxy_origin))
            .header("Referer", format!("{}/", proxy.state.proxy_origin))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(server.seen.lock().unwrap().is_empty());
    }
}
