use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::{I18nError, I18nResult};

/// A flattened translation map: `"connections.title" → "Connections"`.
pub type FlatMap = HashMap<String, String>;

/// Load a single JSON locale file and flatten nested keys.
///
/// The file must be valid JSON matching the frontend format (nested objects
/// with string leaves).  Nested keys are joined with `.` separators.
///
/// # Example
///
/// ```json
/// { "app": { "title": "SortOfRemoteNG" } }
/// ```
///
/// becomes `"app.title" → "SortOfRemoteNG"`.
pub fn load_locale_file(path: &Path) -> I18nResult<FlatMap> {
    let content = std::fs::read_to_string(path).map_err(|e| I18nError::LoadError {
        path: path.display().to_string(),
        source: e,
    })?;

    parse_locale_json(&content, path)
}

/// Parse a JSON string (from any source) and flatten it.
pub fn parse_locale_json(json: &str, source_path: &Path) -> I18nResult<FlatMap> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| I18nError::ParseError {
            path: source_path.display().to_string(),
            source: e,
        })?;

    let mut map = HashMap::new();
    flatten("", &value, &mut map);
    Ok(map)
}

/// Recursively flatten a `serde_json::Value` tree.
fn flatten(prefix: &str, value: &serde_json::Value, out: &mut FlatMap) {
    match value {
        serde_json::Value::Object(obj) => {
            for (key, val) in obj {
                let full_key = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten(&full_key, val, out);
            }
        }
        serde_json::Value::String(s) => {
            out.insert(prefix.to_string(), s.clone());
        }
        // Numbers / bools: stringify for convenience
        other => {
            out.insert(prefix.to_string(), other.to_string());
        }
    }
}

/// Discover all locale files in a directory.
///
/// Expects files named `<locale>.json`, e.g. `en.json`, `pt-PT.json`.
/// Returns a map of locale tag → file path.
pub fn discover_locale_files(dir: &Path) -> I18nResult<HashMap<String, PathBuf>> {
    if !dir.is_dir() {
        return Ok(HashMap::new());
    }

    let mut result = HashMap::new();

    let entries = std::fs::read_dir(dir).map_err(|e| I18nError::LoadError {
        path: dir.display().to_string(),
        source: e,
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| I18nError::LoadError {
            path: dir.display().to_string(),
            source: e,
        })?;

        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                result.insert(stem.to_string(), path);
            }
        }
    }

    Ok(result)
}

/// Load all locale files from a directory, returning a map of
/// locale tag → flat translation map.
pub fn load_all_locales(dir: &Path) -> I18nResult<HashMap<String, FlatMap>> {
    let files = discover_locale_files(dir)?;
    let mut locales = HashMap::new();

    for (tag, path) in &files {
        match load_locale_file(path) {
            Ok(map) => {
                log::info!("i18n: loaded {} keys for locale '{}'", map.len(), tag);
                locales.insert(tag.clone(), map);
            }
            Err(e) => {
                log::warn!("i18n: skipping locale '{}': {}", tag, e);
            }
        }
    }

    Ok(locales)
}

/// Merge an overlay map into a base map.  Overlay values win.
pub fn merge_maps(base: &mut FlatMap, overlay: &FlatMap) {
    for (k, v) in overlay {
        base.insert(k.clone(), v.clone());
    }
}

/// Re-nest a flat map back into a `serde_json::Value` tree.
///
/// Useful for SSR serialisation.
pub fn unflatten(flat: &FlatMap) -> serde_json::Value {
    let mut root = serde_json::Map::new();

    for (key, val) in flat {
        let parts: Vec<&str> = key.split('.').collect();
        insert_nested(&mut root, &parts, val);
    }

    serde_json::Value::Object(root)
}

fn insert_nested(map: &mut serde_json::Map<String, serde_json::Value>, parts: &[&str], val: &str) {
    if parts.len() == 1 {
        map.insert(
            parts[0].to_string(),
            serde_json::Value::String(val.to_string()),
        );
        return;
    }

    let child = map
        .entry(parts[0].to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));

    if let serde_json::Value::Object(ref mut inner) = child {
        insert_nested(inner, &parts[1..], val);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn flatten_nested_json() {
        let json = r#"{"app":{"title":"Test","sub":{"key":"value"}}}"#;
        let map = parse_locale_json(json, Path::new("test.json")).unwrap();
        assert_eq!(map.get("app.title").unwrap(), "Test");
        assert_eq!(map.get("app.sub.key").unwrap(), "value");
    }

    #[test]
    fn unflatten_roundtrip() {
        let mut flat = HashMap::new();
        flat.insert("a.b.c".into(), "hello".into());
        flat.insert("a.d".into(), "world".into());
        flat.insert("e".into(), "top".into());

        let nested = unflatten(&flat);
        let obj = nested.as_object().unwrap();
        assert!(obj.contains_key("a"));
        assert!(obj.contains_key("e"));
    }

    #[test]
    fn load_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let en_path = dir.path().join("en.json");
        let mut f = std::fs::File::create(&en_path).unwrap();
        f.write_all(br#"{"greeting":"Hello"}"#).unwrap();

        let locales = load_all_locales(dir.path()).unwrap();
        assert!(locales.contains_key("en"));
        assert_eq!(locales["en"].get("greeting").unwrap(), "Hello");
    }
}
