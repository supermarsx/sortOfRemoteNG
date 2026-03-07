//! HTTP client wrapper for the Grafana API.

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{GrafanaError, GrafanaResult};
use crate::types::GrafanaConnectionConfig;

#[derive(Debug, Clone)]
pub struct GrafanaClient {
    pub config: GrafanaConnectionConfig,
    http: reqwest::Client,
    base_url: String,
}

impl GrafanaClient {
    pub fn new(config: GrafanaConnectionConfig) -> GrafanaResult<Self> {
        let scheme = config.scheme.clone().unwrap_or_else(|| "http".to_string());
        let port = config.port.unwrap_or(3000);
        let base_url = format!("{}://{}:{}", scheme, config.host, port);

        let tls_verify = config.tls_verify.unwrap_or(true);
        let timeout_secs = config.timeout_secs.unwrap_or(30);

        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        if let Some(ref key) = config.api_key {
            let val = format!("Bearer {}", key);
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&val).map_err(|e| GrafanaError::auth_failed(e.to_string()))?,
            );
        } else if let (Some(ref user), Some(ref pass)) = (&config.username, &config.password) {
            let creds = base64_encode(&format!("{}:{}", user, pass));
            let val = format!("Basic {}", creds);
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&val).map_err(|e| GrafanaError::auth_failed(e.to_string()))?,
            );
        }

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .danger_accept_invalid_certs(!tls_verify)
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| GrafanaError::connection_failed(e.to_string()))?;

        Ok(Self { config, http, base_url })
    }

    pub fn api_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    pub async fn api_get<T: DeserializeOwned>(&self, path: &str) -> GrafanaResult<T> {
        let url = self.api_url(path);
        log::debug!("GET {}", url);
        let resp = self.http.get(&url).send().await?;
        self.handle_response(resp).await
    }

    pub async fn api_get_with_query<T: DeserializeOwned, Q: Serialize + ?Sized>(
        &self,
        path: &str,
        query: &Q,
    ) -> GrafanaResult<T> {
        let url = self.api_url(path);
        log::debug!("GET {} (with query)", url);
        let resp = self.http.get(&url).query(query).send().await?;
        self.handle_response(resp).await
    }

    pub async fn api_post<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> GrafanaResult<T> {
        let url = self.api_url(path);
        log::debug!("POST {}", url);
        let resp = self.http.post(&url).json(body).send().await?;
        self.handle_response(resp).await
    }

    pub async fn api_put<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> GrafanaResult<T> {
        let url = self.api_url(path);
        log::debug!("PUT {}", url);
        let resp = self.http.put(&url).json(body).send().await?;
        self.handle_response(resp).await
    }

    pub async fn api_patch<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> GrafanaResult<T> {
        let url = self.api_url(path);
        log::debug!("PATCH {}", url);
        let resp = self.http.patch(&url).json(body).send().await?;
        self.handle_response(resp).await
    }

    pub async fn api_delete<T: DeserializeOwned>(&self, path: &str) -> GrafanaResult<T> {
        let url = self.api_url(path);
        log::debug!("DELETE {}", url);
        let resp = self.http.delete(&url).send().await?;
        self.handle_response(resp).await
    }

    pub async fn api_post_raw<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> GrafanaResult<serde_json::Value> {
        self.api_post(path, body).await
    }

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> GrafanaResult<T> {
        let status = resp.status();
        if status.is_success() {
            let text = resp.text().await?;
            if text.is_empty() {
                // Try to deserialize from "{}" for empty responses
                return serde_json::from_str("{}").map_err(GrafanaError::from);
            }
            serde_json::from_str(&text).map_err(|e| {
                GrafanaError::parse_error(format!("Failed to parse response: {} – body: {}", e, &text[..text.len().min(200)]))
            })
        } else {
            let body = resp.text().await.unwrap_or_default();
            match status.as_u16() {
                401 => Err(GrafanaError::auth_failed(format!("HTTP 401: {}", body))),
                403 => Err(GrafanaError::permission_denied(format!("HTTP 403: {}", body))),
                404 => Err(GrafanaError::api_error(format!("HTTP 404: {}", body))),
                409 => Err(GrafanaError::conflict(format!("HTTP 409: {}", body))),
                412 => Err(GrafanaError::validation(format!("HTTP 412: {}", body))),
                422 => Err(GrafanaError::validation(format!("HTTP 422: {}", body))),
                _ => Err(GrafanaError::api_error(format!("HTTP {}: {}", status.as_u16(), body))),
            }
        }
    }
}

fn base64_encode(input: &str) -> String {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut encoder = Base64Encoder::new(&mut buf);
        encoder.write_all(input.as_bytes()).unwrap();
        encoder.finish();
    }
    String::from_utf8(buf).unwrap()
}

/// Minimal Base64 encoder to avoid pulling in a base64 crate.
struct Base64Encoder<'a> {
    out: &'a mut Vec<u8>,
    buf: [u8; 3],
    len: usize,
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

impl<'a> Base64Encoder<'a> {
    fn new(out: &'a mut Vec<u8>) -> Self {
        Self { out, buf: [0; 3], len: 0 }
    }
    fn flush_buf(&mut self) {
        if self.len == 0 {
            return;
        }
        let b = self.buf;
        self.out.push(B64[(b[0] >> 2) as usize]);
        self.out.push(B64[((b[0] & 0x03) << 4 | b[1] >> 4) as usize]);
        if self.len > 1 {
            self.out.push(B64[((b[1] & 0x0f) << 2 | b[2] >> 6) as usize]);
        } else {
            self.out.push(b'=');
        }
        if self.len > 2 {
            self.out.push(B64[(b[2] & 0x3f) as usize]);
        } else {
            self.out.push(b'=');
        }
        self.buf = [0; 3];
        self.len = 0;
    }
    fn finish(mut self) {
        self.flush_buf();
    }
}

impl<'a> std::io::Write for Base64Encoder<'a> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        let mut i = 0;
        while i < data.len() {
            self.buf[self.len] = data[i];
            self.len += 1;
            i += 1;
            if self.len == 3 {
                self.flush_buf();
            }
        }
        Ok(data.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
