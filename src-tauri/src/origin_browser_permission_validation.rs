//! Fixed, non-disclosing explanations for saved permission rejection. The
//! domain engine's deserializer remains the authority for acceptance; the
//! classifier below runs ONLY after rejection and never recovers saved data.

use super::NativeAuthorityError;
use serde_json::Value;
use sorng_browser_host::domain_permissions::{
    canonical_website_permission_origin, WebsiteDomainPermissionsSettings, WebsiteRequestClass,
    MAX_WEBSITE_PERMISSION_DESTINATIONS, MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS,
    MAX_WEBSITE_PERMISSION_WEBSITES,
};
use std::collections::HashSet;

/// Called only after NativeBrowserPreferences::from_saved rejects. Diagnose
/// known scalar, retention and delay constraints without copying the appearance
/// validator, and never echo a parser's error or input. This cannot accept,
/// normalize or repair a rejected saved configuration.
pub(super) fn preference_error(connection: &Value, settings: &Value) -> NativeAuthorityError {
    let invalid = |scope, rule| NativeAuthorityError::PolicyInvalid { scope, rule };
    for (value, scope, require_version) in [
        (settings.get("webBrowser"), "settings.webBrowser", false),
        (
            connection.get("browserSession"),
            "connection.browserSession",
            true,
        ),
    ] {
        let Some(value) = value else { continue };
        let Some(row) = value.as_object() else {
            return invalid(scope, "must be an object");
        };
        if require_version && row.get("version") != Some(&Value::from(1)) {
            return invalid(scope, "version must be 1");
        }
        if !require_version && row.get("version").is_some_and(|v| v != &Value::from(1)) {
            return invalid(scope, "version must be 1 when present");
        }
        for (field, rule) in [
            (
                "showBookmarksBar",
                "showBookmarksBar must be a boolean when present",
            ),
            (
                "showSecurityInfo",
                "showSecurityInfo must be a boolean when present",
            ),
            (
                "showLoadingProgress",
                "showLoadingProgress must be a boolean when present",
            ),
            (
                "localStorageEnabled",
                "localStorageEnabled must be a boolean when present",
            ),
            (
                "databasesEnabled",
                "databasesEnabled must be a boolean when present",
            ),
            (
                "webglEnabled",
                "webglEnabled must be a boolean when present",
            ),
            (
                "cookiesEnabled",
                "cookiesEnabled must be a boolean when present",
            ),
            (
                "mediaStreamEnabled",
                "mediaStreamEnabled must be a boolean when present",
            ),
            (
                "crossOriginRequestsEnabled",
                "crossOriginRequestsEnabled must be a boolean when present",
            ),
            (
                "websiteExtensionsEnabled",
                "websiteExtensionsEnabled must be a boolean when present",
            ),
            (
                "hideAutomationIndicator",
                "hideAutomationIndicator must be a boolean when present",
            ),
            (
                "manualFormSubmit",
                "manualFormSubmit must be a boolean when present",
            ),
        ] {
            if row.get(field).is_some_and(|v| !v.is_boolean()) {
                return invalid(scope, rule);
            }
        }
        for (field, minimum, maximum, rule) in [
            (
                "defaultZoomPercent",
                50,
                200,
                "defaultZoomPercent must be an integer from 50 to 200 when present",
            ),
            (
                "initialLoadTimeoutSeconds",
                10,
                120,
                "initialLoadTimeoutSeconds must be an integer from 10 to 120 when present",
            ),
            (
                "documentReadyTimeoutSeconds",
                30,
                240,
                "documentReadyTimeoutSeconds must be an integer from 30 to 240 when present",
            ),
            (
                "minimumFormFillDelayMs",
                0,
                30000,
                "minimumFormFillDelayMs must be an integer from 0 to 30000 when present",
            ),
            (
                "minimumFormSubmitDelayMs",
                0,
                30000,
                "minimumFormSubmitDelayMs must be an integer from 0 to 30000 when present",
            ),
        ] {
            if row
                .get(field)
                .is_some_and(|v| !integer_in_range(v, minimum, maximum))
            {
                return invalid(scope, rule);
            }
        }
        if let Some(rule) = row.get("sessionRetention").and_then(retention_rule) {
            return invalid(scope, rule);
        }
        let delay = |field| row.get(field).and_then(Value::as_u64).unwrap_or(0);
        // Each component is already bounded above, so this cannot overflow.
        if delay("minimumFormFillDelayMs") + delay("minimumFormSubmitDelayMs") > 52_000 {
            return invalid(
                scope,
                "minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms",
            );
        }
    }
    let globals = settings.get("webBrowser");
    if globals
        .and_then(|v| v.get("allowDownloads"))
        .is_some_and(|v| !v.is_boolean())
    {
        return invalid(
            "settings.webBrowser",
            "allowDownloads must be a boolean when present",
        );
    }
    if globals
        .and_then(|v| v.get("popupPolicy"))
        .is_some_and(|v| !matches!(v.as_str(), Some("tabs" | "block")))
    {
        return invalid(
            "settings.webBrowser",
            "popupPolicy must be tabs or block when present",
        );
    }
    let effective_delay = |field| {
        connection
            .get("browserSession")
            .and_then(|v| v.get(field))
            .or_else(|| globals.and_then(|v| v.get(field)))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    if effective_delay("minimumFormFillDelayMs") + effective_delay("minimumFormSubmitDelayMs")
        > 52_000
    {
        return invalid("effective.browserSession", "inherited minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms");
    }
    NativeAuthorityError::PreferencesInvalid
}

fn integer_in_range(value: &Value, minimum: u64, maximum: u64) -> bool {
    value
        .as_u64()
        .is_some_and(|number| (minimum..=maximum).contains(&number))
}

fn retention_rule(value: &Value) -> Option<&'static str> {
    let Some(row) = value.as_object() else {
        return Some("sessionRetention must be an object when present");
    };
    if row.get("version") != Some(&Value::from(1)) {
        return Some("sessionRetention.version is required and must be 1");
    }
    // The existing validator accepts encrypted-local on read. Recognize that
    // alias for diagnosis without rewriting the input or changing acceptance.
    if !matches!(
        row.get("mode").and_then(Value::as_str),
        Some("ephemeral" | "memory" | "encrypted-database" | "encrypted-local")
    ) {
        return Some("sessionRetention.mode is required and must be ephemeral, memory, encrypted-database or encrypted-local");
    }
    if row
        .get("idleTimeoutMinutes")
        .is_none_or(|v| !integer_in_range(v, 0, 10080))
    {
        return Some("sessionRetention.idleTimeoutMinutes is required and must be an integer from 0 to 10080");
    }
    if row
        .get("maxAgeHours")
        .is_none_or(|v| !integer_in_range(v, 1, 8760))
    {
        return Some(
            "sessionRetention.maxAgeHours is required and must be an integer from 1 to 8760",
        );
    }
    if row
        .get("clearOnDatabaseLock")
        .is_none_or(|v| !v.is_boolean())
    {
        return Some("sessionRetention.clearOnDatabaseLock is required and must be a boolean");
    }
    if row.keys().any(|key| {
        !matches!(
            key.as_str(),
            "version" | "mode" | "idleTimeoutMinutes" | "maxAgeHours" | "clearOnDatabaseLock"
        )
    }) {
        return Some("sessionRetention contains an unsupported field");
    }
    None
}

pub(super) fn validate_capabilities(
    connection: &Value,
    capabilities: sorng_browser_host::native_capabilities::NativeBrowserCapabilities,
) -> Result<(), NativeAuthorityError> {
    capabilities.validate().map_err(|_| {
        let (field, rule) = if !capabilities.databases_enabled {
            (
                "databasesEnabled",
                "databasesEnabled=false is unsupported by the native browser",
            )
        } else if !capabilities.webgl_enabled {
            (
                "webglEnabled",
                "webglEnabled=false is unsupported by the native browser",
            )
        } else {
            return NativeAuthorityError::CapabilitiesInvalid;
        };
        NativeAuthorityError::PolicyInvalid {
            scope: if connection
                .get("browserSession")
                .and_then(|v| v.get(field))
                .is_some()
            {
                "connection.browserSession"
            } else {
                "settings.webBrowser"
            },
            rule,
        }
    })
}

pub(super) fn permission_settings(
    value: Option<&Value>,
    scope: &'static str,
) -> Result<Option<WebsiteDomainPermissionsSettings>, NativeAuthorityError> {
    value
        .map(|value| {
            serde_json::from_value(value.clone()).map_err(|_| NativeAuthorityError::PolicyInvalid {
                scope,
                rule: domain_shape(value)
                    .err()
                    .unwrap_or("domain permission schema validation failed"),
            })
        })
        .transpose()
}

pub(super) fn validate_proxy_policy(
    policy: &Value,
    scope: &'static str,
) -> Result<(), NativeAuthorityError> {
    // Broad source defaults are connection-only, never inherited app-wide.
    // Page CSP is preserved by the real-origin engine.
    let rule = if !policy.is_object() {
        "must be an object"
    } else if policy.get("version").is_some_and(|v| v != &Value::from(1)) {
        "version must be 1 when present"
    } else if policy.get("pageScripts").is_some_and(|v| v != "allow") {
        "pageScripts must be allow when present"
    } else if policy
        .get("allowAllRequests")
        .is_some_and(|v| !v.is_boolean())
    {
        "allowAllRequests must be a boolean when present"
    } else if scope == "settings.webBrowser.defaultPolicy"
        && policy.get("allowAllRequests") == Some(&Value::Bool(true))
    {
        "allowAllRequests is connection-only"
    } else if policy
        .get("allowAllScripts")
        .is_some_and(|v| !v.is_boolean())
    {
        "allowAllScripts must be a boolean when present"
    } else if scope == "settings.webBrowser.defaultPolicy"
        && policy.get("allowAllScripts") == Some(&Value::Bool(true))
    {
        "allowAllScripts is connection-only"
    } else if policy.get("httpsOnly").is_some_and(|v| !v.is_boolean()) {
        "httpsOnly must be a boolean when present"
    } else if policy
        .get("sameOriginOnly")
        .is_some_and(|v| !v.is_boolean())
    {
        "sameOriginOnly must be a boolean when present"
    } else if policy.get("allowHttpDowngradeRedirects").is_some_and(|v| !v.is_boolean()) {
        "allowHttpDowngradeRedirects must be a boolean when present"
    } else if policy
        .get("queryParameters")
        .is_some_and(|v| v.as_array().is_none_or(|v| !v.is_empty()))
    {
        "queryParameters must be an empty array when present"
    } else {
        return Ok(());
    };
    Err(NativeAuthorityError::PolicyInvalid { scope, rule })
}

pub(super) fn validate_temporary_http_policy(policy: &Value) -> Result<(), NativeAuthorityError> {
    validate_proxy_policy(policy, "settings.webBrowser.defaultPolicy")?;
    let rule = if !policy.is_object() {
        "must be an object"
    } else if policy
        .get("httpsOnly")
        .is_some_and(|v| v != &Value::Bool(false))
    {
        "httpsOnly must be false when present for temporary HTTP"
    } else if policy.get("pageScripts").is_some_and(|v| v != "allow") {
        "pageScripts must be allow when present"
    } else {
        return Ok(());
    };
    Err(NativeAuthorityError::PolicyInvalid {
        scope: "settings.webBrowser.defaultPolicy",
        rule,
    })
}

fn domain_shape(value: &Value) -> Result<(), &'static str> {
    let settings = value
        .as_object()
        .ok_or("must match the domain permission object schema")?;
    if settings
        .keys()
        .any(|key| !matches!(key.as_str(), "version" | "websites"))
    {
        return Err("domain permission object contains an unsupported field");
    }
    if settings.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("version must be 1");
    }
    let websites = settings
        .get("websites")
        .and_then(Value::as_array)
        .ok_or("websites must be an array")?;
    if websites.len() > MAX_WEBSITE_PERMISSION_WEBSITES {
        return Err("websites must contain at most 64 entries");
    }
    let mut seen_websites = HashSet::new();
    let mut total = 0;
    for website in websites {
        let row = website.as_object().ok_or("websites[] must be an object")?;
        if row
            .keys()
            .any(|key| !matches!(key.as_str(), "origin" | "requestClasses" | "destinations"))
        {
            return Err("websites[] contains an unsupported field");
        }
        let origin_error = "websites[].origin must be an exact HTTPS origin";
        let origin = row
            .get("origin")
            .and_then(Value::as_str)
            .ok_or(origin_error)?;
        let origin = canonical_website_permission_origin(origin).map_err(|_| origin_error)?;
        if !seen_websites.insert(origin) {
            return Err("websites[].origin must be unique after canonicalization");
        }
        classes(row.get("requestClasses"), false)?;
        let Some(destinations) = row.get("destinations") else {
            continue;
        };
        let destinations = destinations
            .as_array()
            .ok_or("websites[].destinations must be an array")?;
        if destinations.len() > MAX_WEBSITE_PERMISSION_DESTINATIONS {
            return Err("websites[].destinations must contain at most 32 entries");
        }
        total += destinations.len();
        if total > MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS {
            return Err("websites[].destinations must total at most 256 entries");
        }
        let mut seen_destinations = HashSet::new();
        for destination in destinations {
            let row = destination
                .as_object()
                .ok_or("websites[].destinations[] must be an object")?;
            if row
                .keys()
                .any(|key| !matches!(key.as_str(), "origin" | "requestClasses"))
            {
                return Err("websites[].destinations[] contains an unsupported field");
            }
            let origin_error = "websites[].destinations[].origin must be an exact HTTPS origin";
            let origin = row
                .get("origin")
                .and_then(Value::as_str)
                .ok_or(origin_error)?;
            let origin = canonical_website_permission_origin(origin).map_err(|_| origin_error)?;
            if !seen_destinations.insert(origin) {
                return Err(
                    "websites[].destinations[].origin must be unique after canonicalization",
                );
            }
            classes(row.get("requestClasses"), true)?;
        }
    }
    Ok(())
}

fn classes(value: Option<&Value>, destination: bool) -> Result<(), &'static str> {
    let Some(value) = value else { return Ok(()) };
    let row = value.as_object().ok_or(if destination {
        "websites[].destinations[].requestClasses must be an object"
    } else {
        "websites[].requestClasses must be an object"
    })?;
    for (class, setting) in row {
        if WebsiteRequestClass::parse(class).is_none() {
            return Err(if destination {
                "websites[].destinations[].requestClasses contains an unsupported request class"
            } else {
                "websites[].requestClasses contains an unsupported request class"
            });
        }
        if !matches!(setting.as_str(), Some("inherit" | "allow" | "deny")) {
            return Err(if destination {
                "websites[].destinations[].requestClasses decisions must be inherit, allow or deny"
            } else {
                "websites[].requestClasses decisions must be inherit, allow or deny"
            });
        }
    }
    Ok(())
}
