//! User management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct UserManager;

impl UserManager {
    /// Get all user accounts (Redfish only).
    pub async fn get_users(client: &SmcClient) -> SmcResult<Vec<UserAccount>> {
        let rf = client.require_redfish()?;
        rf.get_users().await
    }

    /// Create a new user account (Redfish only).
    pub async fn create_user(
        client: &SmcClient,
        username: &str,
        password: &str,
        role: &str,
    ) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.create_user(username, password, role).await
    }

    /// Update a user's password (Redfish only).
    pub async fn update_password(
        client: &SmcClient,
        user_id: &str,
        new_password: &str,
    ) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.update_password(user_id, new_password).await
    }

    /// Delete a user account (Redfish only).
    pub async fn delete_user(client: &SmcClient, user_id: &str) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.delete_user(user_id).await
    }
}
