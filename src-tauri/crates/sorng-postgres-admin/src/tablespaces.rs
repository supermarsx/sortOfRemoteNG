// ── sorng-postgres-admin/src/tablespaces.rs ───────────────────────────────────
//! PostgreSQL tablespace management.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::PgTablespace;

pub struct TablespaceManager;

impl TablespaceManager {
    /// List all tablespaces.
    pub async fn list(client: &PgClient) -> PgResult<Vec<PgTablespace>> {
        let sql = r#"
            SELECT t.spcname, r.rolname,
                   COALESCE(pg_tablespace_location(t.oid), ''),
                   pg_tablespace_size(t.oid),
                   COALESCE(array_to_string(t.spcoptions, ','), '')
            FROM pg_tablespace t
            JOIN pg_roles r ON r.oid = t.spcowner
            ORDER BY t.spcname
        "#;
        let out = client.exec_sql(sql).await?;
        let mut tbs = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(5, '|').collect();
            if cols.len() >= 5 {
                tbs.push(PgTablespace {
                    name: cols[0].to_string(),
                    owner: cols[1].to_string(),
                    location: cols[2].to_string(),
                    size_bytes: cols[3].trim().parse().unwrap_or(0),
                    options: if cols[4].is_empty() { None } else { Some(cols[4].to_string()) },
                });
            }
        }
        Ok(tbs)
    }

    /// Get a single tablespace by name.
    pub async fn get(client: &PgClient, name: &str) -> PgResult<PgTablespace> {
        let tbs = Self::list(client).await?;
        tbs.into_iter()
            .find(|t| t.name == name)
            .ok_or_else(|| crate::error::PgError::tablespace_not_found(name))
    }

    /// Create a new tablespace.
    pub async fn create(
        client: &PgClient,
        name: &str,
        location: &str,
        owner: Option<&str>,
    ) -> PgResult<()> {
        let mut sql = format!("CREATE TABLESPACE \"{}\" LOCATION '{}'", name, location.replace('\'', "''"));
        if let Some(o) = owner {
            sql = format!("CREATE TABLESPACE \"{}\" OWNER \"{}\" LOCATION '{}'", name, o, location.replace('\'', "''"));
        }
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Drop a tablespace.
    pub async fn drop(client: &PgClient, name: &str) -> PgResult<()> {
        client.exec_sql(&format!("DROP TABLESPACE \"{}\"", name)).await?;
        Ok(())
    }

    /// Rename a tablespace.
    pub async fn rename(client: &PgClient, old_name: &str, new_name: &str) -> PgResult<()> {
        client.exec_sql(&format!(
            "ALTER TABLESPACE \"{}\" RENAME TO \"{}\"", old_name, new_name
        )).await?;
        Ok(())
    }

    /// Change tablespace owner.
    pub async fn alter_owner(client: &PgClient, name: &str, owner: &str) -> PgResult<()> {
        client.exec_sql(&format!(
            "ALTER TABLESPACE \"{}\" OWNER TO \"{}\"", name, owner
        )).await?;
        Ok(())
    }

    /// Get tablespace size in bytes.
    pub async fn get_size(client: &PgClient, name: &str) -> PgResult<u64> {
        let sql = format!(
            "SELECT pg_tablespace_size('{}')::text",
            name.replace('\'', "''")
        );
        let out = client.exec_sql(&sql).await?;
        Ok(out.trim().parse().unwrap_or(0))
    }

    /// List objects (databases/tables) in a tablespace.
    pub async fn list_objects(client: &PgClient, name: &str) -> PgResult<Vec<String>> {
        let sql = format!(
            r#"SELECT c.relname
               FROM pg_class c
               JOIN pg_tablespace t ON t.oid = c.reltablespace
               WHERE t.spcname = '{}'
               ORDER BY c.relname"#,
            name.replace('\'', "''")
        );
        let out = client.exec_sql(&sql).await?;
        Ok(out.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect())
    }
}
