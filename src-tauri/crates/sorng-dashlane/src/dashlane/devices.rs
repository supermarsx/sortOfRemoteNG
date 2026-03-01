use crate::dashlane::types::{DashlaneError, RegisteredDevice};
use crate::dashlane::api_client::DashlaneApiClient;

/// List all registered devices.
pub async fn list_devices(client: &DashlaneApiClient) -> Result<Vec<RegisteredDevice>, DashlaneError> {
    let infos = client.list_devices().await?;
    let devices = infos
        .into_iter()
        .map(|info| RegisteredDevice {
            id: info.device_access_key.clone(),
            name: info.device_name,
            platform: Some(info.platform),
            created_at: info.created_at,
            last_active: info.last_active,
            is_current: false, // caller must set this
        })
        .collect();
    Ok(devices)
}

/// Deregister a device by ID.
pub async fn deregister_device(
    client: &DashlaneApiClient,
    device_id: &str,
) -> Result<(), DashlaneError> {
    client.deregister_device(device_id).await
}

/// Find the current device by device access key.
pub fn identify_current_device(
    devices: &mut [RegisteredDevice],
    current_device_id: &str,
) {
    for device in devices.iter_mut() {
        device.is_current = device.id == current_device_id;
    }
}

/// Get only active devices (non-empty last_active).
pub fn get_active_devices(devices: &[RegisteredDevice]) -> Vec<RegisteredDevice> {
    devices
        .iter()
        .filter(|d| d.last_active.is_some())
        .cloned()
        .collect()
}

/// Count devices by platform.
pub fn count_by_platform(devices: &[RegisteredDevice]) -> Vec<(String, usize)> {
    use std::collections::HashMap;
    let mut map: HashMap<String, usize> = HashMap::new();
    for device in devices {
        let platform = device.platform.clone().unwrap_or_else(|| "Unknown".into());
        *map.entry(platform).or_default() += 1;
    }
    let mut result: Vec<_> = map.into_iter().collect();
    result.sort_by(|a, b| b.1.cmp(&a.1));
    result
}
