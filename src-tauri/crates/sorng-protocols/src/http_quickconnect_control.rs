//! Closed anonymous QuickConnect discovery RPC. No arbitrary URLs, inherited
//! website credentials, tunnel requests or response-selected destinations.
use super::AxumProxyState;
use axum::body::Body;
use axum::http::{Method, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;

pub(super) const PATH: &str = "/__sortofremoteng_quickconnect_control_v1";
pub(super) const UPSTREAM: &str = "https://global.quickconnect.to/Serv.php";
pub(super) const DOCUMENT_HEADER: &str = "x-sorng-quickconnect-document";
const MAX_REQUEST: usize = 4096;
const MAX_RESPONSE: usize = 256 * 1024;

pub(super) struct ReviewedQuickConnectControl {
    client: reqwest::Client,
    requests: Semaphore,
    downloads: Semaphore,
}
impl ReviewedQuickConnectControl {
    pub(super) fn new(proxy: Option<reqwest::Proxy>, min_tls: &str) -> Result<Self, String> {
        let roots =
            super::native_root_store().map_err(|_| "Verified QuickConnect roots unavailable")?;
        if roots.is_empty() {
            return Err("Verified QuickConnect roots unavailable".into());
        }
        let versions = if min_tls.trim() == "1.3" {
            vec![&rustls::version::TLS13]
        } else {
            vec![&rustls::version::TLS13, &rustls::version::TLS12]
        };
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_protocol_versions(&versions)
        .map_err(|_| "Verified QuickConnect TLS unavailable")?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .use_preconfigured_tls(tls)
            .cookie_store(false)
            .referer(false)
            .redirect(reqwest::redirect::Policy::none())
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(2);
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        Ok(Self::from_client(
            builder
                .build()
                .map_err(|_| "Verified QuickConnect client unavailable")?,
        ))
    }
    fn from_client(client: reqwest::Client) -> Self {
        Self {
            client,
            requests: Semaphore::new(8),
            downloads: Semaphore::new(2),
        }
    }
    #[cfg(test)]
    pub(super) fn fixture(client: reqwest::Client) -> Self {
        Self::from_client(client)
    }
    pub(super) fn revoke(&self) {
        self.requests.close();
        self.downloads.close();
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ControlCommand {
    version: u8,
    command: String,
    stop_when_error: bool,
    stop_when_success: bool,
    id: String,
    #[serde(rename = "serverID")]
    server_id: String,
    is_gofile: bool,
    path: String,
}

fn validated_body(bytes: &[u8], alias: &str) -> Result<Vec<u8>, &'static str> {
    let invalid = "Unsupported QuickConnect discovery request.";
    if bytes.len() > MAX_REQUEST {
        return Err(invalid);
    }
    let commands: [ControlCommand; 2] = serde_json::from_slice(bytes).map_err(|_| invalid)?;
    for (command, id) in commands.iter().zip(["mainapp_https", "mainapp_http"]) {
        if command.version != 1
            || command.command != "get_server_info"
            || command.stop_when_error
            || command.stop_when_success
            || command.id != id
            || command.server_id != alias
            || command.is_gofile
            || command.path.len() > 128
            || matches!(command.path.as_str(), "." | "..")
            || !command
                .path
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._~-".contains(&byte))
        {
            return Err(invalid);
        }
    }
    if commands[0].path != commands[1].path {
        return Err(invalid);
    }
    serde_json::to_vec(&commands).map_err(|_| invalid)
}

pub(super) fn manifest(
    policy: &super::HttpProxyPolicy,
    source: &str,
    proxy: &str,
) -> Option<serde_json::Value> {
    let defaults = policy.synology_quick_connect_defaults.as_ref()?;
    let source = reqwest::Url::parse(source).ok()?;
    policy.validate(&source).ok()?;
    let origins: Vec<_> = defaults
        .origins()
        .ok()?
        .into_iter()
        .filter(|origin| !policy.https_only || origin.starts_with("https:"))
        .collect();
    let mut value = serde_json::json!({"version":1,"navigationOrigins":origins,"redirectEndpoint":format!("{proxy}{}", super::quickconnect::PATH)});
    if defaults.nas_alias().is_some() {
        value["rpc"] =
            serde_json::json!({"upstreamUrl":UPSTREAM,"proxyUrl":format!("{proxy}{PATH}")});
    }
    Some(value)
}

fn refusal(status: StatusCode, message: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(message))
        .expect("static discovery refusal")
}

async fn exchange(
    control: &ReviewedQuickConnectControl,
    body: Vec<u8>,
) -> Result<Response<Body>, &'static str> {
    let _download = control
        .downloads
        .acquire()
        .await
        .map_err(|_| "QuickConnect discovery ended.")?;
    let mut response = control
        .client
        .post(UPSTREAM)
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded; charset=UTF-8",
        )
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity")
        .body(body)
        .send()
        .await
        .map_err(|_| "Verified QuickConnect discovery failed; no alternate route was attempted.")?;
    let status = response.status();
    if status.is_redirection()
        || !(200..600).contains(&status.as_u16())
        || response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE as u64)
        || response
            .headers()
            .get("content-encoding")
            .is_some_and(|value| value.as_bytes() != b"identity")
    {
        return Err("Unsupported QuickConnect discovery response.");
    }
    let client_ip = (response.headers().get_all("x-qc-client-ip").iter().count() == 1)
        .then(|| {
            response
                .headers()
                .get("x-qc-client-ip")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<std::net::IpAddr>().ok())
                .map(|value| value.to_string())
        })
        .flatten();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Incomplete QuickConnect discovery response.")?
    {
        if chunk.len() > MAX_RESPONSE - bytes.len() {
            return Err("QuickConnect discovery response is too large.");
        }
        bytes.extend_from_slice(&chunk);
    }
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "QuickConnect discovery did not return valid JSON.")?;
    let bytes =
        serde_json::to_vec(&json).map_err(|_| "QuickConnect discovery JSON is unavailable.")?;
    if bytes.len() > MAX_RESPONSE {
        return Err("QuickConnect discovery response is too large.");
    }
    let mut builder = Response::builder()
        .status(status.as_u16())
        .header("Content-Type", "application/json")
        .header("Content-Length", bytes.len())
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin");
    if let Some(ip) = client_ip {
        builder = builder.header("X-QC-CLIENT-IP", ip);
    }
    Ok(builder
        .body(Body::from(bytes))
        .expect("validated discovery response"))
}

pub(super) async fn handle(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
) -> Response<Body> {
    let headers = request.headers();
    if !super::proxy_request_headers_are_authorized(
        headers,
        &state.proxy_authority,
        &state.proxy_origin,
    ) || headers.get_all("host").iter().count() != 1
        || headers.get_all("origin").iter().count() != 1
        || headers.get("origin").and_then(|value| value.to_str().ok())
            != Some(state.proxy_origin.as_str())
    {
        return refusal(
            StatusCode::FORBIDDEN,
            "QuickConnect discovery is not authorized.",
        );
    }
    let sequence = headers
        .get(DOCUMENT_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .and_then(|value| value.parse::<u64>().ok());
    let mime = headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim);
    if request.uri().path() != PATH
        || request.uri().query().is_some()
        || request.method() != Method::POST
        || headers.get_all(DOCUMENT_HEADER).iter().count() != 1
        || sequence.is_none()
        || headers.get_all("content-type").iter().count() != 1
        || !mime.is_some_and(|mime| {
            mime.eq_ignore_ascii_case("application/json")
                || mime.eq_ignore_ascii_case("application/x-www-form-urlencoded")
        })
        || headers.contains_key("upgrade")
        || headers.contains_key("sec-websocket-key")
        || headers
            .get("sec-fetch-dest")
            .is_some_and(|value| value.as_bytes() != b"empty")
        || headers
            .get("sec-fetch-mode")
            .is_some_and(|value| !matches!(value.as_bytes(), b"cors" | b"same-origin"))
        || headers
            .get("sec-fetch-site")
            .is_some_and(|value| value.as_bytes() != b"same-origin")
    {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Only protected QuickConnect discovery POST requests are supported.",
        );
    }
    let Some(defaults) = state.proxy_policy.synology_quick_connect_defaults.as_ref() else {
        return refusal(
            StatusCode::FORBIDDEN,
            "QuickConnect discovery defaults are disabled.",
        );
    };
    let Some(alias) = reqwest::Url::parse(&state.target_origin)
        .ok()
        .filter(|source| state.proxy_policy.validate(source).is_ok())
        .and_then(|_| defaults.nas_alias())
    else {
        return refusal(
            StatusCode::FORBIDDEN,
            "QuickConnect discovery does not belong to this source.",
        );
    };
    let Some(control) = state.network.quickconnect_control.as_ref() else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "Verified QuickConnect discovery is unavailable.",
        );
    };
    let Ok(_request) = control.requests.try_acquire() else {
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "QuickConnect discovery request limit reached.",
        );
    };
    let sequence = sequence.unwrap();
    let operation = async {
        state.network.await_document(sequence).await?;
        state
            .network
            .while_document(sequence, async {
                let bytes = match axum::body::to_bytes(request.into_body(), MAX_REQUEST).await {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        return Ok(refusal(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "QuickConnect discovery request exceeds its limit.",
                        ))
                    }
                };
                let body = match validated_body(&bytes, &alias) {
                    Ok(body) => body,
                    Err(message) => return Ok(refusal(StatusCode::BAD_REQUEST, message)),
                };
                exchange(control, body).await
            })
            .await?
    };
    match tokio::time::timeout(Duration::from_secs(20), operation).await {
        Ok(Ok(response)) => response,
        Ok(Err(message)) => refusal(StatusCode::BAD_GATEWAY, message),
        Err(_) => refusal(
            StatusCode::GATEWAY_TIMEOUT,
            "QuickConnect discovery timed out.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_has_independent_inflight_and_admission_limits_and_closes_both() {
        let control = ReviewedQuickConnectControl::fixture(
            reqwest::Client::builder().no_proxy().build().unwrap(),
        );
        let downloads = control.downloads.try_acquire_many(2).unwrap();
        assert!(control.downloads.try_acquire().is_err());
        let requests = control.requests.try_acquire_many(8).unwrap();
        assert!(control.requests.try_acquire().is_err());
        drop(downloads);
        drop(requests);
        control.revoke();
        assert!(control.downloads.try_acquire().is_err());
        assert!(control.requests.try_acquire().is_err());
    }
}
