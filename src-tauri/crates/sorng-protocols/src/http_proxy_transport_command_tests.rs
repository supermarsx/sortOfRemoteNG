use super::*;

#[test]
fn invalid_transport_is_rejected_before_route_and_tls_setup() {
    let settings = ProxyTransportSettings {
        connect_timeout_seconds: 0,
        ..Default::default()
    };
    let result = proxy_client_builder_with_cookies(
        &settings,
        true,
        Some("invalid-pin"),
        "1.2",
        Some("invalid-route"),
        true,
        None,
        None,
        false,
    );
    assert!(result.unwrap_err().contains("connectTimeoutSeconds"));
}

#[tokio::test]
async fn shared_website_builder_enforces_session_timeout_for_cookie_and_stateless_clients() {
    use std::time::Duration;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(|| async {
                tokio::time::sleep(Duration::from_secs(20)).await;
                "late"
            }),
        )
        .await
        .unwrap();
    });
    let settings = ProxyTransportSettings {
        connect_timeout_seconds: 1,
        request_timeout_seconds: 5,
        ..Default::default()
    };
    let cookie_client = proxy_client_builder_with_cookies(
        &settings, true, None, "1.2", None, false, None, None, true,
    )
    .unwrap();
    let stateless_client = proxy_client_builder_with_cookies(
        &settings, true, None, "1.2", None, false, None, None, false,
    )
    .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(9), async {
        tokio::join!(
            cookie_client.get(&target).send(),
            stateless_client.get(&target).send()
        )
    })
    .await;
    server.abort();
    let (cookie, stateless) = result.expect("session request budget was ignored");
    assert!(cookie.unwrap_err().is_timeout());
    assert!(stateless.unwrap_err().is_timeout());
}
