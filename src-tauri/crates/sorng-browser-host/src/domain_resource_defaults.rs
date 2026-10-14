//! Native-only resource families, validated before installation in an attempt.
use super::{DomainPermissionError, WebsiteRequestClass};
use std::collections::BTreeSet;
use url::{Host, Url};

/// HTTPS resources on this exact DNS domain or its dot-boundary subdomains.
/// No URL, wildcard syntax, arbitrary port, navigation or credential authority.
#[derive(Clone, Debug)]
pub struct WebsiteResourceDomainDefault {
    pub domain: String,
    pub request_classes: BTreeSet<WebsiteRequestClass>,
}

impl WebsiteResourceDomainDefault {
    pub(super) fn validate(&self) -> Result<(), DomainPermissionError> {
        let labels: Vec<_> = self.domain.split('.').collect();
        if self.domain.len() > 253
            || labels.len() < 2
            || self.domain.ends_with(".localhost")
            || labels.iter().any(|label| {
                label.is_empty()
                    || label.len() > 63
                    || label.starts_with('-')
                    || label.ends_with('-')
                    || !label.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                    })
            })
            || self.request_classes.is_empty()
            || self.request_classes.iter().any(|class| {
                !matches!(
                    class,
                    WebsiteRequestClass::Script
                        | WebsiteRequestClass::Stylesheet
                        | WebsiteRequestClass::Font
                        | WebsiteRequestClass::ImageMedia
                        | WebsiteRequestClass::FetchXhr
                        | WebsiteRequestClass::Frame
                )
            })
        {
            return Err(DomainPermissionError);
        }
        let parsed =
            Url::parse(&format!("https://{}/", self.domain)).map_err(|_| DomainPermissionError)?;
        if !matches!(parsed.host(), Some(Host::Domain(host)) if host == self.domain) {
            return Err(DomainPermissionError);
        }
        Ok(())
    }

    pub(super) fn permits(&self, destination: &str, class: WebsiteRequestClass) -> bool {
        if !self.request_classes.contains(&class) {
            return false;
        }
        let Ok(url) = Url::parse(destination) else {
            return false;
        };
        if url.scheme() != "https" || url.port_or_known_default() != Some(443) {
            return false;
        }
        let Some(Host::Domain(host)) = url.host() else {
            return false;
        };
        host == self.domain
            || host
                .strip_suffix(&self.domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    }
}
