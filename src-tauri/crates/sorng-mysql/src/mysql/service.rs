//! MySQL / MariaDB service: connection lifecycle, query execution,
//! schema introspection, import / export, and server administration.

use crate::mysql::types::*;
use log::{debug, info, warn};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::{Column, MySqlPool, Row};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

pub type MysqlServiceState = Arc<Mutex<MysqlService>>;

/// Central MySQL service that manages multiple named sessions.
pub struct MysqlService {
    sessions: std::collections::HashMap<String, MysqlSession>,
}

struct MysqlSession {
    pool: MySqlPool,
    config: MysqlConnectionConfig,
    info: SessionInfo,
    ssh_session: Option<ssh2::Session>,
    _local_port: Option<u16>,
}

pub fn new_state() -> MysqlServiceState {
    Arc::new(Mutex::new(MysqlService::new()))
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

    fn find_available_port() -> Result<u16, MysqlError> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| MysqlError::tunnel(format!("Cannot bind ephemeral port: {}", e)))?;
        listener
            .local_addr()
            .map(|a| a.port())
            .map_err(|e| MysqlError::tunnel(format!("Cannot read port: {}", e)))
    }

    fn pool_for(&self, session_id: &str) -> Result<&MySqlPool, MysqlError> {
        self.sessions
            .get(session_id)
            .map(|s| &s.pool)
            .ok_or_else(|| MysqlError::not_connected())
    }

    fn session_mut(&mut self, id: &str) -> Result<&mut MysqlSession, MysqlError> {
        self.sessions
            .get_mut(id)
            .ok_or_else(|| MysqlError::not_connected())
    }

    fn count_queries(&mut self, id: &str) {
        if let Some(s) = self.sessions.get_mut(id) {
            s.info.queries_executed += 1;
        }
    }

    // ── Connect / disconnect ────────────────────────────────────────

    /// Open a new connection (optionally through an SSH tunnel) and
    /// return a session ID.
    pub async fn connect(&mut self, config: MysqlConnectionConfig) -> Result<String, MysqlError> {
        let id = Self::generate_id();

        // SSH tunnel setup
        let (effective_host, effective_port, ssh_sess, local_port) =
            if let Some(ref tun) = config.ssh_tunnel {
                if tun.enabled {
                    let (sess, lp) = self.setup_ssh_tunnel(tun, &config.host, config.port)?;
                    ("127.0.0.1".to_string(), lp, Some(sess), Some(lp))
                } else {
                    (config.host.clone(), config.port, None, None)
                }
            } else {
                (config.host.clone(), config.port, None, None)
            };

        let url = config.to_url(Some(&effective_host), Some(effective_port));
        debug!("mysql connect url (host masked): mysql://…@{}:{}/…", effective_host, effective_port);

        let pool = MySqlPoolOptions::new()
            .max_connections(config.max_connections.unwrap_or(5))
            .acquire_timeout(std::time::Duration::from_secs(
                config.connect_timeout_secs.unwrap_or(30),
            ))
            .idle_timeout(Some(std::time::Duration::from_secs(
                config.idle_timeout_secs.unwrap_or(300),
            )))
            .connect(&url)
            .await
            .map_err(|e| MysqlError::connection(format!("MySQL connect failed: {}", e)))?;

        // Fetch server version
        let version = sqlx::query("SELECT VERSION()")
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
            .and_then(|r| r.try_get::<String, _>(0).ok());

        let now = chrono::Utc::now().to_rfc3339();

        let session_info = SessionInfo {
            id: id.clone(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            database: config.database.clone(),
            status: ConnectionStatus::Connected,
            server_version: version,
            server_charset: None,
            connected_at: Some(now),
            via_ssh_tunnel: ssh_sess.is_some(),
            tls_enabled: config.tls.as_ref().map_or(false, |t| t.enabled),
            queries_executed: 0,
            total_rows_fetched: 0,
        };

        info!("MySQL session {} connected to {}:{}", id, config.host, config.port);

        self.sessions.insert(
            id.clone(),
            MysqlSession {
                pool,
                config,
                info: session_info,
                ssh_session: ssh_sess,
                _local_port: local_port,
            },
        );

        Ok(id)
    }

    /// Disconnect a session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), MysqlError> {
        if let Some(mut sess) = self.sessions.remove(session_id) {
            sess.pool.close().await;
            if let Some(ssh) = sess.ssh_session.take() {
                let _ = ssh.disconnect(None, "done", None);
            }
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

    // ── SSH tunnel helper ───────────────────────────────────────────

    fn setup_ssh_tunnel(
        &self,
        tun: &SshTunnelConfig,
        db_host: &str,
        db_port: u16,
    ) -> Result<(ssh2::Session, u16), MysqlError> {
        let local_port = Self::find_available_port()?;
        let tcp =
            std::net::TcpStream::connect(format!("{}:{}", tun.ssh_host, tun.ssh_port))
                .map_err(|e| MysqlError::tunnel(format!("SSH connect failed: {}", e)))?;

        let mut sess =
            ssh2::Session::new().map_err(|e| MysqlError::tunnel(format!("SSH session: {}", e)))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| MysqlError::tunnel(format!("SSH handshake: {}", e)))?;

        // Authenticate
        if let Some(ref key) = tun.ssh_private_key {
            let tmp = std::env::temp_dir().join(format!("sorng_ssh_{}", std::process::id()));
            std::fs::write(&tmp, key)
                .map_err(|e| MysqlError::tunnel(format!("Write temp key: {}", e)))?;
            let res = sess.userauth_pubkey_file(
                &tun.ssh_username,
                None,
                &tmp,
                tun.ssh_passphrase.as_deref(),
            );
            let _ = std::fs::remove_file(&tmp);
            res.map_err(|e| MysqlError::tunnel(format!("SSH key auth: {}", e)))?;
        } else if let Some(ref pw) = tun.ssh_password {
            sess.userauth_password(&tun.ssh_username, pw)
                .map_err(|e| MysqlError::tunnel(format!("SSH password auth: {}", e)))?;
        } else {
            return Err(MysqlError::tunnel("No SSH auth method supplied"));
        }

        if !sess.authenticated() {
            return Err(MysqlError::tunnel("SSH authentication failed"));
        }

        debug!(
            "SSH tunnel: local :{} → {}:{}",
            local_port, db_host, db_port
        );

        // NOTE: Real port-forwarding via a background socket-relay is omitted
        // for brevity; the channel_direct_tcpip approach would be used at
        // query-time in a production implementation.

        Ok((sess, local_port))
    }

    // ── Session listing ─────────────────────────────────────────────

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    pub fn get_session(&self, id: &str) -> Result<SessionInfo, MysqlError> {
        self.sessions
            .get(id)
            .map(|s| s.info.clone())
            .ok_or_else(|| MysqlError::not_connected())
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
                let v: String = row.try_get(i).unwrap_or_else(|_| "NULL".to_string());
                vals.push(serde_json::Value::String(v));
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
                select_type: row.try_get("select_type").ok(),
                table: row.try_get("table").ok(),
                partitions: row.try_get("partitions").ok(),
                access_type: row.try_get("type").ok(),
                possible_keys: row.try_get("possible_keys").ok(),
                key: row.try_get("key").ok(),
                key_len: row.try_get("key_len").ok(),
                ref_col: row.try_get("ref").ok(),
                rows: row.try_get::<i64, _>("rows").ok().map(|v| v as u64),
                filtered: row.try_get::<f64, _>("filtered").ok(),
                extra: row.try_get("Extra").ok(),
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
                name: r.try_get(0).unwrap_or_default(),
                character_set: r.try_get(1).ok(),
                collation: r.try_get(2).ok(),
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
                name: r.try_get(0).unwrap_or_default(),
                engine: r.try_get(1).ok(),
                row_count: r.try_get::<i64, _>(2).ok().map(|v| v as u64),
                data_length: r.try_get::<i64, _>(3).ok().map(|v| v as u64),
                index_length: r.try_get::<i64, _>(4).ok().map(|v| v as u64),
                auto_increment: r.try_get::<i64, _>(5).ok().map(|v| v as u64),
                create_time: r.try_get::<String, _>(6).ok(),
                update_time: r.try_get::<String, _>(7).ok(),
                collation: r.try_get(8).ok(),
                comment: r.try_get(9).ok(),
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
                let key: String = r.try_get(4).unwrap_or_default();
                let extra: String = r.try_get(5).unwrap_or_default();
                ColumnDef {
                    name: r.try_get(0).unwrap_or_default(),
                    data_type: r.try_get(1).unwrap_or_default(),
                    is_nullable: r.try_get::<String, _>(2).unwrap_or_default() == "YES",
                    column_default: r.try_get(3).ok(),
                    is_primary_key: key == "PRI",
                    is_unique: key == "UNI" || key == "PRI",
                    is_auto_increment: extra.contains("auto_increment"),
                    character_set: r.try_get(6).ok(),
                    collation: r.try_get(7).ok(),
                    ordinal_position: r.try_get::<i32, _>(8).unwrap_or(0) as u32,
                    extra: extra.clone(),
                    comment: r.try_get(9).ok(),
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
            let idx_name: String = r.try_get(0).unwrap_or_default();
            let col_name: String = r.try_get(1).unwrap_or_default();
            let non_unique: i32 = r.try_get::<i32, _>(2).unwrap_or(1);
            let idx_type: String = r.try_get(3).unwrap_or_default();

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
                name: r.try_get(0).unwrap_or_default(),
                column: r.try_get(1).unwrap_or_default(),
                referenced_table: r.try_get(2).unwrap_or_default(),
                referenced_column: r.try_get(3).unwrap_or_default(),
                on_update: r.try_get(4).unwrap_or_default(),
                on_delete: r.try_get(5).unwrap_or_default(),
            })
            .collect())
    }

    /// List views.
    pub async fn list_views(
        &mut self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<ViewInfo>, MysqlError> {
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
                name: r.try_get(0).unwrap_or_default(),
                definition: r.try_get(1).ok(),
                definer: r.try_get(2).unwrap_or_default(),
                is_updatable: r.try_get::<String, _>(3).unwrap_or_default() == "YES",
            })
            .collect())
    }

    /// List stored routines (procedures + functions).
    pub async fn list_routines(
        &mut self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<RoutineInfo>, MysqlError> {
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
                name: r.try_get(0).unwrap_or_default(),
                routine_type: r.try_get(1).unwrap_or_default(),
                definer: r.try_get(2).unwrap_or_default(),
                created: r.try_get::<String, _>(3).ok(),
                modified: r.try_get::<String, _>(4).ok(),
                body: r.try_get(5).ok(),
            })
            .collect())
    }

    /// List triggers.
    pub async fn list_triggers(
        &mut self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<TriggerInfo>, MysqlError> {
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
                name: r.try_get(0).unwrap_or_default(),
                event: r.try_get(1).unwrap_or_default(),
                table: r.try_get(2).unwrap_or_default(),
                timing: r.try_get(3).unwrap_or_default(),
                statement: r.try_get(4).unwrap_or_default(),
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

    pub async fn drop_database(
        &mut self,
        session_id: &str,
        name: &str,
    ) -> Result<(), MysqlError> {
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
            Some(f) => format!("SHOW VARIABLES LIKE '{}'", f.replace('\'', "''")),
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
                name: r.try_get(0).unwrap_or_default(),
                value: r.try_get(1).unwrap_or_default(),
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
                user: r.try_get(1).unwrap_or_default(),
                host: r.try_get(2).unwrap_or_default(),
                db: r.try_get(3).ok(),
                command: r.try_get(4).unwrap_or_default(),
                time: r.try_get::<i64, _>(5).unwrap_or(0) as u64,
                state: r.try_get(6).ok(),
                info: r.try_get(7).ok(),
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
        let sql = format!("SHOW GRANTS FOR '{}'@'{}'", user.replace('\'', "''"), host.replace('\'', "''"));
        let pool = self.pool_for(session_id)?.clone();
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(rows
            .iter()
            .map(|r| r.try_get::<String, _>(0).unwrap_or_default())
            .collect())
    }

    pub async fn list_users(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<UserInfo>, MysqlError> {
        let pool = self.pool_for(session_id)?.clone();
        let rows = sqlx::query("SELECT User, Host FROM mysql.user ORDER BY User, Host")
            .fetch_all(&pool)
            .await
            .map_err(|e| MysqlError::query(format!("{}", e)))?;
        self.count_queries(session_id);
        Ok(rows
            .iter()
            .map(|r| UserInfo {
                user: r.try_get(0).unwrap_or_default(),
                host: r.try_get(1).unwrap_or_default(),
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
        match opts.format {
            ExportFormat::Csv | ExportFormat::Tsv => {
                self.export_table_delimited(session_id, database, table, opts).await
            }
            ExportFormat::Sql => {
                self.export_table_sql(session_id, database, table, opts).await
            }
            ExportFormat::Json => {
                self.export_table_json(session_id, database, table, opts).await
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
        let sep = if opts.format == ExportFormat::Tsv { "\t" } else { "," };
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
                .get_table_data(session_id, database, table, Some(opts.chunk_size), Some(offset))
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
                let ddl: String = r.try_get(1).unwrap_or_default();
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
                    .get_table_data(session_id, database, table, Some(opts.chunk_size), Some(offset))
                    .await?;
                if data.rows.is_empty() {
                    break;
                }
                for row in &data.rows {
                    let vals = row
                        .iter()
                        .map(|v| match v {
                            serde_json::Value::Null => "NULL".into(),
                            serde_json::Value::String(s) => {
                                if s == "NULL" {
                                    "NULL".into()
                                } else {
                                    format!("'{}'", s.replace('\'', "''").replace('\\', "\\\\"))
                                }
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
                .get_table_data(session_id, database, table, Some(opts.chunk_size), Some(offset))
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
            let table_export = self.export_table(session_id, database, &tbl.name, opts).await?;
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
    pub async fn server_uptime(
        &mut self,
        session_id: &str,
    ) -> Result<u64, MysqlError> {
        let vars = self
            .show_variables(session_id, Some("Uptime"))
            .await?;
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
    fn find_available_port_works() {
        let port = MysqlService::find_available_port().unwrap();
        assert!(port > 0);
    }

    #[test]
    fn generate_id_unique() {
        let a = MysqlService::generate_id();
        let b = MysqlService::generate_id();
        assert_ne!(a, b);
    }
}
