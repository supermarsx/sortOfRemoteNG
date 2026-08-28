//! Integration coverage for the `databases/**` leg of master-key
//! rotation, and for the retained key ring that backstops it (t74-e1).
//!
//! # The bug this file exists to prevent recurring
//!
//! `rotate_master_key_full_inner` used to re-encrypt `settings.enc`,
//! `storage.json`, backups, recordings and macros — and nothing under
//! `<app_data>/databases/`. Rotation then overwrote the vault entry and
//! deleted its rollback sidecars, so the old DEK ceased to exist while
//! every connection database, the database index, and every per-database
//! trust store were still wrapped under it. The report came back with an
//! empty `failures` list. The user's connection library was gone, silently.
//!
//! `report_counts_every_database_artifact` is the regression test that
//! would have caught it: it asserts the tallies are non-zero.
//!
//! Every test here drives the Tauri-agnostic helper directly, so no
//! Tauri runtime and no host keychain are involved (`vault_present:
//! false`, no password ⇒ the rotation refuses… so each test supplies a
//! password receipt, which keeps `dek.enc` as the durable receipt and
//! leaves the OS vault untouched).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::json;
use tempfile::tempdir;

use app_lib::encryption_rotation_commands::{
    rotate_master_key_full_inner, rotate_master_key_full_inner_with_injector, FullRotateReport,
};

use sorng_encryption::envelope::{self as enc_envelope, EnvelopeHeader, NONCE_LEN};
use sorng_encryption::key_ring;
use sorng_encryption::password_wrap::{self, Argon2Params};
use sorng_encryption::{ArtifactKind, EncryptionState, MasterDek};

use sorng_recording::service::{RecordingService, RecordingServiceState};
use sorng_storage::backup::{BackupService, BackupServiceState};
use sorng_storage::sdbf;
use sorng_storage::storage::{SecureStorage, SecureStorageState};

/// Cheap Argon2 so the password receipt does not dominate test runtime.
/// Rotation itself always uses `Argon2Params::OWASP`; this only affects
/// the `dek.enc` we plant as a precondition.
const TEST_ARGON: Argon2Params = Argon2Params {
    memory_kib: 8 * 1024,
    time_cost: 1,
    parallelism: 1,
};

const PASSWORD: &str = "correct horse battery staple";

// ══════════════════════════════════════════════════════════════════
// Fixture
// ══════════════════════════════════════════════════════════════════

struct Fixture {
    _temp: tempfile::TempDir,
    app_data: PathBuf,
    databases: PathBuf,
    enc_state: Arc<EncryptionState>,
    storage_state: SecureStorageState,
    backup_state: BackupServiceState,
    recording_state: RecordingServiceState,
    old_dek_bytes: [u8; 32],
}

impl Fixture {
    async fn new(seed: u8) -> Self {
        let temp = tempdir().expect("temp app data");
        let app_data = temp.path().to_path_buf();
        let databases = app_data.join("databases");
        std::fs::create_dir_all(&databases).expect("databases dir");
        std::fs::create_dir_all(app_data.join("backups")).expect("backup dir");

        let old_dek_bytes = [seed; 32];
        let enc_state = Arc::new(EncryptionState::new());
        enc_state
            .install(MasterDek::from_bytes(&old_dek_bytes).expect("old DEK"))
            .await;

        // A durable receipt is a precondition of rotation. Password mode
        // keeps everything on disk and the OS keychain out of the test.
        let blob = password_wrap::wrap(
            PASSWORD,
            &MasterDek::from_bytes(&old_dek_bytes).expect("receipt DEK"),
            TEST_ARGON,
        )
        .expect("wrap dek.enc");
        std::fs::write(app_data.join("dek.enc"), blob).expect("write dek.enc");

        let storage_state =
            SecureStorage::new(app_data.join("storage.json").to_string_lossy().to_string());
        storage_state
            .lock()
            .await
            .set_encryption_state(enc_state.clone());
        let backup_state =
            BackupService::new(app_data.join("backups").to_string_lossy().to_string());
        let recording_service = RecordingService::new(&app_data.to_string_lossy());
        recording_service
            .set_encryption_state(enc_state.clone())
            .await;

        Self {
            _temp: temp,
            app_data,
            databases,
            enc_state,
            storage_state,
            backup_state,
            recording_state: Arc::new(tokio::sync::Mutex::new(recording_service)),
            old_dek_bytes,
        }
    }

    async fn rotate(&self) -> Result<FullRotateReport, String> {
        rotate_master_key_full_inner(
            &self.app_data,
            &self.enc_state,
            &self.storage_state,
            &self.backup_state,
            &self.recording_state,
            Some(PASSWORD.to_string()),
            false,
        )
        .await
    }

    async fn rotate_failing_at(
        &self,
        target_artifact: &str,
        target_file: &str,
    ) -> Result<FullRotateReport, String> {
        let injector = move |artifact: &str, path: &Path| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if artifact == target_artifact && name == target_file {
                Some("injected staging failure".to_string())
            } else {
                None
            }
        };
        rotate_master_key_full_inner_with_injector(
            &self.app_data,
            &self.enc_state,
            &self.storage_state,
            &self.backup_state,
            &self.recording_state,
            Some(PASSWORD.to_string()),
            false,
            &injector,
        )
        .await
    }

    fn path(&self, name: &str) -> PathBuf {
        self.databases.join(name)
    }
}

// ══════════════════════════════════════════════════════════════════
// Helpers: plant and read `databases/**` files at the byte level
// ══════════════════════════════════════════════════════════════════

/// Write `SDBF preamble || SORNG envelope(value)` — exactly the shape
/// `save_payload` produces at runtime.
async fn plant_encrypted(
    path: &Path,
    state: &EncryptionState,
    artifact: ArtifactKind,
    value: &serde_json::Value,
) {
    let plain = serde_json::to_vec(value).expect("serialise");
    let sub_key = state.sub_key(artifact).await.expect("unlocked");
    let envelope = enc_envelope::write_envelope(
        &sub_key,
        &EnvelopeHeader::new_vault([3u8; NONCE_LEN]),
        &plain,
    )
    .expect("seal");
    write_sdbf(path, &envelope);
}

/// Write `SDBF preamble || raw JSON` — a legacy plaintext-P1 file from
/// before encryption-at-rest existed.
fn plant_plaintext(path: &Path, value: &serde_json::Value) {
    let plain = serde_json::to_vec(value).expect("serialise");
    write_sdbf(path, &plain);
}

fn write_sdbf(path: &Path, payload: &[u8]) {
    let mut out = Vec::with_capacity(sdbf::PREAMBLE_LEN + payload.len());
    out.extend_from_slice(&sdbf::encode_preamble(payload));
    out.extend_from_slice(payload);
    std::fs::write(path, out).expect("write database file");
}

/// Read a `databases/**` file and decrypt it under `state`. Returns an
/// error string when the file is not readable under that key — which is
/// what "this DEK no longer opens the file" looks like from a caller.
async fn open_under(
    path: &Path,
    state: &EncryptionState,
    artifact: ArtifactKind,
) -> Result<serde_json::Value, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let payload = sdbf::parse_and_verify(&bytes).map_err(|e| e.to_string())?;
    let sub_key = state.sub_key(artifact).await.ok_or("locked")?;
    let (_h, plain) =
        enc_envelope::read_envelope(&sub_key, payload).map_err(|e| format!("decrypt: {e}"))?;
    serde_json::from_slice(&plain).map_err(|e| e.to_string())
}

/// Is the payload inside this SDBF container a SORNG envelope (as
/// opposed to legacy plaintext JSON)?
fn is_encrypted_on_disk(path: &Path) -> bool {
    let bytes = std::fs::read(path).expect("read");
    let payload = sdbf::parse_and_verify(&bytes).expect("verify");
    payload.len() >= enc_envelope::MAGIC.len()
        && &payload[..enc_envelope::MAGIC.len()] == enc_envelope::MAGIC
}

async fn state_from(bytes: &[u8; 32]) -> EncryptionState {
    let state = EncryptionState::new();
    state
        .install(MasterDek::from_bytes(bytes).expect("dek"))
        .await;
    state
}

/// Every rotation sidecar this module can leave behind. A clean run and
/// a clean abort must both leave zero of them.
fn leaked_sidecars(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .expect("read databases dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            name.contains(".sorng-rotation-")
                || name.ends_with(".rotating")
                || name.ends_with(".rollback")
        })
        .collect()
}

// ══════════════════════════════════════════════════════════════════
// (i) The whole databases tree is re-keyed
// ══════════════════════════════════════════════════════════════════

#[tokio::test]
async fn rotation_re_keys_index_payloads_and_trust_stores() {
    let fx = Fixture::new(0x11).await;

    let index = json!([{ "id": "db-a", "name": "A" }, { "id": "db-b", "name": "B" }]);
    let db_a = json!({ "connections": [{ "id": "c1", "host": "a.example" }] });
    let db_b = json!({ "connections": [{ "id": "c2", "host": "b.example" }] });
    let trust_a = json!({ "records": [{ "host": "a.example", "fingerprint": "aa" }] });
    let trust_b = json!({ "records": [{ "host": "b.example", "fingerprint": "bb" }] });

    plant_encrypted(
        &fx.path("index.json"),
        &fx.enc_state,
        ArtifactKind::DatabasesIndex,
        &index,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &db_a,
    )
    .await;
    plant_encrypted(
        &fx.path("db-b.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &db_b,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.trust.json"),
        &fx.enc_state,
        ArtifactKind::TrustStore,
        &trust_a,
    )
    .await;
    plant_encrypted(
        &fx.path("db-b.trust.json"),
        &fx.enc_state,
        ArtifactKind::TrustStore,
        &trust_b,
    )
    .await;

    let old = state_from(&fx.old_dek_bytes).await;
    let report = fx.rotate().await.expect("rotation");
    assert!(
        report.failures.is_empty(),
        "unexpected failures: {:?}",
        report.failures
    );

    // The live state now holds DEK B. Every file must open under it,
    // with its content preserved byte-for-byte in JSON terms.
    let new = &fx.enc_state;
    assert_eq!(
        open_under(&fx.path("index.json"), new, ArtifactKind::DatabasesIndex)
            .await
            .expect("index under new key"),
        index
    );
    assert_eq!(
        open_under(&fx.path("db-a.json"), new, ArtifactKind::Connections)
            .await
            .expect("db-a under new key"),
        db_a
    );
    assert_eq!(
        open_under(&fx.path("db-b.json"), new, ArtifactKind::Connections)
            .await
            .expect("db-b under new key"),
        db_b
    );
    assert_eq!(
        open_under(&fx.path("db-a.trust.json"), new, ArtifactKind::TrustStore)
            .await
            .expect("trust-a under new key"),
        trust_a
    );
    assert_eq!(
        open_under(&fx.path("db-b.trust.json"), new, ArtifactKind::TrustStore)
            .await
            .expect("trust-b under new key"),
        trust_b
    );

    // …and the old DEK must no longer authenticate any of them.
    for (name, artifact) in [
        ("index.json", ArtifactKind::DatabasesIndex),
        ("db-a.json", ArtifactKind::Connections),
        ("db-b.json", ArtifactKind::Connections),
        ("db-a.trust.json", ArtifactKind::TrustStore),
        ("db-b.trust.json", ArtifactKind::TrustStore),
    ] {
        assert!(
            open_under(&fx.path(name), &old, artifact).await.is_err(),
            "{name} still opens under the retired DEK"
        );
    }

    assert!(leaked_sidecars(&fx.databases).is_empty());
}

// ══════════════════════════════════════════════════════════════════
// (ii) Recovery generations are re-keyed too
// ══════════════════════════════════════════════════════════════════

#[tokio::test]
async fn rotation_re_keys_bak_and_v0_bak_generations() {
    let fx = Fixture::new(0x22).await;

    let current = json!({ "generation": "current" });
    let previous = json!({ "generation": "bak" });
    let migration = json!({ "generation": "v0" });
    let index_bak = json!([{ "id": "db-a", "name": "A (previous)" }]);

    plant_encrypted(
        &fx.path("index.json"),
        &fx.enc_state,
        ArtifactKind::DatabasesIndex,
        &json!([{ "id": "db-a", "name": "A" }]),
    )
    .await;
    plant_encrypted(
        &fx.path("index.json.bak"),
        &fx.enc_state,
        ArtifactKind::DatabasesIndex,
        &index_bak,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &current,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.json.bak"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &previous,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.json.v0.bak"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &migration,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.trust.json.bak"),
        &fx.enc_state,
        ArtifactKind::TrustStore,
        &json!({ "records": [] }),
    )
    .await;

    // An abandoned write-in-progress file. Not re-encrypted (no reader
    // consults it) and cleaned up once the rotation commits.
    std::fs::write(fx.path("db-a.json.tmp"), b"garbage-in-progress").expect("write tmp");

    let report = fx.rotate().await.expect("rotation");
    assert!(report.failures.is_empty(), "{:?}", report.failures);

    // 4 generations: index.json.bak, db-a.json.bak, db-a.json.v0.bak,
    // db-a.trust.json.bak.
    assert_eq!(report.database_generations_rewritten, 4);

    let new = &fx.enc_state;
    assert_eq!(
        open_under(&fx.path("db-a.json.bak"), new, ArtifactKind::Connections)
            .await
            .expect(".bak under new key"),
        previous
    );
    assert_eq!(
        open_under(&fx.path("db-a.json.v0.bak"), new, ArtifactKind::Connections)
            .await
            .expect(".v0.bak under new key"),
        migration
    );
    assert_eq!(
        open_under(
            &fx.path("index.json.bak"),
            new,
            ArtifactKind::DatabasesIndex
        )
        .await
        .expect("index .bak under new key"),
        index_bak
    );
    assert!(open_under(
        &fx.path("db-a.trust.json.bak"),
        new,
        ArtifactKind::TrustStore
    )
    .await
    .is_ok());

    // Force the read ladder onto the `.bak`: destroy the current
    // generation and confirm the SDBF cascade still yields real data
    // under the new key.
    std::fs::remove_file(fx.path("db-a.json")).expect("drop current generation");
    let (payload, source) = sdbf::safe_read_raw(&fx.path("db-a.json"))
        .expect("ladder read")
        .expect("a surviving generation");
    assert_eq!(source, sdbf::LoadSource::Backup);
    let sub_key = new.sub_key(ArtifactKind::Connections).await.unwrap();
    let (_h, plain) = enc_envelope::read_envelope(&sub_key, &payload)
        .expect("ladder-served .bak opens under the new key");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&plain).unwrap(),
        previous
    );

    assert!(
        !fx.path("db-a.json.tmp").exists(),
        "abandoned .tmp should be cleaned up after a committed rotation"
    );
    assert!(leaked_sidecars(&fx.databases).is_empty());
}

// ══════════════════════════════════════════════════════════════════
// (iii) Legacy plaintext is promoted, not skipped
// ══════════════════════════════════════════════════════════════════

#[tokio::test]
async fn rotation_promotes_legacy_plaintext_databases() {
    let fx = Fixture::new(0x33).await;

    let legacy = json!({ "connections": [{ "id": "legacy-1", "host": "old.example" }] });
    plant_plaintext(&fx.path("db-legacy.json"), &legacy);
    plant_plaintext(&fx.path("index.json"), &json!([{ "id": "db-legacy" }]));
    assert!(!is_encrypted_on_disk(&fx.path("db-legacy.json")));

    let report = fx.rotate().await.expect("rotation");
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(report.databases_rewritten, 1);
    assert!(report.database_index_rewritten);

    assert!(
        is_encrypted_on_disk(&fx.path("db-legacy.json")),
        "a legacy plaintext database must be promoted to an envelope, not skipped"
    );
    assert_eq!(
        open_under(
            &fx.path("db-legacy.json"),
            &fx.enc_state,
            ArtifactKind::Connections
        )
        .await
        .expect("promoted database opens under the new key"),
        legacy
    );
}

// ══════════════════════════════════════════════════════════════════
// (iv) Abort mid-rotation leaves everything on the old key
// ══════════════════════════════════════════════════════════════════

#[tokio::test]
async fn a_failure_in_the_databases_step_aborts_the_whole_rotation() {
    let fx = Fixture::new(0x44).await;

    let index = json!([{ "id": "db-a" }, { "id": "db-b" }]);
    let db_a = json!({ "connections": [{ "id": "c1" }] });
    let db_b = json!({ "connections": [{ "id": "c2" }] });
    let trust = json!({ "records": [{ "host": "a.example" }] });

    plant_encrypted(
        &fx.path("index.json"),
        &fx.enc_state,
        ArtifactKind::DatabasesIndex,
        &index,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &db_a,
    )
    .await;
    plant_encrypted(
        &fx.path("db-b.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &db_b,
    )
    .await;
    plant_encrypted(
        &fx.path("db-a.trust.json"),
        &fx.enc_state,
        ArtifactKind::TrustStore,
        &trust,
    )
    .await;

    let before: Vec<Vec<u8>> = ["index.json", "db-a.json", "db-b.json", "db-a.trust.json"]
        .iter()
        .map(|n| std::fs::read(fx.path(n)).unwrap())
        .collect();
    let dek_enc_before = std::fs::read(fx.app_data.join("dek.enc")).unwrap();

    // `db-b.json` sorts after `db-a.json`, so the injected failure lands
    // *after* several database files have already been staged — the
    // partial-progress case, which is the one that must not commit.
    let report = fx
        .rotate_failing_at("database", "db-b.json")
        .await
        .expect("rotation returns a report rather than erroring");

    assert_eq!(report.failures.len(), 1, "{:?}", report.failures);
    assert_eq!(report.failures[0].artifact, "database");
    assert!(report.failures[0].path.ends_with("db-b.json"));

    // Tallies are zeroed so no caller can mistake an aborted run for a
    // partial success.
    assert_eq!(report.databases_rewritten, 0);
    assert_eq!(report.trust_stores_rewritten, 0);
    assert_eq!(report.database_generations_rewritten, 0);
    assert!(!report.database_index_rewritten);
    assert!(!report.key_ring_updated);
    assert!(!report.vault_updated);
    assert!(!report.dek_enc_updated);

    // Canonical bytes are byte-identical, the old DEK is still live, and
    // the persisted receipt is untouched.
    let after: Vec<Vec<u8>> = ["index.json", "db-a.json", "db-b.json", "db-a.trust.json"]
        .iter()
        .map(|n| std::fs::read(fx.path(n)).unwrap())
        .collect();
    assert_eq!(before, after, "an aborted rotation mutated canonical bytes");
    assert_eq!(
        dek_enc_before,
        std::fs::read(fx.app_data.join("dek.enc")).unwrap(),
        "an aborted rotation rewrote the key receipt"
    );

    let old = state_from(&fx.old_dek_bytes).await;
    assert_eq!(
        open_under(&fx.path("db-a.json"), &old, ArtifactKind::Connections)
            .await
            .expect("db-a still opens under the ORIGINAL key"),
        db_a
    );
    assert_eq!(
        open_under(&fx.path("db-b.json"), &old, ArtifactKind::Connections)
            .await
            .expect("db-b still opens under the ORIGINAL key"),
        db_b
    );
    assert_eq!(
        open_under(&fx.path("index.json"), &old, ArtifactKind::DatabasesIndex)
            .await
            .expect("index still opens under the ORIGINAL key"),
        index
    );
    assert_eq!(
        open_under(&fx.path("db-a.trust.json"), &old, ArtifactKind::TrustStore)
            .await
            .expect("trust store still opens under the ORIGINAL key"),
        trust
    );
    assert!(
        fx.enc_state.is_unlocked().await
            && fx.enc_state.master_bytes_raw().await == Some(fx.old_dek_bytes),
        "the live state must still hold the ORIGINAL DEK after an abort"
    );

    assert!(
        leaked_sidecars(&fx.databases).is_empty(),
        "aborted rotation leaked sidecars: {:?}",
        leaked_sidecars(&fx.databases)
    );

    // And the profile is still rotatable: retrying without the injected
    // fault completes and re-keys everything.
    let retry = fx.rotate().await.expect("retry");
    assert!(retry.failures.is_empty(), "{:?}", retry.failures);
    assert_eq!(retry.databases_rewritten, 2);
    assert_eq!(
        open_under(
            &fx.path("db-b.json"),
            &fx.enc_state,
            ArtifactKind::Connections
        )
        .await
        .expect("db-b after the successful retry"),
        db_b
    );
}

#[tokio::test]
async fn a_failure_staging_the_key_ring_aborts_the_rotation() {
    let fx = Fixture::new(0x45).await;
    let db = json!({ "connections": [] });
    plant_encrypted(
        &fx.path("db-a.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &db,
    )
    .await;

    let report = fx
        .rotate_failing_at("key-ring", key_ring::KEY_RING_FILENAME)
        .await
        .expect("report");
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.failures[0].artifact, "key-ring");
    assert_eq!(report.databases_rewritten, 0);

    let old = state_from(&fx.old_dek_bytes).await;
    assert_eq!(
        open_under(&fx.path("db-a.json"), &old, ArtifactKind::Connections)
            .await
            .expect("database still opens under the ORIGINAL key"),
        db
    );
}

// ══════════════════════════════════════════════════════════════════
// (v) Regression: the report must say databases were covered
// ══════════════════════════════════════════════════════════════════

/// **This is the test that would have caught the shipped bug.** Before
/// t74 the rotation report had no database tallies at all and
/// `connectionsRewritten` referred to `storage.json`, not to anything
/// under `databases/`. A green rotation with zero databases rewritten,
/// on a profile that plainly has databases, is a silent data-loss event.
#[tokio::test]
async fn report_counts_every_database_artifact() {
    let fx = Fixture::new(0x55).await;

    plant_encrypted(
        &fx.path("index.json"),
        &fx.enc_state,
        ArtifactKind::DatabasesIndex,
        &json!([{ "id": "db-a" }, { "id": "db-b" }, { "id": "db-c" }]),
    )
    .await;
    for id in ["db-a", "db-b", "db-c"] {
        plant_encrypted(
            &fx.path(&format!("{id}.json")),
            &fx.enc_state,
            ArtifactKind::Connections,
            &json!({ "id": id }),
        )
        .await;
    }
    for id in ["db-a", "db-b"] {
        plant_encrypted(
            &fx.path(&format!("{id}.trust.json")),
            &fx.enc_state,
            ArtifactKind::TrustStore,
            &json!({ "records": [] }),
        )
        .await;
    }
    plant_encrypted(
        &fx.path("db-a.json.bak"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &json!({ "id": "db-a", "generation": "bak" }),
    )
    .await;

    let report = fx.rotate().await.expect("rotation");

    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_ne!(
        report.databases_rewritten, 0,
        "rotation reported success without re-keying a single connection database"
    );
    assert_eq!(report.databases_rewritten, 3);
    assert_eq!(report.trust_stores_rewritten, 2);
    assert_eq!(report.database_generations_rewritten, 1);
    assert!(report.database_index_rewritten);
    assert!(report.bytes_rewritten > 0);
}

#[tokio::test]
async fn a_profile_with_no_databases_directory_rotates_cleanly() {
    let fx = Fixture::new(0x56).await;
    std::fs::remove_dir_all(&fx.databases).expect("remove databases dir");

    let report = fx.rotate().await.expect("rotation");
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(report.databases_rewritten, 0);
    assert_eq!(report.trust_stores_rewritten, 0);
    assert!(!report.database_index_rewritten);
    // The ring is still maintained — it lives in the app data root.
    assert!(report.key_ring_updated);
}

// ══════════════════════════════════════════════════════════════════
// Retained key ring
// ══════════════════════════════════════════════════════════════════

#[tokio::test]
async fn the_ring_retains_the_outgoing_key_and_stays_encrypted() {
    let fx = Fixture::new(0x66).await;
    plant_encrypted(
        &fx.path("db-a.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &json!({ "id": "db-a" }),
    )
    .await;

    let report = fx.rotate().await.expect("rotation");
    assert!(report.key_ring_updated);
    assert_eq!(report.key_ring_retained, 1);

    let ring_file = key_ring::ring_path(&fx.app_data);
    let bytes = std::fs::read(&ring_file).expect("ring on disk");
    assert_eq!(&bytes[..enc_envelope::MAGIC.len()], enc_envelope::MAGIC);
    assert!(
        !bytes.windows(32).any(|w| w == fx.old_dek_bytes),
        "the retired DEK must never be at rest in the clear"
    );

    let ring = key_ring::load(&ring_file, &fx.enc_state)
        .await
        .expect("ring opens under the current key");
    assert_eq!(ring.len(), 1);
    assert_eq!(
        ring.keys()[0]
            .as_master_dek()
            .unwrap()
            .sub_key(ArtifactKind::Connections)
            .bytes(),
        MasterDek::from_bytes(&fx.old_dek_bytes)
            .unwrap()
            .sub_key(ArtifactKind::Connections)
            .bytes(),
        "the ring must hold the DEK the rotation superseded"
    );
}

/// The whole point of the ring: a file that some rotation *missed*
/// still opens. Simulated by planting a file under the original key and
/// then rotating repeatedly with that file hidden from the walk, so no
/// rotation ever re-keys it.
#[tokio::test]
async fn a_file_missed_by_rotation_still_opens_via_the_ring_for_five_rotations() {
    let fx = Fixture::new(0x77).await;
    let orphan_payload = json!({ "connections": [{ "id": "rescued" }] });

    // Planted outside `databases/` so the walk cannot find it — this
    // stands in for "an artifact family rotation does not know about".
    let orphan = fx.app_data.join("orphan.bin");
    {
        let sub_key = fx
            .enc_state
            .sub_key(ArtifactKind::Connections)
            .await
            .unwrap();
        let plain = serde_json::to_vec(&orphan_payload).unwrap();
        let sealed = enc_envelope::write_envelope(
            &sub_key,
            &EnvelopeHeader::new_vault([9u8; NONCE_LEN]),
            &plain,
        )
        .unwrap();
        std::fs::write(&orphan, sealed).unwrap();
    }
    let sealed = std::fs::read(&orphan).unwrap();

    for round in 1..=key_ring::KEY_RING_CAPACITY {
        let report = fx.rotate().await.expect("rotation");
        assert!(report.failures.is_empty(), "{:?}", report.failures);
        assert_eq!(report.key_ring_retained as usize, round);

        // The current key does NOT open it — that is the missed-file state.
        let current = fx
            .enc_state
            .sub_key(ArtifactKind::Connections)
            .await
            .unwrap();
        assert!(enc_envelope::read_envelope(&current, &sealed).is_err());

        // …but the ring does, at every depth from N-1 through N-5.
        let ring = key_ring::load(&key_ring::ring_path(&fx.app_data), &fx.enc_state)
            .await
            .expect("ring");
        let (plain, position) = ring
            .try_open(ArtifactKind::Connections, &sealed)
            .unwrap_or_else(|| panic!("ring failed to rescue the file after {round} rotation(s)"));
        assert_eq!(position, round - 1, "expected the key at depth N-{round}");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&plain).unwrap(),
            orphan_payload
        );
    }

    // A sixth rotation evicts the original key. The ring stays bounded
    // and the artifact is now genuinely unrecoverable — the documented
    // limit of the window, not a defect.
    let report = fx.rotate().await.expect("rotation");
    assert_eq!(
        report.key_ring_retained as usize,
        key_ring::KEY_RING_CAPACITY
    );
    let ring = key_ring::load(&key_ring::ring_path(&fx.app_data), &fx.enc_state)
        .await
        .expect("ring");
    assert_eq!(ring.len(), key_ring::KEY_RING_CAPACITY);
    assert!(
        ring.try_open(ArtifactKind::Connections, &sealed).is_none(),
        "a key older than the retention window must not open the artifact"
    );
}

/// The ring is per-artifact-correct: it derives the same sub-key labels
/// as the live state, so a rescued trust store decodes as a trust store.
#[tokio::test]
async fn the_ring_rescues_each_artifact_kind_under_its_own_sub_key() {
    let fx = Fixture::new(0x88).await;
    let mut sealed = Vec::new();
    for (artifact, value) in [
        (ArtifactKind::Connections, json!({ "kind": "connections" })),
        (ArtifactKind::DatabasesIndex, json!({ "kind": "index" })),
        (ArtifactKind::TrustStore, json!({ "kind": "trust" })),
    ] {
        let sub_key = fx.enc_state.sub_key(artifact).await.unwrap();
        let blob = enc_envelope::write_envelope(
            &sub_key,
            &EnvelopeHeader::new_vault([1u8; NONCE_LEN]),
            &serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        sealed.push((artifact, value, blob));
    }

    fx.rotate().await.expect("rotation");
    let ring = key_ring::load(&key_ring::ring_path(&fx.app_data), &fx.enc_state)
        .await
        .expect("ring");

    for (artifact, value, blob) in &sealed {
        let (plain, _) = ring
            .try_open(*artifact, blob)
            .unwrap_or_else(|| panic!("ring failed to open {artifact:?}"));
        assert_eq!(
            &serde_json::from_slice::<serde_json::Value>(&plain).unwrap(),
            value
        );
        // A different artifact's sub-key must still fail — the ring does
        // not weaken artifact separation.
        let other = if *artifact == ArtifactKind::TrustStore {
            ArtifactKind::Connections
        } else {
            ArtifactKind::TrustStore
        };
        assert!(ring.try_open(other, blob).is_none());
    }
}

#[tokio::test]
async fn an_aborted_rotation_does_not_grow_the_ring() {
    let fx = Fixture::new(0x99).await;
    plant_encrypted(
        &fx.path("db-a.json"),
        &fx.enc_state,
        ArtifactKind::Connections,
        &json!({}),
    )
    .await;

    fx.rotate().await.expect("first rotation");
    let after_first = key_ring::load(&key_ring::ring_path(&fx.app_data), &fx.enc_state)
        .await
        .expect("ring")
        .len();
    assert_eq!(after_first, 1);

    let report = fx
        .rotate_failing_at("database", "db-a.json")
        .await
        .expect("report");
    assert!(!report.failures.is_empty());

    let after_abort = key_ring::load(&key_ring::ring_path(&fx.app_data), &fx.enc_state)
        .await
        .expect("ring still opens under the unchanged live key")
        .len();
    assert_eq!(
        after_abort, 1,
        "an aborted rotation must not retire a key that is still live"
    );
}
