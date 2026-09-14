//! Real synthetic CONNECT + verified TLS fixtures. No public DNS/upstreams,
//! user credentials, ambient proxy, OS certificate changes or TLS bypass.
use crate::{
    http_route::NativeHttpRoute, quickconnect, scoped_files::FileStationLogin,
    service::SynologyService, types::SynologyConfig,
};
use futures::FutureExt;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const ALIAS: &str = "fixture-nas";
const NAS: &str = "fixture-nas.fr3.quickconnect.to";
const PRIVATE: &str = "synthetic-private-password";

fn config() -> SynologyConfig {
    SynologyConfig {
        host: format!("{ALIAS}.quickconnect.to"),
        port: 443,
        username: "fixture-user".into(),
        password: PRIVATE.into(),
        use_https: true,
        insecure: false,
        timeout_secs: 2,
        otp_code: Some("123456".into()),
        device_token: None,
        access_token: None,
    }
}
fn info() -> Value {
    json!([{"errno":0,"server":{"serverID":"canonical-fixture-id","interface":[],"external":{"ip":"192.0.2.1"}},
        "service":{"port":5001,"ext_port":5002},"env":{"control_host":"dec.quickconnect.to","relay_region":"fr3"}}])
}
fn apis() -> Value {
    json!({"success":true,"data":{
        "SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":7},
        "SYNO.FileStation.Info":{"path":"entry.cgi","minVersion":1,"maxVersion":2}}})
}
struct Reply {
    status: u16,
    body: Vec<u8>,
    extra: String,
}
impl Reply {
    fn json(body: Value) -> Self {
        Self {
            status: 200,
            body: body.to_string().into_bytes(),
            extra: String::new(),
        }
    }
    fn cookie(mut self, cookie: &str) -> Self {
        self.extra.push_str(&format!("Set-Cookie: {cookie}\r\n"));
        self
    }
}
type Handler = dyn Fn(&str, &str) -> Reply + Send + Sync;
struct Peer {
    route: NativeHttpRoute,
    requests: Arc<Mutex<Vec<(String, String)>>>,
    worker: tokio::task::JoinHandle<()>,
    failed: Arc<AtomicBool>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.worker.abort();
        if !std::thread::panicking() {
            assert!(
                !self.failed.load(Ordering::Acquire),
                "synthetic proxy fixture failed"
            );
        }
    }
}
async fn head(stream: &mut (impl AsyncRead + Unpin)) -> Option<String> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        if bytes.len() >= 32 * 1024 {
            return None;
        }
        bytes.push(stream.read_u8().await.ok()?);
    }
    String::from_utf8(bytes).ok()
}
impl Peer {
    async fn start(handler: Arc<Handler>) -> Self {
        let certificate = rcgen::generate_simple_self_signed(vec![
            "global.quickconnect.to".into(),
            "dec.quickconnect.to".into(),
            NAS.into(),
            format!("{ALIAS}.direct.quickconnect.to"),
            "direct.example.test".into(),
        ])
        .unwrap();
        let certificate_der = certificate.serialize_der().unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(
                certificate_der.clone(),
            )],
            rustls::pki_types::PrivateKeyDer::Pkcs8(certificate.serialize_private_key_der().into()),
        )
        .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        let failed = Arc::new(AtomicBool::new(false));
        let failures = failed.clone();
        let worker = tokio::spawn(async move {
            let mut children = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    incoming = listener.accept() => {
                        let (mut socket, _) = incoming.unwrap();
                        let (acceptor, handler, seen) = (acceptor.clone(), handler.clone(), seen.clone());
                        let failures = failures.clone();
                        children.spawn(async move {
                            if std::panic::AssertUnwindSafe(async move {
                            let Some(connect) = head(&mut socket).await else { return; };
                            assert!(connect.starts_with("CONNECT "));
                            assert!(connect.to_ascii_lowercase().contains("proxy-authorization: basic "));
                            let authority = connect.split_whitespace().nth(1).unwrap().to_owned();
                            socket.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                            let Ok(mut tls) = acceptor.accept(socket).await else { return; };
                            let Some(mut request) = head(&mut tls).await else { return; };
                            let size = request.lines().find_map(|line| line.split_once(':')
                                .filter(|(name,_)| name.eq_ignore_ascii_case("content-length"))
                                .and_then(|(_,value)| value.trim().parse::<usize>().ok())).unwrap_or(0);
                            assert!(size <= 32*1024);
                            let mut body = vec![0;size];
                            tls.read_exact(&mut body).await.unwrap();
                            request.push_str(std::str::from_utf8(&body).unwrap());
                            seen.lock().unwrap().push((authority.clone(), request.clone()));
                            let reply = handler(&authority, &request);
                            let response = format!("HTTP/1.1 {} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n",
                                reply.status, reply.body.len(), reply.extra);
                            let _ = tls.write_all(response.as_bytes()).await;
                            let _ = tls.write_all(&reply.body).await;
                            let _ = tls.shutdown().await;
                            }).catch_unwind().await.is_err() { failures.store(true, Ordering::Release); }
                        });
                    },
                    _ = children.join_next(), if !children.is_empty() => {},
                }
            }
        });
        Self {
            route: NativeHttpRoute::Fixture {
                proxy,
                certificate: certificate_der,
            },
            requests,
            worker,
            failed,
        }
    }
    fn seen(&self) -> Vec<(String, String)> {
        assert!(
            !self.failed.load(Ordering::Acquire),
            "synthetic proxy fixture failed"
        );
        self.requests.lock().unwrap().clone()
    }
}

fn ordinary(authority: &str, request: &str) -> Reply {
    let lower = request.to_ascii_lowercase();
    assert!(!lower.contains("proxy-authorization"));
    if authority.starts_with("global.") || authority.starts_with("dec.") {
        for forbidden in [
            PRIVATE,
            "fixture-user",
            "123456",
            "nas-route",
            "nas-session",
        ] {
            assert!(!request.contains(forbidden));
        }
        let body: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body[0]["serverID"], ALIAS);
        assert!(matches!(
            body[0]["command"].as_str(),
            Some("get_server_info" | "request_tunnel")
        ));
        if request.contains("request_tunnel") {
            assert!(request.contains("provider-secret=control-only"));
        } else {
            // The regional origin cannot receive the global origin's cookie,
            // even though both issuers may use a broad provider Domain.
            assert!(!lower.contains("cookie:"));
        }
        let discovery = if authority.starts_with("global.") {
            json!([{"errno":1,"sites":["dec.quickconnect.to"]}])
        } else {
            info()
        };
        return Reply::json(discovery).cookie(
            "provider-secret=control-only; Domain=quickconnect.to; Path=/; Secure; HttpOnly",
        );
    }
    assert!(authority.starts_with(NAS));
    assert!(!request.contains("provider-secret"));
    assert!(lower.contains(&format!("referer: https://{ALIAS}.quickconnect.to/")));
    if request.starts_with("GET /webman/pingpong.cgi?") {
        assert!(!request.contains(PRIVATE) && !lower.contains("cookie:"));
        return Reply::json(
            json!({"ezid":sorng_quickconnect::alias_digest("canonical-fixture-id")}),
        )
        .cookie("nas-route=bound; Path=/; Secure; HttpOnly");
    }
    assert!(lower.contains("nas-route=bound"));
    if request.starts_with("POST /webapi/entry.cgi HTTP")
        || request.starts_with("GET /webapi/query.cgi?")
    {
        assert!(!request.contains(PRIVATE));
        return Reply::json(apis());
    }
    if request.contains("method=login") {
        assert!(request.contains(PRIVATE));
        return Reply::json(
            json!({"success":true,"data":{"sid":"fixture-sid","synotoken":"fixture-token"}}),
        )
        .cookie("nas-session=bound; Path=/; Secure; HttpOnly");
    }
    assert!(request.contains("nas-session=bound"));
    Reply::json(json!({"success":true,"data":{}}))
}

#[tokio::test]
async fn actual_proxy_discovery_probe_login_and_api_keep_one_nas_cookie_route_without_provider_secrets(
) {
    let peer = Peer::start(Arc::new(ordinary)).await;
    let mut service = SynologyService::new();
    let result = service
        .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap();
    assert!(matches!(result, FileStationLogin::Connected { .. }));
    assert!(service.check_session().await.unwrap());
    let seen = peer.seen();
    assert_eq!(
        seen.iter()
            .filter(|(_, request)| request.contains("method=login"))
            .count(),
        1
    );
    assert!(seen[0].0.starts_with("global."));
    assert!(seen[1].0.starts_with("dec."));
    assert!(seen[2].1.starts_with("GET /webman/pingpong.cgi?"));
    assert!(seen
        .iter()
        .skip(2)
        .all(|(authority, _)| authority.starts_with(NAS)));
    assert!(service
        .get_config()
        .unwrap()
        .host
        .ends_with(".quickconnect.to"));
}

#[tokio::test]
async fn one_regional_tunnel_retries_only_anonymous_candidate_then_logs_in_once() {
    let tunnel = Arc::new(AtomicBool::new(false));
    let activated = tunnel.clone();
    let peer = Peer::start(Arc::new(move |authority, request| {
        if request.contains("request_tunnel") {
            assert!(authority.starts_with("dec."));
            assert!(!activated.swap(true, Ordering::SeqCst));
        }
        if request.starts_with("GET /webman/") && !activated.load(Ordering::SeqCst) {
            return Reply {
                status: 503,
                body: b"{}".to_vec(),
                extra: String::new(),
            };
        }
        ordinary(authority, request)
    }))
    .await;
    let mut service = SynologyService::new();
    service
        .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap();
    assert!(tunnel.load(Ordering::SeqCst));
    assert_eq!(
        peer.seen()
            .iter()
            .filter(|(_, r)| r.contains("method=login"))
            .count(),
        1
    );
    assert_eq!(
        peer.seen()
            .iter()
            .filter(|(_, r)| r.starts_with("GET /webman/"))
            .count(),
        2
    );
}

#[tokio::test]
async fn successful_wrong_nas_probe_never_reaches_api_or_credentials() {
    let peer = Peer::start(Arc::new(|authority, request| {
        if request.starts_with("GET /webman/") {
            Reply::json(json!({"ezid":sorng_quickconnect::alias_digest("different-nas")}))
        } else {
            ordinary(authority, request)
        }
    }))
    .await;
    let mut service = SynologyService::new();
    let error = service
        .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap_err();
    assert!(error.message.contains("No NAS credentials were sent"));
    assert!(peer
        .seen()
        .iter()
        .all(|(_, r)| !r.contains("/webapi/") && !r.contains(PRIVATE)));
}

#[tokio::test]
async fn complete_global_discovery_does_not_depend_on_optional_regional_control_availability() {
    let peer = Peer::start(Arc::new(|authority, request| {
        if authority.starts_with("global.") {
            return Reply::json(info());
        }
        assert!(
            !authority.starts_with("dec."),
            "complete discovery must use its verified candidate first"
        );
        ordinary(authority, request)
    }))
    .await;
    let mut service = SynologyService::new();
    service
        .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap();
    assert_eq!(
        peer.seen()
            .iter()
            .filter(|(authority, _)| authority.starts_with("global."))
            .count(),
        1
    );
    assert!(peer
        .seen()
        .iter()
        .all(|(authority, _)| !authority.starts_with("dec.")));
}

#[tokio::test]
async fn one_anonymous_get_query_gateway_fallback_preserves_probe_cookie_and_then_login() {
    let peer = Peer::start(Arc::new(|authority, request| {
        if request.starts_with("POST /webapi/entry.cgi HTTP") {
            return Reply {
                status: 404,
                body: b"not found".to_vec(),
                extra: String::new(),
            };
        }
        ordinary(authority, request)
    }))
    .await;
    let mut service = SynologyService::new();
    service
        .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap();
    let seen = peer.seen();
    assert_eq!(
        seen.iter()
            .filter(|(_, r)| r.starts_with("GET /webapi/query.cgi?"))
            .count(),
        1
    );
    let fallback = &seen
        .iter()
        .find(|(_, r)| r.starts_with("GET /webapi/query.cgi?"))
        .unwrap()
        .1;
    assert!(!fallback.contains(PRIVATE) && !fallback.contains("_sid="));
}

#[tokio::test]
async fn cancellation_after_discovery_stops_before_next_route_or_credentials() {
    let active = Arc::new(AtomicBool::new(true));
    let cancel = active.clone();
    let peer = Peer::start(Arc::new(move |authority, request| {
        let reply = ordinary(authority, request);
        cancel.store(false, Ordering::Release);
        reply
    }))
    .await;
    let mut service = SynologyService::new();
    let error = service
        .fs_connect_routed(config(), &active, peer.route.clone())
        .await
        .unwrap_err();
    assert!(error.message.contains("cancelled"));
    assert_eq!(peer.seen().len(), 1);
}

#[tokio::test]
async fn cancellation_before_gateway_fallback_never_sends_second_discovery_or_login() {
    let active = Arc::new(AtomicBool::new(true));
    let cancel = active.clone();
    let peer = Peer::start(Arc::new(move |authority, request| {
        if request.starts_with("POST /webapi/entry.cgi HTTP") {
            cancel.store(false, Ordering::Release);
            Reply {
                status: 404,
                body: vec![],
                extra: String::new(),
            }
        } else {
            ordinary(authority, request)
        }
    }))
    .await;
    let mut service = SynologyService::new();
    assert!(service
        .fs_connect_routed(config(), &active, peer.route.clone())
        .await
        .unwrap_err()
        .message
        .contains("cancelled"));
    assert!(peer
        .seen()
        .iter()
        .all(|(_, r)| !r.contains("query.cgi") && !r.contains(PRIVATE)));
}

#[tokio::test]
async fn html_api_response_is_diagnostic_not_permission_to_send_credentials() {
    let peer = Peer::start(Arc::new(|authority, request| {
        if request.contains("/webapi/") {
            Reply {
                status: 200,
                body: b"<html>synthetic-private-page</html>".to_vec(),
                extra: String::new(),
            }
        } else {
            ordinary(authority, request)
        }
    }))
    .await;
    let mut service = SynologyService::new();
    let error = service
        .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("api_discovery") && error.contains("\"category\":\"html\""));
    assert!(!error.contains("synthetic-private-page") && !error.contains(PRIVATE));
    assert!(peer.seen().iter().all(|(_, r)| !r.contains(PRIVATE)));
}

#[tokio::test]
async fn untrusted_tls_fails_without_anonymous_or_credential_http_fallback() {
    let peer = Peer::start(Arc::new(ordinary)).await;
    let NativeHttpRoute::Fixture { proxy, .. } = peer.route.clone() else {
        unreachable!()
    };
    let route = NativeHttpRoute::HttpProxy {
        url: proxy,
        username: Some("fixture-proxy-user".into()),
        password: Some("fixture-proxy-password".into()),
    };
    let mut service = SynologyService::new();
    assert!(service
        .fs_connect_routed(config(), &AtomicBool::new(true), route)
        .await
        .is_err());
    assert!(peer.seen().is_empty());
}

#[tokio::test]
async fn http_landing_alias_only_upgrades_to_verified_https_resolution() {
    let peer = Peer::start(Arc::new(ordinary)).await;
    let mut input = config();
    input.use_https = false;
    input.port = 80;
    let mut service = SynologyService::new();
    service
        .fs_connect_routed(input, &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap();
    assert!(peer
        .seen()
        .iter()
        .all(|(authority, _)| authority.ends_with(":443")));
}

#[tokio::test]
async fn saved_prefixed_lan_smart_dns_resolves_original_alias_without_contacting_raw_lan() {
    let peer = Peer::start(Arc::new(ordinary)).await;
    let mut input = config();
    input.host = format!("192-168-50-10.{ALIAS}.direct.quickconnect.to");
    input.port = 5001;
    let mut service = SynologyService::new();
    service
        .fs_connect_routed(input, &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap();
    assert!(peer
        .seen()
        .iter()
        .all(|(authority, _)| !authority.contains("192-168-50-10")));
}

#[test]
fn unsafe_explicit_proxy_routes_are_refused_without_direct_fallback() {
    for url in [
        "socks5://localhost:1080",
        "http://user:secret@localhost:8080",
        "http://localhost/private",
        "http://localhost/?token=secret",
        "http://localhost/#private",
        "http://localhost/\n",
    ] {
        let route = NativeHttpRoute::HttpProxy {
            url: url.into(),
            username: None,
            password: None,
        };
        assert!(route.builder(Duration::from_secs(1), true).is_err());
    }
    assert!(
        serde_json::from_value::<NativeHttpRoute>(json!({"kind":"direct","unknown":true})).is_err()
    );
    assert!(serde_json::from_value::<NativeHttpRoute>(
        json!({"kind":"fixture","proxy":"http://localhost"})
    )
    .is_err());
}

#[tokio::test]
async fn incompatible_first_api_candidate_does_not_receive_login_or_leak_its_cookies() {
    let peer = Peer::start(Arc::new(|authority, request| {
        if authority.starts_with("global.") || authority.starts_with("dec.") {
            let mut response = info();
            response[0]["smartdns"] = json!({"host":format!("{ALIAS}.direct.quickconnect.to")});
            return Reply::json(response);
        }
        if authority.starts_with(NAS) {
            if request.starts_with("POST /webapi/") {
                assert!(!request.contains(PRIVATE));
                let mut response = apis();
                response["data"]["SYNO.FileStation.Info"]["minVersion"] = json!(3);
                response["data"]["SYNO.FileStation.Info"]["maxVersion"] = json!(3);
                return Reply::json(response)
                    .cookie("failed-candidate=private; Domain=quickconnect.to; Path=/; Secure");
            }
            return ordinary(authority, request);
        }
        assert!(authority.starts_with(&format!("{ALIAS}.direct.quickconnect.to:")));
        assert!(!request.contains("failed-candidate"));
        ordinary(NAS, request)
    }))
    .await;
    let mut service = SynologyService::new();
    service
        .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
        .await
        .unwrap();
    let requests = peer.seen();
    let logins: Vec<_> = requests
        .iter()
        .filter(|(_, request)| request.contains("method=login"))
        .collect();
    assert_eq!(logins.len(), 1);
    assert!(logins[0]
        .0
        .starts_with(&format!("{ALIAS}.direct.quickconnect.to:")));
}

#[tokio::test]
async fn oversized_control_and_probe_responses_stop_without_credentials() {
    for probe in [false, true] {
        let peer = Peer::start(Arc::new(move |authority, request| {
            if probe && request.starts_with("GET /webman/")
                || !probe && authority.starts_with("global.")
            {
                return Reply {
                    status: 200,
                    body: vec![b' '; if probe { 64 * 1024 + 1 } else { 256 * 1024 + 1 }],
                    extra: String::new(),
                };
            }
            ordinary(authority, request)
        }))
        .await;
        let mut service = SynologyService::new();
        assert!(service
            .fs_connect_routed(config(), &AtomicBool::new(true), peer.route.clone())
            .await
            .is_err());
        assert!(peer
            .seen()
            .iter()
            .all(|(_, request)| !request.contains(PRIVATE) && !request.contains("/webapi/")));
    }
}

#[test]
fn candidate_budget_retains_relay_ahead_of_many_unreachable_lan_entries() {
    let mut response = info();
    response[0]["smartdns"] = json!({"lan":(0..16).map(|index| format!("lan-{index}.{ALIAS}.direct.quickconnect.to")).collect::<Vec<_>>()});
    let mut identities = std::collections::BTreeSet::new();
    let mut candidates = Vec::new();
    quickconnect::test_evidence(&response, ALIAS, &mut identities, &mut candidates);
    assert_eq!(candidates.len(), 8);
    assert_eq!(candidates[0].host_str(), Some(NAS));
}

#[test]
fn only_vendor_shaped_original_nas_candidates_can_enter_resolution() {
    let mut identities = std::collections::BTreeSet::new();
    let mut candidates = Vec::new();
    let mut response = info();
    response[0]["smartdns"] =
        json!({"host":"other-nas.direct.quickconnect.to","lan":["private.invalid","127.0.0.1"]});
    response[0]["env"]["relay_region"] = json!("fr3.evil.invalid/");
    // Private helper visible from its child-independent test through this local contract.
    assert!(sorng_quickconnect::discovery_server_id(&response[0]).is_some());
    assert!(
        sorng_quickconnect::original_alias("fixture-nas.quickconnect.to.evil.invalid").is_none()
    );
    // Exercise the resolver's evidence collector via its test-only wrapper.
    quickconnect::test_evidence(&response, ALIAS, &mut identities, &mut candidates);
    assert!(candidates.is_empty());
    assert!(identities.contains(&sorng_quickconnect::alias_digest("canonical-fixture-id")));
}
