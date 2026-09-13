//! Synthetic CONNECT peers only; no public discovery API or NAS is contacted.
#[path = "http_quickconnect_discovered_tests.rs"]
mod discovered_tests;
use super::super::quickconnect_control::{self as control, ReviewedQuickConnectControl};
use super::*;
use base64::Engine;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

const ORIGINAL: &str = "https://test-nas.fr3.quickconnect.to";
fn policy() -> HttpProxyPolicy {
    HttpProxyPolicy {
        synology_quick_connect_defaults: Some(SynologyQuickConnectDefaults {
            version: 1,
            original_origin: ORIGINAL.into(),
        }),
        query_parameters: vec![super::super::proxy_policy::QueryParameter {
            name: "private-query".into(),
            value: "source-query-secret".into(),
        }],
        ..Default::default()
    }
}
fn payload() -> serde_json::Value {
    serde_json::Value::Array(["mainapp_https", "mainapp_http"].into_iter().map(|id| serde_json::json!({
        "version":1,"command":"get_server_info","stop_when_error":false,"stop_when_success":false,
        "id":id,"serverID":"test-nas","is_gofile":false,"path":"webman"
    })).collect())
}
async fn head<R: AsyncRead + Unpin>(socket: &mut R) -> Option<String> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        if bytes.len() > 16_384 {
            return None;
        }
        bytes.push(socket.read_u8().await.ok()?);
    }
    String::from_utf8(bytes).ok()
}
struct Peer {
    proxy: String,
    client: reqwest::Client,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    tls_failures: Arc<AtomicU64>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn peer(status: u16, body: Vec<u8>, extra: &str, hold: bool, https_proxy: bool) -> Peer {
    let extra = extra.to_string();
    scripted_peer(
        Arc::new(move |_| (status, body.clone(), extra.clone(), Duration::ZERO)),
        hold,
        https_proxy,
    )
    .await
}

type FixtureReply = dyn Fn(&str) -> (u16, Vec<u8>, String, Duration) + Send + Sync;
async fn scripted_peer(reply: Arc<FixtureReply>, hold: bool, https_proxy: bool) -> Peer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy = format!(
        "{}://127.0.0.1:{}",
        if https_proxy { "https" } else { "http" },
        listener.local_addr().unwrap().port()
    );
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let requests = seen.clone();
    let tls_failures = Arc::new(AtomicU64::new(0));
    let failures = tls_failures.clone();
    let acceptor = tls_fixture::test_acceptor();
    let task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                incoming = listener.accept() => {
                    let (mut socket, _) = incoming.unwrap();
                    let (acceptor, requests, failures, reply) = (acceptor.clone(), requests.clone(), failures.clone(), reply.clone());
                    children.spawn(async move {
                        if https_proxy {
                            if acceptor.accept(socket).await.is_err() { failures.fetch_add(1, Ordering::SeqCst); }
                            return;
                        }
                        let Some(connect) = head(&mut socket).await else { return; };
                        requests.lock().unwrap().push(connect);
                        socket.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                        let Ok(mut tls) = acceptor.accept(socket).await else { failures.fetch_add(1, Ordering::SeqCst); return; };
                        let Some(mut request) = head(&mut tls).await else { return; };
                        let length = request.lines().find_map(|line| line.split_once(':').filter(|(name, _)| name.eq_ignore_ascii_case("content-length")).and_then(|(_, value)| value.trim().parse::<usize>().ok())).unwrap_or(0);
                        if length > 8192 { return; }
                        let mut data = vec![0; length];
                        if tls.read_exact(&mut data).await.is_err() { return; }
                        request.push_str(&String::from_utf8_lossy(&data));
                        let (status, body, extra, delay) = reply(&request);
                        let response = format!("HTTP/1.1 {status} Fixture\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nSet-Cookie: upstream-secret=blocked\r\nX-Private-Upstream: blocked\r\n{extra}Connection: close\r\n\r\n", body.len());
                        requests.lock().unwrap().push(request);
                        if hold { let _ = tls.read_u8().await; }
                        else { tokio::time::sleep(delay).await; let _ = tls.write_all(response.as_bytes()).await; let _ = tls.write_all(&body).await; let _ = tls.shutdown().await; }
                    });
                },
                _ = children.join_next(), if !children.is_empty() => {},
            }
        }
    });
    let cert = base64::engine::general_purpose::STANDARD
        .decode(tls_fixture::TEST_CERT)
        .unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(
            reqwest::Proxy::all(&proxy)
                .unwrap()
                .basic_auth("fixture-proxy-user", "fixture-proxy-password"),
        )
        .use_preconfigured_tls(build_pinned_tls_config(hex::encode(Sha256::digest(cert))).unwrap())
        .cookie_store(false)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    Peer {
        proxy,
        client,
        seen,
        tls_failures,
        task,
    }
}
async fn fixture(
    route: Option<ReviewedQuickConnectControl>,
    source: &str,
    policy: HttpProxyPolicy,
) -> FixtureProxy {
    let mut network = ProxyNetworkState::default();
    network.quickconnect_control = route;
    let proxy = proxy_with_policy_and_network(
        format!("{source}/"),
        reqwest::Client::builder()
            .no_proxy()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap(),
        UpstreamAuthMode::Basic,
        policy,
        HashMap::from([("X-Source-Secret".into(), "header-secret".into())]),
        Arc::new(network),
    )
    .await;
    *proxy.state.username.write().unwrap() = "source-private-user".into();
    *proxy.state.password.write().unwrap() = "source-private-password".into();
    proxy.state.document_sequence.store(1, Ordering::SeqCst);
    proxy.state.network.document_issued(1, true);
    proxy
}
fn request(proxy: &FixtureProxy) -> reqwest::RequestBuilder {
    client()
        .post(format!("{}{}", proxy.base, control::PATH))
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header(control::DOCUMENT_HEADER, "1")
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded; charset=UTF-8",
        )
        .body(payload().to_string())
}

#[tokio::test]
async fn discovery_posts_only_validated_anonymous_json_through_configured_connect_proxy() {
    let response =
        br#"[{"errno":0,"sites":["unapproved.invalid"],"server":{"alias":"test-nas"}}]"#.to_vec();
    let server = peer(
        200,
        response.clone(),
        "X-QC-CLIENT-IP: 192.0.2.4\r\n",
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
    for _ in 0..2 {
        let result = request(&proxy)
            .header("Authorization", "Bearer source-secret")
            .header("Cookie", "id=source-cookie")
            .header("X-Source-Secret", "browser-secret")
            .send()
            .await
            .unwrap();
        assert_eq!(result.status(), StatusCode::OK);
        assert_eq!(result.headers()["content-type"], "application/json");
        assert_eq!(result.headers()["x-qc-client-ip"], "192.0.2.4");
        assert!(!result.headers().contains_key("set-cookie"));
        assert!(!result.headers().contains_key("x-private-upstream"));
        assert_eq!(
            result.json::<serde_json::Value>().await.unwrap(),
            serde_json::from_slice::<serde_json::Value>(&response).unwrap()
        );
    }
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 4);
    for pair in seen.chunks_exact(2) {
        assert!(pair[0].starts_with("CONNECT global.quickconnect.to:443 "));
        assert!(pair[0]
            .to_ascii_lowercase()
            .contains("proxy-authorization: basic "));
        assert!(pair[1].starts_with("POST /Serv.php HTTP/1.1\r\n"));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(pair[1].split_once("\r\n\r\n").unwrap().1)
                .unwrap(),
            payload()
        );
        let lower = pair[1].to_ascii_lowercase();
        for forbidden in [
            "authorization:",
            "cookie:",
            "origin:",
            "referer:",
            "source-private",
            "source-query",
            "x-source-secret",
            "x-sorng",
            "fixture-proxy",
        ] {
            assert!(!lower.contains(forbidden), "{forbidden}");
        }
    }
    assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 2);
    assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 0);
    let manager = proxy.state.global_sessions.lock().unwrap();
    assert_eq!(manager.request_log.len(), 2);
    for entry in &manager.request_log {
        assert_eq!(entry.method, "POST");
        assert_eq!(
            entry.url,
            format!("{}{}", proxy.state.proxy_origin, control::PATH)
        );
        assert_eq!(entry.status, 200);
        assert!(entry.error.is_none());
    }
}

#[tokio::test]
async fn discovery_rejects_cross_alias_extra_commands_malformed_and_oversized_requests_before_network(
) {
    let server = peer(200, b"[]".to_vec(), "", false, false).await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    for mutation in [
        "alias",
        "extra",
        "tunnel",
        "gofile",
        "path",
        "version",
        "order",
        "length",
        "malformed",
        "size",
        "duplicate",
    ] {
        let mut value = payload();
        match mutation {
            "alias" => value[0]["serverID"] = "other-nas".into(),
            "extra" => value[0]["password"] = "forbidden".into(),
            "tunnel" => value[0]["command"] = "request_tunnel".into(),
            "gofile" => value[0]["is_gofile"] = true.into(),
            "path" => value[0]["path"] = "../secret".into(),
            "version" => value[0]["version"] = 2.into(),
            "order" => value.as_array_mut().unwrap().reverse(),
            "length" => {
                value.as_array_mut().unwrap().pop();
            }
            _ => {}
        }
        let body = match mutation {
            "malformed" => "not json".into(),
            "size" => "x".repeat(4097),
            "duplicate" => {
                value
                    .to_string()
                    .replacen("\"version\":1", "\"version\":1,\"version\":1", 1)
            }
            _ => value.to_string(),
        };
        assert_ne!(
            request(&proxy).body(body).send().await.unwrap().status(),
            StatusCode::OK,
            "{mutation}"
        );
    }
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn discovery_requires_protected_origin_exact_route_and_current_enabled_source_document() {
    let server = peer(200, b"[]".to_vec(), "", false, false).await;
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    for mutation in [
        "host",
        "origin",
        "method",
        "query",
        "subpath",
        "mime",
        "document",
        "duplicate-marker",
        "destination",
    ] {
        let mut request = request(&proxy).build().unwrap();
        match mutation {
            "host" => {
                request
                    .headers_mut()
                    .insert("host", "localhost:1".parse().unwrap());
            }
            "origin" => {
                request.headers_mut().remove("origin");
            }
            "method" => *request.method_mut() = reqwest::Method::GET,
            "query" => request
                .url_mut()
                .set_query(Some("destination=https://unapproved.invalid")),
            "subpath" => request
                .url_mut()
                .set_path(&format!("{}/extra", control::PATH)),
            "mime" => {
                request
                    .headers_mut()
                    .insert("content-type", "text/html".parse().unwrap());
            }
            "document" => {
                request
                    .headers_mut()
                    .insert(control::DOCUMENT_HEADER, "0".parse().unwrap());
            }
            "duplicate-marker" => {
                request
                    .headers_mut()
                    .append(control::DOCUMENT_HEADER, "1".parse().unwrap());
            }
            "destination" => {
                request
                    .headers_mut()
                    .insert("sec-fetch-dest", "document".parse().unwrap());
            }
            _ => unreachable!(),
        }
        assert_ne!(
            client().execute(request).await.unwrap().status(),
            StatusCode::OK,
            "{mutation}"
        );
    }
    for (source, policy) in [
        (ORIGINAL, HttpProxyPolicy::default()),
        ("https://unrelated.invalid", policy()),
    ] {
        let fixture = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            source,
            policy,
        )
        .await;
        assert_eq!(
            request(&fixture).send().await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    let unavailable = fixture(None, ORIGINAL, policy()).await;
    assert_eq!(
        request(&unavailable).send().await.unwrap().status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    proxy.state.network.document_issued(2, false);
    proxy.state.network.activate_document(2).unwrap();
    assert_ne!(
        request(&proxy).send().await.unwrap().status(),
        StatusCode::OK
    );
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn discovery_preserves_json_error_status_but_refuses_redirects_non_json_and_unbounded_responses(
) {
    for (status, bytes, extra, expected) in [
        (
            403,
            br#"{"errno":119}"#.to_vec(),
            "X-QC-CLIENT-IP: invalid\r\n",
            403,
        ),
        (200, b"<html>not json</html>".to_vec(), "", 502),
        (200, vec![b' '; 256 * 1024 + 1], "", 502),
        (
            302,
            b"[]".to_vec(),
            "Location: https://unapproved.invalid/\r\n",
            502,
        ),
    ] {
        let server = peer(status, bytes, extra, false, false).await;
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            ORIGINAL,
            policy(),
        )
        .await;
        let response = request(&proxy).send().await.unwrap();
        assert_eq!(response.status().as_u16(), expected);
        assert!(!response.headers().contains_key("location"));
        assert!(!response.headers().contains_key("x-qc-client-ip"));
        if expected == 403 {
            assert_eq!(
                response.json::<serde_json::Value>().await.unwrap(),
                serde_json::json!({"errno":119})
            );
        }
        assert_eq!(server.seen.lock().unwrap().len(), 2);
    }
}

#[tokio::test]
async fn discovery_production_tls_rejects_bad_destination_and_https_proxy_despite_lax_source() {
    for https_proxy in [false, true] {
        let server = peer(200, b"[]".to_vec(), "", false, https_proxy).await;
        let route = ReviewedQuickConnectControl::new(
            Some(reqwest::Proxy::all(&server.proxy).unwrap()),
            "1.2",
        )
        .unwrap();
        let proxy = fixture(Some(route), ORIGINAL, policy()).await;
        assert_eq!(
            request(&proxy).send().await.unwrap().status(),
            StatusCode::BAD_GATEWAY
        );
        assert!(server.tls_failures.load(Ordering::SeqCst) > 0);
        assert_eq!(
            server.seen.lock().unwrap().len(),
            if https_proxy { 0 } else { 1 }
        );
    }
}

#[tokio::test]
async fn discovery_inflight_result_is_discarded_on_primary_navigation_or_proxy_stop() {
    for stop in [false, true] {
        let server = peer(200, b"[]".to_vec(), "", true, false).await;
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            ORIGINAL,
            policy(),
        )
        .await;
        let task = tokio::spawn(request(&proxy).send());
        tokio::time::timeout(Duration::from_secs(2), async {
            while server.seen.lock().unwrap().len() < 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        if stop {
            proxy.state.network.revoke();
        } else {
            proxy.state.network.document_issued(2, false);
            proxy.state.network.activate_document(2).unwrap();
        }
        let response = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_ne!(response.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn discovery_manifest_stays_closed_and_custom_dsm_navigation_uses_existing_receipt_route() {
    let mut settings = policy();
    let value = control::manifest(&settings, ORIGINAL, "http://fixture.localhost:1234").unwrap();
    assert_eq!(value["rpc"]["upstreamUrl"], control::UPSTREAM);
    assert_eq!(value["navigationOrigins"].as_array().unwrap().len(), 4);
    let secure_alias = "https://test-nas.quickconnect.to";
    let alias_manifest =
        control::manifest(&settings, secure_alias, "http://fixture.localhost:1234").unwrap();
    assert_eq!(alias_manifest, value);
    assert_eq!(value["directNavigation"]["alias"], "test-nas");
    assert_eq!(
        value["regionalNavigation"],
        serde_json::json!({"version":1,"alias":"test-nas"})
    );
    assert_eq!(
        value["discovered"]["proxyUrl"],
        format!("http://fixture.localhost:1234{}", control::DISCOVERED_PATH)
    );
    assert_eq!(
        control::manifest(
            &settings,
            "https://test-nas.direct.quickconnect.to:5001",
            "http://fixture.localhost:1234"
        )
        .unwrap(),
        value
    );
    assert_eq!(
        settings
            .synology_quick_connect_defaults
            .as_ref()
            .unwrap()
            .nas_alias()
            .as_deref(),
        Some("test-nas")
    );
    assert!(control::manifest(
        &settings,
        "https://other-nas.quickconnect.to",
        "http://fixture.localhost:1234"
    )
    .is_none());
    settings.https_only = true;
    assert_eq!(
        control::manifest(&settings, ORIGINAL, "http://fixture.localhost:1234").unwrap()
            ["navigationOrigins"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(control::manifest(
        &HttpProxyPolicy::default(),
        ORIGINAL,
        "http://fixture.localhost:1234"
    )
    .is_none());
    assert!(control::manifest(
        &settings,
        "https://unrelated.invalid",
        "http://fixture.localhost:1234"
    )
    .is_none());
    let source = "https://custom-dsm.invalid:5001";
    settings
        .synology_quick_connect_defaults
        .as_mut()
        .unwrap()
        .original_origin = source.into();
    let value = control::manifest(&settings, source, "http://fixture.localhost:1234").unwrap();
    assert!(value.get("rpc").is_none());
    assert!(value.get("regionalNavigation").is_none());
    let proxy = fixture(None, source, settings).await;
    *proxy.state.last_error.lock().unwrap() = Some("unrelated previous failure".into());
    let response = client()
        .get(format!(
            "{}{}",
            proxy.base,
            super::super::quickconnect::PATH
        ))
        .query(&[(
            "destination",
            "https://www.quickconnect.to/?private-token=hidden",
        )])
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let body = response.text().await.unwrap();
    assert!(body.contains("\"kind\":\"redirect_review\""));
    assert!(body.contains("Preparing destination handoff"));
    assert!(!body.contains("private-token"));
    assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 1);
    assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 0);
    assert_eq!(
        proxy.state.last_error.lock().unwrap().as_deref(),
        Some("unrelated previous failure")
    );
    let manager = proxy.state.global_sessions.lock().unwrap();
    assert!(manager
        .redirect_reviews
        .contains_key(&proxy.state.session_id));
    assert_eq!(manager.request_log.back().unwrap().status, 202);
    assert!(manager.request_log.back().unwrap().error.is_none());
}
