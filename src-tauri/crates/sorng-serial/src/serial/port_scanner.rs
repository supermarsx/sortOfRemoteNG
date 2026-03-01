//! Serial port discovery and enumeration.
//!
//! Scans for available serial ports on the system, detects USB-serial
//! adapters by VID/PID, and provides metadata about each port.

use crate::serial::types::*;
use std::collections::HashMap;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Known USB-serial adapters
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Well-known USB VID/PID pairs for serial adapters.
#[derive(Debug, Clone)]
pub struct KnownAdapter {
    pub vid: u16,
    pub pid: u16,
    pub manufacturer: &'static str,
    pub product: &'static str,
    pub chipset: &'static str,
}

/// Registry of known USB-to-serial adapter chipsets.
pub fn known_adapters() -> Vec<KnownAdapter> {
    vec![
        // FTDI
        KnownAdapter { vid: 0x0403, pid: 0x6001, manufacturer: "FTDI", product: "FT232R", chipset: "FT232R" },
        KnownAdapter { vid: 0x0403, pid: 0x6010, manufacturer: "FTDI", product: "FT2232", chipset: "FT2232" },
        KnownAdapter { vid: 0x0403, pid: 0x6011, manufacturer: "FTDI", product: "FT4232H", chipset: "FT4232H" },
        KnownAdapter { vid: 0x0403, pid: 0x6014, manufacturer: "FTDI", product: "FT232H", chipset: "FT232H" },
        KnownAdapter { vid: 0x0403, pid: 0x6015, manufacturer: "FTDI", product: "FT-X Series", chipset: "FT230X" },
        // Silicon Labs (CP210x)
        KnownAdapter { vid: 0x10C4, pid: 0xEA60, manufacturer: "Silicon Labs", product: "CP2102", chipset: "CP2102" },
        KnownAdapter { vid: 0x10C4, pid: 0xEA61, manufacturer: "Silicon Labs", product: "CP2102N", chipset: "CP2102N" },
        KnownAdapter { vid: 0x10C4, pid: 0xEA70, manufacturer: "Silicon Labs", product: "CP2105", chipset: "CP2105" },
        KnownAdapter { vid: 0x10C4, pid: 0xEA80, manufacturer: "Silicon Labs", product: "CP2108", chipset: "CP2108" },
        // Prolific (PL2303)
        KnownAdapter { vid: 0x067B, pid: 0x2303, manufacturer: "Prolific", product: "PL2303", chipset: "PL2303" },
        KnownAdapter { vid: 0x067B, pid: 0x23A3, manufacturer: "Prolific", product: "PL2303GS", chipset: "PL2303GS" },
        KnownAdapter { vid: 0x067B, pid: 0x23B3, manufacturer: "Prolific", product: "PL2303GL", chipset: "PL2303GL" },
        KnownAdapter { vid: 0x067B, pid: 0x23C3, manufacturer: "Prolific", product: "PL2303GT", chipset: "PL2303GT" },
        // WCH (CH340 / CH341)
        KnownAdapter { vid: 0x1A86, pid: 0x7523, manufacturer: "WCH", product: "CH340", chipset: "CH340" },
        KnownAdapter { vid: 0x1A86, pid: 0x5523, manufacturer: "WCH", product: "CH341A", chipset: "CH341A" },
        KnownAdapter { vid: 0x1A86, pid: 0x7522, manufacturer: "WCH", product: "CH340K", chipset: "CH340K" },
        KnownAdapter { vid: 0x1A86, pid: 0x55D4, manufacturer: "WCH", product: "CH9102", chipset: "CH9102" },
        // MCP2200
        KnownAdapter { vid: 0x04D8, pid: 0x00DF, manufacturer: "Microchip", product: "MCP2200", chipset: "MCP2200" },
        // Arduino
        KnownAdapter { vid: 0x2341, pid: 0x0043, manufacturer: "Arduino", product: "Uno R3", chipset: "ATmega16U2" },
        KnownAdapter { vid: 0x2341, pid: 0x0042, manufacturer: "Arduino", product: "Mega 2560 R3", chipset: "ATmega16U2" },
        KnownAdapter { vid: 0x2341, pid: 0x0001, manufacturer: "Arduino", product: "Uno", chipset: "ATmega8U2" },
        KnownAdapter { vid: 0x2341, pid: 0x8036, manufacturer: "Arduino", product: "Leonardo", chipset: "Native USB" },
        KnownAdapter { vid: 0x1B4F, pid: 0x9205, manufacturer: "SparkFun", product: "Pro Micro", chipset: "ATmega32U4" },
        // Espressif
        KnownAdapter { vid: 0x303A, pid: 0x1001, manufacturer: "Espressif", product: "ESP32-S2", chipset: "ESP32-S2 USB-JTAG" },
        KnownAdapter { vid: 0x303A, pid: 0x1002, manufacturer: "Espressif", product: "ESP32-S3", chipset: "ESP32-S3 USB-JTAG" },
        // Cypress
        KnownAdapter { vid: 0x04B4, pid: 0x0002, manufacturer: "Cypress", product: "CY7C65213", chipset: "CY7C65213" },
        // Segger J-Link
        KnownAdapter { vid: 0x1366, pid: 0x0105, manufacturer: "Segger", product: "J-Link", chipset: "J-Link VCOM" },
        // STMicroelectronics
        KnownAdapter { vid: 0x0483, pid: 0x5740, manufacturer: "STMicroelectronics", product: "STM32 VCP", chipset: "STM32 CDC" },
        // Raspberry Pi Pico
        KnownAdapter { vid: 0x2E8A, pid: 0x000A, manufacturer: "Raspberry Pi", product: "Pico", chipset: "RP2040 CDC" },
    ]
}

/// Look up a known adapter by VID/PID.
pub fn lookup_adapter(vid: u16, pid: u16) -> Option<KnownAdapter> {
    known_adapters()
        .into_iter()
        .find(|a| a.vid == vid && a.pid == pid)
}

/// Build a VID/PID lookup map for fast access.
pub fn adapter_lookup_map() -> HashMap<(u16, u16), KnownAdapter> {
    known_adapters().into_iter().map(|a| ((a.vid, a.pid), a)).collect()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Port Scanner
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Scanner options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    /// Whether to probe each port (try to open it) to check availability.
    #[serde(default)]
    pub probe_ports: bool,

    /// Filter by port name prefix (e.g. "COM", "/dev/ttyUSB").
    #[serde(default)]
    pub name_filter: Option<String>,

    /// Filter by USB VID.
    #[serde(default)]
    pub vid_filter: Option<u16>,

    /// Filter by USB PID.
    #[serde(default)]
    pub pid_filter: Option<u16>,

    /// Include virtual / pseudo-terminal ports.
    #[serde(default = "default_true")]
    pub include_virtual: bool,
}

fn default_true() -> bool {
    true
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            probe_ports: false,
            name_filter: None,
            vid_filter: None,
            pid_filter: None,
            include_virtual: true,
        }
    }
}

use serde::{Deserialize, Serialize};

/// Result of a port scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub ports: Vec<SerialPortInfo>,
    pub scan_time_ms: u64,
    pub total_found: usize,
}

/// Generate a display name for a discovered port.
pub fn generate_display_name(port: &SerialPortInfo) -> String {
    let adapter_map = adapter_lookup_map();
    if let (Some(vid), Some(pid)) = (port.vid, port.pid) {
        if let Some(adapter) = adapter_map.get(&(vid, pid)) {
            return format!("{} - {} {}", port.port_name, adapter.manufacturer, adapter.product);
        }
    }
    if let Some(ref desc) = port.description {
        if !desc.is_empty() {
            return format!("{} - {}", port.port_name, desc);
        }
    }
    port.port_name.clone()
}

/// Enumerate serial ports on Windows using registry information.
/// This is a simulated scanner that returns well-known ports.
#[cfg(target_os = "windows")]
pub fn enumerate_windows_ports() -> Vec<String> {
    // In a real implementation, we'd query the registry at
    // HKLM\HARDWARE\DEVICEMAP\SERIALCOMM
    // For now, return common COM port names
    (1..=32).map(|i| format!("COM{}", i)).collect()
}

/// Enumerate serial ports on Linux/macOS.
#[cfg(not(target_os = "windows"))]
pub fn enumerate_unix_ports() -> Vec<String> {
    let mut ports = Vec::new();
    // USB-serial adapters
    for i in 0..16 {
        ports.push(format!("/dev/ttyUSB{}", i));
    }
    // ACM (Abstract Control Model) — Arduino, etc.
    for i in 0..16 {
        ports.push(format!("/dev/ttyACM{}", i));
    }
    // Native serial
    for i in 0..4 {
        ports.push(format!("/dev/ttyS{}", i));
    }
    // macOS
    #[cfg(target_os = "macos")]
    {
        ports.push("/dev/cu.usbserial".to_string());
        ports.push("/dev/cu.usbmodem".to_string());
    }
    ports
}

/// Classify a port name into a PortType.
pub fn classify_port(port_name: &str) -> PortType {
    let lower = port_name.to_lowercase();
    if lower.contains("usb") || lower.contains("acm") || lower.contains("usbmodem") || lower.contains("usbserial") {
        PortType::UsbSerial
    } else if lower.contains("bluetooth") || lower.contains("rfcomm") || lower.contains("bth") {
        PortType::Bluetooth
    } else if lower.contains("pts") || lower.contains("pty") || lower.contains("pseudo") {
        PortType::Virtual
    } else if lower.starts_with("com") || lower.starts_with("/dev/ttys") {
        PortType::Native
    } else {
        PortType::Unknown
    }
}

/// Create a `SerialPortInfo` from basic information.
pub fn build_port_info(
    port_name: &str,
    vid: Option<u16>,
    pid: Option<u16>,
    description: Option<&str>,
    manufacturer: Option<&str>,
    serial_number: Option<&str>,
) -> SerialPortInfo {
    let port_type = if vid.is_some() {
        PortType::UsbSerial
    } else {
        classify_port(port_name)
    };

    let mut info = SerialPortInfo {
        port_name: port_name.to_string(),
        port_type,
        description: description.map(|s| s.to_string()),
        manufacturer: manufacturer.map(|s| s.to_string()),
        vid,
        pid,
        serial_number: serial_number.map(|s| s.to_string()),
        display_name: String::new(),
        in_use: false,
    };
    info.display_name = generate_display_name(&info);
    info
}

/// Apply scan filters to a list of ports.
pub fn apply_filters(ports: Vec<SerialPortInfo>, options: &ScanOptions) -> Vec<SerialPortInfo> {
    ports.into_iter().filter(|p| {
        if let Some(ref filter) = options.name_filter {
            if !p.port_name.to_lowercase().contains(&filter.to_lowercase()) {
                return false;
            }
        }
        if let Some(vid) = options.vid_filter {
            if p.vid != Some(vid) {
                return false;
            }
        }
        if let Some(pid) = options.pid_filter {
            if p.pid != Some(pid) {
                return false;
            }
        }
        if !options.include_virtual && p.port_type == PortType::Virtual {
            return false;
        }
        true
    }).collect()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Baud rate detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Strategy for auto-detecting baud rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BaudDetectStrategy {
    /// Try common rates in descending order, look for valid data.
    BruteForce,
    /// Send AT command and check for OK/ERROR response.
    AtCommandProbe,
    /// Measure break timing (if hardware supports it).
    BreakTiming,
}

/// Result of baud rate detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaudDetectResult {
    pub detected_rate: Option<BaudRate>,
    pub confidence: f64,
    pub rates_tried: Vec<u32>,
    pub strategy: BaudDetectStrategy,
    pub elapsed_ms: u64,
}

/// Common baud rates to try during auto-detect, ordered by popularity.
pub fn common_detect_rates() -> Vec<BaudRate> {
    vec![
        BaudRate::Baud115200,
        BaudRate::Baud9600,
        BaudRate::Baud57600,
        BaudRate::Baud38400,
        BaudRate::Baud19200,
        BaudRate::Baud4800,
        BaudRate::Baud2400,
        BaudRate::Baud1200,
    ]
}

/// Heuristic: check if received data looks like valid text/protocol data.
pub fn is_plausible_data(data: &[u8]) -> bool {
    if data.is_empty() {
        return false;
    }
    let printable = data
        .iter()
        .filter(|b| b.is_ascii_graphic() || b.is_ascii_whitespace())
        .count();
    let ratio = printable as f64 / data.len() as f64;
    // At least 70% printable suggests correct baud rate
    ratio >= 0.70
}

/// Check if data looks like a valid AT command response.
pub fn is_at_response(data: &[u8]) -> bool {
    let text = String::from_utf8_lossy(data);
    let upper = text.to_uppercase();
    for line in upper.lines() {
        let t = line.trim();
        if t == "OK" || t == "ERROR" || t.starts_with("AT") || t.starts_with("+") {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_adapters_not_empty() {
        let adapters = known_adapters();
        assert!(!adapters.is_empty());
        assert!(adapters.len() >= 20);
    }

    #[test]
    fn test_lookup_ftdi() {
        let adapter = lookup_adapter(0x0403, 0x6001).unwrap();
        assert_eq!(adapter.manufacturer, "FTDI");
        assert_eq!(adapter.chipset, "FT232R");
    }

    #[test]
    fn test_lookup_ch340() {
        let adapter = lookup_adapter(0x1A86, 0x7523).unwrap();
        assert_eq!(adapter.manufacturer, "WCH");
        assert_eq!(adapter.chipset, "CH340");
    }

    #[test]
    fn test_lookup_cp2102() {
        let adapter = lookup_adapter(0x10C4, 0xEA60).unwrap();
        assert_eq!(adapter.manufacturer, "Silicon Labs");
    }

    #[test]
    fn test_lookup_unknown() {
        assert!(lookup_adapter(0xFFFF, 0xFFFF).is_none());
    }

    #[test]
    fn test_classify_port_usb() {
        assert_eq!(classify_port("/dev/ttyUSB0"), PortType::UsbSerial);
        assert_eq!(classify_port("/dev/ttyACM0"), PortType::UsbSerial);
    }

    #[test]
    fn test_classify_port_native() {
        assert_eq!(classify_port("COM1"), PortType::Native);
        assert_eq!(classify_port("/dev/ttyS0"), PortType::Native);
    }

    #[test]
    fn test_classify_port_bluetooth() {
        assert_eq!(classify_port("/dev/rfcomm0"), PortType::Bluetooth);
    }

    #[test]
    fn test_build_port_info_usb() {
        let info = build_port_info("COM3", Some(0x0403), Some(0x6001), None, None, None);
        assert_eq!(info.port_type, PortType::UsbSerial);
        assert!(info.display_name.contains("FTDI"));
    }

    #[test]
    fn test_build_port_info_with_description() {
        let info = build_port_info("COM5", None, None, Some("My Device"), None, None);
        assert!(info.display_name.contains("My Device"));
    }

    #[test]
    fn test_build_port_info_no_metadata() {
        let info = build_port_info("COM1", None, None, None, None, None);
        assert_eq!(info.display_name, "COM1");
    }

    #[test]
    fn test_apply_filters_name() {
        let ports = vec![
            build_port_info("COM1", None, None, None, None, None),
            build_port_info("COM2", None, None, None, None, None),
            build_port_info("/dev/ttyUSB0", None, None, None, None, None),
        ];
        let opts = ScanOptions {
            name_filter: Some("COM".to_string()),
            ..Default::default()
        };
        let filtered = apply_filters(ports, &opts);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_apply_filters_vid() {
        let ports = vec![
            build_port_info("COM1", Some(0x0403), Some(0x6001), None, None, None),
            build_port_info("COM2", Some(0x1A86), Some(0x7523), None, None, None),
        ];
        let opts = ScanOptions {
            vid_filter: Some(0x0403),
            ..Default::default()
        };
        let filtered = apply_filters(ports, &opts);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].port_name, "COM1");
    }

    #[test]
    fn test_is_plausible_data() {
        assert!(is_plausible_data(b"Hello World"));
        assert!(!is_plausible_data(b"\xff\xfe\xfd\xfc\xfb"));
        assert!(!is_plausible_data(b""));
    }

    #[test]
    fn test_is_at_response() {
        assert!(is_at_response(b"OK\r\n"));
        assert!(is_at_response(b"\r\nERROR\r\n"));
        assert!(is_at_response(b"AT+CSQ\r\n"));
        assert!(!is_at_response(b"garbage data"));
    }

    #[test]
    fn test_common_detect_rates() {
        let rates = common_detect_rates();
        assert!(!rates.is_empty());
        // 115200 and 9600 should be first
        assert_eq!(rates[0], BaudRate::Baud115200);
        assert_eq!(rates[1], BaudRate::Baud9600);
    }

    #[test]
    fn test_adapter_lookup_map() {
        let map = adapter_lookup_map();
        assert!(map.contains_key(&(0x0403, 0x6001)));
        assert!(map.contains_key(&(0x1A86, 0x7523)));
        assert!(!map.contains_key(&(0xFFFF, 0xFFFF)));
    }

    #[test]
    fn test_generate_display_name_known_adapter() {
        let info = SerialPortInfo {
            port_name: "COM3".to_string(),
            port_type: PortType::UsbSerial,
            description: None,
            manufacturer: None,
            vid: Some(0x0403),
            pid: Some(0x6001),
            serial_number: None,
            display_name: String::new(),
            in_use: false,
        };
        let name = generate_display_name(&info);
        assert!(name.contains("FTDI"));
        assert!(name.contains("FT232R"));
    }

    #[test]
    fn test_scan_options_default() {
        let opts = ScanOptions::default();
        assert!(!opts.probe_ports);
        assert!(opts.include_virtual);
        assert!(opts.name_filter.is_none());
    }
}
