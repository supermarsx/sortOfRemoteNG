//! Resolve the existing saved connection/global appearance schema only.
use serde::Deserialize;
use serde_json::Value;
use sorng_browser_host::native_appearance::{AppearanceConfig, AppearanceTheme};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    version: u8,
    use_global_defaults: bool,
    theme: AppearanceTheme,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Settings {
    version: u8,
    defaults: AppearanceTheme,
    presets: Vec<Preset>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Preset {
    id: String,
    name: String,
    theme: AppearanceTheme,
}

pub(super) fn from_saved(connection: &Value, settings: &Value) -> Result<AppearanceConfig, ()> {
    let automation = connection.get("httpAutomation");
    let enabled = match automation {
        None => true,
        Some(value) => {
            let row = value.as_object().ok_or(())?;
            row.get("forceDark")
                .map(|v| v.as_bool().ok_or(()))
                .transpose()?
                .unwrap_or(false)
        }
    };
    let config = automation
        .and_then(|v| v.get("darkMode"))
        .map(|v| serde_json::from_value::<Config>(v.clone()).map_err(|_| ()))
        .transpose()?;
    if let Some(config) = &config {
        if config.version != 1 {
            return Err(());
        }
        config.theme.validate().map_err(|_| ())?;
    }
    let globals = settings
        .get("websiteDarkMode")
        .map(|v| serde_json::from_value::<Settings>(v.clone()).map_err(|_| ()))
        .transpose()?;
    if let Some(globals) = &globals {
        if globals.version != 1 || globals.presets.len() > 32 {
            return Err(());
        }
        globals.defaults.validate().map_err(|_| ())?;
        let mut ids = std::collections::HashSet::new();
        for preset in &globals.presets {
            if preset.id.is_empty()
                || preset.id.len() > 128
                || !preset.id.as_bytes()[0].is_ascii_alphanumeric()
                || !preset
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                || matches!(
                    preset.id.as_str(),
                    "builtin-comfortable" | "builtin-dim" | "builtin-amoled" | "builtin-sepia"
                )
                || !ids.insert(&preset.id)
                || preset.name.trim().is_empty()
                || preset.name.chars().count() > 80
                || preset.name.chars().any(char::is_control)
            {
                return Err(());
            }
            preset.theme.validate().map_err(|_| ())?;
        }
    }
    let theme = if config.as_ref().is_none_or(|c| c.use_global_defaults) {
        globals.map(|g| g.defaults).unwrap_or_default()
    } else {
        config.unwrap().theme
    };
    Ok(AppearanceConfig { enabled, theme })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn absent_automation_preserves_native_default_but_explicit_false_wins() {
        assert!(from_saved(&json!({}), &Value::Null).unwrap().enabled);
        assert!(
            !from_saved(&json!({"httpAutomation":{"forceDark":false}}), &Value::Null)
                .unwrap()
                .enabled
        );
        assert!(
            !from_saved(&json!({"httpAutomation":{}}), &Value::Null)
                .unwrap()
                .enabled
        );
        assert!(from_saved(&json!({"httpAutomation":null}), &Value::Null).is_err());
    }
    #[test]
    fn saved_theme_overrides_globals_and_legacy_follow_defaults_true() {
        let mut theme = serde_json::to_value(AppearanceTheme::default()).unwrap();
        theme.as_object_mut().unwrap().remove("followAppTheme");
        theme["backgroundColor"] = json!("#010203");
        let local = json!({"httpAutomation":{"forceDark":true,"darkMode":{"version":1,"useGlobalDefaults":false,"theme":theme}}});
        let result = from_saved(&local, &Value::Null).unwrap();
        assert_eq!(result.theme.background_color, "#010203");
        assert!(result.theme.follow_app_theme);
        let global = json!({"websiteDarkMode":{"version":1,"defaults":theme,"presets":[]}});
        assert_eq!(
            from_saved(&json!({}), &global)
                .unwrap()
                .theme
                .background_color,
            "#010203"
        );
    }
    #[test]
    fn malformed_masked_globals_and_remote_css_are_rejected() {
        let theme = serde_json::to_value(AppearanceTheme::default()).unwrap();
        let local = json!({"httpAutomation":{"forceDark":true,"darkMode":{"version":1,"useGlobalDefaults":false,"theme":theme}}});
        assert!(from_saved(&local, &json!({"websiteDarkMode":{"version":2}})).is_err());
        let mut local = local;
        local["httpAutomation"]["darkMode"]["theme"]["customCss"] =
            json!("body{background:url(https://fixture.invalid)}");
        assert!(from_saved(&local, &Value::Null).is_err());
    }
}
