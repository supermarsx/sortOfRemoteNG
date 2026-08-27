//! MySQL / MariaDB service: connection lifecycle, query execution,
//! schema introspection, import / export, and server administration.

use crate::mysql::types::*;
use log::{debug, info, warn};
use sqlx::mysql::{MySqlPoolOptions, MySqlRow};
use sqlx::{Column, MySqlPool, Row, TypeInfo};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

pub type MysqlServiceState = Arc<Mutex<MysqlService>>;

/// Decode a text column that the server may flag as `BINARY`.
///
/// MySQL 8 serves `information_schema` from the data dictionary and returns
/// its name columns (`SCHEMA_NAME`, `TABLE_NAME`, `COLUMN_NAME`, …) as
/// `VAR_STRING` with the `BINARY` flag set, which sqlx decodes as bytes and
/// refuses to hand back as `String`. MariaDB returns the same columns as
/// plain text. Try text first, then fall back to bytes; `None` means SQL
/// NULL or a genuinely undecodable value.
fn text_col<I>(row: &MySqlRow, index: I) -> Option<String>
where
    I: sqlx::ColumnIndex<MySqlRow> + Copy,
{
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return value;
    }
    row.try_get::<Option<Vec<u8>>, _>(index)
        .ok()
        .flatten()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// [`text_col`] with an empty string for NULL / undecodable values.
fn text_or_default<I>(row: &MySqlRow, index: I) -> String
where
    I: sqlx::ColumnIndex<MySqlRow> + Copy,
{
    text_col(row, index).unwrap_or_default()
}

/// Convert one result-set cell to JSON.
///
/// sqlx type-checks its decoders, so a single `try_get::<String>` does not
/// merely lose formatting on non-text columns — it *fails*, and the previous
/// `unwrap_or("NULL")` turned every integer, float, date and blob into the
/// literal string `"NULL"`. Walk the plausible decoders in order and fall
/// back to raw bytes, so a real SQL NULL is the only thing that yields
/// `Value::Null`.
fn cell_to_json(row: &MySqlRow, index: usize) -> serde_json::Value {
    use serde_json::Value;

    macro_rules! try_decode {
        ($ty:ty, $wrap:expr) => {
            if let Ok(decoded) = row.try_get::<Option<$ty>, _>(index) {
                #[allow(clippy::redundant_closure_call)]
                return decoded.map_or(Value::Null, $wrap);
            }
        };
    }

    // DECIMAL/NUMERIC must not round-trip through f64 — a money column would
    // silently lose precision. MySQL sends DECIMAL as a length-encoded
    // *string* in both the text and binary protocols, but sqlx's type-
    // compatibility check rejects `String` and `Vec<u8>` for it, so read the
    // exact wire text with the unchecked decoder.
    let is_decimal = row
        .try_column(index)
        .ok()
        .map(|c| c.type_info().name())
        .is_some_and(|name| {
            name.eq_ignore_ascii_case("DECIMAL") || name.eq_ignore_ascii_case("NEWDECIMAL")
        });
    if is_decimal {
        if let Ok(decoded) = row.try_get_unchecked::<Option<String>, _>(index) {
            return decoded.map_or(Value::Null, Value::String);
        }
    }

    // No `bool` arm: MySQL has no boolean type — `BOOLEAN` is `TINYINT(1)`,
    // and sqlx's bool decoder accepts every integer width, so it would turn
    // `42` into `true`. Integers stay integers.
    try_decode!(String, Value::String);
    try_decode!(i64, |v: i64| Value::Number(v.into()));
    try_decode!(u64, |v: u64| Value::Number(v.into()));
    try_decode!(f64, |v: f64| serde_json::Number::from_f64(v)
        .map_or(Value::Null, Value::Number));
    try_decode!(chrono::NaiveDateTime, |v: chrono::NaiveDateTime| {
        Value::String(v.format("%Y-%m-%d %H:%M:%S%.f").to_string())
    });
    try_decode!(chrono::NaiveDate, |v: chrono::NaiveDate| Value::String(
        v.to_string()
    ));
    try_decode!(chrono::NaiveTime, |v: chrono::NaiveTime| Value::String(
        v.to_string()
    ));
    try_decode!(chrono::DateTime<chrono::Utc>, |v: chrono::DateTime<
        chrono::Utc,
    >| Value::String(
        v.to_rfc3339()
    ));
    // Binary last: covers BLOB/BINARY and the BINARY-flagged VAR_STRING that
    // MySQL 8 uses for information_schema name columns.
    try_decode!(Vec<u8>, |v: Vec<u8>| Value::String(
        String::from_utf8_lossy(&v).into_owned()
    ));

    Value::Null
}

/// Central MySQL service that manages multiple named sessions.
pub struct MysqlService {
    sessions: std::collections::HashMap<String, MysqlSession>,
}

struct MysqlSession {
    pool: MySqlPool,
    #[allow(dead_code)]
    config: MysqlConnectionConfig,
    info: SessionInfo,
}

pub fn new_state() -> MysqlServiceState {
    Arc::new(Mutex::new(MysqlService::new()))
}

impl Default for MysqlService {
    fn default() -> Self {
        Self::new()
    }
}

impl MysqlService {
    // ── Construction ────────────────────────────────────────────────

    pub fn new() -> Self {
        Self {
            sessions: std::collections::HashMap::new(),
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn generate_id() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    fn pool_for(&self, session_id: &str) -> Result<&MySqlPool, MysqlError> {
        self.sessions
            .get(session_id)
            .map(|s| &s.pool)
            .ok_or_else(MysqlError::not_connected)
    }

    #[allow(dead_code)]
    fn session_mut(&mut self, id: &str) -> Result<&mut MysqlSession, MysqlError> {
        self.sessions
            .get_mut(id)
            .ok_or_else(MysqlError::not_connected)
    }

    fn count_queries(&mut self, id: &str) {
        if let Some(s) = self.sessions.get_mut(id) {
            s.info.queries_executed += 1;
        }
    }

    fn validate_sql_identifier(name: &str) -> Result<(), MysqlError> {
        if name.is_empty() || name.len() > 128 {
            return Err(MysqlError::new(
                MysqlErrorKind::InvalidInput,
                "SQL identifier must be 1-128 characters",
            ));
        }
        if !name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
        {
            return Err(MysqlError::new(
                MysqlErrorKind::InvalidInput,
                format!("Invalid SQL identifier: {}", name),
            ));
        }
        Ok(())
    }

    fn validate_where_clause(clause: &str) -> Result<(), MysqlError> {
        if clause.is_empty() {
            return Err(MysqlError::invalid("WHERE clause cannot be empty"));
        }
        if clause.contains(';') {
            return Err(MysqlError::invalid(
                "WHERE clause must not contain semicolons",
            ));
        }
        if clause.contains("--") || clause.contains("/*") {
            return Err(MysqlError::invalid(
                "WHERE clause must not contain SQL comments",
            ));
        }
        let upper = clause.to_uppercase();
        for kw in ["UNION", "DROP", "ALTER", "CREATE", "INSERT", "EXEC", "XP_"] {
            if upper.split_whitespace().any(|w| w == kw) || upper.contains(&format!(" {} ", kw)) {
                return Err(MysqlError::invalid(format!(
                    "WHERE clause must not contain {}",
                    kw
                )));
            }
        }
        Ok(())
    }

    // ── Connect / disconnect ────────────────────────────────────────

    /// Open a new connection and return a session ID.
    ///
    /// SSH tunnels are refused up front: the previous implementation
    /// authenticated against the bastion and then dialled an *unbound* local
    /// port, which would have sent the database credentials to whatever
    /// happened to listen there. Until a real forwarder is composed from
    /// `sorng-ssh`, this fails closed exactly like `sorng-postgres`.
    pub async fn connect(&mut self, config: MysqlConnectionConfig) -> Result<String, MysqlError> {
        if config.requests_ssh_tunnel() {
            return Err(MysqlError::unsupported(
                "SSH tunnelling is not available for MySQL sessions; use a direct target",
            ));
        }

        let id = Self::generate_id();
        debug!("mysql connect target: {}", config.display_url());

        let pool = MySqlPoolOptions::new()
            .max_connections(config.max_connections.unwrap_or(5).max(1))
            .acquire_timeout(std::time::Duration::from_secs(
                config.connect_timeout_secs.unwrap_or(30),
            ))
            .idle_timeout(Some(std::time::Duration::from_secs(
                config.idle_timeout_secs.unwrap_or(300),
            )))
            .connect_with(config.connect_options())
            .await
            .map_err(|e| MysqlError::connection(format!("MySQL connect failed: {}", e)))?;

        let (version, dialect, tls_enabled) = Self::probe_server(&pool).await;

        let now = chrono::Utc::now().to_rfc3339();

        let session_info = SessionInfo {
            id: id.clone(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            database: config.database.clone(),
            status: ConnectionStatus::Connected,
            dialect,
            server_version: version,
            server_charset: None,
            connected_at: Some(now),
            via_ssh_tunnel: false,
            tls_enabled,
            queries_executed: 0,
            total_rows_fetched: 0,
        };

        info!(
            "MySQL session {} connected to {}:{} ({} {}, tls={})",
            id,
            config.host,
            config.port,
            dialect,
            session_info.server_version.as_deref().unwrap_or("?"),
            tls_enabled
        );

        self.sessions.insert(
            id.clone(),
            MysqlSession {
                pool,
                config,
                info: session_info,
            },
        );

        Ok(id)
    }

    /// Read `VERSION()` and the negotiated cipher from a fresh pool.
    /// Failures degrade to `None` / MySQL / `false` rather than failing the
    /// connect, since the pool itself is already proven alive.
    async fn probe_server(pool: &MySqlPool) -> (Option<String>, ServerDialect, bool) {
        let version = sqlx::query("SELECT VERSION()")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .and_then(|r| text_col(&r, 0));
        let dialect = version
            .as_deref()
            .map(ServerDialect::detect)
            .unwrap_or_default();
        let tls_enabled = sqlx::query("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .and_then(|r| text_col(&r, 1))
            .is_some_and(|cipher| !cipher.trim().is_empty());
        (version, dialect, tls_enabled)
    }

    /// Disconnect a session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), MysqlError> {
        if let Some(sess) = self.sessions.remove(session_id) {
            sess.pool.close().await;
            info!("MySQL session {} disconnected", session_id);
            Ok(())
        } else {
            Err(MysqlError::not_connected())
        }
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            let _ = self.disconnect(&id).await;
        }
    }

    // ── Session listing ─────────────────────────────────────────────

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    pub fn get_session(&self, id: &str) -> Result<SessionInfo, MysqlError> {
        self.sessions
            .get(id)
            .map(|s| s.info.clone())
            .ok_or_else(MysqlError::not_connected)
    }

    /// Dialect / version / negotiated-TLS summary for a session, as captured
    /// at connect time.
    pub fn server_info(&self, id: &str) -> Result<ServerInfo, MysqlError> {
        self.sessions
            .get(id)
            .map(|s| ServerInfo {
                dialect: s.info.dialect,
                server_version: s.info.server_version.clone(),
                tls_enabled: s.info.tls_enabled,
            })
            .ok_or_else(MysqlError::not_connected)
    }

    // ── Query execution ─────────────────────────────────────────────

    /// Execute an arbitrary SQL statement and return the result set.
    pub async fn execute_query(
        &mut self,
        session_id: &str,
        sql: &str,
    ) -> Result<QueryResult, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let start = Instant::now();

        let rows = sqlx::query(sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;

        let elapsed = start.elapsed().as_millis() as u64;

        if rows.is_empty() {
            self.count_queries(session_id);
            return Ok(QueryResult {
                execution_time_ms: elapsed,
                ..QueryResult::empty()
            });
        }

        let columns: Vec<ColumnInfo> = rows[0]
            .columns()
            .iter()
            .enumerate()
            .map(|(i, c)| ColumnInfo {
                name: c.name().to_string(),
                ordinal: i,
                data_type: c.type_info().to_string(),
                is_nullable: true,
                max_length: None,
            })
            .collect();

        let mut result_rows: Vec<Vec<serde_json::Value>> = Vec::with_capacity(rows.len());
        for row in &rows {
            let mut vals: Vec<serde_json::Value> = Vec::with_capacity(columns.len());
            for (i, _) in columns.iter().enumerate() {
                vals.push(cell_to_json(row, i));
            }
            result_rows.push(vals);
        }

        let row_count = result_rows.len();
        self.count_queries(session_id);
        if let Some(s) = self.sessions.get_mut(session_id) {
            s.info.total_rows_fetched += row_count as u64;
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            row_count,
            affected_rows: 0,
            last_insert_id: None,
            execution_time_ms: elapsed,
            warnings: vec![],
        })
    }

    /// Execute a statement that does not return rows (INSERT/UPDATE/DELETE/DDL).
    pub async fn execute_statement(
        &mut self,
        session_id: &str,
        sql: &str,
    ) -> Result<QueryResult, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let start = Instant::now();

        let result = sqlx::query(sql)
            .execute(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;

        let elapsed = start.elapsed().as_millis() as u64;
        self.count_queries(session_id);

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            affected_rows: result.rows_affected(),
            last_insert_id: Some(result.last_insert_id()),
            execution_time_ms: elapsed,
            warnings: vec![],
        })
    }

    /// Run EXPLAIN on a query.
    pub async fn explain_query(
        &mut self,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<ExplainRow>, MysqlError> {
        if sql.contains(';') {
            return Err(MysqlError::invalid(
                "EXPLAIN query must not contain semicolons",
            ));
        }
        let pool = self.pool_for(session_id)?.clone();
        let explain_sql = format!("EXPLAIN {}", sql);

        let rows = sqlx::query(&explain_sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("EXPLAIN failed: {}", e)))?;

        self.count_queries(session_id);

        let mut result = Vec::new();
        for row in &rows {
            result.push(ExplainRow {
                id: row.try_get::<i64, _>("id").ok().map(|v| v as u64),
                select_type: text_col(row, "select_type"),
                table: text_col(row, "table"),
                partitions: text_col(row, "partitions"),
                access_type: text_col(row, "type"),
                possible_keys: text_col(row, "possible_keys"),
                key: text_col(row, "key"),
                key_len: text_col(row, "key_len"),
                ref_col: text_col(row, "ref"),
                rows: row.try_get::<i64, _>("rows").ok().map(|v| v as u64),
                filtered: row.try_get::<f64, _>("filtered").ok(),
                extra: text_col(row, "Extra"),
            });
        }
        Ok(result)
    }

    // ── Schema introspection ────────────────────────────────────────

    /// List databases.
    pub async fn list_databases(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<DatabaseInfo>, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let rows = sqlx::query(
            "SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME \
             FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        Ok(rows
            .iter()
            .map(|r| DatabaseInfo {
                name: text_or_default(r, 0),
                character_set: text_col(r, 1),
                collation: text_col(r, 2),
                table_count: None,
            })
            .collect())
    }

    /// List tables in a database.
    pub async fn list_tables(
        &mut self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<TableInfo>, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let sql = format!(
            "SELECT TABLE_NAME, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, \
             AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME, TABLE_COLLATION, TABLE_COMMENT \
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{}' AND TABLE_TYPE = 'BASE TABLE' \
             ORDER BY TABLE_NAME",
            database.replace('\'', "''")
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        Ok(rows
            .iter()
            .map(|r| TableInfo {
                name: text_or_default(r, 0),
                engine: text_col(r, 1),
                row_count: r.try_get::<i64, _>(2).ok().map(|v| v as u64),
                data_length: r.try_get::<i64, _>(3).ok().map(|v| v as u64),
                index_length: r.try_get::<i64, _>(4).ok().map(|v| v as u64),
                auto_increment: r.try_get::<i64, _>(5).ok().map(|v| v as u64),
                create_time: text_col(r, 6),
                update_time: text_col(r, 7),
                collation: text_col(r, 8),
                comment: text_col(r, 9),
            })
            .collect())
    }

    /// Get column definitions for a table.
    pub async fn describe_table(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
    ) -> Result<Vec<ColumnDef>, MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        let pool = self.pool_for(session_id)?.clone();
        let sql = format!(
            "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, \
             EXTRA, CHARACTER_SET_NAME, COLLATION_NAME, ORDINAL_POSITION, COLUMN_COMMENT \
             FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
             ORDER BY ORDINAL_POSITION",
            database.replace('\'', "''"),
            table.replace('\'', "''")
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        Ok(rows
            .iter()
            .map(|r| {
                let key = text_or_default(r, 4);
                let extra = text_or_default(r, 5);
                ColumnDef {
                    name: text_or_default(r, 0),
                    data_type: text_or_default(r, 1),
                    is_nullable: text_or_default(r, 2) == "YES",
                    column_default: text_col(r, 3),
                    is_primary_key: key == "PRI",
                    is_unique: key == "UNI" || key == "PRI",
                    is_auto_increment: extra.contains("auto_increment"),
                    character_set: text_col(r, 6),
                    collation: text_col(r, 7),
                    ordinal_position: r.try_get::<i32, _>(8).unwrap_or(0) as u32,
                    extra: extra.clone(),
                    comment: text_col(r, 9),
                }
            })
            .collect())
    }

    /// List indexes on a table.
    pub async fn list_indexes(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        let pool = self.pool_for(session_id)?.clone();
        let sql = format!(
            "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE \
             FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
             ORDER BY INDEX_NAME, SEQ_IN_INDEX",
            database.replace('\'', "''"),
            table.replace('\'', "''")
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        // Group columns by index name
        let mut map: std::collections::HashMap<String, IndexInfo> =
            std::collections::HashMap::new();
        for r in &rows {
            let idx_name = text_or_default(r, 0);
            let col_name = text_or_default(r, 1);
            let non_unique: i32 = r.try_get::<i32, _>(2).unwrap_or(1);
            let idx_type = text_or_default(r, 3);

            map.entry(idx_name.clone())
                .and_modify(|idx| idx.columns.push(col_name.clone()))
                .or_insert(IndexInfo {
                    name: idx_name.clone(),
                    columns: vec![col_name],
                    is_unique: non_unique == 0,
                    is_primary: idx_name == "PRIMARY",
                    index_type: idx_type,
                });
        }
        Ok(map.into_values().collect())
    }

    /// List foreign keys on a table.
    pub async fn list_foreign_keys(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        let pool = self.pool_for(session_id)?.clone();
        let sql = format!(
            "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, \
             rc.UPDATE_RULE, rc.DELETE_RULE \
             FROM information_schema.KEY_COLUMN_USAGE kcu \
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc USING(CONSTRAINT_SCHEMA, CONSTRAINT_NAME) \
             WHERE kcu.TABLE_SCHEMA = '{}' AND kcu.TABLE_NAME = '{}' \
             AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
             ORDER BY CONSTRAINT_NAME",
            database.replace('\'', "''"),
            table.replace('\'', "''")
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        Ok(rows
            .iter()
            .map(|r| ForeignKeyInfo {
                name: text_or_default(r, 0),
                column: text_or_default(r, 1),
                referenced_table: text_or_default(r, 2),
                referenced_column: text_or_default(r, 3),
                on_update: text_or_default(r, 4),
                on_delete: text_or_default(r, 5),
            })
            .collect())
    }

    /// List views.
    pub async fn list_views(
        &mut self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<ViewInfo>, MysqlError> {
        Self::validate_sql_identifier(database)?;
        let pool = self.pool_for(session_id)?.clone();
        let sql = format!(
            "SELECT TABLE_NAME, VIEW_DEFINITION, DEFINER, IS_UPDATABLE \
             FROM information_schema.VIEWS WHERE TABLE_SCHEMA = '{}' ORDER BY TABLE_NAME",
            database.replace('\'', "''")
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        Ok(rows
            .iter()
            .map(|r| ViewInfo {
                name: text_or_default(r, 0),
                definition: text_col(r, 1),
                definer: text_or_default(r, 2),
                is_updatable: text_or_default(r, 3) == "YES",
            })
            .collect())
    }

    /// List stored routines (procedures + functions).
    pub async fn list_routines(
        &mut self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<RoutineInfo>, MysqlError> {
        Self::validate_sql_identifier(database)?;
        let pool = self.pool_for(session_id)?.clone();
        let sql = format!(
            "SELECT ROUTINE_NAME, ROUTINE_TYPE, DEFINER, CREATED, LAST_ALTERED, ROUTINE_DEFINITION \
             FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '{}' ORDER BY ROUTINE_NAME",
            database.replace('\'', "''")
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        Ok(rows
            .iter()
            .map(|r| RoutineInfo {
                name: text_or_default(r, 0),
                routine_type: text_or_default(r, 1),
                definer: text_or_default(r, 2),
                created: text_col(r, 3),
                modified: text_col(r, 4),
                body: text_col(r, 5),
            })
            .collect())
    }

    /// List triggers.
    pub async fn list_triggers(
        &mut self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<TriggerInfo>, MysqlError> {
        Self::validate_sql_identifier(database)?;
        let pool = self.pool_for(session_id)?.clone();
        let sql = format!(
            "SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING, ACTION_STATEMENT \
             FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '{}' ORDER BY TRIGGER_NAME",
            database.replace('\'', "''")
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::schema(format!("{}", e)))?;

        self.count_queries(session_id);

        Ok(rows
            .iter()
            .map(|r| TriggerInfo {
                name: text_or_default(r, 0),
                event: text_or_default(r, 1),
                table: text_or_default(r, 2),
                timing: text_or_default(r, 3),
                statement: text_or_default(r, 4),
            })
            .collect())
    }

    // ── DDL helpers ─────────────────────────────────────────────────

    pub async fn create_database(
        &mut self,
        session_id: &str,
        name: &str,
        charset: Option<&str>,
    ) -> Result<(), MysqlError> {
        let cs = charset.unwrap_or("utf8mb4");
        let sql = format!("CREATE DATABASE `{}` CHARACTER SET {}", name, cs);
        self.execute_statement(session_id, &sql).await?;
        Ok(())
    }

    pub async fn drop_database(&mut self, session_id: &str, name: &str) -> Result<(), MysqlError> {
        let sql = format!("DROP DATABASE `{}`", name);
        self.execute_statement(session_id, &sql).await?;
        Ok(())
    }

    pub async fn create_table_from_sql(
        &mut self,
        session_id: &str,
        sql: &str,
    ) -> Result<(), MysqlError> {
        self.execute_statement(session_id, sql).await?;
        Ok(())
    }

    pub async fn drop_table(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
    ) -> Result<(), MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        let sql = format!("DROP TABLE `{}`.`{}`", database, table);
        self.execute_statement(session_id, &sql).await?;
        Ok(())
    }

    pub async fn truncate_table(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
    ) -> Result<(), MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        let sql = format!("TRUNCATE TABLE `{}`.`{}`", database, table);
        self.execute_statement(session_id, &sql).await?;
        Ok(())
    }

    // ── Table data CRUD ─────────────────────────────────────────────

    pub async fn get_table_data(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<QueryResult, MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        let mut sql = format!("SELECT * FROM `{}`.`{}`", database, table);
        if let Some(l) = limit {
            sql.push_str(&format!(" LIMIT {}", l));
            if let Some(o) = offset {
                sql.push_str(&format!(" OFFSET {}", o));
            }
        }
        self.execute_query(session_id, &sql).await
    }

    pub async fn insert_row(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        columns: &[String],
        values: &[String],
    ) -> Result<u64, MysqlError> {
        if columns.len() != values.len() {
            return Err(MysqlError::invalid("Column/value count mismatch"));
        }
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        let cols = columns
            .iter()
            .map(|c| format!("`{}`", c))
            .collect::<Vec<_>>()
            .join(", ");
        let placeholders = vec!["?"; values.len()].join(", ");
        let sql = format!(
            "INSERT INTO `{}`.`{}` ({}) VALUES ({})",
            database, table, cols, placeholders
        );

        let pool = self.pool_for(session_id)?.clone();
        let mut q = sqlx::query(&sql);
        for v in values {
            q = q.bind(v);
        }
        let res = q
            .execute(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(res.last_insert_id())
    }

    pub async fn update_rows(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        columns: &[String],
        values: &[String],
        where_clause: &str,
    ) -> Result<u64, MysqlError> {
        if columns.len() != values.len() {
            return Err(MysqlError::invalid("Column/value count mismatch"));
        }
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        for col in columns {
            Self::validate_sql_identifier(col)?;
        }
        Self::validate_where_clause(where_clause)?;
        let set_parts = columns
            .iter()
            .map(|c| format!("`{}` = ?", c))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE `{}`.`{}` SET {} WHERE {}",
            database, table, set_parts, where_clause
        );

        let pool = self.pool_for(session_id)?.clone();
        let mut q = sqlx::query(&sql);
        for v in values {
            q = q.bind(v);
        }
        let res = q
            .execute(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(res.rows_affected())
    }

    pub async fn delete_rows(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        where_clause: &str,
    ) -> Result<u64, MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        Self::validate_where_clause(where_clause)?;
        let sql = format!(
            "DELETE FROM `{}`.`{}` WHERE {}",
            database, table, where_clause
        );
        let pool = self.pool_for(session_id)?.clone();
        let res = sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(res.rows_affected())
    }

    // ── Server administration ───────────────────────────────────────

    pub async fn show_variables(
        &mut self,
        session_id: &str,
        filter: Option<&str>,
    ) -> Result<Vec<ServerVariable>, MysqlError> {
        let sql = match filter {
            Some(f) => {
                if f.contains(';') || f.contains('\\') {
                    return Err(MysqlError::invalid("Invalid variable filter"));
                }
                format!("SHOW VARIABLES LIKE '{}'", f.replace('\'', "''"))
            }
            None => "SHOW VARIABLES".into(),
        };
        let pool = self.pool_for(session_id)?.clone();
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(rows
            .iter()
            .map(|r| ServerVariable {
                name: text_or_default(r, 0),
                value: text_or_default(r, 1),
            })
            .collect())
    }

    pub async fn show_processlist(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<ProcessInfo>, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let rows = sqlx::query("SHOW FULL PROCESSLIST")
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(rows
            .iter()
            .map(|r| ProcessInfo {
                id: r.try_get::<i64, _>(0).unwrap_or(0) as u64,
                user: text_or_default(r, 1),
                host: text_or_default(r, 2),
                db: text_col(r, 3),
                command: text_or_default(r, 4),
                time: r.try_get::<i64, _>(5).unwrap_or(0) as u64,
                state: text_col(r, 6),
                info: text_col(r, 7),
            })
            .collect())
    }

    pub async fn kill_process(
        &mut self,
        session_id: &str,
        process_id: u64,
    ) -> Result<(), MysqlError> {
        let sql = format!("KILL {}", process_id);
        self.execute_statement(session_id, &sql).await?;
        Ok(())
    }

    pub async fn show_grants(
        &mut self,
        session_id: &str,
        user: &str,
        host: &str,
    ) -> Result<Vec<String>, MysqlError> {
        Self::validate_sql_identifier(user)?;
        if !host
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '%'))
        {
            return Err(MysqlError::invalid("Invalid host identifier"));
        }
        let sql = format!(
            "SHOW GRANTS FOR '{}'@'{}'",
            user.replace('\'', "''"),
            host.replace('\'', "''")
        );
        let pool = self.pool_for(session_id)?.clone();
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(rows.iter().map(|r| text_or_default(r, 0)).collect())
    }

    pub async fn list_users(&mut self, session_id: &str) -> Result<Vec<UserInfo>, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let rows = sqlx::query("SELECT User, Host FROM mysql.user ORDER BY User, Host")
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(rows
            .iter()
            .map(|r| UserInfo {
                user: text_or_default(r, 0),
                host: text_or_default(r, 1),
                grants: vec![],
            })
            .collect())
    }

    // ── Export ───────────────────────────────────────────────────────

    pub async fn export_table(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        opts: &ExportOptions,
    ) -> Result<String, MysqlError> {
        Self::validate_sql_identifier(database)?;
        Self::validate_sql_identifier(table)?;
        match opts.format {
            ExportFormat::Csv | ExportFormat::Tsv => {
                self.export_table_delimited(session_id, database, table, opts)
                    .await
            }
            ExportFormat::Sql => {
                self.export_table_sql(session_id, database, table, opts)
                    .await
            }
            ExportFormat::Json => {
                self.export_table_json(session_id, database, table, opts)
                    .await
            }
        }
    }

    async fn export_table_delimited(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        opts: &ExportOptions,
    ) -> Result<String, MysqlError> {
        let sep = if opts.format == ExportFormat::Tsv {
            "\t"
        } else {
            ","
        };
        let cols = self.describe_table(session_id, database, table).await?;
        let mut out = String::new();

        // Header
        out.push_str(
            &cols
                .iter()
                .map(|c| c.name.clone())
                .collect::<Vec<_>>()
                .join(sep),
        );
        out.push('\n');

        // Data in chunks
        let mut offset = 0u32;
        let mut chunks = 0u32;
        loop {
            if chunks >= opts.max_chunks {
                break;
            }
            let data = self
                .get_table_data(
                    session_id,
                    database,
                    table,
                    Some(opts.chunk_size),
                    Some(offset),
                )
                .await?;
            if data.rows.is_empty() {
                break;
            }
            for row in &data.rows {
                let line = row
                    .iter()
                    .map(|v| {
                        let s = match v {
                            serde_json::Value::String(s) => s.clone(),
                            _ => v.to_string(),
                        };
                        if s.contains(sep) || s.contains('"') || s.contains('\n') {
                            format!("\"{}\"", s.replace('"', "\"\""))
                        } else {
                            s
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(sep);
                out.push_str(&line);
                out.push('\n');
            }
            offset += opts.chunk_size;
            chunks += 1;
            if data.rows.len() < opts.chunk_size as usize {
                break;
            }
        }
        Ok(out)
    }

    async fn export_table_sql(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        opts: &ExportOptions,
    ) -> Result<String, MysqlError> {
        let mut out = String::new();
        out.push_str(&format!(
            "-- Export of `{}`.`{}`\n-- Generated at {}\n\n",
            database,
            table,
            chrono::Utc::now().to_rfc3339()
        ));

        if opts.include_schema {
            // Use SHOW CREATE TABLE for accurate DDL
            let pool = self.pool_for(session_id)?.clone();
            let row = sqlx::query(&format!("SHOW CREATE TABLE `{}`.`{}`", database, table))
                .fetch_optional(&pool)
                .await
                .map_err(|e| MysqlError::export(format!("{}", e)))?;
            self.count_queries(session_id);
            if let Some(r) = row {
                let ddl = text_or_default(&r, 1);
                out.push_str(&ddl);
                out.push_str(";\n\n");
            }
        }

        if opts.include_data {
            let cols = self.describe_table(session_id, database, table).await?;
            let col_names = cols
                .iter()
                .map(|c| format!("`{}`", c.name))
                .collect::<Vec<_>>()
                .join(", ");

            let mut offset = 0u32;
            let mut chunks = 0u32;
            loop {
                if chunks >= opts.max_chunks {
                    break;
                }
                let data = self
                    .get_table_data(
                        session_id,
                        database,
                        table,
                        Some(opts.chunk_size),
                        Some(offset),
                    )
                    .await?;
                if data.rows.is_empty() {
                    break;
                }
                for row in &data.rows {
                    let vals = row
                        .iter()
                        .map(|v| match v {
                            // A real SQL NULL is now `Value::Null`; a text
                            // value that happens to read "NULL" stays quoted.
                            serde_json::Value::Null => "NULL".into(),
                            serde_json::Value::String(s) => {
                                format!("'{}'", s.replace('\\', "\\\\").replace('\'', "''"))
                            }
                            other => other.to_string(),
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    out.push_str(&format!(
                        "INSERT INTO `{}` ({}) VALUES ({});\n",
                        table, col_names, vals
                    ));
                }
                offset += opts.chunk_size;
                chunks += 1;
                if data.rows.len() < opts.chunk_size as usize {
                    break;
                }
            }
        }
        Ok(out)
    }

    async fn export_table_json(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        opts: &ExportOptions,
    ) -> Result<String, MysqlError> {
        let mut all_rows: Vec<serde_json::Value> = Vec::new();
        let mut offset = 0u32;
        let mut chunks = 0u32;
        loop {
            if chunks >= opts.max_chunks {
                break;
            }
            let data = self
                .get_table_data(
                    session_id,
                    database,
                    table,
                    Some(opts.chunk_size),
                    Some(offset),
                )
                .await?;
            if data.rows.is_empty() {
                break;
            }
            for row in &data.rows {
                let mut map = serde_json::Map::new();
                for (i, col) in data.columns.iter().enumerate() {
                    if let Some(v) = row.get(i) {
                        map.insert(col.name.clone(), v.clone());
                    }
                }
                all_rows.push(serde_json::Value::Object(map));
            }
            offset += opts.chunk_size;
            chunks += 1;
            if data.rows.len() < opts.chunk_size as usize {
                break;
            }
        }
        serde_json::to_string_pretty(&all_rows)
            .map_err(|e| MysqlError::export(format!("JSON serialization: {}", e)))
    }

    pub async fn export_database(
        &mut self,
        session_id: &str,
        database: &str,
        opts: &ExportOptions,
    ) -> Result<String, MysqlError> {
        let mut out = String::new();
        out.push_str(&format!(
            "-- Database export: `{}`\n-- {}\n\nCREATE DATABASE IF NOT EXISTS `{}`;\nUSE `{}`;\n\n",
            database,
            chrono::Utc::now().to_rfc3339(),
            database,
            database
        ));

        let tables = self.list_tables(session_id, database).await?;
        let filter_tables = opts.tables.as_ref();
        for tbl in &tables {
            if let Some(list) = filter_tables {
                if !list.contains(&tbl.name) {
                    continue;
                }
            }
            let table_export = self
                .export_table(session_id, database, &tbl.name, opts)
                .await?;
            out.push_str(&table_export);
            out.push_str("\n\n");
        }
        Ok(out)
    }

    // ── Import ──────────────────────────────────────────────────────

    pub async fn import_sql(
        &mut self,
        session_id: &str,
        sql_content: &str,
    ) -> Result<u64, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let mut total = 0u64;
        let stmts: Vec<&str> = sql_content
            .split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty() && !s.starts_with("--") && !s.starts_with("/*"))
            .collect();

        for stmt in stmts {
            match sqlx::query(stmt).execute(&pool).await {
                Ok(r) => total += r.rows_affected(),
                Err(e) => warn!("import_sql skip: {}", e),
            }
        }
        self.count_queries(session_id);
        Ok(total)
    }

    pub async fn import_csv(
        &mut self,
        session_id: &str,
        database: &str,
        table: &str,
        csv_content: &str,
        has_header: bool,
    ) -> Result<u64, MysqlError> {
        let mut lines: Vec<&str> = csv_content.lines().collect();
        if lines.is_empty() {
            return Err(MysqlError::import("CSV content is empty"));
        }

        let columns: Vec<String> = if has_header {
            let header = lines.remove(0);
            parse_csv_line(header)
        } else {
            let cols = self.describe_table(session_id, database, table).await?;
            cols.iter().map(|c| c.name.clone()).collect()
        };

        let mut total = 0u64;
        for line in &lines {
            if line.trim().is_empty() {
                continue;
            }
            let values = parse_csv_line(line);
            if values.len() != columns.len() {
                warn!("CSV column mismatch, skipping line");
                continue;
            }
            match self
                .insert_row(session_id, database, table, &columns, &values)
                .await
            {
                Ok(_) => total += 1,
                Err(e) => warn!("CSV import row skip: {}", e),
            }
        }
        Ok(total)
    }

    // ── Misc ────────────────────────────────────────────────────────

    /// Ping to verify the connection pool is alive.
    pub async fn ping(&self, session_id: &str) -> Result<bool, MysqlError> {
        let pool = self.pool_for(session_id)?;
        let row = sqlx::query("SELECT 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| MysqlError::connection(format!("Ping failed: {}", e)))?;
        Ok(row.is_some())
    }

    /// Get server uptime in seconds.
    pub async fn server_uptime(&mut self, session_id: &str) -> Result<u64, MysqlError> {
        let vars = self.show_variables(session_id, Some("Uptime")).await?;
        vars.first()
            .and_then(|v| v.value.parse::<u64>().ok())
            .ok_or_else(|| MysqlError::query("Cannot read Uptime variable"))
    }
}

// ── CSV parser (free function) ──────────────────────────────────────

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                result.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(c),
        }
    }
    result.push(current.trim().to_string());
    result
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = MysqlService::new();
        assert!(svc.sessions.is_empty());
    }

    #[test]
    fn list_sessions_empty() {
        let svc = MysqlService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn get_session_not_found() {
        let svc = MysqlService::new();
        let err = svc.get_session("missing").unwrap_err();
        assert_eq!(err.kind, MysqlErrorKind::NotConnected);
    }

    #[tokio::test]
    async fn ping_not_connected() {
        let svc = MysqlService::new();
        let err = svc.ping("no-session").await.unwrap_err();
        assert_eq!(err.kind, MysqlErrorKind::NotConnected);
    }

    #[tokio::test]
    async fn disconnect_not_found() {
        let mut svc = MysqlService::new();
        let err = svc.disconnect("nope").await.unwrap_err();
        assert_eq!(err.kind, MysqlErrorKind::NotConnected);
    }

    #[tokio::test]
    async fn disconnect_all_empty() {
        let mut svc = MysqlService::new();
        svc.disconnect_all().await; // should not panic
    }

    #[test]
    fn parse_csv_simple() {
        let row = parse_csv_line("a,b,c");
        assert_eq!(row, vec!["a", "b", "c"]);
    }

    #[test]
    fn parse_csv_quoted() {
        let row = parse_csv_line(r#""hello, world","foo""bar",baz"#);
        assert_eq!(row, vec!["hello, world", "foo\"bar", "baz"]);
    }

    #[test]
    fn parse_csv_empty_fields() {
        let row = parse_csv_line(",,");
        assert_eq!(row, vec!["", "", ""]);
    }

    #[test]
    fn server_info_not_found() {
        let svc = MysqlService::new();
        let err = svc.server_info("missing").unwrap_err();
        assert_eq!(err.kind, MysqlErrorKind::NotConnected);
    }

    fn closed_local_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        port
    }

    #[tokio::test]
    async fn connect_rejects_ssh_tunnel_before_dialling() {
        // Point the config at a port that is guaranteed closed: if the
        // tunnel guard did not fire first we would get a Connection error
        // (or wait on the acquire timeout) instead of Unsupported.
        let port = closed_local_port();
        let mut cfg = MysqlConnectionConfig::new("127.0.0.1", port, "u", "p");
        cfg.connect_timeout_secs = Some(1);
        let cfg = cfg.with_ssh_tunnel(SshTunnelConfig {
            enabled: true,
            ssh_host: "127.0.0.1".into(),
            ssh_port: port,
            ssh_username: "ops".into(),
            ssh_password: Some("x".into()),
            ssh_private_key: None,
            ssh_passphrase: None,
        });

        let mut svc = MysqlService::new();
        let started = Instant::now();
        let err = svc.connect(cfg).await.unwrap_err();
        assert_eq!(err.kind, MysqlErrorKind::Unsupported);
        assert!(err.message.contains("SSH tunnelling is not available"));
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
        assert!(svc.list_sessions().is_empty());
    }

    #[tokio::test]
    async fn connect_error_does_not_echo_password() {
        let port = closed_local_port();
        let mut cfg = MysqlConnectionConfig::new("127.0.0.1", port, "us@er", "p@ss:w/ord%#");
        cfg.connect_timeout_secs = Some(2);
        let mut svc = MysqlService::new();
        let err = svc.connect(cfg).await.unwrap_err();
        assert_eq!(err.kind, MysqlErrorKind::Connection);
        assert!(!err.message.contains("p@ss:w/ord%#"), "{}", err.message);
        assert!(!err.message.contains("mysql://"), "{}", err.message);
    }

    #[test]
    fn generate_id_unique() {
        let a = MysqlService::generate_id();
        let b = MysqlService::generate_id();
        assert_ne!(a, b);
    }
}
