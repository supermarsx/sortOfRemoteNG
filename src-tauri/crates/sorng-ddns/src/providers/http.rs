use reqwest::{
    header::{
        HeaderName, HeaderValue, CONNECTION, CONTENT_LENGTH, HOST, PROXY_AUTHORIZATION,
        TRANSFER_ENCODING,
    },
    redirect, Client, Method, RequestBuilder, StatusCode, Url,
};
use std::{net::IpAddr, sync::OnceLock, time::Duration};

const MAX_URL_BYTES: usize = 16 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const MAX_REQUEST_HEADERS: usize = 64;
const MAX_REQUEST_HEADER_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

pub(crate) struct HttpResponse {
    pub status: StatusCode,
    pub body: String,
}

fn client() -> Result<&'static Client, String> {
    match CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent("SortOfRemoteNG/1.0")
            .redirect(redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    return attempt.error("too many redirects");
                }

                let Some(previous) = attempt.previous().last() else {
                    return attempt.follow();
                };
                let next = attempt.url();
                let same_origin = previous.scheme() == next.scheme()
                    && previous.host_str() == next.host_str()
                    && previous.port_or_known_default() == next.port_or_known_default();
                let has_embedded_credentials =
                    !next.username().is_empty() || next.password().is_some();

                if same_origin && !has_embedded_credentials {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|_| "Failed to initialize the DDNS HTTP client".to_string())
    }) {
        Ok(client) => Ok(client),
        Err(error) => Err(error.clone()),
    }
}

fn is_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .map(|address| address.is_loopback())
        .unwrap_or(false)
}

pub(crate) fn parse_url(value: &str, sensitive: bool) -> Result<Url, String> {
    if value.is_empty() || value.len() > MAX_URL_BYTES {
        return Err("DDNS request URL is empty or too long".to_string());
    }

    let url = Url::parse(value).map_err(|_| "DDNS request URL is invalid".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("DDNS requests require an HTTP or HTTPS URL".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Credentials embedded in DDNS URLs are not allowed".to_string());
    }
    if sensitive && url.scheme() != "https" && !is_loopback(&url) {
        return Err("Credentialed DDNS requests require HTTPS".to_string());
    }
    Ok(url)
}

pub(crate) fn request(
    method: Method,
    url: impl AsRef<str>,
    sensitive: bool,
) -> Result<RequestBuilder, String> {
    let url = parse_url(url.as_ref(), sensitive)?;
    Ok(client()?.request(method, url))
}

pub(crate) fn method(value: &str) -> Result<Method, String> {
    match value.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        _ => Err("Custom DDNS method must be GET, POST, PUT, PATCH, or DELETE".to_string()),
    }
}

pub(crate) fn header(
    request: RequestBuilder,
    name: &str,
    value: &str,
) -> Result<RequestBuilder, String> {
    let name = HeaderName::from_bytes(name.trim().as_bytes())
        .map_err(|_| "Custom DDNS header name is invalid".to_string())?;
    if matches!(
        name,
        HOST | CONTENT_LENGTH | TRANSFER_ENCODING | CONNECTION | PROXY_AUTHORIZATION
    ) {
        return Err("Custom DDNS header is not allowed".to_string());
    }
    let value = HeaderValue::from_str(value)
        .map_err(|_| "Custom DDNS header value is invalid".to_string())?;
    Ok(request.header(name, value))
}

pub(crate) async fn send(request: RequestBuilder) -> Result<HttpResponse, String> {
    let response = send_allow_error(request).await?;
    if !response.status.is_success() {
        return Err(format!(
            "DDNS provider returned HTTP {}",
            response.status.as_u16()
        ));
    }
    Ok(response)
}

pub(crate) async fn send_allow_error(
    request: RequestBuilder,
) -> Result<HttpResponse, String> {
    let request = request
        .build()
        .map_err(|_| "Failed to construct DDNS request".to_string())?;

    if request
        .body()
        .and_then(|body| body.as_bytes())
        .map(|body| body.len() > MAX_REQUEST_BODY_BYTES)
        .unwrap_or(false)
    {
        return Err("DDNS request body exceeds the 1 MiB limit".to_string());
    }
    if request.headers().len() > MAX_REQUEST_HEADERS
        || request
            .headers()
            .iter()
            .map(|(name, value)| name.as_str().len() + value.as_bytes().len())
            .sum::<usize>()
            > MAX_REQUEST_HEADER_BYTES
    {
        return Err("DDNS request headers exceed the safety limit".to_string());
    }

    let mut response = client()?.execute(request).await.map_err(|error| {
        if error.is_timeout() {
            "DDNS request timed out".to_string()
        } else if error.is_connect() {
            "Could not connect to the DDNS provider".to_string()
        } else {
            "DDNS request failed".to_string()
        }
    })?;
    let status = response.status();

    if response
        .content_length()
        .map(|length| length > MAX_RESPONSE_BYTES as u64)
        .unwrap_or(false)
    {
        return Err("DDNS response exceeds the 2 MiB limit".to_string());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Failed to read DDNS response".to_string())?
    {
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "DDNS response size overflow".to_string())?;
        if next_len > MAX_RESPONSE_BYTES {
            return Err("DDNS response exceeds the 2 MiB limit".to_string());
        }
        body.extend_from_slice(&chunk);
    }

    Ok(HttpResponse {
        status,
        body: String::from_utf8_lossy(&body).trim().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentialed_remote_http_is_rejected() {
        assert!(parse_url("http://example.com/update", true).is_err());
        assert!(parse_url("http://127.0.0.1/update", true).is_ok());
    }

    #[test]
    fn embedded_url_credentials_are_rejected() {
        assert!(parse_url("https://user:secret@example.com/update", true).is_err());
    }

    #[test]
    fn unsafe_custom_methods_and_headers_are_rejected() {
        assert!(method("TRACE").is_err());
        let request = request(Method::GET, "https://example.com", false).unwrap();
        assert!(header(request, "Host", "attacker.example").is_err());
    }
}
