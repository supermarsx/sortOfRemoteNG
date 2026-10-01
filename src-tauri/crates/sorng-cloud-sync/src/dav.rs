//! Application-data DAV transport. No redirects, weak validators, or unconditional writes.
use crate::types::{Blob, SyncError, Target, TransportOptions, Written};
use base64::{engine::general_purpose::STANDARD, Engine};
use digest_auth::{AuthContext, HttpMethod, WwwAuthenticateHeader};
use reqwest::{header, Client, Method, Response, StatusCode};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tokio::time::{timeout, Instant};
use url::Url;

const FILE: &str = "application-data.v1.sorng";
const DEADLINE: Duration = Duration::from_secs(300);
const CHUNK: usize = 16 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    server_url: String,
    username: String,
    password: Option<String>,
    app_password: Option<String>,
    #[serde(default)]
    use_app_password: bool,
    folder_path: String,
    auth_method: Option<String>,
    bearer_token: Option<String>,
}

enum Auth {
    Basic(String, String),
    Digest(String, String),
    Bearer(String),
}

struct Dav {
    client: Client,
    directory: Url,
    collections: Vec<Url>,
    auth: Auth,
}

fn invalid() -> SyncError {
    SyncError::Invalid("Invalid DAV configuration, path, or revision.".into())
}
fn transport() -> SyncError {
    SyncError::Transport(
        "DAV request failed; no automatic overwrite or redirect was attempted.".into(),
    )
}
fn conflict() -> SyncError {
    SyncError::Conflict(
        "DAV data changed or could not be verified with a strong ETag. Read again before writing."
            .into(),
    )
}

fn segment_valid(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.chars().any(|c| c.is_control() || c == '\\')
}

fn strong_etag(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2
        && bytes.len() <= 1024
        && bytes[0] == b'"'
        && bytes[bytes.len() - 1] == b'"'
        && bytes[1..bytes.len() - 1]
            .iter()
            .all(|b| *b == 0x21 || (0x23..=0x7e).contains(b))
}

fn etag(response: &Response) -> Result<String, SyncError> {
    let mut values = response.headers().get_all(header::ETAG).iter();
    let value = values
        .next()
        .and_then(|v| v.to_str().ok())
        .filter(|v| strong_etag(v))
        .ok_or_else(conflict)?;
    if values.next().is_some() {
        return Err(conflict());
    }
    Ok(value.to_owned())
}

fn status(response: &Response) -> Result<(), SyncError> {
    match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(SyncError::Authentication(
            "DAV authentication or access was denied.".into(),
        )),
        StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED => Err(conflict()),
        code if code.is_success() => Ok(()),
        _ => Err(transport()),
    }
}

impl Dav {
    fn new(target: &Target) -> Result<Self, SyncError> {
        let nextcloud = target.provider == "nextcloud";
        let value = match target.provider.as_str() {
            "nextcloud" => target.nextcloud.as_ref(),
            "webdav" => target.webdav.as_ref(),
            _ => None,
        }
        .ok_or_else(invalid)?;
        let config: Config = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
        if config.server_url.len() > 8192
            || config.folder_path.len() > 4096
            || config.username.len() > 1024
        {
            return Err(invalid());
        }
        let mut directory = Url::parse(&config.server_url).map_err(|_| invalid())?;
        if directory.scheme() != "https"
            || directory.host_str().is_none()
            || !directory.username().is_empty()
            || directory.password().is_some()
            || directory.query().is_some()
            || directory.fragment().is_some()
            || config.server_url.contains('\\')
            || config.server_url.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        let folder = config.folder_path.trim_matches('/');
        if !folder.is_empty() && !folder.split('/').all(segment_valid) {
            return Err(invalid());
        }
        {
            let mut segments = directory.path_segments_mut().map_err(|_| invalid())?;
            segments.pop_if_empty();
            if nextcloud {
                if !segment_valid(&config.username) {
                    return Err(invalid());
                }
                segments.extend(["remote.php", "dav", "files", &config.username]);
            }
            segments.push("");
        }
        let mut collections = Vec::new();
        if !folder.is_empty() {
            for part in folder.split('/') {
                directory
                    .path_segments_mut()
                    .map_err(|_| invalid())?
                    .pop_if_empty()
                    .push(part)
                    .push("");
                collections.push(directory.clone());
            }
        }
        let method = if nextcloud {
            "basic"
        } else {
            config.auth_method.as_deref().ok_or_else(invalid)?
        };
        let password = if nextcloud && config.use_app_password {
            config.app_password
        } else {
            config.password
        };
        let auth = match method {
            "basic" | "digest" => {
                let password = password
                    .filter(|p| !p.is_empty() && p.len() <= 16_384)
                    .ok_or_else(invalid)?;
                if config.username.is_empty()
                    || config.username.chars().any(char::is_control)
                    || (method == "basic" && config.username.contains(':'))
                {
                    return Err(invalid());
                }
                if method == "basic" {
                    Auth::Basic(config.username, password)
                } else {
                    Auth::Digest(config.username, password)
                }
            }
            "bearer" => {
                let token = config
                    .bearer_token
                    .filter(|t| {
                        !t.is_empty()
                            && t.len() <= 16_384
                            && t.bytes().all(|b| b.is_ascii_graphic())
                    })
                    .ok_or_else(invalid)?;
                Auth::Bearer(token)
            }
            _ => return Err(invalid()),
        };
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(DEADLINE)
            .build()
            .map_err(|_| transport())?;
        Ok(Self {
            client,
            directory,
            collections,
            auth,
        })
    }

    fn url(&self, filename: &str) -> Url {
        let mut url = self.directory.clone();
        // Only FILE or a generated, internally owned probe filename reaches this method.
        url.path_segments_mut()
            .expect("validated hierarchical URL")
            .pop_if_empty()
            .push(filename);
        url
    }

    async fn request(
        &self,
        method: Method,
        filename: &str,
        data: Option<&[u8]>,
        condition: Option<(&str, &str)>,
        rate: u64,
    ) -> Result<Response, SyncError> {
        let url = self.url(filename);
        self.request_url(method, url, data, condition, rate).await
    }

    async fn request_url(
        &self,
        method: Method,
        url: Url,
        data: Option<&[u8]>,
        condition: Option<(&str, &str)>,
        rate: u64,
    ) -> Result<Response, SyncError> {
        let data = data.map(Arc::<[u8]>::from);
        let mut digest = None;
        // Digest only retries the unauthenticated challenge, never an uncertain upload.
        for attempt in 0..2 {
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .header(header::ACCEPT_ENCODING, "identity");
            if let Some((name, value)) = condition {
                request = request.header(name, value);
            }
            request = match &self.auth {
                Auth::Basic(user, password) => request.basic_auth(user, Some(password)),
                Auth::Bearer(token) => request.bearer_auth(token),
                Auth::Digest(_, _) => {
                    if let Some(value) = &digest {
                        request.header(header::AUTHORIZATION, value)
                    } else {
                        request
                    }
                }
            };
            if let Some(bytes) = data.clone() {
                request = request
                    .header(header::CONTENT_TYPE, "application/octet-stream")
                    .header(header::CONTENT_LENGTH, bytes.len());
                let start = Instant::now();
                let stream = futures_util::stream::unfold(
                    (bytes, 0usize),
                    move |(bytes, offset)| async move {
                        if offset == bytes.len() {
                            return None;
                        }
                        let end = (offset + CHUNK).min(bytes.len());
                        pace(start, end, rate).await;
                        let chunk = bytes[offset..end].to_vec();
                        Some((Ok::<_, std::io::Error>(chunk), (bytes, end)))
                    },
                );
                request = request.body(reqwest::Body::wrap_stream(stream));
            }
            let response = request.send().await.map_err(|_| transport())?;
            if response.status() != StatusCode::UNAUTHORIZED || attempt != 0 {
                return Ok(response);
            }
            let Auth::Digest(user, password) = &self.auth else {
                return Ok(response);
            };
            let challenge = response
                .headers()
                .get_all(header::WWW_AUTHENTICATE)
                .iter()
                .filter_map(|v| v.to_str().ok())
                .find(|v| v.starts_with("Digest ") && v.len() <= 8192)
                .ok_or_else(|| {
                    SyncError::Authentication(
                        "DAV did not offer a supported Digest challenge.".into(),
                    )
                })?;
            let mut prompt = WwwAuthenticateHeader::parse(challenge).map_err(|_| transport())?;
            let context = AuthContext::new_with_method(
                user.as_str(),
                password.as_str(),
                url.path(),
                data.as_deref(),
                HttpMethod::from(method.as_str()),
            );
            digest = Some(
                prompt
                    .respond(&context)
                    .map_err(|_| transport())?
                    .to_string(),
            );
        }
        Err(transport())
    }

    async fn ensure_collections(&self) -> Result<(), SyncError> {
        // Only user-configured folder components, never the DAV endpoint/user root.
        for url in &self.collections {
            let response = self
                .request_url(
                    Method::from_bytes(b"MKCOL").map_err(|_| invalid())?,
                    url.clone(),
                    None,
                    None,
                    0,
                )
                .await?;
            if matches!(
                response.status(),
                StatusCode::CREATED | StatusCode::METHOD_NOT_ALLOWED
            ) {
                continue;
            }
            status(&response)?;
            return Err(transport());
        }
        Ok(())
    }

    async fn read_file(
        &self,
        filename: &str,
        options: &TransportOptions,
    ) -> Result<Option<(Vec<u8>, String)>, SyncError> {
        let mut response = self.request(Method::GET, filename, None, None, 0).await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        status(&response)?;
        if response.status() != StatusCode::OK {
            return Err(transport());
        }
        let revision = etag(&response)?;
        if response
            .content_length()
            .is_some_and(|n| n > options.max_bytes as u64)
        {
            return Err(invalid());
        }
        let mut data = Vec::new();
        let start = Instant::now();
        while let Some(chunk) = response.chunk().await.map_err(|_| transport())? {
            if chunk.len() > options.max_bytes.saturating_sub(data.len()) {
                return Err(invalid());
            }
            data.extend_from_slice(&chunk);
            pace(start, data.len(), options.download_limit_kbs).await;
        }
        Ok(Some((data, revision)))
    }

    async fn write_file(
        &self,
        filename: &str,
        data: &[u8],
        expected: Option<&str>,
        options: &TransportOptions,
    ) -> Result<Written, SyncError> {
        if data.len() > options.max_bytes || expected.is_some_and(|v| !strong_etag(v)) {
            return Err(invalid());
        }
        self.ensure_collections().await?;
        let condition = expected
            .map(|v| ("If-Match", v))
            .unwrap_or(("If-None-Match", "*"));
        let response = self
            .request(
                Method::PUT,
                filename,
                Some(data),
                Some(condition),
                options.upload_limit_kbs,
            )
            .await?;
        status(&response)?;
        if !matches!(
            response.status(),
            StatusCode::OK | StatusCode::CREATED | StatusCode::NO_CONTENT
        ) {
            return Err(transport());
        }
        let returned_revision = if response.headers().contains_key(header::ETAG) {
            Some(etag(&response)?)
        } else {
            None
        };
        let (actual, revision) = self
            .read_file(filename, options)
            .await?
            .ok_or_else(conflict)?;
        if actual != data || returned_revision.is_some_and(|v| v != revision) {
            return Err(conflict());
        }
        Ok(Written { revision })
    }

    async fn delete_probe(&self, filename: &str, revision: &str) -> Result<(), SyncError> {
        let response = self
            .request(
                Method::DELETE,
                filename,
                None,
                Some(("If-Match", revision)),
                0,
            )
            .await?;
        status(&response)?;
        if !matches!(response.status(), StatusCode::OK | StatusCode::NO_CONTENT) {
            return Err(transport());
        }
        Ok(())
    }
}

async fn pace(start: Instant, bytes: usize, kbs: u64) {
    if kbs != 0 {
        tokio::time::sleep_until(
            start + Duration::from_secs_f64(bytes as f64 / (kbs as f64 * 1024.0)),
        )
        .await;
    }
}

pub async fn read(target: &Target, options: &TransportOptions) -> Result<Blob, SyncError> {
    options.validate()?;
    let dav = Dav::new(target)?;
    let value = timeout(DEADLINE, dav.read_file(FILE, options))
        .await
        .map_err(|_| transport())??;
    Ok(match value {
        Some((data, revision)) => Blob {
            data: Some(STANDARD.encode(data)),
            revision: Some(revision),
        },
        None => Blob {
            data: None,
            revision: None,
        },
    })
}

pub async fn write(
    target: &Target,
    data: &[u8],
    expected_revision: Option<&str>,
    options: &TransportOptions,
) -> Result<Written, SyncError> {
    options.validate()?;
    let dav = Dav::new(target)?;
    timeout(
        DEADLINE,
        dav.write_file(FILE, data, expected_revision, options),
    )
    .await
    .map_err(|_| transport())?
}

pub async fn test(target: &Target, options: &TransportOptions) -> Result<(), SyncError> {
    options.validate()?;
    let dav = Dav::new(target)?;
    let filename = format!(".sorng-probe-{}.tmp", uuid::Uuid::new_v4());
    // A one-byte probe works even with the smallest allowed data limit.
    probe(&dav, &filename, options).await
}

async fn probe(dav: &Dav, filename: &str, options: &TransportOptions) -> Result<(), SyncError> {
    let result = timeout(DEADLINE, async {
        let written = dav.write_file(filename, b"1", None, options).await?;
        let denied = dav
            .request(
                Method::PUT,
                filename,
                Some(b"2"),
                Some(("If-None-Match", "*")),
                options.upload_limit_kbs,
            )
            .await;
        match denied {
            Ok(response) if response.status() == StatusCode::PRECONDITION_FAILED => Ok(()),
            _ => Err(SyncError::Conflict(
                "DAV server did not prove create-only precondition support.".into(),
            )),
        }?;
        let stale = dav
            .request(
                Method::PUT,
                filename,
                Some(b"2"),
                Some(("If-Match", "\"sorng-nonexistent-probe-revision\"")),
                options.upload_limit_kbs,
            )
            .await?;
        if stale.status() != StatusCode::PRECONDITION_FAILED {
            return Err(conflict());
        }
        dav.write_file(filename, b"2", Some(&written.revision), options)
            .await?;
        Ok(())
    })
    .await
    .map_err(|_| transport())
    .and_then(|v| v);
    // A fresh bounded cleanup attempt also covers failures after an uncertain PUT.
    let cleanup = timeout(Duration::from_secs(30), async {
        // Refresh only our random probe, then conditionally remove its observed version.
        // Even a broken server's precondition test can never target the production filename.
        let current = dav.read_file(filename, options).await?;
        if let Some((_, revision)) = current {
            dav.delete_probe(filename, &revision).await?;
        }
        Ok::<(), SyncError>(())
    })
    .await
    .map_err(|_| transport())
    .and_then(|v| v);
    cleanup?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    struct Step {
        method: &'static str,
        path: &'static str,
        headers: Vec<(&'static str, &'static str)>,
        body: &'static [u8],
        status: u16,
        response_headers: &'static str,
        response: &'static [u8],
    }

    fn step(
        method: &'static str,
        path: &'static str,
        code: u16,
        headers: &'static str,
        body: &'static [u8],
    ) -> Step {
        Step {
            method,
            path,
            headers: vec![],
            body: b"",
            status: code,
            response_headers: headers,
            response: body,
        }
    }

    async fn fixture(
        steps: Vec<Step>,
        auth: Auth,
        collections: bool,
    ) -> (Dav, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for step in steps {
                let (mut socket, _) = timeout(Duration::from_secs(5), listener.accept())
                    .await
                    .unwrap()
                    .unwrap();
                let mut bytes = Vec::new();
                loop {
                    let b = socket.read_u8().await.unwrap();
                    bytes.push(b);
                    if bytes.ends_with(b"\r\n\r\n") {
                        break;
                    }
                    assert!(bytes.len() < 32_768);
                }
                let head = String::from_utf8(bytes).unwrap();
                let mut lines = head.split("\r\n");
                assert_eq!(
                    lines.next().unwrap(),
                    format!("{} {} HTTP/1.1", step.method, step.path)
                );
                let headers: std::collections::HashMap<String, String> = lines
                    .filter_map(|l| {
                        l.split_once(':')
                            .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_owned()))
                    })
                    .collect();
                for (key, value) in step.headers {
                    let actual = headers.get(key).map(String::as_str).unwrap_or("");
                    // Assertions deliberately omit raw Authorization values on failure.
                    assert!(actual.starts_with(value), "expected request header {key}");
                }
                let len: usize = headers
                    .get("content-length")
                    .map(|v| v.parse().unwrap())
                    .unwrap_or(0);
                assert!(len <= 1024);
                let mut body = vec![0; len];
                socket.read_exact(&mut body).await.unwrap();
                assert_eq!(body, step.body);
                let response = format!(
                    "HTTP/1.1 {} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n",
                    step.status,
                    step.response.len(),
                    step.response_headers
                );
                socket.write_all(response.as_bytes()).await.unwrap();
                socket.write_all(step.response).await.unwrap();
            }
        });
        // HTTP is allowed only by direct construction inside this test module.
        let directory = Url::parse(&format!("http://{address}/dav/user/sync/")).unwrap();
        let dav = Dav {
            client: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            collections: if collections {
                vec![directory.clone()]
            } else {
                vec![]
            },
            directory,
            auth,
        };
        (dav, server)
    }

    fn options() -> TransportOptions {
        TransportOptions {
            max_bytes: 64,
            upload_limit_kbs: 0,
            download_limit_kbs: 0,
        }
    }

    #[tokio::test]
    async fn http_creates_only_configured_folder_then_create_read_conditional_update() {
        let mut create = step(
            "PUT",
            "/dav/user/sync/application-data.v1.sorng",
            201,
            "ETag: \"one\"\r\n",
            b"",
        );
        create.body = b"old";
        create.headers = vec![("if-none-match", "*"), ("authorization", "Basic ")];
        let mut update = step(
            "PUT",
            "/dav/user/sync/application-data.v1.sorng",
            204,
            "ETag: \"two\"\r\n",
            b"",
        );
        update.body = b"new";
        update.headers = vec![("if-match", "\"one\"")];
        let steps = vec![
            step("MKCOL", "/dav/user/sync/", 201, "", b""),
            create,
            step(
                "GET",
                "/dav/user/sync/application-data.v1.sorng",
                200,
                "ETag: \"one\"\r\n",
                b"old",
            ),
            step("MKCOL", "/dav/user/sync/", 405, "", b""),
            update,
            step(
                "GET",
                "/dav/user/sync/application-data.v1.sorng",
                200,
                "ETag: \"two\"\r\n",
                b"new",
            ),
        ];
        let (dav, server) = fixture(
            steps,
            Auth::Basic("fixture".into(), "synthetic".into()),
            true,
        )
        .await;
        let first = dav
            .write_file(FILE, b"old", None, &options())
            .await
            .unwrap();
        assert_eq!(first.revision, "\"one\"");
        let second = dav
            .write_file(FILE, b"new", Some(&first.revision), &options())
            .await
            .unwrap();
        assert_eq!(second.revision, "\"two\"");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn http_conflict_is_not_retried_or_overwritten() {
        let mut put = step(
            "PUT",
            "/dav/user/sync/application-data.v1.sorng",
            412,
            "",
            b"",
        );
        put.body = b"new";
        put.headers = vec![("if-match", "\"old\""), ("authorization", "Bearer ")];
        let (dav, server) = fixture(vec![put], Auth::Bearer("fixture-token".into()), false).await;
        assert!(matches!(
            dav.write_file(FILE, b"new", Some("\"old\""), &options())
                .await,
            Err(SyncError::Conflict(_))
        ));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn http_missing_weak_etag_oversize_and_redirect_fail_closed() {
        for (code, headers, body) in [
            (200, "", &b"data"[..]),
            (200, "ETag: W/\"weak\"\r\n", &b"data"[..]),
            (200, "ETag: \"strong\"\r\n", &b"0123456789"[..]),
            (302, "Location: http://127.0.0.1:1/foreign\r\n", &b""[..]),
        ] {
            let (dav, server) = fixture(
                vec![step(
                    "GET",
                    "/dav/user/sync/application-data.v1.sorng",
                    code,
                    headers,
                    body,
                )],
                Auth::Basic("u".into(), "p".into()),
                false,
            )
            .await;
            let mut opts = options();
            opts.max_bytes = 5;
            assert!(dav.read_file(FILE, &opts).await.is_err());
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn http_digest_challenge_is_same_endpoint_and_bound_to_method() {
        let challenge = step("GET", "/dav/user/sync/application-data.v1.sorng", 401, "WWW-Authenticate: Digest realm=\"fixture\", nonce=\"synthetic\", algorithm=SHA-256, qop=\"auth\"\r\n", b"");
        let mut accepted = step(
            "GET",
            "/dav/user/sync/application-data.v1.sorng",
            200,
            "ETag: \"one\"\r\n",
            b"one",
        );
        accepted.headers = vec![("authorization", "Digest ")];
        let (dav, server) = fixture(
            vec![challenge, accepted],
            Auth::Digest("u".into(), "p".into()),
            false,
        )
        .await;
        let (_, revision) = dav.read_file(FILE, &options()).await.unwrap().unwrap();
        assert_eq!(revision, "\"one\"");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn http_probe_verifies_both_cas_modes_and_cleans_only_unique_probe() {
        let probe_path = "/dav/user/sync/.sorng-probe-fixture.tmp";
        let mut create = step("PUT", probe_path, 201, "ETag: \"one\"\r\n", b"");
        create.body = b"1";
        create.headers = vec![("if-none-match", "*")];
        let mut duplicate = step("PUT", probe_path, 412, "", b"");
        duplicate.body = b"2";
        duplicate.headers = vec![("if-none-match", "*")];
        let mut stale = step("PUT", probe_path, 412, "", b"");
        stale.body = b"2";
        stale.headers = vec![("if-match", "\"sorng-nonexistent-probe-revision\"")];
        let mut update = step("PUT", probe_path, 204, "ETag: \"two\"\r\n", b"");
        update.body = b"2";
        update.headers = vec![("if-match", "\"one\"")];
        let mut delete = step("DELETE", probe_path, 204, "", b"");
        delete.headers = vec![("if-match", "\"two\"")];
        let (dav, server) = fixture(
            vec![
                create,
                step("GET", probe_path, 200, "ETag: \"one\"\r\n", b"1"),
                duplicate,
                stale,
                update,
                step("GET", probe_path, 200, "ETag: \"two\"\r\n", b"2"),
                step("GET", probe_path, 200, "ETag: \"two\"\r\n", b"2"),
                delete,
            ],
            Auth::Basic("u".into(), "p".into()),
            false,
        )
        .await;
        probe(&dav, ".sorng-probe-fixture.tmp", &options())
            .await
            .unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn http_probe_cleanup_also_runs_after_failed_readback() {
        let p = "/dav/user/sync/.sorng-probe-fixture.tmp";
        let mut create = step("PUT", p, 201, "ETag: \"one\"\r\n", b"");
        create.body = b"1";
        let (dav, server) = fixture(
            vec![
                create,
                step("GET", p, 200, "ETag: \"one\"\r\n", b"wrong"),
                step("GET", p, 200, "ETag: \"one\"\r\n", b"wrong"),
                step("DELETE", p, 204, "", b""),
            ],
            Auth::Basic("u".into(), "p".into()),
            false,
        )
        .await;
        assert!(probe(&dav, ".sorng-probe-fixture.tmp", &options())
            .await
            .is_err());
        server.await.unwrap();
    }

    fn target(provider: &str, config: serde_json::Value) -> Target {
        serde_json::from_value(json!({"id":"test", "provider":provider, provider:config})).unwrap()
    }
    fn config() -> serde_json::Value {
        json!({"serverUrl":"https://example.test/instance/", "username":"a/b+é", "password":"secret", "folderPath":"/sync data/a%2Fb", "authMethod":"basic"})
    }
    #[test]
    fn nextcloud_preserves_instance_and_encodes_each_segment() {
        let dav = Dav::new(&target("nextcloud", config())).unwrap();
        assert_eq!(dav.url(FILE).as_str(), "https://example.test/instance/remote.php/dav/files/a%2Fb+%C3%A9/sync%20data/a%252Fb/application-data.v1.sorng");
    }
    #[test]
    fn generic_dav_does_not_invent_nextcloud_paths() {
        let dav = Dav::new(&target("webdav", config())).unwrap();
        assert_eq!(
            dav.url(FILE).path(),
            "/instance/sync%20data/a%252Fb/application-data.v1.sorng"
        );
    }
    #[test]
    fn rejects_dangerous_paths_urls_and_auth_modes() {
        for url in [
            "http://example.test/",
            "https://u:p@example.test/",
            "https://example.test/?token=secret",
            "https://example.test/#secret",
        ] {
            let mut c = config();
            c["serverUrl"] = json!(url);
            assert!(Dav::new(&target("webdav", c)).is_err());
        }
        for folder in ["../other", "a/./b", "a//b", "a\\b", "a\0b"] {
            let mut c = config();
            c["folderPath"] = json!(folder);
            assert!(Dav::new(&target("webdav", c)).is_err());
        }
        let mut c = config();
        c["authMethod"] = json!("auto");
        assert!(Dav::new(&target("webdav", c)).is_err());
    }
    #[test]
    fn only_strong_single_etags_are_accepted() {
        for invalid in [
            "W/\"abc\"",
            "*",
            "abc",
            "\"a\", \"b\"",
            "\"a\r\nb\"",
            "\"a b\"",
        ] {
            assert!(!strong_etag(invalid));
        }
        assert!(strong_etag("\"abc-123\""));
    }
    #[test]
    fn app_password_and_all_explicit_dav_auth_modes() {
        let mut c = config();
        c["useAppPassword"] = json!(true);
        c["appPassword"] = json!("app-secret");
        assert!(
            matches!(Dav::new(&target("nextcloud", c)).unwrap().auth, Auth::Basic(_, p) if p == "app-secret")
        );
        let mut c = config();
        c["authMethod"] = json!("digest");
        assert!(matches!(
            Dav::new(&target("webdav", c)).unwrap().auth,
            Auth::Digest(_, _)
        ));
        let mut c = config();
        c["authMethod"] = json!("bearer");
        c["bearerToken"] = json!("token");
        assert!(matches!(
            Dav::new(&target("webdav", c)).unwrap().auth,
            Auth::Bearer(_)
        ));
    }
}
