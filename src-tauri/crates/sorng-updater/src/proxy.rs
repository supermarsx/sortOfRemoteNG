//! Native validation and redacted transport configuration for updater proxies.

use percent_encoding::percent_decode_str;
use updater_reqwest::Proxy;
use url::Url;

use crate::error::UpdateError;

/// A validated proxy endpoint with credentials kept outside its printable URL.
///
/// `tauri-plugin-updater` logs URLs configured through `UpdaterBuilder::proxy`.
/// Keeping credentials separate lets us install the proxy through
/// `configure_client` without ever handing a secret-bearing URL to that logger.
#[derive(Clone)]
pub(crate) struct ValidatedUpdaterProxy {
    endpoint: Url,
    username: Option<String>,
    password: Option<String>,
}

impl ValidatedUpdaterProxy {
    pub(crate) fn to_reqwest_proxy(&self) -> Result<Proxy, UpdateError> {
        let proxy = Proxy::all(self.endpoint.as_str())
            .map_err(|_| UpdateError::InvalidProxy("the proxy endpoint is not usable"))?;
        Ok(match self.username.as_deref() {
            Some(username) => proxy.basic_auth(username, self.password.as_deref().unwrap_or("")),
            None => proxy,
        })
    }

    #[cfg(test)]
    fn endpoint(&self) -> &Url {
        &self.endpoint
    }

    #[cfg(test)]
    fn credentials(&self) -> Option<(&str, Option<&str>)> {
        self.username
            .as_deref()
            .map(|username| (username, self.password.as_deref()))
    }
}

/// Validates the optional app-managed proxy at the native IPC boundary.
///
/// A proxy is an origin, not a request URL. Only HTTP(S) origins are accepted;
/// query strings and fragments could carry secrets and have no proxy meaning.
/// Credentials are percent-decoded, stored separately, and never included in an
/// error or printable endpoint.
pub(crate) fn validate_updater_proxy(
    input: Option<&str>,
) -> Result<Option<ValidatedUpdaterProxy>, UpdateError> {
    let Some(input) = input else {
        return Ok(None);
    };
    if input.is_empty() || input.trim() != input {
        return Err(UpdateError::InvalidProxy(
            "it must be a non-empty URL without surrounding whitespace",
        ));
    }

    let mut endpoint = Url::parse(input)
        .map_err(|_| UpdateError::InvalidProxy("it must be a valid absolute URL"))?;
    if !matches!(endpoint.scheme(), "http" | "https") {
        return Err(UpdateError::InvalidProxy(
            "only HTTP and HTTPS proxy schemes are supported",
        ));
    }
    if endpoint.host_str().is_none()
        || endpoint.port_or_known_default().is_none()
        || endpoint.port() == Some(0)
    {
        return Err(UpdateError::InvalidProxy(
            "a host and valid port are required",
        ));
    }
    if endpoint.path() != "/" || endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err(UpdateError::InvalidProxy(
            "paths, query strings, and fragments are not accepted",
        ));
    }

    let encoded_username = endpoint.username();
    let encoded_password = endpoint.password();
    let has_userinfo = !encoded_username.is_empty() || encoded_password.is_some();
    let username = has_userinfo
        .then(|| decode_userinfo(encoded_username, "username"))
        .transpose()?;
    let password = encoded_password
        .map(|value| decode_userinfo(value, "password"))
        .transpose()?;

    endpoint
        .set_username("")
        .map_err(|_| UpdateError::InvalidProxy("the proxy username could not be sanitized"))?;
    endpoint
        .set_password(None)
        .map_err(|_| UpdateError::InvalidProxy("the proxy password could not be sanitized"))?;

    Ok(Some(ValidatedUpdaterProxy {
        endpoint,
        username,
        password,
    }))
}

fn decode_userinfo(value: &str, field: &'static str) -> Result<String, UpdateError> {
    percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| match field {
            "username" => UpdateError::InvalidProxy("the proxy username is not valid UTF-8"),
            _ => UpdateError::InvalidProxy("the proxy password is not valid UTF-8"),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_secret_free_and_authenticated_http_proxy_origins() {
        assert!(validate_updater_proxy(None).unwrap().is_none());
        for valid in [
            "http://127.0.0.1:9080",
            "https://proxy.example.test",
            "http://[::1]:8080",
            "http://alice:p%40ssword@proxy.example.test:8080",
        ] {
            let proxy = validate_updater_proxy(Some(valid))
                .unwrap_or_else(|error| panic!("{valid} should validate: {error}"))
                .expect("a supplied proxy returns a validated configuration");
            assert!(matches!(proxy.endpoint().scheme(), "http" | "https"));
            assert!(proxy.endpoint().username().is_empty());
            assert!(proxy.endpoint().password().is_none());
            assert!(!proxy.endpoint().as_str().contains("alice"));
            assert!(!proxy.endpoint().as_str().contains("p%40ssword"));
            proxy
                .to_reqwest_proxy()
                .expect("validated configuration builds a reqwest proxy");
        }

        assert_eq!(
            validate_updater_proxy(Some("http://alice:p%40ssword@proxy.example.test:8080"))
                .unwrap()
                .expect("authenticated proxy")
                .credentials(),
            Some(("alice", Some("p@ssword")))
        );
    }

    #[test]
    fn rejects_non_http_or_non_origin_proxy_urls() {
        for invalid in [
            "",
            " http://127.0.0.1:9080",
            "socks5://127.0.0.1:1080",
            "file:///tmp/proxy",
            "http://proxy.example.test/path",
            "http://proxy.example.test?token=secret",
            "http://proxy.example.test#secret",
            "http://proxy.example.test:0",
        ] {
            assert!(
                matches!(
                    validate_updater_proxy(Some(invalid)),
                    Err(UpdateError::InvalidProxy(_))
                ),
                "unsafe proxy was accepted: {invalid}"
            );
        }
    }

    #[test]
    fn proxy_errors_and_sanitized_endpoint_never_echo_credentials() {
        let input = "http://alice:do-not-log-me@proxy.example.test:8080/path";
        let message = match validate_updater_proxy(Some(input)) {
            Err(error) => error.to_string(),
            Ok(_) => panic!("non-origin proxy must be rejected"),
        };
        assert!(!message.contains("alice"), "username leaked: {message}");
        assert!(
            !message.contains("do-not-log-me"),
            "password leaked: {message}"
        );

        let accepted =
            validate_updater_proxy(Some("http://alice:do-not-log-me@proxy.example.test:8080"))
                .unwrap()
                .expect("authenticated origin is accepted");
        assert!(!accepted.endpoint().as_str().contains("alice"));
        assert!(!accepted.endpoint().as_str().contains("do-not-log-me"));
    }
}
