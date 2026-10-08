//! State-machine and owner-boundary tests; no network or native dialog launches.
use sorng_browser_host::ipc;
use sorng_browser_host::native_downloads::*;
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Default)]
struct Counts {
    saved: usize,
    dropped: usize,
    cancelled: usize,
    paused: usize,
    resumed: usize,
}
struct Before(Arc<Mutex<Counts>>);
impl BeforeDownload for Before {
    fn save(self: Box<Self>, destination: SaveDestination) {
        assert!(destination.path().is_absolute());
        self.0.lock().unwrap().saved += 1;
    }
}
impl Drop for Before {
    fn drop(&mut self) {
        self.0.lock().unwrap().dropped += 1;
    }
}
struct Control(Arc<Mutex<Counts>>);
impl DownloadControl for Control {
    fn cancel(&self) {
        self.0.lock().unwrap().cancelled += 1;
    }
    fn pause(&self) {
        self.0.lock().unwrap().paused += 1;
    }
    fn resume(&self) {
        self.0.lock().unwrap().resumed += 1;
    }
}
struct Owner {
    identity: BrowserIdentity,
    pool: Arc<DownloadPool>,
    enabled: AtomicBool,
    live: AtomicBool,
    prompts: Mutex<Vec<(DownloadSaveRequest, DownloadSaveCompletion)>>,
    events: Mutex<Vec<DownloadSnapshot>>,
    revealed: Mutex<Vec<PathBuf>>,
}
impl NativeDownloadDelegate for Owner {
    fn pool(&self) -> Arc<DownloadPool> {
        self.pool.clone()
    }
    fn downloads_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }
    fn is_current(&self, identity: &BrowserIdentity) -> bool {
        *identity == self.identity && self.live.load(Ordering::Acquire)
    }
    fn choose_destination(&self, request: DownloadSaveRequest, completion: DownloadSaveCompletion) {
        self.prompts.lock().unwrap().push((request, completion));
    }
    fn changed(&self, snapshot: DownloadSnapshot) {
        self.events.lock().unwrap().push(snapshot);
    }
    fn supports_reveal(&self) -> bool {
        true
    }
    fn reveal(
        &self,
        identity: &BrowserIdentity,
        path: &std::path::Path,
    ) -> Result<(), DownloadError> {
        assert!(*identity == self.identity);
        self.revealed.lock().unwrap().push(path.to_owned());
        Ok(())
    }
}
fn fixture(database: &str) -> (DownloadManager, Arc<Owner>, Arc<Mutex<Counts>>, Instant) {
    let identity = OriginBrowserPolicy::new(database, "connection", "tab", "https://fixture.test")
        .unwrap()
        .identity()
        .clone();
    let owner = Arc::new(Owner {
        identity: identity.clone(),
        pool: Arc::new(DownloadPool::new(identity.clone())),
        enabled: AtomicBool::new(true),
        live: AtomicBool::new(true),
        prompts: Mutex::new(Vec::new()),
        events: Mutex::new(Vec::new()),
        revealed: Mutex::new(Vec::new()),
    });
    (
        DownloadManager::new(identity, owner.clone()),
        owner,
        Arc::new(Mutex::new(Counts::default())),
        Instant::now(),
    )
}
fn destination() -> SaveDestination {
    SaveDestination::from_dialog(std::env::temp_dir().join("sorng-native-download-test-unused.txt"))
        .unwrap()
}
fn approve(owner: &Owner) {
    let (request, completion) = owner.prompts.lock().unwrap().pop().unwrap();
    assert!(request.identity == owner.identity);
    assert!(request.download_id > 0 && request.expires_at > Instant::now());
    assert!(!request.suggested_name.contains('/'));
    completion.complete(Some(destination()));
}
fn action(owner: &Owner, id: u32, action: DownloadAction) -> DownloadControlRequest {
    DownloadControlRequest {
        identity: ipc::OriginBrowserIdentity::from_native(&owner.identity),
        download_id: id,
        action,
    }
}
fn progress() -> DownloadProgress {
    DownloadProgress {
        in_progress: true,
        received: 12,
        total: 100,
        speed: 5,
        ..Default::default()
    }
}

#[test]
fn existing_callbacks_wait_for_native_save_and_support_progress_pause_resume_cancel() {
    let (mut manager, owner, counts, now) = fixture("database");
    // CEF may deliver updates before OnBeforeDownload.
    manager
        .update(41, progress(), Box::new(Control(counts.clone())), now)
        .unwrap();
    assert!(owner.events.lock().unwrap().is_empty());
    manager
        .before(
            41,
            "../../report.pdf",
            Box::new(Before(counts.clone())),
            now,
        )
        .unwrap();
    assert!(manager.poll(now));
    assert_eq!(counts.lock().unwrap().saved, 0);
    assert!(!manager.permits_transfer(41));
    approve(&owner);
    assert!(manager.poll(now));
    assert_eq!(counts.lock().unwrap().saved, 1);
    assert!(manager.permits_transfer(41));
    let rows = manager
        .list(&action(&owner, 1, DownloadAction::Cancel).identity)
        .unwrap();
    assert_eq!(rows[0].file_name, "report.pdf");
    assert_eq!(rows[0].status, DownloadStatus::InProgress);
    assert!(rows[0].can_pause && rows[0].can_cancel);
    manager
        .control(&action(&owner, 1, DownloadAction::Pause), now)
        .unwrap();
    assert!(manager.wants_control(41, DownloadAction::Pause));
    assert!(!manager.wants_control(41, DownloadAction::Resume));
    manager
        .control(&action(&owner, 1, DownloadAction::Resume), now)
        .unwrap();
    assert!(manager.wants_control(41, DownloadAction::Resume));
    assert!(!manager.wants_control(41, DownloadAction::Pause));
    manager
        .control(&action(&owner, 1, DownloadAction::Cancel), now)
        .unwrap();
    manager
        .control(&action(&owner, 1, DownloadAction::Cancel), now)
        .unwrap();
    let counts = counts.lock().unwrap();
    assert_eq!(
        (
            counts.saved,
            counts.cancelled,
            counts.paused,
            counts.resumed
        ),
        (1, 1, 1, 1)
    );
    assert!(!manager.poll(now));
}

#[test]
fn dismissed_or_dropped_save_dialog_cancels_without_a_write() {
    for explicit in [false, true] {
        let (mut manager, owner, counts, now) = fixture("database");
        manager
            .before(1, "report", Box::new(Before(counts.clone())), now)
            .unwrap();
        let (_, completion) = owner.prompts.lock().unwrap().pop().unwrap();
        if explicit {
            completion.complete(None);
        } else {
            drop(completion);
        }
        assert!(!manager.poll(now));
        assert_eq!(counts.lock().unwrap().saved, 0);
        assert_eq!(counts.lock().unwrap().dropped, 1);
        manager
            .update(1, progress(), Box::new(Control(counts.clone())), now)
            .unwrap();
        assert_eq!(counts.lock().unwrap().cancelled, 1);
        assert_eq!(
            owner.events.lock().unwrap().last().unwrap().status,
            DownloadStatus::Cancelled
        );
    }
}

#[test]
fn revocation_or_timeout_defeats_late_save_approval() {
    for revoked in [false, true] {
        let (mut manager, owner, counts, now) = fixture("quick-connect:tab");
        manager
            .before(1, "file", Box::new(Before(counts.clone())), now)
            .unwrap();
        if revoked {
            owner.live.store(false, Ordering::Release);
        }
        let later = if revoked { now } else { now + SAVE_TIMEOUT };
        assert!(!manager.poll(later));
        approve(&owner);
        assert!(!manager.poll(later));
        assert_eq!(counts.lock().unwrap().saved, 0);
    }
}

#[test]
fn temporary_owner_can_download_and_owner_loss_cancels_an_active_transfer() {
    let (mut manager, owner, counts, now) = fixture("quick-connect:tab");
    manager
        .before(5, "file", Box::new(Before(counts.clone())), now)
        .unwrap();
    approve(&owner);
    manager.poll(now);
    manager
        .update(5, progress(), Box::new(Control(counts.clone())), now)
        .unwrap();
    let before = owner.events.lock().unwrap().len();
    owner.live.store(false, Ordering::Release);
    assert!(!manager.poll(now));
    assert_eq!(counts.lock().unwrap().cancelled, 1);
    assert_eq!(owner.events.lock().unwrap().len(), before);
    assert!(manager
        .list(&action(&owner, 1, DownloadAction::Cancel).identity)
        .is_err());
}

#[test]
fn every_identity_component_and_reconnect_attempt_are_fenced() {
    let (mut manager, owner, counts, now) = fixture("database");
    manager
        .before(1, "file", Box::new(Before(counts.clone())), now)
        .unwrap();
    for field in 0..4 {
        let mut request = action(&owner, 1, DownloadAction::Cancel);
        match field {
            0 => request.identity.owner_database_id = "other-db".into(),
            1 => request.identity.connection_id = "other-connection".into(),
            2 => request.identity.session_id = "other-tab".into(),
            _ => {
                request.identity.attempt_id =
                    fixture("database").1.identity.attempt_id().to_string()
            }
        }
        assert_eq!(
            manager.control(&request, now),
            Err(DownloadError::OwnerUnavailable)
        );
        assert!(manager.list(&request.identity).is_err());
    }
    assert_eq!(counts.lock().unwrap().dropped, 0);
    assert!(manager.current());
}

#[test]
fn root_and_popups_share_ids_and_controls_cannot_target_a_sibling() {
    let (mut root, owner, root_counts, now) = fixture("database");
    let mut child = DownloadManager::new(owner.identity.clone(), owner.clone());
    let child_counts = Arc::new(Mutex::new(Counts::default()));
    // Even equal CEF IDs in separate managers cannot collide in the app DTO.
    root.before(41, "root", Box::new(Before(root_counts.clone())), now)
        .unwrap();
    child
        .before(41, "child", Box::new(Before(child_counts.clone())), now)
        .unwrap();
    let identity = ipc::OriginBrowserIdentity::from_native(&owner.identity);
    let root_id = root.list(&identity).unwrap()[0].download_id;
    let child_id = child.list(&identity).unwrap()[0].download_id;
    assert_ne!(root_id, child_id);
    assert_eq!(
        root.control(&action(&owner, child_id, DownloadAction::Cancel), now),
        Err(DownloadError::Unavailable)
    );
    assert_eq!(
        child.control(&action(&owner, root_id, DownloadAction::Cancel), now),
        Err(DownloadError::Unavailable)
    );
    child.revoke();
    assert!(root.current());
    let cancelled = owner.events.lock().unwrap().last().unwrap().clone();
    assert_eq!(cancelled.download_id, child_id);
    assert_eq!(cancelled.status, DownloadStatus::Cancelled);
    assert!(!cancelled.can_cancel && !cancelled.can_pause && !cancelled.can_resume);
    assert_eq!(
        root.list(&identity).unwrap()[0].status,
        DownloadStatus::AwaitingDestination
    );
    assert_eq!(root_counts.lock().unwrap().dropped, 0);
    assert_eq!(child_counts.lock().unwrap().dropped, 1);
    drop(child);
    let mut successor = DownloadManager::new(owner.identity.clone(), owner.clone());
    successor
        .before(41, "next", Box::new(Before(child_counts)), now)
        .unwrap();
    assert!(successor.list(&identity).unwrap()[0].download_id > child_id);
}

#[test]
fn pool_bounds_active_and_history_across_views_and_releases_only_dropped_rows() {
    let (mut root, owner, counts, now) = fixture("database");
    let mut child = DownloadManager::new(owner.identity.clone(), owner.clone());
    for id in 0..MAX_ACTIVE_DOWNLOADS as u32 {
        let manager = if id % 2 == 0 { &mut root } else { &mut child };
        manager
            .before(id, "file", Box::new(Before(counts.clone())), now)
            .unwrap();
    }
    assert!(!root.can_start() && !child.can_start());
    assert_eq!(
        child.before(100, "file", Box::new(Before(counts.clone())), now),
        Err(DownloadError::Limit)
    );
    child.revoke();
    assert!(root.can_start()); // only child's active reservations are released
    root.before(100, "root", Box::new(Before(counts.clone())), now)
        .unwrap();
    assert!(root.current());

    let (mut root, owner, counts, now) = fixture("other-database");
    let mut child = DownloadManager::new(owner.identity.clone(), owner.clone());
    for id in 0..MAX_DOWNLOADS as u32 {
        let manager = if id % 2 == 0 { &mut root } else { &mut child };
        manager
            .before(id, "file", Box::new(Before(counts.clone())), now)
            .unwrap();
        owner
            .prompts
            .lock()
            .unwrap()
            .pop()
            .unwrap()
            .1
            .complete(None);
        assert!(!manager.poll(now));
    }
    let identity = ipc::OriginBrowserIdentity::from_native(&owner.identity);
    assert_eq!(
        root.list(&identity).unwrap().len() + child.list(&identity).unwrap().len(),
        MAX_DOWNLOADS
    );
    assert!(!root.can_start() && !child.can_start());
    drop(child);
    assert!(root.can_start());
    root.before(1000, "file", Box::new(Before(counts)), now)
        .unwrap();
    assert!(root.list(&identity).unwrap().last().unwrap().download_id > MAX_DOWNLOADS as u32);
}

#[test]
fn pool_from_another_attempt_cannot_supply_ids_or_authority() {
    let (_, owner, counts, now) = fixture("database");
    let (_, other, _, _) = fixture("database");
    let mut wrong = DownloadManager::new(other.identity.clone(), owner.clone());
    assert!(!wrong.current());
    assert_eq!(
        wrong.before(1, "file", Box::new(Before(counts)), now),
        Err(DownloadError::OwnerUnavailable)
    );
    assert!(owner.prompts.lock().unwrap().is_empty());
}

#[test]
fn disabled_download_policy_is_an_empty_readable_list_not_a_dead_owner() {
    let (mut manager, owner, counts, now) = fixture("database");
    owner.enabled.store(false, Ordering::Release);
    assert!(manager.current());
    assert!(!manager.can_start());
    let identity = ipc::OriginBrowserIdentity::from_native(&owner.identity);
    assert!(manager.list(&identity).unwrap().is_empty());
    assert_eq!(
        manager.before(1, "file", Box::new(Before(counts.clone())), now),
        Err(DownloadError::ActionUnavailable)
    );
    assert_eq!(
        manager.update(1, progress(), Box::new(Control(counts.clone())), now),
        Err(DownloadError::ActionUnavailable)
    );
    assert!(!manager.poll(now));
    assert!(manager.current());
    assert!(owner.prompts.lock().unwrap().is_empty());
    assert_eq!(counts.lock().unwrap().cancelled, 1);
    assert!(manager.list(&identity).unwrap().is_empty());
    owner.live.store(false, Ordering::Release);
    assert_eq!(
        manager.list(&identity).err(),
        Some(DownloadError::OwnerUnavailable)
    );
}

#[test]
fn rejected_blob_progress_terminates_the_row_and_late_updates_cannot_resurrect_it() {
    let (mut manager, owner, counts, now) = fixture("database");
    manager
        .before(41, "export", Box::new(Before(counts.clone())), now)
        .unwrap();
    approve(&owner);
    manager.poll(now);
    manager
        .update(41, progress(), Box::new(Control(counts.clone())), now)
        .unwrap();
    assert!(download_policy_url(
        "blob:https://fixture.test/export",
        Some("https://other.test/")
    )
    .is_none());
    manager.deny(41, now);
    assert!(!manager.permits_transfer(41));
    assert!(!manager.poll(now));
    assert_eq!(counts.lock().unwrap().cancelled, 1);
    let identity = ipc::OriginBrowserIdentity::from_native(&owner.identity);
    let row = manager.list(&identity).unwrap().pop().unwrap();
    assert_eq!(row.status, DownloadStatus::Cancelled);
    assert!(!row.can_pause && !row.can_resume && !row.can_cancel && !row.can_reveal);
    manager.deny(999, now); // unknown denied metadata never reserves a row
    manager.deny(41, now);
    manager
        .update(
            41,
            DownloadProgress {
                complete: true,
                ..Default::default()
            },
            Box::new(Control(counts)),
            now,
        )
        .unwrap();
    assert_eq!(manager.list(&identity).unwrap().len(), 1);
    assert_eq!(
        manager.list(&identity).unwrap()[0].status,
        DownloadStatus::Cancelled
    );
    assert!(!manager.poll(now));
}

#[test]
fn progress_is_bounded_and_coalesced_and_completion_is_terminal() {
    let (mut manager, owner, counts, now) = fixture("database");
    manager
        .before(1, "file", Box::new(Before(counts.clone())), now)
        .unwrap();
    approve(&owner);
    manager.poll(now);
    let before = owner.events.lock().unwrap().len();
    for _ in 0..100 {
        manager
            .update(
                1,
                DownloadProgress {
                    received: i64::MAX,
                    total: -1,
                    speed: -99,
                    ..progress()
                },
                Box::new(Control(counts.clone())),
                now,
            )
            .unwrap();
    }
    assert_eq!(owner.events.lock().unwrap().len(), before);
    manager.poll(now + PROGRESS_INTERVAL);
    let last = owner.events.lock().unwrap().last().unwrap().clone();
    assert_eq!(last.received_bytes, ipc::MAX_JS_INTEGER);
    assert_eq!(last.total_bytes, None);
    assert_eq!(last.bytes_per_second, 0);
    manager
        .update(
            1,
            DownloadProgress {
                complete: true,
                ..Default::default()
            },
            Box::new(Control(counts.clone())),
            now + PROGRESS_INTERVAL,
        )
        .unwrap();
    assert_eq!(
        owner.events.lock().unwrap().last().unwrap().status,
        DownloadStatus::Completed
    );
    assert_eq!(
        manager.control(&action(&owner, 1, DownloadAction::Resume), now),
        Err(DownloadError::ActionUnavailable)
    );
    manager
        .update(1, progress(), Box::new(Control(counts.clone())), now)
        .unwrap();
    assert_eq!(
        owner.events.lock().unwrap().last().unwrap().status,
        DownloadStatus::Completed
    );
    assert_eq!(counts.lock().unwrap().cancelled, 0);
}

#[test]
fn active_capacity_is_bounded_and_unknown_updates_are_cancelled_at_limit() {
    let (mut manager, owner, counts, now) = fixture("database");
    for id in 0..MAX_ACTIVE_DOWNLOADS as u32 {
        manager
            .before(id, "file", Box::new(Before(counts.clone())), now)
            .unwrap();
    }
    assert_eq!(owner.prompts.lock().unwrap().len(), MAX_ACTIVE_DOWNLOADS);
    assert_eq!(
        manager.before(100, "file", Box::new(Before(counts.clone())), now),
        Err(DownloadError::Limit)
    );
    assert_eq!(
        manager.update(100, progress(), Box::new(Control(counts.clone())), now),
        Err(DownloadError::Limit)
    );
    assert_eq!(counts.lock().unwrap().cancelled, 1);
    manager.revoke();
    assert_eq!(counts.lock().unwrap().dropped, MAX_ACTIVE_DOWNLOADS + 1);
}

#[test]
fn pending_control_cancel_cannot_be_undone_by_dialog_and_drop_cancels_active() {
    let (mut manager, owner, counts, now) = fixture("database");
    manager
        .before(1, "file", Box::new(Before(counts.clone())), now)
        .unwrap();
    let rows = manager
        .list(&action(&owner, 1, DownloadAction::Cancel).identity)
        .unwrap();
    assert_eq!(rows[0].status, DownloadStatus::AwaitingDestination);
    assert!(rows[0].can_cancel);
    assert!(!rows[0].can_pause && !rows[0].can_resume && !rows[0].can_reveal);
    manager
        .control(&action(&owner, 1, DownloadAction::Cancel), now)
        .unwrap();
    approve(&owner);
    assert!(!manager.poll(now));
    assert_eq!(counts.lock().unwrap().saved, 0);
    let rows = manager
        .list(&action(&owner, 1, DownloadAction::Cancel).identity)
        .unwrap();
    assert_eq!(rows[0].status, DownloadStatus::Cancelled);
    assert!(!rows[0].can_cancel);
    manager
        .before(2, "file", Box::new(Before(counts.clone())), now)
        .unwrap();
    approve(&owner);
    manager.poll(now);
    manager
        .update(2, progress(), Box::new(Control(counts.clone())), now)
        .unwrap();
    drop(manager);
    assert_eq!(counts.lock().unwrap().cancelled, 1);
}

#[test]
fn filenames_and_destinations_are_bounded_and_do_not_accept_renderer_authority() {
    for (input, expected) in [
        ("../../secret/report.pdf", "report.pdf"),
        ("C:\\secret\\CON.txt", "_CON.txt"),
        ("...", "download"),
        ("a\u{202e}\n:b?.txt", "a_b_.txt"),
    ] {
        assert_eq!(suggested_file_name(input), expected);
    }
    assert!(suggested_file_name(&"é".repeat(500)).chars().count() <= 121);
    assert_eq!(suggested_file_name(&"a".repeat(5000)), "download");
    assert!(SaveDestination::from_dialog(PathBuf::from("relative.txt")).is_none());
    assert!(SaveDestination::from_dialog(std::env::temp_dir()).is_none());
    assert!(SaveDestination::from_dialog(std::env::temp_dir().join("..").join("file")).is_none());
    let (_, owner, _, _) = fixture("database");
    let identity =
        serde_json::to_value(ipc::OriginBrowserIdentity::from_native(&owner.identity)).unwrap();
    for extra in ["path", "url", "credentials", "ownerWindow", "route"] {
        let mut value =
            serde_json::json!({"identity": identity, "downloadId": 1, "action": "cancel"});
        value[extra] = serde_json::json!("secret");
        assert!(serde_json::from_value::<DownloadControlRequest>(value).is_err());
    }
    let request: DownloadListRequest =
        serde_json::from_value(serde_json::json!({"identity": identity})).unwrap();
    assert!(ipc::ValidateOriginBrowserRequest::validate(&request).is_ok());
}

#[test]
fn events_expose_only_reviewed_fields_and_never_paths_or_urls() {
    let (mut manager, owner, counts, now) = fixture("database");
    manager
        .before(77, "C:\\private\\file.pdf", Box::new(Before(counts)), now)
        .unwrap();
    let event = serde_json::to_value(owner.events.lock().unwrap().last().unwrap()).unwrap();
    assert_eq!(event.as_object().unwrap().len(), 12);
    assert_eq!(event["fileName"], "file.pdf");
    assert_eq!(event["downloadId"], 1);
    assert_eq!(event["status"], "awaiting-destination");
    let text = event.to_string();
    for secret in [
        "private", "https:", "path", "url", "password", "cookie", "header",
    ] {
        assert!(!text.contains(secret));
    }
    assert_eq!(ORIGIN_BROWSER_DOWNLOAD_EVENT, "origin-browser-download");
    assert!(SAVE_TIMEOUT < Duration::from_secs(180));
}

#[test]
fn reveal_is_completed_only_owner_scoped_and_uses_the_private_dialog_destination() {
    let (mut manager, owner, counts, now) = fixture("database");
    manager
        .before(75, "file", Box::new(Before(counts.clone())), now)
        .unwrap();
    assert_eq!(
        manager.control(&action(&owner, 1, DownloadAction::Reveal), now),
        Err(DownloadError::ActionUnavailable)
    );
    approve(&owner);
    manager.poll(now);
    assert_eq!(
        manager.control(&action(&owner, 1, DownloadAction::Reveal), now),
        Err(DownloadError::ActionUnavailable)
    );
    manager
        .update(
            75,
            DownloadProgress {
                complete: true,
                ..Default::default()
            },
            Box::new(Control(counts)),
            now,
        )
        .unwrap();
    let rows = manager
        .list(&action(&owner, 1, DownloadAction::Reveal).identity)
        .unwrap();
    assert!(rows[0].can_reveal);
    assert!(!rows[0].can_cancel && !rows[0].can_pause && !rows[0].can_resume);
    let mut wrong = action(&owner, 1, DownloadAction::Reveal);
    wrong.identity.owner_database_id = "other".into();
    assert_eq!(
        manager.control(&wrong, now),
        Err(DownloadError::OwnerUnavailable)
    );
    assert!(owner.revealed.lock().unwrap().is_empty());
    manager
        .control(&action(&owner, 1, DownloadAction::Reveal), now)
        .unwrap();
    assert_eq!(
        owner.revealed.lock().unwrap().as_slice(),
        &[destination().path()]
    );
    manager.revoke();
    assert_eq!(
        manager.control(&action(&owner, 1, DownloadAction::Reveal), now),
        Err(DownloadError::OwnerUnavailable)
    );
    assert_eq!(owner.revealed.lock().unwrap().len(), 1);
}

#[test]
fn interruption_never_advertises_unproven_resume_or_reveal() {
    let (mut manager, owner, counts, now) = fixture("database");
    manager
        .before(1, "file", Box::new(Before(counts.clone())), now)
        .unwrap();
    approve(&owner);
    manager.poll(now);
    manager
        .update(
            1,
            DownloadProgress {
                interrupted: true,
                ..Default::default()
            },
            Box::new(Control(counts.clone())),
            now,
        )
        .unwrap();
    let rows = manager
        .list(&action(&owner, 1, DownloadAction::Resume).identity)
        .unwrap();
    assert_eq!(rows[0].status, DownloadStatus::Interrupted);
    assert!(
        !rows[0].can_cancel && !rows[0].can_pause && !rows[0].can_resume && !rows[0].can_reveal
    );
    assert_eq!(
        manager.control(&action(&owner, 1, DownloadAction::Resume), now),
        Err(DownloadError::ActionUnavailable)
    );
    assert_eq!(counts.lock().unwrap().resumed, 0);
}

#[test]
fn disabled_owner_and_total_metadata_limit_never_start_an_untracked_download() {
    let (mut manager, owner, counts, now) = fixture("database");
    owner.live.store(false, Ordering::Release);
    assert!(!manager.can_start());
    assert_eq!(
        manager.before(1, "file", Box::new(Before(counts.clone())), now),
        Err(DownloadError::OwnerUnavailable)
    );
    assert!(owner.prompts.lock().unwrap().is_empty());
    assert_eq!(counts.lock().unwrap().saved, 0);

    let (mut manager, owner, counts, now) = fixture("database");
    for cef_id in 0..MAX_DOWNLOADS as u32 {
        manager
            .before(cef_id, "file", Box::new(Before(counts.clone())), now)
            .unwrap();
        let (_, decision) = owner.prompts.lock().unwrap().pop().unwrap();
        decision.complete(None);
        manager.poll(now);
    }
    assert!(!manager.can_start());
    assert_eq!(
        manager.before(
            MAX_DOWNLOADS as u32,
            "file",
            Box::new(Before(counts.clone())),
            now
        ),
        Err(DownloadError::Limit)
    );
    assert_eq!(
        manager
            .list(&action(&owner, 1, DownloadAction::Cancel).identity)
            .unwrap()
            .len(),
        MAX_DOWNLOADS
    );
    assert_eq!(counts.lock().unwrap().saved, 0);
}

#[test]
fn blob_exports_require_the_real_document_creator_origin_and_never_become_fetches() {
    assert_eq!(
        download_policy_url(
            "blob:https://exports.test/8f741e20-file",
            Some("https://exports.test/export")
        ),
        Some("https://exports.test/".into())
    );
    assert_eq!(
        download_policy_url(
            "blob:http://exports.test:8080/id",
            Some("http://exports.test:8080/export")
        ),
        Some("http://exports.test:8080/".into())
    );
    assert_eq!(
        download_policy_url(
            "blob:https://exports.test:443/id",
            Some("https://exports.test/page")
        ),
        Some("https://exports.test/".into())
    );
    for target in [
        "blob:null/id",
        "blob:file:///tmp/id",
        "blob:data:secret",
        "blob:blob:https://exports.test/id",
        "blob:https://other.test/id",
        "blob:http://exports.test/id",
        "blob:https://exports.test:8443/id",
        "blob:https://user:secret@exports.test/id",
        "blob:https://exports.test/",
        "data:text/plain,export",
        "file:///tmp/export",
        "javascript:download()",
    ] {
        assert!(
            download_policy_url(target, Some("https://exports.test/export")).is_none(),
            "{target}"
        );
    }
    for document in [
        None,
        Some("about:blank"),
        Some("data:text/html,page"),
        Some("blob:https://exports.test/id"),
        Some("https://other.test/"),
    ] {
        assert!(download_policy_url("blob:https://exports.test/id", document).is_none());
    }
    assert_eq!(
        download_policy_url("https://exports.test/report?native-only=value", None),
        Some("https://exports.test/report?native-only=value".into())
    );
    assert!(download_policy_url("https://user:secret@exports.test/report", None).is_none());
}
