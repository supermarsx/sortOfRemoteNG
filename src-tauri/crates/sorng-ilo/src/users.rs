//! User account management — CRUD operations on iLO local accounts.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// User management operations.
pub struct UserManager<'a> {
    client: &'a IloClient,
}

impl<'a> UserManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get all user accounts.
    pub async fn get_users(&self) -> IloResult<Vec<BmcUser>> {
        if let Ok(rf) = self.client.require_redfish() {
            let accounts: Vec<serde_json::Value> = rf.get_accounts().await?;
            let mut users = Vec::new();

            for acct in &accounts {
                let username = acct.get("UserName").and_then(|v| v.as_str()).unwrap_or("");
                if username.is_empty() {
                    continue;
                }

                let oem = acct
                    .get("Oem")
                    .and_then(|o| o.get("Hpe").or_else(|| o.get("Hp")));
                let _ = oem; // OEM data available for HP-specific privileges

                users.push(BmcUser {
                    id: acct
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    username: username.to_string(),
                    role: acct
                        .get("RoleId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("ReadOnly")
                        .to_string(),
                    enabled: acct
                        .get("Enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true),
                    locked: acct
                        .get("Locked")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                });
            }
            return Ok(users);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let data = ribcl.get_all_users().await?;
            let mut users = Vec::new();

            if let Some(arr) = data.as_array() {
                for user in arr {
                    let username = user.get("USER_NAME").and_then(|v| v.as_str()).unwrap_or("");
                    if username.is_empty() {
                        continue;
                    }

                    users.push(BmcUser {
                        id: user
                            .get("USER_LOGIN")
                            .and_then(|v| v.as_str())
                            .unwrap_or(username)
                            .to_string(),
                        username: username.to_string(),
                        role: "Unknown".to_string(),
                        enabled: true,
                        locked: false,
                    });
                }
            }
            return Ok(users);
        }

        Err(IloError::unsupported(
            "No protocol available for user management",
        ))
    }

    /// Create a new user account.
    pub async fn create_user(&self, username: &str, password: &str, role: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({
            "UserName": username,
            "Password": password,
            "RoleId": role,
        });
        rf.inner
            .post_json::<_, ()>("/redfish/v1/AccountService/Accounts", &body)
            .await?;
        Ok(())
    }

    /// Update an existing user's password.
    pub async fn update_password(&self, user_id: &str, new_password: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let path = format!("/redfish/v1/AccountService/Accounts/{}", user_id);
        let body = serde_json::json!({ "Password": new_password });
        rf.inner.patch_json(&path, &body).await?;
        Ok(())
    }

    /// Delete a user account.
    pub async fn delete_user(&self, user_id: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let path = format!("/redfish/v1/AccountService/Accounts/{}", user_id);
        rf.inner.delete(&path).await?;
        Ok(())
    }

    /// Enable or disable a user account.
    pub async fn set_user_enabled(&self, user_id: &str, enabled: bool) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let path = format!("/redfish/v1/AccountService/Accounts/{}", user_id);
        let body = serde_json::json!({ "Enabled": enabled });
        rf.inner.patch_json(&path, &body).await?;
        Ok(())
    }
}
