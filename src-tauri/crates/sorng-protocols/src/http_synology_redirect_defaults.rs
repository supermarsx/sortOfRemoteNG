//! Runtime-only, connection-origin-bound defaults. This is a closed destination
//! exception for navigation receipts, never a wildcard or credential grant.
use reqwest::Url;
use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynologyQuickConnectDefaults {
    pub version: u8,
    pub original_origin: String,
}

const PORTALS: [&str; 2] = [
    "https://global.quickconnect.to",
    "https://www.quickconnect.to",
];
const RESERVED: [&str; 10] = [
    "global",
    "www",
    "relay",
    "account",
    "api",
    "portal",
    "help",
    "support",
    "connect",
    "discovery",
];

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && label.as_bytes()[0].is_ascii_alphanumeric()
        && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
        && label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn regional_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    (3..=63).contains(&bytes.len())
        && bytes[..2].iter().all(u8::is_ascii_lowercase)
        && bytes[2..].iter().all(u8::is_ascii_digit)
}

impl SynologyQuickConnectDefaults {
    pub(super) fn origins(&self) -> Result<Vec<String>, &'static str> {
        let invalid = "Invalid Synology QuickConnect redirect defaults.";
        if self.version != 1 || self.original_origin.len() > 2048 {
            return Err(invalid);
        }
        let origin = Url::parse(&self.original_origin).map_err(|_| invalid)?;
        let host = origin.host_str().ok_or(invalid)?;
        let invalid_domain = match origin.host() {
            Some(url::Host::Domain(domain)) => {
                domain.len() > 253 || !domain.split('.').all(valid_label)
            }
            Some(url::Host::Ipv4(_) | url::Host::Ipv6(_)) => false,
            None => true,
        };
        if !matches!(origin.scheme(), "http" | "https")
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.port() == Some(0)
            || host.ends_with('.')
            || invalid_domain
            || origin.origin().ascii_serialization() != self.original_origin
        {
            return Err(invalid);
        }
        let mut destinations: Vec<String> = PORTALS.iter().map(|value| (*value).into()).collect();
        if host == "quickconnect.to" || host.ends_with(".quickconnect.to") {
            // A QC hostname with a custom port is not the provider's canonical
            // browser route. Custom DSM/LAN origins outside this suffix may
            // retain their explicit port but never imply an alias.
            if origin.port().is_some() {
                return Err(invalid);
            }
            if let Some(prefix) = host.strip_suffix(".quickconnect.to") {
                let labels: Vec<_> = prefix.split('.').collect();
                let alias = labels[0];
                if !RESERVED.contains(&alias)
                    && (labels.len() == 1 || (labels.len() == 2 && regional_label(labels[1])))
                {
                    destinations.insert(0, format!("http://{alias}.quickconnect.to"));
                    destinations.insert(1, format!("https://{alias}.quickconnect.to"));
                }
            }
        }
        Ok(destinations)
    }

    pub(super) fn nas_alias(&self) -> Option<String> {
        let origins = self.origins().ok()?;
        let alias = origins
            .first()?
            .strip_prefix("http://")?
            .strip_suffix(".quickconnect.to")?;
        Some(alias.to_string())
    }

    fn permits_regional_origin(&self, destination: &Url) -> bool {
        let Some(alias) = self.nas_alias() else {
            return false;
        };
        let Some(host) = destination.host_str() else {
            return false;
        };
        destination.scheme() == "https"
            && destination.port().is_none()
            && destination.username().is_empty()
            && destination.password().is_none()
            && host
                .strip_suffix(".quickconnect.to")
                .and_then(|prefix| prefix.split_once('.'))
                .is_some_and(|(candidate_alias, region)| {
                    candidate_alias == alias && regional_label(region)
                })
    }

    fn permits_direct_origin(&self, destination: &Url) -> bool {
        let Some(alias) = self.nas_alias() else {
            return false;
        };
        let Some(host) = destination.host_str() else {
            return false;
        };
        let suffix = format!("{alias}.direct.quickconnect.to");
        let same_nas = host == suffix
            || host
                .strip_suffix(&format!(".{suffix}"))
                .is_some_and(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label.bytes().all(|byte| {
                            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                        })
                });
        destination.scheme() == "https"
            && matches!(destination.port(), Some(5001 | 5002))
            && destination.username().is_empty()
            && destination.password().is_none()
            && host.len() <= 253
            && same_nas
    }

    pub(super) fn permits_nas_origin(&self, destination: &Url) -> bool {
        self.permits_regional_origin(destination) || self.permits_direct_origin(destination)
    }

    pub fn validate(&self, current_target: &Url) -> Result<(), String> {
        let destinations = self.origins().map_err(str::to_string)?;
        let current = current_target.origin().ascii_serialization();
        if current == self.original_origin
            || destinations.contains(&current)
            || self.permits_regional_origin(current_target)
            || self.permits_direct_origin(current_target)
        {
            Ok(())
        } else {
            Err("Synology redirect defaults do not belong to this source connection.".into())
        }
    }

    pub(super) fn permits(&self, current_origin: &str, destination: &Url) -> bool {
        let Ok(current) = Url::parse(current_origin) else {
            return false;
        };
        self.validate(&current).is_ok()
            && (self.permits_regional_origin(destination)
                || self.permits_direct_origin(destination)
                || self.origins().is_ok_and(|origins| {
                    origins.contains(&destination.origin().ascii_serialization())
                }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(origin: &str) -> SynologyQuickConnectDefaults {
        SynologyQuickConnectDefaults {
            version: 1,
            original_origin: origin.into(),
        }
    }

    #[test]
    fn defaults_are_exact_and_alias_stays_original_across_portal_hops() {
        let defaults = context("https://nas-example.fr3.quickconnect.to");
        for current in [
            "https://nas-example.fr3.quickconnect.to",
            "https://nas-example.us2.quickconnect.to",
            "http://nas-example.quickconnect.to",
            "https://nas-example.quickconnect.to",
            "https://nas-example.direct.quickconnect.to:5001",
            "https://192-168-50-100.nas-example.direct.quickconnect.to:5002",
            PORTALS[0],
            PORTALS[1],
        ] {
            for destination in [
                "https://nas-example.fr3.quickconnect.to/path",
                "https://nas-example.us2.quickconnect.to/path",
                "http://nas-example.quickconnect.to/path",
                "https://nas-example.quickconnect.to/path",
                "https://nas-example.direct.quickconnect.to:5001/path",
                "https://192-168-50-100.nas-example.direct.quickconnect.to:5002/path",
                "https://global.quickconnect.to/path",
                "https://www.quickconnect.to/",
            ] {
                assert!(defaults.permits(current, &Url::parse(destination).unwrap()));
            }
            for rejected in [
                "http://nas-example.us2.quickconnect.to",
                "https://other-nas.us2.quickconnect.to",
                "https://nas-example.us2.quickconnect.to:5001",
                "https://nas-example.direct.quickconnect.to",
                "https://nas-example.us.quickconnect.to",
                "https://nas-example.usa2.quickconnect.to",
                "https://nas-example.u2.quickconnect.to",
                "https://nas-example.us-2.quickconnect.to",
                "https://nas-example.us2.extra.quickconnect.to",
                "https://nas-example.us2.quickconnect.to.",
                "https://user@nas-example.us2.quickconnect.to",
                "http://other-nas.quickconnect.to",
                "https://other-nas.quickconnect.to",
                "http://global.quickconnect.to",
                "http://www.quickconnect.to",
                "https://nas-example.quickconnect.to:5001",
                "http://nas-example.direct.quickconnect.to:5001",
                "https://nas-example.direct.quickconnect.to:443",
                "https://other-nas.direct.quickconnect.to:5001",
                "https://one.two.nas-example.direct.quickconnect.to:5001",
                "https://global.quickconnect.to:5001",
                "https://www.quickconnect.to.attacker.invalid",
                "http://nas-example.quickconnect.cn",
            ] {
                assert!(!defaults.permits(current, &Url::parse(rejected).unwrap()));
            }
        }
        assert!(!defaults.permits(
            "https://unrelated.invalid",
            &Url::parse(PORTALS[0]).unwrap()
        ));
    }

    #[test]
    fn regional_sources_and_destinations_keep_original_alias_and_dns_bounds() {
        let defaults = context("https://nas-example.fr3.quickconnect.to");
        let maximum = format!("https://nas-example.us{}.quickconnect.to", "2".repeat(61));
        let too_long = format!("https://nas-example.us{}.quickconnect.to", "2".repeat(62));
        for source in ["https://nas-example.us2.quickconnect.to", maximum.as_str()] {
            assert!(defaults.validate(&Url::parse(source).unwrap()).is_ok());
            assert!(defaults.permits(source, &Url::parse(&defaults.original_origin).unwrap()));
            assert!(defaults.permits(PORTALS[0], &Url::parse(source).unwrap()));
        }
        for source in [
            "http://nas-example.us2.quickconnect.to",
            "https://other-nas.us2.quickconnect.to",
            "https://nas-example.us2.quickconnect.to:444",
            "https://nas-example.us2.quickconnect.to.",
            "https://nas-example.us2.extra.quickconnect.to",
            too_long.as_str(),
        ] {
            assert!(defaults.validate(&Url::parse(source).unwrap()).is_err());
            assert!(!defaults.permits(PORTALS[0], &Url::parse(source).unwrap()));
        }
        for original in [
            PORTALS[0],
            "https://nas.custom.invalid",
            "https://nas-example.direct.quickconnect.to",
        ] {
            assert!(!context(original).permits(
                original,
                &Url::parse("https://nas-example.us2.quickconnect.to").unwrap()
            ));
        }
        // URL canonicalization removes explicit standard HTTPS port 443.
        assert!(defaults.permits(
            PORTALS[0],
            &Url::parse("https://nas-example.us2.quickconnect.to:443/path").unwrap()
        ));
    }

    #[test]
    fn custom_origins_have_only_the_two_https_portals_without_guessing_an_alias() {
        for origin in [
            "https://192.0.2.3:5001",
            "https://nas.custom.invalid:5001",
            "http://[::1]:5000",
            "https://global.quickconnect.to",
            "https://www.quickconnect.to",
            "https://quickconnect.to",
            "https://relay.quickconnect.to",
            "https://nas.direct.quickconnect.to",
            "https://nas.id.direct.quickconnect.to",
            "https://nas.fr3.extra.quickconnect.to",
        ] {
            let defaults = context(origin);
            assert_eq!(defaults.origins().unwrap(), PORTALS);
            assert!(defaults.validate(&Url::parse(origin).unwrap()).is_ok());
            assert!(!defaults.permits(origin, &Url::parse("http://nas.custom.invalid").unwrap()));
        }
    }

    #[test]
    fn noncanonical_or_malformed_scope_never_grants_defaults() {
        for origin in [
            "https://nas.fr3.quickconnect.to/",
            "https://nas.quickconnect.to:5001",
            "https://nas.quickconnect.to.",
            "https://user@nas.quickconnect.to",
            "https://nas.quickconnect.to?token=x",
            "https://nas.quickconnect.to#next",
            "https://nas.quickconnect.to:0",
            "ftp://nas.quickconnect.to",
            "https://NAS.quickconnect.to",
            "https://-nas.quickconnect.to",
            "https://nas-.quickconnect.to",
            "https://nas_private.invalid:5001",
            "https://-nas.custom.invalid",
            "https://nas.custom-.invalid",
            "https://nas..invalid",
            "https://*.custom.invalid",
        ] {
            assert!(context(origin).origins().is_err());
        }
        let long_label = format!("https://{}.invalid", "n".repeat(64));
        assert!(context(&long_label).origins().is_err());
        let long_host = format!("https://{}", vec!["n".repeat(63); 4].join("."));
        assert!(context(&long_host).origins().is_err());
        let mut defaults = context("https://nas.quickconnect.to");
        defaults.version = 2;
        assert!(defaults.origins().is_err());
        for value in [
            serde_json::json!({"version":1,"originalOrigin":false}),
            serde_json::json!({"version":1,"originalOrigin":"https://nas.quickconnect.to","enabled":true}),
        ] {
            assert!(serde_json::from_value::<SynologyQuickConnectDefaults>(value).is_err());
        }
    }
}
