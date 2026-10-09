//! Public request policy for the native real-origin browser. This module does
//! not install request handlers, grant credentials, or establish containment.
//! Build an immutable engine for an owned attempt; native route/safety denials
//! always take priority. The legacy rewrite engine does not consume this model.

use regex::Regex;
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::marker::PhantomData;
use std::sync::LazyLock;
use url::Url;

pub const MAX_WEBSITE_PERMISSION_WEBSITES: usize = 64;
pub const MAX_WEBSITE_PERMISSION_DESTINATIONS: usize = 32;
pub const MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS: usize = 256;
pub const MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("Invalid website request permissions.")]
pub struct DomainPermissionError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WebsiteRequestClass {
    Script,
    Stylesheet,
    Font,
    ImageMedia,
    FetchXhr,
    Frame,
    Worker,
    Websocket,
    Navigation,
}

impl WebsiteRequestClass {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "script" => Self::Script,
            "stylesheet" => Self::Stylesheet,
            "font" => Self::Font,
            "image-media" => Self::ImageMedia,
            "fetch-xhr" => Self::FetchXhr,
            "frame" => Self::Frame,
            "worker" => Self::Worker,
            "websocket" => Self::Websocket,
            "navigation" => Self::Navigation,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebsitePermissionDecision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebsitePermissionSetting {
    Inherit,
    Allow,
    Deny,
}

impl WebsitePermissionSetting {
    fn decision(self) -> Option<WebsitePermissionDecision> {
        match self {
            Self::Inherit => None,
            Self::Allow => Some(WebsitePermissionDecision::Allow),
            Self::Deny => Some(WebsitePermissionDecision::Deny),
        }
    }
}

pub type WebsiteRequestClassPermissions = BTreeMap<WebsiteRequestClass, WebsitePermissionSetting>;
pub type WebsitePermissionApplicationDefaults =
    BTreeMap<WebsiteRequestClass, WebsitePermissionDecision>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebsiteDestinationPermissions {
    pub origin: String,
    #[serde(default, deserialize_with = "deserialize_classes")]
    pub request_classes: WebsiteRequestClassPermissions,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebsiteOriginPermissions {
    pub origin: String,
    #[serde(default, deserialize_with = "deserialize_classes")]
    pub request_classes: WebsiteRequestClassPermissions,
    #[serde(default, deserialize_with = "deserialize_destinations")]
    pub destinations: Vec<WebsiteDestinationPermissions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteDomainPermissionsSettings {
    pub version: u8,
    pub websites: Vec<WebsiteOriginPermissions>,
}

impl Default for WebsiteDomainPermissionsSettings {
    fn default() -> Self {
        Self {
            version: 1,
            websites: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsWire {
    version: u8,
    #[serde(deserialize_with = "deserialize_websites")]
    websites: Vec<WebsiteOriginPermissions>,
}

impl<'de> Deserialize<'de> for WebsiteDomainPermissionsSettings {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Serde errors can include malicious field names/values. Expose only a
        // fixed error at the public settings boundary, never the pasted input.
        let wire = SettingsWire::deserialize(deserializer)
            .map_err(|_| de::Error::custom(DomainPermissionError))?;
        Self {
            version: wire.version,
            websites: wire.websites,
        }
        .normalized()
        .map_err(de::Error::custom)
    }
}

fn bounded_sequence<'de, D, T, const MAX: usize>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Bounded<T, const MAX: usize>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>, const MAX: usize> Visitor<'de> for Bounded<T, MAX> {
        type Value = Vec<T>;
        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a bounded list of website rules")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            if seq.size_hint().is_some_and(|size| size > MAX) {
                return Err(de::Error::custom(DomainPermissionError));
            }
            let mut values = Vec::new();
            while values.len() < MAX {
                match seq.next_element()? {
                    Some(value) => values.push(value),
                    None => return Ok(values),
                }
            }
            if seq.next_element::<de::IgnoredAny>()?.is_some() {
                return Err(de::Error::custom(DomainPermissionError));
            }
            Ok(values)
        }
    }
    deserializer.deserialize_seq(Bounded::<T, MAX>(PhantomData))
}

fn deserialize_websites<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Vec<WebsiteOriginPermissions>, D::Error> {
    bounded_sequence::<D, WebsiteOriginPermissions, MAX_WEBSITE_PERMISSION_WEBSITES>(d)
}

fn deserialize_destinations<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Vec<WebsiteDestinationPermissions>, D::Error> {
    bounded_sequence::<D, WebsiteDestinationPermissions, MAX_WEBSITE_PERMISSION_DESTINATIONS>(d)
}

fn deserialize_classes<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<WebsiteRequestClassPermissions, D::Error> {
    struct Classes;
    impl<'de> Visitor<'de> for Classes {
        type Value = WebsiteRequestClassPermissions;
        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("known request classes with inherit, allow or deny values")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut classes = BTreeMap::new();
            while let Some((key, value)) = map.next_entry()? {
                if classes.insert(key, value).is_some() {
                    return Err(de::Error::custom(DomainPermissionError));
                }
            }
            Ok(classes)
        }
    }
    d.deserialize_map(Classes)
}

/// Equivalent to the frontend origin-only validator: IDNs become punycode;
/// default HTTPS ports collapse; other ports/schemes never gain implied grants.
pub fn canonical_website_permission_origin(value: &str) -> Result<String, DomainPermissionError> {
    canonical_request_origin_inner(value, false)
}

/// Native request metadata can be HTTP. Stored domain grants remain HTTPS-only.
pub fn canonical_browser_request_origin(value: &str) -> Result<String, DomainPermissionError> {
    canonical_request_origin_inner(value, true)
}

fn canonical_request_origin_inner(value: &str, allow_http: bool) -> Result<String, DomainPermissionError> {
    static FORBIDDEN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[\s\p{C}@%*\\?#]").expect("static origin character pattern"));
    static AUTHORITY: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^https?://(\[[0-9a-f:.]+\]|[^:/]+)(?::([1-9][0-9]{0,4}))?/?$")
            .expect("static HTTPS authority pattern")
    });
    if value.encode_utf16().count() > MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH
        || FORBIDDEN.is_match(value)
    {
        return Err(DomainPermissionError);
    }
    let captures = AUTHORITY.captures(value).ok_or(DomainPermissionError)?;
    if let Some(port) = captures.get(2) {
        port.as_str()
            .parse::<u16>()
            .map_err(|_| DomainPermissionError)?;
    }
    let url = Url::parse(value).map_err(|_| DomainPermissionError)?;
    let host = url.host_str().ok_or(DomainPermissionError)?;
    if !(url.scheme() == "https" || allow_http && url.scheme() == "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || host.is_empty()
    {
        return Err(DomainPermissionError);
    }
    if !host.starts_with('[') {
        let invalid_label = host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || !label.as_bytes()[0].is_ascii_alphanumeric()
                || !label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                || !label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        });
        let ipv4_alias = host.bytes().all(|c| c.is_ascii_digit() || c == b'.')
            && host != captures.get(1).ok_or(DomainPermissionError)?.as_str();
        if host.len() > 253 || invalid_label || ipv4_alias {
            return Err(DomainPermissionError);
        }
    }
    Ok(url.origin().ascii_serialization())
}

impl WebsiteDomainPermissionsSettings {
    /// Revalidate programmatically constructed policies, too; no truncation or
    /// silent recovery of invalid rows into a more permissive inherited rule.
    pub fn normalized(&self) -> Result<Self, DomainPermissionError> {
        if self.version != 1 || self.websites.len() > MAX_WEBSITE_PERMISSION_WEBSITES {
            return Err(DomainPermissionError);
        }
        let mut result = self.clone();
        let mut websites = HashSet::new();
        let mut total = 0;
        for website in &mut result.websites {
            website.origin = canonical_website_permission_origin(&website.origin)?;
            if !websites.insert(website.origin.clone())
                || website.destinations.len() > MAX_WEBSITE_PERMISSION_DESTINATIONS
            {
                return Err(DomainPermissionError);
            }
            total += website.destinations.len();
            if total > MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS {
                return Err(DomainPermissionError);
            }
            let mut destinations = HashSet::new();
            for destination in &mut website.destinations {
                destination.origin = canonical_website_permission_origin(&destination.origin)?;
                if !destinations.insert(destination.origin.clone()) {
                    return Err(DomainPermissionError);
                }
            }
        }
        Ok(result)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WebsitePermissionSource {
    NativeConstraint,
    ConnectionDestination,
    ConnectionClass,
    SharedDestination,
    SharedClass,
    ApplicationDefault,
    InvalidPolicy,
    InvalidRequest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectiveWebsitePermission {
    pub decision: WebsitePermissionDecision,
    pub source: WebsitePermissionSource,
}

impl EffectiveWebsitePermission {
    fn denied(source: WebsitePermissionSource) -> Self {
        Self {
            decision: WebsitePermissionDecision::Deny,
            source,
        }
    }
}

/// Native callers supply origins, not request URLs. In particular, WSS must not
/// be rewritten into an HTTPS grant here; transport mapping belongs to the
/// separately validated native request boundary.
#[derive(Clone, Copy)]
pub struct WebsitePermissionQuery<'a> {
    pub website_origin: &'a str,
    pub destination_origin: &'a str,
    pub request_class: &'a str,
    pub native_denied: bool,
}

/// Native-only, connection-scoped request defaults. This is not a login,
/// certificate, CORS or page-CSP grant. Explicit domain rules are resolved first.
#[derive(Clone, Default)]
pub struct WebsiteNetworkPolicy {
    pub source_origin: String,
    pub destination_defaults: BTreeMap<String, WebsitePermissionApplicationDefaults>,
    pub allow_all_requests: bool,
    pub allow_all_scripts: bool,
    pub https_only: bool,
    pub same_origin_only: bool,
    pub allow_http_downgrade: bool,
}

/// Validated immutable policy snapshot; no session identity, proxy or secrets.
#[derive(Clone)]
pub struct WebsitePermissionEngine {
    temporary_http_source: Option<String>,
    shared: WebsiteDomainPermissionsSettings,
    connection: WebsiteDomainPermissionsSettings,
    application_defaults: WebsitePermissionApplicationDefaults,
    cross_origin_requests_enabled: bool,
    network_policy: Option<WebsiteNetworkPolicy>,
}

impl WebsitePermissionEngine {
    pub fn new(
        shared: Option<&WebsiteDomainPermissionsSettings>,
        connection: Option<&WebsiteDomainPermissionsSettings>,
        application_defaults: &WebsitePermissionApplicationDefaults,
    ) -> Result<Self, DomainPermissionError> {
        Ok(Self {
            temporary_http_source: None,
            shared: shared
                .map(WebsiteDomainPermissionsSettings::normalized)
                .transpose()?
                .unwrap_or_default(),
            connection: connection
                .map(WebsiteDomainPermissionsSettings::normalized)
                .transpose()?
                .unwrap_or_default(),
            application_defaults: application_defaults.clone(),
            cross_origin_requests_enabled: true,
            network_policy: None,
        })
    }

    /// Explicit temporary HTTP source, not a reusable domain grant. No other
    /// origin (including its HTTPS spelling) obtains navigation/resource rights.
    pub fn temporary_http(source: &str, defaults: &WebsitePermissionApplicationDefaults) -> Result<Self, DomainPermissionError> {
        let source = canonical_browser_request_origin(source)?;
        if !source.starts_with("http://") { return Err(DomainPermissionError); }
        let mut engine = Self::new(None, None, defaults)?;
        engine.temporary_http_source = Some(source);
        Ok(engine)
    }

    /// An additional native restriction, never a new route or CORS exception.
    /// Applying an enabled policy cannot undo an existing restriction.
    pub fn restrict_cross_origin_requests(mut self, enabled: bool) -> Self {
        self.cross_origin_requests_enabled &= enabled;
        self
    }

    /// Bind request defaults to one validated source. Stored domain grants
    /// remain HTTPS-only; HTTP transport is admitted only by this native policy.
    pub fn with_network_policy(
        mut self,
        mut policy: WebsiteNetworkPolicy,
    ) -> Result<Self, DomainPermissionError> {
        if self.temporary_http_source.is_some()
            || policy.destination_defaults.len() > MAX_WEBSITE_PERMISSION_DESTINATIONS
        {
            return Err(DomainPermissionError);
        }
        policy.source_origin = canonical_browser_request_origin(&policy.source_origin)?;
        let mut destinations = BTreeMap::new();
        for (origin, defaults) in policy.destination_defaults {
            let origin = canonical_browser_request_origin(&origin)?;
            if destinations.insert(origin, defaults).is_some() {
                return Err(DomainPermissionError);
            }
        }
        policy.destination_defaults = destinations;
        self.network_policy = Some(policy);
        Ok(self)
    }

    /// Coarse transport/TLS admission only. Resource callbacks must still resolve
    /// their actual native request class; script access does not grant navigation.
    pub fn permits_network_origin(&self, source: &str, destination: &str) -> bool {
        [
            "script", "stylesheet", "font", "image-media", "fetch-xhr",
            "frame", "worker", "websocket", "navigation",
        ]
        .iter()
        .any(|class| {
            self.resolve(WebsitePermissionQuery {
                website_origin: source,
                destination_origin: destination,
                request_class: class,
                native_denied: false,
            }).decision == WebsitePermissionDecision::Allow
        })
    }

    pub fn resolve(&self, query: WebsitePermissionQuery<'_>) -> EffectiveWebsitePermission {
        use WebsitePermissionSource::*;
        if query.native_denied {
            return EffectiveWebsitePermission::denied(NativeConstraint);
        }
        if let Some(source) = &self.temporary_http_source {
            let valid = canonical_browser_request_origin(query.website_origin).as_ref() == Ok(source)
                && canonical_browser_request_origin(query.destination_origin).as_ref() == Ok(source);
            let class = WebsiteRequestClass::parse(query.request_class);
            if !valid || class.is_none() {
                return EffectiveWebsitePermission::denied(NativeConstraint);
            }
            return EffectiveWebsitePermission {
                decision: self.application_defaults.get(&class.unwrap()).copied().unwrap_or(WebsitePermissionDecision::Deny),
                source: ApplicationDefault,
            };
        }
        let canonical = if self.network_policy.is_some() {
            canonical_browser_request_origin
        } else {
            canonical_website_permission_origin
        };
        let (Ok(website), Ok(destination), Some(class)) = (
            canonical(query.website_origin),
            canonical(query.destination_origin),
            WebsiteRequestClass::parse(query.request_class),
        ) else {
            return EffectiveWebsitePermission::denied(InvalidRequest);
        };
        if !self.cross_origin_requests_enabled && website != destination {
            return EffectiveWebsitePermission::denied(NativeConstraint);
        }
        if let Some(policy) = &self.network_policy {
            let broad_class = policy.allow_all_requests
                || policy.allow_all_scripts
                    && class == WebsiteRequestClass::Script
                    && destination.starts_with("https://");
            if website != policy.source_origin
                || policy.same_origin_only && website != destination
                || policy.https_only && !destination.starts_with("https://")
                || !policy.allow_http_downgrade && website.starts_with("https://")
                    && destination.starts_with("http://")
                    && matches!(class, WebsiteRequestClass::Navigation | WebsiteRequestClass::Frame)
                || !policy.destination_defaults.contains_key(&destination)
                    && (!broad_class || !broad_request_destination(&destination))
            {
                return EffectiveWebsitePermission::denied(NativeConstraint);
            }
        }
        let own = self
            .connection
            .websites
            .iter()
            .find(|row| row.origin == website);
        let shared = self
            .shared
            .websites
            .iter()
            .find(|row| row.origin == website);
        let class_rule = |row: Option<&WebsiteOriginPermissions>| {
            row.and_then(|row| row.request_classes.get(&class)).copied()
        };
        let destination_rule = |row: Option<&WebsiteOriginPermissions>| {
            row.and_then(|row| {
                row.destinations
                    .iter()
                    .find(|row| row.origin == destination)
            })
            .and_then(|row| row.request_classes.get(&class))
            .copied()
        };
        for (rule, source) in [
            (destination_rule(own), ConnectionDestination),
            (class_rule(own), ConnectionClass),
            (destination_rule(shared), SharedDestination),
            (class_rule(shared), SharedClass),
        ] {
            if let Some(decision) = rule.and_then(WebsitePermissionSetting::decision) {
                return EffectiveWebsitePermission { decision, source };
            }
        }
        if let Some(policy) = &self.network_policy {
            if let Some(decision) = policy.destination_defaults
                .get(&destination).and_then(|defaults| defaults.get(&class))
            {
                return EffectiveWebsitePermission {
                    decision: *decision,
                    source: ApplicationDefault,
                };
            }
            // Broad defaults never expose the app's local endpoints. Explicit
            // reviewed destinations and the saved source retain existing rules.
            if (policy.allow_all_requests || policy.allow_all_scripts
                    && class == WebsiteRequestClass::Script && destination.starts_with("https://"))
                && broad_request_destination(&destination)
            {
                return EffectiveWebsitePermission {
                    decision: WebsitePermissionDecision::Allow,
                    source: ApplicationDefault,
                };
            }
        }
        EffectiveWebsitePermission {
            decision: self
                .application_defaults
                .get(&class)
                .copied()
                .unwrap_or(WebsitePermissionDecision::Deny),
            source: ApplicationDefault,
        }
    }
}

fn broad_request_destination(origin: &str) -> bool {
    let Ok(url) = Url::parse(origin) else { return false; };
    match url.host() {
        Some(url::Host::Domain(host)) => host != "localhost" && !host.ends_with(".localhost"),
        Some(url::Host::Ipv4(ip)) => !ip.is_loopback() && !ip.is_unspecified(),
        Some(url::Host::Ipv6(ip)) => !ip.is_loopback() && !ip.is_unspecified()
            && ip.to_ipv4_mapped().is_none_or(|v4| !v4.is_loopback() && !v4.is_unspecified()),
        None => false,
    }
}

/// Convenience boundary for callers without a retained validated snapshot.
/// For request callbacks prefer building one engine per immutable attempt.
pub fn resolve_website_request_permission(
    query: WebsitePermissionQuery<'_>,
    shared: Option<&WebsiteDomainPermissionsSettings>,
    connection: Option<&WebsiteDomainPermissionsSettings>,
    application_defaults: &WebsitePermissionApplicationDefaults,
) -> EffectiveWebsitePermission {
    if query.native_denied {
        return EffectiveWebsitePermission::denied(WebsitePermissionSource::NativeConstraint);
    }
    match WebsitePermissionEngine::new(shared, connection, application_defaults) {
        Ok(engine) => engine.resolve(query),
        Err(_) => EffectiveWebsitePermission::denied(WebsitePermissionSource::InvalidPolicy),
    }
}

#[cfg(test)]
#[path = "domain_network_policy_tests.rs"]
mod network_policy_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporary_http_is_exact_origin_and_does_not_enable_stored_http_grants() {
        let defaults = [(WebsiteRequestClass::Navigation, WebsitePermissionDecision::Allow),
            (WebsiteRequestClass::Script, WebsitePermissionDecision::Allow)].into_iter().collect();
        let engine = WebsitePermissionEngine::temporary_http("http://router.test:8080", &defaults).unwrap();
        for (destination, native_denied, expected) in [
            ("http://router.test:8080", false, WebsitePermissionDecision::Allow),
            ("http://router.test:8080", true, WebsitePermissionDecision::Deny),
            ("https://router.test:8080", false, WebsitePermissionDecision::Deny),
            ("http://router.test", false, WebsitePermissionDecision::Deny),
            ("http://other.test:8080", false, WebsitePermissionDecision::Deny),
        ] {
            assert_eq!(engine.resolve(WebsitePermissionQuery { website_origin:"http://router.test:8080", destination_origin:destination,
                request_class:"navigation", native_denied }).decision, expected);
        }
        assert!(canonical_website_permission_origin("http://router.test:8080").is_err());
        assert_eq!(canonical_browser_request_origin("http://router.test:8080").unwrap(), "http://router.test:8080");
        assert!(canonical_browser_request_origin("http://user:secret@router.test").is_err());
    }
    use serde_json::json;

    const WEBSITE: &str = "https://example.com";
    const DESTINATION: &str = "https://cdn.example.com";
    const CLASSES: [&str; 9] = [
        "script",
        "stylesheet",
        "font",
        "image-media",
        "fetch-xhr",
        "frame",
        "worker",
        "websocket",
        "navigation",
    ];

    fn policy(
        class: WebsiteRequestClass,
        website: WebsitePermissionSetting,
        destination: WebsitePermissionSetting,
    ) -> WebsiteDomainPermissionsSettings {
        WebsiteDomainPermissionsSettings {
            version: 1,
            websites: vec![WebsiteOriginPermissions {
                origin: WEBSITE.into(),
                request_classes: BTreeMap::from([(class, website)]),
                destinations: vec![WebsiteDestinationPermissions {
                    origin: DESTINATION.into(),
                    request_classes: BTreeMap::from([(class, destination)]),
                }],
            }],
        }
    }

    fn query(class: &str) -> WebsitePermissionQuery<'_> {
        WebsitePermissionQuery {
            website_origin: WEBSITE,
            destination_origin: DESTINATION,
            request_class: class,
            native_denied: false,
        }
    }

    #[test]
    fn cross_origin_restriction_denies_every_class_without_widening_same_origin_policy() {
        for class in CLASSES {
            let settings = policy(
                WebsiteRequestClass::parse(class).unwrap(),
                WebsitePermissionSetting::Allow,
                WebsitePermissionSetting::Allow,
            );
            let allowed =
                WebsitePermissionEngine::new(Some(&settings), None, &BTreeMap::new()).unwrap();
            assert_eq!(
                allowed.resolve(query(class)).decision,
                WebsitePermissionDecision::Allow
            );
            let restricted = allowed
                .restrict_cross_origin_requests(false)
                .restrict_cross_origin_requests(true);
            assert_eq!(
                restricted.resolve(query(class)).source,
                WebsitePermissionSource::NativeConstraint
            );
            let same = WebsitePermissionQuery {
                destination_origin: "https://EXAMPLE.com:443/",
                ..query(class)
            };
            assert_eq!(
                restricted.resolve(same).decision,
                WebsitePermissionDecision::Allow
            );
            assert_eq!(
                restricted
                    .resolve(WebsitePermissionQuery {
                        native_denied: true,
                        ..same
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
            let denied = policy(
                WebsiteRequestClass::parse(class).unwrap(),
                WebsitePermissionSetting::Deny,
                WebsitePermissionSetting::Allow,
            );
            let restricted = WebsitePermissionEngine::new(Some(&denied), None, &BTreeMap::new())
                .unwrap()
                .restrict_cross_origin_requests(false);
            assert_eq!(
                restricted.resolve(same).decision,
                WebsitePermissionDecision::Deny
            );
        }
    }

    #[test]
    fn canonical_origins_match_frontend_forms() {
        for (input, expected) in [
            ("https://EXAMPLE.com/", WEBSITE),
            ("HTTPS://example.com:443", WEBSITE),
            ("https://example.com:8443/", "https://example.com:8443"),
            ("https://bücher.example", "https://xn--bcher-kva.example"),
            (
                "https://xn--bcher-kva.example/",
                "https://xn--bcher-kva.example",
            ),
            ("https://192.0.2.1", "https://192.0.2.1"),
            (
                "https://[2001:0DB8:0:0:0:0:0:1]:8443",
                "https://[2001:db8::1]:8443",
            ),
        ] {
            assert_eq!(
                canonical_website_permission_origin(input).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn unsafe_origins_fail_closed_without_exposing_input() {
        for value in [
            "",
            "example.com",
            "//example.com",
            "http://example.com",
            "wss://example.com",
            "ws://example.com",
            "file:///example.com",
            "https://*.example.com",
            "https://example.com.*",
            "https://example.com/path",
            "https://example.com/.",
            "https://example.com//",
            "https://user:secret@example.com",
            "https://@example.com",
            "https://example.com?",
            "https://example.com?token=secret",
            "https://example.com#",
            "https://example.com/#fragment",
            " https://example.com",
            "https://example.com ",
            "https://exam\nple.com",
            "https://exam\tple.com",
            "https://exam\u{ad}ple.com",
            "https://example.com\\evil.test",
            "https://%65xample.com",
            "https:////example.com",
            "https:///example.com",
            "https://example.com:",
            "https://example.com:0",
            "https://example.com:0443",
            "https://example.com:65536",
            "https://example.com:abc",
            "https://example.com.",
            "https://-example.com",
            "https://exam_ple.com",
            "https://example..com",
            "https://127.1",
            "https://2130706433",
            "https://0x7f000001",
            "https://0177.0.0.1",
            "https://[fe80::1%25eth0]",
        ] {
            let error = canonical_website_permission_origin(value).unwrap_err();
            assert_eq!(error.to_string(), "Invalid website request permissions.");
        }
        assert!(
            canonical_website_permission_origin(&format!("https://{}.com", "x".repeat(64)))
                .is_err()
        );
        assert!(canonical_website_permission_origin(&format!(
            "https://{}",
            "x".repeat(MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH)
        ))
        .is_err());
    }

    #[test]
    fn serde_uses_the_public_frontend_shape_and_redacts_malformed_input() {
        let input = json!({"version":1,"websites":[{"origin":"https://EXAMPLE.com:443/","requestClasses":{"script":"inherit","worker":"deny"},"destinations":[{"origin":DESTINATION,"requestClasses":{"font":"allow"}}]}]});
        let settings: WebsiteDomainPermissionsSettings = serde_json::from_value(input).unwrap();
        let output = serde_json::to_value(&settings).unwrap();
        assert_eq!(output["websites"][0]["origin"], WEBSITE);
        assert_eq!(output["websites"][0]["requestClasses"]["script"], "inherit");
        assert_eq!(
            serde_json::from_value::<WebsiteDomainPermissionsSettings>(output).unwrap(),
            settings
        );
        for input in [
            json!(null),
            json!([]),
            json!({}),
            json!({"version":2,"websites":[]}),
            json!({"version":"1","websites":[]}),
            json!({"version":1,"websites":null}),
            json!({"version":1,"websites":[],"token-secret":"secret"}),
            json!({"version":1,"websites":[null]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"credentials":"secret"}]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"requestClasses":null}]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"requestClasses":{"unknown-secret":"allow"}}]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"requestClasses":{"script":true}}]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"requestClasses":{"script":"ALLOW"}}]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"destinations":null}]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"destinations":[{"origin":DESTINATION,"secret":"secret"}]}]}),
        ] {
            let error =
                serde_json::from_value::<WebsiteDomainPermissionsSettings>(input).unwrap_err();
            assert!(!error.to_string().contains("secret"));
            assert!(error
                .to_string()
                .starts_with("Invalid website request permissions."));
        }
        let duplicate_class = r#"{"version":1,"websites":[{"origin":"https://example.com","requestClasses":{"script":"deny","script":"allow"}}]}"#;
        assert!(serde_json::from_str::<WebsiteDomainPermissionsSettings>(duplicate_class).is_err());
    }

    #[test]
    fn serde_rejects_duplicate_origins_after_canonicalization() {
        for input in [
            json!({"version":1,"websites":[{"origin":WEBSITE},{"origin":"https://EXAMPLE.com:443/"}]}),
            json!({"version":1,"websites":[{"origin":WEBSITE,"destinations":[{"origin":"https://bücher.example"},{"origin":"https://xn--bcher-kva.example"}]}]}),
        ] {
            assert!(serde_json::from_value::<WebsiteDomainPermissionsSettings>(input).is_err());
        }
    }

    #[test]
    fn bounded_lists_reject_overflow_instead_of_truncating() {
        let website = |i| WebsiteOriginPermissions {
            origin: format!("https://site{i}.example"),
            request_classes: BTreeMap::new(),
            destinations: vec![],
        };
        let mut settings = WebsiteDomainPermissionsSettings {
            version: 1,
            websites: (0..MAX_WEBSITE_PERMISSION_WEBSITES).map(website).collect(),
        };
        assert!(settings.normalized().is_ok());
        settings.websites.push(website(100));
        assert!(settings.normalized().is_err());
        assert!(serde_json::from_value::<WebsiteDomainPermissionsSettings>(
            serde_json::to_value(&settings).unwrap()
        )
        .is_err());
        settings.websites = vec![website(0)];
        settings.websites[0].destinations = (0..MAX_WEBSITE_PERMISSION_DESTINATIONS)
            .map(|i| WebsiteDestinationPermissions {
                origin: format!("https://cdn{i}.example"),
                request_classes: BTreeMap::new(),
            })
            .collect();
        assert!(settings.normalized().is_ok());
        let full = settings.websites[0].clone();
        settings.websites[0]
            .destinations
            .push(WebsiteDestinationPermissions {
                origin: "https://extra.example".into(),
                request_classes: BTreeMap::new(),
            });
        assert!(settings.normalized().is_err());
        assert!(serde_json::from_value::<WebsiteDomainPermissionsSettings>(
            serde_json::to_value(&settings).unwrap()
        )
        .is_err());
        settings.websites = (0..(MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS
            / MAX_WEBSITE_PERMISSION_DESTINATIONS))
            .map(|i| WebsiteOriginPermissions {
                origin: format!("https://site{i}.example"),
                ..full.clone()
            })
            .collect();
        assert!(settings.normalized().is_ok());
        settings.websites.push(WebsiteOriginPermissions {
            destinations: vec![full.destinations[0].clone()],
            ..website(100)
        });
        assert!(settings.normalized().is_err());
        assert!(serde_json::from_value::<WebsiteDomainPermissionsSettings>(
            serde_json::to_value(&settings).unwrap()
        )
        .is_err());
    }

    #[test]
    fn all_nine_classes_follow_every_precedence_level() {
        use WebsitePermissionDecision::{Allow, Deny};
        use WebsitePermissionSetting::{Allow as Grant, Deny as Block, Inherit};
        use WebsitePermissionSource::*;
        for name in CLASSES {
            let class = WebsiteRequestClass::parse(name).unwrap();
            let mut shared = policy(class, Block, Grant);
            let mut connection = policy(class, Block, Grant);
            let defaults = BTreeMap::from([(class, Allow)]);
            let resolve = |shared: &_, connection: &_| {
                resolve_website_request_permission(
                    query(name),
                    Some(shared),
                    Some(connection),
                    &defaults,
                )
            };
            assert_eq!(
                resolve_website_request_permission(
                    WebsitePermissionQuery {
                        native_denied: true,
                        ..query(name)
                    },
                    Some(&shared),
                    Some(&connection),
                    &defaults
                ),
                EffectiveWebsitePermission {
                    decision: Deny,
                    source: NativeConstraint
                }
            );
            assert_eq!(
                resolve(&shared, &connection),
                EffectiveWebsitePermission {
                    decision: Allow,
                    source: ConnectionDestination
                }
            );
            connection.websites[0].destinations[0]
                .request_classes
                .insert(class, Inherit);
            assert_eq!(
                resolve(&shared, &connection),
                EffectiveWebsitePermission {
                    decision: Deny,
                    source: ConnectionClass
                }
            );
            connection.websites[0]
                .request_classes
                .insert(class, Inherit);
            assert_eq!(
                resolve(&shared, &connection),
                EffectiveWebsitePermission {
                    decision: Allow,
                    source: SharedDestination
                }
            );
            shared.websites[0].destinations[0]
                .request_classes
                .insert(class, Inherit);
            assert_eq!(
                resolve(&shared, &connection),
                EffectiveWebsitePermission {
                    decision: Deny,
                    source: SharedClass
                }
            );
            shared.websites[0].request_classes.insert(class, Inherit);
            assert_eq!(
                resolve(&shared, &connection),
                EffectiveWebsitePermission {
                    decision: Allow,
                    source: ApplicationDefault
                }
            );
            assert_eq!(
                resolve_website_request_permission(
                    query(name),
                    Some(&shared),
                    Some(&connection),
                    &BTreeMap::new()
                ),
                EffectiveWebsitePermission {
                    decision: Deny,
                    source: ApplicationDefault
                }
            );
        }
    }

    #[test]
    fn exact_origin_and_class_matching_never_widens_a_grant() {
        let settings = policy(
            WebsiteRequestClass::Script,
            WebsitePermissionSetting::Inherit,
            WebsitePermissionSetting::Allow,
        );
        let engine = WebsitePermissionEngine::new(Some(&settings), None, &BTreeMap::new()).unwrap();
        for destination in [
            "https://sub.cdn.example.com",
            "https://cdn.example.com:8443",
            "https://cdn.example.com.evil.test",
            WEBSITE,
        ] {
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        destination_origin: destination,
                        ..query("script")
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
        }
        for website in [
            "https://sub.example.com",
            "https://example.com:8443",
            "https://other.test",
        ] {
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        website_origin: website,
                        ..query("script")
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
        }
        assert_eq!(
            engine.resolve(query("worker")).decision,
            WebsitePermissionDecision::Deny
        );
        for class in ["other", "SCRIPT", "inline", ""] {
            assert_eq!(
                engine.resolve(query(class)).source,
                WebsitePermissionSource::InvalidRequest
            );
        }
        for destination in [
            "https://cdn.example.com/path",
            "wss://cdn.example.com",
            "http://cdn.example.com",
        ] {
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        destination_origin: destination,
                        ..query("script")
                    })
                    .source,
                WebsitePermissionSource::InvalidRequest
            );
        }
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: "HTTPS://EXAMPLE.com:443/",
                    destination_origin: "https://CDN.example.com/",
                    ..query("script")
                })
                .decision,
            WebsitePermissionDecision::Allow
        );
    }

    #[test]
    fn invalid_masked_policy_and_native_denials_cannot_be_overridden() {
        let invalid = WebsiteDomainPermissionsSettings {
            version: 2,
            websites: vec![],
        };
        let allowed = policy(
            WebsiteRequestClass::Script,
            WebsitePermissionSetting::Allow,
            WebsitePermissionSetting::Allow,
        );
        assert_eq!(
            resolve_website_request_permission(
                query("script"),
                Some(&invalid),
                Some(&allowed),
                &BTreeMap::new()
            )
            .source,
            WebsitePermissionSource::InvalidPolicy
        );
        assert_eq!(
            resolve_website_request_permission(
                WebsitePermissionQuery {
                    native_denied: true,
                    ..query("script")
                },
                Some(&invalid),
                Some(&allowed),
                &BTreeMap::new()
            )
            .source,
            WebsitePermissionSource::NativeConstraint
        );
    }

    #[test]
    fn engine_snapshot_is_immutable_and_sources_match_the_frontend_wire_format() {
        let mut settings = policy(
            WebsiteRequestClass::Script,
            WebsitePermissionSetting::Inherit,
            WebsitePermissionSetting::Allow,
        );
        let engine = WebsitePermissionEngine::new(Some(&settings), None, &BTreeMap::new()).unwrap();
        settings.websites[0].destinations[0]
            .request_classes
            .insert(WebsiteRequestClass::Script, WebsitePermissionSetting::Deny);
        assert_eq!(
            serde_json::to_value(engine.resolve(query("script"))).unwrap(),
            json!({"decision":"allow","source":"shared-destination"})
        );
        for name in CLASSES {
            assert_eq!(
                serde_json::to_value(WebsiteRequestClass::parse(name).unwrap()).unwrap(),
                json!(name)
            );
        }
    }
}
