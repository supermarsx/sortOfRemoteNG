//! # opkssh Provider Configuration
//!
//! Manage the local `~/.opk/config.yml` and environment variable-based
//! provider configuration.
//!
//! These helpers intentionally mirror the current YAML semantics. If
//! `client_secret` is present, it remains plaintext on disk.

use crate::types::*;
use log::{info, warn};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const DEFAULT_CLIENT_CONFIG_YAML: &str =
    "# sortOfRemoteNG mirrors the current ~/.opk/config.yml format.\n# If client_secret is set, it remains plaintext on disk.\n";

/// Well-known providers with their default issuer URIs and client IDs.
pub fn well_known_providers() -> Vec<CustomProvider> {
    vec![
        CustomProvider {
            alias: "google".into(),
            issuer: "https://accounts.google.com".into(),
            client_id: "206584157355-7cbe4s640tvm7naoludob4ut1emii7sf.apps.googleusercontent.com"
                .into(),
            client_secret: None,
            client_secret_present: false,
            client_secret_redacted: false,
            scopes: None,
        },
        CustomProvider {
            alias: "microsoft".into(),
            issuer:
                "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0"
                    .into(),
            client_id: "096ce0a3-5e72-4da8-9c86-12924b294a01".into(),
            client_secret: None,
            client_secret_present: false,
            client_secret_redacted: false,
            scopes: None,
        },
        CustomProvider {
            alias: "gitlab".into(),
            issuer: "https://gitlab.com".into(),
            client_id: "8d8b7024572c7fd501f64374dec6bba37096783dfcd792b3988104be08cb6923"
                .into(),
            client_secret: None,
            client_secret_present: false,
            client_secret_redacted: false,
            scopes: None,
        },
    ]
}

/// Get the config directory path.
pub fn config_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".opk"))
}

/// Get the config file path.
pub fn config_path() -> Option<PathBuf> {
    config_dir().map(|dir| dir.join("config.yml"))
}

/// Return the embedded default client-config bytes.
pub fn default_client_config_bytes() -> Vec<u8> {
    DEFAULT_CLIENT_CONFIG_YAML.as_bytes().to_vec()
}

/// Parse the embedded default client configuration.
pub fn load_default_client_config() -> Result<OpksshClientConfig, String> {
    let resolved_path = resolve_client_config_path(None)?;
    load_default_client_config_at(&resolved_path)
}

/// Parse client YAML into the typed client-config shape.
pub fn new_client_config(
    config_bytes: &[u8],
    explicit_path: Option<&str>,
) -> Result<OpksshClientConfig, String> {
    let resolved_path = resolve_client_config_path(explicit_path)?;
    let content = std::str::from_utf8(config_bytes)
        .map_err(|error| format!("Client config must be UTF-8: {error}"))?;
    let (providers, default_provider) = parse_config_yaml(content);

    warn_if_plaintext_client_secrets(&providers);

    let mut config = OpksshClientConfig {
        config_path: resolved_path.to_string_lossy().to_string(),
        default_provider,
        providers,
        provider_secrets_present: false,
        secrets_redacted_for_transport: false,
        secret_storage_note: None,
    };
    config.normalize_secret_metadata();

    Ok(config)
}

/// Resolve the on-disk client-config path.
pub fn resolve_client_config_path(explicit_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = explicit_path.map(str::trim).filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }

    config_path().ok_or_else(|| "Cannot determine opkssh client config path".to_string())
}

/// Load the typed client config from disk.
pub async fn load_client_config(
    explicit_path: Option<&str>,
) -> Result<OpksshClientConfig, String> {
    let path = resolve_client_config_path(explicit_path)?;
    let bytes = tokio::fs::read(&path).await.map_err(|error| {
        format!(
            "Failed to read opkssh client config {}: {}",
            path.display(),
            error
        )
    })?;
    let path_str = path.to_string_lossy().to_string();
    new_client_config(&bytes, Some(&path_str))
}

/// Create the default client config on disk and return the parsed result.
pub async fn create_default_client_config(
    explicit_path: Option<&str>,
) -> Result<OpksshClientConfig, String> {
    let path = resolve_client_config_path(explicit_path)?;

    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|error| format!("Failed to create config directory: {error}"))?;
    }

    let bytes = default_client_config_bytes();
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|error| format!("Failed to create default config: {error}"))?;

    load_default_client_config_at(&path)
}

/// Redact provider secrets before returning client config across the app
/// transport boundary.
pub fn redact_client_config_for_transport(config: &OpksshClientConfig) -> OpksshClientConfig {
    config.redacted_for_transport()
}

/// Validate provider aliases and return the lookup map used by login flows.
pub fn create_providers_map(
    providers: &[CustomProvider],
) -> Result<HashMap<String, CustomProvider>, String> {
    let mut by_alias = HashMap::with_capacity(providers.len());

    for provider in providers {
        let alias = provider.alias.trim();
        if alias.is_empty() {
            return Err("Provider alias is required when writing ~/.opk/config.yml".to_string());
        }

        let key = alias.to_ascii_lowercase();
        if by_alias.contains_key(&key) {
            return Err(format!("Duplicate opkssh provider alias: {}", provider.alias));
        }

        by_alias.insert(key, provider.clone());
    }

    Ok(by_alias)
}

/// Read the local opkssh client configuration.
pub async fn read_client_config() -> OpksshClientConfig {
    let resolved_path = match resolve_client_config_path(None) {
        Ok(path) => path,
        Err(_) => {
            return OpksshClientConfig {
                config_path: String::new(),
                default_provider: None,
                providers: Vec::new(),
                provider_secrets_present: false,
                secrets_redacted_for_transport: false,
                secret_storage_note: None,
            }
        }
    };

    let mut config = if resolved_path.exists() {
        let path_str = resolved_path.to_string_lossy().to_string();
        load_client_config(Some(&path_str))
            .await
            .unwrap_or_else(|_| empty_client_config(&resolved_path))
    } else {
        empty_client_config(&resolved_path)
    };

    apply_env_provider_overrides(&mut config);
    config
}

/// Parse the config.yml content (simple YAML-like parsing).
/// The opkssh config.yml format is not formally documented; we parse
/// provider blocks of the form:
/// ```yaml
/// providers:
///   - alias: google
///     issuer: https://accounts.google.com
///     client_id: abc123
/// default: google
/// ```
fn parse_config_yaml(content: &str) -> (Vec<CustomProvider>, Option<String>) {
    let mut providers = Vec::new();
    let mut default_provider = None;
    let mut in_providers = false;
    let mut current: Option<HashMap<String, String>> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed == "providers:" {
            in_providers = true;
            continue;
        }

        if trimmed.starts_with("default:") {
            default_provider = Some(trimmed.trim_start_matches("default:").trim().to_string());
            in_providers = false;
            continue;
        }

        if in_providers {
            if trimmed.starts_with("- ") {
                if let Some(map) = current.take() {
                    if let Some(provider) = map_to_provider(&map) {
                        providers.push(provider);
                    }
                }

                current = Some(HashMap::new());
                let after_dash = trimmed.trim_start_matches("- ");
                if let Some((key, value)) = parse_yaml_kv(after_dash) {
                    if let Some(ref mut map) = current {
                        map.insert(key, value);
                    }
                }
            } else if trimmed.contains(':') {
                if let Some((key, value)) = parse_yaml_kv(trimmed) {
                    if let Some(ref mut map) = current {
                        map.insert(key, value);
                    }
                }
            } else {
                in_providers = false;
            }
        }
    }

    if let Some(map) = current.take() {
        if let Some(provider) = map_to_provider(&map) {
            providers.push(provider);
        }
    }

    (providers, default_provider)
}

fn parse_yaml_kv(line: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = line.splitn(2, ':').collect();
    if parts.len() == 2 {
        let key = parts[0].trim().to_string();
        let value = parts[1]
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        if !key.is_empty() {
            return Some((key, value));
        }
    }
    None
}

fn map_to_provider(map: &HashMap<String, String>) -> Option<CustomProvider> {
    let alias = map.get("alias").cloned().unwrap_or_default();
    let issuer = map.get("issuer").cloned().unwrap_or_default();
    if alias.is_empty() && issuer.is_empty() {
        return None;
    }

    let client_secret = map.get("client_secret").cloned();
    let client_secret_present = client_secret
        .as_deref()
        .is_some_and(|secret| !secret.is_empty());

    Some(CustomProvider {
        alias,
        issuer,
        client_id: map.get("client_id").cloned().unwrap_or_default(),
        client_secret,
        client_secret_present,
        client_secret_redacted: false,
        scopes: map.get("scopes").cloned(),
    })
}

/// Parse the OPKSSH_PROVIDERS environment variable.
/// Format: `alias,issuer,client_id,client_secret,scope;alias2,...`
fn parse_env_providers(env: &str) -> Vec<CustomProvider> {
    let mut providers = Vec::new();

    for entry in env.split(';').filter(|entry| !entry.trim().is_empty()) {
        let parts: Vec<&str> = entry.split(',').collect();
        if parts.len() >= 2 {
            let client_secret = parts.get(3).and_then(|secret| {
                let secret = secret.trim();
                if secret.is_empty() {
                    None
                } else {
                    Some(secret.to_string())
                }
            });
            let client_secret_present = client_secret
                .as_deref()
                .is_some_and(|secret| !secret.is_empty());
            providers.push(CustomProvider {
                alias: parts.first().unwrap_or(&"").trim().to_string(),
                issuer: parts.get(1).unwrap_or(&"").trim().to_string(),
                client_id: parts.get(2).unwrap_or(&"").trim().to_string(),
                client_secret,
                client_secret_present,
                client_secret_redacted: false,
                scopes: parts.get(4).and_then(|scopes| {
                    let scopes = scopes.trim();
                    if scopes.is_empty() {
                        None
                    } else {
                        Some(scopes.to_string())
                    }
                }),
            });
        }
    }

    providers
}

/// Write an updated client config to `~/.opk/config.yml`.
pub async fn write_client_config(config: &OpksshClientConfig) -> Result<OpksshClientConfig, String> {
    create_providers_map(&config.providers)?;

    let path = resolve_client_config_path(Some(&config.config_path))?;
    let existing = load_existing_client_config(&path).await;
    reject_new_plaintext_client_secrets(config, existing.as_ref())?;

    let mut persisted = config.clone();
    persisted.config_path = path.to_string_lossy().to_string();
    preserve_existing_client_secrets(&mut persisted, existing.as_ref());
    warn_if_plaintext_client_secrets(&persisted.providers);

    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|error| format!("Failed to create config directory: {error}"))?;
    }

    let yaml = render_client_config_yaml(&persisted);
    tokio::fs::write(&path, yaml)
        .await
        .map_err(|error| format!("Failed to write config: {error}"))?;

    info!("Wrote opkssh client config to {:?}", path);
    Ok(persisted)
}

/// Build the OPKSSH_PROVIDERS environment variable string from config.
pub fn build_env_providers_string(providers: &[CustomProvider]) -> String {
    providers
        .iter()
        .map(|provider| {
            let mut parts = vec![
                provider.alias.clone(),
                provider.issuer.clone(),
                provider.client_id.clone(),
            ];
            parts.push(provider.client_secret.clone().unwrap_or_default());
            parts.push(provider.scopes.clone().unwrap_or_default());
            parts.join(",")
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn load_default_client_config_at(path: &Path) -> Result<OpksshClientConfig, String> {
    let path_str = path.to_string_lossy().to_string();
    new_client_config(&default_client_config_bytes(), Some(&path_str))
}

async fn load_existing_client_config(path: &Path) -> Option<OpksshClientConfig> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let path_str = path.to_string_lossy().to_string();
    new_client_config(&bytes, Some(&path_str)).ok()
}

fn empty_client_config(path: &Path) -> OpksshClientConfig {
    load_default_client_config_at(path).unwrap_or_else(|_| OpksshClientConfig {
        config_path: path.to_string_lossy().to_string(),
        default_provider: None,
        providers: Vec::new(),
        provider_secrets_present: false,
        secrets_redacted_for_transport: false,
        secret_storage_note: None,
    })
}

fn existing_secret_by_alias<'a>(
    existing: Option<&'a OpksshClientConfig>,
) -> HashMap<String, &'a CustomProvider> {
    let mut existing_by_alias = HashMap::new();

    let Some(existing) = existing else {
        return existing_by_alias;
    };

    for provider in &existing.providers {
        let alias = provider.alias.trim();
        if !alias.is_empty() && provider.has_client_secret() {
            existing_by_alias.insert(alias.to_ascii_lowercase(), provider);
        }
    }

    existing_by_alias
}

fn provider_display_name(provider: &CustomProvider) -> String {
    let alias = provider.alias.trim();
    if !alias.is_empty() {
        return alias.to_string();
    }

    let issuer = provider.issuer.trim();
    if !issuer.is_empty() {
        return issuer.to_string();
    }

    "<unnamed provider>".to_string()
}

fn reject_new_plaintext_client_secrets(
    requested: &OpksshClientConfig,
    existing: Option<&OpksshClientConfig>,
) -> Result<(), String> {
    let existing_by_alias = existing_secret_by_alias(existing);
    let mut blocked = Vec::new();

    for provider in &requested.providers {
        let Some(secret) = provider
            .client_secret
            .as_deref()
            .filter(|secret| !secret.is_empty())
        else {
            continue;
        };

        let alias_key = provider.alias.trim().to_ascii_lowercase();
        let matches_existing_secret = existing_by_alias
            .get(&alias_key)
            .and_then(|existing_provider| existing_provider.client_secret.as_deref())
            .is_some_and(|existing_secret| existing_secret == secret);

        if !matches_existing_secret {
            blocked.push(provider_display_name(provider));
        }
    }

    if blocked.is_empty() {
        return Ok(());
    }

    blocked.sort();
    blocked.dedup();

    Err(format!(
        "Persisting new provider client_secret values to ~/.opk/config.yml is blocked in this slice because the upstream file format stores them as plaintext. Remove the inline secret from provider(s) [{}] and supply it via OPKSSH_PROVIDERS or another external secret source. Existing secrets already on disk are preserved only for redacted updates.",
        blocked.join(", ")
    ))
}

fn preserve_existing_client_secrets(
    requested: &mut OpksshClientConfig,
    existing: Option<&OpksshClientConfig>,
) {
    requested.normalize_secret_metadata();

    let Some(_existing) = existing else {
        return;
    };

    let existing_by_alias = existing_secret_by_alias(existing);

    for provider in &mut requested.providers {
        let has_inline_secret = provider
            .client_secret
            .as_deref()
            .is_some_and(|secret| !secret.is_empty());
        if has_inline_secret {
            provider.normalize_secret_metadata();
            continue;
        }

        let alias = provider.alias.trim().to_ascii_lowercase();
        if alias.is_empty() {
            provider.normalize_secret_metadata();
            continue;
        }

        if let Some(existing_provider) = existing_by_alias.get(&alias) {
            if let Some(secret) = existing_provider
                .client_secret
                .as_ref()
                .filter(|secret| !secret.is_empty())
            {
                provider.client_secret = Some(secret.clone());
            }
        }

        provider.normalize_secret_metadata();
    }

    requested.normalize_secret_metadata();
}

fn apply_env_provider_overrides(config: &mut OpksshClientConfig) {
    if let Ok(env_providers) = std::env::var("OPKSSH_PROVIDERS") {
        config.providers =
            merge_provider_sources(config.providers.clone(), parse_env_providers(&env_providers));
    }

    if let Ok(default_provider) = std::env::var("OPKSSH_DEFAULT") {
        if !default_provider.trim().is_empty() {
            config.default_provider = Some(default_provider);
        }
    }
}

fn merge_provider_sources(
    mut file_providers: Vec<CustomProvider>,
    env_providers: Vec<CustomProvider>,
) -> Vec<CustomProvider> {
    let mut by_alias = HashMap::new();
    for (index, provider) in file_providers.iter().enumerate() {
        let alias = provider.alias.trim();
        if !alias.is_empty() {
            by_alias.insert(alias.to_ascii_lowercase(), index);
        }
    }

    for provider in env_providers {
        let alias = provider.alias.trim().to_ascii_lowercase();
        if alias.is_empty() {
            file_providers.push(provider);
            continue;
        }

        if let Some(index) = by_alias.get(&alias).copied() {
            file_providers[index] = provider;
        } else {
            by_alias.insert(alias, file_providers.len());
            file_providers.push(provider);
        }
    }

    file_providers
}

fn warn_if_plaintext_client_secrets(providers: &[CustomProvider]) {
    if providers.iter().any(|provider| {
        provider
            .client_secret
            .as_deref()
            .is_some_and(|secret| !secret.is_empty())
    }) {
        warn!(
            "opkssh client config still contains plaintext provider client_secret values on disk; this helper mirrors the current file format, blocks new plaintext writes through the app wrapper, and is not a secure-store boundary"
        );
    }
}

fn render_client_config_yaml(config: &OpksshClientConfig) -> String {
    let mut yaml = String::new();

    if config.providers.iter().any(|provider| {
        provider
            .client_secret
            .as_deref()
            .is_some_and(|secret| !secret.is_empty())
    }) {
        yaml.push_str(
            "# Existing client_secret values remain plaintext in this file because the upstream format has no secure-store support.\n# The app wrapper blocks new plaintext writes, but already-persisted secrets stay here until removed externally.\n",
        );
    }

    if let Some(default_provider) = config
        .default_provider
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        yaml.push_str(&format!("default: {}\n", sanitize_yaml_scalar(default_provider)));
    }

    if !config.providers.is_empty() {
        yaml.push_str("providers:\n");
        for provider in &config.providers {
            yaml.push_str(&format!(
                "  - alias: {}\n",
                sanitize_yaml_scalar(&provider.alias)
            ));
            yaml.push_str(&format!(
                "    issuer: {}\n",
                sanitize_yaml_scalar(&provider.issuer)
            ));
            yaml.push_str(&format!(
                "    client_id: {}\n",
                sanitize_yaml_scalar(&provider.client_id)
            ));
            if let Some(secret) = provider
                .client_secret
                .as_ref()
                .filter(|value| !value.is_empty())
            {
                yaml.push_str(&format!(
                    "    client_secret: {}\n",
                    sanitize_yaml_scalar(secret)
                ));
            }
            if let Some(scopes) = provider.scopes.as_ref().filter(|value| !value.is_empty()) {
                yaml.push_str(&format!("    scopes: {}\n", sanitize_yaml_scalar(scopes)));
            }
        }
    }

    if yaml.is_empty() {
        DEFAULT_CLIENT_CONFIG_YAML.to_string()
    } else {
        yaml
    }
}

fn sanitize_yaml_scalar(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_client_config_bytes_mentions_plaintext_semantics() {
        let bytes = default_client_config_bytes();
        let text = String::from_utf8(bytes).expect("default config utf-8");
        assert!(text.contains("plaintext"));
    }

    #[test]
    fn test_create_providers_map_rejects_duplicate_aliases() {
        let result = create_providers_map(&[
            CustomProvider {
                alias: "google".into(),
                issuer: "https://accounts.google.com".into(),
                client_id: "a".into(),
                client_secret: None,
                client_secret_present: false,
                client_secret_redacted: false,
                scopes: None,
            },
            CustomProvider {
                alias: "Google".into(),
                issuer: "https://accounts.google.com".into(),
                client_id: "b".into(),
                client_secret: None,
                client_secret_present: false,
                client_secret_redacted: false,
                scopes: None,
            },
        ]);

        assert!(result.is_err());
    }

    #[test]
    fn test_well_known_providers_count() {
        let providers = well_known_providers();
        assert_eq!(providers.len(), 3);
        assert_eq!(providers[0].alias, "google");
    }

    #[test]
    fn test_parse_env_providers() {
        let env = "google,https://accounts.google.com,abc123,,;azure,https://login.microsoft.com,xyz789,secret,openid";
        let providers = parse_env_providers(env);
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].alias, "google");
        assert_eq!(providers[1].alias, "azure");
        assert!(providers[0].client_secret.is_none());
        assert_eq!(providers[1].client_secret.as_deref(), Some("secret"));
    }

    #[test]
    fn test_build_env_providers_string() {
        let providers = vec![CustomProvider {
            alias: "google".into(),
            issuer: "https://accounts.google.com".into(),
            client_id: "abc123".into(),
            client_secret: Some("secret".into()),
            client_secret_present: false,
            client_secret_redacted: false,
            scopes: Some("openid profile".into()),
        }];

        let env = build_env_providers_string(&providers);
        assert_eq!(
            env,
            "google,https://accounts.google.com,abc123,secret,openid profile"
        );
    }

    #[test]
    fn test_parse_config_yaml() {
        let yaml = r#"default: google
providers:
  - alias: google
    issuer: https://accounts.google.com
    client_id: abc123
  - alias: azure
    issuer: https://login.microsoft.com
    client_id: xyz789
    client_secret: secret
    scopes: openid profile
"#;

        let (providers, default) = parse_config_yaml(yaml);
        assert_eq!(default.as_deref(), Some("google"));
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].alias, "google");
        assert_eq!(providers[1].scopes.as_deref(), Some("openid profile"));
    }

    #[test]
    fn test_new_client_config_uses_resolved_path() {
        let config = new_client_config(b"default: google\n", Some("/tmp/opk/config.yml"))
            .expect("client config");

        assert_eq!(config.config_path, "/tmp/opk/config.yml");
        assert_eq!(config.default_provider.as_deref(), Some("google"));
    }

    #[test]
    fn test_redact_client_config_for_transport_hides_client_secret() {
        let config = OpksshClientConfig {
            config_path: "/tmp/opk/config.yml".into(),
            default_provider: Some("google".into()),
            providers: vec![CustomProvider {
                alias: "google".into(),
                issuer: "https://accounts.google.com".into(),
                client_id: "abc123".into(),
                client_secret: Some("secret".into()),
                client_secret_present: false,
                client_secret_redacted: false,
                scopes: None,
            }],
            provider_secrets_present: false,
            secrets_redacted_for_transport: false,
            secret_storage_note: None,
        };

        let redacted = redact_client_config_for_transport(&config);
        assert!(redacted.provider_secrets_present);
        assert!(redacted.secrets_redacted_for_transport);
        assert_eq!(redacted.providers[0].client_secret, None);
        assert!(redacted.providers[0].client_secret_present);
        assert!(redacted.providers[0].client_secret_redacted);
    }

    #[tokio::test]
    async fn test_write_client_config_preserves_existing_secret_when_update_is_redacted() {
        let temp_dir = std::env::temp_dir().join(format!(
            "sorng-opkssh-providers-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let path = temp_dir.join("config.yml");
        let path_str = path.to_string_lossy().to_string();

        tokio::fs::create_dir_all(&temp_dir)
            .await
            .expect("create config dir");
        tokio::fs::write(
            &path,
            "default: custom\nproviders:\n  - alias: custom\n    issuer: https://issuer.example\n    client_id: client-id\n    client_secret: super-secret\n    scopes: openid\n",
        )
        .await
        .expect("seed config");

        let updated = OpksshClientConfig {
            config_path: path_str.clone(),
            default_provider: Some("custom".into()),
            providers: vec![CustomProvider {
                alias: "custom".into(),
                issuer: "https://issuer.example".into(),
                client_id: "updated-client".into(),
                client_secret: None,
                client_secret_present: true,
                client_secret_redacted: true,
                scopes: Some("openid".into()),
            }],
            provider_secrets_present: true,
            secrets_redacted_for_transport: true,
            secret_storage_note: Some("redacted".into()),
        };

        let persisted = write_client_config(&updated).await.expect("updated write");
        assert_eq!(persisted.providers[0].client_secret.as_deref(), Some("super-secret"));

        let reloaded = load_client_config(Some(&path_str)).await.expect("reload config");
        assert_eq!(reloaded.providers[0].client_secret.as_deref(), Some("super-secret"));
        assert_eq!(reloaded.providers[0].client_id, "updated-client");

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_write_client_config_rejects_new_plaintext_secret_persistence() {
        let temp_dir = std::env::temp_dir().join(format!(
            "sorng-opkssh-providers-blocked-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let path = temp_dir.join("config.yml");
        let path_str = path.to_string_lossy().to_string();

        let config = OpksshClientConfig {
            config_path: path_str,
            default_provider: Some("custom".into()),
            providers: vec![CustomProvider {
                alias: "custom".into(),
                issuer: "https://issuer.example".into(),
                client_id: "client-id".into(),
                client_secret: Some("super-secret".into()),
                client_secret_present: false,
                client_secret_redacted: false,
                scopes: Some("openid".into()),
            }],
            provider_secrets_present: false,
            secrets_redacted_for_transport: false,
            secret_storage_note: None,
        };

        let error = write_client_config(&config)
            .await
            .expect_err("new plaintext secrets should be rejected");
        assert!(error.contains("blocked"));
        assert!(!path.exists());
    }
}
