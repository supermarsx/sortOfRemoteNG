//! Deterministic lifecycle coverage for the externally controlled REST API.

use std::future::{poll_fn, Future};
use std::net::TcpListener;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::task::Poll;

use app_lib::agent::AgentService;
use app_lib::api::{prepare_server, ApiService};
use app_lib::api_config::ApiRuntimeConfig;
use app_lib::api_server_commands::{
    ApiServerController, ApiServerLauncher, LaunchFuture, ServerLaunch,
};
use app_lib::auth::AuthService;
use app_lib::aws::AwsService;
use app_lib::cloudflare::CloudflareService;
use app_lib::commander::CommanderService;
use app_lib::db::DbService;
use app_lib::ftp::FtpService;
use app_lib::meshcentral::MeshCentralService;
use app_lib::network::NetworkService;
use app_lib::qr::QrService;
use app_lib::rpc::RpcService;
use app_lib::rustdesk::RustDeskService;
use app_lib::security::SecurityService;
use app_lib::ssh::SshService;
use app_lib::vercel::VercelService;
use app_lib::wmi::WmiService;
use app_lib::wol::WolService;
use serde_json::json;
use tokio::sync::oneshot;

const API_KEY: &str = "lifecycle-api-key-0123456789abcdef";
const JWT_SECRET: &str = "lifecycle-jwt-key-0123456789abcdef";

fn build_services(user_store: &Path) -> Arc<ApiService> {
    Arc::new(ApiService::new(
        AuthService::new(user_store.to_string_lossy().to_string()),
        SshService::new(),
        DbService::new(),
        FtpService::new(),
        NetworkService::new(),
        SecurityService::new(),
        WolService::new(),
        QrService::new(),
        RustDeskService::new(),
        WmiService::new(),
        RpcService::new(),
        MeshCentralService::new(),
        AgentService::new(),
        CommanderService::new(),
        AwsService::new(),
        VercelService::new(),
        CloudflareService::new(),
    ))
}

fn runtime_config(app_dir: &Path, port: u16, use_random_port: bool) -> ApiRuntimeConfig {
    ApiRuntimeConfig::resolve_with_env_and_secrets(
        &json!({
            "restApi": {
                "port": port,
                "useRandomPort": use_random_port,
                "allowRemoteConnections": false,
                "rateLimiting": true,
                "maxRequestsPerMinute": 120
            }
        }),
        app_dir,
        |key| (key == "SORNG_ALLOW_UNAUTHENTICATED_REST_API").then(|| "1".to_string()),
        Some(API_KEY),
        Some(JWT_SECRET),
    )
}

fn real_launcher(config: ApiRuntimeConfig, services: Arc<ApiService>) -> ApiServerLauncher {
    ApiServerLauncher::new(move |shutdown_rx| {
        let config = config.clone();
        let services = services.clone();
        Box::pin(async move {
            let auth_required = config.auth_required;
            let server = prepare_server(config, services, shutdown_rx)
                .await
                .map_err(|error| error.to_string())?;
            let local_addr = server.local_addr();
            let join = tokio::spawn(async move {
                if let Err(error) = server.serve().await {
                    panic!("prepared REST API server failed: {error}");
                }
            });
            Ok(ServerLaunch {
                join,
                bind_addr: local_addr.to_string(),
                port: local_addr.port(),
                auth_required,
            })
        }) as LaunchFuture
    })
}

fn blocking_launcher(calls: Arc<AtomicUsize>) -> ApiServerLauncher {
    ApiServerLauncher::new(move |shutdown_rx| {
        let calls = calls.clone();
        Box::pin(async move {
            let launch_index = calls.fetch_add(1, Ordering::SeqCst);
            let join = tokio::spawn(async move {
                let _ = shutdown_rx.await;
            });
            let port = 41_000 + launch_index as u16;
            Ok(ServerLaunch {
                join,
                bind_addr: format!("127.0.0.1:{port}"),
                port,
                auth_required: false,
            })
        }) as LaunchFuture
    })
}

#[tokio::test]
async fn occupied_port_errors_without_publishing_running() {
    let occupied = TcpListener::bind("127.0.0.1:0").expect("reserve occupied port");
    let occupied_addr = occupied.local_addr().expect("occupied local_addr");
    let temp = tempfile::tempdir().expect("tempdir");
    let config = runtime_config(temp.path(), occupied_addr.port(), false);
    let controller = ApiServerController::new(real_launcher(
        config,
        build_services(&temp.path().join("users.json")),
    ));

    let error = controller
        .start()
        .await
        .expect_err("occupied listener must reject startup");

    assert!(error.contains("failed to bind"), "got: {error}");
    assert!(!controller.status().running);
    assert_eq!(controller.status().port, 0);
    drop(occupied);
}

#[tokio::test]
async fn random_port_reports_actual_address_and_serves_health() {
    let temp = tempfile::tempdir().expect("tempdir");
    let config = runtime_config(temp.path(), 9876, true);
    assert_eq!(config.bind_port(), 0);
    let controller = ApiServerController::new(real_launcher(
        config,
        build_services(&temp.path().join("users.json")),
    ));

    let status = controller.start().await.expect("start random-port server");

    assert!(status.running);
    assert_ne!(status.port, 0);
    let reported_addr = status
        .bind_addr
        .parse::<std::net::SocketAddr>()
        .expect("reported socket address");
    assert_eq!(reported_addr.port(), status.port);
    let response = reqwest::get(format!("http://{}/health", status.bind_addr))
        .await
        .expect("ready listener must answer health");
    assert!(response.status().is_success());

    controller.stop().await.expect("stop random-port server");
    assert!(!controller.status().running);
}

#[tokio::test]
async fn overlapping_stop_then_start_cannot_clear_new_generation() {
    let calls = Arc::new(AtomicUsize::new(0));
    let (shutdown_seen_tx, shutdown_seen_rx) = oneshot::channel();
    let shutdown_seen_tx = Arc::new(StdMutex::new(Some(shutdown_seen_tx)));
    let (release_old_tx, release_old_rx) = oneshot::channel();
    let release_old_rx = Arc::new(StdMutex::new(Some(release_old_rx)));

    let launcher = ApiServerLauncher::new({
        let calls = calls.clone();
        move |shutdown_rx| {
            let calls = calls.clone();
            let shutdown_seen_tx = shutdown_seen_tx.clone();
            let release_old_rx = release_old_rx.clone();
            Box::pin(async move {
                let launch_index = calls.fetch_add(1, Ordering::SeqCst);
                let join = tokio::spawn(async move {
                    let _ = shutdown_rx.await;
                    if launch_index == 0 {
                        if let Some(sender) = shutdown_seen_tx.lock().unwrap().take() {
                            let _ = sender.send(());
                        }
                        let release = release_old_rx.lock().unwrap().take();
                        if let Some(release) = release {
                            let _ = release.await;
                        }
                    }
                });
                let port = 42_000 + launch_index as u16;
                Ok(ServerLaunch {
                    join,
                    bind_addr: format!("127.0.0.1:{port}"),
                    port,
                    auth_required: false,
                })
            }) as LaunchFuture
        }
    });
    let controller = Arc::new(ApiServerController::new(launcher));
    controller.start().await.expect("initial start");

    let stop_controller = controller.clone();
    let stop_task = tokio::spawn(async move { stop_controller.stop().await });
    shutdown_seen_rx
        .await
        .expect("old server must observe shutdown");

    let mut overlapping_start = Box::pin(controller.start());
    let start_is_pending =
        poll_fn(|cx| Poll::Ready(matches!(overlapping_start.as_mut().poll(cx), Poll::Pending)))
            .await;
    assert!(start_is_pending, "start must wait for the active stop");
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    release_old_tx.send(()).expect("release old server");
    stop_task
        .await
        .expect("stop task join")
        .expect("stop old generation");
    let restarted = overlapping_start.await.expect("start new generation");

    assert!(restarted.running);
    assert_eq!(restarted.port, 42_001);
    assert!(controller.status().running);
    assert_eq!(controller.status().port, 42_001);
    controller.stop().await.expect("cleanup new generation");
}

#[tokio::test]
async fn normal_start_stop_updates_status() {
    let calls = Arc::new(AtomicUsize::new(0));
    let controller = ApiServerController::new(blocking_launcher(calls.clone()));

    let started = controller.start().await.expect("normal start");
    assert!(started.running);
    assert_eq!(controller.status().port, 41_000);

    controller.stop().await.expect("normal stop");
    assert!(!controller.status().running);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
