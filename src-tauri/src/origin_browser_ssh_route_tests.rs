use super::*;
use serde_json::json;

struct ConnectDropProbe(Arc<std::sync::atomic::AtomicBool>);

impl Drop for ConnectDropProbe {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[tokio::test]
async fn ssh_pending_connect_owner_revocation_drops_original_work_before_forwarding() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let current = Arc::new(AtomicBool::new(true));
    let observed = current.clone();
    let dropped = Arc::new(AtomicBool::new(false));
    let worker_drop = dropped.clone();
    let (started, entered) = tokio::sync::oneshot::channel();
    let forward_started = Arc::new(AtomicBool::new(false));
    let forwarded = forward_started.clone();
    let worker = tokio::spawn(async move {
        let result = connect_while_current(
            async {
                let _original_attempt = ConnectDropProbe(worker_drop);
                let _ = started.send(());
                std::future::pending::<Result<(), NativeAuthorityError>>().await
            },
            || observed.load(Ordering::SeqCst),
        )
        .await;
        if result.is_ok() {
            forwarded.store(true, Ordering::SeqCst);
        }
        result
    });
    entered.await.unwrap();
    current.store(false, Ordering::SeqCst);
    let result = tokio::time::timeout(Duration::from_secs(1), worker)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        result,
        Err(NativeAuthorityError::SshRouteUnavailable { stage: "owner" })
    ));
    assert!(dropped.load(Ordering::SeqCst));
    assert!(!forward_started.load(Ordering::SeqCst));
}

#[tokio::test]
async fn ssh_revoked_owner_never_polls_connect_and_wins_a_success_race() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let polled = AtomicBool::new(false);
    let result = connect_while_current(
        async {
            polled.store(true, Ordering::SeqCst);
            Ok(())
        },
        || false,
    )
    .await;
    assert!(matches!(
        result,
        Err(NativeAuthorityError::SshRouteUnavailable { stage: "owner" })
    ));
    assert!(!polled.load(Ordering::SeqCst));

    let current = AtomicBool::new(true);
    let dropped = Arc::new(AtomicBool::new(false));
    let result = connect_while_current(
        async {
            // Simulate a returned actor whose owner was revoked during handshake.
            let owned_actor = ConnectDropProbe(dropped.clone());
            current.store(false, Ordering::SeqCst);
            Ok(owned_actor)
        },
        || current.load(Ordering::SeqCst),
    )
    .await;
    assert!(matches!(
        result,
        Err(NativeAuthorityError::SshRouteUnavailable { stage: "owner" })
    ));
    assert!(dropped.load(Ordering::SeqCst));
}

#[tokio::test]
async fn ssh_current_connect_keeps_the_original_owned_result_and_error() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let dropped = Arc::new(AtomicBool::new(false));
    let owned = connect_while_current(async { Ok(ConnectDropProbe(dropped.clone())) }, || true)
        .await
        .unwrap();
    assert!(!dropped.load(Ordering::SeqCst));
    drop(owned);
    assert!(dropped.load(Ordering::SeqCst));
    let result = connect_while_current(
        async { Err::<(), _>(unavailable("connect-authentication")) },
        || true,
    )
    .await;
    assert!(matches!(
        result,
        Err(NativeAuthorityError::SshRouteUnavailable {
            stage: "connect-authentication"
        })
    ));
}

#[test]
fn ssh_connect_failures_preserve_only_known_fixed_reason_codes() {
    for (error, expected) in [
        ("Failed to resolve SSH establishment endpoint", "connect-dns"),
        ("SSH establishment resolver returned no addresses", "connect-dns"),
        ("Failed to connect to SSH establishment endpoint: private-detail", "connect-transport"),
        ("Failed to connect to SSH establishment endpoint: [connection-refused] private-detail", "connect-refused"),
        ("Failed to connect to SSH establishment endpoint: [network-unreachable] private-detail", "connect-network-unreachable"),
        ("Failed to connect to SSH establishment endpoint: [host-unreachable] private-detail", "connect-host-unreachable"),
        ("Failed to connect to SSH establishment endpoint: [permission-denied] private-detail", "connect-denied"),
        ("Failed to connect to SSH establishment endpoint: [address-unavailable] private-detail", "connect-address-unavailable"),
        ("Failed to connect to SSH establishment endpoint: [timed-out] private-detail", "connect-transport-timeout"),
        ("Failed to connect to SSH establishment endpoint: [other] private-detail", "connect-transport"),
        ("Failed to connect to SSH establishment endpoint: [forged] private-detail", "connect-transport"),
        ("Failed to connect to SSH establishment endpoint: private-detail [connection-refused] fake", "connect-transport"),
        ("SSH handshake failed: private-detail", "connect-handshake"),
        ("Host key verification failed for private-host: key rejected by user", "connect-host-key"),
        ("Host key verification timed out for private-host after waiting for user confirmation", "connect-host-key"),
        ("Failed to write known_hosts file: private-path", "connect-host-key"),
        ("No event emitter configured for host-key verification", "connect-host-key"),
        ("SSH_TRUST_UNAVAILABLE[private-detail]: private-host", "connect-host-key"),
        ("All authentication methods failed", "connect-authentication"),
        ("SSH_CONNECTION_TIMEOUT: SSH establishment phase 'overall' exceeded its 30000 ms deadline", "connect-timeout"),
        ("SSH_SESSION_CAPACITY: private-detail", "connect-capacity"),
        ("SSH_HANDSHAKE_CAPACITY: private-detail", "connect-capacity"),
        ("SSH_CONFIG_CAPACITY: private-detail", "connect-capacity"),
        ("SSH connection cancelled", "connect-cancelled"),
    ] {
        let NativeAuthorityError::SshRouteUnavailable { stage } = connect_error(error) else {
            panic!("expected fixed SSH route diagnostic");
        };
        assert_eq!(stage, expected);
    }
}

#[test]
fn ssh_connect_unknown_errors_and_private_details_are_never_reflected() {
    for error in [
        "private-account private-password private-host private-path",
        "remote banner: All authentication methods failed",
        "SSH_CONNECTION_TIMEOUT_LOOKALIKE: private-password",
        "SSH_SESSION_CAPACITY_LOOKALIKE: private-password",
        "SSH connection cancelled private-password",
        "Failed to resolve SSH establishment endpoint private-password",
        "\nSSH handshake failed: private-password",
    ] {
        let result = connect_error(error);
        assert!(matches!(
            result,
            NativeAuthorityError::SshRouteUnavailable {
                stage: "connect-unknown"
            }
        ));
        let message = result.to_string();
        assert!(!message.contains("private-"));
        assert!(!message.contains(error));
    }
    for prefix in [
        "SSH handshake failed:",
        "Failed to connect to SSH establishment endpoint:",
        "Failed to write known_hosts file:",
    ] {
        let message = connect_error(&format!(
            "{prefix} private-password private-account private-host private-path\nforged-log-line"
        ))
        .to_string();
        assert!(!message.contains("private-"));
        assert!(!message.contains("forged-log-line"));
        assert!(!message.contains('\n'));
    }
}

fn target() -> Authority {
    Authority::parse("127.0.10.14:10000").unwrap()
}

fn modern() -> Value {
    json!({"security":{"tunnelChain":[{"enabled":true,"type":"ssh-tunnel",
        "localBindHost":"127.0.10.14","localBindPort":10000,
        "sshTunnel":{"connectionId":"saved-ssh","forwardType":"local",
            "remoteHost":"127.0.0.1","remotePort":10000}}]}})
}

fn editor_ssh_jump() -> Value {
    json!({"security":{"tunnelChain":[{
    "id":"connection-inline-ssh","type":"ssh-jump","enabled":true,
    "name":"Per-connection SSH","sshTunnel":{
        "forwardType":"local","port":22,"authMethod":"password",
        "host":"bastion.example.test","username":"operator","password":"fixture"
    }}]}})
}

#[test]
fn ssh_editor_single_jump_representation_uses_the_original_website_destination() {
    // Exact setInlineSsh/SshSourceFields representation: no remoteHost or
    // remotePort is materialized by the per-connection editor.
    let original = editor_ssh_jump();
    for method in [None, Some("proxyjump"), Some("local-forward")] {
        let mut config = original.clone();
        if let Some(method) = method {
            config["security"]["tunnelChain"][0]["sshChainingMethod"] = method.into();
        }
        let selected = selected(&config, &target()).unwrap().unwrap();
        assert_eq!(selected.remote, target());
        assert_eq!(selected.ssh["host"], "bastion.example.test");
        assert_eq!(selected.ssh["forwardType"], "local");
    }
    let mut linked = original.clone();
    linked["security"]["tunnelChain"][0]["sshTunnel"] = json!({
        "connectionId":"saved-ssh","ownerDatabaseId":"db","forwardType":"local"});
    let selected = selected(&linked, &target()).unwrap().unwrap();
    assert_eq!(selected.remote, target());
    assert_eq!(selected.ssh["connectionId"], "saved-ssh");
    assert_eq!(original, editor_ssh_jump());
}

#[test]
fn ssh_editor_single_jump_does_not_admit_other_mechanisms_or_multiple_hops() {
    for method in [
        json!("proxycommand"),
        json!("nested-ssh"),
        json!("dynamic-socks"),
        json!("stdio"),
        json!("agent-forward"),
        Value::Null,
        json!(false),
    ] {
        let mut config = editor_ssh_jump();
        config["security"]["tunnelChain"][0]["sshChainingMethod"] = method;
        assert!(selected(&config, &target()).is_err());
    }
    for forward in ["remote", "dynamic"] {
        let mut config = editor_ssh_jump();
        config["security"]["tunnelChain"][0]["sshTunnel"]["forwardType"] = forward.into();
        assert!(selected(&config, &target()).is_err());
    }
    let mut config = editor_ssh_jump();
    let extra = config["security"]["tunnelChain"][0].clone();
    config["security"]["tunnelChain"]
        .as_array_mut()
        .unwrap()
        .push(extra);
    assert!(selected(&config, &target()).is_err());
}

#[test]
fn ssh_local_route_preserves_alias_and_separates_remote_destination() {
    let config = modern();
    let selected = selected(&config, &target()).unwrap().unwrap();
    assert_eq!(target().host(), "127.0.10.14");
    assert_eq!(selected.remote.to_string(), "127.0.0.1:10000");
    assert_eq!(selected.ssh["connectionId"], "saved-ssh");
    assert_eq!(config, modern());
    let legacy = json!({"security":{"sshTunnel":{"enabled":true,
        "connectionId":"saved-ssh","localPort":10000,"remoteHost":"localhost","remotePort":10000}}});
    let selected = super::selected(&legacy, &target()).unwrap().unwrap();
    assert_eq!(selected.remote.to_string(), "localhost:10000");
    assert_eq!(selected.ssh["forwardType"], "local");
}

#[test]
fn ssh_local_route_explicit_missing_remote_defaults_and_ipv6_are_unambiguous() {
    let mut config = modern();
    let ssh = config
        .pointer_mut("/security/tunnelChain/0/sshTunnel")
        .unwrap()
        .as_object_mut()
        .unwrap();
    ssh.remove("remoteHost");
    ssh.remove("remotePort");
    assert_eq!(
        selected(&config, &target()).unwrap().unwrap().remote,
        target()
    );
    config["security"]["tunnelChain"][0]["sshTunnel"]["remoteHost"] = "::1".into();
    config["security"]["tunnelChain"][0]["sshTunnel"]["remotePort"] = 8443.into();
    assert_eq!(
        selected(&config, &target())
            .unwrap()
            .unwrap()
            .remote
            .to_string(),
        "[::1]:8443"
    );
    for (key, value) in [
        ("remoteHost", json!("")),
        ("remoteHost", json!("https://host")),
        ("remoteHost", json!("user@host")),
        ("remoteHost", json!("[[::1]]")),
        ("remoteHost", json!("[localhost]")),
        ("remotePort", json!(0)),
        ("remotePort", json!(65536)),
        ("remotePort", json!("10000")),
    ] {
        let mut invalid = modern();
        invalid["security"]["tunnelChain"][0]["sshTunnel"][key] = value;
        assert!(selected(&invalid, &target()).is_err(), "{key}");
    }
}

#[test]
fn ssh_local_route_never_silently_drops_other_route_layers_or_selectors() {
    for key in [
        "proxyProfileId",
        "proxyChainId",
        "tunnelProfileId",
        "tunnelChainId",
        "connectionChainId",
    ] {
        let mut config = modern();
        config[key] = "selected".into();
        assert!(selected(&config, &target()).is_err(), "{key}");
    }
    for extra in [
        json!({"enabled":true,"type":"proxy"}),
        json!({"enabled":true,"type":"ssh-jump"}),
        json!({"type":"ssh-tunnel"}),
    ] {
        let mut config = modern();
        config["security"]["tunnelChain"]
            .as_array_mut()
            .unwrap()
            .push(extra);
        assert!(selected(&config, &target()).is_err());
    }
    for field in ["proxy", "openvpn", "sshTunnel"] {
        let mut config = modern();
        config["security"][field] = json!({"enabled":true});
        assert!(selected(&config, &target()).is_err());
    }
    let mut config = modern();
    config["security"]["tunnelChain"]
        .as_array_mut()
        .unwrap()
        .push(json!({"enabled":false,"type":"proxy"}));
    assert!(selected(&config, &target()).unwrap().is_some());
}

#[test]
fn ssh_local_route_rejects_remote_dynamic_and_unsafe_bind_configuration() {
    for forward in ["dynamic", "remote", "", "localForward"] {
        let mut config = modern();
        config["security"]["tunnelChain"][0]["sshTunnel"]["forwardType"] = forward.into();
        assert!(selected(&config, &target()).is_err());
    }
    for (key, value) in [
        ("localBindHost", json!("0.0.0.0")),
        ("localBindHost", json!("192.0.2.1")),
        ("localBindPort", json!(-1)),
        ("localBindPort", json!(65536)),
        ("tunnelProfileId", json!("profile")),
        ("nodeChainConfig", json!({})),
        ("sshChainingMethod", json!("native")),
    ] {
        let mut config = modern();
        config["security"]["tunnelChain"][0][key] = value;
        assert!(selected(&config, &target()).is_err(), "{key}");
    }
    assert!(selected(&json!({}), &target()).unwrap().is_none());
    assert!(selected(
        &json!({"security":{"sshTunnel":{"enabled":false}}}),
        &target()
    )
    .unwrap()
    .is_none());
}

#[tokio::test]
async fn ssh_route_dial_uses_only_attested_listener_and_postchecks_before_delivery() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = listener.local_addr().unwrap();
    let calls = AtomicUsize::new(0);
    let stream = dial_verified(|| {
        calls.fetch_add(1, Ordering::SeqCst);
        std::future::ready(Ok(endpoint))
    })
    .await
    .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let (mut accepted, _) = listener.accept().await.unwrap();
    let mut stream = stream;
    stream.write_all(b"fixture").await.unwrap();
    let mut bytes = [0; 7];
    accepted.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"fixture");
    let calls = AtomicUsize::new(0);
    assert!(dial_verified(|| {
        let check = calls.fetch_add(1, Ordering::SeqCst);
        std::future::ready(if check == 0 {
            Ok(endpoint)
        } else {
            Err(route_error())
        })
    })
    .await
    .is_err());
    let (mut accepted, _) = listener.accept().await.unwrap();
    assert_eq!(accepted.read(&mut [0u8; 1]).await.unwrap(), 0);
    assert!(dial_verified(|| std::future::ready(Err(route_error())))
        .await
        .is_err());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), listener.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn ssh_source_and_selected_vault_are_bound_to_the_encrypted_owner_lease() {
    use crate::origin_browser_authority::tests::{connection, Fixture};
    use secrecy::ExposeSecret;
    let website = connection();
    let vault_id = "550e8400-e29b-41d4-a716-446655440000";
    let ssh = json!({"id":"saved-ssh","protocol":"ssh","hostname":"ssh.example.test",
        "port":22,"username":"local-fallback","password":"local-fallback",
        "credentialSource":{"kind":"vault","credentialId":vault_id}});
    let mut data = json!({"connections":[website.clone(),ssh],"settings":{},
        "credentialVault":{"version":1,"revision":1,"entries":[{"id":vault_id,
            "facets":{"username":"selected-account","password":"selected-fixture"}}]}});
    let mut f = Fixture::new(website.clone()).await;
    f.replace_totp_fixture_data(&data);
    let authorized = f.authorize().await.unwrap();
    let spec = json!({"connectionId":"saved-ssh","ownerDatabaseId":"db","forwardType":"local"});
    let config = super::super::ssh_config::resolve(
        &f.window,
        &f.state,
        &authorized.lease,
        &website,
        &spec,
        &Value::Null,
    )
    .await
    .unwrap();
    assert_eq!(config.username, "selected-account");
    assert_eq!(
        config.password.as_ref().unwrap().expose_secret(),
        "selected-fixture"
    );
    assert!(authorized.lease.recheck(&f.window, &f.state).await.is_ok());
    data["credentialVault"]["entries"][0]["facets"]["password"] = "changed".into();
    f.replace_totp_fixture_data(&data);
    assert!(authorized.lease.recheck(&f.window, &f.state).await.is_err());
    assert!(!authorized.lease.is_current());
}

#[tokio::test]
async fn ssh_editor_jump_resolves_its_saved_source_and_refuses_real_nested_hops() {
    use crate::origin_browser_authority::tests::{connection, Fixture};
    let website = connection();
    let mut f = Fixture::new(website.clone()).await;
    f.replace_totp_fixture_data(&json!({"connections":[website.clone(),{
        "id":"saved-ssh","protocol":"ssh","hostname":"saved-bastion.example.test",
        "port":22,"username":"saved-operator","password":"fixture"}],"settings":{}}));
    let authorized = f.authorize().await.unwrap();
    let mut editor = editor_ssh_jump();
    let standalone = selected(&editor, &target()).unwrap().unwrap();
    let config = super::super::ssh_config::resolve(
        &f.window,
        &f.state,
        &authorized.lease,
        &website,
        &standalone.ssh,
        &Value::Null,
    )
    .await
    .unwrap();
    assert_eq!(config.host, "bastion.example.test");
    assert!(config.jump_hosts.is_empty());
    assert!(config.proxy_command.is_none());
    editor["security"]["tunnelChain"][0]["sshTunnel"] = json!({
        "connectionId":"saved-ssh","ownerDatabaseId":"db","forwardType":"local"});
    let linked = selected(&editor, &target()).unwrap().unwrap();
    let config = super::super::ssh_config::resolve(
        &f.window,
        &f.state,
        &authorized.lease,
        &website,
        &linked.ssh,
        &Value::Null,
    )
    .await
    .unwrap();
    assert_eq!(config.host, "saved-bastion.example.test");
    assert_eq!(config.username, "saved-operator");
    for extra in [
        json!({"jumpHosts":[{"host":"another-hop.example.test"}]}),
        json!({"proxyCommand":{"command":"nc %h %p"}}),
        json!({"jumpTargetHost":"different.example.test"}),
    ] {
        let mut spec = linked.ssh.clone();
        for (key, value) in extra.as_object().unwrap() {
            spec[key] = value.clone();
        }
        assert!(super::super::ssh_config::resolve(
            &f.window,
            &f.state,
            &authorized.lease,
            &website,
            &spec,
            &Value::Null,
        )
        .await
        .is_err());
    }
}

#[tokio::test]
async fn ssh_reference_missing_foreign_or_changed_source_never_uses_inline_fallback() {
    use crate::origin_browser_authority::tests::{connection, Fixture};
    let website = connection();
    for spec in [
        json!({"connectionId":"absent","forwardType":"local"}),
        json!({"connectionId":"saved-ssh","ownerDatabaseId":"other","forwardType":"local"}),
        json!({"connectionId":"","host":"inline.example","username":"inline","password":"fixture","forwardType":"local"}),
    ] {
        let f = Fixture::new(website.clone()).await;
        let authorized = f.authorize().await.unwrap();
        assert!(super::super::ssh_config::resolve(
            &f.window,
            &f.state,
            &authorized.lease,
            &website,
            &spec,
            &Value::Null,
        )
        .await
        .is_err());
    }
    let mut f = Fixture::new(website.clone()).await;
    let mut data = json!({"connections":[website.clone(),{"id":"saved-ssh","protocol":"ssh",
        "hostname":"ssh.example.test","port":22,"username":"fixture","password":"fixture"}],"settings":{}});
    f.replace_totp_fixture_data(&data);
    let authorized = f.authorize().await.unwrap();
    let spec = json!({"connectionId":"saved-ssh","forwardType":"local"});
    super::super::ssh_config::resolve(
        &f.window,
        &f.state,
        &authorized.lease,
        &website,
        &spec,
        &Value::Null,
    )
    .await
    .unwrap();
    data["connections"][1]["hostname"] = "different.example.test".into();
    f.replace_totp_fixture_data(&data);
    assert!(authorized.lease.recheck(&f.window, &f.state).await.is_err());
}

#[tokio::test]
async fn ssh_cleanup_revocation_preempts_retained_owner_and_thread_drop_is_supported() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let current = Arc::new(AtomicBool::new(true));
    let observed = current.clone();
    let (retained_owner, released) = tokio::sync::oneshot::channel();
    let mut cleanup = tokio::spawn(async move {
        wait_for_actor_release(released, || observed.load(Ordering::SeqCst)).await;
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut cleanup)
            .await
            .is_err()
    );
    current.store(false, Ordering::SeqCst);
    tokio::time::timeout(Duration::from_secs(1), cleanup)
        .await
        .unwrap()
        .unwrap();
    // The retained route sender never had to drop for revocation cleanup.
    assert!(retained_owner.is_closed());
    let (owner, released) = tokio::sync::oneshot::channel();
    let cleanup = tokio::spawn(async move {
        wait_for_actor_release(released, || true).await;
    });
    std::thread::spawn(move || drop(owner)).join().unwrap();
    tokio::time::timeout(Duration::from_secs(1), cleanup)
        .await
        .unwrap()
        .unwrap();
}
