//! Tauri command bindings for the GCP crate.
//!
//! Every `#[tauri::command]` declared here is registered in the main app's
//! command handler. Commands take `tauri::State<'_, GcpServiceState>` and
//! delegate to `GcpService` methods.

use crate::compute;
use crate::config::{GcpConnectionConfig, GcpSession};
use crate::dns;
use crate::functions;
use crate::gke;
use crate::iam;
use crate::logging;
use crate::monitoring;
use crate::pubsub;
use crate::run;
use crate::secrets;
use crate::service::GcpServiceState;
use crate::sql;
use crate::storage;

// ═══════════════════════════════════════════════════════════════════════
//  Session management
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn connect_gcp(
    state: tauri::State<'_, GcpServiceState>,
    config: GcpConnectionConfig,
) -> Result<String, String> {
    let mut gcp = state.lock().await;
    gcp.connect_gcp(config).await
}

#[tauri::command]
pub async fn disconnect_gcp(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut gcp = state.lock().await;
    gcp.disconnect_gcp(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_sessions(
    state: tauri::State<'_, GcpServiceState>,
) -> Result<Vec<GcpSession>, String> {
    let gcp = state.lock().await;
    Ok(gcp.list_gcp_sessions())
}

#[tauri::command]
pub async fn get_gcp_session(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<GcpSession, String> {
    let gcp = state.lock().await;
    gcp.get_gcp_session(&session_id)
        .ok_or_else(|| format!("GCP session {} not found", session_id))
}

// ═══════════════════════════════════════════════════════════════════════
//  Compute Engine
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_instances(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    zone: Option<String>,
) -> Result<Vec<compute::Instance>, String> {
    let mut gcp = state.lock().await;
    gcp.list_instances(&session_id, zone).await
}

#[tauri::command]
pub async fn get_gcp_instance(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
    zone: Option<String>,
) -> Result<compute::Instance, String> {
    let mut gcp = state.lock().await;
    gcp.get_instance(&session_id, zone, &instance_name).await
}

#[tauri::command]
pub async fn start_gcp_instance(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
    zone: Option<String>,
) -> Result<compute::Operation, String> {
    let mut gcp = state.lock().await;
    gcp.start_instance(&session_id, zone, &instance_name).await
}

#[tauri::command]
pub async fn stop_gcp_instance(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
    zone: Option<String>,
) -> Result<compute::Operation, String> {
    let mut gcp = state.lock().await;
    gcp.stop_instance(&session_id, zone, &instance_name).await
}

#[tauri::command]
pub async fn reset_gcp_instance(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
    zone: Option<String>,
) -> Result<compute::Operation, String> {
    let mut gcp = state.lock().await;
    gcp.reset_instance(&session_id, zone, &instance_name).await
}

#[tauri::command]
pub async fn delete_gcp_instance(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
    zone: Option<String>,
) -> Result<compute::Operation, String> {
    let mut gcp = state.lock().await;
    gcp.delete_instance(&session_id, zone, &instance_name).await
}

#[tauri::command]
pub async fn list_gcp_disks(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    zone: Option<String>,
) -> Result<Vec<compute::Disk>, String> {
    let mut gcp = state.lock().await;
    gcp.list_disks(&session_id, zone).await
}

#[tauri::command]
pub async fn list_gcp_snapshots(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<compute::Snapshot>, String> {
    let mut gcp = state.lock().await;
    gcp.list_snapshots(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_firewalls(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<compute::Firewall>, String> {
    let mut gcp = state.lock().await;
    gcp.list_firewalls(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_networks(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<compute::Network>, String> {
    let mut gcp = state.lock().await;
    gcp.list_networks(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_machine_types(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    zone: Option<String>,
) -> Result<Vec<compute::MachineType>, String> {
    let mut gcp = state.lock().await;
    gcp.list_machine_types(&session_id, zone).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Cloud Storage
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_buckets(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<storage::Bucket>, String> {
    let mut gcp = state.lock().await;
    gcp.list_buckets(&session_id).await
}

#[tauri::command]
pub async fn get_gcp_bucket(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    bucket_name: String,
) -> Result<storage::Bucket, String> {
    let mut gcp = state.lock().await;
    gcp.get_bucket(&session_id, &bucket_name).await
}

#[tauri::command]
pub async fn create_gcp_bucket(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    name: String,
    location: String,
    storage_class: Option<String>,
) -> Result<storage::Bucket, String> {
    let mut gcp = state.lock().await;
    gcp.create_bucket(&session_id, &name, &location, storage_class)
        .await
}

#[tauri::command]
pub async fn delete_gcp_bucket(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    bucket_name: String,
) -> Result<(), String> {
    let mut gcp = state.lock().await;
    gcp.delete_bucket(&session_id, &bucket_name).await
}

#[tauri::command]
pub async fn list_gcp_objects(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    bucket: String,
    prefix: Option<String>,
) -> Result<Vec<storage::Object>, String> {
    let mut gcp = state.lock().await;
    gcp.list_objects(&session_id, &bucket, prefix).await
}

#[tauri::command]
pub async fn download_gcp_object(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    bucket: String,
    object: String,
) -> Result<String, String> {
    let mut gcp = state.lock().await;
    gcp.download_object(&session_id, &bucket, &object).await
}

#[tauri::command]
pub async fn delete_gcp_object(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    bucket: String,
    object: String,
) -> Result<(), String> {
    let mut gcp = state.lock().await;
    gcp.delete_object(&session_id, &bucket, &object).await
}

// ═══════════════════════════════════════════════════════════════════════
//  IAM
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_service_accounts(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<iam::IamServiceAccount>, String> {
    let mut gcp = state.lock().await;
    gcp.list_service_accounts(&session_id).await
}

#[tauri::command]
pub async fn get_gcp_iam_policy(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<iam::IamPolicy, String> {
    let mut gcp = state.lock().await;
    gcp.get_iam_policy(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_roles(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<iam::IamRole>, String> {
    let mut gcp = state.lock().await;
    gcp.list_roles(&session_id).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Secret Manager
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_secrets(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<secrets::Secret>, String> {
    let mut gcp = state.lock().await;
    gcp.list_secrets(&session_id).await
}

#[tauri::command]
pub async fn get_gcp_secret(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    secret_name: String,
) -> Result<secrets::Secret, String> {
    let mut gcp = state.lock().await;
    gcp.get_secret(&session_id, &secret_name).await
}

#[tauri::command]
pub async fn access_gcp_secret_version(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    secret_name: String,
    version: String,
) -> Result<String, String> {
    let mut gcp = state.lock().await;
    gcp.access_secret_version(&session_id, &secret_name, &version)
        .await
}

#[tauri::command]
pub async fn create_gcp_secret(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    secret_id: String,
) -> Result<secrets::Secret, String> {
    let mut gcp = state.lock().await;
    gcp.create_secret(&session_id, &secret_id).await
}

#[tauri::command]
pub async fn delete_gcp_secret(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    secret_name: String,
) -> Result<(), String> {
    let mut gcp = state.lock().await;
    gcp.delete_secret(&session_id, &secret_name).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Cloud SQL
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_sql_instances(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<sql::SqlInstance>, String> {
    let mut gcp = state.lock().await;
    gcp.list_sql_instances(&session_id).await
}

#[tauri::command]
pub async fn get_gcp_sql_instance(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
) -> Result<sql::SqlInstance, String> {
    let mut gcp = state.lock().await;
    gcp.get_sql_instance(&session_id, &instance_name).await
}

#[tauri::command]
pub async fn list_gcp_sql_databases(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
) -> Result<Vec<sql::Database>, String> {
    let mut gcp = state.lock().await;
    gcp.list_sql_databases(&session_id, &instance_name).await
}

#[tauri::command]
pub async fn list_gcp_sql_users(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    instance_name: String,
) -> Result<Vec<sql::SqlUser>, String> {
    let mut gcp = state.lock().await;
    gcp.list_sql_users(&session_id, &instance_name).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Cloud Functions
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_functions(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    region: Option<String>,
) -> Result<Vec<functions::Function>, String> {
    let mut gcp = state.lock().await;
    gcp.list_functions(&session_id, region).await
}

#[tauri::command]
pub async fn get_gcp_function(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    function_name: String,
    region: Option<String>,
) -> Result<functions::Function, String> {
    let mut gcp = state.lock().await;
    gcp.get_function(&session_id, region, &function_name).await
}

#[tauri::command]
pub async fn call_gcp_function(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    function_name: String,
    data: serde_json::Value,
    region: Option<String>,
) -> Result<functions::CallResult, String> {
    let mut gcp = state.lock().await;
    gcp.call_function(&session_id, region, &function_name, data)
        .await
}

// ═══════════════════════════════════════════════════════════════════════
//  GKE
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_clusters(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    zone_or_region: Option<String>,
) -> Result<Vec<gke::Cluster>, String> {
    let mut gcp = state.lock().await;
    gcp.list_clusters(&session_id, zone_or_region).await
}

#[tauri::command]
pub async fn get_gcp_cluster(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    cluster_name: String,
    zone_or_region: Option<String>,
) -> Result<gke::Cluster, String> {
    let mut gcp = state.lock().await;
    gcp.get_cluster(&session_id, zone_or_region, &cluster_name)
        .await
}

#[tauri::command]
pub async fn list_gcp_node_pools(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    cluster_name: String,
    zone_or_region: Option<String>,
) -> Result<Vec<gke::NodePool>, String> {
    let mut gcp = state.lock().await;
    gcp.list_node_pools(&session_id, zone_or_region, &cluster_name)
        .await
}

// ═══════════════════════════════════════════════════════════════════════
//  Cloud DNS
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_managed_zones(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<dns::ManagedZone>, String> {
    let mut gcp = state.lock().await;
    gcp.list_managed_zones(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_dns_record_sets(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    zone_name: String,
) -> Result<Vec<dns::ResourceRecordSet>, String> {
    let mut gcp = state.lock().await;
    gcp.list_dns_record_sets(&session_id, &zone_name).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Pub/Sub
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_topics(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<pubsub::Topic>, String> {
    let mut gcp = state.lock().await;
    gcp.list_topics(&session_id).await
}

#[tauri::command]
pub async fn create_gcp_topic(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    topic_name: String,
) -> Result<pubsub::Topic, String> {
    let mut gcp = state.lock().await;
    gcp.create_topic(&session_id, &topic_name).await
}

#[tauri::command]
pub async fn delete_gcp_topic(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    topic_name: String,
) -> Result<(), String> {
    let mut gcp = state.lock().await;
    gcp.delete_topic(&session_id, &topic_name).await
}

#[tauri::command]
pub async fn publish_gcp_message(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    topic_name: String,
    messages: Vec<pubsub::PubsubMessage>,
) -> Result<Vec<String>, String> {
    let mut gcp = state.lock().await;
    gcp.publish_message(&session_id, &topic_name, messages)
        .await
}

#[tauri::command]
pub async fn list_gcp_subscriptions(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<pubsub::Subscription>, String> {
    let mut gcp = state.lock().await;
    gcp.list_subscriptions(&session_id).await
}

#[tauri::command]
pub async fn pull_gcp_messages(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    subscription_name: String,
    max_messages: u32,
) -> Result<Vec<pubsub::ReceivedMessage>, String> {
    let mut gcp = state.lock().await;
    gcp.pull_messages(&session_id, &subscription_name, max_messages)
        .await
}

// ═══════════════════════════════════════════════════════════════════════
//  Cloud Run
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_run_services(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    region: Option<String>,
) -> Result<Vec<run::RunService>, String> {
    let mut gcp = state.lock().await;
    gcp.list_run_services(&session_id, region).await
}

#[tauri::command]
pub async fn list_gcp_run_jobs(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    region: Option<String>,
) -> Result<Vec<run::Job>, String> {
    let mut gcp = state.lock().await;
    gcp.list_run_jobs(&session_id, region).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Cloud Logging
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_log_entries(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    filter: Option<String>,
    page_size: Option<u32>,
) -> Result<Vec<logging::LogEntry>, String> {
    let mut gcp = state.lock().await;
    gcp.list_log_entries(&session_id, filter, page_size).await
}

#[tauri::command]
pub async fn list_gcp_logs(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let mut gcp = state.lock().await;
    gcp.list_logs(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_log_sinks(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<logging::LogSink>, String> {
    let mut gcp = state.lock().await;
    gcp.list_log_sinks(&session_id).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Cloud Monitoring
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_gcp_metric_descriptors(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    filter: Option<String>,
) -> Result<Vec<monitoring::MetricDescriptor>, String> {
    let mut gcp = state.lock().await;
    gcp.list_metric_descriptors(&session_id, filter).await
}

#[tauri::command]
pub async fn list_gcp_time_series(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
    filter: String,
    start_time: String,
    end_time: String,
) -> Result<Vec<monitoring::TimeSeries>, String> {
    let mut gcp = state.lock().await;
    gcp.list_time_series(&session_id, &filter, &start_time, &end_time)
        .await
}

#[tauri::command]
pub async fn list_gcp_alert_policies(
    state: tauri::State<'_, GcpServiceState>,
    session_id: String,
) -> Result<Vec<monitoring::AlertPolicy>, String> {
    let mut gcp = state.lock().await;
    gcp.list_alert_policies(&session_id).await
}
