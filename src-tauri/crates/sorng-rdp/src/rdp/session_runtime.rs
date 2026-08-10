use tokio::sync::{watch, OwnedSemaphorePermit};

/// Monotonic identity for one concrete RDP worker occupying a connection record.
/// Cleanup always compares this generation before mutating the registry so a
/// late completion from an older worker cannot remove its replacement.
pub type RdpWorkerGeneration = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RdpWorkerLifecycle {
    Running,
    Closing,
}

/// Cloneable completion signal for a blocking RDP worker.
///
/// Completion is published only after the worker-owned admission permit has
/// been released (see `RdpWorkerLease::drop`).
#[derive(Clone)]
pub(crate) struct RdpWorkerCompletion {
    receiver: watch::Receiver<bool>,
}

impl RdpWorkerCompletion {
    pub fn is_complete(&self) -> bool {
        *self.receiver.borrow()
    }

    pub async fn wait(&self) {
        let mut receiver = self.receiver.clone();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                return;
            }
        }
    }
}

/// RAII state moved into the actual `spawn_blocking` worker.
///
/// Keeping the semaphore permit here, rather than in the registry record,
/// makes admission account for detached, slow, and panicking workers until
/// their closure has genuinely finished.
struct RdpWorkerLease {
    session_slot: Option<OwnedSemaphorePermit>,
    completion_sender: Option<watch::Sender<bool>>,
}

impl Drop for RdpWorkerLease {
    fn drop(&mut self) {
        // Permit conservation is the primary invariant: capacity becomes
        // available before waiters are told that this worker is complete.
        drop(self.session_slot.take());
        if let Some(sender) = self.completion_sender.take() {
            let _ = sender.send(true);
        }
    }
}

fn bind_rdp_worker_lifetime(
    session_slot: OwnedSemaphorePermit,
) -> (RdpWorkerLease, RdpWorkerCompletion) {
    let (completion_sender, receiver) = watch::channel(false);
    (
        RdpWorkerLease {
            session_slot: Some(session_slot),
            completion_sender: Some(completion_sender),
        },
        RdpWorkerCompletion { receiver },
    )
}

#[derive(Clone)]
pub(crate) struct RdpWorkerCloseTicket {
    pub generation: RdpWorkerGeneration,
    pub completion: RdpWorkerCompletion,
    pub first_request: bool,
}

/// Registry-side metadata for one worker. The admission permit intentionally
/// does not live here; dropping a connection record must never free capacity
/// while its blocking worker is still running.
pub struct RdpWorkerRuntime {
    generation: RdpWorkerGeneration,
    lifecycle: RdpWorkerLifecycle,
    completion: RdpWorkerCompletion,
    _handle: tokio::task::JoinHandle<()>,
}

impl RdpWorkerRuntime {
    fn new(
        generation: RdpWorkerGeneration,
        completion: RdpWorkerCompletion,
        handle: tokio::task::JoinHandle<()>,
    ) -> Self {
        Self {
            generation,
            lifecycle: RdpWorkerLifecycle::Running,
            completion,
            _handle: handle,
        }
    }

    /// Spawn one blocking worker with its admission permit bound to the
    /// closure. Callers cannot retain or transfer the permit separately from
    /// the actual worker lifetime.
    pub fn spawn_blocking<F>(
        generation: RdpWorkerGeneration,
        session_slot: OwnedSemaphorePermit,
        worker: F,
    ) -> Self
    where
        F: FnOnce() + Send + 'static,
    {
        let (worker_lease, completion) = bind_rdp_worker_lifetime(session_slot);
        let handle = tokio::task::spawn_blocking(move || {
            let _worker_lease = worker_lease;
            worker();
        });
        Self::new(generation, completion, handle)
    }

    pub fn generation(&self) -> RdpWorkerGeneration {
        self.generation
    }

    pub fn lifecycle(&self) -> RdpWorkerLifecycle {
        self.lifecycle
    }

    pub fn is_complete(&self) -> bool {
        self.completion.is_complete()
    }

    #[cfg(test)]
    pub(crate) fn completion(&self) -> RdpWorkerCompletion {
        self.completion.clone()
    }

    pub(crate) fn request_close(&mut self) -> RdpWorkerCloseTicket {
        let first_request = self.lifecycle == RdpWorkerLifecycle::Running;
        self.lifecycle = RdpWorkerLifecycle::Closing;
        RdpWorkerCloseTicket {
            generation: self.generation,
            completion: self.completion.clone(),
            first_request,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::Duration;
    use tokio::sync::Semaphore;

    const CAPACITY: usize = 16;

    #[derive(Default)]
    struct BlockingGate {
        open: Mutex<bool>,
        changed: Condvar,
    }

    impl BlockingGate {
        fn wait(&self) {
            let mut open = self.open.lock().expect("gate mutex poisoned");
            while !*open {
                open = self.changed.wait(open).expect("gate mutex poisoned");
            }
        }

        fn open(&self) {
            *self.open.lock().expect("gate mutex poisoned") = true;
            self.changed.notify_all();
        }
    }

    async fn wait_for_count(counter: &AtomicUsize, expected: usize) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while counter.load(Ordering::Acquire) != expected {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("fake workers did not reach expected count");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn worker_owned_permits_bound_blocked_churn_and_restore_capacity() {
        for reconnect_attempts in [100_usize, 500, 1_000] {
            let slots = Arc::new(Semaphore::new(CAPACITY));
            let gate = Arc::new(BlockingGate::default());
            let live_workers = Arc::new(AtomicUsize::new(0));
            let mut completions = Vec::with_capacity(CAPACITY);
            let mut handles = Vec::with_capacity(CAPACITY);

            for _ in 0..CAPACITY {
                let permit = Arc::clone(&slots)
                    .try_acquire_owned()
                    .expect("capacity should admit the initial workers");
                let (worker_lease, completion) = bind_rdp_worker_lifetime(permit);
                completions.push(completion);

                let worker_gate = Arc::clone(&gate);
                let worker_count = Arc::clone(&live_workers);
                handles.push(tokio::task::spawn_blocking(move || {
                    let _worker_lease = worker_lease;
                    worker_count.fetch_add(1, Ordering::AcqRel);
                    worker_gate.wait();
                    worker_count.fetch_sub(1, Ordering::AcqRel);
                }));
            }

            wait_for_count(&live_workers, CAPACITY).await;
            assert_eq!(slots.available_permits(), 0);
            assert_eq!(
                slots.available_permits() + live_workers.load(Ordering::Acquire),
                CAPACITY
            );

            for _ in 0..reconnect_attempts {
                assert!(Arc::clone(&slots).try_acquire_owned().is_err());
                assert!(live_workers.load(Ordering::Acquire) <= CAPACITY);
                assert_eq!(
                    slots.available_permits() + live_workers.load(Ordering::Acquire),
                    CAPACITY
                );
            }

            gate.open();
            for completion in completions {
                tokio::time::timeout(Duration::from_secs(2), completion.wait())
                    .await
                    .expect("worker completion should be published");
            }
            for handle in handles {
                handle.await.expect("fake worker should not panic");
            }

            assert_eq!(live_workers.load(Ordering::Acquire), 0);
            assert_eq!(slots.available_permits(), CAPACITY);
        }
    }

    #[tokio::test]
    async fn close_requests_are_idempotent_and_completion_follows_permit_release() {
        let slots = Arc::new(Semaphore::new(1));
        let permit = Arc::clone(&slots)
            .try_acquire_owned()
            .expect("initial permit should be available");
        let mut runtime = RdpWorkerRuntime::spawn_blocking(7, permit, || {});
        let completion = runtime.completion();

        let first = runtime.request_close();
        let duplicate = runtime.request_close();
        assert!(first.first_request);
        assert!(!duplicate.first_request);
        assert_eq!(first.generation, duplicate.generation);

        completion.wait().await;
        assert_eq!(slots.available_permits(), 1);
        assert!(runtime.is_complete());
    }
}
