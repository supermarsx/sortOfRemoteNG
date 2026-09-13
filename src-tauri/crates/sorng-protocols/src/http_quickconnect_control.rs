//! Closed anonymous QuickConnect discovery RPC. No arbitrary URLs, inherited
//! website credentials or tunnel requests. Verified replies may enroll bounded
//! original-NAS probe/control destinations in a private document registry.
#[path = "http_quickconnect_discovered.rs"]
mod discovered;
use super::AxumProxyState;
use axum::body::Body;
use axum::http::{Method, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;

pub(super) const PATH: &str = "/__sortofremoteng_quickconnect_control_v1";
pub(super) const UPSTREAM: &str = "https://global.quickconnect.to/Serv.php";
pub(super) const DOCUMENT_HEADER: &str = "x-sorng-quickconnect-document";
pub(super) const DISCOVERED_PATH: &str = discovered::PATH;
const MAX_REQUEST: usize = 4096;
const MAX_RESPONSE: usize = 256 * 1024;

#[derive(Clone)]
pub(super) struct ObservedDestination {
    pub(super) description: String,
}

struct LearningTicket<'a> {
    registry: &'a std::sync::Mutex<discovered::Registry>,
    ticket: discovered::Ticket,
}
impl Drop for LearningTicket<'_> {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.finish(self.ticket);
        }
    }
}

pub(super) struct ReviewedQuickConnectControl {
    client: reqwest::Client,
    requests: Semaphore,
    downloads: Semaphore,
    discovered: std::sync::Mutex<discovered::Registry>,
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
            discovered: Default::default(),
        }
    }
    #[cfg(test)]
    pub(super) fn fixture(client: reqwest::Client) -> Self {
        Self::from_client(client)
    }
    pub(super) fn revoke(&self) {
        self.requests.close();
        self.downloads.close();
        if let Ok(mut registry) = self.discovered.lock() {
            registry.revoke();
        }
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
    if let Some(alias) = defaults.nas_alias() {
        value["rpc"] =
            serde_json::json!({"upstreamUrl":UPSTREAM,"proxyUrl":format!("{proxy}{PATH}")});
        value["discovered"] = serde_json::json!({"version":1,"alias":alias,"proxyUrl":format!("{proxy}{DISCOVERED_PATH}")});
        value["directNavigation"] = serde_json::json!({"version":1,"alias":alias});
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

struct Exchange<'a> {
    state: &'a AxumProxyState,
    sequence: u64,
    alias: &'a str,
    url: reqwest::Url,
    route: discovered::Route,
    body: Vec<u8>,
    learned: bool,
}

async fn exchange(
    control: &ReviewedQuickConnectControl,
    exchange: Exchange<'_>,
) -> Result<Response<Body>, &'static str> {
    let _download = control
        .downloads
        .acquire()
        .await
        .map_err(|_| "QuickConnect discovery ended.")?;
    if exchange.learned
        && !control.discovered.lock().is_ok_and(|registry| {
            registry.allows(exchange.sequence, exchange.alias, &exchange.url)
                == Some(exchange.route)
        })
    {
        return Err("QuickConnect destination is not approved for this document.");
    }
    let ticket = if exchange.route == discovered::Route::Control {
        Some(LearningTicket {
            registry: &control.discovered,
            ticket: control
                .discovered
                .lock()
                .map_err(|_| "QuickConnect discovery is unavailable.")?
                .begin(exchange.sequence, exchange.alias)
                .ok_or("QuickConnect discovery is stale.")?,
        })
    } else {
        None
    };
    let request = match exchange.route {
        discovered::Route::Control => control
            .client
            .post(exchange.url)
            .header(
                "Content-Type",
                "application/x-www-form-urlencoded; charset=UTF-8",
            )
            .body(exchange.body),
        discovered::Route::Probe => control
            .client
            .get(exchange.url)
            .header("Origin", &exchange.state.target_origin),
    };
    let mut response = request
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity")
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
    if exchange.route == discovered::Route::Probe {
        let allowed = response.headers().get_all("access-control-allow-origin");
        if allowed.iter().count() != 1
            || !allowed
                .iter()
                .next()
                .and_then(|value| value.to_str().ok())
                .is_some_and(|origin| origin == "*" || origin == exchange.state.target_origin)
        {
            return Err("QuickConnect probe did not permit this anonymous source origin.");
        }
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
    if exchange.route == discovered::Route::Probe
        && !discovered::valid_probe_json(&json, exchange.alias)
    {
        return Err("QuickConnect probe did not identify the original NAS alias.");
    }
    let bytes =
        serde_json::to_vec(&json).map_err(|_| "QuickConnect discovery JSON is unavailable.")?;
    if bytes.len() > MAX_RESPONSE {
        return Err("QuickConnect discovery response is too large.");
    }
    if status.is_success()
        && exchange
            .state
            .network
            .document_is_current(exchange.sequence)
    {
        if let Some(ticket) = ticket {
            if let Ok(mut registry) = control.discovered.lock() {
                if exchange
                    .state
                    .network
                    .document_is_current(exchange.sequence)
                    && !registry.learn(ticket.ticket, &json)
                {
                    return Err("QuickConnect discovery response is no longer current.");
                }
            }
        }
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
    let origin_optional = request.method() == Method::GET
        && request.uri().path() == DISCOVERED_PATH
        && [
            ("sec-fetch-site", "same-origin"),
            ("sec-fetch-dest", "empty"),
        ]
        .into_iter()
        .all(|(name, expected)| {
            headers.get_all(name).iter().count() == 1
                && headers
                    .get(name)
                    .is_some_and(|value| value.as_bytes() == expected.as_bytes())
        })
        && headers.get_all("sec-fetch-mode").iter().count() == 1
        && headers
            .get("sec-fetch-mode")
            .is_some_and(|value| matches!(value.as_bytes(), b"cors" | b"same-origin"));
    if !super::proxy_request_headers_are_authorized(
        headers,
        &state.proxy_authority,
        &state.proxy_origin,
    ) || headers.get_all("host").iter().count() != 1
        || headers.get_all("origin").iter().count() > 1
        || (headers.contains_key("origin")
            && headers.get("origin").and_then(|value| value.to_str().ok())
                != Some(state.proxy_origin.as_str()))
        || (!headers.contains_key("origin") && !origin_optional)
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
    let learned = request.uri().path() == DISCOVERED_PATH;
    let post = request.method() == Method::POST;
    let destination = if learned {
        super::quickconnect::decode_destination(request.uri().query())
    } else if request.uri().path() == PATH && request.uri().query().is_none() {
        reqwest::Url::parse(UPSTREAM).ok()
    } else {
        None
    };
    if destination.is_none()
        || !(post || learned && request.method() == Method::GET)
        || headers.get_all(DOCUMENT_HEADER).iter().count() != 1
        || sequence.is_none()
        || (post
            && (headers.get_all("content-type").iter().count() != 1
                || !mime.is_some_and(|mime| {
                    mime.eq_ignore_ascii_case("application/json")
                        || mime.eq_ignore_ascii_case("application/x-www-form-urlencoded")
                })))
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
            "Only protected QuickConnect discovery POSTs and approved GET probes are supported.",
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
    let destination = destination.unwrap();
    let route = if learned {
        discovered::classify(&destination, &alias)
    } else {
        Some(discovered::Route::Control)
    };
    let Some(route) = route.filter(|route| post == (*route == discovered::Route::Control)) else {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Unsupported QuickConnect destination request.",
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
    let approved = std::sync::atomic::AtomicBool::new(false);
    let description = format!(
        "{}: {}",
        match route {
            discovered::Route::Control => "QuickConnect regional discovery",
            discovered::Route::Probe => "QuickConnect NAS probe",
        },
        destination.origin().ascii_serialization()
    );
    let operation = async {
        state.network.await_document(sequence).await?;
        state
            .network
            .while_document(sequence, async {
                if learned
                    && !control.discovered.lock().is_ok_and(|registry| {
                        registry.allows(sequence, &alias, &destination) == Some(route)
                    })
                {
                    return Ok(refusal(
                        StatusCode::FORBIDDEN,
                        "QuickConnect destination is not approved for this document.",
                    ));
                }
                approved.store(true, std::sync::atomic::Ordering::Relaxed);
                let bytes = match axum::body::to_bytes(request.into_body(), MAX_REQUEST).await {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        return Ok(refusal(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "QuickConnect discovery request exceeds its limit.",
                        ))
                    }
                };
                let body = match if post {
                    validated_body(&bytes, &alias)
                } else if bytes.is_empty() {
                    Ok(Vec::new())
                } else {
                    Err("QuickConnect probes cannot carry a body.")
                } {
                    Ok(body) => body,
                    Err(message) => return Ok(refusal(StatusCode::BAD_REQUEST, message)),
                };
                exchange(
                    control,
                    Exchange {
                        state: &state,
                        sequence,
                        alias: &alias,
                        url: destination,
                        route,
                        body,
                        learned,
                    },
                )
                .await
            })
            .await?
    };
    let mut response = match tokio::time::timeout(Duration::from_secs(20), operation).await {
        Ok(Ok(response)) => response,
        Ok(Err(message)) => refusal(StatusCode::BAD_GATEWAY, message),
        Err(_) => refusal(
            StatusCode::GATEWAY_TIMEOUT,
            "QuickConnect discovery timed out.",
        ),
    };
    if learned && approved.load(std::sync::atomic::Ordering::Relaxed) {
        response
            .extensions_mut()
            .insert(ObservedDestination { description });
    }
    response
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
