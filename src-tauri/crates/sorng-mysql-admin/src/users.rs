// ── sorng-mysql-admin – user management ──────────────────────────────────────
//! MySQL user and privilege administration via SSH.

use crate::client::MysqlClient;
use crate::error::{MysqlError, MysqlResult};
use crate::types::*;

pub struct UserManager;

impl UserManager {
    /// List all MySQL users.
    pub async fn list(client: &MysqlClient) -> MysqlResult<Vec<MysqlUser>> {
        let sql = "SELECT User, Host, plugin, \
                   IF(account_locked='Y',1,0), \
                   IF(password_expired='Y',1,0), \
                   max_connections, ssl_type \
                   FROM mysql.user ORDER BY User, Host";
        let out = client.exec_sql(sql).await?;
        let mut users = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 7 {
                users.push(MysqlUser {
                    user: cols[0].to_string(),
                    host: cols[1].to_string(),
                    plugin: cols[2].to_string(),
                    account_locked: cols[3] == "1",
                    password_expired: cols[4] == "1",
                    max_connections: cols[5].parse().unwrap_or(0),
                    ssl_type: cols[6].to_string(),
                });
            }
        }
        Ok(users)
    }

    /// Get a specific user.
    pub async fn get(client: &MysqlClient, user: &str, host: &str) -> MysqlResult<MysqlUser> {
        let sql = format!(
            "SELECT User, Host, plugin, \
             IF(account_locked='Y',1,0), \
             IF(password_expired='Y',1,0), \
             max_connections, ssl_type \
             FROM mysql.user WHERE User='{}' AND Host='{}'",
            sql_escape(user),
            sql_escape(host)
        );
        let out = client.exec_sql(&sql).await?;
        let line = out.lines().next()
            .ok_or_else(|| MysqlError::user_not_found(user, host))?;
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 7 {
            return Err(MysqlError::parse("unexpected column count for user query"));
        }
        Ok(MysqlUser {
            user: cols[0].to_string(),
            host: cols[1].to_string(),
            plugin: cols[2].to_string(),
            account_locked: cols[3] == "1",
            password_expired: cols[4] == "1",
            max_connections: cols[5].parse().unwrap_or(0),
            ssl_type: cols[6].to_string(),
        })
    }

    /// Create a new MySQL user.
    pub async fn create(
        client: &MysqlClient,
        user: &str,
        host: &str,
        password: &str,
        plugin: Option<&str>,
    ) -> MysqlResult<()> {
        let auth = match plugin {
            Some(p) => format!(
                "CREATE USER '{}'@'{}' IDENTIFIED WITH {} BY '{}'",
                sql_escape(user), sql_escape(host), p, sql_escape(password)
            ),
            None => format!(
                "CREATE USER '{}'@'{}' IDENTIFIED BY '{}'",
                sql_escape(user), sql_escape(host), sql_escape(password)
            ),
        };
        client.exec_sql(&auth).await?;
        Ok(())
    }

    /// Drop a MySQL user.
    pub async fn drop(client: &MysqlClient, user: &str, host: &str) -> MysqlResult<()> {
        let sql = format!("DROP USER '{}'@'{}'", sql_escape(user), sql_escape(host));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Rename a MySQL user.
    pub async fn rename(
        client: &MysqlClient,
        old_user: &str,
        old_host: &str,
        new_user: &str,
        new_host: &str,
    ) -> MysqlResult<()> {
        let sql = format!(
            "RENAME USER '{}'@'{}' TO '{}'@'{}'",
            sql_escape(old_user), sql_escape(old_host),
            sql_escape(new_user), sql_escape(new_host)
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Set a user's password.
    pub async fn set_password(
        client: &MysqlClient,
        user: &str,
        host: &str,
        password: &str,
    ) -> MysqlResult<()> {
        let sql = format!(
            "ALTER USER '{}'@'{}' IDENTIFIED BY '{}'",
            sql_escape(user), sql_escape(host), sql_escape(password)
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Lock a user account.
    pub async fn lock(client: &MysqlClient, user: &str, host: &str) -> MysqlResult<()> {
        let sql = format!(
            "ALTER USER '{}'@'{}' ACCOUNT LOCK",
            sql_escape(user), sql_escape(host)
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Unlock a user account.
    pub async fn unlock(client: &MysqlClient, user: &str, host: &str) -> MysqlResult<()> {
        let sql = format!(
            "ALTER USER '{}'@'{}' ACCOUNT UNLOCK",
            sql_escape(user), sql_escape(host)
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// List grants for a specific user.
    pub async fn list_grants(
        client: &MysqlClient,
        user: &str,
        host: &str,
    ) -> MysqlResult<Vec<MysqlGrant>> {
        let sql = format!("SHOW GRANTS FOR '{}'@'{}'", sql_escape(user), sql_escape(host));
        let out = client.exec_sql(&sql).await?;
        let mut grants = Vec::new();
        for line in out.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Parse GRANT statements into structured data
            grants.push(MysqlGrant {
                user: user.to_string(),
                host: host.to_string(),
                privilege: trimmed.to_string(),
                database: "*".to_string(),
                table_name: "*".to_string(),
                is_grantable: trimmed.contains("WITH GRANT OPTION"),
            });
        }
        Ok(grants)
    }

    /// Grant a privilege.
    pub async fn grant(
        client: &MysqlClient,
        privilege: &str,
        database: &str,
        table: &str,
        user: &str,
        host: &str,
        with_grant: bool,
    ) -> MysqlResult<()> {
        let grant_option = if with_grant { " WITH GRANT OPTION" } else { "" };
        let sql = format!(
            "GRANT {} ON {}.{} TO '{}'@'{}'{}",
            privilege, database, table,
            sql_escape(user), sql_escape(host), grant_option
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Revoke a privilege.
    pub async fn revoke(
        client: &MysqlClient,
        privilege: &str,
        database: &str,
        table: &str,
        user: &str,
        host: &str,
    ) -> MysqlResult<()> {
        let sql = format!(
            "REVOKE {} ON {}.{} FROM '{}'@'{}'",
            privilege, database, table,
            sql_escape(user), sql_escape(host)
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Flush privileges.
    pub async fn flush_privileges(client: &MysqlClient) -> MysqlResult<()> {
        client.exec_sql("FLUSH PRIVILEGES").await?;
        Ok(())
    }
}

/// Escape single quotes in SQL string values.
fn sql_escape(s: &str) -> String {
    s.replace('\'', "\\'").replace('\\', "\\\\")
}
