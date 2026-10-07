//! Loopback-only regression tests; no provider activation or external traffic.
use super::tests::{connection, Fixture};
use super::*;
use crate::chaining::{
    ChainLayer, ChainLayerStatus, ChainingService, ChainingServiceState, ChainingServices,
    ConnectionType,
};
use serde_json::json;
use tauri::Manager;

fn services() -> ChainingServiceState {
    ChainingService::new(ChainingServices {
        proxy: crate::proxy::ProxyService::new(),
        openvpn: crate::openvpn::OpenVPNService::new(),
        wireguard: crate::wireguard::WireGuardService::new(),
        zerotier: crate::zerotier::ZeroTierService::new(),
        tailscale: crate::tailscale::TailscaleService::new(),
        pptp: crate::pptp::PPTPService::new(),
        l2tp: crate::l2tp::L2TPService::new(),
        ikev2: crate::ikev2::IKEv2Service::new(),
        ipsec: crate::ipsec::IPsecService::new(),
        sstp: crate::sstp::SSTPService::new(),
    })
}

fn layer(id: &str, position: usize, kind: ConnectionType) -> ChainLayer {
    ChainLayer {
        id: format!("layer-{position}"),
        connection_type: kind,
        connection_id: id.into(),
        position,
        status: ChainLayerStatus::Connected,
        // Deliberately bogus cached endpoint: must not be used as a dial target.
        local_port: Some(1),
        error: None,
    }
}

async fn chain(services: &ChainingServiceState, layers: Vec<ChainLayer>) -> String {
    services
        .lock()
        .await
        .create_chain("browser fixture".into(), None, layers)
        .await
        .unwrap()
}

async fn install_catalog(f: &Fixture, root: &std::path::Path, catalog: Value) {
    let storage = sorng_storage::storage::SecureStorage::new(
        root.join("storage.json").to_string_lossy().into(),
    );
    sorng_storage::storage::lock_app_data(&storage)
        .await
        .write_app_data("proxy_collection_data", &catalog.to_string())
        .await
        .unwrap();
    assert!(f._app.manage(storage));
}

fn install_services(f: &Fixture, services: ChainingServiceState) {
    assert!(f
        ._app
        .manage(NativeBrowserRouteServices::new(f.root.path(), &f.state, services).unwrap()));
}

fn catalog(port: u16) -> Value {
    json!({"profiles":[
        {"id":"outer","config":{"enabled":true,"type":"http","host":"127.0.0.1","port":port}},
        {"id":"inner","config":{"enabled":true,"type":"socks5","host":"inside.invalid","port":1080}}
    ]})
}

#[tokio::test]
async fn saved_native_chain_dials_in_order_and_drops_transport() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let services = services();
    let id = chain(
        &services,
        vec![
            layer("inner", 2, ConnectionType::Proxy),
            layer("outer", 1, ConnectionType::Proxy),
        ],
    )
    .await;
    let mut row = connection();
    row["connectionChainId"] = id.into();
    let f = Fixture::new(row).await;
    install_catalog(
        &f,
        f.root.path(),
        catalog(listener.local_addr().unwrap().port()),
    )
    .await;
    install_services(&f, services);
    let authorized = f.authorize().await.unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut header = Vec::new();
        while !header.ends_with(b"\r\n\r\n") {
            header.push(socket.read_u8().await.unwrap());
        }
        assert!(header.starts_with(b"CONNECT inside.invalid:1080 HTTP/1.1\r\n"));
        socket.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
        let mut greeting = [0; 3];
        socket.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 1, 0]);
        socket.write_all(&[5, 0]).await.unwrap();
        let mut request = [0; 4];
        socket.read_exact(&mut request).await.unwrap();
        assert_eq!(request, [5, 1, 0, 3]);
        let len = socket.read_u8().await.unwrap() as usize;
        let mut host = vec![0; len];
        socket.read_exact(&mut host).await.unwrap();
        assert_eq!(host, b"source.example");
        assert_eq!(socket.read_u16().await.unwrap(), 443);
        socket
            .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 1])
            .await
            .unwrap();
        socket.write_all(b"opaque TLS").await.unwrap();
        assert_eq!(socket.read_u8().await.unwrap(), 42);
        assert_eq!(socket.read(&mut [0; 1]).await.unwrap(), 0);
    });
    let mut stream = tokio::time::timeout(
        Duration::from_secs(5),
        authorized
            .route
            .dial(Authority::parse("source.example:443").unwrap()),
    )
    .await
    .unwrap()
    .unwrap();
    let mut bytes = [0; 10];
    stream.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"opaque TLS");
    stream.write_all(&[42]).await.unwrap();
    drop(stream);
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    authorized.lease.revoke();
    assert!(authorized
        .route
        .dial(Authority::parse("source.example:443").unwrap())
        .await
        .is_err());
}

#[tokio::test]
async fn native_chain_requires_exact_profile_and_encryption_owner() {
    for wrong in [
        "missing-binding",
        "wrong-profile",
        "wrong-owner",
        "wrong-storage",
        "missing-chain",
        "missing-profile",
        "duplicate-profile",
    ] {
        let services = services();
        let id = chain(&services, vec![layer("outer", 0, ConnectionType::Proxy)]).await;
        let mut row = connection();
        row["connectionChainId"] = if wrong == "missing-chain" {
            "absent".into()
        } else {
            id.into()
        };
        let f = Fixture::new(row).await;
        let other_root = tempfile::tempdir().unwrap();
        let other_owner = EncryptionState::new();
        if wrong != "missing-binding" {
            assert!(f._app.manage(
                NativeBrowserRouteServices::new(
                    if wrong == "wrong-profile" {
                        other_root.path()
                    } else {
                        f.root.path()
                    },
                    if wrong == "wrong-owner" {
                        &other_owner
                    } else {
                        &f.state
                    },
                    services,
                )
                .unwrap()
            ));
        }
        let mut config = catalog(1);
        if wrong == "missing-profile" {
            config["profiles"] = json!([]);
        }
        if wrong == "duplicate-profile" {
            let first = config["profiles"][0].clone();
            config["profiles"].as_array_mut().unwrap().push(first);
        }
        install_catalog(
            &f,
            if wrong == "wrong-storage" {
                other_root.path()
            } else {
                f.root.path()
            },
            config,
        )
        .await;
        assert_eq!(
            f.authorize().await.err(),
            Some(NativeAuthorityError::RouteUnsupported),
            "{wrong}"
        );
    }
}

#[tokio::test]
async fn unsupported_native_chain_layers_cannot_be_skipped() {
    for kind in [
        ConnectionType::OpenVPN,
        ConnectionType::WireGuard,
        ConnectionType::IKEv2,
        ConnectionType::IPsec,
        ConnectionType::SSTP,
        ConnectionType::L2TP,
        ConnectionType::PPTP,
        ConnectionType::ZeroTier,
        ConnectionType::Tailscale,
    ] {
        let services = services();
        let id = chain(
            &services,
            vec![
                layer("outer", 0, ConnectionType::Proxy),
                layer("vpn", 1, kind),
            ],
        )
        .await;
        let mut row = connection();
        row["connectionChainId"] = id.into();
        let f = Fixture::new(row).await;
        install_catalog(&f, f.root.path(), catalog(1)).await;
        install_services(&f, services);
        assert_eq!(
            f.authorize().await.err(),
            Some(NativeAuthorityError::RouteUnsupported)
        );
    }
    for config in [
        json!({"type":"ssh","host":"127.0.0.1","port":22,"enabled":true}),
        json!({"type":"http","host":"127.0.0.1","port":1,"enabled":false}),
    ] {
        let services = services();
        let id = chain(&services, vec![layer("outer", 0, ConnectionType::Proxy)]).await;
        let mut row = connection();
        row["connectionChainId"] = id.into();
        let f = Fixture::new(row).await;
        install_catalog(
            &f,
            f.root.path(),
            json!({"profiles":[{"id":"outer","config":config}]}),
        )
        .await;
        install_services(&f, services);
        assert_eq!(
            f.authorize().await.err(),
            Some(NativeAuthorityError::RouteUnsupported)
        );
    }
}

#[tokio::test]
async fn cancelled_native_chain_dial_closes_pending_proxy_stream() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let services = services();
    let id = chain(&services, vec![layer("outer", 0, ConnectionType::Proxy)]).await;
    let mut row = connection();
    row["connectionChainId"] = id.into();
    let f = Fixture::new(row).await;
    install_catalog(
        &f,
        f.root.path(),
        catalog(listener.local_addr().unwrap().port()),
    )
    .await;
    install_services(&f, services);
    let authorized = f.authorize().await.unwrap();
    let route = authorized.route.clone();
    let dial = tokio::spawn(async move {
        route
            .dial(Authority::parse("source.example:443").unwrap())
            .await
    });
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        header.push(socket.read_u8().await.unwrap());
    }
    dial.abort();
    assert!(matches!(dial.await, Err(error) if error.is_cancelled()));
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), socket.read(&mut [0; 1]))
            .await
            .unwrap()
            .unwrap(),
        0
    );
}
