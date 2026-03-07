// ── cPanel database management ───────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct DatabaseManager;

impl DatabaseManager {
    // ── MySQL databases ──────────────────────────────────────────────

    /// List MySQL databases for a user.
    pub async fn list_mysql_dbs(client: &CpanelClient, user: &str) -> CpanelResult<Vec<CpanelDatabase>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "list_databases", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create a MySQL database.
    pub async fn create_mysql_db(client: &CpanelClient, user: &str, name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "create_database", &[("name", name)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("MySQL database {name} created"))
    }

    /// Delete a MySQL database.
    pub async fn delete_mysql_db(client: &CpanelClient, user: &str, name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "delete_database", &[("name", name)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("MySQL database {name} deleted"))
    }

    /// List MySQL users for a cPanel user.
    pub async fn list_mysql_users(client: &CpanelClient, user: &str) -> CpanelResult<Vec<DatabaseUser>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "list_users", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create a MySQL user.
    pub async fn create_mysql_user(client: &CpanelClient, user: &str, db_user: &str, password: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Mysql",
                "create_user",
                &[("name", db_user), ("password", password)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("MySQL user {db_user} created"))
    }

    /// Delete a MySQL user.
    pub async fn delete_mysql_user(client: &CpanelClient, user: &str, db_user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "delete_user", &[("name", db_user)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("MySQL user {db_user} deleted"))
    }

    /// Grant privileges on a MySQL database to a user.
    pub async fn grant_mysql_privileges(
        client: &CpanelClient,
        user: &str,
        db_user: &str,
        db: &str,
        privileges: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Mysql",
                "set_privileges_on_database",
                &[
                    ("user", db_user),
                    ("database", db),
                    ("privileges", privileges),
                ],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Privileges granted on {db} for {db_user}"))
    }

    /// Revoke all privileges on a database from a user.
    pub async fn revoke_mysql_privileges(
        client: &CpanelClient,
        user: &str,
        db_user: &str,
        db: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Mysql",
                "revoke_access_to_database",
                &[("user", db_user), ("database", db)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Privileges revoked on {db} for {db_user}"))
    }

    /// Get privileges for a user on a database.
    pub async fn get_mysql_privileges(
        client: &CpanelClient,
        user: &str,
        db_user: &str,
        db: &str,
    ) -> CpanelResult<DatabasePrivileges> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Mysql",
                "get_privileges_on_database",
                &[("user", db_user), ("database", db)],
            )
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    // ── PostgreSQL databases ─────────────────────────────────────────

    /// List PostgreSQL databases for a user.
    pub async fn list_pgsql_dbs(client: &CpanelClient, user: &str) -> CpanelResult<Vec<CpanelDatabase>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Postgresql", "list_databases", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create a PostgreSQL database.
    pub async fn create_pgsql_db(client: &CpanelClient, user: &str, name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Postgresql", "create_database", &[("name", name)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("PostgreSQL database {name} created"))
    }

    /// Delete a PostgreSQL database.
    pub async fn delete_pgsql_db(client: &CpanelClient, user: &str, name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Postgresql", "delete_database", &[("name", name)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("PostgreSQL database {name} deleted"))
    }

    /// List PostgreSQL users.
    pub async fn list_pgsql_users(client: &CpanelClient, user: &str) -> CpanelResult<Vec<DatabaseUser>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Postgresql", "list_users", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create a PostgreSQL user.
    pub async fn create_pgsql_user(client: &CpanelClient, user: &str, db_user: &str, password: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Postgresql",
                "create_user",
                &[("name", db_user), ("password", password)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("PostgreSQL user {db_user} created"))
    }

    /// Delete a PostgreSQL user.
    pub async fn delete_pgsql_user(client: &CpanelClient, user: &str, db_user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Postgresql", "delete_user", &[("name", db_user)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("PostgreSQL user {db_user} deleted"))
    }

    // ── Remote MySQL ─────────────────────────────────────────────────

    /// List remote MySQL access hosts.
    pub async fn list_remote_mysql_hosts(client: &CpanelClient, user: &str) -> CpanelResult<Vec<String>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "get_host_notes", &[])
            .await?;
        let data = extract_data(&raw)?;
        if let Some(arr) = data.as_array() {
            Ok(arr
                .iter()
                .filter_map(|v| v.get("host").and_then(|h| h.as_str()).map(String::from))
                .collect())
        } else {
            Ok(vec![])
        }
    }

    /// Add a remote MySQL access host.
    pub async fn add_remote_mysql_host(client: &CpanelClient, user: &str, host: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "add_host", &[("host", host)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Remote MySQL host {host} added"))
    }

    /// Remove a remote MySQL access host.
    pub async fn remove_remote_mysql_host(client: &CpanelClient, user: &str, host: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Mysql", "delete_host", &[("host", host)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Remote MySQL host {host} removed"))
    }
}

fn extract_data(raw: &serde_json::Value) -> CpanelResult<serde_json::Value> {
    check_uapi(raw)?;
    Ok(raw
        .get("result")
        .and_then(|r| r.get("data"))
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![])))
}

fn check_uapi(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("result")
        .and_then(|r| r.get("status"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let errors = raw
            .get("result")
            .and_then(|r| r.get("errors"))
            .and_then(|e| e.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_else(|| "API call failed".into());
        return Err(CpanelError::api(errors));
    }
    Ok(())
}
