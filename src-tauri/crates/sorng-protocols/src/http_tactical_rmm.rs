//! Closed Tactical RMM API-origin capability.
//!
//! Tactical's dashboard reads `window._env_.PROD_URL`. Deployments commonly
//! place the API either at `https://api.<dashboard-host>` or beside an `rmm`
//! dashboard at `https://api.<parent-domain>`. The renderer may request only
//! the small exact-origin set disclosed in the manifest; native code derives
//! and validates the destination independently for every request.

use super::{ProxyNetworkState, ReviewedApplicationProfile};

pub(super) const PATH: &str = "/__sortofremoteng_tactical_rmm_api_v1";
const DOCUMENT_PARAMETER: &str = "__sorng_tactical_document_v1";
const GENERATION_PARAMETER: &str = "__sorng_generation_v1";

#[derive(Clone)]
#[doc(hidden)]
pub struct TacticalRmmApiRoute {
    api_origins: Vec<String>,
    client: reqwest::Client,
}

impl TacticalRmmApiRoute {
    #[doc(hidden)]
    pub fn new(
        profile: Option<ReviewedApplicationProfile>,
        source: &reqwest::Url,
        configured_api_origin: Option<&str>,
        client: reqwest::Client,
    ) -> Option<Self> {
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
        })
    }

    pub(super) fn client(&self) -> &reqwest::Client {
        &self.client
    }

    pub(super) fn manifest(&self, proxy_origin: &str) -> serde_json::Value {
        serde_json::json!({
            "version": 2,
            "apiOrigins": self.api_origins,
            "proxyUrl": format!("{proxy_origin}{PATH}"),
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

pub(super) fn destination(
    route: Option<&TacticalRmmApiRoute>,
    network: &ProxyNetworkState,
    uri: &axum::http::Uri,
) -> Result<Option<reqwest::Url>, &'static str> {
    if uri.path() != PATH {
        return Ok(None);
    }
    let route = route.ok_or("The Tactical RMM API route is unavailable.")?;
    let mut destination = None;
    let mut document = None;
    let mut generation_seen = false;
    for (name, value) in url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes()) {
        match name.as_ref() {
            "destination" if destination.is_none() => destination = Some(value.into_owned()),
            DOCUMENT_PARAMETER if document.is_none() => {
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
