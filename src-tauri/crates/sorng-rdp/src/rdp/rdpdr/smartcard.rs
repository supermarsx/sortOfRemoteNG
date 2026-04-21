//! Smart card device handler for RDPDR smart card redirection (MS-RDPESC).
//!
//! Proxies SCARD API calls between the remote server and the local PC/SC stack.
//! All communication uses IRP_MJ_DEVICE_CONTROL with SCARD_IOCTL codes.

use super::pdu::*;

// SCARD IOCTL codes (MS-RDPESC 2.2.2.19)
const SCARD_IOCTL_ESTABLISH_CONTEXT: u32 = 0x0009_0014;
const SCARD_IOCTL_RELEASE_CONTEXT: u32 = 0x0009_0018;
const SCARD_IOCTL_IS_VALID_CONTEXT: u32 = 0x0009_001C;
const SCARD_IOCTL_LIST_READERS_A: u32 = 0x0009_0028;
const SCARD_IOCTL_LIST_READERS_W: u32 = 0x0009_002C;
#[allow(dead_code)]
const SCARD_IOCTL_CONNECT_A: u32 = 0x0009_00AC;
const SCARD_IOCTL_CONNECT_W: u32 = 0x0009_00B0;
const SCARD_IOCTL_DISCONNECT: u32 = 0x0009_00B4;
const SCARD_IOCTL_GET_STATUS_CHANGE_A: u32 = 0x0009_00A0;
const SCARD_IOCTL_GET_STATUS_CHANGE_W: u32 = 0x0009_00A4;
const SCARD_IOCTL_BEGIN_TRANSACTION: u32 = 0x0009_00BC;
const SCARD_IOCTL_END_TRANSACTION: u32 = 0x0009_00C0;
const SCARD_IOCTL_TRANSMIT: u32 = 0x0009_00C4;
const SCARD_IOCTL_STATUS_A: u32 = 0x0009_00C8;
const SCARD_IOCTL_STATUS_W: u32 = 0x0009_00CC;
const SCARD_IOCTL_CANCEL: u32 = 0x0009_00D8;
const SCARD_IOCTL_ACCESS_STARTED_EVENT: u32 = 0x0009_00E0;

/// SCARD return codes
const SCARD_S_SUCCESS: u32 = 0x0000_0000;
const SCARD_E_NO_SERVICE: u32 = 0x8010_001D;

/// Smart card device that proxies SCARD API calls.
pub struct SmartCardDevice {
    pub device_id: u32,
    session_id: String,
}

impl SmartCardDevice {
    pub fn new(device_id: u32, session_id: String) -> Self {
        Self { device_id, session_id }
    }

    /// Handle an IRP for the smart card device.
    pub fn handle_irp(&mut self, major: u32, _minor: u32, completion_id: u32, _file_id: u32, data: &[u8]) -> Option<Vec<u8>> {
        match major {
            IRP_MJ_CREATE => {
                // Open the smart card device
                let mut out = Vec::with_capacity(5);
                out.extend_from_slice(&0u32.to_le_bytes()); // FileId = 0
                out.push(1); // FILE_OPENED
                Some(build_io_completion(self.device_id, completion_id, STATUS_SUCCESS, &out))
            }
            IRP_MJ_CLOSE => {
                Some(build_io_completion(self.device_id, completion_id, STATUS_SUCCESS, &[0u8; 5]))
            }
            IRP_MJ_DEVICE_CONTROL => {
                let response = self.handle_ioctl(data);
                Some(build_io_completion(self.device_id, completion_id, STATUS_SUCCESS, &response))
            }
            _ => {
                Some(build_io_completion(self.device_id, completion_id, STATUS_NOT_SUPPORTED, &[]))
            }
        }
    }

    fn handle_ioctl(&mut self, data: &[u8]) -> Vec<u8> {
        if data.len() < 12 {
            return self.ioctl_error_response(SCARD_E_NO_SERVICE);
        }

        let _output_buffer_length = read_u32(data, 0);
        let _input_buffer_length = read_u32(data, 4);
        let ioctl_code = read_u32(data, 8);

        log::info!("RDPDR smartcard {}: IOCTL 0x{:08X}", self.session_id, ioctl_code);

        // For now, delegate to the local PC/SC stack on Windows
        #[cfg(target_os = "windows")]
        {
            self.handle_ioctl_windows(ioctl_code, data)
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Non-Windows: return "no service" for all IOCTLs
            log::debug!("RDPDR smartcard {}: PC/SC not available on this platform", self.session_id);
            self.ioctl_error_response(SCARD_E_NO_SERVICE)
        }
    }

    #[cfg(target_os = "windows")]
    fn handle_ioctl_windows(&mut self, ioctl_code: u32, _data: &[u8]) -> Vec<u8> {
        match ioctl_code {
            SCARD_IOCTL_ACCESS_STARTED_EVENT => {
                // Return success — indicates SC subsystem is ready
                self.ioctl_success_response(&[])
            }
            SCARD_IOCTL_ESTABLISH_CONTEXT => {
                // Establish a local PC/SC context.
                // Currently returns a synthetic handle. Real SCard calls
                // require the `Win32_Security_Credentials` windows feature.
                log::info!(
                    "RDPDR smartcard {}: establishing context (synthetic — real PC/SC requires Win32_Security_Credentials feature)",
                    self.session_id
                );
                let mut out = Vec::new();
                out.extend_from_slice(&SCARD_S_SUCCESS.to_le_bytes());
                out.extend_from_slice(&4u32.to_le_bytes()); // cbContext
                out.extend_from_slice(&1u32.to_le_bytes()); // hContext (synthetic)
                self.ioctl_success_response(&out)
            }
            SCARD_IOCTL_RELEASE_CONTEXT | SCARD_IOCTL_IS_VALID_CONTEXT => {
                let mut out = Vec::new();
                out.extend_from_slice(&SCARD_S_SUCCESS.to_le_bytes());
                self.ioctl_success_response(&out)
            }
            SCARD_IOCTL_LIST_READERS_A | SCARD_IOCTL_LIST_READERS_W => {
                // Return empty reader list. Real enumeration requires the
                // `Win32_Security_Credentials` feature to call SCardListReaders.
                log::debug!(
                    "RDPDR smartcard {}: listing readers (empty — no PC/SC backend linked)",
                    self.session_id
                );
                let mut out = Vec::new();
                out.extend_from_slice(&SCARD_S_SUCCESS.to_le_bytes());
                out.extend_from_slice(&0u32.to_le_bytes()); // cReaders = 0
                self.ioctl_success_response(&out)
            }
            SCARD_IOCTL_GET_STATUS_CHANGE_A | SCARD_IOCTL_GET_STATUS_CHANGE_W => {
                // Return timeout (no readers available)
                let mut out = Vec::new();
                out.extend_from_slice(&0x8010_000Au32.to_le_bytes()); // SCARD_E_TIMEOUT
                self.ioctl_success_response(&out)
            }
            SCARD_IOCTL_CONNECT_W | SCARD_IOCTL_DISCONNECT
            | SCARD_IOCTL_BEGIN_TRANSACTION | SCARD_IOCTL_END_TRANSACTION
            | SCARD_IOCTL_TRANSMIT | SCARD_IOCTL_STATUS_A | SCARD_IOCTL_STATUS_W
            | SCARD_IOCTL_CANCEL => {
                // Full SCARD proxy (connect, transmit, transaction) requires
                // real PC/SC handle management. Return SCARD_E_NO_SERVICE to
                // signal the server that we can't service card I/O.
                log::debug!(
                    "RDPDR smartcard {}: unimplemented card I/O IOCTL 0x{:08X} — returning NO_SERVICE",
                    self.session_id, ioctl_code
                );
                let mut out = Vec::new();
                out.extend_from_slice(&SCARD_E_NO_SERVICE.to_le_bytes());
                self.ioctl_success_response(&out)
            }
            _ => {
                log::debug!("RDPDR smartcard {}: unhandled IOCTL 0x{:08X}", self.session_id, ioctl_code);
                self.ioctl_error_response(SCARD_E_NO_SERVICE)
            }
        }
    }

    fn ioctl_success_response(&self, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(4 + data.len());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes()); // OutputBufferLength
        out.extend_from_slice(data);
        out
    }

    fn ioctl_error_response(&self, _error_code: u32) -> Vec<u8> {
        let mut out = Vec::with_capacity(4);
        out.extend_from_slice(&0u32.to_le_bytes()); // OutputBufferLength = 0
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev() -> SmartCardDevice {
        SmartCardDevice::new(5, "test-session".into())
    }

    fn unwrap_completion(resp: Option<Vec<u8>>) -> (u32, Vec<u8>) {
        let buf = resp.expect("expected completion");
        assert!(buf.len() >= 16);
        let io_status = u32::from_le_bytes(buf[12..16].try_into().unwrap());
        let output = buf[16..].to_vec();
        (io_status, output)
    }

    fn make_ioctl_data(ioctl_code: u32) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&256u32.to_le_bytes()); // output_buffer_length
        data.extend_from_slice(&0u32.to_le_bytes());   // input_buffer_length
        data.extend_from_slice(&ioctl_code.to_le_bytes());
        data
    }

    #[test]
    fn irp_create_returns_success() {
        let mut d = dev();
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_CREATE, 0, 1, 0, &[]));
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(out.len(), 5);
    }

    #[test]
    fn irp_close_returns_success() {
        let mut d = dev();
        let (status, _) = unwrap_completion(d.handle_irp(IRP_MJ_CLOSE, 0, 2, 0, &[]));
        assert_eq!(status, STATUS_SUCCESS);
    }

    #[test]
    fn unsupported_irp_returns_not_supported() {
        let mut d = dev();
        let (status, _) = unwrap_completion(d.handle_irp(0xFF, 0, 3, 0, &[]));
        assert_eq!(status, STATUS_NOT_SUPPORTED);
    }

    #[test]
    fn ioctl_short_data_returns_error() {
        let mut d = dev();
        let _data = make_ioctl_data(SCARD_IOCTL_ESTABLISH_CONTEXT);
        // The handle_ioctl is reached via IRP_MJ_DEVICE_CONTROL
        let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 4, 0, &[0u8; 4]));
        assert_eq!(status, STATUS_SUCCESS); // IRP status is always SUCCESS
        // output should be the error response (0 length)
        let buf_len = u32::from_le_bytes(out[0..4].try_into().unwrap());
        assert_eq!(buf_len, 0);
    }

    #[cfg(target_os = "windows")]
    mod windows_tests {
        use super::*;

        #[test]
        fn ioctl_access_started_event() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_ACCESS_STARTED_EVENT);
            let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 10, 0, &data));
            assert_eq!(status, STATUS_SUCCESS);
            // success response: OutputBufferLength(4) + empty data
            let buf_len = u32::from_le_bytes(out[0..4].try_into().unwrap());
            assert_eq!(buf_len, 0);
        }

        #[test]
        fn ioctl_establish_context_returns_handle() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_ESTABLISH_CONTEXT);
            let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 11, 0, &data));
            assert_eq!(status, STATUS_SUCCESS);
            let buf_len = u32::from_le_bytes(out[0..4].try_into().unwrap());
            assert!(buf_len >= 12); // SCARD_S_SUCCESS(4) + cbContext(4) + hContext(4)
            let scard_status = u32::from_le_bytes(out[4..8].try_into().unwrap());
            assert_eq!(scard_status, SCARD_S_SUCCESS);
        }

        #[test]
        fn ioctl_list_readers_returns_empty() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_LIST_READERS_W);
            let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 12, 0, &data));
            assert_eq!(status, STATUS_SUCCESS);
            let buf_len = u32::from_le_bytes(out[0..4].try_into().unwrap());
            assert!(buf_len >= 8); // SCARD_S_SUCCESS(4) + cReaders(4)
            let scard_status = u32::from_le_bytes(out[4..8].try_into().unwrap());
            assert_eq!(scard_status, SCARD_S_SUCCESS);
            let reader_count = u32::from_le_bytes(out[8..12].try_into().unwrap());
            assert_eq!(reader_count, 0);
        }

        #[test]
        fn ioctl_connect_returns_no_service() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_CONNECT_W);
            let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 13, 0, &data));
            assert_eq!(status, STATUS_SUCCESS);
            let buf_len = u32::from_le_bytes(out[0..4].try_into().unwrap());
            assert!(buf_len >= 4);
            let scard_status = u32::from_le_bytes(out[4..8].try_into().unwrap());
            assert_eq!(scard_status, SCARD_E_NO_SERVICE);
        }

        #[test]
        fn ioctl_transmit_returns_no_service() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_TRANSMIT);
            let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 14, 0, &data));
            assert_eq!(status, STATUS_SUCCESS);
            let scard_status = u32::from_le_bytes(out[4..8].try_into().unwrap());
            assert_eq!(scard_status, SCARD_E_NO_SERVICE);
        }

        #[test]
        fn ioctl_get_status_change_returns_timeout() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_GET_STATUS_CHANGE_W);
            let (_, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 15, 0, &data));
            let scard_status = u32::from_le_bytes(out[4..8].try_into().unwrap());
            assert_eq!(scard_status, 0x8010_000A); // SCARD_E_TIMEOUT
        }

        #[test]
        fn ioctl_release_context_returns_success() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_RELEASE_CONTEXT);
            let (_, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 16, 0, &data));
            let scard_status = u32::from_le_bytes(out[4..8].try_into().unwrap());
            assert_eq!(scard_status, SCARD_S_SUCCESS);
        }
    }

    #[cfg(not(target_os = "windows"))]
    mod non_windows_tests {
        use super::*;

        #[test]
        fn ioctl_returns_no_service_on_non_windows() {
            let mut d = dev();
            let data = make_ioctl_data(SCARD_IOCTL_ESTABLISH_CONTEXT);
            let (status, out) = unwrap_completion(d.handle_irp(IRP_MJ_DEVICE_CONTROL, 0, 10, 0, &data));
            assert_eq!(status, STATUS_SUCCESS);
            let buf_len = u32::from_le_bytes(out[0..4].try_into().unwrap());
            assert_eq!(buf_len, 0); // error response has 0 output
        }
    }
}
