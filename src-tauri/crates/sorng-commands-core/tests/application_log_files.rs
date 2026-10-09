//! Real filesystem and authenticated-codec tests, using disposable roots only.
//! Run this target with the `application_log_files` filter; the included adapter
//! also contains its own separately maintained test suite.
pub use sorng_commands_core::database_protection;

#[path = "../../../src/application_log_files.rs"]
mod application_log_files;
#[path = "../../../src/artifact_storage_adapters.rs"]
pub mod artifact_storage_adapters;

use application_log_files::{list, read, LogSource};
use sorng_encryption::{envelope, key_ring, ArtifactKind, EncryptionState, MasterDek};
use sorng_storage::envelope_io::encrypt_with_subkey;
use std::{
    fs,
    path::PathBuf,
    time::{Duration, UNIX_EPOCH},
};

const APP: &str = "encrypted-2026-10-09.log";
const ENC: &str = "encrypted-2026-10-09.log.enc";
const BROWSER: &str = "browser-startup-0123456789abcdef0123456789abcdef.jsonl";

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    // Resolve the platform temp alias before applying the no-link root policy.
    let root = fs::canonicalize(dir.path()).unwrap();
    (dir, root)
}

async fn unlocked() -> EncryptionState {
    let state = EncryptionState::new();
    state.install(MasterDek::generate()).await;
    state
}

async fn encrypt(state: &EncryptionState, plain: &[u8]) -> Vec<u8> {
    encrypt_with_subkey(&state.sub_key(ArtifactKind::Logs).await.unwrap(), plain).unwrap()
}

#[cfg(windows)]
#[tokio::test]
async fn application_log_files_windows_verbatim_and_native_roots_have_equal_safety() {
    use std::path::{Component, Prefix};
    let (dir, canonical) = fixture();
    assert!(
        matches!(canonical.components().next(), Some(Component::Prefix(p))
        if matches!(p.kind(), Prefix::VerbatimDisk(_) | Prefix::VerbatimUNC(_, _)))
    );
    fs::write(canonical.join(APP), b"synthetic\n").unwrap();
    let state = EncryptionState::new();
    for root in [dir.path(), canonical.as_path()] {
        assert_eq!(list(root, LogSource::Application).unwrap().files.len(), 1);
        assert_eq!(
            read(root, LogSource::Application, APP, &state)
                .await
                .unwrap()
                .text,
            "synthetic\n"
        );
        assert!(list(&root.join("missing"), LogSource::Application)
            .unwrap()
            .files
            .is_empty());
        assert!(read(
            root,
            LogSource::Application,
            "../encrypted-2026-10-09.log",
            &state
        )
        .await
        .is_err());
        assert!(list(&root.join(APP), LogSource::Application).is_err());
    }
}

#[tokio::test]
async fn application_log_files_allowlist_and_serialized_contract() {
    let (_dir, root) = fixture();
    for name in [
        APP,
        ENC,
        BROWSER,
        "encrypted-2024-02-29.log",
        "encrypted-2026-02-29.log",
        "encrypted-2026-13-01.log",
        "encrypted-2026-00-01.log",
        "encrypted-0000-01-01.log",
        "encrypted-2026-10-09.log.bak",
        "browser-startup-xyz.jsonl",
        "unrelated.txt",
    ] {
        fs::write(root.join(name), b"synthetic\n").unwrap();
    }
    let app = list(&root, LogSource::Application).unwrap();
    assert_eq!(app.files.len(), 3);
    assert!(!app.truncated);
    let browser = list(&root, LogSource::Browser).unwrap();
    assert_eq!(browser.files.len(), 1);
    assert_eq!(browser.files[0].id, BROWSER);
    let json = serde_json::to_value(&browser).unwrap();
    assert_eq!(json["files"][0]["name"], BROWSER);
    assert_eq!(json["files"][0]["sizeBytes"], 10);
    assert!(json["files"][0]["modifiedUnixMs"].is_u64());
    assert_eq!(json["files"][0]["encrypted"], false);
    assert_eq!(
        serde_json::to_string(&LogSource::Application).unwrap(),
        "\"application\""
    );
    assert!(matches!(
        serde_json::from_str::<LogSource>("\"browser\"").unwrap(),
        LogSource::Browser
    ));
    assert!(serde_json::from_str::<LogSource>("\"foreign\"").is_err());

    let state = EncryptionState::new();
    for name in [
        "../encrypted-2026-10-09.log",
        "..\\encrypted-2026-10-09.log",
        "encrypted-2026-10-09.log:secret",
        "C:\\foreign\\encrypted-2026-10-09.log",
        "/foreign/encrypted-2026-10-09.log",
        BROWSER,
        "encrypted-2026-02-29.log",
    ] {
        let error = read(&root, LogSource::Application, name, &state)
            .await
            .unwrap_err();
        assert_eq!(
            error,
            "Log file is unavailable or is not an allowed regular file."
        );
        assert!(!error.contains(name));
    }
    assert!(read(&root, LogSource::Browser, APP, &state).await.is_err());
}

#[test]
fn application_log_files_latest_hundred_and_missing_root() {
    let (_dir, root) = fixture();
    let missing = list(&root.join("not-created"), LogSource::Application).unwrap();
    assert!(missing.files.is_empty() && !missing.truncated);
    for index in 0..103 {
        let name = format!("browser-startup-{index:032x}.jsonl");
        let file = fs::File::create(root.join(name)).unwrap();
        file.set_times(
            fs::FileTimes::new()
                .set_modified(UNIX_EPOCH + Duration::from_secs(1_700_000_000 + index)),
        )
        .unwrap();
    }
    let result = list(&root, LogSource::Browser).unwrap();
    assert_eq!(result.files.len(), 100);
    assert!(result.truncated);
    assert_eq!(
        result.files[0].id,
        format!("browser-startup-{:032x}.jsonl", 102)
    );
    assert_eq!(
        result.files[99].id,
        format!("browser-startup-{:032x}.jsonl", 3)
    );
    assert!(result
        .files
        .windows(2)
        .all(|pair| pair[0].modified_unix_ms > pair[1].modified_unix_ms));
}

#[tokio::test]
async fn application_log_files_plaintext_remains_readable_after_lock_and_is_unchanged() {
    let (_dir, root) = fixture();
    let state = unlocked().await;
    state.lock().await;
    for (name, source) in [(APP, LogSource::Application), (BROWSER, LogSource::Browser)] {
        let original = b"synthetic first\nsynthetic last\n";
        fs::write(root.join(name), original).unwrap();
        let result = read(&root, source, name, &state).await.unwrap();
        assert_eq!(result.text.as_bytes(), original);
        assert!(!result.truncated);
        assert_eq!(fs::read(root.join(name)).unwrap(), original);
    }
    fs::write(root.join(APP), []).unwrap();
    let empty = read(&root, LogSource::Application, APP, &state)
        .await
        .unwrap();
    assert!(empty.text.is_empty() && !empty.truncated);
}

#[tokio::test]
async fn application_log_files_tail_bounds_lines_and_utf8_bytes() {
    let (_dir, root) = fixture();
    let state = EncryptionState::new();
    let lines: String = (0..2107).map(|n| format!("line-{n:04}\n")).collect();
    fs::write(root.join(APP), &lines).unwrap();
    let result = read(&root, LogSource::Application, APP, &state)
        .await
        .unwrap();
    assert_eq!(result.text.lines().count(), 2000);
    assert!(result.text.starts_with("line-0107\n"));
    assert!(result.text.ends_with("line-2106\n") && result.truncated);
    assert_eq!(fs::read_to_string(root.join(APP)).unwrap(), lines);
    // Four-byte scalars deliberately straddle the 256 KiB cut.
    let large = format!("{}END", "🦀".repeat(70_000));
    fs::write(root.join(APP), &large).unwrap();
    let result = read(&root, LogSource::Application, APP, &state)
        .await
        .unwrap();
    assert!(result.truncated && result.text.len() <= 256 * 1024);
    assert!(result.text.starts_with('🦀') && result.text.ends_with("END"));
    assert!(!result.text.contains('\u{fffd}'));
    assert!(large.ends_with(&result.text));
    // Invalid untruncated UTF-8 must not be silently discarded.
    fs::write(root.join(APP), [0x80, b'x']).unwrap();
    assert!(read(&root, LogSource::Application, APP, &state)
        .await
        .unwrap_err()
        .contains("UTF-8"));
}

#[tokio::test]
async fn application_log_files_authenticated_concatenation_requires_unlock() {
    let (_dir, root) = fixture();
    let state = unlocked().await;
    let mut bytes = encrypt(&state, b"first\n").await;
    bytes.extend(encrypt(&state, b"second\n").await);
    fs::write(root.join(ENC), &bytes).unwrap();
    let result = read(&root, LogSource::Application, ENC, &state)
        .await
        .unwrap();
    assert_eq!(result.text, "first\nsecond\n");
    assert!(!result.truncated);
    assert_eq!(fs::read(root.join(ENC)).unwrap(), bytes);
    state.lock().await;
    assert_eq!(
        read(&root, LogSource::Application, ENC, &state)
            .await
            .unwrap_err(),
        "Unlock the app to read encrypted logs."
    );
    assert!(list(&root, LogSource::Application).unwrap().files[0].encrypted);
}

#[tokio::test]
async fn application_log_files_magic_detects_encryption_without_enc_suffix() {
    let (_dir, root) = fixture();
    let state = unlocked().await;
    fs::write(root.join(APP), encrypt(&state, b"authenticated\n").await).unwrap();
    assert!(list(&root, LogSource::Application).unwrap().files[0].encrypted);
    assert_eq!(
        read(&root, LogSource::Application, APP, &state)
            .await
            .unwrap()
            .text,
        "authenticated\n"
    );
    state.lock().await;
    assert!(read(&root, LogSource::Application, APP, &state)
        .await
        .unwrap_err()
        .contains("Unlock"));
}

#[tokio::test]
async fn application_log_files_tampered_or_incomplete_envelopes_never_return_partial_plaintext() {
    let (_dir, root) = fixture();
    let state = unlocked().await;
    let valid = encrypt(&state, b"SYNTHETIC_PRIVATE\n").await;
    let mut tampered = valid.clone();
    *tampered.last_mut().unwrap() ^= 1;
    let mut truncated_second = valid.clone();
    truncated_second.extend_from_slice(&valid[..valid.len() - 1]);
    let mut trailing_plaintext = valid.clone();
    trailing_plaintext.extend_from_slice(b"unverified trailing data");
    for bytes in [
        tampered,
        truncated_second,
        trailing_plaintext,
        b"plaintext disguised as encrypted".to_vec(),
    ] {
        fs::write(root.join(ENC), &bytes).unwrap();
        let error = read(&root, LogSource::Application, ENC, &state)
            .await
            .unwrap_err();
        assert!(error.contains("authentication"));
        assert!(
            !error.contains("SYNTHETIC_PRIVATE")
                && !error.contains(&root.to_string_lossy().to_string())
        );
        assert_eq!(fs::read(root.join(ENC)).unwrap(), bytes);
    }
}

#[tokio::test]
async fn application_log_files_encrypted_size_and_boundary_limits_fail_explicitly() {
    let (_dir, root) = fixture();
    let state = unlocked().await;
    fs::File::create(root.join(ENC))
        .unwrap()
        .set_len(64 * 1024 * 1024 + 1)
        .unwrap();
    assert!(read(&root, LogSource::Application, ENC, &state)
        .await
        .unwrap_err()
        .contains("64 MiB"));
    fs::write(root.join(ENC), envelope::MAGIC.repeat(4097)).unwrap();
    assert!(read(&root, LogSource::Application, ENC, &state)
        .await
        .unwrap_err()
        .contains("envelope-boundary"));
}

#[tokio::test]
async fn application_log_files_retired_key_concatenation_stays_read_only() {
    let (_dir, root) = fixture();
    // This test executable never initializes an application/user profile.
    assert!(key_ring::app_data_dir().is_none());
    key_ring::set_app_data_dir(root.clone());
    let state = unlocked().await;
    let old_key = [0x42; 32];
    let old_dek = MasterDek::from_bytes(&old_key).unwrap();
    let mut ring = key_ring::RetiredKeyRing::empty();
    ring.retire(&old_key, 1_700_000_000);
    let ring_bytes = key_ring::encode(&state, &ring).await.unwrap();
    fs::write(key_ring::ring_path(&root), &ring_bytes).unwrap();
    let mut original =
        encrypt_with_subkey(&old_dek.sub_key(ArtifactKind::Logs), b"retired\n").unwrap();
    original.extend(encrypt(&state, b"current\n").await);
    fs::write(root.join(ENC), &original).unwrap();
    let result = read(&root, LogSource::Application, ENC, &state)
        .await
        .unwrap();
    assert_eq!(result.text, "retired\ncurrent\n");
    assert_eq!(fs::read(root.join(ENC)).unwrap(), original);
    assert_eq!(fs::read(key_ring::ring_path(&root)).unwrap(), ring_bytes);
}

#[tokio::test]
async fn application_log_files_hardlinks_and_directories_are_not_readable_ids() {
    let (_dir, root) = fixture();
    fs::write(root.join("not-a-log.txt"), b"foreign contents").unwrap();
    fs::hard_link(root.join("not-a-log.txt"), root.join(APP)).unwrap();
    fs::create_dir(root.join(ENC)).unwrap();
    assert!(list(&root, LogSource::Application)
        .unwrap()
        .files
        .is_empty());
    for name in [APP, ENC] {
        assert!(
            read(&root, LogSource::Application, name, &EncryptionState::new())
                .await
                .is_err()
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn application_log_files_symlink_leaf_and_root_are_rejected() {
    let (_dir, root) = fixture();
    let (_foreign, foreign) = fixture();
    fs::write(foreign.join(APP), b"foreign contents").unwrap();
    std::os::unix::fs::symlink(foreign.join(APP), root.join(APP)).unwrap();
    std::os::unix::fs::symlink(&foreign, root.join("linked-root")).unwrap();
    assert!(list(&root, LogSource::Application)
        .unwrap()
        .files
        .is_empty());
    assert!(list(&root.join("linked-root"), LogSource::Application).is_err());
    assert!(
        read(&root, LogSource::Application, APP, &EncryptionState::new())
            .await
            .is_err()
    );
}

#[test]
fn application_log_files_queued_read_rejects_generation_change_even_for_plaintext() {
    use std::{
        future::{poll_fn, Future},
        sync::mpsc,
        task::Poll,
    };
    let (_dir, root) = fixture();
    fs::write(root.join(APP), b"synthetic\n").unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let state = EncryptionState::new();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker = tokio::task::spawn_blocking(move || {
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let mut pending = Box::pin(read(&root, LogSource::Application, APP, &state));
        // Poll exactly once so the generation is captured and IO is queued
        // behind our occupied worker; no timing sleeps or production test hook.
        poll_fn(|cx| match pending.as_mut().poll(cx) {
            Poll::Pending => Poll::Ready(()),
            Poll::Ready(_) => panic!("read unexpectedly bypassed the blocking worker"),
        })
        .await;
        state.lock().await;
        release_tx.send(()).unwrap();
        worker.await.unwrap();
        assert!(pending
            .await
            .unwrap_err()
            .contains("Log protection changed"));
        // A fresh plaintext read at the new locked generation is still valid.
        assert_eq!(
            read(&root, LogSource::Application, APP, &state)
                .await
                .unwrap()
                .text,
            "synthetic\n"
        );
    });
}
