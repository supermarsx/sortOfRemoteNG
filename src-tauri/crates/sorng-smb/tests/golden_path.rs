//! t3-e7 — SMB golden-path smoke test (R3)
//!
//! connect -> list -> disconnect against a live samba container.
//!
//! # Running
//!
//! This test is `#[ignore]`-gated so default `cargo test` skips it.
//! To run it, start a samba container on `127.0.0.1` exposing a share
//! and invoke:
//!
//! ```bash
//! # Example with a dperson/samba container:
//! docker run --rm -d --name test-smb -p 445:445 \
//!   -e USERID=1000 -e GROUPID=1000 \
//!   dperson/samba -u "sorngtest;sorngpass" -s "public;/share;yes;no;no;sorngtest"
//!
//! SMB_HOST=127.0.0.1 SMB_USER=sorngtest SMB_PASSWORD=sorngpass \
//!   SMB_SHARE=public \
//!   cargo test -p sorng-smb --test golden_path -- --ignored --nocapture
//! ```
//!
//! Credentials come from env vars so the test is usable against any
//! reachable SMB server (the e2e/docker-compose.yml in this repo does
//! not yet include a samba service — a follow-up for the e2e compose
//! aggregator executor t3-e30). If env vars are unset the test exits
//! early with a clear SKIP message rather than failing.
//!
//! # Note on feature gating
//!
//! The plan calls for a `docker-e2e` Cargo feature gate in addition to
//! `#[ignore]`. Adding that feature requires editing
//! `src-tauri/crates/sorng-smb/Cargo.toml`, which is outside this
//! executor's exclusive file locks (new-files only). `#[ignore]` alone
//! already satisfies the "default `cargo test` skips it" acceptance
//! criterion. A follow-up may add the feature + `#![cfg(feature =
//! "docker-e2e")]` file-level gate.

use sorng_smb::smb::{SmbConnectionConfig, SmbService};

fn env_or_skip(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

#[tokio::test]
#[ignore = "docker-e2e: requires a running samba container; set SMB_HOST/SMB_USER/SMB_PASSWORD/SMB_SHARE and run with --ignored"]
async fn smb_connect_list_disconnect_golden_path() {
    let host = match env_or_skip("SMB_HOST") {
        Some(h) => h,
        None => {
            eprintln!(
                "SKIP: SMB_HOST not set — start a samba container and export \
                 SMB_HOST/SMB_USER/SMB_PASSWORD/SMB_SHARE to run."
            );
            return;
        }
    };
    let user = env_or_skip("SMB_USER");
    let pass = env_or_skip("SMB_PASSWORD");
    let share = env_or_skip("SMB_SHARE");

    let cfg = SmbConnectionConfig {
        host: host.clone(),
        port: std::env::var("SMB_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(445),
        domain: None,
        username: user,
        password: pass,
        workgroup: None,
        share: share.clone(),
        label: Some("t3-e7-golden-path".into()),
        disable_plaintext: false,
        use_kerberos: false,
    };

    let mut svc = SmbService::new();

    // ── connect ────────────────────────────────────────────────────
    let info = svc
        .connect(cfg)
        .await
        .expect("SMB connect should succeed against running samba container");
    assert!(info.connected, "session should report connected=true");
    assert_eq!(info.host, host);
    let session_id = info.id.clone();

    // ── list ───────────────────────────────────────────────────────
    // If a share was provided, list its root directory; otherwise enumerate shares.
    if let Some(sh) = share.as_deref() {
        let entries = svc
            .list_directory(&session_id, sh, "/")
            .await
            .expect("list_directory on provided share should succeed");
        eprintln!(
            "t3-e7 SMB: listed {} entries under {}:{}",
            entries.len(),
            host,
            sh
        );
    } else {
        let shares = svc
            .list_shares(&session_id)
            .await
            .expect("list_shares on session root should succeed");
        assert!(
            !shares.is_empty(),
            "server should expose at least one share"
        );
        eprintln!("t3-e7 SMB: found {} shares on {}", shares.len(), host);
    }

    // session must be visible
    let listed = svc.list_sessions().await;
    assert!(listed.iter().any(|s| s.id == session_id));

    // ── disconnect ─────────────────────────────────────────────────
    svc.disconnect(&session_id)
        .await
        .expect("disconnect should succeed");
    assert!(
        svc.get_session_info(&session_id).await.is_err(),
        "session should be gone post-disconnect"
    );
}
