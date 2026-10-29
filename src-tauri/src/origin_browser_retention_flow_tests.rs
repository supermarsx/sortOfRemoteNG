//! CEF-free tests of the checkpoint schedule (t-cefiso p3). Every instant is a
//! synthetic offset from one base: the clock is the test's, never the wall's.

use super::gate::{Gate, Work};
use super::{durable_checkpoints, Schedule, FINAL_CAPTURE_LIMIT};
use sorng_browser_host::cef_session_retention::{RetentionMode, RetentionPolicy};
use std::time::{Duration, Instant};

/// `gate::INTERVAL` (private to the gate): the periodic capture cadence.
const PERIODIC: Duration = Duration::from_secs(5);

fn policy(mode: RetentionMode) -> RetentionPolicy {
    RetentionPolicy {
        mode,
        ..RetentionPolicy::default()
    }
}

#[test]
fn durable_checkpoints_only_for_retained_encrypted_database_mode() {
    assert!(durable_checkpoints(true, RetentionPolicy::default()));
    assert!(durable_checkpoints(
        true,
        policy(RetentionMode::EncryptedDatabase)
    ));
    // restoreCookies false, cookies disabled or Quick Connect: no owner.
    assert!(!durable_checkpoints(
        false,
        policy(RetentionMode::EncryptedDatabase)
    ));
    assert!(!durable_checkpoints(true, policy(RetentionMode::Ephemeral)));
    assert!(!durable_checkpoints(true, policy(RetentionMode::Memory)));
    let disabled = RetentionPolicy {
        idle_timeout_minutes: 0,
        ..RetentionPolicy::default()
    };
    assert!(!durable_checkpoints(true, disabled));
}

#[test]
fn periodic_cadence_follows_the_injected_clock() {
    let t0 = Instant::now();
    let mut gate = Gate::new(t0);
    let mut schedule = Schedule::new(true);
    assert!(!schedule.capture_due(&gate, true, t0));
    assert!(!schedule.capture_due(&gate, true, t0 + PERIODIC - Duration::from_millis(1)));
    assert!(schedule.capture_due(&gate, true, t0 + PERIODIC));
    // A save re-arms the interval from its own start.
    let t1 = t0 + PERIODIC + Duration::from_millis(700);
    assert_eq!(gate.start_save(t1), Work::PeriodicSave);
    // No overlapping capture while that save is in flight, even when due.
    assert!(!schedule.capture_due(&gate, true, t1 + PERIODIC * 3));
    assert!(!gate.completed(Ok(()), t1));
    assert!(!schedule.capture_due(&gate, true, t1 + PERIODIC - Duration::from_millis(1)));
    assert!(schedule.capture_due(&gate, true, t1 + PERIODIC));
    // A revoked/detached attempt never starts a mid-session capture.
    assert!(!schedule.capture_due(&gate, false, t1 + PERIODIC * 10));
}

#[test]
fn sign_in_navigation_requests_one_immediate_durable_checkpoint() {
    let t0 = Instant::now();
    let mut gate = Gate::new(t0);
    let mut schedule = Schedule::new(true);
    let soon = t0 + Duration::from_millis(10);
    assert!(!schedule.capture_due(&gate, true, soon));
    schedule.request();
    schedule.request(); // Coalesced: one capture per pending request.
    assert!(!schedule.capture_due(&gate, false, soon)); // Not live: kept.
    assert!(schedule.capture_due(&gate, true, soon));
    assert!(!schedule.capture_due(&gate, true, soon));
    // A request while a save runs waits for it, then fires before the interval.
    schedule.request();
    gate.start_save(soon);
    assert!(!schedule.capture_due(&gate, true, soon));
    gate.completed(Ok(()), soon);
    assert!(schedule.capture_due(&gate, true, soon));
}

#[test]
fn memory_and_ephemeral_attempts_ignore_sign_in_requests() {
    let t0 = Instant::now();
    let gate = Gate::new(t0);
    let mut schedule = Schedule::new(durable_checkpoints(true, policy(RetentionMode::Memory)));
    schedule.request();
    assert!(!schedule.capture_due(&gate, true, t0));
    let mut schedule = Schedule::new(durable_checkpoints(true, policy(RetentionMode::Ephemeral)));
    schedule.request();
    assert!(!schedule.capture_due(&gate, true, t0));
}

#[test]
fn close_ends_mid_session_captures_and_arms_a_bounded_final_capture() {
    let t0 = Instant::now();
    let mut gate = Gate::new(t0);
    let mut schedule = Schedule::new(true);
    assert!(!schedule.final_capture_expired(t0 + Duration::from_secs(3600)));
    schedule.request();
    assert!(gate.begin_close(t0));
    schedule.begin_close(t0);
    // Neither a pending request nor the periodic interval captures again.
    assert!(!schedule.capture_due(&gate, true, t0 + PERIODIC * 4));
    schedule.request();
    assert!(!schedule.capture_due(&gate, true, t0 + PERIODIC * 4));
    assert!(!schedule.final_capture_expired(t0 + FINAL_CAPTURE_LIMIT - Duration::from_millis(1)));
    assert!(schedule.final_capture_expired(t0 + FINAL_CAPTURE_LIMIT));
    // A repeated close (window close, then app exit) keeps the first deadline.
    schedule.begin_close(t0 + Duration::from_secs(2));
    assert!(schedule.final_capture_expired(t0 + FINAL_CAPTURE_LIMIT));
}

#[test]
fn final_capture_bound_is_shorter_than_the_native_capture_and_close_limits() {
    // CookieCapture gives up after 10 s and the gate's close limit is 12 s:
    // the drop must win, or a stuck capture would clear the saved sign-in.
    assert!(FINAL_CAPTURE_LIMIT < Duration::from_secs(10));
    assert!(FINAL_CAPTURE_LIMIT >= Duration::from_secs(1));
}

#[test]
fn dropped_final_capture_finishes_the_slot_without_clearing_it() {
    // The coordinator's path after FINAL_CAPTURE_LIMIT: no capture, Closing.
    let t0 = Instant::now();
    let mut gate = Gate::new(t0);
    assert!(gate.begin_close(t0));
    let late = t0 + FINAL_CAPTURE_LIMIT;
    assert!(!gate.expire(late)); // Not the 12 s close failure (Clear).
    assert!(gate.claim_finish());
    assert_eq!(gate.worker(), Some(Work::Finish));
    assert!(!gate.completed(Ok(()), late));
    assert!(!gate.draining());
    assert_eq!(gate.claim_cleanup(late + Duration::from_secs(60)), None);
}

#[test]
fn dropped_final_capture_waits_for_an_in_flight_periodic_checkpoint() {
    let t0 = Instant::now();
    let mut gate = Gate::new(t0);
    gate.start_save(t0); // Periodic checkpoint still writing.
    assert!(gate.begin_close(t0));
    let late = t0 + FINAL_CAPTURE_LIMIT;
    assert!(!gate.claim_finish());
    assert!(!gate.completed(Ok(()), late));
    assert!(gate.claim_finish());
    assert!(!gate.completed(Ok(()), late));
    assert!(!gate.draining());
}
