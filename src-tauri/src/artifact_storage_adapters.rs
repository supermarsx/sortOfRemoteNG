//! Read-only inventory and verified staging for physical managed artifacts.
//! Capture roots under a short coordinator lease; inspection itself is read-only
//! and content-fenced. Preparation/commit hold the coordinator throughout.
//! No caller-supplied artifact paths reach this API.

use sha2::{Digest, Sha256};
use sorng_encryption::{
    artifact_policy::{ArtifactStatus, DiskState, PolicyMode, ProtectionMode, DATA_ARTIFACTS},
    artifact_transaction::{self, ArtifactTransaction, FileFingerprint},
    artifacts::recording_media,
    envelope, ArtifactKind, EncryptionState,
};
use sorng_storage::{envelope_io, sdbf};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[cfg(test)]
#[path = "tests/artifact_storage_adapters.rs"]
mod tests;

const MAX_DOCUMENT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const GENERATIONS: &[&str] = &["", ".v0.bak", ".previous", ".bak", ".tmp"];

#[derive(Clone)]
pub struct ArtifactRoots {
    pub app_data: PathBuf,
    /// Canonical SecureStorage file, not its parent directory.
    pub legacy_storage: PathBuf,
    pub recordings: PathBuf,
    pub backups: Vec<PathBuf>,
    pub backup_restrictions: Vec<String>,
    pub logs: PathBuf,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Encoding {
    Json,
    Sdbf,
    RenamedJson,
    Media,
    Logs,
    Backup,
    BackupMetadata,
    Protected,
}

#[derive(Clone)]
struct ArtifactFile {
    path: PathBuf,
    kind: ArtifactKind,
    encoding: Encoding,
    encrypted: bool,
    fingerprint: FileFingerprint,
    plaintext_sha256: String,
}

#[derive(Default)]
struct HashWriter(Sha256);
impl Write for HashWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl HashWriter {
    fn finish(self) -> String {
        format!("{:x}", self.0.finalize())
    }
}

#[derive(Clone)]
pub struct ArtifactScan {
    pub rows: Vec<ArtifactStatus>,
    pub roots: Vec<PathBuf>,
    files: Vec<ArtifactFile>,
    root_contracts: BTreeMap<ArtifactKind, String>,
}

impl ArtifactScan {
    pub fn encrypted_backup_pairs(
        &self,
    ) -> Result<Vec<sorng_storage::backup::BackupRewritePair>, String> {
        let mut pairs = Vec::new();
        for file in self
            .files
            .iter()
            .filter(|file| file.encoding == Encoding::Backup && file.encrypted)
        {
            let metadata_path = backup_metadata_path(&file.path)?;
            if !self.files.iter().any(|metadata| {
                metadata.path == metadata_path && metadata.encoding == Encoding::BackupMetadata
            }) {
                return Err(
                    "encrypted backup generation has no verified matching metadata generation"
                        .into(),
                );
            }
            pairs.push(sorng_storage::backup::BackupRewritePair {
                archive_path: file.path.clone(),
                metadata_path,
            });
        }
        Ok(pairs)
    }
    pub fn encrypted_inventory(&self) -> Vec<(ArtifactKind, PathBuf)> {
        self.files
            .iter()
            .filter(|file| file.encrypted)
            .map(|file| (file.kind, file.path.clone()))
            .collect()
    }
    pub fn fingerprint_for(&self, kinds: &[ArtifactKind]) -> String {
        let mut hash = Sha256::new();
        for kind in selected_kinds(kinds) {
            if let Some(contract) = self.root_contracts.get(&kind) {
                hash.update(contract.as_bytes());
            }
        }
        for file in self.files.iter().filter(|file| kinds.contains(&file.kind)) {
            hash.update(file.path.to_string_lossy().as_bytes());
            hash.update(file.fingerprint.sha256.as_bytes());
        }
        for row in self.rows.iter().filter(|row| kinds.contains(&row.id)) {
            hash.update(
                format!(
                    "{:?}:{:?}:{}:{:?}",
                    row.id, row.policy, row.unverified_files, row.reason
                )
                .as_bytes(),
            );
        }
        format!("{:x}", hash.finalize())
    }
}

fn selected_kinds(kinds: &[ArtifactKind]) -> BTreeSet<ArtifactKind> {
    kinds.iter().copied().collect()
}

fn recovery_base(name: &str) -> (&str, &str) {
    for suffix in &GENERATIONS[1..] {
        if let Some(base) = name.strip_suffix(suffix) {
            return (base, suffix);
        }
    }
    (name, "")
}

fn backup_metadata_path(path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("invalid backup name")?;
    let (base, generation) = recovery_base(name);
    Ok(path.with_file_name(format!("{base}.meta.json{generation}")))
}

fn bounded_read(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_DOCUMENT_BYTES {
        return Err("document exceeds the 256 MiB inspection limit".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("document grew beyond the inspection limit".into());
    }
    Ok(bytes)
}

fn read_payload(path: &Path, encoding: Encoding) -> Result<Vec<u8>, String> {
    let bytes = bounded_read(path)?;
    if encoding == Encoding::Sdbf && bytes.starts_with(sdbf::MAGIC) {
        let payload = sdbf::parse_and_verify(&bytes).map_err(|e| e.to_string())?;
        if payload.len() + sdbf::PREAMBLE_LEN != bytes.len() {
            return Err("database generation has unrecognized trailing data".into());
        }
        Ok(payload.to_vec())
    } else {
        Ok(bytes)
    }
}

async fn decode_bytes(
    state: &EncryptionState,
    kind: ArtifactKind,
    bytes: &[u8],
) -> Result<Vec<u8>, String> {
    if !bytes.starts_with(envelope::MAGIC) {
        return Ok(bytes.to_vec());
    }
    let key = state
        .sub_key(kind)
        .await
        .ok_or("encrypted content cannot be authenticated while locked")?;
    match envelope_io::decrypt_with_subkey(&key, bytes) {
        Ok(plain) => Ok(plain),
        Err(_) => sorng_encryption::key_ring::try_decrypt_retired(state, kind, bytes)
            .await
            .ok_or("artifact authentication failed".into()),
    }
}

// Historical log files concatenate independently authenticated envelopes but
// carry no length prefix. Candidate boundaries are accepted only after GCM
// authentication; a bounded candidate count prevents pathological scans.
async fn decode_logs(state: &EncryptionState, bytes: &[u8]) -> Result<Vec<u8>, String> {
    if !bytes.starts_with(envelope::MAGIC) {
        return Ok(bytes.to_vec());
    }
    let mut boundaries: Vec<usize> = bytes
        .windows(envelope::MAGIC.len())
        .enumerate()
        .filter_map(|(index, magic)| (magic == envelope::MAGIC).then_some(index))
        .take(4097)
        .collect();
    if boundaries.len() > 4096 {
        return Err("log has too many envelope boundaries to inspect safely".into());
    }
    boundaries.push(bytes.len());
    let mut start = 0;
    let mut plain = Vec::new();
    while start < bytes.len() {
        let mut matched = None;
        for end in boundaries
            .iter()
            .copied()
            .filter(|end| *end > start + envelope::PREAMBLE_LEN)
        {
            if let Ok(block) = decode_bytes(state, ArtifactKind::Logs, &bytes[start..end]).await {
                matched = Some((end, block));
                break;
            }
        }
        let (end, block) = matched.ok_or("log segment authentication failed or is truncated")?;
        plain.extend_from_slice(&block);
        start = end;
    }
    Ok(plain)
}

fn add_reason(row: &mut ArtifactStatus, reason: &str) {
    let previous = row.reason.get_or_insert_with(String::new);
    if !previous.is_empty() {
        previous.push_str("; ");
    }
    if previous.len() < 4096 {
        previous.push_str(reason);
    }
}

fn add_generations(
    candidates: &mut BTreeMap<PathBuf, (ArtifactKind, Encoding)>,
    path: &Path,
    kind: ArtifactKind,
    encoding: Encoding,
) {
    for suffix in GENERATIONS {
        candidates.insert(
            PathBuf::from(format!("{}{suffix}", path.display())),
            (kind, encoding),
        );
    }
}

fn entries(dir: &Path) -> Result<Vec<PathBuf>, String> {
    match fs::symlink_metadata(dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
        Ok(_) => artifact_transaction::validate_regular_path(dir, dir, false)?,
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        if paths.len() >= MAX_FILES {
            return Err("artifact directory exceeds 20,000 entries".into());
        }
        paths.push(entry.map_err(|e| e.to_string())?.path());
    }
    Ok(paths)
}

pub async fn scan(roots: &ArtifactRoots, state: &EncryptionState) -> Result<ArtifactScan, String> {
    let kinds: Vec<_> = DATA_ARTIFACTS
        .iter()
        .copied()
        .chain([ArtifactKind::KeyRing, ArtifactKind::ArtifactPolicy])
        .collect();
    scan_selected(roots, state, &kinds).await
}

/// Preview/apply need authenticate only the selected families. A full status
/// table deliberately uses `scan`, but selecting Settings never reads media.
pub async fn scan_selected(
    roots: &ArtifactRoots,
    state: &EncryptionState,
    selected: &[ArtifactKind],
) -> Result<ArtifactScan, String> {
    let policy = state.artifact_policy_document();
    let mut rows: BTreeMap<_, _> = DATA_ARTIFACTS
        .iter()
        .copied()
        .chain([ArtifactKind::KeyRing, ArtifactKind::ArtifactPolicy])
        .map(|kind| {
            let mode = policy
                .as_ref()
                .ok()
                .and_then(|p| p.overrides.get(&kind).copied());
            (
                kind,
                ArtifactStatus {
                    id: kind,
                    policy: if DATA_ARTIFACTS.contains(&kind) {
                        PolicyMode::from(mode)
                    } else {
                        PolicyMode::Encrypted
                    },
                    disk_state: DiskState::Absent,
                    encrypted_files: 0,
                    plaintext_files: 0,
                    unverified_files: 0,
                    bytes: 0,
                    mutable: DATA_ARTIFACTS.contains(&kind),
                    reason: None,
                },
            )
        })
        .collect();
    add_reason(
        rows.get_mut(&ArtifactKind::Macros).unwrap(),
        "Native recording macro files only; macros embedded in settings follow Settings policy",
    );
    add_reason(rows.get_mut(&ArtifactKind::Logs).unwrap(), "Native runtime files only; encryption-audit logs intentionally remain plaintext and frontend histories follow their containing storage");
    for kind in [ArtifactKind::KeyRing, ArtifactKind::ArtifactPolicy] {
        add_reason(
            rows.get_mut(&kind).unwrap(),
            "Protected key-management artifact; plaintext opt-out is not permitted",
        );
    }
    for reason in &roots.backup_restrictions {
        let row = rows.get_mut(&ArtifactKind::Backups).unwrap();
        row.unverified_files += 1;
        add_reason(row, reason);
    }
    for name in ["trust_store.json", "rdp-cert-trust.json"] {
        for suffix in GENERATIONS {
            let path = roots.app_data.join(format!("{name}{suffix}"));
            match fs::symlink_metadata(&path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                _ => {
                    let row = rows.get_mut(&ArtifactKind::TrustStore).unwrap();
                    row.unverified_files += 1;
                    add_reason(row, "Legacy trust sidecars remain: migrate and delete legacy files using Trust Center before managing TrustStore protection");
                }
            }
        }
    }
    let database_control_pending = [".database-security-transaction", ".database-security-committed"].iter().any(|name| {
        GENERATIONS.iter().any(|suffix| !matches!(fs::symlink_metadata(roots.app_data.join("databases").join(format!("{name}{suffix}"))), Err(error) if error.kind() == std::io::ErrorKind::NotFound))
    });
    if database_control_pending {
        for kind in [
            ArtifactKind::Connections,
            ArtifactKind::DatabasesIndex,
            ArtifactKind::TrustStore,
        ] {
            let row = rows.get_mut(&kind).unwrap();
            row.unverified_files += 1;
            add_reason(
                row,
                "Pending database security transaction must recover before artifact conversion",
            );
        }
    }
    let mut allowed = vec![
        roots.app_data.clone(),
        roots.recordings.clone(),
        roots.logs.clone(),
    ];
    allowed.extend(roots.backups.clone());
    allowed.push(
        roots
            .legacy_storage
            .parent()
            .ok_or("legacy storage path has no parent")?
            .to_path_buf(),
    );
    allowed.sort();
    allowed.dedup();
    let mut candidates = BTreeMap::new();
    add_generations(
        &mut candidates,
        &roots.legacy_storage,
        ArtifactKind::Connections,
        Encoding::Json,
    );
    for name in ["settings.json", "settings.enc"] {
        add_generations(
            &mut candidates,
            &roots.app_data.join(name),
            ArtifactKind::Settings,
            Encoding::RenamedJson,
        );
    }
    add_generations(
        &mut candidates,
        &roots.recordings.join("config.json"),
        ArtifactKind::RecordingsMeta,
        Encoding::Json,
    );
    add_generations(
        &mut candidates,
        &roots.app_data.join("dek-ring.enc"),
        ArtifactKind::KeyRing,
        Encoding::Protected,
    );
    add_generations(
        &mut candidates,
        &roots
            .app_data
            .join(sorng_encryption::artifact_policy::POLICY_FILENAME),
        ArtifactKind::ArtifactPolicy,
        Encoding::Protected,
    );
    let directories = [
        (roots.app_data.join("databases"), ArtifactKind::Connections),
        (
            roots.recordings.join("recordings"),
            ArtifactKind::RecordingsMeta,
        ),
        (
            roots.recordings.join("inflight"),
            ArtifactKind::RecordingsMeta,
        ),
        (roots.recordings.join("macros"), ArtifactKind::Macros),
        (roots.logs.clone(), ArtifactKind::Logs),
    ];
    for (dir, default_kind) in directories.into_iter().chain(
        roots
            .backups
            .iter()
            .cloned()
            .map(|p| (p, ArtifactKind::Backups)),
    ) {
        let affected: &[ArtifactKind] = match default_kind {
            ArtifactKind::Connections => &[
                ArtifactKind::Connections,
                ArtifactKind::DatabasesIndex,
                ArtifactKind::TrustStore,
            ],
            ArtifactKind::RecordingsMeta => {
                &[ArtifactKind::RecordingsMeta, ArtifactKind::RecordingsMedia]
            }
            _ => std::slice::from_ref(&default_kind),
        };
        if !affected.iter().any(|kind| selected.contains(kind)) {
            continue;
        }
        let paths = match entries(&dir) {
            Ok(paths) => paths,
            Err(error) => {
                let affected: &[ArtifactKind] = match default_kind {
                    ArtifactKind::Connections => &[
                        ArtifactKind::Connections,
                        ArtifactKind::DatabasesIndex,
                        ArtifactKind::TrustStore,
                    ],
                    ArtifactKind::RecordingsMeta => {
                        &[ArtifactKind::RecordingsMeta, ArtifactKind::RecordingsMedia]
                    }
                    _ => std::slice::from_ref(&default_kind),
                };
                for kind in affected {
                    let row = rows.get_mut(kind).unwrap();
                    row.unverified_files += 1;
                    add_reason(row, &format!("{}: {error}", dir.display()));
                }
                continue;
            }
        };
        for path in paths {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or("artifact filename is not valid Unicode")?;
            if name.starts_with(".sorng-artifact-") {
                continue;
            }
            let (base, _) = recovery_base(name);
            let (kind, encoding) = match default_kind {
                ArtifactKind::Connections => {
                    if base == "index.json" {
                        (ArtifactKind::DatabasesIndex, Encoding::Sdbf)
                    } else if base.ends_with(".trust.json") {
                        (ArtifactKind::TrustStore, Encoding::Sdbf)
                    } else if base.ends_with(".json") {
                        (default_kind, Encoding::Sdbf)
                    } else {
                        continue;
                    }
                }
                ArtifactKind::Logs => {
                    if name.starts_with("encryption-audit") {
                        continue;
                    }
                    if !base.contains(".log") {
                        continue;
                    }
                    (default_kind, Encoding::Logs)
                }
                ArtifactKind::Backups => {
                    if !base.starts_with("backup_") {
                        continue;
                    }
                    if ![".json", ".json.gz", ".xml", ".xml.gz"]
                        .iter()
                        .any(|suffix| base.ends_with(suffix))
                    {
                        let row = rows.get_mut(&default_kind).unwrap();
                        row.unverified_files += 1;
                        add_reason(row, "Unrecognized backup generation requires review; it will not be converted automatically");
                        continue;
                    }
                    (
                        default_kind,
                        if base.ends_with(".meta.json") {
                            Encoding::BackupMetadata
                        } else {
                            Encoding::Backup
                        },
                    )
                }
                ArtifactKind::Macros if base.ends_with(".json") || base.ends_with(".json.enc") => {
                    (default_kind, Encoding::RenamedJson)
                }
                _ if base.ends_with(".snapshot")
                    || base.ends_with(".json")
                    || base.ends_with(".json.enc") =>
                {
                    (
                        default_kind,
                        if base.ends_with(".snapshot") {
                            Encoding::Json
                        } else {
                            Encoding::RenamedJson
                        },
                    )
                }
                _ if [".media", ".webm", ".mp4", ".gif"]
                    .iter()
                    .any(|suffix| base.strip_suffix(".enc").unwrap_or(base).ends_with(suffix)) =>
                {
                    (ArtifactKind::RecordingsMedia, Encoding::Media)
                }
                _ => {
                    let row = rows.get_mut(&default_kind).unwrap();
                    row.unverified_files += 1;
                    add_reason(
                        row,
                        &format!(
                            "Unrecognized file {}; not a managed artifact",
                            path.display()
                        ),
                    );
                    continue;
                }
            };
            if let Some((previous_kind, _)) = candidates.get(&path) {
                if *previous_kind != kind {
                    for owner in [*previous_kind, kind] {
                        let row = rows.get_mut(&owner).unwrap();
                        row.unverified_files += 1;
                        add_reason(row, "Overlapping configured roots assign the same physical file to different artifacts; choose separate roots before conversion");
                    }
                    continue;
                }
            }
            candidates.insert(path, (kind, encoding));
        }
    }
    candidates.retain(|_, (kind, _)| selected.contains(kind));
    if candidates.len() > MAX_FILES {
        return Err("managed artifacts exceed the 20,000-file scan limit".into());
    }
    let mut files = Vec::new();
    for (path, (kind, encoding)) in candidates {
        let row = rows.get_mut(&kind).unwrap();
        let inspected = async {
            match fs::symlink_metadata(&path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(e) => return Err(e.to_string()),
                Ok(_) => {}
            }
            let root = allowed
                .iter()
                .filter(|root| path.starts_with(root))
                .max_by_key(|p| p.as_os_str().len())
                .ok_or("artifact outside managed roots")?;
            artifact_transaction::validate_regular_path(root, &path, false)?;
            let fingerprint =
                artifact_transaction::fingerprint(&path)?.ok_or("artifact disappeared")?;
            let (encrypted, plaintext_sha256) = if encoding == Encoding::Media {
                let mut input = fs::File::open(&path).map_err(|e| e.to_string())?;
                let mut header = [0; recording_media::HEADER_LEN];
                let count = input.read(&mut header).map_err(|e| e.to_string())?;
                let encrypted = count >= 6 && header.starts_with(envelope::MAGIC);
                let plain_hash = if encrypted {
                    let key = state
                        .sub_key(kind)
                        .await
                        .ok_or("encrypted media cannot be authenticated while locked")?;
                    let mut hash = HashWriter::default();
                    recording_media::decrypt_stream_with_key(
                        &key,
                        &mut fs::File::open(&path).map_err(|e| e.to_string())?,
                        &mut hash,
                        fingerprint.bytes,
                        &mut |_| Ok(()),
                    )?;
                    hash.finish()
                } else {
                    fingerprint.sha256.clone()
                };
                (encrypted, plain_hash)
            } else {
                let bytes = read_payload(&path, encoding)?;
                let encrypted = bytes.starts_with(envelope::MAGIC);
                let plain = if encoding == Encoding::Logs {
                    decode_logs(state, &bytes).await?
                } else {
                    decode_bytes(state, kind, &bytes).await?
                };
                if !matches!(encoding, Encoding::Logs | Encoding::Backup) {
                    serde_json::from_slice::<serde_json::Value>(&plain)
                        .map_err(|_| "artifact is not valid JSON")?;
                }
                if encoding == Encoding::Protected && !encrypted {
                    return Err("protected artifact is not encrypted".into());
                }
                (encrypted, format!("{:x}", Sha256::digest(&plain)))
            };
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("invalid artifact name")?;
            if recovery_base(name).0.ends_with(".enc") && !encrypted {
                return Err("encrypted artifact filename has no valid encrypted envelope".into());
            }
            if artifact_transaction::fingerprint(&path)?.as_ref() != Some(&fingerprint) {
                return Err("artifact changed while verifying".into());
            }
            Ok::<_, String>(Some(ArtifactFile {
                path: path.clone(),
                kind,
                encoding,
                encrypted,
                fingerprint,
                plaintext_sha256,
            }))
        }
        .await;
        match inspected {
            Ok(Some(file)) => {
                row.bytes += file.fingerprint.bytes;
                if file.encrypted {
                    row.encrypted_files += 1;
                } else {
                    row.plaintext_files += 1;
                }
                files.push(file);
            }
            Ok(None) => {}
            Err(error) => {
                row.unverified_files += 1;
                add_reason(row, &format!("{}: {error}", path.display()));
            }
        }
    }
    let mut paired_metadata = BTreeSet::new();
    for file in files
        .iter()
        .filter(|file| file.encoding == Encoding::Backup)
    {
        let validation = async {
            let metadata_path = backup_metadata_path(&file.path)?;
            if !files.iter().any(|candidate| candidate.path == metadata_path && candidate.encoding == Encoding::BackupMetadata) { return Err("backup archive has no verified matching metadata generation".to_string()); }
            let metadata_bytes = read_payload(&metadata_path, Encoding::BackupMetadata)?;
            let plain = decode_bytes(state, ArtifactKind::Backups, &metadata_bytes).await?;
            let metadata: sorng_storage::backup::BackupMetadata = serde_json::from_slice(&plain).map_err(|_| "backup integrity metadata is invalid".to_string())?;
            if metadata.checksum_scope.as_deref() != Some("archive-sha256-v1") || metadata.checksum != file.fingerprint.sha256 || metadata.size_bytes != file.fingerprint.bytes || metadata.encrypted != file.encrypted {
                return Err("backup archive and integrity metadata disagree or use an unsupported legacy checksum".into());
            }
            paired_metadata.insert(metadata_path);
            Ok::<_, String>(())
        }.await;
        if let Err(error) = validation {
            let row = rows.get_mut(&ArtifactKind::Backups).unwrap();
            row.unverified_files += 1;
            add_reason(row, &error);
        }
    }
    if files.iter().any(|file| {
        file.encoding == Encoding::BackupMetadata && !paired_metadata.contains(&file.path)
    }) {
        let row = rows.get_mut(&ArtifactKind::Backups).unwrap();
        row.unverified_files += 1;
        add_reason(
            row,
            "Orphan or invalid backup integrity metadata requires review before conversion",
        );
    }
    let mut peers: BTreeMap<(ArtifactKind, PathBuf), &ArtifactFile> = BTreeMap::new();
    for file in &files {
        let identity = (file.kind, destination(file, false)?);
        if let Some(peer) = peers.insert(identity, file) {
            if peer.plaintext_sha256 != file.plaintext_sha256 {
                let row = rows.get_mut(&file.kind).unwrap();
                row.unverified_files += 1;
                add_reason(row, "Conflicting encrypted/plaintext peers contain different data; resolve the generations before conversion");
            }
        }
    }
    for row in rows.values_mut() {
        row.disk_state = if row.unverified_files > 0 {
            DiskState::Unverified
        } else if row.encrypted_files > 0 && row.plaintext_files > 0 {
            DiskState::Mixed
        } else if row.encrypted_files > 0 {
            DiskState::Encrypted
        } else if row.plaintext_files > 0 {
            DiskState::Plaintext
        } else {
            DiskState::Absent
        };
        if let Err(error) = &policy {
            row.mutable = false;
            add_reason(row, error);
        }
        if state.artifact_recovery_required() {
            row.mutable = false;
            add_reason(row, "An interrupted artifact transition requires recovery");
        }
        if row.unverified_files > 0 {
            row.mutable = false;
        }
    }
    let root_contracts = rows
        .keys()
        .copied()
        .map(|kind| {
            let contract = match kind {
                ArtifactKind::Connections => format!(
                    "{:?}|{:?}",
                    roots.app_data.join("databases"),
                    roots.legacy_storage
                ),
                ArtifactKind::DatabasesIndex | ArtifactKind::TrustStore => {
                    format!("{:?}", roots.app_data.join("databases"))
                }
                ArtifactKind::RecordingsMeta
                | ArtifactKind::RecordingsMedia
                | ArtifactKind::Macros => format!("{:?}", roots.recordings),
                ArtifactKind::Logs => format!("{:?}", roots.logs),
                ArtifactKind::Backups => {
                    format!("{:?}|{:?}", roots.backups, roots.backup_restrictions)
                }
                _ => format!("{:?}", roots.app_data),
            };
            (kind, contract)
        })
        .collect();
    Ok(ArtifactScan {
        rows: rows.into_values().collect(),
        roots: allowed,
        files,
        root_contracts,
    })
}

fn destination(file: &ArtifactFile, encrypted: bool) -> Result<PathBuf, String> {
    if !matches!(
        file.encoding,
        Encoding::RenamedJson | Encoding::Media | Encoding::Logs
    ) {
        return Ok(file.path.clone());
    }
    let name = file
        .path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid artifact filename")?;
    let (base, generation) = recovery_base(name);
    let plain = if file.kind == ArtifactKind::Settings && base == "settings.enc" {
        "settings.json"
    } else {
        base.strip_suffix(".enc").unwrap_or(base)
    };
    let output = if encrypted {
        if file.kind == ArtifactKind::Settings {
            "settings.enc".to_string()
        } else {
            format!("{plain}.enc")
        }
    } else {
        plain.to_string()
    };
    Ok(file.path.with_file_name(format!("{output}{generation}")))
}

async fn encoded_bytes(
    state: &EncryptionState,
    kind: ArtifactKind,
    plain: &[u8],
    encrypted: bool,
) -> Result<Vec<u8>, String> {
    if !encrypted {
        return Ok(plain.to_vec());
    }
    let key = state
        .sub_key(kind)
        .await
        .ok_or("unlock before preparing encrypted artifacts")?;
    let encoded = envelope_io::encrypt_with_subkey(&key, plain)?;
    if envelope_io::decrypt_with_subkey(&key, &encoded)? != plain {
        return Err("staged artifact verification failed".into());
    }
    Ok(encoded)
}

fn write_stage(stage: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = artifact_transaction::create_private_stage(stage)?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    if bounded_read(stage)? != bytes {
        return Err("stage read-back mismatch".into());
    }
    Ok(())
}

/// Rewrap a private generation already staged by the full-rotation engine.
/// Media remains on that engine's media-specific path; never accidentally
/// feed a large recording to the bounded document codec.
pub async fn rewrite_rotation_generation(
    path: &Path,
    kind: ArtifactKind,
    from: &EncryptionState,
    to: &EncryptionState,
) -> Result<u64, String> {
    if kind == ArtifactKind::RecordingsMedia {
        return Err("media rotation requires its dedicated streaming adapter".into());
    }
    let source = bounded_read(path)?;
    let framed = source.starts_with(sdbf::MAGIC);
    let payload = if framed {
        sdbf::parse_and_verify(&source).map_err(|e| e.to_string())?
    } else {
        &source
    };
    if !payload.starts_with(envelope::MAGIC) {
        return Err("rotation generation is not encrypted".into());
    }
    let plain = if kind == ArtifactKind::Logs {
        decode_logs(from, payload).await?
    } else {
        decode_bytes(from, kind, payload).await?
    };
    let encoded = encoded_bytes(to, kind, &plain, true).await?;
    let bytes = if framed {
        let mut bytes = sdbf::encode_preamble(&encoded).to_vec();
        bytes.extend_from_slice(&encoded);
        bytes
    } else {
        encoded
    };
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("invalid rotation stage name")?;
    if !name.contains(".sorng-rotation-") || !name.ends_with(".staged") {
        return Err(
            "rotation adapter accepts only the full-rotation engine's private stage".into(),
        );
    }
    artifact_transaction::validate_regular_path(
        path.parent().ok_or("rotation stage has no parent")?,
        path,
        false,
    )?;
    // This file is already a private stage; create_new would reject it and
    // canonical publication belongs exclusively to the outer rotation engine.
    let mut stage = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    stage
        .write_all(&bytes)
        .and_then(|_| stage.sync_all())
        .map_err(|e| e.to_string())?;
    if bounded_read(path)? != bytes {
        return Err("rotation generation read-back verification failed".into());
    }
    Ok(bytes.len() as u64)
}

pub async fn prepare_artifact(
    scan: &ArtifactScan,
    kind: ArtifactKind,
    target: ProtectionMode,
    state: &EncryptionState,
    tx: &mut ArtifactTransaction,
    progress: &(dyn Fn(usize, usize) -> Result<(), String> + Sync),
) -> Result<usize, String> {
    let row = scan
        .rows
        .iter()
        .find(|row| row.id == kind)
        .ok_or("unknown artifact")?;
    if !row.mutable {
        return Err(row
            .reason
            .clone()
            .unwrap_or("artifact is not mutable".into()));
    }
    let encrypted = target == ProtectionMode::Encrypted;
    let files: Vec<_> = scan.files.iter().filter(|file| file.kind == kind).collect();
    let mut destinations = BTreeSet::new();
    for file in &files {
        if artifact_transaction::fingerprint(&file.path)?.as_ref() != Some(&file.fingerprint) {
            return Err("artifact changed since preview".into());
        }
    }
    let mut changed = 0;
    let mut handled_metadata = BTreeSet::new();
    for (index, file) in files.iter().enumerate() {
        progress(index, files.len())?;
        if file.encoding == Encoding::BackupMetadata {
            continue;
        }
        let destination = destination(file, encrypted)?;
        if !destinations.insert(destination.clone()) {
            // Scan authenticated both contents and proved equality. One
            // canonical stage is enough; remove only the redundant peer.
            if file.path != destination {
                tx.remove(&file.path)?;
            }
            continue;
        }
        let stage = tx.replace(&destination)?;
        if file.encoding == Encoding::Media {
            let key = state
                .sub_key(kind)
                .await
                .ok_or("unlock before converting media")?;
            let mut input = fs::File::open(&file.path).map_err(|e| e.to_string())?;
            let mut output = artifact_transaction::create_private_stage(&stage)?;
            if file.encrypted == encrypted {
                std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            } else if encrypted {
                recording_media::encrypt_stream_with_key(
                    &key,
                    &mut input,
                    &mut output,
                    file.fingerprint.bytes,
                    &mut |_| progress(index, files.len()),
                )?;
            } else {
                recording_media::decrypt_stream_with_key(
                    &key,
                    &mut input,
                    &mut output,
                    file.fingerprint.bytes,
                    &mut |_| progress(index, files.len()),
                )?;
            }
            output.sync_all().map_err(|e| e.to_string())?;
            if encrypted {
                let mut hash = HashWriter::default();
                recording_media::decrypt_stream_with_key(
                    &key,
                    &mut fs::File::open(&stage).map_err(|e| e.to_string())?,
                    &mut hash,
                    output.metadata().map_err(|e| e.to_string())?.len(),
                    &mut |_| progress(index, files.len()),
                )?;
                if hash.finish() != file.plaintext_sha256 {
                    return Err("media stage plaintext differs from the source".into());
                }
            } else if artifact_transaction::fingerprint(&stage)?
                .ok_or("missing media stage")?
                .sha256
                != file.plaintext_sha256
            {
                return Err("media plaintext stage differs from the source".into());
            }
        } else {
            let source = read_payload(&file.path, file.encoding)?;
            let plain = if file.encoding == Encoding::Logs {
                decode_logs(state, &source).await?
            } else {
                decode_bytes(state, kind, &source).await?
            };
            let payload = encoded_bytes(state, kind, &plain, encrypted).await?;
            let bytes = if file.encoding == Encoding::Sdbf {
                let mut bytes = sdbf::encode_preamble(&payload).to_vec();
                bytes.extend_from_slice(&payload);
                bytes
            } else {
                payload
            };
            write_stage(&stage, &bytes)?;
            if file.encoding == Encoding::Backup {
                let metadata_path = backup_metadata_path(&file.path)?;
                let metadata_file = files
                    .iter()
                    .find(|f| f.path == metadata_path && f.encoding == Encoding::BackupMetadata)
                    .ok_or("backup archive has no verified integrity metadata")?;
                let original_metadata = decode_bytes(
                    state,
                    kind,
                    &read_payload(&metadata_path, Encoding::BackupMetadata)?,
                )
                .await?;
                let mut metadata: serde_json::Value =
                    serde_json::from_slice(&original_metadata).map_err(|e| e.to_string())?;
                if metadata["checksumScope"] != "archive-sha256-v1"
                    && metadata["checksum_scope"] != "archive-sha256-v1"
                {
                    return Err("legacy backup integrity metadata requires a compatible restore/re-export before conversion".into());
                }
                if metadata["checksum"].as_str() != Some(&file.fingerprint.sha256) {
                    return Err("backup archive checksum mismatch".into());
                }
                metadata["checksum"] = format!("{:x}", Sha256::digest(&bytes)).into();
                metadata["encrypted"] = encrypted.into();
                let size_key = if metadata.get("sizeBytes").is_some() {
                    "sizeBytes"
                } else {
                    "size_bytes"
                };
                metadata[size_key] = (bytes.len() as u64).into();
                let metadata_bytes = encoded_bytes(
                    state,
                    kind,
                    &serde_json::to_vec_pretty(&metadata).map_err(|e| e.to_string())?,
                    encrypted,
                )
                .await?;
                let metadata_stage = tx.replace(&metadata_file.path)?;
                write_stage(&metadata_stage, &metadata_bytes)?;
                handled_metadata.insert(metadata_file.path.clone());
            }
        }
        if destination != file.path {
            tx.remove(&file.path)?;
        }
        if artifact_transaction::fingerprint(&file.path)?.as_ref() != Some(&file.fingerprint) {
            return Err("artifact changed during staging".into());
        }
        changed += 1;
    }
    if files.iter().any(|file| {
        file.encoding == Encoding::BackupMetadata && !handled_metadata.contains(&file.path)
    }) {
        return Err("orphan backup metadata cannot be converted safely".into());
    }
    progress(files.len(), files.len())?;
    Ok(changed)
}
