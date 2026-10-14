use super::tests::{connection, Fixture};
use super::*;
use serde_json::json;

const PORTAL: &str = "https://cliente-empresas.meo.pt";
const IDENTITY: &str = "https://login.telecom.pt";
const IDENTITY_PATH: &str = "/AuthorizeService/authorize.aspx";

struct Consent(bool);
impl NativeLoginConsentVerifier for Consent {
    fn with_current_consent(
        &self,
        _: &BrowserIdentity,
        _: &str,
        _: Option<&str>,
        deliver: &mut dyn FnMut(Instant, bool),
    ) {
        if self.0 {
            deliver(Instant::now() + Duration::from_secs(20), true);
        }
    }
}

fn empresas() -> Value {
    let mut row = connection();
    row["hostname"] = "https://cliente-empresas.meo.pt/Pages/Dashboard/Dashboard.aspx".into();
    row["httpApplication"] = json!({"version":1,"id":"meo-empresas","loginMode":"manual"});
    row
}

fn meo(id: &str) -> Value {
    let mut row = empresas();
    row["httpApplication"] = json!({"version":1,"id":id,"loginMode":"form"});
    if id == "meo-particulares" {
        row["hostname"] = "https://my.meo.pt/".into();
    }
    row["credentialSource"] = json!({"kind":"local"});
    row
}

#[tokio::test]
async fn meo_reviewed_identity_steps_bind_local_credentials_to_main_document_and_consent() {
    for id in ["meo-particulares", "meo-empresas"] {
        let row = meo(id);
        let initial = saved_source(&row).unwrap().to_string();
        let mut f = Fixture::new(row).await;
        f.request.initial_url = initial;
        let authorized = f.authorize().await.unwrap();
        assert!(authorized.login.declarative(), "{id}");
        assert_eq!(authorized.login.consent_origins(), &[IDENTITY]);
        for stage in ["form", "form-submit"] {
            assert!(authorized.login.declarative_permits(
                IDENTITY,
                stage,
                Some(IDENTITY_PATH),
                None
            ));
            for (origin, path, frame) in [
                (PORTAL, Some(IDENTITY_PATH), None),
                ("https://my.meo.pt", Some(IDENTITY_PATH), None),
                ("https://id.services.telecom.pt", Some("/oic"), None),
                (
                    "https://login.telecom.pt.attacker.test",
                    Some(IDENTITY_PATH),
                    None,
                ),
                ("https://newassets.hcaptcha.com", Some(IDENTITY_PATH), None),
                ("https://services.telecom.pt", Some(IDENTITY_PATH), None),
                (IDENTITY, Some("/AuthorizeService/Login"), None),
                (IDENTITY, Some("/AuthorizeService/recovery.aspx"), None),
                (IDENTITY, None, None),
                (IDENTITY, Some(IDENTITY_PATH), Some("challenge")),
            ] {
                assert!(
                    !authorized
                        .login
                        .declarative_permits(origin, stage, path, frame),
                    "{id} {stage}"
                );
            }
        }
        for stage in ["identifier", "password", "totp", "totp-submit", "unknown"] {
            assert!(!authorized.login.declarative_permits(
                IDENTITY,
                stage,
                Some(IDENTITY_PATH),
                None
            ));
        }
        assert!(authorized.login.totp.is_none());
        let request = NativeLoginRequest {
            identity: authorized.policy.identity(),
            origin: IDENTITY,
        };
        authorized
            .login
            .with_credentials(&request, &Consent(false), &mut |_| {
                panic!("denied consent released credentials")
            });
        let mut calls = 0;
        authorized
            .login
            .with_credentials(&request, &Consent(true), &mut |credentials| {
                assert_eq!(credentials.username, "test-user");
                assert_eq!(credentials.password, "fixture-secret");
                assert!(!credentials.auto_submit);
                calls += 1;
            });
        assert_eq!(calls, 1);
        for origin in [
            PORTAL,
            "https://my.meo.pt",
            "https://services.telecom.pt",
            "https://id.services.telecom.pt",
            "https://js.hcaptcha.com",
            "https://newassets.hcaptcha.com",
        ] {
            authorized.login.with_credentials(
                &NativeLoginRequest {
                    identity: authorized.policy.identity(),
                    origin,
                },
                &Consent(true),
                &mut |_| panic!("network-only origin received identity credentials"),
            );
        }
        let mut submit_row = meo(id);
        submit_row["browserSession"] = json!({"version":1,"manualFormSubmit":false});
        let initial = saved_source(&submit_row).unwrap().to_string();
        let mut submit_f = Fixture::new(submit_row).await;
        submit_f.request.initial_url = initial;
        let submitted = submit_f.authorize().await.unwrap();
        let mut submits = 0;
        submitted.login.with_credentials(
            &NativeLoginRequest {
                identity: submitted.policy.identity(),
                origin: IDENTITY,
            },
            &Consent(true),
            &mut |credentials| {
                assert!(credentials.auto_submit);
                submits += 1;
            },
        );
        assert_eq!(submits, 1);
    }
}

#[tokio::test]
async fn meo_selected_vault_has_no_inline_fallback_and_manual_mode_has_no_credential_authority() {
    const VAULT: &str = "01234567-89ab-4cde-8fab-0123456789ab";
    for id in ["meo-particulares", "meo-empresas"] {
        let mut row = meo(id);
        row["credentialSource"] = json!({"kind":"vault","credentialId":VAULT});
        row["basicAuthUsername"] = "ignored-inline".into();
        row["basicAuthPassword"] = "ignored-inline".into();
        let initial = saved_source(&row).unwrap().to_string();
        let mut f = Fixture::new(row.clone()).await;
        f.request.initial_url = initial.clone();
        let data = json!({"connections":[row.clone()],"settings":{},"credentialVault":{"version":1,"revision":1,"entries":[{"id":VAULT,"facets":{"username":"selected@example.test","password":"selected-fixture"}}]}});
        f.replace_totp_fixture_data(&data);
        let authorized = f.authorize().await.unwrap();
        let mut calls = 0;
        authorized.login.with_credentials(
            &NativeLoginRequest {
                identity: authorized.policy.identity(),
                origin: IDENTITY,
            },
            &Consent(true),
            &mut |credentials| {
                assert_eq!(credentials.username, "selected@example.test");
                assert_eq!(credentials.password, "selected-fixture");
                calls += 1;
            },
        );
        assert_eq!(calls, 1);
        let missing_data = json!({"connections":[row.clone()],"settings":{},"credentialVault":{"version":1,"revision":1,"entries":[]}});
        f.replace_totp_fixture_data(&missing_data);
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::CredentialUnavailable)
        ));
        row["httpApplication"]["loginMode"] = "manual".into();
        let mut manual_f = Fixture::new(row).await;
        manual_f.request.initial_url = initial;
        let manual = manual_f.authorize().await.unwrap();
        assert!(!manual.login.enabled());
        assert!(!manual.login.declarative());
        assert!(manual.login.consent_origins().is_empty());
    }
}

#[test]
fn meo_empresas_network_defaults_require_the_exact_published_profile_source() {
    let mut row = empresas();
    assert!(!meo_defaults::grants(&row, PORTAL).is_empty());
    for source in [
        "https://my.meo.pt",
        "http://cliente-empresas.meo.pt",
        "https://cliente-empresas.meo.pt:8443",
        "https://cliente-empresas.meo.pt.attacker.test",
    ] {
        assert!(meo_defaults::grants(&row, source).is_empty());
    }
    row["httpApplication"]["id"] = "meo-particulares".into();
    assert!(meo_defaults::grants(&row, PORTAL).is_empty());
    row["httpApplication"]["id"] = "meo-empresas".into();
    row["httpApplication"]["invalid"] = true.into();
    assert!(meo_defaults::grants(&row, PORTAL).is_empty());
}

#[test]
fn meo_consumer_api_default_is_network_only_and_bound_to_the_consumer_portal() {
    const CONSUMER: &str = "https://my.meo.pt";
    const API: &str = "https://services.telecom.pt";
    let row = meo("meo-particulares");
    let (engine, allowed) =
        saved_permissions(&row, &Value::Null, &Url::parse(CONSUMER).unwrap()).unwrap();
    assert_eq!(
        engine
            .resolve(WebsitePermissionQuery {
                website_origin: CONSUMER,
                destination_origin: API,
                request_class: "fetch-xhr",
                native_denied: false
            })
            .decision,
        WebsitePermissionDecision::Allow
    );
    // This is the finite network origin scope, not credential consent.
    assert!(allowed.iter().any(|origin| origin == API));
    for class in ["navigation", "frame", "script", "worker", "websocket"] {
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: CONSUMER,
                    destination_origin: API,
                    request_class: class,
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Deny
        );
    }
    assert!(meo_defaults::grants(&row, PORTAL).is_empty());
    assert!(!meo_defaults::grants(&empresas(), PORTAL)
        .iter()
        .any(|(origin, _)| *origin == API));
}

#[test]
fn meo_hcaptcha_vendor_resources_allow_varying_https_hosts_without_navigation_or_credentials() {
    for (id, source) in [
        ("meo-particulares", "https://my.meo.pt"),
        ("meo-empresas", PORTAL),
    ] {
        let row = meo(id);
        let (engine, finite) =
            saved_permissions(&row, &Value::Null, &Url::parse(source).unwrap()).unwrap();
        for destination in [
            "https://hcaptcha.com",
            "https://newassets.hcaptcha.com",
            "https://varying-region.w.hcaptcha.com",
        ] {
            assert!(!finite.iter().any(|origin| origin == destination));
            for class in ["script", "stylesheet", "frame", "fetch-xhr", "image-media"] {
                assert_eq!(
                    engine
                        .resolve(WebsitePermissionQuery {
                            website_origin: source,
                            destination_origin: destination,
                            request_class: class,
                            native_denied: false
                        })
                        .decision,
                    WebsitePermissionDecision::Allow
                );
                assert_eq!(
                    engine
                        .resolve(WebsitePermissionQuery {
                            website_origin: source,
                            destination_origin: destination,
                            request_class: class,
                            native_denied: true
                        })
                        .decision,
                    WebsitePermissionDecision::Deny
                );
            }
            for class in ["navigation", "font", "worker", "websocket"] {
                assert_eq!(
                    engine
                        .resolve(WebsitePermissionQuery {
                            website_origin: source,
                            destination_origin: destination,
                            request_class: class,
                            native_denied: false
                        })
                        .decision,
                    WebsitePermissionDecision::Deny
                );
            }
        }
        for destination in [
            "http://newassets.hcaptcha.com",
            "https://newassets.hcaptcha.com:8443",
            "https://newassets.hcaptcha.com.evil.test",
            "https://nothcaptcha.com",
        ] {
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        website_origin: source,
                        destination_origin: destination,
                        request_class: "frame",
                        native_denied: false
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
        }
        let mut denied = row.clone();
        denied["websiteDomainPermissions"] = json!({"version":1,"websites":[{"origin":source,"requestClasses":{},"destinations":[{"origin":"https://newassets.hcaptcha.com","requestClasses":{"frame":"deny"}}]}]});
        let (engine, _) =
            saved_permissions(&denied, &Value::Null, &Url::parse(source).unwrap()).unwrap();
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: source,
                    destination_origin: "https://newassets.hcaptcha.com",
                    request_class: "frame",
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Deny
        );
        denied = row;
        denied["httpProxyPolicy"] = json!({"version":1,"sameOriginOnly":true});
        let (engine, _) =
            saved_permissions(&denied, &Value::Null, &Url::parse(source).unwrap()).unwrap();
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: source,
                    destination_origin: "https://newassets.hcaptcha.com",
                    request_class: "frame",
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Deny
        );
    }
}

#[test]
fn meo_empresas_reviewed_handoff_defaults_do_not_authorize_unknown_documents_or_frames() {
    let row = empresas();
    let (engine, allowed) =
        saved_permissions(&row, &Value::Null, &Url::parse(PORTAL).unwrap()).unwrap();
    for (destination, class) in [
        ("https://id.services.telecom.pt", "navigation"),
        (IDENTITY, "navigation"),
        (IDENTITY, "fetch-xhr"),
        ("https://js.hcaptcha.com", "script"),
        ("https://newassets.hcaptcha.com", "frame"),
        ("https://image1d4f630c560a.w.hcaptcha.com", "image-media"),
    ] {
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: PORTAL,
                    destination_origin: destination,
                    request_class: class,
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Allow
        );
    }
    assert!(allowed.iter().any(|origin| origin == IDENTITY));
    for (destination, class) in [
        ("https://id.services.telecom.pt", "frame"),
        (IDENTITY, "frame"),
        (IDENTITY, "worker"),
        ("https://js.hcaptcha.com", "navigation"),
        ("https://newassets.hcaptcha.com", "navigation"),
        ("https://newassets.hcaptcha.com", "worker"),
        ("https://image1d4f630c560a.w.hcaptcha.com", "navigation"),
        ("https://unreviewed.w.hcaptcha.com.evil.test", "image-media"),
        ("https://accounts.google.com", "navigation"),
        ("https://login.telecom.pt.attacker.test", "navigation"),
    ] {
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: PORTAL,
                    destination_origin: destination,
                    request_class: class,
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Deny
        );
    }
}

#[test]
fn meo_empresas_reviewed_network_defaults_preserve_explicit_denies_and_same_origin_only() {
    for shared in [false, true] {
        for class in [false, true] {
            let mut row = empresas();
            let permissions = json!({"version":1,"websites":[{"origin":PORTAL,
                "requestClasses":if class { json!({"navigation":"deny"}) } else { json!({}) },
                "destinations":if class { json!([{"origin":PORTAL,"requestClasses":{"navigation":"allow"}}]) } else { json!([{"origin":IDENTITY,"requestClasses":{"navigation":"deny"}}]) }
            }]});
            let settings = if shared {
                json!({"webBrowser":{"domainPermissions":permissions}})
            } else {
                row["websiteDomainPermissions"] = permissions;
                Value::Null
            };
            let (engine, _) =
                saved_permissions(&row, &settings, &Url::parse(PORTAL).unwrap()).unwrap();
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        website_origin: PORTAL,
                        destination_origin: IDENTITY,
                        request_class: "navigation",
                        native_denied: false
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
        }
    }
    let mut row = empresas();
    row["httpProxyPolicy"] = json!({"version":1,"sameOriginOnly":true});
    let (engine, _) = saved_permissions(&row, &Value::Null, &Url::parse(PORTAL).unwrap()).unwrap();
    assert_eq!(
        engine
            .resolve(WebsitePermissionQuery {
                website_origin: PORTAL,
                destination_origin: IDENTITY,
                request_class: "navigation",
                native_denied: false
            })
            .decision,
        WebsitePermissionDecision::Deny
    );
}
