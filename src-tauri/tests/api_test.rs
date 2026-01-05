use std::sync::Arc;

// Import our services from the library
use app_lib::auth::AuthService;
use app_lib::ssh::SshService;
use app_lib::db::DbService;
use app_lib::ftp::FtpService;
use app_lib::network::NetworkService;
use app_lib::security::SecurityService;
use app_lib::wol::WolService;
use app_lib::qr::QrService;
use app_lib::rustdesk::RustDeskService;
use app_lib::wmi::WmiService;
use app_lib::rpc::RpcService;
use app_lib::meshcentral::MeshCentralService;
use app_lib::agent::AgentService;
use app_lib::commander::CommanderService;
use app_lib::aws::AwsService;
use app_lib::vercel::VercelService;
use app_lib::cloudflare::CloudflareService;
use app_lib::api::ApiService;

#[tokio::test]
async fn test_api_server_startup() {
    // Initialize services - these return Arc<Mutex<...>> directly
    let auth_service = AuthService::new("test_users.json".to_string());
    let ssh_service = SshService::new();
    let db_service = DbService::new();
    let ftp_service = FtpService::new();
    let network_service = NetworkService::new();
    let security_service = SecurityService::new();
    let wol_service = WolService::new();
    let qr_service = QrService::new();
    let rustdesk_service = RustDeskService::new();
    let wmi_service = WmiService::new();
    let rpc_service = RpcService::new();
    let meshcentral_service = MeshCentralService::new();
    let agent_service = AgentService::new();
    let commander_service = CommanderService::new();
    let aws_service = AwsService::new();
    let vercel_service = VercelService::new();
    let cloudflare_service = CloudflareService::new();

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
        rustdesk_service,
        wmi_service,
        rpc_service,
        meshcentral_service,
        agent_service,
        commander_service,
        aws_service,
        vercel_service,
        cloudflare_service,
    );

    // Test that the router can be created
    let _router = Arc::new(api_service).create_router();
    assert!(true); // If we get here, the router was created successfully
}