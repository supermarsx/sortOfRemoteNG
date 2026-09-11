//! Opt-in fixture driven only by scripts/test-vault-ssh-inline.mjs.
#![cfg(feature = "docker-e2e")]
use secrecy::SecretString;
use sorng_ssh::ssh::service::{connect_ssh_on_state, disconnect_ssh_on_state, SshService};
#[path = "common/ssh_config.rs"]
mod fixture;
use fixture::test_config;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "run node scripts/test-vault-ssh-inline.mjs for isolated loopback fixture"]
async fn vault_inline_key_and_partial_authentication_require_all_factors() {
    let state = SshService::new();
    let mut config = test_config();
    config.password = None;
    config.allow_agent_auth = false;
    config.private_key_content = Some(SecretString::from(
        std::env::var("SSH_INLINE_KEY").expect("fixture key"),
    ));
    config.private_key_passphrase = Some(SecretString::from(
        std::env::var("SSH_KEY_PASSPHRASE").expect("fixture passphrase"),
    ));
    let connected = connect_ssh_on_state(&state, config.clone())
        .await
        .expect("in-memory encrypted key authentication");
    let output = state
        .lock()
        .await
        .execute_command(&connected, "echo vault-inline-key".into(), Some(10_000))
        .await
        .expect("authenticated channel");
    assert!(output.contains("vault-inline-key"));
    disconnect_ssh_on_state(&state, &connected)
        .await
        .expect("release key session");
    let mut bad = config.clone();
    bad.private_key_content = Some(SecretString::from(
        std::env::var("SSH_BAD_INLINE_KEY").expect("fixture bad key"),
    ));
    bad.private_key_passphrase = None;
    assert!(
        connect_ssh_on_state(&state, bad).await.is_err(),
        "unknown key must not fall back to agent or local password"
    );
    config.port = std::env::var("SSH_MULTI_PORT")
        .expect("multifactor port")
        .parse()
        .unwrap();
    assert!(
        connect_ssh_on_state(&state, config.clone()).await.is_err(),
        "key partial authentication must not mark a session connected"
    );
    config.password = Some(SecretString::from(
        std::env::var("SSH_PASSWORD").expect("fixture second factor"),
    ));
    let connected = connect_ssh_on_state(&state, config)
        .await
        .expect("both key and password factors");
    disconnect_ssh_on_state(&state, &connected)
        .await
        .expect("release multifactor session");
    assert!(state.lock().await.sessions.is_empty());
}
