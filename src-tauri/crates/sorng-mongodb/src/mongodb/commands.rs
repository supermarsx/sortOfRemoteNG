//! Tauri commands for the MongoDB integration.

use crate::mongodb::service::MongoServiceState;
use crate::mongodb::types::*;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_connect(
    state: tauri::State<'_, MongoServiceState>,
    config: MongoConnectionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_disconnect(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_disconnect_all(
    state: tauri::State<'_, MongoServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn mongo_list_sessions(
    state: tauri::State<'_, MongoServiceState>,
) -> Result<Vec<SessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn mongo_get_session(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session(&session_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_ping(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.ping(&session_id).await.map_err(|e| e.message)
}

// ── Database management ─────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_list_databases(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let svc = state.lock().await;
    svc.list_databases(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_drop_database(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.drop_database(&session_id, &db_name)
        .await
        .map_err(|e| e.message)
}

// ── Collection management ───────────────────────────────────────────

#[tauri::command]
pub async fn mongo_list_collections(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
) -> Result<Vec<CollectionInfo>, String> {
    let svc = state.lock().await;
    svc.list_collections(&session_id, db_name.as_deref())
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_create_collection(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_collection(&session_id, db_name.as_deref(), &collection_name)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_drop_collection(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.drop_collection(&session_id, db_name.as_deref(), &collection_name)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_collection_stats(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
) -> Result<CollectionStats, String> {
    let svc = state.lock().await;
    svc.collection_stats(&session_id, db_name.as_deref(), &collection_name)
        .await
        .map_err(|e| e.message)
}

// ── Document CRUD ───────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_find(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    options: FindOptions,
) -> Result<DocumentResult, String> {
    let svc = state.lock().await;
    svc.find(&session_id, db_name.as_deref(), &collection_name, options)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_count_documents(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    filter: Option<serde_json::Value>,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.count_documents(&session_id, db_name.as_deref(), &collection_name, filter)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_insert_one(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    document: serde_json::Value,
) -> Result<InsertResult, String> {
    let svc = state.lock().await;
    svc.insert_one(&session_id, db_name.as_deref(), &collection_name, document)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_insert_many(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    documents: Vec<serde_json::Value>,
) -> Result<InsertResult, String> {
    let svc = state.lock().await;
    svc.insert_many(&session_id, db_name.as_deref(), &collection_name, documents)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_update_one(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    filter: serde_json::Value,
    update: serde_json::Value,
) -> Result<UpdateResult, String> {
    let svc = state.lock().await;
    svc.update_one(&session_id, db_name.as_deref(), &collection_name, filter, update)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_update_many(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    filter: serde_json::Value,
    update: serde_json::Value,
) -> Result<UpdateResult, String> {
    let svc = state.lock().await;
    svc.update_many(&session_id, db_name.as_deref(), &collection_name, filter, update)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_delete_one(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    filter: serde_json::Value,
) -> Result<DeleteResult, String> {
    let svc = state.lock().await;
    svc.delete_one(&session_id, db_name.as_deref(), &collection_name, filter)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_delete_many(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    filter: serde_json::Value,
) -> Result<DeleteResult, String> {
    let svc = state.lock().await;
    svc.delete_many(&session_id, db_name.as_deref(), &collection_name, filter)
        .await
        .map_err(|e| e.message)
}

// ── Aggregation ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_aggregate(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    pipeline: Vec<serde_json::Value>,
) -> Result<DocumentResult, String> {
    let svc = state.lock().await;
    svc.aggregate(&session_id, db_name.as_deref(), &collection_name, pipeline)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_run_command(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    command: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.run_command(&session_id, db_name.as_deref(), command)
        .await
        .map_err(|e| e.message)
}

// ── Index management ────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_list_indexes(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
) -> Result<Vec<IndexInfo>, String> {
    let svc = state.lock().await;
    svc.list_indexes(&session_id, db_name.as_deref(), &collection_name)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_create_index(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    keys: serde_json::Value,
    unique: bool,
    name: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_index(&session_id, db_name.as_deref(), &collection_name, keys, unique, name)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_drop_index(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    index_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.drop_index(&session_id, db_name.as_deref(), &collection_name, &index_name)
        .await
        .map_err(|e| e.message)
}

// ── Server admin ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_server_status(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<ServerStatus, String> {
    let svc = state.lock().await;
    svc.server_status(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_list_users(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
) -> Result<Vec<MongoUserInfo>, String> {
    let svc = state.lock().await;
    svc.list_users(&session_id, db_name.as_deref())
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_replica_set_status(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<Vec<ReplicaSetMember>, String> {
    let svc = state.lock().await;
    svc.replica_set_status(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_current_op(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.current_op(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_kill_op(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    op_id: i64,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.kill_op(&session_id, op_id).await.map_err(|e| e.message)
}

// ── Export ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_export_collection(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    db_name: Option<String>,
    collection_name: String,
    options: ExportOptions,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_collection(&session_id, db_name.as_deref(), &collection_name, options)
        .await
        .map_err(|e| e.message)
}
