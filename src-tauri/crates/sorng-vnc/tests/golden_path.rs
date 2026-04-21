//! t3-e7 — VNC golden-path smoke test (R3)
//!
//! connect -> list (session info + framebuffer) -> disconnect against the
//! `consol/rocky-xfce-vnc` container exposed on 127.0.0.1:15900 by
//! `e2e/docker-compose.yml`.
//!
//! # Running
//!
//! ```bash
//! cd e2e && docker compose up -d test-vnc
//!
//! VNC_PASSWORD=yoursecret \
//!   cargo test -p sorng-vnc --test golden_path -- --ignored --nocapture
//! ```
//!
//! The default host/port match the compose file; override with
//! `VNC_HOST` / `VNC_PORT` if running a different container.
//!
//! # Note on feature gating
//!
//! The plan specifies a `docker-e2e` Cargo feature gate on top of
//! `#[ignore]`. Adding that feature requires editing
//! `src-tauri/crates/sorng-vnc/Cargo.toml`, which is outside this
//! executor's exclusive file locks (new files only). `#[ignore]` alone
//! already satisfies the "default `cargo test` skips it" acceptance
//! criterion. A follow-up may add the feature + file-level gate.

use std::time::Duration;

use sorng_vnc::vnc::{VncConfig, VncService};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.into())
}

#[tokio::test]
#[ignore = "docker-e2e: requires `docker compose up -d test-vnc` and VNC_PASSWORD env; run with --ignored"]
async fn vnc_connect_list_disconnect_golden_path() {
    let host = env_or("VNC_HOST", "127.0.0.1");
    let port: u16 = env_or("VNC_PORT", "15900").parse().unwrap_or(15900);
    let password = match std::env::var("VNC_PASSWORD") {
        Ok(p) if !p.is_empty() => p,
        _ => {
            eprintln!(
                "SKIP: VNC_PASSWORD not set — export the same value used by \
                 e2e/docker-compose.yml's test-vnc service."
            );
            return;
        }
    };

    let cfg = VncConfig {
        host: host.clone(),
        port,
        password: Some(password),
        username: None,
        pixel_format: None,
        encodings: vec![
            "ZRLE".into(),
            "Hextile".into(),
            "CopyRect".into(),
            "Raw".into(),
        ],
        shared: true,
        view_only: true,
        connect_timeout_secs: 15,
        update_interval_ms: 100,
        local_cursor: true,
        show_desktop_name: true,
        label: Some("t3-e7-golden-path".into()),
        jpeg_quality: 6,
        compression_level: 2,
        keepalive_interval_secs: 0,
    };

    let mut svc = VncService::new();

    // ── connect ────────────────────────────────────────────────────
    let session_id = svc
        .connect(cfg)
        .await
        .expect("VNC connect should succeed against running tightvnc/xfce container");

    // Give the handshake a moment to settle (protocol version + security +
    // init exchange runs on a background task after connect returns).
    tokio::time::sleep(Duration::from_millis(500)).await;

    // ── list ───────────────────────────────────────────────────────
    let ids = svc.list_sessions();
    assert!(
        ids.iter().any(|id| id == &session_id),
        "connected session should appear in list_sessions()"
    );
    let info = svc
        .get_session_info(&session_id)
        .await
        .expect("session info should be retrievable");
    assert_eq!(info.host, host);
    assert_eq!(info.port, port);
    eprintln!(
        "t3-e7 VNC: session {} host={}:{} fb={}x{} proto={:?}",
        info.id, info.host, info.port, info.framebuffer_width, info.framebuffer_height, info.protocol_version,
    );

    // ── disconnect ─────────────────────────────────────────────────
    svc.disconnect(&session_id)
        .await
        .expect("disconnect should succeed");
    assert!(
        !svc.is_connected(&session_id).await,
        "session should report disconnected"
    );
    assert!(svc.remove_session(&session_id));
}
