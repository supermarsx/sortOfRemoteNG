//! Explicit runtime transport choice; never consult ambient proxy variables.
use crate::error::{SynologyError, SynologyResult};
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NativeHttpRoute {
    Direct {},
    HttpProxy {
        url: String,
        username: Option<String>,
        password: Option<String>,
    },
    #[cfg(test)]
    #[serde(skip)]
    Fixture {
        proxy: String,
        certificate: Vec<u8>,
    },
}

impl Default for NativeHttpRoute {
    fn default() -> Self {
        Self::Direct {}
    }
}

impl NativeHttpRoute {
    pub(crate) fn builder(
        &self,
        timeout: Duration,
        cookies: bool,
    ) -> SynologyResult<reqwest::ClientBuilder> {
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .referer(false)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .cookie_store(cookies)
            .connect_timeout(Duration::from_secs(10))
            .timeout(timeout);
        if let Self::HttpProxy {
            url,
            username,
            password,
        } = self
        {
            let parsed = reqwest::Url::parse(url).ok().filter(|value| {
                url.len() <= 2048 && matches!(value.scheme(), "http" | "https")
                    && value.host_str().is_some() && value.username().is_empty()
                    && value.password().is_none() && value.path() == "/"
                    && value.query().is_none() && value.fragment().is_none()
                    && !url.chars().any(char::is_control)
            }).ok_or_else(|| SynologyError::connection("The selected HTTP proxy address is invalid; no direct fallback was attempted"))?;
            if username
                .as_ref()
                .is_some_and(|value| value.len() > 4096 || value.chars().any(char::is_control))
                || password
                    .as_ref()
                    .is_some_and(|value| value.len() > 4096 || value.chars().any(char::is_control))
                || password.is_some() && username.is_none()
            {
                return Err(SynologyError::connection(
                    "The selected HTTP proxy credentials are invalid",
                ));
            }
            let mut proxy = reqwest::Proxy::all(parsed.as_str())
                .map_err(|_| SynologyError::connection("The selected HTTP proxy is unsupported"))?;
            if let Some(username) = username {
                proxy = proxy.basic_auth(username, password.as_deref().unwrap_or(""));
            }
            builder = builder.proxy(proxy);
        }
        #[cfg(test)]
        if let Self::Fixture { proxy, certificate } = self {
            builder = builder
                .proxy(
                    reqwest::Proxy::all(proxy)
                        .unwrap()
                        .basic_auth("fixture-proxy-user", "fixture-proxy-password"),
                )
                .add_root_certificate(reqwest::Certificate::from_der(certificate).unwrap());
        }
        Ok(builder)
    }
}
