// ── sorng-osticket/src/client.rs ───────────────────────────────────────────────
use reqwest::{header, Client, Response, StatusCode};
use serde::de::DeserializeOwned;

use crate::error::{OsticketError, OsticketErrorKind, OsticketResult};
use crate::types::OsticketConnectionConfig;

/// Low-level osTicket HTTP client.
#[derive(Debug, Clone)]
pub struct OsticketClient {
    pub(crate) http: Client,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
}

#[allow(dead_code)]
impl OsticketClient {
    pub fn from_config(cfg: &OsticketConnectionConfig) -> OsticketResult<Self> {
        let http = Client::builder()
            .danger_accept_invalid_certs(cfg.skip_tls_verify)
            .timeout(std::time::Duration::from_secs(cfg.timeout_seconds))
            .build()
            .map_err(|e| OsticketError::new(OsticketErrorKind::ConnectionFailed, e.to_string()))?;

        let base = cfg.host.trim_end_matches('/').to_string();

        Ok(Self { http, base_url: base, api_key: cfg.api_key.clone() })
    }

    fn default_headers(&self) -> header::HeaderMap {
        let mut h = header::HeaderMap::new();
        h.insert("X-API-Key", header::HeaderValue::from_str(&self.api_key).unwrap_or_else(|_| header::HeaderValue::from_static("")));
        h.insert(header::CONTENT_TYPE, header::HeaderValue::from_static("application/json"));
        h
    }

    pub(crate) fn url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    pub(crate) async fn get<T: DeserializeOwned>(&self, path: &str) -> OsticketResult<T> {
        let resp = self.http.get(self.url(path)).headers(self.default_headers()).send().await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn get_with_params<T: DeserializeOwned>(&self, path: &str, params: &[(String, String)]) -> OsticketResult<T> {
        let resp = self.http.get(self.url(path)).headers(self.default_headers()).query(params).send().await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post<T: DeserializeOwned, B: serde::Serialize>(&self, path: &str, body: &B) -> OsticketResult<T> {
        let resp = self.http.post(self.url(path)).headers(self.default_headers()).json(body).send().await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post_unit<B: serde::Serialize>(&self, path: &str, body: &B) -> OsticketResult<()> {
        let resp = self.http.post(self.url(path)).headers(self.default_headers()).json(body).send().await?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn put<T: DeserializeOwned, B: serde::Serialize>(&self, path: &str, body: &B) -> OsticketResult<T> {
        let resp = self.http.put(self.url(path)).headers(self.default_headers()).json(body).send().await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn patch<T: DeserializeOwned, B: serde::Serialize>(&self, path: &str, body: &B) -> OsticketResult<T> {
        let resp = self.http.patch(self.url(path)).headers(self.default_headers()).json(body).send().await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn delete(&self, path: &str) -> OsticketResult<()> {
        let resp = self.http.delete(self.url(path)).headers(self.default_headers()).send().await?;
        self.handle_empty(resp).await
    }

    async fn handle_response<T: DeserializeOwned>(&self, resp: Response) -> OsticketResult<T> {
        let status = resp.status();
        if status.is_success() {
            let text = resp.text().await?;
            serde_json::from_str(&text).map_err(|e| OsticketError::new(OsticketErrorKind::ParseError, format!("{}: {}", e, &text[..text.len().min(200)])))
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.status_error(status, body))
        }
    }

    async fn handle_empty(&self, resp: Response) -> OsticketResult<()> {
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.status_error(status, body))
        }
    }

    fn status_error(&self, status: StatusCode, body: String) -> OsticketError {
        let kind = match status.as_u16() {
            401 => OsticketErrorKind::AuthError,
            403 => OsticketErrorKind::Forbidden,
            404 => OsticketErrorKind::NotFound,
            409 => OsticketErrorKind::Conflict,
            429 => OsticketErrorKind::RateLimited,
            _ => OsticketErrorKind::ApiError(status.as_u16()),
        };
        OsticketError::new(kind, format!("{}: {}", status, &body[..body.len().min(500)]))
    }

    pub async fn ping(&self) -> OsticketResult<crate::types::OsticketConnectionStatus> {
        // Attempt a lightweight GET; any 200-level means connected
        match self.http.get(self.url("/tickets")).headers(self.default_headers()).query(&[("limit", "1")]).send().await {
            Ok(resp) if resp.status().is_success() => Ok(crate::types::OsticketConnectionStatus {
                connected: true,
                version: None,
                message: Some("Connected".into()),
            }),
            Ok(resp) => Ok(crate::types::OsticketConnectionStatus {
                connected: false,
                version: None,
                message: Some(format!("HTTP {}", resp.status())),
            }),
            Err(e) => Ok(crate::types::OsticketConnectionStatus {
                connected: false,
                version: None,
                message: Some(e.to_string()),
            }),
        }
    }
}
