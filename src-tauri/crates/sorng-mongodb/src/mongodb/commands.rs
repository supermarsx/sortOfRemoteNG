// Tauri commands for the MongoDB integration (official driver backend).

use super::mongodb::service::MongoServiceState;
use super::mongodb::types::*;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_connect(
    state: tauri::State<'_, MongoServiceState>,
    config: MongoConnectionConfig,
    insecure_tls_acknowledgement: Option<String>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect_with_acknowledgement(config, insecure_tls_acknowledgement)
        .await
        .map_err(|e| e.message)
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

// ── Databases / collections ─────────────────────────────────────────

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

// ── Server administration ───────────────────────────────────────────

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
    svc.replica_set_status(&session_id)
        .await
        .map_err(|e| e.message)
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

// ── Documents ───────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mongo_find(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    filter: serde_json::Value,
    projection: Option<serde_json::Value>,
    sort: Option<serde_json::Value>,
    limit: Option<i64>,
    skip: Option<u64>,
) -> Result<FindResult, String> {
    let svc = state.lock().await;
    svc.find(
        &session_id,
        database.as_deref(),
        &collection,
        filter,
        projection,
        sort,
        limit,
        skip,
    )
    .await
    .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_count_documents(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    filter: serde_json::Value,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.count_documents(&session_id, database.as_deref(), &collection, filter)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_estimated_count(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.estimated_count(&session_id, database.as_deref(), &collection)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_aggregate(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    pipeline: Vec<serde_json::Value>,
    limit: Option<i64>,
) -> Result<FindResult, String> {
    let svc = state.lock().await;
    svc.aggregate(
        &session_id,
        database.as_deref(),
        &collection,
        pipeline,
        limit,
    )
    .await
    .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_insert_documents(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    documents: Vec<serde_json::Value>,
) -> Result<InsertResult, String> {
    let svc = state.lock().await;
    svc.insert_documents(&session_id, database.as_deref(), &collection, documents)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mongo_update_documents(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    filter: serde_json::Value,
    update: serde_json::Value,
    multi: Option<bool>,
    upsert: Option<bool>,
) -> Result<UpdateResult, String> {
    let svc = state.lock().await;
    svc.update_documents(
        &session_id,
        database.as_deref(),
        &collection,
        filter,
        update,
        multi.unwrap_or(false),
        upsert.unwrap_or(false),
    )
    .await
    .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_delete_documents(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    filter: serde_json::Value,
    multi: Option<bool>,
) -> Result<DeleteResult, String> {
    let svc = state.lock().await;
    svc.delete_documents(
        &session_id,
        database.as_deref(),
        &collection,
        filter,
        multi.unwrap_or(false),
    )
    .await
    .map_err(|e| e.message)
}

// ── Indexes ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mongo_list_indexes(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
) -> Result<Vec<IndexInfo>, String> {
    let svc = state.lock().await;
    svc.list_indexes(&session_id, database.as_deref(), &collection)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_create_index(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    keys: serde_json::Value,
    options: Option<serde_json::Value>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_index(&session_id, database.as_deref(), &collection, keys, options)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mongo_drop_index(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    database: Option<String>,
    collection: String,
    index_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.drop_index(&session_id, database.as_deref(), &collection, &index_name)
        .await
        .map_err(|e| e.message)
}
