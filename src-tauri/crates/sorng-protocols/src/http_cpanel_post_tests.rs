//! Wire-level POST forwarding checks using synthetic cPanel-shaped login data.
//! The local upstream models form decoding, not cPanel authentication.
use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const FORM: &str = "user=fixture%2Buser%40example.test&pass=synthetic%26pass%3D%2B%25+caf%C3%A9&goto_uri=%2F&empty=&flag=one&flag=two";
const MIME: &str = "application/x-www-form-urlencoded";

struct CapturedPost {
    method: axum::http::Method,
    uri: String,
    headers: HeaderMap,
    body: Vec<u8>,
}

struct CaptureUpstream {
    url: String,
    requests: Arc<std::sync::Mutex<Vec<CapturedPost>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for CaptureUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn capture_upstream() -> CaptureUpstream {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = requests.clone();
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let captured = captured.clone();
        async move {
            let (parts, body) = request.into_parts();
            let body = axum::body::to_bytes(body, 64 * 1024).await.unwrap();
            let redirect = parts
                .uri
                .path()
                .strip_prefix("/redirect/")
                .and_then(|value| value.parse::<u16>().ok());
            let form_mime = parts
                .headers
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.split(';').next() == Some(MIME));
            let has_username = form_mime
                && url::form_urlencoded::parse(&body)
                    .any(|(name, value)| name == "user" && !value.is_empty());
            captured.lock().unwrap().push(CapturedPost {
                method: parts.method,
                uri: parts.uri.to_string(),
                headers: parts.headers,
                body: body.to_vec(),
            });
            if let Some(status) = redirect {
                Response::builder()
                    .status(status)
                    .header("Location", "/login/?login_only=1")
                    .body(Body::empty())
                    .unwrap()
            } else {
                Response::builder()
                    .header("Content-Type", "application/json")
                    .body(Body::from(if has_username {
                        r#"{"status":1}"#
                    } else {
                        r#"{"status":0,"message":"no_username"}"#
                    }))
                    .unwrap()
            }
        }
    });
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    CaptureUpstream {
        url,
        requests,
        task,
    }
}

async fn cpanel_proxy(upstream: &CaptureUpstream) -> FixtureProxy {
    proxy_with_policy_and_network(
        upstream.url.clone(),
        client(),
        UpstreamAuthMode::None,
        HttpProxyPolicy::default(),
        HashMap::new(),
        Arc::new(
            ProxyNetworkState::default()
                .with_reviewed_application_profile(Some(ReviewedApplicationProfile::Cpanel)),
        ),
    )
    .await
}

fn post(proxy: &FixtureProxy, path: &str) -> reqwest::RequestBuilder {
    client()
        .post(format!("{}{path}", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .header("Referer", format!("{}/", proxy.state.proxy_origin))
}

fn assert_form_forwarded(request: &CapturedPost, mime: &str) {
    assert_eq!(request.method, axum::http::Method::POST);
    assert_eq!(request.body, FORM.as_bytes());
    assert_eq!(request.headers["content-type"], mime);
    assert_eq!(request.headers["content-length"], FORM.len().to_string());
    assert!(!request.headers.contains_key("transfer-encoding"));
    let fields: Vec<_> = url::form_urlencoded::parse(&request.body).collect();
    assert_eq!(
        fields[0],
        ("user".into(), "fixture+user@example.test".into())
    );
    assert_eq!(fields[1], ("pass".into(), "synthetic&pass=+% café".into()));
}

#[tokio::test]
async fn cpanel_document_and_xhr_posts_preserve_form_bytes_type_and_length() {
    let upstream = capture_upstream().await;
    let proxy = cpanel_proxy(&upstream).await;
    for (dest, mode, mime) in [
        ("iframe", "navigate", MIME),
        (
            "empty",
            "cors",
            "application/x-www-form-urlencoded; charset=UTF-8",
        ),
    ] {
        let response = post(&proxy, "/login/?login_only=1")
            .header("Sec-Fetch-Dest", dest)
            .header("Sec-Fetch-Mode", mode)
            .header("Content-Type", mime)
            .header("Content-Length", FORM.len())
            .body(FORM)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.text().await.unwrap(), r#"{"status":1}"#);
        let requests = upstream.requests.lock().unwrap();
        let request = requests.last().unwrap();
        assert_form_forwarded(request, mime);
        assert_eq!(request.uri, "/login/?login_only=1");
        assert_eq!(request.headers["origin"], proxy.state.target_origin);
        assert_eq!(request.headers["referer"], upstream.url);
    }
    assert_eq!(upstream.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn cpanel_chunked_post_is_buffered_without_losing_fields_and_gets_correct_length() {
    let upstream = capture_upstream().await;
    let proxy = cpanel_proxy(&upstream).await;
    let authority = proxy.base.strip_prefix("http://").unwrap();
    let mut socket = tokio::net::TcpStream::connect(authority).await.unwrap();
    let mut wire = format!(
        "POST /login/?login_only=1 HTTP/1.1\r\nHost: {}\r\nOrigin: {}\r\nContent-Type: {MIME}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
        proxy.state.proxy_authority, proxy.state.proxy_origin,
    );
    // Split percent escapes across chunks as well as form field boundaries.
    for chunk in FORM.as_bytes().chunks(7) {
        wire.push_str(&format!(
            "{:x}\r\n{}\r\n",
            chunk.len(),
            std::str::from_utf8(chunk).unwrap()
        ));
    }
    wire.push_str("0\r\n\r\n");
    socket.write_all(wire.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        socket.read_to_end(&mut response),
    )
    .await
    .unwrap()
    .unwrap();
    let response = String::from_utf8(response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.ends_with(r#"{"status":1}"#));
    let requests = upstream.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_form_forwarded(&requests[0], MIME);
}

#[tokio::test]
async fn cpanel_redirects_preserve_post_on_307_308_and_switch_to_get_on_301_302_303() {
    let upstream = capture_upstream().await;
    let proxy = cpanel_proxy(&upstream).await;
    for status in [301, 302, 303, 307, 308] {
        upstream.requests.lock().unwrap().clear();
        let response = post(&proxy, &format!("/redirect/{status}"))
            .header("Content-Type", MIME)
            .body(FORM)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let requests = upstream.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_form_forwarded(&requests[0], MIME);
        assert_eq!(requests[1].uri, "/login/?login_only=1");
        if matches!(status, 307 | 308) {
            assert_form_forwarded(&requests[1], MIME);
        } else {
            assert_eq!(requests[1].method, axum::http::Method::GET);
            assert!(requests[1].body.is_empty());
            assert!(!requests[1].headers.contains_key("content-type"));
            assert!(!requests[1].headers.contains_key("content-length"));
        }
    }
}

#[tokio::test]
async fn cpanel_missing_username_and_wrong_mime_are_forwarded_without_inventing_credentials() {
    let upstream = capture_upstream().await;
    let proxy = cpanel_proxy(&upstream).await;
    for (body, mime) in [
        ("pass=synthetic", MIME),
        ("user=&pass=synthetic", MIME),
        (FORM, "text/plain"),
    ] {
        let response = post(&proxy, "/login/?login_only=1")
            .header("Content-Type", mime)
            .body(body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.text().await.unwrap(),
            r#"{"status":0,"message":"no_username"}"#
        );
        let requests = upstream.requests.lock().unwrap();
        let request = requests.last().unwrap();
        assert_eq!(request.body, body.as_bytes());
        assert_eq!(request.headers["content-type"], mime);
        assert_eq!(request.headers["content-length"], body.len().to_string());
    }
    assert_eq!(upstream.requests.lock().unwrap().len(), 3);
}
