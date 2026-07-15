//! Per-session control primitives for cancellable remoting operations.
//!
//! A Tauri command must not hold the service-wide mutex while it waits on
//! network I/O. These handles use a bounded channel so cancellation can reach
//! the owning session task independently. The eventual PSRP engine can run one
//! mailbox per runspace and pass the cancellation token into its transport.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Notify};

#[derive(Debug)]
struct PsCancellationState {
    cancelled: AtomicBool,
    notify: Notify,
}

/// Cloneable cancellation signal that does not require a mutex.
#[derive(Debug, Clone)]
pub struct PsCancellationToken {
    state: Arc<PsCancellationState>,
}

impl PsCancellationToken {
    pub fn new() -> Self {
        Self {
            state: Arc::new(PsCancellationState {
                cancelled: AtomicBool::new(false),
                notify: Notify::new(),
            }),
        }
    }

    /// Request cancellation. Returns `true` only for the first request.
    pub fn cancel(&self) -> bool {
        let first = !self.state.cancelled.swap(true, Ordering::AcqRel);
        if first {
            self.state.notify.notify_waiters();
        }
        first
    }

    pub fn is_cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::Acquire)
    }

    /// Wait until cancellation is requested without losing a notification to
    /// the check/wait race.
    pub async fn cancelled(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            let notified = self.state.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

impl Default for PsCancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PsCancelOutcome {
    Requested,
    NotRunning,
}

#[derive(Debug)]
enum PsSessionControl {
    CancelInvocation {
        invocation_id: String,
        reply: oneshot::Sender<PsCancelOutcome>,
    },
    Shutdown {
        reply: oneshot::Sender<()>,
    },
}

/// Cheap cloneable control path retained outside the session task.
#[derive(Debug, Clone)]
pub struct PsSessionActorHandle {
    session_id: String,
    control_tx: mpsc::Sender<PsSessionControl>,
}

impl PsSessionActorHandle {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Request cancellation without acquiring the service or transport lock.
    pub async fn cancel_invocation(
        &self,
        invocation_id: impl Into<String>,
    ) -> Result<PsCancelOutcome, String> {
        let (reply, response) = oneshot::channel();
        self.control_tx
            .send(PsSessionControl::CancelInvocation {
                invocation_id: invocation_id.into(),
                reply,
            })
            .await
            .map_err(|_| format!("PowerShell session actor '{}' is closed", self.session_id))?;
        response.await.map_err(|_| {
            format!(
                "PowerShell session actor '{}' dropped cancellation",
                self.session_id
            )
        })
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        let (reply, response) = oneshot::channel();
        self.control_tx
            .send(PsSessionControl::Shutdown { reply })
            .await
            .map_err(|_| format!("PowerShell session actor '{}' is closed", self.session_id))?;
        response.await.map_err(|_| {
            format!(
                "PowerShell session actor '{}' dropped shutdown",
                self.session_id
            )
        })
    }
}

/// Receiver owned exclusively by one session/runspace task.
#[derive(Debug)]
pub struct PsSessionActorMailbox {
    session_id: String,
    control_rx: mpsc::Receiver<PsSessionControl>,
}

impl PsSessionActorMailbox {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Run one invocation while continuing to service cancellation messages.
    ///
    /// The operation receives a token it must observe and translate into the
    /// transport's stop primitive. This keeps network I/O inside the session
    /// task while the public handle remains responsive.
    pub async fn run_invocation<T, Build, Operation>(
        &mut self,
        invocation_id: impl Into<String>,
        build_operation: Build,
    ) -> Result<T, String>
    where
        Build: FnOnce(PsCancellationToken) -> Operation,
        Operation: Future<Output = Result<T, String>>,
    {
        let invocation_id = invocation_id.into();
        let cancellation = PsCancellationToken::new();
        let mut operation = Box::pin(build_operation(cancellation.clone()));
        let mut controls_open = true;

        loop {
            tokio::select! {
                result = &mut operation => return result,
                control = self.control_rx.recv(), if controls_open => {
                    match control {
                        Some(PsSessionControl::CancelInvocation { invocation_id: requested, reply }) => {
                            let outcome = if requested == invocation_id {
                                cancellation.cancel();
                                PsCancelOutcome::Requested
                            } else {
                                PsCancelOutcome::NotRunning
                            };
                            let _ = reply.send(outcome);
                        }
                        Some(PsSessionControl::Shutdown { reply }) => {
                            cancellation.cancel();
                            let _ = reply.send(());
                            return Err(format!("PowerShell session actor '{}' was shut down", self.session_id));
                        }
                        None => controls_open = false,
                    }
                }
            }
        }
    }
}

/// Create the independent control handle and session-owned mailbox.
pub fn ps_session_actor_channel(
    session_id: impl Into<String>,
    capacity: usize,
) -> (PsSessionActorHandle, PsSessionActorMailbox) {
    let session_id = session_id.into();
    let (control_tx, control_rx) = mpsc::channel(capacity.max(1));
    (
        PsSessionActorHandle {
            session_id: session_id.clone(),
            control_tx,
        },
        PsSessionActorMailbox {
            session_id,
            control_rx,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn cancellation_token_wakes_without_a_mutex() {
        let token = PsCancellationToken::new();
        let waiter = token.clone();
        let task = tokio::spawn(async move {
            waiter.cancelled().await;
            waiter.is_cancelled()
        });

        assert!(token.cancel());
        assert!(!token.cancel());
        assert!(task.await.unwrap());
    }

    #[tokio::test]
    async fn actor_processes_cancel_while_operation_is_waiting() {
        let (handle, mut mailbox) = ps_session_actor_channel("session-1", 4);
        let task = tokio::spawn(async move {
            mailbox
                .run_invocation("invocation-1", |token| async move {
                    token.cancelled().await;
                    Ok::<_, String>("cancel-observed")
                })
                .await
        });

        tokio::task::yield_now().await;
        let outcome = tokio::time::timeout(
            Duration::from_secs(1),
            handle.cancel_invocation("invocation-1"),
        )
        .await
        .expect("cancel handle stayed responsive")
        .unwrap();
        assert_eq!(outcome, PsCancelOutcome::Requested);
        assert_eq!(task.await.unwrap().unwrap(), "cancel-observed");
    }

    #[tokio::test]
    async fn actor_rejects_cancel_for_an_unrelated_invocation() {
        let (handle, mut mailbox) = ps_session_actor_channel("session-1", 4);
        let task = tokio::spawn(async move {
            mailbox
                .run_invocation("running", |token| async move {
                    token.cancelled().await;
                    Ok::<_, String>(())
                })
                .await
        });

        assert_eq!(
            handle.cancel_invocation("other").await.unwrap(),
            PsCancelOutcome::NotRunning
        );
        assert_eq!(
            handle.cancel_invocation("running").await.unwrap(),
            PsCancelOutcome::Requested
        );
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn shutdown_interrupts_the_owned_operation() {
        let (handle, mut mailbox) = ps_session_actor_channel("session-1", 1);
        let task = tokio::spawn(async move {
            mailbox
                .run_invocation("running", |_token| async move {
                    std::future::pending::<Result<(), String>>().await
                })
                .await
        });

        handle.shutdown().await.unwrap();
        let error = task.await.unwrap().unwrap_err();
        assert!(error.contains("shut down"));
    }
}
