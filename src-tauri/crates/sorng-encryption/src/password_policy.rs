//! Policy for newly chosen local protection passwords. Never used by unlock/import.
use crate::{artifacts::settings, ArtifactKind, EncryptionState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordPolicy {
    pub version: u8,
    pub enabled: bool,
    pub min_length: usize,
    pub require_uppercase: bool,
    pub require_lowercase: bool,
    pub require_digit: bool,
    pub require_symbol: bool,
}
impl Default for PasswordPolicy {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            min_length: 12,
            require_uppercase: false,
            require_lowercase: false,
            require_digit: false,
            require_symbol: false,
        }
    }
}
pub fn parse(value: Option<&Value>) -> Result<PasswordPolicy, String> {
    let policy: PasswordPolicy = match value {
        None => PasswordPolicy::default(),
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|_| "Password policy is invalid; review Security settings.")?,
    };
    if policy.version != 1 || !(4..=128).contains(&policy.min_length) {
        return Err("Password policy is invalid; review Security settings.".into());
    }
    Ok(policy)
}
pub fn validate(password: &str, policy: &PasswordPolicy, purpose: &str) -> Result<(), String> {
    let floor = match purpose {
        "database" => 4,
        "application" | "portable-export" | "generator" => 8,
        "export" => 0,
        _ => return Err("Unknown local password purpose.".into()),
    };
    let minimum = floor.max(if policy.enabled { policy.min_length } else { 0 });
    if password.chars().count() < minimum {
        return Err(format!("Use at least {minimum} characters."));
    }
    if !policy.enabled {
        return Ok(());
    }
    for (required, present, label) in [
        (
            policy.require_uppercase,
            password.bytes().any(|b| b.is_ascii_uppercase()),
            "an uppercase letter (A-Z)",
        ),
        (
            policy.require_lowercase,
            password.bytes().any(|b| b.is_ascii_lowercase()),
            "a lowercase letter (a-z)",
        ),
        (
            policy.require_digit,
            password.bytes().any(|b| b.is_ascii_digit()),
            "a digit (0-9)",
        ),
        (
            policy.require_symbol,
            password.bytes().any(|b| b.is_ascii_punctuation()),
            "an ASCII punctuation symbol",
        ),
    ] {
        if required && !present {
            return Err(format!("Include {label}."));
        }
    }
    Ok(())
}
/// Caller holds settings_coordinator. Encrypted canonical settings never fall back.
pub async fn read_locked(dir: &Path, state: &EncryptionState) -> Result<PasswordPolicy, String> {
    let encrypted = dir.join(settings::SETTINGS_ENC_FILENAME);
    let plain = dir.join("settings.json");
    let require_encrypted = state.resolve_write_policy(ArtifactKind::Settings, false)?;
    let document = if encrypted.exists() {
        let bytes = read_bounded(&encrypted)?;
        settings::read(state, &bytes)
            .await
            .map_err(|_| "Unlock storage before validating a new password.")?
            .ok_or("Saved settings are empty; repair settings before choosing a new password.")?
    } else if plain.exists() {
        if require_encrypted {
            return Err("Saved settings conflict with the encryption policy.".into());
        }
        serde_json::from_slice(&read_bounded(&plain)?).map_err(|_| "Saved settings are invalid.")?
    } else {
        serde_json::json!({})
    };
    if !document.is_object() {
        return Err("Saved settings are invalid.".into());
    }
    parse(document.get("passwordPolicy"))
}
fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    const MAX: u64 = 32 * 1024 * 1024;
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| "Saved settings could not be read.")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX {
        return Err("Saved settings are not a bounded regular file.".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "Saved settings could not be read.")?;
    if bytes.len() as u64 > MAX {
        return Err("Saved settings exceed the size limit.".into());
    }
    Ok(bytes)
}
pub async fn validate_saved_locked(
    dir: &Path,
    state: &EncryptionState,
    password: &str,
    purpose: &str,
) -> Result<(), String> {
    validate(password, &read_locked(dir, state).await?, purpose)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_policy_preserves_floors_and_uses_unicode_length() {
        let policy = parse(None).unwrap();
        assert!(!policy.enabled);
        assert!(validate("abc", &policy, "database").is_err());
        assert!(validate("😀😀😀😀", &policy, "database").is_ok());
        assert!(validate("1234567", &policy, "application").is_err());
        assert!(validate("12345678", &policy, "export").is_ok());
        assert!(validate("short", &policy, "export").is_ok());
        assert!(validate("1234567", &policy, "portable-export").is_err());
        assert!(validate("12345678", &policy, "unknown").is_err());
    }
    #[test]
    fn composition_and_malformed_policy_fail_closed_without_echoing_secrets() {
        let policy = PasswordPolicy {
            enabled: true,
            min_length: 12,
            require_uppercase: true,
            require_lowercase: true,
            require_digit: true,
            require_symbol: true,
            ..Default::default()
        };
        assert!(validate("Compliant123!", &policy, "database").is_ok());
        for password in [
            "compliant123!",
            "COMPLIANT123!",
            "CompliantABC!",
            "Compliant1234",
        ] {
            let error = validate(password, &policy, "database").unwrap_err();
            assert!(!error.contains(password));
        }
        assert!(parse(Some(&serde_json::json!({"enabled":false}))).is_err());
        let mut value = serde_json::to_value(policy).unwrap();
        value["minLength"] = 129.into();
        assert!(parse(Some(&value)).is_err());
    }
    #[tokio::test]
    async fn persisted_plain_policy_is_authoritative_and_malformed_is_not_defaulted() {
        let dir = tempfile::tempdir().unwrap();
        let state = EncryptionState::default();
        assert!(!read_locked(dir.path(), &state).await.unwrap().enabled);
        let policy = PasswordPolicy {
            enabled: true,
            min_length: 16,
            ..Default::default()
        };
        std::fs::write(
            dir.path().join("settings.json"),
            serde_json::to_vec(&serde_json::json!({"passwordPolicy":policy})).unwrap(),
        )
        .unwrap();
        assert!(
            validate_saved_locked(dir.path(), &state, "12345678", "export")
                .await
                .is_err()
        );
        std::fs::write(dir.path().join("settings.json"), b"broken").unwrap();
        assert!(read_locked(dir.path(), &state).await.is_err());
    }
    #[tokio::test]
    async fn encrypted_policy_roundtrips_and_locked_never_falls_back_to_plain() {
        use crate::{Argon2Params, MasterDek, MasterKeyStorage};
        let dir = tempfile::tempdir().unwrap();
        let state = EncryptionState::default();
        state.install(MasterDek::generate()).await;
        let policy = PasswordPolicy {
            enabled: true,
            min_length: 20,
            ..Default::default()
        };
        let bytes = settings::write(
            &state,
            &serde_json::json!({"passwordPolicy":policy}),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0; 16],
        )
        .await
        .unwrap();
        std::fs::write(dir.path().join(settings::SETTINGS_ENC_FILENAME), bytes).unwrap();
        std::fs::write(dir.path().join("settings.json"), b"{}").unwrap();
        assert_eq!(
            read_locked(dir.path(), &state).await.unwrap().min_length,
            20
        );
        state.lock().await;
        assert!(read_locked(dir.path(), &state).await.is_err());
    }
}
