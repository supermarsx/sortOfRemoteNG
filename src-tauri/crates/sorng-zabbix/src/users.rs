// ── sorng-zabbix/src/users.rs ────────────────────────────────────────────────
//! User management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::{json, Value};

pub struct UserManager;

impl UserManager {
    /// Retrieve users.  method: user.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixUser>, ZabbixError> {
        client.request_typed("user.get", params).await
    }

    /// Create a user.  method: user.create
    pub async fn create(
        client: &ZabbixClient,
        user: &ZabbixUser,
    ) -> Result<Value, ZabbixError> {
        client.request("user.create", user).await
    }

    /// Update a user.  method: user.update
    pub async fn update(
        client: &ZabbixClient,
        user: &ZabbixUser,
    ) -> Result<Value, ZabbixError> {
        client.request("user.update", user).await
    }

    /// Delete users by IDs.  method: user.delete
    pub async fn delete(
        client: &ZabbixClient,
        userids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("user.delete", userids).await
    }

    /// Authenticate a user.  method: user.login
    pub async fn login(
        client: &ZabbixClient,
        username: &str,
        password: &str,
    ) -> Result<String, ZabbixError> {
        let result = client
            .request("user.login", json!({"username": username, "password": password}))
            .await?;
        result
            .as_str()
            .map(String::from)
            .ok_or_else(|| ZabbixError::AuthenticationFailed("login did not return token".into()))
    }

    /// Log out the current session.  method: user.logout
    pub async fn logout(client: &ZabbixClient) -> Result<Value, ZabbixError> {
        client.request("user.logout", json!([])).await
    }
}
