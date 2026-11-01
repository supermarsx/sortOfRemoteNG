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
            Self::WeakKey => ("certificate-weak-key", "TLS certificate verification", "The certificate uses unsupported cryptography", "A certificate key or signature algorithm was below the verifier's security requirements.", &["Replace weak certificate keys or obsolete signature algorithms on the server."]),
            Self::TlsProtocol => ("tls-protocol", "TLS negotiation", "TLS negotiation failed", "The TLS peers could not complete a supported handshake. This does not, by itself, identify a certificate trust problem.", &["Check the server's TLS versions, cipher configuration and HTTPS port.", "Enable a supported modern TLS configuration on the server; certificate review cannot repair a protocol mismatch."]),
            Self::Hsts => ("hsts-certificate-error", "HTTPS transport policy", "HTTPS policy rejected this connection", "A certificate error on an HSTS-protected origin cannot be overridden for this connection.", &["Repair the website certificate and HTTPS configuration.", "Keep the website on HTTPS; changing the URL to HTTP does not resolve an HSTS certificate error."]),
            Self::Status => match status.as_u16() {
                400 | 405 | 421 | 431 => ("request-rejected", "Request validation", "The proxy could not accept this request", "The request did not satisfy the private proxy's method, destination or HTTP framing requirements.", &["Check the connection target and request configuration."]),
                403 => ("destination-denied", "Destination policy", "This destination was not permitted", "The current private route or request policy did not grant this destination.", &["Review the connection's website destination permissions.", "Only destinations explicitly admitted by the private route can be requested."]),
                407 => ("proxy-authentication", "Proxy authentication", "Private proxy authentication is required", "The request did not present valid credentials for this attempt's private proxy.", &["Reconnect the owning browser tab to restore its private proxy binding."]),
                408 => ("request-timeout", "Request admission", "The request was not received in time", "The private proxy did not receive a complete request header before its deadline.", &["Retry after checking the client connection."]),
                503 => ("proxy-capacity", "Proxy admission", "The private proxy is busy", "The private proxy could not accept more work at this time.", &["Wait for active requests to finish, then retry."]),
                504 => return Self::ResponseTimeout.explain(status),
                _ => ("proxy-failure", "Private proxy", "The private proxy could not complete the request", "An internal forwarding operation failed before a usable response was available.", &["Review the technical details and connection diagnostics."]),
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
        while let Some(error) = current {
            if causes.len() >= MAX_CAUSES {
                break;
            }
            causes.push(safe_cause(error));
            current = error
                .downcast_ref::<io::Error>()
                .and_then(io::Error::get_ref)
                .map(|inner| inner as &(dyn Error + 'static))
                .or_else(|| error.source());
        }
        Self {
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
        }
    }
    fn text(&self, status: StatusCode) -> String {
        let mut output = format!("SortOfRemoteNG private proxy\nHTTP {} {}\n{}\n\n{}\n\nReference ID: {}\nRecorded: {}\nFailure code: {}\nStage: {}\n\nWhat to check\n", status.as_u16(), status.canonical_reason().unwrap_or("Error"), self.title, self.detail, self.id, self.recorded, self.code, self.stage);
        for hint in self.hints {
            let _ = writeln!(output, "- {hint}");
        }
        output.push_str("\nCause chain\n");
        for (index, cause) in self.causes.iter().enumerate() {
            let _ = writeln!(output, "{}. {cause}", index + 1);
        }
        output.push_str("\nError-response backtrace\nCaptured while preparing this response; the asynchronous failure may have originated earlier.\n");
        if self.trace.is_empty() {
            output.push_str(if self.captured {
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
        let mut output = format!(
            r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>{}</title><style>{}</style></head><body><main><header><span class="brand">SortOfRemoteNG <span>PRIVATE PROXY</span></span><span class="status">HTTP {}</span></header><section class="intro"><div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z"/><path d="m9 9 6 6m0-6-6 6"/></svg></div><p class="eyebrow">{}</p><h1>{}</h1><p class="description">{}</p></section><dl class="facts"><div><dt>Failure code</dt><dd>{}</dd></div><div><dt>Recorded in UTC</dt><dd>{}</dd></div><div class="reference"><dt>Reference ID</dt><dd>{}</dd></div></dl><section class="advice"><h2>What to check</h2><ol>"##,
            escape(self.title),
            STYLE,
            status.as_u16(),
            escape(self.stage),
            escape(self.title),
            escape(self.detail),
            escape(self.code),
            escape(&self.recorded),
            escape(&self.id)
        );
        for hint in self.hints {
            let _ = write!(output, "<li>{}</li>", escape(hint));
        }
        output.push_str("</ol></section><section class=\"technical\" aria-label=\"Technical details\"><h2>Technical details</h2><details open><summary>Cause chain</summary><ol>");
        for cause in &self.causes {
            let _ = write!(output, "<li>{}</li>", escape(cause));
        }
        output.push_str("</ol></details><details><summary>Error-response backtrace</summary><p>Captured while preparing this response; the asynchronous failure may have originated earlier.</p><pre>");
        if self.trace.is_empty() {
            output.push_str(if self.captured {
                "Native stack frames or function symbols are unavailable in this build."
            } else {
                "Stack capture is omitted before authenticated forwarding."
            });
        }
        for (index, frame) in self.trace.iter().enumerate() {
            let _ = writeln!(output, "{index}: {}", escape(frame));
        }
        output.push_str("</pre></details></section><footer>Generated locally by the private proxy. Request headers, credentials, URL queries and local source paths are excluded.</footer></main></body></html>");
        output
    }
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
        HeaderValue::from_static(
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        ),
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

const STYLE: &str = r#"*{box-sizing:border-box}html{color-scheme:dark light}body{margin:0;background:#0b1020;color:#e8edf7;font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:clamp(12px,4vw,48px)}main{max-width:920px;margin:auto;background:#111a2d;border:1px solid #29354d;border-radius:20px;overflow:hidden;box-shadow:0 20px 70px #0003}header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 28px;border-bottom:1px solid #29354d}.brand{font-size:14px;font-weight:700}.brand span{display:block;font-size:10px;color:#95a5bf;letter-spacing:.14em}.status{font:12px ui-monospace,monospace;padding:5px 10px;border:1px solid #5c3d35;border-radius:999px;background:#3b2624;color:#ffbf9d}.intro{padding:30px 28px 20px}.icon{float:right;width:54px;height:54px;padding:12px;border-radius:16px;background:#392d2a;color:#f9b78f}.icon svg{width:100%;height:100%}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#9caec9;margin:0 0 6px}h1{font-size:clamp(24px,4vw,34px);line-height:1.2;margin:0 70px 14px 0;letter-spacing:-.025em}.description{color:#b1bfd4;max-width:730px;margin:0}.facts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 28px;padding:18px 0;border-top:1px solid #29354d;border-bottom:1px solid #29354d}.reference{grid-column:1/-1}dt{color:#95a5bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em}dd{margin:3px 0 0;font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;user-select:text}h2{font-size:14px;margin:0 0 10px}.advice,.technical{padding:22px 28px}.advice{background:#152139}.advice ol{padding-left:22px;margin:0;color:#c7d4e9}li+li{margin-top:8px}details{border:1px solid #29354d;border-radius:10px;margin-top:10px;overflow:hidden}summary{padding:12px 15px;cursor:pointer;font-size:13px;font-weight:600}summary:focus-visible{outline:2px solid #8db7ff;outline-offset:-3px}details ol,details p{margin:0;padding:0 20px 16px 36px;color:#adbed6;font-size:13px}details p{padding:0 16px 12px}pre{margin:0;padding:16px;overflow:auto;max-height:420px;background:#0b1323;color:#c3d1e9;font:11px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}footer{padding:18px 28px;color:#8b9cb8;font-size:11px;border-top:1px solid #29354d}@media(max-width:520px){header,.intro,.advice,.technical,footer{padding-left:18px;padding-right:18px}.facts{margin-left:18px;margin-right:18px;grid-template-columns:1fr}.reference{grid-column:auto}.icon{width:44px;height:44px}h1{margin-right:54px}}@media(prefers-color-scheme:light){body{background:#f1f4fa;color:#14223b}main{background:#fff;border-color:#d5ddea}header,.facts,footer,details{border-color:#d5ddea}.description,.advice ol,details ol,details p{color:#415574}.advice{background:#eff5ff}pre{background:#f4f7fc;color:#263e61}.eyebrow,dt,.brand span,footer{color:#5d7190}}@media print{body{padding:0;background:#fff}main{box-shadow:none}details{break-inside:avoid}pre{max-height:none}}"#;

#[cfg(test)]
#[path = "error_response_tests.rs"]
mod tests;
