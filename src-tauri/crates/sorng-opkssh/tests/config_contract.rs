use sorng_opkssh::providers;
use sorng_opkssh::OpksshService;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{}-{stamp}", std::process::id()))
}

#[tokio::test(flavor = "current_thread")]
async fn explicit_config_paths_keep_plaintext_on_disk_but_redact_service_transport_state() {
    let temp_dir = unique_temp_dir("sorng-opkssh-config-contract");
    let config_path = temp_dir.join("config.yml");
    std::fs::create_dir_all(&temp_dir).expect("create test config dir");

    let yaml = r#"default: google
providers:
  - alias: google
    issuer: https://accounts.google.com
    client_id: file-client
    client_secret: file-secret
    scopes: openid email
  - alias: gitlab
    issuer: https://gitlab.com
    client_id: gitlab-client
"#;
    tokio::fs::write(&config_path, yaml)
        .await
        .expect("write client config");

    let loaded = providers::load_client_config(Some(config_path.to_string_lossy().as_ref()))
        .await
        .expect("load explicit config path");
    assert_eq!(loaded.default_provider.as_deref(), Some("google"));
    assert_eq!(loaded.providers.len(), 2);
    assert_eq!(loaded.providers[0].client_secret.as_deref(), Some("file-secret"));

    let mut service = OpksshService::new();
    service
        .update_client_config(loaded.clone())
        .await
        .expect("cache explicit config via service");

    let transport = service
        .get_client_config()
        .expect("cached redacted config");
    assert_eq!(transport.default_provider.as_deref(), Some("google"));
    assert_eq!(transport.providers.len(), 2);
    assert!(transport.provider_secrets_present);
    assert!(transport.secrets_redacted_for_transport);
    assert!(transport
        .secret_storage_note
        .as_deref()
        .is_some_and(|note| {
            note.contains("plaintext")
                && note.contains("unencrypted")
                && note.contains("redacted updates")
        }));

    let google = transport
        .providers
        .iter()
        .find(|provider| provider.alias == "google")
        .expect("google provider present");
    assert_eq!(google.client_secret, None);
    assert!(google.client_secret_present);
    assert!(google.client_secret_redacted);

    let persisted = providers::load_client_config(Some(config_path.to_string_lossy().as_ref()))
        .await
        .expect("reload persisted config");
    let persisted_google = persisted
        .providers
        .iter()
        .find(|provider| provider.alias == "google")
        .expect("persisted google provider");
    assert_eq!(persisted_google.client_secret.as_deref(), Some("file-secret"));
    assert_eq!(persisted.default_provider.as_deref(), Some("google"));

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}