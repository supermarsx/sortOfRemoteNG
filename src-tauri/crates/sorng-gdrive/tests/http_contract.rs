use chrono::Utc;
use serde::Deserialize;
use sorng_gdrive::client::GDriveClient;
use sorng_gdrive::types::{GDriveConfig, GDriveErrorKind, OAuthToken};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

struct ExpectedResponse {
    method: &'static str,
    target: &'static str,
    authorization: Option<&'static str>,
    form_fields: &'static [&'static str],
    status: &'static str,
    body: &'static str,
}

struct MockHttpServer {
    base_url: String,
    thread: JoinHandle<()>,
}

#[derive(Deserialize)]
struct TestTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

impl MockHttpServer {
    fn start(responses: Vec<ExpectedResponse>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock HTTP server");
        let address = listener.local_addr().expect("mock server address");
        let thread = thread::spawn(move || {
            for expected in responses {
                let (mut stream, _) = listener.accept().expect("accept request");
                let request = read_request(&mut stream);
                assert_eq!(
                    request.lines().next(),
                    Some(format!("{} {} HTTP/1.1", expected.method, expected.target).as_str())
                );
                if let Some(authorization) = expected.authorization {
                    assert!(
                        request
                            .lines()
                            .any(|line| line.eq_ignore_ascii_case(authorization)),
                        "missing authorization header: {request}"
                    );
                } else {
                    assert!(
                        !request
                            .lines()
                            .any(|line| line.to_ascii_lowercase().starts_with("authorization:")),
                        "unexpected authorization header: {request}"
                    );
                }
                for field in expected.form_fields {
                    assert!(
                        request.contains(field),
                        "missing form field {field}: {request}"
                    );
                }

                write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    expected.status,
                    expected.body.len(),
                    expected.body
                )
                .expect("write response");
            }
        });
        Self {
            base_url: format!("http://{address}"),
            thread,
        }
    }

    fn finish(self) {
        self.thread.join().expect("mock server assertions");
    }
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 1024];
    let header_end = loop {
        let count = stream.read(&mut buffer).expect("read request");
        assert_ne!(count, 0, "request ended before headers");
        request.extend_from_slice(&buffer[..count]);
        if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let headers = String::from_utf8_lossy(&request[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .and_then(|value| value.trim().parse::<usize>().ok())
        })
        .unwrap_or(0);
    while request.len() < header_end + content_length {
        let count = stream.read(&mut buffer).expect("read request body");
        assert_ne!(count, 0, "request ended before body");
        request.extend_from_slice(&buffer[..count]);
    }
    String::from_utf8(request).expect("HTTP request is UTF-8")
}

fn client() -> GDriveClient {
    let config = GDriveConfig {
        timeout_seconds: 2,
        max_retries: 0,
        rate_limit_ms: 0,
        ..Default::default()
    };
    let mut client = GDriveClient::new(config).expect("client builds");
    client.set_token(OAuthToken {
        access_token: "drive-access-token".into(),
        refresh_token: Some("drive-refresh-token".into()),
        expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
        ..Default::default()
    });
    client
}

#[tokio::test]
async fn drive_request_uses_bearer_auth_and_propagates_non_success() {
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            method: "GET",
            target: "/drive/v3/about?fields=user",
            authorization: Some("authorization: Bearer drive-access-token"),
            form_fields: &[],
            status: "200 OK",
            body: r#"{"user":{"emailAddress":"alice@example.test"}}"#,
        },
        ExpectedResponse {
            method: "GET",
            target: "/drive/v3/about?fields=user",
            authorization: Some("authorization: Bearer drive-access-token"),
            form_fields: &[],
            status: "401 Unauthorized",
            body: r#"{"error":{"message":"expired credential"}}"#,
        },
    ]);
    let client = client();
    let url = format!("{}/drive/v3/about?fields=user", server.base_url);

    let response: serde_json::Value = client.get_json(&url).await.expect("GET succeeds");
    assert_eq!(
        response["user"]["emailAddress"],
        serde_json::json!("alice@example.test")
    );

    let error = client
        .get_json::<serde_json::Value>(&url)
        .await
        .expect_err("401 must fail");
    assert_eq!(error.kind, GDriveErrorKind::AuthenticationFailed);
    assert!(error.message.contains("expired credential"));
    server.finish();
}

#[tokio::test]
async fn oauth_form_boundary_is_unauthenticated_and_parses_token_response() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        method: "POST",
        target: "/token",
        authorization: None,
        form_fields: &[
            "client_id=client-id",
            "client_secret=client-secret",
            "code=authorization-code",
            "grant_type=authorization_code",
        ],
        status: "200 OK",
        body: r#"{"access_token":"new-access","token_type":"Bearer","expires_in":3600,"refresh_token":"new-refresh"}"#,
    }]);
    let client = client();
    let url = format!("{}/token", server.base_url);
    let params = [
        ("client_id", "client-id"),
        ("client_secret", "client-secret"),
        ("code", "authorization-code"),
        ("grant_type", "authorization_code"),
    ];

    let token: TestTokenResponse = client
        .post_form_unauthenticated(&url, &params)
        .await
        .expect("token form succeeds");
    assert_eq!(token.access_token, "new-access");
    assert_eq!(token.refresh_token.as_deref(), Some("new-refresh"));
    server.finish();
}

#[tokio::test]
async fn empty_revocation_response_succeeds_but_non_success_does_not() {
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            method: "POST",
            target: "/revoke",
            authorization: None,
            form_fields: &["token=drive-access-token"],
            status: "200 OK",
            body: "",
        },
        ExpectedResponse {
            method: "POST",
            target: "/revoke",
            authorization: None,
            form_fields: &["token=drive-access-token"],
            status: "503 Service Unavailable",
            body: r#"{"error":"revocation unavailable"}"#,
        },
    ]);
    let mut client = client();
    let url = format!("{}/revoke", server.base_url);
    let params = [("token", "drive-access-token")];

    client
        .post_form_unauthenticated_unit(&url, &params)
        .await
        .expect("empty successful revocation response is valid");
    let error = client
        .post_form_unauthenticated_unit(&url, &params)
        .await
        .expect_err("non-successful revocation must fail");
    assert_eq!(error.kind, GDriveErrorKind::ServerError);
    assert!(error.message.contains("revocation unavailable"));

    client.clear_token();
    assert!(client.token().is_none());
    assert!(!client.is_authenticated());
    server.finish();
}
