//! Reviewed anonymous MEO customer identity handoffs; network defaults only.
//! Credential stages belong to the separately reviewed declarative catalog.

use serde_json::Value;
use sorng_browser_host::domain_permissions::{WebsiteRequestClass, WebsiteResourceDomainDefault};

const NAVIGATION: &[WebsiteRequestClass] = &[WebsiteRequestClass::Navigation];
const IDENTITY_DOCUMENT: &[WebsiteRequestClass] = &[
    WebsiteRequestClass::Navigation,
    WebsiteRequestClass::Script,
    WebsiteRequestClass::Stylesheet,
    WebsiteRequestClass::Font,
    WebsiteRequestClass::ImageMedia,
    WebsiteRequestClass::FetchXhr,
];
const CONSUMER_API: &[WebsiteRequestClass] = &[WebsiteRequestClass::FetchXhr];
const EMPRESAS: &[(&str, &[WebsiteRequestClass])] = &[
    ("https://id.services.telecom.pt", NAVIGATION),
    ("https://login.telecom.pt", IDENTITY_DOCUMENT),
];
const PARTICULARES: &[(&str, &[WebsiteRequestClass])] = &[
    ("https://id.services.telecom.pt", NAVIGATION),
    ("https://login.telecom.pt", IDENTITY_DOCUMENT),
    ("https://services.telecom.pt", CONSUMER_API),
];

pub(super) fn grants(
    connection: &Value,
    source_origin: &str,
) -> &'static [(&'static str, &'static [WebsiteRequestClass])] {
    let Some(application) = connection.get("httpApplication") else {
        return &[];
    };
    if application.get("version") != Some(&Value::from(1)) || application.get("invalid").is_some() {
        return &[];
    }
    match (application.get("id").and_then(Value::as_str), source_origin) {
        (Some("meo-empresas"), "https://cliente-empresas.meo.pt") => EMPRESAS,
        (Some("meo-particulares"), "https://my.meo.pt") => PARTICULARES,
        _ => &[],
    }
}

/// hCaptcha's published integration contract requires varying asset hosts.
/// https://docs.hcaptcha.com/ (Content Security Policy settings).
/// Resource policy only: never document navigation or credential consent.
pub(super) fn resource_domain_defaults(
    connection: &Value,
    source_origin: &str,
) -> Vec<WebsiteResourceDomainDefault> {
    if grants(connection, source_origin).is_empty() {
        return Vec::new();
    }
    vec![WebsiteResourceDomainDefault {
        domain: "hcaptcha.com".into(),
        request_classes: [
            WebsiteRequestClass::Script,
            WebsiteRequestClass::Stylesheet,
            WebsiteRequestClass::Frame,
            WebsiteRequestClass::FetchXhr,
            WebsiteRequestClass::ImageMedia,
        ]
        .into_iter()
        .collect(),
    }]
}
