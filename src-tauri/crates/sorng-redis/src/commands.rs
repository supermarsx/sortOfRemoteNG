//! Tauri commands for the Redis integration.

use std::collections::HashMap;
use tauri::State;

use super::error::RedisError;
use super::service::RedisServiceState;
use super::types::*;

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_connect(
    state: State<'_, RedisServiceState>,
    config: RedisConnectionConfig,
) -> Result<RedisSession, RedisError> {
    let mut svc = state.lock().await;
    svc.connect(config).await
}

#[tauri::command]
pub async fn redis_disconnect(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<(), RedisError> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id)
}

#[tauri::command]
pub async fn redis_list_sessions(
    state: State<'_, RedisServiceState>,
) -> Result<Vec<RedisSession>, RedisError> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn redis_test_connection(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<bool, RedisError> {
    let mut svc = state.lock().await;
    svc.test_connection(&session_id).await
}

// ---------------------------------------------------------------------------
// Key commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_scan_keys(
    state: State<'_, RedisServiceState>,
    session_id: String,
    pattern: String,
    cursor: u64,
    count: Option<u64>,
) -> Result<RedisScanResult, RedisError> {
    let mut svc = state.lock().await;
    svc.scan_keys(&session_id, &pattern, cursor, count).await
}

#[tauri::command]
pub async fn redis_get_key_info(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<RedisKeyInfo, RedisError> {
    let mut svc = state.lock().await;
    svc.get_key_info(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_get_key_value(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<RedisKeyValue, RedisError> {
    let mut svc = state.lock().await;
    svc.get_key_value(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_set_key_value(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    value: String,
    ttl: Option<u64>,
) -> Result<(), RedisError> {
    let mut svc = state.lock().await;
    svc.set_key_value(&session_id, &key, &value, ttl).await
}

#[tauri::command]
pub async fn redis_delete_keys(
    state: State<'_, RedisServiceState>,
    session_id: String,
    keys: Vec<String>,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.delete_keys(&session_id, &keys).await
}

#[tauri::command]
pub async fn redis_rename_key(
    state: State<'_, RedisServiceState>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), RedisError> {
    let mut svc = state.lock().await;
    svc.rename_key(&session_id, &from, &to).await
}

#[tauri::command]
pub async fn redis_set_ttl(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    ttl: i64,
) -> Result<bool, RedisError> {
    let mut svc = state.lock().await;
    svc.set_ttl(&session_id, &key, ttl).await
}

#[tauri::command]
pub async fn redis_persist_key(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<bool, RedisError> {
    let mut svc = state.lock().await;
    svc.persist_key(&session_id, &key).await
}

// ---------------------------------------------------------------------------
// String commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_string_get(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<Option<String>, RedisError> {
    let mut svc = state.lock().await;
    svc.string_get(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_string_set(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    value: String,
) -> Result<(), RedisError> {
    let mut svc = state.lock().await;
    svc.string_set(&session_id, &key, &value).await
}

#[tauri::command]
pub async fn redis_string_incr(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<i64, RedisError> {
    let mut svc = state.lock().await;
    svc.string_incr(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_string_decr(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<i64, RedisError> {
    let mut svc = state.lock().await;
    svc.string_decr(&session_id, &key).await
}

// ---------------------------------------------------------------------------
// List commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_list_range(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    start: i64,
    stop: i64,
) -> Result<Vec<String>, RedisError> {
    let mut svc = state.lock().await;
    svc.list_range(&session_id, &key, start, stop).await
}

#[tauri::command]
pub async fn redis_list_push(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    values: Vec<String>,
    left: bool,
) -> Result<i64, RedisError> {
    let mut svc = state.lock().await;
    svc.list_push(&session_id, &key, &values, left).await
}

#[tauri::command]
pub async fn redis_list_pop(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    left: bool,
) -> Result<Option<String>, RedisError> {
    let mut svc = state.lock().await;
    svc.list_pop(&session_id, &key, left).await
}

#[tauri::command]
pub async fn redis_list_len(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<i64, RedisError> {
    let mut svc = state.lock().await;
    svc.list_len(&session_id, &key).await
}

// ---------------------------------------------------------------------------
// Set commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_set_members(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<Vec<String>, RedisError> {
    let mut svc = state.lock().await;
    svc.set_members(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_set_add(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    members: Vec<String>,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.set_add(&session_id, &key, &members).await
}

#[tauri::command]
pub async fn redis_set_remove(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    members: Vec<String>,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.set_remove(&session_id, &key, &members).await
}

#[tauri::command]
pub async fn redis_set_card(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.set_card(&session_id, &key).await
}

// ---------------------------------------------------------------------------
// Hash commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_hash_getall(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<HashMap<String, String>, RedisError> {
    let mut svc = state.lock().await;
    svc.hash_getall(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_hash_get(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    field: String,
) -> Result<Option<String>, RedisError> {
    let mut svc = state.lock().await;
    svc.hash_get(&session_id, &key, &field).await
}

#[tauri::command]
pub async fn redis_hash_set(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    field: String,
    value: String,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.hash_set(&session_id, &key, &field, &value).await
}

#[tauri::command]
pub async fn redis_hash_del(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    fields: Vec<String>,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.hash_del(&session_id, &key, &fields).await
}

// ---------------------------------------------------------------------------
// Sorted set commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_sorted_set_range(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    start: i64,
    stop: i64,
    with_scores: Option<bool>,
) -> Result<Vec<ZSetMember>, RedisError> {
    let mut svc = state.lock().await;
    svc.sorted_set_range(&session_id, &key, start, stop, with_scores.unwrap_or(true))
        .await
}

#[tauri::command]
pub async fn redis_sorted_set_add(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    members: Vec<(f64, String)>,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.sorted_set_add(&session_id, &key, &members).await
}

#[tauri::command]
pub async fn redis_sorted_set_rem(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    members: Vec<String>,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.sorted_set_rem(&session_id, &key, &members).await
}

#[tauri::command]
pub async fn redis_sorted_set_card(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.sorted_set_card(&session_id, &key).await
}

// ---------------------------------------------------------------------------
// Stream commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_stream_range(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    start: Option<String>,
    end: Option<String>,
    count: Option<u64>,
) -> Result<Vec<RedisStreamEntry>, RedisError> {
    let mut svc = state.lock().await;
    svc.stream_range(
        &session_id,
        &key,
        start.as_deref().unwrap_or("-"),
        end.as_deref().unwrap_or("+"),
        count,
    )
    .await
}

#[tauri::command]
pub async fn redis_stream_add(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    fields: Vec<(String, String)>,
    maxlen: Option<u64>,
) -> Result<String, RedisError> {
    let mut svc = state.lock().await;
    svc.stream_add(&session_id, &key, "*", &fields, maxlen)
        .await
}

#[tauri::command]
pub async fn redis_stream_len(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.stream_len(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_stream_info(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<RedisStreamInfo, RedisError> {
    let mut svc = state.lock().await;
    svc.stream_info(&session_id, &key).await
}

#[tauri::command]
pub async fn redis_stream_groups(
    state: State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<Vec<RedisConsumerGroup>, RedisError> {
    let mut svc = state.lock().await;
    svc.stream_groups(&session_id, &key).await
}

// ---------------------------------------------------------------------------
// Pub/Sub commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_publish(
    state: State<'_, RedisServiceState>,
    session_id: String,
    channel: String,
    message: String,
) -> Result<u64, RedisError> {
    let mut svc = state.lock().await;
    svc.publish(&session_id, &channel, &message).await
}

#[tauri::command]
pub async fn redis_pubsub_channels(
    state: State<'_, RedisServiceState>,
    session_id: String,
    pattern: Option<String>,
) -> Result<Vec<String>, RedisError> {
    let mut svc = state.lock().await;
    svc.pubsub_channels(&session_id, pattern.as_deref()).await
}

#[tauri::command]
pub async fn redis_pubsub_numsub(
    state: State<'_, RedisServiceState>,
    session_id: String,
    channels: Vec<String>,
) -> Result<Vec<RedisPubSubChannel>, RedisError> {
    let mut svc = state.lock().await;
    svc.pubsub_numsub(&session_id, &channels).await
}

// ---------------------------------------------------------------------------
// Server admin commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_server_info(
    state: State<'_, RedisServiceState>,
    session_id: String,
    section: Option<String>,
) -> Result<RedisServerInfo, RedisError> {
    let mut svc = state.lock().await;
    svc.server_info(&session_id, section.as_deref()).await
}

#[tauri::command]
pub async fn redis_config_get(
    state: State<'_, RedisServiceState>,
    session_id: String,
    pattern: String,
) -> Result<Vec<RedisConfigParam>, RedisError> {
    let mut svc = state.lock().await;
    svc.config_get(&session_id, &pattern).await
}

#[tauri::command]
pub async fn redis_config_set(
    state: State<'_, RedisServiceState>,
    session_id: String,
    param: String,
    value: String,
) -> Result<(), RedisError> {
    let mut svc = state.lock().await;
    svc.config_set(&session_id, &param, &value).await
}

#[tauri::command]
pub async fn redis_dbsize(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<i64, RedisError> {
    let mut svc = state.lock().await;
    svc.dbsize(&session_id).await
}

#[tauri::command]
pub async fn redis_flushdb(
    state: State<'_, RedisServiceState>,
    session_id: String,
    r#async: Option<bool>,
) -> Result<(), RedisError> {
    let mut svc = state.lock().await;
    svc.flushdb(&session_id, r#async.unwrap_or(false)).await
}

#[tauri::command]
pub async fn redis_slowlog_get(
    state: State<'_, RedisServiceState>,
    session_id: String,
    count: Option<i64>,
) -> Result<Vec<RedisSlowLogEntry>, RedisError> {
    let mut svc = state.lock().await;
    svc.slowlog_get(&session_id, count).await
}

#[tauri::command]
pub async fn redis_client_list(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<Vec<RedisClientInfo>, RedisError> {
    let mut svc = state.lock().await;
    svc.client_list(&session_id).await
}

#[tauri::command]
pub async fn redis_memory_stats(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<RedisMemoryStats, RedisError> {
    let mut svc = state.lock().await;
    svc.memory_stats(&session_id).await
}

#[tauri::command]
pub async fn redis_command_stats(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<Vec<RedisCommandStats>, RedisError> {
    let mut svc = state.lock().await;
    svc.command_stats(&session_id).await
}

#[tauri::command]
pub async fn redis_keyspace_info(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<Vec<RedisKeyspaceInfo>, RedisError> {
    let mut svc = state.lock().await;
    svc.keyspace_info(&session_id).await
}

#[tauri::command]
pub async fn redis_module_list(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<Vec<RedisModuleInfo>, RedisError> {
    let mut svc = state.lock().await;
    svc.module_list(&session_id).await
}

// ---------------------------------------------------------------------------
// Cluster commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_cluster_info(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<RedisClusterInfo, RedisError> {
    let mut svc = state.lock().await;
    svc.cluster_info(&session_id).await
}

#[tauri::command]
pub async fn redis_cluster_nodes(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<Vec<RedisClusterNode>, RedisError> {
    let mut svc = state.lock().await;
    svc.cluster_nodes(&session_id).await
}

#[tauri::command]
pub async fn redis_cluster_myid(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<String, RedisError> {
    let mut svc = state.lock().await;
    svc.cluster_myid(&session_id).await
}

// ---------------------------------------------------------------------------
// Sentinel commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_sentinel_masters(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<Vec<RedisSentinelMaster>, RedisError> {
    let mut svc = state.lock().await;
    svc.sentinel_masters(&session_id).await
}

#[tauri::command]
pub async fn redis_sentinel_master(
    state: State<'_, RedisServiceState>,
    session_id: String,
    name: String,
) -> Result<RedisSentinelMaster, RedisError> {
    let mut svc = state.lock().await;
    svc.sentinel_master(&session_id, &name).await
}

#[tauri::command]
pub async fn redis_sentinel_slaves(
    state: State<'_, RedisServiceState>,
    session_id: String,
    master_name: String,
) -> Result<Vec<RedisSentinelSlave>, RedisError> {
    let mut svc = state.lock().await;
    svc.sentinel_slaves(&session_id, &master_name).await
}

// ---------------------------------------------------------------------------
// Replication commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_replication_info(
    state: State<'_, RedisServiceState>,
    session_id: String,
) -> Result<RedisReplicationInfo, RedisError> {
    let mut svc = state.lock().await;
    svc.replication_info(&session_id).await
}
