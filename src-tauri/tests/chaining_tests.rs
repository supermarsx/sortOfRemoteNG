use app::*;
use std::sync::Arc;
use tokio::sync::Mutex;

// For testing, we'll create a minimal chaining service
// Note: In a real scenario, you'd want proper dependency injection or mocking

fn create_test_layer(connection_type: ConnectionType, position: usize) -> ChainLayer {
    ChainLayer {
        id: format!("layer_{}", position),
        connection_type,
        connection_id: format!("conn_{}", position),
        position,
        status: ChainLayerStatus::Disconnected,
        local_port: None,
        error: None,
    }
}

#[test]
fn test_connection_type_equality() {
    assert_eq!(ConnectionType::Proxy, ConnectionType::Proxy);
    assert_eq!(ConnectionType::OpenVPN, ConnectionType::OpenVPN);
    assert_eq!(ConnectionType::WireGuard, ConnectionType::WireGuard);
    assert_eq!(ConnectionType::ZeroTier, ConnectionType::ZeroTier);
    assert_eq!(ConnectionType::Tailscale, ConnectionType::Tailscale);

    assert_ne!(ConnectionType::Proxy, ConnectionType::OpenVPN);
    assert_ne!(ConnectionType::WireGuard, ConnectionType::ZeroTier);
}

#[test]
fn test_chain_layer_serialization() {
    let layer = ChainLayer {
        id: "test_layer".to_string(),
        connection_type: ConnectionType::Proxy,
        connection_id: "proxy_conn_1".to_string(),
        position: 0,
        status: ChainLayerStatus::Disconnected,
        local_port: None,
        error: None,
    };

    // Test serialization
    let json = serde_json::to_string(&layer).unwrap();
    let deserialized: ChainLayer = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.id, layer.id);
    assert_eq!(deserialized.connection_type, layer.connection_type);
    assert_eq!(deserialized.connection_id, layer.connection_id);
    assert_eq!(deserialized.position, layer.position);
    assert!(matches!(deserialized.status, ChainLayerStatus::Disconnected));
    assert!(deserialized.local_port.is_none());
    assert!(deserialized.error.is_none());
}

#[test]
fn test_connection_chain_serialization() {
    let layers = vec![
        create_test_layer(ConnectionType::Proxy, 0),
        create_test_layer(ConnectionType::OpenVPN, 1),
    ];

    let chain = ConnectionChain {
        id: "test_chain".to_string(),
        name: "Test Chain".to_string(),
        description: Some("A test chain".to_string()),
        layers,
        status: ChainStatus::Disconnected,
        created_at: Utc::now(),
        connected_at: None,
        final_local_port: None,
        error: None,
    };

    // Test serialization
    let json = serde_json::to_string(&chain).unwrap();
    let deserialized: ConnectionChain = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.id, chain.id);
    assert_eq!(deserialized.name, chain.name);
    assert_eq!(deserialized.description, chain.description);
    assert_eq!(deserialized.layers.len(), chain.layers.len());
    assert!(matches!(deserialized.status, ChainStatus::Disconnected));
    assert!(deserialized.connected_at.is_none());
    assert!(deserialized.final_local_port.is_none());
    assert!(deserialized.error.is_none());
}

#[test]
fn test_chain_layer_status_transitions() {
    let mut layer = create_test_layer(ConnectionType::Proxy, 0);

    // Initially disconnected
    assert!(matches!(layer.status, ChainLayerStatus::Disconnected));

    // Simulate connecting
    layer.status = ChainLayerStatus::Connecting;
    assert!(matches!(layer.status, ChainLayerStatus::Connecting));

    // Simulate successful connection
    layer.status = ChainLayerStatus::Connected;
    layer.local_port = Some(8080);
    assert!(matches!(layer.status, ChainLayerStatus::Connected));
    assert_eq!(layer.local_port, Some(8080));

    // Simulate error
    layer.status = ChainLayerStatus::Error("Connection failed".to_string());
    layer.error = Some("Connection failed".to_string());
    match &layer.status {
        ChainLayerStatus::Error(msg) => assert_eq!(msg, "Connection failed"),
        _ => panic!("Expected error status"),
    }
    assert_eq!(layer.error, Some("Connection failed".to_string()));
}

#[test]
fn test_connection_chain_status_transitions() {
    let layers = vec![create_test_layer(ConnectionType::Proxy, 0)];
    let mut chain = ConnectionChain {
        id: "test_chain".to_string(),
        name: "Test Chain".to_string(),
        description: None,
        layers,
        status: ChainStatus::Disconnected,
        created_at: Utc::now(),
        connected_at: None,
        final_local_port: None,
        error: None,
    };

    // Initially disconnected
    assert!(matches!(chain.status, ChainStatus::Disconnected));

    // Simulate connecting
    chain.status = ChainStatus::Connecting;
    assert!(matches!(chain.status, ChainStatus::Connecting));

    // Simulate successful connection
    chain.status = ChainStatus::Connected;
    chain.connected_at = Some(Utc::now());
    chain.final_local_port = Some(8080);
    assert!(matches!(chain.status, ChainStatus::Connected));
    assert!(chain.connected_at.is_some());
    assert_eq!(chain.final_local_port, Some(8080));

    // Simulate error
    chain.status = ChainStatus::Error("Chain failed".to_string());
    chain.error = Some("Chain failed".to_string());
    match &chain.status {
        ChainStatus::Error(msg) => assert_eq!(msg, "Chain failed"),
        _ => panic!("Expected error status"),
    }
    assert_eq!(chain.error, Some("Chain failed".to_string()));
}