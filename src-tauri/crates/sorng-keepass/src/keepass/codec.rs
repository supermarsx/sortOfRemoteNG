use base64::Engine;
use chrono::{DateTime, NaiveDateTime, Utc};
use keepass::config::{CompressionConfig, DatabaseVersion, KdfConfig, OuterCipherConfig};
use keepass::db::{
    fields, AutoType as NativeAutoType, AutoTypeAssociation as NativeAutoTypeAssociation, Color,
    CustomDataItem, CustomDataValue, DataTransferObfuscation, Entry, EntryId, GroupId, History,
    Icon, MemoryProtection, Times, Value,
};
use keepass::{Database, DatabaseKey};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use uuid::Uuid;
use zeroize::Zeroize;

use super::service::{
    AttachmentData, CompositeKeyInternal, DatabaseInstance, DeletedObject, GroupNode,
    KeePassService,
};
use super::types::*;

pub(crate) const MAX_DATABASE_SIZE: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_KEY_FILE_SIZE: u64 = 1024 * 1024;
const MAX_HEADER_SIZE: usize = 1024 * 1024;
const MAX_ICON_SIZE: usize = 10 * 1024 * 1024;
const MAX_ARGON_MEMORY: u64 = 256 * 1024 * 1024;
const MIN_ARGON_MEMORY: u64 = 8 * 1024 * 1024;
const MAX_ARGON_ITERATIONS: u64 = 10;
const MAX_ARGON_PARALLELISM: u32 = 16;
const MAX_AES_ROUNDS: u64 = 50_000_000;
const MIN_AES_ROUNDS: u64 = 100_000;
const MAX_HISTORY_ENTRIES_PER_ENTRY: usize = 10_000;
const MAX_ATTACHMENTS_PER_ENTRY: usize = 4_096;
const KDBX_SIGNATURE: [u8; 8] = [0x03, 0xD9, 0xA2, 0x9A, 0x67, 0xFB, 0x4B, 0xB5];

#[derive(Debug, Clone)]
pub(crate) struct HeaderInfo {
    pub format_version: String,
    pub cipher: Option<String>,
    pub kdf: Option<String>,
}

pub(crate) struct OpenedNativeDatabase {
    pub path: PathBuf,
    pub native: Database,
    pub key: DatabaseKey,
    pub fingerprint: CompositeKeyInternal,
    pub source_hash: [u8; 32],
}

struct HashingBoundedWriter<'a> {
    inner: &'a mut File,
    hasher: Sha256,
    written: u64,
}

impl Write for HashingBoundedWriter<'_> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let attempted = self
            .written
            .checked_add(buffer.len() as u64)
            .ok_or_else(|| std::io::Error::other("KDBX output size overflow"))?;
        if attempted > MAX_DATABASE_SIZE {
            return Err(std::io::Error::other(format!(
                "KDBX output exceeds the {} MiB safety limit",
                MAX_DATABASE_SIZE / 1024 / 1024
            )));
        }
        let written = self.inner.write(buffer)?;
        self.hasher.update(&buffer[..written]);
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

pub(crate) fn recommended_kdf() -> KdfSettings {
    KdfSettings {
        algorithm: KdfAlgorithm::Argon2id,
        iterations: Some(3),
        memory: Some(64 * 1024 * 1024),
        parallelism: Some(2),
        salt: None,
    }
}

pub(crate) fn resolve_existing_database_path(file_path: &str) -> Result<PathBuf, String> {
    if file_path.trim().is_empty() {
        return Err("File path is required".to_string());
    }
    let path = absolute_path(Path::new(file_path))?;
    validate_regular_file(&path, MAX_DATABASE_SIZE)?;
    std::fs::canonicalize(&path).map_err(|e| format!("Cannot resolve KeePass database path: {e}"))
}

pub(crate) fn resolve_destination_path(
    file_path: &str,
    allow_existing: bool,
) -> Result<PathBuf, String> {
    if file_path.trim().is_empty() {
        return Err("File path is required".to_string());
    }
    let path = absolute_path(Path::new(file_path))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Database path must include a file name".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "Database path must have a parent directory".to_string())?;
    validate_directory(parent)?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Cannot resolve database directory: {e}"))?;
    let resolved = canonical_parent.join(file_name);
    match std::fs::symlink_metadata(&resolved) {
        Ok(metadata) => {
            if !allow_existing {
                return Err(format!(
                    "Refusing to overwrite existing database: {}",
                    resolved.display()
                ));
            }
            validate_file_metadata(&metadata, MAX_DATABASE_SIZE)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Cannot inspect destination database {}: {error}",
                resolved.display()
            ))
        }
    }
    Ok(resolved)
}

pub(crate) fn open_native_database(
    file_path: &str,
    password: Option<&str>,
    key_file_path: Option<&str>,
) -> Result<OpenedNativeDatabase, String> {
    let path = resolve_existing_database_path(file_path)?;
    let (key, fingerprint) = build_database_key(password, key_file_path)?;
    let (bytes, source_hash, _) = read_database_image(&path)?;
    let native = Database::parse(&bytes, key.clone())
        .map_err(|error| format!("Failed to open KeePass database: {error}"))?;
    Ok(OpenedNativeDatabase {
        path,
        native,
        key,
        fingerprint,
        source_hash,
    })
}

pub(crate) fn inspect_database_file(file_path: &str) -> Result<(PathBuf, u64, HeaderInfo), String> {
    let path = resolve_existing_database_path(file_path)?;
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Cannot read KeePass database metadata: {e}"))?;
    let mut file =
        File::open(&path).map_err(|e| format!("Cannot open KeePass database header: {e}"))?;
    let header = inspect_header(&mut file)?;
    Ok((path, metadata.len(), header))
}

pub(crate) fn build_database_key(
    password: Option<&str>,
    key_file_path: Option<&str>,
) -> Result<(DatabaseKey, CompositeKeyInternal), String> {
    if password.is_none() && key_file_path.is_none() {
        return Err("At least a password or key file is required".to_string());
    }

    let password_hash = password.map(|value| Sha256::digest(value.as_bytes()).to_vec());
    let mut key_file_data = if let Some(path) = key_file_path {
        Some(read_bounded_regular_file(
            Path::new(path),
            MAX_KEY_FILE_SIZE,
            "key file",
        )?)
    } else {
        None
    };
    let key_file_hash = key_file_data
        .as_ref()
        .map(|value| Sha256::digest(value).to_vec());

    let mut key = DatabaseKey::new();
    if let Some(password) = password {
        key = key.with_password(password);
    }
    if let Some(data) = key_file_data.as_mut() {
        key = key
            .with_keyfile(&mut Cursor::new(data.as_slice()))
            .map_err(|e| format!("Cannot load key file: {e}"))?;
        data.zeroize();
    }

    let mut fingerprint_hasher = Sha256::new();
    if let Some(hash) = password_hash.as_ref() {
        fingerprint_hasher.update(b"password\0");
        fingerprint_hasher.update(hash);
    }
    if let Some(hash) = key_file_hash.as_ref() {
        fingerprint_hasher.update(b"key-file\0");
        fingerprint_hasher.update(hash);
    }
    let combined_hash = fingerprint_hasher.finalize().to_vec();

    Ok((
        key,
        CompositeKeyInternal {
            password_hash,
            key_file_hash,
            combined_hash,
        },
    ))
}

pub(crate) fn new_native_database(
    request: &CreateDatabaseRequest,
) -> Result<(Database, KdfSettings), String> {
    let kdf = request.kdf.clone().unwrap_or_else(recommended_kdf);
    validate_kdf_settings(&kdf)?;

    let mut config = keepass::config::DatabaseConfig::default();
    config.outer_cipher_config =
        cipher_to_native(request.cipher.as_ref().unwrap_or(&KeePassCipher::Aes256));
    config.compression_config = compression_to_native(
        request
            .compression
            .as_ref()
            .unwrap_or(&KeePassCompression::GZip),
    );
    config.kdf_config = kdf_to_native(&kdf)?;

    let mut native = Database::with_config(config);
    native.meta.generator = Some("sortOfRemoteNG".to_string());
    native.meta.database_name = Some(request.name.clone());
    native.meta.database_description = request.description.clone();
    native.meta.default_username = request.default_username.clone();
    native.meta.memory_protection = Some(MemoryProtection::default());
    native.meta.recyclebin_enabled = request.enable_recycle_bin;
    native.root_mut().edit(|root| {
        root.name = request.name.clone();
    });

    if request.enable_recycle_bin.unwrap_or(true) {
        let recycle_id = native
            .root_mut()
            .add_group()
            .edit(|group| {
                group.name = "Recycle Bin".to_string();
                group.set_icon_builtin(43);
            })
            .id();
        native.meta.recyclebin_enabled = Some(true);
        native.meta.recyclebin_uuid = Some(recycle_id.uuid());
        native.meta.recyclebin_changed = Some(Times::now());
    }

    Ok((native, kdf))
}

pub(crate) fn apply_save_options(
    native: &mut Database,
    options: Option<&SaveDatabaseOptions>,
) -> Result<(), String> {
    let Some(options) = options else {
        validate_native_config(&native.config)?;
        return Ok(());
    };
    if let Some(cipher) = options.new_cipher.as_ref() {
        native.config.outer_cipher_config = cipher_to_native(cipher);
    }
    if let Some(kdf) = options.new_kdf.as_ref() {
        validate_kdf_settings(kdf)?;
        native.config.kdf_config = kdf_to_native(kdf)?;
    }
    validate_native_config(&native.config)
}

pub(crate) fn save_native_atomic(
    native: &Database,
    key: &DatabaseKey,
    target: &Path,
) -> Result<[u8; 32], String> {
    let target = resolve_destination_path(&target.to_string_lossy(), true)?;
    let parent = target
        .parent()
        .ok_or_else(|| "Database destination has no parent directory".to_string())?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|e| format!("Cannot create temporary KDBX file: {e}"))?;

    let digest = {
        let mut writer = HashingBoundedWriter {
            inner: temporary.as_file_mut(),
            hasher: Sha256::new(),
            written: 0,
        };
        native
            .save(&mut writer, key.clone())
            .map_err(|e| format!("Failed to encode KeePass database: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush temporary KDBX file: {e}"))?;
        let digest: [u8; 32] = writer.hasher.finalize().into();
        digest
    };

    temporary
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync temporary KDBX file: {e}"))?;
    let temporary_path = temporary.into_temp_path();
    atomic_replace(temporary_path.as_ref(), &target)?;
    let _ = temporary_path.keep();
    sync_parent(parent)?;
    Ok(digest)
}

pub(crate) fn verify_source_unchanged(
    source: &Path,
    expected_hash: Option<[u8; 32]>,
) -> Result<(), String> {
    let expected = expected_hash.ok_or_else(|| {
        "Database source identity is unavailable; refusing to overwrite it".to_string()
    })?;
    let actual = hash_regular_file(source, MAX_DATABASE_SIZE)?;
    if !constant_time_eq(&actual, &expected) {
        return Err(
            "Database file changed outside sortOfRemoteNG; reopen it before saving".to_string(),
        );
    }
    Ok(())
}

pub(crate) fn durable_backup(source: &Path, backup_dir: Option<&Path>) -> Result<PathBuf, String> {
    validate_regular_file(source, MAX_DATABASE_SIZE)?;
    let parent = source
        .parent()
        .ok_or_else(|| "Database source has no parent directory".to_string())?;
    let directory = backup_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| parent.join("backups"));
    ensure_safe_directory(&directory)?;

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("database");
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
    let destination = directory.join(format!(
        "{stem}.{timestamp}.{}.kdbx",
        Uuid::new_v4().simple()
    ));

    let mut input =
        File::open(source).map_err(|e| format!("Cannot open database for backup: {e}"))?;
    let source_len = input
        .metadata()
        .map_err(|e| format!("Cannot inspect database during backup: {e}"))?
        .len();
    if source_len > MAX_DATABASE_SIZE {
        return Err("Database exceeds the backup safety limit".to_string());
    }
    let mut temporary = NamedTempFile::new_in(&directory)
        .map_err(|e| format!("Cannot create temporary backup: {e}"))?;
    let copied = std::io::copy(
        &mut Read::by_ref(&mut input).take(MAX_DATABASE_SIZE + 1),
        temporary.as_file_mut(),
    )
    .map_err(|e| format!("Failed to copy database backup: {e}"))?;
    if copied != source_len || copied > MAX_DATABASE_SIZE {
        return Err("Database changed or exceeded the safety limit during backup".to_string());
    }
    temporary
        .as_file_mut()
        .flush()
        .map_err(|e| format!("Failed to flush backup: {e}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync backup: {e}"))?;
    temporary
        .persist_noclobber(&destination)
        .map_err(|e| format!("Failed to publish database backup: {}", e.error))?;
    sync_parent(&directory)?;
    Ok(destination)
}

pub(crate) fn write_new_secret_file(path: &Path, data: &[u8]) -> Result<(), String> {
    if data.len() as u64 > MAX_KEY_FILE_SIZE {
        return Err("Key file exceeds the 1 MiB safety limit".to_string());
    }
    let target = resolve_destination_path(&path.to_string_lossy(), false)?;
    let parent = target
        .parent()
        .ok_or_else(|| "Key file path has no parent directory".to_string())?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|e| format!("Cannot create temporary key file: {e}"))?;
    temporary
        .as_file_mut()
        .write_all(data)
        .map_err(|e| format!("Failed to write temporary key file: {e}"))?;
    temporary
        .as_file_mut()
        .flush()
        .map_err(|e| format!("Failed to flush key file: {e}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync key file: {e}"))?;
    temporary
        .persist_noclobber(&target)
        .map_err(|e| format!("Failed to publish key file: {}", e.error))?;
    sync_parent(parent)
}

pub(crate) fn read_key_file(path: &Path) -> Result<Vec<u8>, String> {
    read_bounded_regular_file(path, MAX_KEY_FILE_SIZE, "key file")
}

pub(crate) fn database_instance_from_native(
    id: String,
    file_path: String,
    native: Database,
    key: DatabaseKey,
    fingerprint: CompositeKeyInternal,
    source_hash: [u8; 32],
    read_only: bool,
) -> Result<DatabaseInstance, String> {
    let root_id = native.root().id().uuid().to_string();
    let recycle_bin_id = native.meta.recyclebin_uuid.map(|value| value.to_string());
    let now = Utc::now().to_rfc3339();
    let mut groups = HashMap::new();

    for group in native.iter_all_groups() {
        let uuid = group.id().uuid().to_string();
        let parent_uuid = group.parent().map(|parent| parent.id().uuid().to_string());
        let (icon_id, custom_icon_uuid) = icon_to_projection(group.icon());
        groups.insert(
            uuid.clone(),
            KeePassGroup {
                uuid: uuid.clone(),
                name: group.name.clone(),
                notes: group.notes.clone().unwrap_or_default(),
                icon_id,
                custom_icon_uuid,
                parent_uuid,
                is_expanded: group.is_expanded,
                default_auto_type_sequence: group.default_autotype_sequence.clone(),
                enable_auto_type: group.enable_autotype,
                enable_searching: group.enable_searching,
                last_top_visible_entry: None,
                is_recycle_bin: recycle_bin_id.as_deref() == Some(uuid.as_str()),
                entry_count: 0,
                child_group_count: 0,
                total_entry_count: 0,
                times: times_to_projection(&group.times),
                tags: group.tags.clone(),
                custom_data: custom_data_to_projection(&group.custom_data),
            },
        );
    }

    let mut attachment_pool: HashMap<String, AttachmentData> = HashMap::new();
    let mut entries = HashMap::new();
    let mut history = HashMap::new();

    for entry in native.iter_all_entries() {
        let uuid = entry.id().uuid().to_string();
        let group_uuid = entry.parent().id().uuid().to_string();
        let mut projected = entry_to_projection(&entry, &group_uuid);
        project_entry_attachments(&entry, &mut projected, &mut attachment_pool)?;

        if let Some(native_history) = entry.history.as_ref() {
            let history_len = native_history.get_entries().len();
            if history_len > MAX_HISTORY_ENTRIES_PER_ENTRY {
                return Err(format!(
                    "Entry {uuid} exceeds the history entry safety limit"
                ));
            }
            let mut projected_history = Vec::new();
            for (index, native_index) in (0..history_len).rev().enumerate() {
                let historical = entry.historical(native_index).ok_or_else(|| {
                    format!("Historical entry {native_index} disappeared for entry {uuid}")
                })?;
                let mut historical_projection = entry_to_projection(&historical, &group_uuid);
                project_entry_attachments(
                    &historical,
                    &mut historical_projection,
                    &mut attachment_pool,
                )?;
                projected_history.push(EntryHistoryItem {
                    index,
                    entry: historical_projection,
                    modified_at: historical
                        .times
                        .last_modification
                        .and_then(time_to_rfc3339)
                        .unwrap_or_else(|| now.clone()),
                });
            }
            projected.history_count = projected_history.len();
            if !projected_history.is_empty() {
                history.insert(uuid.clone(), projected_history);
            }
        }
        entries.insert(uuid, projected);
    }

    let custom_icons = native
        .iter_all_custom_icons()
        .map(|icon| {
            (
                icon.id().uuid().to_string(),
                base64::engine::general_purpose::STANDARD.encode(&icon.data),
            )
        })
        .collect::<HashMap<_, _>>();

    let deleted_objects = native
        .deleted_objects
        .iter()
        .map(|(uuid, deletion_time)| DeletedObject {
            uuid: uuid.to_string(),
            deletion_time: deletion_time
                .and_then(time_to_rfc3339)
                .unwrap_or_else(|| now.clone()),
        })
        .collect();

    let root_times = groups
        .get(&root_id)
        .map(|group| group.times.clone())
        .unwrap_or_default();
    let format_version = format_version(&native.config.version);
    let cipher = cipher_from_native(&native.config.outer_cipher_config);
    let kdf = kdf_from_native(&native.config.kdf_config);
    let compression = compression_from_native(&native.config.compression_config);
    let info = KeePassDatabase {
        id,
        file_path,
        name: native.meta.database_name.clone().unwrap_or_else(|| {
            groups
                .get(&root_id)
                .map(|group| group.name.clone())
                .unwrap_or_else(|| "KeePass Database".to_string())
        }),
        description: native.meta.database_description.clone().unwrap_or_default(),
        default_username: native.meta.default_username.clone().unwrap_or_default(),
        locked: false,
        modified: false,
        format_version,
        cipher,
        kdf,
        compression,
        root_group_id: root_id.clone(),
        recycle_bin_id,
        recycle_bin_enabled: native.meta.recyclebin_enabled.unwrap_or(false),
        color: native.meta.color.as_ref().map(ToString::to_string),
        master_seed: None,
        entry_count: entries.len(),
        group_count: groups.len(),
        created_at: root_times.created,
        modified_at: native
            .meta
            .settings_changed
            .and_then(time_to_rfc3339)
            .unwrap_or_else(|| root_times.last_modified.clone()),
        last_opened_at: now,
        custom_icon_count: custom_icons.len(),
        custom_data: custom_data_to_projection(&native.meta.custom_data),
    };

    let mut instance = DatabaseInstance {
        info,
        root_group: GroupNode {
            uuid: root_id,
            name: String::new(),
            children: Vec::new(),
            entry_uuids: Vec::new(),
        },
        entries,
        groups,
        attachment_pool,
        history,
        custom_icons,
        deleted_objects,
        composite_key: Some(fingerprint),
        native_database: Some(native),
        database_key: Some(key),
        source_hash: Some(source_hash),
        read_only,
        next_ref_id: 1,
    };
    instance.next_ref_id = instance
        .attachment_pool
        .keys()
        .filter_map(|value| value.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    instance.rebuild_counts();
    instance.rebuild_tree();
    Ok(instance)
}

pub(crate) fn reconcile_native(instance: &DatabaseInstance) -> Result<Database, String> {
    if instance.info.locked {
        return Err("Database is locked".to_string());
    }
    let mut native = instance
        .native_database
        .clone()
        .ok_or_else(|| "Native KDBX state is unavailable; reopen the database".to_string())?;
    let native_root = native.root().id().uuid().to_string();
    if native_root != instance.info.root_group_id {
        return Err("Root group identity changed; refusing a lossy save".to_string());
    }

    native.meta.database_name = Some(instance.info.name.clone());
    native.meta.database_description = Some(instance.info.description.clone());
    native.meta.default_username = Some(instance.info.default_username.clone());
    native.meta.recyclebin_enabled = Some(instance.info.recycle_bin_enabled);
    native.meta.recyclebin_uuid = instance
        .info
        .recycle_bin_id
        .as_deref()
        .map(parse_uuid)
        .transpose()?;
    native.meta.color = instance
        .info
        .color
        .as_deref()
        .map(str::parse::<Color>)
        .transpose()
        .map_err(|e| format!("Invalid database color: {e}"))?;
    sync_custom_data(&mut native.meta.custom_data, &instance.info.custom_data);
    native.config.outer_cipher_config = cipher_to_native(&instance.info.cipher);
    native.config.compression_config = compression_to_native(&instance.info.compression);
    native.config.kdf_config = kdf_to_native(&instance.info.kdf)?;
    validate_native_config(&native.config)?;

    ensure_groups(&mut native, instance)?;
    ensure_entries(&mut native, instance)?;
    remove_stale_entries(&mut native, instance)?;
    remove_stale_groups(&mut native, instance)?;
    sync_icons(&mut native, instance)?;
    sync_deleted_objects(&mut native, instance)?;
    Ok(native)
}

fn ensure_groups(native: &mut Database, instance: &DatabaseInstance) -> Result<(), String> {
    let root_id = native.root().id();
    let mut pending = instance
        .groups
        .values()
        .filter_map(|group| {
            let id = parse_uuid(&group.uuid).ok().map(GroupId::from_uuid)?;
            (id != root_id && native.group(id).is_none()).then_some(group)
        })
        .collect::<Vec<_>>();

    while !pending.is_empty() {
        let mut progress = false;
        let mut remaining = Vec::new();
        for group in pending {
            let id = GroupId::from_uuid(parse_uuid(&group.uuid)?);
            let parent_id = GroupId::from_uuid(parse_uuid(
                group
                    .parent_uuid
                    .as_deref()
                    .unwrap_or(&instance.info.root_group_id),
            )?);
            if native.group(parent_id).is_some() {
                native
                    .group_mut(parent_id)
                    .ok_or_else(|| "Parent group disappeared during save".to_string())?
                    .add_group_with_id(id)
                    .map_err(|e| format!("Cannot preserve group UUID {}: {e}", group.uuid))?;
                progress = true;
            } else {
                remaining.push(group);
            }
        }
        if !progress {
            return Err("Group hierarchy contains a missing parent or cycle".to_string());
        }
        pending = remaining;
    }

    for group in instance.groups.values() {
        let id = GroupId::from_uuid(parse_uuid(&group.uuid)?);
        let desired_parent = group
            .parent_uuid
            .as_deref()
            .map(parse_uuid)
            .transpose()?
            .map(GroupId::from_uuid);
        if id != root_id {
            let desired_parent = desired_parent.unwrap_or(root_id);
            let current_parent = native
                .group(id)
                .and_then(|current| current.parent().map(|parent| parent.id()));
            if current_parent != Some(desired_parent) {
                native
                    .group_mut(id)
                    .ok_or_else(|| format!("Group not found during save: {}", group.uuid))?
                    .move_to(desired_parent)
                    .map_err(|e| format!("Cannot move group {}: {e}", group.uuid))?;
            }
        }

        let mut target = native
            .group_mut(id)
            .ok_or_else(|| format!("Group not found during save: {}", group.uuid))?;
        target.name = group.name.clone();
        target.notes = (!group.notes.is_empty()).then(|| group.notes.clone());
        target.tags = group.tags.clone();
        target.is_expanded = group.is_expanded;
        target.default_autotype_sequence = group.default_auto_type_sequence.clone();
        target.enable_autotype = group.enable_auto_type;
        target.enable_searching = group.enable_searching;
        target.times = times_from_projection(&group.times)?;
        sync_custom_data(&mut target.custom_data, &group.custom_data);
    }
    Ok(())
}

fn ensure_entries(native: &mut Database, instance: &DatabaseInstance) -> Result<(), String> {
    for entry in instance.entries.values() {
        let id = EntryId::from_uuid(parse_uuid(&entry.uuid)?);
        let parent_id = GroupId::from_uuid(parse_uuid(&entry.group_uuid)?);
        if native.group(parent_id).is_none() {
            return Err(format!(
                "Entry {} references missing group {}",
                entry.uuid, entry.group_uuid
            ));
        }
        if native.entry(id).is_none() {
            native
                .group_mut(parent_id)
                .ok_or_else(|| format!("Entry parent group not found: {}", entry.group_uuid))?
                .add_entry_with_id(id)
                .map_err(|e| format!("Cannot preserve entry UUID {}: {e}", entry.uuid))?;
        } else {
            let current_parent = native
                .entry(id)
                .ok_or_else(|| format!("Entry disappeared during save: {}", entry.uuid))?
                .parent()
                .id();
            if current_parent != parent_id {
                native
                    .entry_mut(id)
                    .ok_or_else(|| format!("Entry disappeared during save: {}", entry.uuid))?
                    .move_to(parent_id)
                    .map_err(|e| format!("Cannot move entry {}: {e}", entry.uuid))?;
            }
        }

        {
            let mut target = native
                .entry_mut(id)
                .ok_or_else(|| format!("Entry not found during save: {}", entry.uuid))?;
            apply_entry_projection(&mut target, entry)?;
        }

        let attachment_names = native
            .entry(id)
            .ok_or_else(|| format!("Entry not found during attachment sync: {}", entry.uuid))?
            .attachments_named()
            .map(|(name, _)| name.to_string())
            .collect::<Vec<_>>();
        for name in attachment_names {
            native
                .entry_mut(id)
                .ok_or_else(|| format!("Entry not found during attachment sync: {}", entry.uuid))?
                .remove_attachment_by_name(&name);
        }
        let mut names = HashSet::new();
        for attachment in &entry.attachments {
            if !names.insert(attachment.filename.clone()) {
                return Err(format!(
                    "Entry {} has duplicate attachment name '{}'",
                    entry.uuid, attachment.filename
                ));
            }
            let pool = instance
                .attachment_pool
                .get(&attachment.ref_id)
                .ok_or_else(|| {
                    format!(
                        "Entry {} references missing attachment {}",
                        entry.uuid, attachment.ref_id
                    )
                })?;
            native
                .entry_mut(id)
                .ok_or_else(|| format!("Entry not found during attachment sync: {}", entry.uuid))?
                .add_attachment(
                    attachment.filename.clone(),
                    Value::protected(pool.data.clone()),
                );
        }

        let base = native
            .entry(id)
            .ok_or_else(|| format!("Entry not found during history sync: {}", entry.uuid))?
            .clone();
        let mut native_history = History::default();
        if let Some(projected_history) = instance.history.get(&entry.uuid) {
            if projected_history.len() > MAX_HISTORY_ENTRIES_PER_ENTRY {
                return Err(format!(
                    "Entry {} exceeds the history entry safety limit",
                    entry.uuid
                ));
            }
            for item in projected_history {
                if item.entry.uuid != entry.uuid || item.entry.group_uuid != entry.group_uuid {
                    return Err(format!(
                        "History for entry {} contains a mismatched entry identity",
                        entry.uuid
                    ));
                }
                if !attachment_sets_equal(&item.entry.attachments, &entry.attachments) {
                    return Err(format!(
                        "History for entry {} contains a different attachment set; \
                         the current KeePass library cannot persist it without data loss",
                        entry.uuid
                    ));
                }
                let mut historical = base.clone();
                apply_entry_projection(&mut historical, &item.entry)?;
                historical.history = None;
                native_history.add_entry(historical);
            }
        }
        native
            .entry_mut(id)
            .ok_or_else(|| format!("Entry not found during history sync: {}", entry.uuid))?
            .history = Some(native_history);
    }
    Ok(())
}

fn remove_stale_entries(native: &mut Database, instance: &DatabaseInstance) -> Result<(), String> {
    let wanted = instance
        .entries
        .keys()
        .map(|value| parse_uuid(value).map(EntryId::from_uuid))
        .collect::<Result<HashSet<_>, _>>()?;
    let stale = native
        .iter_all_entries()
        .map(|entry| entry.id())
        .filter(|id| !wanted.contains(id))
        .collect::<Vec<_>>();
    for id in stale {
        if let Some(entry) = native.entry_mut(id) {
            entry.remove();
        }
    }
    Ok(())
}

fn remove_stale_groups(native: &mut Database, instance: &DatabaseInstance) -> Result<(), String> {
    let root = native.root().id();
    let wanted = instance
        .groups
        .keys()
        .map(|value| parse_uuid(value).map(GroupId::from_uuid))
        .collect::<Result<HashSet<_>, _>>()?;
    let stale = native
        .iter_all_groups()
        .map(|group| group.id())
        .filter(|id| *id != root && !wanted.contains(id))
        .collect::<Vec<_>>();
    for id in stale {
        if let Some(group) = native.group_mut(id) {
            group.remove();
        }
    }
    Ok(())
}

fn sync_icons(native: &mut Database, instance: &DatabaseInstance) -> Result<(), String> {
    let existing = native
        .iter_all_custom_icons()
        .map(|icon| (icon.id().uuid().to_string(), icon.id()))
        .collect::<HashMap<_, _>>();
    let mut resolved = existing.clone();

    for group in instance.groups.values() {
        let group_id = GroupId::from_uuid(parse_uuid(&group.uuid)?);
        if let Some(icon_uuid) = group.custom_icon_uuid.as_ref() {
            let icon_id = if let Some(id) = resolved.get(icon_uuid).copied() {
                id
            } else {
                let data = decode_custom_icon(instance, icon_uuid)?;
                let id = native
                    .group_mut(group_id)
                    .ok_or_else(|| format!("Group not found during icon sync: {}", group.uuid))?
                    .set_icon_custom_new(data)
                    .id();
                resolved.insert(icon_uuid.clone(), id);
                id
            };
            native
                .group_mut(group_id)
                .ok_or_else(|| format!("Group not found during icon sync: {}", group.uuid))?
                .set_icon_custom(icon_id)
                .map_err(|e| format!("Cannot set group custom icon: {e}"))?;
        } else {
            native
                .group_mut(group_id)
                .ok_or_else(|| format!("Group not found during icon sync: {}", group.uuid))?
                .set_icon_builtin(group.icon_id as usize);
        }
    }

    for entry in instance.entries.values() {
        let entry_id = EntryId::from_uuid(parse_uuid(&entry.uuid)?);
        if let Some(icon_uuid) = entry.custom_icon_uuid.as_ref() {
            let icon_id = if let Some(id) = resolved.get(icon_uuid).copied() {
                id
            } else {
                let data = decode_custom_icon(instance, icon_uuid)?;
                let id = native
                    .entry_mut(entry_id)
                    .ok_or_else(|| format!("Entry not found during icon sync: {}", entry.uuid))?
                    .set_icon_custom_new(data)
                    .id();
                resolved.insert(icon_uuid.clone(), id);
                id
            };
            native
                .entry_mut(entry_id)
                .ok_or_else(|| format!("Entry not found during icon sync: {}", entry.uuid))?
                .set_icon_custom(icon_id)
                .map_err(|e| format!("Cannot set entry custom icon: {e}"))?;
        } else {
            native
                .entry_mut(entry_id)
                .ok_or_else(|| format!("Entry not found during icon sync: {}", entry.uuid))?
                .set_icon_builtin(entry.icon_id as usize);
        }
    }

    for icon_uuid in instance.custom_icons.keys() {
        if !resolved.contains_key(icon_uuid) {
            return Err(format!(
                "Custom icon {icon_uuid} is unreferenced and cannot be persisted without changing its UUID"
            ));
        }
    }

    let desired_ids = instance
        .custom_icons
        .keys()
        .filter_map(|uuid| resolved.get(uuid).copied())
        .collect::<HashSet<_>>();
    let stale = native
        .iter_all_custom_icons()
        .map(|icon| icon.id())
        .filter(|id| !desired_ids.contains(id))
        .collect::<Vec<_>>();
    for id in stale {
        if let Some(icon) = native.custom_icon_mut(id) {
            icon.remove();
        }
    }
    Ok(())
}

fn sync_deleted_objects(native: &mut Database, instance: &DatabaseInstance) -> Result<(), String> {
    native.deleted_objects.clear();
    for deleted in &instance.deleted_objects {
        native.deleted_objects.insert(
            parse_uuid(&deleted.uuid)?,
            Some(
                parse_time(&deleted.deletion_time)
                    .ok_or_else(|| format!("Invalid deletion timestamp for {}", deleted.uuid))?,
            ),
        );
    }
    Ok(())
}

fn apply_entry_projection(target: &mut Entry, source: &KeePassEntry) -> Result<(), String> {
    let preserved_otp = target.fields.get(fields::OTP).cloned();
    let mut projected_fields = HashMap::new();
    projected_fields.insert(
        fields::TITLE.to_string(),
        Value::unprotected(source.title.clone()),
    );
    projected_fields.insert(
        fields::USERNAME.to_string(),
        Value::unprotected(source.username.clone()),
    );
    projected_fields.insert(
        fields::PASSWORD.to_string(),
        Value::protected(source.password.clone()),
    );
    projected_fields.insert(
        fields::URL.to_string(),
        Value::unprotected(source.url.clone()),
    );
    projected_fields.insert(
        fields::NOTES.to_string(),
        Value::unprotected(source.notes.clone()),
    );
    for (name, field) in &source.custom_fields {
        if fields::KNOWN_FIELDS.contains(&name.as_str()) || name == fields::OTP {
            continue;
        }
        projected_fields.insert(
            name.clone(),
            if field.is_protected {
                Value::protected(field.value.clone())
            } else {
                Value::unprotected(field.value.clone())
            },
        );
    }
    if let Some(otp) = source.otp.as_ref() {
        projected_fields.insert(fields::OTP.to_string(), Value::protected(otp_to_uri(otp)));
    } else if let Some(otp) = preserved_otp {
        projected_fields.insert(fields::OTP.to_string(), otp);
    }
    target.fields = projected_fields;
    target.tags = source.tags.clone();
    target.times = times_from_projection(&source.times)?;
    target.foreground_color = source
        .foreground_color
        .as_deref()
        .map(str::parse::<Color>)
        .transpose()
        .map_err(|e| format!("Invalid foreground color: {e}"))?;
    target.background_color = source
        .background_color
        .as_deref()
        .map(str::parse::<Color>)
        .transpose()
        .map_err(|e| format!("Invalid background color: {e}"))?;
    target.override_url = source.override_url.clone();
    target.quality_check = true;
    target.autotype = source.auto_type.as_ref().map(|value| NativeAutoType {
        enabled: value.enabled,
        default_sequence: value.default_sequence.clone(),
        data_transfer_obfuscation: if value.obfuscation == 0 {
            DataTransferObfuscation::None
        } else {
            DataTransferObfuscation::UseClipboard
        },
        associations: value
            .associations
            .iter()
            .map(|association| NativeAutoTypeAssociation {
                window: association.window.clone(),
                sequence: association.sequence.clone().unwrap_or_default(),
            })
            .collect(),
    });
    Ok(())
}

fn entry_to_projection(entry: &keepass::db::EntryRef<'_>, group_uuid: &str) -> KeePassEntry {
    entry_value_to_projection(entry, group_uuid)
}

fn project_entry_attachments(
    entry: &keepass::db::EntryRef<'_>,
    projected: &mut KeePassEntry,
    attachment_pool: &mut HashMap<String, AttachmentData>,
) -> Result<(), String> {
    let attachments = entry.attachments_named().collect::<Vec<_>>();
    if attachments.len() > MAX_ATTACHMENTS_PER_ENTRY {
        return Err(format!(
            "Entry {} exceeds the attachment count safety limit",
            entry.id().uuid()
        ));
    }

    let mut names = HashSet::new();
    for (filename, attachment) in attachments {
        if !names.insert(filename) {
            return Err(format!(
                "Entry {} contains duplicate attachment name '{}'",
                entry.id().uuid(),
                filename
            ));
        }
        let ref_id = attachment.id().id().to_string();
        let pool = attachment_pool.entry(ref_id.clone()).or_insert_with(|| {
            let data = attachment.data.get().clone();
            AttachmentData {
                hash: hex::encode(Sha256::digest(&data)),
                data,
                ref_count: 0,
            }
        });
        pool.ref_count = pool
            .ref_count
            .checked_add(1)
            .ok_or_else(|| "Attachment reference count overflow".to_string())?;
        projected.attachments.push(EntryAttachmentRef {
            ref_id,
            filename: filename.to_string(),
        });
    }
    Ok(())
}

fn attachment_sets_equal(left: &[EntryAttachmentRef], right: &[EntryAttachmentRef]) -> bool {
    left.len() == right.len()
        && left.iter().all(|candidate| {
            right.iter().any(|other| {
                candidate.ref_id == other.ref_id && candidate.filename == other.filename
            })
        })
}

fn entry_value_to_projection(entry: &Entry, group_uuid: &str) -> KeePassEntry {
    let (icon_id, custom_icon_uuid) = icon_to_projection(entry.icon());
    let custom_fields = entry
        .fields
        .iter()
        .filter(|(name, _)| {
            !fields::KNOWN_FIELDS.contains(&name.as_str()) && name.as_str() != fields::OTP
        })
        .map(|(name, value)| {
            (
                name.clone(),
                CustomField {
                    value: value.get().clone(),
                    is_protected: value.is_protected(),
                },
            )
        })
        .collect();
    let password = entry.get(fields::PASSWORD).unwrap_or_default().to_string();
    let otp = entry
        .get(fields::OTP)
        .and_then(|value| KeePassService::parse_otp_uri(value).ok());
    let auto_type = entry.autotype.as_ref().map(|value| AutoTypeConfig {
        enabled: value.enabled,
        obfuscation: match value.data_transfer_obfuscation {
            DataTransferObfuscation::None => 0,
            DataTransferObfuscation::UseClipboard => 1,
        },
        default_sequence: value.default_sequence.clone(),
        associations: value
            .associations
            .iter()
            .map(|association| AutoTypeAssociation {
                window: association.window.clone(),
                sequence: (!association.sequence.is_empty()).then(|| association.sequence.clone()),
            })
            .collect(),
    });
    KeePassEntry {
        uuid: entry.id().uuid().to_string(),
        group_uuid: group_uuid.to_string(),
        icon_id,
        custom_icon_uuid,
        foreground_color: entry.foreground_color.as_ref().map(ToString::to_string),
        background_color: entry.background_color.as_ref().map(ToString::to_string),
        override_url: entry.override_url.clone(),
        password_quality: (!password.is_empty())
            .then(|| KeePassService::estimate_entropy(&password)),
        tags: entry.tags.clone(),
        title: entry.get(fields::TITLE).unwrap_or_default().to_string(),
        username: entry.get(fields::USERNAME).unwrap_or_default().to_string(),
        password,
        url: entry.get(fields::URL).unwrap_or_default().to_string(),
        notes: entry.get(fields::NOTES).unwrap_or_default().to_string(),
        custom_fields,
        attachments: Vec::new(),
        auto_type,
        otp,
        times: times_to_projection(&entry.times),
        history_count: entry
            .history
            .as_ref()
            .map(|value| value.get_entries().len())
            .unwrap_or(0),
        is_recycled: false,
    }
}

fn icon_to_projection(icon: Option<&Icon>) -> (u32, Option<String>) {
    match icon {
        Some(Icon::BuiltIn(id)) => ((*id).min(u32::MAX as usize) as u32, None),
        Some(Icon::Custom(id)) => (0, Some(id.uuid().to_string())),
        None => (0, None),
    }
}

fn custom_data_to_projection(
    custom_data: &HashMap<String, CustomDataItem>,
) -> HashMap<String, String> {
    custom_data
        .iter()
        .filter_map(|(key, item)| match item.value.as_ref() {
            Some(CustomDataValue::String(value)) => Some((key.clone(), value.clone())),
            _ => None,
        })
        .collect()
}

fn sync_custom_data(
    native: &mut HashMap<String, CustomDataItem>,
    projected: &HashMap<String, String>,
) {
    native.retain(|key, item| {
        matches!(item.value.as_ref(), Some(CustomDataValue::Binary(_)))
            || projected.contains_key(key)
    });
    for (key, value) in projected {
        native.insert(
            key.clone(),
            CustomDataItem {
                value: Some(CustomDataValue::String(value.clone())),
                last_modification_time: Some(Times::now()),
            },
        );
    }
}

fn times_to_projection(times: &Times) -> KeePassTimes {
    let now = Utc::now().to_rfc3339();
    KeePassTimes {
        created: times
            .creation
            .and_then(time_to_rfc3339)
            .unwrap_or_else(|| now.clone()),
        last_modified: times
            .last_modification
            .and_then(time_to_rfc3339)
            .unwrap_or_else(|| now.clone()),
        last_accessed: times
            .last_access
            .and_then(time_to_rfc3339)
            .unwrap_or_else(|| now.clone()),
        expiry_time: times.expiry.and_then(time_to_rfc3339),
        expires: times.expires.unwrap_or(false),
        usage_count: times.usage_count.unwrap_or(0).min(u32::MAX as usize) as u32,
        location_changed: times.location_changed.and_then(time_to_rfc3339),
    }
}

fn times_from_projection(times: &KeePassTimes) -> Result<Times, String> {
    let mut native = Times::default();
    native.creation = Some(parse_required_time(&times.created, "creation")?);
    native.last_modification = Some(parse_required_time(
        &times.last_modified,
        "last modification",
    )?);
    native.last_access = Some(parse_required_time(&times.last_accessed, "last access")?);
    native.expiry = times
        .expiry_time
        .as_deref()
        .map(|value| parse_required_time(value, "expiry"))
        .transpose()?;
    native.location_changed = times
        .location_changed
        .as_deref()
        .map(|value| parse_required_time(value, "location change"))
        .transpose()?;
    native.expires = Some(times.expires);
    native.usage_count = Some(times.usage_count as usize);
    Ok(native)
}

fn parse_required_time(value: &str, label: &str) -> Result<NaiveDateTime, String> {
    parse_time(value).ok_or_else(|| format!("Invalid {label} timestamp: {value}"))
}

fn parse_time(value: &str) -> Option<NaiveDateTime> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.naive_utc())
}

fn time_to_rfc3339(value: NaiveDateTime) -> Option<String> {
    Some(DateTime::<Utc>::from_naive_utc_and_offset(value, Utc).to_rfc3339())
}

fn otp_to_uri(otp: &OtpConfig) -> String {
    let kind = match &otp.otp_type {
        OtpType::Hotp => "hotp",
        OtpType::Totp | OtpType::Steam => "totp",
    };
    let label = otp
        .account
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("account");
    let algorithm = match &otp.algorithm {
        OtpAlgorithm::Sha1 => "SHA1",
        OtpAlgorithm::Sha256 => "SHA256",
        OtpAlgorithm::Sha512 => "SHA512",
    };
    let mut uri = format!(
        "otpauth://{kind}/{label}?secret={}&algorithm={algorithm}&digits={}",
        otp.secret, otp.digits
    );
    if let Some(issuer) = otp.issuer.as_ref() {
        uri.push_str("&issuer=");
        uri.push_str(issuer);
    }
    match &otp.otp_type {
        OtpType::Hotp => {
            uri.push_str("&counter=");
            uri.push_str(&otp.counter.unwrap_or(0).to_string());
        }
        OtpType::Totp | OtpType::Steam => {
            uri.push_str("&period=");
            uri.push_str(&otp.period.unwrap_or(30).to_string());
        }
    }
    uri
}

fn decode_custom_icon(instance: &DatabaseInstance, icon_uuid: &str) -> Result<Vec<u8>, String> {
    let encoded = instance
        .custom_icons
        .get(icon_uuid)
        .ok_or_else(|| format!("Custom icon data not found: {icon_uuid}"))?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Invalid custom icon data: {e}"))?;
    if decoded.len() > MAX_ICON_SIZE {
        return Err(format!(
            "Custom icon exceeds the {} MiB safety limit",
            MAX_ICON_SIZE / 1024 / 1024
        ));
    }
    Ok(decoded)
}

fn cipher_to_native(cipher: &KeePassCipher) -> OuterCipherConfig {
    match cipher {
        KeePassCipher::Aes256 => OuterCipherConfig::AES256,
        KeePassCipher::Twofish => OuterCipherConfig::Twofish,
        KeePassCipher::ChaCha20 => OuterCipherConfig::ChaCha20,
    }
}

fn cipher_from_native(cipher: &OuterCipherConfig) -> KeePassCipher {
    match cipher {
        OuterCipherConfig::AES256 => KeePassCipher::Aes256,
        OuterCipherConfig::Twofish => KeePassCipher::Twofish,
        OuterCipherConfig::ChaCha20 => KeePassCipher::ChaCha20,
        _ => KeePassCipher::Aes256,
    }
}

fn compression_to_native(compression: &KeePassCompression) -> CompressionConfig {
    match compression {
        KeePassCompression::None => CompressionConfig::None,
        KeePassCompression::GZip => CompressionConfig::GZip,
    }
}

fn compression_from_native(compression: &CompressionConfig) -> KeePassCompression {
    match compression {
        CompressionConfig::None => KeePassCompression::None,
        CompressionConfig::GZip => KeePassCompression::GZip,
        _ => KeePassCompression::GZip,
    }
}

fn kdf_to_native(kdf: &KdfSettings) -> Result<KdfConfig, String> {
    validate_kdf_settings(kdf)?;
    match kdf.algorithm {
        KdfAlgorithm::AesKdf => Ok(KdfConfig::Aes {
            rounds: kdf.iterations.unwrap_or(MIN_AES_ROUNDS),
        }),
        KdfAlgorithm::Argon2d => Ok(KdfConfig::Argon2 {
            iterations: kdf.iterations.unwrap_or(3),
            memory: kdf.memory.unwrap_or(64 * 1024 * 1024),
            parallelism: kdf.parallelism.unwrap_or(2),
            version: argon2::Version::Version13,
        }),
        KdfAlgorithm::Argon2id => Ok(KdfConfig::Argon2id {
            iterations: kdf.iterations.unwrap_or(3),
            memory: kdf.memory.unwrap_or(64 * 1024 * 1024),
            parallelism: kdf.parallelism.unwrap_or(2),
            version: argon2::Version::Version13,
        }),
    }
}

fn kdf_from_native(kdf: &KdfConfig) -> KdfSettings {
    match kdf {
        KdfConfig::Aes { rounds } => KdfSettings {
            algorithm: KdfAlgorithm::AesKdf,
            iterations: Some(*rounds),
            memory: None,
            parallelism: None,
            salt: None,
        },
        KdfConfig::Argon2 {
            iterations,
            memory,
            parallelism,
            ..
        } => KdfSettings {
            algorithm: KdfAlgorithm::Argon2d,
            iterations: Some(*iterations),
            memory: Some(*memory),
            parallelism: Some(*parallelism),
            salt: None,
        },
        KdfConfig::Argon2id {
            iterations,
            memory,
            parallelism,
            ..
        } => KdfSettings {
            algorithm: KdfAlgorithm::Argon2id,
            iterations: Some(*iterations),
            memory: Some(*memory),
            parallelism: Some(*parallelism),
            salt: None,
        },
        _ => recommended_kdf(),
    }
}

fn validate_kdf_settings(kdf: &KdfSettings) -> Result<(), String> {
    match kdf.algorithm {
        KdfAlgorithm::AesKdf => {
            let rounds = kdf.iterations.unwrap_or(0);
            if !(MIN_AES_ROUNDS..=MAX_AES_ROUNDS).contains(&rounds) {
                return Err(format!(
                    "AES-KDF rounds must be between {MIN_AES_ROUNDS} and {MAX_AES_ROUNDS}"
                ));
            }
        }
        KdfAlgorithm::Argon2d | KdfAlgorithm::Argon2id => {
            let memory = kdf.memory.unwrap_or(0);
            let iterations = kdf.iterations.unwrap_or(0);
            let parallelism = kdf.parallelism.unwrap_or(0);
            if !(MIN_ARGON_MEMORY..=MAX_ARGON_MEMORY).contains(&memory) {
                return Err(format!(
                    "Argon2 memory must be between {} MiB and {} MiB",
                    MIN_ARGON_MEMORY / 1024 / 1024,
                    MAX_ARGON_MEMORY / 1024 / 1024
                ));
            }
            if !(1..=MAX_ARGON_ITERATIONS).contains(&iterations) {
                return Err(format!(
                    "Argon2 iterations must be between 1 and {MAX_ARGON_ITERATIONS}"
                ));
            }
            if !(1..=MAX_ARGON_PARALLELISM).contains(&parallelism) {
                return Err(format!(
                    "Argon2 parallelism must be between 1 and {MAX_ARGON_PARALLELISM}"
                ));
            }
        }
    }
    Ok(())
}

fn validate_native_config(config: &keepass::config::DatabaseConfig) -> Result<(), String> {
    match config.version {
        DatabaseVersion::KDB4(_) => {}
        _ => return Err("Only KDBX4 databases can be saved safely".to_string()),
    }
    validate_kdf_settings(&kdf_from_native(&config.kdf_config))
}

fn format_version(version: &DatabaseVersion) -> String {
    match version {
        DatabaseVersion::KDB(_) => "1.x".to_string(),
        DatabaseVersion::KDB2(value) => format!("2.{value}"),
        DatabaseVersion::KDB3(value) => format!("3.{value}"),
        DatabaseVersion::KDB4(value) => format!("4.{value}"),
    }
}

fn read_database_image(path: &Path) -> Result<(Vec<u8>, [u8; 32], HeaderInfo), String> {
    validate_regular_file(path, MAX_DATABASE_SIZE)?;
    let mut file = File::open(path).map_err(|e| format!("Failed to read KeePass database: {e}"))?;
    let header = inspect_header(&mut file)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed to rewind KeePass database: {e}"))?;
    let expected_len = file
        .metadata()
        .map_err(|e| format!("Failed to inspect KeePass database: {e}"))?
        .len();
    let mut bytes = Vec::with_capacity(expected_len.min(MAX_DATABASE_SIZE) as usize);
    Read::by_ref(&mut file)
        .take(MAX_DATABASE_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read KeePass database: {e}"))?;
    if bytes.len() as u64 != expected_len || bytes.len() as u64 > MAX_DATABASE_SIZE {
        return Err(
            "KeePass database changed or exceeded the safety limit while reading".to_string(),
        );
    }
    let hash = Sha256::digest(&bytes).into();
    Ok((bytes, hash, header))
}

fn inspect_header(file: &mut File) -> Result<HeaderInfo, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Cannot seek KeePass database header: {e}"))?;
    let mut header = Vec::new();
    Read::by_ref(file)
        .take(MAX_HEADER_SIZE as u64 + 1)
        .read_to_end(&mut header)
        .map_err(|e| format!("Cannot read KeePass database header: {e}"))?;
    if header.len() < 12 || header[..8] != KDBX_SIGNATURE {
        return Err("Invalid KeePass KDBX file signature".to_string());
    }
    let version = u32::from_le_bytes(
        header[8..12]
            .try_into()
            .map_err(|_| "Invalid KeePass version header".to_string())?,
    );
    let major = version >> 16;
    if major != 3 && major != 4 {
        return Err(format!("Unsupported KDBX major version: {major}"));
    }
    let minor = version & 0xffff;
    let mut cursor = 12usize;
    let mut cipher = None;
    let mut kdf = None;
    let mut terminated = false;
    while cursor < header.len() && cursor <= MAX_HEADER_SIZE {
        let field_id = header[cursor];
        cursor += 1;
        let field_len = if major >= 4 {
            let end = cursor
                .checked_add(4)
                .ok_or_else(|| "KDBX header length overflow".to_string())?;
            let value = u32::from_le_bytes(
                header
                    .get(cursor..end)
                    .ok_or_else(|| "Truncated KDBX header".to_string())?
                    .try_into()
                    .map_err(|_| "Invalid KDBX header length".to_string())?,
            ) as usize;
            cursor = end;
            value
        } else {
            let end = cursor
                .checked_add(2)
                .ok_or_else(|| "KDBX header length overflow".to_string())?;
            let value = u16::from_le_bytes(
                header
                    .get(cursor..end)
                    .ok_or_else(|| "Truncated KDBX header".to_string())?
                    .try_into()
                    .map_err(|_| "Invalid KDBX header length".to_string())?,
            ) as usize;
            cursor = end;
            value
        };
        let end = cursor
            .checked_add(field_len)
            .ok_or_else(|| "KDBX header field overflow".to_string())?;
        if end > MAX_HEADER_SIZE {
            return Err("KDBX header exceeds the 1 MiB safety limit".to_string());
        }
        let value = header
            .get(cursor..end)
            .ok_or_else(|| "Truncated KDBX header field".to_string())?;
        cursor = end;
        match field_id {
            0 => {
                terminated = true;
                break;
            }
            2 if value.len() == 16 => {
                cipher = Some(match value {
                    [
                        0x31, 0xc1, 0xf2, 0xe6, 0xbf, 0x71, 0x43, 0x50, 0xbe, 0x58, 0x05,
                        0x21, 0x6a, 0xfc, 0x5a, 0xff,
                    ] => "AES-256",
                    [
                        0xad, 0x68, 0xf2, 0x9f, 0x57, 0x6f, 0x4b, 0xb9, 0xa3, 0x6a, 0xd4,
                        0x7a, 0xf9, 0x65, 0x34, 0x6c,
                    ] => "Twofish",
                    [
                        0xd6, 0x03, 0x8a, 0x2b, 0x8b, 0x6f, 0x4c, 0xb5, 0xa5, 0x24, 0x33,
                        0x9a, 0x31, 0xdb, 0xb5, 0x9a,
                    ] => "ChaCha20",
                    _ => "Unknown",
                }
                .to_string());
            }
            6 if major == 3 && value.len() == 8 => {
                let rounds = u64::from_le_bytes(
                    value
                        .try_into()
                        .map_err(|_| "Invalid AES-KDF rounds".to_string())?,
                );
                validate_header_aes_rounds(rounds)?;
                kdf = Some("AES-KDF".to_string());
            }
            11 if major >= 4 => {
                kdf = Some(validate_variant_kdf(value)?);
            }
            _ => {}
        }
    }
    if !terminated {
        return Err(
            "KDBX header is missing its terminator or exceeds the safety limit".to_string(),
        );
    }
    Ok(HeaderInfo {
        format_version: format!("{major}.{minor}"),
        cipher,
        kdf,
    })
}

fn validate_variant_kdf(buffer: &[u8]) -> Result<String, String> {
    if buffer.len() < 3 || u16::from_le_bytes([buffer[0], buffer[1]]) != 0x0100 {
        return Err("Invalid KDBX KDF parameter dictionary".to_string());
    }
    let mut cursor = 2usize;
    let mut memory = None;
    let mut iterations = None;
    let mut parallelism = None;
    let mut rounds = None;
    let mut terminated = false;
    while cursor < buffer.len() {
        let value_type = buffer[cursor];
        cursor += 1;
        if value_type == 0 {
            terminated = true;
            break;
        }
        let key_len = read_u32(buffer, &mut cursor)? as usize;
        if key_len > 64 {
            return Err("KDBX KDF parameter name is too large".to_string());
        }
        let key_end = cursor
            .checked_add(key_len)
            .ok_or_else(|| "KDBX KDF parameter overflow".to_string())?;
        let key = std::str::from_utf8(
            buffer
                .get(cursor..key_end)
                .ok_or_else(|| "Truncated KDBX KDF parameter name".to_string())?,
        )
        .map_err(|_| "KDBX KDF parameter name is not UTF-8".to_string())?;
        cursor = key_end;
        let value_len = read_u32(buffer, &mut cursor)? as usize;
        if value_len > MAX_HEADER_SIZE {
            return Err("KDBX KDF parameter value is too large".to_string());
        }
        let value_end = cursor
            .checked_add(value_len)
            .ok_or_else(|| "KDBX KDF parameter overflow".to_string())?;
        let value = buffer
            .get(cursor..value_end)
            .ok_or_else(|| "Truncated KDBX KDF parameter value".to_string())?;
        cursor = value_end;
        match (key, value_type, value.len()) {
            ("M", 0x05, 8) => memory = Some(read_exact_u64(value)?),
            ("I", 0x05, 8) => iterations = Some(read_exact_u64(value)?),
            ("P", 0x04, 4) => parallelism = Some(read_exact_u32(value)?),
            ("R", 0x05, 8) => rounds = Some(read_exact_u64(value)?),
            _ => {}
        }
    }
    if !terminated {
        return Err("KDBX KDF parameter dictionary is not terminated".to_string());
    }
    if let Some(rounds) = rounds {
        validate_header_aes_rounds(rounds)?;
        return Ok("AES-KDF".to_string());
    }
    let memory = memory.ok_or_else(|| "KDBX Argon2 memory parameter is missing".to_string())?;
    let iterations =
        iterations.ok_or_else(|| "KDBX Argon2 iteration parameter is missing".to_string())?;
    let parallelism =
        parallelism.ok_or_else(|| "KDBX Argon2 parallelism parameter is missing".to_string())?;
    if memory == 0 || memory > MAX_ARGON_MEMORY {
        return Err(format!(
            "KDBX Argon2 memory exceeds the {} MiB safety limit",
            MAX_ARGON_MEMORY / 1024 / 1024
        ));
    }
    if iterations == 0 || iterations > MAX_ARGON_ITERATIONS {
        return Err(format!(
            "KDBX Argon2 iterations exceed the safety limit of {MAX_ARGON_ITERATIONS}"
        ));
    }
    if parallelism == 0 || parallelism > MAX_ARGON_PARALLELISM {
        return Err(format!(
            "KDBX Argon2 parallelism exceeds the safety limit of {MAX_ARGON_PARALLELISM}"
        ));
    }
    Ok("Argon2".to_string())
}

fn validate_header_aes_rounds(rounds: u64) -> Result<(), String> {
    if rounds == 0 || rounds > MAX_AES_ROUNDS {
        return Err(format!(
            "KDBX AES-KDF rounds exceed the safety limit of {MAX_AES_ROUNDS}"
        ));
    }
    Ok(())
}

fn read_u32(buffer: &[u8], cursor: &mut usize) -> Result<u32, String> {
    let end = cursor
        .checked_add(4)
        .ok_or_else(|| "KDBX parameter length overflow".to_string())?;
    let value = read_exact_u32(
        buffer
            .get(*cursor..end)
            .ok_or_else(|| "Truncated KDBX parameter length".to_string())?,
    )?;
    *cursor = end;
    Ok(value)
}

fn read_exact_u32(buffer: &[u8]) -> Result<u32, String> {
    Ok(u32::from_le_bytes(
        buffer
            .try_into()
            .map_err(|_| "Invalid KDBX u32 value".to_string())?,
    ))
}

fn read_exact_u64(buffer: &[u8]) -> Result<u64, String> {
    Ok(u64::from_le_bytes(
        buffer
            .try_into()
            .map_err(|_| "Invalid KDBX u64 value".to_string())?,
    ))
}

fn validate_regular_file(path: &Path, max_size: u64) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot inspect {}: {e}", path.display()))?;
    validate_file_metadata(&metadata, max_size)
}

fn validate_file_metadata(metadata: &std::fs::Metadata, max_size: u64) -> Result<(), String> {
    if metadata.file_type().is_symlink() {
        return Err("Refusing to follow a symbolic link".to_string());
    }
    if !metadata.is_file() {
        return Err("Expected a regular file".to_string());
    }
    if metadata.len() > max_size {
        return Err(format!(
            "File exceeds the {} MiB safety limit",
            max_size / 1024 / 1024
        ));
    }
    Ok(())
}

fn validate_directory(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot inspect directory {}: {e}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Refusing non-directory or symlink destination: {}",
            path.display()
        ));
    }
    Ok(())
}

fn ensure_safe_directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => validate_directory(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| "Backup directory has no parent".to_string())?;
            validate_directory(parent)?;
            std::fs::create_dir(path)
                .map_err(|e| format!("Cannot create backup directory {}: {e}", path.display()))?;
            validate_directory(path)
        }
        Err(error) => Err(format!(
            "Cannot inspect backup directory {}: {error}",
            path.display()
        )),
    }
}

fn read_bounded_regular_file(path: &Path, max_size: u64, label: &str) -> Result<Vec<u8>, String> {
    let absolute = absolute_path(path)?;
    validate_regular_file(&absolute, max_size)?;
    let mut file = File::open(&absolute).map_err(|e| format!("Cannot open {label}: {e}"))?;
    let expected = file
        .metadata()
        .map_err(|e| format!("Cannot inspect {label}: {e}"))?
        .len();
    let mut data = Vec::with_capacity(expected as usize);
    Read::by_ref(&mut file)
        .take(max_size + 1)
        .read_to_end(&mut data)
        .map_err(|e| format!("Cannot read {label}: {e}"))?;
    if data.len() as u64 != expected || data.len() as u64 > max_size {
        return Err(format!(
            "{label} changed or exceeded its safety limit while reading"
        ));
    }
    Ok(data)
}

fn hash_regular_file(path: &Path, max_size: u64) -> Result<[u8; 32], String> {
    validate_regular_file(path, max_size)?;
    let mut file = File::open(path).map_err(|e| format!("Cannot open database: {e}"))?;
    let expected = file
        .metadata()
        .map_err(|e| format!("Cannot inspect database: {e}"))?
        .len();
    let mut hasher = Sha256::new();
    let mut read_total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Cannot hash database: {e}"))?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(read as u64)
            .ok_or_else(|| "Database size overflow".to_string())?;
        if read_total > max_size {
            return Err("Database exceeds its safety limit while hashing".to_string());
        }
        hasher.update(&buffer[..read]);
    }
    if read_total != expected {
        return Err("Database changed while hashing".to_string());
    }
    Ok(hasher.finalize().into())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(path))
            .map_err(|e| format!("Cannot resolve current directory: {e}"))
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|e| format!("Invalid KeePass UUID '{value}': {e}"))
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|e| {
        format!(
            "Failed to atomically replace {}: {e}",
            destination.display()
        )
    })
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(format!(
            "Failed to atomically replace {}: {}",
            destination.display(),
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

fn sync_parent(parent: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|e| format!("Failed to sync directory {}: {e}", parent.display()))?;
    }
    #[cfg(not(unix))]
    let _ = parent;
    Ok(())
}
