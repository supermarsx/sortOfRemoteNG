//! Serial/COM port device handler for RDPDR serial redirection.
//!
//! When the `rdp-serial` feature is enabled this module opens a real local
//! serial port and forwards RDPDR IRPs to it. Without that feature the device
//! stays protocol-compatible but remains a graceful no-op backend so the rest
//! of the RDPDR channel continues to behave as before.

use std::io;

#[cfg(feature = "rdp-serial")]
use std::io::{Read, Write};
#[cfg(feature = "rdp-serial")]
use std::time::Duration;

use super::pdu::*;

// IOCTL_SERIAL codes (subset)
const IOCTL_SERIAL_SET_BAUD_RATE: u32 = 0x001B_0004;
const IOCTL_SERIAL_GET_BAUD_RATE: u32 = 0x001B_0050;
const IOCTL_SERIAL_SET_LINE_CONTROL: u32 = 0x001B_000C;
const IOCTL_SERIAL_GET_LINE_CONTROL: u32 = 0x001B_0054;
const IOCTL_SERIAL_SET_TIMEOUTS: u32 = 0x001B_001C;
const IOCTL_SERIAL_GET_TIMEOUTS: u32 = 0x001B_0020;
const IOCTL_SERIAL_GET_WAIT_MASK: u32 = 0x001B_0040;
const IOCTL_SERIAL_SET_WAIT_MASK: u32 = 0x001B_0044;
const IOCTL_SERIAL_GET_COMMSTATUS: u32 = 0x001B_0068;
const IOCTL_SERIAL_SET_DTR: u32 = 0x001B_0024;
const IOCTL_SERIAL_CLR_DTR: u32 = 0x001B_0028;
const IOCTL_SERIAL_SET_RTS: u32 = 0x001B_0030;
const IOCTL_SERIAL_CLR_RTS: u32 = 0x001B_0034;
const IOCTL_SERIAL_PURGE: u32 = 0x001B_004C;
const IOCTL_SERIAL_GET_HANDFLOW: u32 = 0x001B_0060;
const IOCTL_SERIAL_SET_HANDFLOW: u32 = 0x001B_0064;
const IOCTL_SERIAL_GET_PROPERTIES: u32 = 0x001B_0074;
const IOCTL_SERIAL_GET_CHARS: u32 = 0x001B_0058;
const IOCTL_SERIAL_SET_CHARS: u32 = 0x001B_005C;

const DEVICE_CONTROL_DATA_OFFSET: usize = 32;
const WRITE_DATA_OFFSET: usize = 32;
const SERIAL_COMMPROP_SIZE: usize = 64;
#[cfg(feature = "rdp-serial")]
const MIN_EFFECTIVE_TIMEOUT_MS: u64 = 50;

const SERIAL_STOP_BIT_1: u8 = 0;
const SERIAL_STOP_BITS_1_5: u8 = 1;
const SERIAL_STOP_BITS_2: u8 = 2;

const SERIAL_PARITY_NONE: u8 = 0;
const SERIAL_PARITY_ODD: u8 = 1;
const SERIAL_PARITY_EVEN: u8 = 2;
const SERIAL_PARITY_MARK: u8 = 3;
const SERIAL_PARITY_SPACE: u8 = 4;

#[cfg(feature = "rdp-serial")]
const SERIAL_PURGE_TXABORT: u32 = 0x0000_0001;
#[cfg(feature = "rdp-serial")]
const SERIAL_PURGE_RXABORT: u32 = 0x0000_0002;
#[cfg(feature = "rdp-serial")]
const SERIAL_PURGE_TXCLEAR: u32 = 0x0000_0004;
#[cfg(feature = "rdp-serial")]
const SERIAL_PURGE_RXCLEAR: u32 = 0x0000_0008;

const SERIAL_SP_SERIALCOMM: u32 = 0x0000_0001;
const SERIAL_SP_RS232: u32 = 0x0000_0001;
const SERIAL_PCF_DTRDSR: u32 = 0x0000_0001;
const SERIAL_PCF_RTSCTS: u32 = 0x0000_0002;
const SERIAL_PCF_PARITY_CHECK: u32 = 0x0000_0008;
const SERIAL_PCF_XONXOFF: u32 = 0x0000_0010;
const SERIAL_PCF_TOTALTIMEOUTS: u32 = 0x0000_0040;
const SERIAL_PCF_INTTIMEOUTS: u32 = 0x0000_0080;
const SERIAL_PCF_SPECIALCHARS: u32 = 0x0000_0100;
const SERIAL_SP_PARITY: u32 = 0x0000_0001;
const SERIAL_SP_BAUD: u32 = 0x0000_0002;
const SERIAL_SP_DATABITS: u32 = 0x0000_0004;
const SERIAL_SP_STOPBITS: u32 = 0x0000_0008;
const SERIAL_SP_HANDSHAKING: u32 = 0x0000_0010;
const SERIAL_DATABITS_5: u16 = 0x0001;
const SERIAL_DATABITS_6: u16 = 0x0002;
const SERIAL_DATABITS_7: u16 = 0x0004;
const SERIAL_DATABITS_8: u16 = 0x0008;
const SERIAL_STOPPARITY_10: u16 = 0x0001;
const SERIAL_STOPPARITY_15: u16 = 0x0002;
const SERIAL_STOPPARITY_20: u16 = 0x0004;
const SERIAL_PARITY_CAP_NONE: u16 = 0x0100;
const SERIAL_PARITY_CAP_ODD: u16 = 0x0200;
const SERIAL_PARITY_CAP_EVEN: u16 = 0x0400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LineControl {
    stop_bits: u8,
    parity: u8,
    word_length: u8,
}

impl Default for LineControl {
    fn default() -> Self {
        Self {
            stop_bits: SERIAL_STOP_BIT_1,
            parity: SERIAL_PARITY_NONE,
            word_length: 8,
        }
    }
}

impl LineControl {
    fn from_input(input: &[u8]) -> Option<Self> {
        if input.len() < 3 {
            return None;
        }

        Some(
            Self {
                stop_bits: input[0],
                parity: input[1],
                word_length: input[2],
            }
            .sanitize(),
        )
    }

    fn sanitize(mut self) -> Self {
        self.stop_bits = match self.stop_bits {
            SERIAL_STOP_BIT_1 | SERIAL_STOP_BITS_1_5 | SERIAL_STOP_BITS_2 => self.stop_bits,
            _ => SERIAL_STOP_BIT_1,
        };
        self.parity = match self.parity {
            SERIAL_PARITY_NONE
            | SERIAL_PARITY_ODD
            | SERIAL_PARITY_EVEN
            | SERIAL_PARITY_MARK
            | SERIAL_PARITY_SPACE => self.parity,
            _ => SERIAL_PARITY_NONE,
        };
        self.word_length = self.word_length.clamp(5, 8);

        #[cfg(feature = "rdp-serial")]
        {
            if self.stop_bits == SERIAL_STOP_BITS_1_5 {
                log::warn!("RDPDR serial: 1.5 stop bits are not supported by serialport; using 2 stop bits");
                self.stop_bits = SERIAL_STOP_BITS_2;
            }
            if matches!(self.parity, SERIAL_PARITY_MARK | SERIAL_PARITY_SPACE) {
                log::warn!("RDPDR serial: mark/space parity are not supported by serialport; using no parity");
                self.parity = SERIAL_PARITY_NONE;
            }
        }

        self
    }

    fn encode(self) -> [u8; 3] {
        [self.stop_bits, self.parity, self.word_length]
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct SerialTimeouts {
    read_interval_timeout: u32,
    read_total_timeout_multiplier: u32,
    read_total_timeout_constant: u32,
    write_total_timeout_multiplier: u32,
    write_total_timeout_constant: u32,
}

impl SerialTimeouts {
    fn from_input(input: &[u8]) -> Option<Self> {
        if input.len() < 20 {
            return None;
        }

        Some(Self {
            read_interval_timeout: read_u32(input, 0),
            read_total_timeout_multiplier: read_u32(input, 4),
            read_total_timeout_constant: read_u32(input, 8),
            write_total_timeout_multiplier: read_u32(input, 12),
            write_total_timeout_constant: read_u32(input, 16),
        })
    }

    fn encode(self) -> [u8; 20] {
        let mut out = [0u8; 20];
        out[0..4].copy_from_slice(&self.read_interval_timeout.to_le_bytes());
        out[4..8].copy_from_slice(&self.read_total_timeout_multiplier.to_le_bytes());
        out[8..12].copy_from_slice(&self.read_total_timeout_constant.to_le_bytes());
        out[12..16].copy_from_slice(&self.write_total_timeout_multiplier.to_le_bytes());
        out[16..20].copy_from_slice(&self.write_total_timeout_constant.to_le_bytes());
        out
    }

    #[cfg(feature = "rdp-serial")]
    fn effective_timeout(self) -> Duration {
        let read_hint = self
            .read_total_timeout_constant
            .max(self.read_total_timeout_multiplier)
            .max(
                if self.read_interval_timeout == 0 || self.read_interval_timeout == u32::MAX {
                    0
                } else {
                    self.read_interval_timeout
                },
            );
        let write_hint = self
            .write_total_timeout_constant
            .max(self.write_total_timeout_multiplier);
        let timeout_ms = read_hint
            .max(write_hint)
            .max(MIN_EFFECTIVE_TIMEOUT_MS as u32);

        Duration::from_millis(timeout_ms as u64)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct SerialHandflow {
    control_handshake: u32,
    flow_replace: u32,
    xon_limit: u32,
    xoff_limit: u32,
}

impl SerialHandflow {
    fn from_input(input: &[u8]) -> Option<Self> {
        if input.len() < 16 {
            return None;
        }

        Some(Self {
            control_handshake: read_u32(input, 0),
            flow_replace: read_u32(input, 4),
            xon_limit: read_u32(input, 8),
            xoff_limit: read_u32(input, 12),
        })
    }

    fn encode(self) -> [u8; 16] {
        let mut out = [0u8; 16];
        out[0..4].copy_from_slice(&self.control_handshake.to_le_bytes());
        out[4..8].copy_from_slice(&self.flow_replace.to_le_bytes());
        out[8..12].copy_from_slice(&self.xon_limit.to_le_bytes());
        out[12..16].copy_from_slice(&self.xoff_limit.to_le_bytes());
        out
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SerialChars {
    eof_char: u8,
    error_char: u8,
    break_char: u8,
    event_char: u8,
    xon_char: u8,
    xoff_char: u8,
}

impl Default for SerialChars {
    fn default() -> Self {
        Self {
            eof_char: 0,
            error_char: 0,
            break_char: 0,
            event_char: 0,
            xon_char: 0x11,
            xoff_char: 0x13,
        }
    }
}

impl SerialChars {
    fn from_input(input: &[u8]) -> Option<Self> {
        if input.len() < 6 {
            return None;
        }

        Some(Self {
            eof_char: input[0],
            error_char: input[1],
            break_char: input[2],
            event_char: input[3],
            xon_char: input[4],
            xoff_char: input[5],
        })
    }

    fn encode(self) -> [u8; 6] {
        [
            self.eof_char,
            self.error_char,
            self.break_char,
            self.event_char,
            self.xon_char,
            self.xoff_char,
        ]
    }
}

#[cfg(feature = "rdp-serial")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SerialSettings {
    baud_rate: u32,
    line_control: LineControl,
    timeouts: SerialTimeouts,
    dtr_enabled: bool,
    rts_enabled: bool,
}

#[cfg(feature = "rdp-serial")]
trait SerialPortHandle: Send {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize>;
    fn write_all(&mut self, buf: &[u8]) -> io::Result<()>;
    fn flush(&mut self) -> io::Result<()>;
    fn set_baud_rate(&mut self, baud_rate: u32) -> io::Result<()>;
    fn set_line_control(&mut self, line_control: LineControl) -> io::Result<()>;
    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()>;
    fn set_dtr(&mut self, enabled: bool) -> io::Result<()>;
    fn set_rts(&mut self, enabled: bool) -> io::Result<()>;
    fn bytes_to_read(&self) -> io::Result<u32>;
    fn bytes_to_write(&self) -> io::Result<u32>;
    fn clear_input(&mut self) -> io::Result<()>;
    fn clear_output(&mut self) -> io::Result<()>;
}

#[cfg(feature = "rdp-serial")]
trait SerialPortFactory: Send {
    fn open(&self, port_name: &str, settings: &SerialSettings) -> io::Result<Box<dyn SerialPortHandle>>;
}

#[cfg(feature = "rdp-serial")]
struct SystemSerialPortFactory;

#[cfg(feature = "rdp-serial")]
struct SystemSerialPort {
    inner: Box<dyn serialport::SerialPort>,
}

#[cfg(feature = "rdp-serial")]
impl SerialPortHandle for SystemSerialPort {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }

    fn write_all(&mut self, buf: &[u8]) -> io::Result<()> {
        self.inner.write_all(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }

    fn set_baud_rate(&mut self, baud_rate: u32) -> io::Result<()> {
        self.inner
            .set_baud_rate(baud_rate)
            .map_err(serialport_error)
    }

    fn set_line_control(&mut self, line_control: LineControl) -> io::Result<()> {
        self.inner
            .set_data_bits(serial_data_bits(line_control.word_length))
            .map_err(serialport_error)?;
        self.inner
            .set_parity(serial_parity(line_control.parity))
            .map_err(serialport_error)?;
        self.inner
            .set_stop_bits(serial_stop_bits(line_control.stop_bits))
            .map_err(serialport_error)
    }

    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()> {
        self.inner.set_timeout(timeout).map_err(serialport_error)
    }

    fn set_dtr(&mut self, enabled: bool) -> io::Result<()> {
        self.inner
            .write_data_terminal_ready(enabled)
            .map_err(serialport_error)
    }

    fn set_rts(&mut self, enabled: bool) -> io::Result<()> {
        self.inner
            .write_request_to_send(enabled)
            .map_err(serialport_error)
    }

    fn bytes_to_read(&self) -> io::Result<u32> {
        self.inner.bytes_to_read().map_err(serialport_error)
    }

    fn bytes_to_write(&self) -> io::Result<u32> {
        self.inner.bytes_to_write().map_err(serialport_error)
    }

    fn clear_input(&mut self) -> io::Result<()> {
        self.inner
            .clear(serialport::ClearBuffer::Input)
            .map_err(serialport_error)
    }

    fn clear_output(&mut self) -> io::Result<()> {
        self.inner
            .clear(serialport::ClearBuffer::Output)
            .map_err(serialport_error)
    }
}

#[cfg(feature = "rdp-serial")]
impl SerialPortFactory for SystemSerialPortFactory {
    fn open(&self, port_name: &str, settings: &SerialSettings) -> io::Result<Box<dyn SerialPortHandle>> {
        let timeout = settings.timeouts.effective_timeout();
        let mut port = serialport::new(port_name, settings.baud_rate)
            .data_bits(serial_data_bits(settings.line_control.word_length))
            .parity(serial_parity(settings.line_control.parity))
            .stop_bits(serial_stop_bits(settings.line_control.stop_bits))
            .timeout(timeout)
            .open()
            .map_err(serialport_error)?;

        if settings.dtr_enabled {
            port.write_data_terminal_ready(true).map_err(serialport_error)?;
        }
        if settings.rts_enabled {
            port.write_request_to_send(true).map_err(serialport_error)?;
        }

        Ok(Box::new(SystemSerialPort { inner: port }))
    }
}

/// A redirected serial port device.
pub struct SerialDevice {
    pub device_id: u32,
    port_name: String,
    session_id: String,
    baud_rate: u32,
    line_control: LineControl,
    timeouts: SerialTimeouts,
    wait_mask: u32,
    handflow: SerialHandflow,
    chars: SerialChars,
    dtr_enabled: bool,
    rts_enabled: bool,
    open_file_id: Option<u32>,
    next_file_id: u32,
    #[cfg(feature = "rdp-serial")]
    port: Option<Box<dyn SerialPortHandle>>,
    #[cfg(feature = "rdp-serial")]
    opener: Box<dyn SerialPortFactory>,
}

impl SerialDevice {
    pub fn new(device_id: u32, port_name: &str, session_id: String) -> Self {
        Self {
            device_id,
            port_name: port_name.to_string(),
            session_id,
            baud_rate: 9600,
            line_control: LineControl::default(),
            timeouts: SerialTimeouts::default(),
            wait_mask: 0,
            handflow: SerialHandflow::default(),
            chars: SerialChars::default(),
            dtr_enabled: false,
            rts_enabled: false,
            open_file_id: None,
            next_file_id: 1,
            #[cfg(feature = "rdp-serial")]
            port: None,
            #[cfg(feature = "rdp-serial")]
            opener: Box::new(SystemSerialPortFactory),
        }
    }

    #[cfg(all(test, feature = "rdp-serial"))]
    fn new_with_factory(
        device_id: u32,
        port_name: &str,
        session_id: String,
        opener: Box<dyn SerialPortFactory>,
    ) -> Self {
        let mut device = Self::new(device_id, port_name, session_id);
        device.opener = opener;
        device
    }

    /// Handle an IRP for this serial device.
    pub fn handle_irp(&mut self, major: u32, _minor: u32, completion_id: u32, file_id: u32, data: &[u8]) -> Option<Vec<u8>> {
        let (status, output) = match major {
            IRP_MJ_CREATE => self.handle_create(),
            IRP_MJ_CLOSE => self.handle_close(file_id),
            IRP_MJ_READ => self.handle_read(file_id, data),
            IRP_MJ_WRITE => self.handle_write(file_id, data),
            IRP_MJ_DEVICE_CONTROL => self.handle_ioctl(data),
            _ => {
                log::debug!("RDPDR serial {}: unsupported IRP major=0x{:X}", self.session_id, major);
                (STATUS_NOT_SUPPORTED, Vec::new())
            }
        };
        Some(build_io_completion(self.device_id, completion_id, status, &output))
    }

    fn handle_create(&mut self) -> (u32, Vec<u8>) {
        self.close_port();

        let file_id = self.next_file_id;
        self.next_file_id += 1;

        #[cfg(feature = "rdp-serial")]
        {
            let settings = self.current_settings();
            match self.opener.open(&self.port_name, &settings) {
                Ok(port) => {
                    self.port = Some(port);
                    self.open_file_id = Some(file_id);
                    log::info!(
                        "RDPDR serial {}: opened local port '{}' as file_id={}",
                        self.session_id,
                        self.port_name,
                        file_id
                    );
                    (STATUS_SUCCESS, create_response(file_id, 1))
                }
                Err(error) => {
                    log::warn!(
                        "RDPDR serial {}: failed to open local port '{}': {}",
                        self.session_id,
                        self.port_name,
                        error
                    );
                    (status_from_io_error(&error), create_response(0, 0))
                }
            }
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            self.open_file_id = Some(file_id);
            log::info!(
                "RDPDR serial {}: accepting open for '{}' without native backend (feature disabled)",
                self.session_id,
                self.port_name
            );
            (STATUS_SUCCESS, create_response(file_id, 1))
        }
    }

    fn handle_close(&mut self, file_id: u32) -> (u32, Vec<u8>) {
        if self.open_file_id.is_some() {
            log::info!(
                "RDPDR serial {}: close port '{}' file_id={}",
                self.session_id,
                self.port_name,
                file_id
            );
        }
        self.close_port();
        (STATUS_SUCCESS, vec![0u8; 5])
    }

    fn handle_read(&mut self, file_id: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 4 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }

        let length = read_u32(data, 0) as usize;

        #[cfg(not(feature = "rdp-serial"))]
        let _ = length;

        #[cfg(feature = "rdp-serial")]
        {
            if !self.is_open_file(file_id) {
                return (STATUS_UNSUCCESSFUL, Vec::new());
            }

            let mut buffer = vec![0u8; length];
            let read_len = match self.port.as_mut() {
                Some(port) => match port.read(&mut buffer) {
                    Ok(count) => count,
                    Err(error) if error.kind() == io::ErrorKind::TimedOut => 0,
                    Err(error) => {
                        log::warn!(
                            "RDPDR serial {}: read failed on '{}': {}",
                            self.session_id,
                            self.port_name,
                            error
                        );
                        return (STATUS_UNSUCCESSFUL, Vec::new());
                    }
                },
                None => return (STATUS_UNSUCCESSFUL, Vec::new()),
            };

            buffer.truncate(read_len);
            let mut out = Vec::with_capacity(4 + read_len);
            out.extend_from_slice(&(read_len as u32).to_le_bytes());
            out.extend_from_slice(&buffer);
            (STATUS_SUCCESS, out)
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            let _ = file_id;
            let mut out = Vec::with_capacity(4);
            out.extend_from_slice(&0u32.to_le_bytes());
            (STATUS_SUCCESS, out)
        }
    }

    fn handle_write(&mut self, file_id: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 4 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }

        let length = read_u32(data, 0) as usize;
        if data.len() < WRITE_DATA_OFFSET {
            return if length == 0 {
                (STATUS_SUCCESS, write_response(0))
            } else {
                (STATUS_UNSUCCESSFUL, Vec::new())
            };
        }

        let available = data.len() - WRITE_DATA_OFFSET;
        let write_len = length.min(available);

        #[cfg(feature = "rdp-serial")]
        let payload = &data[WRITE_DATA_OFFSET..WRITE_DATA_OFFSET + write_len];

        #[cfg(feature = "rdp-serial")]
        {
            if !self.is_open_file(file_id) {
                return (STATUS_UNSUCCESSFUL, Vec::new());
            }

            match self.port.as_mut() {
                Some(port) => {
                    if let Err(error) = port.write_all(payload) {
                        log::warn!(
                            "RDPDR serial {}: write failed on '{}': {}",
                            self.session_id,
                            self.port_name,
                            error
                        );
                        return (STATUS_UNSUCCESSFUL, Vec::new());
                    }
                    if let Err(error) = port.flush() {
                        log::debug!(
                            "RDPDR serial {}: flush after write on '{}' failed: {}",
                            self.session_id,
                            self.port_name,
                            error
                        );
                    }
                }
                None => return (STATUS_UNSUCCESSFUL, Vec::new()),
            }

            (STATUS_SUCCESS, write_response(write_len as u32))
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            let _ = file_id;
            if write_len > 0 {
                log::warn!(
                    "RDPDR serial {}: discarding {} bytes for '{}' (native serial backend disabled)",
                    self.session_id,
                    write_len,
                    self.port_name
                );
            }
            (STATUS_SUCCESS, write_response(write_len as u32))
        }
    }

    fn handle_ioctl(&mut self, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 12 {
            return (STATUS_NOT_SUPPORTED, Vec::new());
        }

        let output_buffer_length = read_u32(data, 0);
        let input_buffer_length = read_u32(data, 4) as usize;
        let ioctl_code = read_u32(data, 8);
        let input = device_control_input(data, input_buffer_length);

        log::debug!("RDPDR serial {}: IOCTL 0x{:08X}", self.session_id, ioctl_code);

        match ioctl_code {
            IOCTL_SERIAL_GET_BAUD_RATE => {
                let mut out = Vec::with_capacity(8);
                out.extend_from_slice(&4u32.to_le_bytes());
                out.extend_from_slice(&self.baud_rate.to_le_bytes());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_BAUD_RATE => {
                let Some(new_baud_rate) = read_optional_u32(input) else {
                    return (STATUS_UNSUCCESSFUL, Vec::new());
                };

                let previous = self.baud_rate;
                self.baud_rate = new_baud_rate;
                if let Err(error) = self.apply_baud_rate() {
                    self.baud_rate = previous;
                    log::warn!(
                        "RDPDR serial {}: failed to set baud rate on '{}': {}",
                        self.session_id,
                        self.port_name,
                        error
                    );
                    return (status_from_io_error(&error), Vec::new());
                }

                (STATUS_SUCCESS, device_control_ack())
            }
            IOCTL_SERIAL_GET_LINE_CONTROL => {
                let mut out = Vec::with_capacity(7);
                out.extend_from_slice(&3u32.to_le_bytes());
                out.extend_from_slice(&self.line_control.encode());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_LINE_CONTROL => {
                let Some(new_line_control) = LineControl::from_input(input) else {
                    return (STATUS_UNSUCCESSFUL, Vec::new());
                };

                let previous = self.line_control;
                self.line_control = new_line_control;
                if let Err(error) = self.apply_line_control() {
                    self.line_control = previous;
                    log::warn!(
                        "RDPDR serial {}: failed to set line control on '{}': {}",
                        self.session_id,
                        self.port_name,
                        error
                    );
                    return (status_from_io_error(&error), Vec::new());
                }

                (STATUS_SUCCESS, device_control_ack())
            }
            IOCTL_SERIAL_GET_TIMEOUTS => {
                let mut out = Vec::with_capacity(24);
                out.extend_from_slice(&20u32.to_le_bytes());
                out.extend_from_slice(&self.timeouts.encode());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_TIMEOUTS => {
                let Some(new_timeouts) = SerialTimeouts::from_input(input) else {
                    return (STATUS_UNSUCCESSFUL, Vec::new());
                };

                let previous = self.timeouts;
                self.timeouts = new_timeouts;
                if let Err(error) = self.apply_timeouts() {
                    self.timeouts = previous;
                    log::warn!(
                        "RDPDR serial {}: failed to update timeout state on '{}': {}",
                        self.session_id,
                        self.port_name,
                        error
                    );
                    return (status_from_io_error(&error), Vec::new());
                }

                (STATUS_SUCCESS, device_control_ack())
            }
            IOCTL_SERIAL_GET_WAIT_MASK => {
                let mut out = Vec::with_capacity(8);
                out.extend_from_slice(&4u32.to_le_bytes());
                out.extend_from_slice(&self.wait_mask.to_le_bytes());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_WAIT_MASK => {
                let Some(wait_mask) = read_optional_u32(input) else {
                    return (STATUS_UNSUCCESSFUL, Vec::new());
                };
                self.wait_mask = wait_mask;
                (STATUS_SUCCESS, device_control_ack())
            }
            IOCTL_SERIAL_GET_COMMSTATUS => {
                let (bytes_in_queue, bytes_out_queue) = self.comm_status_counts();
                let mut out = Vec::with_capacity(24);
                out.extend_from_slice(&20u32.to_le_bytes());
                out.extend_from_slice(&0u32.to_le_bytes());
                out.extend_from_slice(&0u32.to_le_bytes());
                out.extend_from_slice(&bytes_in_queue.to_le_bytes());
                out.extend_from_slice(&bytes_out_queue.to_le_bytes());
                out.push(0);
                out.push(0);
                out.extend_from_slice(&[0u8; 2]);
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_DTR => self.set_control_line(true, self.rts_enabled, true),
            IOCTL_SERIAL_CLR_DTR => self.set_control_line(false, self.rts_enabled, true),
            IOCTL_SERIAL_SET_RTS => self.set_control_line(self.dtr_enabled, true, false),
            IOCTL_SERIAL_CLR_RTS => self.set_control_line(self.dtr_enabled, false, false),
            IOCTL_SERIAL_PURGE => {
                let Some(purge_mask) = read_optional_u32(input) else {
                    return (STATUS_UNSUCCESSFUL, Vec::new());
                };
                if let Err(error) = self.handle_purge(purge_mask) {
                    log::debug!(
                        "RDPDR serial {}: purge on '{}' failed: {}",
                        self.session_id,
                        self.port_name,
                        error
                    );
                    return (status_from_io_error(&error), Vec::new());
                }
                (STATUS_SUCCESS, device_control_ack())
            }
            IOCTL_SERIAL_GET_HANDFLOW => {
                let mut out = Vec::with_capacity(20);
                out.extend_from_slice(&16u32.to_le_bytes());
                out.extend_from_slice(&self.handflow.encode());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_HANDFLOW => {
                let Some(handflow) = SerialHandflow::from_input(input) else {
                    return (STATUS_UNSUCCESSFUL, Vec::new());
                };
                self.handflow = handflow;
                (STATUS_SUCCESS, device_control_ack())
            }
            IOCTL_SERIAL_GET_PROPERTIES => {
                (STATUS_SUCCESS, self.build_properties_output(output_buffer_length))
            }
            IOCTL_SERIAL_GET_CHARS => {
                let mut out = Vec::with_capacity(10);
                out.extend_from_slice(&6u32.to_le_bytes());
                out.extend_from_slice(&self.chars.encode());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_CHARS => {
                let Some(chars) = SerialChars::from_input(input) else {
                    return (STATUS_UNSUCCESSFUL, Vec::new());
                };
                self.chars = chars;
                (STATUS_SUCCESS, device_control_ack())
            }
            _ => {
                log::debug!("RDPDR serial {}: unhandled IOCTL 0x{:08X}", self.session_id, ioctl_code);
                (STATUS_SUCCESS, device_control_ack())
            }
        }
    }

    #[cfg(feature = "rdp-serial")]
    fn current_settings(&self) -> SerialSettings {
        SerialSettings {
            baud_rate: self.baud_rate,
            line_control: self.line_control,
            timeouts: self.timeouts,
            dtr_enabled: self.dtr_enabled,
            rts_enabled: self.rts_enabled,
        }
    }

    fn close_port(&mut self) {
        #[cfg(feature = "rdp-serial")]
        {
            self.port = None;
        }
        self.open_file_id = None;
    }

    #[cfg(feature = "rdp-serial")]
    fn is_open_file(&self, file_id: u32) -> bool {
        self.open_file_id == Some(file_id)
    }

    fn apply_baud_rate(&mut self) -> io::Result<()> {
        #[cfg(feature = "rdp-serial")]
        {
            return match self.port.as_mut() {
                Some(port) => port.set_baud_rate(self.baud_rate),
                None => Ok(()),
            };
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            Ok(())
        }
    }

    fn apply_line_control(&mut self) -> io::Result<()> {
        #[cfg(feature = "rdp-serial")]
        {
            return match self.port.as_mut() {
                Some(port) => port.set_line_control(self.line_control),
                None => Ok(()),
            };
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            Ok(())
        }
    }

    fn apply_timeouts(&mut self) -> io::Result<()> {
        #[cfg(feature = "rdp-serial")]
        {
            return match self.port.as_mut() {
                Some(port) => port.set_timeout(self.timeouts.effective_timeout()),
                None => Ok(()),
            };
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            Ok(())
        }
    }

    fn set_control_line(&mut self, dtr_enabled: bool, rts_enabled: bool, update_dtr: bool) -> (u32, Vec<u8>) {
        let previous_dtr = self.dtr_enabled;
        let previous_rts = self.rts_enabled;
        self.dtr_enabled = dtr_enabled;
        self.rts_enabled = rts_enabled;

        #[cfg(not(feature = "rdp-serial"))]
        let _ = update_dtr;

        #[cfg(feature = "rdp-serial")]
        let apply_result = match self.port.as_mut() {
            Some(port) if update_dtr => port.set_dtr(self.dtr_enabled),
            Some(port) => port.set_rts(self.rts_enabled),
            None => Ok(()),
        };

        #[cfg(not(feature = "rdp-serial"))]
        let apply_result: io::Result<()> = Ok(());

        match apply_result {
            Ok(()) => (STATUS_SUCCESS, device_control_ack()),
            Err(error) => {
                self.dtr_enabled = previous_dtr;
                self.rts_enabled = previous_rts;
                log::debug!(
                    "RDPDR serial {}: control-line update on '{}' failed: {}",
                    self.session_id,
                    self.port_name,
                    error
                );
                (status_from_io_error(&error), Vec::new())
            }
        }
    }

    fn handle_purge(&mut self, purge_mask: u32) -> io::Result<()> {
        #[cfg(feature = "rdp-serial")]
        {
            return match self.port.as_mut() {
                Some(port) => {
                    if purge_mask & (SERIAL_PURGE_RXABORT | SERIAL_PURGE_RXCLEAR) != 0 {
                        port.clear_input()?;
                    }
                    if purge_mask & (SERIAL_PURGE_TXABORT | SERIAL_PURGE_TXCLEAR) != 0 {
                        port.clear_output()?;
                    }
                    Ok(())
                }
                None => Ok(()),
            };
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            let _ = purge_mask;
            Ok(())
        }
    }

    fn comm_status_counts(&self) -> (u32, u32) {
        #[cfg(feature = "rdp-serial")]
        {
            return match self.port.as_ref() {
                Some(port) => (
                    port.bytes_to_read().unwrap_or(0),
                    port.bytes_to_write().unwrap_or(0),
                ),
                None => (0, 0),
            };
        }

        #[cfg(not(feature = "rdp-serial"))]
        {
            (0, 0)
        }
    }

    fn build_properties_output(&self, output_buffer_length: u32) -> Vec<u8> {
        let mut payload = [0u8; SERIAL_COMMPROP_SIZE];

        payload[0..2].copy_from_slice(&(SERIAL_COMMPROP_SIZE as u16).to_le_bytes());
        payload[2..4].copy_from_slice(&2u16.to_le_bytes());
        payload[4..8].copy_from_slice(&SERIAL_SP_SERIALCOMM.to_le_bytes());
        payload[20..24].copy_from_slice(&self.baud_rate.max(115_200).to_le_bytes());
        payload[24..28].copy_from_slice(&SERIAL_SP_RS232.to_le_bytes());
        payload[28..32].copy_from_slice(
            &(
                SERIAL_PCF_DTRDSR
                    | SERIAL_PCF_RTSCTS
                    | SERIAL_PCF_PARITY_CHECK
                    | SERIAL_PCF_XONXOFF
                    | SERIAL_PCF_TOTALTIMEOUTS
                    | SERIAL_PCF_INTTIMEOUTS
                    | SERIAL_PCF_SPECIALCHARS
            )
            .to_le_bytes(),
        );
        payload[32..36].copy_from_slice(
            &(SERIAL_SP_PARITY
                | SERIAL_SP_BAUD
                | SERIAL_SP_DATABITS
                | SERIAL_SP_STOPBITS
                | SERIAL_SP_HANDSHAKING)
                .to_le_bytes(),
        );
        payload[40..42].copy_from_slice(
            &(SERIAL_DATABITS_5 | SERIAL_DATABITS_6 | SERIAL_DATABITS_7 | SERIAL_DATABITS_8)
                .to_le_bytes(),
        );
        payload[42..44].copy_from_slice(
            &(SERIAL_STOPPARITY_10
                | SERIAL_STOPPARITY_15
                | SERIAL_STOPPARITY_20
                | SERIAL_PARITY_CAP_NONE
                | SERIAL_PARITY_CAP_ODD
                | SERIAL_PARITY_CAP_EVEN)
                .to_le_bytes(),
        );

        let returned_len = output_buffer_length.min(SERIAL_COMMPROP_SIZE as u32) as usize;
        let mut out = Vec::with_capacity(4 + returned_len);
        out.extend_from_slice(&(returned_len as u32).to_le_bytes());
        out.extend_from_slice(&payload[..returned_len]);
        out
    }
}

fn create_response(file_id: u32, information: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(5);
    out.extend_from_slice(&file_id.to_le_bytes());
    out.push(information);
    out
}

fn write_response(length: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(5);
    out.extend_from_slice(&length.to_le_bytes());
    out.push(0);
    out
}

fn device_control_ack() -> Vec<u8> {
    0u32.to_le_bytes().to_vec()
}

fn device_control_input(data: &[u8], input_buffer_length: usize) -> &[u8] {
    if data.len() <= DEVICE_CONTROL_DATA_OFFSET {
        return &[];
    }

    let available = data.len() - DEVICE_CONTROL_DATA_OFFSET;
    let input_len = available.min(input_buffer_length);
    &data[DEVICE_CONTROL_DATA_OFFSET..DEVICE_CONTROL_DATA_OFFSET + input_len]
}

fn read_optional_u32(data: &[u8]) -> Option<u32> {
    if data.len() < 4 {
        None
    } else {
        Some(read_u32(data, 0))
    }
}

fn status_from_io_error(error: &io::Error) -> u32 {
    match error.kind() {
        io::ErrorKind::NotFound => STATUS_OBJECT_NAME_NOT_FOUND,
        io::ErrorKind::PermissionDenied => STATUS_ACCESS_DENIED,
        _ => STATUS_UNSUCCESSFUL,
    }
}

#[cfg(feature = "rdp-serial")]
fn serialport_error(error: serialport::Error) -> io::Error {
    io::Error::new(io::ErrorKind::Other, error.to_string())
}

#[cfg(feature = "rdp-serial")]
fn serial_data_bits(word_length: u8) -> serialport::DataBits {
    match word_length {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    }
}

#[cfg(feature = "rdp-serial")]
fn serial_parity(parity: u8) -> serialport::Parity {
    match parity {
        SERIAL_PARITY_ODD => serialport::Parity::Odd,
        SERIAL_PARITY_EVEN => serialport::Parity::Even,
        _ => serialport::Parity::None,
    }
}

#[cfg(feature = "rdp-serial")]
fn serial_stop_bits(stop_bits: u8) -> serialport::StopBits {
    match stop_bits {
        SERIAL_STOP_BITS_2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "rdp-serial")]
    use std::collections::VecDeque;
    #[cfg(feature = "rdp-serial")]
    use std::io;
    #[cfg(feature = "rdp-serial")]
    use std::sync::{Arc, Mutex};

    use super::*;

    fn unwrap_completion(resp: Option<Vec<u8>>) -> (u32, Vec<u8>) {
        let buf = resp.expect("expected completion");
        assert!(buf.len() >= 16);
        let io_status = u32::from_le_bytes(buf[12..16].try_into().unwrap());
        let output = buf[16..].to_vec();
        (io_status, output)
    }

    #[cfg(feature = "rdp-serial")]
    fn build_device_control(ioctl_code: u32, output_buffer_length: u32, input: &[u8]) -> Vec<u8> {
        let mut data = vec![0u8; DEVICE_CONTROL_DATA_OFFSET];
        data[0..4].copy_from_slice(&output_buffer_length.to_le_bytes());
        data[4..8].copy_from_slice(&(input.len() as u32).to_le_bytes());
        data[8..12].copy_from_slice(&ioctl_code.to_le_bytes());
        data.extend_from_slice(input);
        data
    }

    fn build_write_irp(payload: &[u8]) -> Vec<u8> {
        let mut data = vec![0u8; WRITE_DATA_OFFSET];
        data[0..4].copy_from_slice(&(payload.len() as u32).to_le_bytes());
        data.extend_from_slice(payload);
        data
    }

    fn build_read_irp(length: u32) -> Vec<u8> {
        let mut data = vec![0u8; 12];
        data[0..4].copy_from_slice(&length.to_le_bytes());
        data
    }

    #[cfg(feature = "rdp-serial")]
    #[derive(Clone, Debug)]
    enum MockReadAction {
        Data(Vec<u8>),
        TimedOut,
        Error(io::ErrorKind),
    }

    #[cfg(feature = "rdp-serial")]
    #[derive(Debug)]
    struct MockPortState {
        open_calls: usize,
        close_calls: usize,
        last_port_name: Option<String>,
        last_open_settings: Option<SerialSettings>,
        written: Vec<u8>,
        read_actions: VecDeque<MockReadAction>,
        line_control: LineControl,
        baud_rate: u32,
        timeout: Duration,
        dtr_enabled: bool,
        rts_enabled: bool,
        bytes_to_read: u32,
        bytes_to_write: u32,
        clear_input_calls: usize,
        clear_output_calls: usize,
    }

    #[cfg(feature = "rdp-serial")]
    impl Default for MockPortState {
        fn default() -> Self {
            Self {
                open_calls: 0,
                close_calls: 0,
                last_port_name: None,
                last_open_settings: None,
                written: Vec::new(),
                read_actions: VecDeque::new(),
                line_control: LineControl::default(),
                baud_rate: 9600,
                timeout: Duration::from_millis(MIN_EFFECTIVE_TIMEOUT_MS),
                dtr_enabled: false,
                rts_enabled: false,
                bytes_to_read: 0,
                bytes_to_write: 0,
                clear_input_calls: 0,
                clear_output_calls: 0,
            }
        }
    }

    #[cfg(feature = "rdp-serial")]
    struct MockPortFactory {
        state: Arc<Mutex<MockPortState>>,
    }

    #[cfg(feature = "rdp-serial")]
    impl SerialPortFactory for MockPortFactory {
        fn open(&self, port_name: &str, settings: &SerialSettings) -> io::Result<Box<dyn SerialPortHandle>> {
            let mut state = self.state.lock().unwrap();
            state.open_calls += 1;
            state.last_port_name = Some(port_name.to_string());
            state.last_open_settings = Some(*settings);
            state.baud_rate = settings.baud_rate;
            state.line_control = settings.line_control;
            state.timeout = settings.timeouts.effective_timeout();
            state.dtr_enabled = settings.dtr_enabled;
            state.rts_enabled = settings.rts_enabled;
            drop(state);

            Ok(Box::new(MockPortHandle {
                state: Arc::clone(&self.state),
            }))
        }
    }

    #[cfg(feature = "rdp-serial")]
    struct MockPortHandle {
        state: Arc<Mutex<MockPortState>>,
    }

    #[cfg(feature = "rdp-serial")]
    impl Drop for MockPortHandle {
        fn drop(&mut self) {
            self.state.lock().unwrap().close_calls += 1;
        }
    }

    #[cfg(feature = "rdp-serial")]
    impl SerialPortHandle for MockPortHandle {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let action = self
                .state
                .lock()
                .unwrap()
                .read_actions
                .pop_front()
                .unwrap_or(MockReadAction::TimedOut);

            match action {
                MockReadAction::Data(data) => {
                    let count = data.len().min(buf.len());
                    buf[..count].copy_from_slice(&data[..count]);
                    Ok(count)
                }
                MockReadAction::TimedOut => Err(io::Error::new(io::ErrorKind::TimedOut, "mock timeout")),
                MockReadAction::Error(kind) => Err(io::Error::new(kind, "mock read error")),
            }
        }

        fn write_all(&mut self, buf: &[u8]) -> io::Result<()> {
            let mut state = self.state.lock().unwrap();
            state.written.extend_from_slice(buf);
            state.bytes_to_write = 0;
            Ok(())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }

        fn set_baud_rate(&mut self, baud_rate: u32) -> io::Result<()> {
            self.state.lock().unwrap().baud_rate = baud_rate;
            Ok(())
        }

        fn set_line_control(&mut self, line_control: LineControl) -> io::Result<()> {
            self.state.lock().unwrap().line_control = line_control;
            Ok(())
        }

        fn set_timeout(&mut self, timeout: Duration) -> io::Result<()> {
            self.state.lock().unwrap().timeout = timeout;
            Ok(())
        }

        fn set_dtr(&mut self, enabled: bool) -> io::Result<()> {
            self.state.lock().unwrap().dtr_enabled = enabled;
            Ok(())
        }

        fn set_rts(&mut self, enabled: bool) -> io::Result<()> {
            self.state.lock().unwrap().rts_enabled = enabled;
            Ok(())
        }

        fn bytes_to_read(&self) -> io::Result<u32> {
            Ok(self.state.lock().unwrap().bytes_to_read)
        }

        fn bytes_to_write(&self) -> io::Result<u32> {
            Ok(self.state.lock().unwrap().bytes_to_write)
        }

        fn clear_input(&mut self) -> io::Result<()> {
            self.state.lock().unwrap().clear_input_calls += 1;
            Ok(())
        }

        fn clear_output(&mut self) -> io::Result<()> {
            self.state.lock().unwrap().clear_output_calls += 1;
            Ok(())
        }
    }

    #[cfg(feature = "rdp-serial")]
    fn dev_with_mock() -> (SerialDevice, Arc<Mutex<MockPortState>>) {
        let state = Arc::new(Mutex::new(MockPortState::default()));
        let device = SerialDevice::new_with_factory(
            1,
            "COM9",
            "test-session".into(),
            Box::new(MockPortFactory {
                state: Arc::clone(&state),
            }),
        );
        (device, state)
    }

    #[cfg(not(feature = "rdp-serial"))]
    fn dev() -> SerialDevice {
        SerialDevice::new(1, "COM1", "test-session".into())
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_irp_create_opens_and_close_drops_mock_port() {
        let (mut device, state) = dev_with_mock();

        let (status, out) = unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 1, 0, &[]));
        assert_eq!(status, STATUS_SUCCESS);
        let file_id = read_u32(&out, 0);
        assert_eq!(file_id, 1);

        {
            let state = state.lock().unwrap();
            assert_eq!(state.open_calls, 1);
            assert_eq!(state.last_port_name.as_deref(), Some("COM9"));
        }

        let (status, _) = unwrap_completion(device.handle_irp(IRP_MJ_CLOSE, 0, 2, file_id, &[]));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(state.lock().unwrap().close_calls, 1);
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_irp_write_forwards_payload_to_mock_port() {
        let (mut device, state) = dev_with_mock();
        let (_, out) = unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 3, 0, &[]));
        let file_id = read_u32(&out, 0);
        let payload = b"hello serial";

        let (status, out) = unwrap_completion(
            device.handle_irp(IRP_MJ_WRITE, 0, 4, file_id, &build_write_irp(payload)),
        );
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 0), payload.len() as u32);
        assert_eq!(state.lock().unwrap().written, payload);
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_irp_read_returns_mock_bytes() {
        let (mut device, state) = dev_with_mock();
        let (_, out) = unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 5, 0, &[]));
        let file_id = read_u32(&out, 0);

        {
            let mut state = state.lock().unwrap();
            state.read_actions.push_back(MockReadAction::Data(vec![1, 2, 3, 4]));
        }

        let (status, out) = unwrap_completion(
            device.handle_irp(IRP_MJ_READ, 0, 6, file_id, &build_read_irp(16)),
        );
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 0), 4);
        assert_eq!(&out[4..8], &[1, 2, 3, 4]);
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_irp_read_timeout_returns_empty_success() {
        let (mut device, state) = dev_with_mock();
        let (_, out) = unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 7, 0, &[]));
        let file_id = read_u32(&out, 0);

        state
            .lock()
            .unwrap()
            .read_actions
            .push_back(MockReadAction::TimedOut);

        let (status, out) = unwrap_completion(
            device.handle_irp(IRP_MJ_READ, 0, 8, file_id, &build_read_irp(32)),
        );
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 0), 0);
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_irp_read_error_returns_unsuccessful() {
        let (mut device, state) = dev_with_mock();
        let (_, out) = unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 31, 0, &[]));
        let file_id = read_u32(&out, 0);

        state
            .lock()
            .unwrap()
            .read_actions
            .push_back(MockReadAction::Error(io::ErrorKind::BrokenPipe));

        let (status, out) = unwrap_completion(
            device.handle_irp(IRP_MJ_READ, 0, 32, file_id, &build_read_irp(8)),
        );
        assert_eq!(status, STATUS_UNSUCCESSFUL);
        assert!(out.is_empty());
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_ioctl_set_get_baud_and_line_control_updates_state() {
        let (mut device, state) = dev_with_mock();
        unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 9, 0, &[]));

        let (status, _) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            10,
            0,
            &build_device_control(IOCTL_SERIAL_SET_BAUD_RATE, 0, &115_200u32.to_le_bytes()),
        ));
        assert_eq!(status, STATUS_SUCCESS);

        let (status, _) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            11,
            0,
            &build_device_control(IOCTL_SERIAL_SET_LINE_CONTROL, 0, &[SERIAL_STOP_BITS_2, SERIAL_PARITY_EVEN, 7]),
        ));
        assert_eq!(status, STATUS_SUCCESS);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            12,
            0,
            &build_device_control(IOCTL_SERIAL_GET_BAUD_RATE, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 4), 115_200);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            13,
            0,
            &build_device_control(IOCTL_SERIAL_GET_LINE_CONTROL, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(&out[4..7], &[SERIAL_STOP_BITS_2, SERIAL_PARITY_EVEN, 7]);

        let state = state.lock().unwrap();
        assert_eq!(state.baud_rate, 115_200);
        assert_eq!(state.line_control, LineControl {
            stop_bits: SERIAL_STOP_BITS_2,
            parity: SERIAL_PARITY_EVEN,
            word_length: 7,
        });
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_ioctl_set_get_timeouts_and_control_lines() {
        let (mut device, state) = dev_with_mock();
        unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 14, 0, &[]));

        let mut timeout_input = Vec::new();
        timeout_input.extend_from_slice(&5u32.to_le_bytes());
        timeout_input.extend_from_slice(&10u32.to_le_bytes());
        timeout_input.extend_from_slice(&25u32.to_le_bytes());
        timeout_input.extend_from_slice(&0u32.to_le_bytes());
        timeout_input.extend_from_slice(&50u32.to_le_bytes());

        let (status, _) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            15,
            0,
            &build_device_control(IOCTL_SERIAL_SET_TIMEOUTS, 0, &timeout_input),
        ));
        assert_eq!(status, STATUS_SUCCESS);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            16,
            0,
            &build_device_control(IOCTL_SERIAL_GET_TIMEOUTS, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 4), 5);
        assert_eq!(read_u32(&out, 8), 10);
        assert_eq!(read_u32(&out, 12), 25);
        assert_eq!(read_u32(&out, 20), 50);

        let (status, _) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            17,
            0,
            &build_device_control(IOCTL_SERIAL_SET_DTR, 0, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        let (status, _) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            18,
            0,
            &build_device_control(IOCTL_SERIAL_SET_RTS, 0, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);

        let state = state.lock().unwrap();
        assert_eq!(state.timeout, Duration::from_millis(50));
        assert!(state.dtr_enabled);
        assert!(state.rts_enabled);
    }

    #[cfg(feature = "rdp-serial")]
    #[test]
    fn serial_ioctl_misc_queries_are_sensible() {
        let (mut device, state) = dev_with_mock();
        unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 19, 0, &[]));

        {
            let mut state = state.lock().unwrap();
            state.bytes_to_read = 7;
            state.bytes_to_write = 3;
        }

        let (status, _) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            20,
            0,
            &build_device_control(IOCTL_SERIAL_SET_WAIT_MASK, 0, &0x1Fu32.to_le_bytes()),
        ));
        assert_eq!(status, STATUS_SUCCESS);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            21,
            0,
            &build_device_control(IOCTL_SERIAL_GET_WAIT_MASK, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 4), 0x1F);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            22,
            0,
            &build_device_control(IOCTL_SERIAL_GET_COMMSTATUS, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 12), 7);
        assert_eq!(read_u32(&out, 16), 3);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            23,
            0,
            &build_device_control(IOCTL_SERIAL_GET_PROPERTIES, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 0), 64);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            24,
            0,
            &build_device_control(IOCTL_SERIAL_GET_HANDFLOW, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 0), 16);

        let (status, out) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            25,
            0,
            &build_device_control(IOCTL_SERIAL_GET_CHARS, 64, &[]),
        ));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(&out[4..10], &[0, 0, 0, 0, 0x11, 0x13]);

        let (status, _) = unwrap_completion(device.handle_irp(
            IRP_MJ_DEVICE_CONTROL,
            0,
            26,
            0,
            &build_device_control(IOCTL_SERIAL_PURGE, 0, &(SERIAL_PURGE_RXCLEAR | SERIAL_PURGE_TXCLEAR).to_le_bytes()),
        ));
        assert_eq!(status, STATUS_SUCCESS);

        let state = state.lock().unwrap();
        assert_eq!(state.clear_input_calls, 1);
        assert_eq!(state.clear_output_calls, 1);
    }

    #[cfg(not(feature = "rdp-serial"))]
    #[test]
    fn serial_feature_off_path_stays_graceful() {
        let mut device = dev();

        let (status, out) = unwrap_completion(device.handle_irp(IRP_MJ_CREATE, 0, 27, 0, &[]));
        assert_eq!(status, STATUS_SUCCESS);
        let file_id = read_u32(&out, 0);

        let (status, out) = unwrap_completion(
            device.handle_irp(IRP_MJ_READ, 0, 28, file_id, &build_read_irp(32)),
        );
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 0), 0);

        let payload = b"discarded";
        let (status, out) = unwrap_completion(
            device.handle_irp(IRP_MJ_WRITE, 0, 29, file_id, &build_write_irp(payload)),
        );
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(read_u32(&out, 0), payload.len() as u32);
    }

    #[test]
    fn serial_ioctl_short_data_returns_not_supported() {
        #[cfg(feature = "rdp-serial")]
        let (mut device, _) = dev_with_mock();
        #[cfg(not(feature = "rdp-serial"))]
        let mut device = dev();

        let (status, _) = unwrap_completion(device.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 30, 0, &[0u8; 4]));
        assert_eq!(status, STATUS_NOT_SUPPORTED);
    }
}
