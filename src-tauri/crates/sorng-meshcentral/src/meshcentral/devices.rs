//! Device management — list, add, edit, remove, move, info.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// List devices, optionally filtered.
    pub async fn list_devices(
        &self,
        filter: Option<McDeviceFilter>,
    ) -> MeshCentralResult<Vec<McDevice>> {
        let mut payload = serde_json::Map::new();

        if let Some(ref f) = filter {
            if let Some(ref gid) = f.group_id {
                payload.insert("meshid".to_string(), json!(gid));
            }
            if let Some(ref gname) = f.group_name {
                payload.insert("meshname".to_string(), json!(gname));
            }
        }

        let resp = self.send_action("nodes", payload).await?;

        let mut devices = Vec::new();

        // Response format: { "nodes": { "meshid1": [ {device}, ... ], ... } }
        if let Some(nodes) = resp.get("nodes") {
            if let Some(obj) = nodes.as_object() {
                for (_mesh_id, mesh_devices) in obj {
                    if let Some(arr) = mesh_devices.as_array() {
                        for dev_val in arr {
                            if let Ok(dev) = serde_json::from_value::<McDevice>(dev_val.clone()) {
                                // Apply text filter if specified
                                if let Some(ref f) = filter {
                                    if let Some(ref text) = f.filter {
                                        if !device_matches_filter(&dev, text) {
                                            continue;
                                        }
                                    }
                                    if let Some(ref ids) = f.filter_ids {
                                        if !ids.iter().any(|id| dev.id.contains(id)) {
                                            continue;
                                        }
                                    }
                                }
                                devices.push(dev);
                            }
                        }
                    }
                }
            }
        }

        Ok(devices)
    }

    /// Get detailed information about a specific device.
    pub async fn get_device_info(&self, device_id: &str) -> MeshCentralResult<McDeviceInfo> {
        // Fetch device from nodes list
        let mut payload = serde_json::Map::new();
        let resp = self.send_action("nodes", payload.clone()).await?;

        let mut device: Option<McDevice> = None;
        if let Some(nodes) = resp.get("nodes") {
            if let Some(obj) = nodes.as_object() {
                'outer: for (_mesh_id, mesh_devices) in obj {
                    if let Some(arr) = mesh_devices.as_array() {
                        for dev_val in arr {
                            if let Some(id) = dev_val.get("_id").and_then(|v| v.as_str()) {
                                if id.contains(device_id) || id == device_id {
                                    device =
                                        serde_json::from_value::<McDevice>(dev_val.clone()).ok();
                                    break 'outer;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fetch network info
        payload.insert("nodeid".to_string(), json!(device_id));
        let net_resp = self.send_action("getnetworkinfo", payload.clone()).await.ok();

        // Fetch system info
        payload.insert("nodeinfo".to_string(), json!(true));
        let sys_resp = self.send_action("getsysinfo", payload.clone()).await.ok();

        // Fetch last connect
        let mut lc_payload = serde_json::Map::new();
        lc_payload.insert("nodeid".to_string(), json!(device_id));
        let lc_resp = self.send_action("lastconnect", lc_payload).await.ok();

        let last_connect = lc_resp.and_then(|v| serde_json::from_value::<McLastConnect>(v).ok());

        Ok(McDeviceInfo {
            device,
            system_info: sys_resp,
            network_info: net_resp,
            last_connect,
        })
    }

    /// Add a local device (e.g. Windows RDP, Linux SSH/SCP/VNC).
    pub async fn add_local_device(&self, params: McAddLocalDevice) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("meshid".to_string(), json!(params.mesh_id));
        payload.insert("devicename".to_string(), json!(params.device_name));
        payload.insert("hostname".to_string(), json!(params.hostname));
        payload.insert("type".to_string(), json!(params.device_type));

        let resp = self.send_action("addlocaldevice", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Device added".to_string());
        Ok(result)
    }

    /// Add an Intel AMT device.
    pub async fn add_amt_device(&self, params: McAddAmtDevice) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("meshid".to_string(), json!(params.mesh_id));
        payload.insert("devicename".to_string(), json!(params.device_name));
        payload.insert("hostname".to_string(), json!(params.hostname));
        payload.insert("amtusername".to_string(), json!(params.amt_username));
        payload.insert("amtpassword".to_string(), json!(params.amt_password));
        payload.insert("amttls".to_string(), json!(if params.use_tls { 1 } else { 0 }));

        let resp = self.send_action("addamtdevice", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "AMT device added".to_string());
        Ok(result)
    }

    /// Edit device properties.
    pub async fn edit_device(&self, params: McEditDevice) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(params.device_id));

        if let Some(ref name) = params.name {
            payload.insert("name".to_string(), json!(name));
        }
        if let Some(ref desc) = params.desc {
            payload.insert("desc".to_string(), json!(desc));
        }
        if let Some(ref tags) = params.tags {
            payload.insert("tags".to_string(), json!(tags));
        }
        if let Some(icon) = params.icon {
            payload.insert("icon".to_string(), json!(icon));
        }
        if let Some(consent) = params.consent {
            payload.insert("consent".to_string(), json!(consent));
        }

        let resp = self.send_action("changedevice", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Device updated".to_string());
        Ok(result)
    }

    /// Remove one or more devices.
    pub async fn remove_devices(&self, device_ids: Vec<String>) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeids".to_string(), json!(device_ids));

        let resp = self.send_action("removedevices", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Devices removed".to_string());
        Ok(result)
    }

    /// Move a device to a different device group.
    pub async fn move_device_to_group(
        &self,
        device_id: &str,
        group_id: Option<&str>,
        group_name: Option<&str>,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeids".to_string(), json!([device_id]));

        if let Some(gid) = group_id {
            payload.insert("meshid".to_string(), json!(gid));
        } else if let Some(gname) = group_name {
            payload.insert("meshname".to_string(), json!(gname));
        } else {
            return Err(MeshCentralError::InvalidParameter(
                "Either group_id or group_name must be provided".to_string(),
            ));
        }

        let resp = self.send_action("changeDeviceMesh", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Device moved".to_string());
        Ok(result)
    }

    /// Add a user to a device with specific rights.
    pub async fn add_user_to_device(
        &self,
        params: McAddUserToDevice,
    ) -> MeshCentralResult<String> {
        let rights = if params.full_rights {
            (8 + 16 + 32 + 64 + 128 + 16384 + 32768) as u64
        } else {
            params.rights.unwrap_or(0)
        };

        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(params.device_id));
        payload.insert("usernames".to_string(), json!([params.user_id]));
        payload.insert("rights".to_string(), json!(rights));

        let resp = self.send_action("adddeviceuser", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User added to device".to_string());
        Ok(result)
    }

    /// Remove a user from a device.
    pub async fn remove_user_from_device(
        &self,
        device_id: &str,
        user_id: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));
        payload.insert("usernames".to_string(), json!([user_id]));
        payload.insert("rights".to_string(), json!(0));
        payload.insert("remove".to_string(), json!(true));

        let resp = self.send_action("adddeviceuser", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User removed from device".to_string());
        Ok(result)
    }
}

/// Check if a device matches a text filter.
fn device_matches_filter(dev: &McDevice, filter: &str) -> bool {
    let lower = filter.to_lowercase();

    // Check prefixed filters
    if let Some(rest) = lower.strip_prefix("user:").or_else(|| lower.strip_prefix("u:")) {
        if let Some(ref users) = dev.users {
            return users
                .iter()
                .any(|u| u.to_lowercase().contains(rest));
        }
        return false;
    }
    if let Some(rest) = lower.strip_prefix("ip:") {
        if let Some(ref ip) = dev.ip {
            return ip.contains(rest);
        }
        return false;
    }
    if let Some(rest) = lower.strip_prefix("tag:").or_else(|| lower.strip_prefix("t:")) {
        if let Some(ref tags) = dev.tags {
            return tags
                .iter()
                .any(|t| t.to_lowercase().contains(rest));
        }
        return false;
    }
    if let Some(rest) = lower.strip_prefix("os:") {
        if let Some(ref os) = dev.osdesc {
            return os.to_lowercase().contains(rest);
        }
        return false;
    }
    if let Some(rest) = lower.strip_prefix("desc:") {
        if let Some(ref desc) = dev.desc {
            return desc.to_lowercase().contains(rest);
        }
        return false;
    }

    // Default: match device name
    dev.name.to_lowercase().contains(&lower)
}
