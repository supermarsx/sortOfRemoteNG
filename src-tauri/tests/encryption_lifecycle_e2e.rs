//! End-to-end coverage of the encryption-at-rest lifecycle outside the
//! single-shot key rotation path covered by
//! `encryption_rotation_e2e.rs`. Three independent scenarios live here:
//!
//!   1. **Boot sequence (silent vault unlock).** Materialise an encrypted
//!      `settings.enc` under DEK A, simulate a process restart by
//!      dropping the state and re-installing the master DEK from the
//!      vault bytes, and read the artifact back. This proves the boot
//!      decryption path stays intact even without the Tauri runtime in
//!      the loop.
//!   2. **Rotation partial-failure + recovery.** Plant three artifacts
//!      under DEK A, rotate only one to DEK B (simulating an
//!      orchestrator that crashed after settings but before connections
//!      + recording), then re-install DEK A from a snapshot (the user's
//!        portable `.dek` import) and confirm the not-yet-rotated
//!        artifacts decode while the rotated one does not. This proves
//!        portable-import is a safe recovery rail for half-finished
//!        rotations — the user can re-run rotation to finish the job.
//!   3. **Audit log records lock reason.** Every lock reason emitted by
//!      the auto-lock policies (`manual`, `shortcut`, `idle`, `blur`,
//!      `minimize`, `visibility-hidden`) round-trips through
//!      `audit::record` and surfaces unchanged in `read_tail`. This
//!      pins the on-disk reason vocabulary the Settings → Security
//!      panel filters on.
//!
//! These tests drive the codec layer directly so they need neither a
//! Tauri runtime nor the higher-level orchestrator — the breakage they
//! catch lives in the shared `EncryptionState` + per-artifact codecs.

use serde_json::json;
use std::sync::Arc;
use tempfile::tempdir;

use sorng_encryption::artifacts::{
    connections as artifact_connections, recording_meta as artifact_recording_meta,
    settings as artifact_settings,
};
use sorng_encryption::audit::{self, AuditEvent};
use sorng_encryption::envelope::{MasterKeyStorage, SALT_LEN};
use sorng_encryption::password_wrap::Argon2Params;
use sorng_encryption::{EncryptionState, MasterDek};

/// Simulate the boot flow that runs the first time the app talks to a
/// real OS vault: write `settings.enc` under one in-memory DEK, drop the
/// state (process exit), then build a fresh state and re-install the
/// master from the bytes the vault would have returned at next boot.
/// The fresh state must decrypt the artifact identically.
///
/// This catches breakage in the boot decryption path even though the
/// real boot wiring through `state_registry::register` lives in the
/// `app` crate's `src/` (out of scope for this test layer).
#[tokio::test]
async fn boot_sequence_silent_vault_unlock() {
    // ── Pre-boot: write settings.enc under DEK A. ─────────────────
    let tmp = tempdir().unwrap();
    let app_data = tmp.path();
    let settings_path = app_data.join("settings.enc");

    let enc_state = Arc::new(EncryptionState::new());
    enc_state.install(MasterDek::generate()).await;

    let payload = json!({
        "theme": "dark",
        "language": "en",
        "nested": { "shortcut": "Ctrl+L" }
    });
    let blob = artifact_settings::write(
        &enc_state,
        &payload,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .unwrap();
    std::fs::write(&settings_path, &blob).unwrap();

    // Snapshot the master bytes — this is what the OS vault would
    // hold across the simulated restart.
    let vault_bytes = enc_state.master_bytes_raw().await.unwrap();

    // ── Simulate process exit + reboot. ───────────────────────────
    // Dropping the original state zeroises its DEK; the bytes we
    // saved above are the only surviving handle to the master key.
    drop(enc_state);

    // ── Fresh boot: rebuild state, install master from vault. ─────
    let booted = EncryptionState::new();
    booted
        .install(MasterDek::from_bytes(&vault_bytes).unwrap())
        .await;

    // ── Decrypt the on-disk artifact under the rebooted state. ───
    let on_disk = std::fs::read(&settings_path).unwrap();
    let decoded = artifact_settings::read(&booted, &on_disk)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        decoded, payload,
        "the rebooted state must decrypt settings.enc identically",
    );
}

/// Simulate a master-key rotation that crashed partway through:
/// settings.enc was rewritten under the new DEK B, but the connections
/// store and recording metadata were never reached. The user runs
/// `encryption_import_portable_dek` with a snapshot of the old DEK A,
/// which puts DEK A back in memory. From that recovered state the
/// not-yet-rotated artifacts must decode cleanly, while the already-
/// rotated settings file must not — so the user can re-run rotation to
/// finish the job knowing exactly which artifacts still need it.
#[tokio::test]
async fn rotation_partial_failure_leaves_recoverable_state() {
    let tmp = tempdir().unwrap();
    let app_data = tmp.path();
    let settings_path = app_data.join("settings.enc");
    let connections_path = app_data.join("data.enc");
    let recording_meta_path = app_data.join("recording-meta.enc");

    // ── Set up DEK A and write three artifacts under it. ──────────
    let dek_a_bytes = [3u8; 32];
    let state = Arc::new(EncryptionState::new());
    state
        .install(MasterDek::from_bytes(&dek_a_bytes).unwrap())
        .await;

    let settings_payload = json!({ "theme": "dark" });
    let connections_payload = json!({ "connections": [{ "id": "c1", "host": "h" }] });
    let recording_payload = json!({ "id": "rec-1", "name": "demo" });

    let settings_blob = artifact_settings::write(
        &state,
        &settings_payload,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .unwrap();
    std::fs::write(&settings_path, &settings_blob).unwrap();

    let connections_blob = artifact_connections::write(
        &state,
        &connections_payload,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .unwrap();
    std::fs::write(&connections_path, &connections_blob).unwrap();

    let recording_blob = artifact_recording_meta::write(
        &state,
        &recording_payload,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .unwrap();
    std::fs::write(&recording_meta_path, &recording_blob).unwrap();

    // Snapshot DEK A's bytes — this is what a portable `.dek` export
    // captures, and what an import call later loads back in.
    let dek_a_snapshot = state.master_bytes_raw().await.unwrap();
    assert_eq!(dek_a_snapshot, dek_a_bytes);

    // ── Generate DEK B and swap it in. Then rewrite ONLY settings
    //    under DEK B — simulating a rotation that failed after
    //    settings but before connections + recording.
    state.install(MasterDek::generate()).await;
    let settings_under_b = artifact_settings::write(
        &state,
        &settings_payload,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .unwrap();
    std::fs::write(&settings_path, &settings_under_b).unwrap();

    // Confirm the on-disk surface is now mixed:
    //   - settings.enc        → DEK B
    //   - data.enc            → DEK A (untouched)
    //   - recording-meta.enc  → DEK A (untouched)

    // ── Recovery: the user imports the portable `.dek` (DEK A) into
    //    a fresh state, simulating the
    //    `encryption_import_portable_dek` command path.
    let recovered = Arc::new(EncryptionState::new());
    recovered
        .install(MasterDek::from_bytes(&dek_a_snapshot).unwrap())
        .await;

    // Connections + recording metadata MUST decode cleanly under the
    // recovered DEK A — they were never rotated.
    let connections_on_disk = std::fs::read(&connections_path).unwrap();
    let decoded_connections = artifact_connections::read(&recovered, &connections_on_disk)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(decoded_connections, connections_payload);

    let recording_on_disk = std::fs::read(&recording_meta_path).unwrap();
    let decoded_recording = artifact_recording_meta::read(&recovered, &recording_on_disk)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(decoded_recording, recording_payload);

    // settings.enc was already rewritten under DEK B, so it must NOT
    // decode under DEK A. The user re-runs rotation to finish the
    // job with full knowledge of which artifacts remain on DEK A.
    let settings_on_disk = std::fs::read(&settings_path).unwrap();
    assert!(
        artifact_settings::read(&recovered, &settings_on_disk)
            .await
            .is_err(),
        "settings.enc rotated to DEK B must NOT authenticate under recovered DEK A",
    );
}

/// Every auto-lock reason emitted by Phase 4's policies must round-trip
/// through `audit::record` and surface unchanged in `read_tail`. The
/// reason vocabulary is closed:
///
/// - `manual`              — Settings → Lock button
/// - `shortcut`            — global hotkey
/// - `idle`                — idle-timer expiry
/// - `blur`                — window blur (focus lost)
/// - `minimize`            — window minimised
/// - `visibility-hidden`   — browser-style page-hidden event
///
/// Drift in any of these tags would silently break the Settings panel's
/// filter UI; pinning them here turns that drift into a build failure.
#[tokio::test]
async fn audit_log_records_lock_with_reason() {
    let tmp = tempdir().unwrap();
    let app_data = tmp.path();

    // Closed set of lock reasons the auto-lock policies emit.
    let reasons = [
        "manual",
        "shortcut",
        "idle",
        "blur",
        "minimize",
        "visibility-hidden",
    ];

    for r in reasons {
        audit::record(
            app_data,
            AuditEvent::Locked,
            json!({ "reason": r }),
        )
        .unwrap();
    }

    let entries = audit::read_tail(app_data, 100).unwrap();
    assert_eq!(
        entries.len(),
        reasons.len(),
        "expected one entry per lock reason",
    );
    for (entry, expected_reason) in entries.iter().zip(reasons.iter()) {
        assert_eq!(
            entry.event, "locked",
            "every audit entry must carry the kebab-case `locked` tag",
        );
        assert_eq!(
            entry.metadata["reason"], *expected_reason,
            "reason {expected_reason} must surface unchanged in read_tail",
        );
    }
}
