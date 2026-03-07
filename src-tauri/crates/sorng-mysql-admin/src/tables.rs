// ── sorng-mysql-admin – table management ─────────────────────────────────────
//! MySQL/MariaDB table-level operations via SSH.

use crate::client::MysqlClient;
use crate::error::{MysqlError, MysqlResult};
use crate::types::*;

pub struct TableManager;

impl TableManager {
    /// List all tables in a database.
    pub async fn list(client: &MysqlClient, db: &str) -> MysqlResult<Vec<MysqlTable>> {
        let sql = format!(
            "SELECT TABLE_NAME, ENGINE, ROW_FORMAT, TABLE_ROWS, \
             DATA_LENGTH, INDEX_LENGTH, AUTO_INCREMENT, \
             CREATE_TIME, UPDATE_TIME, TABLE_COLLATION \
             FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = '{}' AND TABLE_TYPE = 'BASE TABLE' \
             ORDER BY TABLE_NAME",
            sql_escape(db)
        );
        let out = client.exec_sql(&sql).await?;
        let mut tables = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 10 {
                tables.push(MysqlTable {
                    name: cols[0].to_string(),
                    engine: cols[1].to_string(),
                    row_format: cols[2].to_string(),
                    rows: cols[3].parse().unwrap_or(0),
                    data_length: cols[4].parse().unwrap_or(0),
                    index_length: cols[5].parse().unwrap_or(0),
                    auto_increment: if cols[6] == "NULL" { None } else { cols[6].parse().ok() },
                    create_time: cols[7].to_string(),
                    update_time: if cols[8] == "NULL" { None } else { Some(cols[8].to_string()) },
                    collation: cols[9].to_string(),
                });
            }
        }
        Ok(tables)
    }

    /// Get a single table's metadata.
    pub async fn get(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<MysqlTable> {
        let sql = format!(
            "SELECT TABLE_NAME, ENGINE, ROW_FORMAT, TABLE_ROWS, \
             DATA_LENGTH, INDEX_LENGTH, AUTO_INCREMENT, \
             CREATE_TIME, UPDATE_TIME, TABLE_COLLATION \
             FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
            sql_escape(db), sql_escape(table)
        );
        let out = client.exec_sql(&sql).await?;
        let line = out.lines().next()
            .ok_or_else(|| MysqlError::table_not_found(table))?;
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 10 {
            return Err(MysqlError::parse("unexpected column count for table query"));
        }
        Ok(MysqlTable {
            name: cols[0].to_string(),
            engine: cols[1].to_string(),
            row_format: cols[2].to_string(),
            rows: cols[3].parse().unwrap_or(0),
            data_length: cols[4].parse().unwrap_or(0),
            index_length: cols[5].parse().unwrap_or(0),
            auto_increment: if cols[6] == "NULL" { None } else { cols[6].parse().ok() },
            create_time: cols[7].to_string(),
            update_time: if cols[8] == "NULL" { None } else { Some(cols[8].to_string()) },
            collation: cols[9].to_string(),
        })
    }

    /// Describe a table's columns.
    pub async fn describe(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<Vec<MysqlColumn>> {
        let sql = format!(
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, \
             CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, EXTRA \
             FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
             ORDER BY ORDINAL_POSITION",
            sql_escape(db), sql_escape(table)
        );
        let out = client.exec_sql(&sql).await?;
        let mut columns = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 8 {
                columns.push(MysqlColumn {
                    name: cols[0].to_string(),
                    data_type: cols[1].to_string(),
                    is_nullable: cols[2] == "YES",
                    column_default: if cols[3] == "NULL" { None } else { Some(cols[3].to_string()) },
                    character_set: if cols[4] == "NULL" { None } else { Some(cols[4].to_string()) },
                    collation: if cols[5] == "NULL" { None } else { Some(cols[5].to_string()) },
                    column_key: cols[6].to_string(),
                    extra: cols[7].to_string(),
                });
            }
        }
        Ok(columns)
    }

    /// List indexes on a table.
    pub async fn list_indexes(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<Vec<MysqlIndex>> {
        let sql = format!(
            "SELECT INDEX_NAME, TABLE_NAME, NON_UNIQUE, COLUMN_NAME, \
             INDEX_TYPE, INDEX_COMMENT \
             FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
             ORDER BY INDEX_NAME, SEQ_IN_INDEX",
            sql_escape(db), sql_escape(table)
        );
        let out = client.exec_sql(&sql).await?;

        // Aggregate columns per index
        let mut index_map: Vec<(String, MysqlIndex)> = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() < 6 {
                continue;
            }
            let idx_name = cols[0].to_string();
            let column = cols[3].to_string();

            if let Some(entry) = index_map.iter_mut().find(|(k, _)| k == &idx_name) {
                entry.1.columns.push(column);
            } else {
                index_map.push((idx_name.clone(), MysqlIndex {
                    name: idx_name,
                    table_name: cols[1].to_string(),
                    non_unique: cols[2] == "1",
                    columns: vec![column],
                    index_type: cols[4].to_string(),
                    comment: cols[5].to_string(),
                }));
            }
        }
        Ok(index_map.into_iter().map(|(_, v)| v).collect())
    }

    /// Create an index on a table.
    pub async fn create_index(
        client: &MysqlClient,
        db: &str,
        table: &str,
        name: &str,
        columns: &[String],
        unique: bool,
    ) -> MysqlResult<()> {
        let unique_kw = if unique { "UNIQUE " } else { "" };
        let col_list = columns.iter()
            .map(|c| format!("`{}`", c))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "CREATE {}INDEX `{}` ON `{}`.`{}` ({})",
            unique_kw, name, sql_escape(db), sql_escape(table), col_list
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Drop an index from a table.
    pub async fn drop_index(
        client: &MysqlClient,
        db: &str,
        table: &str,
        name: &str,
    ) -> MysqlResult<()> {
        let sql = format!("DROP INDEX `{}` ON `{}`.`{}`", name, sql_escape(db), sql_escape(table));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Analyze a table.
    pub async fn analyze(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<String> {
        let sql = format!("ANALYZE TABLE `{}`.`{}`", sql_escape(db), sql_escape(table));
        client.exec_sql(&sql).await
    }

    /// Optimize a table.
    pub async fn optimize(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<String> {
        let sql = format!("OPTIMIZE TABLE `{}`.`{}`", sql_escape(db), sql_escape(table));
        client.exec_sql(&sql).await
    }

    /// Repair a table.
    pub async fn repair(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<String> {
        let sql = format!("REPAIR TABLE `{}`.`{}`", sql_escape(db), sql_escape(table));
        client.exec_sql(&sql).await
    }

    /// Check a table for errors.
    pub async fn check(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<String> {
        let sql = format!("CHECK TABLE `{}`.`{}`", sql_escape(db), sql_escape(table));
        client.exec_sql(&sql).await
    }

    /// Truncate a table (remove all rows).
    pub async fn truncate(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<()> {
        let sql = format!("TRUNCATE TABLE `{}`.`{}`", sql_escape(db), sql_escape(table));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Get the CREATE TABLE statement.
    pub async fn get_create_statement(
        client: &MysqlClient,
        db: &str,
        table: &str,
    ) -> MysqlResult<String> {
        let sql = format!("SHOW CREATE TABLE `{}`.`{}`", sql_escape(db), sql_escape(table));
        let out = client.exec_sql(&sql).await?;
        // Output is tab-separated: table_name \t create_statement
        let line = out.lines().next().unwrap_or("");
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        Ok(parts.get(1).unwrap_or(&"").to_string())
    }

    /// Get the row count of a table.
    pub async fn get_row_count(client: &MysqlClient, db: &str, table: &str) -> MysqlResult<u64> {
        let sql = format!("SELECT COUNT(*) FROM `{}`.`{}`", sql_escape(db), sql_escape(table));
        let out = client.exec_sql(&sql).await?;
        Ok(out.trim().parse().unwrap_or(0))
    }
}

fn sql_escape(s: &str) -> String {
    s.replace('\'', "\\'").replace('`', "``")
}
