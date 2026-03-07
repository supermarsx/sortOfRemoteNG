// ── sorng-postgres-admin – role management ───────────────────────────────────
//! PostgreSQL role/user CRUD, membership, and privilege management.

use crate::client::PgAdminClient;
use crate::error::{PgAdminError, PgAdminResult};
use crate::types::*;

pub struct RoleManager;

impl RoleManager {
    /// List all roles.
    pub async fn list(client: &PgAdminClient) -> PgAdminResult<Vec<PgRole>> {
        let raw = client.exec_psql(
            "SELECT r.oid, r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, \
             r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls, \
             r.rolconnlimit, r.rolvaliduntil::text, \
             COALESCE(array_agg(m.rolname) FILTER (WHERE m.rolname IS NOT NULL), '{}'), \
             COALESCE(array_to_string(r.rolconfig, ','), '') \
             FROM pg_roles r \
             LEFT JOIN pg_auth_members am ON am.member = r.oid \
             LEFT JOIN pg_roles m ON m.oid = am.roleid \
             GROUP BY r.oid, r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, \
             r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls, \
             r.rolconnlimit, r.rolvaliduntil, r.rolconfig \
             ORDER BY r.rolname;"
        ).await?;

        let mut roles = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(13, '|').collect();
            if c.len() < 13 { continue; }
            roles.push(PgRole {
                oid: c[0].trim().parse().unwrap_or(0),
                rolname: c[1].trim().to_string(),
                rolsuper: c[2].trim() == "t",
                rolinherit: c[3].trim() == "t",
                rolcreaterole: c[4].trim() == "t",
                rolcreatedb: c[5].trim() == "t",
                rolcanlogin: c[6].trim() == "t",
                rolreplication: c[7].trim() == "t",
                rolbypassrls: c[8].trim() == "t",
                rolconnlimit: c[9].trim().parse().unwrap_or(-1),
                rolvaliduntil: non_empty(c[10]),
                memberof: parse_pg_array(c[11]),
                config: parse_csv(c[12]),
            });
        }
        Ok(roles)
    }

    /// Get a single role by name.
    pub async fn get(client: &PgAdminClient, name: &str) -> PgAdminResult<PgRole> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|r| r.rolname == name)
            .ok_or_else(|| PgAdminError::role_not_found(name))
    }

    /// Create a new role.
    pub async fn create(client: &PgAdminClient, req: &CreateRoleRequest) -> PgAdminResult<PgRole> {
        let mut sql = format!("CREATE ROLE \"{}\"", req.rolname);
        let mut opts = Vec::new();
        if let Some(true) = req.superuser { opts.push("SUPERUSER".to_string()); }
        if let Some(false) = req.superuser { opts.push("NOSUPERUSER".to_string()); }
        if let Some(true) = req.createdb { opts.push("CREATEDB".to_string()); }
        if let Some(false) = req.createdb { opts.push("NOCREATEDB".to_string()); }
        if let Some(true) = req.createrole { opts.push("CREATEROLE".to_string()); }
        if let Some(false) = req.createrole { opts.push("NOCREATEROLE".to_string()); }
        if let Some(true) = req.inherit { opts.push("INHERIT".to_string()); }
        if let Some(false) = req.inherit { opts.push("NOINHERIT".to_string()); }
        if let Some(true) = req.login { opts.push("LOGIN".to_string()); }
        if let Some(false) = req.login { opts.push("NOLOGIN".to_string()); }
        if let Some(true) = req.replication { opts.push("REPLICATION".to_string()); }
        if let Some(false) = req.replication { opts.push("NOREPLICATION".to_string()); }
        if let Some(true) = req.bypassrls { opts.push("BYPASSRLS".to_string()); }
        if let Some(false) = req.bypassrls { opts.push("NOBYPASSRLS".to_string()); }
        if let Some(limit) = req.connection_limit { opts.push(format!("CONNECTION LIMIT {}", limit)); }
        if let Some(ref v) = req.valid_until { opts.push(format!("VALID UNTIL '{}'", v)); }
        if let Some(ref pw) = req.password { opts.push(format!("PASSWORD '{}'", pw.replace('\'', "''"))); }

        if !opts.is_empty() {
            sql.push(' ');
            sql.push_str(&opts.join(" "));
        }

        if let Some(ref roles) = req.in_roles {
            if !roles.is_empty() {
                sql.push_str(&format!(" IN ROLE {}", roles.iter().map(|r| format!("\"{}\"", r)).collect::<Vec<_>>().join(", ")));
            }
        }
        sql.push(';');

        client.exec_psql(&sql).await?;
        Self::get(client, &req.rolname).await
    }

    /// Alter a role's attributes.
    pub async fn alter(client: &PgAdminClient, name: &str, req: &AlterRoleRequest) -> PgAdminResult<PgRole> {
        let mut opts = Vec::new();
        if let Some(true) = req.superuser { opts.push("SUPERUSER"); }
        if let Some(false) = req.superuser { opts.push("NOSUPERUSER"); }
        if let Some(true) = req.createdb { opts.push("CREATEDB"); }
        if let Some(false) = req.createdb { opts.push("NOCREATEDB"); }
        if let Some(true) = req.createrole { opts.push("CREATEROLE"); }
        if let Some(false) = req.createrole { opts.push("NOCREATEROLE"); }
        if let Some(true) = req.inherit { opts.push("INHERIT"); }
        if let Some(false) = req.inherit { opts.push("NOINHERIT"); }
        if let Some(true) = req.login { opts.push("LOGIN"); }
        if let Some(false) = req.login { opts.push("NOLOGIN"); }
        if let Some(true) = req.replication { opts.push("REPLICATION"); }
        if let Some(false) = req.replication { opts.push("NOREPLICATION"); }
        if let Some(true) = req.bypassrls { opts.push("BYPASSRLS"); }
        if let Some(false) = req.bypassrls { opts.push("NOBYPASSRLS"); }

        let mut extra = Vec::new();
        if let Some(limit) = req.connection_limit {
            extra.push(format!("CONNECTION LIMIT {}", limit));
        }
        if let Some(ref v) = req.valid_until {
            extra.push(format!("VALID UNTIL '{}'", v));
        }

        if !opts.is_empty() || !extra.is_empty() {
            let all: Vec<String> = opts.iter().map(|s| s.to_string()).chain(extra).collect();
            client.exec_psql(&format!("ALTER ROLE \"{}\" {};", name, all.join(" "))).await?;
        }

        Self::get(client, name).await
    }

    /// Drop a role.
    pub async fn drop(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!("DROP ROLE \"{}\";", name)).await?;
        Ok(())
    }

    /// List role memberships.
    pub async fn list_memberships(client: &PgAdminClient, name: &str) -> PgAdminResult<Vec<String>> {
        let raw = client.exec_psql(&format!(
            "SELECT r.rolname FROM pg_auth_members am \
             JOIN pg_roles r ON r.oid = am.roleid \
             JOIN pg_roles m ON m.oid = am.member \
             WHERE m.rolname = '{}' ORDER BY r.rolname;",
            name.replace('\'', "''")
        )).await?;

        Ok(raw.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
    }

    /// Grant a role to another role.
    pub async fn grant_role(client: &PgAdminClient, req: &GrantRoleRequest) -> PgAdminResult<()> {
        let admin = if req.with_admin.unwrap_or(false) { " WITH ADMIN OPTION" } else { "" };
        client.exec_psql(&format!(
            "GRANT \"{}\" TO \"{}\"{};", req.role, req.member, admin
        )).await?;
        Ok(())
    }

    /// Revoke a role from another role.
    pub async fn revoke_role(client: &PgAdminClient, req: &RevokeRoleRequest) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "REVOKE \"{}\" FROM \"{}\";", req.role, req.member
        )).await?;
        Ok(())
    }

    /// Set a configuration parameter for a role.
    pub async fn set_role_config(client: &PgAdminClient, role: &str, param: &str, value: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "ALTER ROLE \"{}\" SET {} = '{}';",
            role, param.replace('\'', "''"), value.replace('\'', "''")
        )).await?;
        Ok(())
    }

    /// List privileges for a role.
    pub async fn list_privileges(client: &PgAdminClient, role: &str) -> PgAdminResult<Vec<PgPrivilege>> {
        let raw = client.exec_psql(&format!(
            "SELECT grantee, table_catalog, table_schema, table_name, privilege_type, is_grantable \
             FROM information_schema.role_table_grants \
             WHERE grantee = '{}' ORDER BY table_schema, table_name, privilege_type;",
            role.replace('\'', "''")
        )).await?;

        let mut privs = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(6, '|').collect();
            if c.len() < 6 { continue; }
            privs.push(PgPrivilege {
                grantee: c[0].trim().to_string(),
                table_catalog: non_empty(c[1]),
                table_schema: non_empty(c[2]),
                table_name: non_empty(c[3]),
                privilege_type: c[4].trim().to_string(),
                is_grantable: c[5].trim() == "YES",
            });
        }
        Ok(privs)
    }

    /// Grant privileges on a table.
    pub async fn grant_privileges(
        client: &PgAdminClient,
        privileges: &str,
        on_object: &str,
        to_role: &str,
    ) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "GRANT {} ON {} TO \"{}\";", privileges, on_object, to_role
        )).await?;
        Ok(())
    }

    /// Revoke privileges on a table.
    pub async fn revoke_privileges(
        client: &PgAdminClient,
        privileges: &str,
        on_object: &str,
        from_role: &str,
    ) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "REVOKE {} ON {} FROM \"{}\";", privileges, on_object, from_role
        )).await?;
        Ok(())
    }

    /// Set password for a role.
    pub async fn set_password(client: &PgAdminClient, role: &str, password: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "ALTER ROLE \"{}\" PASSWORD '{}';",
            role, password.replace('\'', "''")
        )).await?;
        Ok(())
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}

fn parse_pg_array(s: &str) -> Vec<String> {
    let s = s.trim().trim_start_matches('{').trim_end_matches('}');
    if s.is_empty() { return Vec::new(); }
    s.split(',').map(|v| v.trim().trim_matches('"').to_string()).filter(|v| !v.is_empty()).collect()
}

fn parse_csv(s: &str) -> Vec<String> {
    let s = s.trim();
    if s.is_empty() { return Vec::new(); }
    s.split(',').map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).collect()
}
