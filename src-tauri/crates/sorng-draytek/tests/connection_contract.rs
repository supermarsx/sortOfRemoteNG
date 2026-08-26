use sorng_draytek::client::DraytekClient;
use sorng_draytek::error::DraytekErrorKind;
use sorng_draytek::service::DraytekServiceWrapper;
use sorng_draytek::types::DraytekConnectionConfig;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct CannedResponse {
    status: &'static str,
    body: String,
    set_cookie: Option<&'static str>,
}

fn ok(body: impl Into<String>) -> CannedResponse {
    CannedResponse {
        status: "200 OK",
        body: body.into(),
        set_cookie: None,
    }
}

fn ok_with_session(body: impl Into<String>) -> CannedResponse {
    CannedResponse {
        status: "200 OK",
        body: body.into(),
        set_cookie: Some("SESSION_ID_VIGOR=deadbeef; path=/"),
    }
}

/// Recorded request: full raw text (request line, headers, body).
type Recorded = Arc<Mutex<Vec<String>>>;

/// Fake DrayOS router: serves the canned responses in order, one connection
/// per request, and records every raw request for assertions.
async fn spawn_router(
    responses: Vec<CannedResponse>,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>, Recorded) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let recorded: Recorded = Arc::new(Mutex::new(Vec::new()));
    let sink = recorded.clone();
    let task = tokio::spawn(async move {
        for canned in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut header_end = None;
            loop {
                let mut chunk = [0_u8; 1024];
                let read = stream.read(&mut chunk).await.unwrap();
                assert!(read > 0, "client closed before request complete");
                request.extend_from_slice(&chunk[..read]);
                if header_end.is_none() {
                    header_end = request
                        .windows(4)
                        .position(|w| w == b"\r\n\r\n")
                        .map(|p| p + 4);
                }
                if let Some(end) = header_end {
                    let head = String::from_utf8_lossy(&request[..end]).to_string();
                    let content_length = head
                        .lines()
                        .find_map(|l| {
                            let (k, v) = l.split_once(':')?;
                            k.trim()
                                .eq_ignore_ascii_case("content-length")
                                .then(|| v.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    if request.len() >= end + content_length {
                        break;
                    }
                }
            }
            sink.lock()
                .unwrap()
                .push(String::from_utf8_lossy(&request).to_string());
            let cookie = canned
                .set_cookie
                .map(|c| format!("Set-Cookie: {c}\r\n"))
                .unwrap_or_default();
            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: text/html\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                canned.status,
                cookie,
                canned.body.len(),
                canned.body
            );
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.ok();
        }
    });
    (address, task, recorded)
}

fn config(address: std::net::SocketAddr) -> DraytekConnectionConfig {
    DraytekConnectionConfig {
        host: address.ip().to_string(),
        port: address.port(),
        username: "admin".into(),
        password: "s3cret!".into(),
        use_tls: false,
        accept_invalid_certs: false,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: 5,
        proxy_url: None,
        vendor: "draytek".into(),
    }
}

fn request_line(raw: &str) -> &str {
    raw.lines().next().unwrap_or("")
}

fn body_of(raw: &str) -> &str {
    raw.split("\r\n\r\n").nth(1).unwrap_or("")
}

fn header_of<'a>(raw: &'a str, name: &str) -> Option<&'a str> {
    raw.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

const CLASSIC_LOGIN_PAGE: &str = r#"<html><body><form method="post" action="/cgi-bin/wlogin.cgi">
<input type="text" name="aa"><input type="password" name="ab"><input type="submit"></form></body></html>"#;

const TOKEN_LOGIN_PAGE: &str = r#"<html><body><form method="post" action="/cgi-bin/wlogin.cgi">
<input type="hidden" name="sFormAuthStr" value="tok-7f3a9c">
<input type="hidden" name="rtick" value="1700000000">
<input type="text" name="aa"><input type="password" name="ab"></form></body></html>"#;

const RSA_LOGIN_PAGE: &str = r#"<html><head><script src="/js/rsa.js"></script><script>
var rsa = new RSAKey(); rsa.setPublic("c0ffee00", "10001");
function doLogin(){ var enc = rsa.encrypt(document.getElementById('sPassword').value); }
</script></head><body><form action="/cgi-bin/wlogin.cgi"><input type="hidden" name="sFormAuthStr" value="tok"><input name="aa"><input name="ab"></form></body></html>"#;

const DASHBOARD: &str =
    r#"<html><head><title>Vigor2862</title></head><body>Dashboard<br>Welcome admin</body></html>"#;

const STATUS_PAGE: &str = r#"<html><head><title>Vigor2862</title></head><body>
<table><tr><td>Model Name</td><td>Vigor2862ac</td></tr>
<tr><td>Firmware Version</td><td>3.9.7.1</td></tr>
<tr><td>Build Date/Time</td><td>Feb 17 2022 12:21:04</td></tr>
<tr><td>Router Name</td><td>edge-vigor</td></tr>
<tr><td>System Up Time</td><td>3d 04:12:55</td></tr></table>
<table><tr><th>Interface</th><th>Status</th><th>IP Address</th><th>Gateway</th></tr>
<tr><td>WAN1</td><td>Up</td><td>203.0.113.5</td><td>203.0.113.1</td></tr>
<tr><td>WAN2</td><td>Down</td><td>---</td><td>---</td></tr></table></body></html>"#;

// (g) — mirrors pfSense's guard verbatim.
#[test]
fn insecure_tls_requires_a_matching_runtime_acknowledgement() {
    let mut cfg = DraytekConnectionConfig {
        host: "vigor.example.test".into(),
        port: 443,
        username: "admin".into(),
        password: "pw".into(),
        use_tls: true,
        accept_invalid_certs: true,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: 5,
        proxy_url: None,
        vendor: "draytek".into(),
    };
    let err = DraytekClient::new(cfg.clone())
        .err()
        .expect("guard must reject");
    assert_eq!(err.kind, DraytekErrorKind::InvalidRequest);
    cfg.acknowledge_invalid_cert_risk = true;
    assert!(DraytekClient::new(cfg.clone()).is_ok());
    // Acknowledging when nothing is bypassed is equally rejected.
    cfg.accept_invalid_certs = false;
    assert!(DraytekClient::new(cfg).is_err());
}

// (a) classic login sends aa/ab = base64(user)/base64(pass).
#[tokio::test]
async fn classic_login_posts_base64_credentials() {
    let (address, server, recorded) =
        spawn_router(vec![ok(CLASSIC_LOGIN_PAGE), ok_with_session(DASHBOARD)]).await;
    let client = DraytekClient::new(config(address)).unwrap();
    client.login().await.unwrap();
    assert!(client.is_logged_in());
    server.await.unwrap();

    let reqs = recorded.lock().unwrap();
    assert_eq!(request_line(&reqs[0]), "GET /weblogin.htm HTTP/1.1");
    assert_eq!(request_line(&reqs[1]), "POST /cgi-bin/wlogin.cgi HTTP/1.1");
    assert_eq!(
        header_of(&reqs[1], "content-type"),
        Some("application/x-www-form-urlencoded")
    );
    // base64("admin") = YWRtaW4= ; base64("s3cret!") = czNjcmV0IQ==
    let body = body_of(&reqs[1]);
    assert_eq!(body, "aa=YWRtaW4%3D&ab=czNjcmV0IQ%3D%3D");
    assert!(!body.contains("sFormAuthStr"));
    // Plaintext password must never be on the wire.
    assert!(!reqs[1].contains("s3cret!"));
}

// (b) sFormAuthStr is scraped from the login page and echoed in the POST.
#[tokio::test]
async fn token_login_echoes_scraped_sformauthstr() {
    let (address, server, recorded) =
        spawn_router(vec![ok(TOKEN_LOGIN_PAGE), ok_with_session(DASHBOARD)]).await;
    let client = DraytekClient::new(config(address)).unwrap();
    client.login().await.unwrap();
    assert_eq!(client.form_auth_str().as_deref(), Some("tok-7f3a9c"));
    server.await.unwrap();

    let reqs = recorded.lock().unwrap();
    let body = body_of(&reqs[1]);
    assert!(body.starts_with("aa=YWRtaW4%3D&ab=czNjcmV0IQ%3D%3D"));
    assert!(body.contains("&sFormAuthStr=tok-7f3a9c"));
}

// (c) SESSION_ID_VIGOR captured on login and re-sent on the next request.
#[tokio::test]
async fn session_cookie_is_captured_and_resent() {
    let (address, server, recorded) = spawn_router(vec![
        ok(CLASSIC_LOGIN_PAGE),
        ok_with_session(DASHBOARD),
        ok(STATUS_PAGE),
    ])
    .await;
    let client = DraytekClient::new(config(address)).unwrap();
    client.login().await.unwrap();
    let status = sorng_draytek::status::fetch_status(&client).await.unwrap();
    assert_eq!(status.model.as_deref(), Some("Vigor2862ac"));
    server.await.unwrap();

    let reqs = recorded.lock().unwrap();
    assert!(header_of(&reqs[0], "cookie").is_none());
    assert_eq!(request_line(&reqs[2]), "GET /doc/status.sht HTTP/1.1");
    let cookie = header_of(&reqs[2], "cookie").expect("session cookie re-sent");
    assert!(cookie.contains("SESSION_ID_VIGOR=deadbeef"));
}

// (d) status page parsed into model/firmware/WAN through the service.
#[tokio::test]
async fn service_connect_parses_status_and_manages_lifecycle() {
    let (address, server, _recorded) = spawn_router(vec![
        ok(TOKEN_LOGIN_PAGE),
        ok_with_session(DASHBOARD),
        ok(STATUS_PAGE),
        ok(STATUS_PAGE),
    ])
    .await;
    let mut service = DraytekServiceWrapper::new();
    let summary = service
        .connect("router".into(), config(address))
        .await
        .unwrap();
    assert_eq!(summary.vendor, "draytek");
    assert_eq!(summary.model.as_deref(), Some("Vigor2862ac"));
    assert_eq!(summary.firmware.as_deref(), Some("3.9.7.1"));
    assert_eq!(summary.hostname.as_deref(), Some("edge-vigor"));
    assert_eq!(service.list_connections(), vec!["router"]);

    let duplicate = service
        .connect("router".into(), config(address))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let status = service.get_status("router").await.unwrap();
    assert_eq!(status.build.as_deref(), Some("Feb 17 2022 12:21:04"));
    assert_eq!(status.uptime.as_deref(), Some("3d 04:12:55"));
    assert_eq!(status.wan.len(), 2);
    assert_eq!(status.wan[0].name, "WAN1");
    assert!(status.wan[0].is_up());
    assert_eq!(status.wan[0].ip.as_deref(), Some("203.0.113.5"));
    assert_eq!(status.wan[0].gateway.as_deref(), Some("203.0.113.1"));
    assert_eq!(status.wan[1].name, "WAN2");
    assert!(!status.wan[1].is_up());
    assert_eq!(status.wan[1].ip, None);

    assert_eq!(
        service.web_ui_url("router").unwrap(),
        format!("http://{}:{}", address.ip(), address.port())
    );
    service.disconnect("router").unwrap();
    assert!(service.list_connections().is_empty());
    assert!(matches!(
        service.disconnect("router").unwrap_err().kind,
        DraytekErrorKind::NotConnected
    ));
    server.await.unwrap();
}

// (e) login form still present after POST → AuthenticationFailed, no map insertion.
#[tokio::test]
async fn rejected_credentials_map_to_authentication_failed() {
    let (address, server, _recorded) =
        spawn_router(vec![ok(CLASSIC_LOGIN_PAGE), ok(CLASSIC_LOGIN_PAGE)]).await;
    let mut service = DraytekServiceWrapper::new();
    let err = service
        .connect("bad".into(), config(address))
        .await
        .unwrap_err();
    assert_eq!(err.kind, DraytekErrorKind::AuthenticationFailed);
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

// (e') no login form but no session cookie either → AuthenticationFailed.
#[tokio::test]
async fn missing_session_cookie_is_authentication_failed() {
    let (address, server, _recorded) =
        spawn_router(vec![ok(CLASSIC_LOGIN_PAGE), ok(DASHBOARD)]).await;
    let client = DraytekClient::new(config(address)).unwrap();
    let err = client.login().await.unwrap_err();
    assert_eq!(err.kind, DraytekErrorKind::AuthenticationFailed);
    assert!(!client.is_logged_in());
    server.await.unwrap();
}

// (f) RSA scheme on the login page → UnsupportedFirmwareLogin, no POST sent.
#[tokio::test]
async fn rsa_login_scheme_is_reported_as_unsupported() {
    let (address, server, recorded) = spawn_router(vec![ok(RSA_LOGIN_PAGE)]).await;
    let client = DraytekClient::new(config(address)).unwrap();
    let err = client.login().await.unwrap_err();
    assert_eq!(err.kind, DraytekErrorKind::UnsupportedFirmwareLogin);
    assert!(err.message.contains("Open Web UI"));
    server.await.unwrap();
    assert_eq!(
        recorded.lock().unwrap().len(),
        1,
        "no credential POST attempted"
    );
}

// Reboot posts to reboot.cgi with the token and the session cookie.
#[tokio::test]
async fn reboot_posts_current_config_with_token_and_cookie() {
    let (address, server, recorded) = spawn_router(vec![
        ok(TOKEN_LOGIN_PAGE),
        ok_with_session(DASHBOARD),
        ok(STATUS_PAGE),
        ok("<html>Rebooting...</html>"),
    ])
    .await;
    let mut service = DraytekServiceWrapper::new();
    service
        .connect("router".into(), config(address))
        .await
        .unwrap();
    let result = service.reboot("router").await.unwrap();
    assert!(result.accepted);
    server.await.unwrap();

    let reqs = recorded.lock().unwrap();
    assert_eq!(request_line(&reqs[3]), "POST /cgi-bin/reboot.cgi HTTP/1.1");
    assert_eq!(body_of(&reqs[3]), "sReboot=Current&sFormAuthStr=tok-7f3a9c");
    assert!(header_of(&reqs[3], "cookie")
        .unwrap()
        .contains("SESSION_ID_VIGOR=deadbeef"));
}

// Reboot without a session is refused before any request.
#[tokio::test]
async fn reboot_requires_live_login() {
    let client = DraytekClient::new(config("127.0.0.1:1".parse().unwrap())).unwrap();
    let err = sorng_draytek::actions::reboot(&client).await.unwrap_err();
    assert_eq!(err.kind, DraytekErrorKind::NotConnected);
}

// (h) CLI parsers are pure functions.
#[test]
fn cli_parsers_extract_version_and_wan_status() {
    use sorng_draytek::cli;
    use sorng_draytek::types::DraytekCliVerb;

    assert_eq!(cli::command_for(DraytekCliVerb::SysVersion), "sys version");
    assert_eq!(cli::command_for(DraytekCliVerb::WanStatus), "wan status");
    assert_eq!(cli::command_for(DraytekCliVerb::SysReboot), "sys reboot");

    let version = cli::parse_sys_version(
        "Router Model: Vigor2865ax  Version: 4.4.5.1  English\nFirmware Build Date/Time: Nov 21 2023 15:02:11\n",
    );
    assert_eq!(version.model.as_deref(), Some("Vigor2865ax"));
    assert_eq!(version.firmware.as_deref(), Some("4.4.5.1"));
    assert_eq!(version.build.as_deref(), Some("Nov 21 2023 15:02:11"));

    let wans = cli::parse_wan_status(
        "WAN1: Online, stall=N\n Mode: PPPoE, Up Time=02:13:44\n IP=203.0.113.5, GW IP=203.0.113.1\nWAN2: Offline, stall=N\n Mode: DHCP, Up Time=00:00:00\n IP=---, GW IP=---\n",
    );
    assert_eq!(wans.len(), 2);
    assert_eq!(wans[0].name, "WAN1");
    assert!(wans[0].is_up());
    assert_eq!(wans[0].ip.as_deref(), Some("203.0.113.5"));
    assert_eq!(wans[0].gateway.as_deref(), Some("203.0.113.1"));
    assert_eq!(wans[0].mode.as_deref(), Some("PPPoE"));
    assert_eq!(wans[1].name, "WAN2");
    assert!(!wans[1].is_up());
    assert_eq!(wans[1].ip, None);
}
