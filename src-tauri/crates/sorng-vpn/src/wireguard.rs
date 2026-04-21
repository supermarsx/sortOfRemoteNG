use chrono::{DateTime, Utc};
use defguard_wireguard_rs::{
    host::Peer, net::IpAddrMask, InterfaceConfiguration, WGApi, WireguardInterfaceApi,
};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Platform-specific WGApi type alias.
///
/// On Windows the kernel implementation (`wireguard-nt`) is available;
/// on Unix we use the userspace implementation backed by BoringTun.
#[cfg(target_family = "windows")]
type WgHandle = WGApi<defguard_wireguard_rs::Kernel>;
#[cfg(unix)]
type WgHandle = WGApi<defguard_wireguard_rs::Userspace>;

pub type WireGuardServiceState = Arc<Mutex<WireGuardService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardConnection {
    pub id: String,
    pub name: String,
    pub config: WireGuardConfig,
    pub status: WireGuardStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub interface_name: Option<String>,
    pub local_ip: Option<String>,
    pub peer_ip: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum WireGuardStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardConfig {
    pub private_key: Option<String>,
    pub public_key: Option<String>,
    pub preshared_key: Option<String>,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: Option<u16>,
    pub listen_port: Option<u16>,
    pub dns_servers: Vec<String>,
    pub mtu: Option<u16>,
    pub table: Option<String>,
    pub fwmark: Option<u32>,
    pub config_file: Option<String>,
    pub interface_name: Option<String>,
}

pub struct WireGuardService {
    connections: HashMap<String, WireGuardConnection>,
    /// Live WGApi handles keyed by connection ID.  These are not
    /// serialisable so they live outside the connection struct.
    wg_handles: HashMap<String, WgHandle>,
    emitter: Option<DynEventEmitter>,
}

impl WireGuardService {
    pub fn new() -> WireGuardServiceState {
        Arc::new(Mutex::new(WireGuardService {
            connections: HashMap::new(),
            wg_handles: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> WireGuardServiceState {
        Arc::new(Mutex::new(WireGuardService {
            connections: HashMap::new(),
            wg_handles: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "wireguard",
                "status": status,
            });
            if let (Some(base), Some(ext)) = (payload.as_object_mut(), extra.as_object()) {
                for (k, v) in ext {
                    base.insert(k.clone(), v.clone());
                }
            }
            let _ = emitter.emit_event("vpn::status-changed", payload);
        }
    }

    pub async fn create_connection(
        &mut self,
        name: String,
        config: WireGuardConfig,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = WireGuardConnection {
            id: id.clone(),
            name,
            config,
            status: WireGuardStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            local_ip: None,
            peer_ip: None,
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        // Validate connection exists
        if !self.connections.contains_key(connection_id) {
            return Err("WireGuard connection not found".to_string());
        }

        // Early-return if already connected
        if let Some(conn) = self.connections.get(connection_id) {
            if matches!(conn.status, WireGuardStatus::Connected) {
                return Ok(());
            }
        }

        // Clone what we need before mutable borrows
        let config = self.connections[connection_id].config.clone();

        // Generate a short, unique interface name.
        // WireGuard interface names are limited (15 chars on Linux), so
        // we use a prefix + first 8 chars of the UUID.
        let interface_name = config
            .interface_name
            .clone()
            .unwrap_or_else(|| format!("sorng_{}", &connection_id[..8]));

        // Mark as connecting
        if let Some(conn) = self.connections.get_mut(connection_id) {
            conn.status = WireGuardStatus::Connecting;
            conn.interface_name = Some(interface_name.clone());
        }

        // Build and configure the WireGuard interface
        let result = self.setup_wireguard_interface(connection_id, &interface_name, &config);

        match result {
            Ok(local_ip) => {
                let connection = self
                    .connections
                    .get_mut(connection_id)
                    .expect("connection_id verified above");

                connection.status = WireGuardStatus::Connected;
                connection.connected_at = Some(Utc::now());
                connection.local_ip = local_ip.clone();

                // Peer endpoint IP (from the config)
                connection.peer_ip = config.endpoint.as_ref().map(|ep| {
                    // Strip the port from "host:port"
                    ep.rsplit_once(':')
                        .map(|(host, _)| host.to_string())
                        .unwrap_or_else(|| ep.clone())
                });

                let peer_ip = connection.peer_ip.clone();

                self.emit_status(
                    connection_id,
                    "connected",
                    serde_json::json!({
                        "local_ip": local_ip,
                        "peer_ip": peer_ip,
                    }),
                );
                Ok(())
            }
            Err(err_msg) => {
                // Clean up the handle if we partially created one
                self.remove_wg_handle(connection_id);

                if let Some(conn) = self.connections.get_mut(connection_id) {
                    conn.status = WireGuardStatus::Error(err_msg.clone());
                }

                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": &err_msg }),
                );
                Err(format!("WireGuard connection failed: {}", err_msg))
            }
        }
    }

    /// Creates the WireGuard interface, configures it, and returns the
    /// local IP address (if any addresses were configured).
    fn setup_wireguard_interface(
        &mut self,
        connection_id: &str,
        interface_name: &str,
        config: &WireGuardConfig,
    ) -> Result<Option<String>, String> {
        // Create the platform-appropriate WGApi handle
        let mut wgapi = WgHandle::new(interface_name.to_string())
            .map_err(|e| format!("Failed to create WireGuard API: {e}"))?;

        // Create the network interface
        wgapi
            .create_interface()
            .map_err(|e| format!("Failed to create WireGuard interface: {e}"))?;

        // Build the peer from config
        let peer = Self::build_peer(config)?;

        // Build interface configuration
        let prvkey = config
            .private_key
            .as_deref()
            .ok_or_else(|| "Private key is required for WireGuard connection".to_string())?;

        // Parse allowed IPs into IpAddrMask for the interface addresses.
        let addresses: Vec<IpAddrMask> = config
            .allowed_ips
            .iter()
            .filter_map(|ip| ip.parse::<IpAddrMask>().ok())
            .collect();

        let iface_config = InterfaceConfiguration {
            name: interface_name.to_string(),
            prvkey: prvkey.to_string(),
            addresses: addresses.clone(),
            port: config.listen_port.unwrap_or(0),
            peers: vec![peer],
            mtu: config.mtu.map(|m| m as u32),
        };

        // Apply interface configuration (sets private key, port, peers)
        wgapi
            .configure_interface(&iface_config)
            .map_err(|e| format!("Failed to configure WireGuard interface: {e}"))?;

        // Assign addresses to the interface
        for addr in &addresses {
            if let Err(e) = wgapi.assign_address(addr) {
                log::warn!(
                    "Failed to assign address {} to {}: {e}",
                    addr,
                    interface_name
                );
            }
        }

        // Configure DNS if specified
        if !config.dns_servers.is_empty() {
            let dns_ips: Vec<IpAddr> = config
                .dns_servers
                .iter()
                .filter_map(|s| s.parse::<IpAddr>().ok())
                .collect();
            if !dns_ips.is_empty() {
                let search_domains: Vec<&str> = Vec::new();
                if let Err(e) = wgapi.configure_dns(&dns_ips, &search_domains) {
                    log::warn!("Failed to configure DNS for {}: {e}", interface_name);
                }
            }
        }

        // Configure peer routing (sets up routes for AllowedIPs)
        let peers_for_routing = vec![Self::build_peer(config)?];
        if let Err(e) = wgapi.configure_peer_routing(&peers_for_routing) {
            log::warn!(
                "Failed to configure peer routing for {}: {e}",
                interface_name
            );
        }

        // Determine the local tunnel IP (first address we assigned)
        let local_ip = addresses.first().map(|a| a.address.to_string());

        // Store the handle for later teardown
        self.wg_handles.insert(connection_id.to_string(), wgapi);

        Ok(local_ip)
    }

    /// Build a `Peer` from the user-supplied `WireGuardConfig`.
    fn build_peer(config: &WireGuardConfig) -> Result<Peer, String> {
        use defguard_wireguard_rs::key::Key;

        let pubkey_str = config
            .public_key
            .as_deref()
            .ok_or_else(|| "Peer public key is required".to_string())?;

        let pubkey: Key = pubkey_str
            .parse()
            .map_err(|e| format!("Invalid peer public key: {e}"))?;

        let mut peer = Peer::new(pubkey);

        // Preshared key
        if let Some(psk_str) = &config.preshared_key {
            let psk: Key = psk_str
                .parse()
                .map_err(|e| format!("Invalid preshared key: {e}"))?;
            peer.preshared_key = Some(psk);
        }

        // Endpoint
        if let Some(endpoint_str) = &config.endpoint {
            peer.set_endpoint(endpoint_str)
                .map_err(|e| format!("Invalid endpoint '{}': {e}", endpoint_str))?;
        }

        // Allowed IPs
        let allowed_ips: Vec<IpAddrMask> = config
            .allowed_ips
            .iter()
            .map(|s| {
                s.parse::<IpAddrMask>()
                    .map_err(|e| format!("Invalid allowed IP '{}': {e}", s))
            })
            .collect::<Result<Vec<_>, _>>()?;
        peer.set_allowed_ips(allowed_ips);

        // Persistent keepalive
        if let Some(keepalive) = config.persistent_keepalive {
            peer.persistent_keepalive_interval = Some(keepalive);
        }

        Ok(peer)
    }

    /// Remove and tear down a stored WGApi handle.
    ///
    /// On Windows `remove_interface` takes `&mut self`, on Unix it takes
    /// `&self`.  This helper abstracts that difference.
    fn remove_wg_handle(&mut self, connection_id: &str) {
        if let Some(mut handle) = self.wg_handles.remove(connection_id) {
            let _ = handle.remove_interface();
        }
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "WireGuard connection not found".to_string())?;

        if let WireGuardStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = WireGuardStatus::Disconnecting;

        // Remove the interface via the stored WGApi handle
        if let Some(mut handle) = self.wg_handles.remove(connection_id) {
            if let Err(e) = handle.remove_interface() {
                let err_msg = format!("Failed to remove WireGuard interface: {e}");
                let connection = self
                    .connections
                    .get_mut(connection_id)
                    .expect("connection_id verified above");
                connection.status = WireGuardStatus::Error(err_msg.clone());

                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": err_msg }),
                );
                return Err(format!("WireGuard disconnection failed: {}", err_msg));
            }
        }
        // If no handle exists (e.g. process restarted), the interface may
        // already be gone -- that is not an error.

        let connection = self
            .connections
            .get_mut(connection_id)
            .expect("connection_id verified above");

        connection.status = WireGuardStatus::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.peer_ip = None;
        connection.interface_name = None;

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<WireGuardConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "WireGuard connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<WireGuardConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn is_connection_active(&self, connection_id: &str) -> bool {
        if let Some(connection) = self.connections.get(connection_id) {
            matches!(connection.status, WireGuardStatus::Connected)
        } else {
            false
        }
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let WireGuardStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        self.remove_wg_handle(connection_id);
        Ok(())
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<WireGuardConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "WireGuard connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }

    /// Generate a traditional WireGuard config-file string.
    ///
    /// This is kept for diagnostic/export purposes even though the
    /// embedded implementation no longer writes temp files.
    #[allow(dead_code)]
    fn generate_config(
        &self,
        config: &WireGuardConfig,
        _interface_name: &str,
    ) -> Result<String, String> {
        let mut lines = Vec::new();

        lines.push("[Interface]".to_string());
        if let Some(private_key) = &config.private_key {
            lines.push(format!("PrivateKey = {}", private_key));
        }
        if let Some(listen_port) = config.listen_port {
            lines.push(format!("ListenPort = {}", listen_port));
        }
        if !config.dns_servers.is_empty() {
            lines.push(format!("DNS = {}", config.dns_servers.join(",")));
        }
        if let Some(mtu) = config.mtu {
            lines.push(format!("MTU = {}", mtu));
        }
        if let Some(table) = &config.table {
            lines.push(format!("Table = {}", table));
        }
        if let Some(fwmark) = config.fwmark {
            lines.push(format!("FwMark = {}", fwmark));
        }

        lines.push(String::new());
        lines.push("[Peer]".to_string());
        if let Some(public_key) = &config.public_key {
            lines.push(format!("PublicKey = {}", public_key));
        }
        if let Some(preshared_key) = &config.preshared_key {
            lines.push(format!("PresharedKey = {}", preshared_key));
        }
        if let Some(endpoint) = &config.endpoint {
            lines.push(format!("Endpoint = {}", endpoint));
        }
        if !config.allowed_ips.is_empty() {
            lines.push(format!("AllowedIPs = {}", config.allowed_ips.join(",")));
        }
        if let Some(persistent_keepalive) = config.persistent_keepalive {
            lines.push(format!("PersistentKeepalive = {}", persistent_keepalive));
        }

        Ok(lines.join("\n"))
    }

    #[allow(dead_code)] // Used in tests and for diagnostics
    fn extract_ip_from_output(&self, output: &str) -> Result<String, String> {
        for line in output.lines() {
            if line.trim().starts_with("inet ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    return Ok(parts[1].split('/').next().unwrap_or(parts[1]).to_string());
                }
            }
        }
        Err("No IP address found".to_string())
    }

    #[allow(dead_code)] // Used for diagnostics
    fn extract_peer_ip_from_wg(&self, output: &str) -> Option<String> {
        for line in output.lines() {
            if line.contains("endpoint:") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 2 {
                    return Some(parts[1].trim().to_string());
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_wg_config() -> WireGuardConfig {
        WireGuardConfig {
            private_key: Some("cHJpdmF0ZWtleQ==".to_string()),
            public_key: Some("cHVibGlja2V5".to_string()),
            preshared_key: None,
            endpoint: Some("vpn.example.com:51820".to_string()),
            allowed_ips: vec!["0.0.0.0/0".to_string()],
            persistent_keepalive: Some(25),
            listen_port: None,
            dns_servers: vec!["1.1.1.1".to_string()],
            mtu: Some(1420),
            table: None,
            fwmark: None,
            config_file: None,
            interface_name: None,
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn wireguard_status_serde_roundtrip() {
        let variants: Vec<WireGuardStatus> = vec![
            WireGuardStatus::Disconnected,
            WireGuardStatus::Connecting,
            WireGuardStatus::Connected,
            WireGuardStatus::Disconnecting,
            WireGuardStatus::Error("test".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: WireGuardStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn wireguard_config_serde_roundtrip() {
        let cfg = default_wg_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: WireGuardConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.endpoint, Some("vpn.example.com:51820".to_string()));
        assert_eq!(back.mtu, Some(1420));
        assert_eq!(back.allowed_ips, vec!["0.0.0.0/0"]);
    }

    #[test]
    fn wireguard_connection_serde_roundtrip() {
        let conn = WireGuardConnection {
            id: "wg1".to_string(),
            name: "Test WG".to_string(),
            config: default_wg_config(),
            status: WireGuardStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            local_ip: None,
            peer_ip: None,
            process_id: None,
        };
        let json = serde_json::to_string(&conn).unwrap();
        let back: WireGuardConnection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "wg1");
        assert_eq!(back.name, "Test WG");
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test WG".to_string(), default_wg_config())
            .await
            .unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_default_status() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, WireGuardStatus::Disconnected));
        assert!(conn.connected_at.is_none());
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        assert!(svc.list_connections().await.is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        svc.create_connection("WG1".to_string(), default_wg_config())
            .await
            .unwrap();
        svc.create_connection("WG2".to_string(), default_wg_config())
            .await
            .unwrap();
        assert_eq!(svc.list_connections().await.len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        assert!(svc.get_connection("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();
        svc.delete_connection(&id).await.unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    #[tokio::test]
    async fn delete_nonexistent_is_ok() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        // delete_connection just removes from HashMap, doesn't error on missing
        svc.delete_connection("nonexistent").await.unwrap();
    }

    // ── Config generation ───────────────────────────────────────────────

    #[tokio::test]
    async fn generate_config_has_interface_section() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("[Interface]"));
        assert!(content.contains("[Peer]"));
    }

    #[tokio::test]
    async fn generate_config_with_keys() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("PrivateKey = cHJpdmF0ZWtleQ=="));
        assert!(content.contains("PublicKey = cHVibGlja2V5"));
    }

    #[tokio::test]
    async fn generate_config_with_endpoint() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("Endpoint = vpn.example.com:51820"));
    }

    #[tokio::test]
    async fn generate_config_with_dns() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("DNS = 1.1.1.1"));
    }

    #[tokio::test]
    async fn generate_config_with_mtu() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("MTU = 1420"));
    }

    #[tokio::test]
    async fn generate_config_with_keepalive() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("PersistentKeepalive = 25"));
    }

    #[tokio::test]
    async fn generate_config_with_allowed_ips() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("AllowedIPs = 0.0.0.0/0"));
    }

    #[tokio::test]
    async fn generate_config_minimal() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = WireGuardConfig {
            private_key: None,
            public_key: None,
            preshared_key: None,
            endpoint: None,
            allowed_ips: Vec::new(),
            persistent_keepalive: None,
            listen_port: None,
            dns_servers: Vec::new(),
            mtu: None,
            table: None,
            fwmark: None,
            config_file: None,
            interface_name: None,
        };
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("[Interface]"));
        assert!(content.contains("[Peer]"));
        // Should not contain optional fields
        assert!(!content.contains("PrivateKey"));
    }

    // ── Helper methods ──────────────────────────────────────────────────

    #[tokio::test]
    async fn extract_ip_from_output_valid() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let output = "3: wg0: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420\n    inet 10.0.0.1/24 scope global wg0\n";
        let ip = svc.extract_ip_from_output(output).unwrap();
        assert_eq!(ip, "10.0.0.1");
    }

    #[tokio::test]
    async fn extract_ip_from_output_no_ip() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let result = svc.extract_ip_from_output("no ip info here");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn extract_peer_ip_from_wg_valid() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let output =
            "interface: wg0\n  public key: abc=\n  peer: xyz=\n    endpoint: 1.2.3.4:51820\n";
        let peer = svc.extract_peer_ip_from_wg(output);
        assert!(peer.is_some());
    }

    #[tokio::test]
    async fn extract_peer_ip_from_wg_none() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let peer = svc.extract_peer_ip_from_wg("no endpoint here");
        assert!(peer.is_none());
    }

    // ── update_connection ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_name() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Original".to_string(), default_wg_config())
            .await
            .unwrap();

        svc.update_connection(&id, Some("Updated Name".to_string()), None)
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Updated Name");
    }

    #[tokio::test]
    async fn update_connection_config() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();

        let mut new_config = default_wg_config();
        new_config.endpoint = Some("new-endpoint.example.com:51820".to_string());
        new_config.mtu = Some(1500);

        svc.update_connection(&id, None, Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(
            conn.config.endpoint,
            Some("new-endpoint.example.com:51820".to_string())
        );
        assert_eq!(conn.config.mtu, Some(1500));
    }

    #[tokio::test]
    async fn update_connection_both() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();

        let mut new_config = default_wg_config();
        new_config.persistent_keepalive = Some(30);

        svc.update_connection(&id, Some("Renamed".to_string()), Some(new_config))
            .await
            .unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Renamed");
        assert_eq!(conn.config.persistent_keepalive, Some(30));
    }

    #[tokio::test]
    async fn update_connection_not_found() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let result = svc
            .update_connection("nonexistent", Some("Name".to_string()), None)
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn update_connection_no_changes() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();

        // Update with None for both should be a no-op
        svc.update_connection(&id, None, None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Test");
    }

    // ── is_connection_active ───────────────────────────────────────────

    #[tokio::test]
    async fn is_connection_active_disconnected() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_wg_config())
            .await
            .unwrap();
        assert!(!svc.is_connection_active(&id).await);
    }

    #[tokio::test]
    async fn is_connection_active_nonexistent() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        assert!(!svc.is_connection_active("nonexistent").await);
    }

    // ── Peer building ──────────────────────────────────────────────────

    #[test]
    fn build_peer_requires_public_key() {
        let mut cfg = default_wg_config();
        cfg.public_key = None;
        assert!(WireGuardService::build_peer(&cfg).is_err());
    }
}
