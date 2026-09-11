//! Closed per-session proxy controls. No arbitrary native client parameters.
use std::collections::{HashMap, HashSet};

use reqwest::{header::HeaderName, header::HeaderValue, Url};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PageScripts {
    #[default]
    Allow,
    InlineOnly,
    Block,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CacheMode {
    #[default]
    Normal,
    Bypass,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueryParameter {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpProxyPolicy {
    pub version: u8,
    pub page_scripts: PageScripts,
    pub https_only: bool,
    pub same_origin_only: bool,
    #[serde(default)]
    pub allow_cross_origin_redirects: bool,
    /// Separate opt-in to review (never automatically follow) an HTTP handoff.
    #[serde(default)]
    pub allow_http_downgrade_redirects: bool,
    /// Renderer-derived, reference-fenced navigation context. This must never
    /// be persisted/imported as an ordinary saved connection policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synology_quick_connect_defaults: Option<super::SynologyQuickConnectDefaults>,
    pub cache_mode: CacheMode,
    pub query_parameters: Vec<QueryParameter>,
}

impl std::fmt::Debug for HttpProxyPolicy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HttpProxyPolicy")
            .field("version", &self.version)
            .field("page_scripts", &self.page_scripts)
            .field("https_only", &self.https_only)
            .field("same_origin_only", &self.same_origin_only)
            .field(
                "allow_cross_origin_redirects",
                &self.allow_cross_origin_redirects,
            )
            .field(
                "allow_http_downgrade_redirects",
                &self.allow_http_downgrade_redirects,
            )
            .field("cache_mode", &self.cache_mode)
            .field("query_parameter_count", &self.query_parameters.len())
            .finish_non_exhaustive()
    }
}

impl Default for HttpProxyPolicy {
    fn default() -> Self {
        Self {
            version: 1,
            page_scripts: PageScripts::Allow,
            https_only: false,
            same_origin_only: false,
            allow_cross_origin_redirects: false,
            allow_http_downgrade_redirects: false,
            synology_quick_connect_defaults: None,
            cache_mode: CacheMode::Normal,
            query_parameters: Vec::new(),
        }
    }
}

impl HttpProxyPolicy {
    pub fn validate(&self, target: &Url) -> Result<(), String> {
        let invalid =
            || "Invalid HTTP proxy policy. Review the advanced connection settings.".to_string();
        if self.version != 1 || self.query_parameters.len() > 16 {
            return Err(invalid());
        }
        if self.https_only && target.scheme() != "https" {
            return Err("HTTPS-only policy requires an HTTPS connection; no automatic upgrade or insecure fallback was attempted.".into());
        }
        if let Some(defaults) = &self.synology_quick_connect_defaults {
            defaults.validate(target)?;
        }
        let mut names = HashSet::new();
        let mut bytes = 0;
        for field in &self.query_parameters {
            let lower = field.name.to_ascii_lowercase();
            if field.name.is_empty()
                || field.name.len() > 128
                || !field
                    .name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.~-".contains(&c))
                || lower.starts_with("__sorng")
                || lower.starts_with("__sortofremoteng")
                || field.value.len() > 4096
                || field.value.chars().any(|c| c.is_ascii_control())
                || !names.insert(&field.name)
            {
                return Err(invalid());
            }
            bytes += field.name.len() + field.value.len();
        }
        if bytes > 16_384 {
            return Err(invalid());
        }
        Ok(())
    }

    /// Only the actual outbound URL contains these secret-capable additions.
    /// Logs/history keep the original requested URL, never this result.
    pub fn request_url(&self, input: &str) -> Result<Url, String> {
        let mut url = Url::parse(input).map_err(|_| "Invalid HTTP request URL".to_string())?;
        if !self.query_parameters.is_empty() {
            let existing: HashSet<String> = url
                .query_pairs()
                .map(|(name, _)| name.into_owned())
                .collect();
            let mut query = url.query_pairs_mut();
            for field in &self.query_parameters {
                // Never replace an application-supplied value or add duplicates.
                if !existing.contains(&field.name) {
                    query.append_pair(&field.name, &field.value);
                }
            }
        }
        Ok(url)
    }

    pub fn redacted_url(&self, input: &str) -> String {
        if self.query_parameters.is_empty() {
            return input.to_string();
        }
        let Ok(mut url) = Url::parse(input) else {
            return "[invalid HTTP URL]".into();
        };
        let values: Vec<(String, String)> = url
            .query_pairs()
            .map(|(name, value)| {
                let secret = self.query_parameters.iter().any(|field| field.name == name);
                (
                    name.into_owned(),
                    if secret {
                        "[redacted]".into()
                    } else {
                        value.into_owned()
                    },
                )
            })
            .collect();
        if !values.is_empty() {
            url.query_pairs_mut().clear().extend_pairs(values);
        }
        url.to_string()
    }

    /// CSP restricts resources/forms, not top-level or iframe self-navigation.
    pub fn content_security_policy(&self) -> Option<String> {
        let mut directives = Vec::new();
        if self.same_origin_only {
            directives.push("default-src 'self' data: blob:; connect-src 'self'; form-action 'self'; frame-src 'self'; base-uri 'self'; object-src 'none'".to_string());
            directives.push("style-src 'self' 'unsafe-inline'".to_string());
        } else if self.https_only {
            // 'self' is this protected loopback authority, whose upstream is HTTPS.
            directives.push("default-src 'self' https: data: blob:; connect-src 'self' https: wss:; form-action 'self' https:; frame-src 'self' https:; base-uri 'self'; object-src 'none'".to_string());
            directives.push("style-src 'self' https: 'unsafe-inline'".to_string());
        }
        match self.page_scripts {
            PageScripts::Block => directives.push("script-src 'none'".into()),
            PageScripts::InlineOnly => {
                directives.push("script-src 'unsafe-inline' 'unsafe-eval'".into())
            }
            PageScripts::Allow if self.same_origin_only => {
                directives.push("script-src 'self' 'unsafe-inline' 'unsafe-eval'".into())
            }
            PageScripts::Allow if self.https_only => {
                directives.push("script-src 'self' https: 'unsafe-inline' 'unsafe-eval'".into())
            }
            PageScripts::Allow => {}
        }
        (!directives.is_empty()).then(|| directives.join("; "))
    }
}

pub fn validate_custom_headers(
    headers: &HashMap<String, String>,
    header_auth: bool,
) -> Result<(), String> {
    let invalid = || {
        "Invalid or restricted custom HTTP headers. Review header authentication settings."
            .to_string()
    };
    if headers.len() > 32 {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    let mut size = 0;
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        let credential = [
            "authorization",
            "api-key",
            "api_key",
            "apikey",
            "token",
            "secret",
            "password",
            "credential",
        ]
        .iter()
        .any(|part| lower.contains(part));
        if name.len() > 128
            || value.len() > 4096
            || value.chars().any(|c| c.is_ascii_control())
            || HeaderName::from_bytes(name.as_bytes()).is_err()
            || HeaderValue::from_str(value).is_err()
            || !seen.insert(lower.clone())
            || matches!(
                lower.as_str(),
                "host"
                    | "cookie"
                    | "origin"
                    | "referer"
                    | "connection"
                    | "proxy-authorization"
                    | "proxy-authenticate"
                    | "keep-alive"
                    | "transfer-encoding"
                    | "te"
                    | "trailer"
                    | "upgrade"
                    | "content-length"
                    | "accept-encoding"
                    | "forwarded"
            )
            || lower.starts_with("sec-")
            || lower.starts_with("proxy-")
            || lower.starts_with("x-forwarded-")
            || (credential && !header_auth)
        {
            return Err(invalid());
        }
        size += name.len() + value.len();
    }
    if size > 16_384 {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_shape_bounds_and_https_refusal() {
        assert!(serde_json::from_str::<HttpProxyPolicy>(r#"{"version":1}"#).is_err());
        let mut policy = HttpProxyPolicy {
            https_only: true,
            ..HttpProxyPolicy::default()
        };
        assert!(policy
            .validate(&Url::parse("http://fixture.test").unwrap())
            .unwrap_err()
            .contains("no automatic upgrade"));
        policy.query_parameters.push(QueryParameter {
            name: "token".into(),
            value: "synthetic&a=b".into(),
        });
        policy
            .validate(&Url::parse("https://fixture.test").unwrap())
            .unwrap();
        assert!(!format!("{policy:?}").contains("synthetic"));
        assert!(!policy
            .redacted_url("https://fixture.test/path?tenant=ok&token=synthetic")
            .contains("synthetic"));
        let url = policy
            .request_url("https://fixture.test/path?existing=1")
            .unwrap();
        assert_eq!(
            url.query_pairs().collect::<Vec<_>>(),
            [
                ("existing".into(), "1".into()),
                ("token".into(), "synthetic&a=b".into())
            ]
        );
        assert_eq!(
            policy
                .request_url("https://fixture.test/?token=own")
                .unwrap()
                .query(),
            Some("token=own")
        );
        policy.query_parameters[0].value = "secret\n".into();
        let error = policy
            .validate(&Url::parse("https://fixture.test").unwrap())
            .unwrap_err();
        assert!(!error.contains("secret"));
    }
    #[test]
    fn csp_applies_real_source_controls_without_navigation_claims() {
        let mut policy = HttpProxyPolicy::default();
        assert!(policy.content_security_policy().is_none());
        policy.page_scripts = PageScripts::InlineOnly;
        assert_eq!(
            policy.content_security_policy().unwrap(),
            "script-src 'unsafe-inline' 'unsafe-eval'"
        );
        policy.page_scripts = PageScripts::Block;
        policy.same_origin_only = true;
        let csp = policy.content_security_policy().unwrap();
        assert!(csp.contains("script-src 'none'"));
        assert!(csp.contains("form-action 'self'"));
        assert!(!csp.contains("navigate-to"));
    }
    #[test]
    fn explicit_header_auth_still_cannot_override_routing() {
        for name in [
            "Host",
            "Cookie",
            "Origin",
            "Sec-Fetch-Dest",
            "Proxy-Authorization",
            "X-Forwarded-Host",
            "Content-Length",
        ] {
            assert!(validate_custom_headers(
                &HashMap::from([(name.into(), "synthetic".into())]),
                true
            )
            .is_err());
        }
        let headers = HashMap::from([("Authorization".into(), "Bearer synthetic".into())]);
        assert!(validate_custom_headers(&headers, false).is_err());
        assert!(validate_custom_headers(&headers, true).is_ok());
        assert!(validate_custom_headers(
            &HashMap::from([("X-Test".into(), "a".into()), ("x-test".into(), "b".into())]),
            true
        )
        .is_err());
    }
}
