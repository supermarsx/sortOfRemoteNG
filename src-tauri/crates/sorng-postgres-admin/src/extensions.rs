// ── sorng-postgres-admin – extension management ──────────────────────────────
//! Install, uninstall, update, and query PostgreSQL extensions.

use crate::client::PgAdminClient;
use crate::error::{PgAdminError, PgAdminResult};
use crate::types::*;

pub struct ExtensionManager;

impl ExtensionManager {
    /// List installed extensions.
    pub async fn list_installed(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<PgExtension>> {
        let raw = client.exec_psql_db(db,
            "SELECT e.extname, a.default_version, e.extversion, n.nspname, e.extrelocatable, \
             a.comment, obj_description(e.oid, 'pg_extension') \
             FROM pg_extension e \
             JOIN pg_available_extensions a ON a.name = e.extname \
             JOIN pg_namespace n ON n.oid = e.extnamespace \
             ORDER BY e.extname;"
        ).await?;

        let mut exts = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(7, '|').collect();
            if c.len() < 7 { continue; }
            exts.push(PgExtension {
                name: c[0].trim().to_string(),
                default_version: non_empty(c[1]),
                installed_version: non_empty(c[2]),
                schema: non_empty(c[3]),
                relocatable: c[4].trim() == "t",
                description: non_empty(c[5]),
                comment: non_empty(c[6]),
            });
        }
        Ok(exts)
    }

    /// List available extensions (installable).
    pub async fn list_available(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<AvailableExtension>> {
        let raw = client.exec_psql_db(db,
            "SELECT name, default_version, installed_version, comment \
             FROM pg_available_extensions ORDER BY name;"
        ).await?;

        let mut exts = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(4, '|').collect();
            if c.len() < 4 { continue; }
            exts.push(AvailableExtension {
                name: c[0].trim().to_string(),
                default_version: c[1].trim().to_string(),
                installed_version: non_empty(c[2]),
                comment: non_empty(c[3]),
            });
        }
        Ok(exts)
    }

    /// Install (CREATE EXTENSION) an extension.
    pub async fn install(client: &PgAdminClient, db: &str, req: &CreateExtensionRequest) -> PgAdminResult<PgExtension> {
        let mut sql = format!("CREATE EXTENSION IF NOT EXISTS \"{}\"", req.name);
        if let Some(ref schema) = req.schema {
            sql.push_str(&format!(" SCHEMA \"{}\"", schema));
        }
        if let Some(ref ver) = req.version {
            sql.push_str(&format!(" VERSION '{}'", ver));
        }
        if req.cascade.unwrap_or(false) {
            sql.push_str(" CASCADE");
        }
        sql.push(';');

        client.exec_psql_db(db, &sql).await?;

        Self::list_installed(client, db).await?
            .into_iter()
            .find(|e| e.name == req.name)
            .ok_or_else(|| PgAdminError::extension_not_found(&req.name))
    }

    /// Uninstall (DROP EXTENSION) an extension.
    pub async fn uninstall(client: &PgAdminClient, db: &str, name: &str, cascade: bool) -> PgAdminResult<()> {
        let cascade_str = if cascade { " CASCADE" } else { "" };
        client.exec_psql_db(db, &format!("DROP EXTENSION IF EXISTS \"{}\"{};", name, cascade_str)).await?;
        Ok(())
    }

    /// Alter an extension (update version, change schema).
    pub async fn alter(client: &PgAdminClient, db: &str, name: &str, req: &AlterExtensionRequest) -> PgAdminResult<PgExtension> {
        if let Some(ref schema) = req.schema {
            client.exec_psql_db(db, &format!("ALTER EXTENSION \"{}\" SET SCHEMA \"{}\";", name, schema)).await?;
        }
        if let Some(ref ver) = req.version {
            client.exec_psql_db(db, &format!("ALTER EXTENSION \"{}\" UPDATE TO '{}';", name, ver)).await?;
        }

        Self::list_installed(client, db).await?
            .into_iter()
            .find(|e| e.name == name)
            .ok_or_else(|| PgAdminError::extension_not_found(name))
    }

    /// Get the installed version of an extension.
    pub async fn get_version(client: &PgAdminClient, db: &str, name: &str) -> PgAdminResult<String> {
        let raw = client.exec_psql_db(db, &format!(
            "SELECT extversion FROM pg_extension WHERE extname = '{}';",
            name.replace('\'', "''")
        )).await?;
        let ver = raw.trim();
        if ver.is_empty() {
            return Err(PgAdminError::extension_not_found(name));
        }
        Ok(ver.to_string())
    }

    /// Update an extension to a new version.
    pub async fn update(client: &PgAdminClient, db: &str, name: &str, version: Option<&str>) -> PgAdminResult<PgExtension> {
        let sql = match version {
            Some(ver) => format!("ALTER EXTENSION \"{}\" UPDATE TO '{}';", name, ver),
            None => format!("ALTER EXTENSION \"{}\" UPDATE;", name),
        };
        client.exec_psql_db(db, &sql).await?;

        Self::list_installed(client, db).await?
            .into_iter()
            .find(|e| e.name == name)
            .ok_or_else(|| PgAdminError::extension_not_found(name))
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}
