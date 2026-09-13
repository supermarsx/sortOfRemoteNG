//! Closed QuickConnect UA parity through the actual protected handler and
//! synthetic CONNECT/TLS peers. No provider/NAS calls or browser identities.
use super::*;
use reqwest::header::HeaderValue;

const RELAY: &str =
    "https://test-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true";
const AGENT: &str = "SyntheticBrowser/1.0 (UA parity fixture) Engine/2.0";

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

#[tokio::test]
async fn closed_discovery_tunnel_direct_and_relay_preserve_current_user_agent_without_retention() {
    let server = scripted_peer(
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
    .await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    for (sequence, agent) in [(1, Some(AGENT)), (2, None)] {
        if sequence == 2 {
            proxy.state.network.document_issued(2, false);
            proxy.state.network.activate_document(2).unwrap();
        }
        proxy.state.network.record_document_referrer(
            sequence,
            &reqwest::header::HeaderMap::new(),
            "<html></html>",
        );
        for kind in 0..5 {
            let mut outgoing = operation(&proxy, kind)
                .header("Authorization", "Bearer private-source-auth")
                .header("Cookie", "source-cookie=private-source-cookie")
                .header("Forwarded", "proto=http;host=private-source")
                .header("X-Forwarded-Host", "private-source-host")
                .header(
                    "Referer",
                    format!("{}/?private-source-query=1", proxy.state.proxy_origin),
                )
                .build()
                .unwrap();
            outgoing.headers_mut().insert(
                control::DOCUMENT_HEADER,
                sequence.to_string().parse().unwrap(),
            );
            if let Some(agent) = agent {
                outgoing
                    .headers_mut()
                    .insert("user-agent", HeaderValue::from_static(agent));
            }
            let response = client().execute(outgoing).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert!(!response.text().await.unwrap().contains(AGENT));
        }
    }
    let seen = server.seen.lock().unwrap();
    let requests: Vec<_> = seen
        .iter()
        .filter(|request| !request.starts_with("CONNECT "))
        .collect();
    assert_eq!(seen.len(), 20);
    assert_eq!(requests.len(), 10);
    for (index, request) in requests.iter().enumerate() {
        let agents: Vec<_> = request
            .lines()
            .filter_map(|line| {
                line.split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("user-agent"))
                    .map(|(_, value)| value.trim())
            })
            .collect();
        assert_eq!(agents, if index < 5 { vec![AGENT] } else { vec![] });
        let lower = request.to_ascii_lowercase();
        for forbidden in [
            "private-source",
            "forwarded:",
            "x-forwarded-host:",
            "authorization:",
        ] {
            assert!(!lower.contains(forbidden));
        }
        assert!(lower.contains(&format!("referer: {ORIGINAL}/")));
        if request.starts_with("GET ") {
            assert!(!lower.contains("cookie:"));
            assert!(lower.contains(&format!("origin: {ORIGINAL}")));
        } else {
            assert!(!lower.contains("origin:"));
        }
    }
    let logs = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert!(!serde_json::to_string(&logs).unwrap().contains(AGENT));
}

#[tokio::test]
async fn malformed_duplicate_and_oversize_user_agents_fail_before_any_upstream_request() {
    let server = peer(200, b"[]".to_vec(), "", false, false).await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    let invalid = [
        HeaderValue::from_static(""),
        HeaderValue::from_static("   "),
        HeaderValue::from_static("invalid\tagent"),
        HeaderValue::from_bytes(&[0xff]).unwrap(),
        HeaderValue::from_str(&"x".repeat(1025)).unwrap(),
    ];
    for kind in [0, 1, 2, 3, 4] {
        for value in &invalid {
            let response = operation(&proxy, kind)
                .header("User-Agent", value.clone())
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let body = response.text().await.unwrap();
            assert!(body.contains("User-Agent"));
            assert!(!body.contains("invalid\tagent"));
            assert!(server.seen.lock().unwrap().is_empty());
        }
        let response = operation(&proxy, kind)
            .header("User-Agent", AGENT)
            .header("User-Agent", AGENT)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(server.seen.lock().unwrap().is_empty());
    }
    let logs = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert!(logs.iter().all(
        |entry| entry
            .diagnostic
            .as_ref()
            .is_some_and(|value| value.code == "quickconnect_unsupported_request"
                && value.stage == "validation")
    ));
}

#[tokio::test]
async fn printable_user_agent_at_exact_limit_is_forwarded_without_truncation() {
    let server = peer(
        200,
        pong(),
        "Access-Control-Allow-Origin: *\r\n",
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
    let agent = "x".repeat(1024);
    let response = routed(&proxy, RELAY, false)
        .header("User-Agent", &agent)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert_eq!(
        seen[1].lines().find_map(|line| line
            .split_once(':')
            .filter(|(name, _)| name.eq_ignore_ascii_case("user-agent"))
            .map(|(_, value)| value.trim())),
        Some(agent.as_str())
    );
}
