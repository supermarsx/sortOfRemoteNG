use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};

use tokio::sync::watch;

/// Rust's default native-thread stack is intentionally left unchanged. For
/// admission planning we conservatively reserve 2 MiB per shell thread and a
/// 256 MiB process-wide stack budget. This gives a deterministic ceiling of
/// 128 active shell actors while allowing additional logical SSH connections
/// to remain connected without opening a shell.
const PLANNED_DEFAULT_THREAD_STACK_BYTES: usize = 2 * 1024 * 1024;
const PROCESS_SHELL_STACK_BUDGET_BYTES: usize = 256 * 1024 * 1024;
pub(crate) const DEFAULT_MAX_ACTIVE_SSH_SHELLS: usize =
    PROCESS_SHELL_STACK_BUDGET_BYTES / PLANNED_DEFAULT_THREAD_STACK_BYTES;

pub(crate) const DEFAULT_SHELL_INPUT_MAX_BYTES: usize = 256 * 1024;
pub(crate) const DEFAULT_SHELL_INPUT_MAX_COMMANDS: usize = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShellMailboxLimits {
    pub(crate) max_input_bytes: usize,
    pub(crate) max_input_commands: usize,
}

impl Default for ShellMailboxLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: DEFAULT_SHELL_INPUT_MAX_BYTES,
            max_input_commands: DEFAULT_SHELL_INPUT_MAX_COMMANDS,
        }
    }
}

pub enum SshShellCommand {
    Input(String),
    SecretInput(zeroize::Zeroizing<String>),
    Resize(u32, u32),
    Close,
}

impl SshShellCommand {
    fn input_bytes(&self) -> Option<usize> {
        match self {
            Self::Input(data) => Some(data.len()),
            Self::SecretInput(data) => Some(data.len()),
            Self::Resize(..) | Self::Close => None,
        }
    }
}

impl fmt::Debug for SshShellCommand {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Input(data) => formatter
                .debug_tuple("Input")
                .field(&format_args!("[REDACTED {} bytes]", data.len()))
                .finish(),
            Self::SecretInput(data) => formatter
                .debug_tuple("SecretInput")
                .field(&format_args!("[REDACTED {} bytes]", data.len()))
                .finish(),
            Self::Resize(cols, rows) => formatter
                .debug_tuple("Resize")
                .field(cols)
                .field(rows)
                .finish(),
            Self::Close => formatter.write_str("Close"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellMailboxSendError {
    Closed,
    InputTooLarge {
        bytes: usize,
        max_bytes: usize,
    },
    Saturated {
        queued_bytes: usize,
        max_bytes: usize,
        queued_commands: usize,
        max_commands: usize,
    },
}

impl fmt::Display for ShellMailboxSendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => formatter.write_str("SSH shell mailbox is closed"),
            Self::InputTooLarge { bytes, max_bytes } => write!(
                formatter,
                "SSH shell input is {bytes} bytes, exceeding the {max_bytes}-byte mailbox limit"
            ),
            Self::Saturated {
                queued_bytes,
                max_bytes,
                queued_commands,
                max_commands,
            } => write!(
                formatter,
                "SSH shell input mailbox is full ({queued_bytes}/{max_bytes} bytes, \
                 {queued_commands}/{max_commands} commands)"
            ),
        }
    }
}

impl std::error::Error for ShellMailboxSendError {}

#[derive(Debug, Default)]
struct ShellMailboxState {
    input: VecDeque<SshShellCommand>,
    input_bytes: usize,
    latest_resize: Option<(u32, u32)>,
}

#[derive(Debug)]
struct ShellMailboxShared {
    state: StdMutex<ShellMailboxState>,
    limits: ShellMailboxLimits,
    close_requested: Arc<AtomicBool>,
    receiver_alive: AtomicBool,
}

#[derive(Clone)]
pub struct ShellMailboxSender {
    shared: Arc<ShellMailboxShared>,
}

impl fmt::Debug for ShellMailboxSender {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ShellMailboxSender")
            .field(
                "close_requested",
                &self.shared.close_requested.load(Ordering::Acquire),
            )
            .field(
                "receiver_alive",
                &self.shared.receiver_alive.load(Ordering::Acquire),
            )
            .field("limits", &self.shared.limits)
            .finish_non_exhaustive()
    }
}

impl ShellMailboxSender {
    pub fn send(&self, command: SshShellCommand) -> Result<(), ShellMailboxSendError> {
        if matches!(command, SshShellCommand::Close) {
            self.request_close();
            return if self.shared.receiver_alive.load(Ordering::Acquire) {
                Ok(())
            } else {
                Err(ShellMailboxSendError::Closed)
            };
        }

        if self.shared.close_requested.load(Ordering::Acquire)
            || !self.shared.receiver_alive.load(Ordering::Acquire)
        {
            return Err(ShellMailboxSendError::Closed);
        }

        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| ShellMailboxSendError::Closed)?;
        if self.shared.close_requested.load(Ordering::Acquire)
            || !self.shared.receiver_alive.load(Ordering::Acquire)
        {
            return Err(ShellMailboxSendError::Closed);
        }

        if let SshShellCommand::Resize(cols, rows) = command {
            state.latest_resize = Some((cols, rows));
            return Ok(());
        }

        let bytes = command.input_bytes().unwrap_or_default();
        if bytes > self.shared.limits.max_input_bytes {
            return Err(ShellMailboxSendError::InputTooLarge {
                bytes,
                max_bytes: self.shared.limits.max_input_bytes,
            });
        }

        let queued_bytes = state.input_bytes.saturating_add(bytes);
        let queued_commands = state.input.len().saturating_add(1);
        if queued_bytes > self.shared.limits.max_input_bytes
            || queued_commands > self.shared.limits.max_input_commands
        {
            return Err(ShellMailboxSendError::Saturated {
                queued_bytes: state.input_bytes,
                max_bytes: self.shared.limits.max_input_bytes,
                queued_commands: state.input.len(),
                max_commands: self.shared.limits.max_input_commands,
            });
        }

        state.input_bytes = queued_bytes;
        state.input.push_back(command);
        Ok(())
    }

    pub(crate) fn request_close(&self) {
        // Cancellation is deliberately independent from the bounded mailbox
        // mutex and queue capacity. A saturated or briefly locked queue can
        // never prevent the actor from observing Close.
        self.shared.close_requested.store(true, Ordering::Release);
    }

    pub(crate) fn cancellation(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.shared.close_requested)
    }

    #[cfg(test)]
    fn stats(&self) -> ShellMailboxStats {
        let state = self
            .shared
            .state
            .lock()
            .expect("shell mailbox test mutex poisoned");
        ShellMailboxStats {
            input_bytes: state.input_bytes,
            input_commands: state.input.len(),
            resize_pending: usize::from(state.latest_resize.is_some()),
        }
    }
}

pub(crate) struct ShellMailboxReceiver {
    shared: Arc<ShellMailboxShared>,
}

impl ShellMailboxReceiver {
    pub(crate) fn close_requested(&self) -> bool {
        self.shared.close_requested.load(Ordering::Acquire)
    }

    pub(crate) fn try_recv_input(&mut self) -> Option<SshShellCommand> {
        if self.close_requested() {
            self.clear_pending();
            return None;
        }
        let mut state = self.shared.state.lock().ok()?;
        if self.close_requested() {
            Self::clear_state(&mut state);
            return None;
        }
        let command = state.input.pop_front()?;
        state.input_bytes = state
            .input_bytes
            .saturating_sub(command.input_bytes().unwrap_or_default());
        Some(command)
    }

    pub(crate) fn take_latest_resize(&mut self) -> Option<(u32, u32)> {
        if self.close_requested() {
            self.clear_pending();
            return None;
        }
        let mut state = self.shared.state.lock().ok()?;
        if self.close_requested() {
            Self::clear_state(&mut state);
            return None;
        }
        state.latest_resize.take()
    }

    /// Drain one actor tick. The byte budget is deliberately soft because an
    /// input command is atomic: the first command can be as large as the
    /// mailbox's 256 KiB per-command ceiling and is processed whole. Once that
    /// single-command overshoot occurs, no further command is dequeued in the
    /// same tick.
    pub(crate) fn drain_input_tick(
        &mut self,
        max_commands: usize,
        soft_max_bytes: usize,
    ) -> Vec<SshShellCommand> {
        let mut commands = Vec::new();
        let mut bytes = 0usize;
        while commands.len() < max_commands && bytes < soft_max_bytes {
            let Some(command) = self.try_recv_input() else {
                break;
            };
            bytes = bytes.saturating_add(command.input_bytes().unwrap_or_default());
            commands.push(command);
        }
        commands
    }

    fn clear_pending(&self) {
        if let Ok(mut state) = self.shared.state.lock() {
            Self::clear_state(&mut state);
        }
    }

    fn clear_state(state: &mut ShellMailboxState) {
        state.input.clear();
        state.input_bytes = 0;
        state.latest_resize = None;
    }

    #[cfg(test)]
    fn try_recv_input_after_initial_check(
        &mut self,
        after_initial_check: impl FnOnce(),
    ) -> Option<SshShellCommand> {
        if self.close_requested() {
            self.clear_pending();
            return None;
        }
        after_initial_check();
        let mut state = self.shared.state.lock().ok()?;
        if self.close_requested() {
            Self::clear_state(&mut state);
            return None;
        }
        let command = state.input.pop_front()?;
        state.input_bytes = state
            .input_bytes
            .saturating_sub(command.input_bytes().unwrap_or_default());
        Some(command)
    }
}

impl Drop for ShellMailboxReceiver {
    fn drop(&mut self) {
        self.shared.receiver_alive.store(false, Ordering::Release);
        self.shared.close_requested.store(true, Ordering::Release);
        if let Ok(mut state) = self.shared.state.lock() {
            Self::clear_state(&mut state);
        }
    }
}

pub(crate) fn shell_mailbox(
    limits: ShellMailboxLimits,
) -> (ShellMailboxSender, ShellMailboxReceiver) {
    let shared = Arc::new(ShellMailboxShared {
        state: StdMutex::new(ShellMailboxState::default()),
        limits,
        close_requested: Arc::new(AtomicBool::new(false)),
        receiver_alive: AtomicBool::new(true),
    });
    (
        ShellMailboxSender {
            shared: Arc::clone(&shared),
        },
        ShellMailboxReceiver { shared },
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShellWorkerOutcome {
    Running,
    Exited,
    Panicked,
}

#[derive(Debug)]
pub(crate) struct ShellCompletion {
    outcome: watch::Sender<ShellWorkerOutcome>,
}

impl ShellCompletion {
    pub(crate) fn new() -> Arc<Self> {
        let (outcome, _receiver) = watch::channel(ShellWorkerOutcome::Running);
        Arc::new(Self { outcome })
    }

    pub(crate) fn outcome(&self) -> ShellWorkerOutcome {
        *self.outcome.borrow()
    }

    fn finish(&self, outcome: ShellWorkerOutcome) {
        if self.outcome() == ShellWorkerOutcome::Running {
            self.outcome.send_replace(outcome);
        }
    }

    pub(crate) async fn wait_until(
        &self,
        deadline: tokio::time::Instant,
    ) -> Result<ShellWorkerOutcome, ()> {
        let mut receiver = self.outcome.subscribe();
        loop {
            let outcome = *receiver.borrow_and_update();
            if outcome != ShellWorkerOutcome::Running {
                return Ok(outcome);
            }
            match tokio::time::timeout_at(deadline, receiver.changed()).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => return Ok(self.outcome()),
                Err(_) => return Err(()),
            }
        }
    }
}

pub(crate) struct ShellWorkerCompletionGuard {
    completion: Arc<ShellCompletion>,
    completed: bool,
}

impl ShellWorkerCompletionGuard {
    pub(crate) fn new(completion: Arc<ShellCompletion>) -> Self {
        Self {
            completion,
            completed: false,
        }
    }

    pub(crate) fn complete(mut self) {
        self.completed = true;
    }
}

impl Drop for ShellWorkerCompletionGuard {
    fn drop(&mut self) {
        if !self.completed {
            self.completion.finish(ShellWorkerOutcome::Panicked);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShellAdmissionPhase {
    Active,
    Tombstoned,
}

#[derive(Debug)]
struct ShellAdmissionEntry {
    generation: u64,
    phase: ShellAdmissionPhase,
    cancellation: Arc<AtomicBool>,
    completion: Arc<ShellCompletion>,
    publication: Arc<ShellPublicationGate>,
}

#[derive(Debug)]
pub(crate) struct ShellPublicationGate {
    accepting: AtomicBool,
    in_flight: AtomicUsize,
}

impl ShellPublicationGate {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            accepting: AtomicBool::new(true),
            in_flight: AtomicUsize::new(0),
        })
    }

    fn closed() -> Arc<Self> {
        Arc::new(Self {
            accepting: AtomicBool::new(false),
            in_flight: AtomicUsize::new(0),
        })
    }

    fn try_enter(self: &Arc<Self>) -> Option<ShellPublicationPermit> {
        if !self.accepting.load(Ordering::Acquire) {
            return None;
        }
        self.in_flight.fetch_add(1, Ordering::AcqRel);
        if !self.accepting.load(Ordering::Acquire) {
            self.in_flight.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(ShellPublicationPermit {
            gate: Arc::clone(self),
        })
    }

    fn close(&self) {
        self.accepting.store(false, Ordering::Release);
    }

    pub(crate) async fn wait_until_drained(
        &self,
        deadline: tokio::time::Instant,
    ) -> Result<(), ()> {
        while self.in_flight.load(Ordering::Acquire) != 0 {
            if tokio::time::Instant::now() >= deadline {
                return Err(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }
        Ok(())
    }
}

struct ShellPublicationPermit {
    gate: Arc<ShellPublicationGate>,
}

impl Drop for ShellPublicationPermit {
    fn drop(&mut self) {
        self.gate.in_flight.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Debug, Default)]
struct ShellAdmissionState {
    next_generation: u64,
    entries: HashMap<String, ShellAdmissionEntry>,
}

#[derive(Debug)]
pub(crate) struct ShellAdmission {
    limit: usize,
    state: StdMutex<ShellAdmissionState>,
}

impl ShellAdmission {
    pub(crate) fn new(limit: usize) -> Self {
        Self {
            limit: limit.max(1),
            state: StdMutex::new(ShellAdmissionState::default()),
        }
    }

    pub(crate) fn try_acquire(
        self: &Arc<Self>,
        session_id: &str,
        cancellation: Arc<AtomicBool>,
        completion: Arc<ShellCompletion>,
    ) -> Result<ShellAdmissionLease, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Failed to lock SSH shell admission registry".to_string())?;
        if let Some(existing) = state.entries.get(session_id) {
            let phase = match existing.phase {
                ShellAdmissionPhase::Active => "active",
                ShellAdmissionPhase::Tombstoned => "still stopping",
            };
            return Err(format!(
                "SSH shell generation {} for session {} is {}; wait for it to finish before starting another shell",
                existing.generation, session_id, phase
            ));
        }
        if state.entries.len() >= self.limit {
            return Err(format!(
                "SSH shell admission limit reached ({} active process-wide); the SSH connection remains available without a shell",
                self.limit
            ));
        }

        state.next_generation = state.next_generation.wrapping_add(1).max(1);
        let generation = state.next_generation;
        state.entries.insert(
            session_id.to_string(),
            ShellAdmissionEntry {
                generation,
                phase: ShellAdmissionPhase::Active,
                cancellation,
                completion,
                publication: ShellPublicationGate::new(),
            },
        );
        Ok(ShellAdmissionLease {
            admission: Arc::downgrade(self),
            session_id: session_id.to_string(),
            generation,
        })
    }

    pub(crate) fn tombstone(
        &self,
        session_id: &str,
        expected_generation: Option<u64>,
    ) -> Result<Option<ShellCleanupTarget>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Failed to lock SSH shell admission registry".to_string())?;
        let Some(entry) = state.entries.get_mut(session_id) else {
            return Ok(None);
        };
        if expected_generation.is_some_and(|generation| generation != entry.generation) {
            return Err(format!(
                "SSH shell generation changed while disconnecting session {}",
                session_id
            ));
        }
        entry.phase = ShellAdmissionPhase::Tombstoned;
        entry.publication.close();
        Ok(Some(ShellCleanupTarget {
            generation: entry.generation,
            cancellation: Arc::clone(&entry.cancellation),
            completion: Arc::clone(&entry.completion),
            publication: Arc::clone(&entry.publication),
        }))
    }

    pub(crate) fn publish_if_current<T>(
        &self,
        session_id: &str,
        generation: u64,
        publish: impl FnOnce() -> T,
    ) -> Option<T> {
        let publication = {
            let state = self.state.lock().ok()?;
            let entry = state.entries.get(session_id)?;
            if entry.generation != generation || entry.phase != ShellAdmissionPhase::Active {
                return None;
            }
            Arc::clone(&entry.publication)
        };
        // The global registry lock is deliberately gone before recording,
        // automation, highlighting, or replay work begins. Tombstone closes
        // this per-generation gate, and disconnect waits for any publisher
        // already inside it before clearing output state.
        let _permit = publication.try_enter()?;
        Some(publish())
    }

    #[cfg(test)]
    fn can_publish(&self, session_id: &str, generation: u64) -> bool {
        self.publish_if_current(session_id, generation, || ())
            .is_some()
    }

    #[cfg(test)]
    pub(crate) fn active_count(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.entries.len())
            .unwrap_or_default()
    }
}

#[derive(Debug)]
pub(crate) struct ShellAdmissionLease {
    admission: Weak<ShellAdmission>,
    session_id: String,
    generation: u64,
}

impl ShellAdmissionLease {
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
}

impl Drop for ShellAdmissionLease {
    fn drop(&mut self) {
        let Some(admission) = self.admission.upgrade() else {
            return;
        };
        let state_lock = admission.state.lock();
        if let Ok(mut state) = state_lock {
            let owns_entry = state
                .entries
                .get(&self.session_id)
                .is_some_and(|entry| entry.generation == self.generation);
            if owns_entry {
                if let Some(entry) = state.entries.remove(&self.session_id) {
                    entry.publication.close();
                    entry.completion.finish(ShellWorkerOutcome::Exited);
                }
            }
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ShellCleanupTarget {
    pub(crate) generation: u64,
    pub(crate) cancellation: Arc<AtomicBool>,
    pub(crate) completion: Arc<ShellCompletion>,
    pub(crate) publication: Arc<ShellPublicationGate>,
}

impl ShellCleanupTarget {
    pub(crate) fn completed_without_registry(
        generation: u64,
        cancellation: Arc<AtomicBool>,
        completion: Arc<ShellCompletion>,
    ) -> Self {
        Self {
            generation,
            cancellation,
            completion,
            publication: ShellPublicationGate::closed(),
        }
    }
}

lazy_static::lazy_static! {
    static ref PROCESS_SHELL_ADMISSION: Arc<ShellAdmission> =
        Arc::new(ShellAdmission::new(DEFAULT_MAX_ACTIVE_SSH_SHELLS));
}

pub(crate) fn process_shell_admission() -> Arc<ShellAdmission> {
    Arc::clone(&PROCESS_SHELL_ADMISSION)
}

#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
struct ShellMailboxStats {
    input_bytes: usize,
    input_commands: usize,
    resize_pending: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::AssertUnwindSafe;
    use std::sync::{mpsc as std_mpsc, Barrier};
    use std::time::Duration;

    fn runtime(
        limits: ShellMailboxLimits,
    ) -> (
        ShellMailboxSender,
        ShellMailboxReceiver,
        Arc<ShellCompletion>,
    ) {
        let (sender, receiver) = shell_mailbox(limits);
        (sender, receiver, ShellCompletion::new())
    }

    #[test]
    fn admission_registry_caps_synthetic_100_500_and_1000_requests() {
        // This isolates registry math and allocation. Native worker lifecycle
        // coverage lives in the service tests and is intentionally not claimed
        // by these synthetic requests.
        for requested in [100usize, 500, 1_000] {
            let admission = Arc::new(ShellAdmission::new(DEFAULT_MAX_ACTIVE_SSH_SHELLS));
            let mut leases = Vec::new();
            let mut rejected = 0usize;
            for index in 0..requested {
                let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
                match admission.try_acquire(
                    &format!("session-{index}"),
                    sender.cancellation(),
                    completion,
                ) {
                    Ok(lease) => leases.push((lease, sender, receiver)),
                    Err(error) => {
                        rejected += 1;
                        assert!(error.contains("admission limit reached"));
                    }
                }
            }

            let expected = requested.min(DEFAULT_MAX_ACTIVE_SSH_SHELLS);
            assert_eq!(leases.len(), expected);
            assert_eq!(rejected, requested - expected);
            assert_eq!(admission.active_count(), expected);
            drop(leases);
            assert_eq!(admission.active_count(), 0);
        }
    }

    #[test]
    fn input_mailbox_is_bounded_by_bytes_and_commands() {
        let byte_limits = ShellMailboxLimits {
            max_input_bytes: 8,
            max_input_commands: 10,
        };
        let (sender, mut receiver) = shell_mailbox(byte_limits);
        sender.send(SshShellCommand::Input("abcd".into())).unwrap();
        sender
            .send(SshShellCommand::SecretInput(zeroize::Zeroizing::new(
                "efgh".to_string(),
            )))
            .unwrap();
        assert!(matches!(
            sender.send(SshShellCommand::Input("i".into())),
            Err(ShellMailboxSendError::Saturated { .. })
        ));
        assert_eq!(
            sender.stats(),
            ShellMailboxStats {
                input_bytes: 8,
                input_commands: 2,
                resize_pending: 0,
            }
        );

        assert!(matches!(
            receiver.try_recv_input(),
            Some(SshShellCommand::Input(data)) if data == "abcd"
        ));
        sender.send(SshShellCommand::Input("ij".into())).unwrap();
        assert_eq!(sender.stats().input_bytes, 6);
        assert!(matches!(
            sender.send(SshShellCommand::Input("012345678".into())),
            Err(ShellMailboxSendError::InputTooLarge { .. })
        ));

        let (command_sender, _command_receiver) = shell_mailbox(ShellMailboxLimits {
            max_input_bytes: 100,
            max_input_commands: 2,
        });
        command_sender
            .send(SshShellCommand::Input(String::new()))
            .unwrap();
        command_sender
            .send(SshShellCommand::Input(String::new()))
            .unwrap();
        assert!(matches!(
            command_sender.send(SshShellCommand::Input(String::new())),
            Err(ShellMailboxSendError::Saturated {
                queued_bytes: 0,
                queued_commands: 2,
                ..
            })
        ));
    }

    #[test]
    fn resize_mailbox_coalesces_to_the_latest_dimensions() {
        let (sender, mut receiver) = shell_mailbox(ShellMailboxLimits {
            max_input_bytes: 1,
            max_input_commands: 1,
        });
        for size in 1..=1_000u32 {
            sender
                .send(SshShellCommand::Resize(size, size + 1))
                .unwrap();
        }
        assert_eq!(sender.stats().resize_pending, 1);
        assert_eq!(receiver.take_latest_resize(), Some((1_000, 1_001)));
        assert_eq!(receiver.take_latest_resize(), None);
    }

    #[test]
    fn close_is_independent_and_wins_when_input_is_saturated() {
        let (sender, mut receiver) = shell_mailbox(ShellMailboxLimits {
            max_input_bytes: 4,
            max_input_commands: 1,
        });
        sender.send(SshShellCommand::Input("full".into())).unwrap();
        sender.send(SshShellCommand::Close).unwrap();

        assert!(receiver.close_requested());
        assert!(receiver.try_recv_input().is_none());
        assert_eq!(sender.stats().input_commands, 0);
        assert!(matches!(
            sender.send(SshShellCommand::Resize(80, 24)),
            Err(ShellMailboxSendError::Closed)
        ));
    }

    #[test]
    fn close_between_initial_check_and_mailbox_lock_drops_queued_input() {
        let (sender, mut receiver) = shell_mailbox(ShellMailboxLimits {
            max_input_bytes: 32,
            max_input_commands: 4,
        });
        sender
            .send(SshShellCommand::SecretInput(zeroize::Zeroizing::new(
                "queued-secret".to_string(),
            )))
            .unwrap();
        let checked = Arc::new(Barrier::new(2));
        let resume = Arc::new(Barrier::new(2));
        let checked_worker = Arc::clone(&checked);
        let resume_worker = Arc::clone(&resume);
        let worker = std::thread::spawn(move || {
            receiver.try_recv_input_after_initial_check(|| {
                checked_worker.wait();
                resume_worker.wait();
            })
        });

        checked.wait();
        sender.request_close();
        resume.wait();
        assert!(worker.join().unwrap().is_none());
        assert_eq!(sender.stats().input_bytes, 0);
        assert_eq!(sender.stats().input_commands, 0);
    }

    #[test]
    fn concurrent_input_flood_stays_bounded_and_close_wins() {
        let limits = ShellMailboxLimits {
            max_input_bytes: 256,
            max_input_commands: 64,
        };
        let (sender, mut receiver) = shell_mailbox(limits);
        let writer = sender.clone();
        let (active_tx, active_rx) = std_mpsc::sync_channel(1);
        let writer_thread = std::thread::spawn(move || {
            let mut accepted = 0usize;
            let mut maximum_bytes = 0usize;
            let mut maximum_commands = 0usize;
            loop {
                match writer.send(SshShellCommand::Input("flood".to_string())) {
                    Ok(()) => {
                        accepted += 1;
                        let stats = writer.stats();
                        maximum_bytes = maximum_bytes.max(stats.input_bytes);
                        maximum_commands = maximum_commands.max(stats.input_commands);
                        if accepted == 100 {
                            let _ = active_tx.send(());
                        }
                    }
                    Err(ShellMailboxSendError::Saturated { .. }) => {
                        std::thread::yield_now();
                    }
                    Err(ShellMailboxSendError::Closed) => {
                        break;
                    }
                    Err(ShellMailboxSendError::InputTooLarge { .. }) => {
                        panic!("fixed flood command must fit the mailbox")
                    }
                }
            }
            (accepted, maximum_bytes, maximum_commands, true)
        });
        let reader_thread = std::thread::spawn(move || {
            let mut consumed = 0usize;
            loop {
                consumed += receiver.drain_input_tick(8, 64).len();
                if receiver.close_requested() {
                    assert!(receiver.try_recv_input().is_none());
                    return consumed;
                }
                std::thread::yield_now();
            }
        });

        active_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("the bounded reader should let the flood make progress");
        sender.request_close();
        let (accepted, maximum_bytes, maximum_commands, observed_close) =
            writer_thread.join().unwrap();
        let _consumed = reader_thread.join().unwrap();
        assert!(accepted >= 100);
        assert!(observed_close);
        assert!(maximum_bytes <= limits.max_input_bytes);
        assert!(maximum_commands <= limits.max_input_commands);
        assert!(matches!(
            sender.send(SshShellCommand::Input("late".into())),
            Err(ShellMailboxSendError::Closed)
        ));
        assert_eq!(sender.stats().input_commands, 0);
    }

    #[test]
    fn input_tick_allows_one_atomic_256_kib_command_to_exceed_soft_budget() {
        let (sender, mut receiver) = shell_mailbox(ShellMailboxLimits::default());
        sender
            .send(SshShellCommand::Input(
                "x".repeat(DEFAULT_SHELL_INPUT_MAX_BYTES),
            ))
            .unwrap();

        let batch = receiver.drain_input_tick(64, 64 * 1024);
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].input_bytes(), Some(DEFAULT_SHELL_INPUT_MAX_BYTES));
        assert_eq!(sender.stats().input_commands, 0);
    }

    #[test]
    fn permit_releases_on_start_failure_close_and_panic() {
        let admission = Arc::new(ShellAdmission::new(1));

        let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
        let failed = admission
            .try_acquire("failed", sender.cancellation(), completion)
            .unwrap();
        assert_eq!(admission.active_count(), 1);
        drop((failed, sender, receiver));
        assert_eq!(admission.active_count(), 0);

        let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
        let lease = admission
            .try_acquire("closed", sender.cancellation(), Arc::clone(&completion))
            .unwrap();
        let closed_thread = std::thread::spawn(move || {
            let _lease = lease;
            let guard = ShellWorkerCompletionGuard::new(completion);
            while !receiver.close_requested() {
                std::thread::yield_now();
            }
            guard.complete();
        });
        sender.request_close();
        closed_thread.join().unwrap();
        assert_eq!(admission.active_count(), 0);

        let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
        let panic_outcome = Arc::clone(&completion);
        let lease = admission
            .try_acquire("panicked", sender.cancellation(), Arc::clone(&completion))
            .unwrap();
        let panicked_thread = std::thread::spawn(move || {
            let _lease = lease;
            let _guard = ShellWorkerCompletionGuard::new(completion);
            drop(receiver);
            panic!("intentional shell worker panic");
        });
        assert!(panicked_thread.join().is_err());
        assert_eq!(panic_outcome.outcome(), ShellWorkerOutcome::Panicked);
        assert_eq!(admission.active_count(), 0);
    }

    #[tokio::test]
    async fn lease_removal_precedes_observable_normal_completion() {
        let admission = Arc::new(ShellAdmission::new(1));
        let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
        let lease = admission
            .try_acquire(
                "ordered-completion",
                sender.cancellation(),
                Arc::clone(&completion),
            )
            .unwrap();
        let worker = std::thread::spawn(move || {
            drop(receiver);
            drop(lease);
        });

        let outcome = completion
            .wait_until(tokio::time::Instant::now() + Duration::from_secs(1))
            .await
            .unwrap();
        assert_eq!(outcome, ShellWorkerOutcome::Exited);
        assert_eq!(admission.active_count(), 0);
        worker.join().unwrap();
    }

    #[test]
    fn publication_panic_does_not_poison_global_admission_registry() {
        let admission = Arc::new(ShellAdmission::new(2));
        let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
        let lease = admission
            .try_acquire("panic-publish", sender.cancellation(), completion)
            .unwrap();
        let generation = lease.generation();

        let panic = std::panic::catch_unwind(AssertUnwindSafe(|| {
            admission.publish_if_current("panic-publish", generation, || {
                panic!("intentional publication panic")
            });
        }));
        assert!(panic.is_err());
        assert_eq!(admission.active_count(), 1);
        assert!(admission
            .tombstone("panic-publish", Some(generation))
            .unwrap()
            .is_some());
        drop((lease, sender, receiver));
        assert_eq!(admission.active_count(), 0);
    }

    #[tokio::test]
    async fn stalled_publication_does_not_hold_global_admission_registry() {
        let admission = Arc::new(ShellAdmission::new(2));
        let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
        let lease = admission
            .try_acquire("publishing", sender.cancellation(), completion)
            .unwrap();
        let generation = lease.generation();
        let publish_admission = Arc::clone(&admission);
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let entered_worker = Arc::clone(&entered);
        let release_worker = Arc::clone(&release);
        let publisher = std::thread::spawn(move || {
            publish_admission.publish_if_current("publishing", generation, || {
                entered_worker.wait();
                release_worker.wait();
            })
        });
        entered.wait();

        let tombstone_admission = Arc::clone(&admission);
        let (tombstone_tx, tombstone_rx) = std_mpsc::sync_channel(1);
        let tombstoner = std::thread::spawn(move || {
            let result = tombstone_admission.tombstone("publishing", Some(generation));
            let _ = tombstone_tx.send(result);
        });
        let target = tombstone_rx
            .recv_timeout(Duration::from_millis(100))
            .expect("tombstone must not wait for publication work")
            .unwrap()
            .unwrap();
        assert!(target
            .publication
            .wait_until_drained(tokio::time::Instant::now() + Duration::from_millis(10))
            .await
            .is_err());

        release.wait();
        publisher.join().unwrap();
        tombstoner.join().unwrap();
        target
            .publication
            .wait_until_drained(tokio::time::Instant::now() + Duration::from_secs(1))
            .await
            .unwrap();
        drop((lease, sender, receiver));
        assert_eq!(admission.active_count(), 0);
    }

    #[tokio::test]
    async fn tombstone_prevents_old_and_new_generations_from_overlapping() {
        let admission = Arc::new(ShellAdmission::new(2));
        let (sender, receiver, completion) = runtime(ShellMailboxLimits::default());
        let first = admission
            .try_acquire("same-session", sender.cancellation(), completion)
            .unwrap();
        let first_generation = first.generation();
        let target = admission
            .tombstone("same-session", Some(first_generation))
            .unwrap()
            .unwrap();
        assert_eq!(target.generation, first_generation);
        assert!(!admission.can_publish("same-session", first_generation));

        let (next_sender, next_receiver, next_completion) = runtime(ShellMailboxLimits::default());
        let error = admission
            .try_acquire("same-session", next_sender.cancellation(), next_completion)
            .expect_err("a tombstoned worker still owns its generation");
        assert!(error.contains("still stopping"));

        drop((first, sender, receiver));
        tokio::time::timeout(Duration::from_secs(1), async {
            while admission.active_count() != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let next = admission
            .try_acquire(
                "same-session",
                next_sender.cancellation(),
                ShellCompletion::new(),
            )
            .unwrap();
        assert!(next.generation() > first_generation);
        drop((next, next_sender, next_receiver));
    }
}
