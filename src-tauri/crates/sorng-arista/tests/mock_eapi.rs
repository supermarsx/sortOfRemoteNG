//! Integration tests against a hand-rolled mock eAPI server (synthetic data).

use sorng_arista::{fetch_cooling, AristaConfig};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

type Handler = Arc<dyn Fn(&str, &str) -> (u16, String) + Send + Sync>;

/// Spawn a one-route mock. The handler gets (authorization header, request body).
async fn spawn(handler: Handler) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let seen = bodies.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else { return };
            let handler = handler.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut tmp = [0u8; 4096];
                loop {
                    let n = sock.read(&mut tmp).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(idx) = text.find("\r\n\r\n") {
                        let head = &text[..idx];
                        let len = head
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if text.len() >= idx + 4 + len {
                            let body = text[idx + 4..idx + 4 + len].to_string();
                            let auth = head
                                .lines()
                                .find(|l| l.to_ascii_lowercase().starts_with("authorization:"))
                                .unwrap_or("")
                                .to_string();
                            seen.lock().unwrap().push(body.clone());
                            let (status, reply) = handler(&auth, &body);
                            let resp = format!(
                                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                                reply.len()
                            );
                            let _ = sock.write_all(resp.as_bytes()).await;
                            let _ = sock.shutdown().await;
                            return;
                        }
                    }
                }
            });
        }
    });
    (port, bodies)
}

fn cfg(port: u16) -> AristaConfig {
    AristaConfig {
        host: "127.0.0.1".into(),
        port: Some(port),
        username: "admin".into(),
        password: "pw".into(),
        use_https: false,
        insecure_tls: false,
        timeout_secs: Some(3),
    }
}

const OK_BODY: &str = r#"{"jsonrpc":"2.0","id":"x","result":[{"systemStatus":"coolingOk","fanTraySlots":[{"label":"1","status":"ok","fans":[{"label":"1/1","status":"ok","actualSpeed":38,"configuredSpeed":38}]}]}]}"#;

#[tokio::test]
async fn success_sends_basic_auth_and_runcmds() {
    let (port, bodies) = spawn(Arc::new(|_, _| (200, OK_BODY.to_string()))).await;
    let r = fetch_cooling(&cfg(port)).await.unwrap();
    assert_eq!(r.fans.len(), 1);
    assert_eq!(r.source, "show system environment cooling");
    let sent: serde_json::Value = serde_json::from_str(&bodies.lock().unwrap()[0]).unwrap();
    assert_eq!(sent["method"], "runCmds");
    assert_eq!(sent["params"]["cmds"][0], "show system environment cooling");
    assert_eq!(sent["params"]["format"], "json");
}

#[tokio::test]
async fn auth_header_is_basic() {
    let (port, _) = spawn(Arc::new(|auth, _| {
        // base64("admin:pw") = YWRtaW46cHc=
        if auth.contains("Basic YWRtaW46cHc=") {
            (200, OK_BODY.to_string())
        } else {
            (401, "{}".to_string())
        }
    }))
    .await;
    assert!(fetch_cooling(&cfg(port)).await.is_ok());
}

#[tokio::test]
async fn unauthorized_is_reported() {
    let (port, _) = spawn(Arc::new(|_, _| (401, "{}".to_string()))).await;
    let e = fetch_cooling(&cfg(port)).await.unwrap_err();
    assert!(e.contains("Authentication failed"), "{e}");
}

#[tokio::test]
async fn invalid_command_falls_back_to_legacy_alias() {
    let (port, bodies) = spawn(Arc::new(|_, body| {
        if body.contains("show system environment cooling") {
            (
                200,
                r#"{"jsonrpc":"2.0","id":"x","error":{"code":1002,"message":"CLI command 1 of 1 'show system environment cooling' failed: invalid command"}}"#.to_string(),
            )
        } else {
            (200, OK_BODY.to_string())
        }
    }))
    .await;
    let r = fetch_cooling(&cfg(port)).await.unwrap();
    assert_eq!(r.source, "show environment cooling");
    assert_eq!(bodies.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn both_commands_invalid_is_clear_error() {
    let (port, _) = spawn(Arc::new(|_, _| {
        (200, r#"{"error":{"code":1002,"message":"invalid command"}}"#.to_string())
    }))
    .await;
    let e = fetch_cooling(&cfg(port)).await.unwrap_err();
    assert!(e.contains("does not support"), "{e}");
}

#[tokio::test]
async fn other_eapi_error_does_not_fall_back() {
    let (port, bodies) = spawn(Arc::new(|_, _| {
        (200, r#"{"error":{"code":1000,"message":"unauthorized"}}"#.to_string())
    }))
    .await;
    let e = fetch_cooling(&cfg(port)).await.unwrap_err();
    assert!(e.contains("eAPI error: unauthorized"), "{e}");
    assert_eq!(bodies.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn non_json_body_is_error() {
    let (port, _) = spawn(Arc::new(|_, _| (200, "<html>nope</html>".to_string()))).await;
    let e = fetch_cooling(&cfg(port)).await.unwrap_err();
    assert!(e.contains("Invalid eAPI response"), "{e}");
}

#[tokio::test]
async fn connection_refused_hints_at_eapi() {
    // Bind then drop to obtain a closed port.
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    let e = fetch_cooling(&cfg(port)).await.unwrap_err();
    assert!(e.contains("http-commands"), "{e}");
}

#[tokio::test]
async fn timeout_is_reported() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (_s, _) = listener.accept().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    });
    let mut c = cfg(port);
    c.timeout_secs = Some(1);
    let e = fetch_cooling(&c).await.unwrap_err();
    assert!(e.contains("timed out"), "{e}");
}

#[tokio::test]
async fn https_with_insecure_flag_against_plain_server_fails_cleanly() {
    // A TLS handshake against a plaintext listener must surface an error, not hang or panic.
    let (port, _) = spawn(Arc::new(|_, _| (200, OK_BODY.to_string()))).await;
    let mut c = cfg(port);
    c.use_https = true;
    c.insecure_tls = true;
    assert!(fetch_cooling(&c).await.is_err());
}
