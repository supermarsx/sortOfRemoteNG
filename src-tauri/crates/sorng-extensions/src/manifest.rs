//! Extension manifest parsing, validation, and version utilities.
//!
//! Extensions are distributed as directories containing a `manifest.json`
//! file plus a script entry-point.  This module handles loading, validating,
//! and comparing manifests.

use chrono::Utc;
use log::debug;

use crate::types::*;

// ─── Validation ─────────────────────────────────────────────────────

/// Validate an extension ID (reverse-dns style).
/// Rules: lowercase alphanumeric + dots + hyphens, must contain at least one dot,
/// and each segment must start with a letter.
pub fn validate_extension_id(id: &str) -> ExtResult<()> {
    if id.is_empty() {
        return Err(ExtError::manifest("Extension ID cannot be empty"));
    }
    if id.len() > 128 {
        return Err(ExtError::manifest("Extension ID cannot exceed 128 characters"));
    }

    let segments: Vec<&str> = id.split('.').collect();
    if segments.len() < 2 {
        return Err(ExtError::manifest(
            "Extension ID must be reverse-DNS style (e.g. 'com.example.my-ext')",
        ));
    }

    for seg in &segments {
        if seg.is_empty() {
            return Err(ExtError::manifest(
                "Extension ID segments cannot be empty",
            ));
        }
        let first = seg.chars().next().unwrap();
        if !first.is_ascii_lowercase() {
            return Err(ExtError::manifest(format!(
                "Extension ID segment '{}' must start with a lowercase letter",
                seg
            )));
        }
        if !seg.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return Err(ExtError::manifest(format!(
                "Extension ID segment '{}' may only contain lowercase letters, digits, and hyphens",
                seg
            )));
        }
    }
    Ok(())
}

/// Validate a semver version string (simplified: major.minor.patch).
pub fn validate_version(version: &str) -> ExtResult<()> {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 {
        return Err(ExtError::manifest(format!(
            "Version '{}' must be semver (major.minor.patch)",
            version
        )));
    }
    for part in &parts {
        if part.parse::<u32>().is_err() {
            return Err(ExtError::manifest(format!(
                "Version segment '{}' is not a valid number",
                part
            )));
        }
    }
    Ok(())
}

/// Compare two semver versions.  Returns `Ordering`.
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |v: &str| -> (u32, u32, u32) {
        let parts: Vec<u32> = v.split('.').filter_map(|s| s.parse().ok()).collect();
        (
            parts.first().copied().unwrap_or(0),
            parts.get(1).copied().unwrap_or(0),
            parts.get(2).copied().unwrap_or(0),
        )
    };
    parse(a).cmp(&parse(b))
}

/// Check whether `actual` satisfies the version constraint defined by
/// [`min`, `max`].
pub fn version_satisfies(actual: &str, min: Option<&str>, max: Option<&str>) -> bool {
    if let Some(min_v) = min {
        if compare_versions(actual, min_v) == std::cmp::Ordering::Less {
            return false;
        }
    }
    if let Some(max_v) = max {
        if compare_versions(actual, max_v) == std::cmp::Ordering::Greater {
            return false;
        }
    }
    true
}

/// Fully validate an extension manifest.
pub fn validate_manifest(manifest: &ExtensionManifest) -> ExtResult<()> {
    validate_extension_id(&manifest.id)?;
    validate_version(&manifest.version)?;

    if manifest.name.trim().is_empty() {
        return Err(ExtError::manifest("Extension name cannot be empty"));
    }
    if manifest.name.len() > 100 {
        return Err(ExtError::manifest(
            "Extension name cannot exceed 100 characters",
        ));
    }
    if manifest.description.trim().is_empty() {
        return Err(ExtError::manifest("Extension description cannot be empty"));
    }
    if manifest.description.len() > 500 {
        return Err(ExtError::manifest(
            "Extension description cannot exceed 500 characters",
        ));
    }
    if manifest.author.trim().is_empty() {
        return Err(ExtError::manifest("Extension author cannot be empty"));
    }
    if manifest.entry_point.trim().is_empty() {
        return Err(ExtError::manifest("Entry point cannot be empty"));
    }

    // Validate min/max app versions if set.
    if let Some(ref v) = manifest.min_app_version {
        validate_version(v).map_err(|_| {
            ExtError::manifest(format!("Invalid min_app_version: '{}'", v))
        })?;
    }
    if let Some(ref v) = manifest.max_app_version {
        validate_version(v).map_err(|_| {
            ExtError::manifest(format!("Invalid max_app_version: '{}'", v))
        })?;
    }

    // Validate hook registrations.
    for hook in &manifest.hooks {
        if hook.handler.trim().is_empty() {
            return Err(ExtError::manifest(format!(
                "Hook handler name cannot be empty for event '{}'",
                hook.event
            )));
        }
    }

    // Validate dependency versions.
    for dep in &manifest.dependencies {
        if dep.extension_id.trim().is_empty() {
            return Err(ExtError::manifest(
                "Dependency extension_id cannot be empty",
            ));
        }
        if let Some(ref v) = dep.min_version {
            validate_version(v).map_err(|_| {
                ExtError::manifest(format!(
                    "Dependency '{}' has invalid min_version: '{}'",
                    dep.extension_id, v
                ))
            })?;
        }
        if let Some(ref v) = dep.max_version {
            validate_version(v).map_err(|_| {
                ExtError::manifest(format!(
                    "Dependency '{}' has invalid max_version: '{}'",
                    dep.extension_id, v
                ))
            })?;
        }
    }

    // Validate settings schema.
    for setting in &manifest.settings_schema {
        if setting.key.trim().is_empty() {
            return Err(ExtError::manifest("Setting key cannot be empty"));
        }
        if setting.label.trim().is_empty() {
            return Err(ExtError::manifest(format!(
                "Setting '{}' label cannot be empty",
                setting.key
            )));
        }
        if (setting.setting_type == SettingType::Select
            || setting.setting_type == SettingType::MultiSelect)
            && setting.options.as_ref().map_or(true, |o| o.is_empty())
        {
            return Err(ExtError::manifest(format!(
                "Setting '{}' of type {:?} must have at least one option",
                setting.key, setting.setting_type
            )));
        }
        // Validate regex pattern.
        if let Some(ref pat) = setting.validation_pattern {
            if regex::Regex::new(pat).is_err() {
                return Err(ExtError::manifest(format!(
                    "Setting '{}' has invalid validation pattern: '{}'",
                    setting.key, pat
                )));
            }
        }
    }

    debug!("Manifest validated for extension '{}'", manifest.id);
    Ok(())
}

/// Parse a manifest from a JSON string.
pub fn parse_manifest(json: &str) -> ExtResult<ExtensionManifest> {
    let manifest: ExtensionManifest = serde_json::from_str(json)
        .map_err(|e| ExtError::manifest(format!("Failed to parse manifest JSON: {}", e)))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

/// Create a new minimal manifest with sensible defaults.
pub fn create_manifest(
    id: impl Into<String>,
    name: impl Into<String>,
    version: impl Into<String>,
    description: impl Into<String>,
    author: impl Into<String>,
    extension_type: ExtensionType,
) -> ExtensionManifest {
    let now = Utc::now();
    ExtensionManifest {
        id: id.into(),
        name: name.into(),
        version: version.into(),
        description: description.into(),
        author: author.into(),
        license: None,
        homepage: None,
        repository: None,
        min_app_version: None,
        max_app_version: None,
        extension_type,
        permissions: Vec::new(),
        hooks: Vec::new(),
        entry_point: "main.json".to_string(),
        icon: None,
        settings_schema: Vec::new(),
        dependencies: Vec::new(),
        tags: Vec::new(),
        keywords: Vec::new(),
        created_at: now,
        updated_at: now,
    }
}

/// Serialize a manifest to a pretty-printed JSON string.
pub fn serialize_manifest(manifest: &ExtensionManifest) -> ExtResult<String> {
    serde_json::to_string_pretty(manifest)
        .map_err(|e| ExtError::manifest(format!("Failed to serialize manifest: {}", e)))
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_manifest() -> ExtensionManifest {
        create_manifest(
            "com.example.test-ext",
            "Test Extension",
            "1.0.0",
            "A test extension for the suite",
            "Test Author",
            ExtensionType::Script,
        )
    }

    #[test]
    fn valid_extension_id() {
        assert!(validate_extension_id("com.example.my-ext").is_ok());
        assert!(validate_extension_id("org.sorng.ssh-tools").is_ok());
        assert!(validate_extension_id("io.github.user.ext123").is_ok());
    }

    #[test]
    fn invalid_extension_ids() {
        assert!(validate_extension_id("").is_err());
        assert!(validate_extension_id("noperiod").is_err());
        assert!(validate_extension_id("Com.Example.Bad").is_err());
        assert!(validate_extension_id("com..empty").is_err());
        assert!(validate_extension_id("com.123bad.ext").is_err());
        assert!(validate_extension_id("com.bad!chars.ext").is_err());
    }

    #[test]
    fn valid_versions() {
        assert!(validate_version("0.0.0").is_ok());
        assert!(validate_version("1.0.0").is_ok());
        assert!(validate_version("12.34.56").is_ok());
    }

    #[test]
    fn invalid_versions() {
        assert!(validate_version("").is_err());
        assert!(validate_version("1.0").is_err());
        assert!(validate_version("1.0.0.0").is_err());
        assert!(validate_version("a.b.c").is_err());
    }

    #[test]
    fn version_comparison() {
        assert_eq!(compare_versions("1.0.0", "1.0.0"), std::cmp::Ordering::Equal);
        assert_eq!(compare_versions("1.0.1", "1.0.0"), std::cmp::Ordering::Greater);
        assert_eq!(compare_versions("0.9.9", "1.0.0"), std::cmp::Ordering::Less);
        assert_eq!(compare_versions("2.0.0", "1.9.9"), std::cmp::Ordering::Greater);
    }

    #[test]
    fn version_satisfies_checks() {
        assert!(version_satisfies("1.5.0", Some("1.0.0"), Some("2.0.0")));
        assert!(version_satisfies("1.0.0", Some("1.0.0"), None));
        assert!(!version_satisfies("0.9.0", Some("1.0.0"), None));
        assert!(!version_satisfies("3.0.0", None, Some("2.0.0")));
        assert!(version_satisfies("1.0.0", None, None));
    }

    #[test]
    fn validate_valid_manifest() {
        let m = make_valid_manifest();
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn validate_manifest_empty_name() {
        let mut m = make_valid_manifest();
        m.name = "".into();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_empty_description() {
        let mut m = make_valid_manifest();
        m.description = "".into();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_empty_author() {
        let mut m = make_valid_manifest();
        m.author = "".into();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_empty_entry_point() {
        let mut m = make_valid_manifest();
        m.entry_point = "".into();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_bad_min_version() {
        let mut m = make_valid_manifest();
        m.min_app_version = Some("bad".into());
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_bad_dependency_version() {
        let mut m = make_valid_manifest();
        m.dependencies.push(ExtensionDependency {
            extension_id: "com.example.dep".into(),
            min_version: Some("nope".into()),
            max_version: None,
            optional: false,
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_select_without_options() {
        let mut m = make_valid_manifest();
        m.settings_schema.push(SettingDefinition {
            key: "theme".into(),
            label: "Theme".into(),
            description: None,
            setting_type: SettingType::Select,
            default_value: None,
            required: false,
            options: None,
            validation_pattern: None,
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_bad_regex_pattern() {
        let mut m = make_valid_manifest();
        m.settings_schema.push(SettingDefinition {
            key: "pattern".into(),
            label: "Pattern".into(),
            description: None,
            setting_type: SettingType::String,
            default_value: None,
            required: false,
            options: None,
            validation_pattern: Some("[invalid".into()),
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_hook_empty_handler() {
        let mut m = make_valid_manifest();
        m.hooks.push(HookRegistration {
            event: HookEvent::AppStartup,
            handler: "".into(),
            priority: 100,
            enabled: true,
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn parse_and_serialize_roundtrip() {
        let m = make_valid_manifest();
        let json = serialize_manifest(&m).unwrap();
        let parsed = parse_manifest(&json).unwrap();
        assert_eq!(parsed.id, m.id);
        assert_eq!(parsed.name, m.name);
        assert_eq!(parsed.version, m.version);
    }

    #[test]
    fn create_manifest_defaults() {
        let m = create_manifest(
            "com.test.ext",
            "My Ext",
            "0.1.0",
            "Desc",
            "Author",
            ExtensionType::Tool,
        );
        assert_eq!(m.entry_point, "main.json");
        assert!(m.permissions.is_empty());
        assert!(m.hooks.is_empty());
        assert!(m.dependencies.is_empty());
    }

    #[test]
    fn extension_id_too_long() {
        let long_id = format!("com.example.{}", "a".repeat(120));
        assert!(validate_extension_id(&long_id).is_err());
    }

    #[test]
    fn extension_name_too_long() {
        let mut m = make_valid_manifest();
        m.name = "x".repeat(101);
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn extension_description_too_long() {
        let mut m = make_valid_manifest();
        m.description = "x".repeat(501);
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_empty_dependency_id() {
        let mut m = make_valid_manifest();
        m.dependencies.push(ExtensionDependency {
            extension_id: "".into(),
            min_version: None,
            max_version: None,
            optional: false,
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_setting_empty_key() {
        let mut m = make_valid_manifest();
        m.settings_schema.push(SettingDefinition {
            key: "".into(),
            label: "Label".into(),
            description: None,
            setting_type: SettingType::String,
            default_value: None,
            required: false,
            options: None,
            validation_pattern: None,
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_setting_empty_label() {
        let mut m = make_valid_manifest();
        m.settings_schema.push(SettingDefinition {
            key: "key".into(),
            label: "".into(),
            description: None,
            setting_type: SettingType::String,
            default_value: None,
            required: false,
            options: None,
            validation_pattern: None,
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn parse_manifest_invalid_json() {
        assert!(parse_manifest("not json").is_err());
    }
}
