// ── sorng-postgres-admin – database management ───────────────────────────────
//! CRUD operations on PostgreSQL databases.

use crate::client::PgAdminClient;
use crate::error::{PgAdminError, PgAdminResult};
use crate::types::*;

pub struct DatabaseManager;

impl DatabaseManager {
    /// List all databases with stats.
    pub async fn list(client: &PgAdminClient) -> PgAdminResult<Vec<PgDatabase>> {
        let raw = client.exec_psql(
            "SELECT d.oid, d.datname, pg_catalog.pg_get_userbyid(d.datdba), \
             pg_encoding_to_char(d.encoding), d.datcollate, d.datctype, \
             d.datistemplate, d.datallowconn, d.datconnlimit, NULL, \
             d.datfrozenxid::text, d.datminmxid::text, \
             (SELECT spcname FROM pg_tablespace WHERE oid = d.dattablespace), \
             pg_database_size(d.datname), \
             COALESCE(s.numbackends, 0), COALESCE(s.xact_commit, 0), \
             COALESCE(s.xact_rollback, 0), COALESCE(s.blks_read, 0), \
             COALESCE(s.blks_hit, 0), COALESCE(s.tup_returned, 0), \
             COALESCE(s.tup_fetched, 0), COALESCE(s.tup_inserted, 0), \
             COALESCE(s.tup_updated, 0), COALESCE(s.tup_deleted, 0), \
             COALESCE(s.conflicts, 0), COALESCE(s.temp_files, 0), \
             COALESCE(s.temp_bytes, 0), COALESCE(s.deadlocks, 0), \
             s.stats_reset::text \
             FROM pg_database d \
             LEFT JOIN pg_stat_database s ON d.oid = s.datid \
             ORDER BY d.datname;"
        ).await?;

        let mut databases = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(29, '|').collect();
            if c.len() < 29 { continue; }
            databases.push(PgDatabase {
                oid: c[0].trim().parse().unwrap_or(0),
                datname: c[1].trim().to_string(),
                datdba: c[2].trim().to_string(),
                encoding: c[3].trim().to_string(),
                datcollate: c[4].trim().to_string(),
                datctype: c[5].trim().to_string(),
                datistemplate: c[6].trim() == "t",
                datallowconn: c[7].trim() == "t",
                datconnlimit: c[8].trim().parse().unwrap_or(-1),
                datlastsysoid: c[9].trim().parse().ok(),
                datfrozenxid: non_empty(c[10]),
                datminmxid: non_empty(c[11]),
                dattablespace: c[12].trim().to_string(),
                size_bytes: c[13].trim().parse().unwrap_or(0),
                num_backends: c[14].trim().parse().unwrap_or(0),
                xact_commit: c[15].trim().parse().unwrap_or(0),
                xact_rollback: c[16].trim().parse().unwrap_or(0),
                blks_read: c[17].trim().parse().unwrap_or(0),
                blks_hit: c[18].trim().parse().unwrap_or(0),
                tup_returned: c[19].trim().parse().unwrap_or(0),
                tup_fetched: c[20].trim().parse().unwrap_or(0),
                tup_inserted: c[21].trim().parse().unwrap_or(0),
                tup_updated: c[22].trim().parse().unwrap_or(0),
                tup_deleted: c[23].trim().parse().unwrap_or(0),
                conflicts: c[24].trim().parse().unwrap_or(0),
                temp_files: c[25].trim().parse().unwrap_or(0),
                temp_bytes: c[26].trim().parse().unwrap_or(0),
                deadlocks: c[27].trim().parse().unwrap_or(0),
                stats_reset: non_empty(c[28]),
            });
        }
        Ok(databases)
    }

    /// Get a single database by name.
    pub async fn get(client: &PgAdminClient, name: &str) -> PgAdminResult<PgDatabase> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|d| d.datname == name)
            .ok_or_else(|| PgAdminError::database_not_found(name))
    }

    /// Create a new database.
    pub async fn create(client: &PgAdminClient, req: &CreateDatabaseRequest) -> PgAdminResult<PgDatabase> {
        let mut sql = format!("CREATE DATABASE \"{}\"", req.name);
        if let Some(ref owner) = req.owner {
            sql.push_str(&format!(" OWNER \"{}\"", owner));
        }
        if let Some(ref enc) = req.encoding {
            sql.push_str(&format!(" ENCODING '{}'", enc));
        }
        if let Some(ref tpl) = req.template {
            sql.push_str(&format!(" TEMPLATE \"{}\"", tpl));
        }
        if let Some(ref ts) = req.tablespace {
            sql.push_str(&format!(" TABLESPACE \"{}\"", ts));
        }
        if let Some(limit) = req.connection_limit {
            sql.push_str(&format!(" CONNECTION LIMIT {}", limit));
        }
        if let Some(true) = req.is_template {
            sql.push_str(" IS_TEMPLATE true");
        }
        if let Some(ref locale) = req.locale {
            sql.push_str(&format!(" LOCALE '{}'", locale));
        }
        if let Some(ref lc) = req.lc_collate {
            sql.push_str(&format!(" LC_COLLATE '{}'", lc));
        }
        if let Some(ref lc) = req.lc_ctype {
            sql.push_str(&format!(" LC_CTYPE '{}'", lc));
        }
        sql.push(';');

        client.exec_psql(&sql).await?;
        Self::get(client, &req.name).await
    }

    /// Drop a database.
    pub async fn drop(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!("DROP DATABASE \"{}\";", name)).await?;
        Ok(())
    }

    /// Alter a database.
    pub async fn alter(client: &PgAdminClient, name: &str, req: &AlterDatabaseRequest) -> PgAdminResult<PgDatabase> {
        if let Some(ref owner) = req.owner {
            client.exec_psql(&format!("ALTER DATABASE \"{}\" OWNER TO \"{}\";", name, owner)).await?;
        }
        if let Some(limit) = req.connection_limit {
            client.exec_psql(&format!("ALTER DATABASE \"{}\" CONNECTION LIMIT {};", name, limit)).await?;
        }
        if let Some(is_tpl) = req.is_template {
            client.exec_psql(&format!("ALTER DATABASE \"{}\" IS_TEMPLATE {};", name, is_tpl)).await?;
        }
        if let Some(allow) = req.allow_connections {
            client.exec_psql(&format!("ALTER DATABASE \"{}\" ALLOW_CONNECTIONS {};", name, allow)).await?;
        }
        if let Some(ref ts) = req.tablespace {
            client.exec_psql(&format!("ALTER DATABASE \"{}\" SET TABLESPACE \"{}\";", name, ts)).await?;
        }
        Self::get(client, name).await
    }

    /// Get the size of a database in bytes.
    pub async fn get_size(client: &PgAdminClient, name: &str) -> PgAdminResult<i64> {
        let raw = client.exec_psql(&format!(
            "SELECT pg_database_size('{}');",
            name.replace('\'', "''")
        )).await?;
        raw.trim().parse().map_err(|_| PgAdminError::parse("Failed to parse database size"))
    }

    /// Get statistics for a specific database.
    pub async fn get_stats(client: &PgAdminClient, name: &str) -> PgAdminResult<PgDatabase> {
        Self::get(client, name).await
    }

    /// Reassign objects owned by a role to another.
    pub async fn reassign_owned(client: &PgAdminClient, db: &str, from_role: &str, to_role: &str) -> PgAdminResult<()> {
        client.exec_psql_db(db, &format!(
            "REASSIGN OWNED BY \"{}\" TO \"{}\";", from_role, to_role
        )).await?;
        Ok(())
    }

    /// Get the number of active connections to a database.
    pub async fn get_connection_count(client: &PgAdminClient, name: &str) -> PgAdminResult<i32> {
        let raw = client.exec_psql(&format!(
            "SELECT count(*)::int FROM pg_stat_activity WHERE datname = '{}';",
            name.replace('\'', "''")
        )).await?;
        raw.trim().parse().map_err(|_| PgAdminError::parse("Failed to parse connection count"))
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}
