//! User group management — create, remove, add/remove members.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// List all user groups.
    pub async fn list_user_groups(&self) -> MeshCentralResult<Vec<McUserGroup>> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("usergroups", payload).await?;

        let mut groups = Vec::new();
        if let Some(ugroups) = resp.get("ugroups") {
            if let Some(obj) = ugroups.as_object() {
                for (_id, group_val) in obj {
                    if let Ok(group) =
                        serde_json::from_value::<McUserGroup>(group_val.clone())
                    {
                        groups.push(group);
                    }
                }
            }
        }

        Ok(groups)
    }

    /// Create a new user group.
    pub async fn create_user_group(
        &self,
        name: &str,
        desc: Option<&str>,
        domain: Option<&str>,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("name".to_string(), json!(name));
        if let Some(d) = desc {
            payload.insert("desc".to_string(), json!(d));
        }
        if let Some(dom) = domain {
            payload.insert("domain".to_string(), json!(dom));
        }

        let resp = self.send_action("createusergroup", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User group created".to_string());
        Ok(result)
    }

    /// Remove a user group.
    pub async fn remove_user_group(
        &self,
        group_id: &str,
        domain: Option<&str>,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        let mut ugrpid = group_id.to_string();
        if let Some(d) = domain {
            if !ugrpid.contains('/') {
                ugrpid = format!("ugrp/{}/{}", d, ugrpid);
            }
        }
        payload.insert("ugrpid".to_string(), json!(ugrpid));

        let resp = self.send_action("deleteusergroup", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User group removed".to_string());
        Ok(result)
    }

    /// Add an entity (user, device, or device group) to a user group.
    ///
    /// The `id` can be:
    /// - `user/domain/username` for a user
    /// - `node/domain/nodeid` for a device
    /// - `mesh/domain/meshid` for a device group
    pub async fn add_to_user_group(
        &self,
        group_id: &str,
        id: &str,
        rights: Option<u64>,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        if id.starts_with("user/") {
            // Add user to user group
            let username = id.split('/').nth(2).unwrap_or(id);
            payload.insert("ugrpid".to_string(), json!(group_id));
            payload.insert("usernames".to_string(), json!([username]));

            let resp = self
                .send_action("addusertousergroup", payload)
                .await?;
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "User added to user group".to_string());
            Ok(result)
        } else if id.starts_with("mesh/") {
            // Add device group to user group
            let r = rights.unwrap_or(0);
            payload.insert("meshid".to_string(), json!(id));
            payload.insert("userid".to_string(), json!(group_id));
            payload.insert("meshadmin".to_string(), json!(r));

            let resp = self.send_action("addmeshuser", payload).await?;
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "Device group added to user group".to_string());
            Ok(result)
        } else if id.starts_with("node/") {
            // Add device to user group
            let r = rights.unwrap_or(0);
            payload.insert("nodeid".to_string(), json!(id));
            payload.insert("userids".to_string(), json!([group_id]));
            payload.insert("rights".to_string(), json!(r));

            let resp = self.send_action("adddeviceuser", payload).await?;
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "Device added to user group".to_string());
            Ok(result)
        } else {
            Err(MeshCentralError::InvalidParameter(format!(
                "Unknown entity type for id: {}. Must start with user/, mesh/, or node/",
                id
            )))
        }
    }

    /// Remove an entity from a user group.
    pub async fn remove_from_user_group(
        &self,
        group_id: &str,
        id: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        if id.starts_with("user/") {
            payload.insert("ugrpid".to_string(), json!(group_id));
            payload.insert("userid".to_string(), json!(id));

            let resp = self
                .send_action("removeuserfromusergroup", payload)
                .await?;
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "User removed from user group".to_string());
            Ok(result)
        } else if id.starts_with("mesh/") {
            payload.insert("meshid".to_string(), json!(id));
            payload.insert("userid".to_string(), json!(group_id));

            let resp = self.send_action("removemeshuser", payload).await?;
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "Device group removed from user group".to_string());
            Ok(result)
        } else if id.starts_with("node/") {
            payload.insert("nodeid".to_string(), json!(id));
            payload.insert("userids".to_string(), json!([group_id]));
            payload.insert("rights".to_string(), json!(0));
            payload.insert("remove".to_string(), json!(true));

            let resp = self.send_action("adddeviceuser", payload).await?;
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "Device removed from user group".to_string());
            Ok(result)
        } else {
            Err(MeshCentralError::InvalidParameter(format!(
                "Unknown entity type for id: {}",
                id
            )))
        }
    }

    /// Remove all users from a user group.
    pub async fn remove_all_users_from_user_group(
        &self,
        group_id: &str,
    ) -> MeshCentralResult<u32> {
        let groups = self.list_user_groups().await?;

        let target = groups.iter().find(|g| g.id == group_id);
        let target = match target {
            Some(g) => g,
            None => {
                return Err(MeshCentralError::UserGroupNotFound(
                    group_id.to_string(),
                ))
            }
        };

        let mut count = 0u32;
        if let Some(ref links) = target.links {
            for user_id in links.keys() {
                if user_id.starts_with("user/") {
                    let mut payload = serde_json::Map::new();
                    payload.insert("ugrpid".to_string(), json!(group_id));
                    payload.insert("userid".to_string(), json!(user_id));
                    let _ = self
                        .send_action("removeuserfromusergroup", payload)
                        .await;
                    count += 1;
                }
            }
        }

        Ok(count)
    }
}
