#[path = "../../../src/origin_browser_login_consent.rs"]
mod consent;
#[path = "../../../src/origin_browser_login_lifetime.rs"]
mod lifetime;

use consent::AttemptConsent;
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::time::{Duration, Instant};

#[test]
fn cancelling_waits_for_borrowed_delivery_and_blocks_every_later_key_grant() {
    use std::sync::{mpsc, Arc};
    let owner = identity("db", "tab");
    let now = Instant::now();
    let consent = Arc::new(AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        now + Duration::from_secs(600),
        true,
    ));
    let lifetime = Arc::new(lifetime::LoginLifetime::new(now));
    let (entered_tx, entered) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let current = consent.clone();
    let current_owner = owner.clone();
    let delivery = std::thread::spawn(move || {
        current.with_current(&current_owner, "https://login.example", now, &mut |_, _| {
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        })
    });
    entered.recv().unwrap();
    let current = consent.clone();
    let current_lifetime = lifetime.clone();
    let (cancelled_tx, cancelled) = mpsc::channel();
    let cancel = std::thread::spawn(move || {
        assert_eq!(
            current_lifetime.cancel(lifetime::CancelReason::UserCancelled, now),
            Some(lifetime::CancelReason::UserCancelled)
        );
        current.revoke();
        cancelled_tx.send(()).unwrap();
    });
    assert!(cancelled.recv_timeout(Duration::from_millis(20)).is_err());
    release.send(()).unwrap();
    delivery.join().unwrap();
    cancelled.recv_timeout(Duration::from_secs(1)).unwrap();
    cancel.join().unwrap();
    assert!(!lifetime.active(now));
    consent.with_current(&owner, "https://login.example", now, &mut |_, _| {
        panic!("cancelled attempt disclosed another key")
    });
}

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
fn explicit_http_consent_binds_custom_port_owner_expiry_and_revocation() {
    let origin = "http://login.example:8080";
    let policy = OriginBrowserPolicy::new("db", "connection", "tab", origin).unwrap();
    let owner = policy.identity();
    let now = Instant::now();
    let expires = now + Duration::from_secs(60);
    let grant = AttemptConsent::approved(owner.clone(), vec![origin.into()], expires, false);
    let mut rights = None;
    grant.with_current(owner, origin, now, &mut |until, submit| rights = Some((until, submit)));
    assert_eq!(rights, Some((expires, false)));
    for other in [
        "https://login.example:8080", "http://login.example", "http://login.example:8081",
        "http://sub.login.example:8080", "http://login.example.evil.test:8080",
        "http://login.example:8080/path",
    ] {
        grant.with_current(owner, other, now, &mut |_, _| panic!("HTTP origin mismatch"));
    }
    for (db, tab) in [("other-db", "tab"), ("db", "other-tab"), ("db", "tab")] {
        let other = OriginBrowserPolicy::new(db, "connection", tab, origin).unwrap();
        grant.with_current(other.identity(), origin, now, &mut |_, _| panic!("HTTP owner mismatch"));
    }
    grant.with_current(owner, origin, expires, &mut |_, _| panic!("HTTP grant expired"));
    grant.revoke();
    grant.with_current(owner, origin, now, &mut |_, _| panic!("HTTP grant revoked"));
}

#[test]
fn https_consent_never_implicitly_authorizes_http_at_the_same_custom_port() {
    let owner = identity("db", "tab");
    let now = Instant::now();
    let grant = AttemptConsent::approved(
        owner.clone(), vec!["https://login.example:8080".into()],
        now + Duration::from_secs(60), true,
    );
    for origin in ["http://login.example:8080", "http://login.example"] {
        grant.with_current(&owner, origin, now, &mut |_, _| panic!("implicit HTTPS downgrade"));
    }
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

#[test]
fn refusals_name_only_a_fixed_cause_for_the_live_exact_attempt() {
    use consent::ConsentRefusal;
    let owner = identity("db", "tab");
    let now = Instant::now();
    let expires = now + Duration::from_secs(60);
    let grant = AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        expires,
        true,
    );
    let mut delivered = 0;
    let mut never = |_: Instant, _: bool| delivered += 1;
    assert_eq!(
        grant.with_current(&owner, "https://dsm.example:5001", now, &mut never),
        Some(ConsentRefusal::AddressMismatch)
    );
    assert_eq!(
        grant.with_current(&owner, "https://login.example", expires, &mut never),
        Some(ConsentRefusal::Expired)
    );
    // Another attempt or a revoked grant is not this attempt's diagnosis.
    assert_eq!(
        grant.with_current(&identity("db", "tab"), "https://login.example", now, &mut never),
        None
    );
    grant.revoke();
    assert_eq!(
        grant.with_current(&owner, "https://login.example", now, &mut never),
        None
    );
    assert_eq!(delivered, 0);
}

#[test]
fn an_explicit_rearm_approves_only_the_same_attempt_destinations_and_submission_right() {
    let owner = identity("db", "tab");
    let now = Instant::now();
    let grant = AttemptConsent::approved(
        owner.clone(),
        vec!["https://login.example".into()],
        now + Duration::from_secs(60),
        false,
    );
    grant.revoke();
    let later = now + Duration::from_secs(120);
    assert!(grant.rearm(later + Duration::from_secs(60)));
    let mut rights = None;
    grant.with_current(&owner, "https://login.example", later, &mut |until, submit| {
        rights = Some((until, submit));
    });
    assert_eq!(rights, Some((later + Duration::from_secs(60), false)));
    grant.with_current(&owner, "https://cdn.example", later, &mut |_, _| {
        panic!("rearm widened the destinations")
    });
    grant.with_current(&identity("db", "tab"), "https://login.example", later, &mut |_, _| {
        panic!("rearm admitted another attempt")
    });
}

#[test]
fn a_poisoned_grant_is_never_rearmed() {
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
    assert!(!grant.rearm(now + Duration::from_secs(600)));
    grant.with_current(&owner, "https://login.example", now, &mut |_, _| {
        panic!("poisoned grant re-armed");
    });
}
