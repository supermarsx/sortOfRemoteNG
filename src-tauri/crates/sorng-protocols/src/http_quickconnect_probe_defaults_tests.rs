//! Fresh proxy/document probes use only the closed original-NAS capability.
//! All transport is synthetic CONNECT traffic; no real NAS or provider calls.
use super::*;

#[tokio::test]
async fn cached_discovery_and_fresh_handoffs_need_no_probe_enrollment() {
    let server = peer(
        200,
        pong(),
        "Access-Control-Allow-Origin: *\r\n",
        false,
        false,
    )
    .await;
    for source in [
        ORIGINAL,
        "https://global.quickconnect.to",
        "https://test-nas.us2.quickconnect.to",
        "https://test-nas.direct.quickconnect.to:5001",
    ] {
        let proxy = fixture(
            Some(ReviewedQuickConnectControl::fixture(server.client.clone())),
            source,
            policy(),
        )
        .await;
        for sequence in [1, 2] {
            if sequence == 2 {
                proxy.state.network.document_issued(sequence, false);
                proxy.state.network.activate_document(sequence).unwrap();
            }
            for destination in [
                PROBE.to_string(),
                PROBE.replace(":5001", ":5002"),
                PROBE
                    .replace("test-nas.direct", "192-168-50-100.test-nas.direct")
                    .replace(":5001", ":5002"),
            ] {
                let mut request = routed(&proxy, &destination, false)
                    .header("Authorization", "Bearer source-secret")
                    .header("Cookie", "id=source-private-cookie")
                    .header("Referer", format!("{source}/?private-query=secret"))
                    .build()
                    .unwrap();
                request.headers_mut().insert(
                    control::DOCUMENT_HEADER,
                    sequence.to_string().parse().unwrap(),
                );
                let response = client().execute(request).await.unwrap();
                assert_eq!(
                    response.status(),
                    200,
                    "{source} -> {destination}, document {sequence}"
                );
                assert_eq!(response.bytes().await.unwrap().as_ref(), pong());
            }
        }
        let count = server.seen.lock().unwrap().len();
        assert_eq!(
            routed(&proxy, PROBE, false).send().await.unwrap().status(),
            502
        );
        proxy.state.network.revoke();
        let mut request = routed(&proxy, PROBE, false).build().unwrap();
        request
            .headers_mut()
            .insert(control::DOCUMENT_HEADER, "2".parse().unwrap());
        assert!(client()
            .execute(request)
            .await
            .unwrap()
            .status()
            .is_client_error());
        assert_eq!(
            server.seen.lock().unwrap().len(),
            count,
            "stale and closed owners send nothing"
        );
    }
    let seen = server.seen.lock().unwrap();
    assert_eq!(
        seen.len(),
        48,
        "four fresh sources, two documents, three exact GET probes"
    );
    for pair in seen.chunks_exact(2) {
        assert!(pair[0].starts_with("CONNECT "));
        assert!(
            pair[0].contains(".test-nas.direct.quickconnect.to:")
                || pair[0].contains(" test-nas.direct.quickconnect.to:")
        );
        let request = pair[1].to_ascii_lowercase();
        assert!(request.starts_with("get /webman/pingpong.cgi?action=cors&quickconnect=true "));
        for forbidden in [
            "cookie:",
            "authorization:",
            "referer:",
            "source-secret",
            "private-query",
            "source-private",
            "x-source-secret",
            "post ",
            "serv.php",
        ] {
            assert!(!request.contains(forbidden), "{forbidden}");
        }
    }
}

#[tokio::test]
async fn cold_probe_defaults_still_require_original_scope_and_available_verified_client() {
    let server = peer(
        200,
        pong(),
        "Access-Control-Allow-Origin: *\r\n",
        false,
        false,
    )
    .await;
    for (source, settings, available, expected) in [
        (ORIGINAL, HttpProxyPolicy::default(), true, 403),
        ("https://other-nas.quickconnect.to", policy(), true, 403),
        (ORIGINAL, policy(), false, 503),
    ] {
        let proxy = fixture(
            available.then(|| ReviewedQuickConnectControl::fixture(server.client.clone())),
            source,
            settings,
        )
        .await;
        assert_eq!(
            routed(&proxy, PROBE, false)
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            expected
        );
    }
    assert!(server.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cold_probe_rejects_untrusted_tls_independently_of_unverified_source_client() {
    let server = peer(
        200,
        pong(),
        "Access-Control-Allow-Origin: *\r\n",
        false,
        false,
    )
    .await;
    let route =
        ReviewedQuickConnectControl::new(Some(reqwest::Proxy::all(&server.proxy).unwrap()), "1.2")
            .unwrap();
    let proxy = fixture(Some(route), ORIGINAL, policy()).await;
    let response = routed(&proxy, PROBE, false).send().await.unwrap();
    assert_eq!(response.status(), 502);
    assert!(!response.text().await.unwrap().contains("ezid"));
    let seen = server.seen.lock().unwrap();
    assert_eq!(
        seen.len(),
        1,
        "TLS failure sends CONNECT only, never the probe or a fallback"
    );
    assert!(seen[0].starts_with("CONNECT test-nas.direct.quickconnect.to:5001 "));
}
