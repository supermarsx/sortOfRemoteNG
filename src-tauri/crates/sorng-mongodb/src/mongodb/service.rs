//! Lightweight MongoDB service built around `mongosh`.

use crate::mongodb::types::*;
use chrono::Utc;
use log::{info, warn};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type MongoServiceState = Arc<Mutex<MongoService>>;

pub fn new_state() -> MongoServiceState {
    Arc::new(Mutex::new(MongoService::new()))
}

struct MongoSession {
    connection_string: String,
    info: SessionInfo,
    ssh_child: Option<std::process::Child>,
}

pub struct MongoService {
    sessions: HashMap<String, MongoSession>,
}

impl Default for MongoService {
    fn default() -> Self {
        Self::new()
    }
}

impl MongoService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub async fn connect(&mut self, config: MongoConnectionConfig) -> Result<String, MongoError> {
        let session_id = Uuid::new_v4().to_string();
        let label = config
            .label
            .clone()
            .unwrap_or_else(|| format!("mongo-{}", &session_id[..8]));

        let (effective_hosts, ssh_child) = if config.ssh_tunnel.is_some() {
            warn!("SSH tunnel support for MongoDB is a stub; connecting directly");
            (config.hosts.clone(), None)
        } else {
            (config.hosts.clone(), None)
        };

        let connection_string = if config.connection_string.is_some() {
            config.to_connection_string()
        } else {
            let mut config_clone = config.clone();
            config_clone.hosts = effective_hosts.clone();
            config_clone.to_connection_string()
        };

        let connection_info = run_json(
            &connection_string,
            r#"
const admin = db.getSiblingDB('admin');
const ping = admin.runCommand({ ping: 1 });
const buildInfo = admin.runCommand({ buildInfo: 1 });
if (ping.ok !== 1) {
  throw new Error(ping.errmsg || 'MongoDB ping failed');
}
print(JSON.stringify({
  ok: true,
  version: buildInfo.version ?? null
}));
"#,
        )
        .await?;

        let server_version = connection_info
            .get("version")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);

        let info = SessionInfo {
            id: session_id.clone(),
            label,
            hosts: effective_hosts,
            database: config.database.clone(),
            status: ConnectionStatus::Connected,
            connected_at: Utc::now().to_rfc3339(),
            server_version,
            replica_set: config.replica_set.clone(),
        };

        info!("MongoDB connected: {} ({})", info.label, session_id);

        self.sessions.insert(
            session_id.clone(),
            MongoSession {
                connection_string,
                info,
                ssh_child,
            },
        );

        Ok(session_id)
    }

    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), MongoError> {
        let mut session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;

        if let Some(ref mut child) = session.ssh_child {
            let _ = child.kill();
        }

        info!("MongoDB disconnected: {session_id}");
        Ok(())
    }

    pub async fn disconnect_all(&mut self) {
        for (id, mut session) in self.sessions.drain() {
            if let Some(ref mut child) = session.ssh_child {
                let _ = child.kill();
            }
            info!("MongoDB disconnected: {id}");
        }
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions
            .values()
            .map(|session| session.info.clone())
            .collect()
    }

    pub fn get_session(&self, session_id: &str) -> Result<SessionInfo, MongoError> {
        self.sessions
            .get(session_id)
            .map(|session| session.info.clone())
            .ok_or_else(|| MongoError::session_not_found(session_id))
    }

    pub async fn ping(&self, session_id: &str) -> Result<bool, MongoError> {
        run_json(
            self.connection_string(session_id)?,
            r#"
const admin = db.getSiblingDB('admin');
const result = admin.runCommand({ ping: 1 });
print(JSON.stringify({ ok: result.ok === 1 }));
"#,
        )
        .await
        .map(|value| value.get("ok").and_then(Value::as_bool).unwrap_or(false))
    }

    pub async fn list_databases(&self, session_id: &str) -> Result<Vec<DatabaseInfo>, MongoError> {
        let value = run_json(
            self.connection_string(session_id)?,
            r#"
const admin = db.getSiblingDB('admin');
const result = admin.runCommand({ listDatabases: 1, nameOnly: true });
if (result.ok !== 1) {
  throw new Error(result.errmsg || 'listDatabases failed');
}
print(JSON.stringify(result.databases.map(entry => ({ name: entry.name }))));
"#,
        )
        .await?;

        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn drop_database(&self, session_id: &str, db_name: &str) -> Result<(), MongoError> {
        let script = format!(
            r#"
const database = db.getSiblingDB({});
const result = database.dropDatabase();
if (result.ok !== 1) {{
  throw new Error(result.errmsg || 'dropDatabase failed');
}}
print(JSON.stringify({{ ok: true }}));
"#,
            js_string(db_name)?
        );

        run_json(self.connection_string(session_id)?, &script)
            .await
            .map(|_| ())
    }

    pub async fn list_collections(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<CollectionInfo>, MongoError> {
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let script = format!(
            r#"
const database = db.getSiblingDB({});
print(JSON.stringify(database.getCollectionInfos().map(info => ({{
  name: info.name,
  collection_type: info.type || 'collection'
}}))));
"#,
            js_string(&selected_db)?
        );

        let value = run_json(self.connection_string(session_id)?, &script).await?;
        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn create_collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<(), MongoError> {
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let script = format!(
            r#"
const database = db.getSiblingDB({});
const result = database.createCollection({});
if (result.ok !== 1) {{
  throw new Error(result.errmsg || 'createCollection failed');
}}
print(JSON.stringify({{ ok: true }}));
"#,
            js_string(&selected_db)?,
            js_string(collection_name)?
        );

        run_json(self.connection_string(session_id)?, &script)
            .await
            .map(|_| ())
    }

    pub async fn drop_collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<(), MongoError> {
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let script = format!(
            r#"
const database = db.getSiblingDB({});
const result = database.getCollection({}).drop();
if (result !== true) {{
  throw new Error('drop collection failed');
}}
print(JSON.stringify({{ ok: true }}));
"#,
            js_string(&selected_db)?,
            js_string(collection_name)?
        );

        run_json(self.connection_string(session_id)?, &script)
            .await
            .map(|_| ())
    }

    pub async fn collection_stats(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<CollectionStats, MongoError> {
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let script = format!(
            r#"
const database = db.getSiblingDB({});
const stats = database.runCommand({{ collStats: {} }});
if (stats.ok !== 1) {{
  throw new Error(stats.errmsg || 'collStats failed');
}}
print(JSON.stringify({{
  namespace: stats.ns || '',
  count: Number(stats.count || 0),
  size: Number(stats.size || 0),
  storage_size: Number(stats.storageSize || 0),
  num_indexes: Number(stats.nindexes || 0),
  total_index_size: Number(stats.totalIndexSize || 0),
  capped: Boolean(stats.capped)
}}));
"#,
            js_string(&selected_db)?,
            js_string(collection_name)?
        );

        let value = run_json(self.connection_string(session_id)?, &script).await?;
        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn server_status(&self, session_id: &str) -> Result<ServerStatus, MongoError> {
        let value = run_json(
            self.connection_string(session_id)?,
            r#"
const admin = db.getSiblingDB('admin');
const result = admin.runCommand({ serverStatus: 1 });
if (result.ok !== 1) {
  throw new Error(result.errmsg || 'serverStatus failed');
}
print(JSON.stringify({
  host: result.host || 'unknown',
  version: result.version || 'unknown',
  uptime_secs: Number(result.uptime || 0),
  connections: {
    current: Number(result.connections?.current || 0),
    available: Number(result.connections?.available || 0),
    total_created: Number(result.connections?.totalCreated || 0)
  }
}));
"#,
        )
        .await?;

        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn list_users(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<MongoUserInfo>, MongoError> {
        let selected_db = self.resolve_db_name(session_id, db_name.or(Some("admin")))?;
        let script = format!(
            r#"
const database = db.getSiblingDB({});
const result = database.runCommand({{ usersInfo: 1 }});
if (result.ok !== 1) {{
  throw new Error(result.errmsg || 'usersInfo failed');
}}
print(JSON.stringify((result.users || []).map(user => ({{
  user: user.user || '',
  database: user.db || '',
  roles: (user.roles || []).map(role => ({{
    role: role.role || '',
    db: role.db || ''
  }}))
}}))));
"#,
            js_string(&selected_db)?
        );

        let value = run_json(self.connection_string(session_id)?, &script).await?;
        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn replica_set_status(
        &self,
        session_id: &str,
    ) -> Result<Vec<ReplicaSetMember>, MongoError> {
        let value = run_json(
            self.connection_string(session_id)?,
            r#"
const admin = db.getSiblingDB('admin');
const result = admin.runCommand({ replSetGetStatus: 1 });
if (result.ok !== 1) {
  throw new Error(result.errmsg || 'replSetGetStatus failed');
}
print(JSON.stringify((result.members || []).map(member => ({
  name: member.name || '',
  state_str: member.stateStr || '',
  state: Number(member.state || 0),
  health: Number(member.health || 0),
  self: member.self ?? null,
  uptime: member.uptime == null ? null : Number(member.uptime)
}))));
"#,
        )
        .await?;

        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn current_op(&self, session_id: &str) -> Result<Vec<serde_json::Value>, MongoError> {
        let value = run_json(
            self.connection_string(session_id)?,
            r#"
const admin = db.getSiblingDB('admin');
const result = admin.runCommand({ currentOp: 1 });
if (result.ok !== 1) {
  throw new Error(result.errmsg || 'currentOp failed');
}
print(EJSON.stringify(result.inprog || []));
"#,
        )
        .await?;

        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn kill_op(&self, session_id: &str, op_id: i64) -> Result<(), MongoError> {
        let script = format!(
            r#"
const admin = db.getSiblingDB('admin');
const result = admin.runCommand({{ killOp: 1, op: Number({}) }});
if (result.ok !== 1) {{
  throw new Error(result.errmsg || 'killOp failed');
}}
print(JSON.stringify({{ ok: true }}));
"#,
            op_id
        );

        run_json(self.connection_string(session_id)?, &script)
            .await
            .map(|_| ())
    }

    fn connection_string(&self, session_id: &str) -> Result<&str, MongoError> {
        self.sessions
            .get(session_id)
            .map(|session| session.connection_string.as_str())
            .ok_or_else(|| MongoError::session_not_found(session_id))
    }

    fn resolve_db_name(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<String, MongoError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;
        db_name
            .or(session.info.database.as_deref())
            .map(ToOwned::to_owned)
            .ok_or_else(|| MongoError::new(MongoErrorKind::InvalidConfig, "No database specified"))
    }
}

async fn run_json(connection_string: &str, script: &str) -> Result<Value, MongoError> {
    let output = Command::new("mongosh")
        .arg("--quiet")
        .arg("--norc")
        .arg(connection_string)
        .arg("--eval")
        .arg(script)
        .output()
        .await
        .map_err(command_spawn_error)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("mongosh exited with status {}", output.status)
        };
        return Err(MongoError::new(MongoErrorKind::CommandError, message));
    }

    let stdout = String::from_utf8(output.stdout).map_err(|error| {
        MongoError::new(
            MongoErrorKind::SerializationError,
            format!("mongosh returned non-UTF8 output: {error}"),
        )
    })?;

    let json_line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| {
            MongoError::new(
                MongoErrorKind::SerializationError,
                "mongosh returned no structured output",
            )
        })?;

    serde_json::from_str(json_line).map_err(serialization_error)
}

fn command_spawn_error(error: std::io::Error) -> MongoError {
    let message = if error.kind() == std::io::ErrorKind::NotFound {
        "mongosh was not found on PATH".to_string()
    } else {
        format!("failed to launch mongosh: {error}")
    };
    MongoError::new(MongoErrorKind::ConnectionFailed, message)
}

fn serialization_error(error: impl std::fmt::Display) -> MongoError {
    MongoError::new(
        MongoErrorKind::SerializationError,
        format!("failed to parse mongosh output: {error}"),
    )
}

fn js_string(value: &str) -> Result<String, MongoError> {
    serde_json::to_string(value).map_err(serialization_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_service() {
        let svc = MongoService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn test_session_not_found() {
        let svc = MongoService::new();
        let result = svc.get_session("nonexistent");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_disconnect_nonexistent() {
        let mut svc = MongoService::new();
        let result = svc.disconnect("no-such").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_ping_nonexistent() {
        let svc = MongoService::new();
        let result = svc.ping("no-such").await;
        assert!(result.is_err());
    }

    #[test]
    fn test_js_string_quotes_value() {
        assert_eq!(js_string("db\"name").unwrap(), "\"db\\\"name\"");
    }

    #[test]
    fn test_command_spawn_error_not_found() {
        let error = command_spawn_error(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert_eq!(error.kind, MongoErrorKind::ConnectionFailed);
        assert!(error.message.contains("mongosh"));
    }

    #[test]
    fn test_serialization_error_kind() {
        let error = serialization_error("boom");
        assert_eq!(error.kind, MongoErrorKind::SerializationError);
    }
}
