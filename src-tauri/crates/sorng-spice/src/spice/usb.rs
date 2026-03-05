//! SPICE USB redirection channel: device enumeration, filtering, and redirect control.

use crate::spice::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── USB Device Discovery ────────────────────────────────────────────────────

/// USB device class codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum UsbDeviceClass {
    Audio,
    Cdc,
    Hid,
    Physical,
    Image,
    Printer,
    MassStorage,
    Hub,
    CdcData,
    SmartCard,
    ContentSecurity,
    Video,
    PersonalHealthcare,
    AudioVideo,
    Billboard,
    UsbTypeCBridge,
    Diagnostic,
    Wireless,
    Miscellaneous,
    ApplicationSpecific,
    VendorSpecific,
    Unknown(u8),
}

impl UsbDeviceClass {
    pub fn from_code(code: u8) -> Self {
        match code {
            0x01 => Self::Audio,
            0x02 => Self::Cdc,
            0x03 => Self::Hid,
            0x05 => Self::Physical,
            0x06 => Self::Image,
            0x07 => Self::Printer,
            0x08 => Self::MassStorage,
            0x09 => Self::Hub,
            0x0A => Self::CdcData,
            0x0B => Self::SmartCard,
            0x0D => Self::ContentSecurity,
            0x0E => Self::Video,
            0x0F => Self::PersonalHealthcare,
            0x10 => Self::AudioVideo,
            0x11 => Self::Billboard,
            0x12 => Self::UsbTypeCBridge,
            0xDC => Self::Diagnostic,
            0xE0 => Self::Wireless,
            0xEF => Self::Miscellaneous,
            0xFE => Self::ApplicationSpecific,
            0xFF => Self::VendorSpecific,
            other => Self::Unknown(other),
        }
    }

    pub fn to_code(&self) -> u8 {
        match self {
            Self::Audio => 0x01,
            Self::Cdc => 0x02,
            Self::Hid => 0x03,
            Self::Physical => 0x05,
            Self::Image => 0x06,
            Self::Printer => 0x07,
            Self::MassStorage => 0x08,
            Self::Hub => 0x09,
            Self::CdcData => 0x0A,
            Self::SmartCard => 0x0B,
            Self::ContentSecurity => 0x0D,
            Self::Video => 0x0E,
            Self::PersonalHealthcare => 0x0F,
            Self::AudioVideo => 0x10,
            Self::Billboard => 0x11,
            Self::UsbTypeCBridge => 0x12,
            Self::Diagnostic => 0xDC,
            Self::Wireless => 0xE0,
            Self::Miscellaneous => 0xEF,
            Self::ApplicationSpecific => 0xFE,
            Self::VendorSpecific => 0xFF,
            Self::Unknown(c) => *c,
        }
    }
}

// ── USB Redirection Protocol Messages ───────────────────────────────────────

/// USB redir message types.
pub mod usb_msg {
    pub const DEVICE_CONNECT: u32 = 1;
    pub const DEVICE_DISCONNECT: u32 = 2;
    pub const RESET: u32 = 3;
    pub const INTERFACE_INFO: u32 = 4;
    pub const EP_INFO: u32 = 5;
    pub const SET_CONFIGURATION: u32 = 6;
    pub const GET_CONFIGURATION: u32 = 7;
    pub const CONFIGURATION_STATUS: u32 = 8;
    pub const SET_ALT_SETTING: u32 = 9;
    pub const GET_ALT_SETTING: u32 = 10;
    pub const ALT_SETTING_STATUS: u32 = 11;
    pub const START_ISO_STREAM: u32 = 12;
    pub const STOP_ISO_STREAM: u32 = 13;
    pub const ISO_STREAM_STATUS: u32 = 14;
    pub const START_INTERRUPT_RECEIVING: u32 = 15;
    pub const STOP_INTERRUPT_RECEIVING: u32 = 16;
    pub const INTERRUPT_RECEIVING_STATUS: u32 = 17;
    pub const ALLOC_BULK_STREAMS: u32 = 18;
    pub const FREE_BULK_STREAMS: u32 = 19;
    pub const BULK_STREAMS_STATUS: u32 = 20;
    pub const CANCEL_DATA_PACKET: u32 = 21;
    pub const FILTER_REJECT: u32 = 22;
    pub const FILTER_UNREDIRECT: u32 = 23;
    pub const DEVICE_DISCONNECT_ACK: u32 = 24;
    pub const BULK_PACKET: u32 = 100;
    pub const ISO_PACKET: u32 = 101;
    pub const INTERRUPT_PACKET: u32 = 102;
    pub const BUFFERED_BULK_PACKET: u32 = 103;
}

// ── USB Filter Engine ───────────────────────────────────────────────────────

/// Whether a filter rule allows or blocks a device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterAction {
    Allow,
    Block,
}

/// A single USB filter rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbFilterRule {
    pub action: FilterAction,
    pub vendor_id: Option<u16>,
    pub product_id: Option<u16>,
    pub device_class: Option<u8>,
    pub device_subclass: Option<u8>,
    pub device_protocol: Option<u8>,
}

impl UsbFilterRule {
    /// Check if this rule matches a device.
    pub fn matches(&self, device: &UsbDevice) -> bool {
        if let Some(vid) = self.vendor_id {
            if device.vendor_id != vid { return false; }
        }
        if let Some(pid) = self.product_id {
            if device.product_id != pid { return false; }
        }
        if let Some(cls) = self.device_class {
            if device.device_class != cls { return false; }
        }
        if let Some(sub) = self.device_subclass {
            if device.device_subclass != sub { return false; }
        }
        if let Some(proto) = self.device_protocol {
            if device.device_protocol != proto { return false; }
        }
        true
    }
}

/// Parse a SPICE USB filter string like "0x1234,0x5678,-1,0,0,1|0x2345,-1,-1,-1,-1,0".
/// Each entry: vendor,product,class,subclass,protocol,allow(0/1).
/// -1 means "any".
pub fn parse_filter_string(s: &str) -> Vec<UsbFilterRule> {
    let mut rules = Vec::new();
    for entry in s.split('|') {
        let entry = entry.trim();
        if entry.is_empty() { continue; }
        let parts: Vec<&str> = entry.split(',').map(|p| p.trim()).collect();
        if parts.len() < 6 { continue; }

        let parse_opt_u16 = |s: &str| -> Option<u16> {
            let s = s.trim();
            if s == "-1" { return None; }
            if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
                u16::from_str_radix(hex, 16).ok()
            } else {
                s.parse().ok()
            }
        };
        let parse_opt_u8 = |s: &str| -> Option<u8> {
            let s = s.trim();
            if s == "-1" { return None; }
            s.parse().ok()
        };

        let action = if parts[5] == "0" { FilterAction::Block } else { FilterAction::Allow };
        rules.push(UsbFilterRule {
            action,
            vendor_id: parse_opt_u16(parts[0]),
            product_id: parse_opt_u16(parts[1]),
            device_class: parse_opt_u8(parts[2]),
            device_subclass: parse_opt_u8(parts[3]),
            device_protocol: parse_opt_u8(parts[4]),
        });
    }
    rules
}

// ── USB Redirect Manager ────────────────────────────────────────────────────

/// State of a USB device in the context of redirection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UsbRedirectState {
    /// Available on host, not redirected.
    Available,
    /// In the process of being redirected.
    Redirecting,
    /// Actively redirected to the guest.
    Redirected,
    /// In the process of being un-redirected.
    Unredirecting,
    /// Redirect/unredirect failed.
    Error,
}

/// A tracked USB device with redirect state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedUsbDevice {
    pub device: UsbDevice,
    pub state: UsbRedirectState,
    pub error: Option<String>,
}

/// Manages USB device redirection for a SPICE session.
#[derive(Debug)]
pub struct UsbRedirectManager {
    enabled: bool,
    auto_redirect: bool,
    devices: HashMap<String, TrackedUsbDevice>,
    filters: Vec<UsbFilterRule>,
    max_redirected: usize,
}

impl UsbRedirectManager {
    pub fn new(enabled: bool, auto_redirect: bool) -> Self {
        Self {
            enabled,
            auto_redirect,
            devices: HashMap::new(),
            filters: Vec::new(),
            max_redirected: 8,
        }
    }

    pub fn set_filters(&mut self, filters: Vec<UsbFilterRule>) {
        self.filters = filters;
    }

    pub fn set_filter_string(&mut self, s: &str) {
        self.filters = parse_filter_string(s);
    }

    pub fn set_max_redirected(&mut self, max: usize) {
        self.max_redirected = max;
    }

    /// Check if a device is allowed by the filter rules.
    /// If no rule matches, the device is allowed by default.
    pub fn is_allowed(&self, device: &UsbDevice) -> bool {
        for rule in &self.filters {
            if rule.matches(device) {
                return rule.action == FilterAction::Allow;
            }
        }
        true // default allow
    }

    /// Notify that a USB device was plugged in on the host.
    pub fn device_connected(&mut self, device: UsbDevice) -> Option<String> {
        if !self.enabled { return None; }
        let key = format!("{}:{}", device.vendor_id, device.product_id);
        let should_redirect = self.auto_redirect && self.is_allowed(&device);
        let state = if should_redirect {
            UsbRedirectState::Redirecting
        } else {
            UsbRedirectState::Available
        };
        self.devices.insert(key.clone(), TrackedUsbDevice {
            device,
            state,
            error: None,
        });
        if should_redirect { Some(key) } else { None }
    }

    /// Notify that a USB device was unplugged.
    pub fn device_disconnected(&mut self, vendor_id: u16, product_id: u16) {
        let key = format!("{}:{}", vendor_id, product_id);
        self.devices.remove(&key);
    }

    /// Request redirect of a specific device.
    pub fn redirect(&mut self, vendor_id: u16, product_id: u16) -> Result<(), String> {
        if !self.enabled { return Err("USB redirection is disabled".into()); }

        let redirected_count = self.devices.values()
            .filter(|d| d.state == UsbRedirectState::Redirected || d.state == UsbRedirectState::Redirecting)
            .count();
        if redirected_count >= self.max_redirected {
            return Err(format!("maximum redirected devices ({}) reached", self.max_redirected));
        }

        let key = format!("{}:{}", vendor_id, product_id);
        // Check filter allowance before taking a mutable borrow
        let allowed = if let Some(tracked) = self.devices.get(&key) {
            self.is_allowed(&tracked.device)
        } else {
            return Err(format!("device {}:{} not found", vendor_id, product_id));
        };
        if !allowed {
            return Err("device is blocked by filter rules".into());
        }
        if let Some(tracked) = self.devices.get_mut(&key) {
            tracked.state = UsbRedirectState::Redirecting;
            tracked.error = None;
        }
        Ok(())
    }

    /// Mark a device as successfully redirected.
    pub fn redirect_completed(&mut self, vendor_id: u16, product_id: u16) {
        let key = format!("{}:{}", vendor_id, product_id);
        if let Some(tracked) = self.devices.get_mut(&key) {
            tracked.state = UsbRedirectState::Redirected;
        }
    }

    /// Mark a redirect as failed.
    pub fn redirect_failed(&mut self, vendor_id: u16, product_id: u16, error: String) {
        let key = format!("{}:{}", vendor_id, product_id);
        if let Some(tracked) = self.devices.get_mut(&key) {
            tracked.state = UsbRedirectState::Error;
            tracked.error = Some(error);
        }
    }

    /// Request unredirect of a device.
    pub fn unredirect(&mut self, vendor_id: u16, product_id: u16) -> Result<(), String> {
        let key = format!("{}:{}", vendor_id, product_id);
        if let Some(tracked) = self.devices.get_mut(&key) {
            tracked.state = UsbRedirectState::Unredirecting;
            Ok(())
        } else {
            Err(format!("device {}:{} not found", vendor_id, product_id))
        }
    }

    /// Mark a device as successfully un-redirected.
    pub fn unredirect_completed(&mut self, vendor_id: u16, product_id: u16) {
        let key = format!("{}:{}", vendor_id, product_id);
        if let Some(tracked) = self.devices.get_mut(&key) {
            tracked.state = UsbRedirectState::Available;
        }
    }

    /// List all tracked devices.
    pub fn list_devices(&self) -> Vec<&TrackedUsbDevice> {
        self.devices.values().collect()
    }

    /// List only redirected devices.
    pub fn list_redirected(&self) -> Vec<&TrackedUsbDevice> {
        self.devices.values()
            .filter(|d| d.state == UsbRedirectState::Redirected)
            .collect()
    }

    /// Reset all devices to available.
    pub fn reset(&mut self) {
        for tracked in self.devices.values_mut() {
            tracked.state = UsbRedirectState::Available;
            tracked.error = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_device(vid: u16, pid: u16) -> UsbDevice {
        UsbDevice {
            vendor_id: vid,
            product_id: pid,
            device_class: 0x08,
            device_subclass: 0x06,
            device_protocol: 0x50,
            manufacturer: "Test".into(),
            product: "TestDevice".into(),
            serial: "12345".into(),
            bus: 1,
            address: 2,
            redirected: false,
        }
    }

    #[test]
    fn filter_string_parse() {
        let rules = parse_filter_string("0x1234,0x5678,-1,-1,-1,1|0x2345,-1,-1,-1,-1,0");
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].vendor_id, Some(0x1234));
        assert_eq!(rules[0].product_id, Some(0x5678));
        assert_eq!(rules[0].action, FilterAction::Allow);
        assert_eq!(rules[1].vendor_id, Some(0x2345));
        assert_eq!(rules[1].action, FilterAction::Block);
    }

    #[test]
    fn filter_matching() {
        let rule = UsbFilterRule {
            action: FilterAction::Block,
            vendor_id: Some(0x1234),
            product_id: None,
            device_class: None,
            device_subclass: None,
            device_protocol: None,
        };
        assert!(rule.matches(&test_device(0x1234, 0x0001)));
        assert!(!rule.matches(&test_device(0x9999, 0x0001)));
    }

    #[test]
    fn redirect_lifecycle() {
        let mut mgr = UsbRedirectManager::new(true, false);
        let dev = test_device(0x1234, 0x5678);
        mgr.device_connected(dev);

        // Redirect
        mgr.redirect(0x1234, 0x5678).unwrap();
        let devs = mgr.list_devices();
        assert_eq!(devs[0].state, UsbRedirectState::Redirecting);

        // Complete
        mgr.redirect_completed(0x1234, 0x5678);
        assert_eq!(mgr.list_redirected().len(), 1);

        // Unredirect
        mgr.unredirect(0x1234, 0x5678).unwrap();
        mgr.unredirect_completed(0x1234, 0x5678);
        assert_eq!(mgr.list_redirected().len(), 0);
    }

    #[test]
    fn auto_redirect() {
        let mut mgr = UsbRedirectManager::new(true, true);
        let dev = test_device(0x1234, 0x5678);
        let key = mgr.device_connected(dev);
        assert!(key.is_some()); // auto-redirect triggered
    }

    #[test]
    fn device_class_roundtrip() {
        for code in [0x01, 0x02, 0x03, 0x08, 0x09, 0x0E, 0xE0, 0xFF] {
            let cls = UsbDeviceClass::from_code(code);
            assert_eq!(cls.to_code(), code);
        }
    }

    #[test]
    fn max_redirect_limit() {
        let mut mgr = UsbRedirectManager::new(true, false);
        mgr.set_max_redirected(1);

        mgr.device_connected(test_device(0x0001, 0x0001));
        mgr.device_connected(test_device(0x0002, 0x0002));

        mgr.redirect(0x0001, 0x0001).unwrap();
        mgr.redirect_completed(0x0001, 0x0001);

        let result = mgr.redirect(0x0002, 0x0002);
        assert!(result.is_err());
    }
}
