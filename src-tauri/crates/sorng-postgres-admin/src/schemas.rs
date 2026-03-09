// ── sorng-postgres-admin/src/schemas.rs ───────────────────────────────────────
//! PostgreSQL schema management within databases.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::PgSchema;

pub struct SchemaManager;

impl SchemaManager {
    /// List schemas in a database.
    pub async fn list(client: &PgClient, db: &str) -> PgResult<Vec<PgSchema>> {
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
        parse_schemas(&out)
    }

    /// Get a single schema by name.
    pub async fn get(client: &PgClient, db: &str, name: &str) -> PgResult<PgSchema> {
        let schemas = Self::list(client, db).await?;
        schemas
            .into_iter()
            .find(|s| s.name == name)
            .ok_or_else(|| crate::error::PgError::schema_not_found(name))
    }

    /// Create a new schema.
    pub async fn create(
        client: &PgClient,
        db: &str,
        name: &str,
        owner: Option<&str>,
    ) -> PgResult<()> {
        let mut sql = format!("CREATE SCHEMA \"{}\"", name);
        if let Some(o) = owner {
            sql.push_str(&format!(" AUTHORIZATION \"{}\"", o));
        }
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Drop a schema.
    pub async fn drop(client: &PgClient, db: &str, name: &str, cascade: bool) -> PgResult<()> {
        let mut sql = format!("DROP SCHEMA \"{}\"", name);
        if cascade {
            sql.push_str(" CASCADE");
        }
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Rename a schema.
    pub async fn rename(
        client: &PgClient,
        db: &str,
        old_name: &str,
        new_name: &str,
    ) -> PgResult<()> {
        client
            .exec_sql_db(
                db,
                &format!("ALTER SCHEMA \"{}\" RENAME TO \"{}\"", old_name, new_name),
            )
            .await?;
        Ok(())
    }

    /// Change schema owner.
    pub async fn alter_owner(client: &PgClient, db: &str, name: &str, owner: &str) -> PgResult<()> {
        client
            .exec_sql_db(
                db,
                &format!("ALTER SCHEMA \"{}\" OWNER TO \"{}\"", name, owner),
            )
            .await?;
        Ok(())
    }

    /// Grant privileges on a schema.
    pub async fn grant(
        client: &PgClient,
        db: &str,
        schema: &str,
        role: &str,
        privileges: &str,
    ) -> PgResult<()> {
        let sql = format!(
            "GRANT {} ON SCHEMA \"{}\" TO \"{}\"",
            privileges, schema, role
        );
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Revoke privileges on a schema.
    pub async fn revoke(
        client: &PgClient,
        db: &str,
        schema: &str,
        role: &str,
        privileges: &str,
    ) -> PgResult<()> {
        let sql = format!(
            "REVOKE {} ON SCHEMA \"{}\" FROM \"{}\"",
            privileges, schema, role
        );
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// List tables in a schema.
    pub async fn list_tables(client: &PgClient, db: &str, schema: &str) -> PgResult<Vec<String>> {
        let sql = format!(
            "SELECT tablename FROM pg_tables WHERE schemaname = '{}' ORDER BY tablename",
            schema.replace('\'', "''")
        );
        let out = client.exec_sql_db(db, &sql).await?;
        Ok(out
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    /// List views in a schema.
    pub async fn list_views(client: &PgClient, db: &str, schema: &str) -> PgResult<Vec<String>> {
        let sql = format!(
            "SELECT viewname FROM pg_views WHERE schemaname = '{}' ORDER BY viewname",
            schema.replace('\'', "''")
        );
        let out = client.exec_sql_db(db, &sql).await?;
        Ok(out
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    /// List functions in a schema.
    pub async fn list_functions(
        client: &PgClient,
        db: &str,
        schema: &str,
    ) -> PgResult<Vec<String>> {
        let sql = format!(
            "SELECT routine_name FROM information_schema.routines \
             WHERE routine_schema = '{}' ORDER BY routine_name",
            schema.replace('\'', "''")
        );
        let out = client.exec_sql_db(db, &sql).await?;
        Ok(out
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }
}

fn parse_schemas(output: &str) -> PgResult<Vec<PgSchema>> {
    let mut schemas = Vec::new();
    for line in output.lines().filter(|l| !l.is_empty()) {
        let cols: Vec<&str> = line.splitn(4, '|').collect();
        if cols.len() >= 4 {
            schemas.push(PgSchema {
                name: cols[0].to_string(),
                owner: cols[1].to_string(),
                access_privileges: if cols[2].is_empty() {
                    None
                } else {
                    Some(cols[2].to_string())
                },
                description: if cols[3].is_empty() {
                    None
                } else {
                    Some(cols[3].to_string())
                },
            });
        }
    }
    Ok(schemas)
}
