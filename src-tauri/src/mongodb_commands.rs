#[cfg(feature = "db-mongo")]
use crate::mongodb::service::MongoServiceState;
#[cfg(feature = "db-mongo")]
use crate::mongodb::types::*;

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_connect(
    state: tauri::State<'_, MongoServiceState>,
    config: MongoConnectionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_disconnect(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_disconnect_all(
    state: tauri::State<'_, MongoServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_list_sessions(
    state: tauri::State<'_, MongoServiceState>,
) -> Result<Vec<SessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_get_session(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session(&session_id).map_err(|e| e.message)
}

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_ping(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.ping(&session_id).await.map_err(|e| e.message)
}

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_list_databases(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let svc = state.lock().await;
    svc.list_databases(&session_id).await.map_err(|e| e.message)
}

#[cfg(feature = "db-mongo")]
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

#[cfg(feature = "db-mongo")]
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

#[cfg(feature = "db-mongo")]
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

#[cfg(feature = "db-mongo")]
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

#[cfg(feature = "db-mongo")]
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

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_server_status(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<ServerStatus, String> {
    let svc = state.lock().await;
    svc.server_status(&session_id).await.map_err(|e| e.message)
}

#[cfg(feature = "db-mongo")]
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

#[cfg(feature = "db-mongo")]
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

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_current_op(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.current_op(&session_id).await.map_err(|e| e.message)
}

#[cfg(feature = "db-mongo")]
#[tauri::command]
pub async fn mongo_kill_op(
    state: tauri::State<'_, MongoServiceState>,
    session_id: String,
    op_id: i64,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.kill_op(&session_id, op_id).await.map_err(|e| e.message)
}

#[cfg(not(feature = "db-mongo"))]
mod disabled {
    macro_rules! disabled_commands {
        ($($name:ident),* $(,)?) => {
            $(
                #[tauri::command]
                pub async fn $name() -> Result<(), String> {
                    Err("MongoDB support is not enabled in this build".into())
                }
            )*
        };
    }

    disabled_commands!(
        mongo_connect,
        mongo_disconnect,
        mongo_disconnect_all,
        mongo_list_sessions,
        mongo_get_session,
        mongo_ping,
        mongo_list_databases,
        mongo_drop_database,
        mongo_list_collections,
        mongo_create_collection,
        mongo_drop_collection,
        mongo_collection_stats,
        mongo_server_status,
        mongo_list_users,
        mongo_replica_set_status,
        mongo_current_op,
        mongo_kill_op
    );
}

#[cfg(not(feature = "db-mongo"))]
pub use disabled::*;
