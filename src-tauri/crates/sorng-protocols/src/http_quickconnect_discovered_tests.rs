//! Synthetic bounded default control/probe routes; no NAS, provider
//! API, OS trust store or user credentials are accessed.
#[path = "http_quickconnect_control_cookie_tests.rs"]
mod control_cookie_tests;
#[path = "http_quickconnect_probe_defaults_tests.rs"]
mod probe_defaults_tests;
#[path = "http_quickconnect_referrer_tests.rs"]
mod referrer_tests;
#[path = "http_quickconnect_relay_probe_tests.rs"]
mod relay_probe_tests;
#[path = "http_quickconnect_scheduling_tests.rs"]
mod scheduling_tests;
#[path = "http_quickconnect_tunnel_tests.rs"]
mod tunnel_tests;
#[path = "http_quickconnect_user_agent_tests.rs"]
mod user_agent_tests;
use super::*;
const REGIONAL: &str = "https://dec.quickconnect.to/Serv.php";
const PROBE: &str = "https://test-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true";
fn smartdns() -> serde_json::Value {
    serde_json::json!([{"server":{"serverID":"provider-internal-id","pingpong_path":""},
        "smartdns":{"host":"test-nas.direct.quickconnect.to","lan":["192-168-50-100.test-nas.direct.quickconnect.to","other-nas.direct.quickconnect.to"]},
        "service":{"port":5001,"ext_port":5002}}])
}
fn pong() -> Vec<u8> {
    use md5::{Digest, Md5};
    serde_json::json!({"ezid":hex::encode(Md5::digest(b"test-nas"))})
        .to_string()
        .into_bytes()
}
fn routed(proxy: &FixtureProxy, destination: &str, post: bool) -> reqwest::RequestBuilder {
    let builder = client()
        .request(
            if post {
                reqwest::Method::POST
            } else {
                reqwest::Method::GET
            },
            format!("{}{}", proxy.base, control::DISCOVERED_PATH),
        )
        .query(&[("destination", destination)])
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header(control::DOCUMENT_HEADER, "1");
    if post {
        builder
            .header("Origin", &proxy.state.proxy_origin)
            .header(
                "Content-Type",
                "application/x-www-form-urlencoded; charset=UTF-8",
            )
            .body(payload().to_string())
    } else {
        builder
    }
}
async fn learn(proxy: &FixtureProxy) {
    let response = request(proxy).send().await.unwrap();
    assert_eq!(response.status(), 200);
    response.bytes().await.unwrap();
}

#[tokio::test]
async fn verified_regional_to_browser_shaped_anonymous_probe_routes_and_logs_exact_origin() {
    let server = scripted_peer(Arc::new(|request| {
        let lower = request.to_ascii_lowercase();
        let (body, extra) = if request.starts_with("GET ") { (pong(), "Access-Control-Allow-Origin: *\r\n".into()) }
            else if lower.contains("host: global.quickconnect.to") { (br#"[{"sites":["dec.quickconnect.to","attacker.invalid","other.alias.quickconnect.to"]}]"#.to_vec(), String::new()) }
            else { (smartdns().to_string().into_bytes(), String::new()) };
        (200, body, extra, Duration::ZERO)
    }), false, false).await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    assert!(server.seen.lock().unwrap().is_empty());
    // A cached region uses the closed provider-control capability directly;
    // no global exchange or sites[] response is a prerequisite.
    let regional = routed(&proxy, REGIONAL, true).send().await.unwrap();
    assert_eq!(regional.status(), 200);
    assert_eq!(
        regional.json::<serde_json::Value>().await.unwrap(),
        smartdns()
    );
    for destination in [
        PROBE.to_string(),
        PROBE
            .replace("test-nas.direct", "192-168-50-100.test-nas.direct")
            .replace(":5001", ":5002"),
    ] {
        let result = routed(&proxy, &destination, false)
            .header("Authorization", "Bearer private-header")
            .header("Cookie", "source-cookie=secret")
            .header(
                "Referer",
                format!("{}/?private-query=secret", proxy.state.proxy_origin),
            )
            .send()
            .await
            .unwrap();
        assert_eq!(result.status(), 200);
        assert!(!result.headers().contains_key("set-cookie"));
        assert!(!result.headers().contains_key("access-control-allow-origin"));
        assert_eq!(result.bytes().await.unwrap().as_ref(), pong());
    }
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 6);
    assert!(seen[0].starts_with("CONNECT dec.quickconnect.to:443 "));
    for pair in seen.as_chunks::<2>().0 {
        assert!(pair[0].contains("CONNECT "));
        let request = pair[1].to_ascii_lowercase();
        for secret in [
            "authorization:",
            "cookie:",
            "referer:",
            "source-private",
            "private-header",
            "private-query",
            "x-source-secret",
        ] {
            assert!(!request.contains(secret), "{secret}");
        }
        if request.starts_with("get ") {
            assert!(request.contains(&format!("origin: {ORIGINAL}")));
        }
    }
    let log = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert!(log[0].url.starts_with(
        "QuickConnect NAS probe: https://192-168-50-100.test-nas.direct.quickconnect.to:5002"
    ));
    assert_eq!(
        log[2].url,
        "QuickConnect regional discovery: https://dec.quickconnect.to"
    );
    assert_eq!(
        log.last().unwrap().url,
        "QuickConnect regional discovery: https://dec.quickconnect.to"
    );
    assert!(!serde_json::to_string(&log).unwrap().contains("private-"));
}

#[tokio::test]
async fn default_routes_refuse_other_aliases_unsafe_headers_methods_queries_and_stale_documents() {
    let server = peer(200, smartdns().to_string().into_bytes(), "", false, false).await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    learn(&proxy).await;
    let before = server.seen.lock().unwrap().len();
    for destination in [
        PROBE.replace("test-nas", "other-nas"),
        PROBE.replace(":5001", ":444"),
        format!("{PROBE}&secret=hidden"),
        PROBE.replace("/webman/pingpong.cgi", "/webapi/auth.cgi"),
        PROBE.replace("https:", "http:"),
    ] {
        let response = routed(&proxy, &destination, destination == REGIONAL)
            .send()
            .await
            .unwrap();
        assert!(matches!(response.status().as_u16(), 400 | 403));
    }
    for mutation in [
        "missing-site",
        "missing-mode",
        "missing-dest",
        "duplicate-site",
        "duplicate-mode",
        "duplicate-dest",
        "wrong-origin",
        "duplicate-origin",
        "missing-document",
        "duplicate-document",
        "post-probe",
        "body",
    ] {
        let mut request = routed(&proxy, PROBE, false).build().unwrap();
        match mutation {
            "missing-site" => {
                request.headers_mut().remove("sec-fetch-site");
            }
            "missing-mode" => {
                request.headers_mut().remove("sec-fetch-mode");
            }
            "missing-dest" => {
                request.headers_mut().remove("sec-fetch-dest");
            }
            "duplicate-site" => {
                request
                    .headers_mut()
                    .append("sec-fetch-site", "same-origin".parse().unwrap());
            }
            "duplicate-mode" => {
                request
                    .headers_mut()
                    .append("sec-fetch-mode", "cors".parse().unwrap());
            }
            "duplicate-dest" => {
                request
                    .headers_mut()
                    .append("sec-fetch-dest", "empty".parse().unwrap());
            }
            "wrong-origin" => {
                request
                    .headers_mut()
                    .insert("origin", "null".parse().unwrap());
            }
            "duplicate-origin" => {
                request
                    .headers_mut()
                    .append("origin", proxy.state.proxy_origin.parse().unwrap());
                request
                    .headers_mut()
                    .append("origin", proxy.state.proxy_origin.parse().unwrap());
            }
            "missing-document" => {
                request.headers_mut().remove(control::DOCUMENT_HEADER);
            }
            "duplicate-document" => {
                request
                    .headers_mut()
                    .append(control::DOCUMENT_HEADER, "1".parse().unwrap());
            }
            "post-probe" => {
                *request.method_mut() = reqwest::Method::POST;
            }
            "body" => {
                *request.body_mut() = Some("private-body".into());
            }
            _ => unreachable!(),
        }
        assert!(
            matches!(
                client().execute(request).await.unwrap().status().as_u16(),
                400 | 403
            ),
            "{mutation}"
        );
    }
    proxy.state.network.document_issued(2, false);
    proxy.state.network.activate_document(2).unwrap();
    // The old immutable marker cannot use a fresh document's capability.
    assert_eq!(
        routed(&proxy, PROBE, false).send().await.unwrap().status(),
        502
    );
    let optout = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        HttpProxyPolicy::default(),
    )
    .await;
    assert_eq!(
        routed(&optout, PROBE, false).send().await.unwrap().status(),
        403
    );
    assert_eq!(server.seen.lock().unwrap().len(), before);
}

#[tokio::test]
async fn concurrent_discovery_results_do_not_change_default_probe_permission_or_old_document_fence()
{
    for second_status in [200, 500] {
        let calls = Arc::new(AtomicU64::new(0));
        let call_count = calls.clone();
        let server = scripted_peer(
            Arc::new(move |request| {
                if request.starts_with("POST ") {
                    let first = call_count.fetch_add(1, Ordering::SeqCst) == 0;
                    let host = if first {
                        "first.test-nas.direct.quickconnect.to"
                    } else {
                        "second.test-nas.direct.quickconnect.to"
                    };
                    (
                        if first { 200 } else { second_status },
                        serde_json::json!([{"smartdns":{"host":host},"service":{"port":5001}}])
                            .to_string()
                            .into_bytes(),
                        String::new(),
                        if first {
                            Duration::from_millis(150)
                        } else {
                            Duration::ZERO
                        },
                    )
                } else {
                    (
                        200,
                        pong(),
                        "Access-Control-Allow-Origin: *\r\n".into(),
                        Duration::ZERO,
                    )
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
        let first = request(&proxy).build().unwrap();
        let pending = tokio::spawn(async move { client().execute(first).await.unwrap() });
        tokio::time::timeout(Duration::from_secs(2), async {
            while calls.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            request(&proxy).send().await.unwrap().status().as_u16(),
            second_status
        );
        assert_eq!(pending.await.unwrap().status(), 200);
        let first_probe = PROBE.replace("test-nas.direct", "first.test-nas.direct");
        let second_probe = PROBE.replace("test-nas.direct", "second.test-nas.direct");
        assert_eq!(
            routed(&proxy, &first_probe, false)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            routed(&proxy, &second_probe, false)
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            200
        );
        proxy.state.network.document_issued(2, false);
        proxy.state.network.activate_document(2).unwrap();
        let before = server.seen.lock().unwrap().len();
        let old_document = routed(&proxy, &first_probe, false).build().unwrap();
        assert_eq!(
            client()
                .execute(old_document)
                .await
                .unwrap()
                .status()
                .as_u16(),
            502
        );
        assert_eq!(server.seen.lock().unwrap().len(), before);
    }
}

#[tokio::test]
async fn probe_cors_identity_json_redirect_and_size_failures_never_become_success() {
    for (status, body, headers) in [
        (200, pong(), ""),
        (
            200,
            pong(),
            "Access-Control-Allow-Origin: https://other.invalid\r\n",
        ),
        (
            200,
            pong(),
            "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Origin: *\r\n",
        ),
        (
            200,
            br#"{"ezid":"wrong"}"#.to_vec(),
            "Access-Control-Allow-Origin: *\r\n",
        ),
        (
            200,
            b"<html>not-json</html>".to_vec(),
            "Access-Control-Allow-Origin: *\r\n",
        ),
        (
            200,
            vec![b'x'; 256 * 1024 + 1],
            "Access-Control-Allow-Origin: *\r\n",
        ),
        (
            302,
            pong(),
            "Access-Control-Allow-Origin: *\r\nLocation: https://other.invalid/private\r\n",
        ),
    ] {
        let server = scripted_peer(
            Arc::new(move |request| {
                if request.starts_with("GET ") {
                    (status, body.clone(), headers.into(), Duration::ZERO)
                } else {
                    (
                        200,
                        smartdns().to_string().into_bytes(),
                        String::new(),
                        Duration::ZERO,
                    )
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
        learn(&proxy).await;
        let response = routed(&proxy, PROBE, false).send().await.unwrap();
        assert_eq!(response.status(), 502);
        assert!(!response.text().await.unwrap().contains("<html>"));
        assert_eq!(server.seen.lock().unwrap().len(), 4);
    }
}

#[tokio::test]
async fn document_replacement_and_session_close_cancel_inflight_and_queued_probes() {
    for close_session in [false, true] {
        let server = scripted_peer(
            Arc::new(|request| {
                if request.starts_with("GET ") {
                    (
                        200,
                        pong(),
                        "Access-Control-Allow-Origin: *\r\n".into(),
                        Duration::from_secs(1),
                    )
                } else {
                    (
                        200,
                        smartdns().to_string().into_bytes(),
                        String::new(),
                        Duration::ZERO,
                    )
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
        learn(&proxy).await;
        let mut pending = Vec::new();
        for _ in 0..2 {
            let request = routed(&proxy, PROBE, false).build().unwrap();
            pending.push(tokio::spawn(async move {
                client().execute(request).await.unwrap()
            }));
        }
        tokio::time::timeout(Duration::from_secs(2), async {
            while server.seen.lock().unwrap().len() < 6 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let request = routed(&proxy, PROBE, false).build().unwrap();
        pending.push(tokio::spawn(async move {
            client().execute(request).await.unwrap()
        }));
        tokio::time::sleep(Duration::from_millis(20)).await;
        if close_session {
            proxy.state.network.revoke();
        } else {
            proxy.state.network.document_issued(2, false);
            proxy.state.network.activate_document(2).unwrap();
        }
        for request in pending {
            let response = tokio::time::timeout(Duration::from_secs(2), request)
                .await
                .unwrap()
                .unwrap();
            assert!(response.status().is_client_error() || response.status().is_server_error());
            assert!(!response.text().await.unwrap().contains("ezid"));
        }
        assert_eq!(
            server.seen.lock().unwrap().len(),
            6,
            "queued probe must not start after revocation"
        );
    }
}

#[tokio::test]
async fn provider_control_needs_no_sites_but_invalid_control_and_probe_bodies_never_send() {
    let server = peer(
        200,
        br#"[{"sites":["advertised.quickconnect.to"]}]"#.to_vec(),
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
    for body in [
        "not-json".to_string(),
        payload()
            .to_string()
            .replace("get_server_info", "request_tunnel"),
        payload().to_string().replace("test-nas", "other-nas"),
    ] {
        assert_eq!(
            routed(&proxy, REGIONAL, true)
                .body(body)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    assert_eq!(
        routed(&proxy, PROBE, false)
            .body("private-probe-body")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert!(
        server.seen.lock().unwrap().is_empty(),
        "invalid control or GET body cannot contact any upstream"
    );
    assert_eq!(
        routed(&proxy, REGIONAL, true)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let seen = server.seen.lock().unwrap();
    assert_eq!(
        seen.len(),
        2,
        "one requested regional exchange, no global discovery or fallback"
    );
    assert!(seen[0].starts_with("CONNECT dec.quickconnect.to:443 "));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(seen[1].split_once("\r\n\r\n").unwrap().1)
            .unwrap(),
        payload()
    );
    let log = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(
        log[0].url,
        "QuickConnect regional discovery: https://dec.quickconnect.to"
    );
    assert!(log[0].error.is_none());
    assert_eq!(
        log[1].url,
        "Attempted QuickConnect NAS probe: https://test-nas.direct.quickconnect.to:5001"
    );
    assert_eq!(
        log[1].error.as_deref(),
        Some("HTTP 400 [quickconnect_unsupported_body]")
    );
    assert!(log
        .iter()
        .skip(2)
        .all(|entry| entry.error.as_deref() == Some("HTTP 400 [quickconnect_unsupported_body]")));
    let capture = serde_json::to_string(&log).unwrap();
    for hidden in [
        "serverID",
        "private-",
        "not-json",
        "other-nas",
        "request_tunnel",
        "destination=",
    ] {
        assert!(!capture.contains(hidden));
    }
}

#[tokio::test]
async fn actual_upstream_403_is_not_reported_as_a_native_missing_grant() {
    let server = peer(
        403,
        br#"[{"errno":13,"providerPrivate":"do-not-log"}]"#.to_vec(),
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
    let response = routed(&proxy, REGIONAL, true).send().await.unwrap();
    assert_eq!(response.status(), 403);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()[0]["errno"],
        13
    );
    assert_eq!(server.seen.lock().unwrap().len(), 2);
    let log = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(log.len(), 1);
    assert_eq!(
        log[0].url,
        "QuickConnect regional discovery: https://dec.quickconnect.to"
    );
    for entry in &log {
        assert_eq!(
            entry.error.as_deref(),
            Some("HTTP 403 [quickconnect_upstream_status]")
        );
    }
    assert!(!serde_json::to_string(&log).unwrap().contains("do-not-log"));
}

#[tokio::test]
async fn regional_requests_share_two_exchange_limit_and_document_revocation_cancels_the_queue() {
    for close in [false, true] {
        let server = peer(
            200,
            br#"[{"sites":["dec.quickconnect.to"]}]"#.to_vec(),
            "",
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
        let mut pending = Vec::new();
        for _ in 0..3 {
            let request = routed(&proxy, REGIONAL, true).build().unwrap();
            pending.push(tokio::spawn(async move {
                client().execute(request).await.unwrap()
            }));
        }
        tokio::time::timeout(Duration::from_secs(2), async {
            while server.seen.lock().unwrap().len() < 4 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(server.seen.lock().unwrap().len(), 4);
        if close {
            proxy.state.network.revoke();
        } else {
            proxy.state.network.document_issued(2, false);
            proxy.state.network.activate_document(2).unwrap();
        }
        for request in pending {
            let response = tokio::time::timeout(Duration::from_secs(2), request)
                .await
                .unwrap()
                .unwrap();
            assert!(response.status().is_client_error() || response.status().is_server_error());
        }
        let seen = server.seen.lock().unwrap();
        assert_eq!(
            seen.len(),
            4,
            "no queued regional request or fallback after revocation"
        );
        let connects: Vec<_> = seen
            .iter()
            .filter(|request| request.starts_with("CONNECT "))
            .collect();
        assert_eq!(connects.len(), 2);
        assert!(connects
            .iter()
            .all(|request| request.starts_with("CONNECT dec.quickconnect.to:443 ")));
        let log = proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        assert!(log
            .iter()
            .all(|entry| entry.error.as_deref() == Some("HTTP 502 [quickconnect_stale_document]")));
    }
}
