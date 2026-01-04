use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::aws::AwsConnectionConfig;
use crate::vercel::VercelConnectionConfig;
use crate::cloudflare::CloudflareConnectionConfig;

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
    pub wmi_service: Arc<Mutex<crate::wmi::WmiService>>,
    pub rpc_service: Arc<Mutex<crate::rpc::RpcService>>,
    pub meshcentral_service: Arc<Mutex<crate::meshcentral::MeshCentralService>>,
    pub agent_service: Arc<Mutex<crate::agent::AgentService>>,
    pub commander_service: Arc<Mutex<crate::commander::CommanderService>>,
    pub aws_service: Arc<Mutex<crate::aws::AwsService>>,
    pub vercel_service: Arc<Mutex<crate::vercel::VercelService>>,
    pub cloudflare_service: Arc<Mutex<crate::cloudflare::CloudflareService>>,
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
        wmi_service: Arc<Mutex<crate::wmi::WmiService>>,
        rpc_service: Arc<Mutex<crate::rpc::RpcService>>,
        meshcentral_service: Arc<Mutex<crate::meshcentral::MeshCentralService>>,
        agent_service: Arc<Mutex<crate::agent::AgentService>>,
        commander_service: Arc<Mutex<crate::commander::CommanderService>>,
        aws_service: Arc<Mutex<crate::aws::AwsService>>,
        vercel_service: Arc<Mutex<crate::vercel::VercelService>>,
        cloudflare_service: Arc<Mutex<crate::cloudflare::CloudflareService>>,
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
            wmi_service,
            rpc_service,
            meshcentral_service,
            agent_service,
            commander_service,
            aws_service,
            vercel_service,
            cloudflare_service,
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
            // WMI
            .route("/wmi/connect", post(connect_wmi_api))
            .route("/wmi/disconnect/:session_id", post(disconnect_wmi_api))
            .route("/wmi/sessions", get(list_wmi_sessions_api))
            .route("/wmi/session/:session_id", get(get_wmi_session_api))
            .route("/wmi/query/:session_id", post(execute_wmi_query_api))
            .route("/wmi/classes/:session_id", get(get_wmi_classes_api))
            .route("/wmi/namespaces/:session_id", get(get_wmi_namespaces_api))
            // RPC
            .route("/rpc/connect", post(connect_rpc_api))
            .route("/rpc/disconnect/:session_id", post(disconnect_rpc_api))
            .route("/rpc/sessions", get(list_rpc_sessions_api))
            .route("/rpc/session/:session_id", get(get_rpc_session_api))
            .route("/rpc/call/:session_id", post(call_rpc_method_api))
            .route("/rpc/methods/:session_id", get(discover_rpc_methods_api))
            .route("/rpc/batch/:session_id", post(batch_rpc_calls_api))
            // MeshCentral
            .route("/meshcentral/connect", post(connect_meshcentral_api))
            .route("/meshcentral/disconnect/:session_id", post(disconnect_meshcentral_api))
            .route("/meshcentral/sessions", get(list_meshcentral_sessions_api))
            .route("/meshcentral/session/:session_id", get(get_meshcentral_session_api))
            .route("/meshcentral/devices/:session_id", get(get_meshcentral_devices_api))
            .route("/meshcentral/groups/:session_id", get(get_meshcentral_groups_api))
            .route("/meshcentral/command/:session_id", post(execute_meshcentral_command_api))
            .route("/meshcentral/command/:session_id/:command_id", get(get_meshcentral_command_result_api))
            .route("/meshcentral/server/:session_id", get(get_meshcentral_server_info_api))
            // Agent
            .route("/agent/connect", post(connect_agent_api))
            .route("/agent/disconnect/:session_id", post(disconnect_agent_api))
            .route("/agent/sessions", get(list_agent_sessions_api))
            .route("/agent/session/:session_id", get(get_agent_session_api))
            .route("/agent/metrics/:session_id", get(get_agent_metrics_api))
            .route("/agent/logs/:session_id", get(get_agent_logs_api))
            .route("/agent/command/:session_id", post(execute_agent_command_api))
            .route("/agent/command/:session_id/:command_id", get(get_agent_command_result_api))
            .route("/agent/status/:session_id", post(update_agent_status_api))
            .route("/agent/info/:session_id", get(get_agent_info_api))
            // Commander
            .route("/commander/connect", post(connect_commander_api))
            .route("/commander/disconnect/:session_id", post(disconnect_commander_api))
            .route("/commander/sessions", get(list_commander_sessions_api))
            .route("/commander/session/:session_id", get(get_commander_session_api))
            .route("/commander/command/:session_id", post(execute_commander_command_api))
            .route("/commander/command/:session_id/:command_id", get(get_commander_command_result_api))
            .route("/commander/upload/:session_id", post(upload_commander_file_api))
            .route("/commander/download/:session_id", post(download_commander_file_api))
            .route("/commander/transfer/:session_id/:transfer_id", get(get_commander_file_transfer_api))
            .route("/commander/list/:session_id", get(list_commander_directory_api))
            .route("/commander/status/:session_id", post(update_commander_status_api))
            .route("/commander/system/:session_id", get(get_commander_system_info_api))
            // AWS
            .route("/aws/connect", post(connect_aws_api))
            .route("/aws/disconnect/:session_id", post(disconnect_aws_api))
            .route("/aws/sessions", get(list_aws_sessions_api))
            .route("/aws/session/:session_id", get(get_aws_session_api))
            .route("/aws/ec2/instances/:session_id", get(list_ec2_instances_api))
            .route("/aws/ec2/instance/:session_id/:instance_id", get(get_ec2_instance_api))
            .route("/aws/ec2/action/:session_id/:instance_id", post(execute_ec2_action_api))
            .route("/aws/s3/buckets/:session_id", get(list_s3_buckets_api))
            .route("/aws/s3/bucket/:session_id/:bucket_name", get(get_s3_bucket_api))
            .route("/aws/s3/objects/:session_id/:bucket_name", get(list_s3_objects_api))
            .route("/aws/s3/object/:session_id/:bucket_name/*key", get(get_s3_object_api))
            .route("/aws/rds/instances/:session_id", get(list_rds_instances_api))
            .route("/aws/rds/instance/:session_id/:instance_id", get(get_rds_instance_api))
            .route("/aws/lambda/functions/:session_id", get(list_lambda_functions_api))
            .route("/aws/lambda/function/:session_id/:function_name", get(get_lambda_function_api))
            .route("/aws/cloudwatch/metrics/:session_id", get(get_cloudwatch_metrics_api))
            // Vercel
            .route("/vercel/connect", post(connect_vercel_api))
            .route("/vercel/disconnect/:session_id", post(disconnect_vercel_api))
            .route("/vercel/sessions", get(list_vercel_sessions_api))
            .route("/vercel/session/:session_id", get(get_vercel_session_api))
            .route("/vercel/projects/:session_id", get(list_vercel_projects_api))
            .route("/vercel/project/:session_id/:project_id", get(get_vercel_project_api))
            .route("/vercel/deployments/:session_id/:project_id", get(list_vercel_deployments_api))
            .route("/vercel/deployment/:session_id/:deployment_id", get(get_vercel_deployment_api))
            .route("/vercel/domains/:session_id", get(list_vercel_domains_api))
            .route("/vercel/domain/:session_id/:domain_name", get(get_vercel_domain_api))
            .route("/vercel/teams/:session_id", get(list_vercel_teams_api))
            .route("/vercel/team/:session_id/:team_id", get(get_vercel_team_api))
            // Cloudflare
            .route("/cloudflare/connect", post(connect_cloudflare_api))
            .route("/cloudflare/disconnect/:session_id", post(disconnect_cloudflare_api))
            .route("/cloudflare/sessions", get(list_cloudflare_sessions_api))
            .route("/cloudflare/session/:session_id", get(get_cloudflare_session_api))
            .route("/cloudflare/zones/:session_id", get(list_cloudflare_zones_api))
            .route("/cloudflare/zone/:session_id/:zone_id", get(get_cloudflare_zone_api))
            .route("/cloudflare/dns/:session_id/:zone_id", get(list_cloudflare_dns_records_api))
            .route("/cloudflare/dns/:session_id/:zone_id/:record_id", get(get_cloudflare_dns_record_api))
            .route("/cloudflare/workers/:session_id", get(list_cloudflare_workers_api))
            .route("/cloudflare/worker/:session_id/:worker_id", get(get_cloudflare_worker_api))
            .route("/cloudflare/pagerules/:session_id/:zone_id", get(list_cloudflare_page_rules_api))
            .route("/cloudflare/pagerule/:session_id/:zone_id/:rule_id", get(get_cloudflare_page_rule_api))
            .route("/cloudflare/analytics/:session_id/:zone_id", get(get_cloudflare_analytics_api))
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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

// WMI API handlers
async fn connect_wmi_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::wmi::WmiConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut wmi = services.wmi_service.lock().await;
    match wmi.connect_wmi(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect WMI: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_wmi_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut wmi = services.wmi_service.lock().await;
    match wmi.disconnect_wmi(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect WMI: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_wmi_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": wmi.list_wmi_sessions().await
    })))
}

async fn get_wmi_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    match wmi.get_wmi_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Deserialize)]
struct WmiQueryRequest {
    query: String,
}

async fn execute_wmi_query_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(req): Json<WmiQueryRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    match wmi.execute_wmi_query(&session_id, req.query).await {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to execute WMI query: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_wmi_classes_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    let namespace = params.get("namespace");
    match wmi.get_wmi_classes(&session_id, namespace.cloned()).await {
        Ok(classes) => Ok(Json(serde_json::json!({
            "classes": classes
        }))),
        Err(e) => {
            eprintln!("Failed to get WMI classes: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_wmi_namespaces_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let wmi = services.wmi_service.lock().await;
    match wmi.get_wmi_namespaces(&session_id).await {
        Ok(namespaces) => Ok(Json(serde_json::json!({
            "namespaces": namespaces
        }))),
        Err(e) => {
            eprintln!("Failed to get WMI namespaces: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// RPC API handlers
async fn connect_rpc_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::rpc::RpcConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rpc = services.rpc_service.lock().await;
    match rpc.connect_rpc(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect RPC: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_rpc_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut rpc = services.rpc_service.lock().await;
    match rpc.disconnect_rpc(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect RPC: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_rpc_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": rpc.list_rpc_sessions().await
    })))
}

async fn get_rpc_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.get_rpc_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn call_rpc_method_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(request): Json<crate::rpc::RpcRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.call_rpc_method(&session_id, request).await {
        Ok(response) => Ok(Json(serde_json::json!(response))),
        Err(e) => {
            eprintln!("Failed to call RPC method: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn discover_rpc_methods_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.discover_rpc_methods(&session_id).await {
        Ok(methods) => Ok(Json(serde_json::json!({
            "methods": methods
        }))),
        Err(e) => {
            eprintln!("Failed to discover RPC methods: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn batch_rpc_calls_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(requests): Json<Vec<crate::rpc::RpcRequest>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rpc = services.rpc_service.lock().await;
    match rpc.batch_rpc_calls(&session_id, requests).await {
        Ok(responses) => Ok(Json(serde_json::json!({
            "responses": responses
        }))),
        Err(e) => {
            eprintln!("Failed to batch RPC calls: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// MeshCentral API handlers
async fn connect_meshcentral_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::meshcentral::MeshCentralConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.connect_meshcentral(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect MeshCentral: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_meshcentral_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.disconnect_meshcentral(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect MeshCentral: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_meshcentral_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": meshcentral.list_meshcentral_sessions().await
    })))
}

async fn get_meshcentral_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn get_meshcentral_devices_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_devices(&session_id).await {
        Ok(devices) => Ok(Json(serde_json::json!({
            "devices": devices
        }))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral devices: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_meshcentral_groups_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_groups(&session_id).await {
        Ok(groups) => Ok(Json(serde_json::json!({
            "groups": groups
        }))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral groups: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn execute_meshcentral_command_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(command): Json<crate::meshcentral::MeshCentralCommand>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.execute_meshcentral_command(&session_id, command).await {
        Ok(command_id) => Ok(Json(serde_json::json!({
            "command_id": command_id
        }))),
        Err(e) => {
            eprintln!("Failed to execute MeshCentral command: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_meshcentral_command_result_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, command_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_command_result(&session_id, &command_id).await {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral command result: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_meshcentral_server_info_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let meshcentral = services.meshcentral_service.lock().await;
    match meshcentral.get_meshcentral_server_info(&session_id).await {
        Ok(info) => Ok(Json(serde_json::json!(info))),
        Err(e) => {
            eprintln!("Failed to get MeshCentral server info: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Agent API handlers
async fn connect_agent_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::agent::AgentConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agent = services.agent_service.lock().await;
    match agent.connect_agent(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect agent: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_agent_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agent = services.agent_service.lock().await;
    match agent.disconnect_agent(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect agent: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_agent_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": agent.list_agent_sessions().await
    })))
}

async fn get_agent_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.get_agent_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn get_agent_metrics_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.get_agent_metrics(&session_id).await {
        Ok(metrics) => Ok(Json(serde_json::json!(metrics))),
        Err(e) => {
            eprintln!("Failed to get agent metrics: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_agent_logs_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    let limit = params.get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(100);
    match agent.get_agent_logs(&session_id, Some(limit)).await {
        Ok(logs) => Ok(Json(serde_json::json!({
            "logs": logs
        }))),
        Err(e) => {
            eprintln!("Failed to get agent logs: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn execute_agent_command_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(command): Json<crate::agent::AgentCommand>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.execute_agent_command(&session_id, command).await {
        Ok(command_id) => Ok(Json(serde_json::json!({
            "command_id": command_id
        }))),
        Err(e) => {
            eprintln!("Failed to execute agent command: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_agent_command_result_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, command_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.get_agent_command_result(&session_id, &command_id).await {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to get agent command result: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn update_agent_status_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(status): Json<crate::agent::AgentStatus>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agent = services.agent_service.lock().await;
    match agent.update_agent_status(&session_id, status).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "updated"
        }))),
        Err(e) => {
            eprintln!("Failed to update agent status: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_agent_info_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = services.agent_service.lock().await;
    match agent.get_agent_info(&session_id).await {
        Ok(info) => Ok(Json(info)),
        Err(e) => {
            eprintln!("Failed to get agent info: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Commander API handlers
async fn connect_commander_api(
    State(services): State<Arc<ApiService>>,
    Json(config): Json<crate::commander::CommanderConnectionConfig>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut commander = services.commander_service.lock().await;
    match commander.connect_commander(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id,
            "status": "connected"
        }))),
        Err(e) => {
            eprintln!("Failed to connect commander: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_commander_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut commander = services.commander_service.lock().await;
    match commander.disconnect_commander(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect commander: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_commander_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    Ok(Json(serde_json::json!({
        "sessions": commander.list_commander_sessions().await
    })))
}

async fn get_commander_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander.get_commander_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn execute_commander_command_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(command): Json<crate::commander::CommanderCommand>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander.execute_commander_command(&session_id, command).await {
        Ok(command_id) => Ok(Json(serde_json::json!({
            "command_id": command_id
        }))),
        Err(e) => {
            eprintln!("Failed to execute commander command: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_commander_command_result_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, command_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander.get_commander_command_result(&session_id, &command_id).await {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to get commander command result: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn upload_commander_file_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    let local_path = params.get("local_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let remote_path = params.get("remote_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;

    match commander.upload_commander_file(&session_id, local_path.to_string(), remote_path.to_string()).await {
        Ok(transfer_id) => Ok(Json(serde_json::json!({
            "transfer_id": transfer_id
        }))),
        Err(e) => {
            eprintln!("Failed to upload commander file: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn download_commander_file_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    let remote_path = params.get("remote_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let local_path = params.get("local_path")
        .and_then(|v| v.as_str())
        .ok_or(StatusCode::BAD_REQUEST)?;

    match commander.download_commander_file(&session_id, remote_path.to_string(), local_path.to_string()).await {
        Ok(transfer_id) => Ok(Json(serde_json::json!({
            "transfer_id": transfer_id
        }))),
        Err(e) => {
            eprintln!("Failed to download commander file: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_commander_file_transfer_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, transfer_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander.get_commander_file_transfer(&session_id, &transfer_id).await {
        Ok(transfer) => Ok(Json(serde_json::json!(transfer))),
        Err(e) => {
            eprintln!("Failed to get commander file transfer: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_commander_directory_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    let path = params.get("path").unwrap_or(&".".to_string()).clone();
    match commander.list_commander_directory(&session_id, path).await {
        Ok(files) => Ok(Json(serde_json::json!({
            "files": files
        }))),
        Err(e) => {
            eprintln!("Failed to list commander directory: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn update_commander_status_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Json(status): Json<crate::commander::CommanderStatus>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut commander = services.commander_service.lock().await;
    match commander.update_commander_status(&session_id, status).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "updated"
        }))),
        Err(e) => {
            eprintln!("Failed to update commander status: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_commander_system_info_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let commander = services.commander_service.lock().await;
    match commander.get_commander_system_info(&session_id).await {
        Ok(info) => Ok(Json(info)),
        Err(e) => {
            eprintln!("Failed to get commander system info: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// AWS API handlers
async fn connect_aws_api(
    State(services): State<Arc<ApiService>>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut aws = services.aws_service.lock().await;
    // Parse the JSON params into AwsConnectionConfig
    let config: AwsConnectionConfig = match serde_json::from_value(params) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse AWS connection config: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    match aws.connect_aws(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id
        }))),
        Err(e) => {
            eprintln!("Failed to connect to AWS: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_aws_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut aws = services.aws_service.lock().await;
    match aws.disconnect_aws(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect from AWS: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_aws_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    let sessions = aws.list_aws_sessions().await;
    Ok(Json(serde_json::json!(sessions)))
}

async fn get_aws_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.get_aws_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND)
    }
}

async fn list_ec2_instances_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_ec2_instances(&session_id).await {
        Ok(instances) => Ok(Json(serde_json::json!(instances))),
        Err(e) => {
            eprintln!("Failed to list EC2 instances: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_ec2_instance_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, instance_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_ec2_instances(&session_id).await {
        Ok(instances) => {
            match instances.into_iter().find(|i| i.instance_id == instance_id) {
                Some(instance) => Ok(Json(serde_json::json!(instance))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get EC2 instance: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn execute_ec2_action_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, instance_id)): Path<(String, String)>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    let action = params.get("action")
        .and_then(|a| a.as_str())
        .unwrap_or("start");
    match aws.execute_ec2_action(&session_id, &instance_id, action).await {
        Ok(result) => Ok(Json(serde_json::json!(result))),
        Err(e) => {
            eprintln!("Failed to execute EC2 action: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_s3_buckets_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_s3_buckets(&session_id).await {
        Ok(buckets) => Ok(Json(serde_json::json!(buckets))),
        Err(e) => {
            eprintln!("Failed to list S3 buckets: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_s3_bucket_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, bucket_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_s3_buckets(&session_id).await {
        Ok(buckets) => {
            match buckets.into_iter().find(|b| b.name == bucket_name) {
                Some(bucket) => Ok(Json(serde_json::json!(bucket))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get S3 bucket: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_s3_objects_api(
    State(_services): State<Arc<ApiService>>,
    Path((_session_id, _bucket_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // This method doesn't exist, return empty array for now
    Ok(Json(serde_json::json!([])))
}

async fn get_s3_object_api(
    State(_services): State<Arc<ApiService>>,
    Path((_session_id, _bucket_name, _key)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // This method doesn't exist, return not found
    Err(StatusCode::NOT_FOUND)
}

async fn list_rds_instances_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_rds_instances(&session_id).await {
        Ok(instances) => Ok(Json(serde_json::json!(instances))),
        Err(e) => {
            eprintln!("Failed to list RDS instances: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_rds_instance_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, instance_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_rds_instances(&session_id).await {
        Ok(instances) => {
            match instances.into_iter().find(|i| i.db_instance_identifier == instance_id) {
                Some(instance) => Ok(Json(serde_json::json!(instance))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get RDS instance: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_lambda_functions_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_lambda_functions(&session_id).await {
        Ok(functions) => Ok(Json(serde_json::json!(functions))),
        Err(e) => {
            eprintln!("Failed to list Lambda functions: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_lambda_function_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, function_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    match aws.list_lambda_functions(&session_id).await {
        Ok(functions) => {
            match functions.into_iter().find(|f| f.function_name == function_name) {
                Some(function) => Ok(Json(serde_json::json!(function))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Lambda function: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudwatch_metrics_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let aws = services.aws_service.lock().await;
    let namespace = params.get("namespace").unwrap_or(&"AWS/EC2".to_string()).clone();
    let metric_name = params.get("metric_name").unwrap_or(&"CPUUtilization".to_string()).clone();
    match aws.get_cloudwatch_metrics(&session_id, &namespace, &metric_name).await {
        Ok(metrics) => Ok(Json(serde_json::json!(metrics))),
        Err(e) => {
            eprintln!("Failed to get CloudWatch metrics: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Vercel API handlers
async fn connect_vercel_api(
    State(services): State<Arc<ApiService>>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut vercel = services.vercel_service.lock().await;
    let config: VercelConnectionConfig = match serde_json::from_value(params) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse Vercel connection config: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    match vercel.connect_vercel(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id
        }))),
        Err(e) => {
            eprintln!("Failed to connect to Vercel: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_vercel_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut vercel = services.vercel_service.lock().await;
    match vercel.disconnect_vercel(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect from Vercel: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_vercel_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    let sessions = vercel.list_vercel_sessions().await;
    Ok(Json(serde_json::json!(sessions)))
}

async fn get_vercel_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.get_vercel_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND)
    }
}

async fn list_vercel_projects_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_projects(&session_id).await {
        Ok(projects) => Ok(Json(serde_json::json!(projects))),
        Err(e) => {
            eprintln!("Failed to list Vercel projects: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_project_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, project_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_projects(&session_id).await {
        Ok(projects) => {
            match projects.into_iter().find(|p| p.id == project_id) {
                Some(project) => Ok(Json(serde_json::json!(project))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Vercel project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_vercel_deployments_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, project_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_deployments(&session_id, Some(project_id)).await {
        Ok(deployments) => Ok(Json(serde_json::json!(deployments))),
        Err(e) => {
            eprintln!("Failed to list Vercel deployments: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_deployment_api(
    State(_services): State<Arc<ApiService>>,
    Path((_session_id, _deployment_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // This method doesn't exist, return not found
    Err(StatusCode::NOT_FOUND)
}

async fn list_vercel_domains_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_domains(&session_id).await {
        Ok(domains) => Ok(Json(serde_json::json!(domains))),
        Err(e) => {
            eprintln!("Failed to list Vercel domains: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_domain_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, domain_name)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_domains(&session_id).await {
        Ok(domains) => {
            match domains.into_iter().find(|d| d.name == domain_name) {
                Some(domain) => Ok(Json(serde_json::json!(domain))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Vercel domain: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_vercel_teams_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_teams(&session_id).await {
        Ok(teams) => Ok(Json(serde_json::json!(teams))),
        Err(e) => {
            eprintln!("Failed to list Vercel teams: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_vercel_team_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, team_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let vercel = services.vercel_service.lock().await;
    match vercel.list_vercel_teams(&session_id).await {
        Ok(teams) => {
            match teams.into_iter().find(|t| t.id == team_id) {
                Some(team) => Ok(Json(serde_json::json!(team))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Vercel team: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Cloudflare API handlers
async fn connect_cloudflare_api(
    State(services): State<Arc<ApiService>>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut cloudflare = services.cloudflare_service.lock().await;
    let config: CloudflareConnectionConfig = match serde_json::from_value(params) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse Cloudflare connection config: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    match cloudflare.connect_cloudflare(config).await {
        Ok(session_id) => Ok(Json(serde_json::json!({
            "session_id": session_id
        }))),
        Err(e) => {
            eprintln!("Failed to connect to Cloudflare: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn disconnect_cloudflare_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.disconnect_cloudflare(&session_id).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "disconnected"
        }))),
        Err(e) => {
            eprintln!("Failed to disconnect from Cloudflare: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_sessions_api(
    State(services): State<Arc<ApiService>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let sessions = cloudflare.list_cloudflare_sessions().await;
    Ok(Json(serde_json::json!(sessions)))
}

async fn get_cloudflare_session_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.get_cloudflare_session(&session_id).await {
        Some(session) => Ok(Json(serde_json::json!(session))),
        None => Err(StatusCode::NOT_FOUND)
    }
}

async fn list_cloudflare_zones_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_zones(&session_id).await {
        Ok(zones) => Ok(Json(serde_json::json!(zones))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare zones: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_zone_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_zones(&session_id).await {
        Ok(zones) => {
            match zones.into_iter().find(|z| z.id == zone_id) {
                Some(zone) => Ok(Json(serde_json::json!(zone))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare zone: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_dns_records_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_dns_records(&session_id, &zone_id).await {
        Ok(records) => Ok(Json(serde_json::json!(records))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare DNS records: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_dns_record_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id, record_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_dns_records(&session_id, &zone_id).await {
        Ok(records) => {
            match records.into_iter().find(|r| r.id == record_id) {
                Some(record) => Ok(Json(serde_json::json!(record))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare DNS record: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_workers_api(
    State(services): State<Arc<ApiService>>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let account_id = params.get("account_id").unwrap_or(&"default".to_string()).clone();
    match cloudflare.list_cloudflare_workers(&session_id, &account_id).await {
        Ok(workers) => Ok(Json(serde_json::json!(workers))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare workers: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_worker_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, worker_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let account_id = params.get("account_id").unwrap_or(&"default".to_string()).clone();
    match cloudflare.list_cloudflare_workers(&session_id, &account_id).await {
        Ok(workers) => {
            match workers.into_iter().find(|w| w.id == worker_id) {
                Some(worker) => Ok(Json(serde_json::json!(worker))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare worker: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn list_cloudflare_page_rules_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_page_rules(&session_id, &zone_id).await {
        Ok(rules) => Ok(Json(serde_json::json!(rules))),
        Err(e) => {
            eprintln!("Failed to list Cloudflare page rules: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_page_rule_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id, rule_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    match cloudflare.list_cloudflare_page_rules(&session_id, &zone_id).await {
        Ok(rules) => {
            match rules.into_iter().find(|r| r.id == rule_id) {
                Some(rule) => Ok(Json(serde_json::json!(rule))),
                None => Err(StatusCode::NOT_FOUND)
            }
        },
        Err(e) => {
            eprintln!("Failed to get Cloudflare page rule: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_cloudflare_analytics_api(
    State(services): State<Arc<ApiService>>,
    Path((session_id, zone_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cloudflare = services.cloudflare_service.lock().await;
    let since = params.get("since").cloned();
    let until = params.get("until").cloned();
    match cloudflare.get_cloudflare_analytics(&session_id, &zone_id, since, until).await {
        Ok(analytics) => Ok(Json(serde_json::json!(analytics))),
        Err(e) => {
            eprintln!("Failed to get Cloudflare analytics: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
