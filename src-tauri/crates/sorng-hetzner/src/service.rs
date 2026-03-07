use crate::actions::ActionManager;
use crate::certificates::CertificateManager;
use crate::client::HetznerClient;
use crate::error::{HetznerError, HetznerResult};
use crate::firewalls::FirewallManager;
use crate::floating_ips::FloatingIpManager;
use crate::images::ImageManager;
use crate::load_balancers::LoadBalancerManager;
use crate::networks::NetworkManager;
use crate::servers::ServerManager;
use crate::ssh_keys::SshKeyManager;
use crate::types::*;
use crate::volumes::VolumeManager;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type HetznerServiceState = Arc<Mutex<HetznerService>>;

pub struct HetznerService {
    connections: HashMap<String, HetznerClient>,
}

impl HetznerService {
    pub fn new() -> HetznerServiceState {
        Arc::new(Mutex::new(Self {
            connections: HashMap::new(),
        }))
    }

    fn client(&self, connection_id: &str) -> HetznerResult<&HetznerClient> {
        self.connections
            .get(connection_id)
            .ok_or_else(|| HetznerError::not_connected(format!("Connection '{connection_id}' not found")))
    }

    // ── Connection management ───────────────────────────────────────

    pub async fn connect(
        &mut self,
        connection_id: String,
        config: HetznerConnectionConfig,
    ) -> HetznerResult<HetznerConnectionSummary> {
        let client = HetznerClient::new(config)?;
        client.ping().await?;

        let servers = ServerManager::list_servers(&client).await?;
        let summary = HetznerConnectionSummary {
            server_count: servers.len() as u64,
            project_name: None,
        };

        self.connections.insert(connection_id, client);
        Ok(summary)
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> HetznerResult<()> {
        self.connections
            .remove(connection_id)
            .ok_or_else(|| HetznerError::not_connected(format!("Connection '{connection_id}' not found")))?;
        Ok(())
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    pub async fn ping(&self, connection_id: &str) -> HetznerResult<()> {
        self.client(connection_id)?.ping().await
    }

    // ── Dashboard ───────────────────────────────────────────────────

    pub async fn get_dashboard(&self, connection_id: &str) -> HetznerResult<HetznerDashboard> {
        let client = self.client(connection_id)?;
        let servers = ServerManager::list_servers(client).await?;
        let volumes = VolumeManager::list_volumes(client).await?;
        let networks = NetworkManager::list_networks(client).await?;
        let firewalls = FirewallManager::list_firewalls(client).await?;
        let floating_ips = FloatingIpManager::list_floating_ips(client).await?;
        let load_balancers = LoadBalancerManager::list_load_balancers(client).await?;
        let images = ImageManager::list_images(client).await?;
        let ssh_keys = SshKeyManager::list_ssh_keys(client).await?;
        let actions = ActionManager::list_actions(client).await?;

        let running = servers.iter().filter(|s| matches!(s.status, ServerStatus::Running)).count() as u64;
        let stopped = servers.iter().filter(|s| matches!(s.status, ServerStatus::Off)).count() as u64;

        Ok(HetznerDashboard {
            total_servers: servers.len() as u64,
            running_servers: running,
            stopped_servers: stopped,
            total_volumes: volumes.len() as u64,
            total_networks: networks.len() as u64,
            total_firewalls: firewalls.len() as u64,
            total_floating_ips: floating_ips.len() as u64,
            total_load_balancers: load_balancers.len() as u64,
            total_images: images.len() as u64,
            total_ssh_keys: ssh_keys.len() as u64,
            recent_actions: actions.into_iter().take(10).collect(),
        })
    }

    // ── Servers ─────────────────────────────────────────────────────

    pub async fn list_servers(&self, connection_id: &str) -> HetznerResult<Vec<HetznerServer>> {
        ServerManager::list_servers(self.client(connection_id)?).await
    }

    pub async fn get_server(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerServer> {
        ServerManager::get_server(self.client(connection_id)?, id).await
    }

    pub async fn create_server(
        &self,
        connection_id: &str,
        request: CreateServerRequest,
    ) -> HetznerResult<(HetznerServer, HetznerAction)> {
        ServerManager::create_server(self.client(connection_id)?, request).await
    }

    pub async fn delete_server(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        ServerManager::delete_server(self.client(connection_id)?, id).await
    }

    pub async fn start_server(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ServerManager::start_server(self.client(connection_id)?, id).await
    }

    pub async fn stop_server(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ServerManager::stop_server(self.client(connection_id)?, id).await
    }

    pub async fn reboot_server(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ServerManager::reboot_server(self.client(connection_id)?, id).await
    }

    pub async fn rebuild_server(
        &self,
        connection_id: &str,
        id: u64,
        image: String,
    ) -> HetznerResult<HetznerAction> {
        ServerManager::rebuild_server(self.client(connection_id)?, id, image).await
    }

    pub async fn reset_server(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ServerManager::reset_server(self.client(connection_id)?, id).await
    }

    pub async fn change_server_type(
        &self,
        connection_id: &str,
        id: u64,
        server_type: String,
        upgrade_disk: bool,
    ) -> HetznerResult<HetznerAction> {
        ServerManager::change_type(self.client(connection_id)?, id, server_type, upgrade_disk).await
    }

    pub async fn enable_rescue(
        &self,
        connection_id: &str,
        id: u64,
        rescue_type: Option<String>,
        ssh_keys: Option<Vec<u64>>,
    ) -> HetznerResult<HetznerAction> {
        ServerManager::enable_rescue(self.client(connection_id)?, id, rescue_type, ssh_keys).await
    }

    pub async fn disable_rescue(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ServerManager::disable_rescue(self.client(connection_id)?, id).await
    }

    pub async fn create_server_image(
        &self,
        connection_id: &str,
        id: u64,
        description: Option<String>,
        image_type: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerAction> {
        ServerManager::create_image(self.client(connection_id)?, id, description, image_type, labels).await
    }

    pub async fn enable_backup(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ServerManager::enable_backup(self.client(connection_id)?, id).await
    }

    pub async fn disable_backup(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ServerManager::disable_backup(self.client(connection_id)?, id).await
    }

    pub async fn get_server_metrics(
        &self,
        connection_id: &str,
        id: u64,
        metric_type: String,
        start: String,
        end: String,
    ) -> HetznerResult<serde_json::Value> {
        ServerManager::get_metrics(self.client(connection_id)?, id, metric_type, start, end).await
    }

    // ── Networks ────────────────────────────────────────────────────

    pub async fn list_networks(&self, connection_id: &str) -> HetznerResult<Vec<HetznerNetwork>> {
        NetworkManager::list_networks(self.client(connection_id)?).await
    }

    pub async fn get_network(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerNetwork> {
        NetworkManager::get_network(self.client(connection_id)?, id).await
    }

    pub async fn create_network(
        &self,
        connection_id: &str,
        request: CreateNetworkRequest,
    ) -> HetznerResult<HetznerNetwork> {
        NetworkManager::create_network(self.client(connection_id)?, request).await
    }

    pub async fn update_network(
        &self,
        connection_id: &str,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerNetwork> {
        NetworkManager::update_network(self.client(connection_id)?, id, name, labels).await
    }

    pub async fn delete_network(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        NetworkManager::delete_network(self.client(connection_id)?, id).await
    }

    pub async fn add_subnet(
        &self,
        connection_id: &str,
        id: u64,
        subnet: HetznerSubnet,
    ) -> HetznerResult<HetznerAction> {
        NetworkManager::add_subnet(self.client(connection_id)?, id, subnet).await
    }

    pub async fn delete_subnet(
        &self,
        connection_id: &str,
        id: u64,
        ip_range: String,
    ) -> HetznerResult<HetznerAction> {
        NetworkManager::delete_subnet(self.client(connection_id)?, id, ip_range).await
    }

    pub async fn add_route(
        &self,
        connection_id: &str,
        id: u64,
        route: HetznerRoute,
    ) -> HetznerResult<HetznerAction> {
        NetworkManager::add_route(self.client(connection_id)?, id, route).await
    }

    pub async fn delete_route(
        &self,
        connection_id: &str,
        id: u64,
        route: HetznerRoute,
    ) -> HetznerResult<HetznerAction> {
        NetworkManager::delete_route(self.client(connection_id)?, id, route).await
    }

    // ── Firewalls ───────────────────────────────────────────────────

    pub async fn list_firewalls(&self, connection_id: &str) -> HetznerResult<Vec<HetznerFirewall>> {
        FirewallManager::list_firewalls(self.client(connection_id)?).await
    }

    pub async fn get_firewall(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerFirewall> {
        FirewallManager::get_firewall(self.client(connection_id)?, id).await
    }

    pub async fn create_firewall(
        &self,
        connection_id: &str,
        request: CreateFirewallRequest,
    ) -> HetznerResult<HetznerFirewall> {
        FirewallManager::create_firewall(self.client(connection_id)?, request).await
    }

    pub async fn update_firewall(
        &self,
        connection_id: &str,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerFirewall> {
        FirewallManager::update_firewall(self.client(connection_id)?, id, name, labels).await
    }

    pub async fn delete_firewall(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        FirewallManager::delete_firewall(self.client(connection_id)?, id).await
    }

    pub async fn set_firewall_rules(
        &self,
        connection_id: &str,
        id: u64,
        rules: Vec<HetznerFirewallRule>,
    ) -> HetznerResult<Vec<HetznerAction>> {
        FirewallManager::set_rules(self.client(connection_id)?, id, rules).await
    }

    pub async fn apply_firewall(
        &self,
        connection_id: &str,
        id: u64,
        apply_to: Vec<HetznerFirewallAppliedTo>,
    ) -> HetznerResult<Vec<HetznerAction>> {
        FirewallManager::apply_to_resources(self.client(connection_id)?, id, apply_to).await
    }

    pub async fn remove_firewall(
        &self,
        connection_id: &str,
        id: u64,
        remove_from: Vec<HetznerFirewallAppliedTo>,
    ) -> HetznerResult<Vec<HetznerAction>> {
        FirewallManager::remove_from_resources(self.client(connection_id)?, id, remove_from).await
    }

    // ── Floating IPs ────────────────────────────────────────────────

    pub async fn list_floating_ips(&self, connection_id: &str) -> HetznerResult<Vec<HetznerFloatingIp>> {
        FloatingIpManager::list_floating_ips(self.client(connection_id)?).await
    }

    pub async fn get_floating_ip(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerFloatingIp> {
        FloatingIpManager::get_floating_ip(self.client(connection_id)?, id).await
    }

    pub async fn create_floating_ip(
        &self,
        connection_id: &str,
        request: CreateFloatingIpRequest,
    ) -> HetznerResult<HetznerFloatingIp> {
        FloatingIpManager::create_floating_ip(self.client(connection_id)?, request).await
    }

    pub async fn delete_floating_ip(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        FloatingIpManager::delete_floating_ip(self.client(connection_id)?, id).await
    }

    pub async fn assign_floating_ip(
        &self,
        connection_id: &str,
        id: u64,
        server: u64,
    ) -> HetznerResult<HetznerAction> {
        FloatingIpManager::assign(self.client(connection_id)?, id, server).await
    }

    pub async fn unassign_floating_ip(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        FloatingIpManager::unassign(self.client(connection_id)?, id).await
    }

    // ── Volumes ─────────────────────────────────────────────────────

    pub async fn list_volumes(&self, connection_id: &str) -> HetznerResult<Vec<HetznerVolume>> {
        VolumeManager::list_volumes(self.client(connection_id)?).await
    }

    pub async fn get_volume(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerVolume> {
        VolumeManager::get_volume(self.client(connection_id)?, id).await
    }

    pub async fn create_volume(
        &self,
        connection_id: &str,
        request: CreateVolumeRequest,
    ) -> HetznerResult<(HetznerVolume, HetznerAction)> {
        VolumeManager::create_volume(self.client(connection_id)?, request).await
    }

    pub async fn delete_volume(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        VolumeManager::delete_volume(self.client(connection_id)?, id).await
    }

    pub async fn attach_volume(
        &self,
        connection_id: &str,
        id: u64,
        server: u64,
        automount: Option<bool>,
    ) -> HetznerResult<HetznerAction> {
        VolumeManager::attach(self.client(connection_id)?, id, server, automount).await
    }

    pub async fn detach_volume(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        VolumeManager::detach(self.client(connection_id)?, id).await
    }

    pub async fn resize_volume(
        &self,
        connection_id: &str,
        id: u64,
        size: u64,
    ) -> HetznerResult<HetznerAction> {
        VolumeManager::resize(self.client(connection_id)?, id, size).await
    }

    // ── Load Balancers ──────────────────────────────────────────────

    pub async fn list_load_balancers(
        &self,
        connection_id: &str,
    ) -> HetznerResult<Vec<HetznerLoadBalancer>> {
        LoadBalancerManager::list_load_balancers(self.client(connection_id)?).await
    }

    pub async fn get_load_balancer(
        &self,
        connection_id: &str,
        id: u64,
    ) -> HetznerResult<HetznerLoadBalancer> {
        LoadBalancerManager::get_load_balancer(self.client(connection_id)?, id).await
    }

    pub async fn create_load_balancer(
        &self,
        connection_id: &str,
        request: serde_json::Value,
    ) -> HetznerResult<HetznerLoadBalancer> {
        LoadBalancerManager::create_load_balancer(self.client(connection_id)?, request).await
    }

    pub async fn delete_load_balancer(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        LoadBalancerManager::delete_load_balancer(self.client(connection_id)?, id).await
    }

    pub async fn add_lb_service(
        &self,
        connection_id: &str,
        id: u64,
        service: HetznerLbService,
    ) -> HetznerResult<HetznerAction> {
        LoadBalancerManager::add_service(self.client(connection_id)?, id, service).await
    }

    pub async fn update_lb_service(
        &self,
        connection_id: &str,
        id: u64,
        service: HetznerLbService,
    ) -> HetznerResult<HetznerAction> {
        LoadBalancerManager::update_service(self.client(connection_id)?, id, service).await
    }

    pub async fn delete_lb_service(
        &self,
        connection_id: &str,
        id: u64,
        listen_port: u16,
    ) -> HetznerResult<HetznerAction> {
        LoadBalancerManager::delete_service(self.client(connection_id)?, id, listen_port).await
    }

    pub async fn add_lb_target(
        &self,
        connection_id: &str,
        id: u64,
        target: HetznerLbTarget,
    ) -> HetznerResult<HetznerAction> {
        LoadBalancerManager::add_target(self.client(connection_id)?, id, target).await
    }

    pub async fn remove_lb_target(
        &self,
        connection_id: &str,
        id: u64,
        target: HetznerLbTarget,
    ) -> HetznerResult<HetznerAction> {
        LoadBalancerManager::remove_target(self.client(connection_id)?, id, target).await
    }

    // ── Images ──────────────────────────────────────────────────────

    pub async fn list_images(&self, connection_id: &str) -> HetznerResult<Vec<HetznerImage>> {
        ImageManager::list_images(self.client(connection_id)?).await
    }

    pub async fn get_image(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerImage> {
        ImageManager::get_image(self.client(connection_id)?, id).await
    }

    pub async fn update_image(
        &self,
        connection_id: &str,
        id: u64,
        description: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerImage> {
        ImageManager::update_image(self.client(connection_id)?, id, description, labels).await
    }

    pub async fn delete_image(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        ImageManager::delete_image(self.client(connection_id)?, id).await
    }

    // ── SSH Keys ────────────────────────────────────────────────────

    pub async fn list_ssh_keys(&self, connection_id: &str) -> HetznerResult<Vec<HetznerSshKey>> {
        SshKeyManager::list_ssh_keys(self.client(connection_id)?).await
    }

    pub async fn get_ssh_key(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerSshKey> {
        SshKeyManager::get_ssh_key(self.client(connection_id)?, id).await
    }

    pub async fn create_ssh_key(
        &self,
        connection_id: &str,
        request: CreateSshKeyRequest,
    ) -> HetznerResult<HetznerSshKey> {
        SshKeyManager::create_ssh_key(self.client(connection_id)?, request).await
    }

    pub async fn update_ssh_key(
        &self,
        connection_id: &str,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerSshKey> {
        SshKeyManager::update_ssh_key(self.client(connection_id)?, id, name, labels).await
    }

    pub async fn delete_ssh_key(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        SshKeyManager::delete_ssh_key(self.client(connection_id)?, id).await
    }

    // ── Certificates ────────────────────────────────────────────────

    pub async fn list_certificates(
        &self,
        connection_id: &str,
    ) -> HetznerResult<Vec<HetznerCertificate>> {
        CertificateManager::list_certificates(self.client(connection_id)?).await
    }

    pub async fn get_certificate(
        &self,
        connection_id: &str,
        id: u64,
    ) -> HetznerResult<HetznerCertificate> {
        CertificateManager::get_certificate(self.client(connection_id)?, id).await
    }

    pub async fn create_certificate(
        &self,
        connection_id: &str,
        request: CreateCertificateRequest,
    ) -> HetznerResult<HetznerCertificate> {
        CertificateManager::create_certificate(self.client(connection_id)?, request).await
    }

    pub async fn update_certificate(
        &self,
        connection_id: &str,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerCertificate> {
        CertificateManager::update_certificate(self.client(connection_id)?, id, name, labels).await
    }

    pub async fn delete_certificate(&self, connection_id: &str, id: u64) -> HetznerResult<()> {
        CertificateManager::delete_certificate(self.client(connection_id)?, id).await
    }

    // ── Actions ─────────────────────────────────────────────────────

    pub async fn list_actions(&self, connection_id: &str) -> HetznerResult<Vec<HetznerAction>> {
        ActionManager::list_actions(self.client(connection_id)?).await
    }

    pub async fn get_action(&self, connection_id: &str, id: u64) -> HetznerResult<HetznerAction> {
        ActionManager::get_action(self.client(connection_id)?, id).await
    }
}
