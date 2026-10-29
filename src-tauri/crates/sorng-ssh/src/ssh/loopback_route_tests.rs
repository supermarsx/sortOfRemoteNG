//! In-process SSH server tests for the native browser's SSH local-forward
//! route. The server is russh, the client is the production libssh2 path:
//! `connect_ssh_on_state_observed` plus a local port forward, exactly as
//! `origin_browser_ssh_route::prepare` drives it.
//!
//! "localhost" in a forwarded destination belongs to the SSH server. The
//! fixture records the literal direct-tcpip host so a client-side rewrite to a
//! resolved local address fails the test.
use super::*;
use russh::server::{Auth, Handler, Msg, Session as ServerSession};
use russh::Channel;
use std::sync::Mutex as TestMutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const USER: &str = "route-user";
const PASSWORD: &str = "route-password";
const PROMPT_ID: &str = "native-browser:route-test";

fn host_key() -> russh::keys::PrivateKey {
    use rsa::pkcs8::{EncodePrivateKey, LineEnding};
    static PEM: OnceLock<String> = OnceLock::new();
    // WinCNG libssh2 has no ECDSA/Ed25519 host keys. 1024-bit RSA keeps key
    // generation fast in unoptimized test builds and is still negotiated.
    let pem = PEM.get_or_init(|| {
        rsa::RsaPrivateKey::new(&mut ssh_key::rand_core::OsRng, 1024)
            .unwrap()
            .to_pkcs8_pem(LineEnding::LF)
            .unwrap()
            .to_string()
    });
    russh::keys::decode_secret_key(pem, None).unwrap()
}

#[derive(Clone, Default)]
struct ServerLog {
    direct: Arc<TestMutex<Vec<(String, u32)>>>,
}

#[derive(Clone)]
struct RouteServer {
    log: ServerLog,
    auth_delay: Duration,
}

impl Handler for RouteServer {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        tokio::time::sleep(self.auth_delay).await;
        Ok(if user == USER && password == PASSWORD {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut ServerSession,
    ) -> Result<bool, Self::Error> {
        self.log
            .direct
            .lock()
            .unwrap()
            .push((host_to_connect.to_owned(), port_to_connect));
        // The server's own loopback. In-process, that is this machine's, but
        // the name is resolved here, on the server side of the tunnel.
        if host_to_connect != "localhost" {
            return Ok(false);
        }
        let Ok(port) = u16::try_from(port_to_connect) else {
            return Ok(false);
        };
        tokio::spawn(async move {
            if let Ok(mut upstream) = tokio::net::TcpStream::connect(("localhost", port)).await {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut stream, &mut upstream).await;
            }
        });
        Ok(true)
    }
}

async fn start_ssh_server(auth_delay: Duration) -> (SocketAddr, ServerLog) {
    let config = Arc::new(russh::server::Config {
        keys: vec![host_key()],
        auth_rejection_time: Duration::from_millis(10),
        auth_rejection_time_initial: Some(Duration::ZERO),
        inactivity_timeout: None,
        // The cheapest group libssh2/WinCNG negotiates; unoptimized test
        // builds spend seconds on the larger default groups.
        preferred: russh::Preferred {
            kex: std::borrow::Cow::Borrowed(&[
                russh::kex::DH_G14_SHA256,
                russh::kex::EXTENSION_SUPPORT_AS_SERVER,
                russh::kex::EXTENSION_OPENSSH_STRICT_KEX_AS_SERVER,
            ]),
            ..Default::default()
        },
        ..Default::default()
    });
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let log = ServerLog::default();
    let handler = RouteServer {
        log: log.clone(),
        auth_delay,
    };
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let config = config.clone();
            let handler = handler.clone();
            tokio::spawn(async move {
                if let Ok(session) = russh::server::run_stream(config, stream, handler).await {
                    let _ = session.await;
                }
            });
        }
    });
    (address, log)
}

/// A Webmin stand-in on the SSH server's loopback interface.
async fn start_remote_loopback_http() -> u16 {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buffer).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => request.extend_from_slice(&buffer[..read]),
                    }
                }
                let body = "remote-loopback-webmin";
                let _ = stream
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        )
                        .as_bytes(),
                    )
                    .await;
            });
        }
    });
    port
}

#[derive(Clone, Copy)]
enum PromptAnswer {
    Accept { after: Duration },
    Reject,
}

struct PromptResponder {
    answer: PromptAnswer,
    prompts: TestMutex<Vec<serde_json::Value>>,
}

impl sorng_core::events::AppEventEmitter for PromptResponder {
    fn emit_event(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        if event != "ssh://host-key-prompt" {
            return Ok(());
        }
        let session_id = payload["session_id"].as_str().unwrap().to_owned();
        self.prompts.lock().unwrap().push(payload);
        let answer = self.answer;
        // The pending entry is registered before the event is emitted.
        std::thread::spawn(move || {
            let decision = match answer {
                PromptAnswer::Accept { after } => {
                    std::thread::sleep(after);
                    SshHostKeyPromptDecision::AcceptAndSave
                }
                PromptAnswer::Reject => SshHostKeyPromptDecision::Reject,
            };
            if let Some(sender) = PENDING_HOST_KEY_PROMPTS.lock().unwrap().remove(&session_id) {
                let _ = sender.send(decision);
            }
        });
        Ok(())
    }
}

fn route_config(address: SocketAddr, known_hosts: &Path, timeout_secs: u64) -> SshConnectionConfig {
    // Mirrors origin_browser_ssh_config::build: host keys are always checked.
    let mut config: SshConnectionConfig = serde_json::from_value(serde_json::json!({
        "host": address.ip().to_string(), "port": address.port(), "username": USER,
        "password": PASSWORD, "private_key_path": null, "private_key_passphrase": null,
        "allow_agent_auth": false, "jump_hosts": [], "strict_host_key_checking": true,
        "accept_new_host_keys": false, "also_write_known_hosts": true,
        "known_hosts_path": known_hosts.to_string_lossy(),
        "connect_timeout": timeout_secs, "keep_alive_interval": null,
        "tcp_no_delay": true, "tcp_keepalive": true, "keepalive_probes": 3,
        "ip_protocol": "auto", "compression": false, "compression_level": 6,
        "ssh_version": "auto", "agent_forwarding": false
    }))
    .unwrap();
    config.host_key_prompt_id = Some(PROMPT_ID.to_owned());
    config
}

fn responder(answer: PromptAnswer) -> Arc<PromptResponder> {
    Arc::new(PromptResponder {
        answer,
        prompts: TestMutex::new(Vec::new()),
    })
}

async fn http_through(endpoint: SocketAddr, port: u16) -> String {
    let mut stream = tokio::net::TcpStream::connect(endpoint).await.unwrap();
    stream
        .write_all(format!("GET / HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n").as_bytes())
        .await
        .unwrap();
    let mut response = String::new();
    tokio::time::timeout(
        Duration::from_secs(10),
        stream.read_to_string(&mut response),
    )
    .await
    .expect("forwarded HTTP response")
    .unwrap();
    response
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ssh_routed_localhost_reaches_the_ssh_servers_loopback_after_a_slow_host_key_decision() {
    let temp = tempfile::tempdir().unwrap();
    let _trust = sorng_storage::trust_store::test_support::install_active_runtime_for_tests(
        temp.path().join("databases"),
        "db-ssh-route",
    );
    let known_hosts = temp.path().join("known_hosts");
    let (address, log) = start_ssh_server(Duration::ZERO).await;
    let webmin_port = start_remote_loopback_http().await;
    // The user answers the first-use prompt after the 3 s connect deadline.
    // Waiting for a person must not consume the network deadline.
    let emitter = responder(PromptAnswer::Accept {
        after: Duration::from_secs(4),
    });
    let state = SshService::new_with_emitter(emitter.clone());
    let id = connect_ssh_on_state_observed(
        &state,
        route_config(address, &known_hosts, 3),
        SshEstablishmentOrigin::NativeBrowser,
    )
    .await
    .expect("SSH route connects after the host-key decision");
    {
        let prompts = emitter.prompts.lock().unwrap();
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0]["host_key_prompt_id"], PROMPT_ID);
        assert_eq!(prompts[0]["status"], "first_use");
    }

    let forward = state
        .lock()
        .await
        .setup_port_forward(
            &id,
            PortForwardConfig {
                local_host: "127.0.0.1".into(),
                local_port: 0,
                remote_host: "localhost".into(),
                remote_port: webmin_port,
                direction: PortForwardDirection::Local,
                allow_non_loopback_bind: false,
            },
        )
        .await
        .unwrap();
    let info = state
        .lock()
        .await
        .get_port_forward_info(&id, &forward)
        .unwrap();
    assert_eq!(info.config.remote_host, "localhost");
    let endpoint = SocketAddr::from(([127, 0, 0, 1], info.config.local_port));
    let response = http_through(endpoint, webmin_port).await;
    assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
    assert!(response.ends_with("remote-loopback-webmin"), "{response}");
    // The destination name travelled unresolved to the SSH server.
    assert_eq!(
        log.direct.lock().unwrap().as_slice(),
        &[("localhost".to_owned(), u32::from(webmin_port))]
    );

    // The accepted key is now trusted: a second route does not prompt.
    let second = connect_ssh_on_state_observed(
        &state,
        route_config(address, &known_hosts, 3),
        SshEstablishmentOrigin::NativeBrowser,
    )
    .await
    .expect("trusted host key reconnects without a prompt");
    assert_eq!(emitter.prompts.lock().unwrap().len(), 1);
    let _ = disconnect_ssh_on_state(&state, &second).await;
    let _ = disconnect_ssh_on_state(&state, &id).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unknown_ssh_route_host_key_prompts_and_a_refusal_is_reported_as_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let _trust = sorng_storage::trust_store::test_support::install_active_runtime_for_tests(
        temp.path().join("databases"),
        "db-ssh-route-reject",
    );
    let known_hosts = temp.path().join("known_hosts");
    let (address, log) = start_ssh_server(Duration::ZERO).await;
    let emitter = responder(PromptAnswer::Reject);
    let state = SshService::new_with_emitter(emitter.clone());
    let error = connect_ssh_on_state_observed(
        &state,
        route_config(address, &known_hosts, 5),
        SshEstablishmentOrigin::NativeBrowser,
    )
    .await
    .unwrap_err();
    assert!(
        error.starts_with("Host key verification failed for ")
            && error.ends_with(": key rejected by user"),
        "{error}"
    );
    assert_eq!(emitter.prompts.lock().unwrap().len(), 1);
    assert!(!known_hosts.exists());
    assert!(log.direct.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ssh_route_timeout_names_the_authentication_stage() {
    let temp = tempfile::tempdir().unwrap();
    let _trust = sorng_storage::trust_store::test_support::install_active_runtime_for_tests(
        temp.path().join("databases"),
        "db-ssh-route-auth-timeout",
    );
    let known_hosts = temp.path().join("known_hosts");
    let (address, _) = start_ssh_server(Duration::from_secs(30)).await;
    let state = SshService::new_with_emitter(responder(PromptAnswer::Accept {
        after: Duration::ZERO,
    }));
    let started = Instant::now();
    let error = connect_ssh_on_state_observed(
        &state,
        route_config(address, &known_hosts, 3),
        SshEstablishmentOrigin::NativeBrowser,
    )
    .await
    .unwrap_err();
    assert!(started.elapsed() < Duration::from_secs(10), "{error}");
    assert!(
        error.starts_with(SSH_CONNECTION_TIMEOUT_ERROR_CODE),
        "{error}"
    );
    assert!(
        error.contains("phase 'final-ssh-authentication'"),
        "the deadline must name the stage: {error}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ssh_route_timeout_names_the_handshake_stage() {
    // Accepts TCP and never sends an SSH identification line.
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let held = Arc::new(TestMutex::new(Vec::new()));
    let keep = held.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            keep.lock().unwrap().push(stream);
        }
    });
    let temp = tempfile::tempdir().unwrap();
    let state = SshService::new_with_emitter(responder(PromptAnswer::Reject));
    let error = connect_ssh_on_state_observed(
        &state,
        route_config(address, &temp.path().join("known_hosts"), 1),
        SshEstablishmentOrigin::NativeBrowser,
    )
    .await
    .unwrap_err();
    assert!(
        error.starts_with(SSH_CONNECTION_TIMEOUT_ERROR_CODE),
        "{error}"
    );
    assert!(error.contains("phase 'final-ssh-handshake'"), "{error}");
}
