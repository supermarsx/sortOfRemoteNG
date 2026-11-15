use sorng_arista::{AristaConfig, AristaCoolingReport};

/// Fetch fan speeds from an Arista EOS switch over eAPI. Stateless: the
/// connection parameters travel with each call and nothing is persisted.
#[tauri::command]
pub async fn arista_get_fan_speeds(config: AristaConfig) -> Result<AristaCoolingReport, String> {
    sorng_arista::fetch_cooling(&config).await
}
