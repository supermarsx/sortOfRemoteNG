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
    // Only generated public keys are installed on this isolated fixture account.
    // Private keys remain in memory; no ssh-agent or local-file authentication.
    let ec_public = std::env::var("SSH_EC_PUBLIC_KEY").expect("fixture EC public key");
    let mut extra = Vec::new();
    let mut algorithms = vec![
        ssh_key::Algorithm::Ed25519,
        ssh_key::Algorithm::Rsa { hash: None },
    ];
    if cfg!(windows) {
        algorithms.extend([
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP256,
            },
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP384,
            },
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP521,
            },
        ]);
    }
    for algorithm in algorithms {
        let key = ssh_key::PrivateKey::random(&mut ssh_key::rand_core::OsRng, algorithm)
            .expect("fixture key generation");
        let public = key.public_key().to_openssh().unwrap();
        let encrypted = key
            .encrypt(&mut ssh_key::rand_core::OsRng, "fixture-openssh-passphrase")
            .unwrap()
            .to_openssh(ssh_key::LineEnding::LF)
            .unwrap();
        extra.push((public, encrypted));
    }
    for public in
        std::iter::once(ec_public.as_str()).chain(extra.iter().map(|(public, _)| public.as_str()))
    {
        assert!(public
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b" +/=-@.".contains(&b)));
        state
            .lock()
            .await
            .execute_command(
                &connected,
                format!("printf '\\n%s\\n' '{public}' >> ~/.ssh/authorized_keys"),
                Some(10_000),
            )
            .await
            .expect("fixture public key enrollment");
    }
    disconnect_ssh_on_state(&state, &connected)
        .await
        .expect("release key session");
    let mut wrong_passphrases = Vec::new();
    for variable in [
        "SSH_LEGACY_RSA_KEY",
        "SSH_LEGACY_RSA_3DES_KEY",
        "SSH_EC_INLINE_KEY",
        "SSH_EC_PKCS8_KEY",
    ] {
        let mut variant = config.clone();
        variant.private_key_content = Some(SecretString::from(
            std::env::var(variable).expect("fixture variant"),
        ));
        let accepted = connect_ssh_on_state(&state, variant.clone())
            .await
            .expect("encrypted PEM variant authentication");
        disconnect_ssh_on_state(&state, &accepted).await.unwrap();
        variant.private_key_passphrase = Some(SecretString::from("wrong-fixture-passphrase"));
        wrong_passphrases.push(variant);
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    for (public, key) in extra {
        let mut variant = config.clone();
        variant.private_key_content = Some(SecretString::from(key.to_string()));
        variant.private_key_passphrase = Some(SecretString::from("fixture-openssh-passphrase"));
        let accepted = connect_ssh_on_state(&state, variant)
            .await
            .unwrap_or_else(|error| {
                panic!(
                    "encrypted OpenSSH {} authentication: {error}",
                    public.split_whitespace().next().unwrap()
                )
            });
        disconnect_ssh_on_state(&state, &accepted).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    for variant in wrong_passphrases {
        let error = connect_ssh_on_state(&state, variant)
            .await
            .expect_err("wrong passphrase must not authenticate");
        assert_eq!(
            error, "All authentication methods failed",
            "transport failures are not credential rejection evidence"
        );
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    let mut bad = config.clone();
    bad.private_key_content = Some(SecretString::from(
        std::env::var("SSH_BAD_INLINE_KEY").expect("fixture bad key"),
    ));
    bad.private_key_passphrase = None;
    assert_eq!(
        connect_ssh_on_state(&state, bad)
            .await
            .expect_err("unknown key must not fall back to agent or local password"),
        "All authentication methods failed"
    );
    config.port = std::env::var("SSH_MULTI_PORT")
        .expect("multifactor port")
        .parse()
        .unwrap();
    assert_eq!(
        connect_ssh_on_state(&state, config.clone())
            .await
            .expect_err("key partial authentication must not mark a session connected"),
        "All authentication methods failed"
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
