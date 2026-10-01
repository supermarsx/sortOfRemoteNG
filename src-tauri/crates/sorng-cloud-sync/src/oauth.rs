//! OAuth-backed opaque application-data blobs. Never log provider responses or URLs.
//! Redirects are disabled on the authenticated client; Graph download capabilities
//! are followed explicitly without Authorization, only on approved HTTPS hosts.
use crate::types::{Blob, SyncError, Target, TransportOptions, Written};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::stream;
use reqwest::{header, Client, Method, RequestBuilder, Response, StatusCode, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, sync::OnceLock};

const FILE: &str = "application-data.v1.sorng";
const META_LIMIT: usize = 1024 * 1024;
const MAX_PAGES: usize = 100;
const CHUNK: usize = 16 * 1024;
// v2 exposes the file ETag in its resource; a partial-response HTTP validator
// or modifiedTime/version is not a replacement for that concurrency token.
// https://developers.google.com/workspace/drive/api/reference/rest/v2/files
const GOOGLE: &str = "https://www.googleapis.com/drive/v2";
const GRAPH: &str = "https://graph.microsoft.com/v1.0";

// Volatile, bounded credentials cache; keys are digests of request identity,
// including all configuration, so editing/replacing an account cannot reuse it.
// Never Debug/serialize these records. Persistence requires a separate vault API.
struct CachedToken {
    access: String,
    refresh: String,
    expires: tokio::time::Instant,
}
static TOKENS: OnceLock<tokio::sync::Mutex<HashMap<String, CachedToken>>> = OnceLock::new();
fn tokens() -> &'static tokio::sync::Mutex<HashMap<String, CachedToken>> {
    TOKENS.get_or_init(Default::default)
}
fn cache_key(id: &str, google: bool, config: &Value) -> String {
    let identity = json!([id, google, config]).to_string();
    hex::encode(Sha256::digest(identity.as_bytes()))
}
#[cfg(test)]
tokio::task_local! { static FIXTURE_ORIGIN: Url; }

fn invalid(message: &str) -> SyncError {
    SyncError::Invalid(message.into())
}
fn transport() -> SyncError {
    SyncError::Transport("Cloud request failed".into())
}
fn conflict() -> SyncError {
    SyncError::Conflict("Remote application data changed; read again before writing".into())
}
fn auth() -> SyncError {
    SyncError::Authentication("Cloud authorization expired or was rejected".into())
}
fn field<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}
fn required<'a>(value: &'a Value, name: &str) -> Result<&'a str, SyncError> {
    field(value, name).ok_or_else(|| invalid("Cloud response is missing a required field"))
}
fn segment(value: &str) -> String {
    let mut url = Url::parse("https://example.invalid/").expect("constant URL");
    url.path_segments_mut()
        .expect("hierarchical URL")
        .push(value);
    url.path()[1..].to_owned()
}
fn identifier(value: &str) -> Result<&str, SyncError> {
    if value.is_empty()
        || value.len() > 1024
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-!.".contains(&b))
        || value == "."
        || value == ".."
    {
        return Err(invalid("Invalid cloud object identifier"));
    }
    Ok(value)
}
fn path_parts(config: &Value) -> Result<Vec<&str>, SyncError> {
    let path = field(config, "folderPath").unwrap_or("");
    if path.len() > 4096 {
        return Err(invalid("Cloud folder path is too long"));
    }
    let parts: Vec<_> = path
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    if parts.len() > 32
        || parts.iter().any(|p| {
            *p == "." || *p == ".." || p.chars().any(|c| c.is_control() || "\\:#?%".contains(c))
        })
    {
        return Err(invalid("Invalid cloud folder path"));
    }
    Ok(parts)
}
fn check_status(response: Response) -> Result<Response, SyncError> {
    match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(auth()),
        StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED => Err(conflict()),
        status if status.is_success() => Ok(response),
        _ => Err(transport()),
    }
}
async fn pace(start: tokio::time::Instant, bytes: usize, kbs: u64) {
    if kbs > 0 {
        let duration = Duration::from_secs_f64(bytes as f64 / (kbs as f64 * 1024.0));
        tokio::time::sleep_until(start + duration).await;
    }
}
async fn body(mut response: Response, limit: usize, kbs: u64) -> Result<Vec<u8>, SyncError> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(invalid("Cloud response exceeds size limit"));
    }
    let start = tokio::time::Instant::now();
    let mut result = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| transport())? {
        if chunk.len() > limit.saturating_sub(result.len()) {
            return Err(invalid("Cloud response exceeds size limit"));
        }
        result.extend_from_slice(&chunk);
        pace(start, result.len(), kbs).await;
    }
    Ok(result)
}
async fn json_body(response: Response) -> Result<Value, SyncError> {
    serde_json::from_slice(&body(check_status(response)?, META_LIMIT, 0).await?)
        .map_err(|_| transport())
}
fn upload_stream(
    bytes: Vec<u8>,
    kbs: u64,
) -> impl futures_util::Stream<Item = Result<Vec<u8>, std::io::Error>> {
    stream::unfold(
        (bytes, 0usize, tokio::time::Instant::now()),
        move |(bytes, offset, start)| async move {
            if offset == bytes.len() {
                return None;
            }
            let end = (offset + CHUNK).min(bytes.len());
            pace(start, end, kbs).await;
            let part = bytes[offset..end].to_vec();
            Some((Ok::<_, std::io::Error>(part), (bytes, end, start)))
        },
    )
}
fn upload_body(bytes: Vec<u8>, kbs: u64) -> reqwest::Body {
    reqwest::Body::wrap_stream(upload_stream(bytes, kbs))
}
fn download_url(raw: &str) -> Result<Url, SyncError> {
    let url = Url::parse(raw).map_err(|_| invalid("Invalid download location"))?;
    let host = url.host_str().unwrap_or("");
    let approved = [
        "1drv.com",
        "onedrive.com",
        "sharepoint.com",
        "sharepointonline.com",
    ]
    .iter()
    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")));
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !approved
    {
        return Err(SyncError::Trust("Untrusted cloud download location".into()));
    }
    Ok(url)
}

struct Session<'a> {
    client: Client,
    config: &'a Value,
    google: bool,
    token: std::sync::Mutex<String>,
    options: &'a TransportOptions,
    cache_key: String,
    #[cfg(test)]
    fixture_origin: Option<Url>,
}
#[derive(Clone)]
struct Item {
    id: String,
    etag: String,
}
impl Item {
    fn revision(&self) -> String {
        STANDARD.encode(json!([self.id, self.etag]).to_string())
    }
}
fn etag(value: &str) -> Result<String, SyncError> {
    if value.len() < 2
        || value.len() > 1024
        || !value.starts_with('"')
        || !value.ends_with('"')
        || value[1..value.len() - 1]
            .chars()
            .any(|c| c.is_control() || c == '"')
    {
        return Err(invalid("Provider did not supply a strong revision tag"));
    }
    Ok(value.to_owned())
}
fn expected(item: Option<&Item>, revision: Option<&str>) -> Result<(), SyncError> {
    match (item, revision) {
        (None, None) => Ok(()),
        (Some(item), Some(revision)) if item.revision() == revision => Ok(()),
        _ => Err(conflict()),
    }
}
impl<'a> Session<'a> {
    async fn new(target: &'a Target, options: &'a TransportOptions) -> Result<Self, SyncError> {
        let (google, config) = match target.provider.as_str() {
            "googleDrive" => (true, target.google_drive.as_ref()),
            "oneDrive" => (false, target.one_drive.as_ref()),
            _ => return Err(invalid("Unsupported OAuth cloud provider")),
        };
        let config = config.ok_or_else(|| invalid("Missing cloud provider configuration"))?;
        path_parts(config)?;
        options.validate()?;
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(300));
        #[cfg(test)]
        let client = if FIXTURE_ORIGIN.try_with(|_| ()).is_ok() {
            client.https_only(false).no_proxy()
        } else {
            client
        };
        let client = client.build().map_err(|_| transport())?;
        let session = Self {
            client,
            config,
            google,
            token: std::sync::Mutex::new(field(config, "accessToken").unwrap_or("").into()),
            options,
            cache_key: cache_key(&target.id, google, config),
            #[cfg(test)]
            fixture_origin: FIXTURE_ORIGIN.try_with(Clone::clone).ok(),
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| transport())?
            .as_millis() as u64;
        let expired = config
            .get("tokenExpiry")
            .and_then(Value::as_u64)
            .is_some_and(|expiry| expiry <= now.saturating_add(30_000));
        let has_cached = {
            let cache = tokens().lock().await;
            if let Some(cached) = cache.get(&session.cache_key) {
                if cached.expires > tokio::time::Instant::now() {
                    session.set_token(cached.access.clone());
                    return Ok(session);
                }
                true
            } else {
                false
            }
        };
        if has_cached || session.token().is_empty() || expired {
            session.refresh().await?;
        }
        Ok(session)
    }
    fn token(&self) -> String {
        self.token.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    fn set_token(&self, token: String) {
        *self.token.lock().unwrap_or_else(|e| e.into_inner()) = token;
    }
    async fn refresh(&self) -> Result<(), SyncError> {
        self.refresh_after(None).await
    }
    async fn refresh_after(&self, rejected: Option<&str>) -> Result<(), SyncError> {
        // Serialize refresh transactions so two callers don't consume the same
        // rotating token. All HTTP/outer operation waits are bounded.
        let mut cache = tokens().lock().await;
        if let Some(cached) = cache.get(&self.cache_key) {
            if cached.expires > tokio::time::Instant::now()
                && rejected != Some(cached.access.as_str())
            {
                self.set_token(cached.access.clone());
                return Ok(());
            }
        }
        let refresh = cache
            .get(&self.cache_key)
            .map(|c| c.refresh.clone())
            .or_else(|| field(self.config, "refreshToken").map(str::to_owned))
            .ok_or_else(auth)?;
        let client_id = field(self.config, "clientId").ok_or_else(auth)?;
        let endpoint = if self.google {
            "https://oauth2.googleapis.com/token".to_owned()
        } else {
            let tenant = identifier(field(self.config, "tenantId").unwrap_or("common"))?;
            format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token")
        };
        let mut form = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id),
        ];
        if let Some(secret) = field(self.config, "clientSecret") {
            form.push(("client_secret", secret));
        }
        let response = self
            .execute(
                self.client
                    .post(endpoint)
                    .form(&form)
                    .build()
                    .map_err(|_| auth())?,
            )
            .await
            .map_err(|_| auth())?;
        if !response.status().is_success() {
            return Err(auth());
        }
        let value = json_body(response).await?;
        self.set_token(field(&value, "access_token").ok_or_else(auth)?.to_owned());
        let refresh = field(&value, "refresh_token")
            .unwrap_or(&refresh)
            .to_owned();
        let lifetime = value
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(300)
            .min(3600)
            .saturating_sub(30);
        if cache.len() >= 64 && !cache.contains_key(&self.cache_key) {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, v)| v.expires)
                .map(|(k, _)| k.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            self.cache_key.clone(),
            CachedToken {
                access: self.token(),
                refresh,
                expires: tokio::time::Instant::now() + Duration::from_secs(lifetime),
            },
        );
        Ok(())
    }
    fn request(&self, method: Method, url: &str) -> RequestBuilder {
        self.client.request(method, url).bearer_auth(self.token())
    }
    async fn send(&self, request: RequestBuilder) -> Result<Response, SyncError> {
        let request = request.build().map_err(|_| transport())?;
        // Only replay authenticated provider reads, once, after a definitive
        // 401. Never replay uploads, creates, deletes, or capability downloads.
        let provider_host = if self.google {
            "www.googleapis.com"
        } else {
            "graph.microsoft.com"
        };
        let retry = if request.method() == Method::GET
            && request.url().scheme() == "https"
            && request.url().host_str() == Some(provider_host)
            && request.headers().contains_key(header::AUTHORIZATION)
        {
            request.try_clone()
        } else {
            None
        };
        let response = self.execute(request).await?;
        if response.status() != StatusCode::UNAUTHORIZED {
            return Ok(response);
        }
        let Some(mut retry) = retry else {
            return Ok(response);
        };
        let rejected = retry
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(auth)?
            .to_owned();
        drop(response);
        self.refresh_after(Some(&rejected)).await?;
        let mut value = header::HeaderValue::from_str(&format!("Bearer {}", self.token()))
            .map_err(|_| auth())?;
        value.set_sensitive(true);
        retry.headers_mut().insert(header::AUTHORIZATION, value);
        self.execute(retry).await
    }
    async fn execute(&self, request: reqwest::Request) -> Result<Response, SyncError> {
        #[cfg(test)]
        let request = {
            let mut request = request;
            if let Some(origin) = &self.fixture_origin {
                let url = request.url_mut();
                url.set_scheme(origin.scheme()).map_err(|_| transport())?;
                url.set_host(origin.host_str()).map_err(|_| transport())?;
                url.set_port(origin.port()).map_err(|_| transport())?;
            }
            request
        };
        self.client.execute(request).await.map_err(|_| transport())
    }
    fn drive(&self) -> Result<String, SyncError> {
        Ok(match field(self.config, "driveId") {
            Some(id) => format!("{GRAPH}/drives/{}", segment(identifier(id)?)),
            None => format!("{GRAPH}/me/drive"),
        })
    }
    async fn google_lookup(&self, parent: &str, name: &str) -> Result<Option<Value>, SyncError> {
        let escape = |s: &str| s.replace('\\', "\\\\").replace('\'', "\\'");
        let query = format!(
            "'{}' in parents and title = '{}' and trashed = false",
            escape(parent),
            escape(name)
        );
        let mut page = String::new();
        let mut found = None;
        for _ in 0..MAX_PAGES {
            let mut request = self
                .request(Method::GET, &format!("{GOOGLE}/files"))
                .query(&[
                    ("q", query.as_str()),
                    (
                        "fields",
                        "nextPageToken,incompleteSearch,items(id,title,mimeType,parents)",
                    ),
                    ("maxResults", "100"),
                    ("supportsAllDrives", "true"),
                    ("includeItemsFromAllDrives", "true"),
                ]);
            if !page.is_empty() {
                request = request.query(&[("pageToken", &page)]);
            }
            let value = json_body(self.send(request).await?).await?;
            if value.get("incompleteSearch").and_then(Value::as_bool) == Some(true) {
                return Err(transport());
            }
            let files = value
                .get("items")
                .and_then(Value::as_array)
                .ok_or_else(transport)?;
            for file in files {
                if field(file, "title") != Some(name)
                    || !file
                        .get("parents")
                        .and_then(Value::as_array)
                        .is_some_and(|ps| ps.iter().any(|p| field(p, "id") == Some(parent)))
                {
                    return Err(transport());
                }
                if found.is_some() {
                    return Err(SyncError::Conflict(
                        "Multiple cloud files or folders have the configured name".into(),
                    ));
                }
                found = Some(file.clone());
            }
            match field(&value, "nextPageToken") {
                None => return Ok(found),
                Some(next) if next != page => page = next.to_owned(),
                _ => return Err(transport()),
            }
        }
        Err(invalid("Cloud folder lookup exceeded pagination limit"))
    }
    async fn folder(&self) -> Result<String, SyncError> {
        if self.google {
            // Explicit folderId selects the destination itself, not another root
            // below which folderPath is appended a second time.
            if let Some(id) = field(self.config, "folderId") {
                identifier(id)?;
                let value = json_body(
                    self.send(
                        self.request(Method::GET, &format!("{GOOGLE}/files/{}", segment(id)))
                            .query(&[
                                ("fields", "id,mimeType,labels/trashed"),
                                ("supportsAllDrives", "true"),
                            ]),
                    )
                    .await?,
                )
                .await?;
                if field(&value, "mimeType") != Some("application/vnd.google-apps.folder")
                    || value.pointer("/labels/trashed").and_then(Value::as_bool) == Some(true)
                {
                    return Err(invalid("Configured cloud destination is not a folder"));
                }
                return Ok(identifier(required(&value, "id")?)?.into());
            }
            // Resolve root to its actual ID so returned parent IDs are comparable.
            let root = json_body(
                self.send(
                    self.request(Method::GET, &format!("{GOOGLE}/files/root"))
                        .query(&[("fields", "id")]),
                )
                .await?,
            )
            .await?;
            let mut parent = identifier(required(&root, "id")?)?.to_owned();
            for part in path_parts(self.config)? {
                let mut item = self.google_lookup(&parent, part).await?;
                if item.is_none() {
                    let response = self.send(self.request(Method::POST, &format!("{GOOGLE}/files?supportsAllDrives=true")).json(&json!({"title":part,"parents":[{"id":parent}],"mimeType":"application/vnd.google-apps.folder"}))).await?;
                    let created_id = if response.status() == StatusCode::CONFLICT {
                        None
                    } else {
                        Some(required(&json_body(response).await?, "id")?.to_owned())
                    };
                    // One create attempt per segment; a raced duplicate is an
                    // error, never a license to choose or remove someone else's.
                    item = self.google_lookup(&parent, part).await?;
                    if let (Some(created), Some(found)) = (&created_id, &item) {
                        if field(found, "id") != Some(created) {
                            return Err(conflict());
                        }
                    }
                }
                let item =
                    item.ok_or_else(|| invalid("Configured cloud folder could not be created"))?;
                if field(&item, "mimeType") != Some("application/vnd.google-apps.folder") {
                    return Err(invalid("Configured cloud path is not a folder"));
                }
                parent = identifier(required(&item, "id")?)?.to_owned();
            }
            Ok(parent)
        } else {
            let url = format!("{}/root", self.drive()?);
            let value = json_body(self.send(self.request(Method::GET, &url)).await?).await?;
            if value.get("folder").is_none() || value.get("remoteItem").is_some() {
                return Err(invalid(
                    "Configured cloud destination is not a local folder",
                ));
            }
            let mut parent = identifier(required(&value, "id")?)?.to_owned();
            for part in path_parts(self.config)? {
                let url = format!(
                    "{}/items/{}:/{}",
                    self.drive()?,
                    segment(&parent),
                    segment(part)
                );
                let mut response = self.send(self.request(Method::GET, &url)).await?;
                let mut created_id = None;
                if response.status() == StatusCode::NOT_FOUND {
                    let create = self.send(self.request(Method::POST,&format!("{}/items/{}/children",self.drive()?,segment(&parent))).json(&json!({"name":part,"folder":{},"@microsoft.graph.conflictBehavior":"fail"}))).await?;
                    if create.status() != StatusCode::CONFLICT {
                        created_id = Some(required(&json_body(create).await?, "id")?.to_owned());
                    }
                    response = self.send(self.request(Method::GET, &url)).await?;
                }
                let found = json_body(response).await?;
                if field(&found, "name") != Some(part)
                    || found.pointer("/parentReference/id").and_then(Value::as_str)
                        != Some(parent.as_str())
                    || found.get("folder").is_none()
                    || found.get("remoteItem").is_some()
                {
                    return Err(invalid("Cloud path segment is not the configured folder"));
                }
                let id = identifier(required(&found, "id")?)?;
                if created_id.as_deref().is_some_and(|created| created != id) {
                    return Err(conflict());
                }
                parent = id.to_owned();
            }
            Ok(parent)
        }
    }
    async fn metadata(
        &self,
        id: &str,
        destination: Option<(&str, &str)>,
    ) -> Result<Item, SyncError> {
        identifier(id)?;
        let url = if self.google {
            format!(
                "{GOOGLE}/files/{}?fields=id,title,parents,mimeType,labels/trashed,etag&supportsAllDrives=true",
                segment(id)
            )
        } else {
            format!("{}/items/{}", self.drive()?, segment(id))
        };
        let response = check_status(self.send(self.request(Method::GET, &url)).await?)?;
        let value = json_body(response).await?;
        if let Some((parent, name)) = destination {
            if field(&value, "title") != Some(name)
                || !value
                    .get("parents")
                    .and_then(Value::as_array)
                    .is_some_and(|ps| ps.iter().any(|p| field(p, "id") == Some(parent)))
            {
                return Err(conflict());
            }
        }
        if required(&value, "id")? != id
            || value.pointer("/labels/trashed").and_then(Value::as_bool) == Some(true)
            || value.get("remoteItem").is_some()
            || (!self.google && value.get("file").is_none())
            || (self.google
                && field(&value, "mimeType")
                    .is_some_and(|s| s.starts_with("application/vnd.google-apps.")))
        {
            return Err(invalid("Cloud object is not a regular blob"));
        }
        let tag = if self.google {
            field(&value, "etag")
        } else {
            field(&value, "eTag")
        }
        .ok_or_else(|| invalid("Provider did not supply a revision tag"))?;
        Ok(Item {
            id: id.to_owned(),
            etag: etag(tag)?,
        })
    }
    async fn lookup(&self, folder: &str, name: &str) -> Result<Option<Item>, SyncError> {
        if self.google {
            match self.google_lookup(folder, name).await? {
                Some(value) => Ok(Some(
                    self.metadata(required(&value, "id")?, Some((folder, name)))
                        .await?,
                )),
                None => Ok(None),
            }
        } else {
            let url = format!(
                "{}/items/{}:/{}",
                self.drive()?,
                segment(folder),
                segment(name)
            );
            let response = self.send(self.request(Method::GET, &url)).await?;
            if response.status() == StatusCode::NOT_FOUND {
                return Ok(None);
            }
            let value = json_body(response).await?;
            if field(&value, "name") != Some(name)
                || value.pointer("/parentReference/id").and_then(Value::as_str) != Some(folder)
                || value.get("remoteItem").is_some()
                || value.get("file").is_none()
            {
                return Err(invalid("Unexpected cloud file destination"));
            }
            Ok(Some(Item {
                id: identifier(required(&value, "id")?)?.into(),
                etag: etag(required(&value, "eTag")?)?,
            }))
        }
    }
    async fn download(&self, item: &Item) -> Result<Vec<u8>, SyncError> {
        let url = if self.google {
            format!(
                "{GOOGLE}/files/{}?alt=media&supportsAllDrives=true",
                segment(&item.id)
            )
        } else {
            format!("{}/items/{}/content", self.drive()?, segment(&item.id))
        };
        let mut response = self
            .send(
                self.request(Method::GET, &url)
                    .header(header::IF_MATCH, &item.etag),
            )
            .await?;
        if !self.google {
            for _ in 0..5 {
                if !response.status().is_redirection() {
                    break;
                }
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(transport)?;
                let url = download_url(location)?;
                response = self.send(self.client.get(url)).await?;
            }
        }
        let data = body(
            check_status(response)?,
            self.options.max_bytes,
            self.options.download_limit_kbs,
        )
        .await?;
        // A download capability may not honor If-Match: recheck metadata before
        // associating any downloaded bytes with the revision returned to callers.
        if self.metadata(&item.id, None).await?.revision() != item.revision() {
            return Err(conflict());
        }
        Ok(data)
    }
    async fn put(
        &self,
        folder: &str,
        name: &str,
        data: &[u8],
        previous: Option<&Item>,
    ) -> Result<Item, SyncError> {
        if data.len() > self.options.max_bytes || data.len() > 250 * 1024 * 1024 {
            return Err(invalid("Cloud upload exceeds size limit"));
        }
        let (request, payload) = if self.google {
            if let Some(item) = previous {
                (self.request(Method::PUT, &format!("https://www.googleapis.com/upload/drive/v2/files/{}?uploadType=media&supportsAllDrives=true", segment(&item.id))).header(header::IF_MATCH, &item.etag).header(header::CONTENT_TYPE, "application/octet-stream"), data.to_vec())
            } else {
                let boundary = format!("sorng-{}", uuid::Uuid::new_v4());
                let metadata = json!({"title": name, "parents": [{"id":folder}], "mimeType": "application/octet-stream"});
                let mut payload = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
                payload.extend_from_slice(data);
                payload.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
                (self.request(Method::POST, "https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&supportsAllDrives=true").header(header::CONTENT_TYPE, format!("multipart/related; boundary={boundary}")), payload)
            }
        } else {
            let url = match previous {
                Some(item) => format!("{}/items/{}/content", self.drive()?, segment(&item.id)),
                None => format!(
                    "{}/items/{}:/{}:/content?@microsoft.graph.conflictBehavior=fail",
                    self.drive()?,
                    segment(folder),
                    segment(name)
                ),
            };
            let mut request = self
                .request(Method::PUT, &url)
                .header(header::CONTENT_TYPE, "application/octet-stream");
            request = match previous {
                Some(item) => request.header(header::IF_MATCH, &item.etag),
                None => request.header(header::IF_NONE_MATCH, "*"),
            };
            (request, data.to_vec())
        };
        let response = self
            .send(
                request
                    .header(header::CONTENT_LENGTH, payload.len())
                    .body(upload_body(payload, self.options.upload_limit_kbs)),
            )
            .await?;
        let value = json_body(response).await?;
        let id = identifier(required(&value, "id")?)?;
        if previous.is_some_and(|p| p.id != id) {
            return Err(conflict());
        }
        // Never obtain a *later* revision using an extra GET after uploading:
        // that could accidentally authorize overwriting another client's write.
        let tag = if self.google {
            field(&value, "etag")
        } else {
            field(&value, "eTag")
        }
        .ok_or_else(|| invalid("Upload response has no revision tag; read before retrying"))?;
        let item = Item {
            id: id.into(),
            etag: etag(tag)?,
        };
        Ok(item)
    }
    async fn delete_probe(&self, item: &Item) -> Result<(), SyncError> {
        let url = if self.google {
            format!(
                "{GOOGLE}/files/{}?supportsAllDrives=true",
                segment(&item.id)
            )
        } else {
            format!("{}/items/{}", self.drive()?, segment(&item.id))
        };
        check_status(
            self.send(
                self.request(Method::DELETE, &url)
                    .header(header::IF_MATCH, &item.etag),
            )
            .await?,
        )?;
        Ok(())
    }
    async fn probe(&self, folder: &str, name: &str, payload: &[u8]) -> Result<(), SyncError> {
        if self.lookup(folder, name).await?.is_some() {
            return Err(conflict());
        }
        let item = self.put(folder, name, payload, None).await?;
        let verify = match self.download(&item).await {
            Ok(bytes) if bytes == payload => Ok(()),
            Ok(_) => Err(transport()),
            Err(error) => Err(error),
        };
        // Never delete by name/path, or delete a competing/changed object.
        let cleanup = self.delete_probe(&item).await;
        verify?;
        cleanup
    }
}

pub async fn read(target: &Target, options: &TransportOptions) -> Result<Blob, SyncError> {
    tokio::time::timeout(Duration::from_secs(600), async {
        let session = Session::new(target, options).await?;
        let folder = session.folder().await?;
        match session.lookup(&folder, FILE).await? {
            None => Ok(Blob {
                data: None,
                revision: None,
            }),
            Some(item) => {
                let data = session.download(&item).await?;
                if session
                    .lookup(&folder, FILE)
                    .await?
                    .ok_or_else(conflict)?
                    .revision()
                    != item.revision()
                {
                    return Err(conflict());
                }
                Ok(Blob {
                    data: Some(STANDARD.encode(data)),
                    revision: Some(item.revision()),
                })
            }
        }
    })
    .await
    .map_err(|_| transport())?
}
pub async fn write(
    target: &Target,
    data: &[u8],
    expected_revision: Option<&str>,
    options: &TransportOptions,
) -> Result<Written, SyncError> {
    tokio::time::timeout(Duration::from_secs(600), async {
        if data.len() > options.max_bytes {
            return Err(invalid("Cloud upload exceeds size limit"));
        }
        let session = Session::new(target, options).await?;
        let folder = session.folder().await?;
        let item = session.lookup(&folder, FILE).await?;
        expected(item.as_ref(), expected_revision)?;
        let written = session.put(&folder, FILE, data, item.as_ref()).await?;
        if session.download(&written).await? != data {
            return Err(SyncError::Transport(
                "Cloud upload verification failed".into(),
            ));
        }
        // Google allows duplicate names, including a race between first-time
        // writers. Never select one arbitrarily or overwrite/delete a rival.
        let current = session.lookup(&folder, FILE).await?.ok_or_else(conflict)?;
        if current.revision() != written.revision() {
            return Err(conflict());
        }
        Ok(Written {
            revision: written.revision(),
        })
    })
    .await
    .map_err(|_| transport())?
}
pub async fn test(target: &Target, options: &TransportOptions) -> Result<(), SyncError> {
    tokio::time::timeout(Duration::from_secs(600), async {
        let session = Session::new(target, options).await?;
        let folder = session.folder().await?;
        let name = format!(".sorng-probe-{}", uuid::Uuid::new_v4());
        let payload = uuid::Uuid::new_v4().to_string();
        session.probe(&folder, &name, payload.as_bytes()).await
    })
    .await
    .map_err(|_| transport())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct Reply {
        status: u16,
        headers: &'static str,
        data: Vec<u8>,
    }
    fn reply(status: u16, value: Value) -> Reply {
        Reply {
            status,
            headers: "",
            data: value.to_string().into_bytes(),
        }
    }
    async fn fixture(replies: Vec<Reply>) -> (Url, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let task = tokio::spawn(async move {
            tokio::time::timeout(Duration::from_secs(10), async move {
                let mut requests = Vec::new();
                let mut uploaded = Vec::new();
                for mut reply in replies {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut bytes = Vec::new();
                    let mut byte = [0u8; 1];
                    while !bytes.ends_with(b"\r\n\r\n") {
                        socket.read_exact(&mut byte).await.unwrap();
                        bytes.push(byte[0]);
                        assert!(bytes.len() < 64 * 1024);
                    }
                    let headers = String::from_utf8(bytes.clone()).unwrap();
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|s| s.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    let mut payload = vec![0; length];
                    socket.read_exact(&mut payload).await.unwrap();
                    if headers.starts_with("PUT ") {
                        uploaded.clone_from(&payload);
                    }
                    if reply.data == b"__uploaded_bytes__" {
                        reply.data.clone_from(&uploaded);
                    }
                    bytes.extend(payload);
                    requests.push(String::from_utf8_lossy(&bytes).into_owned());
                    let length_header = if reply.headers.contains("Transfer-Encoding:") {
                        String::new()
                    } else {
                        format!("Content-Length: {}\r\n", reply.data.len())
                    };
                    let head = format!(
                        "HTTP/1.1 {} Test\r\n{}Connection: close\r\n{}\r\n",
                        reply.status, length_header, reply.headers
                    );
                    socket.write_all(head.as_bytes()).await.unwrap();
                    socket.write_all(&reply.data).await.unwrap();
                }
                requests
            })
            .await
            .expect("fixture must not hang")
        });
        (origin, task)
    }
    fn options() -> TransportOptions {
        TransportOptions {
            max_bytes: 4096,
            upload_limit_kbs: 0,
            download_limit_kbs: 0,
        }
    }
    fn session<'a>(
        google: bool,
        config: &'a Value,
        options: &'a TransportOptions,
        origin: Url,
    ) -> Session<'a> {
        Session {
            client: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap(),
            config,
            google,
            token: std::sync::Mutex::new("fixture-token".into()),
            options,
            cache_key: cache_key(origin.as_str(), google, config),
            fixture_origin: Some(origin),
        }
    }
    fn google_file(id: &str) -> Value {
        json!({"id":id,"title":FILE,"parents":[{"id":"folder"}],"mimeType":"application/octet-stream","etag":"\"v1\""})
    }
    fn microsoft_file(id: &str, tag: &str) -> Value {
        json!({"id":id,"name":FILE,"file":{},"parentReference":{"id":"folder"},"eTag":tag})
    }
    fn target(google: bool, config: Value) -> Target {
        serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"provider":if google {"googleDrive"} else {"oneDrive"},"googleDrive":if google {config.clone()} else {Value::Null},"oneDrive":if google {Value::Null} else {config}})).unwrap()
    }
    #[tokio::test]
    async fn public_read_refreshes_unknown_expiry_token_once_on_401() {
        for google in [true, false] {
            for accepted in [true, false] {
                let mut replies = vec![
                    reply(401, json!({"error":"rejected"})),
                    reply(200, json!({"access_token":"fresh-token","expires_in":3600})),
                ];
                if accepted {
                    replies.push(reply(
                        200,
                        if google {
                            json!({"id":"folder","mimeType":"application/vnd.google-apps.folder"})
                        } else {
                            json!({"id":"folder","folder":{}})
                        },
                    ));
                    replies.push(if google {
                        reply(200, json!({"items":[]}))
                    } else {
                        reply(404, json!({}))
                    });
                } else {
                    replies.push(reply(401, json!({})));
                }
                let (origin, task) = fixture(replies).await;
                let target = target(
                    google,
                    json!({"accessToken":"initial-token","refreshToken":"refresh","clientId":"client","folderId":"folder","folderPath":"/"}),
                );
                let result = FIXTURE_ORIGIN
                    .scope(origin, read(&target, &options()))
                    .await;
                assert_eq!(result.is_ok(), accepted);
                if !accepted {
                    assert!(matches!(result, Err(SyncError::Authentication(_))));
                }
                let requests = task.await.unwrap();
                assert!(requests[0].contains("authorization: Bearer initial-token"));
                assert!(requests[2].contains("authorization: Bearer fresh-token"));
                assert_eq!(
                    requests.iter().filter(|r| r.starts_with("POST ")).count(),
                    1
                );
            }
        }
    }
    #[tokio::test]
    async fn rejected_cached_access_token_is_not_reused_on_401() {
        let (origin, task) = fixture(vec![
            reply(
                200,
                json!({"access_token":"stale-cached","refresh_token":"rotated","expires_in":3600}),
            ),
            reply(401, json!({})),
            reply(200, json!({"access_token":"fresh","expires_in":3600})),
            reply(200, json!({"items":[]})),
        ])
        .await;
        let config = json!({"clientId":"client","refreshToken":"original"});
        let options = options();
        let session = session(true, &config, &options, origin);
        session.refresh().await.unwrap();
        assert!(session
            .google_lookup("folder", FILE)
            .await
            .unwrap()
            .is_none());
        let requests = task.await.unwrap();
        assert!(requests[1].contains("authorization: Bearer stale-cached"));
        assert!(requests[2].contains("refresh_token=rotated"));
        assert!(requests[3].contains("authorization: Bearer fresh"));
        assert_eq!(session.token(), "fresh");
    }
    #[tokio::test]
    async fn unauthorized_writes_and_capability_downloads_are_not_replayed() {
        for google in [true, false] {
            let (origin, task) = fixture(vec![reply(401, json!({}))]).await;
            let config = json!({"clientId":"client","refreshToken":"refresh"});
            let options = options();
            let session = session(google, &config, &options, origin);
            assert!(matches!(
                session.put("folder", FILE, b"blob", None).await,
                Err(SyncError::Authentication(_))
            ));
            assert_eq!(task.await.unwrap().len(), 1);
        }
        let (origin, task) = fixture(vec![
            Reply {
                status: 302,
                headers: "Location: https://tenant.sharepoint.com/capability\r\n",
                data: vec![],
            },
            reply(401, json!({})),
        ])
        .await;
        let config = json!({"clientId":"client","refreshToken":"refresh"});
        let options = options();
        let item = Item {
            id: "file".into(),
            etag: "\"tag\"".into(),
        };
        assert!(matches!(
            session(false, &config, &options, origin)
                .download(&item)
                .await,
            Err(SyncError::Authentication(_))
        ));
        assert_eq!(task.await.unwrap().len(), 2);
    }
    #[tokio::test]
    async fn public_test_uses_unique_probe_reads_back_and_deletes_only_probe() {
        let file = microsoft_file("probe-created", "\"probe-tag\"");
        let (origin, task) = fixture(vec![
            reply(200, json!({"id":"folder","folder":{}})),
            reply(404, json!({})),
            reply(201, file.clone()),
            Reply {
                status: 200,
                headers: "",
                data: b"__uploaded_bytes__".to_vec(),
            },
            reply(200, file),
            Reply {
                status: 204,
                headers: "",
                data: vec![],
            },
        ])
        .await;
        let target = target(
            false,
            json!({"accessToken":"fixture-token","folderPath":"/"}),
        );
        FIXTURE_ORIGIN
            .scope(origin, super::test(&target, &options()))
            .await
            .unwrap();
        let requests = task.await.unwrap();
        assert!(requests[1].contains(".sorng-probe-"));
        assert!(requests[2].contains(".sorng-probe-"));
        assert!(requests[5].starts_with("DELETE /v1.0/me/drive/items/probe-created "));
        assert!(requests[5].contains("if-match: \"probe-tag\""));
        assert!(requests.iter().all(|r| !r.contains(FILE)));
    }
    #[tokio::test]
    async fn body_limit_is_enforced_without_content_length() {
        let (origin, task) = fixture(vec![Reply {
            status: 200,
            headers: "Transfer-Encoding: chunked\r\n",
            data: b"4\r\nfour\r\n0\r\n\r\n".to_vec(),
        }])
        .await;
        let response = Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(origin)
            .send()
            .await
            .unwrap();
        assert!(response.content_length().is_none());
        assert!(matches!(
            body(response, 3, 0).await,
            Err(SyncError::Invalid(_))
        ));
        task.await.unwrap();
    }
    #[tokio::test]
    async fn microsoft_untrusted_redirect_is_not_followed() {
        let (origin, task) = fixture(vec![Reply {
            status: 302,
            headers: "Location: https://evil.example/steal\r\n",
            data: vec![],
        }])
        .await;
        let config = json!({});
        let options = options();
        let item = Item {
            id: "file".into(),
            etag: "\"v1\"".into(),
        };
        assert!(matches!(
            session(false, &config, &options, origin)
                .download(&item)
                .await,
            Err(SyncError::Trust(_))
        ));
        assert_eq!(task.await.unwrap().len(), 1);
    }
    #[tokio::test]
    async fn upload_throttle_applies_before_yielding_bytes() {
        use futures_util::StreamExt;
        let start = tokio::time::Instant::now();
        let stream = upload_stream(vec![0; 32], 1);
        futures_util::pin_mut!(stream);
        assert_eq!(stream.next().await.unwrap().unwrap().len(), 32);
        assert!(start.elapsed() >= Duration::from_millis(30));
    }
    #[tokio::test]
    async fn public_write_verifies_uploaded_bytes_for_both_providers() {
        for google in [true, false] {
            for valid_bytes in [true, false] {
                let file = if google {
                    google_file("created")
                } else {
                    microsoft_file("created", "\"v1\"")
                };
                let folder = if google {
                    json!({"id":"folder","mimeType":"application/vnd.google-apps.folder"})
                } else {
                    json!({"id":"folder","folder":{}})
                };
                let absent = if google {
                    reply(200, json!({"items":[]}))
                } else {
                    reply(404, json!({}))
                };
                let mut replies = vec![
                    reply(200, folder),
                    absent,
                    reply(201, file.clone()),
                    Reply {
                        status: 200,
                        headers: "",
                        data: if valid_bytes {
                            b"correct".to_vec()
                        } else {
                            b"corrupt".to_vec()
                        },
                    },
                    reply(200, file.clone()),
                ];
                if valid_bytes {
                    if google {
                        replies.push(reply(200, json!({"items":[file.clone()]})));
                    }
                    replies.push(reply(200, file));
                }
                let (origin, task) = fixture(replies).await;
                let target = target(
                    google,
                    json!({"accessToken":"fixture-token","folderId":"folder","folderPath":"/"}),
                );
                let result = FIXTURE_ORIGIN
                    .scope(origin, write(&target, b"correct", None, &options()))
                    .await;
                assert_eq!(result.is_ok(), valid_bytes);
                if !valid_bytes {
                    assert!(matches!(result, Err(SyncError::Transport(_))));
                }
                let requests = task.await.unwrap();
                assert!(requests[3].contains(if google { "alt=media" } else { "/content" }));
                assert!(requests[3].contains("if-match: \"v1\""));
            }
        }
    }
    #[tokio::test]
    async fn public_write_rejects_revision_changed_after_verification() {
        let file = microsoft_file("created", "\"v1\"");
        let (origin, task) = fixture(vec![
            reply(200, json!({"id":"folder","folder":{}})),
            reply(404, json!({})),
            reply(201, file.clone()),
            Reply {
                status: 200,
                headers: "",
                data: b"blob".to_vec(),
            },
            reply(200, file),
            reply(200, microsoft_file("created", "\"v2\"")),
        ])
        .await;
        let target = target(
            false,
            json!({"accessToken":"fixture-token","folderPath":"/"}),
        );
        assert!(matches!(
            FIXTURE_ORIGIN
                .scope(origin, write(&target, b"blob", None, &options()))
                .await,
            Err(SyncError::Conflict(_))
        ));
        task.await.unwrap();
    }
    #[tokio::test]
    async fn public_google_first_upload_reports_competing_duplicate_without_replace_or_delete() {
        let file = google_file("created");
        let (origin, task) = fixture(vec![
            reply(
                200,
                json!({"id":"folder","mimeType":"application/vnd.google-apps.folder"}),
            ),
            reply(200, json!({"items":[]})),
            reply(201, file.clone()),
            Reply {
                status: 200,
                headers: "",
                data: b"blob".to_vec(),
            },
            reply(200, file.clone()),
            reply(200, json!({"items":[file,google_file("rival")]})),
        ])
        .await;
        let target = target(
            true,
            json!({"accessToken":"fixture-token","folderId":"folder","folderPath":"/"}),
        );
        assert!(matches!(
            FIXTURE_ORIGIN
                .scope(origin, write(&target, b"blob", None, &options()))
                .await,
            Err(SyncError::Conflict(_))
        ));
        let requests = task.await.unwrap();
        assert_eq!(
            requests.iter().filter(|r| r.starts_with("POST ")).count(),
            1
        );
        assert!(requests.iter().all(|r| !r.starts_with("PUT ")
            && !r.starts_with("DELETE ")
            && !r.starts_with("PATCH ")));
    }
    #[tokio::test]
    async fn public_read_keeps_missing_blob_distinct_from_failure() {
        for google in [true, false] {
            let folder = if google {
                json!({"id":"folder","mimeType":"application/vnd.google-apps.folder"})
            } else {
                json!({"id":"folder","folder":{}})
            };
            let absent = if google {
                reply(200, json!({"items":[]}))
            } else {
                reply(404, json!({}))
            };
            let (origin, task) = fixture(vec![reply(200, folder), absent]).await;
            let target = target(
                google,
                json!({"accessToken":"fixture-token","folderId":"folder","folderPath":"/"}),
            );
            let result = FIXTURE_ORIGIN
                .scope(origin, read(&target, &options()))
                .await
                .unwrap();
            assert!(result.data.is_none() && result.revision.is_none());
            task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn google_nested_folder_creation_is_single_attempt_parent_scoped() {
        let top = json!({"id":"top","title":"sortOfRemoteNG","parents":[{"id":"root-id"}],"mimeType":"application/vnd.google-apps.folder"});
        let nested = json!({"id":"nested","title":"nested","parents":[{"id":"top"}],"mimeType":"application/vnd.google-apps.folder"});
        let (origin, task) = fixture(vec![
            reply(200, json!({"id":"root-id"})),
            reply(200, json!({"items":[]})),
            reply(200, top.clone()),
            reply(200, json!({"items":[top]})),
            reply(200, json!({"items":[]})),
            reply(200, nested.clone()),
            reply(200, json!({"items":[nested]})),
        ])
        .await;
        let config = json!({"folderPath":"/sortOfRemoteNG/nested"});
        let options = options();
        assert_eq!(
            session(true, &config, &options, origin)
                .folder()
                .await
                .unwrap(),
            "nested"
        );
        let requests = task.await.unwrap();
        assert!(requests[2].contains("\"parents\":[{\"id\":\"root-id\"}]"));
        assert!(requests[5].contains("\"parents\":[{\"id\":\"top\"}]"));
        assert_eq!(
            requests.iter().filter(|r| r.starts_with("POST ")).count(),
            2
        );
    }
    #[tokio::test]
    async fn folder_creation_conflict_requires_exact_folder_parent_and_type() {
        for google in [true, false] {
            for correct in [true, false] {
                let root = if google {
                    json!({"id":"root-id"})
                } else {
                    json!({"id":"root-id","folder":{}})
                };
                let found = if google {
                    json!({"items":[{"id":"folder","title":"nested","parents":[{"id":"root-id"}],"mimeType":if correct {"application/vnd.google-apps.folder"} else {"application/octet-stream"}}]})
                } else {
                    json!({"id":"folder","name":"nested","parentReference":{"id":if correct {"root-id"} else {"wrong-parent"}},"folder":{}})
                };
                let absent = if google {
                    reply(200, json!({"items":[]}))
                } else {
                    reply(404, json!({}))
                };
                let (origin, task) = fixture(vec![
                    reply(200, root),
                    absent,
                    reply(409, json!({})),
                    reply(200, found),
                ])
                .await;
                let config = json!({"folderPath":"/nested"});
                let options = options();
                assert_eq!(
                    session(google, &config, &options, origin)
                        .folder()
                        .await
                        .is_ok(),
                    correct
                );
                assert_eq!(
                    task.await
                        .unwrap()
                        .iter()
                        .filter(|r| r.starts_with("POST "))
                        .count(),
                    1
                );
            }
        }
    }
    #[tokio::test]
    async fn refreshed_rotating_token_is_reused_by_later_calls_and_edits_invalidate() {
        let config = json!({"clientId":"client","refreshToken":"original","tenantId":"common"});
        let options = options();
        let (origin, task) = fixture(vec![
            reply(
                200,
                json!({"access_token":"first","refresh_token":"rotated","expires_in":0}),
            ),
            reply(200, json!({"access_token":"second","expires_in":3600})),
        ])
        .await;
        let first = session(false, &config, &options, origin.clone());
        first.refresh().await.unwrap();
        let second = session(false, &config, &options, origin.clone());
        second.refresh().await.unwrap();
        let third = session(false, &config, &options, origin);
        third.refresh().await.unwrap();
        assert_eq!(third.token(), "second");
        let requests = task.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].contains("refresh_token=original"));
        assert!(requests[1].contains("refresh_token=rotated"));
        assert_ne!(
            cache_key("id", false, &config),
            cache_key(
                "id",
                false,
                &json!({"clientId":"other","refreshToken":"original","tenantId":"common"})
            )
        );
    }

    #[tokio::test]
    async fn google_pagination_rejects_duplicates_across_pages() {
        let (origin, task) = fixture(vec![
            reply(
                200,
                json!({"items":[google_file("first")],"nextPageToken":"page2"}),
            ),
            reply(200, json!({"items":[google_file("second")]})),
        ])
        .await;
        let config = json!({});
        let options = options();
        let session = session(true, &config, &options, origin);
        assert!(matches!(
            session.google_lookup("folder", FILE).await,
            Err(SyncError::Conflict(_))
        ));
        let requests = task.await.unwrap();
        assert!(requests[1].contains("pageToken=page2"));
        assert!(requests[0].contains("folder"));
        assert!(requests[0].contains("trashed"));
    }
    #[tokio::test]
    async fn google_lookup_rejects_wrong_parent_and_incomplete_results() {
        for value in [
            json!({"items":[{"title":FILE,"id":"wrong","parents":[{"id":"other"}]}]}),
            json!({"items":[],"incompleteSearch":true}),
        ] {
            let (origin, task) = fixture(vec![reply(200, value)]).await;
            let config = json!({});
            let options = options();
            assert!(session(true, &config, &options, origin)
                .google_lookup("folder", FILE)
                .await
                .is_err());
            task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn google_lookup_rejects_repeating_page_token() {
        let value = json!({"items":[],"nextPageToken":"same"});
        let (origin, task) = fixture(vec![reply(200, value.clone()), reply(200, value)]).await;
        let config = json!({});
        let options = options();
        assert!(session(true, &config, &options, origin)
            .google_lookup("folder", FILE)
            .await
            .is_err());
        assert_eq!(task.await.unwrap().len(), 2);
    }
    #[tokio::test]
    async fn google_write_sends_etag_and_surfaces_conflict_without_retry() {
        let (origin, task) = fixture(vec![reply(412, json!({"secret":"must not escape"}))]).await;
        let config = json!({});
        let options = options();
        let item = Item {
            id: "file-id".into(),
            etag: "\"v1\"".into(),
        };
        let result = session(true, &config, &options, origin)
            .put("folder", FILE, b"blob", Some(&item))
            .await;
        assert!(matches!(result, Err(SyncError::Conflict(_))));
        let requests = task.await.unwrap();
        assert!(requests[0].starts_with("PUT /upload/drive/v2/files/file-id?"));
        assert!(requests[0].contains("if-match: \"v1\""));
        assert!(requests[0].ends_with("blob"));
    }
    #[tokio::test]
    async fn google_create_is_parent_scoped_multipart_and_revision_is_from_write() {
        let (origin, task) = fixture(vec![Reply {
            status: 200,
            headers: "ETag: \"http-partial-validator-not-file-tag\"\r\n",
            data: json!({"id":"created","etag":"\"new\""})
                .to_string()
                .into_bytes(),
        }])
        .await;
        let config = json!({});
        let options = options();
        let item = session(true, &config, &options, origin)
            .put("folder", FILE, b"application-blob", None)
            .await
            .unwrap();
        assert_eq!(item.etag, "\"new\"");
        let requests = task.await.unwrap();
        assert!(requests[0].starts_with("POST /upload/drive/v2/files?"));
        assert!(requests[0].contains("multipart/related"));
        assert!(requests[0].contains("\"parents\":[{\"id\":\"folder\"}]"));
        assert!(requests[0].contains(FILE));
        assert!(requests[0].contains("application-blob"));
    }
    #[tokio::test]
    async fn microsoft_creates_fail_on_conflict_and_updates_are_conditional() {
        let (origin, task) = fixture(vec![
            reply(201, microsoft_file("created", "\"new\"")),
            reply(412, json!({})),
        ])
        .await;
        let config = json!({"driveId":"selected-drive"});
        let options = options();
        let session = session(false, &config, &options, origin);
        let item = session.put("folder", FILE, b"blob", None).await.unwrap();
        assert!(matches!(
            session.put("folder", FILE, b"new blob", Some(&item)).await,
            Err(SyncError::Conflict(_))
        ));
        let requests = task.await.unwrap();
        assert!(requests[0].contains("/drives/selected-drive/items/folder:/application-data.v1.sorng:/content?@microsoft.graph.conflictBehavior=fail"));
        assert!(requests[0].contains("if-none-match: *"));
        assert!(requests[1].contains("if-match: \"new\""));
        assert!(requests[1].contains("/items/created/content"));
    }
    #[tokio::test]
    async fn microsoft_download_redirect_never_receives_bearer_token() {
        let (origin, task) = fixture(vec![
            Reply {
                status: 302,
                headers: "Location: https://tenant.sharepoint.com/download?capability=secret\r\n",
                data: vec![],
            },
            Reply {
                status: 200,
                headers: "",
                data: b"blob".to_vec(),
            },
            reply(200, microsoft_file("file-id", "\"v1\"")),
        ])
        .await;
        let config = json!({});
        let options = options();
        let item = Item {
            id: "file-id".into(),
            etag: "\"v1\"".into(),
        };
        assert_eq!(
            session(false, &config, &options, origin)
                .download(&item)
                .await
                .unwrap(),
            b"blob"
        );
        let requests = task.await.unwrap();
        assert!(requests[0].contains("authorization: Bearer fixture-token"));
        assert!(!requests[1].to_ascii_lowercase().contains("authorization:"));
        assert!(requests[2].contains("authorization: Bearer fixture-token"));
    }
    #[tokio::test]
    async fn download_rejects_size_overflow_and_changed_revision() {
        let item = Item {
            id: "file-id".into(),
            etag: "\"v1\"".into(),
        };
        let config = json!({});
        let mut options = options();
        options.max_bytes = 3;
        let (origin, task) = fixture(vec![Reply {
            status: 200,
            headers: "",
            data: b"four".to_vec(),
        }])
        .await;
        assert!(matches!(
            session(false, &config, &options, origin)
                .download(&item)
                .await,
            Err(SyncError::Invalid(_))
        ));
        task.await.unwrap();
        let (origin, task) = fixture(vec![
            Reply {
                status: 200,
                headers: "",
                data: b"abc".to_vec(),
            },
            reply(200, microsoft_file("file-id", "\"v2\"")),
        ])
        .await;
        assert!(matches!(
            session(false, &config, &options, origin)
                .download(&item)
                .await,
            Err(SyncError::Conflict(_))
        ));
        task.await.unwrap();
    }
    #[tokio::test]
    async fn probe_verification_failure_still_deletes_only_its_id_conditionally() {
        let (origin, task) = fixture(vec![
            reply(404, json!({})),
            reply(201, microsoft_file("probe-id", "\"probe-tag\"")),
            Reply {
                status: 200,
                headers: "",
                data: b"wrong".to_vec(),
            },
            reply(200, microsoft_file("probe-id", "\"probe-tag\"")),
            Reply {
                status: 204,
                headers: "",
                data: vec![],
            },
        ])
        .await;
        let config = json!({});
        let options = options();
        assert!(session(false, &config, &options, origin)
            .probe("folder", ".sorng-probe-unique", b"correct")
            .await
            .is_err());
        let requests = task.await.unwrap();
        assert!(requests[4].starts_with("DELETE /v1.0/me/drive/items/probe-id "));
        assert!(requests[4].contains("if-match: \"probe-tag\""));
        assert!(!requests[4].contains(FILE));
    }
    #[tokio::test]
    async fn refresh_posts_secrets_only_to_fixed_provider_endpoint() {
        for google in [true, false] {
            let (origin, task) = fixture(vec![reply(
                200,
                json!({"access_token":"new-token","refresh_token":"rotated"}),
            )])
            .await;
            let config = json!({"clientId":"client","clientSecret":"secret","refreshToken":"refresh","tenantId":"tenant"});
            let options = options();
            let session = session(google, &config, &options, origin);
            session.refresh().await.unwrap();
            assert_eq!(session.token(), "new-token");
            let requests = task.await.unwrap();
            assert!(requests[0].starts_with(if google {
                "POST /token "
            } else {
                "POST /tenant/oauth2/v2.0/token "
            }));
            assert!(requests[0].contains("grant_type=refresh_token"));
            assert!(requests[0].contains("client_secret=secret"));
            assert!(!requests[0].contains("authorization:"));
        }
    }
    #[test]
    fn download_capabilities_are_https_and_provider_scoped() {
        for url in [
            "https://tenant.sharepoint.com/path?token=secret",
            "https://sn3302.1drv.com/download",
            "https://files.onedrive.com/x",
        ] {
            assert!(download_url(url).is_ok());
        }
        for url in [
            "http://tenant.sharepoint.com/x",
            "https://tenant.sharepoint.com:444/x",
            "https://sharepoint.com.evil.test/x",
            "https://evilsharepoint.com/x",
            "https://user:secret@tenant.sharepoint.com/x",
            "https://127.0.0.1/x",
            "https://graph.microsoft.com/x",
            "file:///tmp/x",
            "https://tenant.sharepoint.com/x#token",
        ] {
            assert!(download_url(url).is_err());
        }
    }
    #[test]
    fn revisions_require_matching_identity_and_strong_etag() {
        let item = Item {
            id: "a".into(),
            etag: "\"version1\"".into(),
        };
        assert!(expected(Some(&item), Some(&item.revision())).is_ok());
        assert!(expected(None, None).is_ok());
        assert!(expected(Some(&item), None).is_err());
        assert!(expected(None, Some(&item.revision())).is_err());
        let replacement = Item {
            id: "b".into(),
            etag: item.etag.clone(),
        };
        assert!(expected(Some(&replacement), Some(&item.revision())).is_err());
        for tag in ["*", "W/\"weak\"", "\"a\",\"b\"", "\"a\r\nb\"", ""] {
            assert!(etag(tag).is_err());
        }
    }
    #[test]
    fn paths_cannot_change_origin_or_escape_parent() {
        assert_eq!(
            path_parts(&json!({"folderPath":"/sortOfRemoteNG/data"})).unwrap(),
            ["sortOfRemoteNG", "data"]
        );
        for path in [
            "../other",
            "safe/../other",
            "https://evil.test",
            "safe\\other",
            "%2e%2e",
            "a?query",
            "a\n",
        ] {
            assert!(path_parts(&json!({"folderPath":path})).is_err());
        }
        assert_eq!(segment("a b'c"), "a%20b'c");
        for id in ["../x", "x/y", "a?token", "", ".."] {
            assert!(identifier(id).is_err());
        }
    }
    #[tokio::test]
    async fn upload_is_chunked_and_preserves_bytes() {
        use futures_util::StreamExt;
        let data = vec![42; CHUNK * 2 + 3];
        let stream = upload_stream(data.clone(), 0);
        futures_util::pin_mut!(stream);
        let mut actual = Vec::new();
        let mut count = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.unwrap();
            assert!(chunk.len() <= CHUNK);
            actual.extend_from_slice(&chunk);
            count += 1;
        }
        assert_eq!(actual, data);
        assert_eq!(count, 3);
    }
}
