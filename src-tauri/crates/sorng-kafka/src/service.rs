use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::acls;
use crate::admin::KafkaAdminClient;
use crate::broker;
use crate::connect::KafkaConnectClient;
use crate::consumer_groups;
use crate::error::{KafkaError, KafkaResult};
use crate::metrics;
use crate::partitions;
use crate::producer::KafkaProducerWrapper;
use crate::quotas;
use crate::reassignment;
use crate::schema_registry::SchemaRegistryClient;
use crate::topics;
use crate::types::*;

/// Shared application state for the Kafka service.
pub type KafkaServiceState = Arc<Mutex<KafkaService>>;

/// Create a new shared Kafka service state.
pub fn new_state() -> KafkaServiceState {
    Arc::new(Mutex::new(KafkaService::new()))
}

/// An active connection session to a Kafka cluster.
pub struct KafkaSession {
    config: KafkaConnectionConfig,
    admin: KafkaAdminClient,
    producer: Option<KafkaProducerWrapper>,
    schema_registry: Option<SchemaRegistryClient>,
    connect: Option<KafkaConnectClient>,
    connected_at: DateTime<Utc>,
}

/// Façade that manages Kafka sessions and delegates to subsystem modules.
pub struct KafkaService {
    sessions: HashMap<String, KafkaSession>,
}

impl Default for KafkaService {
    fn default() -> Self {
        Self::new()
    }
}

impl KafkaService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    // -----------------------------------------------------------------------
    // Session management
    // -----------------------------------------------------------------------

    /// Connect to a Kafka cluster and return a session ID.
    pub fn connect(&mut self, config: KafkaConnectionConfig) -> KafkaResult<String> {
        let admin = KafkaAdminClient::create(&config)?;
        // Verify connectivity
        let _ = admin.get_metadata(None)?;

        let schema_registry = config
            .schema_registry_url
            .as_deref()
            .map(SchemaRegistryClient::new);

        let connect = config.connect_url.as_deref().map(KafkaConnectClient::new);

        let session_id = Uuid::new_v4().to_string();
        let session = KafkaSession {
            config,
            admin,
            producer: None,
            schema_registry,
            connect,
            connected_at: Utc::now(),
        };

        self.sessions.insert(session_id.clone(), session);
        log::info!("Kafka session created: {}", session_id);
        Ok(session_id)
    }

    /// Disconnect a session.
    pub fn disconnect(&mut self, session_id: &str) -> KafkaResult<()> {
        self.sessions
            .remove(session_id)
            .ok_or_else(|| KafkaError::session_not_found(session_id))?;
        log::info!("Kafka session disconnected: {}", session_id);
        Ok(())
    }

    /// Test connectivity to a Kafka cluster without creating a session.
    pub fn test_connection(config: &KafkaConnectionConfig) -> KafkaResult<KafkaSession> {
        let admin = KafkaAdminClient::create(config)?;
        let _ = admin.get_metadata(None)?;
        Ok(KafkaSession {
            config: config.clone(),
            admin,
            producer: None,
            schema_registry: None,
            connect: None,
            connected_at: Utc::now(),
        })
    }

    /// List active sessions.
    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        self.sessions
            .iter()
            .map(|(id, s)| SessionSummary {
                session_id: id.clone(),
                bootstrap_servers: s.config.bootstrap_servers.clone(),
                connected_at: s.connected_at,
            })
            .collect()
    }

    /// Get session info.
    pub fn get_session_info(&self, session_id: &str) -> KafkaResult<KafkaSession> {
        let session = self.get_session(session_id)?;
        // We can't clone KafkaSession (admin client isn't Clone),
        // so we return metadata about it instead. This is used internally.
        Ok(KafkaSession {
            config: session.config.clone(),
            admin: KafkaAdminClient::create(&session.config)?,
            producer: None,
            schema_registry: None,
            connect: None,
            connected_at: session.connected_at,
        })
    }

    fn get_session(&self, session_id: &str) -> KafkaResult<&KafkaSession> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| KafkaError::session_not_found(session_id))
    }

    fn get_session_mut(&mut self, session_id: &str) -> KafkaResult<&mut KafkaSession> {
        self.sessions
            .get_mut(session_id)
            .ok_or_else(|| KafkaError::session_not_found(session_id))
    }

    // -----------------------------------------------------------------------
    // Cluster / Broker
    // -----------------------------------------------------------------------

    pub fn list_brokers(&self, session_id: &str) -> KafkaResult<Vec<BrokerInfo>> {
        let session = self.get_session(session_id)?;
        broker::list_brokers(&session.admin)
    }

    pub fn get_broker(&self, session_id: &str, broker_id: i32) -> KafkaResult<BrokerInfo> {
        let session = self.get_session(session_id)?;
        broker::get_broker(&session.admin, broker_id)
    }

    pub async fn get_broker_config(
        &self,
        session_id: &str,
        broker_id: i32,
    ) -> KafkaResult<Vec<TopicConfig>> {
        let session = self.get_session(session_id)?;
        broker::get_broker_config(&session.admin, broker_id).await
    }

    pub async fn update_broker_config(
        &self,
        session_id: &str,
        broker_id: i32,
        configs: &HashMap<String, String>,
    ) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        broker::update_broker_config(&session.admin, broker_id, configs).await
    }

    pub fn get_cluster_id(&self, session_id: &str) -> KafkaResult<Option<String>> {
        let session = self.get_session(session_id)?;
        broker::get_cluster_id(&session.admin)
    }

    // -----------------------------------------------------------------------
    // Topics
    // -----------------------------------------------------------------------

    pub fn list_topics(&self, session_id: &str) -> KafkaResult<Vec<TopicInfo>> {
        let session = self.get_session(session_id)?;
        topics::list_topics(&session.admin)
    }

    pub async fn get_topic(&self, session_id: &str, name: &str) -> KafkaResult<TopicInfo> {
        let session = self.get_session(session_id)?;
        topics::get_topic(&session.admin, name).await
    }

    pub async fn create_topic(
        &self,
        session_id: &str,
        name: &str,
        partitions: i32,
        replication_factor: i32,
        configs: HashMap<String, String>,
    ) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        topics::create_topic(
            &session.admin,
            name,
            partitions,
            replication_factor,
            configs,
        )
        .await
    }

    pub async fn delete_topic(&self, session_id: &str, name: &str) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        topics::delete_topic(&session.admin, name).await
    }

    // -----------------------------------------------------------------------
    // Partitions
    // -----------------------------------------------------------------------

    pub fn list_partitions(
        &self,
        session_id: &str,
        topic: &str,
    ) -> KafkaResult<Vec<PartitionInfo>> {
        let session = self.get_session(session_id)?;
        partitions::list_partitions(&session.admin, topic)
    }

    pub fn get_partition(
        &self,
        session_id: &str,
        topic: &str,
        partition_id: i32,
    ) -> KafkaResult<PartitionInfo> {
        let session = self.get_session(session_id)?;
        partitions::get_partition_info(&session.admin, topic, partition_id)
    }

    // -----------------------------------------------------------------------
    // Consumer groups
    // -----------------------------------------------------------------------

    pub fn list_consumer_groups(&self, session_id: &str) -> KafkaResult<Vec<ConsumerGroupInfo>> {
        let session = self.get_session(session_id)?;
        consumer_groups::list_consumer_groups(&session.admin)
    }

    pub fn describe_consumer_group(
        &self,
        session_id: &str,
        group_id: &str,
    ) -> KafkaResult<ConsumerGroupInfo> {
        let session = self.get_session(session_id)?;
        consumer_groups::describe_consumer_group(&session.admin, group_id)
    }

    pub fn get_consumer_group_offsets(
        &self,
        session_id: &str,
        group_id: &str,
    ) -> KafkaResult<Vec<ConsumerGroupOffset>> {
        let session = self.get_session(session_id)?;
        consumer_groups::get_consumer_group_offsets(&session.admin, group_id)
    }

    // -----------------------------------------------------------------------
    // Producer
    // -----------------------------------------------------------------------

    pub async fn produce_message(
        &mut self,
        session_id: &str,
        message: &ProducerMessage,
    ) -> KafkaResult<ProduceResult> {
        let session = self.get_session_mut(session_id)?;

        if session.producer.is_none() {
            session.producer = Some(KafkaProducerWrapper::create(&session.config)?);
        }

        session.producer.as_mut().unwrap().produce(message).await
    }

    // -----------------------------------------------------------------------
    // ACLs
    // -----------------------------------------------------------------------

    pub async fn list_acls(
        &self,
        session_id: &str,
        filter: &AclFilter,
    ) -> KafkaResult<Vec<AclEntry>> {
        let session = self.get_session(session_id)?;
        acls::list_acls(&session.admin, filter).await
    }

    pub async fn create_acls(&self, session_id: &str, entries: &[AclEntry]) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        acls::create_acls(&session.admin, entries).await
    }

    pub async fn delete_acls(
        &self,
        session_id: &str,
        filters: &[AclFilter],
    ) -> KafkaResult<Vec<AclEntry>> {
        let session = self.get_session(session_id)?;
        acls::delete_acls(&session.admin, filters).await
    }

    // -----------------------------------------------------------------------
    // Schema Registry
    // -----------------------------------------------------------------------

    pub async fn list_subjects(&self, session_id: &str) -> KafkaResult<Vec<String>> {
        let session = self.get_session(session_id)?;
        let sr = session
            .schema_registry
            .as_ref()
            .ok_or_else(|| KafkaError::schema_registry_error("Schema Registry not configured"))?;
        sr.list_subjects().await
    }

    pub async fn get_schema(
        &self,
        session_id: &str,
        subject: &str,
        version: i32,
    ) -> KafkaResult<SchemaInfo> {
        let session = self.get_session(session_id)?;
        let sr = session
            .schema_registry
            .as_ref()
            .ok_or_else(|| KafkaError::schema_registry_error("Schema Registry not configured"))?;
        sr.get_schema(subject, version).await
    }

    pub async fn register_schema(
        &self,
        session_id: &str,
        subject: &str,
        schema: &str,
        schema_type: &SchemaType,
    ) -> KafkaResult<i32> {
        let session = self.get_session(session_id)?;
        let sr = session
            .schema_registry
            .as_ref()
            .ok_or_else(|| KafkaError::schema_registry_error("Schema Registry not configured"))?;
        sr.register_schema(subject, schema, schema_type, None).await
    }

    pub async fn delete_subject(&self, session_id: &str, subject: &str) -> KafkaResult<Vec<i32>> {
        let session = self.get_session(session_id)?;
        let sr = session
            .schema_registry
            .as_ref()
            .ok_or_else(|| KafkaError::schema_registry_error("Schema Registry not configured"))?;
        sr.delete_subject(subject).await
    }

    // -----------------------------------------------------------------------
    // Kafka Connect
    // -----------------------------------------------------------------------

    pub async fn list_connectors(&self, session_id: &str) -> KafkaResult<Vec<String>> {
        let session = self.get_session(session_id)?;
        let kc = session
            .connect
            .as_ref()
            .ok_or_else(|| KafkaError::connect_error("Kafka Connect not configured"))?;
        kc.list_connectors().await
    }

    pub async fn get_connector(&self, session_id: &str, name: &str) -> KafkaResult<ConnectorInfo> {
        let session = self.get_session(session_id)?;
        let kc = session
            .connect
            .as_ref()
            .ok_or_else(|| KafkaError::connect_error("Kafka Connect not configured"))?;
        kc.get_connector(name).await
    }

    pub async fn create_connector(
        &self,
        session_id: &str,
        name: &str,
        config: HashMap<String, String>,
    ) -> KafkaResult<ConnectorInfo> {
        let session = self.get_session(session_id)?;
        let kc = session
            .connect
            .as_ref()
            .ok_or_else(|| KafkaError::connect_error("Kafka Connect not configured"))?;
        kc.create_connector(name, config).await
    }

    pub async fn delete_connector(&self, session_id: &str, name: &str) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        let kc = session
            .connect
            .as_ref()
            .ok_or_else(|| KafkaError::connect_error("Kafka Connect not configured"))?;
        kc.delete_connector(name).await
    }

    pub async fn pause_connector(&self, session_id: &str, name: &str) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        let kc = session
            .connect
            .as_ref()
            .ok_or_else(|| KafkaError::connect_error("Kafka Connect not configured"))?;
        kc.pause_connector(name).await
    }

    pub async fn resume_connector(&self, session_id: &str, name: &str) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        let kc = session
            .connect
            .as_ref()
            .ok_or_else(|| KafkaError::connect_error("Kafka Connect not configured"))?;
        kc.resume_connector(name).await
    }

    // -----------------------------------------------------------------------
    // Quotas
    // -----------------------------------------------------------------------

    pub async fn list_quotas(
        &self,
        session_id: &str,
        entity_type: Option<&QuotaEntityType>,
    ) -> KafkaResult<Vec<QuotaInfo>> {
        let session = self.get_session(session_id)?;
        quotas::list_quotas(&session.admin, entity_type).await
    }

    pub async fn alter_quotas(
        &self,
        session_id: &str,
        entity_type: &QuotaEntityType,
        entity_name: &str,
        quota_values: &HashMap<String, f64>,
    ) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        quotas::alter_quotas(&session.admin, entity_type, entity_name, quota_values).await
    }

    // -----------------------------------------------------------------------
    // Reassignment
    // -----------------------------------------------------------------------

    pub async fn start_reassignment(
        &self,
        session_id: &str,
        proposals: &[ReassignmentProposal],
    ) -> KafkaResult<()> {
        let session = self.get_session(session_id)?;
        reassignment::start_reassignment(&session.admin, proposals).await
    }

    pub async fn list_reassignments(&self, session_id: &str) -> KafkaResult<Vec<ReassignmentInfo>> {
        let session = self.get_session(session_id)?;
        reassignment::list_reassignments(&session.admin).await
    }

    // -----------------------------------------------------------------------
    // Metrics
    // -----------------------------------------------------------------------

    pub fn get_cluster_metrics(&self, session_id: &str) -> KafkaResult<ClusterMetrics> {
        let session = self.get_session(session_id)?;
        metrics::get_cluster_metrics(&session.admin)
    }

    pub fn get_broker_metrics(
        &self,
        session_id: &str,
        broker_id: i32,
    ) -> KafkaResult<BrokerMetrics> {
        let session = self.get_session(session_id)?;
        metrics::get_broker_metrics(&session.admin, broker_id)
    }

    pub fn get_topic_metrics(
        &self,
        session_id: &str,
        topic_name: &str,
    ) -> KafkaResult<TopicMetrics> {
        let session = self.get_session(session_id)?;
        metrics::get_topic_metrics(&session.admin, topic_name)
    }
}

/// Summary of a Kafka session for listing.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub bootstrap_servers: String,
    pub connected_at: DateTime<Utc>,
}
