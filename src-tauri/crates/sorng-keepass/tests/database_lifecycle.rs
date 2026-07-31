use sorng_keepass::keepass::service::{DatabaseInstance, KeePassService};
use sorng_keepass::keepass::types::{
    CreateDatabaseRequest, KdfAlgorithm, KdfSettings, OpenDatabaseRequest,
};
use std::path::PathBuf;

struct FixtureDir {
    path: PathBuf,
}

impl FixtureDir {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("sorng-keepass-lifecycle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).expect("create fixture directory");
        Self { path }
    }
}

impl Drop for FixtureDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn create_request(path: &std::path::Path, password: &str) -> CreateDatabaseRequest {
    CreateDatabaseRequest {
        file_path: path.to_string_lossy().to_string(),
        name: "Lifecycle Vault".into(),
        description: Some("Durable KDBX lifecycle test".into()),
        password: Some(password.into()),
        key_file_path: None,
        cipher: None,
        kdf: Some(KdfSettings {
            algorithm: KdfAlgorithm::Argon2id,
            iterations: Some(1),
            memory: Some(8 * 1024 * 1024),
            parallelism: Some(1),
            salt: None,
        }),
        compression: None,
        default_username: Some("operator".into()),
        enable_recycle_bin: Some(true),
    }
}

#[tokio::test]
async fn create_open_save_backup_and_rekey_are_durable() {
    let fixture = FixtureDir::new();
    let path = fixture.path.join("lifecycle.kdbx");
    let state = KeePassService::new();
    let mut service = state.lock().await;

    let created = service
        .create_database(create_request(&path, "initial password"))
        .expect("create KDBX4 database");
    assert!(path.is_file());
    assert_eq!(
        &std::fs::read(&path).expect("read signature")[..8],
        &[0x03, 0xD9, 0xA2, 0x9A, 0x67, 0xFB, 0x4B, 0xB5]
    );

    service
        .update_database_metadata(&created.id, Some("Renamed Vault"), None, None, None, None)
        .expect("update metadata");
    service
        .save_database(&created.id, None)
        .expect("durably save database");
    let backup = service
        .backup_database(&created.id, None)
        .expect("create durable backup");
    assert!(std::path::Path::new(&backup).is_file());

    service
        .change_master_key(
            &created.id,
            Some("initial password"),
            None,
            Some("replacement password"),
            None,
        )
        .expect("durably change master key");
    service
        .close_database(&created.id, false)
        .expect("close database");

    let old_key_error = service
        .open_database(OpenDatabaseRequest {
            file_path: path.to_string_lossy().to_string(),
            password: Some("initial password".into()),
            key_file_path: None,
            read_only: None,
        })
        .expect_err("old master key must no longer open database");
    assert!(old_key_error.contains("Failed to open KeePass database"));

    let reopened = service
        .open_database(OpenDatabaseRequest {
            file_path: path.to_string_lossy().to_string(),
            password: Some("replacement password".into()),
            key_file_path: None,
            read_only: None,
        })
        .expect("new master key opens database");
    assert_eq!(reopened.name, "Renamed Vault");
}

#[tokio::test]
async fn external_source_change_blocks_overwrite() {
    let fixture = FixtureDir::new();
    let path = fixture.path.join("external-change.kdbx");
    let state = KeePassService::new();
    let mut service = state.lock().await;
    let created = service
        .create_database(create_request(&path, "password"))
        .expect("create database");

    std::fs::write(&path, b"externally replaced").expect("replace source");
    let error = service
        .save_database(&created.id, None)
        .expect_err("external change must block overwrite");
    assert!(error.contains("changed outside"));
    assert_eq!(
        std::fs::read(&path).expect("read external replacement"),
        b"externally replaced"
    );
}

#[tokio::test]
async fn synthetic_state_without_native_image_still_fails_closed() {
    let fixture = FixtureDir::new();
    let path = fixture.path.join("synthetic.kdbx");
    let state = KeePassService::new();
    let mut service = state.lock().await;
    let info = service
        .create_database(create_request(&path, "password"))
        .expect("create seed database");
    let mut synthetic: DatabaseInstance = service
        .unregister_database(&info.id)
        .expect("take database instance");
    synthetic.native_database = None;
    service.register_database(synthetic);

    let error = service
        .save_database(&info.id, None)
        .expect_err("missing native image must fail closed");
    assert!(error.contains("Native KDBX state is unavailable"));
}
