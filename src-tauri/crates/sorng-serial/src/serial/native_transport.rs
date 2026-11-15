//! Native serial port transport using the `serialport` crate.
//!
//! Implements [`SerialTransport`] for real hardware COM / tty ports.
//! All blocking `serialport` calls are off-loaded to a dedicated
//! [`tokio::task::spawn_blocking`] pool so they never block the async
//! runtime.

use crate::serial::runtime_check::{probe_host, DriverProbe, RealProbe};
use crate::serial::transport::SerialTransport;
use crate::serial::types::*;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Conversion helpers  (types.rs enums → serialport enums)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn to_sp_baud(b: &BaudRate) -> u32 {
    b.value()
}

fn to_sp_data_bits(d: &DataBits) -> serialport::DataBits {
    match d {
        DataBits::Five => serialport::DataBits::Five,
        DataBits::Six => serialport::DataBits::Six,
        DataBits::Seven => serialport::DataBits::Seven,
        DataBits::Eight => serialport::DataBits::Eight,
    }
}

fn to_sp_parity(p: &Parity) -> serialport::Parity {
    match p {
        Parity::None => serialport::Parity::None,
        Parity::Odd => serialport::Parity::Odd,
        Parity::Even => serialport::Parity::Even,
        // Mark / Space are not supported by the serialport crate;
        // fall back to None with a log warning.
        Parity::Mark => {
            log::warn!("Mark parity not supported by serialport crate; using None");
            serialport::Parity::None
        }
        Parity::Space => {
            log::warn!("Space parity not supported by serialport crate; using None");
            serialport::Parity::None
        }
    }
}

fn to_sp_stop_bits(s: &StopBits) -> serialport::StopBits {
    match s {
        StopBits::One => serialport::StopBits::One,
        // 1.5 stop bits not supported; map to Two.
        StopBits::OnePointFive => {
            log::warn!("1.5 stop bits not supported by serialport crate; using Two");
            serialport::StopBits::Two
        }
        StopBits::Two => serialport::StopBits::Two,
    }
}

fn to_sp_flow_control(f: &FlowControl) -> serialport::FlowControl {
    match f {
        FlowControl::None => serialport::FlowControl::None,
        FlowControl::XonXoff => serialport::FlowControl::Software,
        FlowControl::RtsCts => serialport::FlowControl::Hardware,
        // DTR/DSR flow control is not directly supported; use Hardware.
        FlowControl::DtrDsr => {
            log::warn!("DTR/DSR flow control not directly supported; using Hardware");
            serialport::FlowControl::Hardware
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NativeTransport
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type OpenedPorts = (
    Box<dyn serialport::SerialPort>,
    Option<Box<dyn serialport::SerialPort>>,
);

/// Longest a single blocking read may hold the port.  `serialport` uses one
/// timeout for reads and writes (and on Windows the timeout is device-wide),
/// so it is kept short; writes loop until the real write budget instead.
const MAX_BLOCKING_READ_MS: u64 = 20;
const MIN_BLOCKING_READ_MS: u64 = 5;

fn blocking_timeout(read_timeout_ms: u64) -> Duration {
    let ms = if read_timeout_ms == 0 {
        MAX_BLOCKING_READ_MS
    } else {
        read_timeout_ms.clamp(MIN_BLOCKING_READ_MS, MAX_BLOCKING_READ_MS)
    };
    Duration::from_millis(ms)
}

/// Write all of `data`, retrying on short timeouts until `budget` elapses.
fn write_all_within(
    port: &mut dyn serialport::SerialPort,
    data: &[u8],
    budget: Duration,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let mut offset = 0;
    while offset < data.len() {
        match port.write(&data[offset..]) {
            Ok(0) => return Err("Write error: port accepted no bytes".to_string()),
            Ok(n) => offset += n,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted
                ) =>
            {
                if started.elapsed() >= budget {
                    return Err("Write error: timed out".to_string());
                }
            }
            Err(e) => return Err(format!("Write error: {}", e)),
        }
    }
    Ok(())
}

/// Real hardware serial port transport backed by the `serialport` crate.
///
/// The underlying `Box<dyn SerialPort>` is **not** `Send`, so every call
/// is dispatched through `spawn_blocking` with the port held behind an
/// `Arc<Mutex<Option<…>>>` that is locked/unlocked on the blocking thread.
// Reads use a separate cloned handle (try_clone) so a blocked read never
// holds the mutex that writes and control-line calls need; if the driver
// refuses to clone, reads fall back to the single shared handle.
pub struct NativeTransport {
    port_name: String,
    /// The open port handle used for writes and control (None when closed).
    port: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
    /// Dedicated read handle (None when closed or the clone failed).
    reader: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
    /// Whether reads go through `reader` (true) or the shared `port`.
    split_io: AtomicBool,
    /// Budget for one write, from the session write timeout.
    write_timeout_ms: AtomicU64,
    open: AtomicBool,
    /// Remembered config for reconfigure / diagnostics.
    config: Mutex<Option<SerialConfig>>,
}

impl NativeTransport {
    /// Create a new (initially-closed) native transport for `port_name`.
    pub fn new(port_name: &str) -> Arc<Self> {
        Arc::new(Self {
            port_name: port_name.to_string(),
            port: Arc::new(Mutex::new(None)),
            reader: Arc::new(Mutex::new(None)),
            split_io: AtomicBool::new(false),
            write_timeout_ms: AtomicU64::new(1000),
            open: AtomicBool::new(false),
            config: Mutex::new(None),
        })
    }
}

#[async_trait::async_trait]
impl SerialTransport for NativeTransport {
    // ── open ───────────────────────────────────────────────────
    async fn open(&self, config: &SerialConfig) -> Result<(), String> {
        config.validate()?;
        if config.port_name != self.port_name {
            return Err("Native transport port does not match its configuration".to_string());
        }
        if self.open.load(Ordering::SeqCst) {
            return Err("Port is already open".into());
        }

        // Runtime driver probe (t3-e4). Feature `protocol-serial-dynamic`
        // runs the real per-OS probe; `protocol-serial` short-circuits to
        // Ok. Convert the typed SerialError into the transport's String
        // error channel with a stable "DriverMissing:" prefix so the UI
        // can detect it. e14 will migrate the transport boundary to the
        // typed SerialError as part of its `todo!` cleanup pass.
        if let Err(e) = RealProbe.probe() {
            return Err(e.message);
        }
        // `probe_host` is re-exported here to keep the call site easy to
        // override in tests / embed a mock probe in future refactors.
        let _ = probe_host;

        let port_name = self.port_name.clone();
        let baud = to_sp_baud(&config.baud_rate);
        let data_bits = to_sp_data_bits(&config.data_bits);
        let parity = to_sp_parity(&config.parity);
        let stop_bits = to_sp_stop_bits(&config.stop_bits);
        let flow = to_sp_flow_control(&config.flow_control);
        let port_timeout = blocking_timeout(config.read_timeout_ms);
        let dtr_on_open = config.dtr_on_open;
        let rts_on_open = config.rts_on_open;

        let (port, reader) = tokio::task::spawn_blocking(move || -> Result<OpenedPorts, String> {
            let builder = serialport::new(&port_name, baud)
                .data_bits(data_bits)
                .parity(parity)
                .stop_bits(stop_bits)
                .flow_control(flow)
                // Short blocking timeout: reads must not hold the port.
                .timeout(port_timeout);

            let mut port = builder
                .open()
                .map_err(|e| format!("Failed to open {}: {}", port_name, e))?;

            // Set initial control line states
            if dtr_on_open {
                let _ = port.write_data_terminal_ready(true);
            }
            if rts_on_open {
                let _ = port.write_request_to_send(true);
            }

            // Independent read handle; fall back to the shared handle if
            // the driver cannot duplicate the port.
            let reader = match port.try_clone() {
                Ok(reader) => Some(reader),
                Err(e) => {
                    log::warn!(
                        "Serial port {} cannot be cloned ({}); using a single shared handle",
                        port_name,
                        e
                    );
                    None
                }
            };

            Ok((port, reader))
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))??;

        self.split_io.store(reader.is_some(), Ordering::SeqCst);
        self.write_timeout_ms
            .store(config.write_timeout_ms.max(1), Ordering::SeqCst);
        *self.reader.lock().await = reader;
        *self.port.lock().await = Some(port);
        self.open.store(true, Ordering::SeqCst);
        *self.config.lock().await = Some(config.clone());
        Ok(())
    }

    // ── close ──────────────────────────────────────────────────
    async fn close(&self) -> Result<(), String> {
        if !self.open.load(Ordering::SeqCst) {
            return Ok(());
        }
        // Drop the port handle (which closes it).
        let port_arc = self.port.clone();
        let reader_arc = self.reader.clone();
        tokio::task::spawn_blocking(move || {
            // Lock on the blocking thread so Drop runs off-runtime.
            // The reader releases within one short read timeout.
            let mut guard = reader_arc.blocking_lock();
            *guard = None;
            drop(guard);
            let mut guard = port_arc.blocking_lock();
            *guard = None;
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?;

        self.open.store(false, Ordering::SeqCst);
        Ok(())
    }

    // ── read ───────────────────────────────────────────────────
    async fn read(&self, buf: &mut [u8]) -> Result<usize, String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        if buf.len() > MAX_SERIAL_PAYLOAD_BYTES {
            return Err(format!(
                "Serial read buffer exceeds {} bytes",
                MAX_SERIAL_PAYLOAD_BYTES
            ));
        }
        let port_arc = if self.split_io.load(Ordering::SeqCst) {
            self.reader.clone()
        } else {
            self.port.clone()
        };
        let len = buf.len();
        let data = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            let mut tmp = vec![0u8; len];
            match port.read(&mut tmp) {
                Ok(n) => {
                    tmp.truncate(n);
                    Ok(tmp)
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    Ok(Vec::new()) // timeout → 0 bytes, not an error
                }
                Err(e) => Err(format!("Read error: {}", e)),
            }
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))??;

        let n = data.len();
        buf[..n].copy_from_slice(&data);
        Ok(n)
    }

    // ── write ──────────────────────────────────────────────────
    async fn write(&self, buf: &[u8]) -> Result<usize, String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        if buf.len() > MAX_SERIAL_PAYLOAD_BYTES {
            return Err(format!(
                "Serial write exceeds {} bytes",
                MAX_SERIAL_PAYLOAD_BYTES
            ));
        }
        let port_arc = self.port.clone();
        let data = buf.to_vec();
        let budget = Duration::from_millis(self.write_timeout_ms.load(Ordering::SeqCst));
        tokio::task::spawn_blocking(move || -> Result<usize, String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            write_all_within(port.as_mut(), &data, budget)?;
            Ok(data.len())
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?
    }

    // ── flush ──────────────────────────────────────────────────
    async fn flush(&self) -> Result<(), String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        let port_arc = self.port.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            port.flush().map_err(|e| format!("Flush error: {}", e))
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?
    }

    // ── drain ──────────────────────────────────────────────────
    async fn drain(&self) -> Result<(), String> {
        // The serialport crate's flush() waits for all output to be
        // transmitted, which is effectively drain.
        self.flush().await
    }

    // ── send_break ─────────────────────────────────────────────
    async fn send_break(&self, duration_ms: u32) -> Result<(), String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        if duration_ms > MAX_SERIAL_BREAK_MS {
            return Err(format!(
                "Serial break duration cannot exceed {} ms",
                MAX_SERIAL_BREAK_MS
            ));
        }
        let port_arc = self.port.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            port.set_break()
                .map_err(|e| format!("set_break error: {}", e))?;
            std::thread::sleep(Duration::from_millis(duration_ms as u64));
            port.clear_break()
                .map_err(|e| format!("clear_break error: {}", e))?;
            Ok(())
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?
    }

    // ── set_dtr ────────────────────────────────────────────────
    async fn set_dtr(&self, state: bool) -> Result<(), String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        let port_arc = self.port.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            port.write_data_terminal_ready(state)
                .map_err(|e| format!("set_dtr error: {}", e))
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?
    }

    // ── set_rts ────────────────────────────────────────────────
    async fn set_rts(&self, state: bool) -> Result<(), String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        let port_arc = self.port.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            port.write_request_to_send(state)
                .map_err(|e| format!("set_rts error: {}", e))
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?
    }

    // ── read_control_lines ─────────────────────────────────────
    async fn read_control_lines(&self) -> Result<ControlLines, String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        let port_arc = self.port.clone();
        tokio::task::spawn_blocking(move || -> Result<ControlLines, String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            Ok(ControlLines {
                dtr: false, // DTR is an output — we don't read it back
                rts: false, // RTS is an output — we don't read it back
                cts: port.read_clear_to_send().unwrap_or(false),
                dsr: port.read_data_set_ready().unwrap_or(false),
                ri: port.read_ring_indicator().unwrap_or(false),
                dcd: port.read_carrier_detect().unwrap_or(false),
            })
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?
    }

    // ── bytes_available ────────────────────────────────────────
    async fn bytes_available(&self) -> Result<usize, String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        let port_arc = self.port.clone();
        tokio::task::spawn_blocking(move || -> Result<usize, String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            port.bytes_to_read()
                .map(|n| n as usize)
                .map_err(|e| format!("bytes_available error: {}", e))
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))?
    }

    // ── reconfigure ────────────────────────────────────────────
    async fn reconfigure(&self, config: &SerialConfig) -> Result<(), String> {
        config.validate()?;
        if config.port_name != self.port_name {
            return Err("Cannot change the native transport port name".to_string());
        }
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port is not open".into());
        }

        let port_arc = self.port.clone();
        let baud = to_sp_baud(&config.baud_rate);
        let data_bits = to_sp_data_bits(&config.data_bits);
        let parity = to_sp_parity(&config.parity);
        let stop_bits = to_sp_stop_bits(&config.stop_bits);
        let flow = to_sp_flow_control(&config.flow_control);
        let timeout = blocking_timeout(config.read_timeout_ms);
        let reader_arc = self.reader.clone();
        self.write_timeout_ms
            .store(config.write_timeout_ms.max(1), Ordering::SeqCst);

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = port_arc.blocking_lock();
            let port = guard.as_mut().ok_or("Port closed")?;
            port.set_baud_rate(baud)
                .map_err(|e| format!("set_baud_rate: {}", e))?;
            port.set_data_bits(data_bits)
                .map_err(|e| format!("set_data_bits: {}", e))?;
            port.set_parity(parity)
                .map_err(|e| format!("set_parity: {}", e))?;
            port.set_stop_bits(stop_bits)
                .map_err(|e| format!("set_stop_bits: {}", e))?;
            port.set_flow_control(flow)
                .map_err(|e| format!("set_flow_control: {}", e))?;
            port.set_timeout(timeout)
                .map_err(|e| format!("set_timeout: {}", e))?;
            drop(guard);
            // The cloned read handle keeps its own timeout on some platforms.
            let mut reader_guard = reader_arc.blocking_lock();
            if let Some(reader) = reader_guard.as_mut() {
                reader
                    .set_timeout(timeout)
                    .map_err(|e| format!("set_timeout: {}", e))?;
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {}", e))??;

        *self.config.lock().await = Some(config.clone());
        Ok(())
    }

    // ── is_open ────────────────────────────────────────────────
    fn is_open(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }

    // ── port_name ──────────────────────────────────────────────
    fn port_name(&self) -> &str {
        &self.port_name
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_transport_new() {
        let t = NativeTransport::new("COM1");
        assert_eq!(t.port_name(), "COM1");
        assert!(!t.is_open());
    }

    #[test]
    fn test_native_transport_new_linux() {
        let t = NativeTransport::new("/dev/ttyUSB0");
        assert_eq!(t.port_name(), "/dev/ttyUSB0");
        assert!(!t.is_open());
    }

    #[tokio::test]
    async fn test_read_on_closed_port() {
        let t = NativeTransport::new("COM99");
        let mut buf = [0u8; 128];
        let result = t.read(&mut buf).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not open"));
    }

    #[tokio::test]
    async fn test_write_on_closed_port() {
        let t = NativeTransport::new("COM99");
        let result = t.write(b"hello").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not open"));
    }

    #[tokio::test]
    async fn test_close_when_already_closed() {
        let t = NativeTransport::new("COM99");
        // Should succeed silently when port is not open
        let result = t.close().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_open_nonexistent_port() {
        let t = NativeTransport::new("COM_NONEXISTENT_999");
        let config = valid_test_config("COM_NONEXISTENT_999");
        assert_eq!(config.validate(), Ok(()));
        let result = t.open(&config).await;
        assert!(result.is_err());
        assert!(!t.is_open());
    }

    #[tokio::test]
    async fn test_flush_on_closed_port() {
        let t = NativeTransport::new("COM99");
        assert!(t.flush().await.is_err());
    }

    #[tokio::test]
    async fn test_send_break_on_closed_port() {
        let t = NativeTransport::new("COM99");
        assert!(t.send_break(250).await.is_err());
    }

    #[tokio::test]
    async fn test_dtr_rts_on_closed_port() {
        let t = NativeTransport::new("COM99");
        assert!(t.set_dtr(true).await.is_err());
        assert!(t.set_rts(true).await.is_err());
    }

    #[tokio::test]
    async fn test_read_control_lines_on_closed_port() {
        let t = NativeTransport::new("COM99");
        assert!(t.read_control_lines().await.is_err());
    }

    #[tokio::test]
    async fn test_bytes_available_on_closed_port() {
        let t = NativeTransport::new("COM99");
        assert!(t.bytes_available().await.is_err());
    }

    #[tokio::test]
    async fn test_reconfigure_on_closed_port() {
        let t = NativeTransport::new("COM99");
        assert_eq!(
            t.reconfigure(&valid_test_config("COM99")).await,
            Err("Port is not open".to_string())
        );
    }

    #[tokio::test]
    async fn test_reconfigure_rejects_a_different_port() {
        let t = NativeTransport::new("COM99");
        assert_eq!(
            t.reconfigure(&valid_test_config("COM98")).await,
            Err("Cannot change the native transport port name".to_string())
        );
    }

    #[test]
    fn test_blocking_timeout_is_short_and_bounded() {
        assert_eq!(blocking_timeout(0), Duration::from_millis(20));
        assert_eq!(blocking_timeout(1), Duration::from_millis(5));
        assert_eq!(blocking_timeout(100), Duration::from_millis(20));
        assert_eq!(blocking_timeout(12), Duration::from_millis(12));
    }

    #[test]
    fn test_to_sp_baud() {
        assert_eq!(to_sp_baud(&BaudRate::Baud9600), 9600);
        assert_eq!(to_sp_baud(&BaudRate::Baud115200), 115200);
        assert_eq!(to_sp_baud(&BaudRate::Custom(250000)), 250000);
    }

    #[test]
    fn test_to_sp_data_bits() {
        assert_eq!(
            to_sp_data_bits(&DataBits::Five) as u8,
            serialport::DataBits::Five as u8
        );
        assert_eq!(
            to_sp_data_bits(&DataBits::Eight) as u8,
            serialport::DataBits::Eight as u8
        );
    }

    #[test]
    fn test_to_sp_parity() {
        assert!(
            matches!(to_sp_parity(&Parity::None), serialport::Parity::None),
            "Expected None parity"
        );
        assert!(
            matches!(to_sp_parity(&Parity::Odd), serialport::Parity::Odd),
            "Expected Odd parity"
        );
        assert!(
            matches!(to_sp_parity(&Parity::Even), serialport::Parity::Even),
            "Expected Even parity"
        );
    }

    #[test]
    fn test_to_sp_stop_bits() {
        assert!(
            matches!(to_sp_stop_bits(&StopBits::One), serialport::StopBits::One),
            "Expected One stop bit"
        );
        assert!(
            matches!(to_sp_stop_bits(&StopBits::Two), serialport::StopBits::Two),
            "Expected Two stop bits"
        );
    }

    #[test]
    fn test_to_sp_flow_control() {
        assert!(
            matches!(
                to_sp_flow_control(&FlowControl::None),
                serialport::FlowControl::None
            ),
            "Expected None flow control"
        );
        assert!(
            matches!(
                to_sp_flow_control(&FlowControl::XonXoff),
                serialport::FlowControl::Software
            ),
            "Expected Software flow control"
        );
        assert!(
            matches!(
                to_sp_flow_control(&FlowControl::RtsCts),
                serialport::FlowControl::Hardware
            ),
            "Expected Hardware flow control"
        );
    }
}
