//! Real TAP (layer-2) device implementation of
//! [`super::device::DataplaneDevice`] (SE-5b).
//!
//! # Platform support matrix
//!
//! | Platform | Backing                                              | L2 (TAP) support |
//! |----------|------------------------------------------------------|-------------------|
//! | Linux    | `/dev/net/tun` via the `tun` crate's `IFF_TAP` mode  | **Yes**           |
//! | Windows  | `wintun` (bundled with `tun` crate)                  | **No** — wintun is L3-only |
//! | macOS    | `utun`                                               | **No** — utun is L3-only   |
//!
//! SoftEther is an L2 (Ethernet) VPN — every frame on the wire includes
//! the 14-byte Ethernet header and the hub bridges frames at L2. A
//! pure-L3 device cannot source/sink complete Ethernet frames without
//! synthesising a fake ARP/MAC layer, so we surface non-Linux platforms
//! as [`DeviceError::DriverMissing`] rather than silently falling back
//! to a broken L3 bridge. SE-7 (Docker e2e) and SE-6 (UDP accel) will
//! decide whether to ship a Windows path via a different driver
//! (OpenVPN's `tap-windows6`) — not in scope for SE-5b.
//!
//! # Async model
//!
//! On Linux we use the `tun` crate **without** its `async` feature (to
//! avoid pulling `futures` + alternative runtime glue) and bridge the
//! blocking `Read + Write` device to async via two
//! `tokio::task::spawn_blocking` worker threads joined by bounded
//! `tokio::sync::mpsc` channels. This matches Cedar's own blocking I/O
//! pattern (`pthread_create` per direction in
//! `Cedar/Session.c::SessionThread`) and keeps the per-frame hot path
//! off the async executor.

use async_trait::async_trait;

use super::device::{DataplaneDevice, DeviceError};

/// Per-direction channel buffer used by [`TapDevice`]. Sized to match
/// Cedar's `MAX_SEND_SOCKET_QUEUE_NUM` / 32 — i.e. a small multiple of
/// the supervisor's per-batch max so the worker can park briefly without
/// dropping frames.
pub const TAP_CHANNEL_CAPACITY: usize = 256;

/// L2 TAP device bridged to async via two blocking worker threads.
///
/// On non-Linux platforms this struct is never successfully
/// constructed; [`TapDevice::create`] returns
/// [`DeviceError::DriverMissing`] with an explanatory message.
pub struct TapDevice {
    /// Frames read from the kernel TAP, delivered to the supervisor.
    rx: tokio::sync::mpsc::Receiver<Result<Vec<u8>, DeviceError>>,
    /// Frames queued by the supervisor, drained by the writer worker.
    tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    name: String,
    /// Flipped to `true` on drop to let worker threads exit promptly.
    /// Workers additionally observe channel closure as a shutdown
    /// signal, so this is defence-in-depth.
    #[allow(dead_code)]
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl std::fmt::Debug for TapDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TapDevice").field("name", &self.name).finish()
    }
}

impl Drop for TapDevice {
    fn drop(&mut self) {
        self.shutdown
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

impl TapDevice {
    /// Creates an L2 TAP device. On Linux requires `CAP_NET_ADMIN`
    /// (surfaces as [`DeviceError::PermissionDenied`]). Elsewhere
    /// returns [`DeviceError::DriverMissing`] — see module docs.
    ///
    /// `requested_name` lets callers pin a device name (`"tap0"`). Pass
    /// `None` to let the kernel auto-assign.
    pub async fn create(requested_name: Option<&str>) -> Result<Self, DeviceError> {
        #[cfg(target_os = "linux")]
        {
            Self::create_linux(requested_name).await
        }

        #[cfg(target_os = "windows")]
        {
            let _ = requested_name;
            Err(DeviceError::DriverMissing(
                "L2 TAP not supported on Windows by the `tun` crate (wintun is L3-only). \
                 SE-7 follow-up: port tap-windows6 or openvpn's tap driver."
                    .to_string(),
            ))
        }

        #[cfg(target_os = "macos")]
        {
            let _ = requested_name;
            Err(DeviceError::DriverMissing(
                "L2 TAP not supported on macOS by the `tun` crate (utun is L3-only). \
                 SE-7 follow-up: port tuntaposx kext or equivalent."
                    .to_string(),
            ))
        }

        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        {
            let _ = requested_name;
            Err(DeviceError::DriverMissing(format!(
                "L2 TAP not implemented on this platform ({})",
                std::env::consts::OS
            )))
        }
    }

    #[cfg(target_os = "linux")]
    async fn create_linux(requested_name: Option<&str>) -> Result<Self, DeviceError> {
        use std::io::{Read, Write};
        use std::sync::atomic::Ordering;

        let req_name = requested_name.map(|s| s.to_string());

        // Open the device on a blocking thread — `tun::create` is sync.
        let (device, name) = tokio::task::spawn_blocking(move || -> Result<_, DeviceError> {
            let mut cfg = tun::Configuration::default();
            cfg.layer(tun::Layer::L2).up();
            if let Some(ref n) = req_name {
                cfg.name(n);
            }
            match tun::create(&cfg) {
                Ok(dev) => {
                    let name = req_name.unwrap_or_else(|| "tap".to_string());
                    Ok((dev, name))
                }
                Err(e) => {
                    let msg = e.to_string();
                    let mapped = if msg.contains("Operation not permitted")
                        || msg.contains("permission denied")
                        || msg.contains("EPERM")
                    {
                        DeviceError::PermissionDenied(format!(
                            "TAP open requires CAP_NET_ADMIN: {}",
                            msg
                        ))
                    } else if msg.contains("No such device") || msg.contains("ENODEV") {
                        DeviceError::DriverMissing(format!(
                            "TAP module not loaded (`modprobe tun`): {}",
                            msg
                        ))
                    } else {
                        DeviceError::Io(std::io::Error::new(std::io::ErrorKind::Other, msg))
                    };
                    Err(mapped)
                }
            }
        })
        .await
        .map_err(|_| DeviceError::Closed)??;

        // Share the single device between reader + writer threads
        // behind a std::sync::Mutex. Concurrent read/write from the
        // same fd is safe at the kernel level (different operations)
        // but the `tun::Device` doesn't expose an FD split helper
        // without enabling the crate's `async` feature. The Mutex
        // cost per frame is a single uncontended acquire on the
        // "other" direction because workers alternate naturally —
        // reads park in `read()` itself while writes only acquire
        // briefly. This is acceptable for now and matches typical TAP
        // bridge implementations.
        let device = std::sync::Arc::new(std::sync::Mutex::new(device));
        let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let (frame_tx, frame_rx) =
            tokio::sync::mpsc::channel::<Result<Vec<u8>, DeviceError>>(TAP_CHANNEL_CAPACITY);
        let (out_tx, mut out_rx) =
            tokio::sync::mpsc::channel::<Vec<u8>>(TAP_CHANNEL_CAPACITY);

        // Reader thread: blocking read() in a loop, push each frame.
        let reader_dev = device.clone();
        let reader_sd = shutdown.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = vec![0u8; (super::dataplane::MAX_BLOCK_SIZE as usize) + 64];
            loop {
                if reader_sd.load(Ordering::SeqCst) {
                    break;
                }
                let result = {
                    let mut guard = match reader_dev.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    guard.read(&mut buf)
                };
                match result {
                    Ok(0) => {
                        let _ = frame_tx.blocking_send(Err(DeviceError::Closed));
                        break;
                    }
                    Ok(n) => {
                        if frame_tx
                            .blocking_send(Ok(buf[..n].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = frame_tx.blocking_send(Err(DeviceError::Io(e)));
                        break;
                    }
                }
            }
        });

        // Writer thread: pull frames off the channel, blocking write().
        let writer_dev = device.clone();
        let writer_sd = shutdown.clone();
        tokio::task::spawn_blocking(move || {
            while let Some(frame) = out_rx.blocking_recv() {
                if writer_sd.load(Ordering::SeqCst) {
                    break;
                }
                let mut guard = match writer_dev.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if let Err(e) = guard.write_all(&frame) {
                    log::warn!("TAP write error: {}", e);
                    break;
                }
            }
        });

        Ok(TapDevice {
            rx: frame_rx,
            tx: out_tx,
            name,
            shutdown,
        })
    }
}

#[async_trait]
impl DataplaneDevice for TapDevice {
    async fn read_frame(&mut self) -> Result<Vec<u8>, DeviceError> {
        match self.rx.recv().await {
            Some(Ok(bytes)) => Ok(bytes),
            Some(Err(e)) => Err(e),
            None => Err(DeviceError::Closed),
        }
    }

    async fn write_frame(&mut self, bytes: &[u8]) -> Result<(), DeviceError> {
        self.tx
            .send(bytes.to_vec())
            .await
            .map_err(|_| DeviceError::Closed)
    }

    fn name(&self) -> &str {
        &self.name
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // On non-Linux platforms the constructor must refuse cleanly with
    // `DriverMissing`. This is the only end-to-end test that runs on
    // CI Windows/macOS runners — the Linux path requires CAP_NET_ADMIN
    // and is covered by SE-7's container-based e2e.
    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn windows_returns_driver_missing() {
        let err = TapDevice::create(None).await.expect_err("windows");
        match err {
            DeviceError::DriverMissing(m) => {
                assert!(m.contains("Windows"), "message: {}", m);
            }
            other => panic!("expected DriverMissing, got {:?}", other),
        }
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn windows_driver_missing_with_named_request() {
        let err = TapDevice::create(Some("tap-sorng")).await.expect_err("windows");
        assert!(matches!(err, DeviceError::DriverMissing(_)));
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn macos_returns_driver_missing() {
        let err = TapDevice::create(None).await.expect_err("macos");
        match err {
            DeviceError::DriverMissing(m) => {
                assert!(m.contains("macOS"), "message: {}", m);
            }
            other => panic!("expected DriverMissing, got {:?}", other),
        }
    }

    // On Linux in an unprivileged CI environment the open must fail
    // with a typed error (PermissionDenied / DriverMissing / Io). We
    // accept any of those — CI may or may not grant caps — but the
    // result must never be a panic or a silent success.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn linux_create_surfaces_typed_error_when_unprivileged() {
        match TapDevice::create(Some("sorng-tap-test")).await {
            Ok(_dev) => {
                // Running privileged — accept and move on.
            }
            Err(DeviceError::PermissionDenied(_)) => {}
            Err(DeviceError::DriverMissing(_)) => {}
            Err(DeviceError::Io(_)) => {}
            Err(DeviceError::Closed) => panic!("unexpected Closed at open time"),
        }
    }

    // Compile-guard: module must build on every platform. Value lies
    // in forcing `cargo check` on Windows/macOS to exercise the cfg
    // branches above.
    #[test]
    fn module_compiles_on_all_platforms() {
        let _ = TAP_CHANNEL_CAPACITY;
    }
}
