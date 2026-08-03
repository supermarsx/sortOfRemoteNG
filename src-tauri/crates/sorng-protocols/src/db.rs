use serde::{Deserialize, Serialize};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use sqlx::{Column, Row};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use url::Url;
use zeroize::{Zeroize, Zeroizing};

const DB_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const DB_QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const DB_IMPORT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_DB_QUERY_BYTES: usize = 1024 * 1024;
const MAX_SQL_IMPORT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SQL_IMPORT_STATEMENT_BYTES: usize = 256 * 1024;
const MAX_SQL_IMPORT_STATEMENTS: usize = 512;

#[cfg(test)]
mod rest_session_safety_tests {
    use super::*;

    #[tokio::test]
    async fn unknown_database_session_fails_closed() {
        let state = DbService::new();
        let mut service = state.lock().await;
        assert!(service
            .execute_query_for("missing", "SELECT 1".to_string())
            .await
            .is_err());
        assert!(service.disconnect_db_session("missing").await.is_err());
    }

    #[test]
    fn oversized_database_results_are_rejected() {
        let oversized_value = "x".repeat(MAX_DB_VALUE_BYTES + 1);
        let result = QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![oversized_value]],
            row_count: 1,
        };
        assert!(DbService::validate_query_result_for_test(&result).is_err());
    }

    #[test]
    fn configured_unowned_transports_fail_closed() {
        let proxy = ProxyConfig {
            proxy_type: "socks5".to_string(),
            host: "proxy.example.test".to_string(),
            port: 1080,
            username: None,
            password: None,
        };
        assert_eq!(
            validate_transport_options(Some(&proxy), None, None).unwrap_err(),
            "Proxy database routing is unavailable; configure a supported transport or disable the proxy"
        );

        let openvpn = OpenVPNConfig {
            enabled: true,
            config_id: Some("vpn-1".to_string()),
            chain_position: None,
        };
        assert_eq!(
            validate_transport_options(None, Some(&openvpn), None).unwrap_err(),
            "OpenVPN database routing is unavailable; connect the VPN outside the app or disable this option"
        );

        let ssh = SshTunnelConfig {
            enabled: true,
            ssh_host: "ssh.example.test".to_string(),
            ssh_port: 22,
            ssh_username: "operator".to_string(),
            ssh_password: Some("secret".to_string()),
            ssh_private_key: None,
            ssh_passphrase: None,
        };
        assert_eq!(
            validate_transport_options(None, None, Some(&ssh)).unwrap_err(),
            "SSH database tunneling is unavailable; use a verified local tunnel and connect to its loopback endpoint, or disable SSH tunneling"
        );

        let disabled_openvpn = OpenVPNConfig {
            enabled: false,
            config_id: None,
            chain_position: None,
        };
        let disabled_ssh = SshTunnelConfig {
            enabled: false,
            ssh_host: String::new(),
            ssh_port: 0,
            ssh_username: String::new(),
            ssh_password: None,
            ssh_private_key: None,
            ssh_passphrase: None,
        };
        assert!(
            validate_transport_options(None, Some(&disabled_openvpn), Some(&disabled_ssh)).is_ok()
        );
    }

    fn decode_rfc3986_component(value: &str) -> String {
        let bytes = value.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' {
                let high = (bytes[index + 1] as char)
                    .to_digit(16)
                    .expect("valid high hex digit");
                let low = (bytes[index + 2] as char)
                    .to_digit(16)
                    .expect("valid low hex digit");
                decoded.push(((high << 4) | low) as u8);
                index += 3;
            } else {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
        String::from_utf8(decoded).expect("encoded UTF-8 component")
    }

    #[test]
    fn mysql_url_round_trips_reserved_and_unicode_components() {
        let username = "user:%@/雪";
        let password = "%@:/é";
        let database = "sales/%/雪";
        let url = build_mysql_url(
            "db.example.test",
            3306,
            username,
            password,
            database,
            MySqlTlsPolicy::VerifyIdentity,
        )
        .unwrap();

        assert_eq!(
            url.as_str(),
            "mysql://user%3A%25%40%2F%E9%9B%AA:%25%40%3A%2F%C3%A9@db.example.test:3306/sales%2F%25%2F%E9%9B%AA?ssl-mode=VERIFY_IDENTITY"
        );
        let parsed = Url::parse(url.as_str()).unwrap();
        assert_eq!(decode_rfc3986_component(parsed.username()), username);
        assert_eq!(
            decode_rfc3986_component(parsed.password().unwrap()),
            password
        );
        assert_eq!(
            decode_rfc3986_component(parsed.path_segments().unwrap().next().unwrap()),
            database
        );
    }

    #[test]
    fn mysql_url_validation_requires_a_host_port_and_database() {
        assert!(build_mysql_url(
            "",
            3306,
            "user",
            "password",
            "database",
            MySqlTlsPolicy::VerifyIdentity
        )
        .is_err());
        assert!(build_mysql_url(
            "localhost",
            0,
            "user",
            "password",
            "database",
            MySqlTlsPolicy::VerifyIdentity
        )
        .is_err());
        assert!(build_mysql_url(
            "localhost",
            3306,
            "user",
            "password",
            "",
            MySqlTlsPolicy::VerifyIdentity
        )
        .is_err());
    }

    #[test]
    fn mysql_tls_policy_is_verified_by_default_and_bypass_is_one_shot() {
        assert_eq!(
            resolve_mysql_tls_policy(None).unwrap(),
            MySqlTlsPolicy::VerifyIdentity
        );
        assert!(resolve_mysql_tls_policy(Some(MySqlTlsConfig {
            allow_invalid_certificates: true,
            acknowledge_invalid_cert_risk: false,
        }))
        .is_err());

        let bypass = MySqlTlsConfig {
            allow_invalid_certificates: true,
            acknowledge_invalid_cert_risk: true,
        };
        assert_eq!(
            resolve_mysql_tls_policy(Some(bypass.clone())).unwrap(),
            MySqlTlsPolicy::EncryptWithoutVerification
        );

        let persisted = serde_json::to_value(bypass).unwrap();
        assert_eq!(persisted["allow_invalid_certificates"], true);
        assert!(persisted.get("acknowledge_invalid_cert_risk").is_none());
        let restored: MySqlTlsConfig = serde_json::from_value(persisted).unwrap();
        assert!(resolve_mysql_tls_policy(Some(restored)).is_err());
    }

    #[tokio::test]
    async fn database_deadlines_are_finite_and_errors_are_opaque() {
        let error = run_database_deadline(Duration::from_millis(1), "query", async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok::<(), String>(())
        })
        .await
        .unwrap_err();
        assert_eq!(error, "Database query timed out");
        assert!(!error.contains("SELECT secret"));
    }

    #[test]
    fn sql_import_limits_and_partial_failures_are_explicit_and_redacted() {
        assert!(prepare_sql_import(&"x".repeat(MAX_SQL_IMPORT_BYTES + 1)).is_err());
        assert!(prepare_sql_import(&format!(
            "SELECT '{}';",
            "x".repeat(MAX_SQL_IMPORT_STATEMENT_BYTES)
        ))
        .is_err());

        let statements = prepare_sql_import("SELECT ';'; -- ignored\nSELECT 2;").unwrap();
        assert_eq!(statements, vec!["SELECT ';'", "SELECT 2"]);

        let mut affected = 0;
        record_import_statement_result(&mut affected, 0, Ok(3)).unwrap();
        let error = record_import_statement_result(&mut affected, 1, Err(())).unwrap_err();
        assert_eq!(affected, 3);
        assert_eq!(error, "Database import failed at statement 2");
        assert!(!error.contains("password"));
    }

    #[test]
    fn row_decode_errors_are_classified_without_value_substitution() {
        assert_eq!(
            row_decode_error_message(RowDecodeFailureKind::TypeMismatch, 3),
            "Database result type mismatch at column 3"
        );
        assert_eq!(
            row_decode_error_message(RowDecodeFailureKind::MissingColumn, 2),
            "Database result column 2 is unavailable"
        );
        assert_ne!(
            row_decode_error_message(RowDecodeFailureKind::Decode, 0),
            "NULL"
        );
    }

    fn lazy_pool() -> MySqlPool {
        MySqlPoolOptions::new()
            .connect_lazy("mysql://localhost/test")
            .expect("static lazy test pool URL")
    }

    #[tokio::test]
    async fn disconnecting_active_legacy_session_never_retargets() {
        let state = DbService::new();
        let mut service = state.lock().await;
        let active_pool = lazy_pool();
        service.pool = Some(active_pool.clone());
        service
            .sessions
            .insert("active".to_string(), DbSession::local(active_pool));
        service
            .sessions
            .insert("explicit-only".to_string(), DbSession::local(lazy_pool()));
        service.active_connection_id = Some("active".to_string());

        service.disconnect_db_session("active").await.unwrap();

        assert!(service.active_connection_id.is_none());
        assert!(service.pool.is_none());
        assert!(service.sessions.contains_key("explicit-only"));
        assert_eq!(
            service
                .execute_query("SELECT 1".to_string())
                .await
                .unwrap_err(),
            "No database connection"
        );
    }

    #[tokio::test]
    async fn disconnecting_non_active_session_preserves_legacy_target() {
        let state = DbService::new();
        let mut service = state.lock().await;
        let active_pool = lazy_pool();
        service.pool = Some(active_pool.clone());
        service
            .sessions
            .insert("active".to_string(), DbSession::local(active_pool));
        service
            .sessions
            .insert("other".to_string(), DbSession::local(lazy_pool()));
        service.active_connection_id = Some("active".to_string());

        service.disconnect_db_session("other").await.unwrap();

        assert_eq!(service.active_connection_id.as_deref(), Some("active"));
        assert!(service.pool.is_some());
    }

    #[tokio::test]
    async fn detached_active_session_does_not_retain_the_state_lock() {
        let state = DbService::new();
        {
            let mut service = state.lock().await;
            let pool = lazy_pool();
            service.pool = Some(pool.clone());
            service
                .sessions
                .insert("active".to_string(), DbSession::local(pool));
            service.active_connection_id = Some("active".to_string());
        }

        let detached = DbService::detached_active_from_state(&state).await.unwrap();
        assert_eq!(detached.active_connection_id.as_deref(), Some("active"));
        assert!(state.try_lock().is_ok());
    }

    #[tokio::test]
    async fn rest_sessions_are_owner_bound_and_never_replace_local_active_state() {
        let state = DbService::new();
        let mut service = state.lock().await;
        let local_id = service.register_local_pool(lazy_pool()).unwrap();
        let rest_id = service
            .register_rest_pool(lazy_pool(), "user:alice".to_string())
            .unwrap();

        assert_eq!(
            service.active_connection_id.as_deref(),
            Some(local_id.as_str())
        );
        assert!(service.pool.is_some());
        assert!(service.rest_pool_for_owner(&rest_id, "user:alice").is_ok());
        assert!(service.rest_pool_for_owner(&rest_id, "user:bob").is_err());
        assert!(service
            .rest_pool_for_owner(&local_id, "user:alice")
            .is_err());
        assert!(service.local_pool(&rest_id).is_err());

        assert!(service
            .disconnect_db_session_for_rest_owner(&local_id, "user:alice")
            .await
            .is_err());
        assert!(service.disconnect_db_session(&rest_id).await.is_err());
        assert!(service.sessions.contains_key(&rest_id));
        assert!(service
            .disconnect_db_session_for_rest_owner(&rest_id, "user:bob")
            .await
            .is_err());
        assert!(service.sessions.contains_key(&rest_id));

        service.disconnect_db().await.unwrap();
        assert!(!service.sessions.contains_key(&local_id));
        assert!(service.sessions.contains_key(&rest_id));
        assert!(service.active_connection_id.is_none());

        service
            .disconnect_db_session_for_rest_owner(&rest_id, "user:alice")
            .await
            .unwrap();
        assert!(!service.sessions.contains_key(&rest_id));
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyConfig {
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenVPNConfig {
    pub enabled: bool,
    pub config_id: Option<String>,
    pub chain_position: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SshTunnelConfig {
    pub enabled: bool,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_username: String,
    pub ssh_password: Option<String>,
    pub ssh_private_key: Option<String>,
    pub ssh_passphrase: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MySqlTlsConfig {
    #[serde(default)]
    pub allow_invalid_certificates: bool,
    #[serde(default, skip_serializing)]
    pub acknowledge_invalid_cert_risk: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MySqlTlsPolicy {
    VerifyIdentity,
    EncryptWithoutVerification,
}

impl MySqlTlsPolicy {
    fn url_value(self) -> &'static str {
        match self {
            Self::VerifyIdentity => "VERIFY_IDENTITY",
            Self::EncryptWithoutVerification => "REQUIRED",
        }
    }
}

fn resolve_mysql_tls_policy(mut config: Option<MySqlTlsConfig>) -> Result<MySqlTlsPolicy, String> {
    let Some(config) = config.as_mut() else {
        return Ok(MySqlTlsPolicy::VerifyIdentity);
    };
    let acknowledged = std::mem::take(&mut config.acknowledge_invalid_cert_risk);
    if config.allow_invalid_certificates != acknowledged {
        return Err(
            "Invalid-certificate MySQL TLS requires an explicit one-shot risk acknowledgement"
                .to_string(),
        );
    }
    if config.allow_invalid_certificates {
        Ok(MySqlTlsPolicy::EncryptWithoutVerification)
    } else {
        Ok(MySqlTlsPolicy::VerifyIdentity)
    }
}

fn validate_transport_options(
    proxy: Option<&ProxyConfig>,
    openvpn: Option<&OpenVPNConfig>,
    ssh_tunnel: Option<&SshTunnelConfig>,
) -> Result<(), String> {
    if openvpn.is_some_and(|config| config.enabled) {
        return Err(
            "OpenVPN database routing is unavailable; connect the VPN outside the app or disable this option"
                .to_string(),
        );
    }
    if proxy.is_some() {
        return Err(
            "Proxy database routing is unavailable; configure a supported transport or disable the proxy"
                .to_string(),
        );
    }
    if ssh_tunnel.is_some_and(|config| config.enabled) {
        return Err(
            "SSH database tunneling is unavailable; use a verified local tunnel and connect to its loopback endpoint, or disable SSH tunneling"
                .to_string(),
        );
    }
    Ok(())
}

fn scrub_transport_credentials(
    proxy: &mut Option<ProxyConfig>,
    ssh_tunnel: &mut Option<SshTunnelConfig>,
) {
    if let Some(password) = proxy.as_mut().and_then(|config| config.password.as_mut()) {
        password.zeroize();
    }
    if let Some(config) = ssh_tunnel.as_mut() {
        if let Some(password) = config.ssh_password.as_mut() {
            password.zeroize();
        }
        if let Some(private_key) = config.ssh_private_key.as_mut() {
            private_key.zeroize();
        }
        if let Some(passphrase) = config.ssh_passphrase.as_mut() {
            passphrase.zeroize();
        }
    }
}

fn validate_mysql_endpoint(host: &str, port: u16, database: &str) -> Result<(), String> {
    if host.is_empty()
        || host != host.trim()
        || host.chars().any(char::is_control)
        || host.chars().count() > 253
    {
        return Err("Invalid database host".to_string());
    }
    if port == 0 {
        return Err("Invalid database port".to_string());
    }
    if database.is_empty()
        || database.chars().any(char::is_control)
        || database.chars().count() > 64
    {
        return Err("Invalid database name".to_string());
    }
    Ok(())
}

fn build_mysql_url(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: &str,
    tls_policy: MySqlTlsPolicy,
) -> Result<Zeroizing<String>, String> {
    validate_mysql_endpoint(host, port, database)?;

    // Keep credentials out of `Url`'s ordinary String allocation. The builder
    // validates and normalizes only the non-secret authority; each remaining
    // component is encoded byte-for-byte with the RFC 3986 unreserved set.
    let mut endpoint = Url::parse("mysql://localhost/")
        .map_err(|_| "Database connection configuration is invalid".to_string())?;
    endpoint
        .set_host(Some(host))
        .map_err(|_| "Invalid database host".to_string())?;
    endpoint
        .set_port(Some(port))
        .map_err(|_| "Invalid database port".to_string())?;
    let endpoint = endpoint.to_string();
    let authority = endpoint
        .strip_prefix("mysql://")
        .and_then(|value| value.strip_suffix('/'))
        .ok_or_else(|| "Database connection configuration is invalid".to_string())?;
    let encoded_username = Zeroizing::new(percent_encode_rfc3986_component(username));
    let encoded_password = Zeroizing::new(percent_encode_rfc3986_component(password));
    let encoded_database = percent_encode_rfc3986_component(database);

    Ok(Zeroizing::new(format!(
        "mysql://{}:{}@{}/{}?ssl-mode={}",
        encoded_username.as_str(),
        encoded_password.as_str(),
        authority,
        encoded_database,
        tls_policy.url_value()
    )))
}

fn percent_encode_rfc3986_component(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if matches!(
            byte,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~'
        ) {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

async fn run_database_deadline<T, F>(
    deadline: Duration,
    operation: &'static str,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::time::timeout(deadline, future)
        .await
        .unwrap_or_else(|_| Err(format!("Database {operation} timed out")))
}

fn prepare_sql_import(sql_content: &str) -> Result<Vec<String>, String> {
    if sql_content.len() > MAX_SQL_IMPORT_BYTES {
        return Err(format!(
            "SQL import exceeds the {MAX_SQL_IMPORT_BYTES}-byte limit"
        ));
    }

    let mut statements = Vec::new();
    let mut statement = String::new();
    let mut chars = sql_content.chars().peekable();
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;

    while let Some(character) = chars.next() {
        if line_comment {
            if character == '\n' {
                line_comment = false;
                statement.push('\n');
            }
            continue;
        }
        if block_comment {
            if character == '*' && chars.peek() == Some(&'/') {
                chars.next();
                block_comment = false;
                statement.push(' ');
            }
            continue;
        }
        if let Some(delimiter) = quote {
            statement.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                if chars.peek() == Some(&delimiter) {
                    statement.push(chars.next().expect("peeked quote delimiter"));
                } else {
                    quote = None;
                }
            }
            continue;
        }

        match character {
            '\'' | '"' | '`' => {
                quote = Some(character);
                statement.push(character);
            }
            '#' => line_comment = true,
            '-' if chars.peek() == Some(&'-') => {
                let mut lookahead = chars.clone();
                lookahead.next();
                if lookahead.next().is_none_or(char::is_whitespace) {
                    chars.next();
                    line_comment = true;
                } else {
                    statement.push(character);
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                block_comment = true;
            }
            ';' => push_import_statement(&mut statements, &mut statement)?,
            _ => statement.push(character),
        }
    }

    if quote.is_some() || block_comment {
        return Err("SQL import contains an unterminated quote or comment".to_string());
    }
    push_import_statement(&mut statements, &mut statement)?;
    if statements.is_empty() {
        return Err("SQL import contains no executable statements".to_string());
    }
    Ok(statements)
}

fn push_import_statement(
    statements: &mut Vec<String>,
    statement: &mut String,
) -> Result<(), String> {
    let trimmed = statement.trim();
    if !trimmed.is_empty() {
        if trimmed.len() > MAX_SQL_IMPORT_STATEMENT_BYTES {
            return Err(format!(
                "SQL import statement exceeds the {MAX_SQL_IMPORT_STATEMENT_BYTES}-byte limit"
            ));
        }
        if statements.len() >= MAX_SQL_IMPORT_STATEMENTS {
            return Err(format!(
                "SQL import exceeds the {MAX_SQL_IMPORT_STATEMENTS}-statement limit"
            ));
        }
        statements.push(trimmed.to_string());
    }
    statement.clear();
    Ok(())
}

fn record_import_statement_result(
    total_affected: &mut u64,
    statement_index: usize,
    result: Result<u64, ()>,
) -> Result<(), String> {
    let affected = result.map_err(|_| {
        format!(
            "Database import failed at statement {}",
            statement_index + 1
        )
    })?;
    *total_affected = total_affected
        .checked_add(affected)
        .ok_or_else(|| "Database import affected-row count overflow".to_string())?;
    Ok(())
}

#[derive(Clone, Copy)]
enum RowDecodeFailureKind {
    MissingColumn,
    TypeMismatch,
    Decode,
}

fn classify_row_decode_error(error: &sqlx::Error) -> RowDecodeFailureKind {
    match error {
        sqlx::Error::ColumnNotFound(_) | sqlx::Error::ColumnIndexOutOfBounds { .. } => {
            RowDecodeFailureKind::MissingColumn
        }
        sqlx::Error::ColumnDecode { .. } => RowDecodeFailureKind::TypeMismatch,
        _ => RowDecodeFailureKind::Decode,
    }
}

fn row_decode_error_message(kind: RowDecodeFailureKind, column_index: usize) -> String {
    match kind {
        RowDecodeFailureKind::MissingColumn => {
            format!("Database result column {column_index} is unavailable")
        }
        RowDecodeFailureKind::TypeMismatch => {
            format!("Database result type mismatch at column {column_index}")
        }
        RowDecodeFailureKind::Decode => {
            format!("Database result decode failed at column {column_index}")
        }
    }
}

pub type DbServiceState = Arc<Mutex<DbService>>;

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
}

const MAX_DB_SESSIONS: usize = 16;
const MAX_DB_RESULT_ROWS: usize = 5_000;
const MAX_DB_RESULT_CELLS: usize = 100_000;
const MAX_DB_VALUE_BYTES: usize = 64 * 1024;
const MAX_DB_SERIALIZED_RESULT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
enum DbSessionOwner {
    Local,
    Rest(String),
}

#[derive(Clone)]
struct DbSession {
    pool: MySqlPool,
    owner: DbSessionOwner,
}

impl DbSession {
    fn local(pool: MySqlPool) -> Self {
        Self {
            pool,
            owner: DbSessionOwner::Local,
        }
    }

    fn rest(pool: MySqlPool, owner: String) -> Self {
        Self {
            pool,
            owner: DbSessionOwner::Rest(owner),
        }
    }
}

pub struct DbService {
    // Compatibility alias for legacy Tauri commands that historically used a
    // single implicit connection. REST handlers never use this field: they are
    // strictly UUID-addressed through `sessions`.
    pool: Option<MySqlPool>,
    sessions: std::collections::HashMap<String, DbSession>,
    active_connection_id: Option<String>,
}

impl DbService {
    pub fn new() -> DbServiceState {
        Arc::new(Mutex::new(DbService {
            pool: None,
            sessions: std::collections::HashMap::new(),
            active_connection_id: None,
        }))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect_mysql(
        &mut self,
        host: String,
        port: u16,
        username: String,
        password: String,
        database: String,
        mut proxy: Option<ProxyConfig>,
        openvpn: Option<OpenVPNConfig>,
        mut ssh_tunnel: Option<SshTunnelConfig>,
    ) -> Result<String, String> {
        self.connect_mysql_with_tls(
            host,
            port,
            username,
            password,
            database,
            proxy.take(),
            openvpn,
            ssh_tunnel.take(),
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect_mysql_with_tls(
        &mut self,
        host: String,
        port: u16,
        username: String,
        password: String,
        database: String,
        proxy: Option<ProxyConfig>,
        openvpn: Option<OpenVPNConfig>,
        ssh_tunnel: Option<SshTunnelConfig>,
        tls: Option<MySqlTlsConfig>,
    ) -> Result<String, String> {
        self.ensure_session_capacity()?;
        let pool = Self::open_mysql_pool(
            host,
            port,
            username,
            Zeroizing::new(password),
            database,
            proxy,
            openvpn,
            ssh_tunnel,
            tls,
        )
        .await?;
        self.register_local_pool(pool)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect_mysql_on_state(
        state: &DbServiceState,
        host: String,
        port: u16,
        username: String,
        password: String,
        database: String,
        proxy: Option<ProxyConfig>,
        openvpn: Option<OpenVPNConfig>,
        ssh_tunnel: Option<SshTunnelConfig>,
        tls: Option<MySqlTlsConfig>,
    ) -> Result<String, String> {
        let password = Zeroizing::new(password);
        {
            let service = state.lock().await;
            service.ensure_session_capacity()?;
        }
        let pool = Self::open_mysql_pool(
            host, port, username, password, database, proxy, openvpn, ssh_tunnel, tls,
        )
        .await?;
        let mut service = state.lock().await;
        service.register_local_pool(pool)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect_mysql_for_rest_on_state(
        state: &DbServiceState,
        owner: String,
        host: String,
        port: u16,
        username: String,
        password: String,
        database: String,
        proxy: Option<ProxyConfig>,
        openvpn: Option<OpenVPNConfig>,
        ssh_tunnel: Option<SshTunnelConfig>,
        tls: Option<MySqlTlsConfig>,
    ) -> Result<String, String> {
        if owner.is_empty() {
            return Err("Database session owner is unavailable".to_string());
        }
        let password = Zeroizing::new(password);
        {
            let service = state.lock().await;
            service.ensure_session_capacity()?;
        }
        let pool = Self::open_mysql_pool(
            host, port, username, password, database, proxy, openvpn, ssh_tunnel, tls,
        )
        .await?;
        let mut service = state.lock().await;
        service.register_rest_pool(pool, owner)
    }

    #[allow(clippy::too_many_arguments)]
    async fn open_mysql_pool(
        host: String,
        port: u16,
        username: String,
        password: Zeroizing<String>,
        database: String,
        mut proxy: Option<ProxyConfig>,
        openvpn: Option<OpenVPNConfig>,
        mut ssh_tunnel: Option<SshTunnelConfig>,
        tls: Option<MySqlTlsConfig>,
    ) -> Result<MySqlPool, String> {
        let transport_validation =
            validate_transport_options(proxy.as_ref(), openvpn.as_ref(), ssh_tunnel.as_ref());
        scrub_transport_credentials(&mut proxy, &mut ssh_tunnel);
        transport_validation?;
        let tls_policy = resolve_mysql_tls_policy(tls)?;
        let url = build_mysql_url(
            &host,
            port,
            &username,
            password.as_str(),
            &database,
            tls_policy,
        )?;
        run_database_deadline(DB_CONNECT_TIMEOUT, "connection", async {
            MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(DB_CONNECT_TIMEOUT)
                .connect(url.as_str())
                .await
                .map_err(|_| {
                    "Database connection failed; verify the endpoint, TLS settings, and credentials"
                        .to_string()
                })
        })
        .await
    }

    fn ensure_session_capacity(&self) -> Result<(), String> {
        if self.sessions.len() >= MAX_DB_SESSIONS {
            return Err(format!(
                "Database session limit reached (maximum {MAX_DB_SESSIONS})"
            ));
        }
        Ok(())
    }

    fn register_local_pool(&mut self, pool: MySqlPool) -> Result<String, String> {
        self.ensure_session_capacity()?;
        let connection_id = uuid::Uuid::new_v4().to_string();
        self.pool = Some(pool.clone());
        self.active_connection_id = Some(connection_id.clone());
        self.sessions
            .insert(connection_id.clone(), DbSession::local(pool));
        Ok(connection_id)
    }

    fn register_rest_pool(&mut self, pool: MySqlPool, owner: String) -> Result<String, String> {
        self.ensure_session_capacity()?;
        if owner.is_empty() {
            return Err("Database session owner is unavailable".to_string());
        }
        let connection_id = uuid::Uuid::new_v4().to_string();
        self.sessions
            .insert(connection_id.clone(), DbSession::rest(pool, owner));
        Ok(connection_id)
    }

    fn local_pool(&self, connection_id: &str) -> Result<MySqlPool, String> {
        match self.sessions.get(connection_id) {
            Some(DbSession {
                pool,
                owner: DbSessionOwner::Local,
            }) => Ok(pool.clone()),
            _ => Err("Database session not found".to_string()),
        }
    }

    fn rest_pool_for_owner(&self, connection_id: &str, owner: &str) -> Result<MySqlPool, String> {
        match self.sessions.get(connection_id) {
            Some(DbSession {
                pool,
                owner: DbSessionOwner::Rest(session_owner),
            }) if session_owner == owner => Ok(pool.clone()),
            _ => Err("Database session not found".to_string()),
        }
    }

    pub fn detached_active(&self) -> Result<Self, String> {
        let connection_id = self
            .active_connection_id
            .as_ref()
            .ok_or_else(|| "No database connection".to_string())?;
        let pool = self.local_pool(connection_id)?;
        let mut sessions = std::collections::HashMap::new();
        sessions.insert(connection_id.clone(), DbSession::local(pool.clone()));
        Ok(Self {
            pool: Some(pool),
            sessions,
            active_connection_id: Some(connection_id.clone()),
        })
    }

    pub async fn detached_active_from_state(state: &DbServiceState) -> Result<Self, String> {
        let service = state.lock().await;
        service.detached_active()
    }

    pub async fn execute_query_for_state(
        state: &DbServiceState,
        connection_id: &str,
        query: String,
    ) -> Result<QueryResult, String> {
        let pool = {
            let service = state.lock().await;
            service.local_pool(connection_id)?
        };
        Self::execute_query_on_pool(&pool, query).await
    }

    pub async fn execute_query_for_rest_owner_state(
        state: &DbServiceState,
        connection_id: &str,
        owner: &str,
        query: String,
    ) -> Result<QueryResult, String> {
        let pool = {
            let service = state.lock().await;
            service.rest_pool_for_owner(connection_id, owner)?
        };
        Self::execute_query_on_pool(&pool, query).await
    }

    /// Legacy Tauri compatibility wrapper: use the most recently connected
    /// session. New callers must use `execute_query_for` explicitly.
    pub async fn execute_query(&self, query: String) -> Result<QueryResult, String> {
        let connection_id = self
            .active_connection_id
            .as_deref()
            .ok_or_else(|| "No database connection".to_string())?;
        self.execute_query_for(connection_id, query).await
    }

    pub async fn execute_query_for(
        &self,
        connection_id: &str,
        query: String,
    ) -> Result<QueryResult, String> {
        let pool = self.local_pool(connection_id)?;
        Self::execute_query_on_pool(&pool, query).await
    }

    async fn execute_query_on_pool(pool: &MySqlPool, query: String) -> Result<QueryResult, String> {
        if query.len() > MAX_DB_QUERY_BYTES {
            return Err(format!(
                "Database query exceeds the {MAX_DB_QUERY_BYTES}-byte limit"
            ));
        }
        run_database_deadline(DB_QUERY_TIMEOUT, "query", async {
            Self::execute_query_on_pool_inner(pool, query).await
        })
        .await
    }

    async fn execute_query_on_pool_inner(
        pool: &MySqlPool,
        query: String,
    ) -> Result<QueryResult, String> {
        use futures_util::TryStreamExt as _;

        let mut stream = sqlx::query(&query).fetch(pool);
        let mut columns: Option<Vec<String>> = None;
        let mut result_rows = Vec::new();
        let mut cell_count = 0usize;
        let mut retained_value_bytes = 0usize;

        while let Some(row) = stream
            .try_next()
            .await
            .map_err(|_| "Database query failed".to_string())?
        {
            if result_rows.len() >= MAX_DB_RESULT_ROWS {
                return Err(format!(
                    "Database result exceeds the {MAX_DB_RESULT_ROWS}-row limit"
                ));
            }

            if columns.is_none() {
                let names: Vec<String> = row
                    .columns()
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect();
                if names.len() > MAX_DB_RESULT_CELLS.min(256) {
                    return Err("Database result has too many columns".to_string());
                }
                columns = Some(names);
            }

            let names = columns.as_ref().expect("columns initialized from row");
            cell_count = cell_count
                .checked_add(names.len())
                .ok_or_else(|| "Database result cell count overflow".to_string())?;
            if cell_count > MAX_DB_RESULT_CELLS {
                return Err(format!(
                    "Database result exceeds the {MAX_DB_RESULT_CELLS}-cell limit"
                ));
            }

            let mut row_data = Vec::with_capacity(names.len());
            for index in 0..names.len() {
                let value = row
                    .try_get::<Option<String>, _>(index)
                    .map_err(|error| {
                        row_decode_error_message(classify_row_decode_error(&error), index)
                    })?
                    .unwrap_or_else(|| "NULL".to_string());
                if value.len() > MAX_DB_VALUE_BYTES {
                    return Err(format!(
                        "Database value exceeds the {MAX_DB_VALUE_BYTES}-byte limit"
                    ));
                }
                retained_value_bytes = retained_value_bytes
                    .checked_add(value.len())
                    .ok_or_else(|| "Database result size overflow".to_string())?;
                if retained_value_bytes > MAX_DB_SERIALIZED_RESULT_BYTES {
                    return Err(format!(
                        "Database result exceeds the {MAX_DB_SERIALIZED_RESULT_BYTES}-byte limit"
                    ));
                }
                row_data.push(value);
            }
            result_rows.push(row_data);
        }

        let result = QueryResult {
            columns: columns.unwrap_or_default(),
            row_count: result_rows.len(),
            rows: result_rows,
        };
        let serialized_len = serde_json::to_vec(&result)
            .map_err(|_| "Database result could not be serialized".to_string())?
            .len();
        if serialized_len > MAX_DB_SERIALIZED_RESULT_BYTES {
            return Err(format!(
                "Database result exceeds the {MAX_DB_SERIALIZED_RESULT_BYTES}-byte serialized limit"
            ));
        }
        Ok(result)
    }

    pub async fn disconnect_db_session(&mut self, connection_id: &str) -> Result<(), String> {
        self.local_pool(connection_id)?;
        self.sessions
            .remove(connection_id)
            .ok_or_else(|| "Database session not found".to_string())?;

        if self.active_connection_id.as_deref() == Some(connection_id) {
            // UUID-addressed sessions remain available, but legacy callers must
            // explicitly reconnect instead of being silently retargeted.
            self.active_connection_id = None;
            self.pool = None;
        }
        Ok(())
    }

    pub async fn disconnect_db_session_for_rest_owner(
        &mut self,
        connection_id: &str,
        owner: &str,
    ) -> Result<(), String> {
        self.rest_pool_for_owner(connection_id, owner)?;
        self.sessions
            .remove(connection_id)
            .ok_or_else(|| "Database session not found".to_string())?;
        Ok(())
    }

    pub async fn disconnect_db(&mut self) -> Result<(), String> {
        self.pool = None;
        self.sessions
            .retain(|_, session| matches!(&session.owner, DbSessionOwner::Rest(_)));
        self.active_connection_id = None;
        Ok(())
    }

    #[cfg(test)]
    fn validate_query_result_for_test(result: &QueryResult) -> Result<(), String> {
        if result.rows.len() > MAX_DB_RESULT_ROWS {
            return Err("row limit".to_string());
        }
        let cells = result.rows.iter().try_fold(0usize, |total, row| {
            total
                .checked_add(row.len())
                .ok_or_else(|| "cell overflow".to_string())
        })?;
        if cells > MAX_DB_RESULT_CELLS
            || result
                .rows
                .iter()
                .flatten()
                .any(|value| value.len() > MAX_DB_VALUE_BYTES)
            || serde_json::to_vec(result)
                .map_err(|_| "serialization".to_string())?
                .len()
                > MAX_DB_SERIALIZED_RESULT_BYTES
        {
            return Err("result limit".to_string());
        }
        Ok(())
    }

    pub async fn import_sql(&self, sql_content: String) -> Result<u64, String> {
        if let Some(pool) = &self.pool {
            Self::import_sql_on_pool(pool, sql_content).await
        } else {
            Err("No database connection".to_string())
        }
    }

    async fn import_sql_on_pool(pool: &MySqlPool, sql_content: String) -> Result<u64, String> {
        let statements = prepare_sql_import(&sql_content)?;
        run_database_deadline(DB_IMPORT_TIMEOUT, "import", async {
            let mut transaction = pool
                .begin()
                .await
                .map_err(|_| "Database import could not start".to_string())?;
            let mut total_affected = 0u64;
            for (index, statement) in statements.into_iter().enumerate() {
                let execution = tokio::time::timeout(
                    DB_QUERY_TIMEOUT,
                    sqlx::query(&statement).execute(&mut *transaction),
                )
                .await;
                let affected = match execution {
                    Ok(Ok(result)) => Ok(result.rows_affected()),
                    Ok(Err(_)) | Err(_) => Err(()),
                };
                record_import_statement_result(&mut total_affected, index, affected)?;
            }
            transaction
                .commit()
                .await
                .map_err(|_| "Database import could not be committed".to_string())?;
            Ok(total_affected)
        })
        .await
    }

    pub async fn import_csv(
        &self,
        database: String,
        table: String,
        csv_content: String,
        has_header: bool,
    ) -> Result<u64, String> {
        if let Some(_pool) = &self.pool {
            let mut lines: Vec<&str> = csv_content.lines().collect();

            if lines.is_empty() {
                return Err("CSV content is empty".to_string());
            }

            // Parse header or use column indices
            let columns: Vec<String> = if has_header {
                let header = lines.remove(0);
                self.parse_csv_line(header)
            } else {
                // Get column names from table structure
                let structure = self
                    .get_table_structure(database.clone(), table.clone())
                    .await?;
                structure.rows.iter().map(|row| row[0].clone()).collect()
            };

            let mut total_inserted = 0u64;

            for line in lines {
                if line.trim().is_empty() {
                    continue;
                }

                let values = self.parse_csv_line(line);

                if values.len() != columns.len() {
                    log::warn!("CSV row column count mismatch, skipping: {}", line);
                    continue;
                }

                match self
                    .insert_row(database.clone(), table.clone(), columns.clone(), values)
                    .await
                {
                    Ok(_) => total_inserted += 1,
                    Err(e) => {
                        log::warn!("Failed to insert CSV row: {} - Error: {}", line, e);
                    }
                }
            }

            Ok(total_inserted)
        } else {
            Err("No database connection".to_string())
        }
    }

    fn parse_csv_line(&self, line: &str) -> Vec<String> {
        let mut result = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        let mut chars = line.chars().peekable();

        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    if in_quotes && chars.peek() == Some(&'"') {
                        // Escaped quote
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

    pub async fn get_databases(&self) -> Result<Vec<String>, String> {
        if let Some(pool) = &self.pool {
            let rows = sqlx::query("SHOW DATABASES")
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let databases = rows
                .iter()
                .map(|row| row.try_get::<String, _>(0).unwrap_or_default())
                .collect();

            Ok(databases)
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn get_tables(&self, database: String) -> Result<Vec<String>, String> {
        if let Some(pool) = &self.pool {
            let query = format!("SHOW TABLES FROM {}", database);
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let tables = rows
                .iter()
                .map(|row| row.try_get::<String, _>(0).unwrap_or_default())
                .collect();

            Ok(tables)
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn get_table_structure(
        &self,
        database: String,
        table: String,
    ) -> Result<QueryResult, String> {
        if let Some(_pool) = &self.pool {
            let query = format!("DESCRIBE `{}`.`{}`", database, table);
            self.execute_query(query).await
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn create_database(&self, database: String) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let query = format!("CREATE DATABASE `{}`", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn drop_database(&self, database: String) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let query = format!("DROP DATABASE `{}`", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn create_table(
        &self,
        database: String,
        table: String,
        columns: Vec<String>,
    ) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let columns_str = columns.join(", ");
            let query = format!("CREATE TABLE `{}`.`{}` ({})", database, table, columns_str);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn drop_table(&self, database: String, table: String) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let query = format!("DROP TABLE `{}`.`{}`", database, table);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn get_table_data(
        &self,
        database: String,
        table: String,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<QueryResult, String> {
        if let Some(_pool) = &self.pool {
            let limit_clause = if let Some(l) = limit {
                if let Some(o) = offset {
                    format!(" LIMIT {} OFFSET {}", l, o)
                } else {
                    format!(" LIMIT {}", l)
                }
            } else {
                "".to_string()
            };

            let query = format!("SELECT * FROM `{}`.`{}`{}", database, table, limit_clause);
            self.execute_query(query).await
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn insert_row(
        &self,
        database: String,
        table: String,
        columns: Vec<String>,
        values: Vec<String>,
    ) -> Result<u64, String> {
        if let Some(pool) = &self.pool {
            let columns_str = columns
                .iter()
                .map(|c| format!("`{}`", c))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders = vec!["?"; values.len()].join(", ");
            let query = format!(
                "INSERT INTO `{}`.`{}` ({}) VALUES ({})",
                database, table, columns_str, placeholders
            );

            let mut query_builder = sqlx::query(&query);
            for value in &values {
                query_builder = query_builder.bind(value);
            }

            let result = query_builder
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;

            Ok(result.last_insert_id())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn update_row(
        &self,
        database: String,
        table: String,
        columns: Vec<String>,
        values: Vec<String>,
        where_clause: String,
    ) -> Result<u64, String> {
        if let Some(pool) = &self.pool {
            let set_clause = columns
                .iter()
                .map(|col| format!("`{}` = ?", col))
                .collect::<Vec<_>>()
                .join(", ");

            let query = format!(
                "UPDATE `{}`.`{}` SET {} WHERE {}",
                database, table, set_clause, where_clause
            );

            let mut query_builder = sqlx::query(&query);
            for value in &values {
                query_builder = query_builder.bind(value);
            }

            let result = query_builder
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;

            Ok(result.rows_affected())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn delete_row(
        &self,
        database: String,
        table: String,
        where_clause: String,
    ) -> Result<u64, String> {
        if let Some(pool) = &self.pool {
            let query = format!(
                "DELETE FROM `{}`.`{}` WHERE {}",
                database, table, where_clause
            );

            let result = sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;

            Ok(result.rows_affected())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn export_table(
        &self,
        database: String,
        table: String,
        format: String,
    ) -> Result<String, String> {
        self.export_table_chunked(database, table, format, None, None)
            .await
    }

    pub async fn export_table_chunked(
        &self,
        database: String,
        table: String,
        format: String,
        chunk_size: Option<u32>,
        max_chunks: Option<u32>,
    ) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            let chunk_size = chunk_size.unwrap_or(1000); // Default chunk size
            let max_chunks = max_chunks.unwrap_or(100); // Default max chunks to prevent runaway exports

            match format.as_str() {
                "csv" => {
                    self.export_table_csv_chunked(database, table, chunk_size, max_chunks)
                        .await
                }
                "sql" => {
                    self.export_table_sql_chunked(database, table, chunk_size, max_chunks)
                        .await
                }
                _ => Err("Unsupported export format. Use 'csv' or 'sql'".to_string()),
            }
        } else {
            Err("No database connection".to_string())
        }
    }

    async fn export_table_csv_chunked(
        &self,
        database: String,
        table: String,
        chunk_size: u32,
        max_chunks: u32,
    ) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            // Get table structure first for headers
            let structure = self
                .get_table_structure(database.clone(), table.clone())
                .await?;
            let columns = structure.columns;

            let mut csv = String::new();
            // Add headers
            csv.push_str(&columns.join(","));
            csv.push('\n');

            // Export data in chunks
            let mut offset = 0u32;
            let mut chunks_processed = 0u32;

            loop {
                if chunks_processed >= max_chunks {
                    csv.push_str("-- Export truncated due to max_chunks limit\n");
                    break;
                }

                let data = self
                    .get_table_data(
                        database.clone(),
                        table.clone(),
                        Some(chunk_size),
                        Some(offset),
                    )
                    .await?;

                if data.rows.is_empty() {
                    break; // No more data
                }

                // Add data rows
                for row in &data.rows {
                    let csv_row = row
                        .iter()
                        .map(|cell| {
                            if cell.contains(',') || cell.contains('"') || cell.contains('\n') {
                                format!("\"{}\"", cell.replace("\"", "\"\""))
                            } else {
                                cell.clone()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(",");
                    csv.push_str(&csv_row);
                    csv.push('\n');
                }

                offset += chunk_size;
                chunks_processed += 1;

                // Break if we got less than chunk_size (last chunk)
                if data.rows.len() < chunk_size as usize {
                    break;
                }
            }

            Ok(csv)
        } else {
            Err("No database connection".to_string())
        }
    }

    async fn export_table_sql_chunked(
        &self,
        database: String,
        table: String,
        chunk_size: u32,
        max_chunks: u32,
    ) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            let mut sql = String::new();

            // Add header
            sql.push_str(&format!("-- Export of table `{}`.`{}`\n", database, table));
            sql.push_str(&format!(
                "-- Generated at {}\n",
                chrono::Utc::now().to_rfc3339()
            ));
            sql.push_str("-- Chunked export\n\n");

            // Get table structure and create CREATE TABLE statement
            let structure = self
                .get_table_structure(database.clone(), table.clone())
                .await?;
            sql.push_str(
                &self
                    .generate_create_table_sql(database.clone(), table.clone(), structure)
                    .await?,
            );
            sql.push('\n');

            // Export data in chunks
            let mut offset = 0u32;
            let mut chunks_processed = 0u32;
            let mut total_rows = 0usize;

            loop {
                if chunks_processed >= max_chunks {
                    sql.push_str(&format!(
                        "-- Export truncated due to max_chunks limit ({} rows exported)\n",
                        total_rows
                    ));
                    break;
                }

                let data = self
                    .get_table_data(
                        database.clone(),
                        table.clone(),
                        Some(chunk_size),
                        Some(offset),
                    )
                    .await?;

                if data.rows.is_empty() {
                    break; // No more data
                }

                // Add INSERT statements for this chunk
                for row in &data.rows {
                    let columns_str = data
                        .columns
                        .iter()
                        .map(|c| format!("`{}`", c))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let values_str = row
                        .iter()
                        .map(|v| self.escape_sql_value(v))
                        .collect::<Vec<_>>()
                        .join(", ");
                    sql.push_str(&format!(
                        "INSERT INTO `{}` ({}) VALUES ({});\n",
                        table, columns_str, values_str
                    ));
                    total_rows += 1;
                }

                offset += chunk_size;
                chunks_processed += 1;

                // Break if we got less than chunk_size (last chunk)
                if data.rows.len() < chunk_size as usize {
                    break;
                }
            }

            sql.push_str(&format!(
                "\n-- Export completed: {} rows exported in {} chunks\n",
                total_rows, chunks_processed
            ));
            Ok(sql)
        } else {
            Err("No database connection".to_string())
        }
    }

    async fn generate_create_table_sql(
        &self,
        _database: String,
        table: String,
        structure: QueryResult,
    ) -> Result<String, String> {
        let mut sql = format!("CREATE TABLE `{}` (\n", table);

        let mut column_defs = Vec::new();
        for row in structure.rows {
            let field = &row[0];
            let r#type = &row[1];
            let null = &row[2];
            let key = &row[3];
            let default = &row[4];
            let extra = &row[5];

            let mut col_def = format!("  `{}` {}", field, r#type);

            if null == "NO" {
                col_def.push_str(" NOT NULL");
            }

            if !default.is_empty() && default != "NULL" {
                col_def.push_str(&format!(" DEFAULT {}", self.escape_sql_value(default)));
            }

            if !extra.is_empty() {
                col_def.push_str(&format!(" {}", extra));
            }

            if key == "PRI" {
                col_def.push_str(" PRIMARY KEY");
            }

            column_defs.push(col_def);
        }

        sql.push_str(&column_defs.join(",\n"));
        sql.push_str("\n);");

        Ok(sql)
    }

    fn escape_sql_value(&self, value: &str) -> String {
        if value == "NULL" {
            "NULL".to_string()
        } else {
            format!("'{}'", value.replace("'", "''").replace("\\", "\\\\"))
        }
    }

    pub async fn export_database(
        &self,
        database: String,
        format: String,
        include_data: bool,
    ) -> Result<String, String> {
        self.export_database_chunked(database, format, include_data, None, None)
            .await
    }

    pub async fn export_database_chunked(
        &self,
        database: String,
        _format: String,
        include_data: bool,
        chunk_size: Option<u32>,
        max_chunks: Option<u32>,
    ) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            let mut output = String::new();

            // Add header
            output.push_str(&format!("-- Export of database `{}`\n", database));
            output.push_str(&format!(
                "-- Generated at {}\n",
                chrono::Utc::now().to_rfc3339()
            ));
            output.push_str("-- Complete database export\n\n");

            // Create database
            output.push_str(&format!("CREATE DATABASE IF NOT EXISTS `{}`;\n", database));
            output.push_str(&format!("USE `{}`;\n\n", database));

            // Get all tables
            let tables = self.get_tables(database.clone()).await?;

            for table in &tables {
                // Export table structure
                let structure = self
                    .get_table_structure(database.clone(), table.clone())
                    .await?;
                output.push_str(
                    &self
                        .generate_create_table_sql(database.clone(), table.clone(), structure)
                        .await?,
                );
                output.push_str(";\n\n");

                // Export table data if requested
                if include_data {
                    let table_sql = if let Some(chunk_size) = chunk_size {
                        if let Some(max_chunks) = max_chunks {
                            self.export_table_sql_chunked(
                                database.clone(),
                                table.clone(),
                                chunk_size,
                                max_chunks,
                            )
                            .await?
                        } else {
                            self.export_table_sql_chunked(
                                database.clone(),
                                table.clone(),
                                chunk_size,
                                100,
                            )
                            .await?
                        }
                    } else {
                        self.export_table_sql_chunked(database.clone(), table.clone(), 1000, 100)
                            .await?
                    };

                    // Extract just the INSERT statements (skip the header)
                    let insert_statements: String = table_sql
                        .lines()
                        .filter(|line| line.starts_with("INSERT"))
                        .collect::<Vec<_>>()
                        .join("\n");

                    if !insert_statements.is_empty() {
                        output.push_str(&insert_statements);
                        output.push_str("\n\n");
                    }
                }
            }

            output.push_str(&format!(
                "-- Database export completed: {} tables exported\n",
                tables.len()
            ));
            Ok(output)
        } else {
            Err("No database connection".to_string())
        }
    }
}
