use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{
    auth::AuthService,
    ssh::{SshService, SshConnectionConfig},
    db::DbService,
    ftp::FtpService,
    network::NetworkService,
    security::SecurityService,
    wol::WolService,
    qr::QrService,
    rustdesk::RustDeskService,
};

#[derive(Clone)]
pub struct ApiService {
    pub auth_service: Arc<Mutex<AuthService>>,
    pub ssh_service: Arc<Mutex<SshService>>,
    pub db_service: Arc<Mutex<DbService>>,
    pub ftp_service: Arc<Mutex<FtpService>>,
    pub network_service: Arc<Mutex<NetworkService>>,
    pub security_service: Arc<Mutex<SecurityService>>,
    pub wol_service: Arc<Mutex<WolService>>,
    pub qr_service: Arc<Mutex<QrService>>,
    pub rustdesk_service: Arc<Mutex<RustDeskService>>,
}

impl ApiService {
    pub fn new(
        auth_service: Arc<Mutex<AuthService>>,
        ssh_service: Arc<Mutex<SshService>>,
        db_service: Arc<Mutex<DbService>>,
        ftp_service: Arc<Mutex<FtpService>>,
        network_service: Arc<Mutex<NetworkService>>,
        security_service: Arc<Mutex<SecurityService>>,
        wol_service: Arc<Mutex<WolService>>,
        qr_service: Arc<Mutex<QrService>>,
        rustdesk_service: Arc<Mutex<RustDeskService>>,
    ) -> Self {
        Self {
            auth_service,
            ssh_service,
            db_service,
            ftp_service,
            network_service,
            security_service,
            wol_service,
            qr_service,
            rustdesk_service,
        }
    }

    pub async fn start_server(self: Arc<Self>, port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let app = self.create_router();

        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        println!("Starting REST API server on http://{}", addr);

        let listener = tokio::net::TcpListener::bind(addr).await?;
        println!("REST API server listening on {}", addr);
        axum::serve(listener, app).await?;

        Ok(())
    }

    pub fn create_router(self: Arc<Self>) -> Router {
        Router::new()
            .route("/health", get(health_check))
            // Authentication
            .route("/auth/login", post(login))
            .route("/auth/users", get(list_users))
            // SSH
            .route("/ssh/connect", post(connect_ssh))
            .route("/ssh/execute", post(execute_command))
            .route("/ssh/sessions", get(list_ssh_sessions))
            // Database
            .route("/db/connect", post(connect_mysql))
            .route("/db/query", post(execute_query))
            // FTP
            .route("/ftp/connect", post(connect_ftp))
            .route("/ftp/files/:session_id", get(list_ftp_files))
            // Network
            .route("/network/ping", post(ping_host))
            .route("/network/scan", post(scan_network))
            .route("/network/scan/comprehensive", post(scan_network_comprehensive))
            // Security
            .route("/security/totp/generate", get(generate_totp_secret))
            .route("/security/totp/verify", post(verify_totp))
            // WOL
            .route("/wol/wake", post(wake_on_lan))
            // QR Code
            .route("/qr/generate", post(generate_qr_code))
            .route("/qr/generate/png", post(generate_qr_code_png))
            // RustDesk
            .route("/rustdesk/connect", post(connect_rustdesk_api))
            .route("/rustdesk/disconnect/:session_id", post(disconnect_rustdesk_api))
            .route("/rustdesk/sessions", get(list_rustdesk_sessions_api))
            .route("/rustdesk/session/:session_id", get(get_rustdesk_session_api))
            .route("/rustdesk/settings/:session_id", post(update_rustdesk_settings_api))
            .route("/rustdesk/input/:session_id", post(send_rustdesk_input_api))
            .route("/rustdesk/screenshot/:session_id", get(get_rustdesk_screenshot_api))
            .route("/rustdesk/status", get(rustdesk_status_api))
            .with_state(self)
    }
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "sortOfRemoteNG API",
        "version": "1.0.0"
    }))
}

// Authentication handlers
#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let auth = services.auth_service.lock().await;
    match auth.verify_user(&req.username, &req.password).await {
        Ok(true) => Ok(Json(serde_json::json!({
            "success": true,
            "message": "Login successful"
        }))),
        Ok(false) => Err(StatusCode::UNAUTHORIZED),
        Err(e) => {
            eprintln!("Login error: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_users(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let auth = services.auth_service.lock().await;
    let users = auth.list_users().await;
    Ok(Json(serde_json::json!({
        "users": users
    })))
}

// SSH handlers
#[derive(Deserialize)]
struct SshConnectRequest {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    key_path: Option<String>,
}

async fn connect_ssh(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<SshConnectRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let config = SshConnectionConfig {
        host: req.host,
        port: req.port,
        username: req.username,
        password: req.password,
        private_key_path: req.key_path,
        private_key_passphrase: None,
        jump_hosts: Vec::new(),
        proxy_config: None,
        openvpn_config: None,
        connect_timeout: None,
        keep_alive_interval: None,
        strict_host_key_checking: true,
        known_hosts_path: None,
    };

    let mut ssh = services.ssh_service.lock().await;
    match ssh.connect_ssh(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "success": true,
            "session_id": session_id
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

#[derive(Deserialize)]
struct ExecuteCommandRequest {
    session_id: String,
    command: String,
}

async fn execute_command(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<ExecuteCommandRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut ssh = services.ssh_service.lock().await;
    match ssh.execute_command(&req.session_id, req.command, None).await {
        Ok(output) => Ok(Json(serde_json::json!({
            "success": true,
            "output": output
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn list_ssh_sessions(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let ssh = services.ssh_service.lock().await;
    let sessions = ssh.list_sessions().await;
    Ok(Json(serde_json::json!({
        "sessions": sessions
    })))
}

// Database handlers
#[derive(Deserialize)]
struct DbConnectRequest {
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
}

async fn connect_mysql(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<DbConnectRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut db = services.db_service.lock().await;
    match db.connect_mysql(req.host, req.port, req.username, req.password, req.database.unwrap_or_default(), None, None).await {
        Ok(connection_id) => Ok(Json(serde_json::json!({
            "success": true,
            "connection_id": connection_id
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

#[derive(Deserialize)]
struct QueryRequest {
    connection_id: String,
    query: String,
}

async fn execute_query(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<QueryRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let db = services.db_service.lock().await;
    match db.execute_query(req.query).await {
        Ok(results) => Ok(Json(serde_json::json!({
            "success": true,
            "results": results
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// FTP handlers
#[derive(Deserialize)]
struct FtpConnectRequest {
    host: String,
    port: u16,
    username: String,
    password: String,
}

async fn connect_ftp(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<FtpConnectRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut ftp = services.ftp_service.lock().await;
    match ftp.connect_ftp(req.host, req.port, req.username, req.password).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "success": true,
            "session_id": session_id
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn list_ftp_files(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut ftp = services.ftp_service.lock().await;
    let path = params.get("path").unwrap_or(&"/".to_string()).clone();

    match ftp.list_files(session_id, path).await {
        Ok(files) => Ok(Json(serde_json::json!({
            "files": files
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// Network handlers
#[derive(Deserialize)]
struct PingRequest {
    host: String,
}

async fn ping_host(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<PingRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let network = services.network_service.lock().await;
    match network.ping_host(req.host).await {
        Ok(result) => Ok(Json(serde_json::json!({
            "result": result
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

#[derive(Deserialize)]
struct ScanRequest {
    network: String,
}

async fn scan_network(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<ScanRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let network = services.network_service.lock().await;
    match network.scan_network(req.network).await {
        Ok(hosts) => Ok(Json(serde_json::json!({
            "hosts": hosts
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn scan_network_comprehensive(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<ScanRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let network = services.network_service.lock().await;
    match network.scan_network_comprehensive(req.network, true).await {
        Ok(results) => Ok(Json(serde_json::json!({
            "results": results
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// Security handlers
async fn generate_totp_secret(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut security = services.security_service.lock().await;
    match security.generate_totp_secret().await {
        Ok(secret) => Ok(Json(serde_json::json!({
            "secret": secret
        }))),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

#[derive(Deserialize)]
struct VerifyTotpRequest {
    code: String,
}

async fn verify_totp(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<VerifyTotpRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let security = services.security_service.lock().await;
    match security.verify_totp(req.code).await {
        Ok(valid) => Ok(Json(serde_json::json!({
            "valid": valid
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// WOL handlers
#[derive(Deserialize)]
struct WolRequest {
    mac_address: String,
    broadcast_addr: Option<String>,
}

async fn wake_on_lan(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<WolRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wol = services.wol_service.lock().await;
    match wol.wake_on_lan(req.mac_address).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "success": true,
            "message": "Wake-on-LAN packet sent"
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// QR Code handlers
#[derive(Deserialize)]
struct QrRequest {
    data: String,
    size: Option<u32>,
}

async fn generate_qr_code(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<QrRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let qr = services.qr_service.lock().await;
    match qr.generate_qr_code(req.data, req.size).await {
        Ok(qr_code) => Ok(Json(serde_json::json!({
            "qr_code": qr_code
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

async fn generate_qr_code_png(
    State(services): State<Arc<ApiService>>,
    Json(req): Json<QrRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let qr = services.qr_service.lock().await;
    match qr.generate_qr_code_png(req.data, req.size).await {
        Ok(qr_code) => Ok(Json(serde_json::json!({
            "qr_code": qr_code
        }))),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

// RustDesk API handlers
async fn connect_rustdesk_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::rustdesk::RustDeskConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.connect_rustdesk(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect RustDesk: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_rustdesk_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.disconnect_rustdesk(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect RustDesk: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_rustdesk_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.list_rustdesk_sessions().await {
        sessions => Ok(Json(serde_json::json!({
            "sessions": sessions
        }))),
    }
}

async fn get_rustdesk_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.get_rustdesk_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Deserialize)]
struct UpdateSettingsRequest {
    quality: Option<String>,
    view_only: Option<bool>,
    enable_audio: Option<bool>,
    enable_clipboard: Option<bool>,
    enable_file_transfer: Option<bool>,
}

async fn update_rustdesk_settings_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(settings): Json<UpdateSettingsRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.update_rustdesk_settings(
        &session_id,
        settings.quality,
        settings.view_only,
        settings.enable_audio,
        settings.enable_clipboard,
        settings.enable_file_transfer,
    ).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "updated"
        }))),
        Err(e) => {
            eprintln!("Failed to update RustDesk settings: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Deserialize)]
struct SendInputRequest {
    input_type: String,
    data: serde_json::Value,
}

async fn send_rustdesk_input_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(input): Json<SendInputRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.send_rustdesk_input(&session_id, input.input_type, input.data).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "sent"
        }))),
        Err(e) => {
            eprintln!("Failed to send RustDesk input: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_rustdesk_screenshot_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Vec<u8>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    match rustdesk.get_rustdesk_screenshot(&session_id).await {
        Ok(data) => Ok(data),
        Err(e) => {
            eprintln!("Failed to get RustDesk screenshot: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn rustdesk_status_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rustdesk = services.rustdesk_service.lock().await;
    let available = rustdesk.is_rustdesk_available().await;
    let version = if available {
        rustdesk.get_rustdesk_version().await.ok()
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "available": available,
        "version": version
    })))
}