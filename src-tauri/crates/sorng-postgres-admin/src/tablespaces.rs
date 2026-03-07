// ── sorng-postgres-admin – tablespace management ─────────────────────────────
//! CRUD for PostgreSQL tablespaces.

use crate::client::PgAdminClient;
use crate::error::{PgAdminError, PgAdminResult};
use crate::types::*;

pub struct TablespaceManager;

impl TablespaceManager {
    /// List all tablespaces.
    pub async fn list(client: &PgAdminClient) -> PgAdminResult<Vec<PgTablespace>> {
        let raw = client.exec_psql(
            "SELECT t.spcname, pg_catalog.pg_get_userbyid(t.spcowner), \
             pg_tablespace_location(t.oid), pg_tablespace_size(t.oid), \
             t.spcacl::text, t.spcoptions::text \
             FROM pg_tablespace t ORDER BY t.spcname;"
        ).await?;

        let mut tablespaces = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(6, '|').collect();
            if c.len() < 6 { continue; }
            tablespaces.push(PgTablespace {
                spcname: c[0].trim().to_string(),
                spcowner: c[1].trim().to_string(),
                spclocation: c[2].trim().to_string(),
                size_bytes: c[3].trim().parse().unwrap_or(0),
                spcacl: non_empty(c[4]),
                spcoptions: non_empty(c[5]).map(|s| {
                    s.trim_start_matches('{').trim_end_matches('}')
                        .split(',').map(|o| o.trim().to_string())
                        .filter(|o| !o.is_empty()).collect()
                }),
            });
        }
        Ok(tablespaces)
    }

    /// Create a tablespace.
    pub async fn create(client: &PgAdminClient, req: &CreateTablespaceRequest) -> PgAdminResult<PgTablespace> {
        let mut sql = format!(
            "CREATE TABLESPACE \"{}\" LOCATION '{}'",
            req.name, req.location.replace('\'', "''")
        );
        if let Some(ref owner) = req.owner {
            sql = format!(
                "CREATE TABLESPACE \"{}\" OWNER \"{}\" LOCATION '{}'",
                req.name, owner, req.location.replace('\'', "''")
            );
        }
        if let Some(ref opts) = req.options {
            if !opts.is_empty() {
                sql.push_str(&format!(" WITH ({})", opts.join(", ")));
            }
        }
        sql.push(';');

        client.exec_psql(&sql).await?;
        Self::list(client).await?
            .into_iter()
            .find(|t| t.spcname == req.name)
            .ok_or_else(|| PgAdminError::tablespace_not_found(&req.name))
    }

    /// Drop a tablespace.
    pub async fn drop(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!("DROP TABLESPACE \"{}\";", name)).await?;
        Ok(())
    }

    /// Get the size of a tablespace.
    pub async fn get_size(client: &PgAdminClient, name: &str) -> PgAdminResult<i64> {
        let raw = client.exec_psql(&format!(
            "SELECT pg_tablespace_size('{}');",
            name.replace('\'', "''")
        )).await?;
        raw.trim().parse().map_err(|_| PgAdminError::parse("Failed to parse tablespace size"))
    }

    /// Alter tablespace owner.
    pub async fn alter_owner(client: &PgAdminClient, name: &str, new_owner: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "ALTER TABLESPACE \"{}\" OWNER TO \"{}\";", name, new_owner
        )).await?;
        Ok(())
    }

    /// Get objects in a tablespace.
    pub async fn get_objects_in(client: &PgAdminClient, name: &str) -> PgAdminResult<Vec<String>> {
        let raw = client.exec_psql(&format!(
            "SELECT c.relname FROM pg_class c \
             JOIN pg_tablespace t ON c.reltablespace = t.oid \
             WHERE t.spcname = '{}' ORDER BY c.relname;",
            name.replace('\'', "''")
        )).await?;
        Ok(raw.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}
