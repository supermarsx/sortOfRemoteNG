use super::*;
const ALIAS: &str = "https://example.quickconnect.to/";
const NAS: &str = "https://example.fr3.quickconnect.to/";

fn opted_config() -> BasicAuthProxyConfig {
    let mut value = config(ALIAS);
    value.upstream_auth_mode = UpstreamAuthMode::SynologyForm;
    value.http_auto_login = true;
    value.username = "synthetic-user".into();
    value.password = "synthetic-password".into();
    value
}

fn probe(target: &str) -> Url {
    Url::parse(target)
        .unwrap()
        .join("webman/pingpong.cgi?action=cors&quickconnect=true")
        .unwrap()
}

#[test]
fn native_capture_scrubs_original_and_successor_http_config_without_changing_transport() {
    let mut registry = AttemptRegistry::default();
    let mut original = opted_config();
    let source = start(&mut registry, &original, "source");
    let policy = original.proxy_policy.clone();
    let proxy = original.upstream_proxy_url.clone();
    source.strip_deferred_login_config(&mut original);
    assert!(original.username.is_empty() && original.password.is_empty());
    assert!(!original.http_auto_login);
    assert_eq!(original.upstream_auth_mode, UpstreamAuthMode::None);
    assert_eq!(
        serde_json::to_value(&original.proxy_policy).unwrap(),
        serde_json::to_value(policy).unwrap()
    );
    assert_eq!(original.upstream_proxy_url, proxy);
    assert!(source.uses_deferred_synology_login());
    source.record_deferred_login_probe("example", &probe(NAS));
    let target = transfer(&mut registry, &source, NAS, "nas");
    target.bind_deferred_login_document(&Url::parse(NAS).unwrap(), 1);
    assert_eq!(target.deferred_login_document(), Some(1));
    assert!(source.deferred_login_document().is_none());
}

#[test]
fn wrong_nas_provider_origins_and_unverified_tls_never_bind_saved_login() {
    for candidate in [
        "https://other.fr3.quickconnect.to/",
        "https://global.quickconnect.to/",
        "http://example.fr3.quickconnect.to/",
        "https://example.fr3.quickconnect.to:5001/",
    ] {
        let mut registry = AttemptRegistry::default();
        let source = start(&mut registry, &opted_config(), "source");
        source.record_deferred_login_probe("example", &probe(candidate));
        source.record_deferred_login_probe("wrong-alias", &probe(NAS));
        let target = transfer(&mut registry, &source, NAS, "nas");
        target.bind_deferred_login_document(&Url::parse(NAS).unwrap(), 1);
        assert!(target.deferred_login_document().is_none());
    }
    let mut registry = AttemptRegistry::default();
    let source = start(&mut registry, &opted_config(), "source");
    source.record_deferred_login_probe("example", &probe(NAS));
    let mut next = config(NAS);
    next.verify_ssl = false;
    let ticket = registry
        .prepare_transfer(&source, &Url::parse(NAS).unwrap(), "receipt")
        .unwrap();
    registry.stop(&source, Some(&ticket)).unwrap();
    next.continuation_id = Some(ticket);
    let target = start(&mut registry, &next, "nas");
    target.bind_deferred_login_document(&Url::parse(NAS).unwrap(), 1);
    assert!(target.deferred_login_document().is_none());
}

#[test]
fn restart_and_ordinary_stop_revoke_even_unspent_intent_and_preserve_closed_mode() {
    for restart in [false, true] {
        let mut registry = AttemptRegistry::default();
        let source = start(&mut registry, &opted_config(), "source");
        source.record_deferred_login_probe("example", &probe(NAS));
        let next = if restart {
            registry.restart(&source, "restarted").unwrap()
        } else {
            registry.stop(&source, None).unwrap();
            source.clone()
        };
        assert!(next.uses_deferred_synology_login());
        assert!(next.attempt.state.lock().unwrap().deferred_login.is_none());
        let mut config = opted_config();
        next.strip_deferred_login_config(&mut config);
        assert!(
            !config.http_auto_login && config.username.is_empty() && config.password.is_empty()
        );
    }
}

#[test]
fn first_bound_sequence_cannot_be_rearmed_by_another_receipt() {
    let mut registry = AttemptRegistry::default();
    let source = start(&mut registry, &opted_config(), "source");
    source.record_deferred_login_probe("example", &probe(NAS));
    let nas = transfer(&mut registry, &source, NAS, "nas");
    nas.bind_deferred_login_document(&Url::parse(NAS).unwrap(), 1);
    assert_eq!(nas.deferred_login_document(), Some(1));
    let alias = transfer(&mut registry, &nas, ALIAS, "alias-again");
    alias.record_deferred_login_probe("example", &probe(NAS));
    let again = transfer(&mut registry, &alias, NAS, "nas-again");
    again.bind_deferred_login_document(&Url::parse(NAS).unwrap(), 1);
    assert!(again.deferred_login_document().is_none());
}

#[tokio::test]
async fn native_expiry_timer_clears_idle_credentials_without_another_read() {
    let mut registry = AttemptRegistry::default();
    let source = start(&mut registry, &opted_config(), "source");
    // The intent is aged through its private state seam; the timer, not any
    // accessor, must perform the actual erase. No 120-second test sleep.
    source
        .attempt
        .state
        .lock()
        .unwrap()
        .deferred_login
        .as_mut()
        .unwrap()
        .age_for_test();
    source.expire_login_after(Duration::from_millis(1));
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if source
                .attempt
                .state
                .lock()
                .unwrap()
                .deferred_login
                .as_ref()
                .unwrap()
                .spent_for_test()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
}
