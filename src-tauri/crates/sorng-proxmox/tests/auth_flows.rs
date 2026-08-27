//! Authentication flows against the in-process TLS mock PVE (`mock_pve.rs`).
//!
//! Every test pins the mock's certificate SHA-256 (`insecure + fingerprint`),
//! exercising the real fail-closed pin path of `PveClient::new`.

mod mock_pve;

use std::time::Duration;

use mock_pve::{MockPve, DEFAULT_PASSWORD, MOCK_NODE, MOCK_VMID};
use sorng_proxmox::client::{
    probe_certificate, LoginOutcome, PveClient, TfaKind, TICKET_RENEWAL_AFTER,
};
use sorng_proxmox::error::ProxmoxErrorKind;
use sorng_proxmox::service::ProxmoxService;
use sorng_proxmox::types::{ProxmoxAuthMethod, ProxmoxConfig, ProxmoxConnectOutcome};

const TOTP_SECRET: &str = "JBSWY3DPEHPK3PXP";

fn password_config(mock: &MockPve, username: &str, realm: &str) -> ProxmoxConfig {
    ProxmoxConfig {
        host: mock.host(),
        port: mock.port(),
        auth: ProxmoxAuthMethod::Password {
            username: username.to_string(),
            password: DEFAULT_PASSWORD.to_string(),
            realm: realm.to_string(),
            otp: None,
            totp_secret: None,
        },
        insecure: true,
        timeout_secs: 10,
        fingerprint: Some(mock.fingerprint.clone()),
    }
}

fn token_config(mock: &MockPve, token_id: &str, secret: &str) -> ProxmoxConfig {
    ProxmoxConfig {
        host: mock.host(),
        port: mock.port(),
        auth: ProxmoxAuthMethod::ApiToken {
            token_id: token_id.to_string(),
            secret: secret.to_string(),
        },
        insecure: true,
        timeout_secs: 10,
        fingerprint: Some(mock.fingerprint.clone()),
    }
}

fn set_password_extras(config: &mut ProxmoxConfig, otp_value: Option<&str>, secret: Option<&str>) {
    if let ProxmoxAuthMethod::Password {
        otp, totp_secret, ..
    } = &mut config.auth
    {
        *otp = otp_value.map(str::to_string);
        *totp_secret = secret.map(str::to_string);
    }
}

// ── Password login ───────────────────────────────────────────────────

#[tokio::test]
async fn password_login_pam_realm_issues_ticket_and_lists_nodes() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    let outcome = service
        .connect_ex(password_config(&mock, "root", "pam"))
        .await
        .expect("connect");
    assert_eq!(
        outcome,
        ProxmoxConnectOutcome::Connected {
            username: "root@pam".to_string(),
            message: format!("Connected to {}", mock.host()),
        }
    );
    assert!(service.is_connected());
    assert!(!service.tfa_pending());

    let nodes = service.list_nodes().await.expect("nodes");
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].node, MOCK_NODE);

    let vms = service.list_qemu_vms(MOCK_NODE).await.expect("vms");
    assert_eq!(vms[0].vmid, MOCK_VMID);

    let state = mock.state();
    let login = state.ticket_requests()[0].form();
    assert_eq!(login.get("username").map(String::as_str), Some("root@pam"));
    assert_eq!(
        login.get("password").map(String::as_str),
        Some(DEFAULT_PASSWORD)
    );
    assert!(!login.contains_key("otp"));
    let nodes_request = state
        .requests
        .iter()
        .find(|request| request.path == "/api2/json/nodes")
        .expect("nodes request recorded");
    assert!(nodes_request
        .header("Cookie")
        .is_some_and(|cookie| cookie.starts_with("PVEAuthCookie=PVE:root@pam:")));
    assert!(nodes_request.header("CSRFPreventionToken").is_some());
}

#[tokio::test]
async fn realm_precedence_explicit_username_realm_wins_over_realm_param() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    // realm inside the username beats the `realm` field.
    service
        .connect(password_config(&mock, "admin@pve", "pam"))
        .await
        .expect("connect");
    // realm field applies when the username has none.
    let mut second = ProxmoxService::new();
    second
        .connect(password_config(&mock, "operator", "ldap"))
        .await
        .expect("connect");

    let state = mock.state();
    let tickets = state.ticket_requests();
    assert_eq!(
        tickets[0].form().get("username").map(String::as_str),
        Some("admin@pve")
    );
    assert_eq!(
        tickets[1].form().get("username").map(String::as_str),
        Some("operator@ldap")
    );
}

#[tokio::test]
async fn wrong_password_is_an_authentication_error() {
    let mock = MockPve::start().await;
    let mut config = password_config(&mock, "root", "pam");
    if let ProxmoxAuthMethod::Password { password, .. } = &mut config.auth {
        *password = "nope".to_string();
    }
    let mut service = ProxmoxService::new();
    let error = service.connect(config).await.unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::AuthenticationError));
    assert_eq!(error.message, "Invalid credentials");
    assert!(!service.is_connected());
}

#[tokio::test]
async fn pve6_inline_otp_is_sent_as_form_field() {
    let mock = MockPve::start().await;
    mock.state().inline_otp = Some("424242".to_string());
    let mut config = password_config(&mock, "root", "pam");
    set_password_extras(&mut config, Some("424242"), None);
    let mut service = ProxmoxService::new();
    service
        .connect(config)
        .await
        .expect("connect with inline otp");
    let state = mock.state();
    assert_eq!(
        state.ticket_requests()[0]
            .form()
            .get("otp")
            .map(String::as_str),
        Some("424242")
    );
}

// ── API tokens ───────────────────────────────────────────────────────

#[tokio::test]
async fn api_token_is_verified_against_version_and_never_posts_a_ticket() {
    let mock = MockPve::start().await;
    mock.state()
        .api_tokens
        .insert("root@pam!ci".to_string(), "s3cret-uuid".to_string());
    let mut service = ProxmoxService::new();
    let outcome = service
        .connect_ex(token_config(&mock, "root@pam!ci", "s3cret-uuid"))
        .await
        .expect("token connect");
    assert!(matches!(
        outcome,
        ProxmoxConnectOutcome::Connected { ref username, .. } if username == "root@pam!ci"
    ));
    let version = service.get_version().await.expect("version");
    assert_eq!(version.version.as_deref(), Some("8.2.4"));

    let state = mock.state();
    assert!(state.ticket_requests().is_empty());
    assert_eq!(state.count("GET", "/api2/json/version"), 2);
    let request = &state.requests[0];
    assert_eq!(
        request.header("Authorization"),
        Some("PVEAPIToken=root@pam!ci=s3cret-uuid")
    );
    assert!(request.header("Cookie").is_none());
}

#[tokio::test]
async fn invalid_api_token_fails_and_does_not_connect() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    let error = service
        .connect(token_config(&mock, "root@pam!ci", "wrong"))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::AuthenticationError));
    // The service keeps a client with a token header set, but the login failed:
    // callers must treat the error as authoritative.
    assert!(!service
        .list_nodes()
        .await
        .is_ok_and(|nodes| !nodes.is_empty()));
}

// ── PVE 7+ NeedTFA challenge ─────────────────────────────────────────

#[tokio::test]
async fn need_tfa_challenge_returns_tfa_required_outcome_then_submit_tfa_completes() {
    let mock = MockPve::start().await;
    {
        let mut state = mock.state();
        state.require_tfa = true;
        state.totp_secret = Some(TOTP_SECRET.to_string());
        state.recovery_codes = vec!["recov-1".to_string()];
    }
    let mut service = ProxmoxService::new();
    let outcome = service
        .connect_ex(password_config(&mock, "root", "pam"))
        .await
        .expect("first step");
    assert_eq!(
        outcome,
        ProxmoxConnectOutcome::TfaRequired {
            username: "root@pam".to_string(),
            tfa_types: vec!["recovery".to_string(), "totp".to_string()],
        }
    );
    assert!(service.tfa_pending());
    assert!(
        !service.is_connected(),
        "no ticket before the second factor"
    );
    assert!(service.list_nodes().await.is_err());

    // Wrong code keeps the challenge pending.
    let error = service
        .submit_tfa(TfaKind::Totp, "000000")
        .await
        .unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::TfaRequired));
    assert!(service.tfa_pending());

    let code = sorng_proxmox::client::totp_code_from_secret(TOTP_SECRET).unwrap();
    let outcome = service
        .submit_tfa(TfaKind::Totp, &code)
        .await
        .expect("second step");
    assert!(matches!(outcome, ProxmoxConnectOutcome::Connected { .. }));
    assert!(service.is_connected());
    assert!(!service.tfa_pending());
    assert_eq!(service.list_nodes().await.unwrap()[0].node, MOCK_NODE);

    let state = mock.state();
    let tickets = state.ticket_requests();
    assert_eq!(tickets.len(), 3);
    let second = tickets[2].form();
    assert_eq!(second.get("username").map(String::as_str), Some("root@pam"));
    assert_eq!(
        second.get("password").map(String::as_str),
        Some(format!("totp:{code}").as_str())
    );
    assert!(second
        .get("tfa-challenge")
        .is_some_and(|challenge| challenge.starts_with("PVE:!tfa!")));
}

#[tokio::test]
async fn recovery_kind_uses_recovery_prefix() {
    let mock = MockPve::start().await;
    {
        let mut state = mock.state();
        state.require_tfa = true;
        state.recovery_codes = vec!["abcd-efgh".to_string()];
    }
    let mut service = ProxmoxService::new();
    service
        .connect_ex(password_config(&mock, "root", "pam"))
        .await
        .expect("first step");
    service
        .submit_tfa(TfaKind::Recovery, "abcd-efgh")
        .await
        .expect("recovery code");
    assert!(service.is_connected());
    // Single use: a second attempt with the same code fails.
    let state = mock.state();
    assert!(state.recovery_codes.is_empty());
    assert_eq!(
        state.ticket_requests()[1]
            .form()
            .get("password")
            .map(String::as_str),
        Some("recovery:abcd-efgh")
    );
}

#[tokio::test]
async fn submit_tfa_without_pending_challenge_is_rejected() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    let error = service
        .submit_tfa(TfaKind::Totp, "123456")
        .await
        .unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::TfaRequired));
    service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .expect("connect");
    let error = service
        .submit_tfa(TfaKind::Totp, "123456")
        .await
        .unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::TfaRequired));
    assert_eq!(mock.state().ticket_requests().len(), 1);
}

#[tokio::test]
async fn compat_connect_maps_tfa_required_to_error() {
    let mock = MockPve::start().await;
    {
        let mut state = mock.state();
        state.require_tfa = true;
        state.totp_secret = Some(TOTP_SECRET.to_string());
    }
    let mut service = ProxmoxService::new();
    let error = service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::TfaRequired));
    assert_eq!(error.message, "TFA_REQUIRED");
    assert!(
        service.tfa_pending(),
        "the challenge stays usable via submit_tfa"
    );
}

#[tokio::test]
async fn totp_secret_auto_completes_the_challenge_in_one_call() {
    let mock = MockPve::start().await;
    {
        let mut state = mock.state();
        state.require_tfa = true;
        state.totp_secret = Some(TOTP_SECRET.to_string());
    }
    let mut config = password_config(&mock, "root", "pam");
    set_password_extras(&mut config, None, Some("jbsw y3dp ehpk 3pxp"));
    let mut service = ProxmoxService::new();
    let outcome = service.connect_ex(config).await.expect("auto-TOTP");
    assert!(matches!(outcome, ProxmoxConnectOutcome::Connected { .. }));
    assert!(service.is_connected());

    let state = mock.state();
    let tickets = state.ticket_requests();
    assert_eq!(tickets.len(), 2, "first step + automatic second step");
    assert!(tickets[1].form().contains_key("tfa-challenge"));
    assert!(tickets[1]
        .form()
        .get("password")
        .is_some_and(|p| p.starts_with("totp:")));
}

#[tokio::test]
async fn explicit_otp_is_reused_as_the_totp_code_for_a_pve7_challenge() {
    let mock = MockPve::start().await;
    {
        let mut state = mock.state();
        state.require_tfa = true;
        state.totp_secret = Some(TOTP_SECRET.to_string());
    }
    let code = sorng_proxmox::client::totp_code_from_secret(TOTP_SECRET).unwrap();
    let mut config = password_config(&mock, "root", "pam");
    set_password_extras(&mut config, Some(&code), None);
    let mut service = ProxmoxService::new();
    let outcome = service.connect_ex(config).await.expect("otp as tfa code");
    assert!(matches!(outcome, ProxmoxConnectOutcome::Connected { .. }));
    assert_eq!(mock.state().ticket_requests().len(), 2);
}

// ── Ticket renewal ───────────────────────────────────────────────────

#[tokio::test]
async fn aged_ticket_is_renewed_with_ticket_as_password_before_the_request() {
    let mock = MockPve::start().await;
    let mut client = PveClient::new(&password_config(&mock, "root", "pam")).unwrap();
    assert!(matches!(
        client.login_ex().await.unwrap(),
        LoginOutcome::Connected { .. }
    ));
    let original = client.ticket().unwrap();
    assert_eq!(client.renewal_count(), 0);

    // Just under the threshold: no renewal.
    client.debug_age_ticket(TICKET_RENEWAL_AFTER - Duration::from_secs(60));
    let _: serde_json::Value = client.get("/api2/json/version").await.unwrap();
    assert_eq!(client.renewal_count(), 0);
    assert_eq!(mock.state().ticket_requests().len(), 1);

    // Over the threshold: renewed before the request goes out.
    client.debug_age_ticket(Duration::from_secs(120));
    let _: serde_json::Value = client.get("/api2/json/version").await.unwrap();
    assert_eq!(client.renewal_count(), 1);
    let renewed = client.ticket().unwrap();
    assert_ne!(renewed.ticket, original.ticket);
    assert_ne!(renewed.csrf_token, original.csrf_token);

    // Scoped so the mock's `MutexGuard` never spans the awaits below.
    {
        let state = mock.state();
        let tickets = state.ticket_requests();
        assert_eq!(tickets.len(), 2);
        let renewal = tickets[1].form();
        assert_eq!(
            renewal.get("username").map(String::as_str),
            Some("root@pam")
        );
        assert_eq!(
            renewal.get("password").map(String::as_str),
            Some(original.ticket.as_str())
        );
        assert!(!renewal.contains_key("tfa-challenge"));
        // The request after renewal carried the new cookie.
        let last_version = state
            .requests
            .iter()
            .rev()
            .find(|request| request.path == "/api2/json/version")
            .unwrap();
        assert_eq!(
            last_version.header("Cookie"),
            Some(format!("PVEAuthCookie={}", renewed.ticket).as_str())
        );
    }

    // Renewal resets the age clock.
    let _: serde_json::Value = client.get("/api2/json/version").await.unwrap();
    assert_eq!(client.renewal_count(), 1);
}

#[tokio::test]
async fn a_401_triggers_one_renewal_and_a_retry() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .unwrap();
    // Server-side expiry: the stored ticket is no longer valid, so the
    // ticket-as-password renewal fails and the client falls back to re-login.
    mock.state().invalidate_tickets();

    let nodes = service.list_nodes().await.expect("transparent re-auth");
    assert_eq!(nodes[0].node, MOCK_NODE);
    assert_eq!(service.client().unwrap().renewal_count(), 1);

    let state = mock.state();
    assert_eq!(
        state.count("GET", "/api2/json/nodes"),
        2,
        "one 401 + one retry"
    );
    let tickets = state.ticket_requests();
    // login, failed ticket-as-password renewal, fallback password re-login
    assert_eq!(tickets.len(), 3);
    assert!(tickets[1]
        .form()
        .get("password")
        .is_some_and(|p| p.starts_with("PVE:")));
    assert_eq!(
        tickets[2].form().get("password").map(String::as_str),
        Some(DEFAULT_PASSWORD)
    );
}

#[tokio::test]
async fn a_second_401_after_renewal_surfaces_an_auth_error_without_looping() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .unwrap();
    {
        let mut state = mock.state();
        state.invalidate_tickets();
        // Password rotated server-side: the fallback re-login fails too.
        state.password = "rotated".to_string();
    }
    let error = service.list_nodes().await.unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::AuthenticationError));
    let state = mock.state();
    assert_eq!(state.count("GET", "/api2/json/nodes"), 1, "no retry storm");
    assert_eq!(state.ticket_requests().len(), 3);
}

#[tokio::test]
async fn renewal_fallback_with_tfa_and_no_secret_reports_session_expired() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .unwrap();
    {
        let mut state = mock.state();
        state.invalidate_tickets();
        state.require_tfa = true;
        state.totp_secret = Some(TOTP_SECRET.to_string());
    }
    let error = service.list_nodes().await.unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::AuthenticationError));
    assert!(
        !service.tfa_pending(),
        "no half-authenticated state left behind"
    );
    assert!(!service.is_connected());
}

#[tokio::test]
async fn renewal_fallback_completes_tfa_automatically_with_a_stored_secret() {
    let mock = MockPve::start().await;
    let mut config = password_config(&mock, "root", "pam");
    set_password_extras(&mut config, None, Some(TOTP_SECRET));
    let mut service = ProxmoxService::new();
    service.connect(config).await.unwrap();
    {
        let mut state = mock.state();
        state.invalidate_tickets();
        state.require_tfa = true;
        state.totp_secret = Some(TOTP_SECRET.to_string());
    }
    let nodes = service.list_nodes().await.expect("re-login with auto-TOTP");
    assert_eq!(nodes[0].node, MOCK_NODE);
    assert_eq!(service.client().unwrap().renewal_count(), 1);
}

#[tokio::test]
async fn api_token_sessions_never_renew() {
    let mock = MockPve::start().await;
    mock.state()
        .api_tokens
        .insert("root@pam!ci".to_string(), "s3cret".to_string());
    let mut client = PveClient::new(&token_config(&mock, "root@pam!ci", "s3cret")).unwrap();
    client.login().await.unwrap();
    assert!(!client.uses_ticket_session());
    client.debug_age_ticket(TICKET_RENEWAL_AFTER * 2);
    let _: serde_json::Value = client.get("/api2/json/version").await.unwrap();
    assert_eq!(client.renewal_count(), 0);

    // A 401 for a token is final: no ticket POST, no retry.
    mock.state().api_tokens.clear();
    let error = client
        .get::<serde_json::Value>("/api2/json/version")
        .await
        .unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::AuthenticationError));
    let state = mock.state();
    assert!(state.ticket_requests().is_empty());
    assert_eq!(state.count("GET", "/api2/json/version"), 3);
}

// ── Certificate probe ────────────────────────────────────────────────

#[tokio::test]
async fn probe_reports_the_mock_certificate_and_sends_no_credentials() {
    let mock = MockPve::start().await;
    let probe = probe_certificate(&mock.host(), mock.port())
        .await
        .expect("probe");
    assert_eq!(probe.sha256, mock.fingerprint);
    assert_eq!(probe.sha256.len(), 32 * 3 - 1);
    assert!(probe.self_signed);
    assert_eq!(probe.subject, probe.issuer);
    assert!(probe.subject_alt_names.iter().any(|n| n == "pve-mock.test"));
    assert!(probe.subject_alt_names.iter().any(|n| n == "127.0.0.1"));
    assert!(probe.not_after > probe.not_before);
    assert!(chrono::DateTime::parse_from_rfc3339(&probe.not_after).is_ok());

    // No HTTP request at all reached the mock — in particular no /access/ticket.
    // Scoped so the guard never spans the `connect` await below.
    {
        let state = mock.state();
        assert!(state.requests.is_empty());
        assert!(state.ticket_requests().is_empty());
    }

    // The reported fingerprint is directly usable as the pin.
    let mut config = password_config(&mock, "root", "pam");
    config.fingerprint = Some(probe.sha256.clone());
    let mut service = ProxmoxService::new();
    service
        .connect(config)
        .await
        .expect("connect with probed pin");
}

#[tokio::test]
async fn probe_rejects_bad_input_and_unreachable_hosts() {
    assert!(probe_certificate("127.0.0.1", 0).await.is_err());
    assert!(probe_certificate("", 8006).await.is_err());
    // Closed port → connection error, not a hang.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let error = probe_certificate("127.0.0.1", port).await.unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::ConnectionError));
}

// ── TLS pin / response caps ──────────────────────────────────────────

#[tokio::test]
async fn wrong_pin_fails_closed_before_any_credential_is_sent() {
    let mock = MockPve::start().await;
    let mut config = password_config(&mock, "root", "pam");
    config.fingerprint = Some("AB".repeat(32));
    let mut service = ProxmoxService::new();
    let error = service.connect(config).await.unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::ConnectionError));
    assert!(mock.state().requests.is_empty());
}

#[tokio::test]
async fn oversized_version_response_is_rejected_by_the_metadata_cap() {
    let mock = MockPve::start().await;
    mock.state().version_padding = 300 * 1024;
    let mut service = ProxmoxService::new();
    service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .unwrap();
    let error = service.get_version().await.unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::ParseError));
    assert!(error.message.contains("exceeds"));

    // Same body on the token verification path fails the login itself.
    mock.state()
        .api_tokens
        .insert("root@pam!ci".to_string(), "s".to_string());
    let error = ProxmoxService::new()
        .connect(token_config(&mock, "root@pam!ci", "s"))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::ParseError));
}

// ── Smoke: power actions through the renewing client ─────────────────

#[tokio::test]
async fn power_actions_round_trip_through_the_mock() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .unwrap();
    let upid = service.stop_qemu_vm(MOCK_NODE, MOCK_VMID).await.unwrap();
    assert!(upid.is_some_and(|u| u.starts_with("UPID:")));
    let status = service.get_qemu_status(MOCK_NODE, MOCK_VMID).await.unwrap();
    assert_eq!(status.status, sorng_proxmox::types::QemuStatus::Stopped);
    service.start_qemu_vm(MOCK_NODE, MOCK_VMID).await.unwrap();
    let status = service.get_qemu_status(MOCK_NODE, MOCK_VMID).await.unwrap();
    assert_eq!(status.status, sorng_proxmox::types::QemuStatus::Running);
    let error = service.get_qemu_status(MOCK_NODE, 999).await.unwrap_err();
    assert!(matches!(error.kind, ProxmoxErrorKind::NotFound));
}

// ── Web UI URL ───────────────────────────────────────────────────────

#[tokio::test]
async fn web_ui_url_uses_the_connection_and_deep_links() {
    let mock = MockPve::start().await;
    let mut service = ProxmoxService::new();
    assert!(service.web_ui_url(None, None, None).is_err());
    assert_eq!(
        service
            .web_ui_url(Some("pve.lab"), None, Some(("qemu", "100")))
            .unwrap(),
        "https://pve.lab:8006/#v1:0:=qemu%2F100"
    );
    service
        .connect(password_config(&mock, "root", "pam"))
        .await
        .unwrap();
    assert_eq!(
        service.web_ui_url(None, None, None).unwrap(),
        format!("https://{}:{}/", mock.host(), mock.port())
    );
    assert_eq!(
        service
            .web_ui_url(None, None, Some(("lxc", "101")))
            .unwrap(),
        format!("https://{}:{}/#v1:0:=lxc%2F101", mock.host(), mock.port())
    );
    assert_eq!(
        service
            .web_ui_url(Some("[::1]"), Some(8443), Some(("node", "pve-mock")))
            .unwrap(),
        "https://[::1]:8443/#v1:0:=node%2Fpve-mock"
    );
    assert!(service
        .web_ui_url(None, None, Some(("qemu", "100/../x")))
        .is_err());
    assert!(service
        .web_ui_url(None, None, Some(("bogus", "1")))
        .is_err());
}
