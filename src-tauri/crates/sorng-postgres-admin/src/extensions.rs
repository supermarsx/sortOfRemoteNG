// ── sorng-postgres-admin/src/extensions.rs ────────────────────────────────────
//! PostgreSQL extension management – list, install, update, uninstall.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::PgExtension;

pub struct ExtensionManager;

impl ExtensionManager {
    /// List all available extensions (from pg_available_extensions).
    pub async fn list_available(client: &PgClient) -> PgResult<Vec<PgExtension>> {
        let sql = r#"
            SELECT name, default_version,
                   COALESCE(installed_version, ''),
                   '', false::text, COALESCE(comment, '')
            FROM pg_available_extensions
            ORDER BY name
        "#;
        let out = client.exec_sql(sql).await?;
        parse_extensions(&out)
    }

    /// List installed extensions in a specific database.
    pub async fn list_installed(client: &PgClient, db: &str) -> PgResult<Vec<PgExtension>> {
        let sql = r#"
            SELECT e.extname, a.default_version,
                   e.extversion,
                   COALESCE(n.nspname, ''),
                   e.extrelocatable::text,
                   COALESCE(
                     (SELECT description FROM pg_description d
                      WHERE d.objoid = e.oid AND d.classoid = 'pg_extension'::regclass), '')
            FROM pg_extension e
            JOIN pg_available_extensions a ON a.name = e.extname
            LEFT JOIN pg_namespace n ON n.oid = e.extnamespace
            ORDER BY e.extname
        "#;
        let out = client.exec_sql_db(db, sql).await?;
        parse_extensions(&out)
    }

    /// Install an extension in a database.
    pub async fn install(
        client: &PgClient,
        db: &str,
        name: &str,
        schema: Option<&str>,
    ) -> PgResult<()> {
        let mut sql = format!("CREATE EXTENSION IF NOT EXISTS \"{}\"", name);
        if let Some(s) = schema {
            sql.push_str(&format!(" SCHEMA \"{}\"", s));
        }
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Uninstall an extension from a database.
    pub async fn uninstall(client: &PgClient, db: &str, name: &str, cascade: bool) -> PgResult<()> {
        let mut sql = format!("DROP EXTENSION IF EXISTS \"{}\"", name);
        if cascade {
            sql.push_str(" CASCADE");
        }
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Update an extension to a specific version (or latest).
    pub async fn update(
        client: &PgClient,
        db: &str,
        name: &str,
        version: Option<&str>,
    ) -> PgResult<()> {
        let mut sql = format!("ALTER EXTENSION \"{}\" UPDATE", name);
        if let Some(v) = version {
            sql.push_str(&format!(" TO '{}'", v.replace('\'', "''")));
        }
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Get details of a specific extension in a database.
    pub async fn get(client: &PgClient, db: &str, name: &str) -> PgResult<PgExtension> {
        let installed = Self::list_installed(client, db).await?;
        installed
            .into_iter()
            .find(|e| e.name == name)
            .ok_or_else(|| crate::error::PgError::extension_not_found(name))
    }
}

fn parse_extensions(output: &str) -> PgResult<Vec<PgExtension>> {
    let mut exts = Vec::new();
    for line in output.lines().filter(|l| !l.is_empty()) {
        let cols: Vec<&str> = line.splitn(6, '|').collect();
        if cols.len() >= 6 {
            exts.push(PgExtension {
                name: cols[0].to_string(),
                default_version: if cols[1].is_empty() {
                    None
                } else {
                    Some(cols[1].to_string())
                },
                installed_version: if cols[2].is_empty() {
                    None
                } else {
                    Some(cols[2].to_string())
                },
                schema: if cols[3].is_empty() {
                    None
                } else {
                    Some(cols[3].to_string())
                },
                relocatable: cols[4] == "t",
                comment: if cols[5].is_empty() {
                    None
                } else {
                    Some(cols[5].to_string())
                },
            });
        }
    }
    Ok(exts)
}
