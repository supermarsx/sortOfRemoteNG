//! Saved browser preferences. Resolve at native authorization, never from a
//! renderer-selected profile path or a browser creation payload.

use serde_json::{Map, Value};
use sorng_browser_host::native_capabilities::NativeBrowserCapabilities;
use sorng_browser_host::native_popups::NativePopupPolicy;
use std::sync::LazyLock;
#[path = "origin_browser_appearance_config.rs"]
mod appearance_config;

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("Invalid saved native browser preferences")]
pub struct InvalidNativeBrowserPreferences;

#[derive(Clone)]
pub struct NativeBrowserPreferences {
    pub appearance: sorng_browser_host::native_appearance::AppearanceConfig,
    pub capabilities: NativeBrowserCapabilities,
    pub allow_downloads: bool,
    pub allow_page_dialogs: bool,
    pub default_zoom_percent: u64,
    pub popup_policy: NativePopupPolicy,
    pub initial_load_timeout_seconds: u64,
    pub document_ready_timeout_seconds: u64,
    pub minimum_form_fill_delay_ms: u64,
    pub minimum_form_submit_delay_ms: u64,
    pub manual_form_submit: bool,
    pub retention: Value,
}

static SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../src/types/settings/browserSession.schema.json"
    ))
    .expect("bundled browser session schema")
});

fn valid(value: &Value, rule: &Value) -> bool {
    if let Some(constant) = rule.get("const") {
        return value == constant;
    }
    if let Some(choices) = rule.get("enum").and_then(Value::as_array) {
        return choices.contains(value);
    }
    match rule["type"].as_str() {
        Some("integer") => value.as_u64().is_some_and(|number| {
            number >= rule["minimum"].as_u64().unwrap_or(0)
                && number <= rule["maximum"].as_u64().unwrap_or(u64::MAX)
        }),
        Some("boolean") => value.is_boolean(),
        _ => false,
    }
}

fn retention(value: Option<&Value>) -> Result<Value, ()> {
    let properties = SCHEMA["$defs"]["retention"]["properties"]
        .as_object()
        .ok_or(())?;
    let Some(value) = value else {
        return Ok(Value::Object(
            properties
                .iter()
                .map(|(name, rule)| (name.clone(), rule["default"].clone()))
                .collect(),
        ));
    };
    // Only the former configuration spelling migrates here. Cookie payload
    // migration remains a separate native, owner-authorized storage operation.
    let mut normalized = value.clone();
    if normalized.get("mode").and_then(Value::as_str) == Some("encrypted-local") {
        normalized["mode"] = "encrypted-database".into();
    }
    let row = normalized.as_object().ok_or(())?;
    if row.len() != properties.len()
        || properties
            .iter()
            .any(|(key, rule)| row.get(key).is_none_or(|value| !valid(value, rule)))
    {
        return Err(());
    }
    Ok(normalized)
}

impl NativeBrowserPreferences {
    pub fn from_saved(
        connection: &Value,
        settings: &Value,
    ) -> Result<Self, InvalidNativeBrowserPreferences> {
        Self::resolve_saved(connection, settings).map_err(|()| InvalidNativeBrowserPreferences)
    }

    fn resolve_saved(connection: &Value, settings: &Value) -> Result<Self, ()> {
        let empty = Map::new();
        let globals = settings
            .get("webBrowser")
            .map(|value| value.as_object().ok_or(()))
            .transpose()?
            .unwrap_or(&empty);
        if globals.get("version").is_some_and(|v| v != &Value::from(1)) {
            return Err(());
        }
        // Process-wide startup policy is consumed by the runtime entry point,
        // but malformed saved values must also fail native authorization.
        if globals
            .get("xsltEnabled")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(());
        }
        let overrides = connection
            .get("browserSession")
            .map(|value| value.as_object().ok_or(()))
            .transpose()?;
        let properties = SCHEMA["properties"].as_object().ok_or(())?;
        if let Some(row) = overrides {
            if row.get("version") != Some(&Value::from(1))
                || row.keys().any(|key| !properties.contains_key(key))
            {
                return Err(());
            }
        }
        // Validate both layers, including overridden values. Malformed stored
        // policy is an error, not an implicit permission or coercion.
        for row in [Some(globals), overrides].into_iter().flatten() {
            for (key, rule) in properties {
                if let Some(value) = row.get(key) {
                    if key == "sessionRetention" {
                        retention(Some(value))?;
                    } else if !valid(value, rule) {
                        return Err(());
                    }
                }
            }
            let layer_delay = |key| row.get(key).and_then(Value::as_u64).unwrap_or(0);
            if layer_delay("minimumFormFillDelayMs") + layer_delay("minimumFormSubmitDelayMs")
                > 52_000
            {
                return Err(());
            }
        }
        let get = |key: &str| {
            overrides
                .and_then(|row| row.get(key))
                .or_else(|| globals.get(key))
        };
        let integer = |key, fallback| get(key).and_then(Value::as_u64).unwrap_or(fallback);
        let enabled = |key| get(key).and_then(Value::as_bool).unwrap_or(true);
        let result = Self {
            appearance: appearance_config::from_saved(connection, settings)?,
            // This is global saved policy, not a renderer flag or a connection
            // capability default. Missing legacy settings remain disabled.
            allow_downloads: globals
                .get("allowDownloads")
                .map(|value| value.as_bool().ok_or(()))
                .transpose()?
                .unwrap_or(false),
            allow_page_dialogs: globals
                .get("allowPageDialogs")
                .map(|value| value.as_bool().ok_or(()))
                .transpose()?
                .unwrap_or(false),
            capabilities: NativeBrowserCapabilities {
                local_storage_enabled: enabled("localStorageEnabled"),
                databases_enabled: enabled("databasesEnabled"),
                webgl_enabled: enabled("webglEnabled"),
                cookies_enabled: enabled("cookiesEnabled"),
                media_stream_enabled: enabled("mediaStreamEnabled"),
                cross_origin_requests_enabled: enabled("crossOriginRequestsEnabled"),
                website_extensions_enabled: enabled("websiteExtensionsEnabled"),
                hide_automation_indicator: enabled("hideAutomationIndicator"),
            },
            default_zoom_percent: integer("defaultZoomPercent", 100),
            // Global saved policy only; connection overrides and renderer
            // creation payloads cannot grant popups. Match the legacy UI default.
            popup_policy: match globals.get("popupPolicy") {
                None => NativePopupPolicy::Tabs,
                Some(value) if value.as_str() == Some("tabs") => NativePopupPolicy::Tabs,
                Some(value) if value.as_str() == Some("block") => NativePopupPolicy::Block,
                _ => return Err(()),
            },
            initial_load_timeout_seconds: integer("initialLoadTimeoutSeconds", 30),
            document_ready_timeout_seconds: integer("documentReadyTimeoutSeconds", 120),
            minimum_form_fill_delay_ms: integer("minimumFormFillDelayMs", 0),
            minimum_form_submit_delay_ms: integer("minimumFormSubmitDelayMs", 0),
            // Missing saved policy must preserve the native authority's legacy
            // manual-submit default. Only an explicit saved false (at either
            // layer, with connection overrides first) permits automatic submit.
            manual_form_submit: get("manualFormSubmit")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            retention: retention(get("sessionRetention"))?,
        };
        if result.minimum_form_fill_delay_ms + result.minimum_form_submit_delay_ms > 52_000 {
            return Err(());
        }
        Ok(result)
    }

    /// A native-only effective settings view. This never changes saved data or
    /// grants auto-login consent. Call before creating the credential authority.
    pub fn apply_login_defaults(&self, settings: &mut Value) {
        if !settings.is_object() {
            *settings = Value::Object(Map::new());
        }
        if !settings["webBrowser"].is_object() {
            settings["webBrowser"] = Value::Object(Map::new());
        }
        let browser = &mut settings["webBrowser"];
        browser["manualFormSubmit"] = self.manual_form_submit.into();
        browser["minimumFormFillDelayMs"] = self.minimum_form_fill_delay_ms.into();
        browser["minimumFormSubmitDelayMs"] = self.minimum_form_submit_delay_ms.into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn invalid_saved_preferences_return_a_typed_non_disclosing_error() {
        let error = NativeBrowserPreferences::from_saved(
            &json!({}),
            &json!({"webBrowser":{"allowDownloads":"SYNTHETIC_PRIVATE_VALUE"}}),
        )
        .err()
        .expect("malformed saved permission must be rejected");
        assert_eq!(error, InvalidNativeBrowserPreferences);
        assert_eq!(
            error.to_string(),
            "Invalid saved native browser preferences"
        );
        assert!(!format!("{error:?}").contains("SYNTHETIC_PRIVATE_VALUE"));
    }

    #[test]
    fn popups_resolve_only_valid_saved_global_policy() {
        for (settings, expected) in [
            (json!({}), NativePopupPolicy::Tabs),
            (
                json!({"webBrowser":{"popupPolicy":"tabs"}}),
                NativePopupPolicy::Tabs,
            ),
            (
                json!({"webBrowser":{"popupPolicy":"block"}}),
                NativePopupPolicy::Block,
            ),
        ] {
            assert_eq!(
                NativeBrowserPreferences::from_saved(&json!({}), &settings)
                    .unwrap()
                    .popup_policy,
                expected
            );
        }
        for invalid in [json!(null), json!(true), json!("allow"), json!(1)] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({}),
                &json!({"webBrowser":{"popupPolicy":invalid}})
            )
            .is_err());
        }
        assert!(NativeBrowserPreferences::from_saved(
            &json!({"browserSession":{"version":1,"popupPolicy":"tabs"}}),
            &json!({"webBrowser":{"popupPolicy":"block"}})
        )
        .is_err());
    }

    fn capability_values(policy: NativeBrowserCapabilities) -> [bool; 8] {
        [
            policy.local_storage_enabled,
            policy.databases_enabled,
            policy.webgl_enabled,
            policy.cookies_enabled,
            policy.media_stream_enabled,
            policy.cross_origin_requests_enabled,
            policy.website_extensions_enabled,
            policy.hide_automation_indicator,
        ]
    }

    #[test]
    fn dialogs_require_explicit_valid_saved_global_permission() {
        for (settings, expected) in [
            (Value::Null, false),
            (json!({}), false),
            (json!({"webBrowser":{}}), false),
            (json!({"webBrowser":{"allowPageDialogs":false}}), false),
            (json!({"webBrowser":{"allowPageDialogs":true}}), true),
        ] {
            assert_eq!(
                NativeBrowserPreferences::from_saved(&json!({}), &settings)
                    .unwrap()
                    .allow_page_dialogs,
                expected,
            );
        }
        for invalid in [Value::Null, json!("true"), json!(1), json!({}), json!([])] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({}),
                &json!({"webBrowser":{"allowPageDialogs":invalid}}),
            )
            .is_err());
        }
        for allowed in [false, true] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({"browserSession":{"version":1,"allowPageDialogs":true}}),
                &json!({"webBrowser":{"allowPageDialogs":allowed}}),
            )
            .is_err());
        }
    }

    #[test]
    fn xslt_is_a_strict_optional_global_boolean_not_a_connection_capability() {
        for value in [json!(true), json!(false)] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({}),
                &json!({"webBrowser":{"xsltEnabled":value}}),
            )
            .is_ok());
        }
        for invalid in [Value::Null, json!("true"), json!(1), json!({}), json!([])] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({}),
                &json!({"webBrowser":{"xsltEnabled":invalid}}),
            )
            .is_err());
        }
        assert!(NativeBrowserPreferences::from_saved(
            &json!({"browserSession":{"version":1,"xsltEnabled":false}}),
            &json!({}),
        )
        .is_err());
    }

    #[test]
    fn downloads_require_explicit_valid_saved_global_permission() {
        for (settings, expected) in [
            (json!({}), false),
            (json!({"webBrowser":{}}), false),
            (json!({"webBrowser":{"allowDownloads":false}}), false),
            (json!({"webBrowser":{"allowDownloads":true}}), true),
        ] {
            assert_eq!(
                NativeBrowserPreferences::from_saved(&json!({}), &settings)
                    .unwrap()
                    .allow_downloads,
                expected
            );
        }
        for invalid in [Value::Null, json!("true"), json!(1), json!({})] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({}),
                &json!({"webBrowser":{"allowDownloads":invalid}})
            )
            .is_err());
        }
        assert!(NativeBrowserPreferences::from_saved(
            &json!({"browserSession":{"version":1,"allowDownloads":true}}),
            &json!({"webBrowser":{"allowDownloads":false}}),
        )
        .is_err());
    }

    #[test]
    fn capability_defaults_and_sparse_overrides_preserve_every_explicit_boolean() {
        let keys = [
            "localStorageEnabled",
            "databasesEnabled",
            "webglEnabled",
            "cookiesEnabled",
            "mediaStreamEnabled",
            "crossOriginRequestsEnabled",
            "websiteExtensionsEnabled",
            "hideAutomationIndicator",
        ];
        assert_eq!(
            capability_values(
                NativeBrowserPreferences::from_saved(&json!({}), &json!({}))
                    .unwrap()
                    .capabilities
            ),
            [true; 8]
        );
        for (index, key) in keys.into_iter().enumerate() {
            for global in [None, Some(false), Some(true)] {
                for local in [None, Some(false), Some(true)] {
                    let mut settings = json!({"webBrowser":{"manualFormSubmit":false}});
                    let mut connection =
                        json!({"browserSession":{"version":1,"defaultZoomPercent":110}});
                    if let Some(value) = global {
                        settings["webBrowser"][key] = value.into();
                    }
                    if let Some(value) = local {
                        connection["browserSession"][key] = value.into();
                    }
                    let parsed =
                        NativeBrowserPreferences::from_saved(&connection, &settings).unwrap();
                    let mut expected = [true; 8];
                    expected[index] = local.or(global).unwrap_or(true);
                    assert_eq!(
                        capability_values(parsed.capabilities),
                        expected,
                        "{key}: {global:?}/{local:?}"
                    );
                    assert!(!parsed.manual_form_submit);
                    assert_eq!(parsed.default_zoom_percent, 110);
                }
            }
            let mut settings = json!({"webBrowser":{}});
            let mut connection = json!({"browserSession":{"version":1}});
            settings["webBrowser"][key] = "false".into();
            connection["browserSession"][key] = true.into();
            assert!(
                NativeBrowserPreferences::from_saved(&connection, &settings).is_err(),
                "masked invalid {key}"
            );
        }
    }

    #[test]
    fn missing_legacy_fields_are_ephemeral_and_connection_fields_inherit() {
        let defaults = NativeBrowserPreferences::from_saved(&json!({}), &Value::Null).unwrap();
        assert_eq!(defaults.default_zoom_percent, 100);
        assert_eq!(defaults.retention["mode"], "ephemeral");
        assert!(defaults.manual_form_submit);
        let saved = NativeBrowserPreferences::from_saved(
            &json!({"browserSession":{"version":1,"defaultZoomPercent":150,"manualFormSubmit":true}}),
            &json!({"webBrowser":{"version":1,"defaultZoomPercent":90,"initialLoadTimeoutSeconds":45}}),
        ).unwrap();
        assert_eq!(saved.default_zoom_percent, 150);
        assert_eq!(saved.initial_load_timeout_seconds, 45);
        assert!(saved.manual_form_submit);
    }

    #[test]
    fn native_validation_rejects_coercion_unknown_profiles_and_invalid_layers() {
        for overrides in [
            json!({}),
            json!({"version":2}),
            json!({"version":1,"profilePath":"shared"}),
            json!({"version":1,"defaultZoomPercent":"100"}),
            json!({"version":1,"initialLoadTimeoutSeconds":0}),
            json!({"version":1,"sessionRetention":{"mode":"encrypted-local"}}),
            json!({"version":1,"minimumFormFillDelayMs":30000,"minimumFormSubmitDelayMs":30000}),
        ] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({"browserSession":overrides}),
                &json!({})
            )
            .is_err());
        }
        assert!(NativeBrowserPreferences::from_saved(
            &json!({"browserSession":{"version":1,"defaultZoomPercent":100}}),
            &json!({"webBrowser":{"defaultZoomPercent":"broken"}}),
        )
        .is_err());
        assert!(NativeBrowserPreferences::from_saved(
            &json!({"browserSession":{"version":1,"minimumFormFillDelayMs":30000}}),
            &json!({"webBrowser":{"minimumFormSubmitDelayMs":30000}}),
        )
        .is_err());
    }

    #[test]
    fn encrypted_retention_is_complete_bounded_and_replaces_global_policy() {
        let policy = json!({"version":1,"mode":"encrypted-database","idleTimeoutMinutes":120,"maxAgeHours":72,"clearOnDatabaseLock":false});
        let parsed = NativeBrowserPreferences::from_saved(
            &json!({"browserSession":{"version":1,"sessionRetention":policy}}),
            &json!({}),
        )
        .unwrap();
        assert_eq!(parsed.retention, policy);
        for field in [
            "mode",
            "idleTimeoutMinutes",
            "maxAgeHours",
            "clearOnDatabaseLock",
        ] {
            let mut invalid = policy.clone();
            invalid.as_object_mut().unwrap().remove(field);
            assert!(retention(Some(&invalid)).is_err());
        }
        let mut invalid = policy;
        invalid["maxAgeHours"] = 8761.into();
        assert!(retention(Some(&invalid)).is_err());
    }

    #[test]
    fn connection_overrides_cannot_mask_an_invalid_global_delay_budget() {
        let settings = json!({"webBrowser":{
            "minimumFormFillDelayMs":30000,
            "minimumFormSubmitDelayMs":30000
        }});
        for overrides in [
            json!({"version":1,"minimumFormFillDelayMs":0}),
            json!({"version":1,"minimumFormSubmitDelayMs":0}),
            json!({"version":1,"minimumFormFillDelayMs":0,"minimumFormSubmitDelayMs":0}),
        ] {
            assert!(NativeBrowserPreferences::from_saved(
                &json!({"browserSession":overrides}),
                &settings,
            )
            .is_err());
        }
    }

    #[test]
    fn legacy_retention_spelling_migrates_without_changing_policy_values() {
        let old = json!({"version":1,"mode":"encrypted-local","idleTimeoutMinutes":120,"maxAgeHours":72,"clearOnDatabaseLock":true});
        let mut expected = old.clone();
        expected["mode"] = "encrypted-database".into();
        for (connection, settings) in [
            (json!({}), json!({"webBrowser":{"sessionRetention":old}})),
            (
                json!({"browserSession":{"version":1,"sessionRetention":old}}),
                json!({}),
            ),
        ] {
            assert_eq!(
                NativeBrowserPreferences::from_saved(&connection, &settings)
                    .unwrap()
                    .retention,
                expected
            );
        }
        assert_eq!(old["mode"], "encrypted-local");
    }

    #[test]
    fn effective_login_settings_do_not_mutate_saved_records_or_grant_consent() {
        let connection = json!({"httpAutoLogin":false,"browserSession":{"version":1,"manualFormSubmit":true,"minimumFormFillDelayMs":50}});
        let settings = json!({"webBrowser":{"manualFormSubmit":false}});
        let preferences = NativeBrowserPreferences::from_saved(&connection, &settings).unwrap();
        let mut effective = settings.clone();
        preferences.apply_login_defaults(&mut effective);
        assert_eq!(effective["webBrowser"]["manualFormSubmit"], true);
        assert_eq!(effective["webBrowser"]["minimumFormFillDelayMs"], 50);
        assert_eq!(settings["webBrowser"]["manualFormSubmit"], false);
        assert_eq!(connection["httpAutoLogin"], false);
    }
}
