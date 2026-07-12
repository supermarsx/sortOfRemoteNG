#![allow(clippy::assertions_on_constants)]

//! Real-HTTP end-to-end tests for the hardened external REST API (t41).
//!
//! Every test in the `e2e` module spins up the *actual* production server via
//! [`app_lib::api::start_server`] on a loopback ephemeral port with a tempdir
//! user store, then drives it with a real [`reqwest`] client. Nothing is
//! stubbed: the requests traverse the full middleware stack
//! (audit → CORS → rate-limit → api_key_gate → capability_gate) and the real
//! `/auth/*` JWT flow, exactly as a remote automation client would.
//!
//! The matrix mirrors `.orchestration/plans/t41.md` §5 and the §6 security
//! invariants: 401 without a key, 200 with the key, Bearer-JWT login/accept,
//! 429 rate limiting, capability-gate 403 even when authenticated, `/health`
//! auth exemption, loopback-vs-remote bind resolution, readonly-role mutation
//! rejection, `alg:none`/tampered-JWT rejection, logout revocation, and a
//! response-body scan proving no stored credential is ever serialized.

use std::sync::Arc;

// Import our services from the library
use app_lib::agent::AgentService;
use app_lib::api::ApiService;
use app_lib::auth::AuthService;
use app_lib::aws::AwsService;
use app_lib::cloudflare::CloudflareService;
use app_lib::commander::CommanderService;
use app_lib::db::DbService;
use app_lib::ftp::FtpService;
use app_lib::meshcentral::MeshCentralService;
use app_lib::network::NetworkService;
use app_lib::qr::QrService;
use app_lib::rpc::RpcService;
use app_lib::rustdesk::RustDeskService;
use app_lib::security::SecurityService;
use app_lib::ssh::SshService;
use app_lib::vercel::VercelService;
use app_lib::wmi::WmiService;
use app_lib::wol::WolService;

#[tokio::test]
async fn test_api_server_startup() {
    // Initialize services - these return Arc<Mutex<...>> directly
    let auth_service = AuthService::new("test_users.json".to_string());
    let ssh_service = SshService::new();
    let db_service = DbService::new();
    let ftp_service = FtpService::new();
    let network_service = NetworkService::new();
    let security_service = SecurityService::new();
    let wol_service = WolService::new();
    let qr_service = QrService::new();
    let rustdesk_service = RustDeskService::new();
    let wmi_service = WmiService::new();
    let rpc_service = RpcService::new();
    let meshcentral_service = MeshCentralService::new();
    let agent_service = AgentService::new();
    let commander_service = CommanderService::new();
    let aws_service = AwsService::new();
    let vercel_service = VercelService::new();
    let cloudflare_service = CloudflareService::new();

    // Create API service. Post-t41 the router is built by the free function
    // `api::create_router(ApiState)` (whose RateLimiter has no public
    // constructor), so this smoke test only asserts the 17-service wiring
    // compiles and constructs — real routing is exercised end-to-end against a
    // live `start_server` instance in the `e2e` module below.
    let api_service = ApiService::new(
        auth_service,
        ssh_service,
        db_service,
        ftp_service,
        network_service,
        security_service,
        wol_service,
        qr_service,
        rustdesk_service,
        wmi_service,
        rpc_service,
        meshcentral_service,
        agent_service,
        commander_service,
        aws_service,
        vercel_service,
        cloudflare_service,
    );

    let _service = Arc::new(api_service);
    assert!(true); // If we get here, the service was constructed successfully
}

/// Real-HTTP end-to-end suite (t41-e8). See module docs.
mod e2e {
    use std::net::{IpAddr, Ipv4Addr};
    use std::path::Path;
    use std::sync::Arc;
    use std::time::Duration;

    use serde_json::json;
    use tokio::sync::{oneshot, Mutex};

    use app_lib::agent::AgentService;
    use app_lib::api::{start_server, ApiService};
    use app_lib::api_config::ApiRuntimeConfig;
    use app_lib::auth::AuthService;
    use app_lib::aws::AwsService;
    use app_lib::bearer_auth::{BearerAuthService, Role};
    use app_lib::cloudflare::CloudflareService;
    use app_lib::commander::CommanderService;
    use app_lib::db::DbService;
    use app_lib::ftp::FtpService;
    use app_lib::meshcentral::MeshCentralService;
    use app_lib::network::NetworkService;
    use app_lib::qr::QrService;
    use app_lib::rpc::RpcService;
    use app_lib::rustdesk::RustDeskService;
    use app_lib::security::SecurityService;
    use app_lib::ssh::SshService;
    use app_lib::vercel::VercelService;
    use app_lib::wmi::WmiService;
    use app_lib::wol::WolService;

    // Seeded user store credentials. Passwords are arbitrary — argon2/bcrypt
    // impose no complexity policy — but they are the ONLY secrets the tests
    // present to /auth/login and must never appear in a response body.
    const ADMIN_USER: &str = "admin";
    const ADMIN_PASS: &str = "admin-pass-Aa1!longenough";
    const READONLY_USER: &str = "viewer";
    const READONLY_PASS: &str = "viewer-pass-Aa1!longenough";

    /// A live server instance under test. Dropping it signals graceful
    /// shutdown and aborts the serve task so no server (or bound port) leaks.
    struct TestServer {
        base: String,
        api_key: String,
        jwt_secret: String,
        _tmp: tempfile::TempDir,
        shutdown: Option<oneshot::Sender<()>>,
        handle: tokio::task::JoinHandle<()>,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            if let Some(tx) = self.shutdown.take() {
                let _ = tx.send(());
            }
            self.handle.abort();
        }
    }

    impl TestServer {
        fn url(&self, path: &str) -> String {
            format!("{}{}", self.base, path)
        }
    }

    /// Grab an OS-assigned free loopback port, then release it so the server
    /// can bind it. A small TOCTOU window remains, so [`start_test_server`]
    /// retries on failure.
    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .expect("bind ephemeral port")
            .local_addr()
            .expect("local_addr")
            .port()
    }

    fn http() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("build reqwest client")
    }

    /// Build a fully-wired `ApiService` around a seeded auth store, mirroring
    /// the production 17-service construction.
    fn build_services(auth: Arc<Mutex<AuthService>>) -> Arc<ApiService> {
        Arc::new(ApiService::new(
            auth,
            SshService::new(),
            DbService::new(),
            FtpService::new(),
            NetworkService::new(),
            SecurityService::new(),
            WolService::new(),
            QrService::new(),
            RustDeskService::new(),
            WmiService::new(),
            RpcService::new(),
            MeshCentralService::new(),
            AgentService::new(),
            CommanderService::new(),
            AwsService::new(),
            VercelService::new(),
            CloudflareService::new(),
        ))
    }

    /// Resolve a runtime config from a `restApi` settings fragment via the real
    /// resolver (no env), then start the real server on a loopback ephemeral
    /// port and wait until `/health` answers. Retries the whole spawn a few
    /// times to absorb the free-port race.
    async fn start_test_server(rest_api: serde_json::Value, disabled_caps: &[&str]) -> TestServer {
        for _attempt in 0..6 {
            let port = free_port();
            let mut rest = rest_api.clone();
            rest["port"] = json!(port);

            let tmp = tempfile::tempdir().expect("tempdir");
            let store = tmp.path().join("users.json");
            let auth = AuthService::new(store.to_string_lossy().to_string());
            {
                let mut a = auth.lock().await;
                a.add_user(ADMIN_USER.into(), ADMIN_PASS.into())
                    .await
                    .expect("seed admin");
                a.add_user(READONLY_USER.into(), READONLY_PASS.into())
                    .await
                    .expect("seed readonly");
            }

            let services = build_services(auth);
            if !disabled_caps.is_empty() {
                services.set_disabled_capabilities(disabled_caps.iter().map(|s| s.to_string()));
            }

            let settings = json!({ "restApi": rest });
            let config = ApiRuntimeConfig::resolve_with_env(&settings, tmp.path(), |_| None);
            // The server binds a concrete loopback port here (no random port).
            assert_eq!(config.bind_ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
            let api_key = config.api_key.clone();
            let jwt_secret = config.jwt_secret.clone();
            let base = format!("http://127.0.0.1:{port}");

            let (tx, rx) = oneshot::channel();
            let handle = tokio::spawn(async move {
                let _ = start_server(config, services, rx).await;
            });

            if wait_ready(&base).await {
                return TestServer {
                    base,
                    api_key,
                    jwt_secret,
                    _tmp: tmp,
                    shutdown: Some(tx),
                    handle,
                };
            }
            // Didn't come up (likely lost the port race) — tear down and retry.
            let _ = tx.send(());
            handle.abort();
        }
        panic!("test server failed to become ready after retries");
    }

    /// Poll `/health` (auth-exempt) until it answers 2xx, up to ~5s.
    async fn wait_ready(base: &str) -> bool {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .expect("build readiness client");
        for _ in 0..250 {
            if let Ok(resp) = client.get(format!("{base}/health")).send().await {
                if resp.status().is_success() {
                    return true;
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }

    /// Minimal, dependency-free base64url (no padding) — used only to hand-craft
    /// the `alg:none` attacker token in [`tampered_and_alg_none_jwt_rejected`].
    fn b64url(input: &[u8]) -> String {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        for chunk in input.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = *chunk.get(1).unwrap_or(&0) as u32;
            let b2 = *chunk.get(2).unwrap_or(&0) as u32;
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(T[((n >> 18) & 63) as usize] as char);
            out.push(T[((n >> 12) & 63) as usize] as char);
            if chunk.len() > 1 {
                out.push(T[((n >> 6) & 63) as usize] as char);
            }
            if chunk.len() > 2 {
                out.push(T[(n & 63) as usize] as char);
            }
        }
        out
    }

    /// Settings fragment for an authenticated (loopback) server.
    fn auth_on() -> serde_json::Value {
        json!({ "enabled": true, "authentication": true })
    }

    /// Log in as `admin` and return the issued session JWT.
    async fn login_admin(srv: &TestServer) -> String {
        let resp = http()
            .post(srv.url("/auth/login"))
            .json(&json!({ "username": ADMIN_USER, "password": ADMIN_PASS }))
            .send()
            .await
            .expect("login request");
        assert_eq!(resp.status().as_u16(), 200, "admin login should succeed");
        let body: serde_json::Value = resp.json().await.expect("login body");
        body["token"].as_str().expect("token field").to_string()
    }

    // ── 6. /health is reachable with NO auth ────────────────────────────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn health_is_exempt_from_auth() {
        let srv = start_test_server(auth_on(), &[]).await;
        let resp = http().get(srv.url("/health")).send().await.expect("health");
        assert_eq!(resp.status().as_u16(), 200);
        let body: serde_json::Value = resp.json().await.expect("health body");
        assert_eq!(body["status"], "ok");
    }

    // ── 1. 401 on a protected route with missing / empty X-API-Key ──────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn missing_or_empty_key_is_unauthorized() {
        let srv = start_test_server(auth_on(), &[]).await;

        // No credential header at all.
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .send()
            .await
            .expect("no-key request");
        assert_eq!(resp.status().as_u16(), 401, "missing key must be 401");

        // Present-but-empty X-API-Key must not slip through.
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .header("x-api-key", "")
            .send()
            .await
            .expect("empty-key request");
        assert_eq!(resp.status().as_u16(), 401, "empty key must be 401");

        // A wrong key is also rejected.
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .header("x-api-key", "definitely-not-the-key")
            .send()
            .await
            .expect("wrong-key request");
        assert_eq!(resp.status().as_u16(), 401, "wrong key must be 401");
    }

    // ── 2. 200 on the same route WITH the valid X-API-Key ───────────────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn valid_api_key_authorizes() {
        let srv = start_test_server(auth_on(), &[]).await;
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .header("x-api-key", &srv.api_key)
            .send()
            .await
            .expect("valid-key request");
        assert_eq!(resp.status().as_u16(), 200, "valid key must be 200");
        let body: serde_json::Value = resp.json().await.expect("whoami body");
        assert_eq!(body["auth"], "api-key");
        assert_eq!(body["role"], "admin");
    }

    // ── 3. Bearer JWT: /auth/login issues a token that authorizes ───────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn login_returns_jwt_that_authorizes() {
        let srv = start_test_server(auth_on(), &[]).await;

        // Login shape: { token, expires_at, role }.
        let resp = http()
            .post(srv.url("/auth/login"))
            .json(&json!({ "username": ADMIN_USER, "password": ADMIN_PASS }))
            .send()
            .await
            .expect("login request");
        assert_eq!(resp.status().as_u16(), 200);
        let body: serde_json::Value = resp.json().await.expect("login body");
        let token = body["token"].as_str().expect("token").to_string();
        assert!(body["expires_at"].is_string(), "expires_at present");
        assert_eq!(body["role"], "admin");

        // Wrong password is rejected by the login endpoint itself.
        let bad = http()
            .post(srv.url("/auth/login"))
            .json(&json!({ "username": ADMIN_USER, "password": "wrong" }))
            .send()
            .await
            .expect("bad login");
        assert_eq!(bad.status().as_u16(), 401);

        // The issued token is accepted as `Authorization: Bearer <jwt>`.
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .bearer_auth(&token)
            .send()
            .await
            .expect("bearer request");
        assert_eq!(resp.status().as_u16(), 200, "valid Bearer must be 200");
        let who: serde_json::Value = resp.json().await.expect("whoami body");
        assert_eq!(who["auth"], "bearer");
        assert_eq!(who["principal"], ADMIN_USER);
    }

    // ── 4. 429 once the per-minute rate limit is exceeded ───────────────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rate_limit_returns_429() {
        let limit = 5u32;
        let settings = json!({
            "enabled": true,
            "authentication": true,
            "rateLimiting": true,
            "maxRequestsPerMinute": limit,
        });
        let srv = start_test_server(settings, &[]).await;
        let client = http();

        let mut ok = 0;
        let mut throttled = 0;
        let mut seen_throttle = false;
        // Fire well past the limit; all share one (ip, key) bucket.
        for _ in 0..(limit + 5) {
            let status = client
                .get(srv.url("/auth/whoami"))
                .header("x-api-key", &srv.api_key)
                .send()
                .await
                .expect("rate-limited request")
                .status()
                .as_u16();
            match status {
                200 => {
                    // Within a window the limiter is monotonic: no 200 may
                    // follow a 429.
                    assert!(!seen_throttle, "got a 200 after a 429 in the same window");
                    ok += 1;
                }
                429 => {
                    seen_throttle = true;
                    throttled += 1;
                }
                other => panic!("unexpected status under rate limit: {other}"),
            }
        }
        assert!(ok >= 1 && ok <= limit as i32, "allowed {ok}, limit {limit}");
        assert!(throttled >= 1, "expected at least one 429, got {throttled}");
    }

    // ── 5. Capability gate still 403 even WITH valid auth ───────────────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn disabled_capability_forbidden_even_when_authenticated() {
        // Disable the SSH capability; auth is otherwise valid.
        let srv = start_test_server(auth_on(), &["ssh"]).await;
        let client = http();

        // A disabled-capability route is 403 despite a valid key.
        let resp = client
            .get(srv.url("/ssh/sessions"))
            .header("x-api-key", &srv.api_key)
            .send()
            .await
            .expect("ssh request");
        assert_eq!(resp.status().as_u16(), 403, "disabled capability must be 403");
        let body: serde_json::Value = resp.json().await.expect("403 body");
        assert_eq!(body["error"], "capability_disabled");
        assert_eq!(body["capability"], "ssh");

        // A non-disabled capability with the same key still works — proving the
        // 403 is the capability gate, not an auth failure.
        let resp = client
            .get(srv.url("/auth/whoami"))
            .header("x-api-key", &srv.api_key)
            .send()
            .await
            .expect("whoami request");
        assert_eq!(resp.status().as_u16(), 200, "enabled capability must be 200");
    }

    // ── 7. Loopback vs remote bind + forced auth (resolver + live bind) ─────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn loopback_and_remote_bind_resolution() {
        let app_dir = Path::new("/opt/app-test");

        // Local, auth toggled off → loopback bind, auth not required.
        let local = ApiRuntimeConfig::resolve_with_env(
            &json!({ "restApi": { "authentication": false, "allowRemoteConnections": false } }),
            app_dir,
            |_| None,
        );
        assert_eq!(local.bind_ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert!(!local.auth_required);

        // Remote allowed → bind all interfaces AND auth is FORCED on even
        // though the toggle is false (defense-in-depth §6 invariant).
        let remote = ApiRuntimeConfig::resolve_with_env(
            &json!({ "restApi": { "authentication": false, "allowRemoteConnections": true } }),
            app_dir,
            |_| None,
        );
        assert_eq!(remote.bind_ip, IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        assert!(
            remote.auth_required,
            "auth must be forced on for a remotely-reachable server"
        );

        // Live loopback proof: a default (local) server actually answers on
        // 127.0.0.1. (We do not bind 0.0.0.0 in tests — CI/host-policy gated.)
        let srv = start_test_server(auth_on(), &[]).await;
        let resp = http()
            .get(format!("http://127.0.0.1:{}/health", srv.base.rsplit(':').next().unwrap()))
            .send()
            .await
            .expect("loopback health");
        assert_eq!(resp.status().as_u16(), 200);
    }

    // ── 8. readonly role rejects mutation, permits reads ────────────────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn readonly_role_rejects_mutation_allows_read() {
        let srv = start_test_server(auth_on(), &[]).await;

        // Forge a readonly session token signed with the SERVER's own resolved
        // JWT secret (HS256 is stateless, so a token signed elsewhere with the
        // same secret verifies at the gate — this exercises the real readonly
        // enforcement path, since /auth/login only mints Admin tokens in v1).
        let readonly_token = {
            let bearer = BearerAuthService::new();
            let guard = bearer.lock().await;
            guard
                .issue_session_token(srv.jwt_secret.as_bytes(), READONLY_USER, Role::Readonly, 600)
                .expect("issue readonly token")
                .token
        };

        // Mutating route (POST) → 403 readonly. The gate rejects before the
        // body is parsed, so an empty body is fine.
        let resp = http()
            .post(srv.url("/ssh/connect"))
            .bearer_auth(&readonly_token)
            .json(&json!({}))
            .send()
            .await
            .expect("readonly POST");
        assert_eq!(
            resp.status().as_u16(),
            403,
            "readonly token must be forbidden on a mutating route"
        );
        let body: serde_json::Value = resp.json().await.expect("403 body");
        assert_eq!(body["error"], "readonly");

        // Read route (GET) → 200, and the role/subject survive the round-trip.
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .bearer_auth(&readonly_token)
            .send()
            .await
            .expect("readonly GET");
        assert_eq!(resp.status().as_u16(), 200, "readonly may read");
        let who: serde_json::Value = resp.json().await.expect("whoami body");
        assert_eq!(who["role"], "readonly");
        assert_eq!(who["principal"], READONLY_USER);
    }

    // ── 9. alg:none and tampered JWTs are rejected ──────────────────────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn alg_none_and_tampered_jwt_rejected() {
        let srv = start_test_server(auth_on(), &[]).await;

        // Hand-crafted `alg:none` token claiming admin — classic bypass attempt.
        let header = br#"{"alg":"none","typ":"JWT"}"#;
        let payload = br#"{"sub":"attacker","role":"admin","iat":0,"exp":9999999999}"#;
        let alg_none = format!(
            "{}.{}.{}",
            b64url(header),
            b64url(payload),
            b64url(b"sig")
        );
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .bearer_auth(&alg_none)
            .send()
            .await
            .expect("alg:none request");
        assert_eq!(resp.status().as_u16(), 401, "alg:none must be rejected");

        // A genuinely-issued token with a mutated signature must also fail.
        let good = login_admin(&srv).await;
        let mut parts: Vec<&str> = good.split('.').collect();
        assert_eq!(parts.len(), 3, "JWT has three segments");
        // Flip the last character of the signature segment.
        let sig = parts[2];
        let mut sig_chars: Vec<char> = sig.chars().collect();
        let last = sig_chars.len() - 1;
        sig_chars[last] = if sig_chars[last] == 'A' { 'B' } else { 'A' };
        let tampered_sig: String = sig_chars.into_iter().collect();
        parts[2] = &tampered_sig;
        let tampered = parts.join(".");
        assert_ne!(tampered, good, "signature actually changed");

        let resp = http()
            .get(srv.url("/auth/whoami"))
            .bearer_auth(&tampered)
            .send()
            .await
            .expect("tampered request");
        assert_eq!(resp.status().as_u16(), 401, "tampered signature must be rejected");
    }

    // ── 10. logout revokes the token ────────────────────────────────────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn logout_revokes_token() {
        let srv = start_test_server(auth_on(), &[]).await;
        let token = login_admin(&srv).await;

        // Works before logout.
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .bearer_auth(&token)
            .send()
            .await
            .expect("pre-logout whoami");
        assert_eq!(resp.status().as_u16(), 200);

        // Logout revokes.
        let resp = http()
            .post(srv.url("/auth/logout"))
            .bearer_auth(&token)
            .send()
            .await
            .expect("logout");
        assert_eq!(resp.status().as_u16(), 200);

        // Same token is now rejected.
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .bearer_auth(&token)
            .send()
            .await
            .expect("post-logout whoami");
        assert_eq!(
            resp.status().as_u16(),
            401,
            "revoked token must be rejected after logout"
        );
    }

    // ── Default posture: auth off + loopback → open without a key ───────────
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn no_auth_required_when_toggle_off_and_local() {
        let srv = start_test_server(
            json!({ "enabled": true, "authentication": false, "allowRemoteConnections": false }),
            &[],
        )
        .await;
        let resp = http()
            .get(srv.url("/auth/whoami"))
            .send()
            .await
            .expect("open whoami");
        assert_eq!(
            resp.status().as_u16(),
            200,
            "with auth off on loopback, no key is required"
        );
    }

    // ── §6 invariant: no stored credential is ever serialized in a response ─
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn responses_never_leak_stored_credentials() {
        let srv = start_test_server(auth_on(), &[]).await;
        let client = http();

        // /auth/users returns usernames only — never password hashes.
        let resp = client
            .get(srv.url("/auth/users"))
            .header("x-api-key", &srv.api_key)
            .send()
            .await
            .expect("users request");
        assert_eq!(resp.status().as_u16(), 200);
        let raw = resp.text().await.expect("users body");
        assert!(raw.contains(ADMIN_USER), "usernames should be listed");
        assert!(raw.contains(READONLY_USER));
        for forbidden in ["password_hash", "password", "$argon2", "$2a$", "$2b$", "$2y$"] {
            assert!(
                !raw.contains(forbidden),
                "response leaked credential material ({forbidden}): {raw}"
            );
        }
        // The seeded passwords themselves must never surface.
        assert!(!raw.contains(ADMIN_PASS));
        assert!(!raw.contains(READONLY_PASS));

        // whoami likewise carries no secret / key / token material.
        let who = client
            .get(srv.url("/auth/whoami"))
            .header("x-api-key", &srv.api_key)
            .send()
            .await
            .expect("whoami request")
            .text()
            .await
            .expect("whoami body");
        assert!(!who.contains(&srv.api_key), "api key leaked in whoami");
        assert!(!who.contains(&srv.jwt_secret), "jwt secret leaked in whoami");
    }
}
