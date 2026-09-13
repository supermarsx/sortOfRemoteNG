//! Real protected-handler regressions. All certificates, hosts, cookies and
//! CONNECT traffic are synthetic and confined to a loopback listener.
#[path = "http_attempt_http_redirect_tests.rs"]
mod http_redirect_cycle_tests;
use super::*;
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio_rustls::rustls;

const ALIAS: &str = "https://example.quickconnect.to/";
const REGIONAL: &str = "https://example.fr3.quickconnect.to/";
const CACHE: &str =
    "previous=old-route; previous_verify_type=relay; tunnel=old-tunnel; client_ext_ip=192.0.2.1";
const CONNECTOR: &str = "<!doctype html><html><head><script src='/connect_lib.da3fae9c5d057ef58d3a.bundle.js'></script></head><body>Connecting</body></html>";

struct Peer {
    proxy_url: String,
    client: reqwest::Client,
    requests: Arc<std::sync::Mutex<Vec<String>>>,
    body_gate: Arc<tokio::sync::Semaphore>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.body_gate.close();
        self.task.abort();
    }
}

async fn head(stream: &mut (impl AsyncRead + Unpin)) -> std::io::Result<String> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") && bytes.len() < 16 * 1024 {
        bytes.push(stream.read_u8().await?);
    }
    Ok(String::from_utf8(bytes).unwrap())
}

async fn peer() -> Peer {
    let certificate = rcgen::generate_simple_self_signed(vec![
        "example.quickconnect.to".into(),
        "example.fr3.quickconnect.to".into(),
    ])
    .unwrap();
    let der = certificate.serialize_der().unwrap();
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(der.clone())],
        rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_url = format!("http://{}", listener.local_addr().unwrap());
    let transport = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&proxy_url).unwrap())
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = requests.clone();
    let body_gate = Arc::new(tokio::sync::Semaphore::new(0));
    let release = body_gate.clone();
    let task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let captured = captured.clone();
            let release = release.clone();
            children.spawn(async move {
                let connect = head(&mut tcp).await.unwrap();
                assert!(connect.starts_with("CONNECT example.quickconnect.to:443 ")
                    || connect.starts_with("CONNECT example.fr3.quickconnect.to:443 "));
                tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    .await
                    .unwrap();
                let mut stream = acceptor.accept(tcp).await.unwrap();
                let request = head(&mut stream).await.unwrap();
                let path = request.split_whitespace().nth(1).unwrap().to_owned();
                captured.lock().unwrap().push(request);
                let body = match path.as_str() {
                    "/connector" => CONNECTOR,
                    "/broken" => "invalid-gzip",
                    _ => "<html><head></head><body>Ordinary page</body></html>",
                };
                let extra = match path.as_str() {
                    "/override" => "Set-Cookie: previous=new-upstream; Path=/\r\nSet-Cookie: tunnel=; Max-Age=0; Path=/\r\n",
                    "/broken" => "Content-Encoding: gzip\r\n",
                    _ => "",
                };
                let headers = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                stream.write_all(headers.as_bytes()).await.unwrap();
                stream.flush().await.unwrap();
                if path == "/broken" {
                    let Ok(permit) = release.acquire().await else { return };
                    permit.forget();
                }
                let _ = stream.write_all(body.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    Peer {
        proxy_url,
        client: transport,
        requests,
        body_gate,
        task,
    }
}

fn config(peer: &Peer, target: &str) -> BasicAuthProxyConfig {
    serde_json::from_value(json!({
        "target_url":target,"username":"","password":"","connection_id":"fixture-owner",
        "redirect_profile":"synology","upstream_auth_mode":"none",
        "upstream_proxy_url":peer.proxy_url,
        "proxy_policy":{"version":1,"pageScripts":"allow","httpsOnly":false,
            "sameOriginOnly":false,"cacheMode":"normal","queryParameters":[],
            "synologyQuickConnectDefaults":{"version":1,"originalOrigin":ALIAS.trim_end_matches('/')}}
    })).unwrap()
}

fn start(
    registry: &mut attempt::AttemptRegistry,
    peer: &Peer,
    target: &str,
    id: &str,
    previous: Option<&attempt::AttemptSession>,
) -> attempt::AttemptSession {
    let mut config = config(peer, target);
    let target = reqwest::Url::parse(target).unwrap();
    if let Some(previous) = previous {
        let ticket = registry
            .prepare_transfer(previous, &target, "synthetic-consumed-receipt")
            .unwrap();
        registry.stop(previous, Some(&ticket)).unwrap();
        config.continuation_id = Some(ticket);
    }
    registry.start(&config, &target, id).unwrap().unwrap()
}

async fn attempt_proxy(
    peer: &Peer,
    target: &str,
    id: &str,
    attempt: attempt::AttemptSession,
) -> FixtureProxy {
    // Clone the parent fixture before serving the new state. Each hop has a
    // fresh protected authority, network lease and counters, like native start.
    let template = proxy(target.into(), peer.client.clone()).await;
    let mut state = (*template.state).clone();
    state.network = Arc::new(ProxyNetworkState::default());
    state.attempt = Some(attempt);
    state.session_id = id.into();
    state.proxy_policy = config(peer, target).proxy_policy.unwrap();
    state.redirect_profile = Some(BrowserRedirectProfile::Synology);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    state.proxy_authority = format!("p{TOKEN}.localhost:{port}");
    state.proxy_origin = format!("http://{}", state.proxy_authority);
    let state = Arc::new(state);
    drop(template);
    let router = axum::Router::new()
        .fallback(axum_proxy_handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            enforce_proxy_access,
        ))
        .with_state(state.clone());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    FixtureProxy {
        base: format!("http://127.0.0.1:{port}"),
        state,
        task,
    }
}

fn request(
    proxy: &FixtureProxy,
    path: &str,
    marked: bool,
    destination: &str,
) -> reqwest::RequestBuilder {
    client()
        .get(format!(
            "{}{path}{}",
            proxy.base,
            if marked {
                format!("?__sorng_navigation_v1={TOKEN}")
            } else {
                String::new()
            }
        ))
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", destination)
        .header(
            "Sec-Fetch-Mode",
            if destination == "empty" {
                "cors"
            } else {
                "navigate"
            },
        )
}

fn cookies(response: &reqwest::Response) -> Vec<String> {
    response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn protected_handler_restores_only_four_same_origin_route_cookies_once() {
    let peer = peer().await;
    let mut registry = attempt::AttemptRegistry::default();
    let initial = start(&mut registry, &peer, ALIAS, "alias-0", None);
    let source = attempt_proxy(&peer, ALIAS, "alias-0", initial.clone()).await;
    let response = request(&source, "/plain", true, "document")
        .header("Cookie", format!("{CACHE}; unrelated=never-retain"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let regional = start(&mut registry, &peer, REGIONAL, "regional-1", Some(&initial));
    let foreign = attempt_proxy(&peer, REGIONAL, "regional-1", regional.clone()).await;
    // The old listener can still exist during shutdown; its released attempt
    // must already prevent upstream dispatch, independently of network revoke.
    assert!(source.state.network.is_active());
    assert_eq!(
        request(&source, "/plain", true, "document")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::GONE
    );
    assert!(cookies(
        &request(&foreign, "/plain", true, "document")
            .send()
            .await
            .unwrap()
    )
    .is_empty());
    let back = start(&mut registry, &peer, ALIAS, "alias-2", Some(&regional));
    let restored = attempt_proxy(&peer, ALIAS, "alias-2", back).await;
    let response = request(&restored, "/plain", true, "document")
        .send()
        .await
        .unwrap();
    let values = cookies(&response);
    assert_eq!(values.len(), 4);
    for pair in CACHE.split("; ") {
        assert!(values.contains(&format!("{pair}; Path=/; SameSite=Lax")));
    }
    assert!(cookies(
        &request(&restored, "/plain", true, "document")
            .send()
            .await
            .unwrap()
    )
    .is_empty());
    registry
        .stop(restored.state.attempt.as_ref().unwrap(), None)
        .unwrap();
    assert!(restored.state.network.is_active());
    assert_eq!(
        request(&restored, "/plain", true, "document")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::GONE
    );
    let requests = peer.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
    for request in &requests[1..] {
        assert!(!request.to_ascii_lowercase().contains("cookie:"));
    }
}

#[tokio::test]
async fn protected_handler_fresh_upstream_cookie_value_and_deletion_override_cache() {
    let peer = peer().await;
    let mut registry = attempt::AttemptRegistry::default();
    let initial = start(&mut registry, &peer, ALIAS, "initial", None);
    let source = attempt_proxy(&peer, ALIAS, "initial", initial.clone()).await;
    assert_eq!(
        request(&source, "/plain", true, "document")
            .header("Cookie", CACHE)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let regional = start(&mut registry, &peer, REGIONAL, "regional", Some(&initial));
    let back = start(&mut registry, &peer, ALIAS, "returned", Some(&regional));
    let restored = attempt_proxy(&peer, ALIAS, "returned", back).await;
    let response = request(&restored, "/override", true, "document")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let values = cookies(&response);
    assert_eq!(values.len(), 4);
    assert_eq!(
        values
            .iter()
            .filter(|value| value.starts_with("previous="))
            .count(),
        1
    );
    assert!(values
        .iter()
        .any(|value| value == "previous=new-upstream; Path=/"));
    assert!(values.iter().any(|value| {
        cookie_store::Cookie::parse(value.as_str(), &reqwest::Url::parse(ALIAS).unwrap()).is_ok_and(
            |cookie| {
                cookie.name() == "tunnel"
                    && cookie.value().is_empty()
                    && cookie.path() == Some("/")
                    && cookie.max_age().map(|age| age.whole_seconds()) == Some(0)
                    && cookie.is_expired()
            },
        )
    }));
    assert!(!values
        .iter()
        .any(|value| value.contains("old-route") || value.contains("old-tunnel")));
    assert!(cookies(
        &request(&restored, "/plain", true, "document")
            .send()
            .await
            .unwrap()
    )
    .is_empty());
}

#[tokio::test]
async fn protected_handler_stops_only_third_distinct_marked_regional_connector_hop() {
    let peer = peer().await;
    let mut registry = attempt::AttemptRegistry::default();
    let mut session = start(&mut registry, &peer, REGIONAL, "regional-0", None);
    let attempt_id = session.diagnostic().unwrap().0;
    for visit in 0..6 {
        if visit > 0 {
            let alias = start(
                &mut registry,
                &peer,
                ALIAS,
                &format!("alias-{visit}"),
                Some(&session),
            );
            session = start(
                &mut registry,
                &peer,
                REGIONAL,
                &format!("regional-{visit}"),
                Some(&alias),
            );
        }
        let proxy = attempt_proxy(
            &peer,
            REGIONAL,
            &format!("regional-{visit}"),
            session.clone(),
        )
        .await;
        let (path, marked, destination) = match visit {
            0 => ("/connector", false, "iframe"), // Nested/unmarked connector is not an initial landing.
            1 => ("/connector", true, "empty"), // Even a copied marker cannot make XHR a document.
            2 => ("/plain", true, "document"),  // Ordinary HTML is not connector evidence.
            _ => ("/connector", true, "document"),
        };
        let expected = if visit == 5 {
            StatusCode::LOOP_DETECTED
        } else {
            StatusCode::OK
        };
        let response = request(&proxy, path, marked, destination)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "visit {visit}");
        let body = response.text().await.unwrap();
        if visit == 5 {
            assert!(body.contains("sorng_proxy_failure"));
            assert!(!body.contains("proxy_dom_ready"));
            let logs = proxy
                .state
                .global_sessions
                .lock()
                .unwrap()
                .request_log_newest_first();
            assert_eq!(logs.len(), 1);
            assert_eq!(logs[0].status, 508);
            assert_eq!(
                logs[0].error.as_deref(),
                Some("HTTP 508 [quickconnect_connector_restart]")
            );
            let diagnostic = logs[0].diagnostic.as_ref().unwrap();
            assert_eq!(
                (
                    &*diagnostic.phase,
                    &*diagnostic.stage,
                    &*diagnostic.code,
                    &*diagnostic.outcome
                ),
                (
                    "quickconnect_redirect",
                    "handoff",
                    "quickconnect_connector_restart",
                    "failed"
                )
            );
            assert_eq!(diagnostic.attempt_id.as_deref(), Some(attempt_id.as_str()));
            assert_eq!(diagnostic.hop, Some(10));
            assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 1);
        } else if visit >= 3 {
            // Duplicate initial loads within one native hop do not count as new hops.
            for _ in 0..3 {
                assert_eq!(
                    request(&proxy, path, true, destination)
                        .send()
                        .await
                        .unwrap()
                        .status(),
                    StatusCode::OK
                );
            }
        }
    }
    assert_eq!(peer.requests.lock().unwrap().len(), 12);
}

async fn wait_for_header_log(proxy: &FixtureProxy) {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let ready = proxy
                .state
                .global_sessions
                .lock()
                .unwrap()
                .request_log
                .iter()
                .any(|entry| {
                    entry
                        .diagnostic
                        .as_ref()
                        .is_some_and(|value| value.stage == "response_headers")
                });
            if ready {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn protected_handler_decode_failure_updates_one_existing_log_with_safe_diagnostic() {
    let peer = peer().await;
    let proxy = proxy(ALIAS.into(), peer.client.clone()).await;
    let pending = tokio::spawn(request(&proxy, "/broken", true, "document").send());
    wait_for_header_log(&proxy).await;
    let initial = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(initial[0].status, 200);
    peer.body_gate.add_permits(1);
    let response = pending.await.unwrap().unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body = response.text().await.unwrap();
    assert!(body.contains("sorng_proxy_failure"));
    let logs = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].id, initial[0].id);
    assert_eq!(logs[0].status, 502);
    assert_eq!(
        logs[0].error.as_deref(),
        Some("HTTP 502 [http_response_invalid]")
    );
    let diagnostic = logs[0].diagnostic.as_ref().unwrap();
    assert_eq!(
        (
            &*diagnostic.phase,
            &*diagnostic.stage,
            &*diagnostic.code,
            &*diagnostic.outcome
        ),
        ("http", "response_body", "http_response_invalid", "failed")
    );
    assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 1);
    assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 1);
    assert!(proxy.state.last_error.lock().unwrap().is_some());
    assert_eq!(peer.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn protected_handler_body_completion_does_not_resurrect_cleared_or_evicted_logs() {
    for evict in [false, true] {
        let peer = peer().await;
        let proxy = proxy(ALIAS.into(), peer.client.clone()).await;
        proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .set_request_log_capacity(1)
            .unwrap();
        let pending = tokio::spawn(request(&proxy, "/broken", true, "document").send());
        wait_for_header_log(&proxy).await;
        let removed_id = proxy.state.global_sessions.lock().unwrap().request_log[0]
            .id
            .clone();
        if evict {
            assert_eq!(
                request(&proxy, "/plain", false, "empty")
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::OK
            );
        } else {
            proxy
                .state
                .global_sessions
                .lock()
                .unwrap()
                .request_log
                .clear();
        }
        let before = proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        peer.body_gate.add_permits(1);
        assert_eq!(
            pending.await.unwrap().unwrap().status(),
            StatusCode::BAD_GATEWAY
        );
        let after = proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        assert_eq!(after.len(), usize::from(evict));
        assert!(!after.iter().any(|entry| entry.id == removed_id));
        assert_eq!(
            serde_json::to_value(after).unwrap(),
            serde_json::to_value(before).unwrap()
        );
        assert_eq!(proxy.state.error_count.load(Ordering::SeqCst), 1);
    }
}
