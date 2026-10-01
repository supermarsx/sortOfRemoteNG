use sorng_cloud_sync::types::{Blob, SyncError, Target, TransportOptions, Written};

#[tauri::command]
pub async fn cloud_sync_read(target: Target, options: TransportOptions) -> Result<Blob, SyncError> {
    sorng_cloud_sync::read(target, options).await
}

#[tauri::command]
pub async fn cloud_sync_write(
    target: Target,
    data: String,
    expected_revision: Option<String>,
    options: TransportOptions,
) -> Result<Written, SyncError> {
    sorng_cloud_sync::write(target, data, expected_revision, options).await
}

#[tauri::command]
pub async fn cloud_sync_test(target: Target, options: TransportOptions) -> Result<(), SyncError> {
    sorng_cloud_sync::test(target, options).await
}
