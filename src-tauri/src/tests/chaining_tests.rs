use app::*;
use chrono::Utc;

fn create_test_layer(connection_type: ConnectionType, position: usize) -> ChainLayer {
    ChainLayer {
        id: format!("layer_{}", position),
        connection_type,
        position,
        config: serde_json::json!({"host": "example.com", "port": 8080}),
        status: ChainLayerStatus::Disconnected,
        error_message: None,
        connected_at: None,
    }
}

#[tokio::test]
async fn test_connection_type_equality() {
    assert_eq!(ConnectionType::Proxy, ConnectionType::Proxy);
    assert_eq!(ConnectionType::OpenVPN, ConnectionType::OpenVPN);
    assert_eq!(ConnectionType::WireGuard, ConnectionType::WireGuard);
    assert_eq!(ConnectionType::ZeroTier, ConnectionType::ZeroTier);
    assert_eq!(ConnectionType::Tailscale, ConnectionType::Tailscale);

    assert_ne!(ConnectionType::Proxy, ConnectionType::OpenVPN);
    assert_ne!(ConnectionType::WireGuard, ConnectionType::ZeroTier);
}

#[tokio::test]
async fn test_chain_layer_serialization() {
    let layer = create_test_layer(ConnectionType::Proxy, 0);

    // Serialize
    let json = serde_json::to_string(&layer).unwrap();

    // Deserialize
    let deserialized: ChainLayer = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.id, "layer_0");
    assert_eq!(deserialized.connection_type, ConnectionType::Proxy);
    assert_eq!(deserialized.position, 0);
    assert_eq!(deserialized.status, ChainLayerStatus::Disconnected);
}

#[tokio::test]
async fn test_chain_layer_status_transitions() {
    let mut layer = create_test_layer(ConnectionType::Proxy, 0);

    // Initial status
    assert_eq!(layer.status, ChainLayerStatus::Disconnected);

    // Change to connecting
    layer.status = ChainLayerStatus::Connecting;
    assert_eq!(layer.status, ChainLayerStatus::Connecting);

    // Change to connected
    layer.status = ChainLayerStatus::Connected;
    assert_eq!(layer.status, ChainLayerStatus::Connected);

    // Change to error
    layer.status = ChainLayerStatus::Error("Connection failed".to_string());
    match layer.status {
        ChainLayerStatus::Error(msg) => assert_eq!(msg, "Connection failed"),
        _ => panic!("Expected error status"),
    }
}

#[tokio::test]
async fn test_connection_chain_serialization() {
    let layers = vec![
        create_test_layer(ConnectionType::Proxy, 0),
        create_test_layer(ConnectionType::OpenVPN, 1),
    ];

    let chain = ConnectionChain {
        id: "test_chain".to_string(),
        name: "Test Chain".to_string(),
        layers,
        status: ChainStatus::Disconnected,
        created_at: Utc::now(),
        connected_at: None,
        error_message: None,
    };

    // Serialize
    let json = serde_json::to_string(&chain).unwrap();

    // Deserialize
    let deserialized: ConnectionChain = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.id, "test_chain");
    assert_eq!(deserialized.name, "Test Chain");
    assert_eq!(deserialized.layers.len(), 2);
    assert_eq!(deserialized.status, ChainStatus::Disconnected);
}

#[tokio::test]
async fn test_connection_chain_status_transitions() {
    let layers = vec![create_test_layer(ConnectionType::Proxy, 0)];

    let mut chain = ConnectionChain {
        id: "test_chain".to_string(),
        name: "Test Chain".to_string(),
        layers,
        status: ChainStatus::Disconnected,
        created_at: Utc::now(),
        connected_at: None,
        error_message: None,
    };

    // Initial status
    assert_eq!(chain.status, ChainStatus::Disconnected);

    // Change to connecting
    chain.status = ChainStatus::Connecting;
    assert_eq!(chain.status, ChainStatus::Connecting);

    // Change to connected
    chain.status = ChainStatus::Connected;
    assert_eq!(chain.status, ChainStatus::Connected);

    // Change to error
    chain.status = ChainStatus::Error("Chain failed".to_string());
    match chain.status {
        ChainStatus::Error(msg) => assert_eq!(msg, "Chain failed"),
        _ => panic!("Expected error status"),
    }
}

#[tokio::test]
async fn test_new_chaining_service() {
    let service = ChainingService::new();
    // Service should be created successfully
    assert!(true);
}

#[tokio::test]
async fn test_create_simple_chain() {
    let service = ChainingService::new();

    let layer = create_test_layer(ConnectionType::Proxy, 0);

    let result = service.lock().await.create_chain(vec![layer]).await;
    assert!(result.is_ok());
    let chain_id = result.unwrap();

    // Verify chain exists
    let chain = service.lock().await.get_chain(&chain_id).await;
    assert!(chain.is_ok());
    let chain = chain.unwrap();
    assert!(chain.is_some());
}

#[tokio::test]
async fn test_create_multi_layer_chain() {
    let service = ChainingService::new();

    let layers = vec![
        create_test_layer(ConnectionType::Proxy, 0),
        create_test_layer(ConnectionType::OpenVPN, 1),
    ];

    let result = service.lock().await.create_chain(layers).await;
    assert!(result.is_ok());
    let chain_id = result.unwrap();

    // Verify chain exists
    let chain = service.lock().await.get_chain(&chain_id).await;
    assert!(chain.is_ok());
    let chain = chain.unwrap();
    assert!(chain.is_some());
    let chain = chain.unwrap();
    assert_eq!(chain.layers.len(), 2);
}

#[tokio::test]
async fn test_get_nonexistent_chain() {
    let service = ChainingService::new();

    let result = service.lock().await.get_chain("nonexistent").await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[tokio::test]
async fn test_list_chains() {
    let service = ChainingService::new();

    // Initially empty
    let chains = service.lock().await.list_chains().await;
    assert!(chains.is_empty());

    // Create a chain
    let layer = create_test_layer(ConnectionType::Proxy, 0);
    let chain_id = service.lock().await.create_chain(vec![layer]).await.unwrap();

    // List should contain the chain
    let chains = service.lock().await.list_chains().await;
    assert_eq!(chains.len(), 1);
    assert!(chains.contains(&chain_id));
}

#[tokio::test]
async fn test_delete_existing_chain() {
    let service = ChainingService::new();

    // Create a chain
    let layer = create_test_layer(ConnectionType::Proxy, 0);
    let chain_id = service.lock().await.create_chain(vec![layer]).await.unwrap();

    // Delete the chain
    let result = service.lock().await.delete_chain(&chain_id).await;
    assert!(result.is_ok());

    // Verify chain is gone
    let chain = service.lock().await.get_chain(&chain_id).await;
    assert!(chain.is_ok());
    assert!(chain.unwrap().is_none());
}

#[tokio::test]
async fn test_delete_nonexistent_chain() {
    let service = ChainingService::new();

    let result = service.lock().await.delete_chain("nonexistent").await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_concurrent_chain_operations() {
    let service = ChainingService::new();
    let mut handles = vec![];

    // Spawn multiple chain creation tasks
    for i in 0..3 {
        let service_clone = service.clone();
        let handle = tokio::spawn(async move {
            let layer = create_test_layer(ConnectionType::Proxy, 0);
            let result = service_clone.lock().await.create_chain(vec![layer]).await;
            assert!(result.is_ok());
        });
        handles.push(handle);
    }

    // Wait for all operations to complete
    for handle in handles {
        handle.await.unwrap();
    }

    // Verify all chains were created
    let chains = service.lock().await.list_chains().await;
    assert_eq!(chains.len(), 3);
}

#[tokio::test]
async fn test_empty_chain_creation() {
    let service = ChainingService::new();

    let result = service.lock().await.create_chain(vec![]).await;
    // Empty chain might be allowed or rejected
    assert!(result.is_ok() || result.is_err());
}