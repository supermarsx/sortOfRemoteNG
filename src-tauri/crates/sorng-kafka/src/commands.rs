use std::collections::HashMap;

use tauri::State;

use crate::error::{KafkaError, KafkaResult};
use crate::service::KafkaServiceState;
use crate::types::*;

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_connect(
    state: State<'_, KafkaServiceState>,
    config: KafkaConnectionConfig,
) -> Result<String, KafkaError> {
    let mut svc = state.lock().await;
    svc.connect(config)
}

#[tauri::command]
pub async fn kafka_disconnect(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<(), KafkaError> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id)
}

#[tauri::command]
pub async fn kafka_test_connection(
    config: KafkaConnectionConfig,
) -> Result<bool, KafkaError> {
    crate::service::KafkaService::test_connection(&config)?;
    Ok(true)
}

#[tauri::command]
pub async fn kafka_list_sessions(
    state: State<'_, KafkaServiceState>,
) -> Result<Vec<crate::service::SessionSummary>, KafkaError> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

// ---------------------------------------------------------------------------
// Brokers
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_brokers(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<Vec<BrokerInfo>, KafkaError> {
    let svc = state.lock().await;
    svc.list_brokers(&session_id)
}

#[tauri::command]
pub async fn kafka_get_broker(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    broker_id: i32,
) -> Result<BrokerInfo, KafkaError> {
    let svc = state.lock().await;
    svc.get_broker(&session_id, broker_id)
}

#[tauri::command]
pub async fn kafka_get_broker_config(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    broker_id: i32,
) -> Result<Vec<TopicConfig>, KafkaError> {
    let svc = state.lock().await;
    svc.get_broker_config(&session_id, broker_id).await
}

#[tauri::command]
pub async fn kafka_update_broker_config(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    broker_id: i32,
    configs: HashMap<String, String>,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.update_broker_config(&session_id, broker_id, &configs).await
}

#[tauri::command]
pub async fn kafka_get_cluster_id(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<Option<String>, KafkaError> {
    let svc = state.lock().await;
    svc.get_cluster_id(&session_id)
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_topics(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<Vec<TopicInfo>, KafkaError> {
    let svc = state.lock().await;
    svc.list_topics(&session_id)
}

#[tauri::command]
pub async fn kafka_get_topic(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
) -> Result<TopicInfo, KafkaError> {
    let svc = state.lock().await;
    svc.get_topic(&session_id, &name).await
}

#[tauri::command]
pub async fn kafka_create_topic(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
    partitions: i32,
    replication_factor: i32,
    configs: HashMap<String, String>,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.create_topic(&session_id, &name, partitions, replication_factor, configs)
        .await
}

#[tauri::command]
pub async fn kafka_delete_topic(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.delete_topic(&session_id, &name).await
}

// ---------------------------------------------------------------------------
// Partitions
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_partitions(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    topic: String,
) -> Result<Vec<PartitionInfo>, KafkaError> {
    let svc = state.lock().await;
    svc.list_partitions(&session_id, &topic)
}

#[tauri::command]
pub async fn kafka_get_partition(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    topic: String,
    partition_id: i32,
) -> Result<PartitionInfo, KafkaError> {
    let svc = state.lock().await;
    svc.get_partition(&session_id, &topic, partition_id)
}

// ---------------------------------------------------------------------------
// Consumer Groups
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_consumer_groups(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<Vec<ConsumerGroupInfo>, KafkaError> {
    let svc = state.lock().await;
    svc.list_consumer_groups(&session_id)
}

#[tauri::command]
pub async fn kafka_describe_consumer_group(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    group_id: String,
) -> Result<ConsumerGroupInfo, KafkaError> {
    let svc = state.lock().await;
    svc.describe_consumer_group(&session_id, &group_id)
}

#[tauri::command]
pub async fn kafka_get_consumer_group_offsets(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    group_id: String,
) -> Result<Vec<ConsumerGroupOffset>, KafkaError> {
    let svc = state.lock().await;
    svc.get_consumer_group_offsets(&session_id, &group_id)
}

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_produce_message(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    message: ProducerMessage,
) -> Result<ProduceResult, KafkaError> {
    let mut svc = state.lock().await;
    svc.produce_message(&session_id, &message).await
}

// ---------------------------------------------------------------------------
// ACLs
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_acls(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    filter: AclFilter,
) -> Result<Vec<AclEntry>, KafkaError> {
    let svc = state.lock().await;
    svc.list_acls(&session_id, &filter).await
}

#[tauri::command]
pub async fn kafka_create_acls(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    entries: Vec<AclEntry>,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.create_acls(&session_id, &entries).await
}

#[tauri::command]
pub async fn kafka_delete_acls(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    filters: Vec<AclFilter>,
) -> Result<Vec<AclEntry>, KafkaError> {
    let svc = state.lock().await;
    svc.delete_acls(&session_id, &filters).await
}

// ---------------------------------------------------------------------------
// Schema Registry
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_subjects(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<Vec<String>, KafkaError> {
    let svc = state.lock().await;
    svc.list_subjects(&session_id).await
}

#[tauri::command]
pub async fn kafka_get_schema(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    subject: String,
    version: i32,
) -> Result<SchemaInfo, KafkaError> {
    let svc = state.lock().await;
    svc.get_schema(&session_id, &subject, version).await
}

#[tauri::command]
pub async fn kafka_register_schema(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    subject: String,
    schema: String,
    schema_type: SchemaType,
) -> Result<i32, KafkaError> {
    let svc = state.lock().await;
    svc.register_schema(&session_id, &subject, &schema, &schema_type)
        .await
}

#[tauri::command]
pub async fn kafka_delete_subject(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    subject: String,
) -> Result<Vec<i32>, KafkaError> {
    let svc = state.lock().await;
    svc.delete_subject(&session_id, &subject).await
}

// ---------------------------------------------------------------------------
// Kafka Connect
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_connectors(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<Vec<String>, KafkaError> {
    let svc = state.lock().await;
    svc.list_connectors(&session_id).await
}

#[tauri::command]
pub async fn kafka_get_connector(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
) -> Result<ConnectorInfo, KafkaError> {
    let svc = state.lock().await;
    svc.get_connector(&session_id, &name).await
}

#[tauri::command]
pub async fn kafka_create_connector(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
    config: HashMap<String, String>,
) -> Result<ConnectorInfo, KafkaError> {
    let svc = state.lock().await;
    svc.create_connector(&session_id, &name, config).await
}

#[tauri::command]
pub async fn kafka_delete_connector(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.delete_connector(&session_id, &name).await
}

#[tauri::command]
pub async fn kafka_pause_connector(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.pause_connector(&session_id, &name).await
}

#[tauri::command]
pub async fn kafka_resume_connector(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    name: String,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.resume_connector(&session_id, &name).await
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_list_quotas(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    entity_type: Option<QuotaEntityType>,
) -> Result<Vec<QuotaInfo>, KafkaError> {
    let svc = state.lock().await;
    svc.list_quotas(&session_id, entity_type.as_ref()).await
}

#[tauri::command]
pub async fn kafka_alter_quotas(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    entity_type: QuotaEntityType,
    entity_name: String,
    quotas: HashMap<String, f64>,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.alter_quotas(&session_id, &entity_type, &entity_name, &quotas)
        .await
}

// ---------------------------------------------------------------------------
// Reassignment
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_start_reassignment(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    proposals: Vec<ReassignmentProposal>,
) -> Result<(), KafkaError> {
    let svc = state.lock().await;
    svc.start_reassignment(&session_id, &proposals).await
}

#[tauri::command]
pub async fn kafka_list_reassignments(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<Vec<ReassignmentInfo>, KafkaError> {
    let svc = state.lock().await;
    svc.list_reassignments(&session_id).await
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kafka_get_cluster_metrics(
    state: State<'_, KafkaServiceState>,
    session_id: String,
) -> Result<ClusterMetrics, KafkaError> {
    let svc = state.lock().await;
    svc.get_cluster_metrics(&session_id)
}

#[tauri::command]
pub async fn kafka_get_broker_metrics(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    broker_id: i32,
) -> Result<BrokerMetrics, KafkaError> {
    let svc = state.lock().await;
    svc.get_broker_metrics(&session_id, broker_id)
}

#[tauri::command]
pub async fn kafka_get_topic_metrics(
    state: State<'_, KafkaServiceState>,
    session_id: String,
    topic_name: String,
) -> Result<TopicMetrics, KafkaError> {
    let svc = state.lock().await;
    svc.get_topic_metrics(&session_id, &topic_name)
}
