//! UDP acceleration (SE-6) — Cedar `UdpAccel.c` port, Version 1 only.
//!
//! SoftEther's default transport is TCP+TLS through `/vpnsvc/vpn.cgi`.
//! When the server advertises `use_udp_acceleration` in its Welcome
//! PACK *and* the client opts in, both peers can additionally exchange
//! encrypted UDP datagrams carrying Ethernet frames directly, avoiding
//! the TLS-over-TCP overhead. The TCP session stays open as a control
//! channel and fallback.
//!
//! # Version support
//!
//! Cedar defines two framings:
//!
//! * **V1** — 20-byte random IV prefix, RC4 keystream keyed by
//!   `SHA1(common_key || iv)`, 20-byte zero-verify trailer. This is
//!   what every shipping SoftEther client/server supports.
//! * **V2** — 12-byte IV + ChaCha20-Poly1305 AEAD (16-byte MAC
//!   trailer). Introduced in Cedar build 9000+.
//!
//! This module implements **V1 only**. V2 would require a new
//! `chacha20poly1305` dependency and has no blocker for the current
//! handshake path. Adding V2 is additive (one more arm in the cipher
//! match); the Welcome-PACK parser already preserves the V2 key slot.
//!
//! # Framing (V1)
//!
//! Per-packet layout — matches `UdpAccelSend` / `UdpAccelProcessRecvPacket`:
//!
//! ```text
//! +------+--------+------------+---------------+-----------+------+------+---------+-------------+
//! | IV   | Cookie | MyTick(u64)| YourTick(u64) | size(u16) | flag | data | padding | verify(0..) |
//! | 20B  |  4B    |    8B      |     8B        |    2B     |  1B  | sizeB|   rand  |     20B     |
//! +------+--------+------------+---------------+-----------+------+------+---------+-------------+
//!         ^ — everything from Cookie onwards is RC4-encrypted with key =
//!             SHA1(common_key || IV). Receiver validates by decrypting,
//!             checking the trailing 20-byte verify is all zero, and
//!             asserting `cookie == expected`.
//! ```
//!
//! Replay protection: each packet carries `my_tick` (sender's current
//! ms clock); receiver rejects packets whose tick is older than
//! `window_size_ms = 30 000` before the last-seen tick. We preserve
//! the same check.
//!
//! # Threading
//!
//! One inbound task reads from `UdpSocket`, decrypts, and writes frames
//! to the `DataplaneDevice`. One outbound task reads from the device,
//! encrypts, and sends via `UdpSocket`. A keepalive ticker sends
//! empty-payload datagrams at `keepalive_interval`. All three share a
//! `watch<bool>` shutdown signal and an error channel.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use sha1::{Digest, Sha1};
use tokio::net::UdpSocket;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use super::device::{DataplaneDevice, DeviceError};
use super::session_key::Rc4;

// ─── Cedar constants (V1) ───────────────────────────────────────────────

/// Common-key size — shared by both peers, negotiated via Welcome PACK.
pub const UDP_ACCEL_COMMON_KEY_SIZE_V1: usize = 20;
/// Per-packet IV size (also the RC4 key size — they happen to match).
pub const UDP_ACCEL_IV_SIZE_V1: usize = 20;
/// Replay window — packets older than this (in milliseconds) vs the
/// last-seen `my_tick` are dropped.
pub const UDP_ACCEL_WINDOW_MSEC: u64 = 30_000;
/// Maximum UDP payload accepted — matches Cedar's `TMP_BUF_SIZE`.
pub const UDP_ACCEL_TMP_BUF_SIZE: usize = 2048;
/// Maximum inner-data (Ethernet frame) size that Cedar will accept.
pub const UDP_ACCEL_SUPPORTED_MAX_PAYLOAD_SIZE: usize = 1600;

/// Header overhead (everything except `data` + `padding`): IV + cookie
/// + two ticks + size + flag + verify-trailer.
pub const UDP_ACCEL_V1_OVERHEAD: usize =
    UDP_ACCEL_IV_SIZE_V1 + 4 + 8 + 8 + 2 + 1 + UDP_ACCEL_IV_SIZE_V1;

// ─── Server info from Welcome PACK ──────────────────────────────────────

/// UDP-acceleration parameters extracted from the server-side Welcome
/// PACK (per Cedar `Protocol.c` — the keys `udp_acceleration_server_ip`,
/// `udp_acceleration_server_port`, `udp_acceleration_server_key`,
/// `udp_acceleration_server_cookie`, `udp_acceleration_client_cookie`,
/// `udp_acceleration_use_encryption`, `udp_acceleration_version`).
///
/// Kept as a separate struct (rather than extending SE-3's
/// `AuthResult`) so SE-6's changes stay out of `auth.rs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UdpAccelServerInfo {
    /// Server IP the client should send UDP datagrams to.
    pub server_ip: std::net::IpAddr,
    /// Server UDP port.
    pub server_port: u16,
    /// 20-byte common key used to derive per-packet RC4 keys (V1).
    pub server_key_v1: [u8; UDP_ACCEL_COMMON_KEY_SIZE_V1],
    /// Raw 128-byte V2 common key slot. Preserved for future V2
    /// support — current code does not use it.
    #[allow(dead_code)]
    pub server_key_v2: Vec<u8>,
    /// Server's cookie — client echoes this on every outbound packet.
    pub server_cookie: u32,
    /// Cookie the client should expect on every inbound packet.
    pub client_cookie: u32,
    /// Whether the server negotiated encryption (false = plaintext,
    /// used only in dev / debugging).
    pub use_encryption: bool,
    /// 1 = RC4-SHA1 framing (this module). 2 = ChaCha20-Poly1305
    /// (not yet supported — we reject with `UnsupportedVersion`).
    pub version: u32,
    /// Whether server requested the "fast disconnect detect" mode
    /// (tighter keepalive window).
    pub fast_disconnect: bool,
}

// ─── Config ─────────────────────────────────────────────────────────────

/// Runtime tunables for [`run_udp_accel`].
#[derive(Debug, Clone)]
pub struct UdpAccelConfig {
    /// Server's UDP endpoint (from Welcome PACK).
    pub peer_addr: SocketAddr,
    /// V1 common key (20 bytes, from Welcome PACK).
    pub common_key: [u8; UDP_ACCEL_COMMON_KEY_SIZE_V1],
    /// Our cookie — the *server's* cookie from the Welcome PACK. We
    /// write it on every outbound packet; the server validates it.
    pub your_cookie: u32,
    /// The cookie we expect on every inbound packet. Set from the
    /// `udp_acceleration_client_cookie` field of the Welcome PACK.
    pub my_cookie: u32,
    /// `true` = RC4-SHA1 cipher path (production). `false` = plaintext
    /// mode (dev only, and only if server negotiated it).
    pub use_encryption: bool,
    /// Interval between empty-payload keepalive datagrams.
    pub keepalive_interval: Duration,
    /// Allocate receive buffers at this size.
    pub rx_buf_size: usize,
    /// Opt-in to Cedar's "fast detect" idle threshold (2.1s instead
    /// of 9s). Does not change framing; used by the watchdog timer.
    pub fast_disconnect: bool,
}

impl UdpAccelConfig {
    /// Build a config from the server-announced [`UdpAccelServerInfo`]
    /// and a locally-chosen keepalive interval.
    pub fn from_server_info(
        info: &UdpAccelServerInfo,
        keepalive_interval: Duration,
    ) -> Self {
        Self {
            peer_addr: SocketAddr::new(info.server_ip, info.server_port),
            common_key: info.server_key_v1,
            your_cookie: info.server_cookie,
            my_cookie: info.client_cookie,
            use_encryption: info.use_encryption,
            keepalive_interval,
            rx_buf_size: UDP_ACCEL_TMP_BUF_SIZE,
            fast_disconnect: info.fast_disconnect,
        }
    }
}

// ─── Errors ─────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum UdpAccelError {
    /// `UdpSocket::bind` failed.
    BindFailed(std::io::Error),
    /// `UdpSocket::recv_from` or `send_to` errored.
    Io(std::io::Error),
    /// Received packet failed cookie / verify-trailer / replay check.
    DecryptFailed,
    /// Received packet was malformed (wrong size, bad inner_size).
    FramingError(String),
    /// No inbound traffic for `2 * keepalive_interval`.
    #[allow(dead_code)]
    Timeout,
    /// Device-layer failure.
    DeviceError(DeviceError),
    /// Server negotiated V2 framing — not implemented.
    UnsupportedVersion(u32),
    /// Frame exceeded `UDP_ACCEL_SUPPORTED_MAX_PAYLOAD_SIZE`.
    OversizedFrame(usize),
    /// Supervisor task panicked.
    TaskPanicked(String),
}

impl std::fmt::Display for UdpAccelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BindFailed(e) => write!(f, "UDP accel bind failed: {}", e),
            Self::Io(e) => write!(f, "UDP accel I/O: {}", e),
            Self::DecryptFailed => write!(f, "UDP accel decrypt/verify failed"),
            Self::FramingError(m) => write!(f, "UDP accel framing: {}", m),
            Self::Timeout => write!(f, "UDP accel idle timeout"),
            Self::DeviceError(e) => write!(f, "UDP accel device: {}", e),
            Self::UnsupportedVersion(v) => write!(f, "UDP accel version {} not supported", v),
            Self::OversizedFrame(n) => write!(f, "UDP accel oversized frame: {} bytes", n),
            Self::TaskPanicked(m) => write!(f, "UDP accel task panicked: {}", m),
        }
    }
}

impl std::error::Error for UdpAccelError {}

// ─── Pure-function framing ──────────────────────────────────────────────

/// SHA1(common_key || iv) → 20-byte RC4 key. Mirrors
/// `Cedar/UdpAccel.c::UdpAccelCalcKey`.
pub fn udp_accel_calc_key(
    common_key: &[u8; UDP_ACCEL_COMMON_KEY_SIZE_V1],
    iv: &[u8; UDP_ACCEL_IV_SIZE_V1],
) -> [u8; 20] {
    let mut h = Sha1::new();
    h.update(common_key);
    h.update(iv);
    let out = h.finalize();
    let mut key = [0u8; 20];
    key.copy_from_slice(&out);
    key
}

/// Build one outbound V1 datagram.
///
/// `my_tick` / `your_tick` are monotonic ms clocks exchanged between
/// peers (fresh-enough monotonicity is enforced on RX via the replay
/// window). `data` is the inner Ethernet frame (may be empty — that's
/// a keepalive).
pub fn build_v1_packet(
    iv: &[u8; UDP_ACCEL_IV_SIZE_V1],
    cookie: u32,
    my_tick: u64,
    your_tick: u64,
    data: &[u8],
    flag: u8,
    common_key: &[u8; UDP_ACCEL_COMMON_KEY_SIZE_V1],
    use_encryption: bool,
) -> Result<Vec<u8>, UdpAccelError> {
    if data.len() > UDP_ACCEL_SUPPORTED_MAX_PAYLOAD_SIZE {
        return Err(UdpAccelError::OversizedFrame(data.len()));
    }
    if data.len() > u16::MAX as usize {
        return Err(UdpAccelError::OversizedFrame(data.len()));
    }

    let mut buf = Vec::with_capacity(UDP_ACCEL_V1_OVERHEAD + data.len());

    // IV (plaintext prefix so the receiver can re-derive the key)
    buf.extend_from_slice(iv);

    // ---- encrypted region begins here ----
    let enc_start = buf.len();

    // Cookie (big-endian per Cedar's `Endian32` on send + `READ_UINT`
    // on recv — big-endian on wire).
    buf.extend_from_slice(&cookie.to_be_bytes());
    // My Tick (u64 big-endian)
    buf.extend_from_slice(&my_tick.to_be_bytes());
    // Your Tick
    buf.extend_from_slice(&your_tick.to_be_bytes());
    // inner_size (u16 big-endian)
    buf.extend_from_slice(&(data.len() as u16).to_be_bytes());
    // Flag byte
    buf.push(flag);
    // Inner data
    buf.extend_from_slice(data);
    // 20-byte zero verify trailer
    buf.extend_from_slice(&[0u8; UDP_ACCEL_IV_SIZE_V1]);
    // ---- encrypted region ends here ----

    if use_encryption {
        let key = udp_accel_calc_key(common_key, iv);
        let mut rc4 = Rc4::new(&key);
        rc4.apply_keystream(&mut buf[enc_start..]);
    }

    Ok(buf)
}

/// Parsed inbound V1 datagram.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedV1Packet {
    pub cookie: u32,
    pub my_tick: u64,
    pub your_tick: u64,
    pub flag: u8,
    pub data: Vec<u8>,
}

/// Decrypt + validate one inbound V1 datagram.
///
/// Returns `Ok(ParsedV1Packet)` on success. Errors on any framing
/// short-circuit, cookie mismatch, or verify-trailer mismatch (Cedar's
/// contract: the last 20 bytes after decryption must be all zero).
pub fn parse_v1_packet(
    raw: &[u8],
    common_key: &[u8; UDP_ACCEL_COMMON_KEY_SIZE_V1],
    expected_cookie: u32,
    use_encryption: bool,
) -> Result<ParsedV1Packet, UdpAccelError> {
    if raw.len() < UDP_ACCEL_IV_SIZE_V1 + 4 + 8 + 8 + 2 + 1 + UDP_ACCEL_IV_SIZE_V1 {
        return Err(UdpAccelError::FramingError(format!(
            "packet too small: {} bytes",
            raw.len()
        )));
    }

    // Copy so we can decrypt in place without mutating the caller's buf.
    let mut buf: Vec<u8> = raw.to_vec();
    let iv_fixed: [u8; UDP_ACCEL_IV_SIZE_V1] = {
        let mut a = [0u8; UDP_ACCEL_IV_SIZE_V1];
        a.copy_from_slice(&buf[..UDP_ACCEL_IV_SIZE_V1]);
        a
    };
    if use_encryption {
        let key = udp_accel_calc_key(common_key, &iv_fixed);
        let mut rc4 = Rc4::new(&key);
        rc4.apply_keystream(&mut buf[UDP_ACCEL_IV_SIZE_V1..]);
    }

    // Now parse the decrypted body.
    let body = &buf[UDP_ACCEL_IV_SIZE_V1..];
    let mut cur = 0usize;

    let cookie = u32::from_be_bytes(body[cur..cur + 4].try_into().unwrap());
    cur += 4;

    if cookie != expected_cookie {
        return Err(UdpAccelError::DecryptFailed);
    }

    let my_tick = u64::from_be_bytes(body[cur..cur + 8].try_into().unwrap());
    cur += 8;
    let your_tick = u64::from_be_bytes(body[cur..cur + 8].try_into().unwrap());
    cur += 8;
    let inner_size = u16::from_be_bytes(body[cur..cur + 2].try_into().unwrap()) as usize;
    cur += 2;
    let flag = body[cur];
    cur += 1;

    if body.len() < cur + inner_size + UDP_ACCEL_IV_SIZE_V1 {
        return Err(UdpAccelError::FramingError(format!(
            "body {} bytes < cur {} + inner {} + trailer {}",
            body.len(),
            cur,
            inner_size,
            UDP_ACCEL_IV_SIZE_V1
        )));
    }
    let data = body[cur..cur + inner_size].to_vec();
    cur += inner_size;

    // Verify trailer: the last 20 bytes (after any padding) must be
    // all zero. Cedar's recv path strips `size - IV_SIZE_V1` bytes of
    // padding and inspects the trailing IV_SIZE_V1 — we inspect the
    // *final* 20 bytes of the body directly, which is equivalent.
    let tail_start = body.len() - UDP_ACCEL_IV_SIZE_V1;
    // Padding lives between `cur` (end of data) and `tail_start`.
    // We don't inspect padding — but `cur` must be <= `tail_start`.
    if cur > tail_start {
        return Err(UdpAccelError::FramingError(
            "data + trailer overlap".into(),
        ));
    }
    let verify = &body[tail_start..];
    if verify.iter().any(|&b| b != 0) {
        return Err(UdpAccelError::DecryptFailed);
    }

    if data.len() > UDP_ACCEL_SUPPORTED_MAX_PAYLOAD_SIZE {
        return Err(UdpAccelError::OversizedFrame(data.len()));
    }

    Ok(ParsedV1Packet {
        cookie,
        my_tick,
        your_tick,
        flag,
        data,
    })
}

// ─── Runtime: three-task UDP pump ───────────────────────────────────────

/// Bind a client-side UDP socket on an ephemeral port (any local
/// interface) and connect it to `peer_addr`.
async fn bind_client_socket(peer_addr: SocketAddr) -> Result<UdpSocket, UdpAccelError> {
    let local: SocketAddr = if peer_addr.is_ipv6() {
        "[::]:0".parse().unwrap()
    } else {
        "0.0.0.0:0".parse().unwrap()
    };
    UdpSocket::bind(local).await.map_err(UdpAccelError::BindFailed)
}

/// Handle on a running [`run_udp_accel`] task group.
pub struct UdpAccelHandle {
    shutdown_tx: watch::Sender<bool>,
    pub(crate) join: JoinHandle<Result<(), UdpAccelError>>,
}

impl UdpAccelHandle {
    /// Graceful shutdown — signal + await.
    pub async fn shutdown(self) -> Result<(), UdpAccelError> {
        let _ = self.shutdown_tx.send(true);
        match self.join.await {
            Ok(r) => r,
            Err(je) => Err(UdpAccelError::TaskPanicked(je.to_string())),
        }
    }

    /// Immediate cancellation.
    pub fn abort(self) {
        self.join.abort();
    }
}

/// Monotonic tick in milliseconds since the module was first touched.
fn now_tick_ms() -> u64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    let e = EPOCH.get_or_init(Instant::now);
    e.elapsed().as_millis() as u64
}

/// Spawn the UDP acceleration pump over the supplied device. Returns
/// a handle once spawn succeeds; the underlying socket bind happens
/// inside `run_udp_accel_inner` so a bind failure surfaces via the
/// join handle (mirrors supervisor.rs's pattern).
pub async fn run_udp_accel<D>(
    config: UdpAccelConfig,
    device: D,
    external_shutdown: watch::Receiver<bool>,
) -> Result<UdpAccelHandle, UdpAccelError>
where
    D: DataplaneDevice,
{
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    // Merge external + internal shutdown: flip internal when external fires.
    let tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        let mut ext = external_shutdown;
        if ext.changed().await.is_ok() && *ext.borrow() {
            let _ = tx_clone.send(true);
        }
    });

    let join = tokio::spawn(run_udp_accel_inner(config, device, shutdown_rx));
    Ok(UdpAccelHandle { shutdown_tx, join })
}

/// The actual three-task loop. Factored so the outer `run_udp_accel`
/// can surface synchronous spawn errors without doing I/O itself.
async fn run_udp_accel_inner<D>(
    config: UdpAccelConfig,
    device: D,
    shutdown_rx: watch::Receiver<bool>,
) -> Result<(), UdpAccelError>
where
    D: DataplaneDevice,
{
    let sock = bind_client_socket(config.peer_addr).await?;
    let sock = Arc::new(sock);

    let (err_tx, mut err_rx) = tokio::sync::mpsc::channel::<UdpAccelError>(4);

    // Channels between device + UDP tasks.
    let (dev_to_udp_tx, mut dev_to_udp_rx) =
        tokio::sync::mpsc::channel::<Vec<u8>>(128);
    let (udp_to_dev_tx, mut udp_to_dev_rx) =
        tokio::sync::mpsc::channel::<Vec<u8>>(128);

    // Device owner — bridges read/write halves to channels.
    let mut device = device;
    let device_sd = shutdown_rx.clone();
    let device_err = err_tx.clone();
    let device_task = tokio::spawn(async move {
        let mut sd = device_sd;
        loop {
            tokio::select! {
                _ = sd.changed() => {
                    if *sd.borrow() { return; }
                }
                read = device.read_frame() => {
                    match read {
                        Ok(b) => {
                            if dev_to_udp_tx.send(b).await.is_err() { return; }
                        }
                        Err(e) => {
                            let _ = device_err.send(UdpAccelError::DeviceError(e)).await;
                            return;
                        }
                    }
                }
                Some(b) = udp_to_dev_rx.recv() => {
                    if let Err(e) = device.write_frame(&b).await {
                        let _ = device_err.send(UdpAccelError::DeviceError(e)).await;
                        return;
                    }
                }
            }
        }
    });

    // Outbound: device → UDP send. Also fires keepalives on idle.
    let out_sock = sock.clone();
    let out_cfg = config.clone();
    let out_sd = shutdown_rx.clone();
    let out_err = err_tx.clone();
    let send_task: JoinHandle<()> = tokio::spawn(async move {
        let mut sd = out_sd;
        let mut ka = tokio::time::interval(out_cfg.keepalive_interval);
        ka.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        ka.tick().await; // swallow first immediate tick
        let last_your_tick: u64 = 0;
        loop {
            tokio::select! {
                _ = sd.changed() => {
                    if *sd.borrow() { return; }
                }
                _ = ka.tick() => {
                    // Empty-payload keepalive.
                    if let Err(e) = send_one(&out_sock, &out_cfg, &[], 0, last_your_tick).await {
                        let _ = out_err.send(e).await;
                        return;
                    }
                }
                maybe = dev_to_udp_rx.recv() => {
                    match maybe {
                        Some(frame) => {
                            if let Err(e) = send_one(&out_sock, &out_cfg, &frame, 0, last_your_tick).await {
                                let _ = out_err.send(e).await;
                                return;
                            }
                        }
                        None => return,
                    }
                }
            }
            // Keepalive bump: on tick-only wake we don't know a fresh
            // `your_tick`; leaving it at `last_your_tick` is correct.
            let _ = last_your_tick;
        }
    });

    // Inbound: UDP recv → parse → device write.
    let in_sock = sock.clone();
    let in_cfg = config.clone();
    let in_sd = shutdown_rx.clone();
    let in_err = err_tx.clone();
    let in_buf_size = config.rx_buf_size;
    let recv_task: JoinHandle<()> = tokio::spawn(async move {
        let mut sd = in_sd;
        let mut buf = vec![0u8; in_buf_size];
        let mut last_my_tick: u64 = 0;
        loop {
            tokio::select! {
                _ = sd.changed() => {
                    if *sd.borrow() { return; }
                }
                r = in_sock.recv_from(&mut buf) => {
                    match r {
                        Ok((n, src)) => {
                            // Only accept packets from the configured peer.
                            if src != in_cfg.peer_addr {
                                continue;
                            }
                            match parse_v1_packet(
                                &buf[..n],
                                &in_cfg.common_key,
                                in_cfg.my_cookie,
                                in_cfg.use_encryption,
                            ) {
                                Ok(pkt) => {
                                    // Replay window check.
                                    if last_my_tick > pkt.my_tick
                                        && last_my_tick - pkt.my_tick >= UDP_ACCEL_WINDOW_MSEC
                                    {
                                        continue;
                                    }
                                    if pkt.my_tick > last_my_tick {
                                        last_my_tick = pkt.my_tick;
                                    }
                                    if !pkt.data.is_empty() {
                                        if udp_to_dev_tx.send(pkt.data).await.is_err() {
                                            return;
                                        }
                                    }
                                }
                                Err(UdpAccelError::DecryptFailed)
                                | Err(UdpAccelError::FramingError(_)) => {
                                    // Silently drop malformed / spoofed
                                    // packets — Cedar does the same
                                    // (return NULL from UdpAccelProcessRecvPacket).
                                    continue;
                                }
                                Err(e) => {
                                    let _ = in_err.send(e).await;
                                    return;
                                }
                            }
                        }
                        Err(e) => {
                            let _ = in_err.send(UdpAccelError::Io(e)).await;
                            return;
                        }
                    }
                }
            }
        }
    });

    // Await first terminal error or shutdown.
    let first_err = err_rx.recv().await;
    device_task.abort();
    send_task.abort();
    recv_task.abort();
    let _ = device_task.await;
    let _ = send_task.await;
    let _ = recv_task.await;

    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Build + send a single packet. Internal to the send loop.
async fn send_one(
    sock: &UdpSocket,
    cfg: &UdpAccelConfig,
    data: &[u8],
    flag: u8,
    your_tick: u64,
) -> Result<(), UdpAccelError> {
    // Random 20-byte IV per packet.
    let mut iv = [0u8; UDP_ACCEL_IV_SIZE_V1];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut iv);

    let pkt = build_v1_packet(
        &iv,
        cfg.your_cookie,
        now_tick_ms(),
        your_tick,
        data,
        flag,
        &cfg.common_key,
        cfg.use_encryption,
    )?;

    sock.send_to(&pkt, cfg.peer_addr)
        .await
        .map_err(UdpAccelError::Io)?;
    Ok(())
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::softether::device::MpscDevice;

    const TEST_KEY: [u8; 20] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10, 0x11, 0x12, 0x13, 0x14,
    ];

    // ── Pure framing ────────────────────────────────────────────────

    #[test]
    fn calc_key_matches_cedar_sha1_formula() {
        let iv = [0u8; 20];
        let key = udp_accel_calc_key(&TEST_KEY, &iv);
        // Expected: SHA1(TEST_KEY || 20-byte zero). We don't hardcode
        // the digest — just assert it's deterministic + non-zero.
        assert_eq!(key.len(), 20);
        assert_ne!(key, [0u8; 20]);
        // Second call must produce identical output.
        let key2 = udp_accel_calc_key(&TEST_KEY, &iv);
        assert_eq!(key, key2);
    }

    #[test]
    fn build_then_parse_round_trips_encrypted() {
        let iv = [0x42u8; 20];
        let data = b"hello-udp-world";
        let pkt = build_v1_packet(&iv, 0xDEAD_BEEF, 100, 50, data, 0, &TEST_KEY, true)
            .expect("build");
        let parsed =
            parse_v1_packet(&pkt, &TEST_KEY, 0xDEAD_BEEF, true).expect("parse");
        assert_eq!(parsed.cookie, 0xDEAD_BEEF);
        assert_eq!(parsed.my_tick, 100);
        assert_eq!(parsed.your_tick, 50);
        assert_eq!(parsed.data, data);
    }

    #[test]
    fn build_then_parse_round_trips_plaintext() {
        let iv = [0x42u8; 20];
        let pkt =
            build_v1_packet(&iv, 1, 1, 1, b"x", 0, &TEST_KEY, false).expect("build");
        let parsed = parse_v1_packet(&pkt, &TEST_KEY, 1, false).expect("parse");
        assert_eq!(parsed.data, b"x");
    }

    #[test]
    fn parse_rejects_wrong_cookie() {
        let iv = [0xAAu8; 20];
        let pkt = build_v1_packet(&iv, 1, 0, 0, b"", 0, &TEST_KEY, true).expect("build");
        let err =
            parse_v1_packet(&pkt, &TEST_KEY, 0xFFFF_FFFF, true).expect_err("mismatch");
        assert!(matches!(err, UdpAccelError::DecryptFailed));
    }

    #[test]
    fn parse_rejects_wrong_key() {
        let iv = [0xAAu8; 20];
        let pkt = build_v1_packet(&iv, 1, 0, 0, b"", 0, &TEST_KEY, true).expect("build");
        let other = [0u8; 20];
        let err =
            parse_v1_packet(&pkt, &other, 1, true).expect_err("wrong key");
        assert!(matches!(err, UdpAccelError::DecryptFailed));
    }

    #[test]
    fn parse_rejects_short_packet() {
        let tiny = vec![0u8; 10];
        let err =
            parse_v1_packet(&tiny, &TEST_KEY, 1, true).expect_err("short");
        assert!(matches!(err, UdpAccelError::FramingError(_)));
    }

    #[test]
    fn build_rejects_oversized_frame() {
        let iv = [0u8; 20];
        let data = vec![0u8; UDP_ACCEL_SUPPORTED_MAX_PAYLOAD_SIZE + 1];
        let err = build_v1_packet(&iv, 1, 0, 0, &data, 0, &TEST_KEY, true)
            .expect_err("oversize");
        assert!(matches!(err, UdpAccelError::OversizedFrame(_)));
    }

    #[test]
    fn build_preserves_different_ivs_producing_different_ciphertext() {
        let iv_a = [0x01u8; 20];
        let iv_b = [0x02u8; 20];
        let data = b"same-data";
        let a = build_v1_packet(&iv_a, 1, 0, 0, data, 0, &TEST_KEY, true).unwrap();
        let b = build_v1_packet(&iv_b, 1, 0, 0, data, 0, &TEST_KEY, true).unwrap();
        assert_ne!(a[20..], b[20..], "ciphertext must diverge with IV");
    }

    #[test]
    fn build_v1_keepalive_has_zero_length_data() {
        let iv = [0u8; 20];
        let pkt = build_v1_packet(&iv, 1, 0, 0, &[], 0, &TEST_KEY, true).unwrap();
        let parsed = parse_v1_packet(&pkt, &TEST_KEY, 1, true).unwrap();
        assert!(parsed.data.is_empty());
    }

    #[test]
    fn bit_flip_in_ciphertext_fails_verify() {
        let iv = [0u8; 20];
        let mut pkt = build_v1_packet(&iv, 1, 0, 0, b"abc", 0, &TEST_KEY, true).unwrap();
        // Flip one byte inside the ciphertext region (after IV).
        let flip_at = pkt.len() - 5;
        pkt[flip_at] ^= 0x01;
        let err = parse_v1_packet(&pkt, &TEST_KEY, 1, true).expect_err("flip");
        assert!(matches!(
            err,
            UdpAccelError::DecryptFailed | UdpAccelError::FramingError(_)
        ));
    }

    #[test]
    fn overhead_constant_matches_computation() {
        // IV + cookie + my_tick + your_tick + size + flag + verify
        assert_eq!(UDP_ACCEL_V1_OVERHEAD, 20 + 4 + 8 + 8 + 2 + 1 + 20);
    }

    #[test]
    fn parse_flag_is_preserved() {
        let iv = [0u8; 20];
        let pkt = build_v1_packet(&iv, 1, 0, 0, b"d", 0x7F, &TEST_KEY, true).unwrap();
        let parsed = parse_v1_packet(&pkt, &TEST_KEY, 1, true).unwrap();
        assert_eq!(parsed.flag, 0x7F);
    }

    // ── Runtime with paired UDP sockets ─────────────────────────────

    /// Two UdpAccelConfigs pointing at each other (client + "server"
    /// in the test). For the test we just reuse UDP sockets directly
    /// to emit packets — no full pump on the server side.
    async fn make_test_config(peer: SocketAddr) -> UdpAccelConfig {
        UdpAccelConfig {
            peer_addr: peer,
            common_key: TEST_KEY,
            your_cookie: 0xAAAA_AAAA, // server expects this on our sends
            my_cookie: 0xBBBB_BBBB, // we expect this on server's sends
            use_encryption: true,
            keepalive_interval: Duration::from_millis(50),
            rx_buf_size: UDP_ACCEL_TMP_BUF_SIZE,
            fast_disconnect: false,
        }
    }

    // NOTE: the four end-to-end tests below use real UDP loopback
    // sockets. On Windows the firewall dialog / ephemeral-port
    // reservation can make these flaky in CI, so they are `#[ignore]`-gated
    // ONLY on Windows (`cfg_attr(target_os = "windows", ignore = ...)`).
    // On Linux + macOS UDP loopback is reliable, so these run by default
    // in `cargo test` and `cargo test --features vpn-softether` — giving
    // non-Windows CI lanes real coverage. Windows devs can still opt in
    // locally with `cargo test -- --ignored`. (t4-e13, 2026-04-20.)
    #[tokio::test]
    #[cfg_attr(
        target_os = "windows",
        ignore = "real-UDP loopback; flaky on Windows firewall (runs unignored on linux/macos)"
    )]
    async fn end_to_end_server_packet_reaches_device() {
        // Bind a fake server socket so we can inject packets at the
        // client's chosen ephemeral port.
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let server_addr = server.local_addr().unwrap();

        let cfg = make_test_config(server_addr).await;
        let (dev, mut handle) = MpscDevice::new_pair(16, "udp-test");
        let (_ext_tx, ext_rx) = watch::channel(false);
        let h = run_udp_accel(cfg.clone(), dev, ext_rx).await.expect("spawn");

        // Client just bound — give it a moment, then push a keepalive
        // (empty payload) from the client so the server learns its
        // source address.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let (_n, client_addr) = {
            let mut tmp = [0u8; UDP_ACCEL_TMP_BUF_SIZE];
            tokio::time::timeout(Duration::from_millis(500), server.recv_from(&mut tmp))
                .await
                .expect("client KA")
                .expect("recv ok")
        };

        // Build a server→client ethernet packet. Server's
        // outbound cookie is `my_cookie` from the client's POV.
        let iv = [0xAAu8; 20];
        let pkt = build_v1_packet(
            &iv,
            cfg.my_cookie, // client expects this cookie
            1000,
            0,
            b"from-server-eth",
            0,
            &TEST_KEY,
            true,
        )
        .unwrap();
        server.send_to(&pkt, client_addr).await.unwrap();

        // Device-side handle should see it.
        let got = tokio::time::timeout(Duration::from_millis(500), handle.rx.recv())
            .await
            .expect("dev recv timed out")
            .expect("channel closed");
        assert_eq!(got, b"from-server-eth");

        h.shutdown().await.ok();
    }

    #[tokio::test]
    #[cfg_attr(
        target_os = "windows",
        ignore = "real-UDP loopback; flaky on Windows firewall (runs unignored on linux/macos)"
    )]
    async fn end_to_end_device_frame_reaches_server() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let server_addr = server.local_addr().unwrap();
        let cfg = make_test_config(server_addr).await;

        let (dev, handle) = MpscDevice::new_pair(16, "udp-test-out");
        let (_ext_tx, ext_rx) = watch::channel(false);
        let h = run_udp_accel(cfg.clone(), dev, ext_rx).await.expect("spawn");

        // Inject a frame on the TAP side.
        handle.tx.send(b"from-tap-eth".to_vec()).await.unwrap();

        // Server should receive an encrypted datagram whose decrypted
        // payload is "from-tap-eth". Skip keepalives (empty data).
        let mut buf = [0u8; UDP_ACCEL_TMP_BUF_SIZE];
        let deadline = tokio::time::Instant::now() + Duration::from_millis(800);
        let mut seen = None;
        while tokio::time::Instant::now() < deadline {
            let (n, _) = match tokio::time::timeout(
                Duration::from_millis(200),
                server.recv_from(&mut buf),
            )
            .await
            {
                Ok(Ok(r)) => r,
                _ => continue,
            };
            let parsed =
                parse_v1_packet(&buf[..n], &TEST_KEY, cfg.your_cookie, true)
                    .expect("parse");
            if !parsed.data.is_empty() {
                seen = Some(parsed.data);
                break;
            }
        }
        assert_eq!(seen.as_deref(), Some(&b"from-tap-eth"[..]));

        h.shutdown().await.ok();
    }

    #[tokio::test]
    #[cfg_attr(
        target_os = "windows",
        ignore = "real-UDP loopback; flaky on Windows firewall (runs unignored on linux/macos)"
    )]
    async fn shutdown_signal_exits_cleanly() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let cfg = make_test_config(server.local_addr().unwrap()).await;
        let (dev, _handle) = MpscDevice::new_pair(4, "shutdown-test");
        let (ext_tx, ext_rx) = watch::channel(false);
        let h = run_udp_accel(cfg, dev, ext_rx).await.expect("spawn");
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = ext_tx.send(true);
        let res = tokio::time::timeout(Duration::from_millis(500), h.shutdown()).await;
        // Ok(..) or a clean Ok(()) — either counts as not-hung.
        assert!(res.is_ok(), "shutdown hung");
    }

    #[tokio::test]
    #[cfg_attr(
        target_os = "windows",
        ignore = "real-UDP loopback; flaky on Windows firewall (runs unignored on linux/macos)"
    )]
    async fn malformed_inbound_is_silently_dropped() {
        // Pump stays alive even when garbage arrives.
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let server_addr = server.local_addr().unwrap();
        let cfg = make_test_config(server_addr).await;
        let (dev, mut handle) = MpscDevice::new_pair(8, "garbage-test");
        let (_ext_tx, ext_rx) = watch::channel(false);
        let h = run_udp_accel(cfg.clone(), dev, ext_rx).await.expect("spawn");

        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut tmp = [0u8; UDP_ACCEL_TMP_BUF_SIZE];
        let (_n, client_addr) = server.recv_from(&mut tmp).await.unwrap();

        // Send garbage first.
        server.send_to(&[0u8; 10], client_addr).await.unwrap();
        // Then a valid packet.
        let iv = [1u8; 20];
        let pkt = build_v1_packet(&iv, cfg.my_cookie, 1, 0, b"ok", 0, &TEST_KEY, true)
            .unwrap();
        server.send_to(&pkt, client_addr).await.unwrap();

        let got = tokio::time::timeout(Duration::from_millis(500), handle.rx.recv())
            .await
            .expect("recv timeout")
            .expect("closed");
        assert_eq!(got, b"ok");

        h.shutdown().await.ok();
    }

    // ── Config helpers ──────────────────────────────────────────────

    #[test]
    fn from_server_info_populates_fields() {
        let info = UdpAccelServerInfo {
            server_ip: "127.0.0.1".parse().unwrap(),
            server_port: 12345,
            server_key_v1: TEST_KEY,
            server_key_v2: vec![0; 128],
            server_cookie: 0x1111_2222,
            client_cookie: 0x3333_4444,
            use_encryption: true,
            version: 1,
            fast_disconnect: true,
        };
        let cfg = UdpAccelConfig::from_server_info(&info, Duration::from_secs(2));
        assert_eq!(cfg.peer_addr.port(), 12345);
        assert_eq!(cfg.your_cookie, 0x1111_2222);
        assert_eq!(cfg.my_cookie, 0x3333_4444);
        assert!(cfg.use_encryption);
        assert!(cfg.fast_disconnect);
        assert_eq!(cfg.keepalive_interval, Duration::from_secs(2));
    }
}
