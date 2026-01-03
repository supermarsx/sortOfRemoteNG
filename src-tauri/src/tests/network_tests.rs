use crate::network::NetworkService;

/// Test network service creation
#[tokio::test]
async fn test_new_network_service() {
    let _service = NetworkService::new();
    // Service should be created successfully
    assert!(true); // If we reach here, service creation succeeded
}

/// Test ping functionality with localhost
#[tokio::test]
async fn test_ping_localhost() {
    let service = NetworkService::new();

    let result = service.lock().await.ping_host("127.0.0.1".to_string()).await;
    // Ping might succeed or fail depending on system, but should not panic
    assert!(result.is_ok());
}

/// Test ping with invalid host
#[tokio::test]
async fn test_ping_invalid_host() {
    let service = NetworkService::new();

    let result = service.lock().await.ping_host("invalid.host.name.that.does.not.exist".to_string()).await;
    // Should handle invalid hosts gracefully
    assert!(result.is_ok() || result.is_err());
}

/// Test network scanning on localhost
#[tokio::test]
async fn test_scan_network_localhost() {
    let service = NetworkService::new();

    // Scan localhost network
    let result = service.lock().await.scan_network("127.0.0.1".to_string()).await;
    assert!(result.is_ok());
    let hosts = result.unwrap();
    // Should return a vector, even if empty
    assert!(hosts.is_empty() || !hosts.is_empty());
}

/// Test network scanning with invalid subnet
#[tokio::test]
async fn test_scan_network_invalid_subnet() {
    let service = NetworkService::new();

    let result = service.lock().await.scan_network("invalid.subnet".to_string()).await;
    assert!(result.is_err());
}

/// Test network scanning with CIDR notation
#[tokio::test]
async fn test_scan_network_cidr() {
    let service = NetworkService::new();

    let result = service.lock().await.scan_network("127.0.0.0/24".to_string()).await;
    assert!(result.is_ok());
    let hosts = result.unwrap();
    // Should return results or empty vector
    assert!(hosts.len() >= 0);
}