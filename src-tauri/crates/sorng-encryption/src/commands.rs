//! Tauri command surface for Phase 0 — status, setup, unlock, lock.
//!
//! Phase 0 deliberately does **not** include `encrypt_artifact`,
//! `run_migration`, `rotate_master_key`, or `change_password`. Those
//! land in Phases 1–6 once the per-artifact writers exist; the four
//! commands here are sufficient to (a) bootstrap the master DEK on
//! first run, (b) drive the unlock screen, (c) zeroize the in-memory
//! key on lock, (d) report the current state to the Settings →
//! Security panel.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::dek::{ArtifactKind, MasterDek};
use crate::envelope::MasterKeyStorage;
use crate::state::{decide_setup, EncryptionState, SetupOutcome};

// ─── DTOs ──────────────────────────────────────────────────────────

/// What the Settings → Security panel needs to render its status badge.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionStatus {
    pub schema_version: u8,
    pub master_key_storage: Option<MasterKeyStorage>,
    pub unlocked: bool,
    pub vault_available: bool,
    pub vault_has_master_dek: bool,
    pub vault_backend: String,
    pub artifact_labels: Vec<&'static str>,
}

/// Caller's setup method choice. Matches the `EncryptionSettings.
/// masterKeyStorage` TypeScript enum.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetupMethod {
    Vault,
    Password { password: String },
    VaultAndPassword { password: String },
}

/// Outcome of an `encryption_unlock` call, mirrored from
/// [`SetupOutcome`] so the frontend can decide what to show next.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnlockResult {
    /// Vault delivered the DEK; the state is now unlocked.
    UnlockedFromVault,
    /// Master DEK reconstructed from the provided password.
    UnlockedFromPassword,
    /// The state is already unlocked; nothing to do.
    AlreadyUnlocked,
    /// First run — no master key exists yet. Caller should invoke
    /// `encryption_setup`.
    NeedsSetup,
    /// Vault holds an entry but policy requires a password the caller
    /// didn't provide.
    PasswordRequired,
    /// Vault unreachable in vault-only mode — caller must either
    /// switch to password mode or surface the error.
    VaultUnavailable,
}

// ─── Commands ──────────────────────────────────────────────────────

/// Report the current state of the encryption subsystem. Cheap; safe to
/// call on every settings-dialog render. Never reveals key material.
#[tauri::command]
pub async fn encryption_status(
    state: State<'_, EncryptionState>,
) -> Result<EncryptionStatus, String> {
    let vault_available = sorng_vault::keychain::is_available();
    let vault_backend = sorng_vault::keychain::backend_name().to_string();

    // A `read_dek` failure with `NotFound` semantics means "vault is up
    // but there's no master key yet" — a first-run signal. Other errors
    // (access denied, IO) we treat as "not available" for the purposes
    // of this status.
    let vault_has_master_dek = if vault_available {
        sorng_vault::keychain::read_dek().await.is_ok()
    } else {
        false
    };

    let labels = ArtifactKind::all()
        .iter()
        .map(|a| a.label())
        .collect::<Vec<_>>();

    Ok(EncryptionStatus {
        // Phase 0 ships v2 of the envelope codec; the on-disk schema
        // hasn't been bumped past v0 yet because no migrations have run.
        schema_version: 0,
        master_key_storage: None,
        unlocked: state.is_unlocked().await,
        vault_available,
        vault_has_master_dek,
        vault_backend,
        artifact_labels: labels,
    })
}

/// First-run setup. Idempotent in the same sense as `cargo build` —
/// running it twice with the same method just leaves things as they
/// are. Switching methods requires a separate "change password" /
/// "migrate to vault" command (Phase 6).
#[tauri::command]
pub async fn encryption_setup(
    state: State<'_, EncryptionState>,
    method: SetupMethod,
) -> Result<UnlockResult, String> {
    // If something's already unlocked, refuse to overwrite. A real
    // change-mode operation goes through Phase 6's rotate/change-password.
    if state.is_unlocked().await {
        return Ok(UnlockResult::AlreadyUnlocked);
    }

    match method {
        SetupMethod::Vault => {
            if !sorng_vault::keychain::is_available() {
                return Ok(UnlockResult::VaultUnavailable);
            }
            // `ensure_dek` is a vault op that creates the master if missing
            // and returns the existing bytes otherwise.
            let bytes = sorng_vault::keychain::ensure_dek()
                .await
                .map_err(|e| format!("ensure_dek: {e}"))?;
            let dek =
                MasterDek::from_bytes(&bytes).ok_or("vault returned wrong-size DEK")?;
            state.install(dek).await;
            Ok(UnlockResult::UnlockedFromVault)
        }
        SetupMethod::Password { password: _ } | SetupMethod::VaultAndPassword { password: _ } => {
            // Password-wrap (and hybrid) DEK persistence is Phase 1 — it
            // requires the on-disk `dek.enc` writer that lives next to
            // `settings.enc`. For Phase 0 we acknowledge the request but
            // do not yet persist anything; the caller gets a clear error
            // so the Settings UI can advertise "password mode coming in
            // Phase 1" while the vault path works fully today.
            Err("password-mode setup ships in Phase 1".to_string())
        }
    }
}

/// Attempt to unlock the state. With no password argument, attempts a
/// silent vault unwrap (the default Tauri 2 flow on Windows / macOS /
/// Linux where the user is already authenticated to the OS).
#[tauri::command]
pub async fn encryption_unlock(
    state: State<'_, EncryptionState>,
    password: Option<String>,
) -> Result<UnlockResult, String> {
    if state.is_unlocked().await {
        return Ok(UnlockResult::AlreadyUnlocked);
    }

    let vault_available = sorng_vault::keychain::is_available();
    let has_dek = if vault_available {
        sorng_vault::keychain::read_dek().await.is_ok()
    } else {
        false
    };

    // Phase 0 hasn't persisted `masterKeyStorage` yet — that's the
    // settings-encryption job in Phase 1. The decision tree therefore
    // collapses to "if vault has a DEK, use it; else fresh".
    let outcome = decide_setup(vault_available, has_dek, None);

    match (outcome, password.as_deref()) {
        (SetupOutcome::UnlockedFromVault, _) => {
            let bytes = sorng_vault::keychain::read_dek()
                .await
                .map_err(|e| format!("read_dek: {e}"))?;
            let dek =
                MasterDek::from_bytes(&bytes).ok_or("vault returned wrong-size DEK")?;
            state.install(dek).await;
            Ok(UnlockResult::UnlockedFromVault)
        }
        (SetupOutcome::FreshlyInitialized, _) => Ok(UnlockResult::NeedsSetup),
        (SetupOutcome::PasswordRequired, None) => Ok(UnlockResult::PasswordRequired),
        (SetupOutcome::PasswordRequired, Some(_pw)) => {
            // Password-unwrap path: Phase 1 ships the disk format that
            // makes this real. For Phase 0 we surface the same NotReady
            // signal the setup command does.
            Err("password unlock ships in Phase 1".to_string())
        }
        (SetupOutcome::VaultUnavailable, _) => Ok(UnlockResult::VaultUnavailable),
    }
}

/// Zeroize the in-memory master DEK. Called on auto-lock and on
/// explicit "Lock now" from the Settings → Security panel.
#[tauri::command]
pub async fn encryption_lock(state: State<'_, EncryptionState>) -> Result<(), String> {
    state.lock().await;
    Ok(())
}

// ─── Tests ─────────────────────────────────────────────────────────
//
// Real `#[tauri::command]` integration testing requires a full Tauri
// app harness; we delegate that to `tests/` in a later phase. The
// pure logic (decide_setup, EncryptionState) is exhaustively covered
// in the `dek`, `envelope`, and `state` modules.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_method_deserializes_kebab_case_variants() {
        let v: SetupMethod =
            serde_json::from_str(r#""vault""#).unwrap();
        assert!(matches!(v, SetupMethod::Vault));

        let p: SetupMethod =
            serde_json::from_str(r#"{"password":{"password":"hunter2"}}"#).unwrap();
        if let SetupMethod::Password { password } = p {
            assert_eq!(password, "hunter2");
        } else {
            panic!("expected Password variant");
        }

        let h: SetupMethod = serde_json::from_str(
            r#"{"vault-and-password":{"password":"hunter2"}}"#,
        )
        .unwrap();
        assert!(matches!(h, SetupMethod::VaultAndPassword { .. }));
    }

    #[test]
    fn unlock_result_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&UnlockResult::UnlockedFromVault).unwrap(),
            "\"unlocked-from-vault\""
        );
        assert_eq!(
            serde_json::to_string(&UnlockResult::PasswordRequired).unwrap(),
            "\"password-required\""
        );
    }
}
