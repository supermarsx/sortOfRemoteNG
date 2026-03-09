use std::collections::HashMap;
use tauri::State;

use crate::error::RabbitError;
use crate::service::RabbitServiceState;
use crate::types::{
    BindingInfo, ChannelInfo, ClusterNode, ConnectionInfo, ConsumerInfo, DefinitionsExport,
    ExchangeInfo, FederationLink, FederationUpstream, FederationUpstreamDef, OverviewInfo,
    PermissionInfo, PolicyInfo, QueueInfo, RabbitConnectionConfig, RabbitSession, ShovelDefinition,
    ShovelInfo, UserInfo, VhostInfo,
};

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_connect(
    state: State<'_, RabbitServiceState>,
    config: RabbitConnectionConfig,
) -> Result<RabbitSession, RabbitError> {
    let mut svc = state.lock().await;
    svc.connect(config).await
}

#[tauri::command]
pub async fn rabbit_disconnect(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<(), RabbitError> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id)
}

#[tauri::command]
pub async fn rabbit_list_sessions(
    state: State<'_, RabbitServiceState>,
) -> Result<Vec<RabbitSession>, RabbitError> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn rabbit_test_connection(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<bool, RabbitError> {
    let svc = state.lock().await;
    svc.test_connection(&session_id).await
}

// ---------------------------------------------------------------------------
// Vhost commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_vhosts(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<VhostInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_vhosts(&session_id).await
}

#[tauri::command]
pub async fn rabbit_get_vhost(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<VhostInfo, RabbitError> {
    let svc = state.lock().await;
    svc.get_vhost(&session_id, &name).await
}

#[tauri::command]
pub async fn rabbit_create_vhost(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
    description: Option<String>,
    tags: Option<String>,
    default_queue_type: Option<String>,
    tracing: Option<bool>,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_vhost(
        &session_id,
        &name,
        description.as_deref(),
        tags.as_deref(),
        default_queue_type.as_deref(),
        tracing,
    )
    .await
}

#[tauri::command]
pub async fn rabbit_delete_vhost(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_vhost(&session_id, &name).await
}

// ---------------------------------------------------------------------------
// Exchange commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_exchanges(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: Option<String>,
) -> Result<Vec<ExchangeInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_exchanges(&session_id, vhost.as_deref()).await
}

#[tauri::command]
pub async fn rabbit_get_exchange(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
) -> Result<ExchangeInfo, RabbitError> {
    let svc = state.lock().await;
    svc.get_exchange(&session_id, &vhost, &name).await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn rabbit_create_exchange(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
    exchange_type: String,
    durable: bool,
    auto_delete: bool,
    internal: bool,
    arguments: Option<HashMap<String, serde_json::Value>>,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_exchange(
        &session_id,
        &vhost,
        &name,
        &exchange_type,
        durable,
        auto_delete,
        internal,
        arguments,
    )
    .await
}

#[tauri::command]
pub async fn rabbit_delete_exchange(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
    if_unused: bool,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_exchange(&session_id, &vhost, &name, if_unused)
        .await
}

// ---------------------------------------------------------------------------
// Queue commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_queues(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: Option<String>,
) -> Result<Vec<QueueInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_queues(&session_id, vhost.as_deref()).await
}

#[tauri::command]
pub async fn rabbit_get_queue(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
) -> Result<QueueInfo, RabbitError> {
    let svc = state.lock().await;
    svc.get_queue(&session_id, &vhost, &name).await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn rabbit_create_queue(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
    durable: bool,
    auto_delete: bool,
    queue_type: Option<String>,
    arguments: Option<HashMap<String, serde_json::Value>>,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_queue(
        &session_id,
        &vhost,
        &name,
        durable,
        auto_delete,
        queue_type.as_deref(),
        arguments,
    )
    .await
}

#[tauri::command]
pub async fn rabbit_delete_queue(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
    if_unused: bool,
    if_empty: bool,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_queue(&session_id, &vhost, &name, if_unused, if_empty)
        .await
}

#[tauri::command]
pub async fn rabbit_purge_queue(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.purge_queue(&session_id, &vhost, &name).await
}

// ---------------------------------------------------------------------------
// Binding commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_bindings(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: Option<String>,
) -> Result<Vec<BindingInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_bindings(&session_id, vhost.as_deref()).await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn rabbit_create_binding(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    source: String,
    destination: String,
    dest_type: String,
    routing_key: String,
    arguments: Option<HashMap<String, serde_json::Value>>,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_binding(
        &session_id,
        &vhost,
        &source,
        &destination,
        &dest_type,
        &routing_key,
        arguments,
    )
    .await
}

#[tauri::command]
pub async fn rabbit_delete_binding(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    source: String,
    destination: String,
    dest_type: String,
    properties_key: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_binding(
        &session_id,
        &vhost,
        &source,
        &destination,
        &dest_type,
        &properties_key,
    )
    .await
}

// ---------------------------------------------------------------------------
// User commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_users(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<UserInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_users(&session_id).await
}

#[tauri::command]
pub async fn rabbit_create_user(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
    password: String,
    tags: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_user(&session_id, &name, &password, &tags).await
}

#[tauri::command]
pub async fn rabbit_delete_user(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_user(&session_id, &name).await
}

// ---------------------------------------------------------------------------
// Permission commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_permissions(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<PermissionInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_permissions(&session_id).await
}

#[tauri::command]
pub async fn rabbit_set_permission(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    user: String,
    configure: String,
    write: String,
    read: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.set_permission(&session_id, &vhost, &user, &configure, &write, &read)
        .await
}

// ---------------------------------------------------------------------------
// Policy commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_policies(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: Option<String>,
) -> Result<Vec<PolicyInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_policies(&session_id, vhost.as_deref()).await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn rabbit_create_policy(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
    pattern: String,
    definition: serde_json::Value,
    priority: i64,
    apply_to: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_policy(
        &session_id,
        &vhost,
        &name,
        &pattern,
        definition,
        priority,
        &apply_to,
    )
    .await
}

#[tauri::command]
pub async fn rabbit_delete_policy(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_policy(&session_id, &vhost, &name).await
}

// ---------------------------------------------------------------------------
// Shovel commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_shovels(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: Option<String>,
) -> Result<Vec<ShovelInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_shovels(&session_id, vhost.as_deref()).await
}

#[tauri::command]
pub async fn rabbit_create_shovel(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
    definition: ShovelDefinition,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_shovel(&session_id, &vhost, &name, definition)
        .await
}

#[tauri::command]
pub async fn rabbit_delete_shovel(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_shovel(&session_id, &vhost, &name).await
}

#[tauri::command]
pub async fn rabbit_restart_shovel(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.restart_shovel(&session_id, &vhost, &name).await
}

// ---------------------------------------------------------------------------
// Federation commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_federation_upstreams(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<FederationUpstream>, RabbitError> {
    let svc = state.lock().await;
    svc.list_federation_upstreams(&session_id).await
}

#[tauri::command]
pub async fn rabbit_create_federation_upstream(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
    definition: FederationUpstreamDef,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.create_federation_upstream(&session_id, &vhost, &name, definition)
        .await
}

#[tauri::command]
pub async fn rabbit_delete_federation_upstream(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.delete_federation_upstream(&session_id, &vhost, &name)
        .await
}

#[tauri::command]
pub async fn rabbit_list_federation_links(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<FederationLink>, RabbitError> {
    let svc = state.lock().await;
    svc.list_federation_links(&session_id).await
}

// ---------------------------------------------------------------------------
// Cluster commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_nodes(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<ClusterNode>, RabbitError> {
    let svc = state.lock().await;
    svc.list_nodes(&session_id).await
}

#[tauri::command]
pub async fn rabbit_get_node(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<ClusterNode, RabbitError> {
    let svc = state.lock().await;
    svc.get_node(&session_id, &name).await
}

#[tauri::command]
pub async fn rabbit_get_cluster_name(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<crate::types::ClusterName, RabbitError> {
    let svc = state.lock().await;
    svc.get_cluster_name(&session_id).await
}

#[tauri::command]
pub async fn rabbit_set_cluster_name(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.set_cluster_name(&session_id, &name).await
}

#[tauri::command]
pub async fn rabbit_check_alarms(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<bool, RabbitError> {
    let svc = state.lock().await;
    svc.check_alarms(&session_id).await
}

// ---------------------------------------------------------------------------
// Connection commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_connections(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<ConnectionInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_connections(&session_id).await
}

#[tauri::command]
pub async fn rabbit_get_connection(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<ConnectionInfo, RabbitError> {
    let svc = state.lock().await;
    svc.get_connection(&session_id, &name).await
}

#[tauri::command]
pub async fn rabbit_close_connection(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.close_connection(&session_id, &name).await
}

// ---------------------------------------------------------------------------
// Channel commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_channels(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<Vec<ChannelInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_channels(&session_id).await
}

#[tauri::command]
pub async fn rabbit_get_channel(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    name: String,
) -> Result<ChannelInfo, RabbitError> {
    let svc = state.lock().await;
    svc.get_channel(&session_id, &name).await
}

// ---------------------------------------------------------------------------
// Consumer commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_list_consumers(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: Option<String>,
) -> Result<Vec<ConsumerInfo>, RabbitError> {
    let svc = state.lock().await;
    svc.list_consumers(&session_id, vhost.as_deref()).await
}

#[tauri::command]
pub async fn rabbit_cancel_consumer(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
    consumer_tag: String,
) -> Result<bool, RabbitError> {
    let svc = state.lock().await;
    svc.cancel_consumer(&session_id, &vhost, &consumer_tag)
        .await
}

// ---------------------------------------------------------------------------
// Monitoring commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_get_overview(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<OverviewInfo, RabbitError> {
    let svc = state.lock().await;
    svc.get_overview(&session_id).await
}

#[tauri::command]
pub async fn rabbit_get_message_rates(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<crate::types::MessageStats, RabbitError> {
    let svc = state.lock().await;
    svc.get_message_rates(&session_id).await
}

#[tauri::command]
pub async fn rabbit_get_queue_rates(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: Option<String>,
) -> Result<Vec<serde_json::Value>, RabbitError> {
    let svc = state.lock().await;
    svc.get_queue_rates(&session_id, vhost.as_deref()).await
}

#[tauri::command]
pub async fn rabbit_monitoring_snapshot(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<serde_json::Value, RabbitError> {
    let svc = state.lock().await;
    svc.monitoring_snapshot(&session_id).await
}

#[tauri::command]
pub async fn rabbit_aliveness_test(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
) -> Result<serde_json::Value, RabbitError> {
    let svc = state.lock().await;
    svc.aliveness_test(&session_id, &vhost).await
}

// ---------------------------------------------------------------------------
// Definition commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rabbit_export_definitions(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<DefinitionsExport, RabbitError> {
    let svc = state.lock().await;
    svc.export_definitions(&session_id).await
}

#[tauri::command]
pub async fn rabbit_import_definitions(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    definitions: DefinitionsExport,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.import_definitions(&session_id, &definitions).await
}

#[tauri::command]
pub async fn rabbit_export_vhost_definitions(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    vhost: String,
) -> Result<serde_json::Value, RabbitError> {
    let svc = state.lock().await;
    svc.export_vhost_definitions(&session_id, &vhost).await
}

#[tauri::command]
pub async fn rabbit_clone_vhost(
    state: State<'_, RabbitServiceState>,
    session_id: String,
    source_vhost: String,
    target_vhost: String,
) -> Result<(), RabbitError> {
    let svc = state.lock().await;
    svc.clone_vhost(&session_id, &source_vhost, &target_vhost)
        .await
}

#[tauri::command]
pub async fn rabbit_definitions_summary(
    state: State<'_, RabbitServiceState>,
    session_id: String,
) -> Result<serde_json::Value, RabbitError> {
    let svc = state.lock().await;
    svc.definitions_summary(&session_id).await
}
