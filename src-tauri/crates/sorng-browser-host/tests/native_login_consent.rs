#[path = "../../../src/origin_browser_login_consent.rs"]
mod consent;

use consent::AttemptConsent;
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::time::{Duration, Instant};

fn identity(database: &str, session: &str) -> BrowserIdentity {
    OriginBrowserPolicy::new(database, "connection", session, "https://login.example")
        .unwrap()
        .identity()
        .clone()
}

#[test]
fn approved_exact_origin_and_attempt_receive_only_the_approved_submission_right() {
    let owner = identity("db", "tab");
    let now = Instant::now();
    let expires = now + Duration::from_secs(60);
    let grant = AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        expires,
        false,
    );
    let mut rights = None;
    grant.with_current(
        &owner,
        "https://login.example",
        now,
        &mut |until, submit| {
            rights = Some((until, submit));
        },
    );
    assert_eq!(rights, Some((expires, false)));
}

#[test]
fn another_database_tab_or_reconnect_cannot_reuse_consent() {
    let owner = identity("db", "tab");
    let now = Instant::now();
    let grant = AttemptConsent::approved(
        owner,
        vec!["https://login.example".into()],
        now + Duration::from_secs(60),
        true,
    );
    for other in [
        identity("other-db", "tab"),
        identity("db", "other-tab"),
        identity("db", "tab"),
    ] {
        grant.with_current(&other, "https://login.example", now, &mut |_, _| {
            panic!("another immutable attempt received consent");
        });
    }
}

#[test]
fn unrelated_resources_subdomains_ports_and_lookalikes_are_not_login_consent() {
    let owner = identity("db", "tab");
    let now = Instant::now();
    let grant = AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        now + Duration::from_secs(60),
        true,
    );
    for origin in [
        "https://cdn.example",
        "https://sub.login.example",
        "https://login.example:8443",
        "https://login.example.evil.test",
        "https://login.example@evil.test",
        "http://login.example",
        "https://login.example/path",
        "null",
    ] {
        grant.with_current(&owner, origin, now, &mut |_, _| panic!("origin mismatch"));
    }
}

#[test]
fn expiration_is_monotonic_and_has_no_grace_period() {
    let owner = identity("db", "tab");
    let expires = Instant::now();
    let grant = AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        expires,
        true,
    );
    for now in [expires, expires + Duration::from_secs(1)] {
        grant.with_current(&owner, "https://login.example", now, &mut |_, _| {
            panic!("expired grant");
        });
    }
}

#[test]
fn revocation_is_terminal_even_if_the_original_approval_is_still_unexpired() {
    let owner = identity("db", "tab");
    let now = Instant::now();
    let grant = AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        now + Duration::from_secs(60),
        true,
    );
    let mut deliveries = 0;
    grant.with_current(&owner, "https://login.example", now, &mut |_, submit| {
        assert!(submit);
        deliveries += 1;
    });
    grant.revoke();
    grant.revoke();
    grant.with_current(&owner, "https://login.example", now, &mut |_, _| {
        deliveries += 1;
    });
    assert_eq!(deliveries, 1);
}

#[test]
fn a_panicking_delivery_poisoning_the_grant_cannot_authorize_another_delivery() {
    let owner = identity("db", "tab");
    let now = Instant::now();
    let grant = AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        now + Duration::from_secs(60),
        true,
    );
    assert!(std::panic::catch_unwind(|| {
        grant.with_current(&owner, "https://login.example", now, &mut |_, _| {
            panic!("synthetic delivery failure");
        });
    })
    .is_err());
    grant.with_current(&owner, "https://login.example", now, &mut |_, _| {
        panic!("poisoned grant reused");
    });
    grant.revoke();
}
