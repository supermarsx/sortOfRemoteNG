//! Shared encryption state held in Tauri state and accessed by every
//! artifact writer.
//!
//! Lifecycle:
//!
//! ```text
//!   app start ──► [None] ──setup()──► [Some(dek)] ──lock()──► [None]
//!                                          │
//!                                          └──sub_key(artifact)──► AES-256-GCM
//! ```
//!
//! Behaviour decisions:
//!
//! - Cold start with no `master-dek` vault entry yet means
//!   [`SetupOutcome::FreshlyInitialized`] — the caller (typically the
//!   first-run wizard) decides which storage mode to apply.
//! - Cold start with a vault entry present and `MasterKeyStorage::Vault`
//!   chosen unwraps transparently in [`EncryptionState::unlock_silently`].
//!   No password is ever requested.
//! - `MasterKeyStorage::Password` or `VaultAndPassword` requires
//!   [`EncryptionState::unlock_with_password`].
//! - `lock()` zeroizes the in-memory DEK; subsequent reads need a fresh
//!   unlock. Auto-lock policies in Phase 4 call this on idle.

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::dek::{ArtifactKind, MasterDek, SubKey};
use crate::envelope::MasterKeyStorage;

/// Shared, cloneable handle to the encryption state. The `Arc<RwLock>`
/// pattern means every Tauri window observes the same lock/unlock state
/// without IPC plumbing — the singleton lives in
/// `app.manage(EncryptionState::new())`.
#[derive(Clone, Default)]
pub struct EncryptionState {
    inner: Arc<RwLock<Option<MasterDek>>>,
}

impl EncryptionState {
    /// Create a fresh, locked state. Construct exactly once per app
    /// process at startup and hand the clone to Tauri state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `true` iff a master DEK is currently loaded in memory.
    pub async fn is_unlocked(&self) -> bool {
        self.inner.read().await.is_some()
    }

    /// Zeroize the in-memory DEK. Idempotent — locking an already-locked
    /// state is a no-op. Subsequent reads require a fresh unlock.
    pub async fn lock(&self) {
        let mut guard = self.inner.write().await;
        // Drop replaces the value with None; the old MasterDek's
        // Zeroizing field zeroes itself on Drop.
        *guard = None;
    }

    /// Replace the in-memory DEK. Used by [`setup`] and by every
    /// `unlock_*` path after a successful unwrap. Any previous DEK is
    /// zeroized.
    pub async fn install(&self, dek: MasterDek) {
        let mut guard = self.inner.write().await;
        *guard = Some(dek);
    }

    /// Derive a sub-key for the given artifact. Returns `None` when the
    /// state is locked — callers in artifact writers typically map that
    /// to a domain-specific "storage locked" error.
    pub async fn sub_key(&self, artifact: ArtifactKind) -> Option<SubKey> {
        let guard = self.inner.read().await;
        guard.as_ref().map(|m| m.sub_key(artifact))
    }

    /// Read-only snapshot of the master DEK for callers that need the
    /// raw bytes (wrapping for password export in Phase 6, vault
    /// re-store in Phase 1). Kept `pub(crate)` so it never leaks
    /// outside this crate.
    #[allow(dead_code)]
    pub(crate) async fn with_master<R>(
        &self,
        f: impl FnOnce(&MasterDek) -> R,
    ) -> Option<R> {
        let guard = self.inner.read().await;
        guard.as_ref().map(f)
    }

    /// Build a brand-new `EncryptionState` that holds a separate copy
    /// of the current master DEK. The returned state is independent
    /// of `self`: a later [`install`] on either does not affect the
    /// other. Used by the master-key rotation orchestrator to keep
    /// the *old* DEK alive for decryption while the live state is
    /// swapped to the *new* DEK for encryption.
    ///
    /// Returns `None` when the state is locked. The cloned DEK lives
    /// in a fresh `Zeroizing` buffer; both keys are zeroed when their
    /// respective states drop.
    pub async fn snapshot(&self) -> Option<Self> {
        let guard = self.inner.read().await;
        let dek = guard.as_ref()?;
        let copy = MasterDek::from_bytes(dek.bytes_for_password_wrap())?;
        let cloned = Self::new();
        cloned.install(copy).await;
        Some(cloned)
    }

    /// Hand the raw 32-byte master DEK to a caller that needs to wrap
    /// it for vault storage or password export. Exposed `pub` (rather
    /// than `pub(crate)` like [`with_master`]) so the master-key
    /// rotation orchestrator in the `app` crate can re-wrap the new
    /// DEK into vault + `dek.enc` without round-tripping through this
    /// crate's command surface.
    ///
    /// Returns `None` when the state is locked. The returned bytes
    /// are a copy; the original DEK in the state is unchanged. The
    /// caller is responsible for zeroising the returned buffer.
    pub async fn master_bytes_raw(&self) -> Option<[u8; crate::dek::KEY_LEN]> {
        let guard = self.inner.read().await;
        guard.as_ref().map(|dek| *dek.bytes_for_password_wrap())
    }
}

/// What happened when the caller asked the state to load itself from
/// available sources. Returned by [`probe_and_unlock_silently`] so the
/// app can decide whether to show the first-run wizard, the password
/// prompt, or skip straight to the main UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupOutcome {
    /// Vault was reachable and held a master DEK; we loaded it. The
    /// state is now unlocked and the app can boot directly.
    UnlockedFromVault,
    /// No vault entry exists yet — caller must run the first-run
    /// wizard to decide between `vault`, `password`, or
    /// `vault-and-password` setup.
    FreshlyInitialized,
    /// A vault entry exists but the stored policy says a password is
    /// also required. Caller must collect a password and call
    /// `unlock_with_password`.
    PasswordRequired,
    /// No vault was reachable. Caller must either accept a
    /// password-only workflow or surface an error to the user.
    VaultUnavailable,
}

/// Pure decision tree from `(vault_available, has_dek_in_vault,
/// configured_mode)` to a [`SetupOutcome`]. Split out so it can be
/// exhaustively unit-tested without touching the real vault.
pub fn decide_setup(
    vault_available: bool,
    has_dek_in_vault: bool,
    configured_mode: Option<MasterKeyStorage>,
) -> SetupOutcome {
    match (vault_available, has_dek_in_vault, configured_mode) {
        // Vault present, DEK present, mode says "vault only" → silent load.
        (true, true, Some(MasterKeyStorage::Vault)) => SetupOutcome::UnlockedFromVault,
        // Vault present, DEK present, hybrid or password mode → still need pw.
        (true, true, Some(MasterKeyStorage::VaultAndPassword)) => {
            SetupOutcome::PasswordRequired
        }
        (true, true, Some(MasterKeyStorage::Password)) => SetupOutcome::PasswordRequired,
        // Vault present, no DEK yet → first-run, defaults to vault.
        (true, false, _) => SetupOutcome::FreshlyInitialized,
        // No vault available → password-only.
        (false, _, _) => SetupOutcome::VaultUnavailable,
        // Vault present, DEK present, no mode recorded (legacy app start).
        (true, true, None) => SetupOutcome::UnlockedFromVault,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn locked_state_returns_no_sub_key() {
        let s = EncryptionState::new();
        assert!(!s.is_unlocked().await);
        assert!(s.sub_key(ArtifactKind::Settings).await.is_none());
    }

    #[tokio::test]
    async fn install_then_sub_key() {
        let s = EncryptionState::new();
        let dek = MasterDek::generate();
        s.install(dek).await;
        assert!(s.is_unlocked().await);
        let sk = s.sub_key(ArtifactKind::Settings).await.expect("unlocked");
        assert_eq!(sk.bytes().len(), 32);
    }

    #[tokio::test]
    async fn lock_zeroizes_state() {
        let s = EncryptionState::new();
        s.install(MasterDek::generate()).await;
        s.lock().await;
        assert!(!s.is_unlocked().await);
        assert!(s.sub_key(ArtifactKind::Settings).await.is_none());
    }

    #[tokio::test]
    async fn snapshot_preserves_old_dek_across_install() {
        // Phase A safety net: the rotation orchestrator builds an
        // `old_state` via `snapshot()` and then swaps the live state
        // to a new DEK. After the swap, `old_state` must still derive
        // the *original* sub-key so the orchestrator can decrypt
        // existing ciphertexts.
        let live = EncryptionState::new();
        let original = MasterDek::generate();
        live.install(original).await;
        let original_sub = live
            .sub_key(ArtifactKind::Settings)
            .await
            .unwrap()
            .bytes()
            .to_vec();
        let snap = live.snapshot().await.expect("unlocked");
        // Swap the live state to a brand-new DEK.
        live.install(MasterDek::generate()).await;
        let new_sub = live
            .sub_key(ArtifactKind::Settings)
            .await
            .unwrap()
            .bytes()
            .to_vec();
        assert_ne!(new_sub, original_sub, "live state must hold new DEK");
        // Snapshot still derives the original sub-key.
        let snap_sub = snap
            .sub_key(ArtifactKind::Settings)
            .await
            .unwrap()
            .bytes()
            .to_vec();
        assert_eq!(snap_sub, original_sub, "snapshot retained old DEK");
    }

    #[tokio::test]
    async fn snapshot_on_locked_state_returns_none() {
        let s = EncryptionState::new();
        assert!(s.snapshot().await.is_none());
    }

    #[tokio::test]
    async fn master_bytes_raw_round_trips_through_from_bytes() {
        let s = EncryptionState::new();
        s.install(MasterDek::generate()).await;
        let bytes = s.master_bytes_raw().await.unwrap();
        let reconstructed = MasterDek::from_bytes(&bytes).unwrap();
        // Both should derive the same sub-key.
        let s2 = EncryptionState::new();
        s2.install(reconstructed).await;
        let a = s.sub_key(ArtifactKind::Settings).await.unwrap();
        let b = s2.sub_key(ArtifactKind::Settings).await.unwrap();
        assert_eq!(a.bytes(), b.bytes());
    }

    #[tokio::test]
    async fn lock_is_idempotent() {
        let s = EncryptionState::new();
        s.lock().await;
        s.lock().await; // no panic
        assert!(!s.is_unlocked().await);
    }

    #[tokio::test]
    async fn install_replaces_prior_dek() {
        let s = EncryptionState::new();
        let a = MasterDek::generate();
        let a_label = *a.sub_key(ArtifactKind::Settings).bytes();
        s.install(a).await;

        let b = MasterDek::generate();
        let b_label = *b.sub_key(ArtifactKind::Settings).bytes();
        s.install(b).await;

        // Now the live state derives sub-keys from `b`, not `a`.
        let live = s.sub_key(ArtifactKind::Settings).await.unwrap();
        assert_eq!(live.bytes(), &b_label);
        assert_ne!(live.bytes(), &a_label);
    }

    #[test]
    fn decide_vault_with_dek_and_vault_mode() {
        assert_eq!(
            decide_setup(true, true, Some(MasterKeyStorage::Vault)),
            SetupOutcome::UnlockedFromVault,
        );
    }

    #[test]
    fn decide_vault_with_dek_and_hybrid_mode() {
        assert_eq!(
            decide_setup(true, true, Some(MasterKeyStorage::VaultAndPassword)),
            SetupOutcome::PasswordRequired,
        );
    }

    #[test]
    fn decide_vault_with_dek_and_password_mode() {
        assert_eq!(
            decide_setup(true, true, Some(MasterKeyStorage::Password)),
            SetupOutcome::PasswordRequired,
        );
    }

    #[test]
    fn decide_vault_no_dek_is_fresh() {
        assert_eq!(
            decide_setup(true, false, None),
            SetupOutcome::FreshlyInitialized,
        );
        assert_eq!(
            decide_setup(true, false, Some(MasterKeyStorage::Vault)),
            SetupOutcome::FreshlyInitialized,
        );
    }

    #[test]
    fn decide_no_vault_is_unavailable() {
        assert_eq!(
            decide_setup(false, false, None),
            SetupOutcome::VaultUnavailable,
        );
        // Even with a stored "vault" mode, no vault means no vault.
        assert_eq!(
            decide_setup(false, true, Some(MasterKeyStorage::Vault)),
            SetupOutcome::VaultUnavailable,
        );
    }

    #[test]
    fn decide_legacy_vault_with_dek_and_no_mode() {
        // App that's been running pre-v2: vault has the DEK but no
        // mode was recorded yet. Silent load is the safest default.
        assert_eq!(
            decide_setup(true, true, None),
            SetupOutcome::UnlockedFromVault,
        );
    }
}
