//! # opkssh Provider Configuration
//!
//! Manage the local `~/.opk/config.yml` and environment variable-based
//! provider configuration.

use crate::types::*;
use log::info;
use std::collections::HashMap;
use std::path::PathBuf;

/// Well-known providers with their default issuer URIs and client IDs.
pub fn well_known_providers() -> Vec<CustomProvider> {
    vec![
        CustomProvider {
            alias: "google".into(),
            issuer: "https://accounts.google.com".into(),
            client_id: "206584157355-7cbe4s640tvm7naoludob4ut1emii7sf.apps.googleusercontent.com"
                .into(),
            client_secret: None,
            scopes: None,
        },
        CustomProvider {
            alias: "microsoft".into(),
            issuer: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0"
                .into(),
            client_id: "096ce0a3-5e72-4da8-9c86-12924b294a01".into(),
            client_secret: None,
            scopes: None,
        },
        CustomProvider {
            alias: "gitlab".into(),
            issuer: "https://gitlab.com".into(),
            client_id: "8d8b7024572c7fd501f64374dec6bba37096783dfcd792b3988104be08cb6923".into(),
            client_secret: None,
            scopes: None,
        },
    ]
}

/// Get the config directory path.
pub fn config_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".opk"))
}

/// Get the config file path.
pub fn config_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("config.yml"))
}

/// Read the local opkssh client configuration.
pub async fn read_client_config() -> OpksshClientConfig {
    let path = config_path();
    let path_str = path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut providers = Vec::new();
    let mut default_provider = None;

    // Try to read config.yml
    if let Some(ref p) = path {
        if p.exists() {
            if let Ok(content) = tokio::fs::read_to_string(p).await {
                let parsed = parse_config_yaml(&content);
                providers = parsed.0;
                default_provider = parsed.1;
            }
        }
    }

    // Also check OPKSSH_PROVIDERS environment variable
    if let Ok(env_providers) = std::env::var("OPKSSH_PROVIDERS") {
        let env_parsed = parse_env_providers(&env_providers);
        providers.extend(env_parsed);
    }

    if default_provider.is_none() {
        if let Ok(default) = std::env::var("OPKSSH_DEFAULT") {
            default_provider = Some(default);
        }
    }

    OpksshClientConfig {
        config_path: path_str,
        default_provider,
        providers,
    }
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
                // New provider entry
                if let Some(map) = current.take() {
                    if let Some(p) = map_to_provider(&map) {
                        providers.push(p);
                    }
                }
                current = Some(HashMap::new());
                // Parse the first field on the same line as '-'
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
            } else if !trimmed.is_empty() && !trimmed.starts_with(' ') {
                // End of providers section
                in_providers = false;
            }
        }
    }

    // Don't forget the last provider
    if let Some(map) = current.take() {
        if let Some(p) = map_to_provider(&map) {
            providers.push(p);
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
    Some(CustomProvider {
        alias,
        issuer,
        client_id: map.get("client_id").cloned().unwrap_or_default(),
        client_secret: map.get("client_secret").cloned(),
        scopes: map.get("scopes").cloned(),
    })
}

/// Parse the OPKSSH_PROVIDERS environment variable.
/// Format: `alias,issuer,client_id,client_secret,scope;alias2,...`
fn parse_env_providers(env: &str) -> Vec<CustomProvider> {
    let mut providers = Vec::new();
    for entry in env.split(';') {
        let parts: Vec<&str> = entry.split(',').collect();
        if parts.len() >= 2 {
            providers.push(CustomProvider {
                alias: parts.first().unwrap_or(&"").to_string(),
                issuer: parts.get(1).unwrap_or(&"").to_string(),
                client_id: parts.get(2).unwrap_or(&"").to_string(),
                client_secret: parts.get(3).and_then(|s| {
                    if s.is_empty() {
                        None
                    } else {
                        Some(s.to_string())
                    }
                }),
                scopes: parts.get(4).and_then(|s| {
                    if s.is_empty() {
                        None
                    } else {
                        Some(s.to_string())
                    }
                }),
            });
        }
    }
    providers
}

/// Write an updated client config to `~/.opk/config.yml`.
pub async fn write_client_config(config: &OpksshClientConfig) -> Result<(), String> {
    let path = config_path().ok_or_else(|| "Cannot determine config path".to_string())?;

    // Ensure directory exists
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let mut yaml = String::new();
    if let Some(ref default) = config.default_provider {
        yaml.push_str(&format!("default: {}\n", default));
    }

    if !config.providers.is_empty() {
        yaml.push_str("providers:\n");
        for p in &config.providers {
            yaml.push_str(&format!("  - alias: {}\n", p.alias));
            yaml.push_str(&format!("    issuer: {}\n", p.issuer));
            yaml.push_str(&format!("    client_id: {}\n", p.client_id));
            if let Some(ref secret) = p.client_secret {
                yaml.push_str(&format!("    client_secret: {}\n", secret));
            }
            if let Some(ref scopes) = p.scopes {
                yaml.push_str(&format!("    scopes: {}\n", scopes));
            }
        }
    }

    tokio::fs::write(&path, &yaml)
        .await
        .map_err(|e| format!("Failed to write config: {}", e))?;

    info!("Wrote opkssh client config to {:?}", path);
    Ok(())
}

/// Build the OPKSSH_PROVIDERS environment variable string from config.
pub fn build_env_providers_string(providers: &[CustomProvider]) -> String {
    providers
        .iter()
        .map(|p| {
            let mut parts = vec![p.alias.clone(), p.issuer.clone(), p.client_id.clone()];
            parts.push(p.client_secret.clone().unwrap_or_default());
            parts.push(p.scopes.clone().unwrap_or_default());
            parts.join(",")
        })
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_well_known_providers_count() {
        let providers = well_known_providers();
        assert!(providers.len() >= 3);
        assert!(providers.iter().any(|p| p.alias == "google"));
        assert!(providers.iter().any(|p| p.alias == "microsoft"));
        assert!(providers.iter().any(|p| p.alias == "gitlab"));
    }

    #[test]
    fn test_parse_env_providers() {
        let env = "google,https://accounts.google.com,client123,,;azure,https://login.microsoftonline.com/tenant/v2.0,client456";
        let providers = parse_env_providers(env);
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].alias, "google");
        assert_eq!(providers[1].alias, "azure");
        assert!(providers[0].client_secret.is_none());
    }

    #[test]
    fn test_build_env_providers_string() {
        let providers = vec![CustomProvider {
            alias: "test".into(),
            issuer: "https://test.com".into(),
            client_id: "cid".into(),
            client_secret: None,
            scopes: Some("openid".into()),
        }];
        let result = build_env_providers_string(&providers);
        assert!(result.contains("test,https://test.com,cid,"));
    }

    #[test]
    fn test_parse_config_yaml() {
        let yaml = r#"default: google
providers:
  - alias: google
    issuer: https://accounts.google.com
    client_id: abc123
  - alias: custom
    issuer: https://auth.example.com
    client_id: def456
    scopes: openid profile
"#;
        let (providers, default) = parse_config_yaml(yaml);
        assert_eq!(default.as_deref(), Some("google"));
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].alias, "google");
        assert_eq!(providers[1].scopes.as_deref(), Some("openid profile"));
    }
}
