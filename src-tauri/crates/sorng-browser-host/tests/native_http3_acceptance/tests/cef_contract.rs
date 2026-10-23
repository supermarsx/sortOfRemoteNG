use sorng_cef_http3_acceptance::{known_check, valid_target, CHECKS};

#[test]
fn fixture_routes_are_exact_owned_authorities_and_checks_are_closed() {
    assert!(valid_target("http3.fixture.test", 443));
    assert!(valid_target("alternate-http3.fixture.test", 443));
    for (host, port) in [
        ("http3.fixture.test", 444),
        ("localhost", 443),
        ("127.0.0.1", 443),
        ("http3.fixture.test.evil", 443),
    ] {
        assert!(!valid_target(host, port));
    }
    assert_eq!(CHECKS.len(), 8);
    assert!(CHECKS.iter().all(|check| known_check(check)));
    assert!(!known_check("force-quic"));
    assert!(!known_check(""));
}
