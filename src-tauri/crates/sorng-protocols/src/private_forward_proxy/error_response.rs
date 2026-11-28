//! Self-contained failure reports. Never accept an error's Display/Debug text:
//! route implementations can include passwords, headers, URLs or local paths.
use super::intercept::{forward::full_body, ProxyBody};
use hyper::http::{header, HeaderValue, Response, StatusCode};
use std::{backtrace::Backtrace, error::Error, fmt::Write, io};

const MAX_TRACE_BYTES: usize = 24 * 1024;
const MAX_FRAMES: usize = 48;
const MAX_CAUSES: usize = 8;

#[derive(Clone, Copy)]
pub(super) enum Failure {
    Status,
    UpstreamStatus,
    Route,
    RouteTimeout,
    ResponseTimeout,
    HttpTransport,
    ResponseFraming,
    Hook,
    CertificateDenied,
    ReviewTimeout,
    Revoked,
    BadSignature,
    MalformedCertificate,
    WeakKey,
    TlsProtocol,
    Tls(super::intercept::tls_policy::TlsFailure),
    TlsAttempt(super::intercept::tls_policy::TlsFailure, super::intercept::tls_attempt::TlsAttempt),
    Hsts,
}

struct Explanation {
    code: &'static str,
    stage: &'static str,
    title: &'static str,
    detail: &'static str,
    hints: &'static [&'static str],
}
impl Failure {
    fn explain(self, status: StatusCode) -> Explanation {
        let (code, stage, title, detail, hints): (_, _, _, _, &'static [&'static str]) = match self {
            Self::Route => ("route-failed", "Route establishment", "The website could not be reached", "The configured private route could not establish the upstream connection.", &["Check the saved route, VPN or jump host, and the website service.", "Open connection diagnostics to inspect the current private route."]),
            Self::RouteTimeout => ("route-timeout", "Route establishment", "The private route timed out", "The configured route did not establish a connection before its deadline.", &["Check whether the route and destination service are available.", "A retry may succeed after the network recovers; submitted forms are not replayed automatically."]),
            Self::ResponseTimeout => ("response-timeout", "Upstream response", "The website took too long to respond", "No complete upstream response header arrived before the request deadline.", &["The website or its authentication service may be busy.", "Check the website service before retrying a submitted form."]),
            Self::HttpTransport => ("http-transport", "HTTP exchange", "The upstream HTTP exchange failed", "The upstream connection ended or could not carry a valid HTTP exchange.", &["Check the service's HTTP and HTTPS port configuration.", "A connection reset or interrupted private route can also cause this failure."]),
            Self::ResponseFraming => ("response-framing", "Response validation", "The website returned an invalid response", "The upstream response had unsupported or conflicting HTTP framing or upgrade headers.", &["Check the website's reverse proxy and HTTP response configuration.", "The proxy rejected ambiguous framing rather than forwarding an unsafe response."]),
            Self::Hook => ("exchange-hook-failed", "Request processing", "A request processor failed", "An installed native exchange hook failed while processing this request or response.", &["Review the connection's request processing settings.", "Include the reference ID and technical details when reporting this failure."]),
            Self::CertificateDenied => ("certificate-denied", "Certificate review", "The website certificate was not admitted", "The app's trust policy or certificate review did not permit this upstream certificate.", &["Open the Trust Center to inspect this connection's certificate policy.", "Review the website certificate when the app offers a certificate prompt."]),
            Self::ReviewTimeout => ("review-timeout", "Certificate review", "Certificate review did not finish", "The upstream certificate decision timed out before the request was admitted.", &["Return to the app and check for a pending certificate review.", "Retry the navigation after completing the review."]),
            Self::Revoked => ("certificate-revoked", "TLS certificate verification", "The website certificate is revoked", "The certificate verifier reported revocation, which cannot be overridden by a review prompt.", &["Ask the website administrator to replace the revoked certificate.", "Do not use a remembered exception to bypass revocation."]),
            Self::BadSignature => ("certificate-bad-signature", "TLS certificate verification", "The certificate signature is invalid", "The TLS verifier could not validate a certificate or handshake signature.", &["Check the server's certificate chain and key configuration.", "A normal unknown certificate authority is a separate, reviewable condition."]),
            Self::MalformedCertificate => ("certificate-malformed", "TLS certificate verification", "The website supplied an invalid certificate", "The certificate chain was absent, malformed or could not be decoded safely.", &["Ask the administrator to install a complete, correctly encoded certificate chain."]),
            Self::WeakKey => ("certificate-weak-key", "TLS certificate verification", "The certificate uses unsupported cryptography", "A certificate key or signature algorithm was below the verifier's security requirements.", &["For an old device, enable Allow weak device certificates in this connection's browser options and reconnect. Trust review still applies.", "Very old algorithms may also require a legacy TLS profile; prefer replacing the weak certificate when possible."]),
            Self::Tls(cause @ super::intercept::tls_policy::TlsFailure::PeerAlert(112)) | Self::TlsAttempt(cause @ super::intercept::tls_policy::TlsFailure::PeerAlert(112), _) => (cause.code(), "TLS hostname negotiation", "The server rejected the TLS hostname", cause.detail(), &["Use the DNS hostname configured on the server, and check the connection's hostname and port.", "Ask the server administrator to check its SNI / virtual-host configuration. Certificate trust exceptions do not repair a rejected hostname."]),
            Self::Tls(cause) | Self::TlsAttempt(cause, _) => (cause.code(), "TLS negotiation", cause.title(), cause.detail(), &["Check the selected upstream TLS profile and the device configuration.", "Certificate review cannot repair a protocol, cipher or transport failure."]),
            Self::TlsProtocol => ("tls-protocol", "TLS negotiation", "TLS negotiation failed", "The TLS peers could not complete a supported handshake. This does not, by itself, identify a certificate trust problem.", &["Check the server's TLS versions, cipher configuration and HTTPS port.", "Enable a supported modern TLS configuration on the server; certificate review cannot repair a protocol mismatch."]),
            Self::Hsts => ("hsts-certificate-error", "HTTPS transport policy", "HTTPS policy rejected this connection", "A certificate error on an HSTS-protected origin cannot be overridden for this connection.", &["Repair the website certificate and HTTPS configuration.", "Keep the website on HTTPS; changing the URL to HTTP does not resolve an HSTS certificate error."]),
            Self::UpstreamStatus => match status.as_u16() {
                401 => ("upstream-http-401", "Website response", "The website requires sign-in", "The website returned HTTP 401. It did not accept the current authentication.", &["Check the saved account and the website's authentication method."]),
                403 => ("upstream-http-403", "Website response", "The website refused access", "The website returned HTTP 403. Its access policy refused this request.", &["Check account permissions and the website's IP or access restrictions."]),
                404 => ("upstream-http-404", "Website response", "The website could not find this page", "The website returned HTTP 404 for the requested path.", &["Check the connection URL and bookmark path."]),
                429 => ("upstream-http-429", "Website response", "The website is limiting requests", "The website returned HTTP 429. Its request limit was reached.", &["Wait before retrying. Check the website's rate limits and any Retry-After response."]),
                502 => ("upstream-http-502", "Website response", "The website's gateway failed", "The upstream website returned HTTP 502 from its own gateway.", &["Check the website's reverse proxy and backend service."]),
                503 => ("upstream-http-503", "Website response", "The website is unavailable", "The website returned HTTP 503. Its service may be busy or under maintenance.", &["Check service health and wait before retrying."]),
                504 => ("upstream-http-504", "Website response", "The website's gateway timed out", "The upstream website returned HTTP 504 while waiting for its backend.", &["Check the website's backend and gateway timeout settings."]),
                _ => ("upstream-http-error", "Website response", "The website returned an HTTP error", "The website supplied an error response. The HTTP status is preserved above.", &["Review the website's logs and the request path. Request bodies are never replayed automatically."]),
            },
            Self::Status => match status.as_u16() {
                400 | 405 | 421 | 431 => ("request-rejected", "Request validation", "The proxy could not accept this request", "The request did not satisfy the application internal proxy's method, destination or HTTP framing requirements.", &["Check the connection target and request configuration."]),
                403 => ("destination-denied", "Destination policy", "This destination was not permitted", "The current private route or request policy did not grant this destination.", &["Review the connection's website destination permissions.", "Only destinations explicitly admitted by the private route can be requested."]),
                407 => ("proxy-authentication", "Proxy authentication", "Application internal proxy authentication is required", "The request did not present valid credentials for this attempt's application internal proxy.", &["Reconnect the owning browser tab to restore its application internal proxy binding."]),
                408 => ("request-timeout", "Request admission", "The request was not received in time", "The application internal proxy did not receive a complete request header before its deadline.", &["Retry after checking the client connection."]),
                503 => ("proxy-capacity", "Proxy admission", "The application internal proxy is busy", "The application internal proxy could not accept more work at this time.", &["Wait for active requests to finish, then retry."]),
                504 => return Self::ResponseTimeout.explain(status),
                _ => ("proxy-failure", "Application internal proxy", "The application internal proxy could not complete the request", "An internal forwarding operation failed before a usable response was available.", &["Review the technical details and connection diagnostics."]),
            },
        };
        Explanation {
            code,
            stage,
            title,
            detail,
            hints,
        }
    }
}

#[derive(Clone)]
pub(super) struct Report {
    theme_css: String,
    id: String,
    recorded: String,
    code: &'static str,
    stage: &'static str,
    title: &'static str,
    detail: &'static str,
    hints: &'static [&'static str],
    causes: Vec<String>,
    trace: Vec<String>,
    captured: bool,
    trace_disabled: bool,
    expand_details: bool,
}

struct Limited {
    text: String,
}
impl Write for Limited {
    fn write_str(&mut self, value: &str) -> std::fmt::Result {
        let remaining = MAX_TRACE_BYTES.saturating_sub(self.text.len());
        if value.len() > remaining {
            let mut end = remaining;
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            self.text.push_str(&value[..end]);
            return Err(std::fmt::Error);
        }
        self.text.push_str(value);
        Ok(())
    }
}

fn stack() -> Vec<String> {
    // force_capture is independent of RUST_BACKTRACE. Formatting stops at the
    // byte budget; retain only numbered function symbols, never source paths.
    let trace = Backtrace::force_capture();
    let mut output = Limited {
        text: String::new(),
    };
    let _ = write!(output, "{trace}");
    safe_frames(&output.text)
}
fn safe_frames(value: &str) -> Vec<String> {
    value
        .lines()
        .filter_map(|line| {
            let (number, symbol) = line.trim().split_once(':')?;
            if number.is_empty() || !number.bytes().all(|v| v.is_ascii_digit()) {
                return None;
            }
            let symbol = symbol.trim();
            if ![
                "sorng_protocols::",
                "std::",
                "core::",
                "alloc::",
                "tokio::",
                "hyper::",
                "axum::",
                "rustls::",
                "futures_",
                "http_body_util::",
                "<",
            ]
            .iter()
            .any(|prefix| symbol.starts_with(prefix))
                || symbol.contains(['/', '\\', '@'])
                || symbol.contains("://")
            {
                return None;
            }
            Some(
                symbol
                    .chars()
                    .filter(|v| !v.is_control())
                    .take(240)
                    .collect(),
            )
        })
        .take(MAX_FRAMES)
        .collect()
}

fn safe_cause(error: &(dyn Error + 'static)) -> String {
    if let Some(error) = error.downcast_ref::<super::intercept::tls_policy::TlsFailure>() {
        return error.to_string();
    }
    if let Some(error) = error.downcast_ref::<io::Error>() {
        let kind = match error.kind() {
            io::ErrorKind::ConnectionRefused => "Connection refused",
            io::ErrorKind::ConnectionReset => "Connection reset",
            io::ErrorKind::ConnectionAborted => "Connection aborted",
            io::ErrorKind::TimedOut => "I/O operation timed out",
            io::ErrorKind::UnexpectedEof => "Connection ended unexpectedly",
            io::ErrorKind::NotConnected => "Connection is not established",
            io::ErrorKind::PermissionDenied => "I/O permission denied",
            io::ErrorKind::AddrNotAvailable => "Network address is unavailable",
            io::ErrorKind::InvalidData => "Invalid protocol data",
            _ => "I/O operation failed",
        };
        return match error.raw_os_error() {
            Some(code) => format!("{kind} (OS error {code})"),
            None => kind.into(),
        };
    }
    if let Some(error) = error.downcast_ref::<hyper::Error>() {
        return if error.is_timeout() {
            "HTTP transport timed out"
        } else if error.is_parse() {
            "HTTP response parsing failed"
        } else if error.is_incomplete_message() {
            "HTTP message ended before it was complete"
        } else {
            "HTTP transport failed"
        }
        .into();
    }
    if let Some(error) = error.downcast_ref::<rustls::Error>() {
        use rustls::{CertificateError as C, Error as E};
        return match error {
            E::InvalidCertificate(C::NotValidForName | C::NotValidForNameContext { .. }) => {
                "Certificate hostname mismatch (NotValidForName)"
            }
            E::InvalidCertificate(C::Expired | C::ExpiredContext { .. }) => {
                "Certificate has expired"
            }
            E::InvalidCertificate(C::NotValidYet | C::NotValidYetContext { .. }) => {
                "Certificate is not valid yet"
            }
            E::InvalidCertificate(C::UnknownIssuer) => {
                "Certificate authority is not trusted by the system"
            }
            E::InvalidCertificate(C::Revoked) => "Certificate verifier reported revocation",
            E::InvalidCertificate(C::BadSignature) => "Certificate signature verification failed",
            E::InvalidCertificate(C::BadEncoding) => "Certificate could not be decoded",
            E::InvalidCertificate(_) => "TLS certificate verification failed",
            E::NoCertificatesPresented => "TLS peer did not present a certificate",
            E::NoApplicationProtocol => "TLS peers did not agree on an application protocol",
            E::PeerIncompatible(_) => "TLS peers have no compatible handshake configuration",
            E::PeerMisbehaved(_) | E::InvalidMessage(_) => "TLS peer sent invalid handshake data",
            _ => "TLS engine reported a handshake failure",
        }
        .into();
    }
    "Additional native error context was withheld because it may contain private data".into()
}

impl Report {
    pub(super) fn capture(
        status: StatusCode,
        failure: Failure,
        error: Option<&(dyn Error + 'static)>,
        capture_stack: bool,
    ) -> Self {
        let e = failure.explain(status);
        let mut causes = vec![e.detail.to_owned()];
        let mut current = error;
        for _ in 0..MAX_CAUSES {
            let Some(error) = current else { break; };
            let cause = safe_cause(error);
            if !causes.contains(&cause) { causes.push(cause); }
            current = error.downcast_ref::<io::Error>().and_then(io::Error::get_ref)
                .map(|inner| inner as &(dyn Error + 'static)).or_else(|| error.source());
        }
        if let Failure::TlsAttempt(_, attempt) = failure { causes.extend(attempt.lines()); }
        Self {
            theme_css: crate::theme_tokens::ThemeTokens::dark_default().css_block(),
            id: uuid::Uuid::new_v4().to_string(),
            recorded: chrono::Utc::now().to_rfc3339(),
            code: e.code,
            stage: e.stage,
            title: e.title,
            detail: e.detail,
            hints: e.hints,
            causes,
            trace: if capture_stack { stack() } else { Vec::new() },
            captured: capture_stack,
            trace_disabled: false,
            expand_details: false,
        }
    }
    fn text(&self, status: StatusCode) -> String {
        let mut output = format!("SortOfRemoteNG application internal proxy\nHTTP {} {}\n{}\n\n{}\n\nReference ID: {}\nRecorded: {}\nFailure code: {}\nStage: {}\n\nWhat to check\n", status.as_u16(), status.canonical_reason().unwrap_or("Error"), self.title, self.detail, self.id, self.recorded, self.code, self.stage);
        for hint in self.hints {
            let _ = writeln!(output, "- {hint}");
        }
        output.push_str("\nCause chain\n");
        for (index, cause) in self.causes.iter().enumerate() {
            let _ = writeln!(output, "{}. {cause}", index + 1);
        }
        output.push_str("\nError-response backtrace\nCaptured while preparing this response; the asynchronous failure may have originated earlier.\n");
        if self.trace.is_empty() {
            output.push_str(if self.trace_disabled { "Native stack details are disabled in Internal Proxy settings.\n" } else if self.captured {
                "Native stack frames or function symbols are unavailable in this build.\n"
            } else {
                "Stack capture is omitted before authenticated forwarding.\n"
            });
        }
        for (index, frame) in self.trace.iter().enumerate() {
            let _ = writeln!(output, "{index}: {frame}");
        }
        output
    }
    fn html(&self, status: StatusCode) -> String {
        let details_open = if self.expand_details { " open" } else { "" };
        let short = format!("{}\n{}\nFailure code: {}\nReference ID: {}", self.title, self.detail, self.code, self.id);
        let mut output = format!(r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{}</title><style>{}{}{}</style></head><body><main><header><span>SortOfRemoteNG <span class="muted">/ Application internal proxy</span></span><span class="muted">HTTP {}</span></header><p class="stage">{}</p><h1>{}</h1><p class="description">{}</p><code class="failure-code">{}</code><section class="advice"><h2>What to check</h2><ul>"#,
            escape(self.title), self.theme_css, STYLE, crate::internal_page::ACTION_STYLE,
            status.as_u16(), escape(self.stage), escape(self.title), escape(self.detail), escape(self.code));
        for hint in self.hints { let _=write!(output,"<li>{}</li>",escape(hint)); }
        output.push_str("</ul></section>");
        output.push_str(&crate::internal_page::controls(&short, &self.text(status)));
        let _=write!(output,r#"<details class="technical"{details_open}><summary>Technical details</summary><dl><div><dt>Failure code</dt><dd>{}</dd></div><div><dt>Reference ID</dt><dd>{}</dd></div><div><dt>Recorded in UTC</dt><dd>{}</dd></div></dl><details><summary>Cause chain</summary><ol>"#,escape(self.code),escape(&self.id),escape(&self.recorded));
        for cause in &self.causes { let _=write!(output,"<li>{}</li>",escape(cause)); }
        output.push_str("</ol></details><details><summary>Error-response backtrace</summary><p>Captured while preparing this response; the asynchronous failure may have originated earlier.</p><pre>");
        if self.trace.is_empty() { output.push_str(if self.trace_disabled { "Native stack details are disabled in Internal Proxy settings." } else if self.captured { "Native stack frames or function symbols are unavailable in this build." } else { "Stack capture is omitted before authenticated forwarding." }); }
        for (index,frame) in self.trace.iter().enumerate() { let _=writeln!(output,"{index}: {}",escape(frame)); }
        output.push_str("</pre></details></details><footer>Generated locally. Credentials and private request data are excluded.</footer></main></body></html>");
        output
    }
}

pub(super) fn apply_theme(response: &mut Response<ProxyBody>, theme: &crate::theme_tokens::ThemeTokens) {
    if let Some(report) = response.extensions_mut().get_mut::<Report>() { report.theme_css = theme.css_block(); }
}

pub(super) fn apply_options<B>(response: &mut Response<B>, settings: crate::http::ProxyTransportSettings) {
    if let Some(report) = response.extensions_mut().get_mut::<Report>() {
        report.expand_details = settings.expand_error_details;
        if !settings.include_error_trace { report.trace.clear(); report.trace_disabled = true; }
    }
}

pub(super) fn convert_upstream(status: StatusCode, headers: &hyper::http::HeaderMap, settings: crate::http::ProxyTransportSettings) -> Option<Response<ProxyBody>> {
    use crate::http::ProxyHttpErrorConversion;
    let convert = match settings.http_error_conversion {
        ProxyHttpErrorConversion::Off => false,
        ProxyHttpErrorConversion::ServerErrors => status.is_server_error(),
        ProxyHttpErrorConversion::AllErrors => status.is_server_error() || status.is_client_error(),
    };
    if !convert { return None; }
    let mut converted = response(status, Failure::UpstreamStatus, None, settings.include_error_trace);
    for name in [header::WWW_AUTHENTICATE, header::RETRY_AFTER, header::SET_COOKIE] {
        for value in headers.get_all(&name).iter() { converted.headers_mut().append(name.clone(), value.clone()); }
    }
    apply_options(&mut converted, settings);
    Some(converted)
}

fn escape(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| match c {
            '&' => "&amp;".chars().collect::<Vec<_>>(),
            '<' => "&lt;".chars().collect(),
            '>' => "&gt;".chars().collect(),
            '"' => "&quot;".chars().collect(),
            '\'' => "&#39;".chars().collect(),
            _ => vec![c],
        })
        .collect()
}

pub(super) fn wants_html(accept: Option<&HeaderValue>) -> bool {
    let Some(accept) = accept else {
        return true;
    };
    let Ok(value) = accept.to_str() else {
        return false;
    };
    if value.len() > 8192 {
        return false;
    }
    let mut html: Option<f32> = None;
    let mut wildcard = 0f32;
    let mut other = 0f32;
    for item in value.split(',').take(64) {
        let mut parts = item.trim().split(';');
        let mime = parts.next().unwrap_or("").trim();
        let mut quality = 1f32;
        for parameter in parts {
            if let Some((name, value)) = parameter.trim().split_once('=') {
                if name.eq_ignore_ascii_case("q") {
                    quality = value
                        .parse::<f32>()
                        .ok()
                        .filter(|q| q.is_finite() && (0.0..=1.0).contains(q))
                        .unwrap_or(0.0);
                }
            }
        }
        if mime.eq_ignore_ascii_case("text/html")
            || mime.eq_ignore_ascii_case("application/xhtml+xml")
        {
            html = Some(html.unwrap_or(0.0).max(quality));
        } else if mime == "*/*" || mime.eq_ignore_ascii_case("text/*") {
            wildcard = wildcard.max(quality);
        } else {
            other = other.max(quality);
        }
    }
    let html = html.unwrap_or(wildcard);
    html > 0.0 && html >= other
}

pub(super) fn response(
    status: StatusCode,
    failure: Failure,
    error: Option<&(dyn Error + 'static)>,
    capture_stack: bool,
) -> Response<ProxyBody> {
    let report = Report::capture(status, failure, error, capture_stack);
    let mut response = Response::new(super::intercept::forward::empty_body());
    *response.status_mut() = status;
    response.extensions_mut().insert(report);
    negotiate(response, None, false)
}
pub(super) fn negotiate(
    response: Response<ProxyBody>,
    accept: Option<&HeaderValue>,
    head: bool,
) -> Response<ProxyBody> {
    let Some(report) = response.extensions().get::<Report>() else {
        return response;
    };
    let html = wants_html(accept);
    let body = if html {
        report.html(response.status())
    } else {
        report.text(response.status())
    };
    let length = body.len();
    let id = report.id.clone();
    let code = report.code;
    let (mut parts, _) = response.into_parts();
    let headers = &mut parts.headers;
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(if html {
            "text/html; charset=utf-8"
        } else {
            "text/plain; charset=utf-8"
        }),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&length.to_string()).unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::VARY, HeaderValue::from_static("Accept"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_str(&format!("default-src 'none'; script-src 'sha256-{}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", crate::internal_page::script_hash())).expect("constant script hash CSP"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert("x-sorng-request-id", HeaderValue::from_str(&id).unwrap());
    headers.insert("x-sorng-error-code", HeaderValue::from_static(code));
    Response::from_parts(
        parts,
        if head {
            super::intercept::forward::empty_body()
        } else {
            full_body(body)
        },
    )
}

/// The only raw HTTP writer for authenticated failures before Hyper owns the
/// socket. All input headers and body bytes originate in this bounded renderer.
pub(super) async fn write_response(
    client: &mut tokio::net::TcpStream,
    response: Response<ProxyBody>,
    deadline: std::time::Duration,
) {
    use http_body_util::BodyExt;
    use tokio::io::AsyncWriteExt;
    let (parts, body) = response.into_parts();
    let Ok(body) = body.collect().await else {
        return;
    };
    let mut bytes = format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\n",
        parts.status.as_u16(),
        parts.status.canonical_reason().unwrap_or("Error")
    )
    .into_bytes();
    for (name, value) in &parts.headers {
        if name != header::CONNECTION {
            bytes.extend_from_slice(name.as_str().as_bytes());
            bytes.extend_from_slice(b": ");
            bytes.extend_from_slice(value.as_bytes());
            bytes.extend_from_slice(b"\r\n");
        }
    }
    bytes.extend_from_slice(b"\r\n");
    bytes.extend_from_slice(&body.to_bytes());
    let _ = tokio::time::timeout(deadline, client.write_all(&bytes)).await;
}

const STYLE: &str = r#"*{box-sizing:border-box}html{color-scheme:dark light}body{margin:0;min-height:100dvh;background:var(--proxy-bg);color:var(--proxy-text);font:13px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:clamp(16px,4vw,48px)}main{max-width:720px;margin:6vh auto 0}header{display:flex;justify-content:space-between;gap:12px;padding-bottom:18px;border-bottom:1px solid var(--proxy-border);font-size:12px}.muted,.stage,dt,footer{color:var(--proxy-muted)}.stage{margin:26px 0 5px;font-size:12px}h1{margin:0 0 10px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-.02em}.description{color:var(--proxy-text-2);max-width:660px;margin:0 0 12px}.failure-code{font:11px ui-monospace,monospace;color:var(--proxy-muted);overflow-wrap:anywhere}.advice{margin-top:22px}h2{font-size:12px;font-weight:600;margin:0 0 8px}ul{padding-left:18px;margin:0;color:var(--proxy-text-2)}li+li{margin-top:6px}.technical{margin-top:14px;border-top:1px solid var(--proxy-border);border-bottom:1px solid var(--proxy-border);padding:4px 0}summary{padding:10px 0;cursor:pointer;color:var(--proxy-text-2);font-size:12px}details details{margin:0 0 6px}dl{margin:0 0 12px;display:grid;gap:10px}dt{font-size:11px}dd{margin:2px 0 0;font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;user-select:text}details ol{margin:0;padding:0 0 12px 20px;color:var(--proxy-text-2)}details p{margin:0 0 10px;color:var(--proxy-muted);font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;background:var(--proxy-surface);padding:12px;font:11px/1.6 ui-monospace,monospace;color:var(--proxy-text-2);border-radius:6px}footer{font-size:11px;margin-top:18px}@media(max-width:480px){main{margin-top:16px}h1{font-size:20px}.proxy-actions button{flex:1}}@media print{body{padding:0}main{margin:0}details>summary{font-weight:600}.proxy-actions,#action-status{display:none}pre{max-height:none}}"#;

#[cfg(test)]
#[path = "error_response_tests.rs"]
mod tests;
