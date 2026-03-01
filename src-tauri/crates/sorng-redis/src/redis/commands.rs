//! Tauri commands for the Redis integration.

use crate::redis::service::RedisServiceState;
use crate::redis::types::*;
use std::collections::HashMap;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn redis_connect(
    state: tauri::State<'_, RedisServiceState>,
    config: RedisConnectionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_disconnect(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_disconnect_all(
    state: tauri::State<'_, RedisServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn redis_list_sessions(
    state: tauri::State<'_, RedisServiceState>,
) -> Result<Vec<SessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn redis_get_session(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session(&session_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_ping(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.ping(&session_id).await.map_err(|e| e.message)
}

// ── Key operations ──────────────────────────────────────────────────

#[tauri::command]
pub async fn redis_get(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let mut svc = state.lock().await;
    svc.get(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_set(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    value: String,
    ttl_secs: Option<u64>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set(&session_id, &key, &value, ttl_secs)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_del(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    keys: Vec<String>,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.del(&session_id, &keys).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_exists(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.exists(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_expire(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    ttl_secs: i64,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.expire(&session_id, &key, ttl_secs)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_persist(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.persist(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_ttl(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.ttl(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_key_type(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<RedisKeyType, String> {
    let mut svc = state.lock().await;
    svc.key_type(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_rename(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    new_key: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rename(&session_id, &key, &new_key)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_scan(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    cursor: u64,
    pattern: String,
    count: Option<u64>,
) -> Result<ScanResult, String> {
    let mut svc = state.lock().await;
    svc.scan(&session_id, cursor, &pattern, count)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_key_info(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<KeyInfo, String> {
    let mut svc = state.lock().await;
    svc.key_info(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_dbsize(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.dbsize(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_flushdb(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.flushdb(&session_id).await.map_err(|e| e.message)
}

// ── Hash operations ─────────────────────────────────────────────────

#[tauri::command]
pub async fn redis_hgetall(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<HashMap<String, String>, String> {
    let mut svc = state.lock().await;
    svc.hgetall(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_hget(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    field: String,
) -> Result<Option<String>, String> {
    let mut svc = state.lock().await;
    svc.hget(&session_id, &key, &field)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_hset(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    field: String,
    value: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.hset(&session_id, &key, &field, &value)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_hdel(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    field: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.hdel(&session_id, &key, &field)
        .await
        .map_err(|e| e.message)
}

// ── List operations ─────────────────────────────────────────────────

#[tauri::command]
pub async fn redis_lrange(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    start: i64,
    stop: i64,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    svc.lrange(&session_id, &key, start, stop)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_lpush(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    value: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.lpush(&session_id, &key, &value)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_rpush(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    value: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.rpush(&session_id, &key, &value)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_llen(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.llen(&session_id, &key).await.map_err(|e| e.message)
}

// ── Set operations ──────────────────────────────────────────────────

#[tauri::command]
pub async fn redis_smembers(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    svc.smembers(&session_id, &key).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_sadd(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    member: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.sadd(&session_id, &key, &member)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_srem(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    member: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.srem(&session_id, &key, &member)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_scard(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.scard(&session_id, &key).await.map_err(|e| e.message)
}

// ── Sorted set operations ───────────────────────────────────────────

#[tauri::command]
pub async fn redis_zrange_with_scores(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    start: i64,
    stop: i64,
) -> Result<Vec<ZSetMember>, String> {
    let mut svc = state.lock().await;
    svc.zrange_with_scores(&session_id, &key, start, stop)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_zadd(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    member: String,
    score: f64,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.zadd(&session_id, &key, &member, score)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_zrem(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
    member: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.zrem(&session_id, &key, &member)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_zcard(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    key: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.zcard(&session_id, &key).await.map_err(|e| e.message)
}

// ── Server admin ────────────────────────────────────────────────────

#[tauri::command]
pub async fn redis_server_info(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    section: Option<String>,
) -> Result<ServerInfo, String> {
    let mut svc = state.lock().await;
    svc.server_info(&session_id, section.as_deref())
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_memory_info(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
) -> Result<MemoryInfo, String> {
    let mut svc = state.lock().await;
    svc.memory_info(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_client_list(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
) -> Result<Vec<ClientInfo>, String> {
    let mut svc = state.lock().await;
    svc.client_list(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_client_kill(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    client_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.client_kill(&session_id, &client_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_slowlog_get(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    count: Option<i64>,
) -> Result<Vec<SlowLogEntry>, String> {
    let mut svc = state.lock().await;
    svc.slowlog_get(&session_id, count)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_config_get(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    pattern: String,
) -> Result<HashMap<String, String>, String> {
    let mut svc = state.lock().await;
    svc.config_get(&session_id, &pattern)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_config_set(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    param: String,
    value: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.config_set(&session_id, &param, &value)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_raw_command(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    args: Vec<String>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.raw_command(&session_id, &args)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn redis_select_db(
    state: tauri::State<'_, RedisServiceState>,
    session_id: String,
    db: u8,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.select_db(&session_id, db).await.map_err(|e| e.message)
}
