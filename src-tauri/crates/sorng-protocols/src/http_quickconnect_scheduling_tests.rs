//! Real local CONNECT/TLS exchanges only; no provider APIs or NAS requests.
use super::*;
use control::{Diagnostic, ExchangeObservation};

const RELAY_PROBE: &str =
    "https://test-nas.de2.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true";

fn native_request(proxy: &FixtureProxy, destination: &str, post: bool) -> axum::extract::Request {
    let request = routed(proxy, destination, post).build().unwrap();
    let body = request
        .body()
        .and_then(reqwest::Body::as_bytes)
        .unwrap_or_default()
        .to_vec();
    let mut builder = axum::http::Request::builder()
        .method(request.method().clone())
        .uri(&request.url()[url::Position::BeforePath..]);
    *builder.headers_mut().unwrap() = request.headers().clone();
    builder.body(axum::body::Body::from(body)).unwrap()
}
fn observed(response: &axum::http::Response<axum::body::Body>) -> &ExchangeObservation {
    response.extensions().get::<ExchangeObservation>().unwrap()
}
fn code(response: &axum::http::Response<axum::body::Body>) -> &'static str {
    response.extensions().get::<Diagnostic>().unwrap().code()
}
async fn until_http_count(peer: &Peer, expected: usize) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if peer
                .seen
                .lock()
                .unwrap()
                .iter()
                .filter(|line| !line.starts_with("CONNECT "))
                .count()
                == expected
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn four_stalled_direct_probes_cannot_starve_control_tunnel_or_regional_relay() {
    let server = scripted_peer(
        Arc::new(|request| {
            if request.starts_with("GET ") {
                let direct = request
                    .to_ascii_lowercase()
                    .contains(".direct.quickconnect.to:");
                (
                    200,
                    pong(),
                    "Access-Control-Allow-Origin: *\r\n".into(),
                    if direct {
                        Duration::from_secs(30)
                    } else {
                        Duration::ZERO
                    },
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
    let mut pending = Vec::new();
    for _ in 0..4 {
        let request = native_request(&proxy, PROBE, false);
        let state = proxy.state.clone();
        pending.push(tokio::spawn(async move {
            control::handle(state, request).await
        }));
    }
    until_http_count(&server, 4).await;
    for tunnel in [false, true] {
        let mut request = native_request(&proxy, REGIONAL, true);
        if tunnel {
            *request.body_mut() = axum::body::Body::from(serde_json::json!([{
                "version":1,"command":"request_tunnel","stop_when_error":false,"stop_when_success":true,
                "id":"mainapp_https","serverID":"test-nas","is_gofile":false,"path":""
            }]).to_string());
            request.headers_mut().remove("content-length");
        }
        let response = tokio::time::timeout(
            Duration::from_secs(2),
            control::handle(proxy.state.clone(), request),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            observed(&response).phase.as_str(),
            if tunnel {
                "quickconnect_tunnel"
            } else {
                "quickconnect_discovery"
            }
        );
        assert_eq!(observed(&response).lane.unwrap().as_str(), "control");
    }
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        control::handle(
            proxy.state.clone(),
            native_request(&proxy, RELAY_PROBE, false),
        ),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), 200);
    let observation = observed(&response);
    assert_eq!(observation.phase.as_str(), "quickconnect_relay_probe");
    assert_eq!(observation.outcome.as_str(), "succeeded");
    assert_eq!(observation.stage.as_str(), "complete");
    assert!(observation.active_ms.is_some());
    assert_eq!(observation.upstream_status, Some(200));
    assert!(
        pending.iter().all(|task| !task.is_finished()),
        "relay finished before stalled direct attempts"
    );
    proxy.state.network.revoke();
    for task in pending {
        let response = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(code(&response), "quickconnect_stale_document");
        assert_eq!(observed(&response).outcome.as_str(), "cancelled");
        assert_eq!(observed(&response).lane.unwrap().as_str(), "direct_probe");
    }
    let requests = server.seen.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|line| !line.starts_with("CONNECT "))
            .count(),
        7,
        "no replay, fallback or extra control request"
    );
    for request in requests.iter().filter(|line| !line.starts_with("CONNECT ")) {
        let lower = request.to_ascii_lowercase();
        assert!(!lower.contains("authorization:"));
        assert!(!lower.contains("cookie:"));
        assert!(!lower.contains("source-private"));
    }
}

#[tokio::test]
async fn relay_queue_deadline_has_no_upstream_contact_and_document_replacement_cancels_active() {
    let server = peer(
        200,
        pong(),
        "Access-Control-Allow-Origin: *\r\n",
        true,
        false,
    )
    .await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    let state = proxy.state.clone();
    let request = native_request(&proxy, RELAY_PROBE, false);
    let first = tokio::spawn(async move { control::handle(state, request).await });
    until_http_count(&server, 1).await;
    let response = control::handle(
        proxy.state.clone(),
        native_request(&proxy, RELAY_PROBE, false),
    )
    .await;
    assert_eq!(response.status(), 504);
    assert_eq!(code(&response), "quickconnect_queue_timeout");
    let observation = observed(&response);
    assert_eq!(observation.stage.as_str(), "queue");
    assert_eq!(observation.outcome.as_str(), "timed_out");
    assert!(observation.queue_ms.unwrap() >= 900);
    assert!(observation.active_ms.is_none());
    assert!(observation.upstream_status.is_none());
    assert_eq!(server.seen.lock().unwrap().len(), 2);
    proxy.state.network.document_issued(2, false);
    proxy.state.network.activate_document(2).unwrap();
    let cancelled = tokio::time::timeout(Duration::from_secs(1), first)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(observed(&cancelled).outcome.as_str(), "cancelled");
    assert_eq!(server.seen.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn direct_network_deadline_is_explicit_and_releases_its_capacity() {
    let server = peer(
        200,
        pong(),
        "Access-Control-Allow-Origin: *\r\n",
        true,
        false,
    )
    .await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    let response = tokio::time::timeout(
        Duration::from_secs(6),
        control::handle(proxy.state.clone(), native_request(&proxy, PROBE, false)),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), 504);
    assert_eq!(code(&response), "quickconnect_exchange_timeout");
    let observation = observed(&response);
    assert_eq!(observation.outcome.as_str(), "timed_out");
    assert_eq!(observation.stage.as_str(), "connect_tls");
    assert!(observation.active_ms.unwrap() >= 3500);
    assert!(observation.duration_ms >= observation.active_ms.unwrap());
    assert_eq!(
        server.seen.lock().unwrap().len(),
        2,
        "only one attempted request"
    );
}

#[tokio::test]
async fn response_refusals_have_exact_safe_codes_stage_and_received_status() {
    for (status, body, extra, expected, stage) in [
        (
            302,
            b"[]".to_vec(),
            "Location: https://private.invalid/?secret=never\r\n".to_string(),
            "quickconnect_upstream_redirect",
            "response_headers",
        ),
        (
            200,
            pong(),
            String::new(),
            "quickconnect_cors_rejected",
            "response_headers",
        ),
        (
            200,
            pong(),
            "Access-Control-Allow-Origin: https://wrong.invalid\r\n".into(),
            "quickconnect_cors_rejected",
            "response_headers",
        ),
        (
            200,
            pong(),
            "Access-Control-Allow-Origin: *\r\nContent-Encoding: gzip\r\n".into(),
            "quickconnect_response_encoding",
            "response_headers",
        ),
        (
            200,
            vec![b'x'; 256 * 1024 + 1],
            String::new(),
            "quickconnect_response_size",
            "response_headers",
        ),
        (
            200,
            vec![0xff],
            "Access-Control-Allow-Origin: *\r\n".into(),
            "quickconnect_response_utf8",
            "response_validation",
        ),
        (
            200,
            b"{invalid-private-json".to_vec(),
            "Access-Control-Allow-Origin: *\r\n".into(),
            "quickconnect_response_json",
            "response_validation",
        ),
        (
            200,
            br#"{"ezid":"wrong-private-identity"}"#.to_vec(),
            "Access-Control-Allow-Origin: *\r\n".into(),
            "quickconnect_probe_identity_mismatch",
            "response_validation",
        ),
        (
            200,
            b"invalid-chunked-private-body".to_vec(),
            "Access-Control-Allow-Origin: *\r\nTransfer-Encoding: chunked\r\n".into(),
            "quickconnect_response_read_failed",
            "response_body",
        ),
    ] {
        let server = peer(status, body, &extra, false, false).await;
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            ORIGINAL,
            policy(),
        )
        .await;
        let response =
            control::handle(proxy.state.clone(), native_request(&proxy, PROBE, false)).await;
        assert_eq!(response.status(), 502, "{expected}");
        assert_eq!(code(&response), expected);
        let observation = observed(&response);
        assert_eq!(observation.stage.as_str(), stage, "{expected}");
        assert_eq!(observation.outcome.as_str(), "failed");
        assert_eq!(observation.upstream_status, Some(status));
        assert!(!format!("{observation:?}").contains("private"));
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("private"));
        assert_eq!(
            server.seen.lock().unwrap().len(),
            2,
            "one exchange, no redirect follow"
        );
    }
}

#[tokio::test]
async fn upstream_json_errors_and_words_like_tls_are_not_misclassified_as_transport() {
    for status in [200, 403, 503] {
        let server = peer(
            status,
            br#"{"message":"TLS handshake failure private-text"}"#.to_vec(),
            "",
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
        let response =
            control::handle(proxy.state.clone(), native_request(&proxy, REGIONAL, true)).await;
        assert_eq!(response.status().as_u16(), status);
        assert_eq!(code(&response), "quickconnect_upstream_status");
        assert_eq!(
            observed(&response).outcome.as_str(),
            if status == 200 {
                "succeeded"
            } else {
                "http_error"
            }
        );
        assert_eq!(observed(&response).upstream_status, Some(status));
        assert!(!format!("{:?}", observed(&response)).contains("private"));
    }
}

#[tokio::test]
async fn strict_tls_failure_and_connection_refusal_are_distinct_without_raw_error_text() {
    let server = peer(200, b"[]".to_vec(), "", false, false).await;
    let strict =
        ReviewedQuickConnectControl::new(Some(reqwest::Proxy::all(&server.proxy).unwrap()), "1.2")
            .unwrap();
    let proxy = fixture(Some(strict), ORIGINAL, policy()).await;
    let response =
        control::handle(proxy.state.clone(), native_request(&proxy, REGIONAL, true)).await;
    assert_eq!(code(&response), "quickconnect_tls_failed");
    assert_eq!(observed(&response).stage.as_str(), "connect_tls");
    assert!(observed(&response).upstream_status.is_none());
    assert_eq!(
        server.seen.lock().unwrap().len(),
        1,
        "CONNECT only, no HTTP with untrusted certificate"
    );

    let closed = tokio::net::TcpSocket::new_v4().unwrap();
    closed.bind("127.0.0.1:0".parse().unwrap()).unwrap();
    let address = closed.local_addr().unwrap();
    let strict = ReviewedQuickConnectControl::new(
        Some(reqwest::Proxy::all(format!("http://{address}")).unwrap()),
        "1.2",
    )
    .unwrap();
    let proxy = fixture(Some(strict), ORIGINAL, policy()).await;
    let response =
        control::handle(proxy.state.clone(), native_request(&proxy, REGIONAL, true)).await;
    assert_eq!(code(&response), "quickconnect_connect_failed");
    assert!(observed(&response).upstream_status.is_none());
    assert!(!format!("{:?}", observed(&response)).contains(&address.to_string()));
}
