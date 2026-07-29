use sorng_cloud::ibm::{
    IbmConnectionConfig, IbmService, IbmSessionStatus,
};
use sorng_cloud::heroku::{
    HerokuConnectionConfig, HerokuService, HerokuSessionStatus,
};
use sorng_cloud::scaleway::{
    ScalewayConnectionConfig, ScalewayService, ScalewaySessionStatus,
};
use sorng_cloud::linode::{
    LinodeConnectionConfig, LinodeService, LinodeSessionStatus,
};
use sorng_cloud::ovh::{OvhConnectionConfig, OvhService, OvhSessionStatus};
use sorng_cloud::digital_ocean::{
    DigitalOceanConnectionConfig, DigitalOceanService, DigitalOceanSessionStatus,
};

const IBM_SENTINEL: &str = "t57-ibm-secret-sentinel";
const HEROKU_SENTINEL: &str = "t57-heroku-secret-sentinel";
const SCALEWAY_SENTINEL: &str = "t57-scaleway-secret-sentinel";
const LINODE_SENTINEL: &str = "t57-linode-secret-sentinel";
const OVH_API_SENTINEL: &str = "t57-ovh-api-secret-sentinel";
const OVH_APP_SENTINEL: &str = "t57-ovh-app-secret-sentinel";
const OVH_CONSUMER_SENTINEL: &str = "t57-ovh-consumer-secret-sentinel";
const DIGITAL_OCEAN_SENTINEL: &str = "t57-digital-ocean-secret-sentinel";

#[tokio::test]
async fn ibm_public_sessions_exclude_secrets_and_disconnect_removes_state() {
    let state = IbmService::new();
    let mut service = state.lock().await;
    let session_id = service
        .connect_ibm(IbmConnectionConfig {
            api_key: IBM_SENTINEL.to_string(),
            region: Some("eu-gb".to_string()),
            resource_group: Some("rg-a".to_string()),
        })
        .await
        .expect("IBM session should be created");

    let public = IbmSessionStatus::from(
        service
            .get_session(&session_id)
            .await
            .expect("IBM session should exist"),
    );
    let serialized =
        serde_json::to_string(&public).expect("IBM public session should serialize");
    assert!(!serialized.contains(IBM_SENTINEL));
    let serialized_list = serde_json::to_string(
        &service
            .get_sessions()
            .into_iter()
            .map(IbmSessionStatus::from)
            .collect::<Vec<_>>(),
    )
    .expect("IBM public session list should serialize");
    assert!(!serialized_list.contains(IBM_SENTINEL));

    service
        .disconnect_ibm(&session_id)
        .await
        .expect("IBM disconnect should succeed");
    assert!(service.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn heroku_public_sessions_exclude_secrets_and_disconnect_removes_state() {
    let state = HerokuService::new();
    let mut service = state.lock().await;
    let session_id = service
        .connect_heroku(HerokuConnectionConfig {
            api_key: HEROKU_SENTINEL.to_string(),
            app_name: Some("app-a".to_string()),
            region: Some("eu".to_string()),
        })
        .await
        .expect("Heroku session should be created");

    let public = HerokuSessionStatus::from(
        service
            .get_session(&session_id)
            .await
            .expect("Heroku session should exist"),
    );
    let serialized =
        serde_json::to_string(&public).expect("Heroku public session should serialize");
    assert!(!serialized.contains(HEROKU_SENTINEL));
    let serialized_list = serde_json::to_string(
        &service
            .get_sessions()
            .into_iter()
            .map(HerokuSessionStatus::from)
            .collect::<Vec<_>>(),
    )
    .expect("Heroku public session list should serialize");
    assert!(!serialized_list.contains(HEROKU_SENTINEL));

    service
        .disconnect_heroku(&session_id)
        .await
        .expect("Heroku disconnect should succeed");
    assert!(service.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn scaleway_public_sessions_exclude_secrets_and_disconnect_removes_state() {
    let state = ScalewayService::new();
    let mut service = state.lock().await;
    let session_id = service
        .connect_scaleway(ScalewayConnectionConfig {
            api_key: SCALEWAY_SENTINEL.to_string(),
            organization_id: Some("org-a".to_string()),
            project_name: Some("project-a".to_string()),
            region: Some("fr-par".to_string()),
        })
        .await
        .expect("Scaleway session should be created");

    let public = ScalewaySessionStatus::from(
        service
            .get_session(&session_id)
            .await
            .expect("Scaleway session should exist"),
    );
    let serialized =
        serde_json::to_string(&public).expect("Scaleway public session should serialize");
    assert!(!serialized.contains(SCALEWAY_SENTINEL));
    let serialized_list = serde_json::to_string(
        &service
            .get_sessions()
            .into_iter()
            .map(ScalewaySessionStatus::from)
            .collect::<Vec<_>>(),
    )
    .expect("Scaleway public session list should serialize");
    assert!(!serialized_list.contains(SCALEWAY_SENTINEL));

    service
        .disconnect_scaleway(&session_id)
        .await
        .expect("Scaleway disconnect should succeed");
    assert!(service.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn linode_public_sessions_exclude_secrets_and_disconnect_removes_state() {
    let state = LinodeService::new();
    let mut service = state.lock().await;
    let session_id = service
        .connect_linode(LinodeConnectionConfig {
            api_key: LINODE_SENTINEL.to_string(),
            region: Some("eu-west".to_string()),
        })
        .await
        .expect("Linode session should be created");

    let public = LinodeSessionStatus::from(
        service
            .get_session(&session_id)
            .await
            .expect("Linode session should exist"),
    );
    let serialized =
        serde_json::to_string(&public).expect("Linode public session should serialize");
    assert!(!serialized.contains(LINODE_SENTINEL));
    let serialized_list = serde_json::to_string(
        &service
            .get_sessions()
            .into_iter()
            .map(LinodeSessionStatus::from)
            .collect::<Vec<_>>(),
    )
    .expect("Linode public session list should serialize");
    assert!(!serialized_list.contains(LINODE_SENTINEL));

    service
        .disconnect_linode(&session_id)
        .await
        .expect("Linode disconnect should succeed");
    assert!(service.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn ovh_public_sessions_exclude_secrets_and_disconnect_removes_state() {
    let state = OvhService::new();
    let mut service = state.lock().await;
    let session_id = service
        .connect_ovh(OvhConnectionConfig {
            api_key: OVH_API_SENTINEL.to_string(),
            app_secret: OVH_APP_SENTINEL.to_string(),
            consumer_key: OVH_CONSUMER_SENTINEL.to_string(),
            service_id: Some("service-a".to_string()),
            project_name: Some("project-a".to_string()),
            region: Some("GRA11".to_string()),
        })
        .await
        .expect("OVH session should be created");

    let public = OvhSessionStatus::from(
        service
            .get_session(&session_id)
            .await
            .expect("OVH session should exist"),
    );
    let serialized =
        serde_json::to_string(&public).expect("OVH public session should serialize");
    for sentinel in [
        OVH_API_SENTINEL,
        OVH_APP_SENTINEL,
        OVH_CONSUMER_SENTINEL,
    ] {
        assert!(!serialized.contains(sentinel));
    }
    let serialized_list = serde_json::to_string(
        &service
            .get_sessions()
            .into_iter()
            .map(OvhSessionStatus::from)
            .collect::<Vec<_>>(),
    )
    .expect("OVH public session list should serialize");
    for sentinel in [
        OVH_API_SENTINEL,
        OVH_APP_SENTINEL,
        OVH_CONSUMER_SENTINEL,
    ] {
        assert!(!serialized_list.contains(sentinel));
    }

    service
        .disconnect_ovh(&session_id)
        .await
        .expect("OVH disconnect should succeed");
    assert!(service.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn digital_ocean_public_sessions_exclude_secrets_and_disconnect_removes_state() {
    let state = DigitalOceanService::new();
    let mut service = state.lock().await;
    let session_id = service
        .connect_digital_ocean(DigitalOceanConnectionConfig {
            api_token: DIGITAL_OCEAN_SENTINEL.to_string(),
            region: Some("lon1".to_string()),
        })
        .await
        .expect("DigitalOcean session should be created");

    let public = DigitalOceanSessionStatus::from(
        service
            .get_session(&session_id)
            .await
            .expect("DigitalOcean session should exist"),
    );
    let serialized =
        serde_json::to_string(&public).expect("DigitalOcean public session should serialize");
    assert!(!serialized.contains(DIGITAL_OCEAN_SENTINEL));
    let serialized_list = serde_json::to_string(
        &service
            .get_sessions()
            .into_iter()
            .map(DigitalOceanSessionStatus::from)
            .collect::<Vec<_>>(),
    )
    .expect("DigitalOcean public session list should serialize");
    assert!(!serialized_list.contains(DIGITAL_OCEAN_SENTINEL));

    service
        .disconnect_digital_ocean(&session_id)
        .await
        .expect("DigitalOcean disconnect should succeed");
    assert!(service.get_session(&session_id).await.is_none());
}
