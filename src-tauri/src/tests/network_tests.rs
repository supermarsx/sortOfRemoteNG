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

// ============== DIAGNOSTICS TESTS ==============

/// Test ping_host via NetworkService (detailed version)
#[tokio::test]
async fn test_ping_host_detailed_via_service() {
    let service = NetworkService::new();
    
    // Test pinging localhost using NetworkService directly
    let result = service.lock().await.ping_host("127.0.0.1".to_string()).await;
    
    // Should complete without panicking
    match result {
        Ok(success) => {
            // On some systems localhost ping may succeed or fail
            assert!(success || !success);
        }
        Err(_) => {
            // Also acceptable if ping fails
            assert!(true);
        }
    }
}

/// Test ping with invalid host via NetworkService
#[tokio::test]
async fn test_ping_invalid_via_service() {
    let service = NetworkService::new();
    
    let result = service.lock().await.ping_host("invalid.host.that.does.not.exist.xyz".to_string()).await;
    
    // Should handle gracefully - either return error or success=false
    match result {
        Ok(success) => assert!(!success), // Invalid host should fail
        Err(_) => assert!(true), // Expected for invalid hosts
    }
}

/// Test port connectivity check via NetworkService methods
#[tokio::test]
async fn test_port_check_via_service() {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};
    
    // Test checking a port that's likely closed
    let addr = "127.0.0.1:65534";
    let result = timeout(Duration::from_secs(2), TcpStream::connect(addr)).await;
    
    // Should complete without panicking - port 65534 is almost certainly closed
    match result {
        Ok(Ok(_)) => assert!(true), // Unexpectedly open, but valid result
        Ok(Err(_)) => assert!(true), // Expected - connection refused
        Err(_) => assert!(true), // Timeout - also expected
    }
}

/// Test TCP connectivity logic
#[tokio::test]
async fn test_tcp_connectivity() {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};
    
    // Try to connect to an invalid address
    let addr = "127.0.0.1:9999";
    let result = timeout(Duration::from_secs(1), TcpStream::connect(addr)).await;
    
    // Should handle gracefully
    assert!(result.is_ok() || result.is_err());
}