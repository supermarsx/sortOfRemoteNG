//! Compatibility helpers for the updater settings file.
//!
//! The production updater path is `sorng-updater` plus
//! `tauri-plugin-updater`. Private endpoints are backend-managed runtime
//! settings and are never injected into committed `tauri.conf.json` at build
//! time. These helpers remain for older callers and tests that read/write the
//! app settings file directly.

use std::path::{Path, PathBuf};

/// Key under which the private endpoint URL is persisted in
/// `settings.json`. Grouped under `"updater"` so future keys (channel,
/// auto-check cadence, etc.) slot in without a schema churn.
pub const SETTINGS_KEY_UPDATER: &str = "updater";
pub const SETTINGS_KEY_PRIVATE_ENDPOINT: &str = "privateEndpointUrl";
pub const SETTINGS_KEY_PRIVATE_ENDPOINT_ENABLED: &str = "privateEndpointEnabled";
pub const SETTINGS_KEY_PRIVATE_ENDPOINT_LEGACY: &str = "private_endpoint";

/// Filename of the runtime settings store read by this module.
pub const SETTINGS_FILENAME: &str = "settings.json";

/// Resolve the runtime private-endpoint URL, if any, from `settings.json`
/// inside the given app-data directory.
///
/// Returns `Ok(None)` when the file is absent, the key is missing, or the
/// value fails HTTPS/local-dev validation. Returns `Err` only on unexpected
/// I/O errors the caller should surface.
pub fn read_private_endpoint(app_data_dir: &Path) -> std::io::Result<Option<String>> {
    let path = app_data_dir.join(SETTINGS_FILENAME);
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    Ok(parse_private_endpoint(&raw))
}

/// Parse the JSON settings body and extract a validated private endpoint
/// URL. Public so unit tests can exercise the pure-function surface
/// without touching the filesystem.
pub fn parse_private_endpoint(raw: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let updater = v.get(SETTINGS_KEY_UPDATER)?;
    let s = updater
        .get(SETTINGS_KEY_PRIVATE_ENDPOINT)
        .or_else(|| updater.get(SETTINGS_KEY_PRIVATE_ENDPOINT_LEGACY))?
        .as_str()?
        .trim()
        .to_string();
    if s.is_empty() {
        return None;
    }
    if !is_valid_private_endpoint(&s) {
        return None;
    }
    Some(s)
}

/// Persist the private endpoint URL to `settings.json` under
/// `updater.privateEndpointUrl`. Creates the file (and any missing
/// subkeys) if they do not yet exist; preserves any other top-level
/// keys already written by other subsystems.
///
/// Pass `None` to clear the key (leaving the rest of the file intact).
pub fn write_private_endpoint(app_data_dir: &Path, url: Option<&str>) -> std::io::Result<()> {
    std::fs::create_dir_all(app_data_dir)?;
    let path: PathBuf = app_data_dir.join(SETTINGS_FILENAME);

    let mut root: serde_json::Value = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| serde_json::json!({})),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(e),
    };
    if !root.is_object() {
        root = serde_json::json!({});
    }

    let obj = root.as_object_mut().expect("checked");
    let updater = obj
        .entry(SETTINGS_KEY_UPDATER.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !updater.is_object() {
        *updater = serde_json::json!({});
    }
    let updater_obj = updater.as_object_mut().expect("checked");

    match url {
        Some(u) => {
            let trimmed = u.trim();
            if trimmed.is_empty() || !is_valid_private_endpoint(trimmed) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "private updater endpoint must be HTTPS, except local development HTTP endpoints in debug builds",
                ));
            }
            updater_obj.insert(
                SETTINGS_KEY_PRIVATE_ENDPOINT.to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
            updater_obj.insert(
                SETTINGS_KEY_PRIVATE_ENDPOINT_ENABLED.to_string(),
                serde_json::Value::Bool(true),
            );
            updater_obj.remove(SETTINGS_KEY_PRIVATE_ENDPOINT_LEGACY);
        }
        None => {
            updater_obj.remove(SETTINGS_KEY_PRIVATE_ENDPOINT);
            updater_obj.remove(SETTINGS_KEY_PRIVATE_ENDPOINT_LEGACY);
            updater_obj.insert(
                SETTINGS_KEY_PRIVATE_ENDPOINT_ENABLED.to_string(),
                serde_json::Value::Bool(false),
            );
        }
    }

    let body = serde_json::to_string_pretty(&root)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("serialize: {e}")))?;
    std::fs::write(&path, body)
}

fn is_valid_private_endpoint(input: &str) -> bool {
    let Ok(url) = url::Url::parse(input.trim()) else {
        return false;
    };

    match url.scheme() {
        "https" => true,
        "http" if cfg!(debug_assertions) => {
            matches!(
                url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("::1") | Some("0.0.0.0")
            ) || url
                .host_str()
                .map(|host| host.ends_with(".localhost"))
                .unwrap_or(false)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_present_endpoint() {
        let raw = r#"{"updater":{"private_endpoint":"https://example.com/latest.json"}}"#;
        assert_eq!(
            parse_private_endpoint(raw).as_deref(),
            Some("https://example.com/latest.json")
        );
    }

    #[test]
    fn rejects_non_https() {
        let raw = r#"{"updater":{"private_endpoint":"ftp://example.com/latest.json"}}"#;
        assert_eq!(parse_private_endpoint(raw), None);
    }

    #[test]
    fn missing_key_is_none() {
        assert_eq!(parse_private_endpoint(r#"{}"#), None);
        assert_eq!(parse_private_endpoint(r#"{"updater":{}}"#), None);
    }

    #[test]
    fn malformed_json_is_none() {
        assert_eq!(parse_private_endpoint("not json"), None);
    }

    #[test]
    fn empty_string_is_none() {
        let raw = r#"{"updater":{"private_endpoint":"   "}}"#;
        assert_eq!(parse_private_endpoint(raw), None);
    }

    #[test]
    fn roundtrip_write_then_read() {
        let tmp = tempfile::tempdir().unwrap();
        write_private_endpoint(tmp.path(), Some("https://priv.example/latest.json")).unwrap();
        let got = read_private_endpoint(tmp.path()).unwrap();
        assert_eq!(got.as_deref(), Some("https://priv.example/latest.json"));

        // Clearing
        write_private_endpoint(tmp.path(), None).unwrap();
        assert_eq!(read_private_endpoint(tmp.path()).unwrap(), None);
    }

    #[test]
    fn write_rejects_invalid_url() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(write_private_endpoint(tmp.path(), Some("not-a-url")).is_err());
    }

    #[test]
    fn write_preserves_other_keys() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join(SETTINGS_FILENAME),
            r#"{"theme":"dark","updater":{"private_endpoint":"https://old.example/x"}}"#,
        )
        .unwrap();
        write_private_endpoint(tmp.path(), Some("https://new.example/x")).unwrap();
        let raw = std::fs::read_to_string(tmp.path().join(SETTINGS_FILENAME)).unwrap();
        assert!(raw.contains("\"theme\""));
        assert!(raw.contains("https://new.example/x"));
    }
}
