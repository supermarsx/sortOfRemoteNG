use super::*;
use std::time::Duration;

#[tokio::test]
async fn outer_http_and_websocket_budgets_follow_session_settings() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
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
    // Deliberately omit client timeouts so only the mediator's outer budgets
    // can end these operations. All peers and requests are anonymous/local.
    let fixture = proxy_with_policy_and_network(
        target.clone(),
        reqwest::Client::builder().no_proxy().build().unwrap(),
        UpstreamAuthMode::None,
        HttpProxyPolicy::default(),
        HashMap::new(),
        Arc::new(
            ProxyNetworkState::default()
                .with_transport_settings(settings)
                .unwrap(),
        ),
    )
    .await;
    let result = tokio::time::timeout(Duration::from_secs(8), async {
        let websocket = async {
            tokio::time::timeout(
                Duration::from_secs(3),
                upstream::send_websocket(&fixture.state, &target, &[]),
            )
            .await
        };
        tokio::join!(
            upstream::send(&fixture.state, &reqwest::Method::GET, &target, &[], &[]),
            websocket,
        )
    })
    .await;
    server.abort();
    let (http, websocket) = result.expect("HTTP session budget was ignored");
    assert!(matches!(http, Err(upstream::UpstreamError::Deadline)));
    assert!(matches!(
        websocket.expect("WebSocket connect budget was ignored"),
        Err(upstream::UpstreamError::Deadline)
    ));
}
