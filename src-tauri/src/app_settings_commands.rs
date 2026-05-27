//! Frontend application settings persistence.
//!
//! The frontend `GlobalSettings` blob is stored as plaintext JSON at the
//! root of `<app_data_dir>/settings.json` — the same file the updater
//! reads its `updater.*` slice from (see `updater_config.rs`). Storing it
//! here (rather than the encrypted `storage.json` vault) means UI settings
//! like theme and language are readable at startup *before* the user
//! unlocks the encrypted connection store.
//!
//! Writes shallow-merge a patch at the JSON root so partial saves (e.g.
//! window geometry) never drop sibling keys, and the Rust-managed
//! `updater` object is preserved untouched (`GlobalSettings` has no
//! `updater` key, so the frontend never collides with it).

use serde_json::Value;
use tauri::Manager;

const SETTINGS_FILENAME: &str = "settings.json";

/// Read the whole `settings.json` object, or `None` if the file does not
/// exist yet. The frontend slices out the keys it understands and ignores
/// the rest (e.g. the updater's private-endpoint settings).
#[tauri::command]
pub async fn read_app_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join(SETTINGS_FILENAME);
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            let value: Value = serde_json::from_str(&s)
                .map_err(|e| format!("parse settings.json: {e}"))?;
            Ok(Some(value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Shallow-merge `patch` into `settings.json` at the root and persist.
/// Creates the file and parent directory if missing. Preserves any
/// top-level keys not present in the patch (notably the `updater` object).
#[tauri::command]
pub async fn write_app_settings(app: tauri::AppHandle, patch: Value) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(SETTINGS_FILENAME);

    let existing: Value = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| serde_json::json!({})),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(e.to_string()),
    };

    let merged = merge_root(existing, &patch)?;
    let body = serde_json::to_string_pretty(&merged)
        .map_err(|e| format!("serialize settings.json: {e}"))?;
    std::fs::write(&path, body).map_err(|e| e.to_string())
}

/// Shallow-merge `patch`'s top-level keys into `existing` at the root.
/// `existing` is coerced to an object if it isn't one. Keys in `existing`
/// but not in `patch` (e.g. the backend-managed `updater` object) are
/// preserved untouched. Pure function so it can be unit-tested without a
/// Tauri app / filesystem.
fn merge_root(mut existing: Value, patch: &Value) -> Result<Value, String> {
    if !existing.is_object() {
        existing = serde_json::json!({});
    }
    let patch_obj = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;
    let obj = existing.as_object_mut().expect("coerced to object above");
    for (key, value) in patch_obj {
        obj.insert(key.clone(), value.clone());
    }
    Ok(existing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_frontend_keys_and_preserves_updater() {
        let existing = serde_json::json!({
            "theme": "dark",
            "updater": { "privateEndpointUrl": "https://priv.example/x" }
        });
        let patch = serde_json::json!({ "theme": "light", "language": "fr" });
        let merged = merge_root(existing, &patch).unwrap();

        assert_eq!(merged["theme"], "light");
        assert_eq!(merged["language"], "fr");
        // Backend-managed sibling left intact.
        assert_eq!(
            merged["updater"]["privateEndpointUrl"],
            "https://priv.example/x"
        );
    }

    #[test]
    fn coerces_non_object_root() {
        let merged = merge_root(serde_json::json!("garbage"), &serde_json::json!({ "a": 1 }))
            .unwrap();
        assert_eq!(merged["a"], 1);
    }

    #[test]
    fn rejects_non_object_patch() {
        assert!(merge_root(serde_json::json!({}), &serde_json::json!([1, 2])).is_err());
    }
}
