// ── sorng-mysql-admin – database management ──────────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::{MysqlAdminError, MysqlAdminResult};
use crate::types::*;

pub struct DatabaseManager;

impl DatabaseManager {
    pub async fn list(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<MysqlDatabase>> {
        let out = client.exec_mysql(
            "SELECT s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME, \
             COUNT(t.TABLE_NAME), IFNULL(SUM(t.DATA_LENGTH),0), IFNULL(SUM(t.INDEX_LENGTH),0) \
             FROM information_schema.SCHEMATA s \
             LEFT JOIN information_schema.TABLES t ON s.SCHEMA_NAME = t.TABLE_SCHEMA \
             GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME"
        ).await?;
        let dbs = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                MysqlDatabase {
                    name: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    charset: c.get(1).map(|s| s.to_string()),
                    collation: c.get(2).map(|s| s.to_string()),
                    tables_count: c.get(3).and_then(|s| s.parse().ok()),
                    size_bytes: c.get(4).and_then(|s| s.parse().ok()),
                    index_size_bytes: c.get(5).and_then(|s| s.parse().ok()),
                }
            })
            .collect();
        Ok(dbs)
    }

    pub async fn get(client: &MysqlAdminClient, name: &str) -> MysqlAdminResult<MysqlDatabase> {
        let out = client.exec_mysql(&format!(
            "SELECT s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME, \
             COUNT(t.TABLE_NAME), IFNULL(SUM(t.DATA_LENGTH),0), IFNULL(SUM(t.INDEX_LENGTH),0) \
             FROM information_schema.SCHEMATA s \
             LEFT JOIN information_schema.TABLES t ON s.SCHEMA_NAME = t.TABLE_SCHEMA \
             WHERE s.SCHEMA_NAME='{}' \
             GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME", name
        )).await?;
        let line = out.lines().find(|l| !l.is_empty())
            .ok_or_else(|| MysqlAdminError::database_not_found(name))?;
        let c: Vec<&str> = line.split('\t').collect();
        Ok(MysqlDatabase {
            name: c.first().map(|s| s.to_string()).unwrap_or_default(),
            charset: c.get(1).map(|s| s.to_string()),
            collation: c.get(2).map(|s| s.to_string()),
            tables_count: c.get(3).and_then(|s| s.parse().ok()),
            size_bytes: c.get(4).and_then(|s| s.parse().ok()),
            index_size_bytes: c.get(5).and_then(|s| s.parse().ok()),
        })
    }

    pub async fn create(client: &MysqlAdminClient, req: &CreateDatabaseRequest) -> MysqlAdminResult<()> {
        let mut sql = format!("CREATE DATABASE `{}`", req.name);
        if let Some(ref cs) = req.charset {
            sql.push_str(&format!(" CHARACTER SET {}", cs));
        }
        if let Some(ref co) = req.collation {
            sql.push_str(&format!(" COLLATE {}", co));
        }
        client.exec_mysql(&sql).await?;
        Ok(())
    }

    pub async fn drop(client: &MysqlAdminClient, name: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("DROP DATABASE `{}`", name)).await?;
        Ok(())
    }

    pub async fn get_size(client: &MysqlAdminClient, name: &str) -> MysqlAdminResult<u64> {
        let out = client.exec_mysql(&format!(
            "SELECT IFNULL(SUM(data_length + index_length),0) FROM information_schema.TABLES WHERE table_schema='{}'", name
        )).await?;
        Ok(out.trim().parse::<u64>().unwrap_or(0))
    }

    pub async fn list_tables(client: &MysqlAdminClient, name: &str) -> MysqlAdminResult<Vec<String>> {
        let out = client.exec_mysql_db(name, "SHOW TABLES").await?;
        Ok(out.lines().filter(|l| !l.is_empty()).map(String::from).collect())
    }

    pub async fn get_charset(client: &MysqlAdminClient, name: &str) -> MysqlAdminResult<String> {
        let out = client.exec_mysql(&format!(
            "SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{}'", name
        )).await?;
        let charset = out.trim().to_string();
        if charset.is_empty() {
            return Err(MysqlAdminError::database_not_found(name));
        }
        Ok(charset)
    }

    pub async fn alter_charset(client: &MysqlAdminClient, name: &str, req: &AlterDatabaseRequest) -> MysqlAdminResult<()> {
        let mut sql = format!("ALTER DATABASE `{}`", name);
        if let Some(ref cs) = req.charset {
            sql.push_str(&format!(" CHARACTER SET {}", cs));
        }
        if let Some(ref co) = req.collation {
            sql.push_str(&format!(" COLLATE {}", co));
        }
        client.exec_mysql(&sql).await?;
        Ok(())
    }
}
