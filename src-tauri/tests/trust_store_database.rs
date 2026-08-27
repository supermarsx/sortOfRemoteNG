//! t62 — cross-cutting integration tests for the per-database Trust Center.
//!
//! Unit tests inside `sorng-storage` already cover each runtime primitive in
//! isolation. What is asserted here is the *composition* an installed app
//! actually performs: a real [`TrustRuntime`] over a real `databases/`
//! directory, several user databases side by side, the encrypted and the
//! plaintext file mode, the two legacy sidecars migrating into two databases
//! with disjoint connection scopes, the synchronous verifier façade and the
//! async command service reading each other's writes, the delete hook
//! `delete_database_data` calls, and the `known_hosts` importer that spans
//! `sorng-ssh` and the storage runtime (t62-e3, `4066152d`).
//!
//! The runtime is process-global, so every test takes the guard returned by
//! `trust_store::test_support` (which holds a process-wide mutex) and never
//! takes it twice — the mutex is not reentrant.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use sorng_encryption::{ArtifactKind, EncryptionState, MasterDek};
use sorng_storage::envelope_io::is_envelope_blob;
use sorng_storage::sdbf;
use sorng_storage::trust_store::{
    self, test_support, CertIdentity, Identity, IdentityChangeReason, SshHostKeyIdentity,
    SyncTrustStore, TrustImportMode, TrustPolicy, TrustPolicyConfig, TrustRecord, TrustStoreData,
    TrustStoreService, TrustVerifyResult, CONNECTION_SCOPE_PREFIX, TRUST_EXPORT_VERSION,
};
use tempfile::TempDir;

// ── fixtures ────────────────────────────────────────────────────────────────

fn tls_identity(fingerprint: &str) -> Identity {
    let now = Utc::now().to_rfc3339();
    Identity::Tls(Box::new(CertIdentity {
        fingerprint: fingerprint.to_string(),
        subject: Some("CN=fixture".to_string()),
        issuer: Some("CN=fixture-ca".to_string()),
        first_seen: now.clone(),
        last_seen: now,
        valid_from: None,
        valid_to: None,
        pem: None,
        serial: None,
        signature_algorithm: None,
        san: None,
        chain_fingerprints: vec![],
        subject_cn: None,
        subject_org: None,
        subject_ou: None,
        subject_country: None,
        subject_state: None,
        subject_locality: None,
        subject_email: None,
        issuer_cn: None,
        issuer_org: None,
        issuer_country: None,
        key_algorithm: None,
        key_size: None,
        version: None,
        chain: None,
    }))
}

fn ssh_identity(fingerprint: &str) -> Identity {
    let now = Utc::now().to_rfc3339();
    Identity::Ssh(SshHostKeyIdentity {
        fingerprint: fingerprint.to_string(),
        key_type: Some("ssh-ed25519".to_string()),
        key_bits: Some(256),
        first_seen: now.clone(),
        last_seen: now,
        public_key: Some("AAAAC3NzaC1lZDI1NTE5AAAAIfixture".to_string()),
        algorithms_offered: vec!["ssh-ed25519".to_string()],
    })
}

fn record(host: &str, record_type: &str, identity: Identity) -> TrustRecord {
    TrustRecord {
        host: host.to_string(),
        record_type: record_type.to_string(),
        identity,
        user_approved: true,
        nickname: None,
        history: vec![],
        host_policy: None,
        host_policy_config: None,
        stats: Default::default(),
        first_trusted: Some(Utc::now().to_rfc3339()),
        trust_expires: None,
        revoked: false,
        tags: vec![],
    }
}

/// `<app_data>` root plus its `databases/` child, the exact shape startup
/// installs the runtime over.
struct AppDirs {
    _root: TempDir,
    app_dir: PathBuf,
}

impl AppDirs {
    fn new() -> Self {
        let root = TempDir::new().expect("tempdir");
        let app_dir = root.path().to_path_buf();
        std::fs::create_dir_all(app_dir.join("databases")).expect("databases dir");
        Self {
            _root: root,
            app_dir,
        }
    }

    fn databases(&self) -> PathBuf {
        self.app_dir.join("databases")
    }

    fn trust_file(&self, database_id: &str) -> PathBuf {
        self.databases().join(format!("{database_id}.trust.json"))
    }
}

/// The raw payload under the SDBF preamble, i.e. what an on-disk inspection
/// (or the e2e fs helper) would see.
fn payload_of(path: &Path) -> Vec<u8> {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    assert_eq!(&bytes[..4], sdbf::MAGIC, "{} is not SDBF", path.display());
    sdbf::parse_and_verify(&bytes)
        .unwrap_or_else(|e| panic!("verify {}: {e}", path.display()))
        .to_vec()
}

fn hosts(document_records: &[TrustRecord]) -> Vec<String> {
    let mut out: Vec<String> = document_records
        .iter()
        .map(|r| format!("{}:{}", r.record_type, r.host))
        .collect();
    out.sort();
    out
}

async fn unlocked_state(dek_bytes: [u8; 32]) -> Arc<EncryptionState> {
    let state = EncryptionState::new();
    state
        .install(MasterDek::from_bytes(&dek_bytes).expect("32-byte dek"))
        .await;
    Arc::new(state)
}

// ── 1. two databases, two files, no leakage ─────────────────────────────────

#[tokio::test]
async fn two_databases_keep_isolated_trust_files() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();
    let store = SyncTrustStore::shared();

    runtime
        .activate_database(Some("db-alpha".into()), &[])
        .await
        .expect("activate alpha");
    store
        .trust_identity_blocking(
            "alpha.example:443".into(),
            "tls".into(),
            tls_identity("aa11"),
            true,
        )
        .expect("pin in alpha");

    runtime
        .activate_database(Some("db-beta".into()), &[])
        .await
        .expect("activate beta");
    store
        .trust_identity_blocking(
            "beta.example:22".into(),
            "ssh".into(),
            ssh_identity("SHA256:bb22"),
            true,
        )
        .expect("pin in beta");

    // Two files beside the two databases, never one shared sidecar.
    assert!(dirs.trust_file("db-alpha").exists());
    assert!(dirs.trust_file("db-beta").exists());
    assert!(
        !dirs.app_dir.join("trust_store.json").exists(),
        "the retired global sidecar must never be recreated"
    );

    // Alpha's pin is invisible from beta, and vice versa.
    assert!(matches!(
        store.verify_identity_blocking("alpha.example:443", "tls", tls_identity("aa11")),
        Ok(TrustVerifyResult::FirstUse { .. })
    ));
    runtime
        .activate_database(Some("db-alpha".into()), &[])
        .await
        .expect("re-activate alpha");
    assert!(matches!(
        store.verify_identity_blocking("alpha.example:443", "tls", tls_identity("aa11")),
        Ok(TrustVerifyResult::Trusted)
    ));
    assert!(matches!(
        store.verify_identity_blocking("beta.example:22", "ssh", ssh_identity("SHA256:bb22")),
        Ok(TrustVerifyResult::FirstUse { .. })
    ));

    // Reading a *non*-active database is allowed (export/import needs it),
    // and each file holds exactly its own records.
    assert_eq!(
        hosts(&runtime.export(Some("db-alpha")).unwrap().records),
        vec!["tls:alpha.example:443"]
    );
    assert_eq!(
        hosts(&runtime.export(Some("db-beta")).unwrap().records),
        vec!["ssh:beta.example:22"]
    );
}

// ── 2. encrypted mode: envelope on disk, survives lock/unlock ───────────────

#[tokio::test]
async fn encrypted_database_is_an_envelope_and_survives_a_lock_unlock_cycle() {
    let dirs = AppDirs::new();
    let dek = [9u8; 32];
    let state = unlocked_state(dek).await;
    let guard = test_support::install_runtime_for_tests(dirs.databases(), Some(state.clone()));
    let runtime = guard.runtime.clone();

    let info = runtime
        .activate_database(Some("db-enc".into()), &[])
        .await
        .expect("activate encrypted");
    assert!(info.encrypted, "an unlocked master DEK must encrypt");

    let store = SyncTrustStore::shared();
    store
        .trust_identity_blocking(
            "vault.example:443".into(),
            "tls".into(),
            tls_identity("cc33"),
            true,
        )
        .expect("pin");

    // On disk: SDBF preamble, then a P4 envelope — never readable JSON.
    let payload = payload_of(&dirs.trust_file("db-enc"));
    assert!(
        is_envelope_blob(&payload),
        "an encrypted trust store must be an envelope"
    );
    assert!(
        !String::from_utf8_lossy(&payload).contains("vault.example"),
        "the host must not be legible in the ciphertext"
    );
    // A distinct sub-key: the connections artifact key must not open it.
    let connections_key = state.sub_key(ArtifactKind::Connections).await.unwrap();
    assert!(
        sorng_storage::envelope_io::decrypt_with_subkey(&connections_key, &payload).is_err(),
        "the TrustStore sub-key must be distinct from the Connections one"
    );

    // Locked: reads and writes fail closed, never a plaintext downgrade.
    state.lock().await;
    runtime.refresh_sub_key().await.expect("refresh after lock");
    let error = store
        .verify_identity_blocking("vault.example:443", "tls", tls_identity("cc33"))
        .expect_err("locked verify must fail");
    assert!(error.contains("encrypted"), "{error}");
    assert!(store
        .trust_identity_blocking(
            "other.example:443".into(),
            "tls".into(),
            tls_identity("dd44"),
            true
        )
        .is_err());
    assert_eq!(
        store.global_policy(),
        TrustPolicy::Strict,
        "an unreadable store must report the fail-closed policy"
    );
    let payload_after_lock = payload_of(&dirs.trust_file("db-enc"));
    assert!(
        is_envelope_blob(&payload_after_lock),
        "a failed write must leave the envelope intact"
    );

    // Unlocked with the same master DEK: the same records come back.
    state.install(MasterDek::from_bytes(&dek).unwrap()).await;
    runtime
        .refresh_sub_key()
        .await
        .expect("refresh after unlock");
    assert!(matches!(
        store.verify_identity_blocking("vault.example:443", "tls", tls_identity("cc33")),
        Ok(TrustVerifyResult::Trusted)
    ));
    assert_eq!(runtime.active_info().unwrap().record_count, 1);
}

// ── 3. plaintext mode, and no downgrade once encryption is configured ───────

#[tokio::test]
async fn plaintext_database_never_downgrades_once_encryption_is_configured() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();

    let info = runtime
        .activate_database(Some("db-plain".into()), &[])
        .await
        .expect("activate plaintext");
    assert!(!info.encrypted);

    let store = SyncTrustStore::shared();
    store
        .trust_identity_blocking(
            "plain.example:443".into(),
            "tls".into(),
            tls_identity("ee55"),
            true,
        )
        .expect("pin");

    let payload = payload_of(&dirs.trust_file("db-plain"));
    assert!(
        payload.starts_with(b"{"),
        "an unconfigured app writes plaintext JSON under the SDBF preamble"
    );
    assert!(!is_envelope_blob(&payload));

    // The user turns on master encryption but the app is locked (no cached
    // sub-key). The durable marker alone must stop a plaintext rewrite.
    std::fs::write(dirs.app_dir.join("dek.enc"), b"marker").unwrap();
    let error = store
        .trust_identity_blocking(
            "later.example:443".into(),
            "tls".into(),
            tls_identity("ff66"),
            true,
        )
        .expect_err("configured-but-locked writes must fail closed");
    assert!(error.contains("unlock"), "{error}");
    assert_eq!(
        payload_of(&dirs.trust_file("db-plain")),
        payload,
        "the refused write must not have touched the file"
    );
}

// ── 4. legacy sidecars seed two databases with disjoint scopes ──────────────

#[tokio::test]
async fn legacy_sidecars_seed_each_database_with_its_own_connection_scope() {
    let dirs = AppDirs::new();

    // The retired global Trust Center file: one global record and two
    // connection-scoped records belonging to different databases.
    let mut legacy = TrustStoreData {
        policy: TrustPolicy::TofuWithExpiry,
        policy_config: TrustPolicyConfig {
            expiry_days: Some(30),
            ..Default::default()
        },
        records: Default::default(),
    };
    for (key, host, kind, identity) in [
        (
            "https:shared.example:443",
            "shared.example:443".to_string(),
            "https",
            tls_identity("a1"),
        ),
        (
            "https:@sorng/connection/v1/conn-alpha/only-alpha.example:443",
            format!("{CONNECTION_SCOPE_PREFIX}conn-alpha/only-alpha.example:443"),
            "https",
            tls_identity("a2"),
        ),
        (
            "ssh:@sorng/connection/v1/conn-beta/only-beta.example:22",
            format!("{CONNECTION_SCOPE_PREFIX}conn-beta/only-beta.example:22"),
            "ssh",
            ssh_identity("SHA256:a3"),
        ),
    ] {
        legacy
            .records
            .insert(key.to_string(), record(&host, kind, identity));
    }
    let legacy_path = dirs.app_dir.join("trust_store.json");
    std::fs::write(&legacy_path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let legacy_bytes = std::fs::read(&legacy_path).unwrap();

    // The retired RDP sidecar (camelCase, written by the old `fs::write`).
    let rdp_path = dirs.app_dir.join("rdp-cert-trust.json");
    let rdp_document = serde_json::json!({
        "entries": {
            "rdp.example:3389": {
                "host": "rdp.example", "port": 3389,
                "fingerprint": "AB:CD:EF", "subject": "CN=rdp",
                "issuer": "CN=rdp-ca", "validFrom": "", "validTo": "",
                "serial": "01", "signatureAlgorithm": "sha256WithRSAEncryption",
                "san": ["rdp.example"],
                "pem": "-----BEGIN CERTIFICATE-----\nQUE=\n-----END CERTIFICATE-----",
                "firstSeen": "2026-01-01T00:00:00Z",
                "lastSeen": "2026-01-02T00:00:00Z",
                "lastApprovedAt": "2026-01-02T00:00:00Z"
            }
        }
    });
    std::fs::write(&rdp_path, rdp_document.to_string()).unwrap();
    let rdp_bytes = std::fs::read(&rdp_path).unwrap();

    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();

    let status = runtime.legacy_status().expect("legacy status");
    assert!(status.legacy_present && status.rdp_legacy_present);
    assert_eq!((status.legacy_records, status.rdp_legacy_records), (3, 1));

    // Database one owns conn-alpha; database two owns conn-beta. Each gets
    // the global record and the RDP pin; neither gets the other's scope.
    let alpha = runtime
        .activate_database(Some("db-one".into()), &["conn-alpha".to_string()])
        .await
        .expect("seed db-one");
    assert_eq!(alpha.seeded_records, 3);
    let beta = runtime
        .activate_database(Some("db-two".into()), &["conn-beta".to_string()])
        .await
        .expect("seed db-two");
    assert_eq!(beta.seeded_records, 3);

    assert_eq!(
        hosts(&runtime.export(Some("db-one")).unwrap().records),
        vec![
            "https:@sorng/connection/v1/conn-alpha/only-alpha.example:443",
            "https:shared.example:443",
            "rdp:rdp.example:3389",
        ]
    );
    assert_eq!(
        hosts(&runtime.export(Some("db-two")).unwrap().records),
        vec![
            "https:shared.example:443",
            "rdp:rdp.example:3389",
            "ssh:@sorng/connection/v1/conn-beta/only-beta.example:22",
        ]
    );

    // Policy travels with the seed, every seeded record is marked Migrated,
    // and the RDP pin arrives as a normalised `rdp` TLS record.
    let document = runtime.export(Some("db-one")).unwrap();
    assert_eq!(document.version, TRUST_EXPORT_VERSION);
    assert_eq!(document.policy, TrustPolicy::TofuWithExpiry);
    assert_eq!(document.policy_config.expiry_days, Some(30));
    for seeded in &document.records {
        assert_eq!(
            seeded.history.last().expect("history entry").reason,
            IdentityChangeReason::Migrated,
            "{} was not marked as migrated",
            seeded.host
        );
    }
    let rdp = document
        .records
        .iter()
        .find(|r| r.record_type == "rdp")
        .expect("rdp record");
    assert!(rdp.user_approved);
    match &rdp.identity {
        Identity::Tls(cert) => assert_eq!(cert.fingerprint, "ab:cd:ef"),
        other => panic!("rdp identity must be TLS, got {other:?}"),
    }

    // Both sidecars are read-only inputs, byte-for-byte untouched.
    assert_eq!(std::fs::read(&legacy_path).unwrap(), legacy_bytes);
    assert_eq!(std::fs::read(&rdp_path).unwrap(), rdp_bytes);

    // Re-opening a seeded database never seeds twice (R5).
    let again = runtime
        .activate_database(Some("db-one".into()), &["conn-alpha".to_string()])
        .await
        .unwrap();
    assert_eq!(again.seeded_records, 0);
    assert_eq!(again.record_count, 3);

    // "Every database opened" gates the legacy delete: a third database that
    // exists on disk but was never opened must hold the gate shut.
    assert!(runtime.legacy_status().unwrap().all_databases_opened);
    std::fs::write(dirs.databases().join("db-three.json"), b"payload").unwrap();
    assert!(!runtime.legacy_status().unwrap().all_databases_opened);
    runtime
        .activate_database(Some("db-three".into()), &[])
        .await
        .unwrap();
    assert!(runtime.legacy_status().unwrap().all_databases_opened);

    assert_eq!(runtime.delete_legacy_stores().unwrap(), 2);
    assert!(!legacy_path.exists() && !rdp_path.exists());
}

// ── 5. sync verifier façade ⇄ async command service ─────────────────────────

#[tokio::test]
async fn sync_store_and_command_service_read_each_others_writes() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();
    runtime
        .activate_database(Some("db-shared".into()), &[])
        .await
        .expect("activate");

    let sync = SyncTrustStore::shared();
    let service = TrustStoreService::shared();

    // A verifier (RDP / SSH / rustls) pins a host; the Settings UI sees it.
    sync.trust_identity_blocking(
        "verifier.example:443".into(),
        "tls".into(),
        tls_identity("11aa"),
        true,
    )
    .expect("sync pin");
    {
        let mut service = service.lock().await;
        service.reload_from_disk().expect("reload");
        let records = service.get_all_trust_records().await;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].host, "verifier.example:443");
    }

    // The Settings UI pins a host; the verifier accepts it with no prompt.
    {
        let mut service = service.lock().await;
        service.reload_from_disk().expect("reload");
        service
            .trust_identity(
                "ui.example:22".into(),
                "ssh".into(),
                ssh_identity("SHA256:22bb"),
                true,
            )
            .await
            .expect("service pin");
    }
    assert!(matches!(
        sync.verify_identity_blocking("ui.example:22", "ssh", ssh_identity("SHA256:22bb")),
        Ok(TrustVerifyResult::Trusted)
    ));

    // A revocation in the UI is honoured by the verifier immediately.
    {
        let mut service = service.lock().await;
        service.reload_from_disk().expect("reload");
        service
            .revoke_identity("ui.example:22", "ssh")
            .await
            .expect("revoke");
    }
    assert!(matches!(
        sync.verify_identity_blocking("ui.example:22", "ssh", ssh_identity("SHA256:22bb")),
        Ok(TrustVerifyResult::Revoked { .. })
    ));

    // Policy changes cross the same seam.
    {
        let mut service = service.lock().await;
        service.reload_from_disk().expect("reload");
        service
            .set_trust_policy(TrustPolicy::AlwaysAsk)
            .await
            .expect("set policy");
    }
    assert_eq!(sync.global_policy(), TrustPolicy::AlwaysAsk);

    // Both façades were talking to the one file beside the database.
    assert_eq!(
        hosts(&runtime.export(None).unwrap().records),
        vec!["ssh:ui.example:22", "tls:verifier.example:443"]
    );
}

// ── 6. deleting a database removes its trust file, and only its own ─────────

#[tokio::test]
async fn deleting_a_database_removes_only_its_own_trust_file() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();
    let store = SyncTrustStore::shared();

    for (database, host) in [
        ("db-keep", "keep.example:443"),
        ("db-drop", "drop.example:443"),
    ] {
        runtime
            .activate_database(Some(database.into()), &[])
            .await
            .expect("activate");
        // Two writes so the SDBF ladder also leaves a `.bak` behind.
        store
            .trust_identity_blocking(host.into(), "tls".into(), tls_identity("77cc"), true)
            .expect("pin");
        store
            .trust_identity_blocking(
                format!("second-{host}"),
                "tls".into(),
                tls_identity("88dd"),
                true,
            )
            .expect("pin again");
    }

    let dropped = dirs.trust_file("db-drop");
    assert!(dropped.exists() && sdbf::sibling(&dropped, "bak").exists());

    // The exact hook `database_files::delete_database_data` runs after it has
    // unlinked `databases/<id>.json`.
    runtime.delete_store("db-drop").expect("delete store");

    for suffix in ["bak", "tmp"] {
        assert!(
            !sdbf::sibling(&dropped, suffix).exists(),
            "{suffix} sibling survived the delete"
        );
    }
    assert!(
        !dropped.exists(),
        "canonical trust file survived the delete"
    );
    assert!(
        dirs.trust_file("db-keep").exists(),
        "deleting one database must not touch another"
    );
    assert_eq!(runtime.export(Some("db-keep")).unwrap().records.len(), 2);

    // A deleted database re-opens with an empty, working store.
    runtime
        .activate_database(Some("db-drop".into()), &[])
        .await
        .expect("re-activate");
    assert_eq!(runtime.active_info().unwrap().record_count, 0);
}

// ── 7. trust travels between databases via export / import (D6) ─────────────

#[tokio::test]
async fn export_and_import_carry_trust_between_databases() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();
    let store = SyncTrustStore::shared();
    let service = TrustStoreService::shared();

    runtime
        .activate_database(Some("db-source".into()), &[])
        .await
        .expect("activate source");
    store
        .trust_identity_blocking(
            "a.example:443".into(),
            "tls".into(),
            tls_identity("aa"),
            true,
        )
        .unwrap();
    store
        .trust_identity_blocking(
            "b.example:22".into(),
            "ssh".into(),
            ssh_identity("SHA256:bb"),
            true,
        )
        .unwrap();
    {
        let mut service = service.lock().await;
        service.reload_from_disk().unwrap();
        service
            .set_trust_policy(TrustPolicy::CertificatePinning)
            .await
            .unwrap();
    }

    // The wizard exports the source database and clones it into a new one.
    let document = runtime.export(Some("db-source")).expect("export");
    assert_eq!(document.records.len(), 2);
    let outcome = runtime
        .import(Some("db-clone"), document.clone(), TrustImportMode::Replace)
        .expect("clone import");
    assert_eq!((outcome.imported, outcome.skipped), (2, 0));
    let cloned = runtime.export(Some("db-clone")).unwrap();
    assert_eq!(
        hosts(&cloned.records),
        vec!["ssh:b.example:22", "tls:a.example:443"]
    );
    assert_eq!(
        cloned.policy,
        TrustPolicy::CertificatePinning,
        "replace carries the source policy"
    );

    // The user revokes one host in the clone, then re-imports the same
    // document: merge must never resurrect a revoked record.
    runtime
        .activate_database(Some("db-clone".into()), &[])
        .await
        .expect("activate clone");
    {
        let mut service = service.lock().await;
        service.reload_from_disk().unwrap();
        service
            .revoke_identity("a.example:443", "tls")
            .await
            .unwrap();
    }
    let merged = runtime
        .import(Some("db-clone"), document, TrustImportMode::Merge)
        .expect("merge import");
    assert_eq!(merged.imported + merged.skipped, 2);
    let after = runtime.export(Some("db-clone")).unwrap();
    let revoked = after
        .records
        .iter()
        .find(|r| r.host == "a.example:443")
        .expect("record still present");
    assert!(
        revoked.revoked,
        "an unrevoked import must not overwrite a revoked record"
    );

    // The source database is untouched by either import.
    let source = runtime.export(Some("db-source")).unwrap();
    assert!(source.records.iter().all(|r| !r.revoked));
}

// ── 8. path safety: a database id can never escape databases/ ───────────────

#[test]
fn database_ids_cannot_escape_the_databases_directory() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();

    for hostile in ["", "..", "../evil", "sub/dir", "sub\\dir", "a\0b"] {
        assert!(
            runtime.trust_file_path(hostile).is_err(),
            "id {hostile:?} must be refused"
        );
        assert!(runtime.set_active(Some(hostile.to_string()), None).is_err());
        assert!(runtime.delete_store(hostile).is_err());
    }

    let good = runtime.trust_file_path("db-ok").expect("plain id");
    assert_eq!(good.parent().unwrap(), dirs.databases());
    assert_eq!(good.file_name().unwrap(), "db-ok.trust.json");

    // Nothing above ever activated a database, so the whole façade is closed.
    let store = SyncTrustStore::shared();
    assert!(store
        .verify_identity_blocking("h:443", "tls", tls_identity("aa"))
        .unwrap_err()
        .contains("no active"));
    assert!(runtime.export(None).is_err());
    assert_eq!(runtime.active_info().unwrap().database_id, None);
    assert_eq!(store.global_policy(), TrustPolicy::Strict);
}

// ── 9. trust_store::runtime() is the one authority the app installs ─────────

#[tokio::test]
async fn the_installed_runtime_is_the_one_every_facade_resolves() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    guard
        .runtime
        .activate_database(Some("db-authority".into()), &[])
        .await
        .expect("activate");

    // `runtime()` is what `delete_database_data`, the RDP adapter and the
    // TLS clients call; it must hand back the installed instance.
    let looked_up = trust_store::runtime().expect("installed runtime");
    assert_eq!(looked_up.databases_dir(), dirs.databases());
    assert_eq!(
        looked_up.active_database_id().as_deref(),
        Some("db-authority")
    );

    SyncTrustStore::shared()
        .trust_identity_blocking(
            "authority.example:443".into(),
            "tls".into(),
            tls_identity("99ee"),
            true,
        )
        .expect("pin");
    assert_eq!(looked_up.export(None).unwrap().records.len(), 1);
    assert_eq!(
        looked_up
            .trust_file_path("db-authority")
            .unwrap()
            .parent()
            .unwrap(),
        dirs.databases()
    );
}

// ── 10. known_hosts import: sorng-ssh writes into the active database ───────
//
// `trust_import_known_hosts` (e3) is the one t62 command whose implementation
// lives in `sorng-ssh` while its durable effect lands in `sorng-storage`'s
// per-database file, so the seam only shows up at this level. `sorng-ssh`'s own
// tests cover the parser; what is asserted here is where the records go.

/// A syntactically valid `ssh-ed25519` blob: `string("ssh-ed25519")` followed
/// by `string(32 key bytes)`. Only the fingerprint of these bytes is ever
/// compared, so fixed contents are fine — and make the record deterministic.
const TEST_HOST_KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIA0UGyIpMDc+RUxTWmFob3Z9hIuSmaCnrrW8w8rR2N/m";

fn write_known_hosts(path: &Path) {
    // A plain name (implicit port 22), a bracketed `[host]:port`, and a
    // wildcard pattern that must be skipped rather than guessed at.
    let contents = format!(
        "alpha.example.com ssh-ed25519 {key}\n\
         [beta.example.com]:2222 ssh-ed25519 {key}\n\
         *.wild.example.com ssh-ed25519 {key}\n",
        key = TEST_HOST_KEY
    );
    std::fs::write(path, contents).expect("write known_hosts");
}

#[tokio::test]
async fn known_hosts_import_lands_in_the_active_database_and_never_rewrites_the_file() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();

    let known_hosts = dirs.app_dir.join("known_hosts");
    write_known_hosts(&known_hosts);
    let original = std::fs::read(&known_hosts).expect("read known_hosts");
    let path = known_hosts.to_string_lossy().to_string();

    // With no database open the importer has nowhere to put anything, and must
    // say so rather than inventing a store.
    let error = app_lib::ssh::service::import_known_hosts(Some(path.clone()))
        .expect_err("import without an active database must fail closed");
    assert!(
        error.contains("Trust Center") || error.contains("no active"),
        "{error}"
    );

    runtime
        .activate_database(Some("db-import".into()), &[])
        .await
        .expect("activate");

    let outcome =
        app_lib::ssh::service::import_known_hosts(Some(path.clone())).expect("import known_hosts");
    assert_eq!(outcome.path, path);
    assert_eq!(outcome.imported, 2, "both concrete endpoints import");
    assert!(
        outcome.skipped >= 1,
        "the wildcard pattern must be skipped, not guessed at: {outcome:?}"
    );

    // The records land in THIS database's file, typed and keyed exactly the way
    // the SSH/SFTP/SCP verifiers and the frontend's dual-write key them.
    let document = runtime.export(Some("db-import")).expect("export");
    assert_eq!(
        hosts(&document.records),
        vec!["ssh:alpha.example.com:22", "ssh:beta.example.com:2222"]
    );
    for record in &document.records {
        assert!(
            !record.user_approved,
            "an imported key is adopted, not user-approved: {}",
            record.host
        );
        match &record.identity {
            Identity::Ssh(key) => assert!(!key.fingerprint.is_empty()),
            other => panic!("known_hosts must import an SSH identity, got {other:?}"),
        }
    }
    assert!(dirs.trust_file("db-import").exists());

    // The shared system file is an input only.
    assert_eq!(
        std::fs::read(&known_hosts).expect("re-read"),
        original,
        "known_hosts must never be rewritten by an import"
    );

    // Importing again adopts nothing new — existing records win.
    let again = app_lib::ssh::service::import_known_hosts(Some(path.clone())).expect("re-import");
    assert_eq!(again.imported, 0);
    assert_eq!(
        runtime.export(Some("db-import")).unwrap().records.len(),
        2,
        "a second import must not duplicate records"
    );

    // A different database sees none of it.
    runtime
        .activate_database(Some("db-untouched".into()), &[])
        .await
        .expect("activate other");
    assert!(runtime
        .export(Some("db-untouched"))
        .unwrap()
        .records
        .is_empty());
}

#[tokio::test]
async fn a_known_hosts_import_can_never_re_trust_a_revoked_host_key() {
    let dirs = AppDirs::new();
    let guard = test_support::install_runtime_for_tests(dirs.databases(), None);
    let runtime = guard.runtime.clone();
    runtime
        .activate_database(Some("db-revoked".into()), &[])
        .await
        .expect("activate");

    let known_hosts = dirs.app_dir.join("known_hosts");
    write_known_hosts(&known_hosts);
    let path = known_hosts.to_string_lossy().to_string();

    assert_eq!(
        app_lib::ssh::service::import_known_hosts(Some(path.clone()))
            .expect("first import")
            .imported,
        2
    );

    // The user revokes one of them in Settings → Security.
    let service = TrustStoreService::shared();
    {
        let mut service = service.lock().await;
        service.reload_from_disk().expect("reload");
        service
            .revoke_identity("alpha.example.com:22", "ssh")
            .await
            .expect("revoke");
    }

    // Re-importing the very same `known_hosts` line must not undo that.
    let after = app_lib::ssh::service::import_known_hosts(Some(path)).expect("second import");
    assert_eq!(
        after.imported, 0,
        "a revoked endpoint must not be re-trusted"
    );

    let document = runtime.export(Some("db-revoked")).expect("export");
    let revoked = document
        .records
        .iter()
        .find(|record| record.host == "alpha.example.com:22")
        .expect("record still present");
    assert!(revoked.revoked, "the revocation must survive the import");
}
