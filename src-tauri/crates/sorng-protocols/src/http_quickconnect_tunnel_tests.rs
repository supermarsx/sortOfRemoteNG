//! Public protected-handler acceptance for the vendor's bounded tunnel setup
//! command. All upstreams are synthetic CONNECT/TLS peers, never a real NAS.
use super::*;

fn tunnel_body(id: &str) -> serde_json::Value {
    serde_json::json!([{
        "version":1, "command":"request_tunnel", "stop_when_error":false,
        "stop_when_success":true, "id":id, "serverID":"test-nas",
        "is_gofile":false, "path":""
    }])
}

fn tunnel(proxy: &FixtureProxy, id: &str) -> reqwest::RequestBuilder {
    routed(proxy, REGIONAL, true).body(tunnel_body(id).to_string())
}

fn sent_body(request: &str) -> serde_json::Value {
    serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap()
}

async fn successful_tunnel(cold: bool) {
    for id in ["mainapp_https", "mainapp_http"] {
        // Reply fields cannot expand the fixed, original-alias capability.
        // Neither control nor probe permission depends on vendor discovery
        // state surviving a document change or a fresh proxy handoff.
        let mut reply = smartdns();
        reply[0]["sites"] = serde_json::json!(["unlearned.quickconnect.to"]);
        reply[0]["smartdns"]["host"] = "other-nas.direct.quickconnect.to".into();
        reply[0]["service"]["port"] = 8443.into();
        reply[0]["errno"] = 0.into();
        reply[0]["privateReply"] = "private-response-field".into();
        let expected_reply = reply.clone();
        let server = scripted_peer(
            Arc::new(move |request| {
                if request.starts_with("GET ") {
                    return (
                        200,
                        pong(),
                        "Access-Control-Allow-Origin: *\r\n".into(),
                        Duration::ZERO,
                    );
                }
                let body = if sent_body(request)[0]["command"] == "get_server_info" {
                    b"[]".to_vec()
                } else {
                    reply.to_string().into_bytes()
                };
                (
                    200,
                    body,
                    "X-QC-CLIENT-IP: 192.0.2.4\r\n".into(),
                    Duration::ZERO,
                )
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
        if !cold {
            let discovery = routed(&proxy, REGIONAL, true).send().await.unwrap();
            assert_eq!(discovery.status(), 200);
            assert_eq!(
                discovery.json::<serde_json::Value>().await.unwrap(),
                serde_json::json!([])
            );
            assert_eq!(server.seen.lock().unwrap().len(), 2);
        }
        let response = tunnel(&proxy, id)
            .header("Authorization", "Bearer private-browser-auth")
            .header("Cookie", "sid=private-browser-cookie")
            .header("X-Source-Secret", "private-browser-header")
            .header(
                "Referer",
                format!("{}/?private-query=hidden", proxy.state.proxy_origin),
            )
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["x-qc-client-ip"], "192.0.2.4");
        for forbidden in ["set-cookie", "x-private-upstream", "location"] {
            assert!(!response.headers().contains_key(forbidden));
        }
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            expected_reply
        );
        {
            let seen = server.seen.lock().unwrap();
            assert_eq!(
                seen.len(),
                if cold { 2 } else { 4 },
                "only explicitly requested operations"
            );
            for connect in seen.iter().step_by(2) {
                assert!(connect.starts_with("CONNECT dec.quickconnect.to:443 "));
            }
            if !cold {
                assert_eq!(sent_body(&seen[1]), payload());
            }
            assert_eq!(sent_body(seen.last().unwrap()), tunnel_body(id));
            for (index, request) in seen.iter().skip(1).step_by(2).enumerate() {
                assert!(request.starts_with("POST /Serv.php HTTP/1.1\r\n"));
                let lower = request.to_ascii_lowercase();
                for forbidden in [
                    "authorization:",
                    "origin:",
                    "referer:",
                    "source-private",
                    "source-query",
                    "private-browser",
                    "x-source-secret",
                    "x-sorng",
                    "fixture-proxy",
                ] {
                    assert!(!lower.contains(forbidden), "{forbidden}");
                }
                let cookie = request.lines().find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("cookie"))
                        .map(|(_, value)| value.trim())
                });
                assert_eq!(cookie, (index > 0).then_some("upstream-secret=blocked"));
            }
        }
        let log = proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        assert_eq!(
            log[0].url,
            "QuickConnect tunnel setup: https://dec.quickconnect.to"
        );
        assert_eq!(log[0].status, 200);
        assert!(log[0].error.is_none());
        let encoded = serde_json::to_string(&log).unwrap();
        for hidden in [
            "private-",
            "serverID",
            "mainapp_",
            "request_tunnel",
            "destination=",
            "test-nas",
        ] {
            assert!(!encoded.contains(hidden), "{hidden}");
        }
        // The tunnel response does not schedule extra traffic or authorize
        // another NAS, port, API path, or query, even when its fields name one.
        for destination in [
            PROBE.replace("test-nas.direct", "other-nas.direct"),
            PROBE.replace(":5001", ":8443"),
            PROBE.replace("/webman/pingpong.cgi", "/webapi/auth.cgi"),
            format!("{PROBE}&sid=private-query"),
        ] {
            assert_eq!(
                routed(&proxy, &destination, false)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                400
            );
        }
        assert_eq!(server.seen.lock().unwrap().len(), if cold { 2 } else { 4 });

        // An explicit request to the approved probe works even though the
        // response above advertises a different host/port and no discovery
        // response enrolled this target.
        let probe = routed(&proxy, PROBE, false).send().await.unwrap();
        assert_eq!(probe.status(), 200);
        assert_eq!(
            probe.json::<serde_json::Value>().await.unwrap(),
            serde_json::from_slice::<serde_json::Value>(&pong()).unwrap()
        );
        let seen = server.seen.lock().unwrap();
        assert_eq!(seen.len(), if cold { 4 } else { 6 });
        assert!(seen[seen.len() - 2].starts_with("CONNECT test-nas.direct.quickconnect.to:5001 "));
        assert!(seen
            .last()
            .unwrap()
            .starts_with("GET /webman/pingpong.cgi?action=cors&quickconnect=true HTTP/1.1\r\n"));
    }
}

#[tokio::test]
async fn tunnel_after_no_sites_regional_discovery_keeps_reply_fields_out_of_probe_authority() {
    successful_tunnel(false).await;
}

#[tokio::test]
async fn tunnel_cold_regional_sends_only_exact_requested_singleton_without_global_warmup() {
    successful_tunnel(true).await;
}

#[tokio::test]
async fn tunnel_provider_control_namespace_does_not_require_sites_advertisement() {
    let server = peer(
        200,
        br#"[{"sites":["other.quickconnect.to"]}]"#.to_vec(),
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
    assert_eq!(
        tunnel(&proxy, "mainapp_https")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert!(seen[0].starts_with("CONNECT dec.quickconnect.to:443 "));
    assert_eq!(sent_body(&seen[1]), tunnel_body("mainapp_https"));
    let log = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    assert_eq!(
        log[0].url,
        "QuickConnect tunnel setup: https://dec.quickconnect.to"
    );
    assert!(log[0].error.is_none());
}

#[tokio::test]
async fn tunnel_rejects_malformed_or_expanded_commands_before_any_upstream() {
    let server = peer(
        200,
        br#"[{"sites":["dec.quickconnect.to"]}]"#.to_vec(),
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
    for mutation in [
        "alias",
        "extra",
        "version",
        "command",
        "id",
        "error",
        "success",
        "gofile",
        "path",
        "path-query",
        "count",
        "empty",
        "object",
        "duplicate",
        "missing",
        "malformed",
        "size",
    ] {
        let mut body = tunnel_body("mainapp_https");
        match mutation {
            "alias" => body[0]["serverID"] = "other-nas".into(),
            "extra" => body[0]["password"] = "private-password".into(),
            "version" => body[0]["version"] = 2.into(),
            "command" => body[0]["command"] = "wakeup".into(),
            "id" => body[0]["id"] = "ssh".into(),
            "error" => body[0]["stop_when_error"] = true.into(),
            "success" => body[0]["stop_when_success"] = false.into(),
            "gofile" => body[0]["is_gofile"] = true.into(),
            "path" => body[0]["path"] = "..".into(),
            "path-query" => body[0]["path"] = "webman?secret=private".into(),
            "count" => {
                body.as_array_mut()
                    .unwrap()
                    .push(tunnel_body("mainapp_http")[0].clone());
            }
            "empty" => body = serde_json::json!([]),
            "object" => body = body[0].clone(),
            "missing" => {
                body[0].as_object_mut().unwrap().remove("path");
            }
            _ => {}
        }
        let text = match mutation {
            "duplicate" => {
                body.to_string()
                    .replacen("\"version\":1", "\"version\":1,\"version\":1", 1)
            }
            "malformed" => "not-json-private".into(),
            "size" => "x".repeat(4097),
            _ => body.to_string(),
        };
        let result = routed(&proxy, REGIONAL, true)
            .body(text)
            .send()
            .await
            .unwrap();
        assert_eq!(
            result.status().as_u16(),
            if mutation == "size" { 413 } else { 400 },
            "{mutation}"
        );
    }
    // This command is authorized only at a bounded regional control route,
    // never by merely POSTing it to the fixed global capability endpoint.
    assert_eq!(
        request(&proxy)
            .body(tunnel_body("mainapp_https").to_string())
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert!(server.seen.lock().unwrap().is_empty());
    let log = proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    let encoded = serde_json::to_string(&log).unwrap();
    assert!(
        !encoded.contains("private-")
            && !encoded.contains("other-nas")
            && !encoded.contains("serverID")
    );
}

#[tokio::test]
async fn tunnel_requires_enabled_original_owner_current_document_and_verified_route() {
    let server = peer(
        200,
        br#"[{"sites":["dec.quickconnect.to"]}]"#.to_vec(),
        "",
        false,
        false,
    )
    .await;
    for (source, settings) in [
        (ORIGINAL, HttpProxyPolicy::default()),
        ("https://unrelated.invalid", policy()),
    ] {
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            source,
            settings,
        )
        .await;
        assert_eq!(
            tunnel(&proxy, "mainapp_https")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let unavailable = fixture(None, ORIGINAL, policy()).await;
    assert_eq!(
        tunnel(&unavailable, "mainapp_https")
            .send()
            .await
            .unwrap()
            .status(),
        503
    );
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
        ORIGINAL,
        policy(),
    )
    .await;
    proxy.state.network.document_issued(2, false);
    proxy.state.network.activate_document(2).unwrap();
    assert!(!tunnel(&proxy, "mainapp_https")
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    assert!(server.seen.lock().unwrap().is_empty());
    // Even an insecure source client cannot replace the verified anonymous
    // route's TLS checks: only CONNECT, never HTTP or credentials, may reach it.
    let wrong_pin = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&server.proxy).unwrap())
        .use_preconfigured_tls(build_pinned_tls_config("00".repeat(32)).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let proxy = fixture(
        Some(ReviewedQuickConnectControl::fixture(wrong_pin)),
        ORIGINAL,
        policy(),
    )
    .await;
    assert_eq!(
        tunnel(&proxy, "mainapp_https")
            .send()
            .await
            .unwrap()
            .status(),
        502
    );
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].starts_with("CONNECT dec.quickconnect.to:443 "));
    assert!(!seen[0].contains("request_tunnel") && !seen[0].contains("source-private"));
}

#[tokio::test]
async fn tunnel_provider_errors_are_not_retried_and_do_not_follow_response_routes() {
    for (status, body, extra, expected) in [
        (
            403,
            br#"[{"errno":13,"privateError":"hidden"}]"#.to_vec(),
            "",
            403,
        ),
        (500, br#"[{"errno":1}]"#.to_vec(), "", 500),
        (200, br#"[{"errno":13}]"#.to_vec(), "", 200),
        (
            302,
            b"[]".to_vec(),
            "Location: https://unapproved.invalid/private\r\n",
            502,
        ),
        (200, b"<html>private</html>".to_vec(), "", 502),
        (200, vec![b' '; 256 * 1024 + 1], "", 502),
    ] {
        let expected_body = body.clone();
        let server = peer(status, body, extra, false, false).await;
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            ORIGINAL,
            policy(),
        )
        .await;
        let response = tunnel(&proxy, "mainapp_https").send().await.unwrap();
        assert_eq!(response.status().as_u16(), expected);
        assert!(
            !response.headers().contains_key("location")
                && !response.headers().contains_key("set-cookie")
        );
        if expected != 502 {
            assert_eq!(
                response.json::<serde_json::Value>().await.unwrap(),
                serde_json::from_slice::<serde_json::Value>(&expected_body).unwrap()
            );
        } else {
            assert!(!response.text().await.unwrap().contains("private"));
        }
        assert_eq!(
            server.seen.lock().unwrap().len(),
            2,
            "exactly one requested regional command without retry or warm-up"
        );
        let log = proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        assert!(!serde_json::to_string(&log)
            .unwrap()
            .contains("privateError"));
    }
}

#[tokio::test]
async fn tunnel_document_replacement_and_stop_cancel_inflight_reply_without_replay() {
    for stop in [false, true] {
        let reached = Arc::new(AtomicBool::new(false));
        let hit = reached.clone();
        let server = scripted_peer(
            Arc::new(move |_| {
                hit.store(true, Ordering::SeqCst);
                (
                    200,
                    br#"[{"errno":0,"privateLateReply":"never-visible"}]"#.to_vec(),
                    String::new(),
                    Duration::from_secs(1),
                )
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
        let outgoing = tunnel(&proxy, "mainapp_https").build().unwrap();
        let pending = tokio::spawn(async move { client().execute(outgoing).await.unwrap() });
        tokio::time::timeout(Duration::from_secs(2), async {
            while !reached.load(Ordering::SeqCst) {
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
        let response = tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap();
        assert!(!response.status().is_success());
        assert!(!response.text().await.unwrap().contains("privateLateReply"));
        {
            let seen = server.seen.lock().unwrap();
            assert_eq!(seen.len(), 2);
            assert!(seen[0].starts_with("CONNECT dec.quickconnect.to:443 "));
            assert_eq!(sent_body(&seen[1]), tunnel_body("mainapp_https"));
        }
        assert!(!tunnel(&proxy, "mainapp_https")
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
        assert_eq!(
            server.seen.lock().unwrap().len(),
            2,
            "stale document must not send or replay"
        );
    }
}
