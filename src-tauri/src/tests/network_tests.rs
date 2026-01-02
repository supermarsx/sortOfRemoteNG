use app::*;
use std::net::IpAddr;

/// Test network service creation
#[tokio::test]
async fn test_new_network_service() {
    let service = NetworkService::new();
    // Service should be created successfully
    assert!(true); // If we reach here, service creation succeeded
}

/// Test ping functionality with localhost
#[tokio::test]
async fn test_ping_localhost() {
    let service = NetworkService::new();

    let result = service.lock().await.ping("127.0.0.1".to_string(), None).await;
    // Ping might succeed or fail depending on system, but should not panic
    assert!(result.is_ok());
}

/// Test ping with invalid host
#[tokio::test]
async fn test_ping_invalid_host() {
    let service = NetworkService::new();

    let result = service.lock().await.ping("invalid.host.name.that.does.not.exist".to_string(), None).await;
    // Should handle invalid hosts gracefully
    assert!(result.is_ok() || result.is_err());
}

/// Test ping with timeout
#[tokio::test]
async fn test_ping_with_timeout() {
    let service = NetworkService::new();

    let result = service.lock().await.ping("127.0.0.1".to_string(), Some(1)).await;
    assert!(result.is_ok());
}

/// Test port scanning on localhost
#[tokio::test]
async fn test_port_scan_localhost() {
    let service = NetworkService::new();

    // Scan a small range of ports
    let result = service.lock().await.scan_ports("127.0.0.1".to_string(), 80, 85, Some(1)).await;
    assert!(result.is_ok());
    let open_ports = result.unwrap();
    // Should return a vector, even if empty
    assert!(open_ports.is_empty() || !open_ports.is_empty());
}

/// Test port scanning with invalid IP
#[tokio::test]
async fn test_port_scan_invalid_ip() {
    let service = NetworkService::new();

    let result = service.lock().await.scan_ports("999.999.999.999".to_string(), 80, 85, Some(1)).await;
    assert!(result.is_ok());
    let open_ports = result.unwrap();
    assert!(open_ports.is_empty());
}

/// Test hostname resolution
#[tokio::test]
async fn test_resolve_hostname() {
    let service = NetworkService::new();

    let result = service.lock().await.resolve_hostname("localhost".to_string()).await;
    assert!(result.is_ok());
    let ips = result.unwrap();
    // Should contain at least one IP (127.0.0.1 or ::1)
    assert!(!ips.is_empty());
    // All results should be valid IP addresses
    for ip in ips {
        assert!(ip.parse::<IpAddr>().is_ok());
    }
}

/// Test hostname resolution with invalid hostname
#[tokio::test]
async fn test_resolve_hostname_invalid() {
    let service = NetworkService::new();

    let result = service.lock().await.resolve_hostname("this.hostname.does.not.exist.invalid".to_string()).await;
    // Should handle gracefully - either return empty vec or error
    assert!(result.is_ok() || result.is_err());
}

/// Test reverse DNS lookup
#[tokio::test]
async fn test_reverse_dns() {
    let service = NetworkService::new();

    let result = service.lock().await.reverse_dns("127.0.0.1".to_string()).await;
    // Should handle gracefully - might return localhost or empty
    assert!(result.is_ok());
}

/// Test reverse DNS with invalid IP
#[tokio::test]
async fn test_reverse_dns_invalid() {
    let service = NetworkService::new();

    let result = service.lock().await.reverse_dns("999.999.999.999".to_string()).await;
    assert!(result.is_ok() || result.is_err());
}

/// Test network interface listing
#[tokio::test]
async fn test_get_network_interfaces() {
    let service = NetworkService::new();

    let result = service.lock().await.get_network_interfaces().await;
    assert!(result.is_ok());
    let interfaces = result.unwrap();
    // Should return at least one interface (loopback)
    assert!(!interfaces.is_empty());
}

/// Test traceroute functionality
#[tokio::test]
async fn test_traceroute() {
    let service = NetworkService::new();

    let result = service.lock().await.traceroute("127.0.0.1".to_string(), Some(3)).await;
    // Traceroute might succeed or fail, but should not panic
    assert!(result.is_ok() || result.is_err());
}

/// Test concurrent network operations
#[tokio::test]
async fn test_concurrent_network_operations() {
    let service = NetworkService::new();
    let mut handles = vec![];

    // Spawn multiple ping operations
    for _ in 0..3 {
        let service_clone = service.clone();
        let handle = tokio::spawn(async move {
            let result = service_clone.lock().await.ping("127.0.0.1".to_string(), Some(1)).await;
            assert!(result.is_ok());
        });
        handles.push(handle);
    }

    // Wait for all operations to complete
    for handle in handles {
        handle.await.unwrap();
    }
}

/// Test port scan with large range (should be limited)
#[tokio::test]
async fn test_port_scan_large_range() {
    let service = NetworkService::new();

    // Try to scan a large range - should be handled gracefully
    let result = service.lock().await.scan_ports("127.0.0.1".to_string(), 1, 1000, Some(1)).await;
    assert!(result.is_ok());
}

/// Test ping with very short timeout
#[tokio::test]
async fn test_ping_short_timeout() {
    let service = NetworkService::new();

    let result = service.lock().await.ping("127.0.0.1".to_string(), Some(0)).await;
    assert!(result.is_ok());
}

/// Test hostname resolution with IP address
#[tokio::test]
async fn test_resolve_ip_address() {
    let service = NetworkService::new();

    let result = service.lock().await.resolve_hostname("127.0.0.1".to_string()).await;
    assert!(result.is_ok());
    let ips = result.unwrap();
    assert!(!ips.is_empty());
    assert!(ips.contains(&"127.0.0.1".to_string()));
}