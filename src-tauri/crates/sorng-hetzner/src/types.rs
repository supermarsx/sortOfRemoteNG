use serde::{Deserialize, Serialize};

// ── Connection ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerConnectionConfig {
    pub api_token: String,
    pub base_url: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerConnectionSummary {
    pub server_count: u64,
    pub project_name: Option<String>,
}

// ── Servers ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerServer {
    pub id: u64,
    pub name: String,
    pub status: ServerStatus,
    pub public_net: HetznerPublicNet,
    pub private_net: Vec<HetznerPrivateNet>,
    pub server_type: HetznerServerType,
    pub datacenter: HetznerDatacenter,
    pub image: Option<HetznerImage>,
    pub iso: Option<serde_json::Value>,
    pub rescue_enabled: bool,
    pub locked: bool,
    pub backup_window: Option<String>,
    pub outgoing_traffic: Option<u64>,
    pub ingoing_traffic: Option<u64>,
    pub included_traffic: u64,
    pub protection: HetznerProtection,
    pub labels: serde_json::Value,
    pub volumes: Vec<u64>,
    pub load_balancers: Vec<u64>,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerStatus {
    Running,
    Initializing,
    Starting,
    Stopping,
    Off,
    Deleting,
    Migrating,
    Rebuilding,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerPublicNet {
    pub ipv4: Option<HetznerIpv4>,
    pub ipv6: Option<HetznerIpv6>,
    pub floating_ips: Vec<u64>,
    pub firewalls: Vec<HetznerFirewallRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerIpv4 {
    pub ip: String,
    pub blocked: bool,
    pub dns_ptr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerIpv6 {
    pub ip: String,
    pub blocked: bool,
    pub dns_ptr: Vec<HetznerDnsPtr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerDnsPtr {
    pub ip: String,
    pub dns_ptr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerPrivateNet {
    pub network: u64,
    pub ip: String,
    pub alias_ips: Vec<String>,
    pub mac_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerFirewallRef {
    pub id: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerServerType {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub cores: u32,
    pub memory: f64,
    pub disk: u64,
    pub deprecated: Option<bool>,
    pub prices: Option<Vec<HetznerPrice>>,
    pub storage_type: String,
    pub cpu_type: String,
    pub architecture: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerDatacenter {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub location: HetznerLocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLocation {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub country: String,
    pub city: String,
    pub latitude: f64,
    pub longitude: f64,
    pub network_zone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerProtection {
    pub delete: bool,
    pub rebuild: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerPrice {
    pub location: String,
    pub price_hourly: HetznerPriceDetail,
    pub price_monthly: HetznerPriceDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerPriceDetail {
    pub net: String,
    pub gross: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServerRequest {
    pub name: String,
    pub server_type: String,
    pub image: String,
    pub location: Option<String>,
    pub datacenter: Option<String>,
    pub ssh_keys: Option<Vec<u64>>,
    pub volumes: Option<Vec<u64>>,
    pub firewalls: Option<Vec<HetznerFirewallRef>>,
    pub networks: Option<Vec<u64>>,
    pub user_data: Option<String>,
    pub labels: Option<serde_json::Value>,
    pub public_net: Option<serde_json::Value>,
    pub start_after_create: Option<bool>,
}

// ── Networks ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerNetwork {
    pub id: u64,
    pub name: String,
    pub ip_range: String,
    pub subnets: Vec<HetznerSubnet>,
    pub routes: Vec<HetznerRoute>,
    pub servers: Vec<u64>,
    pub protection: HetznerProtection,
    pub labels: serde_json::Value,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerSubnet {
    #[serde(rename = "type")]
    pub type_field: String,
    pub ip_range: String,
    pub network_zone: String,
    pub gateway: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerRoute {
    pub destination: String,
    pub gateway: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkRequest {
    pub name: String,
    pub ip_range: String,
    pub subnets: Option<Vec<HetznerSubnet>>,
    pub routes: Option<Vec<HetznerRoute>>,
    pub labels: Option<serde_json::Value>,
}

// ── Firewalls ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerFirewall {
    pub id: u64,
    pub name: String,
    pub rules: Vec<HetznerFirewallRule>,
    pub applied_to: Vec<HetznerFirewallAppliedTo>,
    pub labels: serde_json::Value,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerFirewallRule {
    pub direction: String,
    pub protocol: String,
    pub port: Option<String>,
    pub source_ips: Vec<String>,
    pub destination_ips: Vec<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerFirewallAppliedTo {
    #[serde(rename = "type")]
    pub type_field: String,
    pub server: Option<HetznerFirewallServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerFirewallServer {
    pub id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFirewallRequest {
    pub name: String,
    pub rules: Option<Vec<HetznerFirewallRule>>,
    pub labels: Option<serde_json::Value>,
}

// ── Floating IPs ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerFloatingIp {
    pub id: u64,
    pub description: Option<String>,
    pub ip: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub server: Option<u64>,
    pub dns_ptr: Vec<HetznerDnsPtr>,
    pub home_location: HetznerLocation,
    pub blocked: bool,
    pub protection: HetznerProtection,
    pub labels: serde_json::Value,
    pub created: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFloatingIpRequest {
    #[serde(rename = "type")]
    pub type_field: String,
    pub home_location: Option<String>,
    pub server: Option<u64>,
    pub description: Option<String>,
    pub name: Option<String>,
    pub labels: Option<serde_json::Value>,
}

// ── Volumes ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerVolume {
    pub id: u64,
    pub name: String,
    pub size: u64,
    pub server: Option<u64>,
    pub location: HetznerLocation,
    pub linux_device: Option<String>,
    pub protection: HetznerProtection,
    pub labels: serde_json::Value,
    pub status: String,
    pub format: Option<String>,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVolumeRequest {
    pub name: String,
    pub size: u64,
    pub server: Option<u64>,
    pub location: Option<String>,
    pub automount: Option<bool>,
    pub format: Option<String>,
    pub labels: Option<serde_json::Value>,
}

// ── Load Balancers ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLoadBalancer {
    pub id: u64,
    pub name: String,
    pub public_net: HetznerLbPublicNet,
    pub private_net: Vec<HetznerLbPrivateNet>,
    pub location: HetznerLocation,
    pub load_balancer_type: HetznerLbType,
    pub protection: HetznerProtection,
    pub labels: serde_json::Value,
    pub targets: Vec<HetznerLbTarget>,
    pub services: Vec<HetznerLbService>,
    pub algorithm: HetznerLbAlgorithm,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLbPublicNet {
    pub enabled: bool,
    pub ipv4: Option<HetznerIpv4>,
    pub ipv6: Option<HetznerIpv6>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLbPrivateNet {
    pub network: u64,
    pub ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLbType {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub max_connections: u64,
    pub max_services: u32,
    pub max_targets: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLbTarget {
    #[serde(rename = "type")]
    pub type_field: String,
    pub server: Option<HetznerLbTargetServer>,
    pub health_status: Option<Vec<HetznerHealthStatus>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLbTargetServer {
    pub id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerHealthStatus {
    pub listen_port: u16,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLbService {
    pub protocol: String,
    pub listen_port: u16,
    pub destination_port: u16,
    pub proxyprotocol: bool,
    pub health_check: Option<HetznerHealthCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerHealthCheck {
    pub protocol: String,
    pub port: u16,
    pub interval: u32,
    pub timeout: u32,
    pub retries: u32,
    pub http: Option<HetznerHttpHealthCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerHttpHealthCheck {
    pub domain: Option<String>,
    pub path: String,
    pub response: Option<String>,
    pub status_codes: Option<Vec<String>>,
    pub tls: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerLbAlgorithm {
    #[serde(rename = "type")]
    pub type_field: String,
}

// ── Images ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerImage {
    pub id: u64,
    pub name: Option<String>,
    pub description: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub status: String,
    pub image_size: Option<f64>,
    pub disk_size: f64,
    pub created: String,
    pub os_flavor: String,
    pub os_version: Option<String>,
    pub rapid_deploy: Option<bool>,
    pub protection: HetznerProtection,
    pub labels: serde_json::Value,
    pub created_from: Option<HetznerCreatedFrom>,
    pub architecture: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerCreatedFrom {
    pub id: u64,
    pub name: String,
}

// ── SSH Keys ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerSshKey {
    pub id: u64,
    pub name: String,
    pub fingerprint: String,
    pub public_key: String,
    pub labels: serde_json::Value,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSshKeyRequest {
    pub name: String,
    pub public_key: String,
    pub labels: Option<serde_json::Value>,
}

// ── Certificates ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerCertificate {
    pub id: u64,
    pub name: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub certificate: Option<String>,
    pub fingerprint: Option<String>,
    pub not_valid_before: Option<String>,
    pub not_valid_after: Option<String>,
    pub domain_names: Vec<String>,
    pub status: Option<HetznerCertStatus>,
    pub labels: serde_json::Value,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerCertStatus {
    pub issuance: Option<String>,
    pub renewal: Option<String>,
    pub error: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCertificateRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub certificate: Option<String>,
    pub private_key: Option<String>,
    pub domain_names: Option<Vec<String>>,
    pub labels: Option<serde_json::Value>,
}

// ── Actions ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerAction {
    pub id: u64,
    pub command: String,
    pub status: String,
    pub progress: u32,
    pub started: String,
    pub finished: Option<String>,
    pub resources: Vec<HetznerActionResource>,
    pub error: Option<HetznerActionError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerActionResource {
    pub id: u64,
    #[serde(rename = "type")]
    pub type_field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerActionError {
    pub code: String,
    pub message: String,
}

// ── Dashboard ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HetznerDashboard {
    pub total_servers: u64,
    pub running_servers: u64,
    pub stopped_servers: u64,
    pub total_volumes: u64,
    pub total_networks: u64,
    pub total_firewalls: u64,
    pub total_floating_ips: u64,
    pub total_load_balancers: u64,
    pub total_images: u64,
    pub total_ssh_keys: u64,
    pub recent_actions: Vec<HetznerAction>,
}

// ── API list response wrappers ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServersResponse {
    pub servers: Vec<HetznerServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerResponse {
    pub server: HetznerServer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworksResponse {
    pub networks: Vec<HetznerNetwork>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkResponse {
    pub network: HetznerNetwork,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallsResponse {
    pub firewalls: Vec<HetznerFirewall>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallResponse {
    pub firewall: HetznerFirewall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloatingIpsResponse {
    pub floating_ips: Vec<HetznerFloatingIp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloatingIpResponse {
    pub floating_ip: HetznerFloatingIp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumesResponse {
    pub volumes: Vec<HetznerVolume>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeResponse {
    pub volume: HetznerVolume,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancersResponse {
    pub load_balancers: Vec<HetznerLoadBalancer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerResponse {
    pub load_balancer: HetznerLoadBalancer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagesResponse {
    pub images: Vec<HetznerImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageResponse {
    pub image: HetznerImage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKeysResponse {
    pub ssh_keys: Vec<HetznerSshKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKeyResponse {
    pub ssh_key: HetznerSshKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificatesResponse {
    pub certificates: Vec<HetznerCertificate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateResponse {
    pub certificate: HetznerCertificate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionsResponse {
    pub actions: Vec<HetznerAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResponse {
    pub action: HetznerAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServerResponse {
    pub server: HetznerServer,
    pub action: HetznerAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVolumeResponse {
    pub volume: HetznerVolume,
    pub action: HetznerAction,
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_status_serialize() {
        let status = ServerStatus::Running;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"running\"");
    }

    #[test]
    fn test_server_status_deserialize() {
        let status: ServerStatus = serde_json::from_str("\"off\"").unwrap();
        assert!(matches!(status, ServerStatus::Off));
    }

    #[test]
    fn test_connection_config_roundtrip() {
        let config = HetznerConnectionConfig {
            api_token: "test-token".to_string(),
            base_url: None,
            tls_skip_verify: Some(false),
            timeout_secs: Some(30),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: HetznerConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.api_token, "test-token");
    }

    #[test]
    fn test_protection_roundtrip() {
        let prot = HetznerProtection {
            delete: true,
            rebuild: false,
        };
        let json = serde_json::to_string(&prot).unwrap();
        let parsed: HetznerProtection = serde_json::from_str(&json).unwrap();
        assert!(parsed.delete);
        assert!(!parsed.rebuild);
    }

    #[test]
    fn test_dashboard_serialize() {
        let dash = HetznerDashboard {
            total_servers: 5,
            running_servers: 3,
            stopped_servers: 2,
            total_volumes: 10,
            total_networks: 2,
            total_firewalls: 1,
            total_floating_ips: 3,
            total_load_balancers: 1,
            total_images: 8,
            total_ssh_keys: 4,
            recent_actions: vec![],
        };
        let json = serde_json::to_string(&dash).unwrap();
        assert!(json.contains("\"totalServers\":5"));
    }

    #[test]
    fn test_firewall_rule_roundtrip() {
        let rule = HetznerFirewallRule {
            direction: "in".to_string(),
            protocol: "tcp".to_string(),
            port: Some("80".to_string()),
            source_ips: vec!["0.0.0.0/0".to_string()],
            destination_ips: vec![],
            description: Some("Allow HTTP".to_string()),
        };
        let json = serde_json::to_string(&rule).unwrap();
        let parsed: HetznerFirewallRule = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.protocol, "tcp");
    }

    #[test]
    fn test_action_error_roundtrip() {
        let err = HetznerActionError {
            code: "server_error".to_string(),
            message: "Something went wrong".to_string(),
        };
        let json = serde_json::to_string(&err).unwrap();
        let parsed: HetznerActionError = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.code, "server_error");
    }

    #[test]
    fn test_servers_response_deserialize() {
        let json = r#"{"servers":[]}"#;
        let resp: ServersResponse = serde_json::from_str(json).unwrap();
        assert!(resp.servers.is_empty());
    }

    #[test]
    fn test_lb_algorithm_type_field() {
        let algo = HetznerLbAlgorithm {
            type_field: "round_robin".to_string(),
        };
        let json = serde_json::to_string(&algo).unwrap();
        assert!(json.contains("\"type\":\"round_robin\""));
    }
}
