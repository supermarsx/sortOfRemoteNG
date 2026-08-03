// ── sorng-osticket/src/client.rs ───────────────────────────────────────────────
use reqwest::{header, Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::fmt;

use crate::error::{OsticketError, OsticketErrorKind, OsticketResult};
use crate::types::OsticketConnectionConfig;

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

fn transport_error(error: reqwest::Error) -> OsticketError {
    let (kind, message) = if error.is_timeout() {
        (OsticketErrorKind::Timeout, "osTicket request timed out")
    } else if error.is_connect() {
        (
            OsticketErrorKind::ConnectionFailed,
            "Unable to connect to osTicket",
        )
    } else {
        (OsticketErrorKind::Other, "osTicket request failed")
    };
    OsticketError::new(kind, message)
}

async fn read_bounded_response(mut response: Response) -> OsticketResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err(OsticketError::new(
            OsticketErrorKind::ParseError,
            "osTicket response exceeds the 8 MiB safety limit",
        ));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
        let remaining_probe = MAX_RESPONSE_BODY_BYTES + 1 - body.len();
        let take = chunk.len().min(remaining_probe);
        body.try_reserve(take).map_err(|_| {
            OsticketError::new(
                OsticketErrorKind::ParseError,
                "Unable to buffer the osTicket response safely",
            )
        })?;
        body.extend_from_slice(&chunk[..take]);

        if body.len() > MAX_RESPONSE_BODY_BYTES {
            return Err(OsticketError::new(
                OsticketErrorKind::ParseError,
                "osTicket response exceeds the 8 MiB safety limit",
            ));
        }
    }

    Ok(body)
}

/// Low-level osTicket HTTP client.
#[derive(Clone)]
pub struct OsticketClient {
    pub(crate) http: Client,
    pub(crate) base_url: String,
    pub(crate) api_key: header::HeaderValue,
}

impl fmt::Debug for OsticketClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OsticketClient")
            .field("base_url", &"[REDACTED]")
            .field("api_key", &"[REDACTED]")
            .finish()
    }
}

#[allow(dead_code)]
impl OsticketClient {
    pub fn from_config(cfg: &OsticketConnectionConfig) -> OsticketResult<Self> {
        let effective_tls_skip = cfg.skip_tls_verify
            && cfg
                .host
                .trim()
                .get(..8)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"));
        if effective_tls_skip != cfg.acknowledge_invalid_cert_risk {
            return Err(OsticketError::validation(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }

        let mut builder = Client::builder()
            .danger_accept_invalid_certs(effective_tls_skip)
            .timeout(std::time::Duration::from_secs(cfg.timeout_seconds));
        if let Some(proxy_url) = cfg
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url).map_err(|_| {
                OsticketError::new(
                    OsticketErrorKind::ConnectionFailed,
                    "Invalid osTicket proxy configuration",
                )
            })?;
            builder = builder.proxy(proxy);
        }
        let http = builder.build().map_err(|_| {
            OsticketError::new(
                OsticketErrorKind::ConnectionFailed,
                "Unable to initialize the osTicket HTTP client",
            )
        })?;

        let base = cfg.host.trim_end_matches('/').to_string();
        let mut api_key = header::HeaderValue::from_str(&cfg.api_key)
            .map_err(|_| OsticketError::validation("Invalid osTicket API key"))?;
        api_key.set_sensitive(true);

        Ok(Self {
            http,
            base_url: base,
            api_key,
        })
    }

    fn default_headers(&self) -> header::HeaderMap {
        let mut h = header::HeaderMap::new();
        h.insert("X-API-Key", self.api_key.clone());
        h.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        h
    }

    pub(crate) fn url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    pub(crate) async fn get<T: DeserializeOwned>(&self, path: &str) -> OsticketResult<T> {
        let resp = self
            .http
            .get(self.url(path))
            .headers(self.default_headers())
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_response(resp).await
    }

    pub(crate) async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(String, String)],
    ) -> OsticketResult<T> {
        let resp = self
            .http
            .get(self.url(path))
            .headers(self.default_headers())
            .query(params)
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> OsticketResult<T> {
        let resp = self
            .http
            .post(self.url(path))
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post_unit<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> OsticketResult<()> {
        let resp = self
            .http
            .post(self.url(path))
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn put<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> OsticketResult<T> {
        let resp = self
            .http
            .put(self.url(path))
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_response(resp).await
    }

    pub(crate) async fn patch<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> OsticketResult<T> {
        let resp = self
            .http
            .patch(self.url(path))
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_response(resp).await
    }

    pub(crate) async fn delete(&self, path: &str) -> OsticketResult<()> {
        let resp = self
            .http
            .delete(self.url(path))
            .headers(self.default_headers())
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_empty(resp).await
    }

    async fn handle_response<T: DeserializeOwned>(&self, resp: Response) -> OsticketResult<T> {
        let status = resp.status();
        let body = read_bounded_response(resp).await?;
        if status.is_success() {
            serde_json::from_slice(&body).map_err(|_| {
                OsticketError::new(
                    OsticketErrorKind::ParseError,
                    "osTicket returned an invalid JSON response",
                )
            })
        } else {
            Err(self.status_error(status))
        }
    }

    async fn handle_empty(&self, resp: Response) -> OsticketResult<()> {
        let status = resp.status();
        let _ = read_bounded_response(resp).await?;
        if status.is_success() {
            Ok(())
        } else {
            Err(self.status_error(status))
        }
    }

    fn status_error(&self, status: StatusCode) -> OsticketError {
        let kind = match status.as_u16() {
            401 => OsticketErrorKind::AuthError,
            403 => OsticketErrorKind::Forbidden,
            404 => OsticketErrorKind::NotFound,
            409 => OsticketErrorKind::Conflict,
            429 => OsticketErrorKind::RateLimited,
            _ => OsticketErrorKind::ApiError(status.as_u16()),
        };
        OsticketError::new(
            kind,
            format!("osTicket request failed with HTTP {}", status.as_u16()),
        )
    }

    pub async fn ping(&self) -> OsticketResult<crate::types::OsticketConnectionStatus> {
        // Attempt a lightweight GET; any 200-level means connected
        let resp = self
            .http
            .get(self.url("/tickets"))
            .headers(self.default_headers())
            .query(&[("limit", "1")])
            .send()
            .await
            .map_err(transport_error)?;
        self.handle_empty(resp).await?;
        Ok(crate::types::OsticketConnectionStatus {
            connected: true,
            version: None,
            message: Some("Connected".into()),
        })
    }
}
