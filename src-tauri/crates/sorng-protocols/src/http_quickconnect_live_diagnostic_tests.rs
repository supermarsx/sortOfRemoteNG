//! Opt-in anonymous document evidence through the real protected mediator.
//! This is not the running application's session or a browser/JavaScript test.
//! Run only after review, with SORNG_QC_DOCUMENT_DIAGNOSTIC_TARGET set to the
//! user-authorized canonical HTTPS regional root and
//! SORNG_QC_DOCUMENT_DIAGNOSTIC_CONFIRM=anonymous-two-document-gets.
//! The alias root is derived from that exact original NAS. Measurement profiles
//! do not consume receipts. The separate native-flow confirmation adds bounded
//! read-only discovery and one consumed handoff, never request_tunnel, credentials,
//! arbitrary foreign redirects, or a direct-client fallback.
use super::*;
use serde_json::{json, Value};
use std::time::Duration;

const MARKER: &str = "0123456789abcdef0123456789abcdef";
const BODY_LIMIT: usize = 2 * 1024 * 1024;
const CAPTURED_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0";
const FIXED_APP_REFERER: &str = "http://localhost:3001/";

#[derive(Clone, Copy)]
enum ContextProfile {
    Minimal,
    UserAgent,
    AppReferer,
    UserAgentAndAppReferer,
    UserAgentAndAliasReferer,
    UserAgentAndRegionalReferer,
}
impl ContextProfile {
    fn label(self) -> &'static str {
        match self {
            Self::Minimal => "minimal_no_user_agent_or_referer",
            Self::UserAgent => "captured_user_agent_only",
            Self::AppReferer => "fixed_app_referer_only",
            Self::UserAgentAndAppReferer => "captured_user_agent_and_fixed_app_referer",
            Self::UserAgentAndAliasReferer => "captured_user_agent_and_exact_alias_referer",
            Self::UserAgentAndRegionalReferer => "captured_user_agent_and_exact_regional_referer",
        }
    }
    fn apply(
        self,
        request: reqwest::RequestBuilder,
        approved: &[reqwest::Url; 2],
    ) -> reqwest::RequestBuilder {
        let request = if matches!(
            self,
            Self::UserAgent
                | Self::UserAgentAndAppReferer
                | Self::UserAgentAndAliasReferer
                | Self::UserAgentAndRegionalReferer
        ) {
            request.header("User-Agent", CAPTURED_USER_AGENT)
        } else {
            request
        };
        match self {
            Self::AppReferer | Self::UserAgentAndAppReferer => {
                request.header("Referer", FIXED_APP_REFERER)
            }
            Self::UserAgentAndAliasReferer => request.header("Referer", approved[1].as_str()),
            Self::UserAgentAndRegionalReferer => request.header("Referer", approved[0].as_str()),
            _ => request,
        }
    }
}

fn targets(value: &str) -> Result<[reqwest::Url; 2], &'static str> {
    let regional = reqwest::Url::parse(value).map_err(|_| "Invalid diagnostic target")?;
    if regional.as_str() != value
        || regional.scheme() != "https"
        || regional.port().is_some()
        || regional.path() != "/"
        || regional.query().is_some()
        || regional.fragment().is_some()
        || !regional.username().is_empty()
        || regional.password().is_some()
    {
        return Err("A canonical HTTPS regional root without credentials is required");
    }
    let host = regional.host_str().ok_or("Diagnostic host is missing")?;
    let labels: Vec<_> = host.split('.').collect();
    if labels.len() != 4 || labels[2..] != ["quickconnect", "to"] {
        return Err("Only an explicitly authorized QuickConnect regional root is supported");
    }
    if [
        "global",
        "www",
        "relay",
        "account",
        "api",
        "portal",
        "help",
        "support",
        "connect",
        "discovery",
    ]
    .contains(&labels[0])
    {
        return Err("A NAS alias, not a reserved provider name, is required");
    }
    let region = labels[1].as_bytes();
    if !(3..=63).contains(&region.len())
        || !region[..2].iter().all(u8::is_ascii_lowercase)
        || !region[2..].iter().all(u8::is_ascii_digit)
    {
        return Err("The regional label is unsupported");
    }
    let defaults = SynologyQuickConnectDefaults {
        version: 1,
        original_origin: regional.origin().ascii_serialization(),
    };
    let policy = HttpProxyPolicy {
        synology_quick_connect_defaults: Some(defaults),
        ..Default::default()
    };
    policy
        .validate(&regional)
        .map_err(|_| "Invalid original NAS context")?;
    let alias = reqwest::Url::parse(&format!("https://{}.quickconnect.to/", labels[0]))
        .map_err(|_| "Invalid alias")?;
    Ok([regional, alias])
}

fn origin_relation(value: &str, approved: &[reqwest::Url; 2]) -> &'static str {
    let Ok(url) = reqwest::Url::parse(value) else {
        return "unknown";
    };
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return "unknown";
    }
    let origin = url.origin();
    if origin == approved[0].origin() {
        "regional"
    } else if origin == approved[1].origin() {
        "https_alias"
    } else if url.scheme() == "http"
        && url.host_str() == approved[1].host_str()
        && url.port().is_none()
    {
        "http_alias"
    } else {
        "other"
    }
}

fn closed<'a>(value: &'a str, allowed: &[&str]) -> &'a str {
    if allowed.contains(&value) {
        value
    } else {
        "unreported_or_unknown"
    }
}

fn public_text(value: &str, limit: usize, approved: &[reqwest::Url; 2]) -> String {
    let entities =
        regex::Regex::new(r"&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);").unwrap();
    let decoded = entities.replace_all(value, |capture: &regex::Captures<'_>| {
        let entity = &capture[1];
        let character = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .and_then(|v| u32::from_str_radix(v, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|v| v.parse().ok()))
                .and_then(char::from_u32),
        };
        character
            .filter(|value| !value.is_control())
            .unwrap_or(' ')
            .to_string()
    });
    let tags = regex::Regex::new(r"(?s)<[^>]*>").unwrap();
    let mut text = tags.replace_all(&decoded, " ").into_owned();
    let addresses = regex::Regex::new(r#"(?i)(?:https?://|www\.)[^\s<>"']+|\b[^\s<>"']+\.(?:[a-z]{2,}|[0-9]{1,3})(?::[0-9]+)?(?:/[^\s<>"']*)?"#).unwrap();
    text = addresses.replace_all(&text, "[address]").into_owned();
    // The original NAS alias can itself be a page title. Never print it.
    if let Some(alias) = approved[1]
        .host_str()
        .and_then(|host| host.split('.').next())
    {
        let alias = regex::Regex::new(&format!("(?i){}", regex::escape(alias))).unwrap();
        text = alias.replace_all(&text, "[NAS]").into_owned();
    }
    let identifiers = regex::Regex::new(r"(?i)\b(?:token|sid|session[_ -]?id|request[_ -]?id|nonce)\s*[:=]\s*\S+|\b(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-z0-9_-]{32,}|[0-9]{5,})\b").unwrap();
    text = identifiers.replace_all(&text, "[identifier]").into_owned();
    text.chars()
        .filter(|value| !value.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}

fn document_summary(html: &str, approved: &[reqwest::Url; 2]) -> Value {
    // Bounded anonymous title/headings only. Remove comments and all script/style
    // bodies (including injected clients) before examining visible text.
    let comments = regex::Regex::new(r"(?s)<!--.*?(?:-->|$)").unwrap();
    let html = comments.replace_all(html, " ");
    let scripts =
        regex::Regex::new(r#"(?is)<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>.*?(?:</script\s*>|$)"#)
            .unwrap();
    let source =
        regex::Regex::new(r#"(?i)\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap();
    let mut basenames = Vec::new();
    for script in scripts.captures_iter(&html) {
        let Some(attribute) = source.captures(&script[1]) else {
            continue;
        };
        let Some(value) = (1..=3).find_map(|index| attribute.get(index)) else {
            continue;
        };
        let Ok(url) = approved[0].join(value.as_str()) else {
            continue;
        };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let Some(name) = url
            .path_segments()
            .and_then(|mut segments| segments.next_back())
        else {
            continue;
        };
        if !(4..=128).contains(&name.len())
            || !name.ends_with(".js")
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b".-_".contains(&byte))
            || name.starts_with("__sortofremoteng")
            || basenames.iter().any(|old| old == name)
        {
            continue;
        }
        basenames.push(name.to_owned());
        if basenames.len() == 8 {
            break;
        }
    }
    let html = scripts.replace_all(&html, " ");
    let styles = regex::Regex::new(r"(?is)<style\b[^>]*>.*?(?:</style\s*>|$)").unwrap();
    let html = styles.replace_all(&html, " ");
    let title = regex::Regex::new(r"(?is)<title\b[^>]*>(.*?)</title\s*>")
        .unwrap()
        .captures(&html)
        .map(|capture| public_text(&capture[1], 120, approved));
    let headings: Vec<_> = regex::Regex::new(r"(?is)<h[1-6]\b[^>]*>(.*?)</h[1-6]\s*>")
        .unwrap()
        .captures_iter(&html)
        .take(2)
        .map(|capture| public_text(&capture[1], 160, approved))
        .collect();
    let visible = regex::Regex::new(r"(?s)<[^>]*>")
        .unwrap()
        .replace_all(&html, " ")
        .to_lowercase();
    json!({
        "title":title, "headings":headings, "script_basenames":basenames,
        "fixed_text_present":{
            "unsupported_browser":visible.contains("unsupported browser"),
            "not_supported":visible.contains("not supported"),
            "cannot_connect":visible.contains("cannot connect"),
            "synology":visible.contains("synology"),
            "diskstation":visible.contains("diskstation"),
        },
        "scope":"sanitized anonymous mediated title/headings; not login or JavaScript execution evidence",
    })
}

fn path_category(value: Option<Value>) -> Value {
    match value.and_then(|value| value.as_str().map(str::to_owned)) {
        Some(value) if ["root", "dsm", "other"].contains(&value.as_str()) => json!(value),
        _ => Value::Null,
    }
}

fn safe_log(entry: &ProxyRequestLogEntry, approved: &[reqwest::Url; 2]) -> Value {
    let mut result = json!({
        "response_origin_relation": origin_relation(&entry.url, approved),
        "local_status": (100..=599).contains(&entry.status).then_some(entry.status),
    });
    if let Some(diagnostic) = &entry.diagnostic {
        result["code"] = json!(closed(
            &diagnostic.code,
            &[
                "http_response",
                "http_transport_failed",
                "http_timeout",
                "http_redirect_loop",
                "http_redirect_review",
                "http_policy_refused",
                "http_response_invalid",
                "quickconnect_redirect_pending",
                "quickconnect_redirect_loop",
                "quickconnect_connector_restart",
                "quickconnect_upstream_status",
                "quickconnect_probe_identity_mismatch",
                "quickconnect_cors_rejected",
                "quickconnect_upstream_redirect",
                "quickconnect_stale_document",
                "quickconnect_tls_failed",
                "quickconnect_connect_failed",
                "quickconnect_unsupported_request",
            ]
        ));
        result["stage"] = json!(closed(
            &diagnostic.stage,
            &[
                "validation",
                "connect_tls",
                "response_headers",
                "response_body",
                "response_validation",
                "complete",
                "handoff",
                "document_wait",
                "queue",
                "request_body",
            ]
        ));
        result["outcome"] = json!(closed(
            &diagnostic.outcome,
            &[
                "refused",
                "cancelled",
                "timed_out",
                "failed",
                "http_error",
                "succeeded",
                "review_required",
                "continuing",
            ]
        ));
        result["upstream_status"] = json!(diagnostic
            .upstream_status
            .filter(|v| (100..=599).contains(v)));
        result["duration_ms"] = json!(diagnostic.duration_ms.min(86_400_000));
        result["same_origin_redirects"] =
            json!(diagnostic.same_origin_redirects.filter(|v| *v <= 20));
        result["source_path_category"] = path_category(
            diagnostic
                .redirect_source_path
                .and_then(|v| serde_json::to_value(v).ok()),
        );
        result["destination_path_category"] = path_category(
            diagnostic
                .redirect_target_path
                .and_then(|v| serde_json::to_value(v).ok()),
        );
        result["destination_origin_relation"] = json!(diagnostic
            .redirect_target_origin
            .as_deref()
            .map(|v| origin_relation(v, approved)));
        result["redirect_query_removed"] = json!(diagnostic.redirect_query_removed);
    }
    result
}

struct DiagnosticProxy {
    local_url: String,
    authority: String,
    state: Arc<AxumProxyState>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for DiagnosticProxy {
    fn drop(&mut self) {
        if let Some(attempt) = &self.state.attempt {
            attempt.revoke();
        }
        self.state.network.revoke();
        self.task.abort();
        if let Ok(mut manager) = self.state.global_sessions.lock() {
            manager.sessions.remove(&self.state.session_id);
            manager.discard_redirect_review(&self.state.session_id);
        }
    }
}

async fn mediator(
    target: &reqwest::Url,
    original: &reqwest::Url,
) -> Result<DiagnosticProxy, &'static str> {
    mediator_with_attempt(target, original, None).await
}

async fn mediator_with_attempt(
    target: &reqwest::Url,
    original: &reqwest::Url,
    context: Option<(ProxySessionManagerState, Option<String>)>,
) -> Result<DiagnosticProxy, &'static str> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let policy = HttpProxyPolicy {
        synology_quick_connect_defaults: Some(SynologyQuickConnectDefaults {
            version: 1,
            original_origin: original.origin().ascii_serialization(),
        }),
        ..Default::default()
    };
    let flow = context.is_some();
    let (manager, continuation) = context.unwrap_or_else(|| (ProxySessionManager::new(), None));
    let config: BasicAuthProxyConfig = serde_json::from_value(json!({
        "target_url":target.as_str(), "username":"", "password":"", "upstream_auth_mode":"none",
        "redirect_profile":"synology", "proxy_policy":policy, "verify_ssl":true,
        "min_tls_version":"1.2", "connection_id":"anonymous-document-diagnostic",
        "continuation_id":continuation,
    }))
    .map_err(|_| "Diagnostic config unavailable")?;
    let attempt = if flow {
        manager
            .lock()
            .map_err(|_| "Diagnostic owner unavailable")?
            .attempts
            .start(&config, target, &session_id)
            .map_err(|_| "Native attempt start refused")?
    } else {
        None
    };
    let mut start_guard = AttemptStartGuard(attempt.clone());
    // EXACT production builder; strict standard certificate validation, no
    // stored exceptions, ambient proxy, additional upstream proxy, or auth.
    let client = proxy_client_builder_with_cookies(
        true,
        None,
        "1.2",
        None,
        false,
        target.host_str(),
        attempt.as_ref().map(|attempt| attempt.cookie_store()),
    )
    .map_err(|_| "Strict proxy transport initialization failed")?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Local listener unavailable")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Local listener unavailable")?
        .port();
    let authority = format!("p{}.localhost:{port}", uuid::Uuid::new_v4().simple());
    let network = if flow {
        ProxyNetworkState::with_origin(&format!("http://{authority}"))
            .map_err(|_| "Protected origin registration unavailable")?
            .with_reviewed_public_routes(None, "1.2", &policy)
    } else {
        ProxyNetworkState::default()
    };
    let state = Arc::new(AxumProxyState {
        attempt,
        network: Arc::new(network),
        website_dark_mode: Default::default(),
        session_id,
        connection_id: "anonymous-document-diagnostic".into(),
        target_origin: target.origin().ascii_serialization(),
        target_url: target.to_string(),
        username: Arc::new(std::sync::RwLock::new(String::new())),
        password: Arc::new(std::sync::RwLock::new(String::new())),
        upstream_auth_mode: UpstreamAuthMode::None,
        proxy_policy: policy,
        redirect_profile: Some(BrowserRedirectProfile::Synology),
        tactical_rmm_api: None,
        custom_headers: HashMap::new(),
        pending_nonce: Arc::new(std::sync::RwLock::new(None)),
        theme: Arc::new(std::sync::RwLock::new(
            crate::theme_tokens::ThemeTokens::dark_default(),
        )),
        proxy_origin: format!("http://{authority}"),
        proxy_authority: authority.clone(),
        auto_login_armed: Arc::new(AtomicBool::new(false)),
        auto_login_nonce: Arc::new(std::sync::RwLock::new(None)),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: crate::http::yealink_login::session_slot(),
        client,
        request_count: Arc::new(AtomicU64::new(0)),
        document_sequence: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Arc::new(std::sync::Mutex::new(None)),
        global_sessions: manager,
        credentials_applied: None,
    });
    state
        .proxy_policy
        .validate(target)
        .map_err(|_| "Invalid diagnostic policy")?;
    if flow {
        state
            .global_sessions
            .lock()
            .map_err(|_| "Diagnostic owner unavailable")?
            .sessions
            .insert(
                state.session_id.clone(),
                ProxySessionEntry {
                    runtime: Default::default(),
                    attempt: state.attempt.clone(),
                    network: state.network.clone(),
                    website_dark_mode: state.website_dark_mode.clone(),
                    target_url: target.to_string(),
                    username: String::new(),
                    password: String::new(),
                    upstream_auth_mode: UpstreamAuthMode::None,
                    proxy_policy: state.proxy_policy.clone(),
                    redirect_profile: state.redirect_profile,
                    reviewed_application_profile: None,
                    custom_headers: HashMap::new(),
                    upstream_proxy_url: None,
                    target_origin: state.target_origin.clone(),
                    connection_id: state.connection_id.clone(),
                    created_at: String::new(),
                    local_port: port,
                    min_tls_version: "1.2".into(),
                    verify_ssl: true,
                    accepted_cert_fingerprint: None,
                    require_ca_verification: false,
                    request_count: state.request_count.clone(),
                    error_count: state.error_count.clone(),
                    last_error: state.last_error.clone(),
                    shutdown_tx: None,
                },
            );
    }
    let router = axum::Router::new()
        .fallback(axum_proxy_handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            enforce_proxy_access,
        ))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    start_guard.0 = None;
    Ok(DiagnosticProxy {
        local_url: format!("http://127.0.0.1:{port}/?__sorng_navigation_v1={MARKER}"),
        authority,
        state,
        task,
    })
}

async fn inspect(
    target: &reqwest::Url,
    approved: &[reqwest::Url; 2],
    profile: ContextProfile,
    classify_document: bool,
    probe: bool,
) -> Result<Value, &'static str> {
    let proxy = mediator(target, &approved[0]).await?;
    let browser = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(55))
        .build()
        .map_err(|_| "Local diagnostic client unavailable")?;
    // Only the selected UA/Referer differ between profiles. Referrers are the
    // fixed app shell or exact approved roots, never a captured private URL.
    let mut local_url =
        reqwest::Url::parse(&proxy.local_url).map_err(|_| "Invalid local endpoint")?;
    if probe {
        local_url.set_path("/webman/pingpong.cgi");
        local_url.set_query(Some("action=cors&quickconnect=true"));
    }
    let request = browser
        .get(local_url)
        .header("Host", &proxy.authority)
        .header(
            "Accept",
            if probe {
                "application/json"
            } else {
                "text/html,application/xhtml+xml"
            },
        )
        .header("Sec-Fetch-Dest", if probe { "empty" } else { "iframe" })
        .header("Sec-Fetch-Mode", if probe { "cors" } else { "navigate" })
        .header(
            "Sec-Fetch-Site",
            if probe { "same-origin" } else { "cross-site" },
        );
    let response = profile
        .apply(request, approved)
        .send()
        .await
        .map_err(|_| "Protected document request did not complete")?;
    summarize_response(
        response,
        &proxy,
        approved,
        profile,
        classify_document,
        probe,
    )
    .await
}

async fn summarize_response(
    mut response: reqwest::Response,
    proxy: &DiagnosticProxy,
    approved: &[reqwest::Url; 2],
    profile: ContextProfile,
    classify_document: bool,
    probe: bool,
) -> Result<Value, &'static str> {
    let target =
        reqwest::Url::parse(&proxy.state.target_url).map_err(|_| "Invalid diagnostic target")?;
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let category = if content_type.starts_with("text/html") {
        "html"
    } else if content_type.starts_with("application/json") {
        "json"
    } else {
        "other_or_missing"
    };
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Local response read failed")?
    {
        if body.len().saturating_add(chunk.len()) > BODY_LIMIT {
            return Err("Local diagnostic body limit exceeded");
        }
        body.extend_from_slice(&chunk);
    }
    let text = std::str::from_utf8(&body).unwrap_or("");
    let logs = proxy
        .state
        .global_sessions
        .lock()
        .map_err(|_| "Diagnostic snapshot unavailable")?
        .request_log_newest_first();
    let mut report = json!({
        "target": origin_relation(target.as_str(), approved),
        "metadata_profile": profile.label(),
        "request_kind":if probe { "regional_probe_path_ordinary_mediator_no_origin_not_reserved_probe_route" } else { "document_iframe" },
        "origin_header_sent": false, "browser_cookies_sent": false,
        "local_status": status, "mediated_body_category": category,
        "mediated_body_bytes": body.len(),
        "readiness_marker_present": text.contains("proxy_dom_ready"),
        "connector_bundle_reference_present": text.contains("/connect_lib.") && text.contains(".bundle.js"),
        // Do not count /webman/index.cgi strings in our injected automation
        // helpers as provider evidence. This fixed DSM symbol is only a marker,
        // not proof that the page initialized or that authentication succeeded.
        "dsm_symbol_marker_present": text.contains("SYNO.SDS"),
        "javascript_executed": false,
        "log": logs.iter().filter(|entry| entry.session_id == proxy.state.session_id).take(4).map(|entry| safe_log(entry, approved)).collect::<Vec<_>>(),
    });
    if classify_document && category == "html" {
        report["anonymous_document_summary"] = document_summary(text, approved);
    }
    if probe {
        let json = serde_json::from_slice::<Value>(&body).ok();
        report["json_valid"] = json!(json.is_some());
        report["ezid_string_present"] = json!(json
            .as_ref()
            .and_then(|value| value.get("ezid"))
            .is_some_and(Value::is_string));
        report["nas_identity_verified"] = json!(false);
    }
    Ok(report)
}

#[tokio::test]
#[ignore = "requires separately reviewed explicit anonymous live diagnostic authorization"]
async fn actual_proxy_opt_in_quickconnect_document_diagnostic() {
    assert!(
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_CONFIRM")
            .is_ok_and(|v| v == "anonymous-two-document-gets"),
        "Explicit diagnostic confirmation required"
    );
    let value =
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_TARGET").expect("Explicit target required");
    let approved = targets(&value).expect("Invalid diagnostic target");
    for target in &approved {
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            inspect(target, &approved, ContextProfile::Minimal, false, false),
        )
        .await;
        let report = match result {
            Ok(Ok(report)) => report,
            Ok(Err(reason)) => {
                json!({"target":origin_relation(target.as_str(), &approved), "diagnostic_error":reason})
            }
            Err(_) => {
                json!({"target":origin_relation(target.as_str(), &approved), "diagnostic_error":"Diagnostic deadline exceeded"})
            }
        };
        eprintln!("Anonymous internal-proxy document evidence: {report}");
    }
}

/// Four fresh regional-only mediators. No cookie/session reuse, alias GET,
/// control operations, or extra requests after an inconclusive result.
#[tokio::test]
#[ignore = "requires separately reviewed four-profile anonymous diagnostic authorization"]
async fn actual_proxy_opt_in_quickconnect_context_comparison() {
    assert!(
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_CONFIRM")
            .is_ok_and(|value| value == "anonymous-four-context-gets"),
        "Explicit four-profile diagnostic confirmation required"
    );
    let value =
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_TARGET").expect("Explicit target required");
    let approved = targets(&value).expect("Invalid diagnostic target");
    for profile in [
        ContextProfile::Minimal,
        ContextProfile::UserAgent,
        ContextProfile::AppReferer,
        ContextProfile::UserAgentAndAppReferer,
    ] {
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            inspect(&approved[0], &approved, profile, false, false),
        )
        .await;
        let report = match result {
            Ok(Ok(report)) => report,
            Ok(Err(reason)) => {
                json!({"target":"regional", "metadata_profile":profile.label(), "diagnostic_error":reason})
            }
            Err(_) => {
                json!({"target":"regional", "metadata_profile":profile.label(), "diagnostic_error":"Diagnostic deadline exceeded"})
            }
        };
        eprintln!("Anonymous internal-proxy context evidence: {report}");
    }
}

#[test]
fn context_profiles_change_only_the_two_explicit_headers() {
    let approved = targets("https://example.fr3.quickconnect.to/").unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for (profile, ua, referer) in [
        (ContextProfile::Minimal, false, false),
        (ContextProfile::UserAgent, true, false),
        (ContextProfile::AppReferer, false, true),
        (ContextProfile::UserAgentAndAppReferer, true, true),
    ] {
        let request = profile
            .apply(client.get("http://127.0.0.1:9/"), &approved)
            .build()
            .unwrap();
        assert_eq!(
            request
                .headers()
                .get("user-agent")
                .map(|value| value.to_str().unwrap()),
            ua.then_some(CAPTURED_USER_AGENT)
        );
        assert_eq!(
            request
                .headers()
                .get("referer")
                .map(|value| value.to_str().unwrap()),
            referer.then_some(FIXED_APP_REFERER)
        );
        assert_eq!(
            request.headers().len(),
            usize::from(ua) + usize::from(referer)
        );
        assert!(request.body().is_none());
        assert_eq!(request.method(), reqwest::Method::GET);
    }
}

async fn pair(classify: bool, probe: bool) {
    let confirmation = if probe {
        "anonymous-two-regional-probe-gets"
    } else {
        "anonymous-classify-regional-documents"
    };
    assert!(
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_CONFIRM")
            .is_ok_and(|value| value == confirmation),
        "Explicit paired diagnostic confirmation required"
    );
    let value =
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_TARGET").expect("Explicit target required");
    let approved = targets(&value).expect("Invalid diagnostic target");
    for profile in [ContextProfile::Minimal, ContextProfile::UserAgent] {
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            inspect(&approved[0], &approved, profile, classify, probe),
        )
        .await;
        let report = match result {
            Ok(Ok(report)) => report,
            Ok(Err(reason)) => {
                json!({"target":"regional", "metadata_profile":profile.label(), "diagnostic_error":reason})
            }
            Err(_) => {
                json!({"target":"regional", "metadata_profile":profile.label(), "diagnostic_error":"Diagnostic deadline exceeded"})
            }
        };
        eprintln!("Anonymous internal-proxy paired evidence: {report}");
    }
}

#[tokio::test]
#[ignore = "requires explicit anonymous document classification authorization"]
async fn actual_proxy_opt_in_quickconnect_document_classification() {
    pair(true, false).await;
}

#[tokio::test]
#[ignore = "requires explicit anonymous regional probe comparison authorization"]
async fn actual_proxy_opt_in_quickconnect_regional_probe_comparison() {
    pair(false, true).await;
}

#[tokio::test]
#[ignore = "requires explicit anonymous provider-referrer comparison authorization"]
async fn actual_proxy_opt_in_quickconnect_provider_referrer_comparison() {
    assert!(
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_CONFIRM")
            .is_ok_and(|value| value == "anonymous-three-provider-referrer-gets"),
        "Explicit provider-referrer diagnostic confirmation required"
    );
    let value =
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_TARGET").expect("Explicit target required");
    let approved = targets(&value).expect("Invalid diagnostic target");
    for profile in [
        ContextProfile::UserAgent,
        ContextProfile::UserAgentAndAliasReferer,
        ContextProfile::UserAgentAndRegionalReferer,
    ] {
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            inspect(&approved[0], &approved, profile, true, false),
        )
        .await;
        let report = match result {
            Ok(Ok(report)) => report,
            Ok(Err(reason)) => {
                json!({"target":"regional", "metadata_profile":profile.label(), "diagnostic_error":reason})
            }
            Err(_) => {
                json!({"target":"regional", "metadata_profile":profile.label(), "diagnostic_error":"Diagnostic deadline exceeded"})
            }
        };
        eprintln!("Anonymous internal-proxy provider-referrer evidence: {report}");
    }
}

#[test]
fn provider_referrers_are_derived_exact_roots_with_unchanged_captured_user_agent() {
    let approved = targets("https://example.fr3.quickconnect.to/").unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for (profile, reference) in [
        (ContextProfile::UserAgentAndAliasReferer, &approved[1]),
        (ContextProfile::UserAgentAndRegionalReferer, &approved[0]),
    ] {
        let request = profile
            .apply(client.get("http://127.0.0.1:9/"), &approved)
            .build()
            .unwrap();
        assert_eq!(request.headers()["referer"], reference.as_str());
        assert_eq!(request.headers()["user-agent"], CAPTURED_USER_AGENT);
        assert_eq!(request.headers().len(), 2);
        assert!(request.body().is_none());
    }
}

#[test]
fn discovery_is_read_only_and_regional_candidate_is_exact_bounded_provider_host() {
    let approved = targets("https://example.fr3.quickconnect.to/").unwrap();
    let body = discovery_body(&approved).unwrap();
    assert_eq!(body.as_array().unwrap().len(), 2);
    for (index, id) in ["mainapp_https", "mainapp_http"].iter().enumerate() {
        assert_eq!(body[index]["command"], "get_server_info");
        assert_eq!(body[index]["serverID"], "example");
        assert_eq!(body[index]["id"], *id);
        assert_eq!(body[index]["stop_when_success"], false);
        assert_eq!(body[index]["path"], "");
        assert_eq!(body[index].as_object().unwrap().len(), 8);
    }
    let candidate = one_advertised_control(&json!([{"sites":[
        "global.quickconnect.to", "other.invalid", "evil@dec.quickconnect.to",
        "dec.quickconnect.to:444", "dec.quickconnect.to/private", "a.b.quickconnect.to",
        "dec.quickconnect.to",
    ]}]))
    .unwrap();
    assert_eq!(candidate.as_str(), "https://dec.quickconnect.to/Serv.php");
    assert!(one_advertised_control(
        &json!([{"sites":["https://dec.quickconnect.to/", "dec.quickconnect.to?secret=x"]}])
    )
    .is_none());
    assert!(!has_learnable_server_info(
        &json!([{"errno":0,"server":{"serverID":"private-id"}}])
    ));
}

struct FlowOwner(ProxySessionManagerState);
impl Drop for FlowOwner {
    fn drop(&mut self) {
        if let Ok(mut manager) = self.0.lock() {
            manager.attempts.clear();
            for (_, entry) in manager.sessions.drain() {
                if let Some(attempt) = entry.attempt {
                    attempt.revoke();
                }
                entry.network.revoke();
            }
            manager.clear_redirect_reviews();
        }
    }
}

fn flow_browser() -> Result<reqwest::Client, &'static str> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(55))
        .build()
        .map_err(|_| "Local flow client unavailable")
}

async fn flow_document(
    proxy: &DiagnosticProxy,
    browser: &reqwest::Client,
) -> Result<reqwest::Response, &'static str> {
    browser
        .get(&proxy.local_url)
        .header("Host", &proxy.authority)
        .header("User-Agent", CAPTURED_USER_AGENT)
        .header("Referer", FIXED_APP_REFERER)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "cross-site")
        .send()
        .await
        .map_err(|_| "Protected flow document request did not complete")
}

fn discovery_body(approved: &[reqwest::Url; 2]) -> Result<Value, &'static str> {
    let alias = approved[1]
        .host_str()
        .and_then(|host| host.split('.').next())
        .ok_or("Original alias unavailable")?;
    Ok(json!(["mainapp_https", "mainapp_http"].map(|id| json!({
        "version":1, "command":"get_server_info", "stop_when_error":false,
        "stop_when_success":false, "id":id, "serverID":alias, "is_gofile":false, "path":"",
    }))))
}

fn has_learnable_server_info(json: &Value) -> bool {
    json.as_array()
        .filter(|items| items.len() <= 16)
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.get("errno").and_then(Value::as_i64) == Some(0)
                    && [
                        "/server/interface",
                        "/server/external/ip",
                        "/service/port",
                        "/service/ext_port",
                        "/env/control_host",
                        "/env/relay_region",
                    ]
                    .iter()
                    .all(|path| item.pointer(path).is_some_and(|value| !value.is_null()))
                    && item
                        .pointer("/server/serverID")
                        .and_then(Value::as_str)
                        .is_some_and(|id| {
                            !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
                        })
            })
        })
}

fn one_advertised_control(json: &Value) -> Option<reqwest::Url> {
    for item in json.as_array().filter(|items| items.len() <= 16)? {
        let Some(sites) = item
            .get("sites")
            .and_then(Value::as_array)
            .filter(|sites| sites.len() <= 16)
        else {
            continue;
        };
        for host in sites.iter().filter_map(Value::as_str) {
            let Some(label) = host.strip_suffix(".quickconnect.to") else {
                continue;
            };
            if label == "global"
                || !(1..=63).contains(&label.len())
                || !label.as_bytes()[0].is_ascii_alphanumeric()
                || !label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            {
                continue;
            }
            let url = reqwest::Url::parse(&format!("https://{host}/Serv.php")).ok()?;
            if url.host_str() == Some(host)
                && url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
            {
                return Some(url);
            }
        }
    }
    None
}

async fn native_discovery(
    source: &DiagnosticProxy,
    browser: &reqwest::Client,
    approved: &[reqwest::Url; 2],
    sequence: u64,
    regional: Option<&reqwest::Url>,
) -> Result<Value, &'static str> {
    let mut local = reqwest::Url::parse(&source.local_url).map_err(|_| "Invalid local endpoint")?;
    local.set_path(if regional.is_some() {
        "/__sortofremoteng_quickconnect_discovered_v1"
    } else {
        "/__sortofremoteng_quickconnect_control_v1"
    });
    local.set_query(None);
    let request = browser.post(local);
    let request = if let Some(regional) = regional {
        request.query(&[("destination", regional.as_str())])
    } else {
        request
    };
    let source_referrer = format!(
        "{}/?__sorng_navigation_v1={MARKER}",
        source.state.proxy_origin
    );
    let mut response = request
        .header("Host", &source.authority)
        .header("Origin", &source.state.proxy_origin)
        .header("Referer", source_referrer)
        .header("User-Agent", CAPTURED_USER_AGENT)
        .header("Accept", "application/json")
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded; charset=UTF-8",
        )
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header("X-Sorng-QuickConnect-Document", sequence.to_string())
        .body(discovery_body(approved)?.to_string())
        .send()
        .await
        .map_err(|_| "Protected native discovery did not complete")?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Protected discovery response read failed")?
    {
        if bytes.len().saturating_add(chunk.len()) > 256 * 1024 {
            return Err("Discovery response exceeded native diagnostic bound");
        }
        bytes.extend_from_slice(&chunk);
    }
    let json = serde_json::from_slice::<Value>(&bytes).ok();
    let logs = source
        .state
        .global_sessions
        .lock()
        .map_err(|_| "Diagnostic owner unavailable")?
        .request_log_newest_first();
    let report = json!({
        "stage":if regional.is_some() { "regional_discovery" } else { "global_discovery" },
        "local_status":status.as_u16(), "json_valid":json.is_some(),
        "server_info_shape_present":json.as_ref().is_some_and(has_learnable_server_info),
        "identity_source":"native protected discovery response; no harness seeding",
        "log":logs.iter().filter(|entry| entry.session_id == source.state.session_id).take(1).map(|entry|safe_log(entry, approved)).collect::<Vec<_>>(),
    });
    eprintln!("Native anonymous flow discovery: {report}");
    if !status.is_success() {
        return Err("Native discovery failed; flow stopped");
    }
    json.ok_or("Native discovery response was not JSON")
}

async fn native_flow(approved: &[reqwest::Url; 2]) -> Result<(), &'static str> {
    let owner = FlowOwner(ProxySessionManager::new());
    let source =
        mediator_with_attempt(&approved[1], &approved[0], Some((owner.0.clone(), None))).await?;
    let browser = flow_browser()?;
    let response = flow_document(&source, &browser).await?;
    let source_ok = response.status() == reqwest::StatusCode::OK;
    let report = summarize_response(
        response,
        &source,
        approved,
        ContextProfile::UserAgentAndAppReferer,
        true,
        false,
    )
    .await?;
    eprintln!("Native anonymous flow alias-document: {report}");
    if !source_ok {
        return Err("Alias document did not load; flow stopped");
    }
    let sequence = source.state.document_sequence.load(Ordering::SeqCst);
    source
        .state
        .network
        .activate_document(sequence)
        .map_err(|_| "Native source document activation refused")?;
    let source_referrer = format!(
        "{}/?__sorng_navigation_v1={MARKER}",
        source.state.proxy_origin
    );
    let discovery = native_discovery(&source, &browser, approved, sequence, None).await?;
    if !has_learnable_server_info(&discovery) {
        let control = one_advertised_control(&discovery).ok_or("Discovery supplied neither usable server information nor a bounded regional control candidate")?;
        let regional =
            native_discovery(&source, &browser, approved, sequence, Some(&control)).await?;
        if !has_learnable_server_info(&regional) {
            return Err("Regional discovery lacked usable server information; probe not attempted");
        }
    }
    let mut probe_url =
        reqwest::Url::parse(&source.local_url).map_err(|_| "Invalid local endpoint")?;
    probe_url.set_path("/__sortofremoteng_quickconnect_discovered_v1");
    probe_url.set_query(None);
    let mut destination = approved[0].clone();
    destination.set_path("/webman/pingpong.cgi");
    destination.set_query(Some("action=cors&quickconnect=true"));
    let response = browser
        .get(probe_url)
        .query(&[("destination", destination.as_str())])
        .header("Host", &source.authority)
        .header("Origin", &source.state.proxy_origin)
        .header("Referer", &source_referrer)
        .header("User-Agent", CAPTURED_USER_AGENT)
        .header("Accept", "application/json")
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header("X-Sorng-QuickConnect-Document", sequence.to_string())
        .send()
        .await
        .map_err(|_| "Protected native probe did not complete")?;
    let probe_ok = response.status() == reqwest::StatusCode::OK;
    let mut report = summarize_response(
        response,
        &source,
        approved,
        ContextProfile::UserAgent,
        false,
        true,
    )
    .await?;
    report["target"] = json!("regional");
    report["request_kind"] = json!("reserved_native_regional_probe_with_local_source_referrer");
    report["origin_header_sent"] = json!(true);
    report["origin_header_scope"] = json!("protected_local_proxy_only");
    report["nas_identity_verified"] = json!(probe_ok);
    eprintln!("Native anonymous flow reserved-probe: {report}");
    if !probe_ok {
        return Err("Native regional probe refused or failed; handoff not attempted");
    }

    let mut vendor_url =
        reqwest::Url::parse(&source.local_url).map_err(|_| "Invalid local endpoint")?;
    vendor_url.set_path("/__sortofremoteng_quickconnect_redirect_v1");
    vendor_url.set_query(None);
    let response = browser
        .get(vendor_url)
        .query(&[("destination", approved[0].as_str())])
        .header("Host", &source.authority)
        .header("Referer", &source_referrer)
        .header("User-Agent", CAPTURED_USER_AGENT)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
        .send()
        .await
        .map_err(|_| "Native handoff receipt request did not complete")?;
    let pending = response.status() == reqwest::StatusCode::ACCEPTED;
    let report = summarize_response(
        response,
        &source,
        approved,
        ContextProfile::UserAgent,
        false,
        false,
    )
    .await?;
    eprintln!("Native anonymous flow local-handoff: {report}");
    if !pending {
        return Err("Native default handoff was not pending; flow stopped");
    }
    let ticket = {
        let mut manager = owner.0.lock().map_err(|_| "Flow owner unavailable")?;
        let receipt = manager
            .review_redirect(&source.state.session_id, None)
            .ok_or("Native handoff receipt unavailable")?;
        if receipt.destination_url != approved[0].as_str() {
            return Err("Native receipt destination differs from authorized root");
        }
        let consumed = manager
            .review_redirect(&source.state.session_id, Some(&receipt.receipt_id))
            .ok_or("Native receipt consumption refused")?;
        let ticket = consumed
            .continuation_id
            .ok_or("Native continuation unavailable")?;
        let attempt = source
            .state
            .attempt
            .as_ref()
            .ok_or("Native attempt unavailable")?;
        manager
            .attempts
            .stop(attempt, Some(&ticket))
            .map_err(|_| "Native source transfer refused")?;
        ticket
    };
    // The ticket—not an injected upstream Referer—carries native handoff state.
    // Dropping the old source cannot revoke its now-released successor context.
    drop(source);
    let target = mediator_with_attempt(
        &approved[0],
        &approved[0],
        Some((owner.0.clone(), Some(ticket))),
    )
    .await?;
    let response = flow_document(&target, &browser).await?;
    let report = summarize_response(
        response,
        &target,
        approved,
        ContextProfile::UserAgentAndAppReferer,
        true,
        false,
    )
    .await?;
    eprintln!("Native anonymous flow regional-document: {report}");
    if report["local_status"] != 200 || report["mediated_body_category"] != "html" {
        return Err("Regional handoff did not serve HTTP 200 HTML");
    }
    if report["connector_bundle_reference_present"] == true {
        return Err(
            "Regional handoff returned a connector reference instead of an accepted landing page",
        );
    }
    Ok(())
}

/// Three upstream GETs plus one global and at most one advertised regional
/// read-only get_server_info POST. Native validation may stop earlier. No
/// request_tunnel, JS, credentials, manually seeded identity, or private app state.
#[tokio::test]
#[ignore = "requires reviewed anonymous native flow with read-only discovery authorization"]
async fn actual_proxy_opt_in_quickconnect_native_flow() {
    assert!(
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_CONFIRM")
            .is_ok_and(|value| value == "anonymous-native-flow-with-discovery"),
        "Explicit native-flow diagnostic confirmation required"
    );
    let value =
        std::env::var("SORNG_QC_DOCUMENT_DIAGNOSTIC_TARGET").expect("Explicit target required");
    let approved = targets(&value).expect("Invalid diagnostic target");
    let result = match tokio::time::timeout(Duration::from_secs(180), native_flow(&approved)).await
    {
        Ok(result) => result,
        Err(_) => Err("Total diagnostic deadline exceeded"),
    };
    if let Err(reason) = result {
        eprintln!("Native anonymous flow stopped: {reason}");
    }
    assert!(
        result.is_ok(),
        "Native anonymous handoff acceptance failed; see preceding safe diagnostics"
    );
    eprintln!("Native anonymous handoff served a page; no JavaScript or login was exercised");
}

#[test]
fn anonymous_summary_is_bounded_and_excludes_script_text_addresses_and_identifiers() {
    let approved = targets("https://example.fr3.quickconnect.to/").unwrap();
    let summary = document_summary(
        r#"<html><title>Synology &amp; example https://example.fr3.quickconnect.to/?token=private</title>
        <script>var privateData='<h1>PRIVATE SCRIPT Cannot connect</h1>'; </script>
        <style>PRIVATE STYLE unsupported browser</style>
        <!-- <h1>PRIVATE COMMENT</h1> -->
        <script src="https://example.fr3.quickconnect.to/js/provider.js?private=query"></script>
        <h1>Browser not supported</h1><h2>Request id=private-id</h2><h3>PRIVATE THIRD HEADING</h3></html>"#,
        &approved,
    );
    let output = summary.to_string();
    assert!(!output.contains("PRIVATE"));
    assert!(!output.contains("private"));
    assert!(!output.contains("quickconnect.to"));
    assert!(!output.contains("example"));
    assert_eq!(summary["script_basenames"], json!(["provider.js"]));
    assert_eq!(summary["fixed_text_present"]["cannot_connect"], false);
    assert_eq!(summary["fixed_text_present"]["unsupported_browser"], false);
    assert_eq!(summary["fixed_text_present"]["not_supported"], true);
    assert_eq!(summary["headings"].as_array().unwrap().len(), 2);
    assert_eq!(
        public_text(&"x ".repeat(200), 120, &approved)
            .chars()
            .count(),
        120
    );
    assert!(!public_text("a\u{0001}b", 160, &approved).contains('\u{0001}'));
}

#[test]
fn diagnostic_targets_reject_credentials_noncanonical_and_unrelated_routes() {
    assert!(targets("https://example.fr3.quickconnect.to/").is_ok());
    for value in [
        "https://example.quickconnect.to/",
        "http://example.fr3.quickconnect.to/",
        "https://example.fr3.quickconnect.to:444/",
        "https://example.fr3.quickconnect.to/?secret=x",
        "https://user:secret@example.fr3.quickconnect.to/",
        "https://example.fr3.quickconnect.to/webman/",
        "https://example.fr3.quickconnect.to.attacker.invalid/",
        "https://example.fr3.quickconnect.to/#secret",
        "https://example.fr3.quickconnect.to",
        "https://example.FR3.quickconnect.to/",
        "https://global.fr3.quickconnect.to/",
    ] {
        assert!(targets(value).is_err());
    }
}

#[test]
fn diagnostic_output_does_not_serialize_raw_native_errors_urls_or_identifiers() {
    let approved = targets("https://example.fr3.quickconnect.to/").unwrap();
    let entry: ProxyRequestLogEntry = serde_json::from_value(json!({
        "id":"private-id", "session_id":"private-session", "method":"private-method",
        "url":"https://example.fr3.quickconnect.to/private-path?secret=query",
        "status":202,"error":"private-error-cookie", "timestamp":"private-timestamp",
        "diagnostic":{"phase":"private-phase", "stage":"private-stage", "code":"private-code",
            "outcome":"private-outcome", "durationMs":1, "attemptId":"private-attempt",
            "redirectTargetOrigin":"http://example.quickconnect.to", "redirectTargetPath":"root",
            "redirectSourcePath":"dsm", "redirectQueryRemoved":true, "upstreamStatus":302,
            "sameOriginRedirects":1}
    }))
    .unwrap();
    let output = safe_log(&entry, &approved).to_string();
    assert!(!output.contains("private"));
    assert!(!output.contains("secret"));
    assert!(!output.contains("quickconnect.to"));
    assert!(output.contains("http_alias"));
    assert!(output.contains("302"));
}
