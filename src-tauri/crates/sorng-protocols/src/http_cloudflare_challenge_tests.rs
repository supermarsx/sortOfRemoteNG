//! Cloudflare challenge acceptance is entirely loopback TLS behind a synthetic CONNECT proxy.
use super::*;
use base64::engine::general_purpose::STANDARD as BASE64;

const SOURCE: &str = "https://dash.cloudflare.com";
const CHALLENGE: &str = "https://challenges.cloudflare.com";
// Synthetic values only: never record/replay a live challenge token or nonce.
const OPAQUE_QUERY: &str =
    "__cf_chl_tk=fixture%2Bopaque%2fvalue+space&repeat=one&repeat=two&empty=";
const MANAGED_HTML: &str = r#"<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-fixture-nonce' 'unsafe-eval' https://challenges.cloudflare.com; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com"><title>Just a moment...</title></head><body><div id="challenge-stage">Checking your browser</div><script nonce="fixture-nonce">window._cf_chl_opt={cType:'managed',cUPMDTk:'/login?__cf_chl_tk=fixture%2Bopaque%2fvalue+space&repeat=one&repeat=two&empty='};var s=document.createElement('script');s.nonce='fixture-nonce';s.src='/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=fixture';document.head.appendChild(s);</script><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/fixture"></iframe></body></html>"#;

fn csp_hash_source(body: &str) -> String {
    let normalized = body.replace("\r\n", "\n").replace('\r', "\n");
    format!(
        "'sha256-{}'",
        BASE64.encode(Sha256::digest(normalized.as_bytes()))
    )
}

fn csp_meta_content(html: &str) -> &str {
    html.split_once("http-equiv=\"Content-Security-Policy\" content=\"")
        .unwrap()
        .1
        .split_once('"')
        .unwrap()
        .0
}

fn inline_script_bodies(html: &str) -> Vec<&str> {
    let mut bodies = Vec::new();
    let mut rest = html;
    while let Some((_, after)) = rest.split_once("<script") {
        let Some((opening, after_open)) = after.split_once('>') else {
            break;
        };
        let Some((body, after_close)) = after_open.split_once("</script>") else {
            break;
        };
        if !opening.to_ascii_lowercase().contains(" src") {
            bodies.push(body);
        }
        rest = after_close;
    }
    bodies
}

#[test]
fn cloudflare_csp_rewrite_hashes_only_trusted_injected_inline_blocks() {
    let trusted_script =
        "try{window.parent.postMessage({type:'proxy_navigate',url:location.href},'*')}catch(e){}";
    let unknown_script = "alert('upstream-inline-without-nonce')";
    let trusted_style = "@layer sorng-force-dark{html:root{color-scheme:dark!important}}";
    let html = format!(
        "<!doctype html><html><head><meta http-equiv='Content-Security-Policy' content='default-src &#39;none&#39;; script-src &#39;nonce-upstream&#39; https://challenges.cloudflare.com; style-src &#39;self&#39;'></head><body><script>{trusted_script}</script><script>{unknown_script}</script><style id=\"__sorng_dark_bootstrap_v1\">{trusted_style}</style></body></html>"
    );
    let spoofed_marker = "window.__sorng_autologin={fetchCredsAndRun:function(){}}";
    let html = html.replace(
        "</body>",
        &format!("<script>{spoofed_marker}</script></body>"),
    );
    let rewritten = cloudflare_challenge::authorize_injected_csp(
        &html,
        &[trusted_script.to_string()],
        &[trusted_style.to_string()],
    );
    assert!(
        rewritten.contains("script-src &#39;nonce-upstream&#39; https://challenges.cloudflare.com")
    );
    assert!(rewritten.contains(&csp_hash_source(trusted_script).replace('\'', "&#39;")));
    assert!(rewritten.contains(&csp_hash_source(trusted_style).replace('\'', "&#39;")));
    assert!(!rewritten.contains(&csp_hash_source(unknown_script).replace('\'', "&#39;")));
    assert!(!rewritten.contains(&csp_hash_source(spoofed_marker).replace('\'', "&#39;")));
    assert!(!rewritten.contains("unsafe-inline"));
}

#[test]
fn cloudflare_csp_rewrite_preserves_entities_and_default_fallbacks() {
    let trusted_script = "try{window.parent.postMessage({type:'proxy_navigate'},'*')}catch(e){}";
    let html = format!(
        "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' data:; img-src 'self'\"><meta http-equiv=\"content-security-&#112;olicy\" content=\"default-src 'self' https:; img-src 'self'\"></head><body><script>{trusted_script}</script></body></html>"
    );
    let rewritten =
        cloudflare_challenge::authorize_injected_csp(&html, &[trusted_script.to_string()], &[]);
    assert!(rewritten.contains(&format!(
        "script-src 'self' data: {}",
        csp_hash_source(trusted_script)
    )));
    assert!(rewritten.contains(&format!(
        "script-src 'self' https: {}",
        csp_hash_source(trusted_script)
    )));
    assert!(rewritten.contains("content-security-&#112;olicy"));
}

#[test]
fn cloudflare_csp_rewrite_does_not_break_upstream_style_unsafe_inline() {
    let trusted_style = "@layer sorng-force-dark{html:root{color-scheme:dark!important}}";
    let html = format!(
        "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\"></head><body><style>{trusted_style}</style></body></html>"
    );
    let rewritten =
        cloudflare_challenge::authorize_injected_csp(&html, &[], &[trusted_style.to_string()]);
    assert!(rewritten.contains("style-src 'unsafe-inline'"));
    assert!(!rewritten.contains(&csp_hash_source(trusted_style)));
}

#[test]
fn cloudflare_csp_hash_uses_browser_line_ending_normalization() {
    let trusted_script =
        "try{\r\nwindow.parent.postMessage({type:'proxy_navigate'},'*')\r}catch(e){}";
    let html = format!(
        "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'\"></head><body><script>{trusted_script}</script></body></html>"
    );
    let rewritten =
        cloudflare_challenge::authorize_injected_csp(&html, &[trusted_script.to_string()], &[]);
    let expected = csp_hash_source(
        "try{\nwindow.parent.postMessage({type:'proxy_navigate'},'*')\n}catch(e){}",
    );
    assert!(rewritten.contains(&expected), "{rewritten}");
    assert!(!rewritten.contains(&format!(
        "'sha256-{}'",
        BASE64.encode(Sha256::digest(trusted_script.as_bytes()))
    )));
}

#[test]
fn cloudflare_csp_rewrite_preserves_script_unsafe_inline_and_absent_fallbacks() {
    let trusted_script = "try{window.parent.postMessage({type:'proxy_navigate'},'*')}catch(e){}";
    let unsafe_inline = format!(
        "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'\"></head><body><script>{trusted_script}</script></body></html>"
    );
    let rewritten = cloudflare_challenge::authorize_injected_csp(
        &unsafe_inline,
        &[trusted_script.to_string()],
        &[],
    );
    assert!(rewritten.contains("script-src 'unsafe-inline' 'unsafe-eval'"));
    assert!(!rewritten.contains(&csp_hash_source(trusted_script)));

    let no_script_or_default = format!(
        "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"img-src 'self'\"></head><body><script>{trusted_script}</script></body></html>"
    );
    assert_eq!(
        cloudflare_challenge::authorize_injected_csp(
            &no_script_or_default,
            &[trusted_script.to_string()],
            &[],
        ),
        no_script_or_default
    );
}

#[test]
fn cloudflare_csp_rewrite_ignores_meta_text_inside_comments_and_scripts() {
    let trusted_script = "try{window.parent.postMessage({type:'proxy_navigate'},'*')}catch(e){}";
    let html = format!(
        "<html><head><!-- <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"> --><script>const fake = '<meta http-equiv=\"Content-Security-Policy\" content=\"default-src \\'none\\'\">';</script><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'\"></head><body><script>{trusted_script}</script></body></html>"
    );
    let rewritten =
        cloudflare_challenge::authorize_injected_csp(&html, &[trusted_script.to_string()], &[]);
    assert_eq!(
        rewritten.matches(&csp_hash_source(trusted_script)).count(),
        1
    );
    assert!(rewritten.contains("const fake = '<meta http-equiv=\"Content-Security-Policy\" content=\"default-src \\'none\\'\">';"));
}

struct Peer {
    trusted: reqwest::Client,
    untrusted: reqwest::Client,
    relaxed: reqwest::Client,
    connects: Arc<std::sync::Mutex<Vec<String>>>,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    started: Arc<tokio::sync::Semaphore>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn peer(reject_proxy: bool) -> Peer {
    let cert = rcgen::generate_simple_self_signed(vec![
        "dash.cloudflare.com".into(),
        "challenges.cloudflare.com".into(),
    ])
    .unwrap();
    let der = cert.serialize_der().unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(der.clone())],
        rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy = reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let builder = || {
        reqwest::Client::builder()
            .no_proxy()
            .proxy(proxy.clone())
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
    };
    let trusted = builder()
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .build()
        .unwrap();
    let untrusted = builder().build().unwrap();
    let relaxed = builder()
        .danger_accept_invalid_certs(true)
        .cookie_store(true)
        .build()
        .unwrap();
    let connects = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let started = Arc::new(tokio::sync::Semaphore::new(0));
    let (captured_connects, captured, slow) = (connects.clone(), seen.clone(), started.clone());
    let task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let (acceptor, connects, seen, slow) = (
                acceptor.clone(),
                captured_connects.clone(),
                captured.clone(),
                slow.clone(),
            );
            children.spawn(async move {
                let connect = head(&mut tcp).await;
                let mesh = connect.starts_with("CONNECT challenges.cloudflare.com:443 ");
                assert!(mesh || connect.starts_with("CONNECT dash.cloudflare.com:443 "));
                connects.lock().unwrap().push(connect);
                if reject_proxy && mesh {
                    tcp.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                let Ok(mut socket) = acceptor.accept(tcp).await else { return; };
                let mut request = head(&mut socket).await;
                let length = request.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").and_then(|value| value.trim().parse::<usize>().ok())).unwrap_or(0);
                assert!(length < 4096);
                if length > 0 {
                    let mut body = vec![0; length];
                    socket.read_exact(&mut body).await.unwrap();
                    request.push_str(std::str::from_utf8(&body).unwrap());
                }
                seen.lock().unwrap().push(request.clone());
                if request.starts_with("GET /redirect ") {
                    socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://unconfigured.invalid/control?secret=redirect\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                if request.starts_with("GET /managed-redirect ") || request.starts_with("GET /managed-redirect?") {
                    let cookie = if mesh { "challenge_clearance=fixture; Path=/; Secure; HttpOnly" }
                        else { "cf_clearance=fixture; Path=/; Secure; HttpOnly" };
                    socket.write_all(format!("HTTP/1.1 302 Found\r\nLocation: /login?{OPAQUE_QUERY}\r\nSet-Cookie: {cookie}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
                    return;
                }
                if request.starts_with("GET /login?__cf_chl_tk=") {
                    socket.write_all(format!("HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\nCF-Mitigated: challenge\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{MANAGED_HTML}", MANAGED_HTML.len()).as_bytes()).await.unwrap();
                    return;
                }
                if request.starts_with("GET /login?challenge_complete=fixture") {
                    socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: /login?cleared=fixture\r\nSet-Cookie: fixture_clearance=complete; Path=/; Secure; HttpOnly\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                if request.starts_with("GET /login?cleared=fixture") {
                    let body = "<!doctype html><html><head><title>Log in</title></head><body><form method=\"post\"><input type=\"email\" autocomplete=\"username\"><input type=\"password\" autocomplete=\"current-password\"><button type=\"submit\">Log in</button></form></body></html>";
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                    return;
                }
                if request.starts_with("GET /ordinary-error ") || request.starts_with("GET /ordinary-error?") {
                    socket.write_all(format!("HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{MANAGED_HTML}", MANAGED_HTML.len()).as_bytes()).await.unwrap();
                    return;
                }
                if mesh && request.starts_with("GET /strict-meta ") {
                    let body = "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'nonce-upstream'; connect-src 'self'; frame-src 'self'\"><title>Challenge frame</title></head><body><script nonce=\"upstream\">window.challengeFrame=true</script></body></html>";
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                    return;
                }
                let body = if mesh { "<!doctype html><html><head></head><body><script src=\"https://challenges.cloudflare.com/a%20b.js\"></script>control</body></html>" } else { "<!doctype html><html><head><script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\"></script></head><body><iframe src=\"//challenges.cloudflare.com/frame\"></iframe></body></html>" };
                let cookie = if mesh { "mesh_session=mesh-only; Domain=.cloudflare.com; Path=/; HttpOnly" }
                    else { "dashboard_session=dashboard-only; Path=/; HttpOnly" };
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nAccess-Control-Allow-Origin: https://dash.cloudflare.com\r\nSet-Cookie: {cookie}\r\nSet-Cookie: invalid_public=secret; Domain=com; Path=/\r\nSet-Cookie: invalid_foreign=secret; Domain=other.test; Path=/\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
                if request.starts_with("GET /slow ") {
                    slow.add_permits(1);
                    let mut byte = [0u8; 1];
                    let _ = socket.read(&mut byte).await;
                } else { socket.write_all(body.as_bytes()).await.unwrap(); }
            });
        }
    });
    Peer {
        trusted,
        untrusted,
        relaxed,
        connects,
        seen,
        started,
        task,
    }
}

async fn fixture(peer: &Peer, challenge_client: reqwest::Client) -> FixtureProxy {
    fixture_with_profile(
        peer,
        challenge_client,
        Some(ReviewedApplicationProfile::Cloudflare),
    )
    .await
}

async fn fixture_with_profile(
    peer: &Peer,
    challenge_client: reqwest::Client,
    profile: Option<ReviewedApplicationProfile>,
) -> FixtureProxy {
    fixture_with_profile_and_mode(peer, challenge_client, profile, UpstreamAuthMode::Basic).await
}

async fn fixture_with_profile_and_mode(
    peer: &Peer,
    challenge_client: reqwest::Client,
    profile: Option<ReviewedApplicationProfile>,
    mode: UpstreamAuthMode,
) -> FixtureProxy {
    let seed = proxy(SOURCE.into(), peer.relaxed.clone()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let origin = format!("http://p{}.localhost:{port}", uuid::Uuid::new_v4().simple());
    let route = cloudflare_challenge::CloudflareChallenge::new(
        profile,
        &reqwest::Url::parse(SOURCE).unwrap(),
        &origin,
        challenge_client,
    )
    .unwrap();
    let network = ProxyNetworkState::default()
        .with_cloudflare_challenge(route)
        .with_reviewed_application_profile(profile);
    let mut policy = HttpProxyPolicy::default();
    policy.query_parameters.push(proxy_policy::QueryParameter {
        name: "source_secret".into(),
        value: "saved-query".into(),
    });
    let state = Arc::new(AxumProxyState {
        network: Arc::new(network),
        proxy_origin: origin.clone(),
        proxy_authority: origin.trim_start_matches("http://").into(),
        username: Arc::new(std::sync::RwLock::new("saved-user".into())),
        password: Arc::new(std::sync::RwLock::new("saved-password".into())),
        upstream_auth_mode: mode,
        custom_headers: HashMap::from([("X-Dashboard-Secret".into(), "saved-header".into())]),
        proxy_policy: policy,
        auto_login_armed: Arc::new(AtomicBool::new(true)),
        auto_login_nonce: Arc::new(std::sync::RwLock::new(Some("saved-nonce".into()))),
        ..(*seed.state).clone()
    });
    let runtime = ProxySessionRuntime::new(state.clone());
    let router = runtime.router();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    FixtureProxy {
        base: format!("http://127.0.0.1:{port}"),
        state,
        task,
    }
}

fn config(html: &str) -> serde_json::Value {
    serde_json::from_str(
        html.split_once("var sorngNetworkClient=installWebNetworkClient(")
            .unwrap()
            .1
            .split_once(",function(detail)")
            .unwrap()
            .0,
    )
    .unwrap()
}
fn request(fixture: &FixtureProxy, origin: &str, path: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{path}", fixture.base))
        .header("Host", origin.trim_start_matches("http://"))
}
async fn root(fixture: &FixtureProxy) -> String {
    let response = request(
        fixture,
        &fixture.state.proxy_origin,
        &format!("/login?__sorng_navigation_v1={TOKEN}"),
    )
    .header("Sec-Fetch-Dest", "iframe")
    .header("Sec-Fetch-Mode", "navigate")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 200);
    let csp = response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .to_owned();
    let html = response.text().await.unwrap();
    let cfg = config(&html);
    let alias = cfg["cloudflareChallenge"]["proxyOrigin"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        cfg["cloudflareChallenge"],
        serde_json::json!({"version":1,"upstreamOrigin":CHALLENGE,"proxyOrigin":alias})
    );
    for directive in ["script-src", "frame-src", "connect-src"] {
        let value = csp
            .split(';')
            .find(|value| value.trim().starts_with(directive))
            .unwrap();
        assert!(
            value.split_whitespace().any(|value| value == alias),
            "{csp}"
        );
    }
    assert!(html.contains(&format!("<script src=\"{alias}/turnstile/v0/api.js\"")));
    assert!(html.contains(&format!("<iframe src=\"{alias}/frame\"")));
    alias
}

#[tokio::test]
async fn cloudflare_managed_relative_redirect_preserves_opaque_query_cookies_and_native_ua() {
    for challenge_route in [false, true] {
        let peer = peer(false).await;
        let fixture = fixture(&peer, peer.trusted.clone()).await;
        let alias = root(&fixture).await;
        let origin = if challenge_route {
            &alias
        } else {
            &fixture.state.proxy_origin
        };
        let native_ua = "fixture-native-webview/1.0";
        let redirect = request(&fixture, origin, "/managed-redirect")
            .header("User-Agent", native_ua)
            .header("Sec-Fetch-Dest", "empty")
            .send()
            .await
            .unwrap();
        // The dashboard follows approved same-origin redirects natively; the
        // isolated challenge alias returns a rewritten redirect to the browser.
        let response = if challenge_route {
            assert_eq!(redirect.status(), 302);
            let location = redirect.headers()["location"].to_str().unwrap();
            assert_eq!(location, format!("{origin}/login?{OPAQUE_QUERY}"));
            request(&fixture, origin, &format!("/login?{OPAQUE_QUERY}"))
                .header("User-Agent", native_ua)
                .header("Sec-Fetch-Dest", "empty")
                .send()
                .await
                .unwrap()
        } else {
            redirect
        };
        assert_eq!(response.status(), 403);
        assert_eq!(response.headers()["cf-mitigated"], "challenge");
        let html = response.text().await.unwrap();
        assert!(html.contains("<title>Just a moment...</title>"));
        assert!(html.contains("window._cf_chl_opt={cType:'managed'"));
        assert!(html.contains(&format!("cUPMDTk:'/login?{OPAQUE_QUERY}'")));
        assert!(html.contains("<script nonce=\"fixture-nonce\">"));
        assert!(html.contains("'nonce-fixture-nonce'"));
        assert!(html.contains("s.src='/cdn-cgi/challenge-platform/"));
        if challenge_route {
            // Parser URLs and meta-CSP stay scoped to the exact local route.
            // The upstream nonce and challenge script remain intact.
            assert!(!html.contains("frame-src https://challenges.cloudflare.com"));
            assert!(!html.contains("<iframe src=\"https://challenges.cloudflare.com"));
        } else {
            // This is a fetch response, not a navigation: the dashboard's
            // fragment contract deliberately retains upstream HTML verbatim.
            // Navigation rewriting has its own regression below.
            assert_eq!(html, MANAGED_HTML);
        }
        let requests = peer.seen.lock().unwrap();
        let landed = requests
            .iter()
            .find(|request| request.starts_with("GET /login?__cf_chl_tk="))
            .unwrap();
        let expected_query = if challenge_route {
            OPAQUE_QUERY.to_owned()
        } else {
            format!("{OPAQUE_QUERY}&source_secret=saved-query")
        };
        assert!(
            landed.starts_with(&format!("GET /login?{expected_query} HTTP/1.1\r\n")),
            "{landed}"
        );
        assert!(landed.contains(&format!("user-agent: {native_ua}\r\n")));
        let cookie = if challenge_route {
            "challenge_clearance=fixture"
        } else {
            "cf_clearance=fixture"
        };
        assert!(
            landed.contains(cookie),
            "redirect clearance cookie was lost: {landed}"
        );
        if challenge_route {
            assert!(!landed.contains("dashboard_session"));
            assert!(!landed.contains("authorization:"));
            assert!(!landed.contains("saved-query"));
        }
        assert!(peer.connects.lock().unwrap().iter().all(|request| {
            request.starts_with("CONNECT dash.cloudflare.com:443 ")
                || request.starts_with("CONNECT challenges.cloudflare.com:443 ")
        }));
    }
}

#[tokio::test]
async fn cloudflare_rendered_challenge_redirect_rebinds_login_and_dispenses_each_stage_once() {
    let peer = peer(false).await;
    let fixture = fixture_with_profile_and_mode(
        &peer,
        peer.trusted.clone(),
        Some(ReviewedApplicationProfile::Cloudflare),
        UpstreamAuthMode::CloudflareForm,
    )
    .await;
    super::super::cloudflare_tests::register_cloudflare_session(&fixture);
    let navigation = |path: &str| {
        request(&fixture, &fixture.state.proxy_origin, path)
            .header("Sec-Fetch-Dest", "iframe")
            .header("Sec-Fetch-Mode", "navigate")
    };
    let nonce = |html: &str| {
        html.split_once("var NONCE=\"")
            .unwrap()
            .1
            .split('"')
            .next()
            .unwrap()
            .to_owned()
    };
    let challenge = navigation(&format!(
        "/login?{OPAQUE_QUERY}&__sorng_navigation_v1={TOKEN}"
    ))
    .send()
    .await
    .unwrap();
    assert_eq!(challenge.status(), 403);
    let challenge_html = challenge.text().await.unwrap();
    let old_nonce = nonce(&challenge_html);
    assert!(challenge_html.contains("window._cf_chl_opt={cType:'managed'"));
    assert!(fixture.state.auto_login_armed.load(Ordering::SeqCst));

    // A script-initiated reload has no shell navigation token. The approved
    // source performs its own relative redirect through the same proxy.
    let login = navigation("/login?challenge_complete=fixture")
        .send()
        .await
        .unwrap();
    assert_eq!(login.status(), 200);
    let login_html = login.text().await.unwrap();
    let new_nonce = nonce(&login_html);
    assert_ne!(old_nonce, new_nonce);
    assert!(login_html.contains("<title>Log in</title>"));
    assert!(login_html.contains("fetchCredsAndRun(NONCE,SEL, 'cloudflare')"));
    assert!(login_html.contains("window.__sorng_cloudflare_login ="));
    assert!(fixture.state.auto_login_armed.load(Ordering::SeqCst));
    let sequence = fixture.state.document_sequence.load(Ordering::SeqCst);
    assert_eq!(sequence, 2);
    fixture.state.network.activate_document(sequence).unwrap();
    let redeem = |token: &str, phase: &str| {
        request(
            &fixture,
            &fixture.state.proxy_origin,
            &format!("{AUTOLOGIN_PATH}?nonce={token}{phase}"),
        )
    };
    assert_eq!(redeem(&old_nonce, "").send().await.unwrap().status(), 403);
    assert!(fixture.state.auto_login_armed.load(Ordering::SeqCst));
    let username = redeem(&new_nonce, "").send().await.unwrap();
    assert_eq!(username.status(), 200);
    let username: serde_json::Value = username.json().await.unwrap();
    assert_eq!(username["username"], "saved-user");
    assert!(username.get("password").is_none());
    assert!(!fixture.state.auto_login_armed.load(Ordering::SeqCst));
    let continuation = username["continuation"].as_str().unwrap();
    assert_eq!(redeem(&new_nonce, "").send().await.unwrap().status(), 403);
    let password = redeem(continuation, "&phase=password")
        .send()
        .await
        .unwrap();
    assert_eq!(password.status(), 200);
    assert_eq!(
        password.json::<serde_json::Value>().await.unwrap(),
        serde_json::json!({"loginFlow":"cloudflare", "password":"saved-password"})
    );
    assert_eq!(
        redeem(continuation, "&phase=password")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    for html in [&challenge_html, &login_html] {
        assert!(!html.contains("saved-user") && !html.contains("saved-password"));
    }
    let seen = peer.seen.lock().unwrap();
    let landed = seen
        .iter()
        .find(|request| request.starts_with("GET /login?cleared=fixture"))
        .unwrap();
    assert!(landed.contains("fixture_clearance=complete"));
    assert!(seen
        .iter()
        .all(|request| !request.contains("saved-user") && !request.contains("saved-password")));
}

#[tokio::test]
async fn cloudflare_error_rendering_exception_requires_reviewed_route_and_challenge_signal() {
    for reviewed in [false, true] {
        let peer = peer(false).await;
        let fixture = fixture_with_profile(
            &peer,
            peer.trusted.clone(),
            reviewed.then_some(ReviewedApplicationProfile::Cloudflare),
        )
        .await;
        // A challenge-looking title/body is not sufficient. Conversely, the
        // signal alone cannot exempt an unreviewed dashboard connection.
        let path = if reviewed {
            "/ordinary-error".to_owned()
        } else {
            format!("/login?{OPAQUE_QUERY}")
        };
        let response = request(&fixture, &fixture.state.proxy_origin, &path)
            .header("Sec-Fetch-Dest", "iframe")
            .header("Sec-Fetch-Mode", "navigate")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 403);
        let html = response.text().await.unwrap();
        assert!(!html.contains("<script nonce=\"fixture-nonce\">"));
        assert!(!html.contains("var sorngNetworkClient=installWebNetworkClient("));
        assert!(html.contains("&lt;script nonce="));
    }
}

#[tokio::test]
async fn cloudflare_managed_dashboard_document_preserves_nonce_meta_csp_and_local_routes() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let response = request(
        &fixture,
        &fixture.state.proxy_origin,
        &format!("/login?{OPAQUE_QUERY}&__sorng_navigation_v1={TOKEN}"),
    )
    .header("Sec-Fetch-Dest", "iframe")
    .header("Sec-Fetch-Mode", "navigate")
    .header("User-Agent", "fixture-native-webview/1.0")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 403);
    assert_eq!(response.headers()["cf-mitigated"], "challenge");
    let csp = response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .to_owned();
    let html = response.text().await.unwrap();
    let cfg = config(&html);
    let alias = cfg["cloudflareChallenge"]["proxyOrigin"].as_str().unwrap();
    assert!(
        html.find("installWebNetworkClient(").unwrap()
            < html.find("http-equiv=\"Content-Security-Policy\"").unwrap()
    );
    for directive in ["script-src", "frame-src", "connect-src"] {
        let value = csp
            .split(';')
            .find(|value| value.trim().starts_with(directive))
            .unwrap();
        assert!(value.split_whitespace().any(|value| value == alias));
    }
    assert!(html.contains(&format!("frame-src {alias}\"")));
    assert!(html.contains(&format!(
        "<iframe src=\"{alias}/cdn-cgi/challenge-platform/"
    )));
    assert!(html.contains("script-src 'nonce-fixture-nonce' 'unsafe-eval'"));
    let meta_csp = csp_meta_content(&html);
    assert!(meta_csp.contains(&format!(
        "script-src 'nonce-fixture-nonce' 'unsafe-eval' {alias}"
    )));
    let scripts = inline_script_bodies(&html);
    let readiness = scripts
        .iter()
        .find(|body| body.contains("installWebNetworkClient("))
        .unwrap();
    let navigate = scripts
        .iter()
        .find(|body| body.contains("type:'proxy_navigate'"))
        .unwrap();
    let upstream_nonce_script = scripts
        .iter()
        .find(|body| body.contains("window._cf_chl_opt={cType:'managed'"))
        .unwrap();
    assert!(
        meta_csp.contains(&csp_hash_source(readiness)),
        "meta CSP missing readiness hash: {meta_csp}"
    );
    assert!(meta_csp.contains(&csp_hash_source(navigate)));
    assert!(!meta_csp.contains(&csp_hash_source(upstream_nonce_script)));
    assert!(!meta_csp.contains("script-src 'unsafe-inline'"));
    assert!(html.contains("<script nonce=\"fixture-nonce\">window._cf_chl_opt"));
    assert!(html.contains(&format!("cUPMDTk:'/login?{OPAQUE_QUERY}'")));
    let seen = peer.seen.lock().unwrap();
    assert!(seen[0].starts_with(&format!(
        "GET /login?{OPAQUE_QUERY}&source_secret=saved-query HTTP/1.1\r\n"
    )));
    assert!(!seen[0].contains(TOKEN));
}

#[tokio::test]
async fn cloudflare_challenge_source_static_urls_frame_cookies_and_headers_are_isolated() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let initial_nonce = fixture.state.auto_login_nonce.read().unwrap().clone();
    for path in ["/frame", "/a%20b.js"] {
        let response = request(&fixture, &alias, path)
            .header("Origin", &fixture.state.proxy_origin)
            .header(
                "Referer",
                format!(
                    "{}/login?private=source-referrer",
                    fixture.state.proxy_origin
                ),
            )
            .header("Cookie", "dashboard_session=must-not-cross")
            .header("Authorization", "Bearer must-not-cross")
            .header("X-Dashboard-Secret", "must-not-cross")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(!response.headers().contains_key("set-cookie"));
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            fixture.state.proxy_origin
        );
        assert!(!response.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors"));
        let html = response.text().await.unwrap();
        let cfg = config(&html);
        assert_eq!(cfg["sourceOrigin"], CHALLENGE);
        assert_eq!(cfg["proxyOrigin"], alias);
        assert!(cfg.get("cloudflareChallenge").is_none());
        assert!(!html.contains("fetchCredsAndRun"));
        assert!(html.contains(&format!("<script src=\"{alias}/a%20b.js\"")));
    }
    assert_eq!(
        *fixture.state.auto_login_nonce.read().unwrap(),
        initial_nonce
    );
    let requests = peer.seen.lock().unwrap().clone();
    for request in requests.iter().filter(|request| {
        request.starts_with("GET /frame ") || request.starts_with("GET /a%20b.js ")
    }) {
        let lower = request.to_ascii_lowercase();
        for forbidden in [
            "saved-user",
            "saved-password",
            "saved-query",
            "saved-header",
            "authorization:",
            "dashboard_session",
            "must-not-cross",
            "source-referrer",
            "invalid_public",
            "invalid_foreign",
        ] {
            assert!(!lower.contains(forbidden), "leaked {forbidden}: {lower}");
        }
        assert!(lower.contains("origin: https://dash.cloudflare.com"));
    }
    let second = requests
        .iter()
        .find(|request| request.starts_with("GET /a%20b.js "))
        .unwrap();
    assert!(
        second.contains("mesh_session=mesh-only"),
        "valid parent-domain cookie remains challenge-only"
    );
    request(&fixture, &fixture.state.proxy_origin, "/dashboard-resource")
        .send()
        .await
        .unwrap();
    let requests = peer.seen.lock().unwrap();
    assert!(!requests.last().unwrap().contains("mesh_session"));
    assert!(peer
        .connects
        .lock()
        .unwrap()
        .iter()
        .any(|request| request.starts_with("CONNECT challenges.cloudflare.com:443 ")));
}

#[tokio::test]
async fn cloudflare_challenge_alias_html_authorizes_only_its_bootstrap_against_meta_csp() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let response = request(&fixture, &alias, "/strict-meta")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let html = response.text().await.unwrap();
    let meta_csp = csp_meta_content(&html);
    let scripts = inline_script_bodies(&html);
    let bootstrap = scripts
        .iter()
        .find(|body| body.contains("installWebNetworkClient("))
        .unwrap();
    let upstream_nonce_script = scripts
        .iter()
        .find(|body| body.contains("window.challengeFrame=true"))
        .unwrap();
    assert!(meta_csp.contains("script-src 'nonce-upstream'"));
    assert!(meta_csp.contains(&csp_hash_source(bootstrap)));
    assert!(!meta_csp.contains(&csp_hash_source(upstream_nonce_script)));
    assert!(html.contains("<script nonce=\"upstream\">window.challengeFrame=true</script>"));
}

#[tokio::test]
async fn cloudflare_challenge_reserved_foreign_and_stale_roots_fail_without_upstream_io() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let before = peer.seen.lock().unwrap().len();
    for path in [
        AUTOLOGIN_PATH,
        "/__sortofremoteng_auth",
        "/%5f%5fsortofremoteng_autologin",
        "/x/../__sortofremoteng_autologin",
        "/frame?__sorng_generation_v1=wrong",
    ] {
        let status = request(&fixture, &alias, path)
            .send()
            .await
            .unwrap()
            .status();
        assert!(matches!(status.as_u16(), 403 | 410), "{path}: {status}");
    }
    for origin in [
        "https://attacker.test",
        "null",
        "http://pffffffffffffffffffffffffffffffff.localhost:1",
    ] {
        assert_eq!(
            request(&fixture, &alias, "/frame")
                .header("Origin", origin)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    for referer in [
        "https://attacker.test/",
        "null",
        "http://user@localhost/",
        "http://[invalid",
    ] {
        let response = client()
            .get(format!("{}/frame", fixture.base))
            .header("Host", alias.trim_start_matches("http://"))
            .header("Referer", referer)
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            403,
            "foreign Referer with absent Origin: {referer}"
        );
    }
    assert_eq!(
        request(
            &fixture,
            "http://pffffffffffffffffffffffffffffffff.localhost:1234",
            "/frame"
        )
        .send()
        .await
        .unwrap()
        .status(),
        403
    );
    assert_eq!(
        request(&fixture, &alias, "/socket")
            .header("Upgrade", "websocket")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(peer.seen.lock().unwrap().len(), before);
    fixture.state.network.document_issued(2, false);
    let next = fixture
        .state
        .network
        .cloudflare_challenge
        .as_ref()
        .unwrap()
        .manifest(2, &fixture.state.network)
        .unwrap();
    let next = next["proxyOrigin"].as_str().unwrap();
    fixture.state.network.activate_document(2).unwrap();
    assert!(!crate::webview_origins::allows_frame_url(&alias));
    assert_eq!(
        request(&fixture, &alias, "/frame")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        request(&fixture, next, "/frame")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    fixture.state.network.revoke();
    assert!(!crate::webview_origins::allows_frame_url(next));
    assert!(request(&fixture, next, "/frame")
        .send()
        .await
        .unwrap()
        .status()
        .is_client_error());
}

#[tokio::test]
async fn cloudflare_challenge_strict_tls_proxy_failure_and_foreign_redirect_have_no_fallback() {
    for rejected in [false, true] {
        let peer = peer(rejected).await;
        let challenge_client = if rejected {
            peer.trusted.clone()
        } else {
            peer.untrusted.clone()
        };
        let fixture = fixture(&peer, challenge_client).await;
        let alias = root(&fixture).await; // source TLS bypass stays source-only
        let before = peer.seen.lock().unwrap().len();
        assert_eq!(
            request(&fixture, &alias, "/frame")
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
        assert_eq!(peer.seen.lock().unwrap().len(), before);
        assert_eq!(
            peer.connects
                .lock()
                .unwrap()
                .iter()
                .filter(|request| request.starts_with("CONNECT challenges.cloudflare.com:443 "))
                .count(),
            1
        );
    }
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    assert_eq!(
        request(&fixture, &alias, "/redirect")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert!(peer
        .connects
        .lock()
        .unwrap()
        .iter()
        .all(|request| !request.contains("unconfigured.invalid")));
}

#[tokio::test]
async fn cloudflare_challenge_parent_change_cancels_inflight_body() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let request = request(&fixture, &alias, "/slow");
    let pending = tokio::spawn(async move { request.send().await.unwrap() });
    tokio::time::timeout(Duration::from_secs(3), peer.started.acquire())
        .await
        .unwrap()
        .unwrap()
        .forget();
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    let response = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), 403);
    assert!(!response.text().await.unwrap().contains("control</body>"));
}

#[tokio::test]
async fn cloudflare_challenge_post_and_preflight_use_the_same_isolated_proxy() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    for method in [reqwest::Method::POST, reqwest::Method::OPTIONS] {
        let response = client()
            .request(
                method.clone(),
                format!("{}/turnstile/response", fixture.base),
            )
            .header("Host", alias.trim_start_matches("http://"))
            .header("Origin", &fixture.state.proxy_origin)
            .header("Content-Type", "application/json")
            .header("Access-Control-Request-Method", "POST")
            .header("Authorization", "source-authorization")
            .body("{\"challenge\":\"synthetic\"}")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            fixture.state.proxy_origin
        );
        let seen = peer.seen.lock().unwrap();
        let request = seen.last().unwrap();
        assert!(request.starts_with(&format!("{} /turnstile/response ", method.as_str())));
        assert!(request.ends_with("{\"challenge\":\"synthetic\"}"));
        assert!(!request.contains("source-authorization"));
    }
}

#[tokio::test]
async fn cloudflare_challenge_parser_requests_wait_for_exact_root_selection_without_upstream_io() {
    for outcome in ["selected", "newer", "stop"] {
        let peer = peer(false).await;
        let fixture = fixture(&peer, peer.trusted.clone()).await;
        root(&fixture).await;
        let alias = root(&fixture).await; // newly issued document 2, still pending
        let before = peer.seen.lock().unwrap().len();
        let request = request(&fixture, &alias, "/turnstile/v0/api.js");
        let pending = tokio::spawn(async move { request.send().await.unwrap() });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!pending.is_finished());
        assert_eq!(peer.seen.lock().unwrap().len(), before);
        match outcome {
            "selected" => {
                fixture.state.network.activate_document(2).unwrap();
            }
            "newer" => {
                fixture.state.network.document_issued(3, false);
                fixture.state.network.activate_document(3).unwrap();
            }
            _ => fixture.state.network.revoke(),
        }
        let response = tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            if outcome == "selected" { 200 } else { 403 }
        );
        assert_eq!(
            peer.seen.lock().unwrap().len(),
            before + usize::from(outcome == "selected")
        );
    }
}

#[test]
fn cloudflare_challenge_requires_exact_source_and_explicit_profile() {
    let make = |source, profile| {
        cloudflare_challenge::CloudflareChallenge::new(
            profile,
            &reqwest::Url::parse(source).unwrap(),
            "http://p0123456789abcdef0123456789abcdef.localhost:43210",
            client(),
        )
    };
    assert!(make(SOURCE, Some(ReviewedApplicationProfile::Cloudflare))
        .unwrap()
        .is_some());
    assert!(make(SOURCE, None).unwrap().is_none());
    for source in [
        "http://dash.cloudflare.com",
        "https://dash.cloudflare.com:444",
        "https://dash.cloudflare.com.attacker.test",
        "https://user@dash.cloudflare.com",
        "https://challenges.cloudflare.com",
    ] {
        assert!(make(source, Some(ReviewedApplicationProfile::Cloudflare)).is_err());
    }
}

#[test]
fn cloudflare_challenge_static_rewrite_matches_exact_default_port_authorities_only() {
    let alias = "http://p0123456789abcdef0123456789abcdef.localhost:43210";
    for origin in [
        CHALLENGE,
        "https://challenges.cloudflare.com:443",
        "//challenges.cloudflare.com",
        "//challenges.cloudflare.com:443",
    ] {
        let html = format!("<script src=\"{origin}/a%20b.js\"></script>");
        assert_eq!(
            cloudflare_challenge::rewrite(&html, alias),
            format!("<script src=\"{alias}/a%20b.js\"></script>")
        );
    }
    for origin in [
        "https://challenges.cloudflare.com.attacker.test",
        "https://challenges.cloudflare.com:444",
        "https://challenges.cloudflare.com@attacker.test",
    ] {
        let html = format!("<script src=\"{origin}/a.js\"></script>");
        assert_eq!(cloudflare_challenge::rewrite(&html, alias), html);
    }
}
