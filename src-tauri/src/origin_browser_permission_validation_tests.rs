use super::*;
use serde_json::json;

fn source() -> Url {
    Url::parse("https://source.example/").unwrap()
}

fn connection() -> Value {
    json!({"httpsTrustPolicy":"strict"})
}

fn rejected(connection: &Value, settings: &Value) -> NativeAuthorityError {
    saved_permissions_inner(connection, settings, &source(), true)
        .err()
        .expect("policy must be rejected")
}

fn diagnostic(scope: &'static str, rule: &'static str) -> NativeAuthorityError {
    NativeAuthorityError::PolicyInvalid { scope, rule }
}

#[test]
fn legacy_failures_report_exact_scope_field_and_constraint() {
    let cases = [
        (json!(null), "must be an object"),
        (json!({"version":2}), "version must be 1 when present"),
        (
            json!({"pageScripts":"block"}),
            "pageScripts must be allow when present",
        ),
        (
            json!({"allowAllRequests":"true"}),
            "allowAllRequests must be a boolean when present",
        ),
        (
            json!({"allowAllScripts":1}),
            "allowAllScripts must be a boolean when present",
        ),
        (
            json!({"httpsOnly":"false"}),
            "httpsOnly must be a boolean when present",
        ),
        (
            json!({"sameOriginOnly":null}),
            "sameOriginOnly must be a boolean when present",
        ),
        (
            json!({"queryParameters":[{"secret":"PRIVATE_MARKER"}]}),
            "queryParameters must be an empty array when present",
        ),
        (
            json!({"queryParameters":false}),
            "queryParameters must be an empty array when present",
        ),
    ];
    for (policy, rule) in cases {
        let mut own = connection();
        own["httpProxyPolicy"] = policy.clone();
        let error = rejected(&own, &Value::Null);
        assert_eq!(error, diagnostic("connection.httpProxyPolicy", rule));
        assert_eq!(
            error.to_string(),
            format!("Saved browser policy rejected (connection.httpProxyPolicy): {rule}")
        );
        assert_eq!(
            rejected(
                &connection(),
                &json!({"webBrowser":{"defaultPolicy":policy}})
            ),
            diagnostic("settings.webBrowser.defaultPolicy", rule)
        );
    }
}

#[test]
fn source_and_tls_switch_have_separate_non_disclosing_diagnostics() {
    let error = saved_permissions_inner(
        &connection(),
        &Value::Null,
        &Url::parse("http://PRIVATE_MARKER.example/path").unwrap(),
        true,
    )
    .err()
    .unwrap();
    assert_eq!(error, diagnostic("source", "saved source must use HTTPS"));
    for value in [json!(false), json!(null), json!("PRIVATE_MARKER")] {
        let mut own = connection();
        own["httpVerifySsl"] = value;
        let error = rejected(&own, &Value::Null);
        assert_eq!(
            error,
            diagnostic("connection.httpVerifySsl", "must be true when present")
        );
        assert!(!format!("{error} {error:?}").contains("PRIVATE_MARKER"));
    }
    assert_eq!(
        rejected(&connection(), &json!({"webBrowser":null})),
        diagnostic("settings.webBrowser", "must be an object")
    );
}

#[test]
fn resource_font_and_redirect_rules_name_the_failed_setting() {
    for (policy, rule) in [
        (
            json!({"externalResourceOrigins":null}),
            "externalResourceOrigins must be an array",
        ),
        (
            json!({"externalResourceOrigins":vec![json!({});33]}),
            "externalResourceOrigins must contain at most 32 entries",
        ),
        (
            json!({"externalResourceOrigins":[{}]}),
            "externalResourceOrigins[].kinds must be an array",
        ),
        (
            json!({"externalResourceOrigins":[{"kinds":["PRIVATE_MARKER"]}]}),
            "externalResourceOrigins[].kinds[] must be script or stylesheet",
        ),
        (
            json!({"externalResourceOrigins":[{"kinds":[],"origin":"https://user:PRIVATE_MARKER@secret.example"}]}),
            "externalResourceOrigins[].origin must be an exact HTTPS origin",
        ),
        (
            json!({"externalFontOrigins":null}),
            "externalFontOrigins must be an array",
        ),
        (
            json!({"externalFontOrigins":vec![json!("https://font.example");17]}),
            "externalFontOrigins must contain at most 16 entries",
        ),
        (
            json!({"externalFontOrigins":["PRIVATE_MARKER"]}),
            "externalFontOrigins[] must be an exact HTTPS origin",
        ),
    ] {
        let mut own = connection();
        own["httpProxyPolicy"] = policy.clone();
        assert_eq!(
            rejected(&own, &Value::Null),
            diagnostic("connection.httpProxyPolicy", rule)
        );
        assert_eq!(
            rejected(
                &connection(),
                &json!({"webBrowser":{"defaultPolicy":policy}})
            ),
            diagnostic("settings.webBrowser.defaultPolicy", rule)
        );
    }
    for (redirects, rule) in [
        (json!(null), "version must be 1"),
        (json!({"version":1}), "origins must be an array"),
        (
            json!({"version":1,"origins":vec![json!(null);33]}),
            "origins must contain at most 32 entries",
        ),
        (
            json!({"version":1,"origins":["https://secret.example/PRIVATE_MARKER"]}),
            "origins[] must be an exact HTTPS origin",
        ),
    ] {
        let mut own = connection();
        own["httpTrustedRedirectDestinations"] = redirects;
        assert_eq!(
            rejected(&own, &Value::Null),
            diagnostic("connection.httpTrustedRedirectDestinations", rule)
        );
    }
}

#[test]
fn domain_schema_diagnostics_never_echo_unknown_keys_origins_or_values() {
    let mut cases = vec![
        (
            json!(null),
            "must match the domain permission object schema",
        ),
        (
            json!({"version":1,"websites":[],"PRIVATE_MARKER":true}),
            "domain permission object contains an unsupported field",
        ),
        (json!({"version":1.0,"websites":[]}), "version must be 1"),
        (json!({"version":1}), "websites must be an array"),
        (
            json!({"version":1,"websites":vec![json!({});65]}),
            "websites must contain at most 64 entries",
        ),
    ];
    for (website, rule) in [
        (json!(null), "websites[] must be an object"),
        (
            json!({"origin":"https://source.example","PRIVATE_MARKER":true}),
            "websites[] contains an unsupported field",
        ),
        (
            json!({"origin":"https://user:PRIVATE_MARKER@secret.example"}),
            "websites[].origin must be an exact HTTPS origin",
        ),
        (
            json!({"origin":"https://source.example","requestClasses":null}),
            "websites[].requestClasses must be an object",
        ),
        (
            json!({"origin":"https://source.example","requestClasses":{"PRIVATE_MARKER":"allow"}}),
            "websites[].requestClasses contains an unsupported request class",
        ),
        (
            json!({"origin":"https://source.example","requestClasses":{"script":"PRIVATE_MARKER"}}),
            "websites[].requestClasses decisions must be inherit, allow or deny",
        ),
        (
            json!({"origin":"https://source.example","destinations":null}),
            "websites[].destinations must be an array",
        ),
        (
            json!({"origin":"https://source.example","destinations":vec![json!({});33]}),
            "websites[].destinations must contain at most 32 entries",
        ),
    ] {
        cases.push((json!({"version":1,"websites":[website]}), rule));
    }
    for (destination, rule) in [
        (json!(null), "websites[].destinations[] must be an object"),
        (
            json!({"origin":"https://target.example","PRIVATE_MARKER":true}),
            "websites[].destinations[] contains an unsupported field",
        ),
        (
            json!({"origin":"https://target.example/PRIVATE_MARKER"}),
            "websites[].destinations[].origin must be an exact HTTPS origin",
        ),
        (
            json!({"origin":"https://target.example","requestClasses":null}),
            "websites[].destinations[].requestClasses must be an object",
        ),
        (
            json!({"origin":"https://target.example","requestClasses":{"PRIVATE_MARKER":"allow"}}),
            "websites[].destinations[].requestClasses contains an unsupported request class",
        ),
        (
            json!({"origin":"https://target.example","requestClasses":{"script":"PRIVATE_MARKER"}}),
            "websites[].destinations[].requestClasses decisions must be inherit, allow or deny",
        ),
    ] {
        cases.push((json!({"version":1,"websites":[{"origin":"https://source.example","destinations":[destination]}]}), rule));
    }
    for (policy, rule) in cases {
        for scope in [
            "settings.webBrowser.domainPermissions",
            "connection.websiteDomainPermissions",
        ] {
            let error = permission_settings(Some(&policy), scope).unwrap_err();
            assert_eq!(error, diagnostic(scope, rule));
            let text = format!("{error} {error:?}");
            for secret in [
                "PRIVATE_MARKER",
                "secret.example",
                "target.example",
                "source.example",
            ] {
                assert!(!text.contains(secret));
            }
        }
    }
}

#[test]
fn domain_duplicate_and_total_bounds_preserve_normalization_rules() {
    let scope = "connection.websiteDomainPermissions";
    let policy = json!({"version":1,"websites":[{"origin":"https://SOURCE.example:443/"},{"origin":"https://source.example"}]});
    assert_eq!(
        permission_settings(Some(&policy), scope).unwrap_err(),
        diagnostic(
            scope,
            "websites[].origin must be unique after canonicalization"
        )
    );
    let policy = json!({"version":1,"websites":[{"origin":"https://source.example","destinations":[{"origin":"https://TARGET.example:443/"},{"origin":"https://target.example"}]}]});
    assert_eq!(
        permission_settings(Some(&policy), scope).unwrap_err(),
        diagnostic(
            scope,
            "websites[].destinations[].origin must be unique after canonicalization"
        )
    );
    let websites: Vec<_> = (0..9).map(|i| json!({"origin":format!("https://site{i}.example"),
        "destinations":(0..32).map(|j|json!({"origin":format!("https://target{j}.example")})).collect::<Vec<_>>() })).collect();
    let policy = json!({"version":1,"websites":websites});
    assert_eq!(
        permission_settings(Some(&policy), scope).unwrap_err(),
        diagnostic(
            scope,
            "websites[].destinations must total at most 256 entries"
        )
    );
}

#[test]
fn initial_navigation_reports_the_winning_policy_layer_and_rule() {
    for shared in [false, true] {
        for destination in [false, true] {
            let mut row = json!({"origin":"https://source.example"});
            if destination {
                row["destinations"] = json!([{"origin":"https://source.example","requestClasses":{"navigation":"deny"}}]);
            } else {
                row["requestClasses"] = json!({"navigation":"deny"});
            }
            let policy = json!({"version":1,"websites":[row]});
            let mut own = connection();
            let mut settings = Value::Null;
            let scope = if shared {
                settings = json!({"webBrowser":{"domainPermissions":policy}});
                "settings.webBrowser.domainPermissions"
            } else {
                own["websiteDomainPermissions"] = policy;
                "connection.websiteDomainPermissions"
            };
            assert_eq!(
                rejected(&own, &settings),
                diagnostic(
                    scope,
                    if destination {
                        "websites[].destinations[].requestClasses.navigation denies initial navigation"
                    } else {
                        "websites[].requestClasses.navigation denies initial navigation"
                    }
                )
            );
        }
    }
}

#[test]
fn combined_destination_bound_is_distinct_from_individual_list_bounds() {
    let mut own = connection();
    own["httpProxyPolicy"] = json!({"externalResourceOrigins":[],"allowExternalFonts":false});
    own["httpTrustedRedirectDestinations"] = json!({"version":1,"origins":
        (0..32).map(|i|format!("https://target{i}.example")).collect::<Vec<_>>()});
    assert_eq!(
        rejected(&own, &Value::Null),
        diagnostic(
            "effective",
            "combined destinations must contain at most 32 entries"
        )
    );
    own["httpTrustedRedirectDestinations"]["origins"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(saved_permissions_inner(&own, &Value::Null, &source(), true).is_ok());
}

#[test]
fn supported_policies_keep_precedence_and_request_class_grants() {
    let mut own = connection();
    own["httpProxyPolicy"] = json!({"version":1,"httpsOnly":false,"sameOriginOnly":false,
        "pageScripts":"allow","allowAllRequests":false,"allowAllScripts":false,"queryParameters":[],
        "allowExternalFonts":false,"externalResourceOrigins":[{"origin":"HTTPS://cdn.example:443/","kinds":["script"]}]});
    let settings = json!({"webBrowser":{"defaultPolicy":{"pageScripts":"block"}}});
    let (engine, origins) = saved_permissions_inner(&own, &settings, &source(), true).unwrap();
    assert_eq!(origins, ["https://cdn.example", "https://source.example"]);
    for (class, _) in CLASSES {
        let result = engine.resolve(WebsitePermissionQuery {
            website_origin: "https://source.example",
            destination_origin: "https://cdn.example",
            request_class: CLASSES.iter().find(|(c, _)| *c == class).unwrap().1,
            native_denied: false,
        });
        assert_eq!(
            result.decision,
            if class == WebsiteRequestClass::Script {
                WebsitePermissionDecision::Allow
            } else {
                WebsitePermissionDecision::Deny
            }
        );
    }
    // Existing short-circuit behavior: same-origin mode skips these lists, and
    // disabled external fonts skip their list. Do not introduce new rejection.
    own["httpProxyPolicy"] =
        json!({"sameOriginOnly":true,"externalResourceOrigins":null,"externalFontOrigins":null});
    own["httpTrustedRedirectDestinations"] = json!(null);
    let (_, origins) = saved_permissions_inner(&own, &Value::Null, &source(), true).unwrap();
    assert_eq!(origins, ["https://source.example"]);
    assert!(
        permission_settings(None, "connection.websiteDomainPermissions")
            .unwrap()
            .is_none()
    );
}

#[test]
fn temporary_http_reports_only_its_existing_restrictions() {
    for (policy, rule) in [
        (json!(null), "must be an object"),
        (
            json!({"httpsOnly":true}),
            "httpsOnly must be false when present for temporary HTTP",
        ),
        (
            json!({"pageScripts":"block"}),
            "pageScripts must be allow when present",
        ),
    ] {
        assert_eq!(
            validate_temporary_http_policy(&policy).unwrap_err(),
            diagnostic("settings.webBrowser.defaultPolicy", rule)
        );
    }
    assert_eq!(validate_temporary_http_policy(
        &json!({"httpsOnly":false,"pageScripts":"allow","allowAllRequests":true})
    ).unwrap_err(), diagnostic("settings.webBrowser.defaultPolicy", "allowAllRequests is connection-only"));
}

#[test]
fn broad_flags_are_connection_only_and_keep_static_login_scope() {
    for (field, rule) in [("allowAllRequests", "allowAllRequests is connection-only"), ("allowAllScripts", "allowAllScripts is connection-only")] {
        let mut policy = json!({"externalResourceOrigins":[],"allowExternalFonts":false});
        policy[field] = true.into();
        let mut own = connection();
        own["httpProxyPolicy"] = policy.clone();
        let (engine, static_origins) = saved_permissions_inner(&own, &Value::Null, &source(), true).unwrap();
        assert_eq!(static_origins, ["https://source.example"]);
        assert!(engine.permits_network_origin("https://source.example", "https://new.example"));
        assert_eq!(rejected(&connection(), &json!({"webBrowser":{"defaultPolicy":policy}})), diagnostic("settings.webBrowser.defaultPolicy", rule));
        own["httpProxyPolicy"]["sameOriginOnly"] = true.into();
        let (engine, _) = saved_permissions_inner(&own, &Value::Null, &source(), true).unwrap();
        assert!(!engine.permits_network_origin("https://source.example", "https://new.example"));
    }
}

#[test]
fn dynamic_materialization_keeps_explicit_class_denies_and_https_constraints() {
    let mut own = connection();
    own["httpProxyPolicy"] = json!({"allowAllRequests":true,"externalResourceOrigins":[],"allowExternalFonts":false});
    let settings = json!({"webBrowser":{"domainPermissions":{"version":1,"websites":[{
        "origin":"https://source.example","requestClasses":{"script":"deny"},
        "destinations":[{"origin":"https://blocked.example","requestClasses":{"navigation":"deny"}}]
    }]}}});
    let (engine, _) = saved_permissions_inner(&own, &settings, &source(), true).unwrap();
    for (destination, class, expected) in [
        ("https://new.example", "script", WebsitePermissionDecision::Deny),
        ("https://new.example", "navigation", WebsitePermissionDecision::Allow),
        ("https://blocked.example", "navigation", WebsitePermissionDecision::Deny),
        ("http://new.example", "fetch-xhr", WebsitePermissionDecision::Allow),
        ("http://new.example", "navigation", WebsitePermissionDecision::Deny),
    ] {
        assert_eq!(engine.resolve(WebsitePermissionQuery { website_origin:"https://source.example",destination_origin:destination,request_class:class,native_denied:false }).decision, expected);
    }
    own["httpProxyPolicy"]["httpsOnly"] = true.into();
    let (engine, _) = saved_permissions_inner(&own, &settings, &source(), true).unwrap();
    assert!(!engine.permits_network_origin("https://source.example", "http://new.example"));
}

#[test]
fn capability_failures_identify_the_effective_field_and_scope() {
    use sorng_browser_host::native_capabilities::NativeBrowserCapabilities;
    assert!(validate_capabilities(&json!({}), NativeBrowserCapabilities::default()).is_ok());
    for (field, rule) in [
        (
            "databasesEnabled",
            "databasesEnabled=false is unsupported by the native browser",
        ),
        (
            "webglEnabled",
            "webglEnabled=false is unsupported by the native browser",
        ),
    ] {
        let capabilities = NativeBrowserCapabilities {
            databases_enabled: field != "databasesEnabled",
            webgl_enabled: field != "webglEnabled",
            ..Default::default()
        };
        assert_eq!(
            validate_capabilities(&json!({}), capabilities).unwrap_err(),
            diagnostic("settings.webBrowser", rule)
        );
        let mut own = json!({"browserSession":{}});
        own["browserSession"][field] = false.into();
        assert_eq!(
            validate_capabilities(&own, capabilities).unwrap_err(),
            diagnostic("connection.browserSession", rule)
        );
    }
}

#[test]
fn rejected_permission_preferences_identify_the_field_without_changing_acceptance() {
    for (field, rule) in [
        (
            "showBookmarksBar",
            "showBookmarksBar must be a boolean when present",
        ),
        (
            "showSecurityInfo",
            "showSecurityInfo must be a boolean when present",
        ),
        (
            "showLoadingProgress",
            "showLoadingProgress must be a boolean when present",
        ),
        (
            "localStorageEnabled",
            "localStorageEnabled must be a boolean when present",
        ),
        (
            "databasesEnabled",
            "databasesEnabled must be a boolean when present",
        ),
        (
            "webglEnabled",
            "webglEnabled must be a boolean when present",
        ),
        (
            "cookiesEnabled",
            "cookiesEnabled must be a boolean when present",
        ),
        (
            "mediaStreamEnabled",
            "mediaStreamEnabled must be a boolean when present",
        ),
        (
            "crossOriginRequestsEnabled",
            "crossOriginRequestsEnabled must be a boolean when present",
        ),
        (
            "websiteExtensionsEnabled",
            "websiteExtensionsEnabled must be a boolean when present",
        ),
        (
            "hideAutomationIndicator",
            "hideAutomationIndicator must be a boolean when present",
        ),
        (
            "manualFormSubmit",
            "manualFormSubmit must be a boolean when present",
        ),
    ] {
        for shared in [true, false] {
            let mut own = json!({"browserSession":{"version":1}});
            let mut settings = json!({"webBrowser":{}});
            let scope = if shared {
                settings["webBrowser"][field] = "PRIVATE_MARKER".into();
                "settings.webBrowser"
            } else {
                own["browserSession"][field] = "PRIVATE_MARKER".into();
                "connection.browserSession"
            };
            assert!(NativeBrowserPreferences::from_saved(&own, &settings).is_err());
            let error = preference_error(&own, &settings);
            assert_eq!(error, diagnostic(scope, rule));
            assert!(!format!("{error} {error:?}").contains("PRIVATE_MARKER"));
        }
    }
    for (settings, rule) in [
        (
            json!({"webBrowser":{"allowDownloads":"PRIVATE_MARKER"}}),
            "allowDownloads must be a boolean when present",
        ),
        (
            json!({"webBrowser":{"popupPolicy":"PRIVATE_MARKER"}}),
            "popupPolicy must be tabs or block when present",
        ),
        (
            json!({"webBrowser":{"version":2}}),
            "version must be 1 when present",
        ),
        (json!({"webBrowser":null}), "must be an object"),
    ] {
        assert!(NativeBrowserPreferences::from_saved(&json!({}), &settings).is_err());
        assert_eq!(
            preference_error(&json!({}), &settings),
            diagnostic("settings.webBrowser", rule)
        );
    }
    for (own, rule) in [
        (json!({"browserSession":null}), "must be an object"),
        (json!({"browserSession":{}}), "version must be 1"),
    ] {
        assert!(NativeBrowserPreferences::from_saved(&own, &Value::Null).is_err());
        assert_eq!(
            preference_error(&own, &Value::Null),
            diagnostic("connection.browserSession", rule)
        );
    }
}

#[test]
fn unknown_or_appearance_preference_failures_remain_unclassified() {
    for (own, settings) in [
        (json!({}), json!({"websiteDarkMode":"PRIVATE_MARKER"})),
        (
            json!({"httpAutomation":{"darkMode":"PRIVATE_MARKER"}}),
            json!({}),
        ),
        (
            json!({"browserSession":{"version":1,"PRIVATE_MARKER":true}}),
            json!({}),
        ),
    ] {
        assert!(NativeBrowserPreferences::from_saved(&own, &settings).is_err());
        assert_eq!(
            preference_error(&own, &settings),
            NativeAuthorityError::PreferencesInvalid
        );
    }
}

fn preference_documents(shared: bool, field: &str, value: Value) -> (Value, Value, &'static str) {
    let mut own = json!({"browserSession":{"version":1}});
    let mut settings = json!({"webBrowser":{}});
    let scope = if shared {
        settings["webBrowser"][field] = value;
        "settings.webBrowser"
    } else {
        own["browserSession"][field] = value;
        "connection.browserSession"
    };
    (own, settings, scope)
}

fn assert_preference_rejection(
    own: &Value,
    settings: &Value,
    scope: &'static str,
    rule: &'static str,
) {
    let before = (own.clone(), settings.clone());
    assert!(NativeBrowserPreferences::from_saved(own, settings).is_err());
    let error = preference_error(own, settings);
    assert_eq!(error, diagnostic(scope, rule));
    assert_eq!(
        error.to_string(),
        format!("Saved browser policy rejected ({scope}): {rule}")
    );
    for secret in ["PRIVATE_MARKER", "secret.example"] {
        assert!(!format!("{error} {error:?}").contains(secret));
    }
    assert_eq!((&before.0, &before.1), (own, settings));
}

#[test]
fn scalar_preference_ranges_report_exact_field_and_preserve_boundary_acceptance() {
    for (field, minimum, maximum, rule) in [
        (
            "defaultZoomPercent",
            50_u64,
            200_u64,
            "defaultZoomPercent must be an integer from 50 to 200 when present",
        ),
        (
            "initialLoadTimeoutSeconds",
            10,
            120,
            "initialLoadTimeoutSeconds must be an integer from 10 to 120 when present",
        ),
        (
            "documentReadyTimeoutSeconds",
            30,
            240,
            "documentReadyTimeoutSeconds must be an integer from 30 to 240 when present",
        ),
        (
            "minimumFormFillDelayMs",
            0,
            30000,
            "minimumFormFillDelayMs must be an integer from 0 to 30000 when present",
        ),
        (
            "minimumFormSubmitDelayMs",
            0,
            30000,
            "minimumFormSubmitDelayMs must be an integer from 0 to 30000 when present",
        ),
    ] {
        for shared in [true, false] {
            for invalid in [
                json!(minimum as i64 - 1),
                json!(maximum + 1),
                json!(maximum as f64),
                json!(u64::MAX),
                json!(null),
                json!(true),
                json!([]),
                json!({"PRIVATE_MARKER":true}),
                json!("https://user:PRIVATE_MARKER@secret.example"),
            ] {
                let (own, settings, scope) = preference_documents(shared, field, invalid);
                assert_preference_rejection(&own, &settings, scope, rule);
            }
            for boundary in [minimum, maximum] {
                let (mut own, settings, _) = preference_documents(shared, field, json!(boundary));
                assert!(NativeBrowserPreferences::from_saved(&own, &settings).is_ok());
                own["httpAutomation"] = json!(false);
                assert!(NativeBrowserPreferences::from_saved(&own, &settings).is_err());
                assert_eq!(
                    preference_error(&own, &settings),
                    NativeAuthorityError::PreferencesInvalid
                );
            }
        }
    }
    assert!(NativeBrowserPreferences::from_saved(&json!({}), &json!({})).is_ok());
}

fn valid_retention() -> Value {
    json!({"version":1,"mode":"ephemeral","idleTimeoutMinutes":30,"maxAgeHours":24,"clearOnDatabaseLock":false})
}

#[test]
fn retention_reports_each_missing_or_malformed_required_field() {
    let fields = [
        ("version", "sessionRetention.version is required and must be 1", vec![json!(2), json!(1.0)]),
        ("mode", "sessionRetention.mode is required and must be ephemeral, memory, encrypted-database or encrypted-local", vec![json!("PRIVATE_MARKER"), json!(1)]),
        ("idleTimeoutMinutes", "sessionRetention.idleTimeoutMinutes is required and must be an integer from 0 to 10080", vec![json!(-1), json!(10081), json!(10080.0), json!(u64::MAX)]),
        ("maxAgeHours", "sessionRetention.maxAgeHours is required and must be an integer from 1 to 8760", vec![json!(0), json!(8761), json!(8760.0), json!(u64::MAX)]),
        ("clearOnDatabaseLock", "sessionRetention.clearOnDatabaseLock is required and must be a boolean", vec![json!(0), json!(1)]),
    ];
    for (field, rule, invalid_values) in fields {
        for shared in [true, false] {
            let mut missing = valid_retention();
            missing.as_object_mut().unwrap().remove(field);
            let (own, settings, scope) = preference_documents(shared, "sessionRetention", missing);
            assert_preference_rejection(&own, &settings, scope, rule);
            for invalid in invalid_values.iter().cloned().chain([
                json!(null),
                json!("https://user:PRIVATE_MARKER@secret.example"),
                json!([]),
                json!({}),
            ]) {
                let mut retention = valid_retention();
                retention[field] = invalid;
                let (own, settings, scope) =
                    preference_documents(shared, "sessionRetention", retention);
                assert_preference_rejection(&own, &settings, scope, rule);
            }
        }
    }
}

#[test]
fn retention_shape_and_unknown_keys_do_not_expose_saved_data() {
    for shared in [true, false] {
        for value in [json!(null), json!([]), json!(true), json!("PRIVATE_MARKER")] {
            let (own, settings, scope) = preference_documents(shared, "sessionRetention", value);
            assert_preference_rejection(
                &own,
                &settings,
                scope,
                "sessionRetention must be an object when present",
            );
        }
        let mut retention = valid_retention();
        retention["https://user:PRIVATE_MARKER@secret.example"] = json!("PRIVATE_MARKER");
        let (own, settings, scope) = preference_documents(shared, "sessionRetention", retention);
        assert_preference_rejection(
            &own,
            &settings,
            scope,
            "sessionRetention contains an unsupported field",
        );
    }
}

#[test]
fn retention_valid_modes_boundaries_and_legacy_alias_are_not_misdiagnosed() {
    for shared in [true, false] {
        for mode in [
            "ephemeral",
            "memory",
            "encrypted-database",
            "encrypted-local",
        ] {
            for (idle, age) in [(0, 1), (10080, 8760)] {
                for clear in [false, true] {
                    let retention = json!({"version":1,"mode":mode,"idleTimeoutMinutes":idle,
                        "maxAgeHours":age,"clearOnDatabaseLock":clear});
                    let (mut own, settings, _) =
                        preference_documents(shared, "sessionRetention", retention);
                    let before = (own.clone(), settings.clone());
                    let preferences =
                        NativeBrowserPreferences::from_saved(&own, &settings).unwrap();
                    assert_eq!(
                        preferences.retention["mode"],
                        if mode == "encrypted-local" {
                            "encrypted-database"
                        } else {
                            mode
                        }
                    );
                    assert_eq!((&before.0, &before.1), (&own, &settings));
                    own["httpAutomation"] = json!(false);
                    assert!(NativeBrowserPreferences::from_saved(&own, &settings).is_err());
                    assert_eq!(
                        preference_error(&own, &settings),
                        NativeAuthorityError::PreferencesInvalid
                    );
                }
            }
        }
    }
}

#[test]
fn delay_budget_reports_invalid_saved_layer_even_when_overridden() {
    let rule = "minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms";
    for shared in [true, false] {
        let (mut own, mut settings, scope) =
            preference_documents(shared, "minimumFormFillDelayMs", json!(30000));
        if shared {
            settings["webBrowser"]["minimumFormSubmitDelayMs"] = json!(22001);
            own["browserSession"]["minimumFormFillDelayMs"] = json!(0);
            own["browserSession"]["minimumFormSubmitDelayMs"] = json!(0);
        } else {
            own["browserSession"]["minimumFormSubmitDelayMs"] = json!(22001);
        }
        assert_preference_rejection(&own, &settings, scope, rule);
        if shared {
            settings["webBrowser"]["minimumFormSubmitDelayMs"] = json!(22000);
        } else {
            own["browserSession"]["minimumFormSubmitDelayMs"] = json!(22000);
        }
        assert!(NativeBrowserPreferences::from_saved(&own, &settings).is_ok());
    }
}

#[test]
fn inherited_delay_budget_identifies_cross_layer_failure_without_saved_values() {
    for (global_field, own_field) in [
        ("minimumFormFillDelayMs", "minimumFormSubmitDelayMs"),
        ("minimumFormSubmitDelayMs", "minimumFormFillDelayMs"),
    ] {
        let (mut own, settings, _) = preference_documents(true, global_field, json!(30000));
        own["browserSession"][own_field] = json!(22001);
        assert_preference_rejection(&own, &settings, "effective.browserSession",
            "inherited minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms");
        own["browserSession"][own_field] = json!(22000);
        assert!(NativeBrowserPreferences::from_saved(&own, &settings).is_ok());
    }
}
