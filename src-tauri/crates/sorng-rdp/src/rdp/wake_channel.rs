//! Wake-signaled command channel for the RDP session loop.
//!
//! Wraps a `tokio::sync::mpsc::UnboundedSender/Receiver<RdpCommand>` with a
//! TCP socketpair "wake pipe".  When the sender enqueues a command it also
//! writes 1 byte to the pipe, allowing the session loop to `poll()` on both
//! the RDP TCP socket AND the wake pipe simultaneously — no timeout polling.

use crate::rdp::types::RdpCommand;
use std::collections::VecDeque;
use std::fmt;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};

/// Hard process-local bound for commands accepted but not yet handled by one
/// RDP session. The permit travels with a command while handshake/backoff
/// checkpoints defer it, so moving a command out of the channel never opens an
/// unbounded second queue.
pub const MAX_PENDING_COMMANDS: usize = 256;

/// Hard retained-memory weight for one session's accepted regular commands.
/// The service admits at most 16 active-or-starting RDP workers, bounding the
/// process-wide queued command payload to 256 MiB even when every session is
/// saturated. Keep the resource-budget regression below synchronized with the
/// service admission limit if either constant changes.
pub const MAX_PENDING_COMMAND_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeSendError {
    Closed,
    Full,
}

impl fmt::Display for WakeSendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => formatter.write_str("RDP command channel is closed"),
            Self::Full => formatter.write_str("RDP command queue is full"),
        }
    }
}

impl std::error::Error for WakeSendError {}

struct QueuedCommand {
    command: RdpCommand,
    _permit: WakeCommandPermit,
}

/// One slot in the bounded regular-command budget. Callers that must perform
/// related state changes before making a command observable can reserve first,
/// then enqueue with [`WakeSender::send_reserved`].
pub struct WakeCommandPermit {
    _count: OwnedSemaphorePermit,
    _bytes: OwnedSemaphorePermit,
    byte_weight: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointStatus {
    Continue,
    Shutdown,
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CheckpointReport {
    pub status: CheckpointStatus,
    /// Input is transient across transport checkpoints: replaying stale keys or
    /// clicks after reconnect could target a different remote screen.
    pub dropped_input_events: u64,
}

fn regular_command_byte_weight(command: &RdpCommand) -> usize {
    let dynamic = match command {
        RdpCommand::Input(events) => events.len().saturating_mul(std::mem::size_of::<
            crate::ironrdp::pdu::input::fast_path::FastPathInputEvent,
        >()),
        RdpCommand::ClipboardCopy(text) => text.len(),
        RdpCommand::ClipboardCopyFiles(entries) => entries.iter().fold(
            entries
                .len()
                .saturating_mul(std::mem::size_of::<crate::rdp::types::ClipboardFileEntry>()),
            |total, entry| {
                total
                    .saturating_add(entry.name.len())
                    .saturating_add(entry.path.len())
            },
        ),
        RdpCommand::ToggleFeature { feature, .. } => feature.len(),
        _ => 0,
    };
    std::mem::size_of::<RdpCommand>()
        .saturating_add(dynamic)
        .max(1)
}

// ─── Wake pipe (cross-platform TCP socketpair) ──────────────────────────

/// Create a connected TCP socketpair on localhost for use as a wake pipe.
/// Both ends are set to non-blocking.
pub fn create_wake_pair() -> io::Result<(TcpStream, TcpStream)> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;
    let writer = TcpStream::connect(addr)?;
    let (reader, _) = listener.accept()?;
    reader.set_nonblocking(true)?;
    writer.set_nonblocking(true)?;
    Ok((reader, writer))
}

// ─── WakeSender ─────────────────────────────────────────────────────────

/// A command sender that signals a wake pipe whenever a command is enqueued.
/// Thread-safe: can be cloned and shared across tokio tasks.
pub struct WakeSender {
    inner: mpsc::UnboundedSender<QueuedCommand>,
    wake_writer: Arc<std::sync::Mutex<TcpStream>>,
    signaled: Arc<AtomicBool>,
    shutdown_requested: Arc<AtomicBool>,
    activity_changed: Arc<AtomicBool>,
    pending_command_permits: Arc<Semaphore>,
    pending_byte_permits: Arc<Semaphore>,
}

impl WakeSender {
    fn new(
        inner: mpsc::UnboundedSender<QueuedCommand>,
        wake_writer: TcpStream,
        signaled: Arc<AtomicBool>,
        shutdown_requested: Arc<AtomicBool>,
        activity_changed: Arc<AtomicBool>,
        pending_command_permits: Arc<Semaphore>,
        pending_byte_permits: Arc<Semaphore>,
    ) -> Self {
        Self {
            inner,
            wake_writer: Arc::new(std::sync::Mutex::new(wake_writer)),
            signaled,
            shutdown_requested,
            activity_changed,
            pending_command_permits,
            pending_byte_permits,
        }
    }

    /// Send a command and signal the session loop to wake up.
    pub fn send(&self, command: RdpCommand) -> Result<(), WakeSendError> {
        // Shutdown is a control-plane fence, not backlog. It must remain
        // deliverable even when all regular command permits are occupied.
        if matches!(&command, RdpCommand::Shutdown) {
            self.shutdown_requested.store(true, Ordering::Release);
            self.signal();
            return Ok(());
        }
        // Activity state lives in the shared authority. Only one wake edge is
        // needed no matter how many revisions arrive before the worker can
        // reconcile it, and normal queue saturation must never block it.
        if matches!(&command, RdpCommand::ActivityChanged) {
            if self.inner.is_closed() {
                return Err(WakeSendError::Closed);
            }
            self.activity_changed.store(true, Ordering::Release);
            self.signal();
            return Ok(());
        }

        let permit = self.reserve_regular_command(&command)?;
        self.send_reserved(command, permit)
    }

    /// Wake the session loop without enqueueing a command. Used when shared
    /// state (such as frame-delivery credits) changed out of band.
    pub fn wake_session_loop(&self) {
        self.signal();
    }

    /// Reserve capacity for one regular command without publishing it yet.
    /// Out-of-band commands (`Shutdown` and `ActivityChanged`) do not consume
    /// this budget and must be sent through [`WakeSender::send`].
    pub fn reserve_regular_command(
        &self,
        command: &RdpCommand,
    ) -> Result<WakeCommandPermit, WakeSendError> {
        if self.inner.is_closed() {
            return Err(WakeSendError::Closed);
        }
        let byte_weight = regular_command_byte_weight(command);
        let byte_weight_u32 = u32::try_from(byte_weight)
            .ok()
            .filter(|weight| (*weight as usize) <= MAX_PENDING_COMMAND_BYTES)
            .ok_or(WakeSendError::Full)?;
        let count_permit = Arc::clone(&self.pending_command_permits)
            .try_acquire_owned()
            .map_err(|_| WakeSendError::Full)?;
        let byte_permit = Arc::clone(&self.pending_byte_permits)
            .try_acquire_many_owned(byte_weight_u32)
            .map_err(|_| WakeSendError::Full)?;
        if self.inner.is_closed() {
            return Err(WakeSendError::Closed);
        }
        Ok(WakeCommandPermit {
            _count: count_permit,
            _bytes: byte_permit,
            byte_weight,
        })
    }

    /// Publish a regular command using capacity reserved earlier.
    pub fn send_reserved(
        &self,
        command: RdpCommand,
        permit: WakeCommandPermit,
    ) -> Result<(), WakeSendError> {
        if matches!(&command, RdpCommand::Shutdown | RdpCommand::ActivityChanged) {
            drop(permit);
            return self.send(command);
        }
        if regular_command_byte_weight(&command) > permit.byte_weight {
            return Err(WakeSendError::Full);
        }
        self.inner
            .send(QueuedCommand {
                command,
                _permit: permit,
            })
            .map_err(|_| WakeSendError::Closed)?;
        self.signal();
        Ok(())
    }

    fn signal(&self) {
        // Coalesce: only write if not already signaled since last drain
        if !self.signaled.swap(true, Ordering::AcqRel) {
            if let Ok(mut w) = self.wake_writer.lock() {
                let _ = w.write_all(&[1u8]);
            }
        }
    }
}

impl Clone for WakeSender {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            wake_writer: Arc::clone(&self.wake_writer),
            signaled: Arc::clone(&self.signaled),
            shutdown_requested: Arc::clone(&self.shutdown_requested),
            activity_changed: Arc::clone(&self.activity_changed),
            pending_command_permits: Arc::clone(&self.pending_command_permits),
            pending_byte_permits: Arc::clone(&self.pending_byte_permits),
        }
    }
}

// ─── WakeReceiver ───────────────────────────────────────────────────────

/// The receiving end used inside the session loop.  Provides access to
/// both the command channel and the wake pipe's reading end (for polling).
pub struct WakeReceiver {
    cmd_rx: mpsc::UnboundedReceiver<QueuedCommand>,
    deferred: VecDeque<QueuedCommand>,
    pub wake_reader: TcpStream,
    signaled: Arc<AtomicBool>,
    shutdown_requested: Arc<AtomicBool>,
    activity_changed: Arc<AtomicBool>,
}

impl WakeReceiver {
    fn new(
        cmd_rx: mpsc::UnboundedReceiver<QueuedCommand>,
        wake_reader: TcpStream,
        signaled: Arc<AtomicBool>,
        shutdown_requested: Arc<AtomicBool>,
        activity_changed: Arc<AtomicBool>,
    ) -> Self {
        Self {
            cmd_rx,
            deferred: VecDeque::new(),
            wake_reader,
            signaled,
            shutdown_requested,
            activity_changed,
        }
    }

    /// Receive the next command, replaying checkpoint-deferred work before
    /// newly arrived channel work. A requested shutdown always wins.
    pub fn try_recv(&mut self) -> Result<RdpCommand, mpsc::error::TryRecvError> {
        if self.shutdown_requested.load(Ordering::Acquire) {
            return Ok(RdpCommand::Shutdown);
        }
        if self.activity_changed.swap(false, Ordering::AcqRel) {
            return Ok(RdpCommand::ActivityChanged);
        }
        if let Some(queued) = self.deferred.pop_front() {
            return Ok(queued.command);
        }
        self.cmd_rx.try_recv().map(|queued| queued.command)
    }

    /// Preserve every command currently waiting in the live channel while a
    /// connection attempt or reconnect backoff is unable to execute it. The
    /// command's permit remains owned by the deferred envelope, so this queue
    /// and the live channel share one hard bound.
    pub fn preserve_pending_for_checkpoint(&mut self) -> CheckpointReport {
        if self.shutdown_requested.load(Ordering::Acquire) {
            return CheckpointReport {
                status: CheckpointStatus::Shutdown,
                dropped_input_events: 0,
            };
        }

        let mut dropped_input_events = 0u64;
        let mut durable_deferred = VecDeque::with_capacity(self.deferred.len());
        while let Some(queued) = self.deferred.pop_front() {
            if let RdpCommand::Input(events) = &queued.command {
                dropped_input_events = dropped_input_events.saturating_add(events.len() as u64);
            } else {
                durable_deferred.push_back(queued);
            }
        }
        self.deferred = durable_deferred;

        loop {
            match self.cmd_rx.try_recv() {
                Ok(queued) => {
                    if let RdpCommand::Input(events) = &queued.command {
                        dropped_input_events =
                            dropped_input_events.saturating_add(events.len() as u64);
                    } else {
                        self.deferred.push_back(queued);
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => {
                    return CheckpointReport {
                        status: CheckpointStatus::Continue,
                        dropped_input_events,
                    };
                }
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    // Commands accepted before the final sender disappeared
                    // remain executable. Report terminal disconnect only when
                    // there is no preserved work left to service.
                    let status = if self.deferred.is_empty() {
                        CheckpointStatus::Disconnected
                    } else {
                        CheckpointStatus::Continue
                    };
                    return CheckpointReport {
                        status,
                        dropped_input_events,
                    };
                }
            }
        }
    }

    /// Drain all pending bytes from the wake pipe and reset the signal flag.
    /// Call this after the poller wakes, immediately before draining commands
    /// to `Empty`. Bytes are drained before the coalescing flag is cleared: a
    /// sender racing in that window may suppress its redundant byte, but its
    /// command is then observed by the caller's command drain. Any sender after
    /// the clear writes a fresh byte.
    pub fn drain_wake(&self) {
        self.drain_wake_with_hook(|| {});
    }

    fn drain_wake_with_hook(&self, after_pipe_drain: impl FnOnce()) {
        let mut buf = [0u8; 64];
        let mut reader = &self.wake_reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(_) => continue,
                Err(_) => break, // WouldBlock or other — done
            }
        }
        after_pipe_drain();
        self.signaled.store(false, Ordering::Release);
    }
}

// ─── Factory ────────────────────────────────────────────────────────────

/// Create a wake-signaled command channel pair.
pub fn create_wake_channel() -> io::Result<(WakeSender, WakeReceiver)> {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<QueuedCommand>();
    let (wake_reader, wake_writer) = create_wake_pair()?;
    let signaled = Arc::new(AtomicBool::new(false));
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let activity_changed = Arc::new(AtomicBool::new(false));
    let pending_command_permits = Arc::new(Semaphore::new(MAX_PENDING_COMMANDS));
    let pending_byte_permits = Arc::new(Semaphore::new(MAX_PENDING_COMMAND_BYTES));
    let tx = WakeSender::new(
        cmd_tx,
        wake_writer,
        Arc::clone(&signaled),
        Arc::clone(&shutdown_requested),
        Arc::clone(&activity_changed),
        pending_command_permits,
        pending_byte_permits,
    );
    let rx = WakeReceiver::new(
        cmd_rx,
        wake_reader,
        signaled,
        shutdown_requested,
        activity_changed,
    );
    Ok((tx, rx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
    use std::sync::Barrier;

    #[test]
    fn checkpoint_preserves_non_shutdown_commands_in_order() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        sender.send(RdpCommand::Reconnect).expect("reconnect");
        sender
            .send(RdpCommand::DetachViewer)
            .expect("detach viewer");
        sender
            .send(RdpCommand::ClipboardPaste)
            .expect("clipboard paste");

        assert_eq!(
            receiver.preserve_pending_for_checkpoint().status,
            CheckpointStatus::Continue
        );
        // Repeated handshake/loss/backoff checkpoints must neither consume nor
        // reorder already deferred work.
        assert_eq!(
            receiver.preserve_pending_for_checkpoint().status,
            CheckpointStatus::Continue
        );
        sender
            .send(RdpCommand::ToggleFeature {
                feature: "clipboard".to_string(),
                enabled: false,
            })
            .expect("later admin command");
        assert_eq!(
            receiver.preserve_pending_for_checkpoint().status,
            CheckpointStatus::Continue
        );
        assert!(matches!(receiver.try_recv(), Ok(RdpCommand::Reconnect)));
        assert!(matches!(receiver.try_recv(), Ok(RdpCommand::DetachViewer)));
        assert!(matches!(
            receiver.try_recv(),
            Ok(RdpCommand::ClipboardPaste)
        ));
        assert!(matches!(
            receiver.try_recv(),
            Ok(RdpCommand::ToggleFeature {
                feature,
                enabled: false
            }) if feature == "clipboard"
        ));
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
    }

    #[test]
    fn shutdown_bypasses_a_full_regular_command_budget() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        for _ in 0..MAX_PENDING_COMMANDS {
            sender.send(RdpCommand::Reconnect).expect("within bound");
        }
        assert_eq!(
            sender.send(RdpCommand::ClipboardPaste),
            Err(WakeSendError::Full)
        );

        sender
            .send(RdpCommand::Shutdown)
            .expect("shutdown bypasses capacity");
        assert_eq!(
            receiver.preserve_pending_for_checkpoint().status,
            CheckpointStatus::Shutdown
        );
        assert!(matches!(receiver.try_recv(), Ok(RdpCommand::Shutdown)));
    }

    #[test]
    fn activity_wake_is_coalesced_and_bypasses_full_regular_budget() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        for _ in 0..MAX_PENDING_COMMANDS {
            sender.send(RdpCommand::Reconnect).expect("within bound");
        }

        sender
            .send(RdpCommand::ActivityChanged)
            .expect("activity bypasses capacity");
        sender
            .send(RdpCommand::ActivityChanged)
            .expect("duplicate activity coalesces");
        assert_eq!(
            receiver.preserve_pending_for_checkpoint().status,
            CheckpointStatus::Continue
        );
        assert!(matches!(
            receiver.try_recv(),
            Ok(RdpCommand::ActivityChanged)
        ));
        assert!(matches!(receiver.try_recv(), Ok(RdpCommand::Reconnect)));
    }

    #[test]
    fn reservation_reports_saturation_before_command_publication() {
        let (sender, _receiver) = create_wake_channel().expect("wake channel");
        let mut reservations = Vec::with_capacity(MAX_PENDING_COMMANDS);
        let command = RdpCommand::Reconnect;
        for _ in 0..MAX_PENDING_COMMANDS {
            reservations.push(
                sender
                    .reserve_regular_command(&command)
                    .expect("reservation within bound"),
            );
        }
        assert!(matches!(
            sender.reserve_regular_command(&command),
            Err(WakeSendError::Full)
        ));
        drop(reservations);
        sender
            .reserve_regular_command(&command)
            .expect("released reservation restores capacity");
    }

    #[test]
    fn checkpoint_keeps_accepted_work_after_last_sender_disconnects() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        sender.send(RdpCommand::SignOut).expect("accepted command");
        drop(sender);

        assert_eq!(
            receiver.preserve_pending_for_checkpoint().status,
            CheckpointStatus::Continue
        );
        assert!(matches!(receiver.try_recv(), Ok(RdpCommand::SignOut)));
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Disconnected)
        ));
        assert_eq!(
            receiver.preserve_pending_for_checkpoint().status,
            CheckpointStatus::Disconnected
        );
    }

    #[test]
    fn checkpoint_drops_transient_input_but_preserves_durable_fifo_once() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        sender.send(RdpCommand::Reconnect).expect("reconnect");
        sender
            .send(RdpCommand::Input(vec![
                FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x1e),
                FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x1e),
            ]))
            .expect("transient input");
        sender
            .send(RdpCommand::ClipboardPaste)
            .expect("clipboard paste");

        let report = receiver.preserve_pending_for_checkpoint();
        assert_eq!(report.status, CheckpointStatus::Continue);
        assert_eq!(report.dropped_input_events, 2);
        assert!(matches!(receiver.try_recv(), Ok(RdpCommand::Reconnect)));
        assert!(matches!(
            receiver.try_recv(),
            Ok(RdpCommand::ClipboardPaste)
        ));
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
    }

    #[test]
    fn weighted_budget_rejects_large_payloads_and_releases_after_receive() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        let payload_len = 4 * 1024 * 1024;
        let sample = RdpCommand::ClipboardCopy("x".repeat(payload_len));
        let weight = regular_command_byte_weight(&sample);
        let expected_accepted = MAX_PENDING_COMMAND_BYTES / weight;
        assert!(expected_accepted > 0);
        assert!(expected_accepted < MAX_PENDING_COMMANDS);
        sender.send(sample).expect("first weighted command");
        for _ in 1..expected_accepted {
            sender
                .send(RdpCommand::ClipboardCopy("x".repeat(payload_len)))
                .expect("within byte budget");
        }
        assert!(matches!(
            sender.send(RdpCommand::ClipboardCopy("x".repeat(payload_len))),
            Err(WakeSendError::Full)
        ));

        assert!(matches!(
            receiver.try_recv(),
            Ok(RdpCommand::ClipboardCopy(text)) if text.len() == payload_len
        ));
        sender
            .send(RdpCommand::ClipboardCopy("x".repeat(payload_len)))
            .expect("receiving releases weighted capacity");
    }

    #[test]
    fn single_payload_larger_than_weight_budget_fails_without_enqueue() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        assert!(matches!(
            sender.send(RdpCommand::ClipboardCopy(
                "x".repeat(MAX_PENDING_COMMAND_BYTES)
            )),
            Err(WakeSendError::Full)
        ));
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
    }

    #[test]
    fn queue_budget_stays_bounded_by_service_admission_limit() {
        let aggregate = MAX_PENDING_COMMAND_BYTES
            .checked_mul(crate::rdp::types::MAX_RDP_ACTIVE_OR_PENDING_SESSIONS)
            .expect("aggregate budget must fit usize");
        assert_eq!(
            crate::rdp::types::MAX_RDP_ACTIVE_OR_PENDING_SESSIONS,
            16,
            "raising the session cap requires an explicit queued-memory review"
        );
        assert!(aggregate <= 256 * 1024 * 1024);
    }

    #[test]
    fn wake_reset_race_allows_followup_send_to_write_a_fresh_edge() {
        let (sender, mut receiver) = create_wake_channel().expect("wake channel");
        sender.send(RdpCommand::Reconnect).expect("initial wake");

        let barrier = Arc::new(Barrier::new(2));
        let sent = Arc::new(AtomicBool::new(false));
        let racing_sender = sender.clone();
        let racing_barrier = Arc::clone(&barrier);
        let racing_sent = Arc::clone(&sent);
        let racing_thread = std::thread::spawn(move || {
            racing_barrier.wait();
            racing_sender
                .send(RdpCommand::ClipboardPaste)
                .expect("racing command");
            racing_sent.store(true, Ordering::Release);
        });

        receiver.drain_wake_with_hook(|| {
            barrier.wait();
            while !sent.load(Ordering::Acquire) {
                std::thread::yield_now();
            }
        });
        racing_thread.join().expect("racing sender");

        assert!(matches!(receiver.try_recv(), Ok(RdpCommand::Reconnect)));
        assert!(matches!(
            receiver.try_recv(),
            Ok(RdpCommand::ClipboardPaste)
        ));
        sender.send(RdpCommand::SignOut).expect("post-race command");
        let mut byte = [0u8; 1];
        let mut wake_reader = &receiver.wake_reader;
        assert_eq!(wake_reader.read(&mut byte).expect("fresh wake byte"), 1);
    }
}
