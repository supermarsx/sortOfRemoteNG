//! Resolve only from saved, native-authorized data, never renderer preferences.
//! Called alongside NativeBrowserPreferences::from_saved by the central owner.
use serde_json::Value;

/// Missing fields inherit. Malformed values in either layer fail closed even
/// when overridden. No mutation of saved consent, settings, proxy or TLS policy.
pub fn saved_app_extensions_enabled(
    connection: &Value,
    settings: &Value,
) -> Result<bool, &'static str> {
    fn layer(value: Option<&Value>, requires_version: bool) -> Result<Option<bool>, &'static str> {
        let Some(value) = value else {
            return Ok(None);
        };
        let invalid = "Invalid saved website-extension settings.";
        let row = value.as_object().ok_or(invalid)?;
        if (requires_version || row.contains_key("version"))
            && row.get("version") != Some(&Value::from(1))
        {
            return Err(invalid);
        }
        row.get("websiteExtensionsEnabled")
            .map(|value| value.as_bool().ok_or(invalid))
            .transpose()
    }
    let global = layer(settings.get("webBrowser"), false)?;
    let saved = layer(connection.get("browserSession"), true)?;
    Ok(saved.or(global).unwrap_or(true))
}
