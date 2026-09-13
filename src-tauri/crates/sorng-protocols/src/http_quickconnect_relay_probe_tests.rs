//! Regional relay transport and provider-returned identity acceptance. All
//! connections terminate at synthetic local CONNECT/TLS peers, never a NAS.
use super::*;

const RELAY: &str =
    "https://test-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true";
const INTERNAL: &str = "provider-internal-server-identity";

fn server_info(id: &str) -> serde_json::Value {
    // Reviewed ResponseParser.isValidServerInfo minimum required fields.
    serde_json::json!([{"errno":0,
        "server":{"serverID":id,"interface":[],"external":{"ip":"192.0.2.1"}},
        "service":{"port":5001,"ext_port":5002},
        "env":{"control_host":"dec.quickconnect.to","relay_region":"fr3"}}])
}
fn identity_pong(id: &str) -> Vec<u8> {
    use md5::{Digest, Md5};
    serde_json::json!({"ezid":hex::encode(Md5::digest(id.as_bytes()))})
        .to_string()
        .into_bytes()
}
fn tunnel_payload() -> serde_json::Value {
    serde_json::json!([{"version":1,"command":"request_tunnel",
        "stop_when_error":false,"stop_when_success":true,"id":"mainapp_https",
        "serverID":"test-nas","is_gofile":false,"path":""}])
}

#[tokio::test]
async fn verified_discovery_and_tunnel_identities_accept_relay_and_direct_probes_anonymously() {
    for tunnel in [false, true] {
        let server = scripted_peer(
            Arc::new(|request| {
                if request.starts_with("GET ") {
                    (
                        200,
                        identity_pong(INTERNAL),
                        "Access-Control-Allow-Origin: *\r\n".into(),
                        Duration::ZERO,
                    )
                } else {
                    (
                        200,
                        server_info(INTERNAL).to_string().into_bytes(),
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
        let rpc = routed(&proxy, REGIONAL, true)
            .body(if tunnel { tunnel_payload() } else { payload() }.to_string());
        let response = rpc.send().await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            server_info(INTERNAL)
        );
        for destination in [RELAY, PROBE] {
            let response = routed(&proxy, destination, false)
                .header("Authorization", "Bearer private-browser-authorization")
                .header("Cookie", "private-cookie=secret")
                .header("Referer", "https://private.invalid/?private-query=secret")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200, "{destination}");
            assert_eq!(response.headers()["content-type"], "application/json");
            assert!(!response.headers().contains_key("set-cookie"));
            assert_eq!(
                response.bytes().await.unwrap().as_ref(),
                identity_pong(INTERNAL)
            );
        }
        let count = server.seen.lock().unwrap().len();
        for destination in [
            RELAY.replace("test-nas", "other-nas"),
            RELAY.replace(".fr3", ".x.fr3"),
            RELAY.replace(".to/", ".to:5001/"),
            RELAY.replace("https:", "http:"),
            RELAY.replace("pingpong.cgi", "auth.cgi"),
            format!("{RELAY}&password=private-query"),
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
        assert_eq!(
            routed(&proxy, RELAY, true).send().await.unwrap().status(),
            400
        );
        assert_eq!(server.seen.lock().unwrap().len(), count);
        {
            let seen = server.seen.lock().unwrap();
            assert_eq!(
                seen.len(),
                6,
                "exact one RPC and two probes, no replay/extra discovery"
            );
            assert!(seen[2].starts_with("CONNECT test-nas.fr3.quickconnect.to:443 "));
            for request in seen
                .iter()
                .filter(|request| !request.starts_with("CONNECT "))
            {
                let lower = request.to_ascii_lowercase();
                for forbidden in [
                    "authorization:",
                    "cookie:",
                    "referer:",
                    "private-",
                    "source-private",
                    "source-query",
                    "x-source-secret",
                    "fixture-proxy-password",
                ] {
                    assert!(!lower.contains(forbidden), "{forbidden}");
                }
                if request.starts_with("GET ") {
                    assert!(lower.contains(&format!("origin: {ORIGINAL}")));
                }
            }
        }
        let logs = proxy
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        let encoded = serde_json::to_string(&logs).unwrap();
        assert!(!encoded.contains(INTERNAL));
        assert!(!encoded.contains(&String::from_utf8(identity_pong(INTERNAL)).unwrap()));
        assert!(!encoded.contains("private-"));
        assert!(encoded.contains("QuickConnect NAS probe: https://test-nas.fr3.quickconnect.to"));
    }
}

#[tokio::test]
async fn probe_identity_receipts_require_success_and_do_not_survive_new_document_or_session() {
    for invalid in ["none", "status", "errno", "shape"] {
        let eligible = invalid == "none";
        let expected_status = if invalid == "status" { 500 } else { 200 };
        let invalid = invalid.to_string();
        let server = scripted_peer(
            Arc::new(move |request| {
                if request.starts_with("GET ") {
                    return (
                        200,
                        identity_pong(INTERNAL),
                        "Access-Control-Allow-Origin: *\r\n".into(),
                        Duration::ZERO,
                    );
                }
                let mut reply = server_info(INTERNAL);
                let status = if invalid == "status" { 500 } else { 200 };
                if invalid == "errno" {
                    reply[0]["errno"] = 13.into();
                }
                if invalid == "shape" {
                    reply[0].as_object_mut().unwrap().remove("env");
                }
                (
                    status,
                    reply.to_string().into_bytes(),
                    String::new(),
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
        // Before a verified response, an internal ID is not assumed from a URL.
        assert_eq!(
            routed(&proxy, RELAY, false).send().await.unwrap().status(),
            502
        );
        let response = routed(&proxy, REGIONAL, true).send().await.unwrap();
        assert_eq!(response.status().as_u16(), expected_status);
        response.bytes().await.unwrap();
        let response = routed(&proxy, RELAY, false).send().await.unwrap();
        assert_eq!(response.status(), if eligible { 200 } else { 502 });
        if eligible {
            proxy.state.network.document_issued(2, false);
            proxy.state.network.activate_document(2).unwrap();
            let before = server.seen.lock().unwrap().len();
            assert_eq!(
                routed(&proxy, RELAY, false).send().await.unwrap().status(),
                502
            );
            assert_eq!(
                server.seen.lock().unwrap().len(),
                before,
                "old document has no transport authority"
            );
            let mut current = routed(&proxy, RELAY, false).build().unwrap();
            current
                .headers_mut()
                .insert(control::DOCUMENT_HEADER, "2".parse().unwrap());
            assert_eq!(
                client().execute(current).await.unwrap().status(),
                502,
                "new document cannot use previous identity"
            );
        } else {
            assert_eq!(
                response.status(),
                502,
                "failed or incomplete RPC cannot enroll an identity"
            );
        }
        let fresh = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            ORIGINAL,
            policy(),
        )
        .await;
        assert_eq!(
            routed(&fresh, RELAY, false).send().await.unwrap().status(),
            502
        );
        proxy.state.network.revoke();
        let count = server.seen.lock().unwrap().len();
        assert!(routed(&proxy, RELAY, false)
            .send()
            .await
            .unwrap()
            .status()
            .is_client_error());
        assert_eq!(server.seen.lock().unwrap().len(), count);
    }
}

#[tokio::test]
async fn concurrent_verified_identity_replies_union_but_replaced_document_cannot_learn_late() {
    for replace in [false, true] {
        let calls = Arc::new(AtomicU64::new(0));
        let observed = calls.clone();
        let server = scripted_peer(
            Arc::new(move |request| {
                if request.starts_with("GET ") {
                    let id = if request.contains("test-nas.de2.quickconnect.to") {
                        "internal-b"
                    } else {
                        "internal-a"
                    };
                    (
                        200,
                        identity_pong(id),
                        "Access-Control-Allow-Origin: *\r\n".into(),
                        Duration::ZERO,
                    )
                } else {
                    let index = observed.fetch_add(1, Ordering::SeqCst);
                    let id = if index == 0 {
                        "internal-a"
                    } else {
                        "internal-b"
                    };
                    (
                        200,
                        server_info(id).to_string().into_bytes(),
                        String::new(),
                        if index == 0 {
                            Duration::from_millis(200)
                        } else {
                            Duration::ZERO
                        },
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
        let first = routed(&proxy, REGIONAL, true).build().unwrap();
        let pending = tokio::spawn(async move { client().execute(first).await.unwrap() });
        tokio::time::timeout(Duration::from_secs(2), async {
            while calls.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            routed(&proxy, REGIONAL, true)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        if replace {
            proxy.state.network.document_issued(2, false);
            proxy.state.network.activate_document(2).unwrap();
        }
        assert_eq!(
            pending.await.unwrap().status(),
            if replace { 502 } else { 200 }
        );
        for destination in [RELAY.to_string(), RELAY.replace(".fr3", ".de2")] {
            let mut request = routed(&proxy, &destination, false).build().unwrap();
            if replace {
                request
                    .headers_mut()
                    .insert(control::DOCUMENT_HEADER, "2".parse().unwrap());
            }
            assert_eq!(
                client().execute(request).await.unwrap().status(),
                if replace { 502 } else { 200 }
            );
        }
    }
}

#[tokio::test]
async fn regional_probe_preserves_alias_compatibility_but_requires_cors_tls_and_defaults() {
    for (headers, expected) in [
        ("Access-Control-Allow-Origin: *\r\n", 200),
        ("", 502),
        (
            "Access-Control-Allow-Origin: https://other.invalid\r\n",
            502,
        ),
    ] {
        let server = peer(200, pong(), headers, false, false).await;
        for (settings, status) in [(policy(), expected), (HttpProxyPolicy::default(), 403)] {
            let proxy = fixture(
                Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
                ORIGINAL,
                settings,
            )
            .await;
            assert_eq!(
                routed(&proxy, RELAY, false)
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .as_u16(),
                status
            );
        }
    }
    let server = peer(
        200,
        pong(),
        "Access-Control-Allow-Origin: *\r\n",
        false,
        false,
    )
    .await;
    let verified =
        ReviewedQuickConnectControl::new(Some(reqwest::Proxy::all(&server.proxy).unwrap()), "1.2")
            .unwrap();
    let proxy = fixture(Some(verified), ORIGINAL, policy()).await;
    assert_eq!(
        routed(&proxy, RELAY, false).send().await.unwrap().status(),
        502
    );
    let seen = server.seen.lock().unwrap();
    assert_eq!(
        seen.len(),
        1,
        "unknown CA sends no target HTTP, direct fallback or retry"
    );
    assert!(seen[0].starts_with("CONNECT test-nas.fr3.quickconnect.to:443 "));
}
