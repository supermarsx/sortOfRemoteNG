//! Device group (mesh) management — create, edit, remove, list, user permissions.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// List all device groups (meshes).
    pub async fn list_device_groups(&self) -> MeshCentralResult<Vec<McDeviceGroup>> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("meshes", payload).await?;

        let mut groups = Vec::new();
        if let Some(meshes) = resp.get("meshes") {
            if let Some(arr) = meshes.as_array() {
                for mesh_val in arr {
                    if let Ok(group) =
                        serde_json::from_value::<McDeviceGroup>(mesh_val.clone())
                    {
                        groups.push(group);
                    }
                }
            } else if let Some(obj) = meshes.as_object() {
                // Some responses return meshes as an object keyed by id
                for (_id, mesh_val) in obj {
                    if let Ok(group) =
                        serde_json::from_value::<McDeviceGroup>(mesh_val.clone())
                    {
                        groups.push(group);
                    }
                }
            }
        }

        Ok(groups)
    }

    /// Create a new device group.
    pub async fn create_device_group(
        &self,
        params: McCreateDeviceGroup,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("meshname".to_string(), json!(params.name));
        payload.insert("meshtype".to_string(), json!(params.mesh_type));

        if let Some(ref desc) = params.desc {
            payload.insert("desc".to_string(), json!(desc));
        }
        if let Some(features) = params.features {
            payload.insert("flags".to_string(), json!(features));
        }
        if let Some(consent) = params.consent {
            payload.insert("consent".to_string(), json!(consent));
        }

        let resp = self.send_action("createmesh", payload).await?;

        // Response may contain the new mesh id
        if let Some(meshid) = resp.get("meshid").and_then(|v| v.as_str()) {
            Ok(meshid.to_string())
        } else {
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "Device group created".to_string());
            Ok(result)
        }
    }

    /// Edit a device group.
    pub async fn edit_device_group(
        &self,
        params: McEditDeviceGroup,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        if let Some(ref gid) = params.group_id {
            payload.insert("meshid".to_string(), json!(gid));
        } else if let Some(ref gname) = params.group_name {
            payload.insert("meshidname".to_string(), json!(gname));
        } else {
            return Err(MeshCentralError::InvalidParameter(
                "Either group_id or group_name required".to_string(),
            ));
        }

        if let Some(ref name) = params.name {
            payload.insert("meshname".to_string(), json!(name));
        }
        if let Some(ref desc) = params.desc {
            payload.insert("desc".to_string(), json!(desc));
        }
        if let Some(flags) = params.flags {
            payload.insert("flags".to_string(), json!(flags));
        }
        if let Some(consent) = params.consent {
            payload.insert("consent".to_string(), json!(consent));
        }
        if let Some(ref codes) = params.invite_codes {
            if codes.is_empty() {
                payload.insert("invite".to_string(), json!("*"));
            } else {
                let mut invite = serde_json::Map::new();
                invite.insert("codes".to_string(), json!(codes));
                invite.insert(
                    "flags".to_string(),
                    json!(params.invite_flags.unwrap_or(0)),
                );
                payload.insert("invite".to_string(), serde_json::Value::Object(invite));
            }
        }

        let resp = self.send_action("editmesh", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Device group updated".to_string());
        Ok(result)
    }

    /// Remove a device group.
    pub async fn remove_device_group(
        &self,
        group_id: Option<&str>,
        group_name: Option<&str>,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        if let Some(gid) = group_id {
            payload.insert("meshid".to_string(), json!(gid));
        } else if let Some(gname) = group_name {
            payload.insert("meshname".to_string(), json!(gname));
        } else {
            return Err(MeshCentralError::InvalidParameter(
                "Either group_id or group_name required".to_string(),
            ));
        }

        let resp = self.send_action("deletemesh", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Device group removed".to_string());
        Ok(result)
    }

    /// List users of a device group with their rights.
    pub async fn list_users_of_device_group(
        &self,
        group_id: &str,
    ) -> MeshCentralResult<Vec<(String, u64)>> {
        let groups = self.list_device_groups().await?;

        for group in &groups {
            let gid = &group.id;
            let gid_short = gid.split('/').last().unwrap_or(gid);
            if gid == group_id || gid_short == group_id || gid.contains(group_id) {
                let mut result = Vec::new();
                if let Some(ref links) = group.links {
                    for (user_id, link) in links {
                        result.push((user_id.clone(), link.rights.unwrap_or(0)));
                    }
                }
                return Ok(result);
            }
        }

        Err(MeshCentralError::DeviceGroupNotFound(
            group_id.to_string(),
        ))
    }

    /// Add a user to a device group with specific rights.
    pub async fn add_user_to_device_group(
        &self,
        params: McAddUserToDeviceGroup,
    ) -> MeshCentralResult<String> {
        let rights = if params.full_rights {
            0xFFFFFFFF_u64
        } else {
            params.rights.unwrap_or(0)
        };

        let mut payload = serde_json::Map::new();
        payload.insert("usernames".to_string(), json!([params.user_id]));
        payload.insert("meshadmin".to_string(), json!(rights));

        if let Some(ref gid) = params.group_id {
            payload.insert("meshid".to_string(), json!(gid));
        } else if let Some(ref gname) = params.group_name {
            payload.insert("meshname".to_string(), json!(gname));
        } else {
            return Err(MeshCentralError::InvalidParameter(
                "Either group_id or group_name required".to_string(),
            ));
        }

        let resp = self.send_action("addmeshuser", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User added to device group".to_string());
        Ok(result)
    }

    /// Remove a user from a device group.
    pub async fn remove_user_from_device_group(
        &self,
        group_id: Option<&str>,
        group_name: Option<&str>,
        user_id: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("userid".to_string(), json!(user_id));

        if let Some(gid) = group_id {
            payload.insert("meshid".to_string(), json!(gid));
        } else if let Some(gname) = group_name {
            payload.insert("meshname".to_string(), json!(gname));
        } else {
            return Err(MeshCentralError::InvalidParameter(
                "Either group_id or group_name required".to_string(),
            ));
        }

        let resp = self.send_action("removemeshuser", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User removed from device group".to_string());
        Ok(result)
    }
}
