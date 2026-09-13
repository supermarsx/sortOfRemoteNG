//! Closed anonymous QuickConnect discovery and tunnel-setup RPCs. No arbitrary
//! URLs or inherited website credentials. The closed provider-control namespace
//! and fixed same-NAS probe operation are authorized by original-NAS defaults.
//! Every exchange still requires the current native document lease.
#[path = "http_quickconnect_discovered.rs"]
mod discovered;
#[path = "http_quickconnect_probe_identities.rs"]
mod probe_identities;
use super::AxumProxyState;
use axum::body::Body;
use axum::http::{Method, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::Semaphore;
use tokio::time::Instant;

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

/// Native-only fixed diagnostics. Never classify by copying a caller's URL,
/// headers/body or a provider response/error into the request log.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Diagnostic {
    RequestAuthority,
    UnsupportedRequest,
    DefaultsDisabled,
    SourceScope,
    Unavailable,
    RequestLimit,
    BodyLimit,
    UnsupportedBody,
    StaleDocument,
    Transport,
    Timeout,
    UpstreamStatus,
    Connect,
    Tls,
    QueueTimeout,
    ExchangeTimeout,
    ResponseRead,
    UpstreamRedirect,
    Cors,
    Encoding,
    ResponseSize,
    Utf8,
    Json,
    ProbeIdentity,
}
impl Diagnostic {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::RequestAuthority => "quickconnect_request_authority",
            Self::UnsupportedRequest => "quickconnect_unsupported_request",
            Self::DefaultsDisabled => "quickconnect_defaults_disabled",
            Self::SourceScope => "quickconnect_source_scope",
            Self::Unavailable => "quickconnect_verified_route_unavailable",
            Self::RequestLimit => "quickconnect_request_limit",
            Self::BodyLimit => "quickconnect_body_limit",
            Self::UnsupportedBody => "quickconnect_unsupported_body",
            Self::StaleDocument => "quickconnect_stale_document",
            Self::Transport => "quickconnect_verified_exchange_failed",
            Self::Timeout => "quickconnect_timeout",
            Self::UpstreamStatus => "quickconnect_upstream_status",
            Self::Connect => "quickconnect_connect_failed",
            Self::Tls => "quickconnect_tls_failed",
            Self::QueueTimeout => "quickconnect_queue_timeout",
            Self::ExchangeTimeout => "quickconnect_exchange_timeout",
            Self::ResponseRead => "quickconnect_response_read_failed",
            Self::UpstreamRedirect => "quickconnect_upstream_redirect",
            Self::Cors => "quickconnect_cors_rejected",
            Self::Encoding => "quickconnect_response_encoding",
            Self::ResponseSize => "quickconnect_response_size",
            Self::Utf8 => "quickconnect_response_utf8",
            Self::Json => "quickconnect_response_json",
            Self::ProbeIdentity => "quickconnect_probe_identity_mismatch",
        }
    }
}

macro_rules! observation_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub(super) enum $name { $($variant),+ }
        impl $name {
            pub(super) fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $value),+ }
            }
        }
    };
}
observation_enum!(ExchangePhase {
    Request => "quickconnect_request", Discovery => "quickconnect_discovery",
    Tunnel => "quickconnect_tunnel", DirectProbe => "quickconnect_direct_probe",
    RelayProbe => "quickconnect_relay_probe",
});
observation_enum!(ExchangeStage {
    Validation => "validation", DocumentWait => "document_wait", RequestBody => "request_body",
    Queue => "queue", ConnectTls => "connect_tls", ResponseHeaders => "response_headers",
    ResponseBody => "response_body", ResponseValidation => "response_validation", Complete => "complete",
});
observation_enum!(ExchangeOutcome {
    Refused => "refused", Cancelled => "cancelled", TimedOut => "timed_out",
    Failed => "failed", HttpError => "http_error", Succeeded => "succeeded",
});
observation_enum!(ExchangeLane { Control => "control", DirectProbe => "direct_probe", RelayProbe => "relay_probe" });

/// Safe native-only metadata; never populated from arbitrary error strings.
#[derive(Clone, Debug)]
pub(super) struct ExchangeObservation {
    pub(super) phase: ExchangePhase,
    pub(super) stage: ExchangeStage,
    pub(super) outcome: ExchangeOutcome,
    pub(super) lane: Option<ExchangeLane>,
    pub(super) duration_ms: u64,
    pub(super) queue_ms: Option<u64>,
    pub(super) active_ms: Option<u64>,
    pub(super) upstream_status: Option<u16>,
}

struct ProgressState {
    phase: ExchangePhase,
    stage: ExchangeStage,
    lane: Option<ExchangeLane>,
    queued: Option<Instant>,
    queue_ms: Option<u64>,
    active: Option<Instant>,
    upstream_status: Option<u16>,
}
struct Progress {
    started: Instant,
    state: Mutex<ProgressState>,
}
fn milliseconds(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}
impl Progress {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            state: Mutex::new(ProgressState {
                phase: ExchangePhase::Request,
                stage: ExchangeStage::Validation,
                lane: None,
                queued: None,
                queue_ms: None,
                active: None,
                upstream_status: None,
            }),
        }
    }
    fn stage(&self, stage: ExchangeStage) {
        self.state.lock().unwrap().stage = stage;
    }
    fn observation(&self, diagnostic: Diagnostic, status: StatusCode) -> ExchangeObservation {
        let state = self.state.lock().unwrap();
        let outcome = match diagnostic {
            Diagnostic::StaleDocument => ExchangeOutcome::Cancelled,
            Diagnostic::QueueTimeout | Diagnostic::ExchangeTimeout | Diagnostic::Timeout => {
                ExchangeOutcome::TimedOut
            }
            Diagnostic::UpstreamStatus if status.is_success() => ExchangeOutcome::Succeeded,
            Diagnostic::UpstreamStatus => ExchangeOutcome::HttpError,
            Diagnostic::Connect
            | Diagnostic::Tls
            | Diagnostic::Transport
            | Diagnostic::ResponseRead
            | Diagnostic::UpstreamRedirect
            | Diagnostic::Cors
            | Diagnostic::Encoding
            | Diagnostic::ResponseSize
            | Diagnostic::Utf8
            | Diagnostic::Json
            | Diagnostic::ProbeIdentity => ExchangeOutcome::Failed,
            _ => ExchangeOutcome::Refused,
        };
        ExchangeObservation {
            phase: state.phase,
            stage: state.stage,
            outcome,
            lane: state.lane,
            duration_ms: milliseconds(self.started.elapsed()),
            queue_ms: state
                .queue_ms
                .or_else(|| state.queued.map(|start| milliseconds(start.elapsed()))),
            active_ms: state.active.map(|start| milliseconds(start.elapsed())),
            upstream_status: state.upstream_status,
        }
    }
}

struct LaneLimits {
    admitted: Semaphore,
    active: Semaphore,
}
impl LaneLimits {
    fn new(admitted: usize, active: usize) -> Self {
        Self {
            admitted: Semaphore::new(admitted),
            active: Semaphore::new(active),
        }
    }
    fn close(&self) {
        self.admitted.close();
        self.active.close();
    }
}
impl ExchangeLane {
    // Called only after strict destination classification. Valid regional probes
    // use 443; valid direct probes use 5001/5002. This adds no URL permission.
    fn classified(route: discovered::Route, url: &reqwest::Url) -> Self {
        match route {
            discovered::Route::Control => Self::Control,
            discovered::Route::Probe if url.port_or_known_default() == Some(443) => {
                Self::RelayProbe
            }
            discovered::Route::Probe => Self::DirectProbe,
        }
    }
    fn queue_budget(self) -> Duration {
        Duration::from_secs(if self == Self::Control { 2 } else { 1 })
    }
    fn network_budget(self) -> Duration {
        Duration::from_secs(match self {
            Self::Control => 25,
            Self::RelayProbe => 12,
            Self::DirectProbe => 4,
        })
    }
    fn total_budget(self) -> Duration {
        Duration::from_secs(match self {
            Self::Control => 29,
            Self::RelayProbe => 14,
            Self::DirectProbe => 5,
        })
    }
}

pub(super) struct ReviewedQuickConnectControl {
    client: reqwest::Client,
    control: LaneLimits,
    direct_probes: LaneLimits,
    relay_probes: LaneLimits,
    probe_identities: probe_identities::ProbeIdentities,
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
            .retry(reqwest::retry::never())
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
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
            control: LaneLimits::new(4, 2),
            direct_probes: LaneLimits::new(8, 4),
            relay_probes: LaneLimits::new(4, 1),
            probe_identities: probe_identities::ProbeIdentities::default(),
        }
    }
    #[cfg(test)]
    pub(super) fn fixture(client: reqwest::Client) -> Self {
        Self::from_client(client)
    }
    pub(super) fn revoke(&self) {
        self.control.close();
        self.direct_probes.close();
        self.relay_probes.close();
        self.probe_identities.revoke();
    }
    fn lane(&self, lane: ExchangeLane) -> &LaneLimits {
        match lane {
            ExchangeLane::Control => &self.control,
            ExchangeLane::DirectProbe => &self.direct_probes,
            ExchangeLane::RelayProbe => &self.relay_probes,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operation {
    Discovery,
    Tunnel,
    Probe,
}

struct ValidatedBody {
    operation: Operation,
    bytes: Vec<u8>,
}

fn validated_body(bytes: &[u8], alias: &str) -> Result<ValidatedBody, &'static str> {
    let invalid = "Unsupported QuickConnect control request.";
    if bytes.len() > MAX_REQUEST {
        return Err(invalid);
    }
    let commands: Vec<ControlCommand> = serde_json::from_slice(bytes).map_err(|_| invalid)?;
    if !matches!(commands.len(), 1 | 2) {
        return Err(invalid);
    }
    for command in &commands {
        if command.version != 1
            || command.stop_when_error
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
    let operation = match commands.as_slice() {
        [https, http]
            if https.command == "get_server_info"
                && http.command == "get_server_info"
                && https.id == "mainapp_https"
                && http.id == "mainapp_http"
                && !https.stop_when_success
                && !http.stop_when_success
                && https.path == http.path =>
        {
            Operation::Discovery
        }
        [tunnel]
            if tunnel.command == "request_tunnel"
                && matches!(tunnel.id.as_str(), "mainapp_https" | "mainapp_http")
                && tunnel.stop_when_success =>
        {
            Operation::Tunnel
        }
        _ => return Err(invalid),
    };
    let bytes = serde_json::to_vec(&commands).map_err(|_| invalid)?;
    Ok(ValidatedBody { operation, bytes })
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
        value["regionalNavigation"] = serde_json::json!({"version":1,"alias":alias});
    }
    Some(value)
}

fn refusal(status: StatusCode, message: &'static str, diagnostic: Diagnostic) -> Response<Body> {
    Response::builder()
        .status(status)
        .extension(diagnostic)
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
    operation: Operation,
    body: Vec<u8>,
    dynamic_route: bool,
    lane: ExchangeLane,
}

type ExchangeFailure = (Diagnostic, &'static str);
fn transport_failure(error: &reqwest::Error, reading: bool) -> ExchangeFailure {
    let mut cause: Option<&(dyn Error + 'static)> = Some(error);
    // Bounded typed traversal only. Never infer TLS/DNS from exception text.
    for _ in 0..32 {
        let Some(current) = cause else {
            break;
        };
        if current.downcast_ref::<rustls::Error>().is_some() {
            return (
                Diagnostic::Tls,
                "QuickConnect TLS verification or handshake failed.",
            );
        }
        cause = if let Some(io) = current.downcast_ref::<std::io::Error>() {
            io.get_ref()
                .map(|inner| inner as &(dyn Error + 'static))
                .or_else(|| current.source())
        } else {
            current.source()
        };
    }
    if error.is_timeout() {
        (
            Diagnostic::ExchangeTimeout,
            "QuickConnect network exchange timed out.",
        )
    } else if error.is_connect() {
        (
            Diagnostic::Connect,
            "QuickConnect connection failed; no alternate route was attempted.",
        )
    } else if reading {
        (
            Diagnostic::ResponseRead,
            "QuickConnect response could not be read completely.",
        )
    } else {
        (
            Diagnostic::Transport,
            "Verified QuickConnect exchange failed; its transport cause is unavailable.",
        )
    }
}

async fn exchange(
    control: &ReviewedQuickConnectControl,
    exchange: Exchange<'_>,
    progress: &Progress,
) -> Result<Response<Body>, ExchangeFailure> {
    if exchange.operation == Operation::Tunnel
        && (!exchange.dynamic_route
            || exchange.route != discovered::Route::Control
            || exchange.url.as_str() == UPSTREAM)
    {
        return Err((
            Diagnostic::UnsupportedRequest,
            "QuickConnect tunnel setup requires an approved regional control route.",
        ));
    }
    {
        let mut trace = progress.state.lock().unwrap();
        trace.stage = ExchangeStage::Queue;
        trace.queued = Some(Instant::now());
    }
    let _download = tokio::time::timeout(
        exchange.lane.queue_budget(),
        control.lane(exchange.lane).active.acquire(),
    )
    .await
    .map_err(|_| {
        (
            Diagnostic::QueueTimeout,
            "QuickConnect capacity queue timed out.",
        )
    })?
    .map_err(|_| (Diagnostic::StaleDocument, "QuickConnect exchange ended."))?;
    {
        let mut trace = progress.state.lock().unwrap();
        trace.queue_ms = trace.queued.map(|start| milliseconds(start.elapsed()));
        trace.active = Some(Instant::now());
        trace.stage = ExchangeStage::ConnectTls;
    }
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
        .timeout(exchange.lane.network_budget())
        .send()
        .await
        .map_err(|error| transport_failure(&error, false))?;
    let status = response.status();
    {
        let mut trace = progress.state.lock().unwrap();
        trace.stage = ExchangeStage::ResponseHeaders;
        trace.upstream_status = Some(status.as_u16());
    }
    if status.is_redirection() {
        return Err((
            Diagnostic::UpstreamRedirect,
            "QuickConnect exchange redirects are not followed.",
        ));
    }
    if !(200..600).contains(&status.as_u16()) {
        return Err((
            Diagnostic::UpstreamStatus,
            "Unsupported QuickConnect HTTP status.",
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE as u64)
    {
        return Err((
            Diagnostic::ResponseSize,
            "QuickConnect response exceeds its size limit.",
        ));
    }
    if response
        .headers()
        .get_all("content-encoding")
        .iter()
        .count()
        > 1
        || response
            .headers()
            .get("content-encoding")
            .is_some_and(|value| value.as_bytes() != b"identity")
    {
        return Err((
            Diagnostic::Encoding,
            "QuickConnect response encoding is unsupported.",
        ));
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
            return Err((
                Diagnostic::Cors,
                "QuickConnect probe did not permit this anonymous source origin.",
            ));
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
    progress.stage(ExchangeStage::ResponseBody);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_failure(&error, true))?
    {
        if chunk.len() > MAX_RESPONSE - bytes.len() {
            return Err((
                Diagnostic::ResponseSize,
                "QuickConnect response exceeds its size limit.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    progress.stage(ExchangeStage::ResponseValidation);
    let text = std::str::from_utf8(&bytes).map_err(|_| {
        (
            Diagnostic::Utf8,
            "QuickConnect response is not valid UTF-8.",
        )
    })?;
    let json: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| (Diagnostic::Json, "QuickConnect response is not valid JSON."))?;
    if exchange.route == discovered::Route::Probe
        && !control
            .probe_identities
            .accepts(exchange.sequence, exchange.alias, &json)
    {
        return Err((
            Diagnostic::ProbeIdentity,
            "QuickConnect probe did not match an approved current-document NAS identity.",
        ));
    }
    let bytes = serde_json::to_vec(&json).map_err(|_| {
        (
            Diagnostic::Json,
            "QuickConnect response JSON is unavailable.",
        )
    })?;
    if bytes.len() > MAX_RESPONSE {
        return Err((
            Diagnostic::ResponseSize,
            "QuickConnect response exceeds its size limit.",
        ));
    }
    if status.is_success()
        && exchange.route == discovered::Route::Control
        && exchange
            .state
            .network
            .document_is_current(exchange.sequence)
    {
        control
            .probe_identities
            .learn(exchange.sequence, exchange.alias, &json);
    }
    let mut builder = Response::builder()
        .status(status.as_u16())
        .extension(Diagnostic::UpstreamStatus)
        .header("Content-Type", "application/json")
        .header("Content-Length", bytes.len())
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin");
    if let Some(ip) = client_ip {
        builder = builder.header("X-QC-CLIENT-IP", ip);
    }
    progress.stage(ExchangeStage::Complete);
    Ok(builder
        .body(Body::from(bytes))
        .expect("validated discovery response"))
}

pub(super) async fn handle(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
) -> Response<Body> {
    let progress = Progress::new();
    let mut response = handle_inner(state, request, &progress).await;
    let diagnostic = *response
        .extensions()
        .get::<Diagnostic>()
        .expect("closed QuickConnect diagnostic");
    let observation = progress.observation(diagnostic, response.status());
    response.extensions_mut().insert(observation);
    response
}

async fn handle_inner(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
    progress: &Progress,
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
            Diagnostic::RequestAuthority,
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
    let dynamic_route = request.uri().path() == DISCOVERED_PATH;
    let post = request.method() == Method::POST;
    let destination = if dynamic_route {
        super::quickconnect::decode_destination(request.uri().query())
    } else if request.uri().path() == PATH && request.uri().query().is_none() {
        reqwest::Url::parse(UPSTREAM).ok()
    } else {
        None
    };
    if destination.is_none()
        || !(post || dynamic_route && request.method() == Method::GET)
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
            "Only protected QuickConnect control POSTs and approved GET probes are supported.",
            Diagnostic::UnsupportedRequest,
        );
    }
    let Some(defaults) = state.proxy_policy.synology_quick_connect_defaults.as_ref() else {
        return refusal(
            StatusCode::FORBIDDEN,
            "QuickConnect discovery defaults are disabled.",
            Diagnostic::DefaultsDisabled,
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
            Diagnostic::SourceScope,
        );
    };
    let destination = destination.unwrap();
    let route = if dynamic_route {
        discovered::classify(&destination, &alias)
    } else {
        Some(discovered::Route::Control)
    };
    let Some(route) = route.filter(|route| post == (*route == discovered::Route::Control)) else {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Unsupported QuickConnect destination request.",
            Diagnostic::UnsupportedRequest,
        );
    };
    let lane = ExchangeLane::classified(route, &destination);
    {
        let mut trace = progress.state.lock().unwrap();
        trace.lane = Some(lane);
        trace.phase = match lane {
            ExchangeLane::Control => ExchangePhase::Request,
            ExchangeLane::DirectProbe => ExchangePhase::DirectProbe,
            ExchangeLane::RelayProbe => ExchangePhase::RelayProbe,
        };
    }
    let Some(control) = state.network.quickconnect_control.as_ref() else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "Verified QuickConnect discovery is unavailable.",
            Diagnostic::Unavailable,
        );
    };
    let Ok(_request) = control.lane(lane).admitted.try_acquire() else {
        if control.lane(lane).admitted.is_closed() {
            return refusal(
                StatusCode::FORBIDDEN,
                "QuickConnect exchange ended.",
                Diagnostic::StaleDocument,
            );
        }
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "QuickConnect discovery request limit reached.",
            Diagnostic::RequestLimit,
        );
    };
    let sequence = sequence.unwrap();
    let approved = std::sync::atomic::AtomicBool::new(false);
    let candidate_current = std::sync::atomic::AtomicBool::new(false);
    let tunnel_requested = std::sync::atomic::AtomicBool::new(false);
    let destination_origin = destination.origin().ascii_serialization();
    let operation = async {
        progress.stage(ExchangeStage::DocumentWait);
        state
            .network
            .await_document(sequence)
            .await
            .map_err(|message| (Diagnostic::StaleDocument, message))?;
        state
            .network
            .while_document(sequence, async {
                if !control.probe_identities.prepare(sequence, &alias) {
                    return Err((Diagnostic::StaleDocument, "The proxy identity scope is no longer active."));
                }
                candidate_current.store(true, std::sync::atomic::Ordering::Relaxed);
                progress.stage(ExchangeStage::RequestBody);
                let bytes = match tokio::time::timeout(Duration::from_secs(2), axum::body::to_bytes(request.into_body(), MAX_REQUEST))
                    .await.map_err(|_| (Diagnostic::Timeout, "QuickConnect request body timed out."))? {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        return Ok(refusal(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "QuickConnect discovery request exceeds its limit.",
                            Diagnostic::BodyLimit,
                        ))
                    }
                };
                let body = match if post {
                    validated_body(&bytes, &alias)
                } else if bytes.is_empty() {
                    Ok(ValidatedBody {
                        operation: Operation::Probe,
                        bytes: Vec::new(),
                    })
                } else {
                    Err("QuickConnect probes cannot carry a body.")
                } {
                    Ok(body) => body,
                    Err(message) => {
                        return Ok(refusal(
                            StatusCode::BAD_REQUEST,
                            message,
                            Diagnostic::UnsupportedBody,
                        ))
                    }
                };
                progress.state.lock().unwrap().phase = match body.operation {
                    Operation::Discovery => ExchangePhase::Discovery,
                    Operation::Tunnel => ExchangePhase::Tunnel,
                    Operation::Probe if lane == ExchangeLane::RelayProbe => ExchangePhase::RelayProbe,
                    Operation::Probe => ExchangePhase::DirectProbe,
                };
                if body.operation == Operation::Tunnel {
                    tunnel_requested.store(true, std::sync::atomic::Ordering::Relaxed);
                    if !dynamic_route || destination.as_str() == UPSTREAM {
                        return Ok(refusal(
                            StatusCode::BAD_REQUEST,
                            "QuickConnect tunnel setup requires an approved regional control route.",
                            Diagnostic::UnsupportedRequest,
                        ));
                    }
                }
                // Defaults authorize the closed original-alias control body
                // and fixed anonymous same-NAS pingpong GET. Vendor discovery
                // may be cached or precede this new proxy/document, so response
                // enrollment is not authority. classify(), source defaults and
                // while_document retain URL, owner and lifetime boundaries;
                // probe TLS, upstream CORS and ezid are checked independently.
                approved.store(true, std::sync::atomic::Ordering::Relaxed);
                exchange(
                    control,
                    Exchange {
                        state: &state,
                        sequence,
                        alias: &alias,
                        url: destination,
                        route,
                        operation: body.operation,
                        body: body.bytes,
                        dynamic_route,
                        lane,
                    },
                    progress,
                )
                .await
            })
            .await
            .map_err(|message| (Diagnostic::StaleDocument, message))?
    };
    let mut response = match tokio::time::timeout(lane.total_budget(), operation).await {
        Ok(Ok(response)) => response,
        Ok(Err((diagnostic, message))) => refusal(
            if matches!(
                diagnostic,
                Diagnostic::Timeout | Diagnostic::QueueTimeout | Diagnostic::ExchangeTimeout
            ) {
                StatusCode::GATEWAY_TIMEOUT
            } else {
                StatusCode::BAD_GATEWAY
            },
            message,
            diagnostic,
        ),
        Err(_) => refusal(
            StatusCode::GATEWAY_TIMEOUT,
            "QuickConnect discovery timed out.",
            Diagnostic::Timeout,
        ),
    };
    let tunnel_requested = tunnel_requested.load(std::sync::atomic::Ordering::Relaxed);
    if (dynamic_route || tunnel_requested)
        && candidate_current.load(std::sync::atomic::Ordering::Relaxed)
    {
        let description = format!(
            "{}: {destination_origin}",
            if tunnel_requested {
                "QuickConnect tunnel setup"
            } else {
                match route {
                    discovered::Route::Control => "QuickConnect regional discovery",
                    discovered::Route::Probe => "QuickConnect NAS probe",
                }
            }
        );
        let description = if approved.load(std::sync::atomic::Ordering::Relaxed) {
            description
        } else {
            format!("Attempted {description}")
        };
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
    fn control_direct_and_relay_have_independent_bounded_capacity_and_close_together() {
        let control = ReviewedQuickConnectControl::fixture(
            reqwest::Client::builder().no_proxy().build().unwrap(),
        );
        let direct = control.direct_probes.active.try_acquire_many(4).unwrap();
        let direct_admitted = control.direct_probes.admitted.try_acquire_many(8).unwrap();
        let relay = control.relay_probes.active.try_acquire().unwrap();
        let relay_admitted = control.relay_probes.admitted.try_acquire_many(4).unwrap();
        let active_control = control.control.active.try_acquire_many(2).unwrap();
        let admitted_control = control.control.admitted.try_acquire_many(4).unwrap();
        for lane in [
            &control.control,
            &control.direct_probes,
            &control.relay_probes,
        ] {
            assert!(lane.active.try_acquire().is_err());
            assert!(lane.admitted.try_acquire().is_err());
        }
        drop((
            direct,
            direct_admitted,
            relay,
            relay_admitted,
            active_control,
            admitted_control,
        ));
        control.revoke();
        for lane in [
            &control.control,
            &control.direct_probes,
            &control.relay_probes,
        ] {
            assert!(lane.active.try_acquire().is_err());
            assert!(lane.admitted.try_acquire().is_err());
        }
    }
}
