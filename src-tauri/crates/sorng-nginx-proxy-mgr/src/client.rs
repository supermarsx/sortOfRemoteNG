// ── sorng-nginx-proxy-mgr – REST API client ─────────────────────────────────
//! HTTP client wrapping the Nginx Proxy Manager REST API.
//! Endpoint: http://host:81/api/

use crate::error::{NpmError, NpmErrorKind, NpmResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::sync::RwLock;
use std::time::Duration;

pub struct NpmClient {
    pub config: NpmConnectionConfig,
    http: HttpClient,
    token: RwLock<Option<String>>,
}

impl NpmClient {
    pub fn new(config: NpmConnectionConfig) -> NpmResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| NpmError::connection(format!("http client build: {e}")))?;
        let token = config.token.clone();
        Ok(Self {
            config,
            http,
            token: RwLock::new(token),
        })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.api_url.trim_end_matches('/')
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url(), path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Ok(guard) = self.token.read() {
            if let Some(ref t) = *guard {
                return req.header("Authorization", format!("Bearer {t}"));
            }
        }
        req
    }

    pub async fn login(&self) -> NpmResult<()> {
        let (email, password) = match (&self.config.email, &self.config.password) {
            (Some(e), Some(p)) => (e.clone(), p.clone()),
            _ => return Ok(()), // token auth or no auth
        };
        let url = self.api_url("/tokens");
        debug!("NPM POST /tokens (login)");
        let payload = NpmTokenPayload { identity: email, secret: password };
        let resp = self.http.post(&url).json(&payload).send().await
            .map_err(|e| NpmError::connection(format!("login: {e}")))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(NpmError::auth(format!("login failed HTTP {status}: {body}")));
        }
        let token_resp: NpmTokenResponse = serde_json::from_str(&body)
            .map_err(|e| NpmError::parse(format!("token parse: {e}")))?;
        if let Ok(mut guard) = self.token.write() {
            *guard = Some(token_resp.token);
        }
        Ok(())
    }

    pub async fn refresh_token(&self) -> NpmResult<()> {
        self.login().await
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> NpmResult<T> {
        let url = self.api_url(path);
        debug!("NPM GET {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| NpmError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_vec<T: DeserializeOwned>(&self, path: &str) -> NpmResult<Vec<T>> {
        self.get(path).await
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> NpmResult<T> {
        let url = self.api_url(path);
        debug!("NPM POST {url}");
        let resp = self.apply_auth(self.http.post(&url).json(body))
            .send().await
            .map_err(|e| NpmError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn put<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> NpmResult<T> {
        let url = self.api_url(path);
        debug!("NPM PUT {url}");
        let resp = self.apply_auth(self.http.put(&url).json(body))
            .send().await
            .map_err(|e| NpmError::connection(format!("PUT {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> NpmResult<()> {
        let url = self.api_url(path);
        debug!("NPM DELETE {url}");
        let resp = self.apply_auth(self.http.delete(&url))
            .send().await
            .map_err(|e| NpmError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn post_form_file(&self, path: &str, field: &str, filename: &str, data: Vec<u8>) -> NpmResult<serde_json::Value> {
        let url = self.api_url(path);
        debug!("NPM POST multipart {url}");
        let part = reqwest::multipart::Part::bytes(data)
            .file_name(filename.to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| NpmError::parse(format!("mime: {e}")))?;
        let form = reqwest::multipart::Form::new().part(field.to_string(), part);
        let resp = self.apply_auth(self.http.post(&url).multipart(form))
            .send().await
            .map_err(|e| NpmError::connection(format!("POST multipart {url}: {e}")))?;
        self.handle_response(resp).await
    }

    // ── Ping ─────────────────────────────────────────────────────────

    pub async fn ping(&self) -> NpmResult<NpmConnectionSummary> {
        // Try to get health or reports to verify connectivity
        let _reports: NpmReports = self.get("/reports/hosts").await?;
        let user = self.config.email.clone();
        Ok(NpmConnectionSummary {
            api_url: self.config.api_url.clone(),
            user,
            version: None,
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> NpmResult<T> {
        let status = resp.status();
        let body_text = resp.text().await
            .map_err(|e| NpmError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        serde_json::from_str(&body_text)
            .map_err(|e| NpmError::parse(format!("json: {e}\nBody: {body_text}")))
    }

    fn map_status_error(&self, status: u16, body: &str) -> NpmError {
        let kind = match status {
            401 => NpmErrorKind::TokenExpired,
            403 => NpmErrorKind::PermissionDenied,
            404 => NpmErrorKind::ProxyHostNotFound,
            _ => NpmErrorKind::HttpError,
        };
        NpmError { kind, message: format!("HTTP {status}: {body}") }
    }
}
