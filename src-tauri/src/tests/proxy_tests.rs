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

    // Service should be created successfully - check by listing connections
    let connections = service.lock().await.list_connections().await;
    assert!(connections.is_empty());
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

    // Verify connection exists
    let connection = service.lock().await.get_connection(&connection_id).await;
    assert!(connection.is_some());
}

#[tokio::test]
async fn test_get_proxy_connection_existing() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("http");

    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    let connection = service.lock().await.get_connection(&connection_id).await;
    assert!(connection.is_some());
}

#[tokio::test]
async fn test_get_proxy_connection_nonexistent() {
    let service = ProxyService::new();

    let connection = service.lock().await.get_connection("nonexistent").await;
    assert!(connection.is_none());
}

#[tokio::test]
async fn test_list_proxy_connections() {
    let service = ProxyService::new();

    // Initially empty
    let connections = service.lock().await.list_connections().await;
    assert!(connections.is_empty());

    // Add a connection
    let proxy_config = create_test_proxy_config("http");
    service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    // Check connection is listed
    let connections = service.lock().await.list_connections().await;
    assert_eq!(connections.len(), 1);
}

#[tokio::test]
async fn test_delete_proxy_connection_existing() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("http");

    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    // Delete the connection
    let result = service.lock().await.delete_connection(&connection_id).await;
    assert!(result.is_ok());

    // Verify connection is gone
    let connection = service.lock().await.get_connection(&connection_id).await;
    assert!(connection.is_none());
}

#[tokio::test]
async fn test_delete_proxy_connection_nonexistent() {
    let service = ProxyService::new();

    let result = service.lock().await.delete_connection("nonexistent").await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_connect_via_proxy_unsupported_type() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("unsupported");

    let result = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await;

    // Should fail for unsupported type
    assert!(result.is_err());
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

    // Disconnect
    let result = service.lock().await.disconnect_connection(&connection_id).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_create_proxy_chain() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("http");

    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    let result = service.lock().await.create_chain(vec![connection_id]).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_get_proxy_chain_existing() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("http");

    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    let chain_id = service.lock().await.create_chain(vec![connection_id]).await.unwrap();

    let chain = service.lock().await.get_chain(&chain_id).await;
    assert!(chain.is_some());
}

#[tokio::test]
async fn test_get_proxy_chain_nonexistent() {
    let service = ProxyService::new();

    let chain = service.lock().await.get_chain("nonexistent").await;
    assert!(chain.is_none());
}

#[tokio::test]
async fn test_list_proxy_chains() {
    let service = ProxyService::new();

    // Initially empty
    let chains = service.lock().await.list_chains().await;
    assert!(chains.is_empty());

    // Add a chain
    let proxy_config = create_test_proxy_config("http");
    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    service.lock().await.create_chain(vec![connection_id]).await.unwrap();

    // Check chain is listed
    let chains = service.lock().await.list_chains().await;
    assert_eq!(chains.len(), 1);
}

#[tokio::test]
async fn test_delete_proxy_chain_existing() {
    let service = ProxyService::new();
    let proxy_config = create_test_proxy_config("http");

    let connection_id = service.lock().await.create_proxy_connection(
        "example.com".to_string(),
        80,
        proxy_config,
    ).await.unwrap();

    let chain_id = service.lock().await.create_chain(vec![connection_id]).await.unwrap();

    // Delete the chain
    let result = service.lock().await.delete_chain(&chain_id).await;
    assert!(result.is_ok());

    // Verify chain is gone
    let chain = service.lock().await.get_chain(&chain_id).await;
    assert!(chain.is_none());
}

#[tokio::test]
async fn test_delete_proxy_chain_nonexistent() {
    let service = ProxyService::new();

    let result = service.lock().await.delete_chain("nonexistent").await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_proxy_config_serialization() {
    let config = create_test_proxy_config("http");

    // Serialize
    let json = serde_json::to_string(&config).unwrap();

    // Deserialize
    let deserialized: ProxyConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.proxy_type, "http");
    assert_eq!(deserialized.host, "127.0.0.1");
    assert_eq!(deserialized.port, 8080);
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
            let result = service_clone.lock().await.create_proxy_connection(
                format!("example{}.com", i),
                80,
                proxy_config,
            ).await;
            result.is_ok()
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result);
    }

    // Verify connections were created
    let connections = service.lock().await.list_connections().await;
    assert_eq!(connections.len(), 5);
}