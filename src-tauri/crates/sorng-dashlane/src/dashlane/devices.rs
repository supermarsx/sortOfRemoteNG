use crate::dashlane::api_client::DashlaneApiClient;
use crate::dashlane::types::{DashlaneError, RegisteredDevice};
use sha2::{Digest, Sha256};
use std::cmp::Reverse;

/// List all registered devices.
pub async fn list_devices(
    client: &DashlaneApiClient,
) -> Result<Vec<RegisteredDevice>, DashlaneError> {
    let infos = client.list_devices().await?;
    let devices = infos
        .into_iter()
        .map(|mut info| {
            let id = device_id_for_access_key(&info.device_access_key);
            RegisteredDevice {
                id,
                name: std::mem::take(&mut info.device_name),
                platform: Some(std::mem::take(&mut info.platform)),
                created_at: info.created_at.take(),
                last_active: info.last_active.take(),
                is_current: false,
            }
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
pub fn identify_current_device(devices: &mut [RegisteredDevice], current_device_id: &str) {
    let current_device_id = device_id_for_access_key(current_device_id);
    identify_current_device_by_id(devices, &current_device_id);
}

pub(crate) fn identify_current_device_by_id(
    devices: &mut [RegisteredDevice],
    current_device_id: &str,
) {
    for device in devices.iter_mut() {
        device.is_current = device.id == current_device_id;
    }
}

pub(crate) fn device_id_for_access_key(device_access_key: &str) -> String {
    let digest = Sha256::digest(device_access_key.as_bytes());
    hex::encode(&digest[..16])
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
    result.sort_by_key(|item| Reverse(item.1));
    result
}
