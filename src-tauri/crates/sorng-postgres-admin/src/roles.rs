// ── sorng-postgres-admin/src/roles.rs ─────────────────────────────────────────
//! PostgreSQL role (user/group) management via pg_catalog queries.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::PgRole;

pub struct RoleManager;

impl RoleManager {
    /// List all roles from pg_roles.
    pub async fn list(client: &PgClient) -> PgResult<Vec<PgRole>> {
        let sql = r#"
            SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
                   r.rolcanlogin, r.rolreplication, r.rolinherit,
                   r.rolconnlimit,
                   COALESCE(r.rolvaliduntil::text, ''),
                   COALESCE(
                     (SELECT string_agg(g.rolname, ',')
                      FROM pg_auth_members m
                      JOIN pg_roles g ON g.oid = m.roleid
                      WHERE m.member = r.oid), ''),
                   COALESCE(
                     (SELECT string_agg(c.setconfig::text, '|')
                      FROM pg_db_role_setting c
                      WHERE c.setrole = r.oid), '')
            FROM pg_roles r
            ORDER BY r.rolname
        "#;
        let out = client.exec_sql(sql).await?;
        let mut roles = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(11, '|').collect();
            if cols.len() >= 11 {
                roles.push(PgRole {
                    name: cols[0].to_string(),
                    superuser: cols[1] == "t",
                    create_db: cols[2] == "t",
                    create_role: cols[3] == "t",
                    login: cols[4] == "t",
                    replication: cols[5] == "t",
                    inherit: cols[6] == "t",
                    connection_limit: cols[7].parse().unwrap_or(-1),
                    password_valid_until: if cols[8].is_empty() {
                        None
                    } else {
                        Some(cols[8].to_string())
                    },
                    member_of: cols[9]
                        .split(',')
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                        .collect(),
                    config: cols[10]
                        .split('|')
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                        .collect(),
                });
            }
        }
        Ok(roles)
    }

    /// Get a single role by name.
    pub async fn get(client: &PgClient, name: &str) -> PgResult<PgRole> {
        let roles = Self::list(client).await?;
        roles
            .into_iter()
            .find(|r| r.name == name)
            .ok_or_else(|| crate::error::PgError::role_not_found(name))
    }

    /// Create a new role.
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        client: &PgClient,
        name: &str,
        password: Option<&str>,
        superuser: bool,
        createdb: bool,
        createrole: bool,
        login: bool,
        replication: bool,
        connection_limit: Option<i32>,
    ) -> PgResult<()> {
        let mut opts = Vec::new();
        if superuser {
            opts.push("SUPERUSER");
        } else {
            opts.push("NOSUPERUSER");
        }
        if createdb {
            opts.push("CREATEDB");
        } else {
            opts.push("NOCREATEDB");
        }
        if createrole {
            opts.push("CREATEROLE");
        } else {
            opts.push("NOCREATEROLE");
        }
        if login {
            opts.push("LOGIN");
        } else {
            opts.push("NOLOGIN");
        }
        if replication {
            opts.push("REPLICATION");
        } else {
            opts.push("NOREPLICATION");
        }
        let mut sql = format!("CREATE ROLE \"{}\" {}", name, opts.join(" "));
        if let Some(pw) = password {
            sql.push_str(&format!(" PASSWORD '{}'", pw.replace('\'', "''")));
        }
        if let Some(limit) = connection_limit {
            sql.push_str(&format!(" CONNECTION LIMIT {}", limit));
        }
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Alter role attributes.
    #[allow(clippy::too_many_arguments)]
    pub async fn alter(
        client: &PgClient,
        name: &str,
        superuser: Option<bool>,
        createdb: Option<bool>,
        createrole: Option<bool>,
        login: Option<bool>,
        replication: Option<bool>,
        connection_limit: Option<i32>,
    ) -> PgResult<()> {
        let mut opts = Vec::new();
        if let Some(v) = superuser {
            opts.push(if v { "SUPERUSER" } else { "NOSUPERUSER" });
        }
        if let Some(v) = createdb {
            opts.push(if v { "CREATEDB" } else { "NOCREATEDB" });
        }
        if let Some(v) = createrole {
            opts.push(if v { "CREATEROLE" } else { "NOCREATEROLE" });
        }
        if let Some(v) = login {
            opts.push(if v { "LOGIN" } else { "NOLOGIN" });
        }
        if let Some(v) = replication {
            opts.push(if v { "REPLICATION" } else { "NOREPLICATION" });
        }
        if let Some(limit) = connection_limit {
            let fragment = format!("CONNECTION LIMIT {}", limit);
            let sql = format!("ALTER ROLE \"{}\" {} {}", name, opts.join(" "), fragment);
            client.exec_sql(&sql).await?;
        } else if !opts.is_empty() {
            let sql = format!("ALTER ROLE \"{}\" {}", name, opts.join(" "));
            client.exec_sql(&sql).await?;
        }
        Ok(())
    }

    /// Drop a role.
    pub async fn drop(client: &PgClient, name: &str) -> PgResult<()> {
        client.exec_sql(&format!("DROP ROLE \"{}\"", name)).await?;
        Ok(())
    }

    /// Rename a role.
    pub async fn rename(client: &PgClient, old_name: &str, new_name: &str) -> PgResult<()> {
        client
            .exec_sql(&format!(
                "ALTER ROLE \"{}\" RENAME TO \"{}\"",
                old_name, new_name
            ))
            .await?;
        Ok(())
    }

    /// Grant a role to a member.
    pub async fn grant_role(client: &PgClient, role: &str, member: &str) -> PgResult<()> {
        client
            .exec_sql(&format!("GRANT \"{}\" TO \"{}\"", role, member))
            .await?;
        Ok(())
    }

    /// Revoke a role from a member.
    pub async fn revoke_role(client: &PgClient, role: &str, member: &str) -> PgResult<()> {
        client
            .exec_sql(&format!("REVOKE \"{}\" FROM \"{}\"", role, member))
            .await?;
        Ok(())
    }

    /// Set password for a role.
    pub async fn set_password(
        client: &PgClient,
        name: &str,
        password: &str,
        valid_until: Option<&str>,
    ) -> PgResult<()> {
        let mut sql = format!(
            "ALTER ROLE \"{}\" PASSWORD '{}'",
            name,
            password.replace('\'', "''")
        );
        if let Some(until) = valid_until {
            sql.push_str(&format!(" VALID UNTIL '{}'", until.replace('\'', "''")));
        }
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// List memberships for a role.
    pub async fn list_role_memberships(client: &PgClient, name: &str) -> PgResult<Vec<String>> {
        let sql = format!(
            "SELECT g.rolname FROM pg_auth_members m \
             JOIN pg_roles g ON g.oid = m.roleid \
             JOIN pg_roles u ON u.oid = m.member \
             WHERE u.rolname = '{}' ORDER BY g.rolname",
            name.replace('\'', "''")
        );
        let out = client.exec_sql(&sql).await?;
        Ok(out
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }
}
