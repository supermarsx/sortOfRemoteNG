use sorng_keepass::keepass::service::{DatabaseInstance, KeePassService};
use sorng_keepass::keepass::types::{
    ConflictResolution, CreateDatabaseRequest, KdfSettings, KeePassCipher, KeePassCompression,
    KeePassDatabase, MergeConfig, OpenDatabaseRequest,
};
use std::collections::HashMap;
use std::path::PathBuf;

struct FixtureDir {
    path: PathBuf,
}

impl FixtureDir {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("sorng-keepass-contract-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).expect("create fixture directory");
        Self { path }
    }
}

impl Drop for FixtureDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn create_request(path: &std::path::Path) -> CreateDatabaseRequest {
    CreateDatabaseRequest {
        file_path: path.to_string_lossy().to_string(),
        name: "Contract Vault".into(),
        description: None,
        password: Some("correct horse battery staple".into()),
        key_file_path: None,
        cipher: None,
        kdf: None,
        compression: None,
        default_username: None,
        enable_recycle_bin: Some(true),
    }
}

fn synthetic_database(path: &std::path::Path, id: &str, modified: bool) -> DatabaseInstance {
    DatabaseInstance::new_empty(KeePassDatabase {
        id: id.into(),
        file_path: path.to_string_lossy().to_string(),
        name: "Synthetic test database".into(),
        description: String::new(),
        default_username: String::new(),
        locked: false,
        modified,
        format_version: "4.1".into(),
        cipher: KeePassCipher::default(),
        kdf: KdfSettings::default(),
        compression: KeePassCompression::default(),
        root_group_id: "root".into(),
        recycle_bin_id: None,
        recycle_bin_enabled: false,
        color: None,
        master_seed: None,
        entry_count: 0,
        group_count: 1,
        created_at: "2026-01-01T00:00:00Z".into(),
        modified_at: "2026-01-01T00:00:00Z".into(),
        last_opened_at: "2026-01-01T00:00:00Z".into(),
        custom_icon_count: 0,
        custom_data: HashMap::new(),
    })
}

#[tokio::test]
async fn unsupported_create_writes_nothing_and_registers_nothing() {
    let fixture = FixtureDir::new();
    let path = fixture.path.join("contract.kdbx");
    let state = KeePassService::new();
    let mut service = state.lock().await;

    let error = service
        .create_database(create_request(&path))
        .expect_err("unsupported KDBX creation must fail closed");
    assert!(error.contains("not implemented"));
    assert!(!path.exists(), "create must not write a placeholder file");
    assert_eq!(service.open_database_count(), 0);
}

#[tokio::test]
async fn invalid_or_unsupported_kdbx_open_never_registers_database() {
    let fixture = FixtureDir::new();
    let invalid_path = fixture.path.join("invalid.kdbx");
    std::fs::write(&invalid_path, b"not a kdbx file").expect("write invalid fixture");
    let valid_header_path = fixture.path.join("header-only.kdbx");
    std::fs::write(
        &valid_header_path,
        [0x03, 0xD9, 0xA2, 0x9A, 0x67, 0xFB, 0x4B, 0xB5],
    )
    .expect("write KDBX header fixture");
    let state = KeePassService::new();
    let mut service = state.lock().await;

    let invalid_error = service
        .open_database(OpenDatabaseRequest {
            file_path: invalid_path.to_string_lossy().to_string(),
            password: Some("password".into()),
            key_file_path: None,
            read_only: Some(true),
        })
        .expect_err("invalid signature must fail");
    assert!(invalid_error.contains("Invalid KeePass KDBX"));
    assert_eq!(service.open_database_count(), 0);

    let unsupported_error = service
        .open_database(OpenDatabaseRequest {
            file_path: valid_header_path.to_string_lossy().to_string(),
            password: Some("password".into()),
            key_file_path: None,
            read_only: Some(true),
        })
        .expect_err("unimplemented parser must not fabricate an open database");
    assert!(unsupported_error.contains("not implemented"));
    assert_eq!(service.open_database_count(), 0);
}

#[tokio::test]
async fn persistence_operations_fail_closed_without_mutation_or_files() {
    let fixture = FixtureDir::new();
    let source = fixture.path.join("source.kdbx");
    let backup_dir = fixture.path.join("backups");
    let state = KeePassService::new();
    let mut service = state.lock().await;
    service.register_database(synthetic_database(&source, "synthetic", false));

    let save_error = service
        .save_database("synthetic", None)
        .expect_err("unsupported KDBX save must fail");
    assert!(save_error.contains("not implemented"));

    let backup_error = service
        .backup_database("synthetic", Some(backup_dir.to_string_lossy().as_ref()))
        .expect_err("unsupported KDBX backup must fail");
    assert!(backup_error.contains("not implemented"));
    assert!(!backup_dir.exists());

    let key_error = service
        .change_master_key("synthetic", Some("old"), None, Some("new"), None)
        .expect_err("unsupported master-key change must fail");
    assert!(key_error.contains("not implemented"));

    let merge_error = service
        .merge_database(
            "synthetic",
            MergeConfig {
                remote_path: fixture
                    .path
                    .join("remote.kdbx")
                    .to_string_lossy()
                    .to_string(),
                remote_password: Some("remote".into()),
                remote_key_file: None,
                conflict_resolution: ConflictResolution::PreferNewer,
                sync_deletions: true,
                merge_custom_icons: true,
            },
        )
        .expect_err("unsupported KDBX merge must fail");
    assert!(merge_error.contains("not implemented"));
    assert!(!service.get_database("synthetic").unwrap().info.modified);
}

#[tokio::test]
async fn close_all_propagates_save_failure_and_shutdown_discards_all() {
    let fixture = FixtureDir::new();
    let state = KeePassService::new();
    let mut service = state.lock().await;
    service.register_database(synthetic_database(
        &fixture.path.join("one.kdbx"),
        "one",
        true,
    ));
    service.register_database(synthetic_database(
        &fixture.path.join("two.kdbx"),
        "two",
        true,
    ));

    let error = service
        .close_all_databases(true)
        .expect_err("save-first close-all must propagate unsupported save");
    assert!(error.contains("not implemented"));
    assert_eq!(service.open_database_count(), 2);

    let closed = service.shutdown();
    assert_eq!(closed.len(), 2);
    assert_eq!(service.open_database_count(), 0);
}
