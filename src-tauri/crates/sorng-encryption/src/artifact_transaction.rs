//! Bounded-memory representation transaction. Every mutation is journalled
//! before staging. Uncommitted recovery restores originals; committed recovery
//! finishes cleanup only. Callers hold settings_coordinator for the whole job.

use crate::{ArtifactKind, EncryptionState, SubKey};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub const JOURNAL_FILENAME: &str = "artifact-transition.enc";
const JOURNAL_PENDING: &str = "artifact-transition.enc.pending";
const MAX_ENTRIES: usize = 20_000;
const MAX_JOURNAL_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_ARTIFACT_BYTES: u64 = 1024 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileFingerprint {
    pub bytes: u64,
    pub sha256: String,
}

fn is_link(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

/// Reject every symlink/reparse ancestor, including configured roots. Only
/// normal relative components below an explicitly allowed root are accepted.
pub fn validate_regular_path(root: &Path, path: &Path, allow_missing: bool) -> Result<(), String> {
    if !root.is_absolute() || !path.is_absolute() {
        return Err("artifact paths must be absolute".into());
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "artifact path escapes its configured root")?;
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("invalid artifact path component".into());
    }
    let mut prefix = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err("invalid artifact path component".into());
        }
        prefix.push(component.as_os_str());
        match fs::symlink_metadata(&prefix) {
            Ok(meta) => {
                if is_link(&meta) {
                    return Err("symlink/reparse artifact paths are not supported".into());
                }
                if prefix != path && !meta.is_dir() {
                    return Err("artifact ancestor is not a directory".into());
                }
                if prefix == path && !meta.is_file() && path != root {
                    return Err("artifact is not a regular file".into());
                }
            }
            Err(e)
                if allow_missing && e.kind() == std::io::ErrorKind::NotFound && prefix == path => {}
            Err(e) => return Err(format!("cannot validate artifact path: {e}")),
        }
    }
    Ok(())
}

pub fn fingerprint(path: &Path) -> Result<Option<FileFingerprint>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("cannot inspect artifact: {e}")),
    };
    if !metadata.is_file() || is_link(&metadata) || metadata.len() > MAX_ARTIFACT_BYTES {
        return Err("unsupported artifact type or size".into());
    }
    let mut input = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut bytes = 0u64;
    loop {
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes = bytes
            .checked_add(n as u64)
            .ok_or("artifact size overflow")?;
        if bytes > MAX_ARTIFACT_BYTES {
            return Err("artifact exceeds size limit".into());
        }
        hash.update(&buffer[..n]);
    }
    let after = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if bytes != metadata.len()
        || after.len() != metadata.len()
        || after.modified().ok() != metadata.modified().ok()
        || is_link(&after)
    {
        return Err("artifact changed while being inspected".into());
    }
    Ok(Some(FileFingerprint {
        bytes,
        sha256: format!("{:x}", hash.finalize()),
    }))
}

pub fn sync_parent(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        fs::File::open(path.parent().ok_or("artifact has no parent")?)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub fn durable_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // This is a journal-registered stage, not an untracked random temporary.
    let mut file = create_private_stage(path)?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    sync_parent(path)
}

/// Stages and rollback copies can contain plaintext. Create them exclusively
/// with owner-only Unix access; on Windows they inherit the ACL of the already
/// validated profile/artifact directory (no temporary directory relocation).
pub fn create_private_stage(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|e| e.to_string())
}

fn durable_copy(from: &Path, to: &Path) -> Result<(), String> {
    let mut input = fs::File::open(from).map_err(|e| e.to_string())?;
    let mut file = create_private_stage(to)?;
    std::io::copy(&mut input, &mut file).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    sync_parent(to)
}

fn rename_durable(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
        }
        let source: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0x1 | 0x8) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    #[cfg(not(windows))]
    fs::rename(from, to).map_err(|e| e.to_string())?;
    sync_parent(to)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Preparing,
    Committing,
    Committed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    path: PathBuf,
    stage: Option<PathBuf>,
    backup: PathBuf,
    original: Option<FileFingerprint>,
    output: Option<FileFingerprint>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u32,
    id: String,
    profile_root: PathBuf,
    roots: Vec<PathBuf>,
    phase: Phase,
    entries: Vec<Entry>,
}

pub struct ArtifactTransaction {
    root: PathBuf,
    roots: Vec<PathBuf>,
    journal: Journal,
    key: SubKey,
    receipt_uncertain: bool,
}

pub fn has_pending(root: &Path) -> Result<bool, String> {
    Ok(root
        .join(JOURNAL_FILENAME)
        .try_exists()
        .map_err(|_| "cannot inspect artifact transition journal")?
        || root
            .join(JOURNAL_PENDING)
            .try_exists()
            .map_err(|_| "cannot inspect pending artifact journal")?)
}

impl ArtifactTransaction {
    pub fn is_committed(&self) -> bool {
        self.journal.phase == Phase::Committed
    }
    pub fn receipt_uncertain(&self) -> bool {
        self.receipt_uncertain
    }
    pub async fn begin(
        root: &Path,
        roots: &[PathBuf],
        state: &EncryptionState,
    ) -> Result<Self, String> {
        Self::begin_with(root, roots, state, Self::persist).await
    }
    async fn begin_with(
        root: &Path,
        roots: &[PathBuf],
        state: &EncryptionState,
        persist: impl FnOnce(&Self) -> Result<(), String>,
    ) -> Result<Self, String> {
        validate_regular_path(root, &root.join(JOURNAL_FILENAME), true)?;
        if has_pending(root)? {
            return Err("an interrupted artifact transition requires recovery".into());
        }
        let key = state
            .sub_key(ArtifactKind::ArtifactPolicy)
            .await
            .ok_or("unlock before artifact transition")?;
        let mut random = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut random);
        let id = random.iter().map(|b| format!("{b:02x}")).collect();
        let mut allowed = roots.to_vec();
        if !allowed.contains(&root.to_path_buf()) {
            allowed.push(root.to_path_buf());
        }
        allowed.sort();
        allowed.dedup();
        for allowed_root in &allowed {
            validate_regular_path(allowed_root, allowed_root, true)?;
        }
        let tx = Self {
            root: root.to_path_buf(),
            roots: allowed.clone(),
            journal: Journal {
                version: 1,
                id,
                profile_root: root.to_path_buf(),
                roots: allowed,
                phase: Phase::Preparing,
                entries: Vec::new(),
            },
            key,
            receipt_uncertain: false,
        };
        // Block ordinary writers BEFORE the first durable mutation, including
        // the pending-only failure window. No subsequent status call is needed.
        state.set_artifact_recovery_required(true);
        if let Err(error) = persist(&tx) {
            crate::artifact_policy::refresh(state).await;
            state.set_artifact_recovery_required(has_pending(root).unwrap_or(true));
            return Err(error);
        }
        Ok(tx)
    }

    fn validate(&self, path: &Path) -> Result<(), String> {
        let root = self
            .roots
            .iter()
            .filter(|root| path.starts_with(root))
            .max_by_key(|root| root.as_os_str().len())
            .ok_or("artifact path is outside configured roots")?;
        validate_regular_path(root, path, true)
    }
    fn sibling(&self, path: &Path, index: usize, suffix: &str) -> Result<PathBuf, String> {
        Ok(path.parent().ok_or("artifact has no parent")?.join(format!(
            ".sorng-artifact-{}-{index}.{suffix}",
            self.journal.id
        )))
    }
    fn persist(&self) -> Result<(), String> {
        self.persist_phase(self.journal.phase)
    }
    fn persist_phase(&self, phase: Phase) -> Result<(), String> {
        self.persist_phase_with(phase, || Ok(()))
    }
    fn persist_phase_with(
        &self,
        phase: Phase,
        before_rename: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut journal = self.journal.clone();
        journal.phase = phase;
        let bytes = serde_json::to_vec(&journal).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES {
            return Err("artifact transition journal exceeds limit".into());
        }
        let mut nonce = [0u8; crate::envelope::NONCE_LEN];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let envelope = crate::envelope::write_envelope(
            &self.key,
            &crate::envelope::EnvelopeHeader::new_vault(nonce),
            &bytes,
        )
        .map_err(|e| e.to_string())?;
        let pending = self.root.join(JOURNAL_PENDING);
        validate_regular_path(&self.root, &pending, true)?;
        // The only overwriteable temporary is this named, encrypted journal.
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&pending)
            .map_err(|e| e.to_string())?;
        file.write_all(&envelope)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        before_rename()?;
        rename_durable(&pending, &self.root.join(JOURNAL_FILENAME))
    }
    fn add(&mut self, path: &Path, replace: bool) -> Result<Option<PathBuf>, String> {
        if self.journal.phase != Phase::Preparing {
            return Err("artifact transaction is already committing".into());
        }
        if self.journal.entries.len() >= MAX_ENTRIES {
            return Err("too many artifact transaction files".into());
        }
        self.validate(path)?;
        if path == self.root.join(JOURNAL_FILENAME)
            || path == self.root.join(JOURNAL_PENDING)
            || path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(".sorng-artifact-"))
        {
            return Err("reserved artifact transition path".into());
        }
        if self.journal.entries.iter().any(|entry| entry.path == path) {
            return Err("duplicate artifact transaction destination".into());
        }
        let index = self.journal.entries.len();
        let backup = self.sibling(path, index, "backup")?;
        let stage = replace
            .then(|| self.sibling(path, index, "stage"))
            .transpose()?;
        if backup.try_exists().map_err(|e| e.to_string())?
            || stage.as_ref().is_some_and(|p| p.exists())
        {
            return Err("artifact transaction temporary collision".into());
        }
        let original = fingerprint(path)?;
        self.journal.entries.push(Entry {
            path: path.to_path_buf(),
            stage: stage.clone(),
            backup,
            original,
            output: None,
        });
        self.persist()?;
        Ok(stage)
    }
    /// Adapter writes and round-trip verifies this bounded-memory stage. It
    /// must never mutate the canonical file itself.
    pub fn replace(&mut self, path: &Path) -> Result<PathBuf, String> {
        self.add(path, true)?
            .ok_or("replacement has no stage".into())
    }
    pub fn remove(&mut self, path: &Path) -> Result<(), String> {
        self.add(path, false).map(|_| ())
    }

    pub fn commit(&mut self) -> Result<(), String> {
        self.commit_with_receipt(|tx| tx.persist_phase(Phase::Committed))
    }
    fn commit_with_receipt(
        &mut self,
        persist_receipt: impl FnOnce(&Self) -> Result<(), String>,
    ) -> Result<(), String> {
        for index in 0..self.journal.entries.len() {
            let entry = &self.journal.entries[index];
            self.validate(&entry.path)?;
            if fingerprint(&entry.path)? != entry.original {
                return Err("artifact changed after preview/staging; commit refused".into());
            }
            let output = if let Some(stage) = &entry.stage {
                self.validate(stage)?;
                fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(stage)
                    .and_then(|f| f.sync_all())
                    .map_err(|e| e.to_string())?;
                Some(fingerprint(stage)?.ok_or("prepared artifact is missing")?)
            } else {
                None
            };
            if entry.original.is_some() {
                durable_copy(&entry.path, &entry.backup)?;
                if fingerprint(&entry.backup)? != entry.original {
                    return Err("artifact rollback copy verification failed".into());
                }
            }
            self.journal.entries[index].output = output;
        }
        self.journal.phase = Phase::Committing;
        self.persist()?;
        for entry in &self.journal.entries {
            if let Some(stage) = &entry.stage {
                self.validate(&entry.path)?;
                if fingerprint(&entry.path)? != entry.original {
                    return Err("artifact changed during commit".into());
                }
                rename_durable(stage, &entry.path)?;
                if fingerprint(&entry.path)? != entry.output {
                    return Err("committed artifact verification failed".into());
                }
            }
        }
        for entry in &self.journal.entries {
            if entry.stage.is_none() && entry.original.is_some() {
                self.validate(&entry.path)?;
                if fingerprint(&entry.path)? != entry.original {
                    return Err("obsolete artifact changed during commit".into());
                }
                fs::remove_file(&entry.path).map_err(|e| e.to_string())?;
                sync_parent(&entry.path)?;
            }
        }
        if let Err(error) = persist_receipt(self) {
            // Never discard rollback copies based on an in-memory phase. The
            // write/rename outcome is uncertain: leave all recovery material.
            self.receipt_uncertain = true;
            return Err(format!(
                "committed receipt durability is uncertain; recovery required: {error}"
            ));
        }
        self.journal.phase = Phase::Committed;
        self.cleanup()
    }

    fn cleanup(&self) -> Result<(), String> {
        for entry in &self.journal.entries {
            for path in entry.stage.iter().chain(std::iter::once(&entry.backup)) {
                self.validate(path)?;
                match fs::remove_file(path) {
                    Ok(()) => sync_parent(path)?,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(format!("artifact cleanup incomplete: {e}")),
                }
            }
        }
        let pending = self.root.join(JOURNAL_PENDING);
        validate_regular_path(&self.root, &pending, true)?;
        match fs::remove_file(&pending) {
            Ok(()) => sync_parent(&pending)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
        let path = self.root.join(JOURNAL_FILENAME);
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        sync_parent(&path)
    }

    pub fn recover(&self) -> Result<(), String> {
        if self.receipt_uncertain {
            return Err(
                "restart or explicitly recover the durable artifact journal before cleanup".into(),
            );
        }
        if self.journal.phase == Phase::Committing {
            // Verify the entire recovery plan before modifying even one file.
            for entry in &self.journal.entries {
                self.validate(&entry.path)?;
                self.validate(&entry.backup)?;
                let current = fingerprint(&entry.path)?;
                if entry.original.is_some()
                    && current != entry.original
                    && fingerprint(&entry.backup)? != entry.original
                {
                    return Err(
                        "artifact rollback receipt is missing or changed; recovery remains blocked"
                            .into(),
                    );
                }
                if current != entry.original && current != entry.output {
                    return Err(
                        "artifact changed outside the transaction; recovery remains blocked".into(),
                    );
                }
            }
            for entry in self.journal.entries.iter().rev() {
                match &entry.original {
                    Some(_) if fingerprint(&entry.path)? != entry.original => {
                        rename_durable(&entry.backup, &entry.path)?
                    }
                    Some(_) => (),
                    None => match fs::remove_file(&entry.path) {
                        Ok(()) => sync_parent(&entry.path)?,
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                        Err(e) => return Err(e.to_string()),
                    },
                }
                if fingerprint(&entry.path)? != entry.original {
                    return Err("artifact rollback read-back failed".into());
                }
            }
        } else if self.journal.phase == Phase::Committed {
            for entry in &self.journal.entries {
                self.validate(&entry.path)?;
                if fingerprint(&entry.path)? != entry.output {
                    return Err("committed artifact changed; cleanup requires review".into());
                }
            }
        }
        self.cleanup()
    }

    pub async fn recover_pending(
        root: &Path,
        _roots: &[PathBuf],
        state: &EncryptionState,
    ) -> Result<(), String> {
        let canonical = root.join(JOURNAL_FILENAME);
        let pending_only = !canonical.try_exists().map_err(|e| e.to_string())?;
        let path = if pending_only {
            root.join(JOURNAL_PENDING)
        } else {
            canonical.clone()
        };
        validate_regular_path(root, &path, false)?;
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() > MAX_JOURNAL_BYTES {
            return Err("artifact recovery journal exceeds limit".into());
        }
        let key = state
            .sub_key(ArtifactKind::ArtifactPolicy)
            .await
            .ok_or("unlock before artifact recovery")?;
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let (_, plain) = crate::envelope::read_envelope(&key, &bytes)
            .map_err(|_| "artifact recovery journal authentication failed")?;
        let journal: Journal =
            serde_json::from_slice(&plain).map_err(|_| "invalid artifact recovery journal")?;
        if journal.version != 1
            || journal.id.len() != 32
            || !journal.id.bytes().all(|b| b.is_ascii_hexdigit())
            || journal.entries.len() > MAX_ENTRIES
        {
            return Err("invalid artifact recovery journal identity".into());
        }
        // Settings/config hydration is intentionally blocked during recovery.
        // Trust only the authenticated original native root contract, bound to
        // this profile, not reset service defaults or renderer-supplied paths.
        if journal.profile_root != root
            || !journal.roots.contains(&root.to_path_buf())
            || journal.roots.len() > MAX_ENTRIES
        {
            return Err(
                "artifact recovery journal belongs to another profile or has invalid roots".into(),
            );
        }
        for allowed_root in &journal.roots {
            validate_regular_path(allowed_root, allowed_root, true)?;
        }
        if pending_only {
            if journal.phase != Phase::Preparing || !journal.entries.is_empty() {
                return Err(
                    "unidentified pending artifact journal; recovery remains blocked".into(),
                );
            }
            // No adapter can stage data before the first journal is installed.
            // Authenticate that exact empty first journal before removing it.
            rename_durable(&path, &canonical)?;
        }
        let tx = Self {
            root: root.to_path_buf(),
            roots: journal.roots.clone(),
            journal,
            key,
            receipt_uncertain: false,
        };
        for (index, entry) in tx.journal.entries.iter().enumerate() {
            tx.validate(&entry.path)?;
            if entry.backup != tx.sibling(&entry.path, index, "backup")?
                || entry.stage.as_ref().is_some_and(|p| {
                    Some(p) != tx.sibling(&entry.path, index, "stage").ok().as_ref()
                })
            {
                return Err("artifact recovery paths do not match transaction identity".into());
            }
        }
        tx.recover()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture() -> (tempfile::TempDir, EncryptionState) {
        let dir = tempfile::tempdir().unwrap();
        let state = EncryptionState::new();
        state.install(crate::MasterDek::generate()).await;
        (dir, state)
    }
    #[tokio::test]
    async fn verified_replace_remove_and_policy_only_commit() {
        let (dir, state) = fixture().await;
        let source = dir.path().join("old.json");
        let dest = dir.path().join("new.enc");
        fs::write(&source, b"old").unwrap();
        let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
            .await
            .unwrap();
        let stage = tx.replace(&dest).unwrap();
        fs::write(stage, b"encoded").unwrap();
        tx.remove(&source).unwrap();
        tx.commit().unwrap();
        assert_eq!(fs::read(dest).unwrap(), b"encoded");
        assert!(!source.exists());
        assert!(!has_pending(dir.path()).unwrap());
    }
    #[tokio::test]
    async fn interrupted_preparation_does_not_modify_sources() {
        let (dir, state) = fixture().await;
        let source = dir.path().join("file");
        fs::write(&source, b"old").unwrap();
        let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
            .await
            .unwrap();
        fs::write(tx.replace(&source).unwrap(), b"new").unwrap();
        drop(tx);
        ArtifactTransaction::recover_pending(dir.path(), &[], &state)
            .await
            .unwrap();
        assert_eq!(fs::read(source).unwrap(), b"old");
    }
    #[tokio::test]
    async fn interrupted_commit_rolls_back_but_committed_phase_only_cleans_up() {
        for committed in [false, true] {
            let (dir, state) = fixture().await;
            let source = dir.path().join("file");
            fs::write(&source, b"old").unwrap();
            let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
                .await
                .unwrap();
            let stage = tx.replace(&source).unwrap();
            fs::write(&stage, b"new").unwrap();
            let entry = &mut tx.journal.entries[0];
            durable_copy(&source, &entry.backup).unwrap();
            entry.output = fingerprint(&stage).unwrap();
            rename_durable(&stage, &source).unwrap();
            tx.journal.phase = if committed {
                Phase::Committed
            } else {
                Phase::Committing
            };
            tx.persist().unwrap();
            drop(tx);
            ArtifactTransaction::recover_pending(dir.path(), &[], &state)
                .await
                .unwrap();
            assert_eq!(
                fs::read(source).unwrap(),
                if committed { b"new" } else { b"old" }
            );
        }
    }
    #[tokio::test]
    async fn source_drift_and_journal_tamper_fail_closed() {
        let (dir, state) = fixture().await;
        let source = dir.path().join("file");
        fs::write(&source, b"old").unwrap();
        let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
            .await
            .unwrap();
        fs::write(tx.replace(&source).unwrap(), b"new").unwrap();
        fs::write(&source, b"external").unwrap();
        assert!(tx.commit().is_err());
        assert_eq!(fs::read(source).unwrap(), b"external");
        let path = dir.path().join(JOURNAL_FILENAME);
        let mut raw = fs::read(&path).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 1;
        fs::write(path, raw).unwrap();
        assert!(
            ArtifactTransaction::recover_pending(dir.path(), &[], &state)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn outside_paths_and_duplicate_targets_rejected() {
        let (dir, state) = fixture().await;
        let other = tempfile::tempdir().unwrap();
        let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
            .await
            .unwrap();
        assert!(tx.replace(&other.path().join("outside")).is_err());
        assert!(tx.replace(&dir.path().join("../outside")).is_err());
        tx.replace(&dir.path().join("one")).unwrap();
        assert!(tx.remove(&dir.path().join("one")).is_err());
        tx.recover().unwrap();
    }

    #[tokio::test]
    async fn first_journal_rename_failure_blocks_writers_without_status_and_recovers_pending_only()
    {
        let (dir, state) = fixture().await;
        crate::artifact_policy::initialize(&state, dir.path()).await;
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, true)
            .is_ok());
        let result = ArtifactTransaction::begin_with(dir.path(), &[], &state, |tx| {
            tx.persist_phase_with(Phase::Preparing, || {
                Err("injected first journal rename failure".into())
            })
        })
        .await;
        assert!(result.is_err());
        assert!(!dir.path().join(JOURNAL_FILENAME).exists());
        assert!(dir.path().join(JOURNAL_PENDING).exists());
        assert!(state.artifact_recovery_required());
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, true)
            .is_err());
        ArtifactTransaction::recover_pending(dir.path(), &[], &state)
            .await
            .unwrap();
        crate::artifact_policy::refresh(&state).await;
        assert!(!has_pending(dir.path()).unwrap());
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, true)
            .is_ok());
    }

    #[tokio::test]
    async fn failed_committed_receipt_never_cleans_rollback_sources() {
        for after_pending_write in [false, true] {
            let (dir, state) = fixture().await;
            let source = dir.path().join("file");
            fs::write(&source, b"old").unwrap();
            let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
                .await
                .unwrap();
            durable_write(&tx.replace(&source).unwrap(), b"new").unwrap();
            let error = tx
                .commit_with_receipt(|tx| {
                    if after_pending_write {
                        tx.persist_phase_with(Phase::Committed, || {
                            Err("injected committed receipt rename failure".into())
                        })
                    } else {
                        Err("injected committed receipt write failure".into())
                    }
                })
                .unwrap_err();
            assert!(error.contains("recovery required"));
            assert!(!tx.is_committed());
            assert!(tx.receipt_uncertain());
            assert!(tx.journal.entries[0].backup.exists());
            assert!(tx.recover().is_err());
            assert_eq!(fs::read(&source).unwrap(), b"new");
            drop(tx);
            ArtifactTransaction::recover_pending(dir.path(), &[], &state)
                .await
                .unwrap();
            assert_eq!(fs::read(source).unwrap(), b"old");
            assert!(!has_pending(dir.path()).unwrap());
        }
    }

    #[tokio::test]
    async fn interrupted_copy_cleanup_and_committed_cleanup_are_retryable() {
        let (dir, state) = fixture().await;
        let source = dir.path().join("file");
        fs::write(&source, b"original").unwrap();
        let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
            .await
            .unwrap();
        durable_write(&tx.replace(&source).unwrap(), b"partial-stage").unwrap();
        durable_write(&tx.journal.entries[0].backup, b"partial-backup").unwrap();
        drop(tx);
        ArtifactTransaction::recover_pending(dir.path(), &[], &state)
            .await
            .unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
            .await
            .unwrap();
        let stage = tx.replace(&source).unwrap();
        durable_write(&stage, b"committed").unwrap();
        durable_copy(&source, &tx.journal.entries[0].backup).unwrap();
        tx.journal.entries[0].output = fingerprint(&stage).unwrap();
        rename_durable(&stage, &source).unwrap();
        tx.journal.phase = Phase::Committed;
        tx.persist().unwrap();
        fs::remove_file(&tx.journal.entries[0].backup).unwrap();
        drop(tx);
        ArtifactTransaction::recover_pending(dir.path(), &[], &state)
            .await
            .unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"committed");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn same_length_external_edit_is_rejected_at_commit() {
        let (dir, state) = fixture().await;
        let source = dir.path().join("file");
        fs::write(&source, b"old").unwrap();
        let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
            .await
            .unwrap();
        durable_write(&tx.replace(&source).unwrap(), b"new").unwrap();
        fs::write(&source, b"BAD").unwrap();
        assert!(tx.commit().is_err());
        tx.recover().unwrap();
        assert_eq!(fs::read(source).unwrap(), b"BAD");
    }

    #[cfg(unix)]
    #[test]
    fn plaintext_stages_and_backups_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        durable_write(&source, b"private").unwrap();
        let backup = dir.path().join("backup");
        durable_copy(&source, &backup).unwrap();
        for path in [&source, &backup] {
            assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o077, 0);
        }
    }

    #[tokio::test]
    async fn rollback_keeps_policy_marker_and_data_in_one_consistent_generation() {
        use crate::artifact_policy::{self, PolicyDocument, ProtectionMode};
        for previous_policy in [false, true] {
            let (dir, state) = fixture().await;
            let data = dir.path().join("data");
            fs::write(&data, b"original").unwrap();
            let policy_path = dir.path().join(artifact_policy::POLICY_FILENAME);
            let marker_path = dir.path().join(artifact_policy::POLICY_MARKER);
            let old = PolicyDocument::default()
                .with_mode(ArtifactKind::Settings, ProtectionMode::Encrypted)
                .unwrap();
            if previous_policy {
                fs::write(
                    &policy_path,
                    artifact_policy::encode(&state, &old).await.unwrap(),
                )
                .unwrap();
                fs::write(&marker_path, b"1").unwrap();
            }
            artifact_policy::initialize(&state, dir.path()).await;
            let before = fingerprint(&policy_path).unwrap();
            let mut tx = ArtifactTransaction::begin(dir.path(), &[], &state)
                .await
                .unwrap();
            durable_write(&tx.replace(&data).unwrap(), b"changed").unwrap();
            let next = old
                .with_mode(ArtifactKind::Settings, ProtectionMode::Plaintext)
                .unwrap();
            durable_write(
                &tx.replace(&policy_path).unwrap(),
                &artifact_policy::encode(&state, &next).await.unwrap(),
            )
            .unwrap();
            durable_write(&tx.replace(&marker_path).unwrap(), b"1").unwrap();
            assert!(tx
                .commit_with_receipt(|_| Err("injected policy receipt failure".into()))
                .is_err());
            drop(tx);
            ArtifactTransaction::recover_pending(dir.path(), &[], &state)
                .await
                .unwrap();
            artifact_policy::refresh(&state).await;
            assert_eq!(fs::read(data).unwrap(), b"original");
            assert_eq!(fingerprint(&policy_path).unwrap(), before);
            assert_eq!(marker_path.exists(), previous_policy);
            assert!(state
                .resolve_write_policy(ArtifactKind::Settings, true)
                .unwrap());
            assert!(!has_pending(dir.path()).unwrap());
        }
    }

    #[tokio::test]
    async fn authenticated_external_roots_survive_service_reset_but_not_profile_replay() {
        let (dir, state) = fixture().await;
        let external = tempfile::tempdir().unwrap();
        let source = external.path().join("backup.json");
        fs::write(&source, b"old backup").unwrap();
        let mut tx =
            ArtifactTransaction::begin(dir.path(), &[external.path().to_path_buf()], &state)
                .await
                .unwrap();
        durable_write(&tx.replace(&source).unwrap(), b"new backup").unwrap();
        assert!(tx
            .commit_with_receipt(|_| Err("injected crash before committed receipt".into()))
            .is_err());
        drop(tx);
        let other = tempfile::tempdir().unwrap();
        fs::copy(
            dir.path().join(JOURNAL_FILENAME),
            other.path().join(JOURNAL_FILENAME),
        )
        .unwrap();
        assert!(ArtifactTransaction::recover_pending(
            other.path(),
            &[external.path().to_path_buf()],
            &state
        )
        .await
        .unwrap_err()
        .contains("another profile"));
        assert_eq!(fs::read(&source).unwrap(), b"new backup");
        // Restarted BackupService knows only its default root; recovery must
        // still reach the originally authorized external local directory.
        ArtifactTransaction::recover_pending(dir.path(), &[], &state)
            .await
            .unwrap();
        assert_eq!(fs::read(source).unwrap(), b"old backup");
        assert!(!has_pending(dir.path()).unwrap());
    }
}
