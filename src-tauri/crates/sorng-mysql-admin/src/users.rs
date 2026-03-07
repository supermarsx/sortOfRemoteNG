// ── sorng-mysql-admin – user management ──────────────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::{MysqlAdminError, MysqlAdminResult};
use crate::types::*;

pub struct UserManager;

impl UserManager {
    pub async fn list(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<MysqlUser>> {
        let out = client.exec_mysql(
            "SELECT User, Host, plugin, authentication_string, ssl_type, \
             max_connections, max_user_connections, account_locked, password_expired, password_lifetime \
             FROM mysql.user"
        ).await?;
        let mut users = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let c: Vec<&str> = line.split('\t').collect();
            if c.len() >= 2 {
                users.push(MysqlUser {
                    user: c[0].to_string(),
                    host: c[1].to_string(),
                    plugin: c.get(2).map(|s| s.to_string()),
                    authentication_string: c.get(3).map(|s| s.to_string()),
                    ssl_type: c.get(4).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    max_connections: c.get(5).and_then(|s| s.parse().ok()),
                    max_user_connections: c.get(6).and_then(|s| s.parse().ok()),
                    account_locked: c.get(7).map(|s| s == "Y"),
                    password_expired: c.get(8).map(|s| s == "Y"),
                    password_lifetime: c.get(9).and_then(|s| s.parse().ok()),
                });
            }
        }
        Ok(users)
    }

    pub async fn get(client: &MysqlAdminClient, user: &str, host: &str) -> MysqlAdminResult<MysqlUser> {
        let out = client.exec_mysql(&format!(
            "SELECT User, Host, plugin, authentication_string, ssl_type, \
             max_connections, max_user_connections, account_locked, password_expired, password_lifetime \
             FROM mysql.user WHERE User='{}' AND Host='{}'", user, host
        )).await?;
        let line = out.lines().find(|l| !l.is_empty())
            .ok_or_else(|| MysqlAdminError::user_not_found(user))?;
        let c: Vec<&str> = line.split('\t').collect();
        Ok(MysqlUser {
            user: c.first().map(|s| s.to_string()).unwrap_or_default(),
            host: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
            plugin: c.get(2).map(|s| s.to_string()),
            authentication_string: c.get(3).map(|s| s.to_string()),
            ssl_type: c.get(4).filter(|s| !s.is_empty()).map(|s| s.to_string()),
            max_connections: c.get(5).and_then(|s| s.parse().ok()),
            max_user_connections: c.get(6).and_then(|s| s.parse().ok()),
            account_locked: c.get(7).map(|s| s == "Y"),
            password_expired: c.get(8).map(|s| s == "Y"),
            password_lifetime: c.get(9).and_then(|s| s.parse().ok()),
        })
    }

    pub async fn create(client: &MysqlAdminClient, req: &CreateUserRequest) -> MysqlAdminResult<()> {
        let mut sql = format!("CREATE USER '{}'@'{}' IDENTIFIED", req.user, req.host);
        if let Some(ref plugin) = req.plugin {
            sql.push_str(&format!(" WITH {} BY '{}'", plugin, req.password));
        } else {
            sql.push_str(&format!(" BY '{}'", req.password));
        }
        if let Some(mc) = req.max_connections {
            sql.push_str(&format!(" WITH MAX_CONNECTIONS_PER_HOUR {}", mc));
        }
        if let Some(muc) = req.max_user_connections {
            sql.push_str(&format!(" MAX_USER_CONNECTIONS {}", muc));
        }
        client.exec_mysql(&sql).await?;
        Ok(())
    }

    pub async fn alter(client: &MysqlAdminClient, user: &str, host: &str, req: &AlterUserRequest) -> MysqlAdminResult<()> {
        let mut parts = Vec::new();
        if let Some(ref pw) = req.password {
            parts.push(format!("IDENTIFIED BY '{}'", pw));
        }
        if let Some(locked) = req.account_locked {
            parts.push(if locked { "ACCOUNT LOCK".to_string() } else { "ACCOUNT UNLOCK".to_string() });
        }
        if let Some(expired) = req.password_expired {
            if expired {
                parts.push("PASSWORD EXPIRE".to_string());
            }
        }
        if let Some(mc) = req.max_connections {
            parts.push(format!("WITH MAX_CONNECTIONS_PER_HOUR {}", mc));
        }
        if !parts.is_empty() {
            let sql = format!("ALTER USER '{}'@'{}' {}", user, host, parts.join(" "));
            client.exec_mysql(&sql).await?;
        }
        Ok(())
    }

    pub async fn drop(client: &MysqlAdminClient, user: &str, host: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("DROP USER '{}'@'{}'", user, host)).await?;
        Ok(())
    }

    pub async fn list_grants(client: &MysqlAdminClient, user: &str, host: &str) -> MysqlAdminResult<Vec<MysqlGrant>> {
        let out = client.exec_mysql(&format!("SHOW GRANTS FOR '{}'@'{}'", user, host)).await?;
        let grants = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let line = l.to_string();
                let is_grantable = line.contains("WITH GRANT OPTION");
                MysqlGrant {
                    privilege: line.clone(),
                    database: None,
                    table_name: None,
                    column_name: None,
                    is_grantable,
                }
            })
            .collect();
        Ok(grants)
    }

    pub async fn grant(client: &MysqlAdminClient, req: &GrantRequest) -> MysqlAdminResult<()> {
        let privs = req.privileges.join(", ");
        let target = match (&req.database, &req.table_name) {
            (Some(db), Some(tbl)) => format!("`{}`.`{}`", db, tbl),
            (Some(db), None) => format!("`{}`.*", db),
            _ => "*.*".to_string(),
        };
        let mut sql = format!("GRANT {} ON {} TO '{}'@'{}'", privs, target, req.user, req.host);
        if req.with_grant_option == Some(true) {
            sql.push_str(" WITH GRANT OPTION");
        }
        client.exec_mysql(&sql).await?;
        Ok(())
    }

    pub async fn revoke(client: &MysqlAdminClient, req: &RevokeRequest) -> MysqlAdminResult<()> {
        let privs = req.privileges.join(", ");
        let target = match (&req.database, &req.table_name) {
            (Some(db), Some(tbl)) => format!("`{}`.`{}`", db, tbl),
            (Some(db), None) => format!("`{}`.*", db),
            _ => "*.*".to_string(),
        };
        client.exec_mysql(&format!(
            "REVOKE {} ON {} FROM '{}'@'{}'", privs, target, req.user, req.host
        )).await?;
        Ok(())
    }

    pub async fn flush_privileges(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("FLUSH PRIVILEGES").await?;
        Ok(())
    }

    pub async fn set_password(client: &MysqlAdminClient, user: &str, host: &str, password: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!(
            "ALTER USER '{}'@'{}' IDENTIFIED BY '{}'", user, host, password
        )).await?;
        Ok(())
    }

    pub async fn lock_account(client: &MysqlAdminClient, user: &str, host: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("ALTER USER '{}'@'{}' ACCOUNT LOCK", user, host)).await?;
        Ok(())
    }

    pub async fn unlock_account(client: &MysqlAdminClient, user: &str, host: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("ALTER USER '{}'@'{}' ACCOUNT UNLOCK", user, host)).await?;
        Ok(())
    }
}
