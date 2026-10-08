use super::*;
use sorng_protocols::origin_browser::OriginBrowserPolicy;

struct Owner {
    identity: BrowserIdentity,
    active: AtomicBool,
}
impl RecordingOwner for Owner {
    fn current(&self, identity: &BrowserIdentity) -> bool {
        identity == &self.identity && self.active.load(Ordering::Acquire)
    }
}
struct Fixture {
    owner: Arc<Owner>,
    record: Arc<Recording>,
}
impl Fixture {
    fn new() -> Self {
        let identity =
            OriginBrowserPolicy::new("db", "connection", "session", "https://fixture.invalid")
                .unwrap()
                .identity()
                .clone();
        let owner = Arc::new(Owner {
            identity: identity.clone(),
            active: AtomicBool::new(true),
        });
        assert!(begin(&identity, "https://fixture.invalid", "GET").is_none());
        let record = Recording::start(&identity, owner.clone()).unwrap();
        Self { owner, record }
    }
    fn begin(&self) -> Capture {
        begin(
            &self.owner.identity,
            "https://fixture.invalid/resource",
            "GET",
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        discard(&self.owner.identity);
    }
}

#[test]
fn native_recording_defaults_to_origin_only_metadata_and_never_retains_secrets() {
    let f = Fixture::new();
    begin(
        &f.owner.identity,
        "https://alice:password@fixture.invalid/private-secret?access_token=hidden#otp",
        "CUSTOM-SECRET",
    )
    .unwrap()
    .complete(200, 42, Outcome::Success);
    f.record.stop().unwrap();
    let data = f.record.export().unwrap();
    assert_eq!(data.entries[0].url, "https://fixture.invalid/");
    assert_eq!(data.entries[0].method, "OTHER");
    assert_eq!(data.snapshot.received_body_bytes, 42);
    let serialized = serde_json::to_string(&data).unwrap();
    for secret in [
        "alice",
        "password",
        "private-secret",
        "access_token",
        "hidden",
        "otp",
        "CUSTOM-SECRET",
    ] {
        assert!(!serialized.contains(secret));
    }
    assert!(data.snapshot.metadata_only);
    assert!(redacted_url("data:text/plain,secret").is_none());
    assert_eq!(
        redacted_url("http://fixture.invalid:8080/path").unwrap(),
        "http://fixture.invalid:8080/"
    );
}

#[test]
fn native_recording_requires_explicit_start_exact_attempt_and_live_owner() {
    let f = Fixture::new();
    let other = OriginBrowserPolicy::new(
        "other-db",
        "connection",
        "session",
        "https://fixture.invalid",
    )
    .unwrap();
    assert!(find(other.identity()).is_none());
    assert!(matches!(
        Recording::start(other.identity(), f.owner.clone()),
        Err(RecordingError::OwnerUnavailable)
    ));
    assert!(matches!(
        Recording::start(&f.owner.identity, f.owner.clone()),
        Err(RecordingError::AlreadyExists)
    ));
    assert!(matches!(
        f.record.export(),
        Err(RecordingError::Unavailable)
    ));
    let pending = f.begin();
    f.owner.active.store(false, Ordering::Release);
    pending.complete(200, 100, Outcome::Success);
    assert!(find(&f.owner.identity).is_none());
    assert!(matches!(
        f.record.export(),
        Err(RecordingError::OwnerUnavailable)
    ));
    assert!(f.record.buffer.lock().unwrap().entries.is_empty());
}

#[test]
fn native_recording_stale_completion_and_redirect_cannot_enter_a_replacement() {
    let f = Fixture::new();
    let completion = f.begin();
    let redirect = f.begin();
    let first_id = f.record.stop().unwrap().recording_id;
    assert_eq!(f.record.snapshot().unwrap().dropped_entries, 2);
    discard(&f.owner.identity);
    let replacement = Recording::start(&f.owner.identity, f.owner.clone()).unwrap();
    assert_ne!(replacement.snapshot().unwrap().recording_id, first_id);
    assert!(!discard_exact(&f.owner.identity, &first_id));
    assert!(find(&f.owner.identity).is_some());
    completion.complete(200, 100, Outcome::Success);
    assert!(redirect
        .redirect(302, "https://fixture.invalid/next", "GET")
        .is_none());
    assert_eq!(replacement.snapshot().unwrap().entry_count, 0);
}

#[test]
fn native_recording_tracks_redirect_hops_without_exporting_locations_or_values() {
    let f = Fixture::new();
    f.begin()
        .redirect(302, "https://fixture.invalid/private?secret=value", "GET")
        .unwrap()
        .complete(200, 16, Outcome::Success);
    f.record.stop().unwrap();
    let data = f.record.export().unwrap();
    assert_eq!(data.entries.len(), 2);
    assert_eq!(data.entries[0].outcome, Outcome::Redirect);
    assert_eq!(data.entries[1].outcome, Outcome::Success);
    assert!(data
        .entries
        .iter()
        .all(|entry| entry.url == "https://fixture.invalid/"));
}

#[test]
fn native_recording_caps_in_flight_and_counts_abandoned_requests() {
    let f = Fixture::new();
    let pending: Vec<_> = (0..MAX_IN_FLIGHT).map(|_| f.begin()).collect();
    assert!(begin(&f.owner.identity, "https://fixture.invalid", "GET").is_none());
    assert_eq!(f.record.snapshot().unwrap().dropped_entries, 1);
    drop(pending);
    assert_eq!(
        f.record.snapshot().unwrap().dropped_entries,
        1 + MAX_IN_FLIGHT as u64
    );
    f.begin().complete(0, -1, Outcome::Cancelled);
    f.begin().complete(0, 0, Outcome::Failed);
    assert_eq!(f.record.snapshot().unwrap().received_body_bytes, 0);
}

#[test]
fn native_recording_caps_entries_and_is_explicit_about_truncation() {
    let f = Fixture::new();
    for _ in 0..=MAX_ENTRIES {
        f.begin().complete(200, 1, Outcome::Success);
    }
    let snapshot = f.record.snapshot().unwrap();
    assert_eq!(snapshot.phase, Phase::LimitReached);
    assert_eq!(snapshot.entry_count, MAX_ENTRIES);
    assert_eq!(snapshot.dropped_entries, 1);
    assert_eq!(snapshot.received_body_bytes, MAX_ENTRIES as u64);
    assert!(begin(&f.owner.identity, "https://fixture.invalid", "GET").is_none());
    assert_eq!(f.record.export().unwrap().entries.len(), MAX_ENTRIES);
}

#[test]
fn native_recording_duration_limit_ends_capture_without_waiting_for_a_poll() {
    let f = Fixture::new();
    let expired = Arc::new(Recording {
        identity: f.owner.identity.clone(),
        id: "expired".into(),
        owner: f.owner.clone(),
        revoked: AtomicBool::new(false),
        started: Instant::now() - MAX_DURATION - Duration::from_secs(1),
        buffer: Mutex::new(Buffer {
            phase: Phase::Recording,
            stopped: None,
            entries: Vec::new(),
            received: 0,
            dropped: 0,
            in_flight: 0,
        }),
    });
    assert!(expired.begin("https://fixture.invalid", "GET").is_none());
    let snapshot = expired.snapshot().unwrap();
    assert_eq!(snapshot.phase, Phase::LimitReached);
    assert_eq!(snapshot.duration_ms, milliseconds(MAX_DURATION));
}

#[test]
fn native_recording_revoke_scrubs_stopped_export_and_does_not_revoke_another_owner() {
    let first = Fixture::new();
    let second = Fixture::new();
    first.begin().complete(200, 12, Outcome::Success);
    first.record.stop().unwrap();
    first.owner.active.store(false, Ordering::Release);
    reap();
    assert!(first.record.buffer.lock().unwrap().entries.is_empty());
    assert!(first.record.export().is_err());
    second.begin().complete(200, 5, Outcome::Success);
    assert_eq!(second.record.snapshot().unwrap().entry_count, 1);
}
