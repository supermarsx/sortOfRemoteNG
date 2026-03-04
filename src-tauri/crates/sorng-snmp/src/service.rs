//! # SNMP Service Facade
//!
//! Central service struct wrapping all SNMP sub-systems.  Stored as Tauri
//! managed state via the `SnmpServiceState` type alias.

use crate::client::SnmpClient;
use crate::discovery;
use crate::error::SnmpResult;
use crate::ifmib;
use crate::mib::MibDatabase;
use crate::monitor::MonitorEngine;
use crate::system_info;
use crate::trap::TrapReceiver;
use crate::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe reference counted handle for Tauri state management.
pub type SnmpServiceState = Arc<Mutex<SnmpService>>;

/// Top-level SNMP service that owns all sub-systems.
pub struct SnmpService {
    /// Underlying SNMP client for packet I/O.
    client: SnmpClient,
    /// MIB database for OID resolution.
    mib_db: MibDatabase,
    /// Trap receiver.
    trap_receiver: TrapReceiver,
    /// Monitor engine.
    monitor_engine: Arc<Mutex<MonitorEngine>>,
    /// Known devices by host key.
    devices: HashMap<String, SnmpDevice>,
    /// Saved targets by name.
    targets: HashMap<String, SnmpTarget>,
    /// Saved USM users by ID.
    usm_users: HashMap<String, UsmUser>,
    /// Total requests counter.
    total_requests: u64,
}

impl SnmpService {
    /// Create a new SNMP service with defaults.
    pub fn new() -> Self {
        Self {
            client: SnmpClient::new(),
            mib_db: MibDatabase::new(),
            trap_receiver: TrapReceiver::new(TrapReceiverConfig::default()),
            monitor_engine: Arc::new(Mutex::new(MonitorEngine::new())),
            devices: HashMap::new(),
            targets: HashMap::new(),
            usm_users: HashMap::new(),
            total_requests: 0,
        }
    }

    // ------- Client accessors -------

    pub fn client(&self) -> &SnmpClient {
        &self.client
    }

    // ------- Target management -------

    pub fn add_target(&mut self, name: String, target: SnmpTarget) {
        self.targets.insert(name, target);
    }

    pub fn remove_target(&mut self, name: &str) -> bool {
        self.targets.remove(name).is_some()
    }

    pub fn get_target(&self, name: &str) -> Option<&SnmpTarget> {
        self.targets.get(name)
    }

    pub fn list_targets(&self) -> Vec<(String, SnmpTarget)> {
        self.targets.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    // ------- USM user management -------

    pub fn add_usm_user(&mut self, user: UsmUser) {
        self.usm_users.insert(user.id.clone(), user);
    }

    pub fn remove_usm_user(&mut self, user_id: &str) -> bool {
        self.usm_users.remove(user_id).is_some()
    }

    pub fn list_usm_users(&self) -> Vec<&UsmUser> {
        self.usm_users.values().collect()
    }

    // ------- GET / WALK / SET -------

    pub async fn snmp_get(
        &mut self,
        target: &SnmpTarget,
        oids: &[String],
    ) -> SnmpResult<SnmpResponse> {
        self.total_requests += 1;
        self.client.get(target, oids).await
    }

    pub async fn snmp_get_next(
        &mut self,
        target: &SnmpTarget,
        oids: &[String],
    ) -> SnmpResult<SnmpResponse> {
        self.total_requests += 1;
        self.client.get_next(target, oids).await
    }

    pub async fn snmp_get_bulk(
        &mut self,
        target: &SnmpTarget,
        oids: &[String],
        non_repeaters: i32,
        max_repetitions: i32,
    ) -> SnmpResult<SnmpResponse> {
        self.total_requests += 1;
        self.client.get_bulk(target, oids, non_repeaters, max_repetitions).await
    }

    pub async fn snmp_set(
        &mut self,
        target: &SnmpTarget,
        varbinds: &[(String, SnmpValue)],
    ) -> SnmpResult<SnmpResponse> {
        self.total_requests += 1;
        self.client.set(target, varbinds).await
    }

    pub async fn snmp_walk(
        &mut self,
        target: &SnmpTarget,
        root_oid: &str,
    ) -> SnmpResult<WalkResult> {
        self.total_requests += 1;
        crate::walk::walk(&self.client, target, root_oid).await
    }

    // ------- Table -------

    pub async fn snmp_get_table(
        &mut self,
        target: &SnmpTarget,
        table_oid: &str,
    ) -> SnmpResult<SnmpTable> {
        self.total_requests += 1;
        crate::table::get_table(&self.client, target, table_oid, &[]).await
    }

    pub async fn snmp_get_if_table(
        &mut self,
        target: &SnmpTarget,
    ) -> SnmpResult<SnmpTable> {
        self.total_requests += 1;
        crate::table::get_if_table(&self.client, target).await
    }

    // ------- System info -------

    pub async fn get_system_info(
        &mut self,
        target: &SnmpTarget,
    ) -> SnmpResult<SnmpDevice> {
        self.total_requests += 1;
        system_info::get_system_info(&self.client, target).await
    }

    // ------- IF-MIB -------

    pub async fn get_interfaces(
        &mut self,
        target: &SnmpTarget,
    ) -> SnmpResult<Vec<InterfaceInfo>> {
        self.total_requests += 1;
        ifmib::get_interfaces(&self.client, target).await
    }

    // ------- Trap receiver -------

    pub async fn start_trap_receiver(&mut self) -> SnmpResult<()> {
        self.trap_receiver.start().await
    }

    pub fn stop_trap_receiver(&mut self) {
        self.trap_receiver.stop();
    }

    pub fn get_trap_receiver_status(&self) -> TrapReceiverStatus {
        self.trap_receiver.status()
    }

    pub fn get_traps(&self, limit: Option<usize>) -> Vec<SnmpTrap> {
        let all = self.trap_receiver.get_traps();
        match limit {
            Some(n) => all.iter().rev().take(n).cloned().collect(),
            None => all.to_vec(),
        }
    }

    pub fn clear_traps(&mut self) {
        self.trap_receiver.clear_buffer();
    }

    // ------- MIB database -------

    pub fn mib_resolve_oid(&self, oid: &str) -> Option<String> {
        self.mib_db.resolve_oid(oid)
    }

    pub fn mib_resolve_name(&self, name: &str) -> Option<String> {
        self.mib_db.resolve_name(name)
    }

    pub fn mib_search(&self, query: &str) -> Vec<OidMapping> {
        self.mib_db.search(query).into_iter().cloned().collect()
    }

    pub fn mib_load_text(&mut self, text: &str) -> SnmpResult<String> {
        self.mib_db.load_mib_text(text)
    }

    pub fn mib_get_subtree(&self, oid: &str) -> Vec<OidMapping> {
        self.mib_db.get_subtree(oid).into_iter().cloned().collect()
    }

    // ------- Monitor engine -------

    pub fn monitor_engine(&self) -> Arc<Mutex<MonitorEngine>> {
        Arc::clone(&self.monitor_engine)
    }

    // ------- Discovery -------

    pub async fn discover_subnet(
        &self,
        config: DiscoveryConfig,
    ) -> SnmpResult<DiscoveryResult> {
        discovery::discover(&config).await
    }

    // ------- Device inventory -------

    pub fn add_device(&mut self, device: SnmpDevice) {
        let key = format!("{}:{}", device.host, device.port);
        self.devices.insert(key, device);
    }

    pub fn remove_device(&mut self, host: &str, port: u16) -> bool {
        let key = format!("{}:{}", host, port);
        self.devices.remove(&key).is_some()
    }

    pub fn get_device(&self, host: &str, port: u16) -> Option<&SnmpDevice> {
        let key = format!("{}:{}", host, port);
        self.devices.get(&key)
    }

    pub fn list_devices(&self) -> Vec<&SnmpDevice> {
        self.devices.values().collect()
    }

    // ------- Status -------

    pub fn status(&self) -> SnmpServiceStatus {
        SnmpServiceStatus {
            total_requests: self.total_requests,
            active_monitors: 0,
            trap_receiver: self.trap_receiver.status(),
            loaded_mibs: self.mib_db.mapping_count() as u32,
            usm_users: self.usm_users.len() as u32,
            discovered_devices: self.devices.len() as u32,
        }
    }
}
