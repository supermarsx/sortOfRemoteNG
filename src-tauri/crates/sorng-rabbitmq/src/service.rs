use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::RabbitApiClient;
use crate::error::RabbitError;
use crate::types::{
    BindingInfo, ChannelInfo, ClusterName, ClusterNode, ConnectionInfo, ConsumerInfo,
    DefinitionsExport, ExchangeInfo, FederationLink, FederationUpstream, FederationUpstreamDef,
    OverviewInfo, PermissionInfo, PolicyInfo, QueueInfo, RabbitConnectionConfig, RabbitSession,
    ServerInfo, ShovelDefinition, ShovelInfo, UserInfo, VhostInfo,
};

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/// Thread-safe shared state for the Rabbit service.
pub type RabbitServiceState = Arc<Mutex<RabbitService>>;

/// Create a new default service state wrapped in `Arc<Mutex<>>`.
pub fn new_state() -> RabbitServiceState {
    Arc::new(Mutex::new(RabbitService::new()))
}

/// An active session holding a client and its metadata.
struct SessionEntry {
    client: RabbitApiClient,
    config: RabbitConnectionConfig,
    connected_at: chrono::DateTime<chrono::Utc>,
    server_info: Option<ServerInfo>,
}

// ---------------------------------------------------------------------------
// RabbitService
// ---------------------------------------------------------------------------

/// Façade that manages multiple RabbitMQ sessions and delegates operations
/// to the appropriate module functions.
pub struct RabbitService {
    sessions: HashMap<String, SessionEntry>,
}

impl RabbitService {
    /// Create an empty service with no sessions.
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    // -- session management ------------------------------------------------

    /// Connect to a RabbitMQ server and return a session ID.
    pub async fn connect(
        &mut self,
        config: RabbitConnectionConfig,
    ) -> Result<RabbitSession, RabbitError> {
        let client = RabbitApiClient::new(&config)?;

        // Verify connectivity by fetching the overview
        let overview: OverviewInfo = client.get("overview").await?;

        let server_info = Some(ServerInfo {
            rabbitmq_version: overview.rabbitmq_version.unwrap_or_default(),
            erlang_version: overview.erlang_version.unwrap_or_default(),
            cluster_name: overview.cluster_name.unwrap_or_default(),
            node_name: overview.node.unwrap_or_default(),
            product_name: overview.product_name,
            product_version: overview.product_version,
        });

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        let session = RabbitSession {
            id: id.clone(),
            config: config.clone(),
            connected_at: now,
            server_info: server_info.clone(),
        };

        self.sessions.insert(
            id.clone(),
            SessionEntry {
                client,
                config,
                connected_at: now,
                server_info,
            },
        );

        log::info!("RabbitMQ session {} connected", id);
        Ok(session)
    }

    /// Disconnect and remove a session.
    pub fn disconnect(&mut self, session_id: &str) -> Result<(), RabbitError> {
        self.sessions
            .remove(session_id)
            .map(|_| {
                log::info!("RabbitMQ session {} disconnected", session_id);
            })
            .ok_or_else(|| RabbitError::session_not_found(session_id))
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<RabbitSession> {
        self.sessions
            .iter()
            .map(|(id, entry)| RabbitSession {
                id: id.clone(),
                config: entry.config.clone(),
                connected_at: entry.connected_at,
                server_info: entry.server_info.clone(),
            })
            .collect()
    }

    /// Test connectivity for a session by fetching the overview.
    pub async fn test_connection(&self, session_id: &str) -> Result<bool, RabbitError> {
        let client = self.get_client(session_id)?;
        let result: Result<OverviewInfo, _> = client.get("overview").await;
        Ok(result.is_ok())
    }

    /// Get a reference to the client for a session (internal helper).
    fn get_client(&self, session_id: &str) -> Result<&RabbitApiClient, RabbitError> {
        self.sessions
            .get(session_id)
            .map(|entry| &entry.client)
            .ok_or_else(|| RabbitError::session_not_found(session_id))
    }

    // -- vhosts ------------------------------------------------------------

    pub async fn list_vhosts(&self, session_id: &str) -> Result<Vec<VhostInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::vhosts::list_vhosts(client).await
    }

    pub async fn get_vhost(&self, session_id: &str, name: &str) -> Result<VhostInfo, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::vhosts::get_vhost(client, name).await
    }

    pub async fn create_vhost(
        &self,
        session_id: &str,
        name: &str,
        description: Option<&str>,
        tags: Option<&str>,
        default_queue_type: Option<&str>,
        tracing: Option<bool>,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::vhosts::create_vhost(client, name, description, tags, default_queue_type, tracing)
            .await
    }

    pub async fn delete_vhost(&self, session_id: &str, name: &str) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::vhosts::delete_vhost(client, name).await
    }

    // -- exchanges ---------------------------------------------------------

    pub async fn list_exchanges(
        &self,
        session_id: &str,
        vhost: Option<&str>,
    ) -> Result<Vec<ExchangeInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::exchanges::list_exchanges(client, vhost).await
    }

    pub async fn get_exchange(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
    ) -> Result<ExchangeInfo, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::exchanges::get_exchange(client, vhost, name).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_exchange(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
        exchange_type: &str,
        durable: bool,
        auto_delete: bool,
        internal: bool,
        arguments: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::exchanges::create_exchange(
            client,
            vhost,
            name,
            exchange_type,
            durable,
            auto_delete,
            internal,
            arguments,
        )
        .await
    }

    pub async fn delete_exchange(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
        if_unused: bool,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::exchanges::delete_exchange(client, vhost, name, if_unused).await
    }

    // -- queues ------------------------------------------------------------

    pub async fn list_queues(
        &self,
        session_id: &str,
        vhost: Option<&str>,
    ) -> Result<Vec<QueueInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::queues::list_queues(client, vhost).await
    }

    pub async fn get_queue(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
    ) -> Result<QueueInfo, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::queues::get_queue(client, vhost, name).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_queue(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
        durable: bool,
        auto_delete: bool,
        queue_type: Option<&str>,
        arguments: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::queues::create_queue(
            client,
            vhost,
            name,
            durable,
            auto_delete,
            queue_type,
            arguments,
        )
        .await
    }

    pub async fn delete_queue(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
        if_unused: bool,
        if_empty: bool,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::queues::delete_queue(client, vhost, name, if_unused, if_empty).await
    }

    pub async fn purge_queue(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::queues::purge_queue(client, vhost, name).await
    }

    // -- bindings ----------------------------------------------------------

    pub async fn list_bindings(
        &self,
        session_id: &str,
        vhost: Option<&str>,
    ) -> Result<Vec<BindingInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::bindings::list_bindings(client, vhost).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_binding(
        &self,
        session_id: &str,
        vhost: &str,
        source: &str,
        destination: &str,
        dest_type: &str,
        routing_key: &str,
        arguments: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::bindings::create_binding(
            client,
            vhost,
            source,
            destination,
            dest_type,
            routing_key,
            arguments,
        )
        .await
    }

    pub async fn delete_binding(
        &self,
        session_id: &str,
        vhost: &str,
        source: &str,
        destination: &str,
        dest_type: &str,
        properties_key: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::bindings::delete_binding(
            client,
            vhost,
            source,
            destination,
            dest_type,
            properties_key,
        )
        .await
    }

    // -- users -------------------------------------------------------------

    pub async fn list_users(&self, session_id: &str) -> Result<Vec<UserInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::users::list_users(client).await
    }

    pub async fn create_user(
        &self,
        session_id: &str,
        name: &str,
        password: &str,
        tags: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::users::create_user(client, name, password, tags).await
    }

    pub async fn delete_user(&self, session_id: &str, name: &str) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::users::delete_user(client, name).await
    }

    // -- permissions -------------------------------------------------------

    pub async fn list_permissions(
        &self,
        session_id: &str,
    ) -> Result<Vec<PermissionInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::permissions::list_permissions(client).await
    }

    pub async fn set_permission(
        &self,
        session_id: &str,
        vhost: &str,
        user: &str,
        configure: &str,
        write: &str,
        read: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::permissions::set_permission(client, vhost, user, configure, write, read).await
    }

    // -- policies ----------------------------------------------------------

    pub async fn list_policies(
        &self,
        session_id: &str,
        vhost: Option<&str>,
    ) -> Result<Vec<PolicyInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::policies::list_policies(client, vhost).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_policy(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
        pattern: &str,
        definition: serde_json::Value,
        priority: i64,
        apply_to: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::policies::create_policy(client, vhost, name, pattern, definition, priority, apply_to)
            .await
    }

    pub async fn delete_policy(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::policies::delete_policy(client, vhost, name).await
    }

    // -- shovels -----------------------------------------------------------

    pub async fn list_shovels(
        &self,
        session_id: &str,
        vhost: Option<&str>,
    ) -> Result<Vec<ShovelInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::shovels::list_shovels(client, vhost).await
    }

    pub async fn create_shovel(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
        definition: ShovelDefinition,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::shovels::create_shovel(client, vhost, name, definition).await
    }

    pub async fn delete_shovel(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::shovels::delete_shovel(client, vhost, name).await
    }

    pub async fn restart_shovel(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::shovels::restart_shovel(client, vhost, name).await
    }

    // -- federation --------------------------------------------------------

    pub async fn list_federation_upstreams(
        &self,
        session_id: &str,
    ) -> Result<Vec<FederationUpstream>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::federation::list_upstreams(client).await
    }

    pub async fn create_federation_upstream(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
        definition: FederationUpstreamDef,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::federation::create_upstream(client, vhost, name, definition).await
    }

    pub async fn delete_federation_upstream(
        &self,
        session_id: &str,
        vhost: &str,
        name: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::federation::delete_upstream(client, vhost, name).await
    }

    pub async fn list_federation_links(
        &self,
        session_id: &str,
    ) -> Result<Vec<FederationLink>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::federation::list_links(client).await
    }

    // -- cluster -----------------------------------------------------------

    pub async fn list_nodes(&self, session_id: &str) -> Result<Vec<ClusterNode>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::cluster::list_nodes(client).await
    }

    pub async fn get_node(&self, session_id: &str, name: &str) -> Result<ClusterNode, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::cluster::get_node(client, name).await
    }

    pub async fn get_cluster_name(&self, session_id: &str) -> Result<ClusterName, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::cluster::get_cluster_name(client).await
    }

    pub async fn set_cluster_name(&self, session_id: &str, name: &str) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::cluster::set_cluster_name(client, name).await
    }

    pub async fn check_alarms(&self, session_id: &str) -> Result<bool, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::cluster::check_alarms(client).await
    }

    // -- connections -------------------------------------------------------

    pub async fn list_connections(
        &self,
        session_id: &str,
    ) -> Result<Vec<ConnectionInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::connections::list_connections(client).await
    }

    pub async fn get_connection(
        &self,
        session_id: &str,
        name: &str,
    ) -> Result<ConnectionInfo, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::connections::get_connection(client, name).await
    }

    pub async fn close_connection(&self, session_id: &str, name: &str) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::connections::close_connection(client, name).await
    }

    // -- channels ----------------------------------------------------------

    pub async fn list_channels(&self, session_id: &str) -> Result<Vec<ChannelInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::channels::list_channels(client).await
    }

    pub async fn get_channel(
        &self,
        session_id: &str,
        name: &str,
    ) -> Result<ChannelInfo, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::channels::get_channel(client, name).await
    }

    // -- consumers ---------------------------------------------------------

    pub async fn list_consumers(
        &self,
        session_id: &str,
        vhost: Option<&str>,
    ) -> Result<Vec<ConsumerInfo>, RabbitError> {
        let client = self.get_client(session_id)?;
        match vhost {
            Some(v) => crate::consumers::list_consumers_for_vhost(client, v).await,
            None => crate::consumers::list_consumers(client).await,
        }
    }

    pub async fn cancel_consumer(
        &self,
        session_id: &str,
        vhost: &str,
        consumer_tag: &str,
    ) -> Result<bool, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::consumers::cancel_consumer(client, vhost, consumer_tag).await
    }

    // -- monitoring --------------------------------------------------------

    pub async fn get_overview(&self, session_id: &str) -> Result<OverviewInfo, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::monitoring::get_overview(client).await
    }

    pub async fn get_message_rates(
        &self,
        session_id: &str,
    ) -> Result<crate::types::MessageStats, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::monitoring::get_message_rates(client).await
    }

    pub async fn get_queue_rates(
        &self,
        session_id: &str,
        vhost: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::monitoring::get_queue_rates(client, vhost).await
    }

    pub async fn monitoring_snapshot(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::monitoring::monitoring_snapshot(client).await
    }

    pub async fn aliveness_test(
        &self,
        session_id: &str,
        vhost: &str,
    ) -> Result<serde_json::Value, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::monitoring::aliveness_test(client, vhost).await
    }

    // -- definitions -------------------------------------------------------

    pub async fn export_definitions(
        &self,
        session_id: &str,
    ) -> Result<DefinitionsExport, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::definitions::export_definitions(client).await
    }

    pub async fn import_definitions(
        &self,
        session_id: &str,
        definitions: &DefinitionsExport,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::definitions::import_definitions(client, definitions).await
    }

    pub async fn export_vhost_definitions(
        &self,
        session_id: &str,
        vhost: &str,
    ) -> Result<serde_json::Value, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::definitions::export_vhost_definitions(client, vhost).await
    }

    pub async fn clone_vhost(
        &self,
        session_id: &str,
        source_vhost: &str,
        target_vhost: &str,
    ) -> Result<(), RabbitError> {
        let client = self.get_client(session_id)?;
        crate::definitions::clone_vhost(client, source_vhost, target_vhost).await
    }

    pub async fn definitions_summary(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, RabbitError> {
        let client = self.get_client(session_id)?;
        crate::definitions::definitions_summary(client).await
    }
}

impl Default for RabbitService {
    fn default() -> Self {
        Self::new()
    }
}
