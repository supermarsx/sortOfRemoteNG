//! Closed default destinations exercised through the existing one-use receipt
//! and protected QuickConnect route. All transports are local synthetic fixtures.
use super::*;

const ORIGINAL: &str = "https://nas-example.fr3.quickconnect.to";
const ALIAS: &str = "http://nas-example.quickconnect.to";
const SECURE_ALIAS: &str = "https://nas-example.quickconnect.to";
const GLOBAL: &str = "https://global.quickconnect.to";
const WWW: &str = "https://www.quickconnect.to";

fn defaults(original: &str) -> HttpProxyPolicy {
    HttpProxyPolicy {
        synology_quick_connect_defaults: Some(SynologyQuickConnectDefaults {
            version: 1,
            original_origin: original.into(),
        }),
        ..Default::default()
    }
}

async fn receipt_fixture(source: &str, policy: HttpProxyPolicy) -> FixtureProxy {
    let fixture = proxy_with_policy(
        format!("{source}/"),
        client(),
        UpstreamAuthMode::None,
        policy,
        HashMap::new(),
    )
    .await;
    register(&fixture);
    fixture.state.document_sequence.store(1, Ordering::SeqCst);
    fixture
}

#[tokio::test]
async fn synology_defaults_are_destination_scoped_and_https_only_still_wins() {
    for (policy, destination, expected) in [
        (defaults(ORIGINAL), ALIAS, true),
        (defaults(ORIGINAL), GLOBAL, true),
        (defaults(ORIGINAL), WWW, true),
        (defaults(ORIGINAL), SECURE_ALIAS, true),
        (
            defaults(ORIGINAL),
            "https://nas-example.us2.quickconnect.to",
            true,
        ),
        (
            defaults(ORIGINAL),
            "http://nas-example.us2.quickconnect.to",
            false,
        ),
        (
            defaults(ORIGINAL),
            "https://other-nas.us2.quickconnect.to",
            false,
        ),
        (
            defaults(ORIGINAL),
            "https://nas-example.us2.quickconnect.to:5001",
            false,
        ),
        (
            defaults(ORIGINAL),
            "https://nas-example.direct.quickconnect.to:5001",
            true,
        ),
        (
            defaults(ORIGINAL),
            "https://192-168-50-100.nas-example.direct.quickconnect.to:5002",
            true,
        ),
        (
            defaults(ORIGINAL),
            "https://other-nas.direct.quickconnect.to:5001",
            false,
        ),
        (
            defaults(ORIGINAL),
            "http://nas-example.direct.quickconnect.to:5001",
            false,
        ),
        (
            defaults(ORIGINAL),
            "https://nas-example.direct.quickconnect.to:5003",
            false,
        ),
        (
            defaults(ORIGINAL),
            "http://other-nas.quickconnect.to",
            false,
        ),
        (
            defaults(ORIGINAL),
            "https://other-nas.quickconnect.to",
            false,
        ),
        (
            defaults(ORIGINAL),
            "https://nas-example.quickconnect.to:5001",
            false,
        ),
        (defaults(ORIGINAL), "http://global.quickconnect.to", false),
        (
            defaults(ORIGINAL),
            "https://global.quickconnect.to:5001",
            false,
        ),
        (
            defaults(ORIGINAL),
            "https://www.quickconnect.to.attacker.invalid",
            false,
        ),
        (defaults(ORIGINAL), "https://www.quickconnect.to.", false),
        (
            defaults(ORIGINAL),
            "https://user@www.quickconnect.to",
            false,
        ),
        (defaults(ORIGINAL), "https://www.quickconnect.to:0", false),
        (HttpProxyPolicy::default(), ALIAS, false),
        (HttpProxyPolicy::default(), SECURE_ALIAS, false),
        (
            HttpProxyPolicy::default(),
            "https://nas-example.us2.quickconnect.to",
            false,
        ),
        (HttpProxyPolicy::default(), GLOBAL, false),
        (
            HttpProxyPolicy {
                https_only: true,
                ..defaults(ORIGINAL)
            },
            ALIAS,
            false,
        ),
        (
            HttpProxyPolicy {
                https_only: true,
                ..defaults(ORIGINAL)
            },
            "https://nas-example.us2.quickconnect.to",
            true,
        ),
        (
            HttpProxyPolicy {
                https_only: true,
                ..defaults(ORIGINAL)
            },
            GLOBAL,
            true,
        ),
        (
            HttpProxyPolicy {
                https_only: true,
                ..defaults(ORIGINAL)
            },
            SECURE_ALIAS,
            true,
        ),
        (
            HttpProxyPolicy {
                allow_cross_origin_redirects: true,
                ..Default::default()
            },
            GLOBAL,
            true,
        ),
        (
            HttpProxyPolicy {
                allow_cross_origin_redirects: true,
                allow_http_downgrade_redirects: true,
                ..Default::default()
            },
            ALIAS,
            true,
        ),
    ] {
        let fixture = receipt_fixture(ORIGINAL, policy).await;
        let url = reqwest::Url::parse(destination).unwrap();
        assert_eq!(
            redirect::record(&fixture.state, &url, 1, None),
            expected,
            "{destination}"
        );
        let mut manager = fixture.state.global_sessions.lock().unwrap();
        let receipt = manager.review_redirect(&fixture.state.session_id, None);
        assert_eq!(receipt.is_some(), expected, "{destination}");
        if let Some(receipt) = receipt {
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
                .is_some());
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
                .is_none());
        }
        assert_eq!(fixture.state.request_count.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn synology_receipts_revalidate_defaults_policy_scope_and_document() {
    for mutation in [
        "opt-out",
        "secure-opt-out",
        "direct-opt-out",
        "regional-opt-out",
        "regional-original",
        "regional-document",
        "https-only",
        "different-original",
        "shared-portals-original",
        "unrelated-source",
        "document",
    ] {
        let fixture = receipt_fixture(GLOBAL, defaults(ORIGINAL)).await;
        let origin = match mutation {
            "shared-portals-original" => WWW,
            "secure-opt-out" => SECURE_ALIAS,
            "direct-opt-out" => "https://nas-example.direct.quickconnect.to:5001",
            "regional-opt-out" | "regional-original" | "regional-document" => {
                "https://nas-example.us2.quickconnect.to"
            }
            _ => ALIAS,
        };
        let destination =
            reqwest::Url::parse(&format!("{origin}/login?private-token=secret#fragment")).unwrap();
        assert!(redirect::record(&fixture.state, &destination, 1, None));
        let mut manager = fixture.state.global_sessions.lock().unwrap();
        let receipt = manager
            .review_redirect(&fixture.state.session_id, None)
            .unwrap();
        assert_eq!(receipt.destination_url, format!("{origin}/login"));
        assert!(receipt.removed_query);
        let entry = manager.sessions.get_mut(&fixture.state.session_id).unwrap();
        match mutation {
            "opt-out" | "secure-opt-out" | "direct-opt-out" | "regional-opt-out" => {
                entry.proxy_policy.synology_quick_connect_defaults = None
            }
            "https-only" => entry.proxy_policy.https_only = true,
            "different-original" | "shared-portals-original" | "regional-original" => {
                entry.proxy_policy.synology_quick_connect_defaults =
                    defaults("https://other-nas.quickconnect.to").synology_quick_connect_defaults
            }
            "unrelated-source" => entry.target_origin = "https://unrelated.invalid".into(),
            "document" | "regional-document" => {
                fixture
                    .state
                    .document_sequence
                    .fetch_add(1, Ordering::SeqCst);
            }
            _ => unreachable!(),
        }
        assert!(
            manager
                .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
                .is_none(),
            "{mutation}"
        );
    }
}

#[tokio::test]
async fn synology_custom_origins_and_unknown_qc_shapes_do_not_infer_nas_aliases() {
    for original in [
        "https://192.0.2.3:5001",
        "https://nas.custom.invalid:5001",
        "https://nas-example.direct.quickconnect.to",
        "https://nas-example.fr3.extra.quickconnect.to",
        "https://quickconnect.to",
        GLOBAL,
    ] {
        let policy = defaults(original);
        assert!(policy
            .validate(&reqwest::Url::parse(original).unwrap())
            .is_ok());
        let fixture = receipt_fixture(original, policy).await;
        assert!(!redirect::record(
            &fixture.state,
            &reqwest::Url::parse(ALIAS).unwrap(),
            1,
            None
        ));
        assert!(redirect::record(
            &fixture.state,
            &reqwest::Url::parse(WWW).unwrap(),
            1,
            None
        ));
    }
    let policy = defaults(ORIGINAL);
    assert!(policy
        .validate(&reqwest::Url::parse("https://unrelated.invalid").unwrap())
        .is_err());
    let fixture = receipt_fixture("https://unrelated.invalid", policy).await;
    assert!(!redirect::record(
        &fixture.state,
        &reqwest::Url::parse(WWW).unwrap(),
        1,
        None
    ));
}

#[tokio::test]
async fn synology_default_chain_issues_sequential_redacted_receipts_without_network_or_login() {
    use tokio::io::AsyncWriteExt;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicU64::new(0));
    let count = hits.clone();
    let tripwire = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            count.fetch_add(1, Ordering::SeqCst);
            let _ = socket
                .write_all(
                    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
        }
    });
    let upstream = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{address}")).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap();
    let mut previous_receipt: Option<String> = None;
    for (source, destination) in [
        (ORIGINAL, SECURE_ALIAS),
        (SECURE_ALIAS, GLOBAL),
        (GLOBAL, ORIGINAL),
        (ORIGINAL, "https://nas-example.us2.quickconnect.to"),
        ("https://nas-example.us2.quickconnect.to", GLOBAL),
        (GLOBAL, WWW),
        (WWW, "https://nas-example.direct.quickconnect.to:5001"),
        ("https://nas-example.direct.quickconnect.to:5001", GLOBAL),
        (GLOBAL, ALIAS),
    ] {
        let fixture = proxy_with_policy(
            format!("{source}/"),
            upstream.clone(),
            UpstreamAuthMode::None,
            defaults(ORIGINAL),
            HashMap::new(),
        )
        .await;
        register(&fixture);
        let target = format!("{destination}/dsm/login?private-token=hidden#fragment");
        let response = client()
            .get(format!("{}{}", fixture.base, quickconnect::PATH))
            .query(&[("destination", target.as_str())])
            .header("Host", &fixture.state.proxy_authority)
            .header("Origin", &fixture.state.proxy_origin)
            .header("Sec-Fetch-Dest", "iframe")
            .header("Sec-Fetch-Mode", "navigate")
            .header("Sec-Fetch-Site", "same-origin")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body = response.text().await.unwrap();
        assert!(body.contains("\"kind\":\"redirect_review\""));
        assert!(!body.contains("private-token"));
        let mut manager = fixture.state.global_sessions.lock().unwrap();
        let receipt = manager
            .review_redirect(&fixture.state.session_id, None)
            .unwrap();
        assert_eq!(receipt.source_origin, source);
        assert_eq!(receipt.destination_url, format!("{destination}/dsm/login"));
        assert!(receipt.removed_query);
        if let Some(previous) = previous_receipt.take() {
            assert!(manager
                .review_redirect(&fixture.state.session_id, Some(&previous))
                .is_none());
        }
        assert!(manager
            .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
            .is_some());
        assert!(manager
            .review_redirect(&fixture.state.session_id, Some(&receipt.receipt_id))
            .is_none());
        previous_receipt = Some(receipt.receipt_id);
        assert!(!fixture.state.proxy_policy.allow_cross_origin_redirects);
        assert!(!fixture.state.proxy_policy.allow_http_downgrade_redirects);
        assert_eq!(*fixture.state.username.read().unwrap(), "");
        assert_eq!(*fixture.state.password.read().unwrap(), "");
        assert!(!fixture.state.auto_login_armed.load(Ordering::SeqCst));
        assert_eq!(fixture.state.request_count.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.state.error_count.load(Ordering::SeqCst), 0);
        let entry = manager.request_log.back().unwrap();
        assert_eq!(entry.status, 403);
        assert!(entry.error.is_none());
        assert_eq!(
            entry.url,
            format!("{}{}", fixture.state.proxy_origin, quickconnect::PATH)
        );
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0);
    tripwire.abort();
}
