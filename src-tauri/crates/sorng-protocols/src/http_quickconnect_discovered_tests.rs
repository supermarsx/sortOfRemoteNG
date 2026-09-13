//! Synthetic verified control replies enroll exact routes; no NAS, provider
//! API, OS trust store or user credentials are accessed.
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
async fn verified_global_to_regional_to_browser_shaped_anonymous_probe_routes_and_logs_exact_origin(
) {
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
    assert_eq!(
        routed(&proxy, REGIONAL, true)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert!(server.seen.lock().unwrap().is_empty());
    learn(&proxy).await;
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
    assert_eq!(seen.len(), 8);
    for pair in seen.chunks_exact(2) {
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
        format!("{}{}", proxy.state.proxy_origin, control::DISCOVERED_PATH)
    );
    assert!(!serde_json::to_string(&log).unwrap().contains("private-"));
}

#[tokio::test]
async fn discovered_routes_refuse_unlearned_aliases_unsafe_headers_methods_queries_and_stale_documents(
) {
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
        REGIONAL.to_string(),
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
    let mut next_document = routed(&proxy, PROBE, false).build().unwrap();
    next_document
        .headers_mut()
        .insert(control::DOCUMENT_HEADER, "2".parse().unwrap());
    assert_eq!(client().execute(next_document).await.unwrap().status(), 403);
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
async fn concurrent_verified_replies_union_even_when_later_request_fails_and_old_document_cannot_reuse(
) {
    for second_status in [200, 500] {
        let calls = Arc::new(AtomicU64::new(0));
        let call_count = calls.clone();
        let server = scripted_peer(Arc::new(move |request| {
            if request.to_ascii_lowercase().contains("host: global.quickconnect.to") {
                let first = call_count.fetch_add(1, Ordering::SeqCst) == 0;
                (if first {200} else {second_status}, serde_json::json!([{"sites":[if first {"first.quickconnect.to"} else {"second.quickconnect.to"}]}]).to_string().into_bytes(), String::new(), if first {Duration::from_millis(150)} else {Duration::ZERO})
            } else { (200, b"[]".to_vec(), String::new(), Duration::ZERO) }
        }), false, false).await;
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
        assert_eq!(
            routed(&proxy, "https://first.quickconnect.to/Serv.php", true)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            routed(&proxy, "https://second.quickconnect.to/Serv.php", true)
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            if second_status == 200 { 200 } else { 403 }
        );
        proxy.state.network.document_issued(2, false);
        proxy.state.network.activate_document(2).unwrap();
        let mut next_document = routed(&proxy, "https://first.quickconnect.to/Serv.php", true)
            .build()
            .unwrap();
        next_document
            .headers_mut()
            .insert(control::DOCUMENT_HEADER, "2".parse().unwrap());
        assert_eq!(client().execute(next_document).await.unwrap().status(), 403);
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
