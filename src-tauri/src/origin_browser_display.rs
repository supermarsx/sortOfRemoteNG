//! CEF-free owner-window publication boundary. Never retain private page state
//! after observed revocation and never call an emitter with snapshot locks held.
use sorng_browser_host::ipc::{OriginBrowserPageState, OriginBrowserPhase, OriginBrowserSnapshot};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::sync::Mutex;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Publication {
    Published,
    IgnoredSequence,
    OwnerUnavailable,
    Failed,
}

pub(super) fn scrub_retained(snapshot: &Mutex<OriginBrowserSnapshot>) {
    snapshot
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .scrub_page_state();
}

pub(super) fn publish(
    snapshot: &Mutex<OriginBrowserSnapshot>,
    identity: &BrowserIdentity,
    sequence: u64,
    phase: OriginBrowserPhase,
    page: OriginBrowserPageState<'_>,
    mut current: impl FnMut() -> bool,
    emit: impl FnOnce(OriginBrowserSnapshot) -> bool,
) -> Publication {
    let terminal = matches!(
        phase,
        OriginBrowserPhase::Closing | OriginBrowserPhase::Closed | OriginBrowserPhase::Failed
    );
    if !terminal && !current() {
        scrub_retained(snapshot);
        return Publication::OwnerUnavailable;
    }
    // Do not even copy/validate a terminal event's untrusted private payload.
    let page = if terminal {
        OriginBrowserPageState {
            url: "",
            title: "",
            loading: false,
            can_go_back: false,
            can_go_forward: false,
        }
    } else {
        page
    };
    let Ok(mut next) = OriginBrowserSnapshot::new(identity, sequence, phase, page) else {
        scrub_retained(snapshot);
        return Publication::Failed;
    };
    {
        let mut previous = match snapshot.lock() {
            Ok(previous) => previous,
            Err(error) => {
                // Recover only to clear data, never to resume publication.
                error.into_inner().scrub_page_state();
                return Publication::Failed;
            }
        };
        // Revoke can have cleared the retained snapshot after the entry check.
        // Test under this lock before any replacement could restore page data.
        if terminal {
            previous.scrub_page_state();
        } else if !current() {
            previous.scrub_page_state();
            return Publication::OwnerUnavailable;
        }
        if next.sequence() <= previous.sequence() {
            return Publication::IgnoredSequence;
        }
        *previous = next.clone();
    }
    // Recheck at the dispatch boundary, after retention and outside its lock.
    // Terminal lifecycle notifications remain useful, but must stay scrubbed.
    if !current() {
        scrub_retained(snapshot);
        next.scrub_page_state();
        if !terminal {
            return Publication::OwnerUnavailable;
        }
    }
    if !emit(next) {
        scrub_retained(snapshot);
        return Publication::Failed;
    }
    Publication::Published
}
