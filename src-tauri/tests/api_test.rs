use std::sync::Arc;
use tokio::sync::Mutex;

// Import our services from the library
use app_lib::auth::AuthService;
use app_lib::ssh::SshService;
use app_lib::db::DbService;
use app_lib::ftp::FtpService;
use app_lib::network::NetworkService;
use app_lib::security::SecurityService;
use app_lib::wol::WolService;
use app_lib::qr::QrService;
use app_lib::api::ApiService;

#[tokio::test]
async fn test_api_server_startup() {
    // Initialize services
    let auth_service = Arc::new(Mutex::new(AuthService::new("test_users.json".to_string())));
    let ssh_service = Arc::new(Mutex::new(SshService::new()));
    let db_service = Arc::new(Mutex::new(DbService::new()));
    let ftp_service = Arc::new(Mutex::new(FtpService::new()));
    let network_service = Arc::new(Mutex::new(NetworkService::new()));
    let security_service = Arc::new(Mutex::new(SecurityService::new()));
    let wol_service = Arc::new(Mutex::new(WolService::new()));
    let qr_service = Arc::new(Mutex::new(QrService::new()));

    // Create API service
    let api_service = ApiService::new(
        auth_service,
        ssh_service,
        db_service,
        ftp_service,
        network_service,
        security_service,
        wol_service,
        qr_service,
    );

    // Test that the router can be created
    let _router = Arc::new(api_service).create_router();
    assert!(true); // If we get here, the router was created successfully
}