use crate::error::CredentialError;
use crate::types::{
    CredentialAlert, CredentialAuditEntry, CredentialGroup, CredentialRecord, CredentialsConfig,
    RotationPolicy,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

pub(crate) const STATE_DIRECTORY: &str = "credentials";
pub(crate) const STATE_FILENAME: &str = "tracker-state-v1.json";
pub(crate) const AUDIT_CAPACITY: usize = 10_000;

const SCHEMA_VERSION: u32 = 1;
const MAX_STATE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_CREDENTIALS: usize = 100_000;
const MAX_POLICIES: usize = 10_000;
const MAX_GROUPS: usize = 20_000;
const MAX_ALERTS: usize = 100_000;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_METADATA_ENTRIES: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PersistedCredentialState {
    pub schema_version: u32,
    pub credentials: HashMap<String, CredentialRecord>,
    pub policies: HashMap<String, RotationPolicy>,
    pub groups: HashMap<String, CredentialGroup>,
    pub alerts: Vec<CredentialAlert>,
    pub audit_entries: Vec<CredentialAuditEntry>,
    pub config: CredentialsConfig,
}

impl PersistedCredentialState {
    pub(crate) fn new(
        credentials: HashMap<String, CredentialRecord>,
        policies: HashMap<String, RotationPolicy>,
        groups: HashMap<String, CredentialGroup>,
        alerts: Vec<CredentialAlert>,
        audit_entries: Vec<CredentialAuditEntry>,
        config: CredentialsConfig,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            credentials,
            policies,
            groups,
            alerts,
            audit_entries,
            config,
        }
    }
}

pub(crate) fn load(path: &Path) -> Result<Option<PersistedCredentialState>, CredentialError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CredentialError::Persistence(
            "credential state path is not a regular file".to_string(),
        ));
    }
    if metadata.len() > MAX_STATE_BYTES {
        return Err(CredentialError::Validation(format!(
            "credential state exceeds the {} byte safety limit",
            MAX_STATE_BYTES
        )));
    }

    let bytes = fs::read(path)?;
    let state: PersistedCredentialState = serde_json::from_slice(&bytes)?;
    validate(&state)?;
    Ok(Some(state))
}

pub(crate) fn store(path: &Path, state: &PersistedCredentialState) -> Result<(), CredentialError> {
    validate(state)?;
    let bytes = serde_json::to_vec_pretty(state)?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err(CredentialError::Validation(format!(
            "credential state exceeds the {} byte safety limit",
            MAX_STATE_BYTES
        )));
    }

    let parent = path.parent().ok_or_else(|| {
        CredentialError::Persistence("credential state path has no parent directory".to_string())
    })?;
    fs::create_dir_all(parent)?;

    let mut temporary = tempfile::Builder::new()
        .prefix(".tracker-state-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(CredentialError::from)?;
    temporary.write_all(&bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| CredentialError::Persistence(error.error.to_string()))?;
    Ok(())
}

fn validate(state: &PersistedCredentialState) -> Result<(), CredentialError> {
    if state.schema_version != SCHEMA_VERSION {
        return Err(CredentialError::Validation(format!(
            "unsupported credential state schema version {}",
            state.schema_version
        )));
    }
    validate_count("credentials", state.credentials.len(), MAX_CREDENTIALS)?;
    validate_count("policies", state.policies.len(), MAX_POLICIES)?;
    validate_count("groups", state.groups.len(), MAX_GROUPS)?;
    validate_count("alerts", state.alerts.len(), MAX_ALERTS)?;
    validate_count("audit entries", state.audit_entries.len(), AUDIT_CAPACITY)?;
    if state.config.check_interval_seconds == 0 || state.config.check_interval_seconds > 31_536_000
    {
        return Err(CredentialError::Validation(
            "credential check interval is outside the supported range".to_string(),
        ));
    }
    if state.config.default_max_age_days > 36_500 || state.config.default_warn_before_days > 36_500
    {
        return Err(CredentialError::Validation(
            "credential age configuration is outside the supported range".to_string(),
        ));
    }

    for (id, record) in &state.credentials {
        validate_identity("credential", id, &record.id)?;
        validate_text("credential connection id", &record.connection_id)?;
        validate_text("credential label", &record.label)?;
        if let Some(username) = &record.username {
            validate_text("credential username", username)?;
        }
        validate_text("credential notes", &record.notes)?;
        if record.fingerprint.len() != 64
            || !record
                .fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(CredentialError::Validation(format!(
                "credential {id} has an invalid SHA-256 fingerprint"
            )));
        }
        validate_count(
            "credential metadata entries",
            record.metadata.len(),
            MAX_METADATA_ENTRIES,
        )?;
        for (key, value) in &record.metadata {
            validate_text("credential metadata key", key)?;
            validate_text("credential metadata value", value)?;
            if is_secret_field_name(key) {
                return Err(CredentialError::Validation(format!(
                    "credential {id} metadata contains a secret-bearing field"
                )));
            }
        }
    }

    for (id, policy) in &state.policies {
        validate_identity("policy", id, &policy.id)?;
        validate_text("policy name", &policy.name)?;
        if policy.max_age_days > 36_500 || policy.warn_before_days > 36_500 {
            return Err(CredentialError::Validation(format!(
                "policy {id} contains an unsupported age limit"
            )));
        }
    }

    for (id, group) in &state.groups {
        validate_identity("group", id, &group.id)?;
        validate_text("group name", &group.name)?;
        validate_text("group description", &group.description)?;
        validate_count(
            "group credential references",
            group.credential_ids.len(),
            MAX_CREDENTIALS,
        )?;
    }

    for alert in &state.alerts {
        validate_nonempty_id("alert", &alert.id)?;
        validate_nonempty_id("alert credential", &alert.credential_id)?;
        validate_nonempty_id("alert connection", &alert.connection_id)?;
        validate_text("alert message", &alert.message)?;
    }
    for entry in &state.audit_entries {
        validate_nonempty_id("audit entry", &entry.id)?;
        validate_nonempty_id("audit credential", &entry.credential_id)?;
        validate_text("audit details", &entry.details)?;
        validate_text("audit user", &entry.user)?;
    }

    Ok(())
}

fn validate_count(label: &str, actual: usize, maximum: usize) -> Result<(), CredentialError> {
    if actual > maximum {
        return Err(CredentialError::Validation(format!(
            "{label} count {actual} exceeds the safety limit {maximum}"
        )));
    }
    Ok(())
}

fn validate_identity(kind: &str, key: &str, id: &str) -> Result<(), CredentialError> {
    validate_nonempty_id(kind, id)?;
    if key != id {
        return Err(CredentialError::Validation(format!(
            "{kind} map key does not match its record id"
        )));
    }
    Ok(())
}

fn validate_nonempty_id(kind: &str, id: &str) -> Result<(), CredentialError> {
    if id.trim().is_empty() || id.len() > 512 {
        return Err(CredentialError::Validation(format!(
            "{kind} id is empty or too long"
        )));
    }
    Ok(())
}

fn validate_text(label: &str, value: &str) -> Result<(), CredentialError> {
    if value.len() > MAX_TEXT_BYTES {
        return Err(CredentialError::Validation(format!(
            "{label} exceeds the text safety limit"
        )));
    }
    if contains_secret_material(value) {
        return Err(CredentialError::Validation(format!(
            "{label} appears to contain secret material"
        )));
    }
    Ok(())
}

fn is_secret_field_name(value: &str) -> bool {
    let normalized: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    [
        "password",
        "passphrase",
        "privatekey",
        "presharedkey",
        "secret",
        "token",
        "apikey",
        "authkey",
        "cookie",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn contains_secret_material(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [
        "-----begin openssh private key-----",
        "-----begin rsa private key-----",
        "-----begin ec private key-----",
        "-----begin private key-----",
        "putty-user-key-file-",
        "privatekey =",
        "private_key =",
        "presharedkey =",
        "preshared_key =",
        "authorization: bearer ",
        "\"password\":",
        "\"passphrase\":",
        "\"client_secret\":",
        "tskey-auth-",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}
