use super::*;

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

#[tokio::test]
async fn downgrade_receipts_require_both_opt_ins_and_https_only_always_wins() {
    for (cross_origin, downgrade, https_only, allowed) in [
        (false, false, false, false),
        (true, false, false, false),
        (false, true, false, false),
        (true, true, false, true),
        (true, true, true, false),
    ] {
        let fixture = proxy_with_policy(
            "https://source.invalid/".into(),
            client(),
            UpstreamAuthMode::None,
            HttpProxyPolicy {
                allow_cross_origin_redirects: cross_origin,
                allow_http_downgrade_redirects: downgrade,
                https_only,
                ..Default::default()
            },
            HashMap::new(),
        )
        .await;
        register(&fixture);
        fixture.state.document_sequence.store(1, Ordering::SeqCst);
        for unsafe_url in [
            "http://user:password@target.invalid/",
            "http://target.invalid:0/",
        ] {
            assert!(!redirect::record(
                &fixture.state,
                &reqwest::Url::parse(unsafe_url).unwrap(),
                1,
                None
            ));
        }
        assert_eq!(
            redirect::record(
                &fixture.state,
                &reqwest::Url::parse("http://target.invalid/admin/?secret=query#fragment").unwrap(),
                1,
                None
            ),
            allowed
        );
        let mut manager = fixture.state.global_sessions.lock().unwrap();
        let receipt = manager.review_redirect(&fixture.state.session_id, None);
        assert_eq!(receipt.is_some(), allowed);
        if let Some(receipt) = receipt {
            assert_eq!(receipt.destination_url, "http://target.invalid/admin/");
            assert!(receipt.removed_query);
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
                .is_some());
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
                .is_none());
        }
    }
}

#[tokio::test]
async fn downgrade_receipt_cannot_be_consumed_after_native_policy_revocation() {
    let fixture = proxy_with_policy(
        "https://source.invalid/".into(),
        client(),
        UpstreamAuthMode::None,
        HttpProxyPolicy {
            allow_cross_origin_redirects: true,
            allow_http_downgrade_redirects: true,
            ..Default::default()
        },
        HashMap::new(),
    )
    .await;
    register(&fixture);
    fixture.state.document_sequence.store(1, Ordering::SeqCst);
    assert!(redirect::record(
        &fixture.state,
        &reqwest::Url::parse("http://target.invalid/").unwrap(),
        1,
        None
    ));
    let mut manager = fixture.state.global_sessions.lock().unwrap();
    let receipt = manager
        .review_redirect(&fixture.state.session_id, None)
        .unwrap();
    manager
        .sessions
        .get_mut(&fixture.state.session_id)
        .unwrap()
        .proxy_policy
        .allow_http_downgrade_redirects = false;
    assert!(manager
        .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
        .is_none());
}

#[tokio::test]
async fn actual_https_downgrade_is_only_reviewed_and_never_follows_or_forwards_post() {
    use base64::Engine;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let foreign_hits = Arc::new(AtomicU64::new(0));
    let foreign = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let destination = format!(
        "http://127.0.0.1:{}/admin/?token=foreign-secret#fragment",
        foreign.local_addr().unwrap().port()
    );
    let hits = foreign_hits.clone();
    let foreign_task = tokio::spawn(async move {
        axum::serve(
            foreign,
            axum::Router::new().fallback(move || {
                let hits = hits.clone();
                async move {
                    hits.fetch_add(1, Ordering::SeqCst);
                    "unexpected"
                }
            }),
        )
        .await
        .unwrap();
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let acceptor = tls_fixture::test_acceptor();
    let upstream_task = tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let destination = destination.clone();
            tokio::spawn(async move {
                let Ok(mut stream) = acceptor.accept(tcp).await else {
                    return;
                };
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                    let Ok(byte) = stream.read_u8().await else {
                        return;
                    };
                    request.push(byte);
                }
                let response = format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: {destination}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    let der = base64::engine::general_purpose::STANDARD
        .decode(tls_fixture::TEST_CERT)
        .unwrap();
    let tls = build_pinned_tls_config(hex::encode(Sha256::digest(der))).unwrap();
    let transport = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .use_preconfigured_tls(tls)
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    for (cross_origin, downgrade, https_only, allowed) in [
        (false, false, false, false),
        (true, false, false, false),
        (false, true, false, false),
        (true, true, false, true),
        (true, true, true, false),
    ] {
        let fixture = proxy_with_policy(
            format!("https://{address}/"),
            transport.clone(),
            UpstreamAuthMode::Basic,
            HttpProxyPolicy {
                allow_cross_origin_redirects: cross_origin,
                allow_http_downgrade_redirects: downgrade,
                https_only,
                ..Default::default()
            },
            HashMap::new(),
        )
        .await;
        register(&fixture);
        *fixture.state.username.write().unwrap() = "source-user".into();
        *fixture.state.password.write().unwrap() = "source-secret".into();
        let response = fetch(&fixture, "/").await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let html = response.text().await.unwrap();
        assert!(html.contains(if allowed {
            "redirect_review"
        } else {
            "insecure_redirect"
        }));
        assert!(!html.contains("foreign-secret") && !html.contains("source-secret"));
        assert_eq!(
            fixture
                .state
                .global_sessions
                .lock()
                .unwrap()
                .review_redirect(&fixture.state.session_id, None)
                .is_some(),
            allowed
        );
        let response = client()
            .post(format!("{}/", fixture.base))
            .header("Host", &fixture.state.proxy_authority)
            .header("Sec-Fetch-Dest", "document")
            .body("password=manual-secret")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response.text().await.unwrap().contains("insecure_redirect"));
        assert!(fixture
            .state
            .global_sessions
            .lock()
            .unwrap()
            .review_redirect(&fixture.state.session_id, None)
            .is_none());
    }
    assert_eq!(foreign_hits.load(Ordering::SeqCst), 0);
    upstream_task.abort();
    foreign_task.abort();
}

#[tokio::test]
async fn redirects_review_all_scheme_pairs_without_downgrades_and_consume_once() {
    for (source, destination, allowed) in [
        (
            "http://source.invalid/",
            "http://target.invalid/admin/?secret=private#token",
            true,
        ),
        (
            "http://source.invalid/",
            "https://target.invalid/admin/?secret=private#token",
            true,
        ),
        (
            "https://source.invalid/",
            "https://target.invalid/admin/?secret=private#token",
            true,
        ),
        (
            "https://source.invalid/",
            "http://target.invalid/admin/?secret=private#token",
            false,
        ),
    ] {
        let fixture = proxy_with_policy(
            source.into(),
            client(),
            UpstreamAuthMode::None,
            HttpProxyPolicy {
                allow_cross_origin_redirects: true,
                ..Default::default()
            },
            HashMap::new(),
        )
        .await;
        register(&fixture);
        fixture.state.document_sequence.store(1, Ordering::SeqCst);
        fixture.state.auto_login_armed.store(true, Ordering::SeqCst);
        *fixture.state.auto_login_nonce.write().unwrap() = Some("secret-grant".into());
        assert_eq!(
            redirect::record(
                &fixture.state,
                &reqwest::Url::parse(destination).unwrap(),
                1,
                Some(TOKEN.into())
            ),
            allowed
        );
        let mut manager = fixture.state.global_sessions.lock().unwrap();
        let review = manager.review_redirect(&fixture.state.session_id, None);
        assert_eq!(review.is_some(), allowed);
        if let Some(review) = review {
            assert!(!review.destination_url.contains("private"));
            assert!(review.destination_url.ends_with("/admin/"));
            assert!(review.removed_query);
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some("forged"))
                .is_none());
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&review.receipt_id))
                .is_some());
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&review.receipt_id))
                .is_none());
            assert!(!fixture.state.auto_login_armed.load(Ordering::SeqCst));
            assert!(fixture.state.auto_login_nonce.read().unwrap().is_none());
        }
    }
}

#[tokio::test]
async fn redirects_receipts_require_live_session_and_current_document() {
    let fixture = proxy_with_policy(
        "https://source.invalid/".into(),
        client(),
        UpstreamAuthMode::None,
        HttpProxyPolicy {
            allow_cross_origin_redirects: true,
            ..Default::default()
        },
        HashMap::new(),
    )
    .await;
    register(&fixture);
    let destination = reqwest::Url::parse("https://target.invalid/").unwrap();
    fixture.state.document_sequence.store(1, Ordering::SeqCst);
    assert!(!redirect::record(
        &fixture.state,
        &reqwest::Url::parse("https://target.invalid:0/").unwrap(),
        1,
        None
    ));
    assert!(redirect::record(&fixture.state, &destination, 1, None));
    fixture.state.document_sequence.store(2, Ordering::SeqCst);
    assert!(fixture
        .state
        .global_sessions
        .lock()
        .unwrap()
        .review_redirect(&fixture.state.session_id, None)
        .is_none());
    assert!(!redirect::record(&fixture.state, &destination, 1, None));
    assert!(redirect::record(&fixture.state, &destination, 2, None));
    let mut manager = fixture.state.global_sessions.lock().unwrap();
    manager.sessions.remove(&fixture.state.session_id);
    assert!(manager
        .review_redirect(&fixture.state.session_id, None)
        .is_none());
}

#[tokio::test]
async fn redirect_receipt_store_has_a_fixed_bound() {
    let fixture = proxy_with_policy(
        "https://source.invalid/".into(),
        client(),
        UpstreamAuthMode::None,
        HttpProxyPolicy {
            allow_cross_origin_redirects: true,
            ..Default::default()
        },
        HashMap::new(),
    )
    .await;
    let destination = reqwest::Url::parse("https://target.invalid/").unwrap();
    fixture.state.document_sequence.store(1, Ordering::SeqCst);
    let mut owners = Vec::new();
    for index in 0..256 {
        let mut state = (*fixture.state).clone();
        state.session_id = format!("bounded-{index}");
        let state = Arc::new(state);
        assert!(redirect::record(&state, &destination, 1, None));
        owners.push(state);
    }
    assert!(!redirect::record(&fixture.state, &destination, 1, None));
}

#[tokio::test]
async fn actual_cross_origin_redirects_never_forward_auth_query_or_post_and_same_origin_307_still_works(
) {
    let foreign_hits = Arc::new(AtomicU64::new(0));
    let foreign = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let destination = format!(
        "http://127.0.0.1:{}/admin/?token=foreign-secret#private",
        foreign.local_addr().unwrap().port()
    );
    let hits = foreign_hits.clone();
    let foreign_task = tokio::spawn(async move {
        axum::serve(
            foreign,
            axum::Router::new().fallback(move || {
                let hits = hits.clone();
                async move {
                    hits.fetch_add(1, Ordering::SeqCst);
                    "unexpected"
                }
            }),
        )
        .await
        .unwrap();
    });
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!(
        "http://127.0.0.1:{}/",
        upstream.local_addr().unwrap().port()
    );
    let upstream_task = tokio::spawn(async move {
        axum::serve(
            upstream,
            axum::Router::new()
                .route(
                    "/same",
                    axum::routing::any(|| async {
                        Response::builder()
                            .status(307)
                            .header("Location", "/done")
                            .body(Body::empty())
                            .unwrap()
                    }),
                )
                .route(
                    "/done",
                    axum::routing::any(|body: String| async move { body }),
                )
                .fallback(move || {
                    let destination = destination.clone();
                    async move {
                        Response::builder()
                            .status(307)
                            .header("Location", destination)
                            .body(Body::empty())
                            .unwrap()
                    }
                }),
        )
        .await
        .unwrap();
    });
    for enabled in [false, true] {
        let fixture = proxy_with_policy(
            target.clone(),
            client(),
            UpstreamAuthMode::Basic,
            HttpProxyPolicy {
                allow_cross_origin_redirects: enabled,
                ..Default::default()
            },
            HashMap::new(),
        )
        .await;
        register(&fixture);
        *fixture.state.username.write().unwrap() = "source-user".into();
        *fixture.state.password.write().unwrap() = "source-secret".into();
        let response = fetch(&fixture, "/").await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let html = response.text().await.unwrap();
        assert!(html.contains(if enabled {
            "redirect_review"
        } else {
            "cross_origin_redirect"
        }));
        assert!(!html.contains("foreign-secret"));
        let review = fixture
            .state
            .global_sessions
            .lock()
            .unwrap()
            .review_redirect(&fixture.state.session_id, None);
        assert_eq!(review.is_some(), enabled);
        let response = client()
            .post(format!("{}/", fixture.base))
            .header("Host", &fixture.state.proxy_authority)
            .header("Sec-Fetch-Dest", "document")
            .body("password=manual-secret")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(fixture
            .state
            .global_sessions
            .lock()
            .unwrap()
            .review_redirect(&fixture.state.session_id, None)
            .is_none());
        let same = client()
            .post(format!("{}/same", fixture.base))
            .header("Host", &fixture.state.proxy_authority)
            .header("Sec-Fetch-Dest", "document")
            .body("same-origin-body")
            .send()
            .await
            .unwrap();
        assert_eq!(same.status(), StatusCode::OK);
        assert_eq!(same.text().await.unwrap(), "same-origin-body");
    }
    assert_eq!(foreign_hits.load(Ordering::SeqCst), 0);
    upstream_task.abort();
    foreign_task.abort();
}
