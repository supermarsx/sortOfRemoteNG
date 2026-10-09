//! Frozen native/TS contract (sign-in cookies only; never DOM storage).
//!
//! Ordinary StorageData projection:
//! `browserSessions?: { version: 1, records: [{ connectionId, revision }] }`.
//! Revisions are stable logical hashes, independent of encryption randomness.
//! `_nativeBrowserSessions` is PRIVATE managed-database plaintext, never IPC.
//!
//! Transport: `browserSessionsTransfer: { version: 1, ciphertext: string }`.
//! `database_browser_sessions_export({ databaseId, sessionId,
//!   expectedSecurityRevision, selected: BrowserSessionsDescriptor,
//!   deletedConnectionIds?: string[], password })`
//!   -> BrowserSessionsTransfer.
//! `database_browser_sessions_import({ databaseId, sessionId,
//!   expectedSecurityRevision, expected: BrowserSessionsDescriptor,
//!   selected: BrowserSessionsDescriptor, transfer: BrowserSessionsTransfer,
//!   deletedConnectionIds?: string[], data: StorageData,
//!   expectedData: StorageData, password })` -> SaveResult.
//! Public data and selected sessions commit ATOMICALLY. For a new archive,
//! create an empty protected destination, then import the full body here.
//! `expected` lists destination baseline revisions for the selected connections;
//! omission means no destination record. It covers selected + deleted IDs.
//! Deletions are authenticated in the capsule; export verifies source absence.
//! Unselected records are never replaced (security edits can invalidate them).
//! Each selected connection is atomic. Capsule plaintext authenticates the
//! EXACT selected descriptors. The transfer password alone unlocks the capsule;
//! source DB keys are never exported. Sync/ledger compares descriptors ONLY,
//! never randomized ciphertext. No cookie material is accepted from the UI.
//! `database_browser_sessions_describe({databaseId,sessionId,expectedSecurityRevision})`
//! -> BrowserSessionsDescriptor. Logical changes emit the event
//! `database-protection:browser-sessions-changed` with `{databaseId}` only.
//! Import preserves authenticated records independently of destination-local
//! preferences/grants. Native restore revalidates those and leaves mismatches
//! dormant. Transferring encrypted cookies never transfers network consent.

use super::*;
use serde::{Deserialize, Serialize};
use sorng_browser_host::cef_session_retention::{
    validate_cookies, validate_retention_origins, RetentionMode, RetentionPolicy, SignInCookie,
    MAX_COOKIE_BYTES, MAX_TOTAL_BYTES,
};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const PRIVATE: &str = "_nativeBrowserSessions";
pub(crate) const PUBLIC: &str = "browserSessions";
const TRANSFER_ID: &str = "browser-sessions-transfer";
const LIMIT: usize = 1024;
const ERROR: &str = "Native browser session data is unavailable, stale or invalid";

/// Borrowed session identity; construction does not validate or grant access.
/// Every use must retain the existing session and commit-time revocation checks.
pub(crate) struct SessionBinding<'a> {
    pub window: &'a str,
    pub database: &'a str,
    pub token: &'a str,
    pub revision: &'a str,
}

// The lock command intentionally has no renderer-supplied unlock token. Keep a
// bounded native witness to tokens already issued by this module, never DEKs.
#[derive(Clone)]
struct UnlockWitness {
    root: PathBuf,
    state: EncryptionState,
    window: String,
    database: String,
    revision: String,
    token: Zeroizing<String>,
}
fn witnesses() -> &'static std::sync::Mutex<Vec<UnlockWitness>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<Vec<UnlockWitness>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(Default::default)
}
pub(crate) fn remember_unlock(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    database: &str,
    revision: &str,
    token: &str,
) -> Result<(), String> {
    let mut store = witnesses().lock().map_err(|_| ERROR)?;
    store.retain(|entry| {
        if entry.state.database_session_owner() == state.database_session_owner()
            && entry.root == root
            && entry.database == database
            && entry.window == window
        {
            return false;
        }
        profile_binding(&entry.root).ok().is_some_and(|profile| {
            session_key(
                &entry.token,
                &scope(
                    &profile,
                    &entry.database,
                    &entry.revision,
                    &entry.window,
                    &entry.state,
                ),
            )
            .is_ok()
        })
    });
    if store.len() >= 128 {
        return Err(ERROR.into());
    }
    store.push(UnlockWitness {
        root: root.into(),
        state: state.clone(),
        window: window.into(),
        database: database.into(),
        revision: revision.into(),
        token: Zeroizing::new(token.into()),
    });
    Ok(())
}

fn prune(records: &mut PrivateSessions, lock: bool) -> bool {
    let before = records.records.len();
    let now = stamp();
    records
        .records
        .retain(|r| !r.expired(now) && !(lock && r.policy.clear_on_database_lock));
    before != records.records.len()
}

/// Caller holds database-operation coordination. Errors do not prevent lock:
/// the caller revokes keys anyway and reports incomplete physical cleanup.
pub(crate) async fn before_lock(
    root: &Path,
    state: &EncryptionState,
    database: &str,
) -> Result<(), String> {
    let candidates: Vec<_> = witnesses()
        .lock()
        .map_err(|_| ERROR)?
        .iter()
        .filter(|w| {
            w.root == root
                && w.database == database
                && w.state.database_session_owner() == state.database_session_owner()
        })
        .cloned()
        .collect();
    for witness in candidates {
        let profile = profile_binding(root)?;
        let Ok(key) = session_key(
            &witness.token,
            &scope(
                &profile,
                database,
                &witness.revision,
                &witness.window,
                state,
            ),
        ) else {
            continue;
        };
        let snapshot = managed_snapshot(root, state, database).await?;
        if revision(&snapshot) != witness.revision {
            return Err(ERROR.into());
        }
        let mut data = SecretData(DatabaseEnvelope::parse(&snapshot.data, database)?.open(&key)?);
        let mut records = private(&data.0)?;
        if prune(&mut records, true) {
            put_private(&mut data.0, records)?;
            commit_session_data(
                root,
                state,
                SessionBinding {
                    window: &witness.window,
                    database,
                    token: &witness.token,
                    revision: &witness.revision,
                },
                &snapshot,
                &data.0,
            )
            .await?;
        }
        return Ok(());
    }
    // No usable token means this database was already locked. Nothing can
    // release a key here; the next native unlock prunes expired/clear-on-lock.
    Ok(())
}

pub(crate) async fn after_unlock(
    root: &Path,
    state: &EncryptionState,
    binding: SessionBinding<'_>,
    snapshot: &ManagedSnapshot,
    data: &mut Value,
) -> Result<(), String> {
    remember_unlock(
        root,
        state,
        binding.window,
        binding.database,
        binding.revision,
        binding.token,
    )?;
    let mut records = private(data)?;
    if prune(&mut records, true) {
        put_private(data, records)?;
        commit_session_data(root, state, binding, snapshot, data).await?;
    }
    Ok(())
}

pub(crate) struct SecretData(pub Value);
impl Drop for SecretData {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionDescriptor {
    pub connection_id: String,
    pub revision: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserSessionsDescriptor {
    pub version: u8,
    pub records: Vec<SessionDescriptor>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserSessionsTransfer {
    pub version: u8,
    pub ciphertext: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeCookieRecord {
    pub connection_id: String,
    pub revision: String,
    pub salt: String,
    pub connection_digest: [u8; 32],
    pub dependencies: Vec<(bool, String, [u8; 32])>,
    pub portable_connection_digest: [u8; 32],
    pub portable_dependencies: Vec<(bool, String, [u8; 32])>,
    pub source_origin: String,
    pub origins: Vec<String>,
    pub policy: RetentionPolicy,
    pub created: u64,
    pub saved: u64,
    pub last_used: u64,
    pub cookies: Vec<SignInCookie>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PrivateSessions {
    version: u8,
    pub records: Vec<NativeCookieRecord>,
}

pub(crate) fn stamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl NativeCookieRecord {
    pub fn descriptor(&self) -> SessionDescriptor {
        SessionDescriptor {
            connection_id: self.connection_id.clone(),
            revision: self.revision.clone(),
        }
    }
    pub fn expired(&self, now: u64) -> bool {
        self.created > self.saved
            || self.saved > now
            || self.last_used > now
            || now.saturating_sub(self.created) >= u64::from(self.policy.max_age_hours) * 3600
            || now.saturating_sub(self.last_used.max(self.saved))
                >= u64::from(self.policy.idle_timeout_minutes) * 60
    }
    pub fn refresh_revision(&mut self) -> Result<(), String> {
        self.revision.clear();
        let mut value = SecretData(serde_json::to_value(&self).map_err(|_| ERROR)?);
        logical_projection(&mut value.0)?;
        let bytes = Zeroizing::new(serde_json::to_vec(&value.0).map_err(|_| ERROR)?);
        self.revision = format!("{:x}", Sha256::digest(&*bytes));
        Ok(())
    }
    pub fn same_cookies(&self, cookies: &[SignInCookie]) -> Result<bool, String> {
        let first = Zeroizing::new(serde_json::to_vec(&self.cookies).map_err(|_| ERROR)?);
        let second = Zeroizing::new(serde_json::to_vec(cookies).map_err(|_| ERROR)?);
        Ok(*first == *second)
    }
    pub(crate) fn validate(&self) -> Result<(), String> {
        self.policy.validate().map_err(|_| ERROR)?;
        if !valid_connection_id(&self.connection_id)
            || self.salt.len() != 48
            || !self.salt.bytes().all(|c| c.is_ascii_hexdigit())
            || self.revision.len() != 64
            || self.origins.is_empty()
            || self.origins.len() > 128
            || !self.origins.contains(&self.source_origin)
            || self.dependencies.len() > 128
            || self.portable_dependencies.len() != self.dependencies.len()
            || self
                .dependencies
                .iter()
                .map(|(v, id, _)| (v, id))
                .collect::<BTreeSet<_>>()
                != self
                    .portable_dependencies
                    .iter()
                    .map(|(v, id, _)| (v, id))
                    .collect::<BTreeSet<_>>()
            || self
                .dependencies
                .iter()
                .any(|(_, id, _)| !valid_connection_id(id))
            || self.origins.iter().any(|origin| {
                origin.len() > 4096
                    || url::Url::parse(origin).map_or(true, |url| {
                        url.scheme() != "https" || url.origin().ascii_serialization() != *origin
                    })
            })
            || self.policy.mode != RetentionMode::EncryptedDatabase
            || !self.policy.enabled()
            || self
                .cookies
                .iter()
                .map(SignInCookie::byte_len)
                .sum::<usize>()
                > MAX_COOKIE_BYTES
        {
            return Err(ERROR.into());
        }
        validate_cookies(&self.cookies, &self.origins, self.saved).map_err(|_| ERROR)?;
        let mut value = serde_json::to_value(self).map_err(|_| ERROR)?;
        value["revision"] = "".into();
        logical_projection(&mut value)?;
        let bytes = Zeroizing::new(serde_json::to_vec(&value).map_err(|_| ERROR)?);
        wipe(&mut value);
        if format!("{:x}", Sha256::digest(&*bytes)) != self.revision {
            return Err(ERROR.into());
        }
        Ok(())
    }
}

// These fields are authenticated by the managed envelope, but are local
// admission/activity metadata, not portable logical changes. In particular,
// importing into another DB/device must not cause an endless revision ping-pong.
fn logical_projection(value: &mut Value) -> Result<(), String> {
    let object = value.as_object_mut().ok_or(ERROR)?;
    for field in ["lastUsed", "connectionDigest", "dependencies", "origins"] {
        object.remove(field);
    }
    Ok(())
}

// serde_json::Value has no zeroizing Drop. Explicitly wipe native secret copies
// before removing their field or returning a renderer projection.
pub(crate) fn wipe(value: &mut Value) {
    use zeroize::Zeroize;
    match value {
        Value::String(text) => text.zeroize(),
        Value::Array(values) => values.iter_mut().for_each(wipe),
        Value::Object(values) => values.values_mut().for_each(wipe),
        _ => (),
    }
}

pub(crate) fn private(data: &Value) -> Result<PrivateSessions, String> {
    let Some(value) = data.get(PRIVATE) else {
        return Ok(PrivateSessions {
            version: 1,
            records: vec![],
        });
    };
    let bytes = Zeroizing::new(serde_json::to_vec(value).map_err(|_| ERROR)?);
    let records: PrivateSessions = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
    if records.version != 1 || records.records.len() > LIMIT {
        return Err(ERROR.into());
    }
    let mut ids = BTreeSet::new();
    let mut total = 0usize;
    for record in &records.records {
        record.validate()?;
        if !ids.insert(&record.connection_id) {
            return Err(ERROR.into());
        }
        total += record
            .cookies
            .iter()
            .map(SignInCookie::byte_len)
            .sum::<usize>();
    }
    if total > MAX_TOTAL_BYTES {
        return Err(ERROR.into());
    }
    Ok(records)
}

pub(crate) fn put_private(data: &mut Value, mut records: PrivateSessions) -> Result<(), String> {
    records
        .records
        .sort_by(|a, b| a.connection_id.cmp(&b.connection_id));
    let object = data.as_object_mut().ok_or(ERROR)?;
    if let Some(mut old) = object.remove(PRIVATE) {
        wipe(&mut old);
    }
    object.remove(PUBLIC);
    if !records.records.is_empty() {
        object.insert(
            PRIVATE.into(),
            serde_json::to_value(records).map_err(|_| ERROR)?,
        );
        private(data)?;
    }
    Ok(())
}

pub(crate) fn descriptor(data: &Value) -> Result<BrowserSessionsDescriptor, String> {
    let mut records: Vec<_> = private(data)?
        .records
        .iter()
        .map(NativeCookieRecord::descriptor)
        .collect();
    records.sort_by(|a, b| a.connection_id.cmp(&b.connection_id));
    Ok(BrowserSessionsDescriptor {
        version: 1,
        records,
    })
}

pub(crate) fn project(data: Value) -> Result<Value, String> {
    let mut data = SecretData(data);
    let description = descriptor(&data.0)?;
    let object = data.0.as_object_mut().ok_or(ERROR)?;
    if let Some(mut secrets) = object.remove(PRIVATE) {
        wipe(&mut secrets);
    }
    object.remove(PUBLIC);
    if !description.records.is_empty() {
        object.insert(
            PUBLIC.into(),
            serde_json::to_value(description).map_err(|_| ERROR)?,
        );
    }
    Ok(std::mem::take(&mut data.0))
}

fn ordinary(mut data: Value) -> Result<Value, String> {
    if data.get(PRIVATE).is_some() {
        return Err(ERROR.into());
    }
    if let Some(description) = data.as_object_mut().ok_or(ERROR)?.remove(PUBLIC) {
        let description: BrowserSessionsDescriptor =
            serde_json::from_value(description).map_err(|_| ERROR)?;
        validate_descriptor(&description)?;
    }
    Ok(data)
}

pub(crate) fn merge_renderer(
    current: &Value,
    proposed: Value,
    expected: Option<Value>,
) -> Result<Value, String> {
    let baseline = expected.ok_or("database baseline is required; reload before saving")?;
    // Generic writes cannot inject or edit even the public native descriptors.
    if proposed.get(PUBLIC) != baseline.get(PUBLIC) {
        return Err(ERROR.into());
    }
    let projected = ordinary(project(current.clone())?)?;
    if projected != ordinary(baseline)? {
        return Err("database baseline changed; reload before saving".into());
    }
    let mut result = ordinary(proposed)?;
    let mut records = private(current)?;
    records
        .records
        .retain(|record| record_matches(&result, record).unwrap_or(false));
    put_private(&mut result, records)?;
    Ok(result)
}

pub(crate) fn record_matches(data: &Value, record: &NativeCookieRecord) -> Result<bool, String> {
    let connection = native_browser_owner::select_connection(data, &record.connection_id)?;
    if retention_connection_digest(connection)? != record.connection_digest {
        return Ok(false);
    }
    for (vault, id, expected) in &record.dependencies {
        if native_browser_owner::digest(native_browser_owner::select_dependency(data, *vault, id)?)?
            != *expected
        {
            return Ok(false);
        }
    }
    // App-wide defaults are NOT StorageData.settings. Explicit saved
    // connection overrides are checked here; runtime/import also validates
    // the native app-settings layer before using cookies.
    if connection
        .pointer("/browserSession/sessionRetention")
        .is_some()
    {
        let prefs = crate::origin_browser_authority::NativeBrowserPreferences::from_saved(
            connection,
            &Value::Null,
        )
        .map_err(|_| ERROR)?;
        let policy: RetentionPolicy = serde_json::from_value(prefs.retention).map_err(|_| ERROR)?;
        return Ok(policy == record.policy
            && policy.enabled()
            && policy.mode == RetentionMode::EncryptedDatabase);
    }
    Ok(true)
}

// This switch revokes live browser authority but is not a request to delete an
// encrypted sign-in record. Keep the runtime lease's stricter digest unchanged.
fn remove_cookie_switch(connection: &mut Value) {
    if let Some(session) = connection
        .get_mut("browserSession")
        .and_then(Value::as_object_mut)
    {
        session.remove("cookiesEnabled");
        if session.len() == 1 && session.get("version") == Some(&Value::from(1)) {
            connection.as_object_mut().unwrap().remove("browserSession");
        }
    }
}

pub(crate) fn retention_connection_digest(connection: &Value) -> Result<[u8; 32], String> {
    let mut value = SecretData(connection.clone());
    remove_cookie_switch(&mut value.0);
    native_browser_owner::connection_digest(&value.0)
}

/// Portable security projection v1. Only transformations performed by the
/// reviewed full-archive adapter are excluded. Credentials, route references,
/// trust policies and unknown fields remain bound. Local origin consent is
/// checked independently against the destination native authority.
pub(crate) fn portable_digest(
    value: &Value,
    vault: bool,
    database: &str,
) -> Result<[u8; 32], String> {
    fn sanitize(value: &mut Value, database: &str, path: &mut Vec<String>) {
        match value {
            Value::Array(rows) => {
                for row in rows {
                    sanitize(row, database, path)
                }
            }
            Value::Object(object) => {
                object.retain(|key, _| {
                    let normalized: String = key
                        .chars()
                        .filter(|c| c.is_ascii_alphanumeric())
                        .map(|c| c.to_ascii_lowercase())
                        .collect();
                    !matches!(
                        normalized.as_str(),
                        "synologyquickconnectdefaults"
                            | "backendsessionid"
                            | "shellid"
                            | "runtimesessionid"
                            | "detachedsessionid"
                            | "channelid"
                            | "terminalbuffer"
                            | "transcript"
                            | "transcripts"
                            | "replay"
                            | "replaybuffer"
                            | "outputsnapshot"
                            | "lastoutput"
                            | "commandhistory"
                            | "runtimestate"
                            | "backendstate"
                    )
                });
                for (key, child) in object {
                    let owner_reference = matches!(key.as_str(), "ownerDatabaseId" | "databaseId")
                        && path.first().is_some_and(|p| {
                            matches!(
                                p.as_str(),
                                "machineAssignment"
                                    | "sshQuickActions"
                                    | "httpAutomation"
                                    | "proxyChain"
                                    | "sshTunnel"
                                    | "tcpTunnel"
                                    | "rdpSettings"
                                    | "connectionChain"
                            )
                        });
                    if owner_reference && child.as_str() == Some(database) {
                        *child = Value::String("$owning-database".into());
                    }
                    path.push(key.clone());
                    sanitize(child, database, path);
                    path.pop();
                }
            }
            _ => (),
        }
    }
    let mut data = SecretData(value.clone());
    if vault {
        if let Some(facets) = data.0.get_mut("facets").and_then(Value::as_object_mut) {
            if let Some(mut trust) = facets.remove("deviceTrust") {
                wipe(&mut trust);
            }
        }
    } else {
        remove_cookie_switch(&mut data.0);
        let object = data.0.as_object_mut().ok_or(ERROR)?;
        object.remove("httpTrustedRedirectDestinations");
        object.remove("httpBookmarks");
        object.remove("updatedAt");
        if let Some(automation) = object
            .get_mut("httpAutomation")
            .and_then(Value::as_object_mut)
        {
            automation.remove("items");
        }
        if let Some(gateway) = data
            .0
            .pointer_mut("/rdpSettings/gateway")
            .and_then(Value::as_object_mut)
        {
            gateway.remove("accessToken");
        }
        sanitize(&mut data.0, database, &mut vec![]);
    }
    native_browser_owner::digest(&data.0)
}

fn rebind_portable(
    data: &Value,
    database: &str,
    record: &mut NativeCookieRecord,
) -> Result<(), String> {
    let connection = native_browser_owner::select_connection(data, &record.connection_id)?;
    if portable_digest(connection, false, database)? != record.portable_connection_digest {
        return Err(ERROR.into());
    }
    let mut dependencies = vec![];
    for (vault, id, expected) in &record.portable_dependencies {
        let value = native_browser_owner::select_dependency(data, *vault, id)?;
        if portable_digest(value, *vault, database)? != *expected {
            return Err(ERROR.into());
        }
        dependencies.push((*vault, id.clone(), native_browser_owner::digest(value)?));
    }
    if record.dependencies.len() != dependencies.len() {
        return Err(ERROR.into());
    }
    record.connection_digest = retention_connection_digest(connection)?;
    record.dependencies = dependencies;
    record.refresh_revision()?;
    Ok(())
}

pub(crate) fn validate_destination_scope(
    data: &Value,
    settings: &Value,
    record: &mut NativeCookieRecord,
) -> Result<(), String> {
    let connection = native_browser_owner::select_connection(data, &record.connection_id)?;
    let preferences =
        crate::origin_browser_authority::NativeBrowserPreferences::from_saved(connection, settings)
            .map_err(|_| ERROR)?;
    if !preferences.capabilities.cookies_enabled {
        return Err(ERROR.into());
    }
    let policy: RetentionPolicy =
        serde_json::from_value(preferences.retention).map_err(|_| ERROR)?;
    policy.validate().map_err(|_| ERROR)?;
    let (source, mut origins, grant) =
        crate::origin_browser_authority::saved_retention_network_scope(connection, settings)
            .map_err(|_| ERROR)?;
    if source != record.source_origin
        || policy != record.policy
        || !policy.enabled()
        || policy.mode != RetentionMode::EncryptedDatabase
    {
        return Err(ERROR.into());
    }
    // A source device's observed origins are not transferable consent. Recheck
    // every concrete origin with this destination's current network policy.
    validate_retention_origins(&record.origins, &source, &grant).map_err(|_| ERROR)?;
    origins.extend(record.origins.iter().cloned());
    origins.sort();
    origins.dedup();
    validate_retention_origins(&origins, &source, &grant).map_err(|_| ERROR)?;
    validate_cookies(&record.cookies, &origins, stamp()).map_err(|_| ERROR)?;
    record.origins = origins;
    Ok(())
}

fn validate_descriptor(value: &BrowserSessionsDescriptor) -> Result<(), String> {
    if value.version != 1 || value.records.len() > LIMIT {
        return Err(ERROR.into());
    }
    let mut ids = BTreeSet::new();
    for row in &value.records {
        if !valid_connection_id(&row.connection_id)
            || row.revision.len() != 64
            || !row.revision.bytes().all(|c| c.is_ascii_hexdigit())
            || !ids.insert(&row.connection_id)
        {
            return Err(ERROR.into());
        }
    }
    Ok(())
}

fn valid_connection_id(id: &str) -> bool {
    !id.trim().is_empty()
        && id.len() <= 256
        && !id.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        && !matches!(id, "__proto__" | "constructor" | "prototype")
}

fn selected_records(
    data: &Value,
    selected: &BrowserSessionsDescriptor,
) -> Result<PrivateSessions, String> {
    validate_descriptor(selected)?;
    let wanted: BTreeMap<_, _> = selected
        .records
        .iter()
        .map(|r| (r.connection_id.as_str(), r.revision.as_str()))
        .collect();
    let mut records = private(data)?;
    records
        .records
        .retain(|record| wanted.contains_key(record.connection_id.as_str()));
    if records.records.len() != wanted.len() {
        return Err(ERROR.into());
    }
    for record in &records.records {
        if wanted.get(record.connection_id.as_str()) != Some(&record.revision.as_str())
            || record.expired(stamp())
            || !record_matches(data, record)?
        {
            return Err(ERROR.into());
        }
    }
    Ok(records)
}

fn seal_transfer(
    source: &str,
    selected: BrowserSessionsDescriptor,
    records: PrivateSessions,
    deleted: Vec<String>,
    password: &str,
) -> Result<BrowserSessionsTransfer, String> {
    if !(12..=1024).contains(&password.len()) {
        return Err(ERROR.into());
    }
    let key = DatabaseKey::generate();
    let key_id = codec::random_id();
    let slot = codec::new_password_slot(
        TRANSFER_ID,
        &key_id,
        "Browser session transfer",
        password,
        None,
        &key,
    )?;
    let payload = SecretData(
        json!({ "connections": [], "purpose": "sign-in-cookie-transfer-v1",
        "sourceDatabaseId": source, "selected": selected, "deletedConnectionIds": deleted, PRIVATE: records }),
    );
    let envelope = DatabaseEnvelope::create(
        TRANSFER_ID,
        &key_id,
        &codec::random_id(),
        DataCipher::Aes256Gcm,
        vec![slot],
        &payload.0,
        &key,
    )?;
    Ok(BrowserSessionsTransfer {
        version: 1,
        ciphertext: envelope.value()?.as_str().ok_or(ERROR)?.into(),
    })
}

fn open_transfer(
    transfer: BrowserSessionsTransfer,
    selected: &BrowserSessionsDescriptor,
    deleted: &[String],
    password: &str,
) -> Result<PrivateSessions, String> {
    validate_descriptor(selected)?;
    if transfer.version != 1
        || transfer.ciphertext.len() > 48 * 1024 * 1024
        || !(12..=1024).contains(&password.len())
    {
        return Err(ERROR.into());
    }
    let envelope = DatabaseEnvelope::parse(&Value::String(transfer.ciphertext), TRANSFER_ID)
        .map_err(|_| ERROR)?;
    if envelope.slots.len() != 1 || envelope.slots[0].slot_type != SlotType::Password {
        return Err(ERROR.into());
    }
    let key = envelope
        .unlock_password(&envelope.slots[0].id, password)
        .map_err(|_| ERROR)?;
    let data = SecretData(envelope.open(&key).map_err(|_| ERROR)?);
    if data.0["purpose"] != "sign-in-cookie-transfer-v1"
        || data.0.as_object().ok_or(ERROR)?.len() != 6
        || data.0["selected"] != serde_json::to_value(selected).map_err(|_| ERROR)?
        || !data.0["sourceDatabaseId"].is_string()
        || data.0["deletedConnectionIds"] != serde_json::to_value(deleted).map_err(|_| ERROR)?
    {
        return Err(ERROR.into());
    }
    let records = private(&data.0)?;
    let actual: BTreeMap<_, _> = records
        .records
        .iter()
        .map(|r| (&r.connection_id, &r.revision))
        .collect();
    let wanted: BTreeMap<_, _> = selected
        .records
        .iter()
        .map(|r| (&r.connection_id, &r.revision))
        .collect();
    if actual != wanted {
        return Err(ERROR.into());
    }
    Ok(records)
}

fn import_records(
    data: &mut Value,
    expected: &BrowserSessionsDescriptor,
    selected: &BrowserSessionsDescriptor,
    deleted: &[String],
    mut incoming: PrivateSessions,
    destination_database: &str,
) -> Result<bool, String> {
    validate_descriptor(expected)?;
    validate_descriptor(selected)?;
    let mut selected_ids: BTreeSet<_> = selected
        .records
        .iter()
        .map(|r| r.connection_id.as_str())
        .collect();
    validate_deletions(deleted, selected)?;
    selected_ids.extend(deleted.iter().map(String::as_str));
    if expected
        .records
        .iter()
        .any(|r| !selected_ids.contains(r.connection_id.as_str()))
    {
        return Err(ERROR.into());
    }
    let mut records = private(data)?;
    let before = descriptor(data)?;
    for id in &selected_ids {
        let actual = records.records.iter().find(|r| r.connection_id == *id);
        let baseline = expected.records.iter().find(|r| r.connection_id == *id);
        if actual.map(|r| &r.revision) != baseline.map(|r| &r.revision) {
            return Err(ERROR.into());
        }
    }
    for record in &mut incoming.records {
        rebind_portable(data, destination_database, record)?;
        // Storing an authenticated capsule is not browser admission. Device-
        // local defaults/grants may differ; load checks them before delivery.
        let actual = records
            .records
            .iter()
            .find(|r| r.connection_id == record.connection_id);
        let baseline = expected
            .records
            .iter()
            .find(|r| r.connection_id == record.connection_id);
        if actual.map(|r| &r.revision) != baseline.map(|r| &r.revision)
            || !record_matches(data, record)?
        {
            return Err(ERROR.into());
        }
        if let Some(actual) = actual.filter(|r| r.revision == record.revision) {
            record.last_used = record.last_used.max(actual.last_used);
        }
    }
    // Old archives still restore their ordinary data. Expired sign-in records
    // are discarded, never resurrected and never allowed to block that restore.
    incoming.records.retain(|r| !r.expired(stamp()));
    records
        .records
        .retain(|r| !selected_ids.contains(r.connection_id.as_str()));
    records.records.extend(incoming.records);
    records
        .records
        .retain(|r| record_matches(data, r).unwrap_or(false));
    put_private(data, records)?;
    Ok(descriptor(data)? != before)
}

fn validate_deletions(
    deleted: &[String],
    selected: &BrowserSessionsDescriptor,
) -> Result<(), String> {
    if deleted.len() + selected.records.len() > LIMIT {
        return Err(ERROR.into());
    }
    let mut ids: BTreeSet<_> = selected
        .records
        .iter()
        .map(|r| r.connection_id.as_str())
        .collect();
    for id in deleted {
        if !valid_connection_id(id) || !ids.insert(id.as_str()) {
            return Err(ERROR.into());
        }
    }
    Ok(())
}

fn import_public(current: &Value, proposed: Value, expected: Value) -> Result<Value, String> {
    if ordinary(project(current.clone())?)? != ordinary(expected)? {
        return Err("database contents changed; reload before importing".into());
    }
    let mut result = ordinary(proposed)?;
    put_private(&mut result, private(current)?)?;
    Ok(result)
}

pub(crate) async fn commit_session_data(
    root: &Path,
    state: &EncryptionState,
    binding: SessionBinding<'_>,
    snapshot: &ManagedSnapshot,
    data: &Value,
) -> Result<SaveResult, String> {
    let SessionBinding {
        window,
        database: id,
        token: session,
        revision: expected_revision,
    } = binding;
    let profile = profile_binding(root)?;
    let access = scope(&profile, id, expected_revision, window, state);
    let key = session_key(session, &access)?;
    let mut envelope = DatabaseEnvelope::parse(&snapshot.data, id)?;
    envelope.replace_data(data, &key)?;
    let result = crate::database_files::managed_commit_guarded(
        root,
        state,
        id,
        expected_revision,
        &snapshot.data,
        &envelope.value()?,
        expected_revision,
        |commit| {
            let mut sessions = database_sessions::global().lock().map_err(|_| ERROR)?;
            sessions.key(session, &access)?;
            if access.generation != state.key_generation() {
                return Err(ERROR.into());
            }
            commit()
        },
    )
    .await?;
    Ok(SaveResult {
        committed: result.committed,
        cleanup_pending: result.cleanup_pending,
        warnings: result.warnings,
        security_revision: expected_revision.into(),
        browser_sessions_changed: false,
    })
}

#[tauri::command]
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri IPC boundary preserves the existing named transfer fields and injected state"
)]
pub async fn database_browser_sessions_export<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
    selected: BrowserSessionsDescriptor,
    deleted_connection_ids: Option<Vec<String>>,
    password: String,
) -> Result<BrowserSessionsTransfer, String> {
    let password = Zeroizing::new(password);
    let mut deleted = deleted_connection_ids.unwrap_or_default();
    deleted.sort();
    validate_deletions(&deleted, &selected)?;
    require_live_unlock_window(&window, &state)?;
    let root = native_root(&window, &state)?;
    let profile = profile_binding(&root)?;
    let records = {
        let _guard = lock_database_operation(&root.join("databases")).await?;
        let snapshot = managed_snapshot(&root, &state, &database_id).await?;
        if revision(&snapshot) != expected_security_revision {
            return Err(ERROR.into());
        }
        let key = session_key(
            &session_id,
            &scope(
                &profile,
                &database_id,
                &expected_security_revision,
                window.label(),
                &state,
            ),
        )?;
        let data = SecretData(DatabaseEnvelope::parse(&snapshot.data, &database_id)?.open(&key)?);
        if private(&data.0)?
            .records
            .iter()
            .any(|r| deleted.contains(&r.connection_id))
        {
            return Err(ERROR.into());
        }
        selected_records(&data.0, &selected)?
    };
    let source = database_id.clone();
    let selection = selected.clone();
    let expected_deletions = deleted.clone();
    let result = tokio::task::spawn_blocking(move || {
        seal_transfer(&source, selection, records, deleted, &password)
    })
    .await
    .map_err(|_| ERROR)??;
    require_live_unlock_window(&window, &state)?;
    if native_root(&window, &state)? != root {
        return Err(ERROR.into());
    }
    let _guard = lock_database_operation(&root.join("databases")).await?;
    let latest = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&latest) != expected_security_revision {
        return Err(ERROR.into());
    }
    let key = session_key(
        &session_id,
        &scope(
            &profile,
            &database_id,
            &expected_security_revision,
            window.label(),
            &state,
        ),
    )?;
    let data = SecretData(DatabaseEnvelope::parse(&latest.data, &database_id)?.open(&key)?);
    selected_records(&data.0, &selected)?;
    if private(&data.0)?
        .records
        .iter()
        .any(|r| expected_deletions.contains(&r.connection_id))
    {
        return Err(ERROR.into());
    }
    session_key(
        &session_id,
        &scope(
            &profile,
            &database_id,
            &expected_security_revision,
            window.label(),
            &state,
        ),
    )?;
    Ok(result)
}

#[tauri::command]
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri IPC boundary preserves the existing named transfer fields and injected state"
)]
pub async fn database_browser_sessions_import<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
    expected: BrowserSessionsDescriptor,
    selected: BrowserSessionsDescriptor,
    deleted_connection_ids: Option<Vec<String>>,
    data: Value,
    expected_data: Value,
    transfer: BrowserSessionsTransfer,
    password: String,
) -> Result<SaveResult, String> {
    let password = Zeroizing::new(password);
    let mut deleted = deleted_connection_ids.unwrap_or_default();
    deleted.sort();
    validate_deletions(&deleted, &selected)?;
    require_live_unlock_window(&window, &state)?;
    let root = native_root(&window, &state)?;
    let selection = selected.clone();
    let deletions = deleted.clone();
    let records = tokio::task::spawn_blocking(move || {
        open_transfer(transfer, &selection, &deletions, &password)
    })
    .await
    .map_err(|_| ERROR)??;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    require_live_unlock_window(&window, &state)?;
    if native_root(&window, &state)? != root {
        return Err(ERROR.into());
    }
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err(ERROR.into());
    }
    let profile = profile_binding(&root)?;
    let key = session_key(
        &session_id,
        &scope(
            &profile,
            &database_id,
            &expected_security_revision,
            window.label(),
            &state,
        ),
    )?;
    let current = SecretData(DatabaseEnvelope::parse(&snapshot.data, &database_id)?.open(&key)?);
    let mut data = SecretData(import_public(&current.0, data, expected_data)?);
    import_records(
        &mut data.0,
        &expected,
        &selected,
        &deleted,
        records,
        &database_id,
    )?;
    if data.0 == current.0 {
        return Ok(SaveResult {
            committed: true,
            cleanup_pending: false,
            warnings: vec![],
            security_revision: expected_security_revision,
            browser_sessions_changed: false,
        });
    }
    let logical_changed = descriptor(&current.0)? != descriptor(&data.0)?;
    let result = commit_session_data(
        &root,
        &state,
        SessionBinding {
            window: window.label(),
            database: &database_id,
            token: &session_id,
            revision: &expected_security_revision,
        },
        &snapshot,
        &data.0,
    )
    .await?;
    if result.committed && logical_changed {
        let _ = window.app_handle().emit(
            "database-protection:browser-sessions-changed",
            json!({"databaseId":database_id}),
        );
    }
    Ok(result)
}

#[tauri::command]
pub async fn database_browser_sessions_describe<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
) -> Result<BrowserSessionsDescriptor, String> {
    require_live_unlock_window(&window, &state)?;
    let root = native_root(&window, &state)?;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    if root != native_root(&window, &state)? {
        return Err(ERROR.into());
    }
    let profile = profile_binding(&root)?;
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err(ERROR.into());
    }
    let access = scope(
        &profile,
        &database_id,
        &expected_security_revision,
        window.label(),
        &state,
    );
    let key = session_key(&session_id, &access)?;
    let data = SecretData(DatabaseEnvelope::parse(&snapshot.data, &database_id)?.open(&key)?);
    let result = descriptor(&data.0)?;
    require_live_unlock_window(&window, &state)?;
    session_key(&session_id, &access)?;
    Ok(result)
}

#[cfg(test)]
#[path = "database_browser_sessions_tests.rs"]
mod tests;
