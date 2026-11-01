use super::*;
use crate::private_forward_proxy::{
    exact_authority_grant, Authority, BoxedStream, DialFuture, PrivateForwardProxy, ProxyLimits,
};
use base64::Engine;
use http_body_util::BodyExt;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn body(response: Response<ProxyBody>) -> String {
    String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap()
}

#[test]
fn native_frames_keep_functions_and_drop_source_paths_addresses_and_untrusted_text() {
    let input = "stack backtrace:\n   0: sorng_protocols::private_forward_proxy::error_response::stack\n             at F:\\Users\\private-user\\source.rs:12:3\n   1: tokio::runtime::task::run\n   2: 0x1234567890\n   3: https://user:PRIVATE@example.test/?token=SECRET\n   4: password=SECRET\n   5: <alloc::boxed::Box<T> as core::ops::drop::Drop>::drop\n";
    let frames = safe_frames(input);
    assert_eq!(frames.len(), 3);
    let joined = frames.join("\n");
    assert!(joined.contains("sorng_protocols::private_forward_proxy"));
    for private in [
        "private-user",
        "source.rs",
        "0x123",
        "PRIVATE",
        "SECRET",
        "https://",
    ] {
        assert!(!joined.contains(private), "{private}");
    }
    let many = (0..1000)
        .map(|n| format!("{n}: sorng_protocols::{}\n", "a".repeat(1000)))
        .collect::<String>();
    let frames = safe_frames(&many);
    assert_eq!(frames.len(), MAX_FRAMES);
    assert!(frames.iter().all(|frame| frame.chars().count() <= 240));
}

#[test]
fn trace_formatter_stops_at_byte_budget_without_breaking_utf8() {
    let mut output = Limited {
        text: String::new(),
    };
    assert!(write!(output, "{}", "é".repeat(MAX_TRACE_BYTES)).is_err());
    assert!(output.text.len() <= MAX_TRACE_BYTES);
    assert!(std::str::from_utf8(output.text.as_bytes()).is_ok());
}

#[derive(Debug)]
struct PrivateChain;
impl fmt::Display for PrivateChain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "https://user:SECRET@host/path?token=PRIVATE Authorization: Bearer TOKEN C:\\Users\\NAME")
    }
}
impl Error for PrivateChain {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(self)
    }
}

#[test]
fn error_causes_are_typed_and_bounded_without_displaying_private_error_text() {
    let report = Report::capture(
        StatusCode::BAD_GATEWAY,
        Failure::Route,
        Some(&PrivateChain),
        false,
    );
    assert_eq!(report.causes.len(), MAX_CAUSES);
    let rendered = report.text(StatusCode::BAD_GATEWAY);
    for private in ["SECRET", "PRIVATE", "TOKEN", "C:\\Users", "Authorization:"] {
        assert!(!rendered.contains(private), "{private}");
    }
    let io = io::Error::new(io::ErrorKind::ConnectionRefused, "PASSWORD_AND_PRIVATE_URL");
    let report = Report::capture(StatusCode::BAD_GATEWAY, Failure::Route, Some(&io), false);
    assert!(report
        .causes
        .iter()
        .any(|cause| cause == "Connection refused"));
    assert!(!report
        .text(StatusCode::BAD_GATEWAY)
        .contains("PASSWORD_AND_PRIVATE_URL"));
}

#[test]
fn typed_certificate_name_failure_survives_io_wrapping_without_exposing_names() {
    let error =
        rustls::Error::InvalidCertificate(rustls::CertificateError::NotValidForNameContext {
            expected: rustls::pki_types::ServerName::try_from("private-expected.invalid").unwrap(),
            presented: vec!["private-presented.invalid".into()],
        });
    let error = io::Error::new(io::ErrorKind::InvalidData, error);
    let report = Report::capture(
        StatusCode::BAD_GATEWAY,
        Failure::HttpTransport,
        Some(&error),
        false,
    );
    let rendered = report.text(StatusCode::BAD_GATEWAY);
    assert!(rendered.contains("Certificate hostname mismatch (NotValidForName)"));
    assert!(!rendered.contains("private-expected"));
    assert!(!rendered.contains("private-presented"));
}

#[tokio::test]
async fn upstream_error_body_and_content_type_are_preserved_even_with_spoofed_report_headers() {
    let mut response = Response::new(super::super::intercept::forward::full_body(
        "upstream-site-error",
    ));
    *response.status_mut() = StatusCode::BAD_GATEWAY;
    response
        .headers_mut()
        .insert("x-sorng-error-code", HeaderValue::from_static("spoofed"));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    let response = negotiate(
        response,
        Some(&HeaderValue::from_static("text/html")),
        false,
    );
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    assert_eq!(body(response).await, "upstream-site-error");
}

#[tokio::test]
async fn fatal_tls_reasons_remain_distinct_and_keep_compatibility_tag() {
    use crate::private_forward_proxy::intercept::{
        forward, trust::UpstreamFatal, upstream::UpstreamFailure,
    };
    for (reason, code, title) in [
        (
            UpstreamFatal::Revoked,
            "certificate-revoked",
            "The website certificate is revoked",
        ),
        (
            UpstreamFatal::BadSignature,
            "certificate-bad-signature",
            "The certificate signature is invalid",
        ),
        (
            UpstreamFatal::Malformed,
            "certificate-malformed",
            "The website supplied an invalid certificate",
        ),
        (
            UpstreamFatal::WeakKey,
            "certificate-weak-key",
            "The certificate uses unsupported cryptography",
        ),
        (
            UpstreamFatal::Protocol,
            "tls-protocol",
            "TLS negotiation failed",
        ),
        (
            UpstreamFatal::HstsViolation,
            "hsts-certificate-error",
            "HTTPS policy rejected this connection",
        ),
    ] {
        let response = forward::upstream_failure(UpstreamFailure::Fatal(reason));
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(response.headers()["x-sorng-upstream"], "fatal");
        assert_eq!(response.headers()["x-sorng-error-code"], code);
        assert!(
            uuid::Uuid::parse_str(response.headers()["x-sorng-request-id"].to_str().unwrap())
                .is_ok()
        );
        let page = body(response).await;
        assert!(page.contains(title));
        assert!(page.contains("Error-response backtrace"));
        if reason == UpstreamFatal::Protocol {
            assert!(page.contains("does not, by itself, identify a certificate trust problem"));
        }
    }
}

#[test]
fn explicit_non_html_preferences_and_quality_zero_get_plain_text() {
    for accept in [
        "text/plain",
        "application/json",
        "text/html;q=0,*/*;q=1",
        "text/html;q=.2,text/plain;q=1",
        "text/html;q=NaN",
    ] {
        assert!(
            !wants_html(Some(&HeaderValue::from_str(accept).unwrap())),
            "{accept}"
        );
    }
    for accept in [
        None,
        Some("text/html,application/xhtml+xml,application/xml;q=.9,*/*;q=.8"),
        Some("*/*"),
    ] {
        assert!(wants_html(
            accept.map(|s| HeaderValue::from_str(s).unwrap()).as_ref()
        ));
    }
}

#[tokio::test]
async fn reports_are_self_contained_script_free_no_store_and_head_has_no_body() {
    let response = response(StatusCode::BAD_GATEWAY, Failure::TlsProtocol, None, true);
    let report = response.extensions().get::<Report>().unwrap().clone();
    let html = report.html(StatusCode::BAD_GATEWAY);
    assert!(html.len() < 96 * 1024);
    for marker in [
        "<meta name=\"viewport\"",
        "<summary>Cause chain",
        "<summary>Error-response backtrace",
        "Reference ID",
        "Technical details",
        "What to check",
    ] {
        assert!(html.contains(marker), "{marker}");
    }
    for forbidden in [
        "<script",
        "<form",
        "<input",
        "javascript:",
        "postMessage",
        "<link",
        "<img",
        "url(",
        "https://",
        "http://",
    ] {
        assert!(!html.contains(forbidden), "{forbidden}");
    }
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        response.headers()[header::X_CONTENT_TYPE_OPTIONS],
        "nosniff"
    );
    assert!(response.headers()[header::CONTENT_SECURITY_POLICY]
        .to_str()
        .unwrap()
        .contains("default-src 'none'"));
    let response = negotiate(
        response,
        Some(&HeaderValue::from_static("text/plain")),
        true,
    );
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/plain; charset=utf-8"
    );
    assert_eq!(
        response.headers()[header::CONTENT_LENGTH],
        report.text(StatusCode::BAD_GATEWAY).len().to_string()
    );
    assert!(body(response).await.is_empty());
}

#[test]
fn diagnostic_symbols_are_escaped_in_html_and_never_create_executable_markup() {
    let mut report = Report::capture(StatusCode::BAD_GATEWAY, Failure::Route, None, false);
    report.trace = vec!["sorng_protocols::<svg onload=evil()> & \"quoted\"".into()];
    let html = report.html(StatusCode::BAD_GATEWAY);
    assert!(html.contains("&lt;svg onload=evil()&gt; &amp; &quot;quoted&quot;"));
    assert!(!html.contains("<svg onload"));
}

#[tokio::test]
async fn real_plain_http_route_failure_negotiates_diagnostics_and_never_echoes_request_secrets() {
    let dialer = Arc::new(|_: Authority| -> DialFuture {
        Box::pin(async {
            Err::<BoxedStream, _>(io::Error::new(
                io::ErrorKind::ConnectionRefused,
                "DO_NOT_EXPOSE_ROUTE_ERROR_SECRET",
            ))
        })
    });
    let mut proxy = PrivateForwardProxy::start(
        dialer,
        exact_authority_grant(Authority::parse("fixture.invalid:80").unwrap()),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    let auth = proxy
        .with_credentials(|user, password| {
            base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
        })
        .unwrap();
    for (method, accept, html) in [
        ("GET", "text/html", true),
        ("GET", "application/json", false),
        ("HEAD", "text/html", true),
    ] {
        let mut socket = tokio::net::TcpStream::connect(proxy.local_addr())
            .await
            .unwrap();
        socket.write_all(format!("{method} http://fixture.invalid/admin?token=REQUEST_QUERY_SECRET HTTP/1.1\r\nHost: fixture.invalid\r\nProxy-Authorization: Basic {auth}\r\nAuthorization: Bearer REQUEST_HEADER_SECRET\r\nCookie: session=REQUEST_COOKIE_SECRET\r\nAccept: {accept}\r\n\r\n").as_bytes()).await.unwrap();
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(8), socket.read_to_end(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        let response = String::from_utf8(bytes).unwrap();
        let (headers, page) = response.split_once("\r\n\r\n").unwrap();
        assert!(headers.starts_with("HTTP/1.1 502"));
        assert!(headers.contains("x-sorng-request-id:"));
        if method == "HEAD" {
            assert!(page.is_empty());
        } else {
            assert_eq!(page.contains("<!doctype html>"), html);
            assert!(page.contains("Connection refused"));
            assert!(page.contains("Cause chain"));
            assert!(page.contains("Error-response backtrace"));
        }
        for secret in [
            "REQUEST_QUERY_SECRET",
            "REQUEST_HEADER_SECRET",
            "REQUEST_COOKIE_SECRET",
            "DO_NOT_EXPOSE_ROUTE_ERROR_SECRET",
            &auth,
        ] {
            assert!(!response.contains(secret), "{secret}");
        }
    }
    proxy.stop().await.unwrap();
}
