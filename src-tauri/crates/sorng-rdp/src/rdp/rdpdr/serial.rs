//! Serial/COM port device handler for RDPDR serial redirection.
//!
//! Redirects local serial ports to the remote RDP session. The server
//! sends IOCTL_SERIAL_* codes for configuration and IRP_MJ_READ/WRITE
//! for data flow.
//!
//! NOTE: This is a stub implementation. Full serial port support requires
//! the `serialport` crate and platform-specific IOCTL translation.

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

/// A redirected serial port device.
pub struct SerialDevice {
    pub device_id: u32,
    port_name: String,
    session_id: String,
    baud_rate: u32,
    wait_mask: u32,
}

impl SerialDevice {
    pub fn new(device_id: u32, port_name: &str, session_id: String) -> Self {
        Self {
            device_id,
            port_name: port_name.to_string(),
            session_id,
            baud_rate: 9600,
            wait_mask: 0,
        }
    }

    /// Handle an IRP for this serial device.
    pub fn handle_irp(&mut self, major: u32, _minor: u32, completion_id: u32, _file_id: u32, data: &[u8]) -> Option<Vec<u8>> {
        let (status, output) = match major {
            IRP_MJ_CREATE => {
                log::info!("RDPDR serial {}: open port '{}'", self.session_id, self.port_name);
                let mut out = Vec::with_capacity(5);
                out.extend_from_slice(&0u32.to_le_bytes()); // FileId
                out.push(1); // FILE_OPENED
                (STATUS_SUCCESS, out)
            }
            IRP_MJ_CLOSE => {
                log::info!("RDPDR serial {}: close port '{}'", self.session_id, self.port_name);
                (STATUS_SUCCESS, vec![0u8; 5])
            }
            IRP_MJ_READ => {
                // Return empty read (no data available)
                let mut out = Vec::with_capacity(4);
                out.extend_from_slice(&0u32.to_le_bytes()); // Length = 0
                (STATUS_SUCCESS, out)
            }
            IRP_MJ_WRITE => {
                let length = if data.len() >= 4 { read_u32(data, 0) as usize } else { 0 };
                log::debug!("RDPDR serial {}: write {} bytes to '{}'", self.session_id, length, self.port_name);
                // Serial port write is acknowledged but data is discarded.
                // Full serial I/O requires the `serialport` crate as an optional
                // dependency — not currently enabled so we accept the data to keep
                // the RDP session happy and log the discard.
                if length > 0 {
                    log::warn!(
                        "RDPDR serial {}: discarding {} bytes for '{}' (serialport crate not linked)",
                        self.session_id, length, self.port_name
                    );
                }
                let mut out = Vec::with_capacity(5);
                out.extend_from_slice(&(length as u32).to_le_bytes());
                out.push(0);
                (STATUS_SUCCESS, out)
            }
            IRP_MJ_DEVICE_CONTROL => {
                self.handle_ioctl(data)
            }
            _ => {
                log::debug!("RDPDR serial {}: unsupported IRP major=0x{:X}", self.session_id, major);
                (STATUS_NOT_SUPPORTED, Vec::new())
            }
        };
        Some(build_io_completion(self.device_id, completion_id, status, &output))
    }

    fn handle_ioctl(&mut self, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 12 {
            return (STATUS_NOT_SUPPORTED, Vec::new());
        }
        let output_buffer_length = read_u32(data, 0);
        let _input_buffer_length = read_u32(data, 4);
        let ioctl_code = read_u32(data, 8);

        log::debug!("RDPDR serial {}: IOCTL 0x{:08X}", self.session_id, ioctl_code);

        match ioctl_code {
            IOCTL_SERIAL_GET_BAUD_RATE => {
                let mut out = Vec::with_capacity(8);
                out.extend_from_slice(&4u32.to_le_bytes()); // OutputBufferLength
                out.extend_from_slice(&self.baud_rate.to_le_bytes());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_BAUD_RATE => {
                if data.len() >= 36 {
                    self.baud_rate = read_u32(data, 32);
                    log::info!("RDPDR serial {}: set baud rate to {}", self.session_id, self.baud_rate);
                }
                (STATUS_SUCCESS, vec![0u8; 4]) // OutputBufferLength = 0
            }
            IOCTL_SERIAL_GET_LINE_CONTROL => {
                let mut out = Vec::with_capacity(7);
                out.extend_from_slice(&3u32.to_le_bytes()); // OutputBufferLength
                out.push(0); // StopBits = 1
                out.push(0); // Parity = NONE
                out.push(8); // WordLength = 8
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_SET_LINE_CONTROL | IOCTL_SERIAL_SET_TIMEOUTS
            | IOCTL_SERIAL_SET_DTR | IOCTL_SERIAL_CLR_DTR
            | IOCTL_SERIAL_SET_RTS | IOCTL_SERIAL_CLR_RTS
            | IOCTL_SERIAL_PURGE | IOCTL_SERIAL_SET_HANDFLOW
            | IOCTL_SERIAL_SET_CHARS | IOCTL_SERIAL_SET_WAIT_MASK => {
                if ioctl_code == IOCTL_SERIAL_SET_WAIT_MASK && data.len() >= 36 {
                    self.wait_mask = read_u32(data, 32);
                }
                (STATUS_SUCCESS, vec![0u8; 4])
            }
            IOCTL_SERIAL_GET_TIMEOUTS => {
                // Return default timeouts (all zeros = no timeout)
                let mut out = Vec::with_capacity(24);
                out.extend_from_slice(&20u32.to_le_bytes()); // OutputBufferLength
                out.extend_from_slice(&[0u8; 20]); // SERIAL_TIMEOUTS (5 x u32)
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_GET_WAIT_MASK => {
                let mut out = Vec::with_capacity(8);
                out.extend_from_slice(&4u32.to_le_bytes());
                out.extend_from_slice(&self.wait_mask.to_le_bytes());
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_GET_COMMSTATUS => {
                // SERIAL_STATUS: all zeros (no errors, no data pending)
                let mut out = Vec::with_capacity(4 + 20);
                out.extend_from_slice(&20u32.to_le_bytes()); // OutputBufferLength = 20 (SERIAL_STATUS size)
                out.extend_from_slice(&[0u8; 20]);
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_GET_PROPERTIES => {
                // SERIAL_COMMPROP: return sensible defaults
                let buf_len = output_buffer_length.min(64) as usize;
                let mut out = Vec::with_capacity(4 + buf_len);
                out.extend_from_slice(&(buf_len as u32).to_le_bytes());
                out.resize(4 + buf_len, 0); // zero-filled
                // Set some key fields
                if buf_len >= 8 {
                    // MaxBaud at offset 4
                    out[8..12].copy_from_slice(&115200u32.to_le_bytes());
                }
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_GET_HANDFLOW => {
                let mut out = Vec::with_capacity(20);
                out.extend_from_slice(&16u32.to_le_bytes()); // OutputBufferLength
                out.extend_from_slice(&[0u8; 16]); // SERIAL_HANDFLOW (4 x u32)
                (STATUS_SUCCESS, out)
            }
            IOCTL_SERIAL_GET_CHARS => {
                let mut out = Vec::with_capacity(10);
                out.extend_from_slice(&6u32.to_le_bytes()); // OutputBufferLength
                out.extend_from_slice(&[0u8; 6]); // SERIAL_CHARS
                (STATUS_SUCCESS, out)
            }
            _ => {
                log::debug!("RDPDR serial {}: unhandled IOCTL 0x{:08X}", self.session_id, ioctl_code);
                (STATUS_SUCCESS, vec![0u8; 4]) // Return success with empty output
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev() -> SerialDevice {
        SerialDevice::new(1, "COM1", "test-session".into())
    }

    fn unwrap_completion(resp: Option<Vec<u8>>) -> (u32, Vec<u8>) {
        let buf = resp.expect("expected completion");
        // skip RDPDR header (4 bytes) + device_id(4) + completion_id(4) + io_status(4) = 16 bytes header
        assert!(buf.len() >= 16);
        let io_status = u32::from_le_bytes(buf[12..16].try_into().unwrap());
        let output = buf[16..].to_vec();
        (io_status, output)
    }

    #[test]
    fn irp_create_returns_success() {
        let mut d = dev();
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_CREATE, 0, 1, 0, &[]));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(out.len(), 5); // FileId(4) + Information(1)
    }

    #[test]
    fn irp_close_returns_success() {
        let mut d = dev();
        let (status, _) = unwrap_completion(d.handle_irp(IRP_MJ_CLOSE, 0, 2, 0, &[]));
        assert_eq!(status, STATUS_SUCCESS);
    }

    #[test]
    fn irp_read_returns_empty() {
        let mut d = dev();
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_READ, 0, 3, 0, &[]));
        assert_eq!(status, STATUS_SUCCESS);
        let length = u32::from_le_bytes(out[0..4].try_into().unwrap());
        assert_eq!(length, 0);
    }

    #[test]
    fn irp_write_acknowledges_length() {
        let mut d = dev();
        let mut data = Vec::new();
        data.extend_from_slice(&42u32.to_le_bytes()); // Length = 42
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_WRITE, 0, 4, 0, &data));
        assert_eq!(status, STATUS_SUCCESS);
        let echoed = u32::from_le_bytes(out[0..4].try_into().unwrap());
        assert_eq!(echoed, 42);
    }

    #[test]
    fn irp_write_zero_length() {
        let mut d = dev();
        let data = 0u32.to_le_bytes();
        let (status, _) = unwrap_completion(d.handle_irp(IRP_MJ_WRITE, 0, 5, 0, &data));
        assert_eq!(status, STATUS_SUCCESS);
    }

    #[test]
    fn unsupported_irp_returns_not_supported() {
        let mut d = dev();
        let (status, _) = unwrap_completion(d.handle_irp(0xFF, 0, 6, 0, &[]));
        assert_eq!(status, STATUS_NOT_SUPPORTED);
    }

    #[test]
    fn ioctl_get_baud_rate() {
        let mut d = dev();
        // Build IOCTL data: output_buffer_len(4) + input_buffer_len(4) + ioctl_code(4)
        let mut data = Vec::new();
        data.extend_from_slice(&64u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&IOCTL_SERIAL_GET_BAUD_RATE.to_le_bytes());
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 7, 0, &data));
        assert_eq!(status, STATUS_SUCCESS);
        // OutputBufferLength(4) + baud_rate(4)
        assert!(out.len() >= 8);
        let baud = u32::from_le_bytes(out[4..8].try_into().unwrap());
        assert_eq!(baud, 9600); // default
    }

    #[test]
    fn ioctl_set_then_get_baud_rate() {
        let mut d = dev();
        // SET baud to 115200
        let mut set_data = vec![0u8; 36];
        set_data[8..12].copy_from_slice(&IOCTL_SERIAL_SET_BAUD_RATE.to_le_bytes());
        set_data[32..36].copy_from_slice(&115200u32.to_le_bytes());
        d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 8, 0, &set_data);

        // GET baud
        let mut get_data = Vec::new();
        get_data.extend_from_slice(&64u32.to_le_bytes());
        get_data.extend_from_slice(&0u32.to_le_bytes());
        get_data.extend_from_slice(&IOCTL_SERIAL_GET_BAUD_RATE.to_le_bytes());
        let (_, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 9, 0, &get_data));
        let baud = u32::from_le_bytes(out[4..8].try_into().unwrap());
        assert_eq!(baud, 115200);
    }

    #[test]
    fn ioctl_get_line_control() {
        let mut d = dev();
        let mut data = Vec::new();
        data.extend_from_slice(&64u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&IOCTL_SERIAL_GET_LINE_CONTROL.to_le_bytes());
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 10, 0, &data));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(out[6], 8); // WordLength = 8
    }

    #[test]
    fn ioctl_set_get_wait_mask() {
        let mut d = dev();
        // SET wait mask
        let mut set_data = vec![0u8; 36];
        set_data[8..12].copy_from_slice(&IOCTL_SERIAL_SET_WAIT_MASK.to_le_bytes());
        set_data[32..36].copy_from_slice(&0x1Fu32.to_le_bytes());
        d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 11, 0, &set_data);

        // GET wait mask
        let mut get_data = Vec::new();
        get_data.extend_from_slice(&64u32.to_le_bytes());
        get_data.extend_from_slice(&0u32.to_le_bytes());
        get_data.extend_from_slice(&IOCTL_SERIAL_GET_WAIT_MASK.to_le_bytes());
        let (_, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 12, 0, &get_data));
        let mask = u32::from_le_bytes(out[4..8].try_into().unwrap());
        assert_eq!(mask, 0x1F);
    }

    #[test]
    fn ioctl_get_commstatus_zeros() {
        let mut d = dev();
        let mut data = Vec::new();
        data.extend_from_slice(&64u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&IOCTL_SERIAL_GET_COMMSTATUS.to_le_bytes());
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 13, 0, &data));
        assert_eq!(status, STATUS_SUCCESS);
        let buf_len = u32::from_le_bytes(out[0..4].try_into().unwrap());
        assert_eq!(buf_len, 20);
    }

    #[test]
    fn ioctl_short_data_returns_not_supported() {
        let mut d = dev();
        let (status, _) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 14, 0, &[0u8; 4]));
        assert_eq!(status, STATUS_NOT_SUPPORTED);
    }
}
