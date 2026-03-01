// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · client
// ──────────────────────────────────────────────────────────────────────────────
// Low-level HTTP client for the Nextcloud API covering:
//  • WebDAV requests (PROPFIND, MKCOL, PUT, GET, DELETE, MOVE, COPY)
//  • OCS REST JSON requests (GET, POST, PUT, DELETE)
//  • Retry logic with exponential back-off & 429 handling
//  • WebDAV XML response parsing
// ──────────────────────────────────────────────────────────────────────────────

use crate::types::*;
use log::{debug, warn};
use reqwest::{header, Client, Method, RequestBuilder, Response, StatusCode};

const MAX_RETRIES: u32 = 4;
const INITIAL_BACKOFF_MS: u64 = 500;

/// Low-level Nextcloud HTTP client.
#[derive(Debug, Clone)]
pub struct NextcloudClient {
    http: Client,
    /// Base URL of the Nextcloud instance (e.g. `https://cloud.example.com`).
    base_url: String,
    /// Username for authentication.
    username: String,
    /// App password / regular password for basic auth.
    password: String,
    /// Optional OAuth2 bearer token (takes priority over basic auth when set).
    bearer_token: Option<String>,
}

impl NextcloudClient {
    // ── Constructors ─────────────────────────────────────────────────────

    pub fn new() -> Self {
        Self {
            http: Client::new(),
            base_url: String::new(),
            username: String::new(),
            password: String::new(),
            bearer_token: None,
        }
    }

    pub fn with_credentials(base_url: &str, username: &str, password: &str) -> Self {
        Self {
            http: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
            bearer_token: None,
        }
    }

    pub fn with_bearer(base_url: &str, token: &str) -> Self {
        Self {
            http: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            username: String::new(),
            password: String::new(),
            bearer_token: Some(token.to_string()),
        }
    }

    // ── Setters ──────────────────────────────────────────────────────────

    pub fn set_credentials(&mut self, base_url: &str, username: &str, password: &str) {
        self.base_url = base_url.trim_end_matches('/').to_string();
        self.username = username.to_string();
        self.password = password.to_string();
        self.bearer_token = None;
    }

    pub fn set_bearer_token(&mut self, token: &str) {
        self.bearer_token = Some(token.to_string());
    }

    pub fn clear_bearer_token(&mut self) {
        self.bearer_token = None;
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn username(&self) -> &str {
        &self.username
    }

    pub fn masked_password(&self) -> String {
        if self.password.len() <= 4 {
            return "****".to_string();
        }
        format!("{}****", &self.password[..4])
    }

    pub fn is_configured(&self) -> bool {
        !self.base_url.is_empty()
            && (!self.username.is_empty() || self.bearer_token.is_some())
    }

    pub fn auth_method(&self) -> AuthMethod {
        if self.bearer_token.is_some() {
            AuthMethod::OAuth2
        } else if !self.username.is_empty() && !self.password.is_empty() {
            AuthMethod::AppPassword
        } else {
            AuthMethod::None
        }
    }

    // ── URL builders ─────────────────────────────────────────────────────

    /// WebDAV endpoint for the current user, e.g.
    /// `https://cloud.example.com/remote.php/dav/files/USERNAME`.
    pub fn dav_base(&self) -> String {
        format!(
            "{}/remote.php/dav/files/{}",
            self.base_url,
            url_encode_path(&self.username)
        )
    }

    /// WebDAV trashbin endpoint.
    pub fn trashbin_base(&self) -> String {
        format!(
            "{}/remote.php/dav/trashbin/{}/trash",
            self.base_url,
            url_encode_path(&self.username)
        )
    }

    /// WebDAV versions endpoint for a file.
    pub fn versions_base(&self, file_id: u64) -> String {
        format!(
            "{}/remote.php/dav/versions/{}/versions/{}",
            self.base_url,
            url_encode_path(&self.username),
            file_id
        )
    }

    /// WebDAV uploads endpoint for chunked v2 uploads.
    pub fn uploads_base(&self) -> String {
        format!(
            "{}/remote.php/dav/uploads/{}",
            self.base_url,
            url_encode_path(&self.username)
        )
    }

    /// OCS base for a given endpoint, e.g. `/ocs/v2.php/apps/files_sharing/api/v1/shares`.
    pub fn ocs_url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// Public status.php URL.
    pub fn status_url(&self) -> String {
        format!("{}/status.php", self.base_url)
    }

    // ── Auth header injection ────────────────────────────────────────────

    fn apply_auth(&self, req: RequestBuilder) -> RequestBuilder {
        if let Some(ref tok) = self.bearer_token {
            req.bearer_auth(tok)
        } else {
            req.basic_auth(&self.username, Some(&self.password))
        }
    }

    // ── WebDAV methods ───────────────────────────────────────────────────

    /// Send a PROPFIND and parse the multistatus XML into `DavResource` items.
    pub async fn propfind(
        &self,
        path: &str,
        depth: PropfindDepth,
        body: Option<&str>,
    ) -> Result<Vec<DavResource>, String> {
        let url = format!("{}/{}", self.dav_base(), encode_dav_path(path));
        let default_body = propfind_all_props_body();
        let xml_body = body.unwrap_or(&default_body);

        let req = self
            .http
            .request(Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .header("Depth", depth.as_str())
            .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
            .header("OCS-APIRequest", "true")
            .body(xml_body.to_string());

        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| format!("read body: {}", e))?;

        if status == StatusCode::MULTI_STATUS || status.is_success() {
            parse_multistatus_xml(&text)
        } else {
            Err(format!("PROPFIND {} → {}: {}", url, status, text))
        }
    }

    /// WebDAV MKCOL (create directory).
    pub async fn mkcol(&self, path: &str) -> Result<(), String> {
        let url = format!("{}/{}", self.dav_base(), encode_dav_path(path));
        let req = self
            .http
            .request(Method::from_bytes(b"MKCOL").unwrap(), &url)
            .header("OCS-APIRequest", "true");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        check_dav_success(resp, "MKCOL").await
    }

    /// WebDAV PUT (upload file).
    pub async fn put(
        &self,
        path: &str,
        data: Vec<u8>,
        content_type: Option<&str>,
        mtime: Option<i64>,
    ) -> Result<(), String> {
        let url = format!("{}/{}", self.dav_base(), encode_dav_path(path));
        let mut req = self
            .http
            .put(&url)
            .header("OCS-APIRequest", "true")
            .header(
                header::CONTENT_TYPE,
                content_type.unwrap_or("application/octet-stream"),
            )
            .body(data);

        if let Some(ts) = mtime {
            req = req.header("X-OC-Mtime", ts.to_string());
        }

        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        let status = resp.status();
        if status.is_success() || status == StatusCode::CREATED || status == StatusCode::NO_CONTENT
        {
            Ok(())
        } else {
            let text = resp.text().await.unwrap_or_default();
            Err(format!("PUT {} → {}: {}", url, status, text))
        }
    }

    /// WebDAV GET (download file). Returns raw bytes.
    pub async fn get(&self, path: &str) -> Result<Vec<u8>, String> {
        let url = format!("{}/{}", self.dav_base(), encode_dav_path(path));
        let req = self
            .http
            .get(&url)
            .header("OCS-APIRequest", "true");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        let status = resp.status();
        if status.is_success() {
            resp.bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("read bytes: {}", e))
        } else {
            let text = resp.text().await.unwrap_or_default();
            Err(format!("GET {} → {}: {}", url, status, text))
        }
    }

    /// WebDAV DELETE.
    pub async fn delete(&self, path: &str) -> Result<(), String> {
        let url = format!("{}/{}", self.dav_base(), encode_dav_path(path));
        let req = self
            .http
            .delete(&url)
            .header("OCS-APIRequest", "true");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        check_dav_success(resp, "DELETE").await
    }

    /// WebDAV MOVE.
    pub async fn move_resource(&self, from: &str, to: &str, overwrite: bool) -> Result<(), String> {
        let src_url = format!("{}/{}", self.dav_base(), encode_dav_path(from));
        let dst_url = format!("{}/{}", self.dav_base(), encode_dav_path(to));
        let req = self
            .http
            .request(Method::from_bytes(b"MOVE").unwrap(), &src_url)
            .header("Destination", &dst_url)
            .header("Overwrite", if overwrite { "T" } else { "F" })
            .header("OCS-APIRequest", "true");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        check_dav_success(resp, "MOVE").await
    }

    /// WebDAV COPY.
    pub async fn copy_resource(&self, from: &str, to: &str, overwrite: bool) -> Result<(), String> {
        let src_url = format!("{}/{}", self.dav_base(), encode_dav_path(from));
        let dst_url = format!("{}/{}", self.dav_base(), encode_dav_path(to));
        let req = self
            .http
            .request(Method::from_bytes(b"COPY").unwrap(), &src_url)
            .header("Destination", &dst_url)
            .header("Overwrite", if overwrite { "T" } else { "F" })
            .header("OCS-APIRequest", "true");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        check_dav_success(resp, "COPY").await
    }

    /// WebDAV PROPPATCH to set a single property.
    pub async fn proppatch(&self, path: &str, body: &str) -> Result<(), String> {
        let url = format!("{}/{}", self.dav_base(), encode_dav_path(path));
        let req = self
            .http
            .request(Method::from_bytes(b"PROPPATCH").unwrap(), &url)
            .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
            .header("OCS-APIRequest", "true")
            .body(body.to_string());
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        let status = resp.status();
        if status == StatusCode::MULTI_STATUS || status.is_success() {
            Ok(())
        } else {
            let text = resp.text().await.unwrap_or_default();
            Err(format!("PROPPATCH {} → {}: {}", url, status, text))
        }
    }

    // ── OCS JSON helpers ─────────────────────────────────────────────────

    /// OCS GET returning JSON deserialized to T.
    pub async fn ocs_get<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<OcsResponse<T>, String> {
        let url = self.ocs_url(path);
        let req = self
            .http
            .get(&url)
            .header("OCS-APIRequest", "true")
            .header(header::ACCEPT, "application/json");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        parse_ocs_json(resp).await
    }

    /// OCS POST with form-encoded body.
    pub async fn ocs_post<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        form: &[(String, String)],
    ) -> Result<OcsResponse<T>, String> {
        let url = self.ocs_url(path);
        let req = self
            .http
            .post(&url)
            .header("OCS-APIRequest", "true")
            .header(header::ACCEPT, "application/json")
            .form(form);
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        parse_ocs_json(resp).await
    }

    /// OCS PUT with form-encoded body.
    pub async fn ocs_put<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        form: &[(String, String)],
    ) -> Result<OcsResponse<T>, String> {
        let url = self.ocs_url(path);
        let req = self
            .http
            .put(&url)
            .header("OCS-APIRequest", "true")
            .header(header::ACCEPT, "application/json")
            .form(form);
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        parse_ocs_json(resp).await
    }

    /// OCS DELETE.
    pub async fn ocs_delete<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<OcsResponse<T>, String> {
        let url = self.ocs_url(path);
        let req = self
            .http
            .delete(&url)
            .header("OCS-APIRequest", "true")
            .header(header::ACCEPT, "application/json");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        parse_ocs_json(resp).await
    }

    /// Plain GET for non-OCS endpoints (status.php, etc.). Returns raw JSON.
    pub async fn plain_get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, String> {
        let req = self
            .http
            .get(url)
            .header(header::ACCEPT, "application/json");
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        let status = resp.status();
        if status.is_success() {
            resp.json::<T>()
                .await
                .map_err(|e| format!("json parse: {}", e))
        } else {
            let text = resp.text().await.unwrap_or_default();
            Err(format!("GET {} → {}: {}", url, status, text))
        }
    }

    /// Plain GET returning raw bytes (previews / thumbnails).
    pub async fn plain_get_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
        let req = self.http.get(url);
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        let status = resp.status();
        if status.is_success() {
            resp.bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("read bytes: {}", e))
        } else {
            Err(format!("GET bytes {} → {}", url, status))
        }
    }

    /// Plain POST with JSON body returning JSON.
    pub async fn plain_post_json<B: serde::Serialize, R: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> Result<R, String> {
        let req = self
            .http
            .post(url)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ACCEPT, "application/json")
            .json(body);
        let resp = self.send_with_retry(self.apply_auth(req)).await?;
        let status = resp.status();
        if status.is_success() {
            resp.json::<R>()
                .await
                .map_err(|e| format!("json parse: {}", e))
        } else {
            let text = resp.text().await.unwrap_or_default();
            Err(format!("POST {} → {}: {}", url, status, text))
        }
    }

    // ── Retry engine ─────────────────────────────────────────────────────

    async fn send_with_retry(&self, req: RequestBuilder) -> Result<Response, String> {
        // reqwest::RequestBuilder is not Clone, so we must try_clone for retries.
        // If try_clone fails (stream body), we just send once.
        let mut last_err = String::new();

        // Build a clonable request
        let request = req.build().map_err(|e| format!("build request: {}", e))?;
        let mut attempt = 0u32;

        loop {
            let cloned = request
                .try_clone()
                .ok_or_else(|| "request not clonable".to_string())?;

            match self.http.execute(cloned).await {
                Ok(resp) => {
                    let status = resp.status();
                    if status == StatusCode::TOO_MANY_REQUESTS {
                        if attempt >= MAX_RETRIES {
                            return Err("rate-limited after max retries".to_string());
                        }
                        let wait = retry_after_ms(&resp, attempt);
                        warn!("429 rate-limited, waiting {}ms (attempt {})", wait, attempt);
                        tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                        attempt += 1;
                        continue;
                    }
                    if status.is_server_error() && attempt < MAX_RETRIES {
                        let wait = backoff_ms(attempt);
                        warn!("{} server error, retrying in {}ms", status, wait);
                        tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                        attempt += 1;
                        continue;
                    }
                    return Ok(resp);
                }
                Err(e) => {
                    last_err = format!("{}", e);
                    if attempt >= MAX_RETRIES {
                        break;
                    }
                    let wait = backoff_ms(attempt);
                    debug!("request error, retrying in {}ms: {}", wait, e);
                    tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                    attempt += 1;
                }
            }
        }

        Err(format!("request failed after {} attempts: {}", MAX_RETRIES, last_err))
    }
}

// ── Free-standing helpers ────────────────────────────────────────────────────

fn backoff_ms(attempt: u32) -> u64 {
    INITIAL_BACKOFF_MS * 2u64.pow(attempt)
}

fn retry_after_ms(resp: &Response, attempt: u32) -> u64 {
    resp.headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .map(|s| s * 1000)
        .unwrap_or_else(|| backoff_ms(attempt))
}

/// URL-encode a path segment for WebDAV URLs.
pub fn encode_dav_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    trimmed
        .split('/')
        .map(|seg| {
            url::form_urlencoded::byte_serialize(seg.as_bytes()).collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// URL-encode just the username portion of the path.
fn url_encode_path(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Build the PROPFIND XML body requesting all common properties.
pub fn propfind_all_props_body() -> String {
    r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:displayname/>
    <d:getcontenttype/>
    <d:getcontentlength/>
    <d:getetag/>
    <d:getlastmodified/>
    <d:resourcetype/>
    <oc:fileid/>
    <oc:owner-id/>
    <oc:owner-display-name/>
    <oc:permissions/>
    <oc:checksums/>
    <nc:has-preview/>
    <oc:favorite/>
    <oc:comments-count/>
    <oc:size/>
    <nc:system-tags/>
  </d:prop>
</d:propfind>"#
        .to_string()
}

/// Check a WebDAV response for success (2xx / 207).
async fn check_dav_success(resp: Response, method: &str) -> Result<(), String> {
    let status = resp.status();
    if status.is_success()
        || status == StatusCode::CREATED
        || status == StatusCode::NO_CONTENT
        || status == StatusCode::MULTI_STATUS
    {
        Ok(())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("{} → {}: {}", method, status, text))
    }
}

/// Parse an OCS JSON response.
async fn parse_ocs_json<T: serde::de::DeserializeOwned>(
    resp: Response,
) -> Result<OcsResponse<T>, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read body: {}", e))?;

    if status.is_success() {
        serde_json::from_str::<OcsResponse<T>>(&text)
            .map_err(|e| format!("OCS JSON parse error: {} – body: {}", e, &text[..text.len().min(500)]))
    } else {
        Err(format!("OCS request failed {}: {}", status, &text[..text.len().min(500)]))
    }
}

// ── WebDAV XML Parser ────────────────────────────────────────────────────────

/// Parse a WebDAV multistatus XML body into `DavResource` entries.
pub fn parse_multistatus_xml(xml: &str) -> Result<Vec<DavResource>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut resources: Vec<DavResource> = Vec::new();
    let mut current: Option<DavResource> = None;
    let mut in_response = false;
    let mut in_propstat = false;
    let mut current_tag: Option<String> = None;
    let mut buf = Vec::new();
    let mut is_collection = false;
    let mut in_resourcetype = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = local_name(e.name().as_ref());
                match local.as_str() {
                    "response" => {
                        in_response = true;
                        current = Some(DavResource::default());
                        is_collection = false;
                    }
                    "propstat" => in_propstat = true,
                    "resourcetype" => in_resourcetype = true,
                    "collection" if in_resourcetype => is_collection = true,
                    "href" | "displayname" | "getcontenttype" | "getcontentlength"
                    | "getetag" | "getlastmodified" | "fileid" | "owner-id"
                    | "owner-display-name" | "permissions" | "checksums" | "has-preview"
                    | "favorite" | "comments-count" | "size" => {
                        current_tag = Some(local);
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local = local_name(e.name().as_ref());
                if local == "collection" && in_resourcetype {
                    is_collection = true;
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Some(ref tag) = current_tag {
                    if let Some(ref mut res) = current {
                        let text = e
                            .unescape()
                            .unwrap_or_default()
                            .to_string();
                        match tag.as_str() {
                            "href" => res.href = text,
                            "displayname" => res.display_name = text,
                            "getcontenttype" => res.content_type = Some(text),
                            "getcontentlength" => {
                                res.content_length = text.parse().ok();
                            }
                            "getetag" => {
                                res.etag = Some(text.trim_matches('"').to_string());
                            }
                            "getlastmodified" => res.last_modified = Some(text),
                            "fileid" => res.file_id = text.parse().ok(),
                            "owner-id" => res.owner_id = Some(text),
                            "owner-display-name" => res.owner_display_name = Some(text),
                            "permissions" => res.permissions = Some(text),
                            "checksums" => res.checksum = Some(text),
                            "has-preview" => {
                                res.has_preview = Some(text == "true" || text == "1");
                            }
                            "favorite" => {
                                res.favorite = Some(text == "1");
                            }
                            "comments-count" => {
                                res.comments_count = text.parse().ok();
                            }
                            "size" => {
                                res.size = text.parse().ok();
                            }
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let local = local_name(e.name().as_ref());
                match local.as_str() {
                    "response" => {
                        if let Some(mut res) = current.take() {
                            if is_collection {
                                res.resource_type = DavResourceType::Folder;
                            }
                            // Decode display_name from href if empty
                            if res.display_name.is_empty() {
                                res.display_name = display_name_from_href(&res.href);
                            }
                            resources.push(res);
                        }
                        in_response = false;
                    }
                    "propstat" => in_propstat = false,
                    "resourcetype" => in_resourcetype = false,
                    _ => {
                        // Close whatever text tag we were reading
                        if current_tag.as_deref() == Some(&local) {
                            current_tag = None;
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(resources)
}

/// Extract the local name from a possibly-namespaced XML tag.
fn local_name(raw: &[u8]) -> String {
    let s = String::from_utf8_lossy(raw);
    if let Some(pos) = s.rfind(':') {
        s[pos + 1..].to_string()
    } else {
        s.to_string()
    }
}

/// Derive a display name from a DAV href when the server doesn't send `<d:displayname>`.
fn display_name_from_href(href: &str) -> String {
    let decoded = url::form_urlencoded::parse(href.as_bytes())
        .map(|(k, v)| {
            if v.is_empty() {
                k.to_string()
            } else {
                format!("{}={}", k, v)
            }
        })
        .collect::<String>();

    let trimmed = decoded.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .next()
        .unwrap_or(trimmed)
        .to_string()
}

/// Build a PROPPATCH XML body for setting the favorite flag.
pub fn proppatch_favorite_body(favorite: bool) -> String {
    let val = if favorite { "1" } else { "0" };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:set>
    <d:prop>
      <oc:favorite>{}</oc:favorite>
    </d:prop>
  </d:set>
</d:propertyupdate>"#,
        val
    )
}

/// Build a PROPPATCH XML body for setting tags.
pub fn proppatch_tags_body(tags: &[String]) -> String {
    let tag_xml: String = tags
        .iter()
        .map(|t| format!("      <nc:system-tag>{}</nc:system-tag>\n", t))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
  <d:set>
    <d:prop>
      <nc:system-tags>
{}      </nc:system-tags>
    </d:prop>
  </d:set>
</d:propertyupdate>"#,
        tag_xml
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_dav_path_basic() {
        assert_eq!(encode_dav_path("Documents/hello world.pdf"), "Documents/hello+world.pdf");
    }

    #[test]
    fn encode_dav_path_leading_slash() {
        assert_eq!(encode_dav_path("/Photos"), "Photos");
    }

    #[test]
    fn display_name_from_href_simple() {
        let n = display_name_from_href("/remote.php/dav/files/user/Photos/");
        assert_eq!(n, "Photos");
    }

    #[test]
    fn display_name_from_href_file() {
        let n = display_name_from_href("/remote.php/dav/files/user/test.txt");
        assert_eq!(n, "test.txt");
    }

    #[test]
    fn propfind_body_is_valid_xml() {
        let body = propfind_all_props_body();
        assert!(body.starts_with("<?xml"));
        assert!(body.contains("<d:propfind"));
        assert!(body.contains("oc:fileid"));
    }

    #[test]
    fn proppatch_favorite_body_true() {
        let body = proppatch_favorite_body(true);
        assert!(body.contains("<oc:favorite>1</oc:favorite>"));
    }

    #[test]
    fn proppatch_favorite_body_false() {
        let body = proppatch_favorite_body(false);
        assert!(body.contains("<oc:favorite>0</oc:favorite>"));
    }

    #[test]
    fn client_default_not_configured() {
        let c = NextcloudClient::new();
        assert!(!c.is_configured());
        assert_eq!(c.auth_method(), AuthMethod::None);
    }

    #[test]
    fn client_with_credentials_configured() {
        let c = NextcloudClient::with_credentials("https://nc.test", "user", "pass");
        assert!(c.is_configured());
        assert_eq!(c.auth_method(), AuthMethod::AppPassword);
    }

    #[test]
    fn client_with_bearer_configured() {
        let c = NextcloudClient::with_bearer("https://nc.test", "abc123");
        assert!(c.is_configured());
        assert_eq!(c.auth_method(), AuthMethod::OAuth2);
    }

    #[test]
    fn dav_base_url() {
        let c = NextcloudClient::with_credentials("https://nc.test", "alice", "pw");
        assert_eq!(c.dav_base(), "https://nc.test/remote.php/dav/files/alice");
    }

    #[test]
    fn trashbin_url() {
        let c = NextcloudClient::with_credentials("https://nc.test", "bob", "pw");
        assert!(c.trashbin_base().contains("/trashbin/bob/trash"));
    }

    #[test]
    fn uploads_url() {
        let c = NextcloudClient::with_credentials("https://nc.test", "x", "pw");
        assert!(c.uploads_base().contains("/uploads/x"));
    }

    #[test]
    fn masked_password_short() {
        let mut c = NextcloudClient::new();
        c.password = "ab".into();
        assert_eq!(c.masked_password(), "****");
    }

    #[test]
    fn masked_password_long() {
        let mut c = NextcloudClient::new();
        c.password = "secret-password".into();
        assert_eq!(c.masked_password(), "secr****");
    }

    #[test]
    fn parse_multistatus_minimal() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/user/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>user</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/user/test.txt</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>test.txt</d:displayname>
        <d:getcontentlength>42</d:getcontentlength>
        <d:getcontenttype>text/plain</d:getcontenttype>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;

        let res = parse_multistatus_xml(xml).unwrap();
        assert_eq!(res.len(), 2);
        assert_eq!(res[0].resource_type, DavResourceType::Folder);
        assert_eq!(res[0].display_name, "user");
        assert_eq!(res[1].resource_type, DavResourceType::File);
        assert_eq!(res[1].display_name, "test.txt");
        assert_eq!(res[1].content_length, Some(42));
    }

    #[test]
    fn parse_multistatus_with_properties() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/user/photo.jpg</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>photo.jpg</d:displayname>
        <d:getcontentlength>1048576</d:getcontentlength>
        <d:getetag>"abc123"</d:getetag>
        <oc:fileid>42</oc:fileid>
        <oc:permissions>RGDNVCK</oc:permissions>
        <nc:has-preview>true</nc:has-preview>
        <oc:favorite>1</oc:favorite>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;

        let res = parse_multistatus_xml(xml).unwrap();
        assert_eq!(res.len(), 1);
        let r = &res[0];
        assert_eq!(r.file_id, Some(42));
        assert_eq!(r.etag.as_deref(), Some("abc123"));
        assert_eq!(r.permissions.as_deref(), Some("RGDNVCK"));
        assert_eq!(r.has_preview, Some(true));
        assert_eq!(r.favorite, Some(true));
        assert_eq!(r.content_length, Some(1048576));
    }

    #[test]
    fn backoff_increases_exponentially() {
        assert_eq!(backoff_ms(0), 500);
        assert_eq!(backoff_ms(1), 1000);
        assert_eq!(backoff_ms(2), 2000);
        assert_eq!(backoff_ms(3), 4000);
    }

    #[test]
    fn ocs_url_building() {
        let c = NextcloudClient::with_credentials("https://nc.test", "u", "p");
        assert_eq!(
            c.ocs_url("/ocs/v2.php/apps/files_sharing/api/v1/shares"),
            "https://nc.test/ocs/v2.php/apps/files_sharing/api/v1/shares"
        );
    }

    #[test]
    fn status_url_building() {
        let c = NextcloudClient::with_credentials("https://nc.test/", "u", "p");
        // trailing slash should be stripped
        assert_eq!(c.status_url(), "https://nc.test/status.php");
    }
}
