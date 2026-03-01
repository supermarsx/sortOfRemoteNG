//! Serial port transport abstraction.
//!
//! Provides a platform-agnostic wrapper around OS-level serial port I/O,
//! including byte-level read/write, break signals, modem control lines,
//! and drain / flush operations.  Since we cannot depend on a real serial
//! port library at compile-time (the Tauri desktop host may or may not
//! have one), all low-level I/O is simulated for testability and the
//! actual platform back-end is expected to be injected via the
//! `SerialTransport` trait.

use crate::serial::types::*;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Transport trait
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Platform-agnostic serial port transport.
///
/// Implementations must be `Send + Sync` so they can be held behind an
/// `Arc` and used from multiple async tasks.
#[async_trait::async_trait]
pub trait SerialTransport: Send + Sync {
    /// Open the port with the given configuration.
    async fn open(&self, config: &SerialConfig) -> Result<(), String>;

    /// Close the port.
    async fn close(&self) -> Result<(), String>;

    /// Read up to `buf.len()` bytes into `buf`.  Returns number of bytes read.
    async fn read(&self, buf: &mut [u8]) -> Result<usize, String>;

    /// Write all bytes in `buf`.
    async fn write(&self, buf: &[u8]) -> Result<usize, String>;

    /// Flush all pending output.
    async fn flush(&self) -> Result<(), String>;

    /// Drain — wait until all output has been physically transmitted.
    async fn drain(&self) -> Result<(), String>;

    /// Send a break signal.
    async fn send_break(&self, duration_ms: u32) -> Result<(), String>;

    /// Set DTR (Data Terminal Ready).
    async fn set_dtr(&self, state: bool) -> Result<(), String>;

    /// Set RTS (Request To Send).
    async fn set_rts(&self, state: bool) -> Result<(), String>;

    /// Read current control line states.
    async fn read_control_lines(&self) -> Result<ControlLines, String>;

    /// Get number of bytes waiting in the receive buffer.
    async fn bytes_available(&self) -> Result<usize, String>;

    /// Reconfigure the port (e.g. change baud rate on the fly).
    async fn reconfigure(&self, config: &SerialConfig) -> Result<(), String>;

    /// Check whether the port is open.
    fn is_open(&self) -> bool;

    /// Retrieve the port name.
    fn port_name(&self) -> &str;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Simulated transport (for testing & offline use)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A fully in-memory transport useful for unit tests and UI demos.
pub struct SimulatedTransport {
    name: String,
    open: AtomicBool,
    config: Mutex<SerialConfig>,
    rx_buf: Mutex<VecDeque<u8>>,
    tx_buf: Mutex<VecDeque<u8>>,
    control_lines: Mutex<ControlLines>,
    rx_notify: Notify,
    loopback: AtomicBool,
}

impl SimulatedTransport {
    /// Create a new simulated transport for the given port name.
    pub fn new(port_name: impl Into<String>) -> Arc<Self> {
        Arc::new(Self {
            name: port_name.into(),
            open: AtomicBool::new(false),
            config: Mutex::new(SerialConfig::default()),
            rx_buf: Mutex::new(VecDeque::with_capacity(4096)),
            tx_buf: Mutex::new(VecDeque::with_capacity(4096)),
            control_lines: Mutex::new(ControlLines::default()),
            rx_notify: Notify::new(),
            loopback: AtomicBool::new(false),
        })
    }

    /// Enable loopback mode (TX data is immediately available in RX).
    pub fn set_loopback(&self, enabled: bool) {
        self.loopback.store(enabled, Ordering::SeqCst);
    }

    /// Inject bytes into the receive buffer (simulate incoming data).
    pub async fn inject_rx(&self, data: &[u8]) {
        let mut buf = self.rx_buf.lock().await;
        buf.extend(data);
        self.rx_notify.notify_waiters();
    }

    /// Drain all bytes from the transmit buffer (for test assertions).
    pub async fn drain_tx(&self) -> Vec<u8> {
        let mut buf = self.tx_buf.lock().await;
        buf.drain(..).collect()
    }

    /// Peek at the transmit buffer contents without draining.
    pub async fn peek_tx(&self) -> Vec<u8> {
        let buf = self.tx_buf.lock().await;
        buf.iter().copied().collect()
    }
}

#[async_trait::async_trait]
impl SerialTransport for SimulatedTransport {
    async fn open(&self, config: &SerialConfig) -> Result<(), String> {
        if self.open.load(Ordering::SeqCst) {
            return Err(format!("Port {} already open", self.name));
        }
        let mut cfg = self.config.lock().await;
        *cfg = config.clone();
        self.open.store(true, Ordering::SeqCst);

        // Set control lines per config
        let mut cl = self.control_lines.lock().await;
        cl.dtr = config.dtr_on_open;
        cl.rts = config.rts_on_open;
        cl.dsr = true; // simulate connected
        cl.cts = true;
        Ok(())
    }

    async fn close(&self) -> Result<(), String> {
        self.open.store(false, Ordering::SeqCst);
        let mut cl = self.control_lines.lock().await;
        *cl = ControlLines::default();
        Ok(())
    }

    async fn read(&self, buf: &mut [u8]) -> Result<usize, String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port not open".to_string());
        }
        let mut rx = self.rx_buf.lock().await;
        if rx.is_empty() {
            drop(rx);
            // Wait for data with a short timeout
            tokio::select! {
                _ = self.rx_notify.notified() => {},
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(50)) => {},
            }
            rx = self.rx_buf.lock().await;
        }
        let count = buf.len().min(rx.len());
        for b in buf.iter_mut().take(count) {
            *b = rx.pop_front().unwrap();
        }
        Ok(count)
    }

    async fn write(&self, buf: &[u8]) -> Result<usize, String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port not open".to_string());
        }
        let mut tx = self.tx_buf.lock().await;
        tx.extend(buf);
        drop(tx);

        if self.loopback.load(Ordering::SeqCst) {
            self.inject_rx(buf).await;
        }
        Ok(buf.len())
    }

    async fn flush(&self) -> Result<(), String> {
        Ok(())
    }

    async fn drain(&self) -> Result<(), String> {
        Ok(())
    }

    async fn send_break(&self, _duration_ms: u32) -> Result<(), String> {
        if !self.open.load(Ordering::SeqCst) {
            return Err("Port not open".to_string());
        }
        Ok(())
    }

    async fn set_dtr(&self, state: bool) -> Result<(), String> {
        let mut cl = self.control_lines.lock().await;
        cl.dtr = state;
        Ok(())
    }

    async fn set_rts(&self, state: bool) -> Result<(), String> {
        let mut cl = self.control_lines.lock().await;
        cl.rts = state;
        Ok(())
    }

    async fn read_control_lines(&self) -> Result<ControlLines, String> {
        let cl = self.control_lines.lock().await;
        Ok(*cl)
    }

    async fn bytes_available(&self) -> Result<usize, String> {
        let rx = self.rx_buf.lock().await;
        Ok(rx.len())
    }

    async fn reconfigure(&self, config: &SerialConfig) -> Result<(), String> {
        let mut cfg = self.config.lock().await;
        *cfg = config.clone();
        Ok(())
    }

    fn is_open(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }

    fn port_name(&self) -> &str {
        &self.name
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Line discipline helper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Manages line-based buffering and character processing.
pub struct LineDiscipline {
    buffer: Vec<u8>,
    line_ending: LineEnding,
    local_echo: bool,
    max_line_length: usize,
}

impl LineDiscipline {
    pub fn new(line_ending: LineEnding, local_echo: bool) -> Self {
        Self {
            buffer: Vec::with_capacity(256),
            line_ending,
            local_echo,
            max_line_length: 4096,
        }
    }

    pub fn set_max_line_length(&mut self, max: usize) {
        self.max_line_length = max;
    }

    /// Process incoming byte, returns completed line (if any) and echo bytes.
    pub fn process_byte(&mut self, byte: u8) -> (Option<Vec<u8>>, Vec<u8>) {
        let mut echo = Vec::new();

        match byte {
            // Backspace / DEL
            0x08 | 0x7F => {
                if !self.buffer.is_empty() {
                    self.buffer.pop();
                    if self.local_echo {
                        echo.extend_from_slice(b"\x08 \x08");
                    }
                }
                (None, echo)
            }
            // CR
            b'\r' => {
                if self.local_echo {
                    echo.extend_from_slice(b"\r\n");
                }
                let line = std::mem::take(&mut self.buffer);
                (Some(line), echo)
            }
            // LF
            b'\n' => {
                // If the line ending is LF or CrLf, treat LF as line submit
                if self.local_echo {
                    echo.extend_from_slice(b"\r\n");
                }
                let line = std::mem::take(&mut self.buffer);
                (Some(line), echo)
            }
            // Ctrl-C
            0x03 => {
                self.buffer.clear();
                if self.local_echo {
                    echo.extend_from_slice(b"^C\r\n");
                }
                (None, echo)
            }
            // Ctrl-U (kill line)
            0x15 => {
                if self.local_echo && !self.buffer.is_empty() {
                    for _ in 0..self.buffer.len() {
                        echo.extend_from_slice(b"\x08 \x08");
                    }
                }
                self.buffer.clear();
                (None, echo)
            }
            // Regular character
            _ => {
                if self.buffer.len() < self.max_line_length {
                    self.buffer.push(byte);
                    if self.local_echo {
                        echo.push(byte);
                    }
                }
                (None, echo)
            }
        }
    }

    /// Get current line buffer contents.
    pub fn current_line(&self) -> &[u8] {
        &self.buffer
    }

    /// Clear the line buffer.
    pub fn clear(&mut self) {
        self.buffer.clear();
    }

    /// Append a line ending to a data buffer for transmission.
    pub fn append_line_ending(&self, data: &mut Vec<u8>) {
        data.extend_from_slice(self.line_ending.bytes());
    }

    pub fn line_ending(&self) -> LineEnding {
        self.line_ending
    }

    pub fn set_line_ending(&mut self, le: LineEnding) {
        self.line_ending = le;
    }

    pub fn local_echo(&self) -> bool {
        self.local_echo
    }

    pub fn set_local_echo(&mut self, echo: bool) {
        self.local_echo = echo;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Hex dump formatter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Format bytes as a hex dump string (offset + hex + ASCII).
pub fn hex_dump(data: &[u8], offset: usize) -> String {
    let mut output = String::new();
    for (i, chunk) in data.chunks(16).enumerate() {
        let addr = offset + i * 16;
        output.push_str(&format!("{:08X}  ", addr));

        for (j, byte) in chunk.iter().enumerate() {
            output.push_str(&format!("{:02X} ", byte));
            if j == 7 {
                output.push(' ');
            }
        }

        // Padding for short lines
        let pad = 16 - chunk.len();
        for j in 0..pad {
            output.push_str("   ");
            if chunk.len() + j == 7 {
                output.push(' ');
            }
        }

        output.push_str(" |");
        for byte in chunk {
            if byte.is_ascii_graphic() || *byte == b' ' {
                output.push(*byte as char);
            } else {
                output.push('.');
            }
        }
        output.push_str("|\n");
    }
    output
}

/// Format a single byte as a printable character or dot.
pub fn printable_char(byte: u8) -> char {
    if byte.is_ascii_graphic() || byte == b' ' {
        byte as char
    } else {
        '.'
    }
}

/// Convert bytes to a hex string.
pub fn bytes_to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")
}

/// Convert a hex string back to bytes.
pub fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = hex.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if cleaned.len() % 2 != 0 {
        return Err("Odd number of hex digits".to_string());
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&cleaned[i..i + 2], 16)
                .map_err(|e| format!("Invalid hex at position {}: {}", i, e))
        })
        .collect()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  XON / XOFF (Software flow control)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pub const XON: u8 = 0x11;
pub const XOFF: u8 = 0x13;

/// Software flow control state machine.
pub struct XonXoffController {
    /// Whether we have been told to stop sending (we received XOFF).
    remote_paused: AtomicBool,
    /// Whether we told the remote to stop (we sent XOFF).
    local_paused: AtomicBool,
    /// High-water mark for local RX buffer.
    high_water: usize,
    /// Low-water mark for local RX buffer.
    low_water: usize,
}

impl XonXoffController {
    pub fn new(high_water: usize, low_water: usize) -> Self {
        Self {
            remote_paused: AtomicBool::new(false),
            local_paused: AtomicBool::new(false),
            high_water,
            low_water,
        }
    }

    /// Process an incoming byte. Returns `true` if the byte is a flow control
    /// character and should be consumed (not passed to the application).
    pub fn process_incoming(&self, byte: u8) -> bool {
        match byte {
            XON => {
                self.remote_paused.store(false, Ordering::SeqCst);
                true
            }
            XOFF => {
                self.remote_paused.store(true, Ordering::SeqCst);
                true
            }
            _ => false,
        }
    }

    /// Check whether the remote side has paused us.
    pub fn is_remote_paused(&self) -> bool {
        self.remote_paused.load(Ordering::SeqCst)
    }

    /// Check buffer level and decide whether to send XON or XOFF.
    /// Returns an optional byte to transmit.
    pub fn check_buffer_level(&self, current_level: usize) -> Option<u8> {
        if current_level >= self.high_water && !self.local_paused.load(Ordering::SeqCst) {
            self.local_paused.store(true, Ordering::SeqCst);
            Some(XOFF)
        } else if current_level <= self.low_water && self.local_paused.load(Ordering::SeqCst) {
            self.local_paused.store(false, Ordering::SeqCst);
            Some(XON)
        } else {
            None
        }
    }

    /// Reset flow control state.
    pub fn reset(&self) {
        self.remote_paused.store(false, Ordering::SeqCst);
        self.local_paused.store(false, Ordering::SeqCst);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Character delay helper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Write bytes one at a time with an inter-character delay.
pub async fn write_with_char_delay(
    transport: &dyn SerialTransport,
    data: &[u8],
    delay_ms: u64,
) -> Result<usize, String> {
    let mut total = 0;
    for byte in data {
        let n = transport.write(std::slice::from_ref(byte)).await?;
        total += n;
        if delay_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_simulated_transport_open_close() {
        let t = SimulatedTransport::new("COM1");
        assert!(!t.is_open());
        t.open(&SerialConfig::default()).await.unwrap();
        assert!(t.is_open());
        t.close().await.unwrap();
        assert!(!t.is_open());
    }

    #[tokio::test]
    async fn test_simulated_transport_write_read() {
        let t = SimulatedTransport::new("COM1");
        let cfg = SerialConfig::default();
        t.open(&cfg).await.unwrap();

        t.inject_rx(b"Hello").await;
        let mut buf = [0u8; 64];
        let n = t.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"Hello");
    }

    #[tokio::test]
    async fn test_simulated_transport_loopback() {
        let t = SimulatedTransport::new("COM1");
        t.open(&SerialConfig::default()).await.unwrap();
        t.set_loopback(true);

        t.write(b"echo").await.unwrap();
        let mut buf = [0u8; 64];
        let n = t.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"echo");
    }

    #[tokio::test]
    async fn test_simulated_transport_control_lines() {
        let t = SimulatedTransport::new("COM1");
        let mut cfg = SerialConfig::default();
        cfg.dtr_on_open = true;
        cfg.rts_on_open = false;
        t.open(&cfg).await.unwrap();

        let cl = t.read_control_lines().await.unwrap();
        assert!(cl.dtr);
        assert!(!cl.rts);

        t.set_rts(true).await.unwrap();
        let cl2 = t.read_control_lines().await.unwrap();
        assert!(cl2.rts);
    }

    #[tokio::test]
    async fn test_simulated_transport_error_when_closed() {
        let t = SimulatedTransport::new("COM1");
        let mut buf = [0u8; 8];
        assert!(t.read(&mut buf).await.is_err());
        assert!(t.write(b"x").await.is_err());
    }

    #[test]
    fn test_line_discipline_basic() {
        let mut ld = LineDiscipline::new(LineEnding::CrLf, true);
        let (line, echo) = ld.process_byte(b'A');
        assert!(line.is_none());
        assert_eq!(echo, vec![b'A']);

        let (line, echo) = ld.process_byte(b'B');
        assert!(line.is_none());
        assert_eq!(echo, vec![b'B']);

        let (line, echo) = ld.process_byte(b'\r');
        assert_eq!(line.unwrap(), b"AB");
        assert_eq!(echo, b"\r\n");
    }

    #[test]
    fn test_line_discipline_backspace() {
        let mut ld = LineDiscipline::new(LineEnding::CrLf, true);
        ld.process_byte(b'A');
        ld.process_byte(b'B');
        let (line, echo) = ld.process_byte(0x08);
        assert!(line.is_none());
        assert_eq!(echo, b"\x08 \x08");
        assert_eq!(ld.current_line(), b"A");
    }

    #[test]
    fn test_line_discipline_ctrl_u() {
        let mut ld = LineDiscipline::new(LineEnding::CrLf, true);
        ld.process_byte(b'A');
        ld.process_byte(b'B');
        ld.process_byte(b'C');
        let (line, echo) = ld.process_byte(0x15);
        assert!(line.is_none());
        assert_eq!(echo.len(), 9); // 3 × "\x08 \x08"
        assert!(ld.current_line().is_empty());
    }

    #[test]
    fn test_hex_dump_format() {
        let data = b"Hello, World!";
        let dump = hex_dump(data, 0);
        assert!(dump.contains("48 65 6C 6C"));
        assert!(dump.contains("|Hello, World!|"));
    }

    #[test]
    fn test_bytes_to_hex_roundtrip() {
        let data = vec![0xDE, 0xAD, 0xBE, 0xEF];
        let hex = bytes_to_hex(&data);
        assert_eq!(hex, "DE AD BE EF");
        let back = hex_to_bytes(&hex).unwrap();
        assert_eq!(back, data);
    }

    #[test]
    fn test_hex_to_bytes_error() {
        assert!(hex_to_bytes("ABC").is_err()); // Odd length
    }

    #[test]
    fn test_xon_xoff_controller() {
        let ctrl = XonXoffController::new(100, 20);
        assert!(!ctrl.is_remote_paused());

        assert!(ctrl.process_incoming(XOFF));
        assert!(ctrl.is_remote_paused());

        assert!(ctrl.process_incoming(XON));
        assert!(!ctrl.is_remote_paused());

        // Normal byte should not be consumed
        assert!(!ctrl.process_incoming(b'A'));
    }

    #[test]
    fn test_xon_xoff_buffer_level() {
        let ctrl = XonXoffController::new(100, 20);
        assert_eq!(ctrl.check_buffer_level(50), None);
        assert_eq!(ctrl.check_buffer_level(100), Some(XOFF));
        // Already paused, no duplicate
        assert_eq!(ctrl.check_buffer_level(110), None);
        // Drop below low-water
        assert_eq!(ctrl.check_buffer_level(20), Some(XON));
    }

    #[test]
    fn test_printable_char() {
        assert_eq!(printable_char(b'A'), 'A');
        assert_eq!(printable_char(b' '), ' ');
        assert_eq!(printable_char(0x00), '.');
        assert_eq!(printable_char(0xFF), '.');
    }

    #[test]
    fn test_line_discipline_no_echo() {
        let mut ld = LineDiscipline::new(LineEnding::Lf, false);
        let (_, echo) = ld.process_byte(b'X');
        assert!(echo.is_empty());
        let (_, echo) = ld.process_byte(b'\n');
        assert!(echo.is_empty());
    }

    #[test]
    fn test_line_discipline_append_ending() {
        let ld = LineDiscipline::new(LineEnding::CrLf, false);
        let mut data = b"test".to_vec();
        ld.append_line_ending(&mut data);
        assert_eq!(data, b"test\r\n");
    }
}
