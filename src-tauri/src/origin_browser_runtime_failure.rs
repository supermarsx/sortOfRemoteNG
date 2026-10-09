//! Bounded process-wide engine evidence, independent of admission and disk IO.
//! A retry/readiness reset invalidates old producers; per-view failures have no
//! entry point here. The wire payload can contain only two fixed enums.
use sorng_browser_host::ipc::{
    OriginBrowserRuntimeFailure as RuntimeFailure, OriginBrowserRuntimeFailureCode as Code,
    OriginBrowserRuntimeFailureStage as Stage,
};
use std::sync::Mutex;

struct State {
    generation: u64,
    stage: Stage,
    failure: Option<RuntimeFailure>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            generation: 0,
            stage: Stage::Preparing,
            failure: None,
        }
    }
}

#[derive(Default)]
pub(crate) struct RuntimeFailureStore(Mutex<State>);

#[derive(Clone, Copy)]
pub(crate) struct StartupFailureScope<'a> {
    store: &'a RuntimeFailureStore,
    generation: u64,
}

impl RuntimeFailureStore {
    /// Only the holder of the existing startup permit begins a new generation.
    pub(crate) fn begin(&self) -> StartupFailureScope<'_> {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        state.generation = state.generation.wrapping_add(1);
        state.stage = Stage::Preparing;
        state.failure = None;
        StartupFailureScope {
            store: self,
            generation: state.generation,
        }
    }

    pub(crate) fn ready_if(&self, ready: impl FnOnce() -> bool) {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if ready() {
            state.generation = state.generation.wrapping_add(1);
            state.stage = Stage::PolicyReadback;
            state.failure = None;
        }
    }

    /// Actual global runtime faults only, never owner cancellation or shutdown.
    /// Preserve the first cause when cleanup produces a secondary failure.
    pub(crate) fn record_current(&self, code: Code) {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let stage = state.stage;
        state.failure.get_or_insert(RuntimeFailure { code, stage });
    }

    pub(crate) fn snapshot(&self) -> Option<RuntimeFailure> {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .failure
    }
}

impl StartupFailureScope<'_> {
    pub(crate) fn stage(self, stage: Stage) {
        let mut state = self
            .store
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.generation == self.generation {
            state.stage = stage;
        }
    }

    pub(crate) fn record(self, code: Code) {
        let mut state = self
            .store
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.generation == self.generation {
            let stage = state.stage;
            state.failure.get_or_insert(RuntimeFailure { code, stage });
        }
    }
}
