//! SQLite service – multi-session, schema introspection, PRAGMA, export/import.

use crate::sqlite::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type SqliteServiceState = Arc<Mutex<SqliteService>>;

struct SqliteSession {
    pool: SqlitePool,
    config: SqliteConnectionConfig,
    info: SessionInfo,
}

pub struct SqliteService {
    sessions: HashMap<String, SqliteSession>,
}

impl SqliteService {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }

    fn get_pool(&self, id: &str) -> Result<&SqlitePool, SqliteError> {
        self.sessions.get(id).map(|s| &s.pool).ok_or_else(|| SqliteError::session_not_found(id))
    }

    fn get_session_mut(&mut self, id: &str) -> Result<&mut SqliteSession, SqliteError> {
        self.sessions.get_mut(id).ok_or_else(|| SqliteError::session_not_found(id))
    }

    // ── connect / disconnect ────────────────────────────────────

    pub async fn connect(&mut self, config: SqliteConnectionConfig) -> Result<String, SqliteError> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let url = config.to_url();

        let pool = SqlitePoolOptions::new()
            .max_connections(1) // SQLite single-writer
            .connect(&url)
            .await
            .map_err(|e| SqliteError::new(SqliteErrorKind::ConnectionFailed, format!("SQLite connect: {e}")))?;

        // Apply PRAGMAs
        if let Some(ref jm) = config.journal_mode {
            sqlx::query(&format!("PRAGMA journal_mode={jm}")).execute(&pool).await.ok();
        }
        if let Some(bt) = config.busy_timeout_ms {
            sqlx::query(&format!("PRAGMA busy_timeout={bt}")).execute(&pool).await.ok();
        }
        if let Some(cs) = config.cache_size {
            sqlx::query(&format!("PRAGMA cache_size={cs}")).execute(&pool).await.ok();
        }
        if let Some(fk) = config.foreign_keys {
            let val = if fk { "ON" } else { "OFF" };
            sqlx::query(&format!("PRAGMA foreign_keys={val}")).execute(&pool).await.ok();
        }

        // Get version & journal mode
        let version: String = sqlx::query_scalar("SELECT sqlite_version()")
            .fetch_one(&pool).await.unwrap_or_else(|_| "unknown".to_string());
        let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool).await.unwrap_or_else(|_| "unknown".to_string());
        let page_size: Option<i64> = sqlx::query_scalar("PRAGMA page_size")
            .fetch_optional(&pool).await.ok().flatten();

        let (path, is_memory) = match &config.mode {
            SqliteMode::File(p) => (p.clone(), false),
            SqliteMode::Memory => (":memory:".to_string(), true),
        };

        let info = SessionInfo {
            id: session_id.clone(),
            path: path.clone(),
            is_memory,
            status: ConnectionStatus::Connected,
            sqlite_version: Some(version),
            connected_at: Some(Utc::now().to_rfc3339()),
            queries_executed: 0,
            total_rows_fetched: 0,
            journal_mode: Some(journal),
            page_size,
            database_size_bytes: None,
        };

        self.sessions.insert(session_id.clone(), SqliteSession { pool, config, info });
        info!("SQLite session {session_id} connected to {path}");
        Ok(session_id)
    }

    pub async fn disconnect(&mut self, id: &str) -> Result<(), SqliteError> {
        let sess = self.sessions.remove(id).ok_or_else(|| SqliteError::session_not_found(id))?;
        sess.pool.close().await;
        info!("SQLite session {id} disconnected");
        Ok(())
    }

    pub async fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Some(s) = self.sessions.remove(&id) {
                s.pool.close().await;
            }
        }
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    pub fn get_session(&self, id: &str) -> Result<SessionInfo, SqliteError> {
        self.sessions.get(id).map(|s| s.info.clone()).ok_or_else(|| SqliteError::session_not_found(id))
    }

    pub fn ping(&self, id: &str) -> Result<bool, SqliteError> {
        self.sessions.get(id).map(|_| true).ok_or_else(|| SqliteError::session_not_found(id))
    }

    // ── Queries ─────────────────────────────────────────────────

    pub async fn execute_query(&mut self, id: &str, sql: &str) -> Result<QueryResult, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let start = std::time::Instant::now();

        let rows: Vec<SqliteRow> = sqlx::query(sql)
            .fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let elapsed = start.elapsed().as_millis();

        let columns: Vec<ColumnInfo> = if !rows.is_empty() {
            rows[0].columns().iter().enumerate().map(|(i, c)| ColumnInfo {
                name: c.name().to_string(),
                type_name: c.type_info().to_string(),
                ordinal: i,
            }).collect()
        } else { vec![] };

        let mut result_rows: Vec<RowMap> = Vec::with_capacity(rows.len());
        for row in &rows {
            let mut map = RowMap::new();
            for (i, col) in row.columns().iter().enumerate() {
                let val: Option<String> = row.try_get::<Option<String>, _>(i).unwrap_or(None);
                map.insert(col.name().to_string(), val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null));
            }
            result_rows.push(map);
        }

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        sess.info.total_rows_fetched += result_rows.len() as u64;

        Ok(QueryResult { columns, rows: result_rows, affected_rows: 0, execution_time_ms: elapsed })
    }

    pub async fn execute_statement(&mut self, id: &str, sql: &str) -> Result<QueryResult, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let start = std::time::Instant::now();

        let result = sqlx::query(sql).execute(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let elapsed = start.elapsed().as_millis();
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: result.rows_affected(),
            execution_time_ms: elapsed,
        })
    }

    pub async fn explain_query(&mut self, id: &str, sql: &str) -> Result<Vec<ExplainRow>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let explain_sql = format!("EXPLAIN QUERY PLAN {sql}");
        let rows: Vec<SqliteRow> = sqlx::query(&explain_sql)
            .fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| ExplainRow {
            detail: r.try_get::<String, _>("detail").unwrap_or_default(),
        }).collect())
    }

    // ── Schema introspection ────────────────────────────────────

    pub async fn list_tables(&mut self, id: &str) -> Result<Vec<TableInfo>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<SqliteRow> = sqlx::query(
            "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| TableInfo {
            name: r.try_get("name").unwrap_or_default(),
            table_type: r.try_get("type").unwrap_or_default(),
            sql: r.try_get("sql").ok(),
        }).collect())
    }

    pub async fn describe_table(&mut self, id: &str, table: &str) -> Result<Vec<ColumnDef>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let sql = format!("PRAGMA table_info(\"{}\")", table);
        let rows: Vec<SqliteRow> = sqlx::query(&sql).fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| ColumnDef {
            cid: r.try_get::<i32, _>("cid").unwrap_or(0),
            name: r.try_get("name").unwrap_or_default(),
            data_type: r.try_get("type").unwrap_or_default(),
            is_nullable: r.try_get::<i32, _>("notnull").unwrap_or(0) == 0,
            default_value: r.try_get("dflt_value").ok(),
            is_primary_key: r.try_get::<i32, _>("pk").unwrap_or(0) > 0,
        }).collect())
    }

    pub async fn list_indexes(&mut self, id: &str, table: &str) -> Result<Vec<IndexInfo>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let sql = format!("PRAGMA index_list(\"{}\")", table);
        let idx_rows: Vec<SqliteRow> = sqlx::query(&sql).fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let mut indexes = Vec::new();
        for idx_row in &idx_rows {
            let idx_name: String = idx_row.try_get("name").unwrap_or_default();
            let is_unique: bool = idx_row.try_get::<i32, _>("unique").unwrap_or(0) != 0;
            let is_partial: bool = idx_row.try_get::<i32, _>("partial").unwrap_or(0) != 0;

            let col_sql = format!("PRAGMA index_info(\"{}\")", idx_name);
            let col_rows: Vec<SqliteRow> = sqlx::query(&col_sql).fetch_all(&pool).await.unwrap_or_default();
            let columns: Vec<String> = col_rows.iter().map(|r| r.try_get::<String, _>("name").unwrap_or_default()).collect();

            // get CREATE INDEX sql
            let create_sql: Option<String> = sqlx::query_scalar(&format!("SELECT sql FROM sqlite_master WHERE type='index' AND name='{}'", idx_name))
                .fetch_optional(&pool).await.ok().flatten();

            indexes.push(IndexInfo {
                name: idx_name,
                table_name: table.to_string(),
                columns,
                is_unique,
                is_partial,
                sql: create_sql,
            });
        }

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1 + indexes.len() as u64;

        Ok(indexes)
    }

    pub async fn list_foreign_keys(&mut self, id: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let sql = format!("PRAGMA foreign_key_list(\"{}\")", table);
        let rows: Vec<SqliteRow> = sqlx::query(&sql).fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| ForeignKeyInfo {
            id: r.try_get::<i32, _>("id").unwrap_or(0),
            table: table.to_string(),
            from_column: r.try_get("from").unwrap_or_default(),
            to_table: r.try_get("table").unwrap_or_default(),
            to_column: r.try_get("to").unwrap_or_default(),
            on_update: r.try_get("on_update").unwrap_or_default(),
            on_delete: r.try_get("on_delete").unwrap_or_default(),
        }).collect())
    }

    pub async fn list_triggers(&mut self, id: &str) -> Result<Vec<TriggerInfo>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<SqliteRow> = sqlx::query(
            "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name"
        ).fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| TriggerInfo {
            name: r.try_get("name").unwrap_or_default(),
            table_name: r.try_get("tbl_name").unwrap_or_default(),
            sql: r.try_get("sql").ok(),
        }).collect())
    }

    pub async fn list_attached_databases(&mut self, id: &str) -> Result<Vec<AttachedDatabase>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<SqliteRow> = sqlx::query("PRAGMA database_list")
            .fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| AttachedDatabase {
            seq: r.try_get::<i32, _>("seq").unwrap_or(0),
            name: r.try_get("name").unwrap_or_default(),
            file: r.try_get("file").ok(),
        }).collect())
    }

    // ── PRAGMA ──────────────────────────────────────────────────

    pub async fn get_pragma(&mut self, id: &str, pragma: &str) -> Result<PragmaValue, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let sql = format!("PRAGMA {pragma}");
        let row: SqliteRow = sqlx::query(&sql).fetch_one(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        let value: String = row.try_get(0).unwrap_or_default();
        Ok(PragmaValue { name: pragma.to_string(), value })
    }

    pub async fn set_pragma(&mut self, id: &str, pragma: &str, value: &str) -> Result<(), SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let sql = format!("PRAGMA {pragma}={value}");
        sqlx::query(&sql).execute(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    // ── DDL ─────────────────────────────────────────────────────

    pub async fn drop_table(&mut self, id: &str, table: &str) -> Result<(), SqliteError> {
        self.execute_statement(id, &format!("DROP TABLE IF EXISTS \"{}\"", table)).await?;
        Ok(())
    }

    pub async fn vacuum(&mut self, id: &str) -> Result<(), SqliteError> {
        self.execute_statement(id, "VACUUM").await?;
        Ok(())
    }

    pub async fn integrity_check(&mut self, id: &str) -> Result<Vec<String>, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<SqliteRow> = sqlx::query("PRAGMA integrity_check")
            .fetch_all(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(rows.iter().map(|r| r.try_get::<String, _>(0).unwrap_or_default()).collect())
    }

    pub async fn attach_database(&mut self, id: &str, path: &str, alias: &str) -> Result<(), SqliteError> {
        self.execute_statement(id, &format!("ATTACH DATABASE '{}' AS \"{}\"", path, alias)).await?;
        Ok(())
    }

    pub async fn detach_database(&mut self, id: &str, alias: &str) -> Result<(), SqliteError> {
        self.execute_statement(id, &format!("DETACH DATABASE \"{}\"", alias)).await?;
        Ok(())
    }

    // ── Data CRUD ───────────────────────────────────────────────

    pub async fn get_table_data(&mut self, id: &str, table: &str, limit: Option<u32>, offset: Option<u32>) -> Result<QueryResult, SqliteError> {
        let lim = limit.unwrap_or(500);
        let off = offset.unwrap_or(0);
        let sql = format!("SELECT * FROM \"{}\" LIMIT {} OFFSET {}", table, lim, off);
        self.execute_query(id, &sql).await
    }

    pub async fn insert_row(&mut self, id: &str, table: &str, columns: &[String], values: &[String]) -> Result<u64, SqliteError> {
        let cols = columns.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(", ");
        let placeholders = (0..values.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("INSERT INTO \"{}\" ({}) VALUES ({})", table, cols, placeholders);
        let pool = self.get_pool(id)?.clone();
        let mut q = sqlx::query(&sql);
        for v in values { q = q.bind(v); }
        let result = q.execute(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(result.rows_affected())
    }

    pub async fn update_rows(&mut self, id: &str, table: &str, columns: &[String], values: &[String], where_clause: &str) -> Result<u64, SqliteError> {
        let sets: Vec<String> = columns.iter().zip(values.iter()).map(|(c, _)| format!("\"{}\" = ?", c)).collect();
        let sql = format!("UPDATE \"{}\" SET {} WHERE {}", table, sets.join(", "), where_clause);
        let pool = self.get_pool(id)?.clone();
        let mut q = sqlx::query(&sql);
        for v in values { q = q.bind(v); }
        let result = q.execute(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(result.rows_affected())
    }

    pub async fn delete_rows(&mut self, id: &str, table: &str, where_clause: &str) -> Result<u64, SqliteError> {
        let sql = format!("DELETE FROM \"{}\" WHERE {}", table, where_clause);
        let pool = self.get_pool(id)?.clone();
        let result = sqlx::query(&sql).execute(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(result.rows_affected())
    }

    // ── Export ───────────────────────────────────────────────────

    pub async fn export_table(&mut self, id: &str, table: &str, options: &ExportOptions) -> Result<String, SqliteError> {
        match options.format {
            ExportFormat::Csv | ExportFormat::Tsv => self.export_delimited(id, table, options).await,
            ExportFormat::Sql => self.export_sql(id, table, options).await,
            ExportFormat::Json => self.export_json(id, table, options).await,
        }
    }

    async fn export_delimited(&mut self, id: &str, table: &str, options: &ExportOptions) -> Result<String, SqliteError> {
        let sep = match options.format { ExportFormat::Tsv => '\t', _ => ',' };
        let mut output = String::new();
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;

        if options.include_headers {
            let cols = self.describe_table(id, table).await?;
            output.push_str(&cols.iter().map(|c| c.name.clone()).collect::<Vec<_>>().join(&sep.to_string()));
            output.push('\n');
        }

        loop {
            let sql = format!("SELECT * FROM \"{}\" LIMIT {} OFFSET {}", table, chunk, offset);
            let result = self.execute_query(id, &sql).await?;
            if result.rows.is_empty() { break; }
            let col_names: Vec<String> = result.columns.iter().map(|c| c.name.clone()).collect();
            for row in &result.rows {
                let vals: Vec<String> = col_names.iter().map(|c| {
                    match row.get(c) {
                        Some(serde_json::Value::String(s)) => {
                            if s.contains(sep) || s.contains('"') || s.contains('\n') {
                                format!("\"{}\"", s.replace('"', "\"\""))
                            } else { s.clone() }
                        }
                        Some(serde_json::Value::Null) | None => String::new(),
                        Some(v) => v.to_string(),
                    }
                }).collect();
                output.push_str(&vals.join(&sep.to_string()));
                output.push('\n');
            }
            offset += chunk;
            if result.rows.len() < chunk as usize { break; }
        }
        Ok(output)
    }

    async fn export_sql(&mut self, id: &str, table: &str, options: &ExportOptions) -> Result<String, SqliteError> {
        let mut output = String::new();
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;

        if options.include_create {
            let pool = self.get_pool(id)?.clone();
            let create_sql: Option<String> = sqlx::query_scalar(&format!("SELECT sql FROM sqlite_master WHERE type='table' AND name='{}'", table))
                .fetch_optional(&pool).await.ok().flatten();
            if let Some(cs) = create_sql {
                output.push_str(&cs);
                output.push_str(";\n\n");
            }
        }

        loop {
            let sql = format!("SELECT * FROM \"{}\" LIMIT {} OFFSET {}", table, chunk, offset);
            let result = self.execute_query(id, &sql).await?;
            if result.rows.is_empty() { break; }
            let col_names: Vec<String> = result.columns.iter().map(|c| c.name.clone()).collect();
            for row in &result.rows {
                let vals: Vec<String> = col_names.iter().map(|c| {
                    match row.get(c) {
                        Some(serde_json::Value::String(s)) => format!("'{}'", s.replace('\'', "''")),
                        Some(serde_json::Value::Null) | None => "NULL".to_string(),
                        Some(v) => v.to_string(),
                    }
                }).collect();
                let quoted_cols: Vec<String> = col_names.iter().map(|c| format!("\"{}\"", c)).collect();
                output.push_str(&format!("INSERT INTO \"{}\" ({}) VALUES ({});\n", table, quoted_cols.join(", "), vals.join(", ")));
            }
            offset += chunk;
            if result.rows.len() < chunk as usize { break; }
        }
        Ok(output)
    }

    async fn export_json(&mut self, id: &str, table: &str, options: &ExportOptions) -> Result<String, SqliteError> {
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;
        let mut all_rows: Vec<RowMap> = Vec::new();
        loop {
            let sql = format!("SELECT * FROM \"{}\" LIMIT {} OFFSET {}", table, chunk, offset);
            let result = self.execute_query(id, &sql).await?;
            if result.rows.is_empty() { break; }
            all_rows.extend(result.rows.clone());
            offset += chunk;
            if result.rows.len() < chunk as usize { break; }
        }
        serde_json::to_string_pretty(&all_rows)
            .map_err(|e| SqliteError::new(SqliteErrorKind::ExportFailed, format!("{e}")))
    }

    pub async fn export_database(&mut self, id: &str, options: &ExportOptions) -> Result<String, SqliteError> {
        let tables = self.list_tables(id).await?;
        let mut output = String::new();
        for t in &tables {
            if t.table_type == "table" {
                output.push_str(&format!("-- Table: {}\n", t.name));
                let tbl = self.export_table(id, &t.name, options).await?;
                output.push_str(&tbl);
                output.push_str("\n\n");
            }
        }
        Ok(output)
    }

    // ── Import ──────────────────────────────────────────────────

    pub async fn import_sql(&mut self, id: &str, sql_content: &str) -> Result<u64, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let statements: Vec<&str> = sql_content.split(';').filter(|s| !s.trim().is_empty()).collect();
        let mut count: u64 = 0;
        for stmt in &statements {
            sqlx::query(stmt.trim()).execute(&pool).await
                .map_err(|e| SqliteError::new(SqliteErrorKind::ImportFailed, format!("Statement: {e}")))?;
            count += 1;
        }
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += count;
        Ok(count)
    }

    pub async fn import_csv(&mut self, id: &str, table: &str, csv_content: &str, has_header: bool) -> Result<u64, SqliteError> {
        let mut lines = csv_content.lines();
        let headers: Option<Vec<String>> = if has_header {
            lines.next().map(|h| h.split(',').map(|s| s.trim().trim_matches('"').to_string()).collect())
        } else { None };

        let pool = self.get_pool(id)?.clone();
        let mut count: u64 = 0;

        for line in lines {
            if line.trim().is_empty() { continue; }
            let values: Vec<String> = line.split(',').map(|s| s.trim().trim_matches('"').to_string()).collect();
            let placeholders = (0..values.len()).map(|_| "?").collect::<Vec<_>>().join(", ");

            let sql = if let Some(ref h) = headers {
                let cols = h.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(", ");
                format!("INSERT INTO \"{}\" ({}) VALUES ({})", table, cols, placeholders)
            } else {
                format!("INSERT INTO \"{}\" VALUES ({})", table, placeholders)
            };

            let mut q = sqlx::query(&sql);
            for v in &values { q = q.bind(v); }
            q.execute(&pool).await
                .map_err(|e| SqliteError::new(SqliteErrorKind::ImportFailed, format!("CSV: {e}")))?;
            count += 1;
        }

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += count;
        Ok(count)
    }

    // ── Database info ───────────────────────────────────────────

    pub async fn database_size(&mut self, id: &str) -> Result<i64, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let page_count: i64 = sqlx::query_scalar("PRAGMA page_count")
            .fetch_one(&pool).await.unwrap_or(0);
        let page_size: i64 = sqlx::query_scalar("PRAGMA page_size")
            .fetch_one(&pool).await.unwrap_or(4096);
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 2;
        Ok(page_count * page_size)
    }

    pub async fn table_count(&mut self, id: &str, table: &str) -> Result<i64, SqliteError> {
        let pool = self.get_pool(id)?.clone();
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", table))
            .fetch_one(&pool).await
            .map_err(|e| SqliteError::new(SqliteErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(count)
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = SqliteService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn session_not_found() {
        let svc = SqliteService::new();
        assert!(svc.get_session("x").is_err());
    }

    #[test]
    fn ping_not_found() {
        let svc = SqliteService::new();
        assert!(svc.ping("x").is_err());
    }

    #[tokio::test]
    async fn disconnect_not_found() {
        let mut svc = SqliteService::new();
        assert!(svc.disconnect("x").await.is_err());
    }

    #[tokio::test]
    async fn disconnect_all_empty() {
        let mut svc = SqliteService::new();
        svc.disconnect_all().await;
        assert!(svc.list_sessions().is_empty());
    }

    #[tokio::test]
    async fn connect_memory() {
        let mut svc = SqliteService::new();
        let id = svc.connect(SqliteConnectionConfig::memory()).await.unwrap();
        assert!(!id.is_empty());
        let sessions = svc.list_sessions();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].is_memory);
        assert_eq!(sessions[0].status, ConnectionStatus::Connected);
        svc.disconnect(&id).await.unwrap();
        assert!(svc.list_sessions().is_empty());
    }

    #[tokio::test]
    async fn basic_crud_memory() {
        let mut svc = SqliteService::new();
        let id = svc.connect(SqliteConnectionConfig::memory()).await.unwrap();

        svc.execute_statement(&id, "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)").await.unwrap();
        let affected = svc.insert_row(&id, "test", &["name".to_string()], &["Alice".to_string()]).await.unwrap();
        assert_eq!(affected, 1);

        let qr = svc.get_table_data(&id, "test", None, None).await.unwrap();
        assert_eq!(qr.rows.len(), 1);

        let del = svc.delete_rows(&id, "test", "id = 1").await.unwrap();
        assert_eq!(del, 1);

        svc.disconnect(&id).await.unwrap();
    }

    #[tokio::test]
    async fn schema_introspection_memory() {
        let mut svc = SqliteService::new();
        let id = svc.connect(SqliteConnectionConfig::memory()).await.unwrap();

        svc.execute_statement(&id, "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL DEFAULT 0.0)").await.unwrap();

        let tables = svc.list_tables(&id).await.unwrap();
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "items");

        let cols = svc.describe_table(&id, "items").await.unwrap();
        assert_eq!(cols.len(), 3);
        assert!(cols[0].is_primary_key);
        assert!(!cols[1].is_nullable); // NOT NULL

        svc.disconnect(&id).await.unwrap();
    }

    #[tokio::test]
    async fn vacuum_memory() {
        let mut svc = SqliteService::new();
        let id = svc.connect(SqliteConnectionConfig::memory()).await.unwrap();
        svc.vacuum(&id).await.unwrap();
        svc.disconnect(&id).await.unwrap();
    }

    #[tokio::test]
    async fn integrity_check_memory() {
        let mut svc = SqliteService::new();
        let id = svc.connect(SqliteConnectionConfig::memory()).await.unwrap();
        let results = svc.integrity_check(&id).await.unwrap();
        assert_eq!(results, vec!["ok"]);
        svc.disconnect(&id).await.unwrap();
    }

    #[tokio::test]
    async fn export_csv() {
        let mut svc = SqliteService::new();
        let id = svc.connect(SqliteConnectionConfig::memory()).await.unwrap();
        svc.execute_statement(&id, "CREATE TABLE t (a TEXT, b TEXT)").await.unwrap();
        svc.insert_row(&id, "t", &["a".to_string(), "b".to_string()], &["x".to_string(), "y".to_string()]).await.unwrap();
        let csv = svc.export_table(&id, "t", &ExportOptions::default()).await.unwrap();
        assert!(csv.contains("a,b"));
        assert!(csv.contains("x,y"));
        svc.disconnect(&id).await.unwrap();
    }

    #[tokio::test]
    async fn database_size_memory() {
        let mut svc = SqliteService::new();
        let id = svc.connect(SqliteConnectionConfig::memory()).await.unwrap();
        let size = svc.database_size(&id).await.unwrap();
        assert!(size > 0);
        svc.disconnect(&id).await.unwrap();
    }
}
