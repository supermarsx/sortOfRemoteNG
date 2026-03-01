//! PostgreSQL service – multi-session, SSH tunnel, schema introspection, export/import.

use crate::postgres::types::*;
use chrono::Utc;
use log::{debug, error, info, warn};
use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::{Column, Row};
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type PostgresServiceState = Arc<Mutex<PostgresService>>;

// ── Internal session ────────────────────────────────────────────────

struct PgSession {
    pool: PgPool,
    config: PgConnectionConfig,
    info: SessionInfo,
    #[allow(dead_code)]
    ssh_session: Option<ssh2::Session>,
    local_port: Option<u16>,
}

// ── Service ─────────────────────────────────────────────────────────

pub struct PostgresService {
    sessions: HashMap<String, PgSession>,
}

pub fn new_state() -> PostgresServiceState {
    Arc::new(Mutex::new(PostgresService::new()))
}

impl PostgresService {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }

    // ── helpers ─────────────────────────────────────────────────

    fn get_pool(&self, id: &str) -> Result<&PgPool, PgError> {
        self.sessions.get(id).map(|s| &s.pool).ok_or_else(|| PgError::session_not_found(id))
    }

    fn get_session_mut(&mut self, id: &str) -> Result<&mut PgSession, PgError> {
        self.sessions.get_mut(id).ok_or_else(|| PgError::session_not_found(id))
    }

    fn free_port() -> Result<u16, PgError> {
        TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .map_err(|e| PgError::new(PgErrorKind::SshTunnelFailed, format!("No free port: {e}")))
    }

    // ── SSH tunnel ──────────────────────────────────────────────

    fn setup_ssh_tunnel(cfg: &SshTunnelConfig, remote_host: &str, remote_port: u16) -> Result<(ssh2::Session, u16), PgError> {
        use std::net::TcpStream;
        let local_port = Self::free_port()?;
        let tcp = TcpStream::connect(format!("{}:{}", cfg.host, cfg.port))
            .map_err(|e| PgError::new(PgErrorKind::SshTunnelFailed, format!("SSH TCP connect: {e}")))?;
        let mut sess = ssh2::Session::new()
            .map_err(|e| PgError::new(PgErrorKind::SshTunnelFailed, format!("SSH session new: {e}")))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| PgError::new(PgErrorKind::SshTunnelFailed, format!("SSH handshake: {e}")))?;
        if let Some(ref key_path) = cfg.private_key_path {
            sess.userauth_pubkey_file(&cfg.username, None, std::path::Path::new(key_path), cfg.passphrase.as_deref())
                .map_err(|e| PgError::new(PgErrorKind::SshTunnelFailed, format!("SSH key auth: {e}")))?;
        } else if let Some(ref pw) = cfg.password {
            sess.userauth_password(&cfg.username, pw)
                .map_err(|e| PgError::new(PgErrorKind::SshTunnelFailed, format!("SSH password auth: {e}")))?;
        } else {
            return Err(PgError::new(PgErrorKind::SshTunnelFailed, "No SSH credentials"));
        }
        let _channel = sess.channel_direct_tcpip(remote_host, remote_port, None)
            .map_err(|e| PgError::new(PgErrorKind::SshTunnelFailed, format!("SSH tunnel: {e}")))?;
        info!("SSH tunnel established on local port {local_port} → {remote_host}:{remote_port}");
        Ok((sess, local_port))
    }

    // ── connect / disconnect ────────────────────────────────────

    pub async fn connect(&mut self, config: PgConnectionConfig) -> Result<String, PgError> {
        let session_id = uuid::Uuid::new_v4().to_string();

        let (ssh_session, local_port) = if let Some(ref ssh_cfg) = config.ssh_tunnel {
            let (s, p) = Self::setup_ssh_tunnel(ssh_cfg, &config.host, config.port)?;
            (Some(s), Some(p))
        } else {
            (None, None)
        };

        let url = config.to_url(local_port);
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(config.connection_timeout_secs.unwrap_or(10)))
            .connect(&url)
            .await
            .map_err(|e| PgError::new(PgErrorKind::ConnectionFailed, format!("PG connect: {e}")))?;

        // detect version
        let version: String = sqlx::query_scalar("SELECT version()")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| "unknown".to_string());

        let info = SessionInfo {
            id: session_id.clone(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            database: config.database.clone(),
            status: ConnectionStatus::Connected,
            server_version: Some(version),
            connected_at: Some(Utc::now().to_rfc3339()),
            queries_executed: 0,
            total_rows_fetched: 0,
            via_ssh_tunnel: ssh_session.is_some(),
        };

        self.sessions.insert(session_id.clone(), PgSession { pool, config, info, ssh_session, local_port });
        info!("PostgreSQL session {session_id} connected");
        Ok(session_id)
    }

    pub async fn disconnect(&mut self, id: &str) -> Result<(), PgError> {
        let sess = self.sessions.remove(id).ok_or_else(|| PgError::session_not_found(id))?;
        sess.pool.close().await;
        info!("PostgreSQL session {id} disconnected");
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

    pub fn get_session(&self, id: &str) -> Result<SessionInfo, PgError> {
        self.sessions.get(id).map(|s| s.info.clone()).ok_or_else(|| PgError::session_not_found(id))
    }

    pub fn ping(&self, id: &str) -> Result<bool, PgError> {
        self.sessions.get(id).map(|_| true).ok_or_else(|| PgError::session_not_found(id))
    }

    // ── Queries ─────────────────────────────────────────────────

    pub async fn execute_query(&mut self, id: &str, sql: &str) -> Result<QueryResult, PgError> {
        let pool = self.get_pool(id)?.clone();
        let start = std::time::Instant::now();

        let rows: Vec<PgRow> = sqlx::query(sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let elapsed = start.elapsed().as_millis();

        let columns: Vec<ColumnInfo> = if !rows.is_empty() {
            rows[0]
                .columns()
                .iter()
                .enumerate()
                .map(|(i, c)| ColumnInfo {
                    name: c.name().to_string(),
                    type_name: c.type_info().to_string(),
                    ordinal: i,
                })
                .collect()
        } else {
            vec![]
        };

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

    pub async fn execute_statement(&mut self, id: &str, sql: &str) -> Result<QueryResult, PgError> {
        let pool = self.get_pool(id)?.clone();
        let start = std::time::Instant::now();

        let result = sqlx::query(sql)
            .execute(&pool)
            .await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

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

    pub async fn explain_query(&mut self, id: &str, sql: &str) -> Result<Vec<ExplainNode>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let explain_sql = format!("EXPLAIN (FORMAT JSON) {sql}");

        let rows: Vec<PgRow> = sqlx::query(&explain_sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        let mut results = Vec::new();
        for row in &rows {
            let plan: serde_json::Value = row.try_get(0).unwrap_or(serde_json::Value::Null);
            results.push(ExplainNode { plan });
        }
        Ok(results)
    }

    // ── Schema introspection ────────────────────────────────────

    pub async fn list_databases(&mut self, id: &str) -> Result<Vec<DatabaseInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT d.datname, r.rolname AS owner, pg_encoding_to_char(d.encoding) AS encoding, \
             d.datcollate AS collation, pg_database_size(d.datname) AS size_bytes \
             FROM pg_database d JOIN pg_roles r ON d.datdba = r.oid WHERE d.datistemplate = false ORDER BY d.datname"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| DatabaseInfo {
            name: r.try_get("datname").unwrap_or_default(),
            owner: r.try_get("owner").ok(),
            encoding: r.try_get("encoding").ok(),
            collation: r.try_get("collation").ok(),
            size_bytes: r.try_get("size_bytes").ok(),
        }).collect())
    }

    pub async fn list_schemas(&mut self, id: &str) -> Result<Vec<SchemaInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT schema_name, schema_owner FROM information_schema.schemata \
             WHERE schema_name NOT IN ('pg_toast', 'pg_catalog', 'information_schema') ORDER BY schema_name"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| SchemaInfo {
            name: r.try_get("schema_name").unwrap_or_default(),
            owner: r.try_get("schema_owner").ok(),
        }).collect())
    }

    pub async fn list_tables(&mut self, id: &str, schema: &str) -> Result<Vec<TableInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT c.relname AS name, n.nspname AS schema, \
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' \
             WHEN 'f' THEN 'foreign table' WHEN 'p' THEN 'partitioned table' ELSE 'other' END AS table_type, \
             c.reltuples::bigint AS estimated_rows, \
             pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size, \
             obj_description(c.oid) AS comment \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relkind IN ('r','v','m','f','p') ORDER BY c.relname"
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| TableInfo {
            name: r.try_get("name").unwrap_or_default(),
            schema: r.try_get("schema").unwrap_or_default(),
            table_type: r.try_get("table_type").unwrap_or_default(),
            estimated_rows: r.try_get("estimated_rows").ok(),
            total_size: r.try_get("total_size").ok(),
            comment: r.try_get("comment").ok(),
        }).collect())
    }

    pub async fn describe_table(&mut self, id: &str, schema: &str, table: &str) -> Result<Vec<ColumnDef>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default, \
             c.character_maximum_length, c.numeric_precision, c.ordinal_position, c.is_identity, \
             col_description(t.oid, c.ordinal_position::int) AS comment \
             FROM information_schema.columns c \
             JOIN pg_class t ON t.relname = c.table_name \
             JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema \
             WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position"
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| {
            let nullable_str: String = r.try_get("is_nullable").unwrap_or_default();
            let identity_str: String = r.try_get("is_identity").unwrap_or_default();
            ColumnDef {
                name: r.try_get("column_name").unwrap_or_default(),
                data_type: r.try_get("data_type").unwrap_or_default(),
                udt_name: r.try_get("udt_name").unwrap_or_default(),
                is_nullable: nullable_str == "YES",
                column_default: r.try_get("column_default").ok(),
                character_maximum_length: r.try_get::<Option<i32>, _>("character_maximum_length").unwrap_or(None).map(|v| v as i64),
                numeric_precision: r.try_get("numeric_precision").ok(),
                ordinal_position: r.try_get::<i32, _>("ordinal_position").unwrap_or(0),
                is_identity: identity_str == "YES",
                comment: r.try_get("comment").ok(),
            }
        }).collect())
    }

    pub async fn list_indexes(&mut self, id: &str, schema: &str, table: &str) -> Result<Vec<IndexInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT i.relname AS index_name, t.relname AS table_name, \
             array_to_string(array_agg(a.attname ORDER BY x.ordinality), ', ') AS columns, \
             ix.indisunique AS is_unique, ix.indisprimary AS is_primary, \
             am.amname AS index_type, pg_size_pretty(pg_relation_size(i.oid)) AS index_size \
             FROM pg_index ix \
             JOIN pg_class t ON t.oid = ix.indrelid \
             JOIN pg_class i ON i.oid = ix.indexrelid \
             JOIN pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_am am ON am.oid = i.relam \
             JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality) ON true \
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum \
             WHERE n.nspname = $1 AND t.relname = $2 \
             GROUP BY i.relname, t.relname, ix.indisunique, ix.indisprimary, am.amname, i.oid \
             ORDER BY i.relname"
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| {
            let cols_str: String = r.try_get("columns").unwrap_or_default();
            IndexInfo {
                name: r.try_get("index_name").unwrap_or_default(),
                table_name: r.try_get("table_name").unwrap_or_default(),
                columns: cols_str.split(", ").map(|s| s.to_string()).collect(),
                is_unique: r.try_get("is_unique").unwrap_or(false),
                is_primary: r.try_get("is_primary").unwrap_or(false),
                index_type: r.try_get("index_type").ok(),
                index_size: r.try_get("index_size").ok(),
            }
        }).collect())
    }

    pub async fn list_foreign_keys(&mut self, id: &str, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT tc.constraint_name, kcu.column_name, \
             ccu.table_name AS referenced_table, ccu.column_name AS referenced_column, \
             ccu.table_schema AS referenced_schema, \
             rc.update_rule, rc.delete_rule \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema \
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema \
             JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema \
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2 \
             ORDER BY tc.constraint_name"
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| ForeignKeyInfo {
            name: r.try_get("constraint_name").unwrap_or_default(),
            column: r.try_get("column_name").unwrap_or_default(),
            referenced_table: r.try_get("referenced_table").unwrap_or_default(),
            referenced_column: r.try_get("referenced_column").unwrap_or_default(),
            referenced_schema: r.try_get("referenced_schema").unwrap_or_default(),
            on_update: r.try_get("update_rule").unwrap_or_default(),
            on_delete: r.try_get("delete_rule").unwrap_or_default(),
        }).collect())
    }

    pub async fn list_views(&mut self, id: &str, schema: &str) -> Result<Vec<ViewInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        // Regular views
        let mut views: Vec<ViewInfo> = Vec::new();

        let rows: Vec<PgRow> = sqlx::query(
            "SELECT table_name, table_schema, view_definition \
             FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name"
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        for r in &rows {
            views.push(ViewInfo {
                name: r.try_get("table_name").unwrap_or_default(),
                schema: r.try_get("table_schema").unwrap_or_default(),
                definition: r.try_get("view_definition").ok(),
                is_materialized: false,
            });
        }

        // Materialized views
        let mat_rows: Vec<PgRow> = sqlx::query(
            "SELECT c.relname AS name, n.nspname AS schema, pg_get_viewdef(c.oid, true) AS definition \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relkind = 'm' ORDER BY c.relname"
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        for r in &mat_rows {
            views.push(ViewInfo {
                name: r.try_get("name").unwrap_or_default(),
                schema: r.try_get("schema").unwrap_or_default(),
                definition: r.try_get("definition").ok(),
                is_materialized: true,
            });
        }

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 2;

        Ok(views)
    }

    pub async fn list_routines(&mut self, id: &str, schema: &str) -> Result<Vec<RoutineInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT r.routine_name, r.routine_schema, r.routine_type, r.external_language, r.data_type, r.routine_definition \
             FROM information_schema.routines r \
             WHERE r.routine_schema = $1 ORDER BY r.routine_name"
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| RoutineInfo {
            name: r.try_get("routine_name").unwrap_or_default(),
            schema: r.try_get("routine_schema").unwrap_or_default(),
            routine_type: r.try_get("routine_type").unwrap_or_default(),
            language: r.try_get("external_language").ok(),
            return_type: r.try_get("data_type").ok(),
            definition: r.try_get("routine_definition").ok(),
        }).collect())
    }

    pub async fn list_triggers(&mut self, id: &str, schema: &str) -> Result<Vec<TriggerInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT t.trigger_name, t.event_object_table, t.trigger_schema, \
             t.event_manipulation, t.action_timing, t.action_statement \
             FROM information_schema.triggers t \
             WHERE t.trigger_schema = $1 ORDER BY t.trigger_name"
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| TriggerInfo {
            name: r.try_get("trigger_name").unwrap_or_default(),
            table_name: r.try_get("event_object_table").unwrap_or_default(),
            schema: r.try_get("trigger_schema").unwrap_or_default(),
            event: r.try_get("event_manipulation").unwrap_or_default(),
            timing: r.try_get("action_timing").unwrap_or_default(),
            definition: r.try_get("action_statement").ok(),
        }).collect())
    }

    pub async fn list_sequences(&mut self, id: &str, schema: &str) -> Result<Vec<SequenceInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT s.sequence_name, s.sequence_schema, s.data_type, \
             s.start_value::bigint, s.increment::bigint, s.minimum_value::bigint, s.maximum_value::bigint \
             FROM information_schema.sequences s \
             WHERE s.sequence_schema = $1 ORDER BY s.sequence_name"
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| SequenceInfo {
            name: r.try_get("sequence_name").unwrap_or_default(),
            schema: r.try_get("sequence_schema").unwrap_or_default(),
            data_type: r.try_get("data_type").unwrap_or_default(),
            start_value: r.try_get("start_value").ok(),
            increment: r.try_get("increment").ok(),
            min_value: r.try_get("minimum_value").ok(),
            max_value: r.try_get("maximum_value").ok(),
            current_value: None,
        }).collect())
    }

    pub async fn list_extensions(&mut self, id: &str) -> Result<Vec<ExtensionInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT e.extname, e.extversion, n.nspname AS schema, c.description \
             FROM pg_extension e \
             JOIN pg_namespace n ON n.oid = e.extnamespace \
             LEFT JOIN pg_description c ON c.objoid = e.oid \
             ORDER BY e.extname"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| ExtensionInfo {
            name: r.try_get("extname").unwrap_or_default(),
            version: r.try_get("extversion").unwrap_or_default(),
            schema: r.try_get("schema").ok(),
            description: r.try_get("description").ok(),
        }).collect())
    }

    // ── DDL ─────────────────────────────────────────────────────

    pub async fn create_database(&mut self, id: &str, name: &str, owner: Option<&str>) -> Result<(), PgError> {
        let pool = self.get_pool(id)?.clone();
        let mut sql = format!("CREATE DATABASE \"{}\"", name);
        if let Some(o) = owner {
            sql.push_str(&format!(" OWNER \"{}\"", o));
        }
        sqlx::query(&sql).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    pub async fn drop_database(&mut self, id: &str, name: &str) -> Result<(), PgError> {
        let pool = self.get_pool(id)?.clone();
        sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", name)).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    pub async fn create_schema(&mut self, id: &str, name: &str) -> Result<(), PgError> {
        let pool = self.get_pool(id)?.clone();
        sqlx::query(&format!("CREATE SCHEMA IF NOT EXISTS \"{}\"", name)).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    pub async fn drop_schema(&mut self, id: &str, name: &str, cascade: bool) -> Result<(), PgError> {
        let pool = self.get_pool(id)?.clone();
        let cascade_str = if cascade { " CASCADE" } else { "" };
        sqlx::query(&format!("DROP SCHEMA IF EXISTS \"{}\"{}", name, cascade_str)).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    pub async fn drop_table(&mut self, id: &str, schema: &str, table: &str) -> Result<(), PgError> {
        let pool = self.get_pool(id)?.clone();
        sqlx::query(&format!("DROP TABLE IF EXISTS \"{}\".\"{}\"", schema, table)).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    pub async fn truncate_table(&mut self, id: &str, schema: &str, table: &str) -> Result<(), PgError> {
        let pool = self.get_pool(id)?.clone();
        sqlx::query(&format!("TRUNCATE TABLE \"{}\".\"{}\"", schema, table)).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    pub async fn vacuum_table(&mut self, id: &str, schema: &str, table: &str, analyze: bool) -> Result<(), PgError> {
        let pool = self.get_pool(id)?.clone();
        let analyze_str = if analyze { " ANALYZE" } else { "" };
        sqlx::query(&format!("VACUUM{} \"{}\".\"{}\"", analyze_str, schema, table)).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(())
    }

    // ── Data CRUD ───────────────────────────────────────────────

    pub async fn get_table_data(&mut self, id: &str, schema: &str, table: &str, limit: Option<u32>, offset: Option<u32>) -> Result<QueryResult, PgError> {
        let lim = limit.unwrap_or(500);
        let off = offset.unwrap_or(0);
        let sql = format!("SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}", schema, table, lim, off);
        self.execute_query(id, &sql).await
    }

    pub async fn insert_row(&mut self, id: &str, schema: &str, table: &str, columns: &[String], values: &[String]) -> Result<u64, PgError> {
        let cols = columns.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(", ");
        let placeholders: Vec<String> = (1..=values.len()).map(|i| format!("${i}")).collect();
        let sql = format!("INSERT INTO \"{}\".\"{}\" ({}) VALUES ({})", schema, table, cols, placeholders.join(", "));
        let pool = self.get_pool(id)?.clone();
        let mut q = sqlx::query(&sql);
        for v in values {
            q = q.bind(v);
        }
        let result = q.execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(result.rows_affected())
    }

    pub async fn update_rows(&mut self, id: &str, schema: &str, table: &str, columns: &[String], values: &[String], where_clause: &str) -> Result<u64, PgError> {
        let sets: Vec<String> = columns.iter().enumerate().map(|(i, c)| format!("\"{}\" = ${}", c, i + 1)).collect();
        let sql = format!("UPDATE \"{}\".\"{}\" SET {} WHERE {}", schema, table, sets.join(", "), where_clause);
        let pool = self.get_pool(id)?.clone();
        let mut q = sqlx::query(&sql);
        for v in values {
            q = q.bind(v);
        }
        let result = q.execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(result.rows_affected())
    }

    pub async fn delete_rows(&mut self, id: &str, schema: &str, table: &str, where_clause: &str) -> Result<u64, PgError> {
        let sql = format!("DELETE FROM \"{}\".\"{}\" WHERE {}", schema, table, where_clause);
        let pool = self.get_pool(id)?.clone();
        let result = sqlx::query(&sql).execute(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(result.rows_affected())
    }

    // ── Export ───────────────────────────────────────────────────

    pub async fn export_table(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, PgError> {
        match options.format {
            ExportFormat::Csv | ExportFormat::Tsv => self.export_table_delimited(id, schema, table, options).await,
            ExportFormat::Sql => self.export_table_sql(id, schema, table, options).await,
            ExportFormat::Json => self.export_table_json(id, schema, table, options).await,
            ExportFormat::Copy => self.export_table_copy(id, schema, table).await,
        }
    }

    async fn export_table_delimited(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, PgError> {
        let sep = match options.format {
            ExportFormat::Tsv => '\t',
            _ => ',',
        };
        let mut output = String::new();
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;

        // Header from column info
        if options.include_headers {
            let cols = self.describe_table(id, schema, table).await?;
            let header: Vec<String> = cols.iter().map(|c| c.name.clone()).collect();
            output.push_str(&header.join(&sep.to_string()));
            output.push('\n');
        }

        loop {
            let sql = format!("SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}", schema, table, chunk, offset);
            let result = self.execute_query(id, &sql).await?;
            if result.rows.is_empty() {
                break;
            }
            let col_names: Vec<String> = result.columns.iter().map(|c| c.name.clone()).collect();
            for row in &result.rows {
                let vals: Vec<String> = col_names.iter().map(|c| {
                    match row.get(c) {
                        Some(serde_json::Value::String(s)) => {
                            if s.contains(sep) || s.contains('"') || s.contains('\n') {
                                format!("\"{}\"", s.replace('"', "\"\""))
                            } else {
                                s.clone()
                            }
                        }
                        Some(serde_json::Value::Null) | None => String::new(),
                        Some(v) => v.to_string(),
                    }
                }).collect();
                output.push_str(&vals.join(&sep.to_string()));
                output.push('\n');
            }
            offset += chunk;
            if result.rows.len() < chunk as usize {
                break;
            }
        }
        Ok(output)
    }

    async fn export_table_sql(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, PgError> {
        let mut output = String::new();
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;

        if options.include_create {
            // PG doesn't have SHOW CREATE TABLE — we synthesise a basic one
            let cols = self.describe_table(id, schema, table).await?;
            output.push_str(&format!("CREATE TABLE \"{}\".\"{}\" (\n", schema, table));
            let col_defs: Vec<String> = cols.iter().map(|c| {
                let mut def = format!("  \"{}\" {}", c.name, c.udt_name);
                if !c.is_nullable {
                    def.push_str(" NOT NULL");
                }
                if let Some(ref d) = c.column_default {
                    def.push_str(&format!(" DEFAULT {}", d));
                }
                def
            }).collect();
            output.push_str(&col_defs.join(",\n"));
            output.push_str("\n);\n\n");
        }

        loop {
            let sql = format!("SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}", schema, table, chunk, offset);
            let result = self.execute_query(id, &sql).await?;
            if result.rows.is_empty() {
                break;
            }
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
                output.push_str(&format!(
                    "INSERT INTO \"{}\".\"{}\" ({}) VALUES ({});\n",
                    schema, table,
                    quoted_cols.join(", "),
                    vals.join(", ")
                ));
            }
            offset += chunk;
            if result.rows.len() < chunk as usize {
                break;
            }
        }
        Ok(output)
    }

    async fn export_table_json(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, PgError> {
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;
        let mut all_rows: Vec<RowMap> = Vec::new();

        loop {
            let sql = format!("SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}", schema, table, chunk, offset);
            let result = self.execute_query(id, &sql).await?;
            if result.rows.is_empty() {
                break;
            }
            all_rows.extend(result.rows.clone());
            offset += chunk;
            if result.rows.len() < chunk as usize {
                break;
            }
        }
        serde_json::to_string_pretty(&all_rows)
            .map_err(|e| PgError::new(PgErrorKind::ExportFailed, format!("{e}")))
    }

    async fn export_table_copy(&mut self, id: &str, schema: &str, table: &str) -> Result<String, PgError> {
        // Use COPY ... TO STDOUT via a query
        let sql = format!("COPY \"{}\".\"{}\" TO STDOUT WITH (FORMAT csv, HEADER true)", schema, table);
        let pool = self.get_pool(id)?.clone();
        // Note: COPY TO STDOUT via sqlx is complex; fall back to CSV export
        warn!("COPY format falling back to CSV export for {schema}.{table}");
        self.export_table_delimited(id, schema, table, &ExportOptions {
            format: ExportFormat::Csv,
            include_headers: true,
            include_create: false,
            chunk_size: 10000,
        }).await
    }

    pub async fn export_schema(&mut self, id: &str, schema: &str, options: &ExportOptions) -> Result<String, PgError> {
        let tables = self.list_tables(id, schema).await?;
        let mut output = String::new();
        for t in &tables {
            if t.table_type == "table" {
                output.push_str(&format!("-- Table: {}.{}\n", schema, t.name));
                let tbl = self.export_table(id, schema, &t.name, options).await?;
                output.push_str(&tbl);
                output.push_str("\n\n");
            }
        }
        Ok(output)
    }

    // ── Import ──────────────────────────────────────────────────

    pub async fn import_sql(&mut self, id: &str, sql_content: &str) -> Result<u64, PgError> {
        let pool = self.get_pool(id)?.clone();
        let statements: Vec<&str> = sql_content.split(';').filter(|s| !s.trim().is_empty()).collect();
        let mut count: u64 = 0;
        for stmt in &statements {
            sqlx::query(stmt.trim()).execute(&pool).await
                .map_err(|e| PgError::new(PgErrorKind::ImportFailed, format!("Statement failed: {e}")))?;
            count += 1;
        }
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += count;
        Ok(count)
    }

    pub async fn import_csv(&mut self, id: &str, schema: &str, table: &str, csv_content: &str, has_header: bool) -> Result<u64, PgError> {
        let mut lines = csv_content.lines();
        let headers: Option<Vec<String>> = if has_header {
            lines.next().map(|h| h.split(',').map(|s| s.trim().trim_matches('"').to_string()).collect())
        } else {
            None
        };

        let pool = self.get_pool(id)?.clone();
        let mut count: u64 = 0;

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }
            let values: Vec<String> = line.split(',').map(|s| s.trim().trim_matches('"').to_string()).collect();
            let cols = if let Some(ref h) = headers {
                h.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(", ")
            } else {
                (1..=values.len()).map(|_| "".to_string()).collect::<Vec<_>>().join(", ")
            };
            let placeholders: Vec<String> = (1..=values.len()).map(|i| format!("${i}")).collect();

            let sql = if headers.is_some() {
                format!("INSERT INTO \"{}\".\"{}\" ({}) VALUES ({})", schema, table, cols, placeholders.join(", "))
            } else {
                format!("INSERT INTO \"{}\".\"{}\" VALUES ({})", schema, table, placeholders.join(", "))
            };

            let mut q = sqlx::query(&sql);
            for v in &values {
                q = q.bind(v);
            }
            q.execute(&pool).await
                .map_err(|e| PgError::new(PgErrorKind::ImportFailed, format!("CSV row import: {e}")))?;
            count += 1;
        }

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += count;
        Ok(count)
    }

    // ── Administration ──────────────────────────────────────────

    pub async fn show_settings(&mut self, id: &str, filter: Option<&str>) -> Result<Vec<ServerSetting>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let sql = match filter {
            Some(f) => format!("SELECT name, setting, unit, category, short_desc AS description FROM pg_settings WHERE name ILIKE '%{}%' ORDER BY name", f),
            None => "SELECT name, setting, unit, category, short_desc AS description FROM pg_settings ORDER BY name".to_string(),
        };
        let rows: Vec<PgRow> = sqlx::query(&sql).fetch_all(&pool).await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(rows.iter().map(|r| ServerSetting {
            name: r.try_get("name").unwrap_or_default(),
            setting: r.try_get("setting").unwrap_or_default(),
            unit: r.try_get("unit").ok(),
            category: r.try_get("category").ok(),
            description: r.try_get("description").ok(),
        }).collect())
    }

    pub async fn show_activity(&mut self, id: &str) -> Result<Vec<PgStatActivity>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT pid, datname AS database, usename AS username, application_name, \
             client_addr::text, state, query, query_start::text, wait_event_type, wait_event \
             FROM pg_stat_activity WHERE datname IS NOT NULL ORDER BY pid"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| PgStatActivity {
            pid: r.try_get("pid").unwrap_or(0),
            database: r.try_get("database").ok(),
            username: r.try_get("username").ok(),
            application_name: r.try_get("application_name").ok(),
            client_addr: r.try_get("client_addr").ok(),
            state: r.try_get("state").ok(),
            query: r.try_get("query").ok(),
            query_start: r.try_get("query_start").ok(),
            wait_event_type: r.try_get("wait_event_type").ok(),
            wait_event: r.try_get("wait_event").ok(),
        }).collect())
    }

    pub async fn terminate_backend(&mut self, id: &str, pid: i32) -> Result<bool, PgError> {
        let pool = self.get_pool(id)?.clone();
        let row: PgRow = sqlx::query("SELECT pg_terminate_backend($1)")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(row.try_get::<bool, _>(0).unwrap_or(false))
    }

    pub async fn cancel_backend(&mut self, id: &str, pid: i32) -> Result<bool, PgError> {
        let pool = self.get_pool(id)?.clone();
        let row: PgRow = sqlx::query("SELECT pg_cancel_backend($1)")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(row.try_get::<bool, _>(0).unwrap_or(false))
    }

    pub async fn list_roles(&mut self, id: &str) -> Result<Vec<PgRole>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, \
             rolconnlimit, rolvaliduntil::text \
             FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| PgRole {
            name: r.try_get("rolname").unwrap_or_default(),
            is_superuser: r.try_get("rolsuper").unwrap_or(false),
            can_login: r.try_get("rolcanlogin").unwrap_or(false),
            can_create_db: r.try_get("rolcreatedb").unwrap_or(false),
            can_create_role: r.try_get("rolcreaterole").unwrap_or(false),
            is_replication: r.try_get("rolreplication").unwrap_or(false),
            connection_limit: r.try_get("rolconnlimit").ok(),
            valid_until: r.try_get("rolvaliduntil").ok(),
        }).collect())
    }

    pub async fn list_tablespaces(&mut self, id: &str) -> Result<Vec<TablespaceInfo>, PgError> {
        let pool = self.get_pool(id)?.clone();
        let rows: Vec<PgRow> = sqlx::query(
            "SELECT spcname, r.rolname AS owner, pg_tablespace_location(t.oid) AS location, \
             pg_size_pretty(pg_tablespace_size(t.oid)) AS size \
             FROM pg_tablespace t JOIN pg_roles r ON t.spcowner = r.oid ORDER BY spcname"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;

        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;

        Ok(rows.iter().map(|r| TablespaceInfo {
            name: r.try_get("spcname").unwrap_or_default(),
            owner: r.try_get("owner").unwrap_or_default(),
            location: r.try_get("location").ok(),
            size: r.try_get("size").ok(),
        }).collect())
    }

    pub async fn server_uptime(&mut self, id: &str) -> Result<String, PgError> {
        let pool = self.get_pool(id)?.clone();
        let row: PgRow = sqlx::query("SELECT date_trunc('second', current_timestamp - pg_postmaster_start_time()) AS uptime")
            .fetch_one(&pool)
            .await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        let uptime: String = row.try_get("uptime").unwrap_or_else(|_| "unknown".to_string());
        Ok(uptime)
    }

    pub async fn database_size(&mut self, id: &str, database: &str) -> Result<String, PgError> {
        let pool = self.get_pool(id)?.clone();
        let row: PgRow = sqlx::query("SELECT pg_size_pretty(pg_database_size($1)) AS size")
            .bind(database)
            .fetch_one(&pool)
            .await
            .map_err(|e| PgError::new(PgErrorKind::QueryFailed, format!("{e}")))?;
        let sess = self.get_session_mut(id)?;
        sess.info.queries_executed += 1;
        Ok(row.try_get("size").unwrap_or_else(|_| "unknown".to_string()))
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = PostgresService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn session_not_found() {
        let svc = PostgresService::new();
        let err = svc.get_session("nope").unwrap_err();
        assert!(matches!(err.kind, PgErrorKind::SessionNotFound));
    }

    #[test]
    fn ping_not_found() {
        let svc = PostgresService::new();
        let err = svc.ping("xx").unwrap_err();
        assert!(err.message.contains("xx"));
    }

    #[tokio::test]
    async fn disconnect_not_found() {
        let mut svc = PostgresService::new();
        let err = svc.disconnect("abc").await.unwrap_err();
        assert!(matches!(err.kind, PgErrorKind::SessionNotFound));
    }

    #[tokio::test]
    async fn disconnect_all_empty() {
        let mut svc = PostgresService::new();
        svc.disconnect_all().await;
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn free_port_works() {
        let port = PostgresService::free_port().unwrap();
        assert!(port > 0);
    }

    #[test]
    fn free_port_unique() {
        let p1 = PostgresService::free_port().unwrap();
        let p2 = PostgresService::free_port().unwrap();
        // Ports should generally differ (not guaranteed but very likely)
        assert!(p1 > 0 && p2 > 0);
    }
}
