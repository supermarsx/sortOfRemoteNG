use crate::client::OciClient;
use crate::compute::ComputeManager;
use crate::containers::ContainerManager;
use crate::database::DatabaseManager;
use crate::error::{OciError, OciResult};
use crate::functions::FunctionsManager;
use crate::identity::IdentityManager;
use crate::monitoring::MonitoringManager;
use crate::networking::NetworkingManager;
use crate::storage::StorageManager;
use crate::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe state type for Tauri managed state.
pub type OciServiceState = Arc<Mutex<OciService>>;

/// Top-level OCI service managing multiple named connections.
pub struct OciService {
    connections: HashMap<String, OciClient>,
}

impl OciService {
    pub fn new() -> OciServiceState {
        Arc::new(Mutex::new(Self {
            connections: HashMap::new(),
        }))
    }

    fn client(&self, connection_id: &str) -> OciResult<&OciClient> {
        self.connections
            .get(connection_id)
            .ok_or_else(|| OciError::not_connected(format!("No connection: {connection_id}")))
    }

    // ── Connection management ────────────────────────────────────────

    pub async fn connect(
        &mut self,
        connection_id: String,
        config: OciConnectionConfig,
    ) -> OciResult<OciConnectionSummary> {
        let client = OciClient::new(config)?;
        let summary = OciConnectionSummary {
            region: client.config.region.clone(),
            tenancy_ocid: client.config.tenancy_ocid.clone(),
            user_ocid: client.config.user_ocid.clone(),
            compartment_id: client.config.compartment_id.clone(),
        };
        self.connections.insert(connection_id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, connection_id: &str) -> OciResult<()> {
        self.connections
            .remove(connection_id)
            .map(|_| ())
            .ok_or_else(|| OciError::not_connected(format!("No connection: {connection_id}")))
    }

    pub fn list_connections(&self) -> Vec<OciConnectionSummary> {
        self.connections
            .values()
            .map(|c| OciConnectionSummary {
                region: c.config.region.clone(),
                tenancy_ocid: c.config.tenancy_ocid.clone(),
                user_ocid: c.config.user_ocid.clone(),
                compartment_id: c.config.compartment_id.clone(),
            })
            .collect()
    }

    pub async fn ping(&self, connection_id: &str) -> OciResult<()> {
        self.client(connection_id)?.ping().await
    }

    // ── Dashboard ────────────────────────────────────────────────────

    pub async fn get_dashboard(&self, connection_id: &str) -> OciResult<OciDashboard> {
        let client = self.client(connection_id)?;
        let cid = client.compartment_id();

        let instances: Vec<OciInstance> = ComputeManager::list_instances(client, cid)
            .await
            .unwrap_or_default();
        let running = instances
            .iter()
            .filter(|i| i.lifecycle_state == "RUNNING")
            .count() as u64;
        let vcns: Vec<OciVcn> = NetworkingManager::list_vcns(client, cid)
            .await
            .unwrap_or_default();
        let subnets: Vec<OciSubnet> = NetworkingManager::list_subnets(client, cid, None)
            .await
            .unwrap_or_default();
        let volumes: Vec<OciBlockVolume> = StorageManager::list_block_volumes(client, cid, None)
            .await
            .unwrap_or_default();
        let compartments: Vec<OciCompartment> = IdentityManager::list_compartments(client, cid)
            .await
            .unwrap_or_default();
        let autonomous_dbs: Vec<OciAutonomousDb> =
            DatabaseManager::list_autonomous_dbs(client, cid)
                .await
                .unwrap_or_default();

        Ok(OciDashboard {
            region: client.config.region.clone(),
            total_instances: instances.len() as u64,
            running_instances: running,
            total_vcns: vcns.len() as u64,
            total_subnets: subnets.len() as u64,
            total_volumes: volumes.len() as u64,
            total_buckets: 0,
            total_autonomous_dbs: autonomous_dbs.len() as u64,
            total_compartments: compartments.len() as u64,
            recent_audit_events: vec![],
        })
    }

    // ── Compute ──────────────────────────────────────────────────────

    pub async fn list_instances(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciInstance>> {
        ComputeManager::list_instances(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_instance(
        &self,
        connection_id: &str,
        instance_id: &str,
    ) -> OciResult<OciInstance> {
        ComputeManager::get_instance(self.client(connection_id)?, instance_id).await
    }

    pub async fn launch_instance(
        &self,
        connection_id: &str,
        request: &LaunchInstanceRequest,
    ) -> OciResult<OciInstance> {
        ComputeManager::launch_instance(self.client(connection_id)?, request).await
    }

    pub async fn terminate_instance(
        &self,
        connection_id: &str,
        instance_id: &str,
    ) -> OciResult<()> {
        ComputeManager::terminate_instance(self.client(connection_id)?, instance_id).await
    }

    pub async fn start_instance(
        &self,
        connection_id: &str,
        instance_id: &str,
    ) -> OciResult<OciInstance> {
        ComputeManager::start_instance(self.client(connection_id)?, instance_id).await
    }

    pub async fn stop_instance(
        &self,
        connection_id: &str,
        instance_id: &str,
    ) -> OciResult<OciInstance> {
        ComputeManager::stop_instance(self.client(connection_id)?, instance_id).await
    }

    pub async fn reboot_instance(
        &self,
        connection_id: &str,
        instance_id: &str,
    ) -> OciResult<OciInstance> {
        ComputeManager::reboot_instance(self.client(connection_id)?, instance_id).await
    }

    pub async fn list_shapes(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciShape>> {
        ComputeManager::list_shapes(self.client(connection_id)?, compartment_id).await
    }

    pub async fn list_images(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciImage>> {
        ComputeManager::list_images(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_image(
        &self,
        connection_id: &str,
        image_id: &str,
    ) -> OciResult<OciImage> {
        ComputeManager::get_image(self.client(connection_id)?, image_id).await
    }

    // ── Networking ───────────────────────────────────────────────────

    pub async fn list_vcns(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciVcn>> {
        NetworkingManager::list_vcns(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_vcn(&self, connection_id: &str, vcn_id: &str) -> OciResult<OciVcn> {
        NetworkingManager::get_vcn(self.client(connection_id)?, vcn_id).await
    }

    pub async fn create_vcn(
        &self,
        connection_id: &str,
        compartment_id: &str,
        display_name: &str,
        cidr_block: &str,
    ) -> OciResult<OciVcn> {
        NetworkingManager::create_vcn(
            self.client(connection_id)?,
            compartment_id,
            display_name,
            cidr_block,
        )
        .await
    }

    pub async fn delete_vcn(&self, connection_id: &str, vcn_id: &str) -> OciResult<()> {
        NetworkingManager::delete_vcn(self.client(connection_id)?, vcn_id).await
    }

    pub async fn list_subnets(
        &self,
        connection_id: &str,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciSubnet>> {
        NetworkingManager::list_subnets(self.client(connection_id)?, compartment_id, vcn_id).await
    }

    pub async fn get_subnet(
        &self,
        connection_id: &str,
        subnet_id: &str,
    ) -> OciResult<OciSubnet> {
        NetworkingManager::get_subnet(self.client(connection_id)?, subnet_id).await
    }

    pub async fn create_subnet(
        &self,
        connection_id: &str,
        body: &serde_json::Value,
    ) -> OciResult<OciSubnet> {
        NetworkingManager::create_subnet(self.client(connection_id)?, body).await
    }

    pub async fn delete_subnet(
        &self,
        connection_id: &str,
        subnet_id: &str,
    ) -> OciResult<()> {
        NetworkingManager::delete_subnet(self.client(connection_id)?, subnet_id).await
    }

    pub async fn list_security_lists(
        &self,
        connection_id: &str,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciSecurityList>> {
        NetworkingManager::list_security_lists(
            self.client(connection_id)?,
            compartment_id,
            vcn_id,
        )
        .await
    }

    pub async fn get_security_list(
        &self,
        connection_id: &str,
        security_list_id: &str,
    ) -> OciResult<OciSecurityList> {
        NetworkingManager::get_security_list(self.client(connection_id)?, security_list_id).await
    }

    pub async fn list_route_tables(
        &self,
        connection_id: &str,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciRouteTable>> {
        NetworkingManager::list_route_tables(self.client(connection_id)?, compartment_id, vcn_id)
            .await
    }

    pub async fn list_internet_gateways(
        &self,
        connection_id: &str,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciInternetGateway>> {
        NetworkingManager::list_internet_gateways(
            self.client(connection_id)?,
            compartment_id,
            vcn_id,
        )
        .await
    }

    pub async fn list_nat_gateways(
        &self,
        connection_id: &str,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciNatGateway>> {
        NetworkingManager::list_nat_gateways(self.client(connection_id)?, compartment_id, vcn_id)
            .await
    }

    pub async fn list_load_balancers(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciLoadBalancer>> {
        NetworkingManager::list_load_balancers(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_load_balancer(
        &self,
        connection_id: &str,
        lb_id: &str,
    ) -> OciResult<OciLoadBalancer> {
        NetworkingManager::get_load_balancer(self.client(connection_id)?, lb_id).await
    }

    // ── Storage ──────────────────────────────────────────────────────

    pub async fn list_block_volumes(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciBlockVolume>> {
        StorageManager::list_block_volumes(self.client(connection_id)?, compartment_id, None).await
    }

    pub async fn get_block_volume(
        &self,
        connection_id: &str,
        volume_id: &str,
    ) -> OciResult<OciBlockVolume> {
        StorageManager::get_block_volume(self.client(connection_id)?, volume_id).await
    }

    pub async fn create_block_volume(
        &self,
        connection_id: &str,
        compartment_id: &str,
        availability_domain: &str,
        display_name: &str,
        size_in_gbs: u64,
    ) -> OciResult<OciBlockVolume> {
        StorageManager::create_block_volume(
            self.client(connection_id)?,
            compartment_id,
            availability_domain,
            display_name,
            size_in_gbs,
        )
        .await
    }

    pub async fn delete_block_volume(
        &self,
        connection_id: &str,
        volume_id: &str,
    ) -> OciResult<()> {
        StorageManager::delete_block_volume(self.client(connection_id)?, volume_id).await
    }

    pub async fn list_buckets(
        &self,
        connection_id: &str,
        namespace: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciBucket>> {
        StorageManager::list_buckets(self.client(connection_id)?, namespace, compartment_id).await
    }

    pub async fn get_bucket(
        &self,
        connection_id: &str,
        namespace: &str,
        bucket_name: &str,
    ) -> OciResult<OciBucket> {
        StorageManager::get_bucket(self.client(connection_id)?, namespace, bucket_name).await
    }

    pub async fn create_bucket(
        &self,
        connection_id: &str,
        namespace: &str,
        compartment_id: &str,
        bucket_name: &str,
    ) -> OciResult<OciBucket> {
        StorageManager::create_bucket(
            self.client(connection_id)?,
            namespace,
            compartment_id,
            bucket_name,
        )
        .await
    }

    pub async fn delete_bucket(
        &self,
        connection_id: &str,
        namespace: &str,
        bucket_name: &str,
    ) -> OciResult<()> {
        StorageManager::delete_bucket(self.client(connection_id)?, namespace, bucket_name).await
    }

    pub async fn list_objects(
        &self,
        connection_id: &str,
        namespace: &str,
        bucket_name: &str,
        prefix: Option<&str>,
    ) -> OciResult<Vec<OciObject>> {
        StorageManager::list_objects(self.client(connection_id)?, namespace, bucket_name, prefix)
            .await
    }

    // ── Identity / IAM ───────────────────────────────────────────────

    pub async fn list_compartments(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciCompartment>> {
        IdentityManager::list_compartments(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_compartment(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<OciCompartment> {
        IdentityManager::get_compartment(self.client(connection_id)?, compartment_id).await
    }

    pub async fn create_compartment(
        &self,
        connection_id: &str,
        parent_compartment_id: &str,
        name: &str,
        description: &str,
    ) -> OciResult<OciCompartment> {
        IdentityManager::create_compartment(
            self.client(connection_id)?,
            parent_compartment_id,
            name,
            description,
        )
        .await
    }

    pub async fn list_users(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciUser>> {
        IdentityManager::list_users(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_user(
        &self,
        connection_id: &str,
        user_id: &str,
    ) -> OciResult<OciUser> {
        IdentityManager::get_user(self.client(connection_id)?, user_id).await
    }

    pub async fn create_user(
        &self,
        connection_id: &str,
        compartment_id: &str,
        name: &str,
        description: &str,
        email: Option<&str>,
    ) -> OciResult<OciUser> {
        IdentityManager::create_user(
            self.client(connection_id)?,
            compartment_id,
            name,
            description,
            email,
        )
        .await
    }

    pub async fn delete_user(
        &self,
        connection_id: &str,
        user_id: &str,
    ) -> OciResult<()> {
        IdentityManager::delete_user(self.client(connection_id)?, user_id).await
    }

    pub async fn list_groups(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciGroup>> {
        IdentityManager::list_groups(self.client(connection_id)?, compartment_id).await
    }

    pub async fn list_policies(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciPolicy>> {
        IdentityManager::list_policies(self.client(connection_id)?, compartment_id).await
    }

    // ── Database ─────────────────────────────────────────────────────

    pub async fn list_db_systems(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciDbSystem>> {
        DatabaseManager::list_db_systems(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_db_system(
        &self,
        connection_id: &str,
        db_system_id: &str,
    ) -> OciResult<OciDbSystem> {
        DatabaseManager::get_db_system(self.client(connection_id)?, db_system_id).await
    }

    pub async fn list_autonomous_dbs(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciAutonomousDb>> {
        DatabaseManager::list_autonomous_dbs(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_autonomous_db(
        &self,
        connection_id: &str,
        autonomous_db_id: &str,
    ) -> OciResult<OciAutonomousDb> {
        DatabaseManager::get_autonomous_db(self.client(connection_id)?, autonomous_db_id).await
    }

    pub async fn create_autonomous_db(
        &self,
        connection_id: &str,
        body: &serde_json::Value,
    ) -> OciResult<OciAutonomousDb> {
        DatabaseManager::create_autonomous_db(self.client(connection_id)?, body).await
    }

    pub async fn start_autonomous_db(
        &self,
        connection_id: &str,
        autonomous_db_id: &str,
    ) -> OciResult<OciAutonomousDb> {
        DatabaseManager::start_autonomous_db(self.client(connection_id)?, autonomous_db_id).await
    }

    pub async fn stop_autonomous_db(
        &self,
        connection_id: &str,
        autonomous_db_id: &str,
    ) -> OciResult<OciAutonomousDb> {
        DatabaseManager::stop_autonomous_db(self.client(connection_id)?, autonomous_db_id).await
    }

    // ── Containers / OKE ─────────────────────────────────────────────

    pub async fn list_container_instances(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciContainerInstance>> {
        ContainerManager::list_container_instances(self.client(connection_id)?, compartment_id)
            .await
    }

    pub async fn list_oke_clusters(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OkeCluster>> {
        ContainerManager::list_oke_clusters(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_oke_cluster(
        &self,
        connection_id: &str,
        cluster_id: &str,
    ) -> OciResult<OkeCluster> {
        ContainerManager::get_oke_cluster(self.client(connection_id)?, cluster_id).await
    }

    pub async fn list_node_pools(
        &self,
        connection_id: &str,
        compartment_id: &str,
        cluster_id: Option<&str>,
    ) -> OciResult<Vec<OkeNodePool>> {
        ContainerManager::list_node_pools(
            self.client(connection_id)?,
            compartment_id,
            cluster_id,
        )
        .await
    }

    // ── Functions ────────────────────────────────────────────────────

    pub async fn list_applications(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciFunctionApplication>> {
        FunctionsManager::list_applications(self.client(connection_id)?, compartment_id).await
    }

    pub async fn list_functions(
        &self,
        connection_id: &str,
        application_id: &str,
    ) -> OciResult<Vec<OciFunction>> {
        FunctionsManager::list_functions(self.client(connection_id)?, application_id).await
    }

    pub async fn get_function(
        &self,
        connection_id: &str,
        function_id: &str,
    ) -> OciResult<OciFunction> {
        FunctionsManager::get_function(self.client(connection_id)?, function_id).await
    }

    pub async fn invoke_function(
        &self,
        connection_id: &str,
        function_id: &str,
        payload: &serde_json::Value,
    ) -> OciResult<serde_json::Value> {
        FunctionsManager::invoke_function(self.client(connection_id)?, function_id, payload).await
    }

    // ── Monitoring ───────────────────────────────────────────────────

    pub async fn list_alarms(
        &self,
        connection_id: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciAlarm>> {
        MonitoringManager::list_alarms(self.client(connection_id)?, compartment_id).await
    }

    pub async fn get_alarm(
        &self,
        connection_id: &str,
        alarm_id: &str,
    ) -> OciResult<OciAlarm> {
        MonitoringManager::get_alarm(self.client(connection_id)?, alarm_id).await
    }

    pub async fn query_metrics(
        &self,
        connection_id: &str,
        compartment_id: &str,
        query: &str,
        namespace: &str,
    ) -> OciResult<Vec<OciMetricData>> {
        MonitoringManager::query_metrics(
            self.client(connection_id)?,
            compartment_id,
            query,
            namespace,
        )
        .await
    }

    pub async fn list_audit_events(
        &self,
        connection_id: &str,
        compartment_id: &str,
        start_time: &str,
        end_time: &str,
    ) -> OciResult<Vec<OciAuditEvent>> {
        MonitoringManager::list_audit_events(
            self.client(connection_id)?,
            compartment_id,
            start_time,
            end_time,
        )
        .await
    }
}
