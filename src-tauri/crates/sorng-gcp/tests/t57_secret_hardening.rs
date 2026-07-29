use sorng_gcp::config::GcpConnectionConfig;
use sorng_gcp::service::GcpService;

const GCP_SENTINEL: &str = "t57-gcp-private-key-secret-sentinel";

fn service_account_key_json() -> String {
    serde_json::json!({
        "type": "service_account",
        "project_id": "project-a",
        "private_key_id": "key-a",
        "private_key": GCP_SENTINEL,
        "client_email": "service-account@project-a.iam.gserviceaccount.com",
        "client_id": "client-a",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/test"
    })
    .to_string()
}

#[tokio::test]
async fn gcp_public_sessions_exclude_service_account_key_and_disconnect_removes_state() {
    let state = GcpService::new();
    let mut service = state.lock().await;
    let session_id = service
        .connect_gcp(GcpConnectionConfig {
            project_id: "project-a".to_string(),
            service_account_key: service_account_key_json(),
            region: Some("europe-west2".to_string()),
            zone: Some("europe-west2-a".to_string()),
            scopes: Vec::new(),
            endpoint_override: None,
        })
        .await
        .expect("GCP session should be created");

    let public = service
        .get_gcp_session(&session_id)
        .expect("GCP session should exist");
    let serialized =
        serde_json::to_string(&public).expect("GCP public session should serialize");
    assert!(!serialized.contains(GCP_SENTINEL));

    let serialized_list = serde_json::to_string(&service.list_gcp_sessions())
        .expect("GCP public session list should serialize");
    assert!(!serialized_list.contains(GCP_SENTINEL));

    service
        .disconnect_gcp(&session_id)
        .await
        .expect("GCP disconnect should succeed");
    assert!(service.get_gcp_session(&session_id).is_none());
}
