use super::*;
use crate::http::{BasicAuthProxyConfig, ProxyNetworkState};
use serde_json::json;

#[test]
fn legacy_and_partial_configs_use_the_exact_defaults() {
    let legacy = json!({"target_url":"https://example.test/", "username":"", "password":""});
    let config: BasicAuthProxyConfig = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(
        serde_json::to_value(config.transport_settings).unwrap(),
        json!({
            "version":1, "connectTimeoutSeconds":15, "requestTimeoutSeconds":120,
            "poolIdleTimeoutSeconds":20, "maxIdleConnectionsPerHost":4, "tcpKeepaliveSeconds":30
        })
    );
    for value in [json!({}), json!({"requestTimeoutSeconds":240})] {
        let mut input = legacy.clone();
        input["transport_settings"] = value.clone();
        let config: BasicAuthProxyConfig = serde_json::from_value(input).unwrap();
        let expected = ProxyTransportSettings {
            request_timeout_seconds: value["requestTimeoutSeconds"].as_u64().unwrap_or(120),
            ..Default::default()
        };
        assert_eq!(config.transport_settings, expected);
        config.transport_settings.validate().unwrap();
    }
}

#[test]
fn schema_rejects_unknown_fields_nulls_and_non_integer_values() {
    for value in [
        json!(null),
        json!(false),
        json!({"connect_timeout_seconds":15}),
        json!({"userAgent":"spoof"}),
        json!({"version":null}),
        json!({"connectTimeoutSeconds":-1}),
        json!({"requestTimeoutSeconds":5.5}),
        json!({"poolIdleTimeoutSeconds":"20"}),
        json!({"tcpKeepaliveSeconds":null}),
        json!({"maxIdleConnectionsPerHost":true}),
    ] {
        assert!(
            serde_json::from_value::<ProxyTransportSettings>(value.clone()).is_err(),
            "{value}"
        );
    }
    assert!(
        serde_json::from_str::<ProxyTransportSettings>(r#"{"version":1,"version":1}"#,).is_err()
    );
}

#[test]
fn rejects_each_out_of_range_field_and_inverted_deadlines() {
    for (field, value) in [
        ("version", 0),
        ("version", 2),
        ("connectTimeoutSeconds", 0),
        ("connectTimeoutSeconds", 121),
        ("requestTimeoutSeconds", 4),
        ("requestTimeoutSeconds", 601),
        ("poolIdleTimeoutSeconds", 301),
        ("maxIdleConnectionsPerHost", 33),
        ("tcpKeepaliveSeconds", 301),
    ] {
        let mut input = serde_json::to_value(ProxyTransportSettings::default()).unwrap();
        input[field] = json!(value);
        let settings: ProxyTransportSettings = serde_json::from_value(input).unwrap();
        assert!(settings.validate().unwrap_err().contains(field));
        assert!(settings
            .apply_to_client_builder(reqwest::Client::builder())
            .is_err());
        assert!(ProxyNetworkState::default()
            .with_transport_settings(settings)
            .is_err());
    }
    let inverted = ProxyTransportSettings {
        connect_timeout_seconds: 16,
        request_timeout_seconds: 15,
        ..Default::default()
    };
    assert!(inverted
        .validate()
        .unwrap_err()
        .contains("at least connectTimeoutSeconds"));
}

#[test]
fn inclusive_bounds_equal_deadlines_and_zero_keepalive_are_valid() {
    for settings in [
        ProxyTransportSettings {
            connect_timeout_seconds: 1,
            request_timeout_seconds: 5,
            pool_idle_timeout_seconds: 0,
            max_idle_connections_per_host: 0,
            tcp_keepalive_seconds: 0,
            ..Default::default()
        },
        ProxyTransportSettings {
            connect_timeout_seconds: 120,
            request_timeout_seconds: 600,
            pool_idle_timeout_seconds: 300,
            max_idle_connections_per_host: 32,
            tcp_keepalive_seconds: 300,
            ..Default::default()
        },
        ProxyTransportSettings {
            connect_timeout_seconds: 120,
            request_timeout_seconds: 120,
            ..Default::default()
        },
    ] {
        settings.validate().unwrap();
        settings
            .apply_to_client_builder(reqwest::Client::builder().no_proxy())
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(
            settings.tcp_keepalive(),
            (settings.tcp_keepalive_seconds != 0)
                .then(|| Duration::from_secs(settings.tcp_keepalive_seconds))
        );
    }
}

#[test]
fn successor_keeps_the_session_snapshot_and_socket_limit() {
    let settings = ProxyTransportSettings {
        connect_timeout_seconds: 7,
        request_timeout_seconds: 45,
        pool_idle_timeout_seconds: 8,
        max_idle_connections_per_host: 2,
        tcp_keepalive_seconds: 0,
        ..Default::default()
    };
    let network = ProxyNetworkState::default()
        .with_transport_settings(settings)
        .unwrap();
    let next = network.successor();
    network.revoke();
    assert_eq!(*next.transport_settings(), settings);
    assert!(next.is_active());
    assert_eq!(next.sockets.available_permits(), 16);
}

#[tokio::test]
async fn configured_request_deadline_is_enforced_by_the_real_client() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(socket.read_u8().await.unwrap());
            assert!(head.len() < 16 * 1024);
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nx")
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_secs(20)).await;
    });
    let settings = ProxyTransportSettings {
        connect_timeout_seconds: 1,
        request_timeout_seconds: 5,
        ..Default::default()
    };
    let client = settings
        .apply_to_client_builder(reqwest::Client::builder().no_proxy())
        .unwrap()
        .build()
        .unwrap();
    // Includes a stalled body, not just response headers.
    let result = tokio::time::timeout(Duration::from_secs(9), async {
        client.get(target).send().await?.bytes().await
    })
    .await;
    server.abort();
    assert!(result
        .expect("configured five-second request deadline was ignored")
        .unwrap_err()
        .is_timeout());
}

#[tokio::test]
async fn zero_idle_connections_disables_reuse_without_adding_headers_or_cookies() {
    use axum::{extract::ConnectInfo, http::HeaderMap};
    use std::{
        net::SocketAddr,
        sync::{Arc, Mutex},
    };
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observed = seen.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/", listener.local_addr().unwrap());
    let router = axum::Router::new().fallback(
        move |ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap| {
            let observed = observed.clone();
            async move {
                observed.lock().unwrap().push((peer, headers));
                ([("set-cookie", "private=must-not-replay; Path=/")], "ok")
            }
        },
    );
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    let settings = ProxyTransportSettings {
        max_idle_connections_per_host: 0,
        tcp_keepalive_seconds: 0,
        ..Default::default()
    };
    let client = settings
        .apply_to_client_builder(reqwest::Client::builder().no_proxy().cookie_store(false))
        .unwrap()
        .build()
        .unwrap();
    for _ in 0..2 {
        tokio::time::timeout(Duration::from_secs(3), async {
            client
                .get(&target)
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap();
        })
        .await
        .unwrap();
    }
    server.abort();
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert_ne!(seen[0].0, seen[1].0);
    for (_, headers) in seen.iter() {
        assert!(!headers.contains_key("user-agent"));
        assert!(!headers.contains_key("authorization"));
        assert!(!headers.contains_key("cookie"));
    }
}
