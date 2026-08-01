//! Lightweight MongoDB service built around `mongosh`.

use crate::mongodb::types::*;
use chrono::Utc;
use log::info;
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsString;
use std::future::Future;
use std::io::Write as SyncWrite;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tempfile::NamedTempFile;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const MONGOSH_PATH_ENV: &str = "SORNG_MONGOSH_PATH";
const MAX_CONNECTION_URI_BYTES: usize = 8 * 1024;
const MAX_SCRIPT_BYTES: usize = 256 * 1024;
const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const MAX_SESSIONS: usize = 32;
const MAX_HOSTS: usize = 32;
const MAX_HOST_BYTES: usize = 512;
const MAX_FIELD_BYTES: usize = 1024;
const MAX_PATH_BYTES: usize = 4096;
const MAX_SESSION_ID_BYTES: usize = 128;
const MAX_TIMEOUT_SECS: u64 = 300;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(45);
const REAP_TIMEOUT: Duration = Duration::from_secs(3);

type MongoRunnerFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, MongoError>> + Send + 'a>>;

trait MongoRunner: Send + Sync {
    fn run_json<'a>(&'a self, connection_string: &'a str, script: &'a str)
        -> MongoRunnerFuture<'a>;
}

struct MongoshRunner;

impl MongoRunner for MongoshRunner {
    fn run_json<'a>(
        &'a self,
        connection_string: &'a str,
        script: &'a str,
    ) -> MongoRunnerFuture<'a> {
        Box::pin(run_mongosh_json(connection_string, script))
    }
}

pub type MongoServiceState = Arc<Mutex<MongoService>>;

pub fn new_state() -> MongoServiceState {
    Arc::new(Mutex::new(MongoService::new()))
}

struct MongoSession {
    connection_string: Zeroizing<String>,
    info: SessionInfo,
    ssh_child: Option<std::process::Child>,
}

pub struct MongoService {
    sessions: HashMap<String, MongoSession>,
    runner: Arc<dyn MongoRunner>,
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
            runner: Arc::new(MongoshRunner),
        }
    }

    #[cfg(test)]
    fn with_runner(runner: Arc<dyn MongoRunner>) -> Self {
        Self {
            sessions: HashMap::new(),
            runner,
        }
    }

    pub async fn connect(&mut self, config: MongoConnectionConfig) -> Result<String, MongoError> {
        self.connect_with_acknowledgement(config, None).await
    }

    pub async fn connect_with_acknowledgement(
        &mut self,
        mut config: MongoConnectionConfig,
        insecure_tls_acknowledgement: Option<String>,
    ) -> Result<String, MongoError> {
        let session_id = Uuid::new_v4().to_string();
        let label = config
            .label
            .clone()
            .unwrap_or_else(|| format!("mongo-{}", &session_id[..8]));

        if self.sessions.len() >= MAX_SESSIONS {
            scrub_config_secrets(&mut config);
            return Err(MongoError::new(
                MongoErrorKind::InvalidConfig,
                "MongoDB session limit reached; disconnect an existing session first",
            ));
        }

        if config.ssh_tunnel.is_some() {
            scrub_config_secrets(&mut config);
            return Err(MongoError::new(
                MongoErrorKind::InvalidConfig,
                "MongoDB SSH tunnelling is not implemented; refusing a direct connection",
            ));
        }

        let acknowledgement = insecure_tls_acknowledgement.map(Zeroizing::new);
        let policy_result = validate_and_secure_config(
            &mut config,
            acknowledgement.as_ref().map(|value| value.as_str()),
        );
        drop(acknowledgement);
        let effective_hosts = match policy_result {
            Ok(hosts) => hosts,
            Err(error) => {
                scrub_config_secrets(&mut config);
                return Err(error);
            }
        };
        let ssh_child = None;

        let connection_string = Zeroizing::new(config.to_connection_string());
        scrub_config_secrets(&mut config);

        let connection_info = self
            .runner
            .run_json(
                connection_string.as_str(),
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

        info!("MongoDB connected: {session_id}");

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
        session.connection_string.zeroize();

        info!("MongoDB disconnected: {session_id}");
        Ok(())
    }

    pub async fn disconnect_all(&mut self) {
        for (id, mut session) in self.sessions.drain() {
            if let Some(ref mut child) = session.ssh_child {
                let _ = child.kill();
            }
            session.connection_string.zeroize();
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
        self.run_session_json(
            session_id,
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
        let value = self
            .run_session_json(
                session_id,
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

        self.run_session_json(session_id, &script).await.map(|_| ())
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

        let value = self.run_session_json(session_id, &script).await?;
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

        self.run_session_json(session_id, &script).await.map(|_| ())
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

        self.run_session_json(session_id, &script).await.map(|_| ())
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

        let value = self.run_session_json(session_id, &script).await?;
        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn server_status(&self, session_id: &str) -> Result<ServerStatus, MongoError> {
        let value = self
            .run_session_json(
                session_id,
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

        let value = self.run_session_json(session_id, &script).await?;
        serde_json::from_value(value).map_err(serialization_error)
    }

    pub async fn replica_set_status(
        &self,
        session_id: &str,
    ) -> Result<Vec<ReplicaSetMember>, MongoError> {
        let value = self
            .run_session_json(
                session_id,
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
        let value = self
            .run_session_json(
                session_id,
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

        self.run_session_json(session_id, &script).await.map(|_| ())
    }

    fn connection_string(&self, session_id: &str) -> Result<&str, MongoError> {
        validate_required_field("MongoDB session ID", session_id, MAX_SESSION_ID_BYTES)?;
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

    async fn run_session_json(&self, session_id: &str, script: &str) -> Result<Value, MongoError> {
        let connection_string = self.connection_string(session_id)?;
        validate_runner_input(connection_string, script)?;
        self.runner.run_json(connection_string, script).await
    }
}

struct ParsedMongoUri {
    hosts: Vec<String>,
    has_credentials: bool,
    all_hosts_are_literal_loopback: bool,
    tls_enabled: bool,
    allows_invalid_certificates: bool,
}

fn validate_and_secure_config(
    config: &mut MongoConnectionConfig,
    insecure_tls_acknowledgement: Option<&str>,
) -> Result<Vec<String>, MongoError> {
    validate_optional_field("label", config.label.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field("database", config.database.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field("username", config.username.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field("password", config.password.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field(
        "authentication database",
        config.auth_database.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_optional_field(
        "replica set",
        config.replica_set.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_optional_field(
        "read preference",
        config.read_preference.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_optional_field(
        "application name",
        config.app_name.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_timeout(config.connect_timeout_secs)?;
    validate_timeout(config.server_selection_timeout_secs)?;

    if let Some(uri) = config.connection_string.as_deref() {
        if config.username.is_some() || config.password.is_some() || config.tls.is_some() {
            return Err(invalid_config(
                "Raw MongoDB URIs must contain their own authentication and TLS settings",
            ));
        }
        let parsed = parse_mongo_uri(uri)?;
        enforce_transport_policy(&parsed, insecure_tls_acknowledgement)?;
        return Ok(parsed.hosts);
    }

    if config.hosts.is_empty() {
        config.hosts.push("127.0.0.1:27017".to_string());
    }
    if config.hosts.len() > MAX_HOSTS {
        return Err(invalid_config(
            "MongoDB host count exceeds the safety limit",
        ));
    }

    let mut all_hosts_are_literal_loopback = true;
    for host in &config.hosts {
        let parsed = parse_host(host, false)?;
        all_hosts_are_literal_loopback &= parsed.literal_loopback;
    }

    if let Some(tls) = config.tls.as_ref() {
        validate_optional_field("TLS CA path", tls.ca_cert_path.as_deref(), MAX_PATH_BYTES)?;
        validate_optional_field(
            "TLS client certificate path",
            tls.client_cert_path.as_deref(),
            MAX_PATH_BYTES,
        )?;
        validate_optional_field(
            "TLS client key path",
            tls.client_key_path.as_deref(),
            MAX_PATH_BYTES,
        )?;
    } else if !all_hosts_are_literal_loopback {
        config.tls = Some(TlsConfig::default());
    }

    let has_credentials = config.username.is_some()
        || config.password.is_some()
        || matches!(
            config.auth_mechanism.as_ref(),
            Some(MongoAuthMechanism::X509 | MongoAuthMechanism::AwsIam)
        );
    let tls_enabled = config.tls.as_ref().is_some_and(|tls| tls.enabled);
    let allows_invalid_certificates = config
        .tls
        .as_ref()
        .is_some_and(|tls| tls.allow_invalid_certificates);
    let policy = ParsedMongoUri {
        hosts: config.hosts.clone(),
        has_credentials,
        all_hosts_are_literal_loopback,
        tls_enabled,
        allows_invalid_certificates,
    };
    enforce_transport_policy(&policy, insecure_tls_acknowledgement)?;

    let generated_uri = Zeroizing::new(config.to_connection_string());
    validate_runner_input(generated_uri.as_str(), "policy-validation")?;
    Ok(policy.hosts)
}

fn enforce_transport_policy(
    policy: &ParsedMongoUri,
    insecure_tls_acknowledgement: Option<&str>,
) -> Result<(), MongoError> {
    if policy.allows_invalid_certificates {
        if !policy.tls_enabled {
            return Err(invalid_config(
                "MongoDB invalid-certificate mode requires TLS to be enabled",
            ));
        }
        if insecure_tls_acknowledgement != Some(INVALID_CERTIFICATE_ACKNOWLEDGEMENT) {
            return Err(invalid_config(
                "MongoDB invalid-certificate mode requires the exact one-time acknowledgement",
            ));
        }
    }

    if policy.has_credentials
        && !policy.all_hosts_are_literal_loopback
        && (!policy.tls_enabled || policy.allows_invalid_certificates)
    {
        return Err(invalid_config(
            "Credentialed remote MongoDB connections require certificate-verified TLS",
        ));
    }
    Ok(())
}

fn parse_mongo_uri(uri: &str) -> Result<ParsedMongoUri, MongoError> {
    validate_runner_input(uri, "uri-validation")?;
    if uri.trim() != uri || uri.contains('#') {
        return Err(invalid_uri());
    }

    let (srv, remainder) = if let Some(remainder) = uri.strip_prefix("mongodb://") {
        (false, remainder)
    } else if let Some(remainder) = uri.strip_prefix("mongodb+srv://") {
        (true, remainder)
    } else {
        return Err(invalid_uri());
    };

    let (location, query) = remainder
        .split_once('?')
        .map_or((remainder, None), |(location, query)| {
            (location, Some(query))
        });
    let (authority, path) = location
        .split_once('/')
        .map_or((location, ""), |(authority, path)| (authority, path));
    validate_required_field("MongoDB URI authority", authority, MAX_CONNECTION_URI_BYTES)?;
    validate_optional_field("MongoDB URI database", Some(path), MAX_FIELD_BYTES)?;

    let (userinfo, host_list) = authority
        .rsplit_once('@')
        .map_or((None, authority), |(userinfo, hosts)| {
            (Some(userinfo), hosts)
        });
    if let Some(userinfo) = userinfo {
        if userinfo.is_empty() || userinfo.contains('@') || userinfo.len() > MAX_FIELD_BYTES * 2 {
            return Err(invalid_uri());
        }
    }

    let host_values = host_list.split(',').collect::<Vec<_>>();
    if host_values.is_empty() || host_values.len() > MAX_HOSTS {
        return Err(invalid_uri());
    }
    if srv && host_values.len() != 1 {
        return Err(invalid_config(
            "MongoDB SRV URIs require exactly one hostname",
        ));
    }

    let mut hosts = Vec::with_capacity(host_values.len());
    let mut all_hosts_are_literal_loopback = true;
    for host in host_values {
        let parsed = parse_host(host, srv)?;
        all_hosts_are_literal_loopback &= parsed.literal_loopback;
        hosts.push(host.to_string());
    }

    let mut tls_enabled = srv;
    let mut tls_seen = false;
    let mut invalid_seen = false;
    let mut allows_invalid_certificates = false;
    let mut mechanism_has_credentials = false;
    if let Some(query) = query {
        validate_optional_field("MongoDB URI options", Some(query), MAX_CONNECTION_URI_BYTES)?;
        for option in query.split('&') {
            if option.is_empty() {
                return Err(invalid_uri());
            }
            let (name, value) = option.split_once('=').unwrap_or((option, ""));
            validate_required_field("MongoDB URI option", name, MAX_FIELD_BYTES)?;
            validate_optional_field("MongoDB URI option value", Some(value), MAX_FIELD_BYTES)?;
            if name.eq_ignore_ascii_case("tls") || name.eq_ignore_ascii_case("ssl") {
                if tls_seen {
                    return Err(invalid_config("MongoDB URI contains ambiguous TLS options"));
                }
                tls_enabled = parse_bool_option(value)?;
                tls_seen = true;
            } else if name.eq_ignore_ascii_case("tlsAllowInvalidCertificates")
                || name.eq_ignore_ascii_case("tlsAllowInvalidHostnames")
                || name.eq_ignore_ascii_case("tlsInsecure")
            {
                if invalid_seen {
                    return Err(invalid_config(
                        "MongoDB URI contains ambiguous certificate-verification options",
                    ));
                }
                allows_invalid_certificates = parse_bool_option(value)?;
                invalid_seen = true;
            } else if name.eq_ignore_ascii_case("authMechanism") {
                mechanism_has_credentials =
                    !value.eq_ignore_ascii_case("none") && !value.is_empty();
            }
        }
    }

    Ok(ParsedMongoUri {
        hosts,
        has_credentials: userinfo.is_some() || mechanism_has_credentials,
        all_hosts_are_literal_loopback,
        tls_enabled,
        allows_invalid_certificates,
    })
}

struct ParsedHost {
    literal_loopback: bool,
}

fn parse_host(value: &str, srv: bool) -> Result<ParsedHost, MongoError> {
    validate_required_field("MongoDB host", value, MAX_HOST_BYTES)?;
    if value.chars().any(|character| character.is_whitespace()) {
        return Err(invalid_uri());
    }

    let (hostname, has_port) = if let Some(bracketed) = value.strip_prefix('[') {
        let (hostname, suffix) = bracketed.split_once(']').ok_or_else(invalid_uri)?;
        if suffix.is_empty() {
            (hostname, false)
        } else if let Some(port) = suffix.strip_prefix(':') {
            validate_port(port)?;
            (hostname, true)
        } else {
            return Err(invalid_uri());
        }
    } else {
        let colon_count = value.bytes().filter(|byte| *byte == b':').count();
        if colon_count > 1 {
            return Err(invalid_uri());
        }
        if let Some((hostname, port)) = value.rsplit_once(':') {
            validate_port(port)?;
            (hostname, true)
        } else {
            (value, false)
        }
    };

    if hostname.is_empty() {
        return Err(invalid_uri());
    }
    if hostname.contains(':') {
        if std::net::IpAddr::from_str(hostname).is_err() {
            return Err(invalid_uri());
        }
    } else if !hostname
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(invalid_uri());
    }
    if srv && has_port {
        return Err(invalid_config("MongoDB SRV URIs cannot specify a port"));
    }

    let literal_loopback = std::net::IpAddr::from_str(hostname)
        .map(|address| address.is_loopback())
        .unwrap_or(false);
    Ok(ParsedHost { literal_loopback })
}

fn validate_port(value: &str) -> Result<(), MongoError> {
    match value.parse::<u16>() {
        Ok(1..=u16::MAX) => Ok(()),
        _ => Err(invalid_uri()),
    }
}

fn parse_bool_option(value: &str) -> Result<bool, MongoError> {
    if value.eq_ignore_ascii_case("true") || value == "1" {
        Ok(true)
    } else if value.eq_ignore_ascii_case("false") || value == "0" {
        Ok(false)
    } else {
        Err(invalid_config(
            "MongoDB URI contains an invalid security option",
        ))
    }
}

fn validate_timeout(value: Option<u64>) -> Result<(), MongoError> {
    if value.is_some_and(|seconds| seconds == 0 || seconds > MAX_TIMEOUT_SECS) {
        return Err(invalid_config(
            "MongoDB timeout must be between 1 and 300 seconds",
        ));
    }
    Ok(())
}

fn validate_optional_field(
    name: &str,
    value: Option<&str>,
    max_bytes: usize,
) -> Result<(), MongoError> {
    if let Some(value) = value {
        if value.len() > max_bytes
            || value
                .chars()
                .any(|character| matches!(character, '\0' | '\r' | '\n'))
        {
            return Err(invalid_config(format!(
                "{name} is invalid or exceeds the safety limit"
            )));
        }
    }
    Ok(())
}

fn validate_required_field(name: &str, value: &str, max_bytes: usize) -> Result<(), MongoError> {
    validate_optional_field(name, Some(value), max_bytes)?;
    if value.is_empty() {
        return Err(invalid_config(format!("{name} is required")));
    }
    Ok(())
}

fn invalid_uri() -> MongoError {
    invalid_config("MongoDB connection URI is invalid")
}

fn invalid_config(message: impl Into<String>) -> MongoError {
    MongoError::new(MongoErrorKind::InvalidConfig, message)
}

/// `mongosh` receives the URI only through its anonymous stdin pipe. The URI is
/// never placed in argv, the environment, the temporary script, or an error.
/// There is deliberately no argv fallback: if stdin cannot be established, the
/// operation fails closed.
async fn run_mongosh_json(connection_string: &str, script: &str) -> Result<Value, MongoError> {
    validate_runner_input(connection_string, script)?;

    let executable = resolve_mongosh()?;
    let script_file = create_secure_script(script)?;
    let invocation = build_invocation(&executable, script_file.path());

    let mut command = Command::new(&invocation.program);
    command
        .args(&invocation.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("MONGOSH_CONFIG_DIR")
        .env("NO_COLOR", "1");
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);

    let mut child = command.spawn().map_err(|_| command_spawn_error())?;
    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            terminate_and_reap(&mut child).await;
            return Err(command_io_error());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_and_reap(&mut child).await;
            return Err(command_io_error());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_and_reap(&mut child).await;
            return Err(command_io_error());
        }
    };

    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let status = match timeout(PROCESS_TIMEOUT, async {
        stdin.write_all(connection_string.as_bytes()).await?;
        stdin.shutdown().await?;
        drop(stdin);
        child.wait().await
    })
    .await
    {
        Ok(Ok(status)) => status,
        Ok(Err(_)) => {
            terminate_and_reap(&mut child).await;
            discard_captures(stdout_task, stderr_task).await;
            return Err(command_io_error());
        }
        Err(_) => {
            terminate_and_reap(&mut child).await;
            discard_captures(stdout_task, stderr_task).await;
            return Err(MongoError::new(
                MongoErrorKind::CommandError,
                "MongoDB client operation timed out",
            ));
        }
    };

    let (stdout_capture, _stderr_capture) = finish_captures(stdout_task, stderr_task).await?;
    if !status.success() {
        let status_label = status
            .code()
            .map(|code| format!("exit code {code}"))
            .unwrap_or_else(|| "terminated by the operating system".to_string());
        return Err(MongoError::new(
            MongoErrorKind::CommandError,
            format!("MongoDB client operation failed ({status_label})"),
        ));
    }

    parse_json_output(&stdout_capture)
}

fn scrub_config_secrets(config: &mut MongoConnectionConfig) {
    if let Some(password) = config.password.as_mut() {
        password.zeroize();
    }
    config.password = None;

    if let Some(connection_string) = config.connection_string.as_mut() {
        connection_string.zeroize();
    }
    config.connection_string = None;

    if let Some(tunnel) = config.ssh_tunnel.as_mut() {
        if let Some(password) = tunnel.password.as_mut() {
            password.zeroize();
        }
        tunnel.password = None;
        if let Some(passphrase) = tunnel.passphrase.as_mut() {
            passphrase.zeroize();
        }
        tunnel.passphrase = None;
    }
}

fn validate_runner_input(connection_string: &str, script: &str) -> Result<(), MongoError> {
    if connection_string.is_empty()
        || connection_string.len() > MAX_CONNECTION_URI_BYTES
        || connection_string
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err(MongoError::new(
            MongoErrorKind::InvalidConfig,
            "MongoDB connection URI is invalid or exceeds the safety limit",
        ));
    }
    if script.is_empty() || script.len() > MAX_SCRIPT_BYTES || script.contains('\0') {
        return Err(MongoError::new(
            MongoErrorKind::CommandError,
            "MongoDB operation exceeds the safety limit",
        ));
    }
    Ok(())
}

const SCRIPT_BOOTSTRAP: &str = r#""use strict";
const __sorngFs = require("fs");
const __sorngUri = __sorngFs.readFileSync(0, "utf8");
if (typeof __sorngUri !== "string" || __sorngUri.length === 0) {
  throw new Error("MongoDB connection input is unavailable");
}
globalThis.db = connect(__sorngUri);
"#;

fn create_secure_script(script: &str) -> Result<NamedTempFile, MongoError> {
    let mut file = tempfile::Builder::new()
        .prefix("sorng-mongosh-")
        .suffix(".js")
        .tempfile()
        .map_err(|_| script_preparation_error())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| script_preparation_error())?;
    }

    SyncWrite::write_all(file.as_file_mut(), SCRIPT_BOOTSTRAP.as_bytes())
        .and_then(|_| SyncWrite::write_all(file.as_file_mut(), script.as_bytes()))
        .and_then(|_| SyncWrite::flush(file.as_file_mut()))
        .map_err(|_| script_preparation_error())?;
    Ok(file)
}

struct MongoshInvocation {
    program: PathBuf,
    args: Vec<OsString>,
}

fn build_invocation(executable: &Path, script_path: &Path) -> MongoshInvocation {
    MongoshInvocation {
        program: executable.to_path_buf(),
        args: vec![
            OsString::from("--quiet"),
            OsString::from("--norc"),
            OsString::from("--nodb"),
            OsString::from("--file"),
            script_path.as_os_str().to_owned(),
        ],
    }
}

fn resolve_mongosh() -> Result<PathBuf, MongoError> {
    let candidates = trusted_mongosh_candidates();
    let trusted_roots = candidates
        .iter()
        .map(|(_, root)| root.clone())
        .collect::<Vec<_>>();

    if let Some(explicit) = std::env::var_os(MONGOSH_PATH_ENV) {
        let explicit = PathBuf::from(explicit);
        if !explicit.is_absolute() {
            return Err(executable_resolution_error());
        }
        return validate_executable(&explicit, &trusted_roots)
            .ok_or_else(executable_resolution_error);
    }

    for (candidate, _) in candidates {
        if let Some(executable) = validate_executable(&candidate, &trusted_roots) {
            return Ok(executable);
        }
    }

    Err(executable_resolution_error())
}

#[cfg(windows)]
fn trusted_mongosh_candidates() -> Vec<(PathBuf, PathBuf)> {
    windows_mongosh_candidates(windows_program_files_roots())
}

#[cfg(windows)]
fn windows_program_files_roots() -> Vec<PathBuf> {
    use windows_sys::Win32::UI::Shell::{
        FOLDERID_ProgramFiles, FOLDERID_ProgramFilesX64, FOLDERID_ProgramFilesX86,
    };

    let mut roots = [
        known_folder_path(&FOLDERID_ProgramFiles),
        known_folder_path(&FOLDERID_ProgramFilesX64),
        known_folder_path(&FOLDERID_ProgramFilesX86),
    ]
    .into_iter()
    .flatten()
    .filter(|path| path.is_absolute())
    .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    roots
}

#[cfg(windows)]
struct CoTaskMemWidePath(*mut u16);

#[cfg(windows)]
impl Drop for CoTaskMemWidePath {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: SHGetKnownFolderPath allocated this pointer with the COM
            // task allocator and ownership remains with this guard.
            unsafe {
                windows_sys::Win32::System::Com::CoTaskMemFree(self.0.cast::<std::ffi::c_void>());
            }
        }
    }
}

#[cfg(windows)]
fn known_folder_path(folder_id: &windows_sys::core::GUID) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::UI::Shell::SHGetKnownFolderPath;

    let mut raw = std::ptr::null_mut();
    // SAFETY: folder_id points to a static KNOWNFOLDERID, the default token is
    // null by contract, and raw is an out-pointer owned by the guard below.
    let result = unsafe { SHGetKnownFolderPath(folder_id, 0, std::ptr::null_mut(), &mut raw) };
    if result < 0 || raw.is_null() {
        return None;
    }
    let allocation = CoTaskMemWidePath(raw);

    let mut length = 0usize;
    // SAFETY: a successful SHGetKnownFolderPath call guarantees a terminated
    // UTF-16 string. MAX_PATH-sized legacy assumptions are avoided while a
    // defensive NT path ceiling prevents unbounded scanning.
    while length < 32_767 && unsafe { *allocation.0.add(length) } != 0 {
        length += 1;
    }
    if length == 0 || length == 32_767 {
        return None;
    }
    // SAFETY: the loop established that the allocation contains `length`
    // initialized UTF-16 code units before its terminator.
    let path =
        std::ffi::OsString::from_wide(unsafe { std::slice::from_raw_parts(allocation.0, length) });
    Some(PathBuf::from(path))
}

#[cfg(any(windows, test))]
fn windows_mongosh_candidates(roots: impl IntoIterator<Item = PathBuf>) -> Vec<(PathBuf, PathBuf)> {
    let mut candidates = Vec::new();
    for root in roots.into_iter().filter(|path| path.is_absolute()) {
        candidates.push((
            root.join("MongoDB/mongosh/current/bin/mongosh.exe"),
            root.clone(),
        ));
        candidates.push((root.join("MongoDB/mongosh/bin/mongosh.exe"), root.clone()));

        let servers = root.join("MongoDB/Server");
        if let Ok(entries) = std::fs::read_dir(&servers) {
            let mut versioned: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path().join("bin/mongosh.exe"))
                .collect();
            versioned.sort_by(|left, right| right.cmp(left));
            candidates.extend(
                versioned
                    .into_iter()
                    .map(|candidate| (candidate, root.clone())),
            );
        }
    }
    candidates
}

#[cfg(not(windows))]
fn trusted_mongosh_candidates() -> Vec<(PathBuf, PathBuf)> {
    [
        ("/usr/bin/mongosh", "/usr"),
        ("/usr/local/bin/mongosh", "/usr/local"),
        ("/opt/homebrew/bin/mongosh", "/opt/homebrew"),
    ]
    .into_iter()
    .map(|(candidate, root)| (PathBuf::from(candidate), PathBuf::from(root)))
    .collect()
}

fn validate_executable(candidate: &Path, trusted_roots: &[PathBuf]) -> Option<PathBuf> {
    if !candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                std::path::Component::CurDir | std::path::Component::ParentDir
            )
        })
    {
        return None;
    }

    let lexical_root = trusted_roots
        .iter()
        .find(|root| candidate.starts_with(root))?;
    if !parent_chain_has_no_symlinks(candidate.parent()?, lexical_root) {
        return None;
    }

    let link_metadata = std::fs::symlink_metadata(candidate).ok()?;
    if !link_metadata.is_file() && !link_metadata.file_type().is_symlink() {
        return None;
    }
    let canonical = candidate.canonicalize().ok()?;
    let canonical_roots = trusted_roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .collect::<Vec<_>>();
    if !canonical_roots
        .iter()
        .any(|root| canonical.starts_with(root))
    {
        return None;
    }

    let metadata = std::fs::metadata(&canonical).ok()?;
    if !metadata.is_file() {
        return None;
    }

    #[cfg(unix)]
    {
        if !unix_executable_chain_is_trusted(&canonical) {
            return None;
        }
    }

    #[cfg(windows)]
    {
        // The candidate and canonical target are already confined beneath an
        // OS-managed Program Files root. Reject a file writable by the current
        // process as a final defense against a user-controlled replacement.
        if std::fs::OpenOptions::new()
            .write(true)
            .open(&canonical)
            .is_ok()
        {
            return None;
        }
        let canonical_root = canonical_roots
            .iter()
            .find(|root| canonical.starts_with(root))?;
        if !parent_chain_has_no_symlinks(canonical.parent()?, canonical_root) {
            return None;
        }
    }

    Some(canonical)
}

fn parent_chain_has_no_symlinks(mut path: &Path, root: &Path) -> bool {
    loop {
        if !path.starts_with(root) {
            return false;
        }
        let Ok(metadata) = std::fs::symlink_metadata(path) else {
            return false;
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return false;
        }
        if path == root {
            return true;
        }
        let Some(parent) = path.parent() else {
            return false;
        };
        path = parent;
    }
}

#[cfg(unix)]
fn unix_executable_chain_is_trusted(executable: &Path) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let Some(current_uid) = tempfile::tempfile()
        .ok()
        .and_then(|file| file.metadata().ok())
        .map(|metadata| metadata.uid())
    else {
        return false;
    };

    let Ok(metadata) = std::fs::metadata(executable) else {
        return false;
    };
    let mode = metadata.permissions().mode();
    if !metadata.is_file()
        || (metadata.uid() != 0 && metadata.uid() != current_uid)
        || mode & 0o111 == 0
        || mode & 0o022 != 0
    {
        return false;
    }

    for parent in executable.ancestors().skip(1) {
        let Ok(metadata) = std::fs::symlink_metadata(parent) else {
            return false;
        };
        let mode = metadata.permissions().mode();
        let owner_is_trusted = metadata.uid() == 0 || metadata.uid() == current_uid;
        let writable_by_others = mode & 0o022 != 0;
        let trusted_sticky_directory = metadata.uid() == 0 && mode & 0o1000 != 0;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || !owner_is_trusted
            || (writable_by_others && !trusted_sticky_directory)
        {
            return false;
        }
    }
    true
}

struct BoundedCapture {
    bytes: Vec<u8>,
    truncated: bool,
}

type CaptureTask = JoinHandle<std::io::Result<BoundedCapture>>;

async fn read_bounded<R>(mut reader: R) -> std::io::Result<BoundedCapture>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::with_capacity(16 * 1024);
    let mut truncated = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let available = MAX_CAPTURE_BYTES.saturating_sub(bytes.len());
        let retained = available.min(read);
        bytes.extend_from_slice(&buffer[..retained]);
        truncated |= retained != read;
    }
    Ok(BoundedCapture { bytes, truncated })
}

async fn finish_captures(
    mut stdout: CaptureTask,
    mut stderr: CaptureTask,
) -> Result<(BoundedCapture, BoundedCapture), MongoError> {
    let joined = timeout(REAP_TIMEOUT, async {
        tokio::join!(&mut stdout, &mut stderr)
    })
    .await;
    match joined {
        Ok((Ok(Ok(stdout)), Ok(Ok(stderr)))) => Ok((stdout, stderr)),
        Ok(_) => Err(command_io_error()),
        Err(_) => {
            abort_and_join_captures(stdout, stderr).await;
            Err(command_io_error())
        }
    }
}

async fn discard_captures(stdout: CaptureTask, stderr: CaptureTask) {
    abort_and_join_captures(stdout, stderr).await;
}

async fn abort_and_join_captures(mut stdout: CaptureTask, mut stderr: CaptureTask) {
    stdout.abort();
    stderr.abort();
    let _ = timeout(REAP_TIMEOUT, async {
        let _ = (&mut stdout).await;
        let _ = (&mut stderr).await;
    })
    .await;
}

async fn terminate_and_reap(child: &mut Child) {
    let _ = child.start_kill();
    let _ = timeout(REAP_TIMEOUT, child.wait()).await;
}

fn parse_json_output(output: &BoundedCapture) -> Result<Value, MongoError> {
    if output.truncated {
        return Err(MongoError::new(
            MongoErrorKind::SerializationError,
            "MongoDB client output exceeded the safety limit",
        ));
    }
    let stdout = std::str::from_utf8(&output.bytes).map_err(|_| serialization_error("utf8"))?;
    let json_line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| serialization_error("empty"))?;
    serde_json::from_str(json_line).map_err(serialization_error)
}

fn command_spawn_error() -> MongoError {
    MongoError::new(
        MongoErrorKind::ConnectionFailed,
        "MongoDB client could not be started",
    )
}

fn command_io_error() -> MongoError {
    MongoError::new(
        MongoErrorKind::CommandError,
        "MongoDB client operation failed",
    )
}

fn script_preparation_error() -> MongoError {
    MongoError::new(
        MongoErrorKind::CommandError,
        "MongoDB client operation could not be prepared securely",
    )
}

fn executable_resolution_error() -> MongoError {
    MongoError::new(
        MongoErrorKind::ConnectionFailed,
        format!(
            "Trusted mongosh executable not found; set {MONGOSH_PATH_ENV} to an absolute path inside a protected MongoDB installation root"
        ),
    )
}

fn serialization_error(_error: impl std::fmt::Display) -> MongoError {
    MongoError::new(
        MongoErrorKind::SerializationError,
        "MongoDB client returned invalid structured output",
    )
}

fn js_string(value: &str) -> Result<String, MongoError> {
    validate_required_field("MongoDB command field", value, MAX_FIELD_BYTES)?;
    serde_json::to_string(value).map_err(serialization_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex as StdMutex;

    struct FakeRunner {
        calls: StdMutex<Vec<(String, String)>>,
        responses: StdMutex<VecDeque<Result<Value, MongoError>>>,
    }

    impl FakeRunner {
        fn new(responses: Vec<Result<Value, MongoError>>) -> Self {
            Self {
                calls: StdMutex::new(Vec::new()),
                responses: StdMutex::new(responses.into()),
            }
        }

        fn calls(&self) -> Vec<(String, String)> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl MongoRunner for FakeRunner {
        fn run_json<'a>(
            &'a self,
            connection_string: &'a str,
            script: &'a str,
        ) -> MongoRunnerFuture<'a> {
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push((connection_string.to_string(), script.to_string()));
                self.responses
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("fake response")
            })
        }
    }

    fn config_with_uri(uri: &str) -> MongoConnectionConfig {
        MongoConnectionConfig {
            label: Some("test".into()),
            hosts: vec!["ignored:27017".into()],
            database: Some("admin".into()),
            username: None,
            password: None,
            auth_database: None,
            auth_mechanism: None,
            replica_set: None,
            read_preference: None,
            direct_connection: None,
            app_name: None,
            connection_string: Some(uri.into()),
            connect_timeout_secs: None,
            server_selection_timeout_secs: None,
            ssh_tunnel: None,
            tls: None,
        }
    }

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
    fn test_command_spawn_error_is_opaque() {
        let error = command_spawn_error();
        assert_eq!(error.kind, MongoErrorKind::ConnectionFailed);
        assert!(!error.message.contains("PATH"));
    }

    #[test]
    fn test_serialization_error_kind() {
        let error = serialization_error("boom");
        assert_eq!(error.kind, MongoErrorKind::SerializationError);
        assert!(!error.message.contains("boom"));
    }

    #[test]
    fn invocation_contains_neither_uri_nor_javascript() {
        let invocation = build_invocation(
            Path::new("/trusted/mongosh"),
            Path::new("/private/random-script.js"),
        );
        let arguments = invocation
            .args
            .iter()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(
            arguments,
            "--quiet --norc --nodb --file /private/random-script.js"
        );
        assert!(!arguments.contains("mongodb://"));
        assert!(!arguments.contains("dropDatabase"));
        assert_eq!(invocation.program, Path::new("/trusted/mongosh"));
    }

    #[test]
    fn secure_script_is_raii_and_contains_no_connection_uri() {
        let file = create_secure_script("print(JSON.stringify({ ok: true }));").unwrap();
        let path = file.path().to_path_buf();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.contains("readFileSync(0"));
        assert!(contents.contains("print(JSON.stringify"));
        assert!(!contents.contains("mongodb://user:password"));
        drop(file);
        assert!(!path.exists());
    }

    #[test]
    fn bounded_output_parser_uses_only_the_final_structured_line() {
        let output = BoundedCapture {
            bytes: b"startup noise\n{\"ok\":true}\n".to_vec(),
            truncated: false,
        };
        assert_eq!(parse_json_output(&output).unwrap()["ok"], true);

        let truncated = BoundedCapture {
            bytes: b"{\"ok\":true}".to_vec(),
            truncated: true,
        };
        assert!(parse_json_output(&truncated).is_err());
    }

    #[tokio::test]
    async fn fake_runner_preserves_destructive_command_boundary() {
        let runner = Arc::new(FakeRunner::new(vec![
            Ok(serde_json::json!({ "ok": true, "version": "8.0" })),
            Ok(serde_json::json!({ "ok": true })),
        ]));
        let mut service = MongoService::with_runner(runner.clone());
        let secret_uri = "mongodb://admin:top-secret@db.example/admin?tls=true";
        let session_id = service.connect(config_with_uri(secret_uri)).await.unwrap();
        let database = "prod'); throw new Error('not code";
        service.drop_database(&session_id, database).await.unwrap();

        let calls = runner.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].0, secret_uri);
        assert!(calls[1].1.contains("dropDatabase"));
        assert!(calls[1]
            .1
            .contains(&serde_json::to_string(database).unwrap()));
    }

    #[test]
    fn raw_uri_parser_enforces_scheme_hosts_and_bounds_without_leaking_secrets() {
        assert!(parse_mongo_uri("https://db.example.com").is_err());
        assert!(parse_mongo_uri("mongodb://db1.example.com,db2.example.com/admin").is_ok());
        assert!(parse_mongo_uri("mongodb+srv://db1.example.com,db2.example.com/admin").is_err());
        assert!(parse_mongo_uri("mongodb://[::1]:27017/admin").is_ok());
        assert!(parse_mongo_uri(&format!(
            "mongodb://127.0.0.1/{}",
            "x".repeat(MAX_FIELD_BYTES + 1)
        ))
        .is_err());

        let secret = "do-not-reflect-this-secret";
        let error = match parse_mongo_uri(&format!("mongodb://admin:{secret}@/admin")) {
            Err(error) => error,
            Ok(_) => panic!("credential URI without a host must be rejected"),
        };
        assert!(!error.message.contains(secret));
    }

    #[test]
    fn transport_policy_allows_plaintext_only_for_safe_loopback_case() {
        let loopback = parse_mongo_uri("mongodb://127.0.0.1:27017/dev").unwrap();
        assert!(!loopback.has_credentials);
        assert!(loopback.all_hosts_are_literal_loopback);
        enforce_transport_policy(&loopback, None).unwrap();

        let remote_plaintext =
            parse_mongo_uri("mongodb://admin:secret@db.example.com/admin").unwrap();
        assert!(enforce_transport_policy(&remote_plaintext, None).is_err());

        let remote_verified =
            parse_mongo_uri("mongodb://admin:secret@db.example.com/admin?tls=true").unwrap();
        enforce_transport_policy(&remote_verified, None).unwrap();
    }

    #[test]
    fn invalid_certificate_mode_requires_exact_one_shot_acknowledgement() {
        let insecure = parse_mongo_uri(
            "mongodb://db.example.com/admin?tls=true&tlsAllowInvalidCertificates=true",
        )
        .unwrap();
        assert!(enforce_transport_policy(&insecure, None).is_err());
        assert!(enforce_transport_policy(&insecure, Some("yes")).is_err());
        enforce_transport_policy(&insecure, Some(INVALID_CERTIFICATE_ACKNOWLEDGEMENT)).unwrap();

        let credentialed = parse_mongo_uri(
            "mongodb://admin:secret@db.example.com/admin?tls=true&tlsAllowInvalidCertificates=true",
        )
        .unwrap();
        assert!(
            enforce_transport_policy(&credentialed, Some(INVALID_CERTIFICATE_ACKNOWLEDGEMENT))
                .is_err()
        );
    }

    #[test]
    fn structured_remote_connections_default_to_verified_tls() {
        let mut config = config_with_uri("mongodb://127.0.0.1/dev");
        config.connection_string = None;
        config.hosts = vec!["db.example.com:27017".into()];
        let hosts = validate_and_secure_config(&mut config, None).unwrap();
        assert_eq!(hosts, vec!["db.example.com:27017"]);
        assert!(config.tls.as_ref().is_some_and(|tls| tls.enabled));
        assert!(config.to_connection_string().contains("tls=true"));
    }

    #[test]
    fn field_and_script_limits_are_applied_before_runner_use() {
        let mut config = config_with_uri("mongodb://127.0.0.1/dev");
        config.label = Some("x".repeat(MAX_FIELD_BYTES + 1));
        assert!(validate_and_secure_config(&mut config, None).is_err());
        assert!(validate_runner_input(
            "mongodb://127.0.0.1/dev",
            &"x".repeat(MAX_SCRIPT_BYTES + 1)
        )
        .is_err());
        assert!(js_string(&"x".repeat(MAX_FIELD_BYTES + 1)).is_err());
    }

    #[tokio::test]
    async fn session_cap_is_enforced_before_an_additional_runner_call() {
        let responses = (0..MAX_SESSIONS)
            .map(|_| Ok(serde_json::json!({ "ok": true, "version": "8.0" })))
            .collect();
        let runner = Arc::new(FakeRunner::new(responses));
        let mut service = MongoService::with_runner(runner.clone());
        for _ in 0..MAX_SESSIONS {
            service
                .connect(config_with_uri("mongodb://127.0.0.1/dev"))
                .await
                .unwrap();
        }

        let error = service
            .connect(config_with_uri("mongodb://127.0.0.1/dev"))
            .await
            .unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::InvalidConfig);
        assert_eq!(runner.calls().len(), MAX_SESSIONS);
    }

    #[tokio::test]
    async fn disconnect_removes_retained_credential_uri() {
        let runner = Arc::new(FakeRunner::new(vec![Ok(serde_json::json!({
            "ok": true,
            "version": "8.0"
        }))]));
        let mut service = MongoService::with_runner(runner);
        let session_id = service
            .connect(config_with_uri("mongodb://admin:secret@127.0.0.1/admin"))
            .await
            .unwrap();
        service.disconnect(&session_id).await.unwrap();
        assert!(service.get_session(&session_id).is_err());
        assert!(service.connection_string(&session_id).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn executable_validation_allows_only_in_root_canonical_symlink_targets() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let trusted = tempfile::tempdir().unwrap();
        std::fs::set_permissions(trusted.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let executable = trusted.path().join("mongosh-real");
        std::fs::write(&executable, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let link = trusted.path().join("mongosh");
        symlink(&executable, &link).unwrap();
        let roots = vec![trusted.path().to_path_buf()];
        assert_eq!(
            validate_executable(&link, &roots),
            executable.canonicalize().ok()
        );

        let outside = tempfile::tempdir().unwrap();
        std::fs::set_permissions(outside.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let outside_executable = outside.path().join("mongosh-real");
        std::fs::write(&outside_executable, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&outside_executable, std::fs::Permissions::from_mode(0o755))
            .unwrap();
        let escaping_link = trusted.path().join("mongosh-outside");
        symlink(&outside_executable, &escaping_link).unwrap();
        assert!(validate_executable(&escaping_link, &roots).is_none());

        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(validate_executable(&link, &roots).is_none());
    }

    #[test]
    fn windows_candidate_builder_uses_only_supplied_trusted_roots() {
        let trusted = tempfile::tempdir().unwrap();
        let versioned = trusted.path().join("MongoDB/Server/8.0/bin");
        std::fs::create_dir_all(&versioned).unwrap();
        let candidates = windows_mongosh_candidates(vec![trusted.path().to_path_buf()]);

        assert!(!candidates.is_empty());
        assert!(candidates
            .iter()
            .all(|(candidate, root)| candidate.starts_with(root) && root == trusted.path()));
        assert!(candidates
            .iter()
            .any(|(candidate, _)| candidate
                .ends_with(Path::new("MongoDB/Server/8.0/bin/mongosh.exe"))));
    }
}
