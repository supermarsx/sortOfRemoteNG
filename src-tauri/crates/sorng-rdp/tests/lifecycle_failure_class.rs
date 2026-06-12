//! Integration coverage for the runner's classify-then-stamp failure-class
//! path (t32). The runner drives the linear connect/disconnect phases through
//! the string-based phase projection, which has no channel for a per-error
//! `FailureClass` — so `ConnectionPhase::Error` always projects to
//! `Failed(ProtocolViolation)`. At its terminal/network-loss sites the runner
//! now classifies the real error and stamps the typed class via
//! `RdpSessionStats::set_failure_class`, which `snapshot()` then prefers over
//! the state-derived default.
//!
//! These tests stitch the exact runner ordering (`set_phase("error")` →
//! `set_failure_class(real)`) through the public `RdpSessionStats` /
//! `classify_security_error_for_lifecycle` surfaces and assert each failure
//! path lands the CORRECT class — NOT always `protocol_violation`. Deterministic
//! and host-independent — no live RDP server.

use sorng_rdp::rdp::cert_trust::classify_security_error_for_lifecycle;
use sorng_rdp::rdp::session_state::FailureClass;
use sorng_rdp::rdp::stats::RdpSessionStats;

/// Mirror the runner's terminal-error ordering: project the `error` phase
/// (stamps the default `ProtocolViolation`) then stamp the classified class.
fn stamp_terminal_failure(stats: &RdpSessionStats, err_msg: &str) -> Option<String> {
    let class = classify_security_error_for_lifecycle(err_msg);
    stats.set_phase("error");
    stats.set_failure_class(class);
    stats.lifecycle_snapshot("session-1").last_failure_class
}

#[test]
fn auth_failure_is_classified_as_auth_rejected_not_protocol_violation() {
    let stats = RdpSessionStats::new();
    let class = stamp_terminal_failure(
        &stats,
        "connect_finalize failed: CredSSP InvalidToken — access denied",
    );
    assert_eq!(class.as_deref(), Some("auth_rejected"));
}

#[test]
fn empty_identity_is_classified_as_auth_rejected() {
    let stats = RdpSessionStats::new();
    let class = stamp_terminal_failure(
        &stats,
        "connect_finalize failed: sspi error — Got empty identity",
    );
    assert_eq!(class.as_deref(), Some("auth_rejected"));
}

#[test]
fn certificate_failure_is_classified_as_trust_rejected() {
    let stats = RdpSessionStats::new();
    let class = stamp_terminal_failure(
        &stats,
        "server certificate validation failed: UnknownIssuer",
    );
    assert_eq!(class.as_deref(), Some("trust_rejected"));
}

#[test]
fn network_loss_is_classified_as_network_transient() {
    let stats = RdpSessionStats::new();
    let class = stamp_terminal_failure(
        &stats,
        "io error: an existing connection was forcibly closed (10054)",
    );
    assert_eq!(class.as_deref(), Some("network_transient"));
}

#[test]
fn unrecognized_failure_falls_back_to_protocol_violation() {
    let stats = RdpSessionStats::new();
    let class = stamp_terminal_failure(&stats, "unexpected PDU type 0x42 in active stage");
    assert_eq!(class.as_deref(), Some("protocol_violation"));
}

#[test]
fn reconnect_path_stamps_network_transient_without_terminating() {
    // The runner's reconnect sites keep the Reconnecting state but stamp
    // NetworkTransient so the diagnostics row reflects the real class.
    let stats = RdpSessionStats::new();
    stats.set_phase("reconnecting");
    stats.set_failure_class(FailureClass::NetworkTransient);

    let snapshot = stats.lifecycle_snapshot("session-1");
    assert_eq!(snapshot.state, "reconnecting");
    assert_eq!(
        snapshot.last_failure_class.as_deref(),
        Some("network_transient")
    );
}

#[test]
fn real_class_is_not_clobbered_by_error_phase_default() {
    // R1 regression guard: set_phase("error") stamps ProtocolViolation via
    // force_state; the subsequent set_failure_class(real) must win.
    let stats = RdpSessionStats::new();

    stats.set_phase("error");
    assert_eq!(
        stats
            .lifecycle_snapshot("session-1")
            .last_failure_class
            .as_deref(),
        Some("protocol_violation"),
    );

    stats.set_failure_class(FailureClass::AuthRejected);
    let snapshot = stats.lifecycle_snapshot("session-1");
    assert_eq!(snapshot.state, "terminated");
    assert_eq!(snapshot.last_failure_class.as_deref(), Some("auth_rejected"));
}

#[test]
fn clean_disconnect_carries_no_failure_class() {
    // R4 regression guard: clean user/server disconnect must leave the class
    // null — only the error/network-loss sites stamp a class.
    let stats = RdpSessionStats::new();
    stats.set_phase("active");
    stats.set_phase("disconnected");

    let snapshot = stats.lifecycle_snapshot("session-1");
    // ConnectionPhase::Disconnected -> Terminated(ServerClosed). ServerClosed is
    // a clean termination reason that carries NO failure class (only
    // Terminated(Failed(_)) does), and the clean-disconnect runner path never
    // calls set_failure_class. So the diagnostics "Failure Class" row stays
    // empty for a clean close.
    assert_eq!(snapshot.state, "terminated");
    assert_eq!(snapshot.last_failure_class, None);
}

#[test]
fn happy_path_active_has_no_failure_class() {
    let stats = RdpSessionStats::new();
    stats.set_phase("tcp_connect");
    stats.set_phase("active");

    let snapshot = stats.lifecycle_snapshot("session-1");
    assert_eq!(snapshot.state, "active");
    assert_eq!(snapshot.last_failure_class, None);
}
