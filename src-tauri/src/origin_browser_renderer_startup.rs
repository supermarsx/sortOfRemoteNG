//! Preserve an exact attempt's observed renderer failure through its cleanup.
//! This reports failure only; it never establishes readiness or owner authority.
use std::sync::atomic::{AtomicU8, Ordering};

const PENDING: u8 = 0;
const RENDERER_FAILED: u8 = 1;
const FINISHED: u8 = 2;

#[derive(Default)]
pub(crate) struct RendererStartup {
    state: AtomicU8,
}

pub(crate) struct StartState {
    pub current: bool,
    pub runtime_ready: bool,
    pub document_current: bool,
    pub ordinary_close: bool,
    pub response_open: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    Continue,
    Stale,
    RendererFailed,
}

impl RendererStartup {
    /// The caller has matched the native event identity. Capture only while
    /// its owner is current, before renderer cleanup revokes that same lease.
    pub(crate) fn observe_renderer_failure(&self, owner_current: bool) {
        if owner_current {
            let _ = self.state.compare_exchange(
                PENDING,
                RENDERER_FAILED,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        }
    }

    pub(crate) fn decision(&self, state: StartState) -> Decision {
        if !state.runtime_ready
            || !state.document_current
            || state.ordinary_close
            || !state.response_open
        {
            self.finish();
            return Decision::Stale;
        }
        // Own failure cleanup makes `current` false. That must not erase an
        // already verified fixed cause and replace it with generic staleness.
        let observed = self.state.load(Ordering::Acquire);
        if observed == FINISHED {
            return Decision::Stale;
        }
        if observed == RENDERER_FAILED {
            self.finish();
            return Decision::RendererFailed;
        }
        if !state.current {
            self.finish();
            return Decision::Stale;
        }
        Decision::Continue
    }

    /// A completed startup cannot acquire a failure from a later document.
    pub(crate) fn finish(&self) {
        self.state.store(FINISHED, Ordering::Release);
    }
}
