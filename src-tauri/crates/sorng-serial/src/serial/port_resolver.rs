//! Resolves the concrete serial port for a [`SerialPortSelection`].
//!
//! Pure and deterministic: takes an already-enumerated candidate list plus
//! the set of ports held by our own sessions, never opens a device (probing
//! would toggle DTR on real hardware). Candidates are ordered by a natural
//! name sort (`COM3 < COM10`, `/dev/ttyUSB0 < /dev/ttyUSB1`) so "first" is
//! stable regardless of the OS enumeration order.

use std::cmp::Ordering;
use std::collections::HashSet;

use super::types::{PortType, SerialError, SerialErrorKind, SerialPortInfo, SerialPortSelection};

/// Maximum number of seen device names listed in a not-found error.
const MAX_SEEN_IN_ERROR: usize = 8;

/// One segment of a natural sort key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segment {
    /// Case-folded run of non-digit characters.
    Text(String),
    /// Run of ASCII digits, compared numerically.
    Number(u128),
}

impl PartialOrd for Segment {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Segment {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Segment::Number(a), Segment::Number(b)) => a.cmp(b),
            (Segment::Text(a), Segment::Text(b)) => a.cmp(b),
            // Digit runs sort before text so `COM` < `COM1` < `COMA`.
            (Segment::Number(_), Segment::Text(_)) => Ordering::Less,
            (Segment::Text(_), Segment::Number(_)) => Ordering::Greater,
        }
    }
}

/// Split a port name into a natural sort key: letters case-insensitively,
/// digit runs numerically.
pub fn natural_key(name: &str) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut number: Option<u128> = None;
    for ch in name.chars() {
        if let Some(d) = ch.to_digit(10) {
            if !text.is_empty() {
                out.push(Segment::Text(std::mem::take(&mut text)));
            }
            number = Some(
                number
                    .unwrap_or(0)
                    .saturating_mul(10)
                    .saturating_add(u128::from(d)),
            );
        } else {
            if let Some(n) = number.take() {
                out.push(Segment::Number(n));
            }
            text.extend(ch.to_lowercase());
        }
    }
    if let Some(n) = number {
        out.push(Segment::Number(n));
    }
    if !text.is_empty() {
        out.push(Segment::Text(text));
    }
    out
}

/// Compare two port names naturally; ties broken by the full raw name.
pub fn compare_port_names(a: &str, b: &str) -> Ordering {
    natural_key(a).cmp(&natural_key(b)).then_with(|| a.cmp(b))
}

/// Preference rank for `FirstAny` (lower wins).
fn type_rank(port_type: &PortType) -> u8 {
    match port_type {
        PortType::UsbSerial => 0,
        PortType::Native | PortType::Pci | PortType::Unknown => 1,
        PortType::Bluetooth => 2,
        PortType::Virtual => 3,
    }
}

fn contains_ci(haystack: Option<&str>, needle: &str) -> bool {
    haystack
        .map(|h| h.to_lowercase().contains(needle))
        .unwrap_or(false)
}

fn matches_filters(
    port: &SerialPortInfo,
    vid: Option<u16>,
    pid: Option<u16>,
    pattern: Option<&str>,
) -> bool {
    if let Some(v) = vid {
        if port.vid != Some(v) {
            return false;
        }
    }
    if let Some(p) = pid {
        if port.pid != Some(p) {
            return false;
        }
    }
    if let Some(raw) = pattern {
        let needle = raw.trim().to_lowercase();
        if !needle.is_empty() {
            let hit = contains_ci(Some(&port.port_name), &needle)
                || contains_ci(port.manufacturer.as_deref(), &needle)
                || contains_ci(port.description.as_deref(), &needle)
                || contains_ci(port.serial_number.as_deref(), &needle)
                || contains_ci(Some(&port.display_name), &needle);
            if !hit {
                return false;
            }
        }
    }
    true
}

fn synthetic_fixed(name: &str) -> SerialPortInfo {
    SerialPortInfo {
        port_name: name.to_string(),
        port_type: PortType::Unknown,
        description: None,
        manufacturer: None,
        vid: None,
        pid: None,
        serial_number: None,
        display_name: name.to_string(),
        in_use: false,
    }
}

fn describe_filters(selection: &SerialPortSelection) -> String {
    match selection {
        SerialPortSelection::Match { vid, pid, pattern } => {
            let mut parts = Vec::new();
            if let Some(v) = vid {
                parts.push(format!("vid=0x{:04x}", v));
            }
            if let Some(p) = pid {
                parts.push(format!("pid=0x{:04x}", p));
            }
            if let Some(t) = pattern.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                parts.push(format!("name contains \"{}\"", t));
            }
            if parts.is_empty() {
                String::new()
            } else {
                format!(" ({})", parts.join(", "))
            }
        }
        _ => String::new(),
    }
}

fn describe_seen(candidates: &[SerialPortInfo], busy: &HashSet<String>) -> String {
    let free: Vec<&SerialPortInfo> = candidates
        .iter()
        .filter(|c| !busy.contains(&c.port_name))
        .collect();
    let held: Vec<&str> = candidates
        .iter()
        .filter(|c| busy.contains(&c.port_name))
        .map(|c| c.port_name.as_str())
        .collect();

    let mut out = if free.is_empty() {
        "no serial devices detected".to_string()
    } else {
        let names: Vec<String> = free
            .iter()
            .take(MAX_SEEN_IN_ERROR)
            .map(|c| {
                format!(
                    "{} ({})",
                    c.port_name,
                    c.port_type.label().to_ascii_lowercase()
                )
            })
            .collect();
        let more = if free.len() > MAX_SEEN_IN_ERROR {
            format!(", +{} more", free.len() - MAX_SEEN_IN_ERROR)
        } else {
            String::new()
        };
        format!(
            "seen {} device{}: {}{}",
            free.len(),
            if free.len() == 1 { "" } else { "s" },
            names.join(", "),
            more
        )
    };
    if !held.is_empty() {
        out.push_str(&format!(
            "; {} device{} in use by another session: {}",
            held.len(),
            if held.len() == 1 { "" } else { "s" },
            held.iter()
                .take(MAX_SEEN_IN_ERROR)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    out
}

/// Pick the port a connection should open.
///
/// * `Fixed` returns `fixed_name` (the enumerated entry when present, else a
///   synthetic entry) and never fails — the OS open decides, as today.
/// * Auto modes drop busy ports, order the rest naturally, and apply the
///   mode's preference/filters. Virtual ports are considered only when no
///   other device exists.
pub fn resolve_serial_port(
    selection: &SerialPortSelection,
    fixed_name: &str,
    candidates: &[SerialPortInfo],
    busy: &HashSet<String>,
) -> Result<SerialPortInfo, SerialError> {
    if let SerialPortSelection::Fixed = selection {
        return Ok(candidates
            .iter()
            .find(|c| c.port_name == fixed_name)
            .cloned()
            .unwrap_or_else(|| synthetic_fixed(fixed_name)));
    }

    let mut free: Vec<&SerialPortInfo> = candidates
        .iter()
        .filter(|c| !busy.contains(&c.port_name))
        .collect();
    free.sort_by(|a, b| compare_port_names(&a.port_name, &b.port_name));

    let has_non_virtual = free.iter().any(|c| c.port_type != PortType::Virtual);
    let pool: Vec<&SerialPortInfo> = if has_non_virtual {
        free.iter()
            .copied()
            .filter(|c| c.port_type != PortType::Virtual)
            .collect()
    } else {
        free.clone()
    };

    let chosen = match selection {
        SerialPortSelection::Fixed => unreachable!("handled above"),
        SerialPortSelection::FirstUsb => pool
            .iter()
            .find(|c| c.port_type == PortType::UsbSerial)
            .copied(),
        SerialPortSelection::FirstAny => pool
            .iter()
            .copied()
            .min_by(|a, b| type_rank(&a.port_type).cmp(&type_rank(&b.port_type))),
        SerialPortSelection::Match { vid, pid, pattern } => pool
            .iter()
            .find(|c| matches_filters(c, *vid, *pid, pattern.as_deref()))
            .copied(),
    };

    match chosen {
        Some(port) => Ok(port.clone()),
        None => {
            let message = format!(
                "no serial device found for mode \"{}\"{}; {}",
                selection.mode_label(),
                describe_filters(selection),
                describe_seen(candidates, busy)
            );
            Err(SerialError::new(SerialErrorKind::PortNotFound, message))
        }
    }
}

/// Render a resolver error using the `"PortNotFound: …"` string convention
/// (same prefix style as `"DriverMissing:"` in the native transport).
pub fn resolver_error_string(err: &SerialError) -> String {
    format!("{:?}: {}", err.kind, err.message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serial::port_scanner::build_port_info;
    use crate::serial::types::{SerialConfig, SerialSession};

    fn port(name: &str, port_type: PortType) -> SerialPortInfo {
        let mut p = build_port_info(name, None, None, None, None, None);
        p.port_type = port_type;
        p
    }

    fn usb(name: &str, vid: u16, pid: u16, mfr: &str, desc: &str, sn: &str) -> SerialPortInfo {
        build_port_info(name, Some(vid), Some(pid), Some(desc), Some(mfr), Some(sn))
    }

    fn none_busy() -> HashSet<String> {
        HashSet::new()
    }

    fn names(ports: &[SerialPortInfo]) -> Vec<String> {
        let mut v: Vec<&SerialPortInfo> = ports.iter().collect();
        v.sort_by(|a, b| compare_port_names(&a.port_name, &b.port_name));
        v.iter().map(|p| p.port_name.clone()).collect()
    }

    #[test]
    fn natural_order_com10_after_com3() {
        assert_eq!(compare_port_names("COM3", "COM10"), Ordering::Less);
        assert_eq!(compare_port_names("COM10", "COM3"), Ordering::Greater);
        assert_eq!(compare_port_names("com3", "COM3"), Ordering::Greater);
        let sorted = names(&[
            port("COM10", PortType::Native),
            port("COM3", PortType::Native),
            port("COM1", PortType::Native),
        ]);
        assert_eq!(sorted, vec!["COM1", "COM3", "COM10"]);
    }

    #[test]
    fn natural_order_tty_usb() {
        let sorted = names(&[
            port("/dev/ttyUSB1", PortType::UsbSerial),
            port("/dev/ttyUSB10", PortType::UsbSerial),
            port("/dev/ttyUSB0", PortType::UsbSerial),
            port("/dev/ttyACM0", PortType::UsbSerial),
        ]);
        assert_eq!(
            sorted,
            vec![
                "/dev/ttyACM0",
                "/dev/ttyUSB0",
                "/dev/ttyUSB1",
                "/dev/ttyUSB10"
            ]
        );
    }

    #[test]
    fn natural_key_segments() {
        assert_eq!(
            natural_key("COM10"),
            vec![Segment::Text("com".into()), Segment::Number(10)]
        );
        assert_eq!(natural_key(""), Vec::<Segment>::new());
    }

    #[test]
    fn first_usb_picks_lowest_usb_even_when_native_sorts_first() {
        let cands = vec![
            port("COM1", PortType::Native),
            usb("COM9", 0x0403, 0x6001, "FTDI", "USB Serial", "A1"),
            usb("COM7", 0x0403, 0x6001, "FTDI", "USB Serial", "A2"),
        ];
        let got =
            resolve_serial_port(&SerialPortSelection::FirstUsb, "", &cands, &none_busy()).unwrap();
        assert_eq!(got.port_name, "COM7");
        assert_eq!(got.port_type, PortType::UsbSerial);
    }

    #[test]
    fn first_usb_fails_when_only_native() {
        let cands = vec![port("COM1", PortType::Native)];
        let err = resolve_serial_port(&SerialPortSelection::FirstUsb, "", &cands, &none_busy())
            .unwrap_err();
        assert_eq!(err.kind, SerialErrorKind::PortNotFound);
        assert!(err.message.contains("first USB device"), "{}", err.message);
        assert!(err.message.contains("COM1 (native)"), "{}", err.message);
    }

    #[test]
    fn first_any_prefers_usb_then_native_then_bluetooth_then_virtual() {
        let pick = |cands: &[SerialPortInfo]| {
            resolve_serial_port(&SerialPortSelection::FirstAny, "", cands, &none_busy())
                .unwrap()
                .port_name
        };
        let bt = port("COM3", PortType::Bluetooth);
        let native = port("COM4", PortType::Native);
        let usbp = usb("COM8", 1, 2, "m", "d", "s");
        let virt = port("COM2", PortType::Virtual);

        assert_eq!(
            pick(&[virt.clone(), bt.clone(), native.clone(), usbp.clone()]),
            "COM8"
        );
        assert_eq!(pick(&[virt.clone(), bt.clone(), native.clone()]), "COM4");
        assert_eq!(pick(&[virt.clone(), bt.clone()]), "COM3");
        assert_eq!(pick(&[virt.clone()]), "COM2");
        // Pci and Unknown rank with Native; lowest natural name wins.
        assert_eq!(
            pick(&[port("COM5", PortType::Pci), port("COM4", PortType::Unknown)]),
            "COM4"
        );
    }

    #[test]
    fn first_usb_uses_virtual_only_when_nothing_else() {
        let mut v = port("COM2", PortType::Virtual);
        v.port_type = PortType::Virtual;
        let err = resolve_serial_port(&SerialPortSelection::FirstUsb, "", &[v], &none_busy());
        assert!(err.is_err());
    }

    #[test]
    fn busy_ports_are_skipped() {
        let cands = vec![
            usb("COM7", 1, 2, "m", "d", "s"),
            usb("COM9", 1, 2, "m", "d", "s"),
        ];
        let busy: HashSet<String> = ["COM7".to_string()].into_iter().collect();
        let got = resolve_serial_port(&SerialPortSelection::FirstUsb, "", &cands, &busy).unwrap();
        assert_eq!(got.port_name, "COM9");

        let busy: HashSet<String> = ["COM7".to_string(), "COM9".to_string()]
            .into_iter()
            .collect();
        let err =
            resolve_serial_port(&SerialPortSelection::FirstUsb, "", &cands, &busy).unwrap_err();
        assert!(
            err.message
                .contains("2 devices in use by another session: COM7, COM9"),
            "{}",
            err.message
        );
        assert!(err.message.contains("no serial devices detected"));
    }

    fn match_sel(vid: Option<u16>, pid: Option<u16>, pattern: Option<&str>) -> SerialPortSelection {
        SerialPortSelection::Match {
            vid,
            pid,
            pattern: pattern.map(str::to_string),
        }
    }

    fn match_fixture() -> Vec<SerialPortInfo> {
        vec![
            port("COM1", PortType::Native),
            usb(
                "COM5",
                0x10c4,
                0xea60,
                "Silicon Labs",
                "CP210x UART Bridge",
                "SL-01",
            ),
            usb(
                "COM7",
                0x0403,
                0x6001,
                "FTDI",
                "USB Serial Port",
                "FT-ABC123",
            ),
        ]
    }

    #[test]
    fn match_by_vid_only() {
        let got = resolve_serial_port(
            &match_sel(Some(0x0403), None, None),
            "",
            &match_fixture(),
            &none_busy(),
        )
        .unwrap();
        assert_eq!(got.port_name, "COM7");
    }

    #[test]
    fn match_by_pid_only() {
        let got = resolve_serial_port(
            &match_sel(None, Some(0xea60), None),
            "",
            &match_fixture(),
            &none_busy(),
        )
        .unwrap();
        assert_eq!(got.port_name, "COM5");
    }

    #[test]
    fn match_by_pattern_over_all_fields_case_insensitive() {
        let f = match_fixture();
        for (needle, expect) in [
            ("ftdi", "COM7"),         // manufacturer
            ("cp210X", "COM5"),       // description
            ("ft-abc", "COM7"),       // serial number
            ("com1", "COM1"),         // port name
            ("silicon labs", "COM5"), // display name / manufacturer
        ] {
            let got =
                resolve_serial_port(&match_sel(None, None, Some(needle)), "", &f, &none_busy())
                    .unwrap_or_else(|e| panic!("{}: {}", needle, e));
            assert_eq!(got.port_name, expect, "needle {}", needle);
        }
    }

    #[test]
    fn match_all_filters_must_hold() {
        let f = match_fixture();
        let err = resolve_serial_port(
            &match_sel(Some(0x0403), Some(0xea60), None),
            "",
            &f,
            &none_busy(),
        )
        .unwrap_err();
        assert!(err.message.contains("matching device"), "{}", err.message);
        assert!(err.message.contains("vid=0x0403"), "{}", err.message);
        assert!(err.message.contains("pid=0xea60"), "{}", err.message);
        assert!(err.message.contains("seen 3 devices"), "{}", err.message);
        assert!(err.message.contains("COM7 (usb-serial)"), "{}", err.message);

        let got = resolve_serial_port(
            &match_sel(Some(0x0403), Some(0x6001), Some("FTDI")),
            "",
            &f,
            &none_busy(),
        )
        .unwrap();
        assert_eq!(got.port_name, "COM7");
    }

    #[test]
    fn match_with_no_filters_is_invalid_config() {
        let cfg = SerialConfig {
            port_selection: match_sel(None, None, Some("   ")),
            ..Default::default()
        };
        let err = cfg.validate().unwrap_err();
        assert_eq!(err, "Match selection needs a VID, PID, or name filter");
    }

    #[test]
    fn validate_allows_empty_name_only_for_auto_modes() {
        let fixed = SerialConfig::default();
        assert!(fixed.validate().is_err());
        let auto = SerialConfig {
            port_selection: SerialPortSelection::FirstUsb,
            ..Default::default()
        };
        assert!(auto.validate().is_ok());
        let bad = SerialConfig {
            port_selection: match_sel(None, None, Some("a\u{7}b")),
            ..Default::default()
        };
        assert!(bad.validate().unwrap_err().contains("control characters"));
        let long = SerialConfig {
            port_selection: match_sel(None, None, Some(&"x".repeat(129))),
            ..Default::default()
        };
        assert!(long.validate().unwrap_err().contains("exceeds 128"));
    }

    #[test]
    fn none_found_error_mentions_mode_and_seen_devices_capped() {
        let cands: Vec<SerialPortInfo> = (1..=10)
            .map(|i| port(&format!("COM{}", i), PortType::Native))
            .collect();
        let err = resolve_serial_port(&SerialPortSelection::FirstUsb, "", &cands, &none_busy())
            .unwrap_err();
        assert!(err.message.contains("seen 10 devices"), "{}", err.message);
        assert!(err.message.contains("+2 more"), "{}", err.message);
        assert!(!err.message.contains("COM9 "), "{}", err.message);
        assert_eq!(
            resolver_error_string(&err),
            format!("PortNotFound: {}", err.message)
        );
    }

    #[test]
    fn fixed_passes_name_through_untouched() {
        let got =
            resolve_serial_port(&SerialPortSelection::Fixed, "COM42", &[], &none_busy()).unwrap();
        assert_eq!(got.port_name, "COM42");
        assert_eq!(got.display_name, "COM42");

        // Enumerated entry is preferred when present; busy is ignored for Fixed.
        let cands = vec![usb("COM42", 1, 2, "FTDI", "d", "s")];
        let busy: HashSet<String> = ["COM42".to_string()].into_iter().collect();
        let got = resolve_serial_port(&SerialPortSelection::Fixed, "COM42", &cands, &busy).unwrap();
        assert_eq!(got.vid, Some(1));
    }

    #[test]
    fn serde_roundtrip_match_selection() {
        let json = r#"{"mode":"match","vid":1027,"pid":24577,"match":"ftdi"}"#;
        let sel: SerialPortSelection = serde_json::from_str(json).unwrap();
        assert_eq!(sel, match_sel(Some(1027), Some(24577), Some("ftdi")));
        let back = serde_json::to_string(&sel).unwrap();
        assert_eq!(back, json);

        let sel: SerialPortSelection = serde_json::from_str(r#"{"mode":"match"}"#).unwrap();
        assert_eq!(sel, match_sel(None, None, None));
        assert_eq!(
            serde_json::to_string(&SerialPortSelection::FirstUsb).unwrap(),
            r#"{"mode":"firstUsb"}"#
        );
        assert_eq!(
            serde_json::to_string(&SerialPortSelection::FirstAny).unwrap(),
            r#"{"mode":"firstAny"}"#
        );
        assert!(serde_json::from_str::<SerialPortSelection>(r#"{"mode":"bogus"}"#).is_err());
    }

    #[test]
    fn serde_config_without_port_selection_is_fixed() {
        let cfg: SerialConfig = serde_json::from_str(r#"{"portName":"COM3"}"#).unwrap();
        assert_eq!(cfg.port_selection, SerialPortSelection::Fixed);
        assert_eq!(cfg.port_name, "COM3");
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(
            json.contains(r#""portSelection":{"mode":"fixed"}"#),
            "{}",
            json
        );

        let cfg: SerialConfig =
            serde_json::from_str(r#"{"portName":"","portSelection":{"mode":"firstUsb"}}"#).unwrap();
        assert_eq!(cfg.port_selection, SerialPortSelection::FirstUsb);
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn serde_session_without_new_fields() {
        let json = r#"{"id":"s1","portName":"COM3","configShorthand":"9600-8N1","state":"connected","label":null,"connectedAt":"2026-08-26T00:00:00Z","bytesRx":0,"bytesTx":0,"controlLines":{"dtr":false,"rts":false,"cts":false,"dsr":false,"dcd":false,"ri":false}}"#;
        let s: SerialSession = serde_json::from_str(json).unwrap();
        assert!(!s.auto_selected);
        assert_eq!(s.port_display_name, None);
        let out = serde_json::to_string(&s).unwrap();
        assert!(out.contains(r#""autoSelected":false"#));
        assert!(out.contains(r#""portDisplayName":null"#));
    }
}
