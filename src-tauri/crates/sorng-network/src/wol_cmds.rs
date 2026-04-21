use super::wol::*;

#[tauri::command]
pub async fn wake_on_lan(
    state: tauri::State<'_, WolServiceState>,
    mac_address: String,
    broadcast_address: Option<String>,
    port: Option<u16>,
    password: Option<String>,
) -> Result<(), String> {
    let wol = state.lock().await;
    wol.wake_on_lan(mac_address, broadcast_address, port, password)
        .await
}

/// Wake multiple hosts in parallel, each in its own thread
#[tauri::command]
pub async fn wake_multiple_hosts(
    state: tauri::State<'_, WolServiceState>,
    mac_addresses: Vec<String>,
    broadcast_address: Option<String>,
    port: Option<u16>,
) -> Result<Vec<Result<(), String>>, String> {
    let wol = state.lock().await;
    wol.wake_multiple(mac_addresses, broadcast_address, port)
        .await
}

#[tauri::command]
pub async fn discover_wol_devices(
    state: tauri::State<'_, WolServiceState>,
) -> Result<Vec<WolDevice>, String> {
    let wol = state.lock().await;
    wol.discover_devices().await
}

#[tauri::command]
pub async fn add_wol_schedule(
    state: tauri::State<'_, WolServiceState>,
    schedule: WolSchedule,
) -> Result<String, String> {
    let mut wol = state.lock().await;
    wol.add_schedule(schedule)
}

#[tauri::command]
pub async fn remove_wol_schedule(
    state: tauri::State<'_, WolServiceState>,
    schedule_id: String,
) -> Result<(), String> {
    let mut wol = state.lock().await;
    wol.remove_schedule(&schedule_id)
}

#[tauri::command]
pub async fn list_wol_schedules(
    state: tauri::State<'_, WolServiceState>,
) -> Result<Vec<WolSchedule>, String> {
    let wol = state.lock().await;
    Ok(wol.list_schedules())
}

#[tauri::command]
pub async fn update_wol_schedule(
    state: tauri::State<'_, WolServiceState>,
    schedule: WolSchedule,
) -> Result<(), String> {
    let mut wol = state.lock().await;
    wol.update_schedule(schedule)
}

