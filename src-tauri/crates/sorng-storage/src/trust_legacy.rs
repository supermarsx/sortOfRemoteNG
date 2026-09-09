//! Explicit, non-activating legacy migration and conservative cleanup eligibility.
//! All source generations are retained until a separately requested, revalidated
//! cleanup. Receipts live inside the normal trust document (and its protection).
use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

// Managed container text can be 96 MiB and is itself stored as a JSON string.
// Allow its JSON escaping overhead, without retaining every database in memory.
const MAX_DATABASE_BYTES: u64 =
    (sorng_encryption::database_protection::MAX_CONTAINER_BYTES as u64) * 2 + 2;
const GENERATIONS: [&str; 3] = ["", ".bak", ".v0.bak"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustLegacyMigrationReceipt {
    version: u8,
    database_id: String,
    source_digest: String,
    payload_digest: String,
    scope_digest: String,
    decision_digest: String,
}
impl TrustLegacyMigrationReceipt {
    pub(super) fn validate(&self) -> Result<(), String> {
        crate::database_transaction::validate_database_id(&self.database_id)?;
        if self.version != 1
            || [
                &self.source_digest,
                &self.payload_digest,
                &self.scope_digest,
                &self.decision_digest,
            ]
            .iter()
            .any(|digest| digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("Invalid legacy trust migration receipt".into());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustLegacyMigrationOutcome {
    pub database_id: String,
    pub status: String,
    pub migrated_records: u64,
    pub preserved_records: u64,
    pub warnings: Vec<String>,
}

struct Sources {
    digest: String,
    trust: Option<TrustStoreData>,
    rdp: RdpLegacyDocument,
    paths: Vec<PathBuf>,
    file_digests: BTreeMap<PathBuf, String>,
    legacy_records: u64,
    rdp_records: u64,
    legacy_present: bool,
    rdp_present: bool,
}

pub(super) fn digest(value: &Value) -> Result<String, String> {
    // serde_json::Value objects are sorted maps in this workspace. Explicit
    // recursive sorting also keeps this binding stable if preserve_order changes.
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let ordered: BTreeMap<_, _> =
                    map.iter().map(|(k, v)| (k.clone(), canonical(v))).collect();
                serde_json::to_value(ordered).expect("JSON values serialize")
            }
            Value::Array(values) => Value::Array(values.iter().map(canonical).collect()),
            other => other.clone(),
        }
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&canonical(value))
                .map_err(|_| "Could not bind migration snapshot")?
        )
    ))
}

fn decision_digest(data: &TrustStoreData) -> Result<String, String> {
    let mut value = serde_json::to_value(data).map_err(|_| "Could not bind trust decisions")?;
    let object = value.as_object_mut().ok_or("Invalid trust decisions")?;
    object.remove("legacy_migration_receipt");
    object.remove("legacyMigrationReceipt");
    if let Some(records) = object.get_mut("records").and_then(Value::as_object_mut) {
        for record in records.values_mut().filter_map(Value::as_object_mut) {
            record.remove("stats");
            record.remove("history");
            if let Some(identity) = record.get_mut("identity").and_then(Value::as_object_mut) {
                for field in ["firstSeen", "lastSeen", "first_seen", "last_seen"] {
                    identity.remove(field);
                }
            }
        }
    }
    digest(&value)
}

fn raw_file(root: &Path, path: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    sorng_encryption::artifact_transaction::validate_regular_path(root, path, true)?;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("A migration file could not be read".into()),
    };
    if file
        .metadata()
        .map_err(|_| "Could not inspect migration file")?
        .len()
        > limit
    {
        return Err("A migration file exceeds its bounded size limit".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read migration file")?;
    if bytes.len() as u64 > limit {
        return Err("A migration file changed beyond its size limit".into());
    }
    Ok(Some(bytes))
}

fn check_known_peers(root: &Path, canonical: &Path) -> Result<(), String> {
    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid migration file name")?;
    let parent = canonical.parent().ok_or("Invalid migration directory")?;
    for entry in
        std::fs::read_dir(parent).map_err(|_| "Migration directory could not be inspected")?
    {
        let entry = entry.map_err(|_| "Migration directory entry could not be inspected")?;
        let candidate = entry
            .file_name()
            .into_string()
            .map_err(|_| "Unknown migration file name")?;
        if candidate == name || candidate.starts_with(&format!("{name}.")) {
            if !GENERATIONS
                .iter()
                .any(|suffix| candidate == format!("{name}{suffix}"))
            {
                return Err(format!(
                    "Unverified or pending migration generation: {candidate}"
                ));
            }
            sorng_encryption::artifact_transaction::validate_regular_path(
                root,
                &entry.path(),
                false,
            )?;
        }
    }
    Ok(())
}

impl TrustRuntime {
    fn strict_value(
        &self,
        path: &Path,
        kind: ArtifactKind,
        limit: u64,
    ) -> Result<Option<Value>, String> {
        let Some(bytes) = raw_file(&self.app_dir, path, limit + 1024)? else {
            return Ok(None);
        };
        let payload = if bytes.starts_with(sdbf::MAGIC) {
            sdbf::parse_and_verify(&bytes)
                .map_err(|_| "Corrupt migration file checksum")?
                .to_vec()
        } else {
            bytes
        };
        let decode = |key: Option<&SubKey>| -> Result<Value, String> {
            let plain = if is_envelope_blob(&payload) {
                decrypt_with_subkey(
                    key.ok_or("Unlock global encryption before inspecting migration")?,
                    &payload,
                )?
            } else {
                if self
                    .enc_state
                    .as_ref()
                    .is_some_and(|state| state.resolve_write_policy(kind, false).unwrap_or(true))
                {
                    return Err(
                        "Plaintext migration file conflicts with protected artifact policy".into(),
                    );
                }
                payload.clone()
            };
            if plain.len() as u64 > limit {
                return Err("Decoded migration file exceeds its size limit".into());
            }
            serde_json::from_slice(&plain).map_err(|_| "Malformed migration file".into())
        };
        let value = match &self.enc_state {
            Some(state) => {
                state.resolve_write_policy(kind, false)?;
                state
                    .with_sub_key_sync(kind, decode)
                    .map_err(str::to_string)??
            }
            None => decode(None)?,
        };
        Ok(Some(value))
    }

    fn sources(&self) -> Result<Sources, String> {
        self.with_current_key(|_| Ok(()))?;
        let mut source = Sources {
            digest: String::new(),
            trust: None,
            rdp: RdpLegacyDocument::default(),
            paths: vec![],
            file_digests: BTreeMap::new(),
            legacy_records: 0,
            rdp_records: 0,
            legacy_present: false,
            rdp_present: false,
        };
        let mut manifest = BTreeMap::new();
        for (base, rdp) in [(self.legacy_path(), false), (self.legacy_rdp_path(), true)] {
            check_known_peers(&self.app_dir, &base)?;
            for suffix in GENERATIONS {
                let path = PathBuf::from(format!("{}{suffix}", base.to_string_lossy()));
                let Some(bytes) = raw_file(&self.app_dir, &path, MAX_TRUST_STORE_BYTES)? else {
                    continue;
                };
                manifest.insert(
                    path.file_name().unwrap().to_string_lossy().to_string(),
                    format!("{:x}", Sha256::digest(&bytes)),
                );
                source
                    .file_digests
                    .insert(path.clone(), format!("{:x}", Sha256::digest(&bytes)));
                if rdp {
                    let value: Value = serde_json::from_slice(&bytes)
                        .map_err(|_| "Malformed legacy RDP trust source")?;
                    if !value.get("entries").is_some_and(Value::is_object) {
                        return Err("Legacy RDP trust entries are missing".into());
                    }
                    let document: RdpLegacyDocument = serde_json::from_value(value)
                        .map_err(|_| "Malformed legacy RDP records")?;
                    if document.entries.len() > MAX_TRUST_RECORDS {
                        return Err("Too many legacy RDP records".into());
                    }
                    for (key, entry) in document.entries {
                        if entry.host.is_empty()
                            || entry.fingerprint.trim().is_empty()
                            || entry.port == 0
                        {
                            return Err("A legacy RDP identity cannot be safely migrated".into());
                        }
                        source.rdp.entries.entry(key).or_insert(entry);
                    }
                    source.rdp_present = true;
                } else {
                    let data: TrustStoreData = serde_json::from_slice(&bytes)
                        .map_err(|_| "Malformed legacy trust source")?;
                    validate_trust_store_data(&data)?;
                    if let Some(current) = &mut source.trust {
                        for (key, record) in data.records {
                            current.records.entry(key).or_insert(record);
                        }
                        suppress_legacy_keys(current, data.legacy_suppressed_keys)?;
                    } else {
                        source.trust = Some(data);
                    }
                    source.legacy_present = true;
                }
                source.paths.push(path);
            }
        }
        source.legacy_records = source.trust.as_ref().map_or(0, |d| d.records.len() as u64);
        source.rdp_records = source.rdp.entries.len() as u64;
        if source.legacy_records + source.rdp_records > MAX_TRUST_RECORDS as u64 {
            return Err("Too many combined legacy identities".into());
        }
        source.digest =
            digest(&serde_json::to_value(manifest).map_err(|_| "Could not bind legacy sources")?)?;
        Ok(source)
    }

    fn database_inventory(&self) -> Result<BTreeMap<String, (String, String)>, String> {
        let index_path = self.databases_dir.join("index.json");
        check_known_peers(&self.app_dir, &index_path)?;
        for suffix in &GENERATIONS[1..] {
            if let Some(index) = self.strict_value(
                &PathBuf::from(format!("{}{suffix}", index_path.to_string_lossy())),
                ArtifactKind::DatabasesIndex,
                MAX_DATABASE_BYTES,
            )? {
                if !index.is_array() {
                    return Err("Malformed database index recovery generation".into());
                }
            }
        }
        let index = self
            .strict_value(
                &index_path,
                ArtifactKind::DatabasesIndex,
                MAX_DATABASE_BYTES,
            )?
            .ok_or("Database index is missing; cleanup cannot verify completeness")?;
        let rows = index.as_array().ok_or("Malformed database index")?;
        if rows.is_empty() || rows.len() > MAX_TRUST_RECORDS {
            return Err("No bounded database inventory is available for migration coverage".into());
        }
        let mut inventory = BTreeMap::new();
        let mut allowed = BTreeSet::new();
        for suffix in GENERATIONS {
            allowed.insert(format!("index.json{suffix}"));
        }
        for row in rows {
            let id = row
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Database ID is missing from index")?;
            crate::database_transaction::validate_database_id(id)?;
            let encrypted = row
                .get("isEncrypted")
                .and_then(Value::as_bool)
                .ok_or("Database encryption metadata is malformed")?;
            let revision = row
                .get("securityRevision")
                .map(|v| v.as_str().ok_or("Database security revision is malformed"))
                .transpose()?
                .unwrap_or("");
            if revision.len() > 256 || revision.contains('\0') {
                return Err("Invalid database security revision".into());
            }
            let path = self.databases_dir.join(format!("{id}.json"));
            check_known_peers(&self.app_dir, &path)?;
            for suffix in GENERATIONS {
                allowed.insert(format!("{id}.json{suffix}"));
                allowed.insert(format!("{id}.trust.json{suffix}"));
                if !suffix.is_empty() {
                    self.strict_value(
                        &PathBuf::from(format!("{}{suffix}", path.to_string_lossy())),
                        ArtifactKind::Connections,
                        MAX_DATABASE_BYTES,
                    )?;
                }
            }
            let data = self
                .strict_value(&path, ArtifactKind::Connections, MAX_DATABASE_BYTES)?
                .ok_or("An indexed database payload is missing")?;
            if encrypted != data.is_string()
                || (!encrypted && !data.get("connections").is_some_and(Value::is_array))
            {
                return Err("Database payload does not match encryption metadata".into());
            }
            if row.get("protectionFormat").is_some()
                || sorng_encryption::database_protection::is_managed(&data)
            {
                let envelope =
                    sorng_encryption::database_protection::DatabaseEnvelope::parse(&data, id)?;
                if envelope.security_revision != revision {
                    return Err("Managed database security revision changed".into());
                }
            }
            let payload_digest = digest(&json!({"revision":revision,"data":data}))?;
            if inventory
                .insert(id.to_owned(), (revision.to_owned(), payload_digest))
                .is_some()
            {
                return Err("Duplicate database ID in index".into());
            }
        }
        for entry in std::fs::read_dir(&self.databases_dir)
            .map_err(|_| "Could not inspect database inventory")?
        {
            let entry = entry.map_err(|_| "Could not inspect database inventory entry")?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "Unknown database inventory name")?;
            if !allowed.contains(&name) {
                return Err(format!("Unverified or pending database file: {name}"));
            }
            sorng_encryption::artifact_transaction::validate_regular_path(
                &self.app_dir,
                &entry.path(),
                false,
            )?;
        }
        Ok(inventory)
    }

    fn strict_trust(&self, id: &str) -> Result<Option<TrustStoreData>, String> {
        let path = self.trust_file_path(id)?;
        check_known_peers(&self.app_dir, &path)?;
        for suffix in &GENERATIONS[1..] {
            if let Some(value) = self.strict_value(
                &PathBuf::from(format!("{}{suffix}", path.to_string_lossy())),
                ArtifactKind::TrustStore,
                MAX_TRUST_STORE_BYTES,
            )? {
                validate_trust_store_data(
                    &serde_json::from_value(value)
                        .map_err(|_| "Malformed trust recovery generation")?,
                )?;
            }
        }
        let value = self.strict_value(&path, ArtifactKind::TrustStore, MAX_TRUST_STORE_BYTES)?;
        if value.is_none()
            && GENERATIONS[1..]
                .iter()
                .any(|suffix| PathBuf::from(format!("{}{suffix}", path.to_string_lossy())).exists())
        {
            return Err("Trust recovery generation exists without its canonical file; recover it before migration".into());
        }
        value
            .map(|value| {
                let data = serde_json::from_value(value)
                    .map_err(|_| "Malformed destination trust store")?;
                validate_trust_store_data(&data)?;
                Ok(data)
            })
            .transpose()
    }

    /// Caller supplies a natively verified source snapshot while holding the
    /// same global key/writer barrier. Never changes the active trust database.
    #[allow(clippy::too_many_arguments)]
    pub fn migrate_legacy_database_with_coordinator_guard(
        &self,
        profile: &Path,
        database_id: &str,
        revision: &str,
        expected_data: &Value,
        connection_ids: &[String],
        _coordinator: &tokio::sync::MutexGuard<'static, ()>,
        validate_access: impl FnOnce() -> Result<(), String>,
    ) -> Result<TrustLegacyMigrationOutcome, String> {
        crate::database_transaction::validate_database_id(database_id)?;
        if profile
            .canonicalize()
            .map_err(|_| "Database profile unavailable")?
            != self
                .app_dir
                .canonicalize()
                .map_err(|_| "Trust profile unavailable")?
        {
            return Err("Database and trust profiles do not match".into());
        }
        let _io = self
            .io
            .lock()
            .map_err(|_| "Trust runtime I/O lock poisoned")?;
        let mut ids = BTreeSet::new();
        if connection_ids.len() > MAX_TRUST_RECORDS {
            return Err("Too many connection IDs for migration".into());
        }
        for id in connection_ids {
            if id.is_empty()
                || id.len() > 256
                || id.contains(['\0', '/', '\\'])
                || !ids.insert(id.clone())
            {
                return Err("Invalid or duplicate migration connection ID".into());
            }
        }
        let source = self.sources()?;
        if source.paths.is_empty() {
            return Err("No legacy trust source is present".into());
        }
        let inventory = self.database_inventory()?;
        let current = inventory
            .get(database_id)
            .ok_or("Database is no longer in the verified inventory")?;
        let payload_digest = digest(&json!({"revision":revision,"data":expected_data}))?;
        if current.0 != revision || current.1 != payload_digest {
            return Err(
                "Database contents or security changed; reload and review migration again".into(),
            );
        }
        let scope_digest = digest(&json!(ids))?;
        let current_data = self.strict_trust(database_id)?;
        let mut data = current_data.clone().unwrap_or_default();
        let mut outcome = TrustLegacyMigrationOutcome {
            database_id: database_id.into(),
            status: "migrated".into(),
            migrated_records: 0,
            preserved_records: 0,
            warnings: vec![],
        };
        if data
            .legacy_migration_receipt
            .as_ref()
            .is_some_and(|receipt| {
                receipt.database_id == database_id
                    && receipt.source_digest == source.digest
                    && receipt.payload_digest == payload_digest
                    && receipt.scope_digest == scope_digest
                    && decision_digest(&data).as_ref() == Ok(&receipt.decision_digest)
            })
        {
            self.revalidate_migration_snapshot(
                database_id,
                revision,
                &payload_digest,
                &source.digest,
            )?;
            validate_access()?;
            outcome.status = "already-verified".into();
            return Ok(outcome);
        }
        let source_suppressed = source
            .trust
            .as_ref()
            .map(|d| d.legacy_suppressed_keys.clone())
            .unwrap_or_default();
        let incoming = legacy_data_for_connections(source.trust, source.rdp, connection_ids);
        if current_data.is_none() {
            data.policy = incoming.policy;
            data.policy_config = incoming.policy_config;
        }
        let mut suppressed = 0;
        // A source can retain only a forgotten-key marker, with no record left.
        // Preserve relevant markers too, so later automatic browser replay
        // cannot restore them after the legacy sidecar is explicitly cleaned up.
        for key in &source_suppressed {
            let host = key.split_once(':').map(|(_, host)| host).unwrap_or("");
            let in_scope = host
                .strip_prefix(CONNECTION_SCOPE_PREFIX)
                .is_none_or(|rest| rest.split('/').next().is_some_and(|id| ids.contains(id)));
            if in_scope
                && !incoming.records.contains_key(key)
                && !data.records.contains_key(key)
                && !data.legacy_suppressed_keys.contains(key)
            {
                suppress_legacy_keys(&mut data, [key.clone()])?;
                suppressed += 1;
                outcome.preserved_records += 1;
            }
        }
        for (key, record) in incoming.records {
            if data.records.contains_key(&key) {
                outcome.preserved_records += 1;
                continue;
            }
            if data.legacy_suppressed_keys.contains(&key) || source_suppressed.contains(&key) {
                suppress_legacy_keys(&mut data, [key])?;
                suppressed += 1;
                outcome.preserved_records += 1;
            } else if let std::collections::hash_map::Entry::Vacant(entry) = data.records.entry(key)
            {
                entry.insert(record);
                outcome.migrated_records += 1;
            } else {
                outcome.preserved_records += 1;
            }
        }
        if suppressed > 0 {
            outcome.warnings.push(format!("{suppressed} forgotten legacy identities were kept suppressed; migration did not restore them."));
        }
        if outcome.preserved_records > 0 {
            outcome.warnings.push("Existing destination identities, policies, revocations and expiry decisions were preserved.".into());
        }
        let source_digest = source.digest;
        data.legacy_migration_receipt = Some(TrustLegacyMigrationReceipt {
            version: 1,
            database_id: database_id.into(),
            source_digest: source_digest.clone(),
            payload_digest: payload_digest.clone(),
            scope_digest,
            decision_digest: decision_digest(&data)?,
        });
        validate_trust_store_data(&data)?;
        let path = self.trust_file_path(database_id)?;
        self.revalidate_migration_snapshot(database_id, revision, &payload_digest, &source_digest)?;
        validate_access()?;
        self.write_file(&path, &data)?;
        let verified = self
            .strict_trust(database_id)?
            .ok_or("Migration write could not be verified")?;
        if serde_json::to_value(verified).map_err(|_| "Could not verify migrated trust")?
            != serde_json::to_value(data).map_err(|_| "Could not verify trust migration")?
        {
            return Err(
                "Migration destination readback did not match; legacy sources were retained".into(),
            );
        }
        Ok(outcome)
    }

    fn revalidate_migration_snapshot(
        &self,
        id: &str,
        revision: &str,
        payload_digest: &str,
        source_digest: &str,
    ) -> Result<(), String> {
        let index = self
            .strict_value(
                &self.databases_dir.join("index.json"),
                ArtifactKind::DatabasesIndex,
                MAX_DATABASE_BYTES,
            )?
            .ok_or("Database index disappeared during migration")?;
        let rows = index
            .as_array()
            .ok_or("Database index changed during migration")?;
        let mut matching = rows
            .iter()
            .filter(|row| row.get("id").and_then(Value::as_str) == Some(id));
        let row = matching
            .next()
            .ok_or("Database was removed during migration")?;
        if matching.next().is_some()
            || row
                .get("securityRevision")
                .and_then(Value::as_str)
                .unwrap_or("")
                != revision
        {
            return Err("Database security changed during migration".into());
        }
        let payload = self
            .strict_value(
                &self.databases_dir.join(format!("{id}.json")),
                ArtifactKind::Connections,
                MAX_DATABASE_BYTES,
            )?
            .ok_or("Database payload disappeared during migration")?;
        if row.get("isEncrypted").and_then(Value::as_bool) != Some(payload.is_string())
            || digest(&json!({"revision":revision,"data":payload}))? != payload_digest
            || self.sources()?.digest != source_digest
        {
            return Err(
                "Database or legacy source changed during migration; no trust changes were written"
                    .into(),
            );
        }
        Ok(())
    }

    fn legacy_status_inner(&self) -> Result<(TrustLegacyStatus, Option<String>), String> {
        let mut status = TrustLegacyStatus {
            legacy_present: false,
            legacy_records: 0,
            rdp_legacy_present: false,
            rdp_legacy_records: 0,
            all_databases_opened: false,
            pending_database_ids: vec![],
            verified_database_ids: vec![],
            blockers: vec![],
            can_delete_legacy: false,
        };
        let source = match self.sources() {
            Ok(source) => source,
            Err(error) => {
                status.legacy_present = std::fs::symlink_metadata(self.legacy_path()).is_ok();
                status.rdp_legacy_present =
                    std::fs::symlink_metadata(self.legacy_rdp_path()).is_ok();
                status.blockers.push(error);
                return Ok((status, None));
            }
        };
        status.legacy_present = source.legacy_present;
        status.rdp_legacy_present = source.rdp_present;
        status.legacy_records = source.legacy_records;
        status.rdp_legacy_records = source.rdp_records;
        if source.paths.is_empty() {
            return Ok((status, Some(source.digest)));
        }
        let inventory = match self.database_inventory() {
            Ok(v) => v,
            Err(error) => {
                status.blockers.push(error);
                return Ok((status, Some(source.digest)));
            }
        };
        for (id, (_, payload_digest)) in inventory {
            let verified = match self.strict_trust(&id) {
                Ok(Some(data)) => data
                    .legacy_migration_receipt
                    .as_ref()
                    .is_some_and(|receipt| {
                        receipt.database_id == id
                            && receipt.source_digest == source.digest
                            && payload_digest == receipt.payload_digest
                            && decision_digest(&data).as_ref() == Ok(&receipt.decision_digest)
                    }),
                Ok(None) => false,
                Err(error) => {
                    status.blockers.push(format!("{id}: {error}"));
                    false
                }
            };
            if verified {
                status.verified_database_ids.push(id);
            } else {
                status.pending_database_ids.push(id);
            }
        }
        status.can_delete_legacy = status.blockers.is_empty()
            && status.pending_database_ids.is_empty()
            && !status.verified_database_ids.is_empty();
        status.all_databases_opened = status.can_delete_legacy;
        Ok((status, Some(source.digest)))
    }

    pub fn legacy_status(&self) -> Result<TrustLegacyStatus, String> {
        let _io = self.io_guard()?;
        self.legacy_status_inner().map(|(status, _)| status)
    }

    /// Revalidate completeness natively under the writer/key barrier. Partial
    /// removal on an OS I/O failure is reported as an error; destinations remain.
    pub fn delete_legacy_stores(&self) -> Result<u32, String> {
        self.delete_legacy_stores_checked(|| {})
    }

    fn delete_legacy_stores_checked(&self, before_recheck: impl FnOnce()) -> Result<u32, String> {
        let _io = self.io_guard()?;
        let (status, verified_source_digest) = self.legacy_status_inner()?;
        if !status.can_delete_legacy {
            return Err("Legacy trust cleanup refused: migrate and verify every database; resolve all inventory blockers first".into());
        }
        before_recheck();
        let source = self.sources()?;
        if verified_source_digest.as_deref() != Some(&source.digest) {
            return Err(
                "Legacy sources changed during cleanup verification; no sources were removed"
                    .into(),
            );
        }
        for path in &source.paths {
            sorng_encryption::artifact_transaction::validate_regular_path(
                &self.app_dir,
                path,
                false,
            )?;
        }
        let mut removed = 0;
        for path in source.paths {
            let bytes = raw_file(&self.app_dir, &path, MAX_TRUST_STORE_BYTES)?
                .ok_or("Legacy source disappeared during cleanup")?;
            if source.file_digests.get(&path) != Some(&format!("{:x}", Sha256::digest(bytes))) {
                return Err(format!(
                    "Legacy source changed during cleanup; stopped after {removed} removals"
                ));
            }
            std::fs::remove_file(path).map_err(|_| format!("Legacy cleanup stopped after {removed} files; verified per-database copies remain intact"))?;
            removed += 1;
        }
        Ok(removed)
    }
}

#[cfg(test)]
#[path = "trust_legacy_tests.rs"]
mod tests;
