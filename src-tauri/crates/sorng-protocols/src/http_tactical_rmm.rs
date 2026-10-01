//! Closed application API-origin transport (Tactical RMM and PTisp).
//!
//! Tactical's dashboard reads `window._env_.PROD_URL`. Deployments commonly
//! place the API either at `https://api.<dashboard-host>` or beside an `rmm`
//! dashboard at `https://api.<parent-domain>`. The renderer may request only
//! the small exact-origin set disclosed in the manifest; native code derives
//! and validates the destination independently for every request.

use super::{ProxyNetworkState, ReviewedApplicationProfile};

pub(super) const PATH: &str = "/__sortofremoteng_tactical_rmm_api_v1";
pub(super) const PTISP_PATH: &str = "/__sortofremoteng_ptisp_api_v1";
pub(super) const PTISP_SOURCE: &str = "https://my.ptisp.pt";
pub(super) const PTISP_API: &str = "https://api3.ptisp.pt";
const DOCUMENT_PARAMETER: &str = "__sorng_tactical_document_v1";
const PTISP_DOCUMENT_PARAMETER: &str = "__sorng_ptisp_document_v1";
const GENERATION_PARAMETER: &str = "__sorng_generation_v1";

#[derive(Clone)]
#[doc(hidden)]
pub struct TacticalRmmApiRoute {
    api_origins: Vec<String>,
    client: reqwest::Client,
    profile: ReviewedApplicationProfile,
}

impl TacticalRmmApiRoute {
    #[doc(hidden)]
    pub fn new(
        profile: Option<ReviewedApplicationProfile>,
        source: &reqwest::Url,
        configured_api_origin: Option<&str>,
        client: reqwest::Client,
    ) -> Option<Self> {
        // Reuse only the stateless transport. PTisp receives no derived hosts,
        // configured API override, Tactical popups, Mesh or WebSocket grant.
        if profile == Some(ReviewedApplicationProfile::Ptisp) {
            if source.origin().ascii_serialization() != PTISP_SOURCE
                || !source.username().is_empty()
                || source.password().is_some()
            {
                return None;
            }
            return Some(Self {
                api_origins: vec![PTISP_API.into()],
                client,
                profile: ReviewedApplicationProfile::Ptisp,
            });
        }
        if profile != Some(ReviewedApplicationProfile::TacticalRmm)
            || source.scheme() != "https"
            || source.port_or_known_default() != Some(443)
            || source.username() != ""
            || source.password().is_some()
        {
            return None;
        }
        let host = match source.host() {
            Some(url::Host::Domain(host))
                if host.contains('.')
                    && host != "localhost"
                    && !host.starts_with("api.")
                    && !host.ends_with('.') =>
            {
                host
            }
            _ => return None,
        };
        let mut api_origins = Vec::with_capacity(3);
        push_exact_origin(&mut api_origins, &format!("https://api.{host}/"))?;

        let (_, parent) = host.split_once('.')?;
        push_exact_origin(&mut api_origins, &format!("https://api.{parent}/"))?;

        if let Some(configured) = configured_api_origin {
            push_exact_origin(&mut api_origins, configured)?;
        }

        Some(Self {
            api_origins,
            client,
            profile: ReviewedApplicationProfile::TacticalRmm,
        })
    }

    pub(super) fn is_tactical(&self) -> bool {
        self.profile == ReviewedApplicationProfile::TacticalRmm
    }

    pub(super) fn manifest_key(&self) -> &'static str {
        if self.is_tactical() {
            "tacticalRmmApi"
        } else {
            "ptispApi"
        }
    }

    fn path(&self) -> &'static str {
        if self.is_tactical() {
            PATH
        } else {
            PTISP_PATH
        }
    }

    pub(super) fn client(&self) -> &reqwest::Client {
        &self.client
    }

    pub(super) fn manifest(&self, proxy_origin: &str) -> serde_json::Value {
        serde_json::json!({
            "version": 2,
            "apiOrigins": self.api_origins,
            "proxyUrl": format!("{proxy_origin}{}", self.path()),
        })
    }

    fn validate_destination(&self, value: &str) -> Result<reqwest::Url, &'static str> {
        if value.len() > 16_384 {
            return Err("The Tactical RMM API URL is too long.");
        }
        let destination =
            reqwest::Url::parse(value).map_err(|_| "The Tactical RMM API URL is invalid.")?;
        if !self.permits(&destination)
            || destination.scheme() != "https"
            || destination.port_or_known_default() != Some(443)
            || destination.username() != ""
            || destination.password().is_some()
            || destination.fragment().is_some()
        {
            return Err("The Tactical RMM API destination is not permitted.");
        }
        Ok(destination)
    }

    pub(super) fn permits(&self, destination: &reqwest::Url) -> bool {
        self.api_origins
            .iter()
            .any(|origin| destination.origin().ascii_serialization() == *origin)
            && destination.scheme() == "https"
            && destination.port_or_known_default() == Some(443)
            && destination.username().is_empty()
            && destination.password().is_none()
            && destination.fragment().is_none()
    }
}

fn push_exact_origin(origins: &mut Vec<String>, value: &str) -> Option<()> {
    let parsed = reqwest::Url::parse(value).ok()?;
    if parsed.scheme() != "https"
        || parsed.port_or_known_default() != Some(443)
        || parsed.username() != ""
        || parsed.password().is_some()
        || !matches!(parsed.host(), Some(url::Host::Domain(host)) if host.contains('.') && host != "localhost" && !host.ends_with('.'))
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let origin = parsed.origin().ascii_serialization();
    if !origins.contains(&origin) {
        origins.push(origin);
    }
    Some(())
}

pub(super) fn document_parameter(path: &str) -> Option<&'static str> {
    match path {
        PATH => Some(DOCUMENT_PARAMETER),
        PTISP_PATH => Some(PTISP_DOCUMENT_PARAMETER),
        _ => None,
    }
}

pub(super) fn destination(
    route: Option<&TacticalRmmApiRoute>,
    network: &ProxyNetworkState,
    uri: &axum::http::Uri,
) -> Result<Option<reqwest::Url>, &'static str> {
    let Some(document_parameter) = document_parameter(uri.path()) else {
        return Ok(None);
    };
    let route = route
        .filter(|route| route.path() == uri.path())
        .ok_or("The reviewed application API route is unavailable.")?;
    let mut destination = None;
    let mut document = None;
    let mut generation_seen = false;
    for (name, value) in url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes()) {
        match name.as_ref() {
            "destination" if destination.is_none() => destination = Some(value.into_owned()),
            name if name == document_parameter && document.is_none() => {
                document = value.parse::<u64>().ok();
                if document.is_none() {
                    return Err("The Tactical RMM API document is invalid.");
                }
            }
            GENERATION_PARAMETER if !generation_seen => generation_seen = true,
            _ => return Err("The Tactical RMM API route parameters are invalid."),
        }
    }
    let sequence = document.ok_or("The Tactical RMM API document is missing.")?;
    if !network.document_is_current(sequence) {
        return Err("The Tactical RMM API document is no longer active.");
    }
    route
        .validate_destination(
            destination
                .as_deref()
                .ok_or("The Tactical RMM API destination is missing.")?,
        )
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ptisp_requires_exact_reviewed_source_and_discloses_no_tactical_grants() {
        assert_eq!(
            serde_json::to_string(&ReviewedApplicationProfile::Ptisp).unwrap(),
            "\"ptisp\""
        );
        for (profile, source) in [
            (None, PTISP_SOURCE),
            (Some(ReviewedApplicationProfile::Porkbun), PTISP_SOURCE),
            (
                Some(ReviewedApplicationProfile::Ptisp),
                "http://my.ptisp.pt",
            ),
            (
                Some(ReviewedApplicationProfile::Ptisp),
                "https://my.ptisp.pt:8443",
            ),
            (
                Some(ReviewedApplicationProfile::Ptisp),
                "https://my.ptisp.pt.evil.test",
            ),
            (
                Some(ReviewedApplicationProfile::Ptisp),
                "https://my.ptisp.pt.",
            ),
            (
                Some(ReviewedApplicationProfile::Ptisp),
                "https://user:secret@my.ptisp.pt",
            ),
            (Some(ReviewedApplicationProfile::Ptisp), PTISP_API),
        ] {
            assert!(TacticalRmmApiRoute::new(
                profile,
                &reqwest::Url::parse(source).unwrap(),
                None,
                reqwest::Client::new()
            )
            .is_none());
        }
        let capability = TacticalRmmApiRoute::new(
            Some(ReviewedApplicationProfile::Ptisp),
            &reqwest::Url::parse("https://my.ptisp.pt:443/login").unwrap(),
            Some("https://unapproved.test"),
            reqwest::Client::new(),
        )
        .unwrap();
        assert!(!capability.is_tactical());
        assert_eq!(capability.api_origins, [PTISP_API]);
        assert_eq!(capability.manifest_key(), "ptispApi");
        assert_eq!(
            capability.manifest("http://fixture.localhost:1234")["proxyUrl"],
            "http://fixture.localhost:1234/__sortofremoteng_ptisp_api_v1"
        );
        let bootstrap = super::super::network::bootstrap(
            "fixture",
            1,
            None,
            PTISP_SOURCE,
            "http://fixture.localhost:1234",
            &super::super::HttpProxyPolicy::default(),
            Some(&capability),
            None,
            None,
            None,
            None,
            false,
            super::super::BrowserCompatibility::default(),
        );
        assert!(bootstrap.contains("\"ptispApi\":{"));
        assert!(bootstrap.contains("\"popupTabs\":false"));
        assert!(!bootstrap.contains("\"tacticalRmmApi\":{"));
        assert!(!bootstrap.contains("\"tacticalRmmMesh\":{"));
    }

    #[test]
    fn ptisp_destination_requires_its_own_alias_document_and_exact_api_origin() {
        let capability = TacticalRmmApiRoute::new(
            Some(ReviewedApplicationProfile::Ptisp),
            &reqwest::Url::parse(PTISP_SOURCE).unwrap(),
            None,
            reqwest::Client::new(),
        )
        .unwrap();
        let network = ProxyNetworkState::default();
        network.document_issued(3, true);
        let uri = |target: &str| -> axum::http::Uri {
            format!(
                "{PTISP_PATH}?{}",
                url::form_urlencoded::Serializer::new(String::new())
                    .append_pair("destination", target)
                    .append_pair(PTISP_DOCUMENT_PARAMETER, "3")
                    .finish()
            )
            .parse()
            .unwrap()
        };
        let target = "https://api3.ptisp.pt/user/security/fixture%40example.test/login?raw=%2F+";
        assert_eq!(
            destination(Some(&capability), &network, &uri(target))
                .unwrap()
                .unwrap()
                .as_str(),
            target
        );
        assert!(destination(None, &network, &uri(target)).is_err());
        assert!(destination(Some(&capability), &network, &request_uri(target, 3)).is_err());
        for target in [
            "http://api3.ptisp.pt/",
            "https://api3.ptisp.pt:8443/",
            "https://api3.ptisp.pt.evil.test/",
            "https://api3.ptisp.pt./",
            "https://user:secret@api3.ptisp.pt/",
            "https://api3.ptisp.pt/#fragment",
            "https://api4.ptisp.pt/",
        ] {
            assert!(destination(Some(&capability), &network, &uri(target)).is_err());
        }
        for extra in [
            "&__sorng_ptisp_document_v1=3",
            "&__sorng_tactical_document_v1=3",
            "&destination=https://api3.ptisp.pt/",
            "&unknown=secret",
        ] {
            assert!(destination(
                Some(&capability),
                &network,
                &format!("{}{extra}", uri(target)).parse().unwrap()
            )
            .is_err());
        }
        network.document_issued(4, true);
        network.activate_document(4).unwrap();
        assert!(destination(Some(&capability), &network, &uri(target)).is_err());
    }

    fn route(source: &str) -> Option<TacticalRmmApiRoute> {
        route_with_config(source, None)
    }

    fn route_with_config(
        source: &str,
        configured_api_origin: Option<&str>,
    ) -> Option<TacticalRmmApiRoute> {
        TacticalRmmApiRoute::new(
            Some(ReviewedApplicationProfile::TacticalRmm),
            &reqwest::Url::parse(source).unwrap(),
            configured_api_origin,
            reqwest::Client::new(),
        )
    }

    fn request_uri(destination: &str, document: u64) -> axum::http::Uri {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("destination", destination)
            .append_pair(DOCUMENT_PARAMETER, &document.to_string())
            .finish();
        format!("{PATH}?{query}").parse().unwrap()
    }

    #[test]
    fn derives_only_exact_common_api_origins_for_a_canonical_https_dashboard() {
        let capability = route("https://rmm.apps.vogue-homes.com/").unwrap();
        assert_eq!(
            capability.api_origins,
            [
                "https://api.rmm.apps.vogue-homes.com",
                "https://api.apps.vogue-homes.com"
            ]
        );
        assert!(capability
            .validate_destination("https://api.rmm.apps.vogue-homes.com/accounts/login/")
            .is_ok());
        assert!(capability
            .validate_destination("https://api.apps.vogue-homes.com/accounts/login/")
            .is_ok());
        for destination in [
            "http://api.rmm.apps.vogue-homes.com/",
            "https://api.rmm.apps.vogue-homes.com:8443/",
            "https://other.rmm.apps.vogue-homes.com/",
            "https://api.rmm.apps.vogue-homes.com.evil.test/",
            "https://user@api.rmm.apps.vogue-homes.com/",
            "https://api.rmm.apps.vogue-homes.com/#fragment",
        ] {
            assert!(
                capability.validate_destination(destination).is_err(),
                "unexpectedly permitted {destination}"
            );
        }
    }

    #[test]
    fn refuses_non_tactical_noncanonical_and_already_api_sources() {
        assert!(TacticalRmmApiRoute::new(
            None,
            &reqwest::Url::parse("https://rmm.example.test/").unwrap(),
            None,
            reqwest::Client::new(),
        )
        .is_none());
        for source in [
            "http://rmm.example.test/",
            "https://rmm.example.test:8443/",
            "https://localhost/",
            "https://192.0.2.10/",
            "https://rmm/",
            "https://api.rmm.example.test/",
        ] {
            assert!(
                route(source).is_none(),
                "unexpected capability for {source}"
            );
        }
    }

    #[test]
    fn accepts_one_configured_canonical_exact_api_origin() {
        let capability = route_with_config(
            "https://rmm.example.test/",
            Some("https://api.vendor.example/"),
        )
        .unwrap();
        assert_eq!(
            capability.api_origins,
            [
                "https://api.rmm.example.test",
                "https://api.example.test",
                "https://api.vendor.example"
            ]
        );
        assert!(capability
            .validate_destination("https://api.vendor.example/v3/checkin")
            .is_ok());

        for configured in [
            "http://api.vendor.example/",
            "https://api.vendor.example:8443/",
            "https://user@api.vendor.example/",
            "https://api.vendor.example/path",
            "https://api.vendor.example/?query=true",
            "https://api.vendor.example/#fragment",
            "https://localhost/",
        ] {
            assert!(
                route_with_config("https://rmm.example.test/", Some(configured)).is_none(),
                "unexpected configured capability for {configured}"
            );
        }
    }

    #[test]
    fn reserved_endpoint_requires_the_active_document_and_exact_api_origin() {
        let capability = route("https://rmm.apps.vogue-homes.com/").unwrap();
        let network = ProxyNetworkState::default();
        network.document_issued(7, true);

        let accepted = destination(
            Some(&capability),
            &network,
            &request_uri(
                "https://api.rmm.apps.vogue-homes.com/v3/checkin/?agent=42",
                7,
            ),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            accepted.as_str(),
            "https://api.rmm.apps.vogue-homes.com/v3/checkin/?agent=42"
        );

        let sibling = destination(
            Some(&capability),
            &network,
            &request_uri("https://api.apps.vogue-homes.com/v3/checkin/", 7),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            sibling.as_str(),
            "https://api.apps.vogue-homes.com/v3/checkin/"
        );

        network.document_issued(8, false);
        network.activate_document(8).unwrap();
        assert!(destination(
            Some(&capability),
            &network,
            &request_uri("https://api.rmm.apps.vogue-homes.com/v3/checkin/", 7),
        )
        .is_err());
    }

    #[test]
    fn reserved_endpoint_rejects_missing_capability_and_ambiguous_parameters() {
        let capability = route("https://rmm.apps.vogue-homes.com/").unwrap();
        let network = ProxyNetworkState::default();
        network.document_issued(3, true);
        let uri = request_uri("https://api.rmm.apps.vogue-homes.com/", 3);
        assert!(destination(None, &network, &uri).is_err());

        let duplicate = format!("{}&{}=3", uri, DOCUMENT_PARAMETER)
            .parse::<axum::http::Uri>()
            .unwrap();
        assert!(destination(Some(&capability), &network, &duplicate).is_err());

        let unknown = format!("{}&unexpected=true", uri)
            .parse::<axum::http::Uri>()
            .unwrap();
        assert!(destination(Some(&capability), &network, &unknown).is_err());
    }
}
