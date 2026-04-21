//! Abstract data-plane device trait (SE-5a).
//!
//! A [`DataplaneDevice`] is the sink/source of raw layer-2 Ethernet
//! frames — the "TAP side" of a SoftEther session. SE-5a ships the trait
//! + an `MpscDevice` test mock; SE-5b wires a real `wintun`/`tun-tap`
//! implementation behind the same trait.
//!
//! # Contract
//!
//! * [`DataplaneDevice::read_frame`] returns one complete L2 frame per
//!   call. For real TAP drivers this typically corresponds to one
//!   `ReadPacket` / one `read(2)` (each syscall yields exactly one
//!   frame).
//! * [`DataplaneDevice::write_frame`] consumes one L2 frame. Partial
//!   writes are not exposed — the impl must loop internally.
//! * Both methods are `async` and may park the task. They MUST be
//!   cancellation-safe at the `.await` boundary (callers pump them
//!   from a `tokio::select!` or `JoinSet` supervisor in SE-5b).

use async_trait::async_trait;

/// Device-layer errors. Kept deliberately coarse; SE-5b may refine.
#[derive(Debug)]
pub enum DeviceError {
    /// Peer/driver closed the device cleanly.
    Closed,
    /// Raw `std::io::Error` from the underlying driver/syscall.
    Io(std::io::Error),
    /// Permission denied opening the TAP device (`CAP_NET_ADMIN` / admin
    /// on Windows / root on macOS).
    PermissionDenied(String),
    /// Driver not installed (e.g. `wintun.dll` missing on Windows).
    DriverMissing(String),
}

impl std::fmt::Display for DeviceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Closed => write!(f, "dataplane device closed"),
            Self::Io(e) => write!(f, "dataplane device io: {}", e),
            Self::PermissionDenied(m) => write!(f, "dataplane device permission denied: {}", m),
            Self::DriverMissing(m) => write!(f, "dataplane driver missing: {}", m),
        }
    }
}

impl std::error::Error for DeviceError {}

impl From<std::io::Error> for DeviceError {
    fn from(e: std::io::Error) -> Self {
        DeviceError::Io(e)
    }
}

/// An async source/sink of raw layer-2 Ethernet frames.
///
/// Implementations include:
/// * [`MpscDevice`] — in-memory mock for tests (SE-5a).
/// * `WintunDevice` — production Windows TAP (SE-5b).
/// * `TunTapDevice` — production Linux/macOS TAP (SE-5b).
#[async_trait]
pub trait DataplaneDevice: Send + 'static {
    /// Read one complete L2 frame from the device.
    async fn read_frame(&mut self) -> Result<Vec<u8>, DeviceError>;
    /// Write one complete L2 frame to the device.
    async fn write_frame(&mut self, bytes: &[u8]) -> Result<(), DeviceError>;
    /// Human-readable name for diagnostics.
    fn name(&self) -> &str;
}

// ─── MpscDevice — in-memory test mock ───────────────────────────────────

/// In-memory fake TAP built on two [`tokio::sync::mpsc`] channels.
/// The device `read_frame`s from its `rx` and `write_frame`s to its `tx`.
/// Tests drive traffic in the opposite direction via [`MpscDeviceHandle`].
pub struct MpscDevice {
    rx: tokio::sync::mpsc::Receiver<Vec<u8>>,
    tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    name: String,
}

/// Test-side handle paired with an [`MpscDevice`].
///
/// * `tx` pushes frames INTO the device — the device yields them from
///   [`DataplaneDevice::read_frame`].
/// * `rx` pulls frames OUT of the device — whatever the device wrote
///   via [`DataplaneDevice::write_frame`].
pub struct MpscDeviceHandle {
    pub tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    pub rx: tokio::sync::mpsc::Receiver<Vec<u8>>,
}

impl MpscDevice {
    /// Create a paired device + handle with the given buffer capacity
    /// on each channel.
    pub fn new_pair(buffer: usize, name: &str) -> (Self, MpscDeviceHandle) {
        let (dev_tx, handle_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(buffer);
        let (handle_tx, dev_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(buffer);
        let dev = MpscDevice {
            rx: dev_rx,
            tx: dev_tx,
            name: name.to_string(),
        };
        let h = MpscDeviceHandle {
            tx: handle_tx,
            rx: handle_rx,
        };
        (dev, h)
    }
}

#[async_trait]
impl DataplaneDevice for MpscDevice {
    async fn read_frame(&mut self) -> Result<Vec<u8>, DeviceError> {
        match self.rx.recv().await {
            Some(bytes) => Ok(bytes),
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

    #[tokio::test]
    async fn mpsc_device_read_yields_handle_tx() {
        let (mut dev, handle) = MpscDevice::new_pair(4, "test0");
        handle.tx.send(b"hello".to_vec()).await.unwrap();
        let got = dev.read_frame().await.expect("read");
        assert_eq!(got, b"hello");
        assert_eq!(dev.name(), "test0");
    }

    #[tokio::test]
    async fn mpsc_device_write_reaches_handle_rx() {
        let (mut dev, mut handle) = MpscDevice::new_pair(4, "test1");
        dev.write_frame(b"world").await.expect("write");
        let got = handle.rx.recv().await.expect("recv");
        assert_eq!(got, b"world");
    }

    #[tokio::test]
    async fn mpsc_device_read_closed_when_handle_tx_dropped() {
        let (mut dev, handle) = MpscDevice::new_pair(4, "test2");
        drop(handle.tx);
        // handle.rx still lives — only the tx side (which feeds the
        // device's read path) is closed.
        let err = dev.read_frame().await.expect_err("closed");
        assert!(matches!(err, DeviceError::Closed));
    }

    #[tokio::test]
    async fn mpsc_device_write_closed_when_handle_rx_dropped() {
        let (mut dev, handle) = MpscDevice::new_pair(4, "test3");
        drop(handle.rx);
        let err = dev.write_frame(b"x").await.expect_err("closed");
        assert!(matches!(err, DeviceError::Closed));
    }

    #[tokio::test]
    async fn mpsc_device_round_trip_multiple_frames() {
        let (mut dev, mut handle) = MpscDevice::new_pair(8, "rt");
        // push 3 frames in from the handle side.
        for i in 0..3u8 {
            handle.tx.send(vec![i, i, i]).await.unwrap();
        }
        // device reads them back out in order.
        for i in 0..3u8 {
            let f = dev.read_frame().await.unwrap();
            assert_eq!(f, vec![i, i, i]);
        }
        // and the device writes flow to the handle.
        dev.write_frame(b"dev-out").await.unwrap();
        assert_eq!(handle.rx.recv().await.unwrap(), b"dev-out");
    }
}
