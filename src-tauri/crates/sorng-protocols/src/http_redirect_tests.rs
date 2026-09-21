use super::*;

#[path = "http_synology_redirect_tests.rs"]
mod synology_defaults_tests;

fn register(proxy: &FixtureProxy) {
    let state = &proxy.state;
    state.global_sessions.lock().unwrap().sessions.insert(
        state.session_id.clone(),
        ProxySessionEntry {
            runtime: Default::default(),
            attempt: state.attempt.clone(),
            network: state.network.clone(),
            website_dark_mode: state.website_dark_mode.clone(),
            target_url: state.target_url.clone(),
            username: String::new(),
            password: String::new(),
            upstream_auth_mode: state.upstream_auth_mode,
            proxy_policy: state.proxy_policy.clone(),
            redirect_profile: state.redirect_profile,
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: 1,
            min_tls_version: "1.2".into(),
            verify_ssl: true,
            accepted_cert_fingerprint: None,
            require_ca_verification: false,
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

#[tokio::test]
async fn quickconnect_style_chain_requires_each_review_and_never_carries_source_state() {
    // Regional portal -> canonical portal -> DSM. All addresses/credentials are
    // synthetic loopback fixtures; creating the next proxy models explicit UI
    // receipt acceptance, never an automatic cross-origin native request.
    let mut listeners = Vec::new();
    let mut origins = Vec::new();
    for _ in 0..3 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        origins.push(format!("http://{}", listener.local_addr().unwrap()));
        listeners.push(listener);
    }
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut servers = Vec::new();
    for (index, listener) in listeners.into_iter().enumerate() {
        let captured = requests.clone();
        let destination = origins.get(index + 1).cloned();
        servers.push(tokio::spawn(async move {
            axum::serve(
                listener,
                axum::Router::new().fallback(move |uri: axum::http::Uri, headers: HeaderMap| {
                    let captured = captured.clone();
                    let destination = destination.clone();
                    async move {
                        captured
                            .lock()
                            .unwrap()
                            .push((index, uri.to_string(), headers));
                        if uri.path() == "/asset.css" {
                            return Response::builder()
                                .header("Content-Type", "text/css")
                                .body(Body::from("body{color:black}"))
                                .unwrap();
                        }
                        if let Some(destination) = destination {
                            let location = if uri.path() == "/entry" {
                                "/regional".into()
                            } else {
                                format!("{destination}/entry?relay=secret-{index}#private")
                            };
                            Response::builder()
                                .status(307)
                                .header("Location", location)
                                .header("Set-Cookie", format!("portal-{index}=private; Path=/"))
                                .body(Body::empty())
                                .unwrap()
                        } else {
                            Response::builder()
                                .header("Content-Type", "text/html")
                                .body(Body::from(
                                    "<!doctype html><title>Synthetic DSM login</title>",
                                ))
                                .unwrap()
                        }
                    }
                }),
            )
            .await
            .unwrap();
        }));
    }
    let mut previous_receipt = None;
    for (index, origin) in origins.iter().enumerate() {
        assert!(requests
            .lock()
            .unwrap()
            .iter()
            .all(|(owner, _, _)| *owner < index));
        let transport = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let fixture = proxy_with_policy(
            format!("{origin}/"),
            transport,
            if index == 0 {
                UpstreamAuthMode::Basic
            } else {
                UpstreamAuthMode::None
            },
            HttpProxyPolicy {
                allow_cross_origin_redirects: true,
                query_parameters: if index == 0 {
                    vec![proxy_policy::QueryParameter {
                        name: "source-query".into(),
                        value: "private-query".into(),
                    }]
                } else {
                    vec![]
                },
                ..Default::default()
            },
            if index == 0 {
                HashMap::from([("X-Source-Secret".into(), "private-header".into())])
            } else {
                HashMap::new()
            },
        )
        .await;
        register(&fixture);
        if index == 0 {
            *fixture.state.username.write().unwrap() = "private-user".into();
            *fixture.state.password.write().unwrap() = "private-password".into();
        }
        let response = fetch(&fixture, &format!("/entry?__sorng_navigation_v1={TOKEN}")).await;
        if index == 2 {
            assert_eq!(response.status(), StatusCode::OK);
            assert!(response
                .text()
                .await
                .unwrap()
                .contains("Synthetic DSM login"));
        } else {
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            let html = response.text().await.unwrap();
            assert!(html.contains("redirect_review"));
            assert!(html.contains("in-page redirect review"));
            assert!(!html.contains("browser dialog"));
            assert!(!html.contains("private-query") && !html.contains("secret-"));
            let mut receipt = fixture
                .state
                .global_sessions
                .lock()
                .unwrap()
                .review_redirect(&fixture.state.session_id, None)
                .unwrap();
            assert_eq!(
                receipt.destination_url,
                format!("{}/entry", origins[index + 1])
            );
            assert_eq!(receipt.navigation_token.as_deref(), Some(TOKEN));
            assert!(receipt.removed_query);
            assert_ne!(previous_receipt.as_ref(), Some(&receipt.receipt_id));
            assert!(requests
                .lock()
                .unwrap()
                .iter()
                .all(|(owner, _, _)| *owner <= index));

            // Error-page assets and an XHR returning its own redirect cannot
            // churn the document identity or replace the navigation receipt.
            for (path, destination) in [("/asset.css", "style"), ("/poll", "empty")] {
                let _ = client()
                    .get(format!(
                        "{}{path}?__sorng_navigation_v1={TOKEN}",
                        fixture.base
                    ))
                    .header("Host", &fixture.state.proxy_authority)
                    .header("Sec-Fetch-Dest", destination)
                    .send()
                    .await
                    .unwrap();
            }
            assert_eq!(
                fixture.state.document_sequence.load(Ordering::SeqCst),
                receipt.document_sequence
            );
            if index == 0 {
                // A real subsequent document navigation, unlike a resource,
                // invalidates the old receipt even when it returns only CSS.
                let stale_id = receipt.receipt_id.clone();
                let _ = fetch(&fixture, "/asset.css").await;
                assert!(fixture
                    .state
                    .global_sessions
                    .lock()
                    .unwrap()
                    .review_redirect(&fixture.state.session_id, Some(&stale_id))
                    .is_none());
                assert_eq!(
                    fetch(&fixture, &format!("/entry?__sorng_navigation_v1={TOKEN}"))
                        .await
                        .status(),
                    StatusCode::FORBIDDEN
                );
                receipt = fixture
                    .state
                    .global_sessions
                    .lock()
                    .unwrap()
                    .review_redirect(&fixture.state.session_id, None)
                    .unwrap();
                assert_ne!(receipt.receipt_id, stale_id);
                assert_eq!(receipt.navigation_token.as_deref(), Some(TOKEN));
            }
            let mut manager = fixture.state.global_sessions.lock().unwrap();
            assert_eq!(
                manager
                    .review_redirect(&fixture.state.session_id, None)
                    .unwrap()
                    .receipt_id,
                receipt.receipt_id
            );
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
                .is_some());
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
                .is_none());
            previous_receipt = Some(receipt.receipt_id);
        }
        let captured = requests.lock().unwrap();
        let first = captured
            .iter()
            .find(|(owner, _, _)| *owner == index)
            .unwrap();
        if index == 0 {
            assert!(first.2.contains_key("authorization"));
            assert!(first.2.contains_key("x-source-secret"));
            assert!(first.1.contains("source-query=private-query"));
        } else {
            assert!(!first.2.contains_key("authorization"));
            assert!(!first.2.contains_key("cookie"));
            assert!(!first.2.contains_key("x-source-secret"));
            assert!(!first.1.contains('?'));
        }
    }
    for server in servers {
        server.abort();
    }
}

#[tokio::test]
async fn same_origin_chains_allow_ten_hops_but_bound_loops_with_the_correct_failure_kind() {
    assert_same_origin_redirect_budget(None, 10).await;
}

#[tokio::test]
async fn synology_same_origin_chains_allow_twenty_hops_but_refuse_twenty_first_and_loops() {
    assert_same_origin_redirect_budget(Some(BrowserRedirectProfile::Synology), 20).await;
}

async fn assert_same_origin_redirect_budget(profile: Option<BrowserRedirectProfile>, limit: usize) {
    let hits = Arc::new(AtomicU64::new(0));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}/", listener.local_addr().unwrap());
    let counter = hits.clone();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(move |uri: axum::http::Uri| {
                let hits = counter.clone();
                async move {
                    hits.fetch_add(1, Ordering::SeqCst);
                    let parts: Vec<_> = uri.path().split('/').collect();
                    let location = if uri.path() == "/loop" {
                        Some("/loop".to_string())
                    } else {
                        let limit: usize = parts[2].parse().unwrap();
                        let step: usize = parts[3].parse().unwrap();
                        (step < limit).then(|| format!("/chain/{limit}/{}", step + 1))
                    };
                    match location {
                        Some(location) => Response::builder()
                            .status(302)
                            .header("Location", location)
                            .body(Body::empty())
                            .unwrap(),
                        None => Response::new(Body::from("Reached login")),
                    }
                }
            }),
        )
        .await
        .unwrap();
    });
    let fixture = proxy_with_redirect_profile(
        origin,
        client(),
        UpstreamAuthMode::None,
        HttpProxyPolicy::default(),
        HashMap::new(),
        Arc::new(ProxyNetworkState::default()),
        profile,
    )
    .await;
    for (path, expected, expected_hits) in [
        ("/chain/2/0".to_string(), StatusCode::OK, 3),
        (format!("/chain/{limit}/0"), StatusCode::OK, limit + 1),
        (
            format!("/chain/{}/0", limit + 1),
            StatusCode::LOOP_DETECTED,
            limit + 1,
        ),
        ("/loop".to_string(), StatusCode::LOOP_DETECTED, limit + 1),
    ] {
        hits.store(0, Ordering::SeqCst);
        let response = fetch(&fixture, &path).await;
        assert_eq!(response.status(), expected);
        let body = response.text().await.unwrap();
        if expected == StatusCode::LOOP_DETECTED {
            assert!(body.contains("redirect_loop"));
            assert!(body.contains(&format!("{limit} redirects")));
        } else {
            assert_eq!(body, "Reached login");
        }
        assert_eq!(hits.load(Ordering::SeqCst), expected_hits as u64);
    }
    server.abort();
}

#[tokio::test]
async fn synology_budget_never_grants_cross_origin_or_websocket_redirects() {
    let foreign = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let location = format!("http://{}/foreign", foreign.local_addr().unwrap());
    let foreign_hits = Arc::new(AtomicU64::new(0));
    let count = foreign_hits.clone();
    let foreign_server = tokio::spawn(async move {
        axum::serve(
            foreign,
            axum::Router::new().fallback(move || {
                count.fetch_add(1, Ordering::SeqCst);
                async { "unexpected foreign request" }
            }),
        )
        .await
        .unwrap();
    });
    let source = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let source_origin = format!("http://{}", source.local_addr().unwrap());
    let source_hits = Arc::new(AtomicU64::new(0));
    let count = source_hits.clone();
    let source_server = tokio::spawn(async move {
        axum::serve(
            source,
            axum::Router::new().fallback(move || {
                count.fetch_add(1, Ordering::SeqCst);
                let location = location.clone();
                async move {
                    Response::builder()
                        .status(302)
                        .header("Location", location)
                        .body(Body::empty())
                        .unwrap()
                }
            }),
        )
        .await
        .unwrap();
    });
    let proxy = proxy_with_redirect_profile(
        format!("{source_origin}/"),
        client(),
        UpstreamAuthMode::Basic,
        HttpProxyPolicy::default(),
        HashMap::new(),
        Arc::new(ProxyNetworkState::default()),
        Some(BrowserRedirectProfile::Synology),
    )
    .await;
    *proxy.state.username.write().unwrap() = "private-user".into();
    *proxy.state.password.write().unwrap() = "private-password".into();
    let result = fetch(&proxy, "/").await;
    assert_eq!(result.status(), StatusCode::FORBIDDEN);
    assert!(result
        .text()
        .await
        .unwrap()
        .contains("cross_origin_redirect"));
    assert!(matches!(
        super::super::upstream::send_websocket(
            &proxy.state,
            &format!("{source_origin}/socket"),
            &[]
        )
        .await,
        Err(super::super::upstream::UpstreamError::Policy(_))
    ));
    assert_eq!(source_hits.load(Ordering::SeqCst), 2);
    assert_eq!(foreign_hits.load(Ordering::SeqCst), 0);
    assert!(proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .redirect_reviews
        .is_empty());
    source_server.abort();
    foreign_server.abort();
}
