//! Authenticated per-artifact future-write decisions. No caller-controlled
//! paths or keys are accepted by the policy API.

use crate::{ArtifactKind, EncryptionState};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::RwLock,
};

pub const POLICY_FILENAME: &str = "artifact-policy.enc";
pub const POLICY_MARKER: &str = "artifact-policy.required";
pub const MAX_POLICY_BYTES: u64 = 64 * 1024;
pub const DATA_ARTIFACTS: &[ArtifactKind] = &[
    ArtifactKind::Connections,
    ArtifactKind::Settings,
    ArtifactKind::RecordingsMeta,
    ArtifactKind::RecordingsMedia,
    ArtifactKind::Backups,
    ArtifactKind::Logs,
    ArtifactKind::Macros,
    ArtifactKind::DatabasesIndex,
    ArtifactKind::TrustStore,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProtectionMode {
    Encrypted,
    Plaintext,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PolicyMode {
    Default,
    Encrypted,
    Plaintext,
}
impl From<Option<ProtectionMode>> for PolicyMode {
    fn from(value: Option<ProtectionMode>) -> Self {
        match value {
            None => Self::Default,
            Some(ProtectionMode::Encrypted) => Self::Encrypted,
            Some(ProtectionMode::Plaintext) => Self::Plaintext,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskState {
    Encrypted,
    Plaintext,
    Mixed,
    Absent,
    Unverified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactStatus {
    pub id: ArtifactKind,
    pub policy: PolicyMode,
    pub disk_state: DiskState,
    pub encrypted_files: u64,
    pub plaintext_files: u64,
    pub unverified_files: u64,
    pub bytes: u64,
    pub mutable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyDocument {
    pub version: u32,
    pub revision: u64,
    pub overrides: BTreeMap<ArtifactKind, ProtectionMode>,
}
impl Default for PolicyDocument {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            overrides: BTreeMap::new(),
        }
    }
}
impl PolicyDocument {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.overrides.keys().any(|id| !DATA_ARTIFACTS.contains(id)) {
            return Err("invalid artifact policy version or protected artifact override".into());
        }
        Ok(())
    }
    pub fn with_mode(&self, kind: ArtifactKind, mode: ProtectionMode) -> Result<Self, String> {
        if !DATA_ARTIFACTS.contains(&kind) {
            return Err("protected artifact cannot change policy".into());
        }
        let mut next = self.clone();
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or("artifact policy revision exhausted")?;
        next.overrides.insert(kind, mode);
        Ok(next)
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PolicyCache {
    pub root: Option<PathBuf>,
    pub document: PolicyDocument,
    pub error: Option<String>,
    pub recovery_required: bool,
    pub configured_profile: bool,
}
#[derive(Default)]
pub(crate) struct PolicyRuntime(pub RwLock<PolicyCache>);

pub async fn encode(state: &EncryptionState, policy: &PolicyDocument) -> Result<Vec<u8>, String> {
    policy.validate()?;
    let key = state
        .sub_key(ArtifactKind::ArtifactPolicy)
        .await
        .ok_or("unlock the master key before changing artifact protection")?;
    let mut nonce = [0u8; crate::envelope::NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    crate::envelope::write_envelope(
        &key,
        &crate::envelope::EnvelopeHeader::new_vault(nonce),
        &serde_json::to_vec(policy).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub async fn decode(state: &EncryptionState, bytes: &[u8]) -> Result<PolicyDocument, String> {
    let key = state
        .sub_key(ArtifactKind::ArtifactPolicy)
        .await
        .ok_or("artifact policy requires an unlocked master key")?;
    let (_, plain) = crate::envelope::read_envelope(&key, bytes)
        .map_err(|_| "artifact policy authentication failed")?;
    let document: PolicyDocument =
        serde_json::from_slice(&plain).map_err(|_| "invalid authenticated artifact policy")?;
    document.validate()?;
    Ok(document)
}

pub async fn refresh(state: &EncryptionState) {
    let snapshot = match state.artifact_policy.0.read() {
        Ok(p) => p.clone(),
        Err(_) => return,
    };
    let Some(root) = snapshot.root else { return };
    let result = async {
        crate::artifact_transaction::validate_regular_path(
            &root,
            &root.join(POLICY_FILENAME),
            true,
        )?;
        crate::artifact_transaction::validate_regular_path(&root, &root.join(POLICY_MARKER), true)?;
        if let Ok(marker) = std::fs::metadata(root.join(POLICY_MARKER)) {
            if marker.len() != 1
                || std::fs::read(root.join(POLICY_MARKER))
                    .map_err(|_| "cannot read artifact policy marker")?
                    != b"1"
            {
                return Err("invalid artifact policy marker".into());
            }
        }
        let path = root.join(POLICY_FILENAME);
        match std::fs::symlink_metadata(&path) {
            Ok(meta) => {
                if !meta.is_file() || meta.len() > MAX_POLICY_BYTES {
                    return Err("invalid artifact policy file".to_string());
                }
                let bytes = std::fs::read(path).map_err(|_| "cannot read artifact policy")?;
                decode(state, &bytes).await
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if root
                    .join(POLICY_MARKER)
                    .try_exists()
                    .map_err(|_| "cannot inspect artifact policy marker")?
                {
                    Err("artifact policy is missing; protection changes require recovery".into())
                } else {
                    Ok(PolicyDocument::default())
                }
            }
            Err(_) => Err("cannot inspect artifact policy".into()),
        }
    }
    .await;
    if let Ok(mut cache) = state.artifact_policy.0.write() {
        match result {
            Ok(document) => {
                cache.document = document;
                cache.error = None;
            }
            Err(error) => {
                cache.error = Some(error);
            }
        }
        cache.recovery_required = crate::artifact_transaction::has_pending(&root).unwrap_or(true);
    }
}

pub async fn initialize(state: &EncryptionState, root: &Path) {
    if let Ok(mut cache) = state.artifact_policy.0.write() {
        cache.root = Some(root.to_path_buf());
        cache.configured_profile = crate::profile_guard::probe_profile(root)
            != crate::profile_guard::ProfileEvidence::Fresh;
        cache.error = Some("artifact policy has not been verified".into());
        cache.recovery_required = crate::artifact_transaction::has_pending(root).unwrap_or(true);
    }
    refresh(state).await;
}

pub fn require_legacy_mutation_allowed(state: &EncryptionState) -> Result<(), String> {
    let document = state.artifact_policy_document()?;
    if document.revision != 0 || state.artifact_recovery_required() {
        return Err("Managed artifact protection is active. Use the artifact management preview/apply controls instead of legacy migrations.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn restart_and_key_install_refresh_policy_without_resetting_overrides() {
        let dir = tempfile::tempdir().unwrap();
        let old = EncryptionState::new();
        old.install(crate::MasterDek::from_bytes(&[12u8; 32]).unwrap())
            .await;
        let doc = PolicyDocument::default()
            .with_mode(ArtifactKind::Settings, ProtectionMode::Plaintext)
            .unwrap()
            .with_mode(ArtifactKind::RecordingsMeta, ProtectionMode::Encrypted)
            .unwrap();
        std::fs::write(
            dir.path().join(POLICY_FILENAME),
            encode(&old, &doc).await.unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join(POLICY_MARKER), b"1").unwrap();
        let restarted = EncryptionState::new();
        initialize(&restarted, dir.path()).await;
        assert!(restarted
            .resolve_write_policy(ArtifactKind::Settings, false)
            .is_err());
        restarted
            .install(crate::MasterDek::from_bytes(&[12u8; 32]).unwrap())
            .await;
        assert_eq!(restarted.artifact_policy_document().unwrap(), doc);
        let snapshot = restarted.snapshot().await.unwrap();
        assert_eq!(snapshot.artifact_policy_document().unwrap(), doc);
        assert!(snapshot.artifact_policy_root().is_none());
        let replacement = EncryptionState::new();
        replacement
            .install(crate::MasterDek::from_bytes(&[13u8; 32]).unwrap())
            .await;
        std::fs::write(
            dir.path().join(POLICY_FILENAME),
            encode(&replacement, &doc).await.unwrap(),
        )
        .unwrap();
        restarted
            .install(crate::MasterDek::from_bytes(&[13u8; 32]).unwrap())
            .await;
        assert_eq!(restarted.artifact_policy_document().unwrap(), doc);
        assert!(!restarted
            .resolve_write_policy(ArtifactKind::Settings, true)
            .unwrap());
        assert!(restarted
            .resolve_write_policy(ArtifactKind::RecordingsMeta, false)
            .unwrap());
        assert_eq!(snapshot.artifact_policy_document().unwrap(), doc);
        let mut corrupt = std::fs::read(dir.path().join(POLICY_FILENAME)).unwrap();
        let last = corrupt.len() - 1;
        corrupt[last] ^= 1;
        std::fs::write(dir.path().join(POLICY_FILENAME), corrupt).unwrap();
        refresh(&restarted).await;
        assert!(restarted
            .resolve_write_policy(ArtifactKind::Settings, false)
            .is_err());
        assert!(require_legacy_mutation_allowed(&restarted).is_err());
    }
    #[tokio::test]
    async fn receipt_is_authenticated_and_protected_kinds_are_rejected() {
        let state = EncryptionState::new();
        state.install(crate::MasterDek::generate()).await;
        let document = PolicyDocument::default()
            .with_mode(ArtifactKind::Settings, ProtectionMode::Plaintext)
            .unwrap();
        let mut bytes = encode(&state, &document).await.unwrap();
        assert_eq!(
            decode(&state, &bytes).await.unwrap().overrides,
            document.overrides
        );
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(decode(&state, &bytes).await.is_err());
        assert!(document
            .with_mode(ArtifactKind::KeyRing, ProtectionMode::Plaintext)
            .is_err());
        assert!(document
            .with_mode(ArtifactKind::ArtifactPolicy, ProtectionMode::Plaintext)
            .is_err());
    }
    #[tokio::test]
    async fn missing_installed_receipt_and_locked_plaintext_override_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let state = EncryptionState::new();
        state.install(crate::MasterDek::generate()).await;
        initialize(&state, dir.path()).await;
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, true)
            .unwrap());
        std::fs::write(dir.path().join(POLICY_MARKER), b"1").unwrap();
        refresh(&state).await;
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, false)
            .is_err());
        let doc = PolicyDocument::default()
            .with_mode(ArtifactKind::Settings, ProtectionMode::Plaintext)
            .unwrap();
        std::fs::write(
            dir.path().join(POLICY_FILENAME),
            encode(&state, &doc).await.unwrap(),
        )
        .unwrap();
        refresh(&state).await;
        assert!(!state
            .resolve_write_policy(ArtifactKind::Settings, true)
            .unwrap());
        state.lock().await;
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, false)
            .is_err());
    }
}
