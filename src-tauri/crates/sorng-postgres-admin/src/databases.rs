// ── sorng-postgres-admin/src/databases.rs ─────────────────────────────────────
//! PostgreSQL database management via pg_catalog queries.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::{PgDatabase, PgSchema};

pub struct DatabaseManager;

impl DatabaseManager {
    /// List all databases from pg_database.
    pub async fn list(client: &PgClient) -> PgResult<Vec<PgDatabase>> {
        let sql = r#"
            SELECT d.datname, r.rolname, pg_encoding_to_char(d.encoding),
                   d.datcollate, d.datctype,
                   COALESCE(d.datacl::text, ''),
                   pg_database_size(d.oid),
                   t.spcname, d.datconnlimit, d.datistemplate, d.datallowconn
            FROM pg_database d
            JOIN pg_roles r ON r.oid = d.datdba
            JOIN pg_tablespace t ON t.oid = d.dattablespace
            ORDER BY d.datname
        "#;
        let out = client.exec_sql(sql).await?;
        let mut dbs = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(11, '|').collect();
            if cols.len() >= 11 {
                dbs.push(PgDatabase {
                    name: cols[0].to_string(),
                    owner: cols[1].to_string(),
                    encoding: cols[2].to_string(),
                    collation: cols[3].to_string(),
                    ctype: cols[4].to_string(),
                    access_privileges: if cols[5].is_empty() { None } else { Some(cols[5].to_string()) },
                    size_bytes: cols[6].trim().parse().unwrap_or(0),
                    tablespace: cols[7].to_string(),
                    connection_limit: cols[8].trim().parse().unwrap_or(-1),
                    is_template: cols[9] == "t",
                    allow_connections: cols[10] == "t",
                });
            }
        }
        Ok(dbs)
    }

    /// Get a single database by name.
    pub async fn get(client: &PgClient, name: &str) -> PgResult<PgDatabase> {
        let dbs = Self::list(client).await?;
        dbs.into_iter()
            .find(|d| d.name == name)
            .ok_or_else(|| crate::error::PgError::database_not_found(name))
    }

    /// Create a new database.
    pub async fn create(
        client: &PgClient,
        name: &str,
        owner: Option<&str>,
        encoding: Option<&str>,
        template: Option<&str>,
        tablespace: Option<&str>,
    ) -> PgResult<()> {
        let mut sql = format!("CREATE DATABASE \"{}\"", name);
        if let Some(o) = owner { sql.push_str(&format!(" OWNER \"{}\"", o)); }
        if let Some(e) = encoding { sql.push_str(&format!(" ENCODING '{}'", e)); }
        if let Some(t) = template { sql.push_str(&format!(" TEMPLATE \"{}\"", t)); }
        if let Some(ts) = tablespace { sql.push_str(&format!(" TABLESPACE \"{}\"", ts)); }
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Drop a database.
    pub async fn drop(client: &PgClient, name: &str) -> PgResult<()> {
        client.exec_sql(&format!("DROP DATABASE \"{}\"", name)).await?;
        Ok(())
    }

    /// Rename a database.
    pub async fn rename(client: &PgClient, old_name: &str, new_name: &str) -> PgResult<()> {
        client.exec_sql(&format!(
            "ALTER DATABASE \"{}\" RENAME TO \"{}\"", old_name, new_name
        )).await?;
        Ok(())
    }

    /// Change database owner.
    pub async fn alter_owner(client: &PgClient, db: &str, owner: &str) -> PgResult<()> {
        client.exec_sql(&format!(
            "ALTER DATABASE \"{}\" OWNER TO \"{}\"", db, owner
        )).await?;
        Ok(())
    }

    /// Get database size in bytes.
    pub async fn get_size(client: &PgClient, name: &str) -> PgResult<u64> {
        let sql = format!(
            "SELECT pg_database_size('{}')::text",
            name.replace('\'', "''")
        );
        let out = client.exec_sql(&sql).await?;
        Ok(out.trim().parse().unwrap_or(0))
    }

    /// Get active connection count for a database.
    pub async fn get_connections(client: &PgClient, name: &str) -> PgResult<u64> {
        let sql = format!(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = '{}'",
            name.replace('\'', "''")
        );
        let out = client.exec_sql(&sql).await?;
        Ok(out.trim().parse().unwrap_or(0))
    }

    /// Terminate all connections to a database.
    pub async fn terminate_connections(client: &PgClient, name: &str) -> PgResult<()> {
        let sql = format!(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
             WHERE datname = '{}' AND pid <> pg_backend_pid()",
            name.replace('\'', "''")
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// List schemas in a database.
    pub async fn list_schemas(client: &PgClient, db: &str) -> PgResult<Vec<PgSchema>> {
        let sql = r#"
            SELECT n.nspname, r.rolname,
                   COALESCE(n.nspacl::text, ''),
                   COALESCE(obj_description(n.oid, 'pg_namespace'), '')
            FROM pg_namespace n
            JOIN pg_roles r ON r.oid = n.nspowner
            WHERE n.nspname NOT LIKE 'pg_toast%'
              AND n.nspname NOT LIKE 'pg_temp%'
            ORDER BY n.nspname
        "#;
        let out = client.exec_sql_db(db, sql).await?;
        let mut schemas = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(4, '|').collect();
            if cols.len() >= 4 {
                schemas.push(PgSchema {
                    name: cols[0].to_string(),
                    owner: cols[1].to_string(),
                    access_privileges: if cols[2].is_empty() { None } else { Some(cols[2].to_string()) },
                    description: if cols[3].is_empty() { None } else { Some(cols[3].to_string()) },
                });
            }
        }
        Ok(schemas)
    }
}
