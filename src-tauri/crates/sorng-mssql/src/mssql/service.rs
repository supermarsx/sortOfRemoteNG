//! SQL Server service – multi-session via tiberius, SSH tunnel, schema introspection, export/import.

use crate::mssql::types::*;
use chrono::Utc;
use log::info;
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Arc;
use tiberius::{AuthMethod, Client, Config, ColumnData};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

pub type MssqlServiceState = Arc<Mutex<MssqlService>>;

// ── Internal session ────────────────────────────────────────────────

struct MssqlSession {
    client: Client<Compat<TcpStream>>,
    config: MssqlConnectionConfig,
    info: SessionInfo,
    #[allow(dead_code)]
    ssh_session: Option<ssh2::Session>,
    local_port: Option<u16>,
}

// ── Service ─────────────────────────────────────────────────────────

pub struct MssqlService {
    sessions: HashMap<String, MssqlSession>,
}

pub fn new_state() -> MssqlServiceState {
    Arc::new(Mutex::new(MssqlService::new()))
}

impl MssqlService {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }

    // helpers
    fn get_session_mut(&mut self, id: &str) -> Result<&mut MssqlSession, MssqlError> {
        self.sessions.get_mut(id).ok_or_else(|| MssqlError::session_not_found(id))
    }

    fn free_port() -> Result<u16, MssqlError> {
        TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .map_err(|e| MssqlError::new(MssqlErrorKind::SshTunnelFailed, format!("No free port: {e}")))
    }

    fn setup_ssh_tunnel(cfg: &SshTunnelConfig, remote_host: &str, remote_port: u16) -> Result<(ssh2::Session, u16), MssqlError> {
        use std::net::TcpStream as StdTcp;
        let local_port = Self::free_port()?;
        let tcp = StdTcp::connect(format!("{}:{}", cfg.host, cfg.port))
            .map_err(|e| MssqlError::new(MssqlErrorKind::SshTunnelFailed, format!("SSH TCP: {e}")))?;
        let mut sess = ssh2::Session::new()
            .map_err(|e| MssqlError::new(MssqlErrorKind::SshTunnelFailed, format!("SSH session: {e}")))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| MssqlError::new(MssqlErrorKind::SshTunnelFailed, format!("SSH handshake: {e}")))?;
        if let Some(ref key_path) = cfg.private_key_path {
            sess.userauth_pubkey_file(&cfg.username, None, std::path::Path::new(key_path), cfg.passphrase.as_deref())
                .map_err(|e| MssqlError::new(MssqlErrorKind::SshTunnelFailed, format!("SSH key auth: {e}")))?;
        } else if let Some(ref pw) = cfg.password {
            sess.userauth_password(&cfg.username, pw)
                .map_err(|e| MssqlError::new(MssqlErrorKind::SshTunnelFailed, format!("SSH pw auth: {e}")))?;
        } else {
            return Err(MssqlError::new(MssqlErrorKind::SshTunnelFailed, "No SSH credentials"));
        }
        let _channel = sess.channel_direct_tcpip(remote_host, remote_port, None)
            .map_err(|e| MssqlError::new(MssqlErrorKind::SshTunnelFailed, format!("SSH tunnel: {e}")))?;
        info!("SSH tunnel on local :{local_port} → {remote_host}:{remote_port}");
        Ok((sess, local_port))
    }

    fn column_data_to_json(col: &ColumnData<'_>) -> serde_json::Value {
        match col {
            ColumnData::Bit(Some(v)) => serde_json::Value::Bool(*v),
            ColumnData::I16(Some(v)) => serde_json::json!(*v),
            ColumnData::I32(Some(v)) => serde_json::json!(*v),
            ColumnData::I64(Some(v)) => serde_json::json!(*v),
            ColumnData::F32(Some(v)) => serde_json::json!(*v),
            ColumnData::F64(Some(v)) => serde_json::json!(*v),
            ColumnData::U8(Some(v)) => serde_json::json!(*v),
            ColumnData::String(Some(v)) => serde_json::Value::String(v.to_string()),
            _ => serde_json::Value::Null,
        }
    }

    // ── connect / disconnect ────────────────────────────────────

    pub async fn connect(&mut self, conn_cfg: MssqlConnectionConfig) -> Result<String, MssqlError> {
        let session_id = uuid::Uuid::new_v4().to_string();

        let (ssh_session, local_port) = if let Some(ref ssh_cfg) = conn_cfg.ssh_tunnel {
            let (s, p) = Self::setup_ssh_tunnel(ssh_cfg, &conn_cfg.host, conn_cfg.port)?;
            (Some(s), Some(p))
        } else {
            (None, None)
        };

        let mut config = Config::new();
        let connect_host = if local_port.is_some() { "127.0.0.1" } else { &conn_cfg.host };
        let connect_port = local_port.unwrap_or(conn_cfg.port);
        config.host(connect_host);
        config.port(connect_port);

        match &conn_cfg.auth {
            MssqlAuthMethod::SqlAuth { username, password } => {
                config.authentication(AuthMethod::sql_server(username, password));
            }
            MssqlAuthMethod::WindowsAuth => {
                config.authentication(AuthMethod::sql_server("", ""));
            }
            MssqlAuthMethod::AzureAd { username, password } => {
                config.authentication(AuthMethod::sql_server(username, password));
            }
        }
        if let Some(ref db) = conn_cfg.database {
            config.database(db);
        }
        if let Some(ref tls) = conn_cfg.tls {
            if tls.trust_server_certificate {
                config.trust_cert();
            }
        }

        let tcp = TcpStream::connect(config.get_addr())
            .await
            .map_err(|e| MssqlError::new(MssqlErrorKind::ConnectionFailed, format!("TCP connect: {e}")))?;
        tcp.set_nodelay(true).ok();

        let mut client = Client::connect(config, tcp.compat_write())
            .await
            .map_err(|e| MssqlError::new(MssqlErrorKind::ConnectionFailed, format!("TDS connect: {e}")))?;

        // Detect version
        let version = match client.simple_query("SELECT @@VERSION AS ver").await {
            Ok(stream) => {
                let row = stream.into_first_result().await.ok().and_then(|rows| rows.into_iter().next());
                row.and_then(|r| r.try_get::<&str, _>(0).ok().flatten().map(|s| s.to_string()))
                    .unwrap_or_else(|| "unknown".to_string())
            }
            Err(_) => "unknown".to_string(),
        };

        let info = SessionInfo {
            id: session_id.clone(),
            host: conn_cfg.host.clone(),
            port: conn_cfg.port,
            database: conn_cfg.database.clone(),
            instance_name: conn_cfg.instance_name.clone(),
            status: ConnectionStatus::Connected,
            server_version: Some(version),
            connected_at: Some(Utc::now().to_rfc3339()),
            queries_executed: 0,
            total_rows_fetched: 0,
            via_ssh_tunnel: ssh_session.is_some(),
        };

        self.sessions.insert(session_id.clone(), MssqlSession {
            client, config: conn_cfg, info, ssh_session, local_port,
        });
        info!("SQL Server session {session_id} connected");
        Ok(session_id)
    }

    pub async fn disconnect(&mut self, id: &str) -> Result<(), MssqlError> {
        let _sess = self.sessions.remove(id).ok_or_else(|| MssqlError::session_not_found(id))?;
        info!("SQL Server session {id} disconnected");
        Ok(())
    }

    pub async fn disconnect_all(&mut self) {
        self.sessions.clear();
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    pub fn get_session(&self, id: &str) -> Result<SessionInfo, MssqlError> {
        self.sessions.get(id).map(|s| s.info.clone()).ok_or_else(|| MssqlError::session_not_found(id))
    }

    // ── Queries ─────────────────────────────────────────────────

    pub async fn execute_query(&mut self, id: &str, sql: &str) -> Result<QueryResult, MssqlError> {
        let sess = self.get_session_mut(id)?;
        let start = std::time::Instant::now();

        let stream = sess.client.simple_query(sql).await
            .map_err(|e| MssqlError::new(MssqlErrorKind::QueryFailed, format!("{e}")))?;
        let tib_rows = stream.into_first_result().await
            .map_err(|e| MssqlError::new(MssqlErrorKind::QueryFailed, format!("{e}")))?;

        let elapsed = start.elapsed().as_millis();

        let columns: Vec<ColumnInfo> = if let Some(first) = tib_rows.first() {
            first.columns().iter().enumerate().map(|(i, c)| ColumnInfo {
                name: c.name().to_string(),
                type_name: format!("{:?}", c.column_type()),
                ordinal: i,
            }).collect()
        } else {
            vec![]
        };

        let mut rows: Vec<RowMap> = Vec::with_capacity(tib_rows.len());
        for trow in tib_rows {
            let mut map = RowMap::new();
            let col_names: Vec<String> = trow.columns().iter().map(|c| c.name().to_string()).collect();
            for (col_data, name) in trow.into_iter().zip(col_names.into_iter()) {
                let val = Self::column_data_to_json(&col_data);
                map.insert(name, val);
            }
            rows.push(map);
        }

        sess.info.queries_executed += 1;
        sess.info.total_rows_fetched += rows.len() as u64;

        Ok(QueryResult { columns, rows, affected_rows: 0, execution_time_ms: elapsed })
    }

    pub async fn execute_statement(&mut self, id: &str, sql: &str) -> Result<QueryResult, MssqlError> {
        let sess = self.get_session_mut(id)?;
        let start = std::time::Instant::now();

        let result = sess.client.execute(sql, &[]).await
            .map_err(|e| MssqlError::new(MssqlErrorKind::QueryFailed, format!("{e}")))?;

        let elapsed = start.elapsed().as_millis();
        sess.info.queries_executed += 1;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: result.rows_affected().iter().sum::<u64>(),
            execution_time_ms: elapsed,
        })
    }

    // ── Schema introspection ────────────────────────────────────

    pub async fn list_databases(&mut self, id: &str) -> Result<Vec<DatabaseInfo>, MssqlError> {
        let qr = self.execute_query(id,
            "SELECT d.name, d.state_desc, d.recovery_model_desc, d.compatibility_level, d.collation_name, \
             CAST(SUM(mf.size) * 8.0 / 1024 AS DECIMAL(18,2)) AS size_mb \
             FROM sys.databases d LEFT JOIN sys.master_files mf ON d.database_id = mf.database_id \
             GROUP BY d.name, d.state_desc, d.recovery_model_desc, d.compatibility_level, d.collation_name ORDER BY d.name"
        ).await?;

        Ok(qr.rows.iter().map(|r| DatabaseInfo {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            state: r.get("state_desc").and_then(|v| v.as_str()).map(|s| s.to_string()),
            recovery_model: r.get("recovery_model_desc").and_then(|v| v.as_str()).map(|s| s.to_string()),
            compatibility_level: r.get("compatibility_level").and_then(|v| v.as_i64()).map(|v| v as i32),
            collation: r.get("collation_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
            size_mb: r.get("size_mb").and_then(|v| v.as_f64()),
        }).collect())
    }

    pub async fn list_schemas(&mut self, id: &str) -> Result<Vec<SchemaInfo>, MssqlError> {
        let qr = self.execute_query(id,
            "SELECT s.name, p.name AS owner FROM sys.schemas s \
             JOIN sys.database_principals p ON s.principal_id = p.principal_id \
             WHERE s.name NOT IN ('guest','INFORMATION_SCHEMA','sys') ORDER BY s.name"
        ).await?;

        Ok(qr.rows.iter().map(|r| SchemaInfo {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            owner: r.get("owner").and_then(|v| v.as_str()).map(|s| s.to_string()),
        }).collect())
    }

    pub async fn list_tables(&mut self, id: &str, schema: &str) -> Result<Vec<TableInfo>, MssqlError> {
        let sql = format!(
            "SELECT t.name, s.name AS [schema], t.type_desc AS table_type, \
             p.rows AS row_count, \
             SUM(a.total_pages) * 8 AS total_size_kb \
             FROM sys.tables t \
             JOIN sys.schemas s ON t.schema_id = s.schema_id \
             JOIN sys.indexes i ON t.object_id = i.object_id \
             JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id \
             JOIN sys.allocation_units a ON p.partition_id = a.container_id \
             WHERE s.name = '{}' AND i.index_id <= 1 \
             GROUP BY t.name, s.name, t.type_desc, p.rows ORDER BY t.name", schema
        );
        let qr = self.execute_query(id, &sql).await?;

        Ok(qr.rows.iter().map(|r| TableInfo {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            schema: r.get("schema").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            table_type: r.get("table_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            row_count: r.get("row_count").and_then(|v| v.as_i64()),
            total_size_kb: r.get("total_size_kb").and_then(|v| v.as_i64()),
        }).collect())
    }

    pub async fn describe_table(&mut self, id: &str, schema: &str, table: &str) -> Result<Vec<ColumnDef>, MssqlError> {
        let sql = format!(
            "SELECT c.name, t.name AS data_type, c.max_length, c.precision, c.scale, \
             c.is_nullable, c.is_identity, c.is_computed, \
             dc.definition AS default_value, c.column_id AS ordinal_position, c.collation_name \
             FROM sys.columns c \
             JOIN sys.types t ON c.user_type_id = t.user_type_id \
             JOIN sys.objects o ON c.object_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id \
             WHERE s.name = '{}' AND o.name = '{}' ORDER BY c.column_id",
            schema, table
        );
        let qr = self.execute_query(id, &sql).await?;

        Ok(qr.rows.iter().map(|r| ColumnDef {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            data_type: r.get("data_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            max_length: r.get("max_length").and_then(|v| v.as_i64()).map(|v| v as i16),
            precision: r.get("precision").and_then(|v| v.as_u64()).map(|v| v as u8),
            scale: r.get("scale").and_then(|v| v.as_u64()).map(|v| v as u8),
            is_nullable: r.get("is_nullable").and_then(|v| v.as_bool()).unwrap_or(false),
            is_identity: r.get("is_identity").and_then(|v| v.as_bool()).unwrap_or(false),
            is_computed: r.get("is_computed").and_then(|v| v.as_bool()).unwrap_or(false),
            default_value: r.get("default_value").and_then(|v| v.as_str()).map(|s| s.to_string()),
            ordinal_position: r.get("ordinal_position").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            collation: r.get("collation_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        }).collect())
    }

    pub async fn list_indexes(&mut self, id: &str, schema: &str, table: &str) -> Result<Vec<IndexInfo>, MssqlError> {
        let sql = format!(
            "SELECT i.name, t.name AS table_name, i.type_desc AS index_type, \
             i.is_unique, i.is_primary_key, \
             CASE WHEN i.type IN (1) THEN 1 ELSE 0 END AS is_clustered, \
             i.fill_factor, \
             STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns \
             FROM sys.indexes i \
             JOIN sys.tables t ON i.object_id = t.object_id \
             JOIN sys.schemas s ON t.schema_id = s.schema_id \
             JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
             JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
             WHERE s.name = '{}' AND t.name = '{}' AND i.name IS NOT NULL \
             GROUP BY i.name, t.name, i.type_desc, i.is_unique, i.is_primary_key, i.type, i.fill_factor \
             ORDER BY i.name",
            schema, table
        );
        let qr = self.execute_query(id, &sql).await?;

        Ok(qr.rows.iter().map(|r| {
            let cols_str = r.get("columns").and_then(|v| v.as_str()).unwrap_or("");
            IndexInfo {
                name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                table_name: r.get("table_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                index_type: r.get("index_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                columns: cols_str.split(", ").map(|s| s.to_string()).collect(),
                is_unique: r.get("is_unique").and_then(|v| v.as_bool()).unwrap_or(false),
                is_primary_key: r.get("is_primary_key").and_then(|v| v.as_bool()).unwrap_or(false),
                is_clustered: r.get("is_clustered").and_then(|v| v.as_bool()).unwrap_or(false),
                fill_factor: r.get("fill_factor").and_then(|v| v.as_u64()).map(|v| v as u8),
            }
        }).collect())
    }

    pub async fn list_foreign_keys(&mut self, id: &str, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, MssqlError> {
        let sql = format!(
            "SELECT fk.name, c.name AS column_name, rt.name AS referenced_table, rc.name AS referenced_column, \
             rs.name AS referenced_schema, fk.update_referential_action_desc, fk.delete_referential_action_desc \
             FROM sys.foreign_keys fk \
             JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id \
             JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id \
             JOIN sys.tables pt ON fkc.parent_object_id = pt.object_id \
             JOIN sys.schemas ps ON pt.schema_id = ps.schema_id \
             JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id \
             JOIN sys.schemas rs ON rt.schema_id = rs.schema_id \
             JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id \
             WHERE ps.name = '{}' AND pt.name = '{}' ORDER BY fk.name",
            schema, table
        );
        let qr = self.execute_query(id, &sql).await?;

        Ok(qr.rows.iter().map(|r| ForeignKeyInfo {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            column: r.get("column_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            referenced_table: r.get("referenced_table").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            referenced_column: r.get("referenced_column").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            referenced_schema: r.get("referenced_schema").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            on_update: r.get("update_referential_action_desc").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            on_delete: r.get("delete_referential_action_desc").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        }).collect())
    }

    pub async fn list_views(&mut self, id: &str, schema: &str) -> Result<Vec<ViewInfo>, MssqlError> {
        let sql = format!(
            "SELECT v.name, s.name AS [schema], m.definition, \
             CASE WHEN EXISTS(SELECT 1 FROM sys.indexes i WHERE i.object_id = v.object_id AND i.type > 0) THEN 1 ELSE 0 END AS is_indexed \
             FROM sys.views v \
             JOIN sys.schemas s ON v.schema_id = s.schema_id \
             LEFT JOIN sys.sql_modules m ON v.object_id = m.object_id \
             WHERE s.name = '{}' ORDER BY v.name", schema
        );
        let qr = self.execute_query(id, &sql).await?;

        Ok(qr.rows.iter().map(|r| ViewInfo {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            schema: r.get("schema").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            definition: r.get("definition").and_then(|v| v.as_str()).map(|s| s.to_string()),
            is_indexed: r.get("is_indexed").and_then(|v| v.as_bool()).unwrap_or(false),
        }).collect())
    }

    pub async fn list_stored_procs(&mut self, id: &str, schema: &str) -> Result<Vec<StoredProcInfo>, MssqlError> {
        let sql = format!(
            "SELECT p.name, s.name AS [schema], p.type_desc AS proc_type, m.definition, \
             p.create_date, p.modify_date \
             FROM sys.procedures p \
             JOIN sys.schemas s ON p.schema_id = s.schema_id \
             LEFT JOIN sys.sql_modules m ON p.object_id = m.object_id \
             WHERE s.name = '{}' ORDER BY p.name", schema
        );
        let qr = self.execute_query(id, &sql).await?;

        Ok(qr.rows.iter().map(|r| StoredProcInfo {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            schema: r.get("schema").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            proc_type: r.get("proc_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            definition: r.get("definition").and_then(|v| v.as_str()).map(|s| s.to_string()),
            created: r.get("create_date").and_then(|v| v.as_str()).map(|s| s.to_string()),
            modified: r.get("modify_date").and_then(|v| v.as_str()).map(|s| s.to_string()),
        }).collect())
    }

    pub async fn list_triggers(&mut self, id: &str, schema: &str) -> Result<Vec<TriggerInfo>, MssqlError> {
        let sql = format!(
            "SELECT tr.name, OBJECT_NAME(tr.parent_id) AS table_name, s.name AS [schema], \
             tr.type_desc AS trigger_type, \
             CASE WHEN tr.is_disabled = 0 THEN 1 ELSE 0 END AS is_enabled, \
             m.definition \
             FROM sys.triggers tr \
             JOIN sys.objects o ON tr.parent_id = o.object_id \
             JOIN sys.schemas s ON o.schema_id = s.schema_id \
             LEFT JOIN sys.sql_modules m ON tr.object_id = m.object_id \
             WHERE s.name = '{}' ORDER BY tr.name", schema
        );
        let qr = self.execute_query(id, &sql).await?;

        Ok(qr.rows.iter().map(|r| TriggerInfo {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            table_name: r.get("table_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            schema: r.get("schema").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            trigger_type: r.get("trigger_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            is_enabled: r.get("is_enabled").and_then(|v| v.as_bool()).unwrap_or(false),
            definition: r.get("definition").and_then(|v| v.as_str()).map(|s| s.to_string()),
        }).collect())
    }

    // ── DDL ─────────────────────────────────────────────────────

    pub async fn create_database(&mut self, id: &str, name: &str) -> Result<(), MssqlError> {
        self.execute_statement(id, &format!("CREATE DATABASE [{}]", name)).await?;
        Ok(())
    }

    pub async fn drop_database(&mut self, id: &str, name: &str) -> Result<(), MssqlError> {
        self.execute_statement(id, &format!("DROP DATABASE IF EXISTS [{}]", name)).await?;
        Ok(())
    }

    pub async fn drop_table(&mut self, id: &str, schema: &str, table: &str) -> Result<(), MssqlError> {
        self.execute_statement(id, &format!("DROP TABLE IF EXISTS [{}].[{}]", schema, table)).await?;
        Ok(())
    }

    pub async fn truncate_table(&mut self, id: &str, schema: &str, table: &str) -> Result<(), MssqlError> {
        self.execute_statement(id, &format!("TRUNCATE TABLE [{}].[{}]", schema, table)).await?;
        Ok(())
    }

    // ── Data CRUD ───────────────────────────────────────────────

    pub async fn get_table_data(&mut self, id: &str, schema: &str, table: &str, limit: Option<u32>, offset: Option<u32>) -> Result<QueryResult, MssqlError> {
        let lim = limit.unwrap_or(500);
        let off = offset.unwrap_or(0);
        let sql = format!(
            "SELECT * FROM [{schema}].[{table}] ORDER BY (SELECT NULL) OFFSET {off} ROWS FETCH NEXT {lim} ROWS ONLY"
        );
        self.execute_query(id, &sql).await
    }

    pub async fn insert_row(&mut self, id: &str, schema: &str, table: &str, columns: &[String], values: &[String]) -> Result<u64, MssqlError> {
        let cols = columns.iter().map(|c| format!("[{}]", c)).collect::<Vec<_>>().join(", ");
        let vals = values.iter().map(|v| format!("'{}'", v.replace('\'', "''"))).collect::<Vec<_>>().join(", ");
        let sql = format!("INSERT INTO [{schema}].[{table}] ({cols}) VALUES ({vals})");
        let qr = self.execute_statement(id, &sql).await?;
        Ok(qr.affected_rows)
    }

    pub async fn update_rows(&mut self, id: &str, schema: &str, table: &str, columns: &[String], values: &[String], where_clause: &str) -> Result<u64, MssqlError> {
        let sets: Vec<String> = columns.iter().zip(values.iter()).map(|(c, v)| format!("[{}] = '{}'", c, v.replace('\'', "''"))).collect();
        let sql = format!("UPDATE [{schema}].[{table}] SET {} WHERE {where_clause}", sets.join(", "));
        let qr = self.execute_statement(id, &sql).await?;
        Ok(qr.affected_rows)
    }

    pub async fn delete_rows(&mut self, id: &str, schema: &str, table: &str, where_clause: &str) -> Result<u64, MssqlError> {
        let sql = format!("DELETE FROM [{schema}].[{table}] WHERE {where_clause}");
        let qr = self.execute_statement(id, &sql).await?;
        Ok(qr.affected_rows)
    }

    // ── Export ───────────────────────────────────────────────────

    pub async fn export_table(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, MssqlError> {
        match options.format {
            ExportFormat::Csv | ExportFormat::Tsv => self.export_table_delimited(id, schema, table, options).await,
            ExportFormat::Sql => self.export_table_sql(id, schema, table, options).await,
            ExportFormat::Json => self.export_table_json(id, schema, table, options).await,
        }
    }

    async fn export_table_delimited(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, MssqlError> {
        let sep = match options.format { ExportFormat::Tsv => '\t', _ => ',' };
        let mut output = String::new();
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;

        if options.include_headers {
            let cols = self.describe_table(id, schema, table).await?;
            output.push_str(&cols.iter().map(|c| c.name.clone()).collect::<Vec<_>>().join(&sep.to_string()));
            output.push('\n');
        }

        loop {
            let sql = format!("SELECT * FROM [{schema}].[{table}] ORDER BY (SELECT NULL) OFFSET {offset} ROWS FETCH NEXT {chunk} ROWS ONLY");
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

    async fn export_table_sql(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, MssqlError> {
        let mut output = String::new();
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;

        if options.include_create {
            let cols = self.describe_table(id, schema, table).await?;
            output.push_str(&format!("CREATE TABLE [{schema}].[{table}] (\n"));
            let defs: Vec<String> = cols.iter().map(|c| {
                let mut d = format!("  [{}] {}", c.name, c.data_type);
                if let Some(ml) = c.max_length {
                    if ml > 0 { d.push_str(&format!("({})", ml)); }
                }
                if !c.is_nullable { d.push_str(" NOT NULL"); }
                if c.is_identity { d.push_str(" IDENTITY(1,1)"); }
                d
            }).collect();
            output.push_str(&defs.join(",\n"));
            output.push_str("\n);\nGO\n\n");
        }

        loop {
            let sql = format!("SELECT * FROM [{schema}].[{table}] ORDER BY (SELECT NULL) OFFSET {offset} ROWS FETCH NEXT {chunk} ROWS ONLY");
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
                let bracket_cols: Vec<String> = col_names.iter().map(|c| format!("[{}]", c)).collect();
                output.push_str(&format!("INSERT INTO [{schema}].[{table}] ({}) VALUES ({});\n", bracket_cols.join(", "), vals.join(", ")));
            }
            offset += chunk;
            if result.rows.len() < chunk as usize { break; }
        }
        Ok(output)
    }

    async fn export_table_json(&mut self, id: &str, schema: &str, table: &str, options: &ExportOptions) -> Result<String, MssqlError> {
        let chunk = options.chunk_size;
        let mut offset: u32 = 0;
        let mut all_rows: Vec<RowMap> = Vec::new();
        loop {
            let sql = format!("SELECT * FROM [{schema}].[{table}] ORDER BY (SELECT NULL) OFFSET {offset} ROWS FETCH NEXT {chunk} ROWS ONLY");
            let result = self.execute_query(id, &sql).await?;
            if result.rows.is_empty() { break; }
            all_rows.extend(result.rows.clone());
            offset += chunk;
            if result.rows.len() < chunk as usize { break; }
        }
        serde_json::to_string_pretty(&all_rows).map_err(|e| MssqlError::new(MssqlErrorKind::ExportFailed, format!("{e}")))
    }

    // ── Import ──────────────────────────────────────────────────

    pub async fn import_sql(&mut self, id: &str, sql_content: &str) -> Result<u64, MssqlError> {
        // Split on GO batches and semicolons
        let batches: Vec<&str> = sql_content
            .split("\nGO\n")
            .flat_map(|batch| batch.split(';'))
            .filter(|s| !s.trim().is_empty())
            .collect();
        let mut count: u64 = 0;
        for batch in &batches {
            self.execute_statement(id, batch.trim()).await?;
            count += 1;
        }
        Ok(count)
    }

    pub async fn import_csv(&mut self, id: &str, schema: &str, table: &str, csv_content: &str, has_header: bool) -> Result<u64, MssqlError> {
        let mut lines = csv_content.lines();
        let headers: Option<Vec<String>> = if has_header {
            lines.next().map(|h| h.split(',').map(|s| s.trim().trim_matches('"').to_string()).collect())
        } else {
            None
        };
        let mut count: u64 = 0;
        for line in lines {
            if line.trim().is_empty() { continue; }
            let values: Vec<String> = line.split(',').map(|s| s.trim().trim_matches('"').to_string()).collect();
            let vals = values.iter().map(|v| format!("'{}'", v.replace('\'', "''"))).collect::<Vec<_>>().join(", ");
            let sql = if let Some(ref h) = headers {
                let cols = h.iter().map(|c| format!("[{}]", c)).collect::<Vec<_>>().join(", ");
                format!("INSERT INTO [{schema}].[{table}] ({cols}) VALUES ({vals})")
            } else {
                format!("INSERT INTO [{schema}].[{table}] VALUES ({vals})")
            };
            self.execute_statement(id, &sql).await?;
            count += 1;
        }
        Ok(count)
    }

    // ── Administration ──────────────────────────────────────────

    pub async fn server_properties(&mut self, id: &str) -> Result<Vec<ServerProperty>, MssqlError> {
        let props = ["MachineName", "ServerName", "Edition", "ProductVersion", "ProductLevel", "EngineEdition", "Collation"];
        let mut result = Vec::new();
        for prop in &props {
            let sql = format!("SELECT SERVERPROPERTY('{}') AS val", prop);
            let qr = self.execute_query(id, &sql).await?;
            let val = qr.rows.first().and_then(|r| r.get("val")).and_then(|v| v.as_str()).map(|s| s.to_string());
            result.push(ServerProperty { name: prop.to_string(), value: val });
        }
        Ok(result)
    }

    pub async fn show_processes(&mut self, id: &str) -> Result<Vec<SpWhoResult>, MssqlError> {
        let qr = self.execute_query(id,
            "SELECT spid, status, loginame AS login_name, hostname, DB_NAME(dbid) AS database_name, cmd AS command, program_name FROM sys.sysprocesses WHERE spid > 50 ORDER BY spid"
        ).await?;

        Ok(qr.rows.iter().map(|r| SpWhoResult {
            spid: r.get("spid").and_then(|v| v.as_i64()).unwrap_or(0) as i16,
            status: r.get("status").and_then(|v| v.as_str()).map(|s| s.to_string()),
            login_name: r.get("login_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
            hostname: r.get("hostname").and_then(|v| v.as_str()).map(|s| s.to_string()),
            database_name: r.get("database_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
            command: r.get("command").and_then(|v| v.as_str()).map(|s| s.to_string()),
            program_name: r.get("program_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        }).collect())
    }

    pub async fn kill_process(&mut self, id: &str, spid: i16) -> Result<(), MssqlError> {
        self.execute_statement(id, &format!("KILL {spid}")).await?;
        Ok(())
    }

    pub async fn list_logins(&mut self, id: &str) -> Result<Vec<SqlLogin>, MssqlError> {
        let qr = self.execute_query(id,
            "SELECT name, type_desc AS login_type, is_disabled, default_database_name, create_date \
             FROM sys.server_principals WHERE type IN ('S','U','G') ORDER BY name"
        ).await?;

        Ok(qr.rows.iter().map(|r| SqlLogin {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            login_type: r.get("login_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            is_disabled: r.get("is_disabled").and_then(|v| v.as_bool()).unwrap_or(false),
            default_database: r.get("default_database_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
            create_date: r.get("create_date").and_then(|v| v.as_str()).map(|s| s.to_string()),
        }).collect())
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = MssqlService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn session_not_found() {
        let svc = MssqlService::new();
        let err = svc.get_session("nope").unwrap_err();
        assert!(matches!(err.kind, MssqlErrorKind::SessionNotFound));
    }

    #[tokio::test]
    async fn disconnect_not_found() {
        let mut svc = MssqlService::new();
        let err = svc.disconnect("abc").await.unwrap_err();
        assert!(matches!(err.kind, MssqlErrorKind::SessionNotFound));
    }

    #[tokio::test]
    async fn disconnect_all_empty() {
        let mut svc = MssqlService::new();
        svc.disconnect_all().await;
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn free_port_works() {
        let port = MssqlService::free_port().unwrap();
        assert!(port > 0);
    }

    #[test]
    fn column_data_null() {
        let val = MssqlService::column_data_to_json(&ColumnData::String(None));
        assert!(val.is_null());
    }

    #[test]
    fn column_data_string() {
        let val = MssqlService::column_data_to_json(&ColumnData::String(Some("hello".into())));
        assert_eq!(val, serde_json::Value::String("hello".to_string()));
    }

    #[test]
    fn column_data_int() {
        let val = MssqlService::column_data_to_json(&ColumnData::I32(Some(42)));
        assert_eq!(val, serde_json::json!(42));
    }

    #[test]
    fn column_data_bool() {
        let val = MssqlService::column_data_to_json(&ColumnData::Bit(Some(true)));
        assert_eq!(val, serde_json::Value::Bool(true));
    }
}
