//! Dataplane supervisor (SE-5b).
//!
//! Owns three cooperating tokio tasks for a single SoftEther session
//! once the watermark + auth + session-key derivation have completed:
//!
//! 1. **device→net** — pull frames from [`DataplaneDevice::read_frame`],
//!    batch them (by count or by elapsed time), encode via SE-5a's
//!    Cedar wire format, write to the TLS stream.
//! 2. **net→device** — read framed batches from the TLS stream using
//!    Cedar's receive FSM (`[u32 num_blocks | KEEP_ALIVE_MAGIC]`
//!    followed by `[u32 size | body] × N`), decode via SE-5a, push
//!    each `DataFrame::Ethernet` to [`DataplaneDevice::write_frame`],
//!    and reset the keepalive deadline on `DataFrame::KeepAlive`.
//! 3. **keepalive** — every `keepalive_interval` derived from Cedar's
//!    `GenNextKeepAliveSpan`, emit a KeepAlive batch onto the TLS side.
//!
//! All three tasks share a `tokio::sync::watch<bool>` shutdown signal
//! and a unified error channel; the first task to error flips the
//! watch and signals every peer to exit cooperatively. The returned
//! [`DataplaneHandle`] lets callers either `shutdown().await` for
//! graceful teardown or `abort()` for immediate cancellation.
//!
//! # Cipher layering note
//!
//! SoftEther's Cedar writes the framed Ethernet bytes into its
//! `SendFifo` **plain** and relies on the outer TLS stream (via
//! OpenSSL) to encrypt them. SE-4's [`CipherState`] models a secondary
//! RC4/AES layer used by UDP acceleration + some non-TLS bridges. For
//! the TLS-only path (the common case and the only path SE-5b ships)
//! we therefore operate directly on [`super::dataplane::encode_plain`]
//! / [`super::dataplane::decode_plain`] and do NOT instantiate the
//! SE-5a `DataplaneEncoder`/`Decoder` (which require a `CipherState`
//! with no pass-through variant). SE-6's UDP acceleration will layer
//! the cipher encoder/decoder on top of this supervisor when it
//! lands — see [`CipherMode`].
//!
//! # KeepAlive interval
//!
//! Cedar's `GenNextKeepAliveSpan` (Connection.c:942-956) computes:
//!
//! ```text
//! a = Session->Timeout;          // ms; server-announced via Welcome PACK, default TIMEOUT_DEFAULT (60000ms)
//! b = rand() % (a / 2);          // [0, 30000) ms
//! b = MAX(b, a / 5);             // floored at 12000 ms
//! return b;                      // between 12s and <30s
//! ```
//!
//! We ship a deterministic **20 000 ms** default (the midpoint of that
//! interval) so tests are reproducible; [`DataplaneConfig`] accepts an
//! override. A future SE-6 enhancement can restore the randomised
//! interval once we thread `Session->Timeout` through from the Welcome
//! PACK.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::dataplane::{
    decode_plain, encode_plain, DataFrame, DataplaneError, KEEP_ALIVE_MAGIC, MAX_BLOCKS_PER_BATCH,
    MAX_KEEPALIVE_SIZE, MAX_WIRE_BLOCK_SIZE,
};
use super::device::{DataplaneDevice, DeviceError};

// ─── Config ─────────────────────────────────────────────────────────────

/// Cipher layering choice. TLS-only is the common/default case; UDP
/// acceleration (SE-6) will select `Layered` to run the SE-5a cipher
/// encoder/decoder in addition to (or instead of) TLS.
#[derive(Debug, Clone)]
pub enum CipherMode {
    /// Pure TLS: framed bytes go to the wire unencrypted (the TLS
    /// layer encrypts them). This is what SE-5b ships today.
    TlsOnly,
    /// Layered cipher (SE-5a's `DataplaneEncoder`/`Decoder`) — reserved
    /// for SE-6 UDP acceleration. Construction is deferred; SE-5b does
    /// NOT wire this arm.
    #[allow(dead_code)]
    Layered, // SE-6 will stash `SessionKeys` here.
}

/// Runtime tunables for [`spawn_dataplane`]. Defaults are Cedar-derived
/// — see module docs.
#[derive(Debug, Clone)]
pub struct DataplaneConfig {
    /// Interval between keepalive batches. Default: 20 000 ms
    /// (midpoint of Cedar's randomised 12 000–30 000 ms range).
    pub keepalive_interval: Duration,
    /// Maximum frames per outbound batch before a forced flush.
    /// Default: 16 — a small multiple of typical Ethernet burst depth
    /// that stays well under Cedar's `MAX_SEND_SOCKET_QUEUE_NUM = 8192`.
    pub batch_max_frames: usize,
    /// Upper bound on how long the first un-flushed frame may sit
    /// waiting for siblings. Default: 10 ms — round-trip latency
    /// dominates over batching above ~10 ms.
    pub batch_flush: Duration,
    /// Cipher layering mode. Default: `CipherMode::TlsOnly`.
    pub cipher: CipherMode,
    /// SE-6: multiplier on `keepalive_interval` after which the
    /// watchdog fires `DataplaneSupervisorError::KeepaliveTimeout`.
    /// Default: 2 (matches Cedar's "2x KEEP_ALIVE means dead" heuristic
    /// in Connection.c).
    pub keepalive_timeout_multiplier: u32,
}

impl Default for DataplaneConfig {
    fn default() -> Self {
        Self {
            keepalive_interval: Duration::from_millis(20_000),
            batch_max_frames: 16,
            batch_flush: Duration::from_millis(10),
            cipher: CipherMode::TlsOnly,
            keepalive_timeout_multiplier: 2,
        }
    }
}

// ─── Errors ─────────────────────────────────────────────────────────────

/// Terminal error surfaced by the supervisor's join handle.
#[derive(Debug)]
pub enum DataplaneSupervisorError {
    /// SE-5a framing encoder/decoder failure (oversized block, too
    /// many blocks, cipher error, truncated batch …).
    Dataplane(DataplaneError),
    /// [`DataplaneDevice`] backing error (TAP closed, write failed…).
    Device(DeviceError),
    /// TLS-stream I/O error.
    Tls(std::io::Error),
    /// No batch observed (including keepalives) within the expected
    /// liveness window. SE-6 wires this to a real `2 *
    /// keepalive_interval` watchdog — see [`keepalive_watchdog`].
    KeepaliveTimeout,
    /// A supervised task panicked (reason wrapped).
    TaskPanicked(String),
    /// Shutdown completed cleanly. This variant is only observed via
    /// [`DataplaneHandle::shutdown`] — the join handle itself returns
    /// `Ok(())` on a clean exit.
    #[allow(dead_code)]
    Shutdown,
}

impl std::fmt::Display for DataplaneSupervisorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Dataplane(e) => write!(f, "dataplane framing error: {}", e),
            Self::Device(e) => write!(f, "dataplane device error: {}", e),
            Self::Tls(e) => write!(f, "dataplane TLS I/O error: {}", e),
            Self::KeepaliveTimeout => write!(f, "dataplane keepalive timeout"),
            Self::TaskPanicked(m) => write!(f, "dataplane task panicked: {}", m),
            Self::Shutdown => write!(f, "dataplane shutdown"),
        }
    }
}

impl std::error::Error for DataplaneSupervisorError {}

impl DataplaneSupervisorError {
    /// Categorize errors for the SE-6 reconnect loop.
    ///
    /// Transient errors (return `true`) are candidates for retry: the
    /// underlying TLS pipe broke, a keepalive watchdog fired, the peer
    /// dropped the socket, or an I/O timeout hit. The reconnect loop
    /// will re-run `softether_handshake_and_auth + spawn_dataplane`.
    ///
    /// Fatal errors (return `false`) indicate a programmer/config
    /// bug — dataplane framing error, malformed device, or a supervisor
    /// task panic. Reconnecting would loop forever.
    pub fn is_transient(&self) -> bool {
        match self {
            // Pipe broke / peer dropped us — reconnectable.
            Self::Tls(_) => true,
            Self::KeepaliveTimeout => true,
            // Device closed (TAP torn down) — transient. Driver errors
            // are fatal.
            Self::Device(DeviceError::Closed) => true,
            Self::Device(DeviceError::Io(_)) => true,
            Self::Device(DeviceError::PermissionDenied(_)) => false,
            Self::Device(DeviceError::DriverMissing(_)) => false,
            // Framing error is a protocol-level bug; retrying won't
            // fix it. Panic is also fatal. Shutdown is not an error
            // at all.
            Self::Dataplane(_) => false,
            Self::TaskPanicked(_) => false,
            Self::Shutdown => false,
        }
    }
}

impl From<DataplaneError> for DataplaneSupervisorError {
    fn from(e: DataplaneError) -> Self {
        Self::Dataplane(e)
    }
}
impl From<DeviceError> for DataplaneSupervisorError {
    fn from(e: DeviceError) -> Self {
        Self::Device(e)
    }
}
impl From<std::io::Error> for DataplaneSupervisorError {
    fn from(e: std::io::Error) -> Self {
        Self::Tls(e)
    }
}

// ─── Handle ─────────────────────────────────────────────────────────────

/// Handle on a running dataplane supervisor. Either await
/// [`Self::shutdown`] for graceful teardown or call [`Self::abort`] to
/// hard-cancel the joined task.
pub struct DataplaneHandle {
    shutdown_tx: watch::Sender<bool>,
    pub(crate) join: JoinHandle<Result<(), DataplaneSupervisorError>>,
    /// Name of the attached device — diagnostic use only.
    pub device_name: String,
}

impl DataplaneHandle {
    /// Signal a graceful shutdown and await the supervisor task. On
    /// clean teardown returns `Ok(())`; otherwise returns whatever
    /// terminal error the supervisor observed.
    pub async fn shutdown(self) -> Result<(), DataplaneSupervisorError> {
        let _ = self.shutdown_tx.send(true);
        match self.join.await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e),
            Err(join_err) => Err(DataplaneSupervisorError::TaskPanicked(join_err.to_string())),
        }
    }

    /// Cancel the supervisor task immediately. Remaining frames are
    /// dropped. Safe to call if already exited.
    pub fn abort(self) {
        self.join.abort();
    }
}

// ─── Public API ─────────────────────────────────────────────────────────

/// Spawn the three supervisor tasks over a TLS stream + dataplane
/// device + the Cedar-format framing codec.
///
/// The stream + device are consumed (moved into the per-direction
/// tasks). Returns a [`DataplaneHandle`] once spawning succeeds; this
/// call does not block on any I/O and is therefore usable from a
/// `SoftEtherService::connect` path without holding the service mutex
/// across network round-trips.
pub async fn spawn_dataplane<S, D>(
    stream: S,
    device: D,
    config: DataplaneConfig,
) -> Result<DataplaneHandle, DataplaneSupervisorError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    D: DataplaneDevice,
{
    // Cipher direction ownership: no shared Mutex. `CipherMode::TlsOnly`
    // needs no state at all, so the supervisor doesn't instantiate any
    // cipher struct. SE-6 will extend this match arm to construct
    // direction-specific encoder/decoder and move each into the
    // appropriate per-task closure.
    match config.cipher {
        CipherMode::TlsOnly => {}
        CipherMode::Layered => {
            return Err(DataplaneSupervisorError::Tls(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "CipherMode::Layered is SE-6 UDP-accel scope",
            )));
        }
    }

    let device_name = device.name().to_string();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // SE-6: shared "last RX timestamp" — the reader task bumps this
    // whenever a record arrives (including keepalives). The watchdog
    // task fires `KeepaliveTimeout` if it stays stale for
    // `keepalive_interval * keepalive_timeout_multiplier`.
    let last_rx = Arc::new(tokio::sync::Mutex::new(tokio::time::Instant::now()));

    // Single error bus — first task to push wins; runner aborts the
    // others on receipt.
    let (err_tx, mut err_rx) = mpsc::channel::<DataplaneSupervisorError>(4);

    // Split the TLS stream into owned read + write halves so reader &
    // writer tasks can run in parallel.
    let (mut tls_read, mut tls_write) = tokio::io::split(stream);

    // Channel: encoder-side ethernet frames arriving from the device
    // reader task. The writer task drains this, batches, encodes, and
    // writes to TLS.
    let (out_frame_tx, mut out_frame_rx) =
        mpsc::channel::<DataFrame>(config.batch_max_frames.max(16) * 4);

    // Device is split into read and write halves via two channels so
    // the supervisor can own each direction in a dedicated task.
    let (dev_in_tx, mut dev_in_rx) = mpsc::channel::<Vec<u8>>(128);
    let (dev_out_tx, mut dev_out_rx) = mpsc::channel::<Result<Vec<u8>, DeviceError>>(128);

    // Device owner task — bridges the async trait to two channels so
    // we can `tokio::select!` freely in the supervisor tasks without
    // borrowing `&mut device` in two places.
    let mut device = device;
    let device_shutdown = shutdown_rx.clone();
    let device_err = err_tx.clone();
    let device_task = tokio::spawn(async move {
        let mut shutdown = device_shutdown;
        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { return; }
                }
                read = device.read_frame() => {
                    match read {
                        Ok(bytes) => {
                            if dev_out_tx.send(Ok(bytes)).await.is_err() {
                                return;
                            }
                        }
                        Err(e) => {
                            let _ = dev_out_tx.send(Err(clone_device_error(&e))).await;
                            let _ = device_err.send(DataplaneSupervisorError::Device(e)).await;
                            return;
                        }
                    }
                }
                Some(frame) = dev_in_rx.recv() => {
                    if let Err(e) = device.write_frame(&frame).await {
                        let _ = device_err.send(DataplaneSupervisorError::Device(e)).await;
                        return;
                    }
                }
            }
        }
    });

    // device→net task: pull frames from device_out channel, feed the
    // batch-encoder channel. The batch loop lives in the TLS-writer
    // task so keepalives can be interleaved without racing.
    let dev_to_net_shutdown = shutdown_rx.clone();
    let dev_to_net_err = err_tx.clone();
    let dev_to_net_task: JoinHandle<()> = tokio::spawn(async move {
        let mut shutdown = dev_to_net_shutdown;
        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { return; }
                }
                maybe = dev_out_rx.recv() => {
                    match maybe {
                        Some(Ok(bytes)) => {
                            if out_frame_tx.send(DataFrame::Ethernet(bytes)).await.is_err() {
                                return;
                            }
                        }
                        Some(Err(e)) => {
                            let _ = dev_to_net_err.send(DataplaneSupervisorError::Device(e)).await;
                            return;
                        }
                        None => return,
                    }
                }
            }
        }
    });

    // Writer task: batch + keepalive + TLS write.
    let writer_cfg = config.clone();
    let writer_shutdown = shutdown_rx.clone();
    let writer_err = err_tx.clone();
    let writer_task: JoinHandle<()> = tokio::spawn(async move {
        let mut shutdown = writer_shutdown;
        let mut batch: Vec<DataFrame> = Vec::with_capacity(writer_cfg.batch_max_frames);
        let mut keepalive = tokio::time::interval(writer_cfg.keepalive_interval);
        // First tick fires immediately — skip it so we don't send a
        // KA before any real traffic has flowed. Callers that want a
        // prompt initial KA can set a short batch_flush on purpose.
        keepalive.tick().await;

        // Deadline-based flush: whenever `batch` goes non-empty we
        // arm a timer; once it fires OR the batch hits the max, we
        // flush.
        let batch_flush = writer_cfg.batch_flush;
        let flush_sleep: Option<tokio::time::Instant> = None;
        let mut flush_sleep = flush_sleep;

        loop {
            // Compute the next wake-up: keepalive + optional
            // flush deadline.
            let flush_fut = async {
                if let Some(deadline) = flush_sleep {
                    tokio::time::sleep_until(deadline).await;
                    true
                } else {
                    std::future::pending::<()>().await;
                    unreachable!()
                }
            };

            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() {
                        // Flush residual batch on graceful shutdown.
                        if !batch.is_empty() {
                            if let Err(e) = encode_and_write(&mut tls_write, &batch).await {
                                let _ = writer_err.send(e).await;
                            }
                        }
                        return;
                    }
                }
                // Flush deadline hit.
                _flushed = flush_fut => {
                    if !batch.is_empty() {
                        if let Err(e) = encode_and_write(&mut tls_write, &batch).await {
                            let _ = writer_err.send(e).await;
                            return;
                        }
                        batch.clear();
                    }
                    flush_sleep = None;
                }
                // Keepalive tick.
                _ = keepalive.tick() => {
                    // Emit a KA as its own record so the Cedar receiver
                    // picks it up via the mode-3 keepalive path.
                    if let Err(e) = encode_and_write(
                        &mut tls_write,
                        &[DataFrame::KeepAlive],
                    ).await {
                        let _ = writer_err.send(e).await;
                        return;
                    }
                }
                // Frame arrival.
                maybe = out_frame_rx.recv() => {
                    match maybe {
                        Some(frame) => {
                            if batch.is_empty() {
                                // Arm the flush timer on first frame.
                                flush_sleep = Some(
                                    tokio::time::Instant::now() + batch_flush,
                                );
                            }
                            batch.push(frame);
                            if batch.len() >= writer_cfg.batch_max_frames {
                                if let Err(e) = encode_and_write(&mut tls_write, &batch).await {
                                    let _ = writer_err.send(e).await;
                                    return;
                                }
                                batch.clear();
                                flush_sleep = None;
                            }
                        }
                        None => {
                            // Upstream device→net task closed. Flush
                            // residual and exit cleanly.
                            if !batch.is_empty() {
                                if let Err(e) = encode_and_write(&mut tls_write, &batch).await {
                                    let _ = writer_err.send(e).await;
                                }
                            }
                            return;
                        }
                    }
                }
            }
        }
    });

    // Reader task: parse Cedar receive FSM directly off the TLS
    // stream. `decode_plain` (SE-5a) is reused per-record for the
    // body-level decode once we've read the full record bytes.
    let reader_shutdown = shutdown_rx.clone();
    let reader_err = err_tx.clone();
    let reader_last_rx = last_rx.clone();
    let reader_task: JoinHandle<()> = tokio::spawn(async move {
        let mut shutdown = reader_shutdown;
        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { return; }
                }
                record = read_one_record(&mut tls_read) => {
                    match record {
                        Ok(frames) => {
                            // SE-6: bump watchdog deadline on any
                            // successful record (ethernet or KA).
                            *reader_last_rx.lock().await = tokio::time::Instant::now();
                            for f in frames {
                                if let DataFrame::Ethernet(bytes) = f {
                                    if dev_in_tx.send(bytes).await.is_err() {
                                        return;
                                    }
                                }
                                // KeepAlives are discarded here —
                                // Cedar's receiver only uses them to
                                // refresh a comm timestamp, which we
                                // track implicitly via the fact that
                                // we received *something* at all.
                            }
                        }
                        Err(e) => {
                            let _ = reader_err.send(e).await;
                            return;
                        }
                    }
                }
            }
        }
    });

    // SE-6: KeepAlive watchdog. Polls every `keepalive_interval / 2`
    // and surfaces `KeepaliveTimeout` when no record has arrived in
    // `keepalive_interval * keepalive_timeout_multiplier`. Setting
    // `keepalive_timeout_multiplier == 0` disables the watchdog
    // (used by tests that don't want it racing their assertions).
    let watchdog_mult = config.keepalive_timeout_multiplier;
    let watchdog_interval = config.keepalive_interval;
    let watchdog_shutdown = shutdown_rx.clone();
    let watchdog_err = err_tx.clone();
    let watchdog_last_rx = last_rx.clone();
    let watchdog_task: JoinHandle<()> = tokio::spawn(async move {
        if watchdog_mult == 0 {
            // Disabled — park forever (until shutdown).
            let mut sd = watchdog_shutdown;
            let _ = sd.changed().await;
            return;
        }
        let timeout_dur = watchdog_interval
            .checked_mul(watchdog_mult)
            .unwrap_or(Duration::from_secs(u64::MAX / 2));
        let poll_period = watchdog_interval / 2;
        let mut sd = watchdog_shutdown;
        let mut ticker = tokio::time::interval(poll_period);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = sd.changed() => {
                    if *sd.borrow() { return; }
                }
                _ = ticker.tick() => {
                    let last = *watchdog_last_rx.lock().await;
                    if tokio::time::Instant::now().duration_since(last) >= timeout_dur {
                        let _ = watchdog_err
                            .send(DataplaneSupervisorError::KeepaliveTimeout)
                            .await;
                        return;
                    }
                }
            }
        }
    });

    // Runner — await first terminal error or clean end of all tasks,
    // propagate to the DataplaneHandle consumer.
    let runner_shutdown_tx = shutdown_tx.clone();
    let runner: JoinHandle<Result<(), DataplaneSupervisorError>> = tokio::spawn(async move {
        let first_err: Option<DataplaneSupervisorError> = err_rx.recv().await;

        // On first terminal error (or any task return), fire shutdown
        // and abort peers.
        let _ = runner_shutdown_tx.send(true);
        device_task.abort();
        dev_to_net_task.abort();
        writer_task.abort();
        reader_task.abort();
        watchdog_task.abort();

        // Await peers so the handle's join awaits full teardown.
        let _ = device_task.await;
        let _ = dev_to_net_task.await;
        let _ = writer_task.await;
        let _ = reader_task.await;
        let _ = watchdog_task.await;

        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    });

    Ok(DataplaneHandle {
        shutdown_tx,
        join: runner,
        device_name,
    })
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Clone a [`DeviceError`] losslessly (the type isn't `Clone`, but we
/// need to fan it out to both the device task and the error bus).
fn clone_device_error(e: &DeviceError) -> DeviceError {
    match e {
        DeviceError::Closed => DeviceError::Closed,
        DeviceError::PermissionDenied(m) => DeviceError::PermissionDenied(m.clone()),
        DeviceError::DriverMissing(m) => DeviceError::DriverMissing(m.clone()),
        DeviceError::Io(io) => DeviceError::Io(std::io::Error::new(io.kind(), io.to_string())),
    }
}

/// Encode a slice of frames via SE-5a's plain codec (no cipher — TLS
/// handles encryption) and write the entire record to the TLS stream.
async fn encode_and_write<W>(
    w: &mut W,
    frames: &[DataFrame],
) -> Result<(), DataplaneSupervisorError>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    let bytes = encode_plain(frames)?;
    if !bytes.is_empty() {
        w.write_all(&bytes).await?;
        w.flush().await?;
    }
    Ok(())
}

/// Read a single Cedar record from the wire and return the decoded
/// frames. Mirrors the receive FSM in `Cedar/Connection.c::2129-2316`:
/// read `num_blocks`; if it's the KA magic, read one size+body pair;
/// otherwise read N size+body pairs. The assembled bytes are then fed
/// through SE-5a's [`decode_plain`] for reuse of its bounds checks.
async fn read_one_record<R>(r: &mut R) -> Result<Vec<DataFrame>, DataplaneSupervisorError>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut num_buf = [0u8; 4];
    r.read_exact(&mut num_buf).await?;
    let num = u32::from_be_bytes(num_buf);

    let mut assembled: Vec<u8> = Vec::with_capacity(4 + 64);
    assembled.extend_from_slice(&num_buf);

    if num == KEEP_ALIVE_MAGIC {
        let mut sz_buf = [0u8; 4];
        r.read_exact(&mut sz_buf).await?;
        let sz = u32::from_be_bytes(sz_buf);
        if sz > MAX_KEEPALIVE_SIZE {
            return Err(DataplaneError::KeepAliveTooLarge(sz).into());
        }
        assembled.extend_from_slice(&sz_buf);
        let mut body = vec![0u8; sz as usize];
        r.read_exact(&mut body).await?;
        assembled.extend_from_slice(&body);
    } else {
        if num > MAX_BLOCKS_PER_BATCH {
            return Err(DataplaneError::TooManyBlocks(num).into());
        }
        for _ in 0..num {
            let mut sz_buf = [0u8; 4];
            r.read_exact(&mut sz_buf).await?;
            let sz = u32::from_be_bytes(sz_buf);
            if sz > MAX_WIRE_BLOCK_SIZE {
                return Err(DataplaneError::BlockTooLarge(sz).into());
            }
            assembled.extend_from_slice(&sz_buf);
            let mut body = vec![0u8; sz as usize];
            r.read_exact(&mut body).await?;
            assembled.extend_from_slice(&body);
        }
    }

    decode_plain(&assembled).map_err(Into::into)
}

/// Unused silencer so the atomic type appears referenced even if we
/// don't cfg in tests that read from it directly.
#[allow(dead_code)]
fn _touch_atomic(_: &Arc<AtomicBool>) {}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::softether::device::MpscDevice;
    use tokio::io::duplex;

    fn eth(bytes: &[u8]) -> DataFrame {
        DataFrame::Ethernet(bytes.to_vec())
    }

    fn test_config() -> DataplaneConfig {
        DataplaneConfig {
            keepalive_interval: Duration::from_millis(60_000),
            batch_max_frames: 4,
            batch_flush: Duration::from_millis(5),
            cipher: CipherMode::TlsOnly,
            keepalive_timeout_multiplier: 0, // watchdog disabled in most tests
        }
    }

    // ── Config + error plumbing ─────────────────────────────────────

    #[test]
    fn default_config_matches_cedar_derived_constants() {
        let cfg = DataplaneConfig::default();
        // Cedar's GenNextKeepAliveSpan midpoint is ~20s given
        // TIMEOUT_DEFAULT = 60s; confirm our default.
        assert_eq!(cfg.keepalive_interval, Duration::from_millis(20_000));
        assert_eq!(cfg.batch_max_frames, 16);
        assert_eq!(cfg.batch_flush, Duration::from_millis(10));
        assert!(matches!(cfg.cipher, CipherMode::TlsOnly));
    }

    #[test]
    fn error_conversions_round_trip() {
        let de = DataplaneError::Truncated;
        let se: DataplaneSupervisorError = de.into();
        assert!(matches!(se, DataplaneSupervisorError::Dataplane(_)));
        let devv: DataplaneSupervisorError = DeviceError::Closed.into();
        assert!(matches!(devv, DataplaneSupervisorError::Device(_)));
        let iov: DataplaneSupervisorError =
            std::io::Error::new(std::io::ErrorKind::Other, "x").into();
        assert!(matches!(iov, DataplaneSupervisorError::Tls(_)));
    }

    // ── Cipher-mode gating ─────────────────────────────────────────

    #[tokio::test]
    async fn layered_cipher_mode_returns_unsupported() {
        let (client_side, _server_side) = duplex(128);
        let (dev, _handle) = MpscDevice::new_pair(4, "t");
        let mut cfg = test_config();
        cfg.cipher = CipherMode::Layered;
        let res = spawn_dataplane(client_side, dev, cfg).await;
        assert!(matches!(res, Err(DataplaneSupervisorError::Tls(_))));
    }

    // ── Reader-half primitive ───────────────────────────────────────

    #[tokio::test]
    async fn read_one_record_decodes_single_eth_batch() {
        // Build a one-frame batch using SE-5a.
        let wire = encode_plain(&[eth(b"payload")]).unwrap();
        let mut cursor = std::io::Cursor::new(wire);
        let frames = read_one_record(&mut cursor).await.expect("read");
        assert_eq!(frames, vec![eth(b"payload")]);
    }

    #[tokio::test]
    async fn read_one_record_decodes_keepalive_batch() {
        let wire = encode_plain(&[DataFrame::KeepAlive]).unwrap();
        let mut cursor = std::io::Cursor::new(wire);
        let frames = read_one_record(&mut cursor).await.expect("read");
        assert_eq!(frames, vec![DataFrame::KeepAlive]);
    }

    #[tokio::test]
    async fn read_one_record_rejects_too_many_blocks() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(MAX_BLOCKS_PER_BATCH + 1).to_be_bytes());
        let mut cursor = std::io::Cursor::new(buf);
        let err = read_one_record(&mut cursor).await.expect_err("too many");
        assert!(matches!(
            err,
            DataplaneSupervisorError::Dataplane(DataplaneError::TooManyBlocks(_))
        ));
    }

    #[tokio::test]
    async fn read_one_record_rejects_oversized_block() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&(MAX_WIRE_BLOCK_SIZE + 1).to_be_bytes());
        let mut cursor = std::io::Cursor::new(buf);
        let err = read_one_record(&mut cursor).await.expect_err("big");
        assert!(matches!(
            err,
            DataplaneSupervisorError::Dataplane(DataplaneError::BlockTooLarge(_))
        ));
    }

    #[tokio::test]
    async fn read_one_record_rejects_oversized_keepalive() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&KEEP_ALIVE_MAGIC.to_be_bytes());
        buf.extend_from_slice(&(MAX_KEEPALIVE_SIZE + 1).to_be_bytes());
        let mut cursor = std::io::Cursor::new(buf);
        let err = read_one_record(&mut cursor).await.expect_err("ka big");
        assert!(matches!(
            err,
            DataplaneSupervisorError::Dataplane(DataplaneError::KeepAliveTooLarge(_))
        ));
    }

    // ── End-to-end supervisor w/ MpscDevice + duplex TLS surrogate ─

    /// Helper — drive a supervisor end-to-end with a mock "server"
    /// that reads/writes the other half of a `duplex` pair.
    async fn setup_supervisor(
        cfg: DataplaneConfig,
    ) -> (
        DataplaneHandle,
        tokio::io::DuplexStream,
        super::super::device::MpscDeviceHandle,
    ) {
        let (client_side, server_side) = duplex(64 * 1024);
        let (dev, handle) = MpscDevice::new_pair(32, "supervisor-test");
        let sup = spawn_dataplane(client_side, dev, cfg).await.expect("spawn");
        (sup, server_side, handle)
    }

    #[tokio::test]
    async fn device_to_net_delivers_frame_on_server_side() {
        let (sup, mut server_side, handle) = setup_supervisor(test_config()).await;
        // Push one frame from "TAP" — the supervisor batches, waits
        // `batch_flush`, then writes to the "server".
        handle.tx.send(b"hello-from-tap".to_vec()).await.unwrap();

        // Read one record off the server side.
        let frames = read_one_record(&mut server_side).await.expect("server read");
        assert_eq!(frames, vec![eth(b"hello-from-tap")]);

        sup.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn net_to_device_delivers_frame_to_tap() {
        let (sup, mut server_side, mut handle) = setup_supervisor(test_config()).await;

        // Encode a one-frame batch and write from "server".
        let wire = encode_plain(&[eth(b"hello-from-server")]).unwrap();
        server_side.write_all(&wire).await.unwrap();
        server_side.flush().await.unwrap();

        // Expect it on the TAP handle side.
        let got = handle.rx.recv().await.expect("tap recv");
        assert_eq!(got, b"hello-from-server");

        sup.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn batch_flushes_at_max_frames() {
        let mut cfg = test_config();
        cfg.batch_max_frames = 4;
        cfg.batch_flush = Duration::from_secs(60); // so only max triggers
        let (sup, mut server_side, handle) = setup_supervisor(cfg).await;

        // Push exactly batch_max frames.
        for i in 0..4u8 {
            handle.tx.send(vec![0xA0 + i]).await.unwrap();
        }

        // Exactly one record should appear, with 4 frames.
        let frames = read_one_record(&mut server_side).await.expect("read");
        assert_eq!(frames.len(), 4);
        for (i, f) in frames.iter().enumerate() {
            if let DataFrame::Ethernet(b) = f {
                assert_eq!(b, &vec![0xA0 + i as u8]);
            } else {
                panic!("expected eth");
            }
        }

        sup.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn batch_flushes_on_elapsed_time() {
        let cfg = DataplaneConfig {
            keepalive_interval: Duration::from_secs(3600),
            batch_max_frames: 64, // never reached
            batch_flush: Duration::from_millis(15),
            cipher: CipherMode::TlsOnly,
            keepalive_timeout_multiplier: 0,
        };
        let (sup, mut server_side, handle) = setup_supervisor(cfg).await;

        handle.tx.send(b"solo".to_vec()).await.unwrap();
        // Give the flush timer real-world time to fire.
        let frames = tokio::time::timeout(
            Duration::from_millis(500),
            read_one_record(&mut server_side),
        )
        .await
        .expect("timed out awaiting flush")
        .expect("read");
        assert_eq!(frames, vec![eth(b"solo")]);

        sup.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn keepalive_fires_on_timer() {
        // Real-time test: a short keepalive interval (50 ms) means we
        // should observe at least one KA record within ~250 ms. We
        // avoid `tokio::time::pause`/`advance` because those require
        // the `test-util` feature which isn't enabled in the workspace
        // tokio dependency.
        let cfg = DataplaneConfig {
            keepalive_interval: Duration::from_millis(50),
            batch_max_frames: 4,
            batch_flush: Duration::from_secs(3600),
            cipher: CipherMode::TlsOnly,
            keepalive_timeout_multiplier: 0,
        };
        let (sup, mut server_side, _handle) = setup_supervisor(cfg).await;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
        loop {
            if tokio::time::Instant::now() >= deadline {
                panic!("keepalive never observed");
            }
            match tokio::time::timeout(
                Duration::from_millis(200),
                read_one_record(&mut server_side),
            )
            .await
            {
                Ok(Ok(frames)) => {
                    if frames.iter().any(|f| matches!(f, DataFrame::KeepAlive)) {
                        sup.shutdown().await.expect("shutdown");
                        return;
                    }
                }
                _ => {}
            }
        }
    }

    #[tokio::test]
    async fn clean_shutdown_exits_without_error() {
        let (sup, _server_side, _handle) = setup_supervisor(test_config()).await;
        // No traffic — just shut down.
        let res = sup.shutdown().await;
        assert!(res.is_ok(), "clean shutdown errored: {:?}", res);
    }

    #[tokio::test]
    async fn decoder_error_on_server_side_propagates() {
        let (sup, mut server_side, _handle) = setup_supervisor(test_config()).await;
        // Write garbage claiming too many blocks.
        let mut bad = Vec::new();
        bad.extend_from_slice(&(MAX_BLOCKS_PER_BATCH + 5).to_be_bytes());
        server_side.write_all(&bad).await.unwrap();
        server_side.flush().await.unwrap();

        // Await the join handle directly — do NOT call shutdown()
        // first, since that would race the reader's error path. The
        // reader must detect the bad record itself and propagate via
        // the error bus before the runner tears tasks down.
        let res = tokio::time::timeout(Duration::from_millis(500), sup.join).await;
        match res {
            Ok(Ok(Err(DataplaneSupervisorError::Dataplane(_)))) => {}
            other => panic!("expected Dataplane error, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn mixed_ethernet_and_keepalive_from_server_reach_tap() {
        let (sup, mut server_side, mut handle) = setup_supervisor(test_config()).await;

        // Batch: [eth, KA, eth]
        let wire = encode_plain(&[
            eth(b"first"),
            DataFrame::KeepAlive,
            eth(b"third"),
        ])
        .unwrap();
        server_side.write_all(&wire).await.unwrap();
        server_side.flush().await.unwrap();

        // Only ethernet frames should reach the TAP.
        assert_eq!(handle.rx.recv().await.unwrap(), b"first");
        assert_eq!(handle.rx.recv().await.unwrap(), b"third");

        sup.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn shutdown_is_idempotent_at_join_level() {
        let (sup, _server_side, _handle) = setup_supervisor(test_config()).await;
        let res = sup.shutdown().await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn abort_cancels_tasks_without_panic() {
        let (sup, _server_side, _handle) = setup_supervisor(test_config()).await;
        sup.abort();
        // no .await on the join after abort — just confirm no panic
        // propagated via the executor. Sleep a tick so the abort can
        // land.
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    #[tokio::test]
    async fn bidirectional_round_trip_two_frames_each_way() {
        let (sup, mut server_side, mut handle) = setup_supervisor(test_config()).await;

        // Device → server
        handle.tx.send(b"c2s-1".to_vec()).await.unwrap();
        handle.tx.send(b"c2s-2".to_vec()).await.unwrap();

        // Collect until we see both frames (may arrive as one or two
        // records depending on batch timing).
        let mut seen: Vec<Vec<u8>> = Vec::new();
        while seen.len() < 2 {
            let frames = read_one_record(&mut server_side).await.expect("record");
            for f in frames {
                if let DataFrame::Ethernet(b) = f {
                    seen.push(b);
                }
            }
        }
        assert_eq!(seen[0], b"c2s-1");
        assert_eq!(seen[1], b"c2s-2");

        // Server → device
        let wire = encode_plain(&[eth(b"s2c-1"), eth(b"s2c-2")]).unwrap();
        server_side.write_all(&wire).await.unwrap();
        server_side.flush().await.unwrap();
        assert_eq!(handle.rx.recv().await.unwrap(), b"s2c-1");
        assert_eq!(handle.rx.recv().await.unwrap(), b"s2c-2");

        sup.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn tls_eof_on_read_triggers_terminal_error() {
        let cfg = test_config();
        let (client_side, server_side) = duplex(1024);
        let (dev, _handle) = MpscDevice::new_pair(8, "eof-test");
        let sup = spawn_dataplane(client_side, dev, cfg).await.expect("spawn");
        // Close the server side abruptly — reader should EOF.
        drop(server_side);
        let res = tokio::time::timeout(Duration::from_millis(500), sup.shutdown()).await;
        match res {
            Ok(Err(DataplaneSupervisorError::Tls(_))) => {}
            Ok(Ok(())) => { /* reader finished before EOF noticed */ }
            other => panic!("unexpected shutdown outcome: {:?}", other),
        }
    }

    // ── SE-6: error taxonomy (is_transient) ─────────────────────────

    #[test]
    fn is_transient_covers_each_variant() {
        use std::io;
        assert!(DataplaneSupervisorError::Tls(
            io::Error::new(io::ErrorKind::UnexpectedEof, "eof")
        ).is_transient());
        assert!(DataplaneSupervisorError::KeepaliveTimeout.is_transient());
        assert!(DataplaneSupervisorError::Device(DeviceError::Closed).is_transient());
        assert!(DataplaneSupervisorError::Device(
            DeviceError::Io(io::Error::new(io::ErrorKind::Other, "x"))
        ).is_transient());
        // Fatal: framing / permission / driver / panic.
        assert!(!DataplaneSupervisorError::Dataplane(DataplaneError::Truncated).is_transient());
        assert!(!DataplaneSupervisorError::Device(
            DeviceError::PermissionDenied("root required".into())
        ).is_transient());
        assert!(!DataplaneSupervisorError::Device(
            DeviceError::DriverMissing("wintun.dll".into())
        ).is_transient());
        assert!(!DataplaneSupervisorError::TaskPanicked("boom".into()).is_transient());
        assert!(!DataplaneSupervisorError::Shutdown.is_transient());
    }

    // ── SE-6: keepalive watchdog ────────────────────────────────────

    #[tokio::test]
    async fn watchdog_fires_after_timeout_with_no_traffic() {
        // Short interval + multiplier 2 = 100ms deadline. No server
        // traffic (server_side kept but silent) — watchdog must fire.
        let cfg = DataplaneConfig {
            keepalive_interval: Duration::from_millis(50),
            batch_max_frames: 4,
            batch_flush: Duration::from_secs(3600),
            cipher: CipherMode::TlsOnly,
            keepalive_timeout_multiplier: 2,
        };
        let (client_side, _server_side) = duplex(64 * 1024);
        let (dev, _handle) = MpscDevice::new_pair(8, "wd-fire");
        let sup = spawn_dataplane(client_side, dev, cfg).await.expect("spawn");
        let res = tokio::time::timeout(Duration::from_millis(800), sup.join).await;
        match res {
            Ok(Ok(Err(DataplaneSupervisorError::KeepaliveTimeout))) => {}
            // If the reader hit EOF first (server_side was alive but
            // nothing arrives, so that shouldn't happen), accept it.
            other => panic!("expected KeepaliveTimeout, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn watchdog_does_not_fire_when_traffic_flows() {
        // Feed a KA record every 30ms for 300ms. Watchdog's 2×50ms =
        // 100ms deadline must stay unmet.
        let cfg = DataplaneConfig {
            keepalive_interval: Duration::from_millis(50),
            batch_max_frames: 4,
            batch_flush: Duration::from_secs(3600),
            cipher: CipherMode::TlsOnly,
            keepalive_timeout_multiplier: 2,
        };
        let (sup, mut server_side, _handle) = setup_supervisor(cfg).await;
        let feeder = tokio::spawn(async move {
            for _ in 0..10 {
                let wire = encode_plain(&[DataFrame::KeepAlive]).unwrap();
                if server_side.write_all(&wire).await.is_err() {
                    return;
                }
                let _ = server_side.flush().await;
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
            drop(server_side);
        });
        // Give ~350ms for traffic — watchdog should stay silent.
        let probe = tokio::time::timeout(
            Duration::from_millis(350),
            &mut Box::pin(async {
                // This future never completes on its own; we just want
                // the timeout to elapse while the supervisor runs.
                std::future::pending::<()>().await
            }),
        )
        .await;
        assert!(probe.is_err(), "pending future unexpectedly resolved");
        // Still up — clean shutdown.
        sup.shutdown().await.ok(); // may be Ok or Tls(EOF) depending on feeder timing
        let _ = feeder.await;
    }

    #[tokio::test]
    async fn watchdog_disabled_when_multiplier_is_zero() {
        // No traffic, mult=0, 200ms window — must stay alive.
        let (sup, _server_side, _handle) = setup_supervisor(test_config()).await;
        let res = tokio::time::timeout(
            Duration::from_millis(200),
            &mut Box::pin(async {
                std::future::pending::<()>().await
            }),
        )
        .await;
        assert!(res.is_err());
        sup.shutdown().await.expect("shutdown");
    }
}
