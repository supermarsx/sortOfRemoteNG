//! Bounded, full-duplex forwarding for nonblocking SSH channels/TCP sockets.
//! `write_all` loses the retry offset when a partial write returns WouldBlock.
//! Do not flush an ssh2 channel: its flush discards unread *inbound* data.

use std::io::{self, ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const BUFFER_BYTES: usize = 32 * 1024;
const IDLE_POLL: Duration = Duration::from_millis(2);

/// libssh2 stores an unfinished channel open on the session, not on its caller.
/// Every user of the session's channel-creation/mode APIs must hold this permit.
#[derive(Default)]
pub(crate) struct ChannelOpenGate {
    busy: AtomicBool,
    poisoned: AtomicBool,
}

pub(super) struct SessionOperation {
    gate: Arc<ChannelOpenGate>,
    pending: bool,
}

impl SessionOperation {
    /// Non-forwarding openers must not hand an unfinished native operation to
    /// the next caller, either. Conservatively quarantine every open error.
    pub(super) fn native_open<T>(
        &self,
        open: impl FnOnce() -> Result<T, ssh2::Error>,
    ) -> Result<T, String> {
        self.gate.ensure_healthy()?;
        open().map_err(|error| {
            self.gate.poisoned.store(true, Ordering::Release);
            format!("{error}; disconnect and reconnect this SSH session")
        })
    }
}

impl Drop for SessionOperation {
    fn drop(&mut self) {
        if self.pending {
            // Never let another destination resume an abandoned libssh2 open.
            self.gate.poisoned.store(true, Ordering::Release);
        }
        self.gate.busy.store(false, Ordering::Release);
    }
}

impl ChannelOpenGate {
    pub(super) fn ensure_healthy(&self) -> Result<(), String> {
        if self.poisoned.load(Ordering::Acquire) {
            Err("SSH channel setup was interrupted; disconnect and reconnect this session".into())
        } else {
            Ok(())
        }
    }

    fn try_acquire(self: &Arc<Self>) -> Result<Option<SessionOperation>, String> {
        self.ensure_healthy()?;
        if self
            .busy
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            return Ok(None);
        }
        let permit = SessionOperation {
            gate: Arc::clone(self),
            pending: false,
        };
        // The previous owner can poison between our first check and acquisition.
        self.ensure_healthy()?;
        Ok(Some(permit))
    }

    pub(super) fn operation(self: &Arc<Self>) -> Result<SessionOperation, String> {
        self.try_acquire()?
            .ok_or_else(|| "SSH channel setup is busy; retry this operation".into())
    }

    pub(super) fn open<T>(
        self: &Arc<Self>,
        cancelled: &AtomicBool,
        deadline: Instant,
        mut step: impl FnMut() -> Result<Option<T>, String>,
    ) -> Result<T, String> {
        let check = || {
            if cancelled.load(Ordering::Acquire) {
                Err("SSH forwarding channel open cancelled".to_string())
            } else if Instant::now() >= deadline {
                Err("SSH forwarding channel open timed out".to_string())
            } else {
                Ok(())
            }
        };
        let mut permit = loop {
            check()?;
            if let Some(permit) = self.try_acquire()? {
                break permit;
            }
            std::thread::sleep(IDLE_POLL);
        };
        loop {
            check()?;
            // Also fail closed if the operation panics before reporting its state.
            permit.pending = true;
            match step() {
                Ok(None) => std::thread::sleep(IDLE_POLL),
                Ok(Some(channel)) => {
                    permit.pending = false;
                    return Ok(channel);
                }
                Err(error) => {
                    // A wrapper timeout/transport error need not prove native
                    // continuation state was reset. Only success permits reuse.
                    return Err(format!(
                        "{error}; disconnect and reconnect this SSH session"
                    ));
                }
            }
        }
    }
}

pub(super) trait RelayEndpoint: Read + Write {
    fn shutdown_write(&mut self) -> io::Result<()>;
}

impl RelayEndpoint for std::net::TcpStream {
    fn shutdown_write(&mut self) -> io::Result<()> {
        self.shutdown(std::net::Shutdown::Write)
    }
}

impl RelayEndpoint for ssh2::Channel {
    fn shutdown_write(&mut self) -> io::Result<()> {
        self.send_eof().map_err(io::Error::from)
    }
}

/// Coordinate relay I/O with operations which temporarily change session mode.
pub(super) struct ForwardChannel {
    pub(super) channel: ssh2::Channel,
    pub(super) session: ssh2::Session,
    pub(super) gate: Arc<ChannelOpenGate>,
}

impl ForwardChannel {
    fn with_channel<T>(
        &mut self,
        run: impl FnOnce(&mut ssh2::Channel) -> io::Result<T>,
    ) -> io::Result<T> {
        let _permit = self
            .gate
            .try_acquire()
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::from(ErrorKind::WouldBlock))?;
        self.session.set_blocking(false);
        run(&mut self.channel)
    }

    pub(super) fn close(&mut self) {
        let _ = self.with_channel(|channel| channel.close().map_err(io::Error::from));
    }
}

impl Read for ForwardChannel {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.with_channel(|channel| channel.read(bytes))
    }
}

impl Write for ForwardChannel {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.with_channel(|channel| channel.write(bytes))
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl RelayEndpoint for ForwardChannel {
    fn shutdown_write(&mut self) -> io::Result<()> {
        self.with_channel(|channel| channel.send_eof().map_err(io::Error::from))
    }
}

/// Dropping the owning async future must also stop its native relay worker.
pub(super) struct RelayOwner(pub(super) Arc<AtomicBool>);

impl RelayOwner {
    pub(super) fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

impl Drop for RelayOwner {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

fn retryable(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
    )
}

struct Direction {
    bytes: Box<[u8; BUFFER_BYTES]>,
    start: usize,
    end: usize,
    eof: bool,
    write_closed: bool,
}

impl Direction {
    fn new() -> Self {
        Self {
            bytes: Box::new([0; BUFFER_BYTES]),
            start: 0,
            end: 0,
            eof: false,
            write_closed: false,
        }
    }

    fn pending(&self) -> bool {
        self.start < self.end
    }

    fn pump(&mut self, source: &mut impl Read, sink: &mut impl RelayEndpoint) -> io::Result<bool> {
        let mut progressed = false;
        if !self.pending() && !self.eof {
            match source.read(&mut self.bytes[..]) {
                Ok(0) => self.eof = true,
                Ok(count) => {
                    self.start = 0;
                    self.end = count;
                    progressed = true;
                }
                Err(error) if retryable(&error) => {}
                Err(error) => return Err(error),
            }
        }
        if self.pending() {
            match sink.write(&self.bytes[self.start..self.end]) {
                Ok(0) => return Err(io::Error::from(ErrorKind::WriteZero)),
                Ok(count) => {
                    self.start += count;
                    progressed = true;
                }
                // Retain exactly the same slice until it has been accepted.
                // The other direction still gets a turn (SSH window updates
                // and TLS responses must not be starved by a pending write).
                Err(error) if retryable(&error) => {}
                Err(error) => return Err(error),
            }
        }
        if self.eof && !self.pending() && !self.write_closed {
            match sink.shutdown_write() {
                Ok(()) => {
                    self.write_closed = true;
                    progressed = true;
                }
                Err(error) if retryable(&error) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(progressed)
    }
}

pub(super) fn relay_nonblocking(
    local: &mut impl RelayEndpoint,
    remote: &mut impl RelayEndpoint,
    cancelled: &AtomicBool,
) -> io::Result<()> {
    let mut to_remote = Direction::new();
    let mut to_local = Direction::new();
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut progressed = to_remote.pump(local, remote)?;
        progressed |= to_local.pump(remote, local)?;
        // A send-side EOF does not close the reverse receive direction. Drain
        // each direction and propagate its FIN/SSH EOF independently.
        if to_remote.write_closed && to_local.write_closed {
            return Ok(());
        }
        if !progressed {
            std::thread::sleep(IDLE_POLL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::net::{Shutdown, TcpListener, TcpStream};
    use std::time::Instant;

    enum ReadStep {
        Data(Vec<u8>),
        Pause(ErrorKind),
        Eof,
    }
    struct Endpoint {
        reads: VecDeque<ReadStep>,
        writes: VecDeque<io::Result<usize>>,
        received: Vec<u8>,
        flushes: usize,
        shutdowns: usize,
        shutdown_errors: VecDeque<ErrorKind>,
        after_shutdown: Vec<ReadStep>,
        // Stop a deterministic script after every expected byte has arrived.
        finish: Option<(usize, Arc<AtomicBool>)>,
    }
    impl Endpoint {
        fn new(reads: Vec<ReadStep>) -> Self {
            Self {
                reads: reads.into(),
                writes: VecDeque::new(),
                received: Vec::new(),
                flushes: 0,
                shutdowns: 0,
                shutdown_errors: VecDeque::new(),
                after_shutdown: vec![],
                finish: None,
            }
        }
    }
    impl Read for Endpoint {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            match self
                .reads
                .pop_front()
                .unwrap_or(ReadStep::Pause(ErrorKind::WouldBlock))
            {
                ReadStep::Data(mut data) => {
                    let count = buf.len().min(data.len());
                    buf[..count].copy_from_slice(&data[..count]);
                    if count < data.len() {
                        self.reads.push_front(ReadStep::Data(data.split_off(count)));
                    }
                    Ok(count)
                }
                ReadStep::Pause(kind) => Err(io::Error::from(kind)),
                ReadStep::Eof => Ok(0),
            }
        }
    }
    impl Write for Endpoint {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let count = self
                .writes
                .pop_front()
                .unwrap_or(Ok(bytes.len()))?
                .min(bytes.len());
            self.received.extend_from_slice(&bytes[..count]);
            if let Some((expected, stop)) = &self.finish {
                if self.received.len() == *expected {
                    stop.store(true, Ordering::Release);
                }
            }
            Ok(count)
        }
        fn flush(&mut self) -> io::Result<()> {
            // ssh2::Stream::flush calls libssh2_channel_flush_ex, whose
            // documented operation is discarding the channel read buffer.
            self.flushes += 1;
            self.reads.clear();
            Ok(())
        }
    }

    impl RelayEndpoint for Endpoint {
        fn shutdown_write(&mut self) -> io::Result<()> {
            if let Some(error) = self.shutdown_errors.pop_front() {
                return Err(io::Error::from(error));
            }
            self.shutdowns += 1;
            self.reads.extend(self.after_shutdown.drain(..));
            Ok(())
        }
    }

    #[test]
    fn forward_relay_open_ownership_covers_continuations_and_other_channel_types() {
        let gate = Arc::new(ChannelOpenGate::default());
        let other_listener = Arc::clone(&gate);
        let cancel = AtomicBool::new(false);
        let mut calls = 0;
        let channel = gate
            .open(&cancel, Instant::now() + Duration::from_secs(1), || {
                calls += 1;
                // A caller for another listener/destination, including an exec/SFTP
                // opener, cannot enter the shared session while A is pending.
                assert!(other_listener.operation().is_err());
                if calls == 1 {
                    assert!(other_listener
                        .open::<()>(&cancel, Instant::now() + Duration::from_millis(5), || {
                            panic!("another destination consumed the pending open")
                        })
                        .unwrap_err()
                        .contains("timed out"));
                    Ok(None)
                } else {
                    Ok(Some("destination-A"))
                }
            })
            .unwrap();
        assert_eq!(channel, "destination-A");
        assert_eq!(calls, 2);
        assert_eq!(
            other_listener
                .open(&cancel, Instant::now() + Duration::from_secs(1), || Ok(
                    Some("destination-B")
                ))
                .unwrap(),
            "destination-B"
        );
        assert!(gate.operation().is_ok());
    }

    #[test]
    fn forward_relay_open_concurrent_workers_keep_destination_ownership() {
        let gate = Arc::new(ChannelOpenGate::default());
        let pending = Arc::new(std::sync::Mutex::new(None));
        let release = Arc::new(AtomicBool::new(false));
        let (started, entered) = std::sync::mpsc::channel();
        let (done, completed) = std::sync::mpsc::channel();
        let mut workers = vec![];
        for destination in ["local-A", "socks-B"] {
            let gate = Arc::clone(&gate);
            let pending = Arc::clone(&pending);
            let release = Arc::clone(&release);
            let started = started.clone();
            let done = done.clone();
            workers.push(std::thread::spawn(move || {
                let mut first = true;
                let result = gate.open(
                    &AtomicBool::new(false),
                    Instant::now() + Duration::from_secs(2),
                    || {
                        let mut current = pending.lock().unwrap();
                        if first {
                            assert!(current.is_none(), "overlapping libssh2 open");
                            *current = Some(destination);
                            first = false;
                            started.send(destination).unwrap();
                            return Ok(None);
                        }
                        assert_eq!(*current, Some(destination));
                        if !release.load(Ordering::Acquire) {
                            return Ok(None);
                        }
                        Ok(current.take())
                    },
                );
                done.send((destination, result)).unwrap();
            }));
        }
        entered.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(gate.operation().is_err());
        assert!(entered.try_recv().is_err());
        release.store(true, Ordering::Release);
        for _ in 0..2 {
            let (destination, channel) = completed.recv_timeout(Duration::from_secs(3)).unwrap();
            assert_eq!(channel.unwrap(), destination);
        }
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(gate.operation().is_ok());
    }

    #[test]
    fn forward_relay_abandoned_pending_open_poison_is_shared_and_never_reentered() {
        for timeout in [false, true] {
            let gate = Arc::new(ChannelOpenGate::default());
            let other = Arc::clone(&gate);
            let cancelled = AtomicBool::new(false);
            let deadline = Instant::now() + Duration::from_millis(10);
            let error = gate
                .open::<()>(&cancelled, deadline, || {
                    if timeout {
                        while Instant::now() < deadline {
                            std::thread::yield_now();
                        }
                    } else {
                        cancelled.store(true, Ordering::Release);
                    }
                    Ok(None)
                })
                .unwrap_err();
            assert!(error.contains(if timeout { "timed out" } else { "cancelled" }));
            assert!(other.operation().err().unwrap().contains("reconnect"));
            assert!(other
                .open::<()>(
                    &AtomicBool::new(false),
                    Instant::now() + Duration::from_secs(1),
                    || { panic!("abandoned session was reused") }
                )
                .unwrap_err()
                .contains("reconnect"));
        }
    }

    #[test]
    fn forward_relay_cancelled_waiter_does_not_poison_current_owner() {
        let gate = Arc::new(ChannelOpenGate::default());
        let permit = gate.operation().unwrap();
        let cancelled = AtomicBool::new(true);
        assert!(gate
            .open::<()>(
                &cancelled,
                Instant::now() + Duration::from_secs(1),
                || panic!("cancelled waiter ran")
            )
            .is_err());
        drop(permit);
        assert!(gate.operation().is_ok());
        let result = gate.open::<()>(
            &AtomicBool::new(false),
            Instant::now() + Duration::from_secs(1),
            || Err("server rejected channel".into()),
        );
        assert!(result.unwrap_err().contains("server rejected channel"));
        assert!(gate.operation().err().unwrap().contains("reconnect"));
    }

    #[test]
    fn forward_relay_panicked_opener_fails_closed() {
        let gate = Arc::new(ChannelOpenGate::default());
        assert!(std::panic::catch_unwind(|| {
            let _ = gate.open::<()>(
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(1),
                || panic!("open panic"),
            );
        })
        .is_err());
        assert!(gate.operation().err().unwrap().contains("reconnect"));
    }

    #[test]
    fn forward_relay_error_after_wouldblock_never_clears_pending_ownership() {
        let gate = Arc::new(ChannelOpenGate::default());
        let mut calls = 0;
        let error = gate
            .open::<()>(
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(1),
                || {
                    calls += 1;
                    if calls == 1 {
                        Ok(None)
                    } else {
                        Err("native socket timeout".into())
                    }
                },
            )
            .unwrap_err();
        assert!(error.contains("reconnect"));
        assert!(gate.operation().is_err());
    }

    #[test]
    fn forward_relay_other_native_opener_error_blocks_later_destinations() {
        let gate = Arc::new(ChannelOpenGate::default());
        let operation = gate.operation().unwrap();
        let error = operation
            .native_open::<()>(|| {
                Err(ssh2::Error::new(
                    ssh2::ErrorCode::Session(-9),
                    "socket timeout",
                ))
            })
            .unwrap_err();
        assert!(error.contains("reconnect"));
        assert!(operation
            .native_open::<()>(|| panic!("cleanup resumed an abandoned open"))
            .is_err());
        drop(operation);
        assert!(gate
            .open::<()>(
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(1),
                || panic!("forward consumed abandoned exec open")
            )
            .is_err());
    }

    #[test]
    fn forward_relay_half_close_receives_delayed_response_larger_than_buffer() {
        let response: Vec<_> = (0..BUFFER_BYTES * 3 + 19)
            .map(|i| (i % 251) as u8)
            .collect();
        let mut local = Endpoint::new(vec![ReadStep::Data(b"request".to_vec()), ReadStep::Eof]);
        let mut remote = Endpoint::new(vec![]);
        remote.writes = [Ok(2), Err(io::Error::from(ErrorKind::WouldBlock)), Ok(99)].into();
        remote.shutdown_errors = [ErrorKind::WouldBlock, ErrorKind::Interrupted].into();
        remote.after_shutdown = vec![
            ReadStep::Pause(ErrorKind::WouldBlock),
            ReadStep::Data(response.clone()),
            ReadStep::Eof,
        ];
        local.writes = [Ok(3), Err(io::Error::from(ErrorKind::WouldBlock)), Ok(99)].into();
        relay_nonblocking(&mut local, &mut remote, &AtomicBool::new(false)).unwrap();
        assert_eq!(remote.received, b"request");
        assert_eq!(local.received, response);
        assert_eq!((local.shutdowns, remote.shutdowns), (1, 1));
    }

    #[test]
    fn forward_relay_eof_before_first_reverse_read_preserves_queued_response() {
        let mut local = Endpoint::new(vec![ReadStep::Eof]);
        let mut remote = Endpoint::new(vec![
            ReadStep::Data(b"queued-response".to_vec()),
            ReadStep::Eof,
        ]);
        relay_nonblocking(&mut local, &mut remote, &AtomicBool::new(false)).unwrap();
        assert_eq!(local.received, b"queued-response");
        assert_eq!((local.shutdowns, remote.shutdowns), (1, 1));
    }

    #[test]
    fn forward_relay_cancels_half_closed_idle_peer_within_bound() {
        let owner = RelayOwner::new();
        let cancelled = Arc::clone(&owner.0);
        let (done, result) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let mut local = Endpoint::new(vec![ReadStep::Eof]);
            let mut remote = Endpoint::new(vec![]);
            done.send(relay_nonblocking(&mut local, &mut remote, &cancelled))
                .unwrap();
        });
        drop(owner);
        result
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn forward_relay_retains_partial_writes_and_retries_without_duplication() {
        let stop = Arc::new(AtomicBool::new(false));
        let payload = b"TLS-client-hello-and-finished".to_vec();
        let mut local = Endpoint::new(vec![ReadStep::Data(payload.clone())]);
        let mut remote = Endpoint::new(vec![]);
        remote.writes = [
            Ok(3),
            Err(io::Error::from(ErrorKind::WouldBlock)),
            Ok(2),
            Err(io::Error::from(ErrorKind::Interrupted)),
            Err(io::Error::from(ErrorKind::TimedOut)),
            Ok(usize::MAX),
        ]
        .into();
        remote.finish = Some((payload.len(), stop.clone()));
        relay_nonblocking(&mut local, &mut remote, &stop).unwrap();
        assert_eq!(remote.received, payload);
    }

    #[test]
    fn forward_relay_regression_old_write_all_closed_after_only_a_tls_prefix() {
        let payload = b"TLS-client-hello";
        let mut old_channel = Endpoint::new(vec![]);
        old_channel.writes = [Ok(3), Err(io::Error::from(ErrorKind::WouldBlock))].into();
        // This is the old forwarding write path: it returned/closed the
        // connection here, despite having already transmitted the prefix.
        assert_eq!(
            old_channel.write_all(payload).unwrap_err().kind(),
            ErrorKind::WouldBlock
        );
        assert_eq!(old_channel.received, &payload[..3]);

        let stop = Arc::new(AtomicBool::new(false));
        let mut local = Endpoint::new(vec![ReadStep::Data(payload.to_vec())]);
        let mut channel = Endpoint::new(vec![]);
        channel.writes = [Ok(3), Err(io::Error::from(ErrorKind::WouldBlock)), Ok(99)].into();
        channel.finish = Some((payload.len(), stop.clone()));
        relay_nonblocking(&mut local, &mut channel, &stop).unwrap();
        assert_eq!(channel.received, payload);
    }

    #[test]
    fn forward_relay_regression_never_flushes_away_buffered_server_certificate() {
        let certificate = b"buffered-server-certificate";
        let mut old_channel = Endpoint::new(vec![ReadStep::Data(certificate.to_vec())]);
        old_channel.write_all(b"client-hello").unwrap();
        old_channel.flush().unwrap();
        assert_eq!(
            old_channel.read(&mut [0; 64]).unwrap_err().kind(),
            ErrorKind::WouldBlock
        );

        let mut local = Endpoint::new(vec![
            ReadStep::Data(b"client-hello".to_vec()),
            ReadStep::Eof,
        ]);
        let mut channel = Endpoint::new(vec![ReadStep::Data(certificate.to_vec()), ReadStep::Eof]);
        relay_nonblocking(&mut local, &mut channel, &AtomicBool::new(false)).unwrap();
        assert_eq!(local.received, certificate);
        assert_eq!(channel.flushes, 0);
        assert_eq!(local.flushes, 0);
    }

    #[test]
    fn forward_relay_eof_drains_already_read_response_through_local_backpressure() {
        let mut local = Endpoint::new(vec![ReadStep::Data(b"request".to_vec()), ReadStep::Eof]);
        let mut channel = Endpoint::new(vec![
            ReadStep::Data(b"server-response-tail".to_vec()),
            ReadStep::Eof,
        ]);
        local.writes = [
            Ok(2),
            Err(io::Error::from(ErrorKind::WouldBlock)),
            Ok(2),
            Err(io::Error::from(ErrorKind::Interrupted)),
            Ok(99),
        ]
        .into();
        relay_nonblocking(&mut local, &mut channel, &AtomicBool::new(false)).unwrap();
        assert_eq!(local.received, b"server-response-tail");
        assert_eq!(channel.received, b"request");
    }

    #[test]
    fn forward_relay_explicit_cancel_stops_pending_data_without_new_error() {
        let stop = Arc::new(AtomicBool::new(false));
        let mut local = Endpoint::new(vec![ReadStep::Data(b"pending-request".to_vec())]);
        let mut channel = Endpoint::new(vec![]);
        channel.writes.push_back(Ok(2));
        channel.finish = Some((2, stop.clone()));
        // Unlike ordinary EOF draining, explicit cancellation must not keep
        // transmitting buffered application data after the owner closes it.
        relay_nonblocking(&mut local, &mut channel, &stop).unwrap();
        assert_eq!(channel.received, b"pe");
    }

    #[test]
    fn forward_relay_keeps_reverse_direction_live_while_ssh_write_is_blocked() {
        let stop = AtomicBool::new(false);
        let mut local = Endpoint::new(vec![ReadStep::Data(b"request".to_vec()), ReadStep::Eof]);
        let mut remote =
            Endpoint::new(vec![ReadStep::Data(b"certificate".to_vec()), ReadStep::Eof]);
        remote.writes = [Err(io::Error::from(ErrorKind::WouldBlock)), Ok(7)].into();
        local.writes = [Ok(2), Err(io::Error::from(ErrorKind::WouldBlock)), Ok(9)].into();
        relay_nonblocking(&mut local, &mut remote, &stop).unwrap();
        assert_eq!(remote.received, b"request");
        assert_eq!(local.received, b"certificate");
    }

    #[test]
    fn forward_relay_idle_peer_does_not_block_later_client_hello_or_approval_response() {
        let stop = Arc::new(AtomicBool::new(false));
        let pauses = || {
            (0..6)
                .map(|_| ReadStep::Pause(ErrorKind::WouldBlock))
                .collect::<Vec<_>>()
        };
        let mut steps = pauses();
        steps.push(ReadStep::Data(b"client-finished".to_vec()));
        let mut local = Endpoint::new(steps);
        let mut remote = Endpoint::new(pauses());
        remote.finish = Some((15, stop.clone()));
        // No wall-clock handshake/approval deadline in the relay.
        relay_nonblocking(&mut local, &mut remote, &stop).unwrap();
        assert_eq!(remote.received, b"client-finished");
    }

    #[test]
    fn forward_relay_large_payload_is_bounded_and_not_truncated() {
        let stop = Arc::new(AtomicBool::new(false));
        let payload: Vec<_> = (0..BUFFER_BYTES * 4 + 17)
            .map(|i| (i % 251) as u8)
            .collect();
        let mut local = Endpoint::new(vec![ReadStep::Data(payload.clone())]);
        let mut remote = Endpoint::new(vec![]);
        remote.finish = Some((payload.len(), stop.clone()));
        remote.writes = (0..40).map(|_| Ok(101)).collect();
        relay_nonblocking(&mut local, &mut remote, &stop).unwrap();
        assert_eq!(remote.received, payload);
    }

    #[test]
    fn forward_relay_zero_write_and_fatal_io_fail_instead_of_spinning() {
        for (result, expected) in [
            (Ok(0), ErrorKind::WriteZero),
            (
                Err(io::Error::from(ErrorKind::ConnectionReset)),
                ErrorKind::ConnectionReset,
            ),
        ] {
            let mut local = Endpoint::new(vec![ReadStep::Data(vec![1])]);
            let mut remote = Endpoint::new(vec![]);
            remote.writes.push_back(result);
            assert_eq!(
                relay_nonblocking(&mut local, &mut remote, &AtomicBool::new(false))
                    .unwrap_err()
                    .kind(),
                expected
            );
        }
    }

    #[test]
    fn forward_relay_owner_drop_cancels_idle_native_worker() {
        let owner = RelayOwner::new();
        let cancel = owner.0.clone();
        let worker = std::thread::spawn(move || {
            relay_nonblocking(
                &mut Endpoint::new(vec![]),
                &mut Endpoint::new(vec![]),
                &cancel,
            )
        });
        drop(owner);
        worker.join().unwrap().unwrap();
    }

    // Absolute deadlines prevent a peer making tiny amounts of progress from
    // indefinitely renewing a per-read timeout. These wrappers are test-only;
    // the production relay deliberately has no certificate-approval deadline.
    struct DeadlineSocket {
        socket: TcpStream,
        deadline: Instant,
    }

    impl DeadlineSocket {
        fn remaining(&self) -> io::Result<Duration> {
            self.deadline
                .checked_duration_since(Instant::now())
                .filter(|remaining| !remaining.is_zero())
                .ok_or_else(|| io::Error::new(ErrorKind::TimedOut, "loopback TLS fixture deadline"))
        }
    }

    impl Read for DeadlineSocket {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            self.socket.set_read_timeout(Some(self.remaining()?))?;
            self.socket.read(bytes)
        }
    }

    impl Write for DeadlineSocket {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.socket.set_write_timeout(Some(self.remaining()?))?;
            self.socket.write(bytes)
        }
        fn flush(&mut self) -> io::Result<()> {
            self.socket.flush()
        }
    }

    fn loopback_pair(deadline: Instant) -> io::Result<(TcpStream, TcpStream)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let client = TcpStream::connect_timeout(&listener.local_addr()?, Duration::from_secs(1))?;
        let server = loop {
            match listener.accept() {
                Ok((server, _)) => break server,
                Err(error)
                    if error.kind() == ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(1));
                }
                Err(error) => return Err(error),
            }
        };
        // Windows accepts inherit the listener's nonblocking mode. TLS peers
        // below use blocking deadline I/O; only the pump ends are nonblocking.
        client.set_nonblocking(false)?;
        server.set_nonblocking(false)?;
        client.set_nodelay(true)?;
        server.set_nodelay(true)?;
        Ok((client, server))
    }

    struct FixtureWorkers {
        owner: Option<RelayOwner>,
        // Only clone the client/server peers, never the relay's sockets: when
        // cancellation drops the relay sockets their peers must really see EOF.
        sockets: Vec<TcpStream>,
        threads: Vec<std::thread::JoinHandle<()>>,
    }

    impl FixtureWorkers {
        fn spawn(
            &mut self,
            run: impl FnOnce() -> io::Result<()> + Send + 'static,
        ) -> std::sync::mpsc::Receiver<io::Result<()>> {
            let (send, receive) = std::sync::mpsc::channel();
            self.threads.push(std::thread::spawn(move || {
                let _ = send.send(run());
            }));
            receive
        }

        fn finish(&mut self, deadline: Instant) -> bool {
            while self.threads.iter().any(|thread| !thread.is_finished())
                && Instant::now() < deadline
            {
                std::thread::sleep(Duration::from_millis(1));
            }
            if self.threads.iter().any(|thread| !thread.is_finished()) {
                return false;
            }
            let mut successful = true;
            for thread in self.threads.drain(..) {
                successful &= thread.join().is_ok();
            }
            successful
        }
    }

    impl Drop for FixtureWorkers {
        fn drop(&mut self) {
            self.owner.take();
            for socket in &self.sockets {
                let _ = socket.shutdown(Shutdown::Both);
            }
            // No unbounded join even on an assertion failure. Peer shutdown
            // interrupts socket operations; DeadlineSocket is a second bound.
            let _ = self.finish(Instant::now() + Duration::from_secs(1));
        }
    }

    #[test]
    fn forward_relay_loopback_half_close_delivers_response_after_request_eof() {
        let deadline = Instant::now() + Duration::from_secs(5);
        let (mut client, mut relay_local) = loopback_pair(deadline).unwrap();
        let (mut relay_remote, server) = loopback_pair(deadline).unwrap();
        relay_local.set_nonblocking(true).unwrap();
        relay_remote.set_nonblocking(true).unwrap();
        let owner = RelayOwner::new();
        let cancelled = Arc::clone(&owner.0);
        let mut workers = FixtureWorkers {
            owner: Some(owner),
            sockets: vec![client.try_clone().unwrap(), server.try_clone().unwrap()],
            threads: vec![],
        };
        let relay_done = workers
            .spawn(move || relay_nonblocking(&mut relay_local, &mut relay_remote, &cancelled));
        let response: Vec<_> = (0..BUFFER_BYTES * 4 + 7).map(|i| (i % 251) as u8).collect();
        let expected = response.clone();
        let server_done = workers.spawn(move || {
            let mut server = DeadlineSocket {
                socket: server,
                deadline,
            };
            let mut request = vec![];
            server.read_to_end(&mut request)?;
            assert_eq!(request, b"request-needs-fin");
            server.write_all(&response)?;
            server.socket.shutdown(Shutdown::Write)?;
            Ok(())
        });
        client.write_all(b"request-needs-fin").unwrap();
        client.shutdown(Shutdown::Write).unwrap();
        let mut client = DeadlineSocket {
            socket: client,
            deadline,
        };
        let mut received = vec![];
        client.read_to_end(&mut received).unwrap();
        assert_eq!(received, expected);
        relay_done
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        server_done
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        assert!(workers.finish(Instant::now() + Duration::from_secs(1)));
    }

    #[test]
    fn forward_relay_loopback_tls_handshake_binary_idle_and_cancel_cleanup() {
        use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName};

        let certificate =
            rcgen::generate_simple_self_signed(vec!["relay.fixture.test".into()]).unwrap();
        let der = CertificateDer::from(certificate.serialize_der().unwrap());
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            certificate.serialize_private_key_der(),
        ));
        // Never install/change the process-global provider: other parallel
        // suites may use aws-lc-rs. Both configurations select ring explicitly.
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let server_config = Arc::new(
            rustls::ServerConfig::builder_with_provider(provider.clone())
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_no_client_auth()
                .with_single_cert(vec![der.clone()], key)
                .unwrap(),
        );
        let mut roots = rustls::RootCertStore::empty();
        roots.add(der).unwrap();
        let client_config = Arc::new(
            rustls::ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_root_certificates(roots)
                .with_no_client_auth(),
        );

        let deadline = Instant::now() + Duration::from_secs(5);
        let (client_socket, mut relay_local) = loopback_pair(deadline).unwrap();
        let (mut relay_remote, server_socket) = loopback_pair(deadline).unwrap();
        relay_local.set_nonblocking(true).unwrap();
        relay_remote.set_nonblocking(true).unwrap();
        let owner = RelayOwner::new();
        let cancel = Arc::clone(&owner.0);
        let mut workers = FixtureWorkers {
            owner: Some(owner),
            sockets: vec![
                client_socket.try_clone().unwrap(),
                server_socket.try_clone().unwrap(),
            ],
            threads: vec![],
        };
        let relay_done =
            workers.spawn(move || relay_nonblocking(&mut relay_local, &mut relay_remote, &cancel));
        let request: Vec<u8> = (0..BUFFER_BYTES * 3 + 19)
            .map(|index| (index % 256) as u8)
            .collect();
        let response: Vec<u8> = (0..BUFFER_BYTES * 2 + 37)
            .map(|index| (255 - index % 256) as u8)
            .collect();
        let server_request = request.clone();
        let server_response = response.clone();
        let (handshake_send, handshake_received) = std::sync::mpsc::channel();
        let (idle_send, idle_received) = std::sync::mpsc::channel();
        let server_done = workers.spawn(move || {
            let mut tls = rustls::StreamOwned::new(
                rustls::ServerConnection::new(server_config).unwrap(),
                DeadlineSocket {
                    socket: server_socket,
                    deadline,
                },
            );
            while tls.conn.is_handshaking() {
                tls.conn.complete_io(&mut tls.sock)?;
            }
            handshake_send.send(()).unwrap();
            let mut received = vec![0; server_request.len()];
            tls.read_exact(&mut received)?;
            assert_eq!(received, server_request);
            tls.write_all(&server_response)?;
            tls.flush()?;
            let mut marker = [0; 4];
            tls.read_exact(&mut marker)?;
            assert_eq!(&marker, b"done");
            idle_send.send(()).unwrap();
            // Keep the server alive until *relay cancellation* closes its TCP
            // peer, rather than closing the server to make the pump exit.
            match tls.sock.read(&mut [0; 1]) {
                Ok(0) => Ok(()),
                Err(error) if error.kind() == ErrorKind::ConnectionReset => Ok(()),
                Err(error) => Err(error),
                Ok(_) => Err(io::Error::new(
                    ErrorKind::InvalidData,
                    "unexpected bytes after cancellation marker",
                )),
            }
        });
        let mut tls = rustls::StreamOwned::new(
            rustls::ClientConnection::new(
                client_config,
                ServerName::try_from("relay.fixture.test").unwrap(),
            )
            .unwrap(),
            DeadlineSocket {
                socket: client_socket,
                deadline,
            },
        );
        while tls.conn.is_handshaking() {
            tls.conn.complete_io(&mut tls.sock).unwrap();
        }
        handshake_received
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        assert!(tls.conn.negotiated_cipher_suite().is_some());

        // Both peers are deliberately silent for many idle polls. This proves
        // socket idleness is preserved, not that any remote approval UI ran.
        std::thread::sleep(Duration::from_millis(50));
        assert!(matches!(
            relay_done.try_recv(),
            Err(std::sync::mpsc::TryRecvError::Empty)
        ));
        tls.write_all(&request).unwrap();
        tls.flush().unwrap();
        let mut received = vec![0; response.len()];
        tls.read_exact(&mut received).unwrap();
        assert_eq!(received, response);
        tls.write_all(b"done").unwrap();
        tls.flush().unwrap();
        idle_received.recv_timeout(Duration::from_secs(1)).unwrap();

        workers.owner.take();
        relay_done
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        server_done
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        assert!(
            workers.finish(Instant::now() + Duration::from_secs(1)),
            "fixture workers did not stop"
        );
    }
}
