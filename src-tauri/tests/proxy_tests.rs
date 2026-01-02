use app::*;
use std::collections::HashMap;

fn create_test_proxy_config(proxy_type: &str) -> ProxyConfig {
    ProxyConfig {
        proxy_type: proxy_type.to_string(),
        host: "127.0.0.1".to_string(),
        port: 8080,
        username: Some("testuser".to_string()),
        password: Some("testpass".to_string()),
        ssh_key_file: None,
        ssh_key_passphrase: None,
        ssh_host_key_verification: None,
        ssh_known_hosts_file: None,
        tunnel_domain: None,
        tunnel_key: None,
        tunnel_method: None,
        custom_headers: None,
        websocket_path: None,
        quic_cert_file: None,
        shadowsocks_method: None,
        shadowsocks_plugin: None,
    }
}

#[tokio::test]
async fn test_new_proxy_service() {
    let service = ProxyService::new();

    // Service should be created successfully
    assert!(service.lock().await.connections.is_empty());
    assert!(service.lock().await.chains.is_empty());
}

#[tokio::test]
async fn test_create_proxy_connection() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("http");

    let result = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await;

    assert!(result.is_ok());
    let connection_id = result.unwrap();

    // Verify connection was created
    let connections = &service.lock().await.connections;
    assert!(connections.contains_key(&connection_id));

    let connection = connections.get(&connection_id).unwrap();
    assert_eq!(connection.target_host, "example.com");
    assert_eq!(connection.target_port, 80);
    assert_eq!(connection.proxy_config.proxy_type, "http");
    assert_eq!(connection.status, ProxyConnectionStatus::Disconnected);
    assert!(connection.local_port.is_none());
}

#[tokio::test]
async fn test_get_proxy_connection_existing() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("socks5");

    let connection_id = service.lock().await.create_proxy_connection(
        "test.com".to_string(),
        443,
        proxy_config,
    ).await.unwrap();

    let result = service.lock().await.get_proxy_connection(&connection_id).await;
    assert!(result.is_ok());

    let connection = result.unwrap();
    assert_eq!(connection.id, connection_id);
    assert_eq!(connection.target_host, "test.com");
    assert_eq!(connection.target_port, 443);
}

#[tokio::test]
async fn test_get_proxy_connection_nonexistent() {
    let service = ProxyService::new();

    let result = service.lock().await.get_proxy_connection("nonexistent").await;
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "Proxy connection not found");
}

#[tokio::test]
async fn test_list_proxy_connections() {
    let service = ProxyService::new();

    // Initially empty
    let connections = service.lock().await.list_proxy_connections().await;
    assert!(connections.is_empty());

    // Add some connections
    let config1 = create_test_proxy_config("http");
    let config2 = create_test_proxy_config("socks5");

    service.lock().await.create_proxy_connection(
        "host1.com".to_string(),
        80,
        config1,
    ).await.unwrap();

    service.lock().await.create_proxy_connection(
        "host2.com".to_string(),
        443,
        config2,
    ).await.unwrap();

    let connections = service.lock().await.list_proxy_connections().await;
    assert_eq!(connections.len(), 2);

    // Check that both connections are present
    let hosts: Vec<String> = connections.iter().map(|c| c.target_host.clone()).collect();
    assert!(hosts.contains(&"host1.com".to_string()));
    assert!(hosts.contains(&"host2.com".to_string()));
}

#[tokio::test]
async fn test_delete_proxy_connection_existing() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("ssh");

    let connection_id = service.lock().await.create_proxy_connection(
        "ssh.example.com".to_string(),
        22,
        proxy_config,
    ).await.unwrap();

    // Verify connection exists
    assert!(service.lock().await.connections.contains_key(&connection_id));

    // Delete connection
    let result = service.lock().await.delete_proxy_connection(&connection_id).await;
    assert!(result.is_ok());

    // Verify connection is gone
    assert!(!service.lock().await.connections.contains_key(&connection_id));
}

#[tokio::test]
async fn test_delete_proxy_connection_nonexistent() {
    let service = ProxyService::new();

    let result = service.lock().await.delete_proxy_connection("nonexistent").await;
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "Proxy connection not found");
}

#[tokio::test]
async fn test_connect_via_proxy_unsupported_type() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("unsupported");

    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    let result = service.lock().await.connect_via_proxy(&connection_id).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Unsupported proxy type"));

    // Check that status was updated to error
    let service_guard = service.lock().await;
    let connection = service_guard.connections.get(&connection_id).unwrap();
    match &connection.status {
        ProxyConnectionStatus::Error(_) => {},
        _ => panic!("Expected error status"),
    }
}

#[tokio::test]
async fn test_disconnect_proxy_connection() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("http");

    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    // Disconnect (should work even if not connected)
    let result = service.lock().await.disconnect_proxy(&connection_id).await;
    assert!(result.is_ok());

    // Verify status is disconnected
    let service_guard = service.lock().await;
    let connection = service_guard.connections.get(&connection_id).unwrap();
    assert!(matches!(connection.status, ProxyConnectionStatus::Disconnected));
}

#[tokio::test]
async fn test_create_proxy_chain() {
    let service = ProxyService::new();

    let layers = vec![
        create_test_proxy_config("http"),
        create_test_proxy_config("socks5"),
    ];

    let result = service.lock().await.create_proxy_chain(
        "Test Chain".to_string(),
        layers,
        Some("A test proxy chain".to_string()),
    ).await;

    assert!(result.is_ok());
    let chain_id = result.unwrap();

    // Verify chain was created
    let chains = &service.lock().await.chains;
    assert!(chains.contains_key(&chain_id));

    let chain = chains.get(&chain_id).unwrap();
    assert_eq!(chain.name, "Test Chain");
    assert_eq!(chain.description, Some("A test proxy chain".to_string()));
    assert_eq!(chain.layers.len(), 2);
    assert!(matches!(chain.status, ProxyConnectionStatus::Disconnected));
}

#[tokio::test]
async fn test_get_proxy_chain_existing() {
    let service = ProxyService::new();

    let layers = vec![create_test_proxy_config("http")];

    let chain_id = service.lock().await.create_proxy_chain(
        "Test Chain".to_string(),
        layers,
        None,
    ).await.unwrap();

    let result = service.lock().await.get_proxy_chain(&chain_id).await;
    assert!(result.is_ok());

    let chain = result.unwrap();
    assert_eq!(chain.id, chain_id);
    assert_eq!(chain.name, "Test Chain");
}

#[tokio::test]
async fn test_get_proxy_chain_nonexistent() {
    let service = ProxyService::new();

    let result = service.lock().await.get_proxy_chain("nonexistent").await;
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "Proxy chain not found");
}

#[tokio::test]
async fn test_list_proxy_chains() {
    let service = ProxyService::new();

    // Initially empty
    let chains = service.lock().await.list_proxy_chains().await;
    assert!(chains.is_empty());

    // Add chains
    let layers1 = vec![create_test_proxy_config("http")];
    let layers2 = vec![create_test_proxy_config("socks5")];

    service.lock().await.create_proxy_chain(
        "Chain 1".to_string(),
        layers1,
        None,
    ).await.unwrap();

    service.lock().await.create_proxy_chain(
        "Chain 2".to_string(),
        layers2,
        None,
    ).await.unwrap();

    let chains = service.lock().await.list_proxy_chains().await;
    assert_eq!(chains.len(), 2);

    let names: Vec<String> = chains.iter().map(|c| c.name.clone()).collect();
    assert!(names.contains(&"Chain 1".to_string()));
    assert!(names.contains(&"Chain 2".to_string()));
}

#[tokio::test]
async fn test_delete_proxy_chain_existing() {
    let service = ProxyService::new();

    let layers = vec![create_test_proxy_config("http")];
    let chain_id = service.lock().await.create_proxy_chain(
        "Test Chain".to_string(),
        layers,
        None,
    ).await.unwrap();

    // Verify chain exists
    assert!(service.lock().await.chains.contains_key(&chain_id));

    // Delete chain
    let result = service.lock().await.delete_proxy_chain(&chain_id).await;
    assert!(result.is_ok());

    // Verify chain is gone
    assert!(!service.lock().await.chains.contains_key(&chain_id));
}

#[tokio::test]
async fn test_delete_proxy_chain_nonexistent() {
    let service = ProxyService::new();

    let result = service.lock().await.delete_proxy_chain("nonexistent").await;
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "Proxy chain not found");
}

#[tokio::test]
async fn test_proxy_config_serialization() {
    let config = ProxyConfig {
        proxy_type: "websocket".to_string(),
        host: "ws.example.com".to_string(),
        port: 443,
        username: Some("wsuser".to_string()),
        password: Some("wspass".to_string()),
        ssh_key_file: Some("/path/to/key".to_string()),
        ssh_key_passphrase: Some("keypass".to_string()),
        ssh_host_key_verification: Some(true),
        ssh_known_hosts_file: Some("/path/to/known_hosts".to_string()),
        tunnel_domain: Some("tunnel.example.com".to_string()),
        tunnel_key: Some("tunnelkey123".to_string()),
        tunnel_method: Some("obfuscated".to_string()),
        custom_headers: Some({
            let mut headers = HashMap::new();
            headers.insert("X-Custom".to_string(), "value".to_string());
            headers
        }),
        websocket_path: Some("/ws".to_string()),
        quic_cert_file: Some("/path/to/cert.pem".to_string()),
        shadowsocks_method: Some("aes-256-gcm".to_string()),
        shadowsocks_plugin: Some("v2ray-plugin".to_string()),
    };

    // Test serialization
    let json = serde_json::to_string(&config).unwrap();
    let deserialized: ProxyConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.proxy_type, config.proxy_type);
    assert_eq!(deserialized.host, config.host);
    assert_eq!(deserialized.port, config.port);
    assert_eq!(deserialized.username, config.username);
    assert_eq!(deserialized.password, config.password);
    assert_eq!(deserialized.websocket_path, config.websocket_path);
    assert_eq!(deserialized.shadowsocks_method, config.shadowsocks_method);
}

#[tokio::test]
async fn test_concurrent_proxy_operations() {
    let service = ProxyService::new();

    // Spawn multiple tasks to create connections concurrently
    let mut handles = vec![];
    for i in 0..5 {
        let service_clone = service.clone();
        let handle = tokio::spawn(async move {
            let proxy_config = create_test_proxy_config("http");
            let connection_id = service_clone.lock().await.create_proxy_connection(
                format!("host{}.com", i),
                80,
                proxy_config,
            ).await.unwrap();

            // Don't try to connect in unit tests to avoid network dependencies
            // Just return the connection ID

            connection_id
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    let mut connection_ids = vec![];
    for handle in handles {
        connection_ids.push(handle.await.unwrap());
    }

    // Verify all connections were created
    let connections = service.lock().await.list_proxy_connections().await;
    assert_eq!(connections.len(), 5);

    // Verify all IDs are unique
    let mut ids = std::collections::HashSet::new();
    for id in &connection_ids {
        assert!(ids.insert(id));
    }
}