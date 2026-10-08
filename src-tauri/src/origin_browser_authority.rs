//! Native saved-owner authorization. No Tauri commands, renderer-selected
//! routes, global connection lookup, credential Debug or serialization.
//!
//! Call `authorize_create` on the async command path. Retain `lease`; check
//! `is_current` from callbacks and a runtime timer, revoke the host AND relay
//! when false. Call `lease.recheck` before commands and after asynchronous host
//! startup. A lease never upgrades an existing immutable attempt's policy.

use crate::database_protection::native_browser_owner;
use base64::Engine;
use serde_json::Value;
use sorng_browser_host::{
    domain_permissions::{
        canonical_website_permission_origin, WebsiteDestinationPermissions,
        WebsiteDomainPermissionsSettings, WebsiteOriginPermissions, WebsitePermissionDecision,
        WebsitePermissionEngine, WebsitePermissionQuery, WebsitePermissionSetting,
        WebsiteRequestClass,
    },
    ipc::{OriginBrowserConsent, OriginBrowserCreateRequest},
};
use sorng_encryption::EncryptionState;
use sorng_protocols::{
    origin_browser::{BrowserIdentity, OriginBrowserPolicy},
    private_forward_proxy::{Authority, BoxedStream, DialFuture, RouteDialer},
};
use sorng_socket_transport::{Route, SocketConnector, SocketTarget, TcpOptions};
use std::{
    collections::BTreeMap,
    io,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};
use tauri::{Runtime, WebviewWindow};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use url::Url;
use zeroize::Zeroizing;

pub use native_browser_owner::NativeOwnerLease;
#[path = "origin_browser_preferences.rs"]
mod preferences;
#[path = "origin_browser_extensions.rs"]
pub mod extensions;
#[cfg(test)]
#[path = "origin_browser_extensions_tests.rs"]
mod extension_tests;
#[path = "origin_browser_prewarm.rs"]
pub mod prewarm;
pub use preferences::NativeBrowserPreferences;
#[path = "origin_browser_automation_authority.rs"]
mod automation;
pub use automation::NativeAutomationAuthority;
#[path = "origin_browser_certificates.rs"]
mod certificates;
#[path = "origin_browser_credentials.rs"]
mod credentials;
#[path = "origin_browser_totp.rs"]
mod native_totp;
#[path = "origin_browser_basic_auth.rs"]
mod basic_auth;
pub use basic_auth::NativeBasicAuth;
#[path = "origin_browser_routes.rs"]
mod routes;
pub use routes::NativeBrowserRouteServices;
#[cfg(test)]
#[path = "origin_browser_route_tests.rs"]
mod route_tests;
pub use certificates::{
    NativeCertificateAuthority, NativeCertificateDecision, NativeCertificateEvidence,
    NativeCertificatePermit, NativeCertificateReview,
};

// Keep these native-only borrowed DTOs independent of browser-host's optional
// CEF feature. Main's CEF adapter copies the fields into native_features DTOs.
const MAX_CREDENTIAL_BYTES: usize = 4096;
pub struct NativeLoginRequest<'a> {
    pub identity: &'a BrowserIdentity,
    pub origin: &'a str,
}
pub struct NativeLoginCredentials<'a> {
    pub identity: &'a BrowserIdentity,
    pub origin: &'a str,
    pub valid_until: Instant,
    pub username: &'a str,
    pub password: &'a str,
    pub auto_submit: bool,
}

/// Only fixed diagnostics cross the application boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum NativeAuthorityError {
    #[error("Browser creation request is invalid")]
    InvalidRequest,
    #[error("Browser saved database owner is unavailable or changed")]
    OwnerUnavailable,
    #[error("Browser initial URL does not match its saved source")]
    SourceMismatch,
    #[error("Saved browser permission policy is invalid or unsupported")]
    PolicyUnsupported,
    #[error("Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported")]
    CertificatePolicyUnsupported,
    #[error("Saved application entry or login route has no native translation")]
    ApplicationUnsupported,
    #[error("Saved browser network route is invalid or unsupported; no direct fallback")]
    RouteUnsupported,
    #[error("Saved website credentials are unavailable or invalid in the owning database; review its credential reference")]
    CredentialUnavailable,
}

/// Native-only immutable snapshot, intentionally without Debug/serde/Clone.
/// This grants network access only, never login submission or credential consent.
pub struct NativeAuthorizedBrowser {
    pub basic_auth: Option<Arc<NativeBasicAuth>>,
    pub policy: OriginBrowserPolicy,
    pub permissions: Arc<WebsitePermissionEngine>,
    pub route: Arc<dyn RouteDialer>,
    pub initial_url: String,
    pub lease: NativeOwnerLease,
    pub login: Arc<NativeLoginAuthority>,
    pub certificates: Arc<NativeCertificateAuthority>,
    pub automation: Arc<NativeAutomationAuthority>,
    pub preferences: NativeBrowserPreferences,
}

/// Native consent provider, bound by main to the saved automatic-login choice.
/// It MUST
/// verify owner/attempt/exact origin, disclosure and optional submission rights
/// and hold the grant valid throughout `deliver`. A renderer grant ID is only
/// a lookup hint, never proof. This callback must not perform DB or network IO.
pub trait NativeLoginConsentVerifier: Send + Sync {
    fn with_current_consent(
        &self,
        identity: &BrowserIdentity,
        origin: &str,
        requested_grant_id: Option<&str>,
        deliver: &mut dyn FnMut(Instant, bool),
    );
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeCredentialAvailability {
    Saved,
    Unavailable,
    UnsupportedCredentialSource,
}

/// Secret-bearing callback adapter, never Debug/serde. Credentials are borrowed
/// only after a trusted native verifier supplies a live attempt-scoped grant.
pub struct NativeLoginAuthority {
    identity: BrowserIdentity,
    enabled: bool,
    application_id: String,
    supports_default_adapter: bool,
    form_configuration: Option<String>,
    form_options: Option<Zeroizing<String>>,
    origins: Vec<String>,
    lease: NativeOwnerLease,
    requested_grant_id: Option<Zeroizing<String>>,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
    availability: NativeCredentialAvailability,
    manual_submit: bool,
    totp: Option<native_totp::NativeTotpAuthority>,
}

impl NativeLoginAuthority {
    /// Effective saved opt-in. The request flag can never enable saved opt-out;
    /// current IPC validation requires that flag true even for saved manual mode.
    /// Profile form mode opts in; manual/absent profile mode does not. Legacy
    /// connections without a profile use their saved httpAutoLogin flag.
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Presentation bound for native consent; the verifier may further deny
    /// submission. This does not itself authorize disclosure or submission.
    pub fn auto_submit_allowed(&self) -> bool {
        self.enabled && !self.manual_submit
    }

    pub fn application_id(&self) -> &str {
        &self.application_id
    }

    /// False when saved custom selectors/automation require another adapter.
    pub fn supports_default_adapter(&self) -> bool {
        self.supports_default_adapter
    }

    /// Native-owned non-secret setup JSON; never accepts renderer configuration.
    pub fn form_configuration(&self) -> Option<&str> {
        self.form_configuration.as_deref()
    }

    pub fn revoke_totp(&self) {
        if let Some(totp) = &self.totp { totp.revoke(); }
    }

    pub fn totp_current(&self, request: &sorng_browser_host::native_totp::NativeTotpRequest<'_>,
        verifier: &dyn NativeLoginConsentVerifier, submit: bool) -> bool {
        if !self.enabled || !self.supports_default_adapter || self.availability != NativeCredentialAvailability::Saved
            || !self.totp.as_ref().is_some_and(|totp| totp.current(request)) { return false; }
        let mut current = false;
        verifier.with_current_consent(request.identity, request.origin, self.requested_grant_id.as_deref().map(String::as_str), &mut |until, auto| {
            current = Instant::now() < until && (!submit || (auto && !self.manual_submit));
        });
        current
    }

    pub fn with_totp(&self, request: &sorng_browser_host::native_totp::NativeTotpRequest<'_>,
        verifier: &dyn NativeLoginConsentVerifier,
        deliver: &mut dyn FnMut(sorng_browser_host::native_totp::NativeTotpCode<'_>)) -> Option<Duration> {
        if !self.totp_current(request, verifier, false) { return None; }
        let mut wait = None;
        let mut checked = false;
        verifier.with_current_consent(request.identity, request.origin, self.requested_grant_id.as_deref().map(String::as_str), &mut |until, auto| {
            if checked { return; }
            checked = true;
            if let Some(totp) = &self.totp { wait = totp.with_code(request, until, auto && !self.manual_submit, deliver); }
        });
        wait
    }

    /// Literal extra-field values are credential material. Release only under
    /// the SAME exact-owner/origin consent checks as the username/password.
    pub fn with_form_credentials(
        &self,
        request: &NativeLoginRequest<'_>,
        verifier: &dyn NativeLoginConsentVerifier,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
    ) {
        self.with_credentials(request, verifier, &mut |credentials| {
            deliver(
                credentials,
                self.form_options.as_ref().map(|options| options.as_str()),
            );
        });
    }

    /// Exact credential disclosure candidates for main's attempt authorization.
    /// These are NOT consent grants and intentionally exclude resource origins.
    pub fn consent_origins(&self) -> &[String] {
        &self.origins
    }

    pub fn availability(&self) -> NativeCredentialAvailability {
        self.availability
    }

    pub fn with_credentials(
        &self,
        request: &NativeLoginRequest<'_>,
        verifier: &dyn NativeLoginConsentVerifier,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
    ) {
        if !self.enabled
            || self.availability != NativeCredentialAvailability::Saved
            || !self.supports_default_adapter
            || request.identity != &self.identity
            || !self.lease.is_current()
            || !self.origins.iter().any(|origin| origin == request.origin)
            || canonical_website_permission_origin(request.origin).as_deref() != Ok(request.origin)
        {
            return;
        }
        let mut delivered = false;
        verifier.with_current_consent(
            &self.identity,
            request.origin,
            self.requested_grant_id.as_ref().map(|s| s.as_str()),
            &mut |valid_until, auto_submit| {
                if delivered || valid_until <= Instant::now() || !self.lease.is_current() {
                    return;
                }
                delivered = true;
                deliver(NativeLoginCredentials {
                    identity: &self.identity,
                    origin: request.origin,
                    valid_until,
                    username: &self.username,
                    password: &self.password,
                    auto_submit: auto_submit && !self.manual_submit,
                });
            },
        );
    }
}

/// Reviewed defaults are generated from the legacy application catalog and
/// parity-tested against that catalog. Unknown/staged/manual profiles never
/// fall back to heuristic filling. Saved overrides remain authoritative.
fn saved_form_configuration(
    connection: &Value,
    application_id: &str,
) -> Result<Option<(String, String)>, ()> {
    static CATALOG: LazyLock<Value> = LazyLock::new(|| {
        serde_json::from_str(include_str!(
            "../crates/sorng-browser-host/src/native_login_catalog.json"
        ))
        .expect("reviewed native login catalog")
    });
    let profile = &CATALOG["profiles"][application_id];
    if profile.get("loginFlow").is_some()
        || profile["emailOnly"] == true
        || !matches!(
            profile["capability"].as_str(),
            Some("known-form" | "generic-form" | "custom-form")
        )
    {
        return Ok(None);
    }
    if connection.pointer("/httpApplication/invalid") == Some(&Value::Bool(true)) {
        return Err(());
    }
    if application_id == "proxmox" {
        if let Some(realm) = connection.pointer("/httpApplication/realm") {
            let realm = realm.as_str().ok_or(())?;
            if realm.is_empty()
                || realm.len() > 128
                || !realm
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            {
                return Err(());
            }
        }
    }
    let mut selectors = serde_json::Map::new();
    let valid_selector = |value: &Value| {
        value
            .as_str()
            .filter(|text| {
                !text.trim().is_empty()
                    && text.encode_utf16().count() <= 512
                    && !text.chars().any(|c| c.is_control())
            })
            .map(str::to_owned)
            .ok_or(())
    };
    let defaults = if application_id == "joomla" {
        let version = connection
            .pointer("/httpApplication/joomlaVersion")
            .map(|value| value.as_str().ok_or(()))
            .transpose()?
            .unwrap_or("auto");
        CATALOG["joomla"].get(version).ok_or(())?
    } else {
        &profile["selectors"]
    };
    for raw in [Some(defaults), connection.get("httpAutoLoginSelectors")]
        .into_iter()
        .flatten()
        .filter(|v| !v.is_null())
    {
        let raw = raw.as_object().ok_or(())?;
        for (key, value) in raw {
            let name = match key.as_str() {
                "usernameSelector" => "username",
                "passwordSelector" => "password",
                "submitSelector" => "submit",
                _ => return Err(()),
            };
            selectors.insert(name.into(), Value::String(valid_selector(value)?));
        }
    }
    // Explicit custom profiles must not accidentally invoke generic discovery.
    if application_id == "custom"
        && !["username", "password", "submit"]
            .iter()
            .all(|key| selectors.contains_key(*key))
    {
        return Err(());
    }
    let raw = connection
        .get("httpFormAutomation")
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(|| {
            serde_json::json!({
                "version":1,"fillDelayMs":0,"submitDelayMs":0,
                "detectionTimeoutMs":8000,"submit":true,"fields":[]
            })
        });
    let options: sorng_protocols::themed_autologin::HttpFormAutomation =
        serde_json::from_value(raw).map_err(|_| ())?;
    options.validate().map_err(|_| ())?;
    let mut readiness = serde_json::json!({"detectionTimeoutMs":options.detection_timeout_ms});
    if let Some(selector) = &options.form_selector {
        readiness["formSelector"] = selector.clone().into();
    }
    let mut setup = serde_json::json!({"selectors":selectors,"readiness":readiness});
    if application_id == "cpanel" {
        setup["readinessProfile"] = "cpanel".into();
    }
    Ok(Some((
        serde_json::to_string(&setup).map_err(|_| ())?,
        serde_json::to_string(&options).map_err(|_| ())?,
    )))
}

#[cfg(test)]
mod login_configuration_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn effective_browser_minima_reach_ordinary_and_every_reviewed_provider() {
        let settings =
            json!({"webBrowser":{"minimumFormFillDelayMs":3000,"minimumFormSubmitDelayMs":4000}});
        let connection = json!({"httpFormAutomation":{"version":1,"fillDelayMs":5000,"submitDelayMs":10,
            "detectionTimeoutMs":8000,"submit":false,"fields":[]}});
        let (setup, options) = saved_login_configuration(&connection, &settings, "generic-form")
            .unwrap()
            .unwrap();
        let setup: Value = serde_json::from_str(&setup).unwrap();
        let options: Value = serde_json::from_str(&options).unwrap();
        assert_eq!(options["fillDelayMs"], 5000);
        assert_eq!(options["submitDelayMs"], 4000);
        assert_eq!(options["submit"], false);
        assert_eq!(options["detectionTimeoutMs"], 17000);
        assert_eq!(setup["readiness"]["detectionTimeoutMs"], 17000);
        assert_eq!(connection["httpFormAutomation"]["submitDelayMs"], 10);
        for id in [
            "google-account",
            "gmail",
            "bitwarden-self-hosted",
            "vaultwarden",
            "synology-dsm",
            "cloudflare",
            "voip-phone",
            "adobe-admin-console",
            "chatgpt",
            "claude",
        ] {
            let (setup, _) = saved_login_configuration(&json!({}), &settings, id)
                .unwrap()
                .unwrap();
            let setup: Value = serde_json::from_str(&setup).unwrap();
            assert!(setup["provider"].is_string(), "{id}");
            assert_eq!(setup["timing"]["fillDelayMs"], 3000, "{id}");
            assert_eq!(setup["timing"]["submitDelayMs"], 4000, "{id}");
            assert!(saved_login_configuration(
                &json!({"httpAutoLoginSelectors":{"passwordSelector":"#unsafe"}}),
                &settings,
                id
            )
            .is_err());
        }
        assert!(
            saved_login_configuration(&json!({}), &settings, "unknown-app")
                .unwrap()
                .is_none()
        );
        for value in [json!(-1), json!(30001), json!("3000"), json!(null)] {
            assert!(saved_login_configuration(
                &json!({}),
                &json!({"webBrowser":{"minimumFormFillDelayMs":value}}),
                "generic-form"
            )
            .is_err());
        }
    }

    #[test]
    fn reviewed_defaults_overrides_versions_and_staged_exclusions() {
        for id in [
            "nginxProxyMgr",
            "cpanel",
            "porkbun",
            "exchange-owa",
            "instagram",
            "linkedin",
            "freepbx",
        ] {
            assert!(
                saved_form_configuration(&json!({}), id).unwrap().is_some(),
                "{id}"
            );
        }
        let (setup, _) = saved_form_configuration(
            &json!({
                "httpAutoLoginSelectors":{"passwordSelector":"#override"}
            }),
            "nginxProxyMgr",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&setup).unwrap()["selectors"]["password"],
            "#override"
        );
        for version in ["auto", "3", "4", "5", "6"] {
            assert!(saved_form_configuration(
                &json!({"httpApplication":{"joomlaVersion":version}}),
                "joomla"
            )
            .unwrap()
            .is_some());
        }
        assert!(saved_form_configuration(
            &json!({"httpApplication":{"joomlaVersion":"7"}}),
            "joomla"
        )
        .is_err());
        for id in [
            "google-account",
            "synology-dsm",
            "cloudflare",
            "amazon-shopping",
            "http-basic",
        ] {
            assert!(
                saved_form_configuration(&json!({}), id).unwrap().is_none(),
                "{id}"
            );
        }
    }

    #[test]
    fn form_configuration_keeps_literal_values_out_of_setup() {
        let connection = json!({
            "httpAutoLoginSelectors":{"usernameSelector":"#u","passwordSelector":"#p","submitSelector":"#s"},
            "httpFormAutomation":{"version":1,"fillDelayMs":10,"submitDelayMs":20,
                "detectionTimeoutMs":1000,"submit":false,"fields":[{"selector":"#realm","value":"sensitive-value"}]},
            "httpAutomation":{"enabled":true}
        });
        let (setup, options) = saved_form_configuration(&connection, "custom")
            .unwrap()
            .unwrap();
        assert!(!setup.contains("sensitive-value"));
        assert!(!setup.contains("#realm"));
        assert!(setup.contains("#u"));
        assert!(options.contains("sensitive-value"));
        assert_eq!(
            serde_json::from_str::<Value>(&options).unwrap()["submit"],
            false
        );
    }

    #[test]
    fn invalid_or_unknown_configuration_never_becomes_generic() {
        for value in [
            json!([]),
            json!({"unknown":"#u"}),
            json!({"passwordSelector":""}),
            json!({"passwordSelector":"a".repeat(513)}),
        ] {
            assert!(saved_form_configuration(
                &json!({"httpAutoLoginSelectors":value}),
                "generic-form"
            )
            .is_err());
        }
        assert!(saved_form_configuration(&json!({}), "custom").is_err());
        assert!(saved_form_configuration(&json!({}), "unknown-app")
            .unwrap()
            .is_none());
        assert!(saved_form_configuration(&json!({}), "synology-dsm")
            .unwrap()
            .is_none());
        assert!(saved_form_configuration(
            &json!({"httpFormAutomation":{
                "version":1,"fillDelayMs":30001,"submitDelayMs":0,
                "detectionTimeoutMs":1000,"submit":true,"fields":[]
            }}),
            "generic-form"
        )
        .is_err());
    }
}

/// Resolved browser minima are non-secret setup metadata. They never extend a
/// credential grant: adapters wait before requesting fields and obtain fresh
/// native consent for each deferred submission.
fn saved_login_configuration(
    connection: &Value,
    settings: &Value,
    application_id: &str,
) -> Result<Option<(String, String)>, ()> {
    let minimum = |key: &str| -> Result<u64, ()> {
        match settings.pointer(&format!("/webBrowser/{key}")) {
            None => Ok(0),
            Some(value) => value.as_u64().filter(|value| *value <= 30_000).ok_or(()),
        }
    };
    let fill = minimum("minimumFormFillDelayMs")?;
    let submit = minimum("minimumFormSubmitDelayMs")?;
    if let Some((setup, options)) = saved_form_configuration(connection, application_id)? {
        let mut setup: Value = serde_json::from_str(&setup).map_err(|_| ())?;
        let mut options: Value = serde_json::from_str(&options).map_err(|_| ())?;
        let fill = fill.max(options["fillDelayMs"].as_u64().ok_or(())?);
        let submit = submit.max(options["submitDelayMs"].as_u64().ok_or(())?);
        let detection = options["detectionTimeoutMs"]
            .as_u64()
            .ok_or(())?
            .max((fill + submit + 8_000).min(60_000));
        options["fillDelayMs"] = fill.into();
        options["submitDelayMs"] = submit.into();
        options["detectionTimeoutMs"] = detection.into();
        setup["readiness"]["detectionTimeoutMs"] = detection.into();
        return Ok(Some((setup.to_string(), options.to_string())));
    }
    // This closed list mirrors NativeLoginAdapter; unknown/manual providers
    // never acquire a generic-form configuration through timing preferences.
    let provider = match application_id {
        "bitwarden-self-hosted" | "vaultwarden" => "bitwarden-self-hosted",
        "synology-dsm"
        | "cloudflare"
        | "voip-phone"
        | "adobe-admin-console"
        | "chatgpt"
        | "claude" => application_id,
        id if GOOGLE_ROUTES["profiles"].get(id).is_some() => "google-account",
        _ => return Ok(None),
    };
    if connection.pointer("/httpApplication/invalid") == Some(&Value::Bool(true))
        || connection
            .get("httpAutoLoginSelectors")
            .is_some_and(|value| {
                !value.is_null() && !value.as_object().is_some_and(|row| row.is_empty())
            })
        || connection
            .get("httpFormAutomation")
            .is_some_and(|value| !value.is_null())
    {
        return Err(());
    }
    Ok(Some((
        serde_json::json!({"provider":provider,"timing":{"fillDelayMs":fill,"submitDelayMs":submit}}).to_string(),
        serde_json::json!({"version":1,"fillDelayMs":0,"submitDelayMs":0,"detectionTimeoutMs":8000,"submit":true,"fields":[]}).to_string(),
    )))
}

fn saved_login(
    connection: &Value,
    settings: &Value,
    request: &OriginBrowserCreateRequest,
    policy: &OriginBrowserPolicy,
    lease: &NativeOwnerLease,
) -> NativeLoginAuthority {
    let enabled = extensions::saved_app_extensions_enabled(connection, settings).unwrap_or(false)
        && request.policy.auto_login.enabled
        && match connection.get("httpApplication") {
            None => connection.get("httpAutoLogin") == Some(&Value::Bool(true)),
            Some(application) => {
                application.get("loginMode").and_then(Value::as_str) == Some("form")
            }
        };
    let application_id = connection
        .pointer("/httpApplication/id")
        .and_then(Value::as_str)
        .unwrap_or("generic-form");
    let (availability, selected) = match credentials::vault_id(connection) {
        Ok(None) => match credentials::local(connection) {
            Ok(selected) => (selected.availability(connection), Some(selected)),
            Err(_) => (NativeCredentialAvailability::Unavailable, None),
        },
        _ => (
            NativeCredentialAvailability::UnsupportedCredentialSource,
            None,
        ),
    };
    let available = enabled && availability == NativeCredentialAvailability::Saved;
    let selected = selected
        .filter(|_| available)
        .unwrap_or_else(|| credentials::Credentials {
            username: Zeroizing::new(String::new()),
            password: Zeroizing::new(String::new()),
        });
    let selectors_supported = connection
        .get("httpAutoLoginSelectors")
        .is_none_or(|value| value.is_null() || value.as_object().is_some_and(|row| row.is_empty()));
    let form = saved_login_configuration(connection, settings, application_id);
    let supports_default_adapter = (form.is_ok() && form.as_ref().is_ok_and(Option::is_some)
        || (selectors_supported
            && connection
                .get("httpFormAutomation")
                .is_none_or(Value::is_null)))
        && form.is_ok()
        && !matches!(
            connection
                .pointer("/httpApplication/loginMode")
                .and_then(Value::as_str),
            Some("basic" | "digest")
        );
    let google_login =
        GOOGLE_ROUTES["profiles"][application_id].as_str() == Some(policy.source_origin());
    // Google product/document routes are not password-entry authorities. Even
    // the source (Studio, Gmail, etc.) and www.google.com cannot get secrets.
    let mut origins = if google_login || !enabled {
        Vec::new()
    } else {
        vec![policy.source_origin().to_owned()]
    };
    let mut add_origin = |value: &str| {
        if let Ok(origin) = canonical_website_permission_origin(value) {
            if policy.allowed_origins().contains(&origin) && !origins.contains(&origin) {
                origins.push(origin);
            }
        }
    };
    if google_login && enabled {
        add_origin("https://accounts.google.com");
    }
    if enabled
        && !google_login
        && connection
            .pointer("/httpRedirectAuthentication/version")
            .and_then(Value::as_u64)
            == Some(1)
        && connection
            .pointer("/httpRedirectAuthentication/mode")
            .and_then(Value::as_str)
            == Some("saved-login")
    {
        if let Some(values) = connection
            .pointer("/httpTrustedRedirectDestinations/origins")
            .and_then(Value::as_array)
        {
            for value in values {
                if let Some(origin) = value.as_str() {
                    add_origin(origin);
                }
            }
        }
    }
    NativeLoginAuthority {
        identity: policy.identity().clone(),
        enabled,
        application_id: application_id.into(),
        supports_default_adapter,
        form_configuration: form
            .as_ref()
            .ok()
            .and_then(|form| form.as_ref().map(|(setup, _)| setup.clone())),
        form_options: form
            .ok()
            .flatten()
            .map(|(_, options)| Zeroizing::new(options)),
        origins,
        lease: lease.clone(),
        requested_grant_id: match &request.policy.auto_login.consent {
            OriginBrowserConsent::Required {} => None,
            OriginBrowserConsent::ExistingGrant { grant_id } => {
                Some(Zeroizing::new(grant_id.clone()))
            }
        },
        username: selected.username,
        password: selected.password,
        availability,
        totp: None,
        manual_submit: settings
            .pointer("/webBrowser/manualFormSubmit")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    }
}

pub async fn authorize_create<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    request: &OriginBrowserCreateRequest,
) -> Result<NativeAuthorizedBrowser, NativeAuthorityError> {
    authorize_create_inner(window, state, request, false).await
}

/// Main may use this only with a native host gate that verifies EVERY actual
/// handshake against `certificates`, including CA-valid handshakes, and pauses
/// network admission for native review. Error-only callbacks are insufficient.
pub async fn authorize_create_with_certificate_hooks<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    request: &OriginBrowserCreateRequest,
) -> Result<NativeAuthorizedBrowser, NativeAuthorityError> {
    authorize_create_inner(window, state, request, true).await
}

async fn authorize_create_inner<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    request: &OriginBrowserCreateRequest,
    certificate_hooks: bool,
) -> Result<NativeAuthorizedBrowser, NativeAuthorityError> {
    request
        .validate()
        .map_err(|_| NativeAuthorityError::InvalidRequest)?;
    let (connection, lease) = if let Some(quick) = &request.quick_connect {
        // Deliberately narrow input: no database/vault references, scripts,
        // route credentials or retention preferences may be supplied here.
        let connection = serde_json::json!({
            "id": request.owner.connection_id,
            "protocol": quick.protocol,
            "hostname": quick.hostname,
            "port": quick.port,
            "httpVerifySsl": quick.http_verify_ssl,
            "httpAutoLogin": false,
        });
        let lease = native_browser_owner::temporary(window, state, request, &connection)
            .map_err(|_| NativeAuthorityError::OwnerUnavailable)?;
        (connection, lease)
    } else {
        native_browser_owner::read(
        window,
        state,
        &request.owner.owner_database_id,
        &request.owner.connection_id,
        &request.expected_security_revision,
        &request.source_session_id,
    )
    .await
        .map_err(|_| NativeAuthorityError::OwnerUnavailable)?
    };
    let initial_url = saved_source(&connection)?;
    let requested =
        Url::parse(&request.initial_url).map_err(|_| NativeAuthorityError::SourceMismatch)?;
    if initial_url != requested {
        return Err(NativeAuthorityError::SourceMismatch);
    }
    let mut settings =
        crate::app_settings_commands::read_app_settings_inner(lease.profile_root(), state)
            .await
            .map_err(|_| NativeAuthorityError::PolicyUnsupported)?
            .unwrap_or(Value::Null);
    let preferences = NativeBrowserPreferences::from_saved(&connection, &settings)
        .map_err(|_| NativeAuthorityError::PolicyUnsupported)?;
    preferences
        .capabilities
        .validate()
        .map_err(|_| NativeAuthorityError::PolicyUnsupported)?;
    preferences.apply_login_defaults(&mut settings);
    let (permissions, mut allowed_origins) = if lease.is_temporary() && initial_url.scheme() == "http" {
        let policy = settings.pointer("/webBrowser/defaultPolicy");
        if policy.is_some_and(|p| !p.is_object()
            || p.get("httpsOnly").is_some_and(|v| v != &Value::Bool(false))
            || p.get("pageScripts").is_some_and(|v| v != "allow")) {
            return Err(NativeAuthorityError::PolicyUnsupported);
        }
        let defaults = CLASSES.iter().map(|(class, _)| (*class, WebsitePermissionDecision::Allow)).collect();
        let source = initial_url.origin().ascii_serialization();
        (WebsitePermissionEngine::temporary_http(&source, &defaults)
            .map_err(|_| NativeAuthorityError::PolicyUnsupported)?, vec![source])
    } else if certificate_hooks {
        saved_permissions_inner(&connection, &settings, &initial_url, true)?
    } else {
        saved_permissions(&connection, &settings, &initial_url)?
    };
    let permissions = permissions
        .restrict_cross_origin_requests(preferences.capabilities.cross_origin_requests_enabled);
    if !preferences.capabilities.cross_origin_requests_enabled {
        // Restrict the relay's native authority too, not just CEF callbacks.
        let source = initial_url.origin().ascii_serialization();
        allowed_origins.retain(|origin| origin == &source);
    }
    let origins: Vec<&str> = allowed_origins.iter().map(String::as_str).collect();
    let policy = OriginBrowserPolicy::new_with_allowed_origins(
        &request.owner.owner_database_id,
        &request.owner.connection_id,
        &request.owner.session_id,
        &initial_url.origin().ascii_serialization(),
        &origins,
    )
    .map_err(|_| NativeAuthorityError::PolicyUnsupported)?;
    let expanded_route = routes::expand(window, state, &connection, &lease).await?;
    let hops = Arc::new(saved_route(&expanded_route)?);
    let route_lease = lease.clone();
    let grant = policy.destination_grant();
    let route: Arc<dyn RouteDialer> = Arc::new(move |target: Authority| -> DialFuture {
        let hops = hops.clone();
        let lease = route_lease.clone();
        let granted = grant(&target);
        Box::pin(async move {
            if !granted || !lease.is_current() {
                return Err(route_error());
            }
            let stream = tokio::time::timeout(Duration::from_secs(30), dial_route(&hops, &target))
                .await
                .map_err(|_| route_error())??;
            if !lease.is_current() {
                return Err(route_error());
            }
            Ok(stream)
        })
    });
    // Settings and route parsing may race lock/rotation/saved edits.
    lease
        .recheck(window, state)
        .await
        .map_err(|_| NativeAuthorityError::OwnerUnavailable)?;
    let mut login = saved_login(&connection, &settings, request, &policy, &lease);
    if login.enabled() {
        let selected = credentials::resolve(&connection, &lease, window, state).await?;
        login.availability = selected.availability(&connection);
        login.username = selected.username;
        login.password = selected.password;
        login.totp = native_totp::NativeTotpAuthority::resolve(&connection, &login, window, state).await?;
        if let Some(totp) = &login.totp {
            let mut setup: Value = login.form_configuration.as_ref()
                .and_then(|v| serde_json::from_str(v).ok()).ok_or(NativeAuthorityError::ApplicationUnsupported)?;
            setup["mfa"] = totp.configuration().clone();
            login.form_configuration = Some(setup.to_string());
        }
    }
    let login = Arc::new(login);
    let certificates = Arc::new(NativeCertificateAuthority::new(
        &connection,
        &settings,
        &policy,
        &lease,
    )?);
    Ok(NativeAuthorizedBrowser {
        basic_auth: request.quick_connect.as_ref()
            .map(|quick| NativeBasicAuth::new(quick, &policy, &lease))
            .transpose()?.flatten(),
        automation: Arc::new(NativeAutomationAuthority::new(
            &connection,
            &lease,
            preferences.capabilities.website_extensions_enabled,
        )),
        policy,
        permissions: Arc::new(permissions),
        route,
        initial_url: initial_url.into(),
        lease,
        login,
        certificates,
        preferences,
    })
}

static GOOGLE_ROUTES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../src/utils/protocol/googleHostedRoutes.json"
    ))
    .expect("reviewed bundled Google route manifest")
});

static APPLICATION_TARGETS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../src/utils/protocol/originBrowserApplicationTargets.json"
    ))
    .expect("reviewed bundled browser application targets")
});

fn google_entry(connection: &Value) -> Option<String> {
    let id = connection.pointer("/httpApplication/id")?.as_str()?;
    GOOGLE_ROUTES.get("profiles")?.get(id)?.as_str()?;
    APPLICATION_TARGETS["profiles"][id]["hostedLoginUrl"]
        .as_str()
        .map(str::to_owned)
}

fn saved_source(connection: &Value) -> Result<Url, NativeAuthorityError> {
    let error = NativeAuthorityError::SourceMismatch;
    if connection
        .get("isGroup")
        .is_some_and(|v| v != &Value::Bool(false))
    {
        return Err(error);
    }
    let protocol = connection
        .get("protocol")
        .and_then(Value::as_str)
        .ok_or(error)?;
    if !matches!(protocol, "http" | "https") {
        return Err(error);
    }
    if let Some(application) = connection.get("httpApplication") {
        if application.get("version") != Some(&Value::from(1))
            || application.get("invalid").is_some()
        {
            return Err(NativeAuthorityError::ApplicationUnsupported);
        }
    }
    let raw = connection
        .get("hostname")
        .and_then(Value::as_str)
        .ok_or(error)?;
    if let Some(entry) = google_entry(connection) {
        let entry = Url::parse(&entry).map_err(|_| error)?;
        if raw.trim().is_empty()
            || entry
                .host_str()
                .is_some_and(|host| raw.trim().eq_ignore_ascii_case(host))
        {
            return Ok(entry);
        }
    }
    if raw.is_empty()
        || raw.len() > 16_384
        || raw.chars().any(|c| c.is_control() || c.is_whitespace())
        || raw.contains('\\')
    {
        return Err(error);
    }
    let full_url = raw.contains("://");
    if !full_url && raw.contains(['/', '?', '#', '%']) {
        return Err(error);
    }
    let raw_authority = raw
        .split_once("://")
        .map(|(_, value)| value)
        .unwrap_or(raw)
        .split(['/', '?', '#'])
        .next()
        .ok_or(error)?;
    if raw_authority.contains(['%', '@']) {
        return Err(error);
    }
    let port_text = if raw_authority.starts_with('[') {
        raw_authority
            .split_once(']')
            .and_then(|(_, suffix)| suffix.strip_prefix(':'))
    } else {
        raw_authority.split_once(':').map(|(_, port)| port)
    };
    let explicit_port = port_text
        .map(|p| p.parse::<u16>().ok().filter(|p| *p > 0).ok_or(error))
        .transpose()?;
    let mut url = Url::parse(&if full_url {
        raw.into()
    } else {
        format!("{protocol}://{raw}")
    })
    .map_err(|_| error)?;
    if url.scheme() != protocol
        || !url.has_host()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error);
    }
    if url.query() == Some("") {
        url.set_query(None);
    }
    if url.fragment() == Some("") {
        url.set_fragment(None);
    }
    if !full_url {
        let canonical = match explicit_port {
            Some(port) => format!("{}:{port}", url.host_str().ok_or(error)?),
            None => url.host_str().ok_or(error)?.to_owned(),
        };
        if !canonical.eq_ignore_ascii_case(raw_authority) {
            return Err(error);
        }
    }
    if let Some(port) = connection
        .get("port")
        .filter(|v| !v.is_null() && v.as_u64() != Some(0))
    {
        let port = port
            .as_u64()
            .and_then(|p| u16::try_from(p).ok())
            .filter(|p| *p != 0)
            .ok_or(error)?;
        if explicit_port.is_some_and(|old| old != port) {
            return Err(error);
        }
        url.set_port(Some(port)).map_err(|_| error)?;
    }
    if url.port() == Some(0) {
        return Err(error);
    }
    if let Some(application) = connection.get("httpApplication") {
        let id = application
            .get("id")
            .and_then(Value::as_str)
            .ok_or(NativeAuthorityError::ApplicationUnsupported)?;
        let profile = APPLICATION_TARGETS["profiles"]
            .get(id)
            .ok_or(NativeAuthorityError::ApplicationUnsupported)?;
        let saved_path = url.path().to_owned();
        let saved_query = url.query().map(str::to_owned);
        let saved_fragment = url.fragment().map(str::to_owned);
        url.set_path("/");
        url.set_query(None);
        url.set_fragment(None);
        let hosted = profile.get("hostedLoginUrl").and_then(Value::as_str);
        if let Some(hosted) = hosted {
            url.set_path(Url::parse(hosted).map_err(|_| error)?.path());
        } else if let Some(path) = application.get("loginPath") {
            let path = path
                .as_str()
                .ok_or(NativeAuthorityError::ApplicationUnsupported)?;
            if id != "joomla" || !safe_login_path(path) {
                return Err(NativeAuthorityError::ApplicationUnsupported);
            }
            url.set_path(path);
        } else if let Some(path) = profile.get("loginPath").and_then(Value::as_str) {
            url.set_path(path);
        }
        if hosted.is_none()
            && full_url
            && (saved_path != "/" || saved_query.is_some() || saved_fragment.is_some())
        {
            url.set_path(&saved_path);
            url.set_query(saved_query.as_deref());
            url.set_fragment(saved_fragment.as_deref());
        }
        if id == "cloudflare"
            && application.get("loginMode").and_then(Value::as_str) == Some("form")
        {
            url.set_path("/login");
        }
        if profile.get("loginFlow").and_then(Value::as_str) == Some("bitwarden") {
            url.set_fragment(Some("/login"));
        }
        if id == "exchange-owa" {
            apply_owa_mailbox(&mut url, application.get("exchangeOwaMailbox"))?;
        }
    }
    Ok(url)
}

fn safe_login_path(path: &str) -> bool {
    path.starts_with('/')
        && path.len() <= 512
        && !path.starts_with("//")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/._~-".contains(&b))
        && !path.split('/').any(|part| matches!(part, "." | ".."))
        && !path[1..].contains("//")
}

fn apply_owa_mailbox(url: &mut Url, value: Option<&Value>) -> Result<(), NativeAuthorityError> {
    let error = NativeAuthorityError::ApplicationUnsupported;
    if url.scheme() != "https" {
        return Err(error);
    }
    let raw = match value {
        None => "",
        Some(Value::String(value)) => value,
        _ => return Err(error),
    };
    if !raw.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(error);
    }
    let mailbox = raw.trim();
    if !mailbox.is_empty() {
        let (local, domain) = mailbox.split_once('@').ok_or(error)?;
        if mailbox.len() > 254
            || local.len() > 64
            || local.is_empty()
            || domain.len() > 253
            || local.split('.').any(|part| {
                part.is_empty()
                    || !part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_+-".contains(&b))
            })
            || !domain.contains('.')
            || domain.split('.').any(|label| {
                label.is_empty()
                    || label.len() > 63
                    || !label.as_bytes()[0].is_ascii_alphanumeric()
                    || !label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                    || !label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
        {
            return Err(error);
        }
        url.set_path(&format!("/owa/{mailbox}/"));
        url.set_query(None);
        url.set_fragment(None);
    } else if url.path() == "/" && url.query().is_none() && url.fragment().is_none() {
        url.set_path("/owa/");
    }
    Ok(())
}

const CLASSES: [(WebsiteRequestClass, &str); 9] = [
    (WebsiteRequestClass::Script, "script"),
    (WebsiteRequestClass::Stylesheet, "stylesheet"),
    (WebsiteRequestClass::Font, "font"),
    (WebsiteRequestClass::ImageMedia, "image-media"),
    (WebsiteRequestClass::FetchXhr, "fetch-xhr"),
    (WebsiteRequestClass::Frame, "frame"),
    (WebsiteRequestClass::Worker, "worker"),
    (WebsiteRequestClass::Websocket, "websocket"),
    (WebsiteRequestClass::Navigation, "navigation"),
];

fn permission_settings(
    value: Option<&Value>,
) -> Result<Option<WebsiteDomainPermissionsSettings>, NativeAuthorityError> {
    value
        .map(|v| {
            serde_json::from_value(v.clone()).map_err(|_| NativeAuthorityError::PolicyUnsupported)
        })
        .transpose()
}

/// Resolve the destination's existing network scope for an imported cookie
/// snapshot. This is a pure policy check, not browser admission, credential
/// consent or permission to restore cookies without an unlocked owner lease.
pub(crate) fn saved_retention_scope(
    connection: &Value,
    settings: &Value,
) -> Result<(String, Vec<String>), NativeAuthorityError> {
    let source = saved_source(connection)?;
    let (_, mut origins) = saved_permissions_inner(connection, settings, &source, true)?;
    origins.sort();
    origins.dedup();
    Ok((source.origin().ascii_serialization(), origins))
}

fn saved_permissions(
    connection: &Value,
    settings: &Value,
    source: &Url,
) -> Result<(WebsitePermissionEngine, Vec<String>), NativeAuthorityError> {
    saved_permissions_inner(connection, settings, source, false)
}

fn saved_permissions_inner(
    connection: &Value,
    settings: &Value,
    source: &Url,
    certificate_hooks: bool,
) -> Result<(WebsitePermissionEngine, Vec<String>), NativeAuthorityError> {
    let error = NativeAuthorityError::PolicyUnsupported;
    // The existing domain engine deliberately accepts exact HTTPS origins only.
    if source.scheme() != "https" {
        return Err(error);
    }
    if connection
        .get("httpVerifySsl")
        .is_some_and(|v| v != &Value::Bool(true))
    {
        return Err(error);
    }
    // Same HTTPS precedence as resolveEffectiveTrustPolicy in the app shell.
    // CEF's system verifier cannot silently replace TOFU/pin/prompt semantics.
    let trust = certificates::saved_policy(connection, settings)?;
    if !certificate_hooks && trust != sorng_storage::trust_store::TrustPolicy::Strict {
        return Err(NativeAuthorityError::CertificatePolicyUnsupported);
    }
    if settings
        .get("webBrowser")
        .is_some_and(|value| !value.is_object())
    {
        return Err(error);
    }
    // Legacy content-rewriting restrictions cannot be silently lost. Explicit
    // native domain policies are supported; legacy special modes fail closed.
    if let Some(policy) = connection
        .get("httpProxyPolicy")
        .or_else(|| settings.pointer("/webBrowser/defaultPolicy"))
    {
        if !policy.is_object()
            || policy.get("version").is_some_and(|v| v != &Value::from(1))
            || policy.get("pageScripts").is_some_and(|v| v != "allow")
            || policy
                .get("allowAllRequests")
                .is_some_and(|v| v != &Value::Bool(false))
            || policy
                .get("allowAllScripts")
                .is_some_and(|v| v != &Value::Bool(false))
            || policy.get("httpsOnly").is_some_and(|v| !v.is_boolean())
            || policy
                .get("sameOriginOnly")
                .is_some_and(|v| !v.is_boolean())
            || policy
                .get("queryParameters")
                .is_some_and(|v| v.as_array().is_none_or(|v| !v.is_empty()))
        {
            return Err(error);
        }
    }
    let shared = permission_settings(settings.pointer("/webBrowser/domainPermissions"))?;
    let own = permission_settings(connection.get("websiteDomainPermissions"))?;
    let origin = source.origin().ascii_serialization();
    let same_origin = connection
        .get("httpProxyPolicy")
        .or_else(|| settings.pointer("/webBrowser/defaultPolicy"))
        .and_then(|p| p.get("sameOriginOnly"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut candidates: BTreeMap<String, BTreeMap<WebsiteRequestClass, WebsitePermissionDecision>> =
        BTreeMap::new();
    candidates.insert(
        origin.clone(),
        CLASSES
            .iter()
            .map(|(class, _)| (*class, WebsitePermissionDecision::Allow))
            .collect(),
    );
    if !same_origin {
        for settings in [shared.as_ref(), own.as_ref()].into_iter().flatten() {
            for row in &settings.websites {
                if row.origin == origin {
                    for destination in &row.destinations {
                        candidates.entry(destination.origin.clone()).or_default();
                    }
                }
            }
        }
        let mut grant = |destination: &str,
                         classes: &[WebsiteRequestClass]|
         -> Result<(), NativeAuthorityError> {
            let destination =
                canonical_website_permission_origin(destination).map_err(|_| error)?;
            let row = candidates.entry(destination).or_default();
            for class in classes {
                row.insert(*class, WebsitePermissionDecision::Allow);
            }
            Ok(())
        };
        let all: Vec<_> = CLASSES.iter().map(|(class, _)| *class).collect();
        if let Some(redirects) = connection.get("httpTrustedRedirectDestinations") {
            if redirects.get("version") != Some(&Value::from(1)) {
                return Err(error);
            }
            let origins = redirects
                .get("origins")
                .and_then(Value::as_array)
                .ok_or(error)?;
            if origins.len() > 32 {
                return Err(error);
            }
            // Existing trust permits exact-origin anonymous handoffs, not login.
            for value in origins {
                grant(value.as_str().ok_or(error)?, &all)?;
            }
        }
        let policy = connection
            .get("httpProxyPolicy")
            .or_else(|| settings.pointer("/webBrowser/defaultPolicy"));
        let common: Value = serde_json::from_str(include_str!(
            "../../src/utils/protocol/commonResourceOrigins.json"
        ))
        .map_err(|_| error)?;
        let resources = policy
            .and_then(|p| p.get("externalResourceOrigins"))
            .unwrap_or(&common)
            .as_array()
            .ok_or(error)?;
        if resources.len() > 32 {
            return Err(error);
        }
        for row in resources {
            let classes = row
                .get("kinds")
                .and_then(Value::as_array)
                .ok_or(error)?
                .iter()
                .map(|kind| match kind.as_str() {
                    Some("script") => Ok(WebsiteRequestClass::Script),
                    Some("stylesheet") => Ok(WebsiteRequestClass::Stylesheet),
                    _ => Err(error),
                })
                .collect::<Result<Vec<_>, _>>()?;
            grant(
                row.get("origin").and_then(Value::as_str).ok_or(error)?,
                &classes,
            )?;
        }
        if policy
            .and_then(|p| p.get("allowExternalFonts"))
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            let default_fonts = serde_json::json!([
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net"
            ]);
            let fonts = policy
                .and_then(|p| p.get("externalFontOrigins"))
                .unwrap_or(&default_fonts)
                .as_array()
                .ok_or(error)?;
            if fonts.len() > 16 {
                return Err(error);
            }
            for font in fonts {
                grant(
                    font.as_str().ok_or(error)?,
                    &[WebsiteRequestClass::Stylesheet, WebsiteRequestClass::Font],
                )?;
            }
        }
        if google_entry(connection).is_some() {
            let id = connection
                .pointer("/httpApplication/id")
                .and_then(Value::as_str)
                .ok_or(error)?;
            if GOOGLE_ROUTES["profiles"][id].as_str() != Some(origin.as_str()) {
                return Err(NativeAuthorityError::ApplicationUnsupported);
            }
            // Match the reviewed hosted-route document boundary: CDN/API
            // resources do not acquire top-level or frame navigation by default.
            // Explicit shared/connection domain rules still take precedence.
            let resources: Vec<_> = all
                .iter()
                .copied()
                .filter(|class| {
                    !matches!(
                        class,
                        WebsiteRequestClass::Navigation | WebsiteRequestClass::Frame
                    )
                })
                .collect();
            for value in GOOGLE_ROUTES["loginOrigins"].as_array().ok_or(error)? {
                grant(value.as_str().ok_or(error)?, &all)?;
            }
            for value in GOOGLE_ROUTES["resourceOrigins"].as_array().ok_or(error)? {
                grant(value.as_str().ok_or(error)?, &resources)?;
            }
            if let Some(values) = connection
                .pointer("/httpApplication/id")
                .and_then(Value::as_str)
                .and_then(|id| GOOGLE_ROUTES["profileOrigins"].get(id))
                .and_then(Value::as_array)
            {
                // Keep this classification aligned with http_google.rs and
                // googleProxySession.ts. Only these reviewed profile extras
                // are document continuations; none imply credential consent.
                let classes = if matches!(id, "youtube" | "youtube-studio") {
                    &all
                } else {
                    &resources
                };
                for value in values {
                    grant(value.as_str().ok_or(error)?, classes)?;
                }
            }
        }
    }
    // Materialize effective per-destination classes so a script-only CDN grant
    // cannot accidentally acquire navigation/fetch rights from source defaults.
    let mut destinations = Vec::new();
    let mut allowed = Vec::new();
    for (destination, defaults) in candidates {
        let resolver = WebsitePermissionEngine::new(shared.as_ref(), own.as_ref(), &defaults)
            .map_err(|_| error)?;
        let classes: BTreeMap<_, _> = CLASSES
            .iter()
            .map(|(class, name)| {
                let decision = resolver
                    .resolve(WebsitePermissionQuery {
                        website_origin: &origin,
                        destination_origin: &destination,
                        request_class: name,
                        native_denied: false,
                    })
                    .decision;
                (
                    *class,
                    if decision == WebsitePermissionDecision::Allow {
                        WebsitePermissionSetting::Allow
                    } else {
                        WebsitePermissionSetting::Deny
                    },
                )
            })
            .collect();
        if destination == origin
            && classes.get(&WebsiteRequestClass::Navigation)
                != Some(&WebsitePermissionSetting::Allow)
        {
            return Err(error);
        }
        if classes
            .values()
            .any(|v| *v == WebsitePermissionSetting::Allow)
        {
            allowed.push(destination.clone());
        }
        destinations.push(WebsiteDestinationPermissions {
            origin: destination,
            request_classes: classes,
        });
    }
    let effective = WebsiteDomainPermissionsSettings {
        version: 1,
        websites: vec![WebsiteOriginPermissions {
            origin,
            request_classes: BTreeMap::new(),
            destinations,
        }],
    };
    let engine = WebsitePermissionEngine::new(None, Some(&effective), &BTreeMap::new())
        .map_err(|_| error)?;
    Ok((engine, allowed))
}

enum ProxyKind {
    Http,
    Https,
    Socks4,
    Socks5,
}
struct ProxyHop {
    kind: ProxyKind,
    endpoint: Authority,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
}

fn proxy_hop(value: &Value, type_key: &str) -> Result<ProxyHop, NativeAuthorityError> {
    let error = NativeAuthorityError::RouteUnsupported;
    let kind = match value.get(type_key).and_then(Value::as_str) {
        Some("http" | "http-connect") => ProxyKind::Http,
        Some("https") => ProxyKind::Https,
        Some("socks4") => ProxyKind::Socks4,
        Some("socks5") => ProxyKind::Socks5,
        _ => return Err(error),
    };
    let host = value.get("host").and_then(Value::as_str).ok_or(error)?;
    let port = value.get("port").and_then(Value::as_u64).ok_or(error)?;
    let endpoint = Authority::parse(&format!("{host}:{port}")).map_err(|_| error)?;
    let credential = |key: &str| -> Result<Zeroizing<String>, NativeAuthorityError> {
        match value.get(key) {
            None => Ok(Zeroizing::new(String::new())),
            Some(Value::String(s)) if s.len() <= 255 && !s.chars().any(char::is_control) => {
                Ok(Zeroizing::new(s.clone()))
            }
            _ => Err(error),
        }
    };
    let username = credential("username")?;
    let password = credential("password")?;
    if username.is_empty() && !password.is_empty()
        || matches!(kind, ProxyKind::Socks4) && !password.is_empty()
        || matches!(kind, ProxyKind::Http | ProxyKind::Https) && username.contains(':')
    {
        return Err(error);
    }
    Ok(ProxyHop {
        kind,
        endpoint,
        username,
        password,
    })
}

fn saved_route(connection: &Value) -> Result<Vec<ProxyHop>, NativeAuthorityError> {
    let error = NativeAuthorityError::RouteUnsupported;
    for key in [
        "proxyProfileId",
        "proxyChainId",
        "tunnelProfileId",
        "tunnelChainId",
        "connectionChainId",
    ] {
        if connection.get(key).is_some_and(|v| !v.is_null() && v != "") {
            return Err(error);
        }
    }
    let Some(security) = connection.get("security") else {
        return Ok(Vec::new());
    };
    if !security.is_object() {
        return Err(error);
    }
    for key in ["openvpn", "sshTunnel"] {
        if let Some(value) = security.get(key) {
            if value.get("enabled") != Some(&Value::Bool(false)) {
                return Err(error);
            }
        }
    }
    let mut hops = Vec::new();
    if let Some(value) = security.get("proxy") {
        match value.get("enabled").and_then(Value::as_bool) {
            Some(true) => hops.push(proxy_hop(value, "type")?),
            Some(false) => (),
            _ => return Err(error),
        }
    }
    if let Some(layers) = security.get("tunnelChain") {
        let layers = layers.as_array().ok_or(error)?;
        if layers.len() > 8 {
            return Err(error);
        }
        // Conflicting route representations must be resolved by saving one.
        if !hops.is_empty() && !layers.is_empty() {
            return Err(error);
        }
        for layer in layers {
            match layer.get("enabled").and_then(Value::as_bool) {
                Some(false) => continue,
                Some(true) => (),
                _ => return Err(error),
            }
            if layer.get("type").and_then(Value::as_str) != Some("proxy")
                || [
                    "tunnelProfileId",
                    "localBindHost",
                    "localBindPort",
                    "nodeChainConfig",
                    "sshChainingMethod",
                ]
                .iter()
                .any(|key| layer.get(key).is_some())
            {
                return Err(error);
            }
            hops.push(proxy_hop(layer.get("proxy").ok_or(error)?, "proxyType")?);
        }
    }
    if hops
        .iter()
        .skip(1)
        .any(|hop| matches!(hop.kind, ProxyKind::Https))
    {
        return Err(error);
    }
    Ok(hops)
}

fn route_error() -> io::Error {
    io::Error::other("Browser route unavailable; no direct fallback")
}

async fn dial_route(hops: &[ProxyHop], target: &Authority) -> io::Result<BoxedStream> {
    if let Some(hop) = hops
        .first()
        .filter(|hop| matches!(hop.kind, ProxyKind::Https))
    {
        let destination = hops.get(1).map(|hop| &hop.endpoint).unwrap_or(target);
        let mut proxy = Url::parse(&format!(
            "https://{}:{}",
            hop.endpoint.host(),
            hop.endpoint.port()
        ))
        .map_err(|_| route_error())?;
        proxy
            .set_username(&hop.username)
            .map_err(|_| route_error())?;
        if !hop.password.is_empty() {
            proxy
                .set_password(Some(&hop.password))
                .map_err(|_| route_error())?;
        }
        let route =
            sorng_protocols::private_forward_route::NativeForwardRoute::http_connect(proxy.into())
                .map_err(|_| route_error())?;
        let mut stream = route
            .dial(destination.clone())
            .await
            .map_err(|_| route_error())?;
        for (index, hop) in hops.iter().enumerate().skip(1) {
            let destination = hops
                .get(index + 1)
                .map(|hop| &hop.endpoint)
                .unwrap_or(target);
            proxy_handshake(&mut stream, hop, destination)
                .await
                .map_err(|_| route_error())?;
        }
        return Ok(stream);
    }
    let first = hops.first().map(|h| &h.endpoint).unwrap_or(target);
    // DNS and direct TCP belong only to the configured first hop. Subsequent
    // destination names travel inside CONNECT/SOCKS, never local lookup.
    let host = first.host().trim_start_matches('[').trim_end_matches(']');
    let mut stream = SocketConnector::new()
        .connect_tcp(
            &SocketTarget::new(host, first.port()),
            Route::Direct,
            TcpOptions::default(),
        )
        .await
        .map_err(|_| route_error())?
        .into_stream();
    for (index, hop) in hops.iter().enumerate() {
        let destination = hops.get(index + 1).map(|h| &h.endpoint).unwrap_or(target);
        proxy_handshake(&mut stream, hop, destination)
            .await
            .map_err(|_| route_error())?;
    }
    Ok(Box::new(stream))
}

async fn proxy_handshake<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
    stream: &mut S,
    hop: &ProxyHop,
    destination: &Authority,
) -> io::Result<()> {
    match hop.kind {
        ProxyKind::Https => return Err(route_error()), // TLS must wrap the first transport, never downgrade.
        ProxyKind::Http => {
            let authority = format!("{}:{}", destination.host(), destination.port());
            let mut request = Zeroizing::new(format!(
                "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n"
            ));
            if !hop.username.is_empty() {
                let raw = Zeroizing::new(format!("{}:{}", *hop.username, *hop.password));
                let encoded = Zeroizing::new(
                    base64::engine::general_purpose::STANDARD.encode(raw.as_bytes()),
                );
                request.push_str("Proxy-Authorization: Basic ");
                request.push_str(&encoded);
                request.push_str("\r\n");
            }
            request.push_str("\r\n");
            stream.write_all(request.as_bytes()).await?;
            let mut header = Zeroizing::new(Vec::new());
            while !header.ends_with(b"\r\n\r\n") {
                if header.len() == 16_384 {
                    return Err(route_error());
                }
                header.push(stream.read_u8().await?);
            }
            let line = header
                .split(|b| *b == b'\r')
                .next()
                .ok_or_else(route_error)?;
            let parts: Vec<_> = line.split(|b| *b == b' ').collect();
            if parts.len() < 2
                || !matches!(parts[0], b"HTTP/1.1" | b"HTTP/1.0")
                || parts[1] != b"200"
            {
                return Err(route_error());
            }
        }
        ProxyKind::Socks5 => {
            let auth = !hop.username.is_empty();
            stream.write_all(&[5, 1, if auth { 2 } else { 0 }]).await?;
            let mut response = [0; 2];
            stream.read_exact(&mut response).await?;
            if response != [5, if auth { 2 } else { 0 }] {
                return Err(route_error());
            }
            if auth {
                let mut request = Zeroizing::new(vec![1, hop.username.len() as u8]);
                request.extend_from_slice(hop.username.as_bytes());
                request.push(hop.password.len() as u8);
                request.extend_from_slice(hop.password.as_bytes());
                stream.write_all(&request).await?;
                stream.read_exact(&mut response).await?;
                if response != [1, 0] {
                    return Err(route_error());
                }
            }
            let host = destination
                .host()
                .trim_start_matches('[')
                .trim_end_matches(']');
            let mut request = vec![5, 1, 0];
            match host.parse::<std::net::IpAddr>() {
                Ok(std::net::IpAddr::V4(ip)) => {
                    request.push(1);
                    request.extend_from_slice(&ip.octets());
                }
                Ok(std::net::IpAddr::V6(ip)) => {
                    request.push(4);
                    request.extend_from_slice(&ip.octets());
                }
                Err(_) if host.len() <= 255 => {
                    request.extend_from_slice(&[3, host.len() as u8]);
                    request.extend_from_slice(host.as_bytes());
                }
                _ => return Err(route_error()),
            }
            request.extend_from_slice(&destination.port().to_be_bytes());
            stream.write_all(&request).await?;
            let mut head = [0; 4];
            stream.read_exact(&mut head).await?;
            if head[..3] != [5, 0, 0] {
                return Err(route_error());
            }
            let length = match head[3] {
                1 => 4,
                4 => 16,
                3 => stream.read_u8().await? as usize,
                _ => return Err(route_error()),
            };
            if length == 0 {
                return Err(route_error());
            }
            let mut rest = vec![0; length + 2];
            stream.read_exact(&mut rest).await?;
        }
        ProxyKind::Socks4 => {
            let host = destination.host();
            if host.contains(':') {
                return Err(route_error());
            }
            let ip = host.parse::<std::net::Ipv4Addr>().ok();
            let mut request = Zeroizing::new(vec![4, 1]);
            request.extend_from_slice(&destination.port().to_be_bytes());
            request.extend_from_slice(&ip.map(|ip| ip.octets()).unwrap_or([0, 0, 0, 1]));
            request.extend_from_slice(hop.username.as_bytes());
            request.push(0);
            if ip.is_none() {
                request.extend_from_slice(host.as_bytes());
                request.push(0);
            }
            stream.write_all(&request).await?;
            let mut response = [0; 8];
            stream.read_exact(&mut response).await?;
            if response[0] != 0 || response[1] != 90 {
                return Err(route_error());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use sorng_encryption::{
        database_protection::{self as codec, DataCipher, DatabaseEnvelope, DatabaseKey},
        database_sessions::{self, SessionScope},
    };
    use tauri::{
        test::{mock_builder, mock_context, noop_assets, MockRuntime},
        WebviewUrl, WebviewWindowBuilder,
    };

    pub(super) fn connection() -> Value {
        json!({"id":"saved", "isGroup":false, "protocol":"https", "httpsTrustPolicy":"strict",
        "hostname":"https://source.example/login?q=fixture", "port":443,
        "username":"test-user", "password":"fixture-secret", "httpAutoLogin":true})
    }

    #[test]
    fn retention_scope_uses_destination_permissions_without_widening_them() {
        let mut connection = connection();
        connection["httpsTrustPolicy"] = "tofu".into();
        connection["httpProxyPolicy"] =
            json!({"version":1,"sameOriginOnly":true,"pageScripts":"allow"});
        let scope = saved_retention_scope(&connection, &Value::Null).unwrap();
        assert_eq!(scope.0, "https://source.example");
        assert_eq!(scope.1, vec!["https://source.example"]);

        connection["httpVerifySsl"] = false.into();
        assert!(saved_retention_scope(&connection, &Value::Null).is_err());
        connection.as_object_mut().unwrap().remove("httpVerifySsl");
        connection["httpProxyPolicy"]["allowAllRequests"] = true.into();
        assert!(saved_retention_scope(&connection, &Value::Null).is_err());
    }

    #[test]
    fn retention_scope_matches_the_native_creation_origin_set() {
        let connection = connection();
        let settings = json!({"webBrowser":{"version":1}});
        let source = saved_source(&connection).unwrap();
        let (_, mut expected) =
            saved_permissions_inner(&connection, &settings, &source, true).unwrap();
        expected.sort();
        expected.dedup();
        let actual = saved_retention_scope(&connection, &settings).unwrap();
        assert_eq!(actual.0, source.origin().ascii_serialization());
        assert_eq!(actual.1, expected);
        assert!(saved_retention_scope(&connection, &json!({"webBrowser":[]})).is_err());
    }

    pub(super) struct Fixture {
        pub(super) _app: tauri::App<MockRuntime>,
        pub(super) root: tempfile::TempDir,
        pub(super) window: WebviewWindow<MockRuntime>,
        pub(super) state: EncryptionState,
        pub(super) request: OriginBrowserCreateRequest,
        envelope: DatabaseEnvelope,
        key: DatabaseKey,
    }

    impl Fixture {
        pub(super) async fn new(connection: Value) -> Self {
            let app = mock_builder().build(mock_context(noop_assets())).unwrap();
            let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
                .build()
                .unwrap();
            let root = tempfile::tempdir().unwrap();
            let state = EncryptionState::new();
            sorng_encryption::artifact_policy::initialize(&state, root.path()).await;
            std::fs::create_dir(root.path().join("databases")).unwrap();
            let profile = format!(
                "{:x}",
                Sha256::digest(
                    root.path()
                        .canonicalize()
                        .unwrap()
                        .to_string_lossy()
                        .as_bytes()
                )
            );
            let key = DatabaseKey::generate();
            let slot = codec::new_vault_slot(
                "db",
                "key",
                "slot".into(),
                &profile,
                "fixture",
                &DatabaseKey::generate(),
                &key,
            )
            .unwrap();
            let data = json!({"connections":[connection], "settings":{}});
            let envelope = DatabaseEnvelope::create(
                "db",
                "key",
                "revision",
                DataCipher::Aes256Gcm,
                vec![slot],
                &data,
                &key,
            )
            .unwrap();
            sorng_storage::sdbf::safe_write(&root.path().join("databases/index.json"), &serde_json::to_vec(&json!([
                {"id":"db","name":"fixture","isEncrypted":true,"protectionFormat":"sorng-db","securityRevision":"revision"}
            ])).unwrap()).unwrap();
            sorng_storage::sdbf::safe_write(
                &root.path().join("databases/db.json"),
                &serde_json::to_vec(&envelope.value().unwrap()).unwrap(),
            )
            .unwrap();
            let token = database_sessions::global()
                .lock()
                .unwrap()
                .insert(
                    &SessionScope {
                        owner: state.database_session_owner(),
                        profile: &profile,
                        database: "db",
                        revision: "revision",
                        window: "main",
                        generation: state.key_generation(),
                    },
                    key.duplicate(),
                )
                .unwrap();
            let request = serde_json::from_value(json!({
                "owner":{"ownerDatabaseId":"db","connectionId":"saved","sessionId":"tab"},
                "expectedSecurityRevision":"revision", "sourceSessionId":token,"requestId":"create",
                "initialUrl":"https://source.example/login?q=fixture",
                "bounds":{"x":0,"y":0,"width":800,"height":600}, "visible":false,
                "policy":{"darkMode":"forced","autoLogin":{"enabled":true,"consent":{"kind":"existing-grant","grantId":"untrusted-hint"}}}
            })).unwrap();
            Self {
                _app: app,
                root,
                window,
                state,
                request,
                envelope,
                key,
            }
        }

        pub(super) async fn authorize(
            &self,
        ) -> Result<NativeAuthorizedBrowser, NativeAuthorityError> {
            authorize_create(&self.window, &self.state, &self.request).await
        }

        pub(super) fn replace_connection(&mut self, connection: Value) {
            self.envelope
                .replace_data(
                    &json!({"connections":[connection],"settings":{}}),
                    &self.key,
                )
                .unwrap();
            sorng_storage::sdbf::safe_write(
                &self.root.path().join("databases/db.json"),
                &serde_json::to_vec(&self.envelope.value().unwrap()).unwrap(),
            )
            .unwrap();
        }

        pub(super) fn replace_totp_fixture_data(&mut self, data: &Value) {
            self.envelope.replace_data(data, &self.key).unwrap();
            sorng_storage::sdbf::safe_write(
                &self.root.path().join("databases/db.json"),
                &serde_json::to_vec(&self.envelope.value().unwrap()).unwrap(),
            ).unwrap();
        }
    }

    #[test]
    fn saved_url_preserves_source_and_explicit_default_ports() {
        assert_eq!(
            saved_source(&connection()).unwrap().as_str(),
            "https://source.example/login?q=fixture"
        );
        for (host, port, expected) in [
            ("source.example", 0, Some("https://source.example/")),
            (
                "source.example:8443",
                8443,
                Some("https://source.example:8443/"),
            ),
            ("https://source.example:443/login", 8443, None),
            ("http://source.example/", 443, None),
            ("source.example/login", 443, None),
            ("127.1", 443, None),
            ("https://user:secret@source.example/", 443, None),
            ("[::1]:8443", 8443, Some("https://[::1]:8443/")),
        ] {
            let mut row = connection();
            row["hostname"] = host.into();
            row["port"] = port.into();
            assert_eq!(saved_source(&row).ok().as_ref().map(Url::as_str), expected);
        }
        let mut group = connection();
        group["isGroup"] = true.into();
        assert!(saved_source(&group).is_err());
    }

    #[tokio::test]
    async fn quick_connect_never_reads_saved_rows_or_cookie_keys_and_rechecks_its_window() {
        let mut f = Fixture::new(connection()).await;
        let mut wire = serde_json::to_value(&f.request).unwrap();
        wire["owner"]["ownerDatabaseId"] = json!("quick-connect:tab");
        // Deliberately collide with a saved ID: temporary authority still must
        // not select the saved row or its form-login secrets.
        wire["expectedSecurityRevision"] = json!("quick-connect");
        wire["sourceSessionId"] = json!("tab");
        wire["initialUrl"] = json!("https://temporary.example:8443/login");
        wire["quickConnect"] = json!({"protocol":"https","hostname":"https://temporary.example:8443/login", "port":8443,"httpVerifySsl":true});
        f.request = serde_json::from_value(wire).unwrap();
        let before = std::fs::read(f.root.path().join("databases/db.json")).unwrap();
        let authorized = authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request).await.unwrap();
        assert!(authorized.lease.is_temporary());
        assert!(authorized.lease.is_current());
        assert!(!authorized.login.enabled());
        assert!(authorized.lease.fork_for_cookie_retention().is_err());
        assert!(authorized.lease.read_dependency(&f.window, &f.state, false, "saved").await.is_err());
        assert!(authorized.lease.load_cookie_record(|| true).await.is_err());
        authorized.lease.recheck(&f.window, &f.state).await.unwrap();
        assert_eq!(before, std::fs::read(f.root.path().join("databases/db.json")).unwrap());
        let other = WebviewWindowBuilder::new(&f._app, "other", WebviewUrl::default()).build().unwrap();
        assert!(authorized.lease.recheck(&other, &f.state).await.is_err());
        assert!(!authorized.lease.is_current());
    }

    #[tokio::test]
    async fn quick_connect_source_mismatch_and_saved_owner_downgrade_are_rejected() {
        let mut f = Fixture::new(connection()).await;
        let mut wire = serde_json::to_value(&f.request).unwrap();
        wire["quickConnect"] = json!({"protocol":"https","hostname":"elsewhere.example", "port":443,"httpVerifySsl":true});
        f.request = serde_json::from_value(wire.clone()).unwrap();
        assert!(matches!(authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request).await, Err(NativeAuthorityError::InvalidRequest)));
        wire["owner"]["ownerDatabaseId"] = json!("quick-connect:tab");
        wire["expectedSecurityRevision"] = json!("quick-connect");
        wire["sourceSessionId"] = json!("tab");
        f.request = serde_json::from_value(wire).unwrap();
        assert!(matches!(authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request).await, Err(NativeAuthorityError::SourceMismatch)));
    }

    #[tokio::test]
    async fn quick_connect_works_without_any_database_or_unlock_session() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();
        let root = tempfile::tempdir().unwrap();
        let state = EncryptionState::new();
        sorng_encryption::artifact_policy::initialize(&state, root.path()).await;
        let request = serde_json::from_value(json!({
            "owner":{"ownerDatabaseId":"quick-connect:tab","connectionId":"temporary","sessionId":"tab"},
            "expectedSecurityRevision":"quick-connect", "sourceSessionId":"tab", "requestId":"create",
            "quickConnect":{"protocol":"https","hostname":"temporary.example","port":443,"httpVerifySsl":true},
            "initialUrl":"https://temporary.example/", "bounds":{"x":0,"y":0,"width":800,"height":600},"visible":false,
            "policy":{"darkMode":"forced","autoLogin":{"enabled":true,"consent":{"kind":"required"}}}
        })).unwrap();
        let authorized = authorize_create_with_certificate_hooks(&window, &state, &request).await.unwrap();
        assert!(authorized.lease.is_current());
        assert!(!root.path().join("databases").exists());
        authorized.lease.recheck(&window, &state).await.unwrap();
        authorized.lease.revoke();
        assert!(!authorized.lease.is_current());
    }

    #[tokio::test]
    async fn temporary_http_runs_through_its_exact_source_policy() {
        let mut f = Fixture::new(connection()).await;
        let mut wire = serde_json::to_value(&f.request).unwrap();
        wire["owner"]["ownerDatabaseId"] = json!("quick-connect:tab");
        wire["expectedSecurityRevision"] = json!("quick-connect");
        wire["sourceSessionId"] = json!("tab");
        wire["initialUrl"] = json!("http://router.example:8080/");
        wire["quickConnect"] = json!({"protocol":"http","hostname":"router.example", "port":8080,"httpVerifySsl":true});
        f.request = serde_json::from_value(wire).unwrap();
        let authorized = authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request).await.unwrap();
        assert_eq!(authorized.policy.allowed_origins(), &["http://router.example:8080"]);
        assert!(authorized.lease.is_temporary());
    }

    #[test]
    fn application_entries_match_reviewed_frontend_precedence() {
        for (id, host, extra, expected) in [
            (
                "gitea",
                "source.example",
                json!({}),
                "https://source.example/user/login",
            ),
            (
                "gitea",
                "https://source.example/custom?q=kept#section",
                json!({}),
                "https://source.example/custom?q=kept#section",
            ),
            (
                "github",
                "https://github.com/ignored?discard=1",
                json!({}),
                "https://github.com/login",
            ),
            (
                "cloudflare",
                "dash.cloudflare.com",
                json!({"loginMode":"form"}),
                "https://dash.cloudflare.com/login",
            ),
            (
                "vaultwarden",
                "source.example",
                json!({}),
                "https://source.example/#/login",
            ),
            (
                "joomla",
                "source.example",
                json!({"loginPath":"/private-admin/"}),
                "https://source.example/private-admin/",
            ),
            (
                "exchange-owa",
                "mail.example.com",
                json!({"exchangeOwaMailbox":" shared+box@example.com "}),
                "https://mail.example.com/owa/shared+box@example.com/",
            ),
            (
                "exchange-owa",
                "https://mail.example.com/owa/user@example.com/?x=1",
                json!({}),
                "https://mail.example.com/owa/user@example.com/?x=1",
            ),
            (
                "google-analytics",
                "https://analytics.google.com/ignored?discard=1",
                json!({}),
                "https://analytics.google.com/analytics/web/",
            ),
        ] {
            let mut row = connection();
            row["hostname"] = host.into();
            let mut app = json!({"id":id,"version":1,"loginMode":"manual"});
            app.as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            row["httpApplication"] = app;
            assert_eq!(saved_source(&row).unwrap().as_str(), expected, "{id}");
        }
        for mailbox in [
            "//evil.example",
            "a@example.com?token=secret",
            "a@example.com/../../",
            "a..b@example.com",
            "a@-example.com",
        ] {
            let mut row = connection();
            row["httpApplication"] =
                json!({"id":"exchange-owa","version":1,"exchangeOwaMailbox":mailbox});
            assert!(saved_source(&row).is_err());
        }
    }

    #[test]
    fn google_entry_and_network_grants_do_not_depend_on_renderer_routes() {
        let mut row = connection();
        row["hostname"] = "analytics.google.com".into();
        row["httpApplication"] = json!({"version":1,"id":"google-analytics","loginMode":"form"});
        let source = saved_source(&row).unwrap();
        assert_eq!(
            source.as_str(),
            "https://analytics.google.com/analytics/web/"
        );
        let (engine, origins) = saved_permissions(&row, &Value::Null, &source).unwrap();
        assert!(origins.iter().any(|s| s == "https://accounts.google.com"));
        assert!(origins
            .iter()
            .any(|s| s == "https://analyticsdata.googleapis.com"));
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: "https://analytics.google.com",
                    destination_origin: "https://accounts.google.com",
                    request_class: "navigation",
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Allow
        );
        row["hostname"] = "https://attacker.example/".into();
        assert!(saved_permissions(&row, &Value::Null, &saved_source(&row).unwrap()).is_err());
    }

    #[test]
    fn youtube_studio_source_comes_from_shared_native_manifest() {
        let mut row = connection();
        row["hostname"] = "studio.youtube.com".into();
        row["httpApplication"] = json!({"version":1,"id":"youtube-studio","loginMode":"form"});
        let source = saved_source(&row).unwrap();
        assert_eq!(source.as_str(), "https://studio.youtube.com/");
        assert_eq!(
            APPLICATION_TARGETS["profiles"]["youtube-studio"]["hostedLoginUrl"],
            source.as_str()
        );
        let (_, origins) = saved_permissions(&row, &Value::Null, &source).unwrap();
        assert!(origins
            .iter()
            .any(|origin| origin == "https://studio.youtube.com"));
        assert!(origins
            .iter()
            .any(|origin| origin == "https://accounts.google.com"));
        row["hostname"] = "".into();
        assert_eq!(saved_source(&row).unwrap(), source);
    }

    #[test]
    fn google_resource_routes_never_gain_document_permissions_by_default() {
        for (id, origin) in GOOGLE_ROUTES["profiles"].as_object().unwrap() {
            let origin = origin.as_str().unwrap();
            let mut row = connection();
            row["hostname"] = origin.into();
            row["httpApplication"] = json!({"version":1,"id":id,"loginMode":"form"});
            let source = saved_source(&row).unwrap();
            let (engine, _) = saved_permissions(&row, &Value::Null, &source).unwrap();
            let mut resources = GOOGLE_ROUTES["resourceOrigins"].as_array().unwrap().clone();
            if !matches!(id.as_str(), "youtube" | "youtube-studio") {
                if let Some(extras) = GOOGLE_ROUTES["profileOrigins"][id].as_array() {
                    resources.extend_from_slice(extras);
                }
            }
            for destination in resources {
                let destination = destination.as_str().unwrap();
                for (class, expected) in [
                    ("navigation", WebsitePermissionDecision::Deny),
                    ("frame", WebsitePermissionDecision::Deny),
                    ("script", WebsitePermissionDecision::Allow),
                    ("fetch-xhr", WebsitePermissionDecision::Allow),
                ] {
                    assert_eq!(
                        engine
                            .resolve(WebsitePermissionQuery {
                                website_origin: origin,
                                destination_origin: destination,
                                request_class: class,
                                native_denied: false,
                            })
                            .decision,
                        expected,
                        "{id}: {destination} {class}",
                    );
                }
            }
            for destination in std::iter::once(origin).chain(
                GOOGLE_ROUTES["loginOrigins"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| value.as_str().unwrap()),
            ) {
                for class in ["navigation", "frame"] {
                    assert_eq!(
                        engine
                            .resolve(WebsitePermissionQuery {
                                website_origin: origin,
                                destination_origin: destination,
                                request_class: class,
                                native_denied: false,
                            })
                            .decision,
                        WebsitePermissionDecision::Allow,
                        "{id}: {destination} {class}",
                    );
                }
            }
            if id != "youtube" && id != "youtube-studio" {
                assert_eq!(
                    engine
                        .resolve(WebsitePermissionQuery {
                            website_origin: origin,
                            destination_origin: "https://www.youtube.com",
                            request_class: "navigation",
                            native_denied: false,
                        })
                        .decision,
                    WebsitePermissionDecision::Deny,
                    "Studio continuation leaked into {id}",
                );
            }
        }
    }

    #[test]
    fn google_resource_document_permissions_require_explicit_domain_override() {
        let mut row = connection();
        row["hostname"] = "analytics.google.com".into();
        row["httpApplication"] = json!({"version":1,"id":"google-analytics","loginMode":"form"});
        let source = saved_source(&row).unwrap();
        let rules = json!({"version":1,"websites":[{"origin":"https://analytics.google.com",
        "destinations":[
            {"origin":"https://www.gstatic.com","requestClasses":{"navigation":"allow","frame":"allow"}},
            {"origin":"https://analyticsdata.googleapis.com","requestClasses":{"navigation":"allow","frame":"allow"}}
        ]}]});
        for shared in [false, true] {
            let mut connection = row.clone();
            let mut settings = Value::Null;
            if shared {
                settings = json!({"webBrowser":{"domainPermissions":rules}});
            } else {
                connection["websiteDomainPermissions"] = rules.clone();
            }
            let (engine, _) = saved_permissions(&connection, &settings, &source).unwrap();
            for destination in [
                "https://www.gstatic.com",
                "https://analyticsdata.googleapis.com",
            ] {
                for class in ["navigation", "frame"] {
                    assert_eq!(
                        engine
                            .resolve(WebsitePermissionQuery {
                                website_origin: "https://analytics.google.com",
                                destination_origin: destination,
                                request_class: class,
                                native_denied: false,
                            })
                            .decision,
                        WebsitePermissionDecision::Allow,
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn studio_continuation_allows_documents_but_never_implies_login_consent() {
        let mut row = connection();
        row["hostname"] = "studio.youtube.com".into();
        row["httpApplication"] = json!({"version":1,"id":"youtube-studio","loginMode":"form"});
        let mut f = Fixture::new(row.clone()).await;
        f.request.initial_url = "https://studio.youtube.com/".into();
        let authorized = f.authorize().await.unwrap();
        let continuation =
            Url::parse("https://www.youtube.com/signin?next=https%3A%2F%2Fstudio.youtube.com%2F")
                .unwrap();
        let destination = continuation.origin().ascii_serialization();
        assert!(GOOGLE_ROUTES["profileOrigins"]["youtube-studio"]
            .as_array()
            .unwrap()
            .contains(&Value::String(destination.clone())));
        assert!(authorized.policy.allowed_origins().contains(&destination));
        for class in ["navigation", "frame"] {
            assert_eq!(
                authorized
                    .permissions
                    .resolve(WebsitePermissionQuery {
                        website_origin: authorized.policy.source_origin(),
                        destination_origin: &destination,
                        request_class: class,
                        native_denied: false,
                    })
                    .decision,
                WebsitePermissionDecision::Allow,
            );
        }
        assert_eq!(
            authorized.login.consent_origins(),
            &["https://accounts.google.com"]
        );
        let mut released = 0;
        for origin in [
            "https://accounts.google.com",
            destination.as_str(),
            "https://studio.youtube.com",
            "https://www.google.com",
        ] {
            authorized.login.with_credentials(
                &NativeLoginRequest {
                    identity: authorized.policy.identity(),
                    origin,
                },
                &Consent { allow: true },
                &mut |_| released += 1,
            );
            assert_eq!(released, 1, "Continuation must not release credentials");
        }
        // A reviewed continuation remains subject to saved per-domain denial.
        row["websiteDomainPermissions"] = json!({"version":1,"websites":[{
            "origin":"https://studio.youtube.com","destinations":[{
                "origin":destination,"requestClasses":{"navigation":"deny","frame":"deny"}
            }]
        }]});
        let (engine, _) =
            saved_permissions(&row, &Value::Null, &saved_source(&row).unwrap()).unwrap();
        for class in ["navigation", "frame"] {
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        website_origin: "https://studio.youtube.com",
                        destination_origin: &destination,
                        request_class: class,
                        native_denied: false,
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
        }
    }

    #[test]
    fn destination_grants_preserve_class_scope_and_connection_denials() {
        let mut row = connection();
        row["httpTrustedRedirectDestinations"] =
            json!({"version":1,"origins":["https://login.example"]});
        row["websiteDomainPermissions"] = json!({"version":1,"websites":[{"origin":"https://source.example",
            "destinations":[{"origin":"https://login.example","requestClasses":{"navigation":"deny"}}]}]});
        let source = saved_source(&row).unwrap();
        let (engine, _) = saved_permissions(&row, &Value::Null, &source).unwrap();
        let resolve = |destination, class| {
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: "https://source.example",
                    destination_origin: destination,
                    request_class: class,
                    native_denied: false,
                })
                .decision
        };
        assert_eq!(
            resolve("https://js.stripe.com", "script"),
            WebsitePermissionDecision::Allow
        );
        assert_eq!(
            resolve("https://js.stripe.com", "navigation"),
            WebsitePermissionDecision::Deny
        );
        assert_eq!(
            resolve("https://login.example", "navigation"),
            WebsitePermissionDecision::Deny
        );
        assert_eq!(
            resolve("https://unknown.example", "script"),
            WebsitePermissionDecision::Deny
        );
        row["httpProxyPolicy"] = json!({"sameOriginOnly":true});
        let (_, origins) = saved_permissions(&row, &Value::Null, &source).unwrap();
        assert_eq!(origins, vec!["https://source.example"]);
    }

    #[test]
    fn unsupported_route_representations_never_become_direct() {
        for config in [
            json!({"proxyProfileId":"saved-profile"}),
            json!({"connectionChainId":"saved-chain"}),
            json!({"security":{"sshTunnel":{"enabled":true,"connectionId":"ssh"}}}),
            json!({"security":{"openvpn":{"enabled":true}}}),
            json!({"security":{"tunnelChain":[{"enabled":true,"type":"ssh-jump"}]}}),
            json!({"security":{"proxy":{"type":"http","host":"proxy.example","port":8080}}}),
        ] {
            assert!(matches!(
                saved_route(&config),
                Err(NativeAuthorityError::RouteUnsupported)
            ));
        }
        assert!(saved_route(&connection()).unwrap().is_empty());
    }

    #[test]
    fn certificate_policy_preserves_native_precedence_and_rejects_unimplemented_trust() {
        let mut row = connection();
        let source = saved_source(&row).unwrap();
        let settings =
            json!({"httpsTrustPolicy":"inherit","trustPolicy":"tofu","tlsTrustPolicy":"tofu"});
        assert!(saved_permissions(&row, &settings, &source).is_ok()); // Explicit connection strict overrides global TOFU.
        row["httpsTrustPolicy"] = "inherit".into();
        assert!(matches!(
            saved_permissions(&row, &settings, &source),
            Err(NativeAuthorityError::CertificatePolicyUnsupported)
        ));
        row.as_object_mut().unwrap().remove("httpsTrustPolicy");
        assert!(matches!(
            saved_permissions(&row, &Value::Null, &source),
            Err(NativeAuthorityError::CertificatePolicyUnsupported)
        ));
        row["httpsTrustPolicy"] = "strict".into();
        row["httpProxyPolicy"] = json!({"allowAllRequests":true});
        assert!(matches!(
            saved_permissions(&row, &settings, &source),
            Err(NativeAuthorityError::PolicyUnsupported)
        ));
    }

    #[tokio::test]
    async fn managed_owner_rejects_forged_url_window_database_revision_and_token() {
        let mut f = Fixture::new(connection()).await;
        let authorized = f.authorize().await.unwrap();
        assert!(authorized.lease.is_current());
        assert_eq!(authorized.policy.identity().owner_database_id(), "db");
        let other = WebviewWindowBuilder::new(&f._app, "other", WebviewUrl::default())
            .build()
            .unwrap();
        assert!(authorize_create(&other, &f.state, &f.request)
            .await
            .is_err());
        assert!(authorized.lease.is_current()); // Wrong-window attempt never revokes owner's token.
        f.request.initial_url = "https://attacker.example/".into();
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::SourceMismatch)
        ));
        f.request.initial_url = "https://source.example/login?q=fixture".into();
        f.request.owner.owner_database_id = "other".into();
        assert!(f.authorize().await.is_err());
        f.request.owner.owner_database_id = "db".into();
        f.request.expected_security_revision = "changed".into();
        assert!(f.authorize().await.is_err());
        f.request.expected_security_revision = "revision".into();
        f.request.source_session_id = "forged".into();
        assert!(f.authorize().await.is_err());
    }

    #[tokio::test]
    async fn same_revision_saved_edit_revokes_lease_on_command_recheck() {
        let mut f = Fixture::new(connection()).await;
        let authorized = f.authorize().await.unwrap();
        let mut changed = connection();
        changed["hostname"] = "https://changed.example/".into();
        f.replace_connection(changed);
        assert!(authorized.lease.recheck(&f.window, &f.state).await.is_err());
        assert!(!authorized.lease.is_current());
        f.replace_connection(connection());
        assert!(!authorized.lease.is_current());
    }

    #[tokio::test]
    async fn durable_security_revision_and_profile_changes_invalidate_owner() {
        let mut f = Fixture::new(connection()).await;
        let authorized = f.authorize().await.unwrap();
        f.envelope.security_revision = "next-revision".into();
        f.replace_connection(connection());
        sorng_storage::sdbf::safe_write(&f.root.path().join("databases/index.json"), &serde_json::to_vec(&json!([
            {"id":"db","name":"fixture","isEncrypted":true,"protectionFormat":"sorng-db","securityRevision":"next-revision"}
        ])).unwrap()).unwrap();
        assert!(authorized.lease.recheck(&f.window, &f.state).await.is_err());
        assert!(!authorized.lease.is_current());
        let f = Fixture::new(connection()).await;
        let authorized = f.authorize().await.unwrap();
        let changed = tempfile::tempdir().unwrap();
        sorng_encryption::artifact_policy::initialize(&f.state, changed.path()).await;
        assert!(!authorized.lease.is_current());
    }

    #[tokio::test]
    async fn duplicate_connection_ids_and_other_native_state_never_authorize() {
        let mut f = Fixture::new(connection()).await;
        let other = EncryptionState::new();
        sorng_encryption::artifact_policy::initialize(&other, f.root.path()).await;
        assert!(authorize_create(&f.window, &other, &f.request)
            .await
            .is_err());
        assert!(f.authorize().await.is_ok());
        f.envelope
            .replace_data(
                &json!({"connections":[connection(),connection()],"settings":{}}),
                &f.key,
            )
            .unwrap();
        sorng_storage::sdbf::safe_write(
            &f.root.path().join("databases/db.json"),
            &serde_json::to_vec(&f.envelope.value().unwrap()).unwrap(),
        )
        .unwrap();
        assert!(f.authorize().await.is_err());
    }

    #[tokio::test]
    async fn lock_rotation_window_close_and_token_replacement_revoke_exact_lease() {
        for operation in ["lock", "rotation", "window", "release"] {
            let f = Fixture::new(connection()).await;
            let authorized = f.authorize().await.unwrap();
            match operation {
                "lock" => f.state.lock().await,
                "rotation" => {
                    f.state
                        .install(sorng_encryption::MasterDek::generate())
                        .await
                }
                "window" => {
                    database_sessions::revoke_window(f.state.database_session_owner(), "main")
                }
                _ => {
                    let profile = format!(
                        "{:x}",
                        Sha256::digest(
                            f.root
                                .path()
                                .canonicalize()
                                .unwrap()
                                .to_string_lossy()
                                .as_bytes()
                        )
                    );
                    database_sessions::global()
                        .lock()
                        .unwrap()
                        .release(
                            &f.request.source_session_id,
                            f.state.database_session_owner(),
                            &profile,
                            "db",
                            "main",
                        )
                        .unwrap();
                }
            }
            assert!(!authorized.lease.is_current(), "{operation}");
            let target = Authority::parse("source.example:443").unwrap();
            assert!(authorized.route.dial(target).await.is_err());
        }
    }

    struct Consent {
        allow: bool,
    }

    #[tokio::test]
    async fn login_opt_out_and_manual_submission_are_distinct_from_missing_credentials() {
        let mut f = Fixture::new(connection()).await;
        let enabled = f.authorize().await.unwrap();
        assert!(enabled.login.enabled());
        assert!(!enabled.login.auto_submit_allowed());
        f.request.policy.auto_login.enabled = false;
        f.request.policy.auto_login.consent = OriginBrowserConsent::Required {};
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::InvalidRequest)
        ));
        let disabled = saved_login(
            &connection(),
            &Value::Null,
            &f.request,
            &enabled.policy,
            &enabled.lease,
        );
        assert!(!disabled.enabled());
        assert_eq!(disabled.availability(), NativeCredentialAvailability::Saved);
        assert!(disabled.consent_origins().is_empty());
        disabled.with_credentials(
            &NativeLoginRequest {
                identity: enabled.policy.identity(),
                origin: "https://source.example",
            },
            &Consent { allow: true },
            &mut |_| panic!("opt-out released secrets"),
        );

        let mut row = connection();
        row["httpApplication"] = json!({"version":1,"id":"generic-form","loginMode":"manual"});
        let f = Fixture::new(row).await;
        assert!(!f.authorize().await.unwrap().login.enabled());

        let mut row = connection();
        row["httpAutoLogin"] = false.into();
        row["httpApplication"] = json!({"version":1,"id":"generic-form","loginMode":"form"});
        row["password"] = "".into();
        let f = Fixture::new(row).await;
        let missing = f.authorize().await.unwrap();
        assert!(missing.login.enabled());
        assert_eq!(
            missing.login.availability(),
            NativeCredentialAvailability::Unavailable
        );
        let settings = json!({"webBrowser":{"manualFormSubmit":false}});
        let login = saved_login(
            &connection(),
            &settings,
            &f.request,
            &missing.policy,
            &missing.lease,
        );
        assert!(login.auto_submit_allowed());

        // Resolve through the actual persisted-settings authorization path.
        // A sparse browserSession must not silently turn legacy manual submit
        // into automatic submit; explicit saved choices still override/inherit.
        for global in [None, Some(false), Some(true)] {
            for local in [None, Some(false), Some(true)] {
                let mut row = connection();
                row["browserSession"] = json!({"version":1,"minimumFormFillDelayMs":50});
                if let Some(manual) = local {
                    row["browserSession"]["manualFormSubmit"] = manual.into();
                }
                let f = Fixture::new(row).await;
                if let Some(manual) = global {
                    crate::app_settings_commands::write_app_settings_inner(
                        f.root.path(),
                        &f.state,
                        json!({"webBrowser":{"manualFormSubmit":manual}}),
                    )
                    .await
                    .unwrap();
                }
                let authorized = f.authorize().await.unwrap();
                let manual = local.or(global).unwrap_or(true);
                assert_eq!(authorized.preferences.manual_form_submit, manual);
                assert!(authorized.login.enabled());
                assert_eq!(authorized.login.auto_submit_allowed(), !manual);
                let mut delivered = 0;
                authorized.login.with_credentials(
                    &NativeLoginRequest {
                        identity: authorized.policy.identity(),
                        origin: "https://source.example",
                    },
                    &Consent { allow: true },
                    &mut |credentials| {
                        assert_eq!(credentials.password, "fixture-secret");
                        assert_eq!(credentials.auto_submit, !manual);
                        delivered += 1;
                    },
                );
                assert_eq!(delivered, 1);
            }
        }
    }

    #[tokio::test]
    async fn vault_credentials_are_selected_only_from_owner_and_rechecked_for_edits() {
        let id = "01234567-89ab-4cde-8fab-0123456789ab";
        let mut row = connection();
        // Dedicated local fields must be ignored just like generic fields when
        // the selected source is the database vault, even if they are malformed.
        row["basicAuthUsername"] = json!({"stale":"ignored"});
        row["basicAuthPassword"] = false.into();
        row["credentialSource"] = json!({"kind":"vault","credentialId":id});
        let mut f = Fixture::new(row.clone()).await;
        let mut data = json!({"connections":[row], "settings":{}, "credentialVault":{
            "version":1,"revision":1,"entries":[{"id":id,"facets":{"username":"vault-user","password":"vault-secret"}}]
        }});
        f.envelope.replace_data(&data, &f.key).unwrap();
        let path = f.root.path().join("databases/db.json");
        sorng_storage::sdbf::safe_write(
            &path,
            &serde_json::to_vec(&f.envelope.value().unwrap()).unwrap(),
        )
        .unwrap();
        let authorized = f.authorize().await.unwrap();
        assert_eq!(
            authorized.login.availability(),
            NativeCredentialAvailability::Saved
        );
        let mut calls = 0;
        authorized.login.with_credentials(
            &NativeLoginRequest {
                identity: authorized.policy.identity(),
                origin: "https://source.example",
            },
            &Consent { allow: true },
            &mut |credentials| {
                assert_eq!(credentials.username, "vault-user");
                assert_eq!(credentials.password, "vault-secret");
                calls += 1;
            },
        );
        assert_eq!(calls, 1);
        data["credentialVault"]["entries"][0]["facets"]["password"] = "changed".into();
        f.envelope.replace_data(&data, &f.key).unwrap();
        sorng_storage::sdbf::safe_write(
            &path,
            &serde_json::to_vec(&f.envelope.value().unwrap()).unwrap(),
        )
        .unwrap();
        assert!(authorized.lease.recheck(&f.window, &f.state).await.is_err());
        assert!(!authorized.lease.is_current());
        let duplicate = data["credentialVault"]["entries"][0].clone();
        data["credentialVault"]["entries"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        f.envelope.replace_data(&data, &f.key).unwrap();
        sorng_storage::sdbf::safe_write(
            &path,
            &serde_json::to_vec(&f.envelope.value().unwrap()).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::CredentialUnavailable)
        ));

        let f = Fixture::new(row.clone()).await;
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::CredentialUnavailable)
        ));
        row["credentialSource"]["ownerDatabaseId"] = "other".into();
        let f = Fixture::new(row).await;
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::CredentialUnavailable)
        ));
        let mut row = connection();
        row["credentialSource"] = json!({"kind":"local"});
        assert_eq!(
            Fixture::new(row)
                .await
                .authorize()
                .await
                .unwrap()
                .login
                .availability(),
            NativeCredentialAvailability::Saved
        );
    }

    #[tokio::test]
    async fn vault_login_preserves_application_requirements_without_using_local_secrets() {
        let id = "01234567-89ab-4cde-8fab-0123456789ab";
        for (application, facets, expected_user, expected_password, available) in [
            (
                "proxmox",
                json!({"username":"operator","password":"vault-secret"}),
                "operator@pve",
                "vault-secret",
                true,
            ),
            (
                "claude",
                json!({"username":"email@example.invalid","password":{"unused":true}}),
                "email@example.invalid",
                "",
                true,
            ),
            (
                "generic-form",
                json!({"username":"operator"}),
                "operator",
                "",
                false,
            ),
        ] {
            let mut row = connection();
            row["httpApplication"] = json!({"version":1,"id":application,"loginMode":"form"});
            if application == "proxmox" {
                row["httpApplication"]["realm"] = "pve".into();
            }
            row["credentialSource"] = json!({"kind":"vault","credentialId":id});
            row["basicAuthUsername"] = "ignored-user".into();
            row["basicAuthPassword"] = "ignored-secret".into();
            let initial = saved_source(&row).unwrap().to_string();
            let mut f = Fixture::new(row.clone()).await;
            f.request.initial_url = initial;
            f.envelope
                .replace_data(
                    &json!({"connections":[row],"settings":{},"credentialVault":{
                        "version":1,"revision":1,"entries":[{"id":id,"facets":facets}]
                    }}),
                    &f.key,
                )
                .unwrap();
            sorng_storage::sdbf::safe_write(
                &f.root.path().join("databases/db.json"),
                &serde_json::to_vec(&f.envelope.value().unwrap()).unwrap(),
            )
            .unwrap();
            let authorized = f.authorize().await.unwrap();
            assert_eq!(
                authorized.login.availability(),
                if available {
                    NativeCredentialAvailability::Saved
                } else {
                    NativeCredentialAvailability::Unavailable
                }
            );
            assert_eq!(authorized.login.username.as_str(), expected_user);
            assert_eq!(authorized.login.password.as_str(), expected_password);
            let mut delivered = 0;
            authorized.login.with_credentials(
                &NativeLoginRequest {
                    identity: authorized.policy.identity(),
                    origin: &authorized.login.consent_origins()[0],
                },
                &Consent { allow: true },
                &mut |_| delivered += 1,
            );
            assert_eq!(delivered, usize::from(available));
        }
    }

    #[tokio::test]
    async fn saved_proxy_catalog_requires_native_profile_storage() {
        use tauri::Manager;
        let mut row = connection();
        row["proxyProfileId"] = "saved-proxy".into();
        let f = Fixture::new(row).await;
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::RouteUnsupported)
        ));
        let storage = sorng_storage::storage::SecureStorage::new(
            f.root.path().join("storage.json").to_string_lossy().into(),
        );
        let catalog = json!({"profiles":[{"id":"saved-proxy","config":{"enabled":true,"type":"socks5","host":"proxy.invalid","port":1080}}]});
        sorng_storage::storage::lock_app_data(&storage)
            .await
            .write_app_data("proxy_collection_data", &catalog.to_string())
            .await
            .unwrap();
        assert!(f._app.manage(storage));
        assert_eq!(f.authorize().await.err(), None);
    }
    impl NativeLoginConsentVerifier for Consent {
        fn with_current_consent(
            &self,
            _: &BrowserIdentity,
            _: &str,
            _: Option<&str>,
            deliver: &mut dyn FnMut(Instant, bool),
        ) {
            if self.allow {
                deliver(Instant::now() + Duration::from_secs(20), true);
                deliver(Instant::now() + Duration::from_secs(20), true);
            }
        }
    }

    #[tokio::test]
    async fn credentials_require_separate_native_consent_exact_attempt_and_live_owner() {
        let f = Fixture::new(connection()).await;
        let authorized = f.authorize().await.unwrap();
        assert_eq!(authorized.login.application_id(), "generic-form");
        assert!(authorized.login.supports_default_adapter());
        assert_eq!(
            authorized.login.consent_origins(),
            &["https://source.example"]
        );
        let request = NativeLoginRequest {
            identity: authorized.policy.identity(),
            origin: "https://source.example",
        };
        let mut count = 0;
        authorized
            .login
            .with_credentials(&request, &Consent { allow: false }, &mut |_| count += 1);
        assert_eq!(count, 0); // ExistingGrant from IPC is not proof.
        authorized
            .login
            .with_credentials(&request, &Consent { allow: true }, &mut |credentials| {
                assert_eq!(credentials.password, "fixture-secret");
                assert!(!credentials.auto_submit);
                count += 1;
            });
        assert_eq!(count, 1); // A buggy verifier calling twice cannot release twice.
        let other =
            OriginBrowserPolicy::new("db", "saved", "tab", "https://source.example").unwrap();
        authorized.login.with_credentials(
            &NativeLoginRequest {
                identity: other.identity(),
                origin: request.origin,
            },
            &Consent { allow: true },
            &mut |_| count += 1,
        );
        authorized.login.with_credentials(
            &NativeLoginRequest {
                identity: request.identity,
                origin: "https://attacker.example",
            },
            &Consent { allow: true },
            &mut |_| count += 1,
        );
        assert!(authorized
            .policy
            .allowed_origins()
            .iter()
            .any(|origin| origin == "https://js.stripe.com"));
        authorized.login.with_credentials(
            &NativeLoginRequest {
                identity: request.identity,
                origin: "https://js.stripe.com",
            },
            &Consent { allow: true },
            &mut |_| count += 1,
        );
        authorized.lease.revoke();
        authorized
            .login
            .with_credentials(&request, &Consent { allow: true }, &mut |_| count += 1);
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn consent_candidates_require_login_routes_and_custom_selectors_use_modular_adapter() {
        let mut row = connection();
        row["hostname"] = "analytics.google.com".into();
        row["httpApplication"] = json!({"version":1,"id":"google-analytics","loginMode":"form"});
        let mut f = Fixture::new(row).await;
        f.request.initial_url = "https://analytics.google.com/analytics/web/".into();
        let authorized = f.authorize().await.unwrap();
        assert_eq!(authorized.login.application_id(), "google-analytics");
        assert_eq!(
            authorized.login.consent_origins(),
            &["https://accounts.google.com"]
        );
        let mut row = connection();
        row["httpTrustedRedirectDestinations"] =
            json!({"version":1,"origins":["https://login.example"]});
        let f = Fixture::new(row.clone()).await;
        assert_eq!(
            f.authorize().await.unwrap().login.consent_origins(),
            &["https://source.example"]
        );
        row["httpRedirectAuthentication"] =
            json!({"version":1,"mode":"saved-login","allowInsecureHttp":false});
        row["httpAutoLoginSelectors"] = json!({"usernameSelector":"#special"});
        row["httpFormAutomation"] = json!({"version":1,"fillDelayMs":0,
            "submitDelayMs":0,"detectionTimeoutMs":8000,"submit":true,
            "fields":[{"selector":"#realm","value":"private-realm-value"}]});
        let f = Fixture::new(row).await;
        let authorized = f.authorize().await.unwrap();
        assert_eq!(
            authorized.login.consent_origins(),
            &["https://source.example", "https://login.example"]
        );
        assert!(authorized.login.supports_default_adapter());
        assert!(authorized
            .login
            .form_configuration()
            .unwrap()
            .contains("#special"));
        let mut released = false;
        authorized.login.with_credentials(
            &NativeLoginRequest {
                identity: authorized.policy.identity(),
                origin: "https://source.example",
            },
            &Consent { allow: true },
            &mut |_| released = true,
        );
        assert!(released);
        let request = NativeLoginRequest {
            identity: authorized.policy.identity(),
            origin: "https://source.example",
        };
        assert!(!authorized
            .login
            .form_configuration()
            .unwrap()
            .contains("private-realm-value"));
        authorized
            .login
            .with_form_credentials(&request, &Consent { allow: false }, &mut |_, _| {
                panic!("options must not escape denied consent");
            });
        let mut options_released = false;
        authorized.login.with_form_credentials(
            &request,
            &Consent { allow: true },
            &mut |credentials, options| {
                assert_eq!(credentials.origin, request.origin);
                assert!(options.unwrap().contains("private-realm-value"));
                options_released = true;
            },
        );
        assert!(options_released);
    }

    #[tokio::test]
    async fn connect_chain_preserves_hops_remote_dns_and_opaque_payload() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let config = json!({"security":{"tunnelChain":[
            {"enabled":true,"type":"proxy","proxy":{"proxyType":"http","host":"127.0.0.1","port":port}},
            {"enabled":true,"type":"proxy","proxy":{"proxyType":"socks5","host":"second.invalid","port":1080}}
        ]}});
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                header.push(socket.read_u8().await.unwrap());
            }
            assert!(header.starts_with(b"CONNECT second.invalid:1080 HTTP/1.1\r\n"));
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let mut greeting = [0; 3];
            socket.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting, [5, 1, 0]);
            socket.write_all(&[5, 0]).await.unwrap();
            let mut request = [0; 4];
            socket.read_exact(&mut request).await.unwrap();
            assert_eq!(request, [5, 1, 0, 3]);
            let len = socket.read_u8().await.unwrap() as usize;
            let mut host = vec![0; len];
            socket.read_exact(&mut host).await.unwrap();
            assert_eq!(host, b"destination.invalid");
            assert_eq!(socket.read_u16().await.unwrap(), 443);
            socket
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 1])
                .await
                .unwrap();
            socket.write_all(b"opaque-tls").await.unwrap();
        });
        let hops = saved_route(&config).unwrap();
        let mut stream = tokio::time::timeout(
            Duration::from_secs(5),
            dial_route(&hops, &Authority::parse("destination.invalid:443").unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        let mut bytes = [0; 10];
        stream.read_exact(&mut bytes).await.unwrap();
        assert_eq!(&bytes, b"opaque-tls");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn rejecting_proxy_never_dials_target_directly() {
        let tripwire = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = json!({"security":{"proxy":{"enabled":true,"type":"http","host":"127.0.0.1","port":proxy.local_addr().unwrap().port()}}});
        let server = tokio::spawn(async move {
            let (mut socket, _) = proxy.accept().await.unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                header.push(socket.read_u8().await.unwrap());
            }
            socket
                .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                .await
                .unwrap();
        });
        assert!(dial_route(
            &saved_route(&config).unwrap(),
            &Authority::parse(&tripwire.local_addr().unwrap().to_string()).unwrap()
        )
        .await
        .is_err());
        assert!(
            tokio::time::timeout(Duration::from_millis(50), tripwire.accept())
                .await
                .is_err()
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn https_upstream_negotiates_tls_and_never_falls_back_on_failure() {
        let proxy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = json!({"security":{"proxy":{"enabled":true,"type":"https","host":"127.0.0.1","port":proxy.local_addr().unwrap().port()}}});
        let hops = saved_route(&config).unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = proxy.accept().await.unwrap();
            let mut header = [0; 3];
            socket.read_exact(&mut header).await.unwrap();
            assert_eq!(header[0], 22); // TLS handshake, never cleartext CONNECT.
            assert_eq!(header[1], 3);
        });
        assert!(tokio::time::timeout(
            Duration::from_secs(10),
            dial_route(
                &hops,
                &Authority::parse(&target.local_addr().unwrap().to_string()).unwrap()
            )
        )
        .await
        .unwrap()
        .is_err());
        server.await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), target.accept())
                .await
                .is_err()
        );
    }
}
