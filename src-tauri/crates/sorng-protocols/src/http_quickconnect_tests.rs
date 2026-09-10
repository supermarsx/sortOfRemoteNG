//! Synthetic HTTP-only tripwires: no QuickConnect or destination DNS/network.
use super::*;
use tokio::io::AsyncWriteExt;

struct Tripwire {
    address: std::net::SocketAddr,
    hits: Arc<AtomicU64>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Tripwire {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn tripwire() -> Tripwire {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicU64::new(0));
    let count = hits.clone();
    let task = tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            count.fetch_add(1, Ordering::SeqCst);
            let _ = stream
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
        }
    });
    Tripwire {
        address,
        hits,
        task,
    }
}
fn register(proxy: &FixtureProxy) {
    let state = &proxy.state;
    state.global_sessions.lock().unwrap().sessions.insert(
        state.session_id.clone(),
        ProxySessionEntry {
            target_url: state.target_url.clone(),
            username: String::new(),
            password: String::new(),
            upstream_auth_mode: state.upstream_auth_mode,
            proxy_policy: state.proxy_policy.clone(),
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: 1,
            min_tls_version: "1.2".into(),
            verify_ssl: true,
            accepted_cert_fingerprint: None,
            request_count: state.request_count.clone(),
            error_count: state.error_count.clone(),
            last_error: state.last_error.clone(),
            shutdown_tx: None,
        },
    );
}
async fn fixture(host: &str, policy: HttpProxyPolicy) -> (FixtureProxy, Tripwire) {
    let upstream = tripwire().await;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve(host, upstream.address)
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap();
    let proxy = proxy_with_policy(
        format!("https://{host}:{}/", upstream.address.port()),
        client,
        UpstreamAuthMode::Basic,
        policy,
        HashMap::new(),
    )
    .await;
    register(&proxy);
    *proxy.state.username.write().unwrap() = "synthetic-private-user".into();
    *proxy.state.password.write().unwrap() = "synthetic-private-password".into();
    (proxy, upstream)
}
fn request(proxy: &FixtureProxy) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{}", proxy.base, quickconnect::PATH))
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
}
fn peek(proxy: &FixtureProxy) -> Option<redirect::ProxyRedirectReview> {
    proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .review_redirect(&proxy.state.session_id, None)
}
fn enabled() -> HttpProxyPolicy {
    HttpProxyPolicy {
        allow_cross_origin_redirects: true,
        ..Default::default()
    }
}

#[tokio::test]
async fn quickconnect_navigation_records_one_use_receipt_without_any_upstream_or_destination_request(
) {
    let (proxy, upstream) = fixture("fixture.quickconnect.to", enabled()).await;
    let destination = tripwire().await;
    let target = format!(
        "https://127.0.0.1:{}/dsm/login?private-token=hidden#fragment",
        destination.address.port()
    );
    let response = request(&proxy)
        .query(&[("destination", &target)])
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = response.text().await.unwrap();
    assert!(body.contains("\"kind\":\"redirect_review\""));
    for forbidden in ["private-token", "synthetic-private", "destination="] {
        assert!(!body.contains(forbidden));
    }
    let review = peek(&proxy).unwrap();
    assert!(review.removed_query);
    assert_eq!(
        review.destination_url,
        format!("https://127.0.0.1:{}/dsm/login", destination.address.port())
    );
    let mut manager = proxy.state.global_sessions.lock().unwrap();
    assert!(manager
        .review_redirect(&proxy.state.session_id, Some("wrong-receipt"))
        .is_none());
    assert!(manager
        .review_redirect(&proxy.state.session_id, Some(&review.receipt_id))
        .is_some());
    assert!(manager
        .review_redirect(&proxy.state.session_id, Some(&review.receipt_id))
        .is_none());
    assert_eq!(upstream.hits.load(Ordering::SeqCst), 0);
    assert_eq!(destination.hits.load(Ordering::SeqCst), 0);
    assert_eq!(proxy.state.request_count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn quickconnect_navigation_requires_protected_host_and_same_origin_before_handler_sequence() {
    let (proxy, upstream) = fixture("fixture.quickconnect.to", enabled()).await;
    let path = format!(
        "{}{}?destination=https%3A%2F%2Ftarget.invalid%2F",
        proxy.base,
        quickconnect::PATH
    );
    for (host, origin) in [
        ("localhost", None),
        (
            proxy.state.proxy_authority.as_str(),
            Some("https://foreign.invalid"),
        ),
    ] {
        let mut request = client()
            .get(&path)
            .header("Host", host)
            .header("Sec-Fetch-Dest", "iframe")
            .header("Sec-Fetch-Mode", "navigate")
            .header("Sec-Fetch-Site", "same-origin");
        if let Some(origin) = origin {
            request = request.header("Origin", origin);
        }
        assert_eq!(
            request.send().await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(proxy.state.document_sequence.load(Ordering::SeqCst), 0);
        assert!(peek(&proxy).is_none());
    }
    assert_eq!(upstream.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn quickconnect_navigation_rejects_post_xhr_marker_only_cross_site_and_get_bodies() {
    let (proxy, upstream) = fixture("fixture.quickconnect.to", enabled()).await;
    let path = format!(
        "{}{}?destination=https%3A%2F%2Ftarget.invalid%2F",
        proxy.base,
        quickconnect::PATH
    );
    let post = client()
        .post(&path)
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
        .body("private-body");
    assert_eq!(post.send().await.unwrap().status(), StatusCode::BAD_REQUEST);
    for (name, value) in [
        ("Sec-Fetch-Dest", "empty"),
        ("Sec-Fetch-Mode", "cors"),
        ("Sec-Fetch-Site", "cross-site"),
        ("X-Requested-With", "XMLHttpRequest"),
    ] {
        let mut outgoing = request(&proxy)
            .query(&[("destination", "https://target.invalid/")])
            .build()
            .unwrap();
        outgoing.headers_mut().insert(
            reqwest::header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            reqwest::header::HeaderValue::from_static(value),
        );
        assert_eq!(
            client().execute(outgoing).await.unwrap().status(),
            StatusCode::BAD_REQUEST,
            "unexpected accepted Fetch Metadata override {name}={value}"
        );
    }
    assert_eq!(
        client()
            .get(format!("{path}&__sorng_navigation_v1={TOKEN}"))
            .header("Host", &proxy.state.proxy_authority)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&proxy)
            .query(&[("destination", "https://target.invalid/")])
            .body("private-body")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert!(peek(&proxy).is_none());
    assert_eq!(upstream.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn quickconnect_navigation_rejects_malformed_query_unsafe_or_same_origin_destinations() {
    let (proxy, upstream) = fixture("fixture.quickconnect.to", enabled()).await;
    for query in [
        "",
        "unexpected=https://target.invalid/",
        "destination=",
        "destination=%GG",
        "destination=%FF",
        "destination=https://target.invalid/&destination=https://other.invalid/",
        "destination=https://target.invalid/%0A",
        "destination=https://target.invalid/\\bad",
    ] {
        let response = request(&proxy).build().unwrap();
        let mut url = response.url().clone();
        url.set_query(Some(query));
        let mut response = response;
        *response.url_mut() = url;
        assert_eq!(
            client().execute(response).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        assert!(peek(&proxy).is_none());
    }
    for target in [
        "javascript:alert(1)".to_string(),
        "https://user:secret@target.invalid/".into(),
        "https://@target.invalid/".into(),
        "https:target.invalid".into(),
        "https://target.invalid:0/".into(),
        proxy.state.target_origin.clone(),
        format!("https://target.invalid/{}", "x".repeat(4096)),
    ] {
        assert_eq!(
            request(&proxy)
                .query(&[("destination", target)])
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert!(peek(&proxy).is_none());
    }
    assert_eq!(upstream.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn quickconnect_navigation_exact_source_and_downgrade_permissions_remain_required() {
    for (host, cross, downgrade, https_only, expected) in [
        ("fixture.quickconnect.to", false, false, false, false),
        ("fixture.quickconnect.to", true, false, false, false),
        ("fixture.quickconnect.to", true, true, false, true),
        ("fixture.quickconnect.to", true, true, true, false),
        ("fixture.quickconnect.cn", true, true, false, true),
        (
            "fixture.quickconnect.to.attacker.invalid",
            true,
            true,
            false,
            false,
        ),
    ] {
        let (proxy, upstream) = fixture(
            host,
            HttpProxyPolicy {
                allow_cross_origin_redirects: cross,
                allow_http_downgrade_redirects: downgrade,
                https_only,
                ..Default::default()
            },
        )
        .await;
        let response = request(&proxy)
            .query(&[("destination", "http://127.0.0.1:1/dsm/")])
            .send()
            .await
            .unwrap();
        let body = response.text().await.unwrap();
        assert_eq!(body.contains("\"kind\":\"redirect_review\""), expected);
        assert_eq!(peek(&proxy).is_some(), expected);
        assert_eq!(upstream.hits.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn quickconnect_navigation_receipt_does_not_survive_new_document_or_session_stop() {
    let (proxy, upstream) = fixture("fixture.quickconnect.to", enabled()).await;
    request(&proxy)
        .query(&[("destination", "https://target.invalid/path/")])
        .send()
        .await
        .unwrap();
    let first = peek(&proxy).unwrap();
    request(&proxy)
        .query(&[("destination", "https://other.invalid/path/")])
        .send()
        .await
        .unwrap();
    let second = peek(&proxy).unwrap();
    assert!(second.document_sequence > first.document_sequence);
    assert!(proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .review_redirect(&proxy.state.session_id, Some(&first.receipt_id))
        .is_none());
    proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .sessions
        .remove(&proxy.state.session_id);
    assert!(peek(&proxy).is_none());
    assert_eq!(upstream.hits.load(Ordering::SeqCst), 0);
}
