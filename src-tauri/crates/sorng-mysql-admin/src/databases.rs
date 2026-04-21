// ── sorng-mysql-admin – database management ──────────────────────────────────
//! MySQL/MariaDB database-level operations via SSH.

use crate::client::MysqlClient;
use crate::error::{MysqlError, MysqlResult};
use crate::types::*;

pub struct DatabaseManager;

impl DatabaseManager {
    /// List all databases with metadata.
    pub async fn list(client: &MysqlClient) -> MysqlResult<Vec<MysqlDatabase>> {
        let sql = "SELECT s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, \
                   s.DEFAULT_COLLATION_NAME, \
                   IFNULL(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size_bytes, \
                   COUNT(t.TABLE_NAME) AS tables_count \
                   FROM information_schema.SCHEMATA s \
                   LEFT JOIN information_schema.TABLES t \
                   ON s.SCHEMA_NAME = t.TABLE_SCHEMA \
                   GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME \
                   ORDER BY s.SCHEMA_NAME";
        let out = client.exec_sql(sql).await?;
        let mut databases = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 5 {
                databases.push(MysqlDatabase {
                    name: cols[0].to_string(),
                    character_set: cols[1].to_string(),
                    collation: cols[2].to_string(),
                    size_bytes: cols[3].parse().unwrap_or(0),
                    tables_count: cols[4].parse().unwrap_or(0),
                });
            }
        }
        Ok(databases)
    }

    /// Get a single database by name.
    pub async fn get(client: &MysqlClient, name: &str) -> MysqlResult<MysqlDatabase> {
        let sql = format!(
            "SELECT s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, \
             s.DEFAULT_COLLATION_NAME, \
             IFNULL(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0), \
             COUNT(t.TABLE_NAME) \
             FROM information_schema.SCHEMATA s \
             LEFT JOIN information_schema.TABLES t \
             ON s.SCHEMA_NAME = t.TABLE_SCHEMA \
             WHERE s.SCHEMA_NAME = '{}' \
             GROUP BY s.SCHEMA_NAME",
            sql_escape(name)
        );
        let out = client.exec_sql(&sql).await?;
        let line = out
            .lines()
            .next()
            .ok_or_else(|| MysqlError::database_not_found(name))?;
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 5 {
            return Err(MysqlError::parse(
                "unexpected column count for database query",
            ));
        }
        Ok(MysqlDatabase {
            name: cols[0].to_string(),
            character_set: cols[1].to_string(),
            collation: cols[2].to_string(),
            size_bytes: cols[3].parse().unwrap_or(0),
            tables_count: cols[4].parse().unwrap_or(0),
        })
    }

    /// Create a new database.
    pub async fn create(
        client: &MysqlClient,
        name: &str,
        charset: Option<&str>,
        collation: Option<&str>,
    ) -> MysqlResult<()> {
        let mut sql = format!("CREATE DATABASE `{}`", sql_escape(name));
        if let Some(cs) = charset {
            sql.push_str(&format!(" CHARACTER SET {}", cs));
        }
        if let Some(co) = collation {
            sql.push_str(&format!(" COLLATE {}", co));
        }
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Drop a database.
    pub async fn drop(client: &MysqlClient, name: &str) -> MysqlResult<()> {
        let sql = format!("DROP DATABASE `{}`", sql_escape(name));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Get the total size of a database in bytes.
    pub async fn get_size(client: &MysqlClient, name: &str) -> MysqlResult<u64> {
        let sql = format!(
            "SELECT IFNULL(SUM(DATA_LENGTH + INDEX_LENGTH), 0) \
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{}'",
            sql_escape(name)
        );
        let out = client.exec_sql(&sql).await?;
        Ok(out.trim().parse().unwrap_or(0))
    }

    /// Get the character set of a database.
    pub async fn get_charset(client: &MysqlClient, name: &str) -> MysqlResult<String> {
        let sql = format!(
            "SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA \
             WHERE SCHEMA_NAME = '{}'",
            sql_escape(name)
        );
        let out = client.exec_sql(&sql).await?;
        let cs = out.trim();
        if cs.is_empty() {
            return Err(MysqlError::database_not_found(name));
        }
        Ok(cs.to_string())
    }

    /// Alter the default character set and collation of a database.
    pub async fn alter_charset(
        client: &MysqlClient,
        name: &str,
        charset: &str,
        collation: &str,
    ) -> MysqlResult<()> {
        let sql = format!(
            "ALTER DATABASE `{}` CHARACTER SET {} COLLATE {}",
            sql_escape(name),
            charset,
            collation
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// List tables in a database (delegates to `TableManager::list`).
    pub async fn list_tables(client: &MysqlClient, db: &str) -> MysqlResult<Vec<MysqlTable>> {
        crate::tables::TableManager::list(client, db).await
    }
}

fn sql_escape(s: &str) -> String {
    s.replace('\'', "\\'").replace('`', "``")
}
