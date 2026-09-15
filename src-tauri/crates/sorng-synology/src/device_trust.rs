//! Trusted devices for native DSM API sign-ins (DSM Login Web API guide,
//! examples 3 and 4).
//!
//! - **Enroll:** a sign-in with `otp_code`, `enable_device_token=yes` and
//!   `device_name` makes DSM return a device token (`did`).
//! - **Reuse:** a later sign-in sends `device_name` and `device_id` instead of
//!   a one-time code.
//!
//! The token is a bearer credential that skips the second factor, so:
//! - DSM is asked for one only on a code sign-in the user opted in to;
//! - a saved token is sent only under this computer's own device name, so a
//!   database copied to another computer never replays it;
//! - it never appears in `Debug` output, errors, diagnostics or logs.
use crate::{
    error::{SynologyError, SynologyResult},
    login_handshake::SecondFactor,
    types::LoginResult,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::fmt;

/// Longest device name, in UTF-16 code units (the renderer's `length`).
pub const MAX_DEVICE_NAME_UNITS: usize = 64;
/// Longest device token, in UTF-16 code units.
pub const MAX_DEVICE_ID_UNITS: usize = 1024;
const DEVICE_NAME_PREFIX: &str = "SortOfRemoteNG · ";
const UNNAMED_HOST: &str = "desktop";

/// A sign-in's trusted-device choices, from the renderer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DeviceTrustRequest {
    /// Ask DSM to trust this computer. Honoured only with a one-time code.
    pub enroll: bool,
    /// The name saved with a trusted device, sent with its `device_id`.
    pub device_name: Option<String>,
}

/// A device token DSM issued for an opted-in sign-in (`connected.trustedDevice`).
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDevice {
    pub device_name: String,
    pub device_id: String,
}

impl fmt::Debug for TrustedDevice {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedDevice")
            .field("device_name", &self.device_name)
            .field("device_id", &"<redacted>")
            .finish()
    }
}

/// `SortOfRemoteNG · <computer name>`: the name DSM lists for this computer
/// and the binding a saved device token must match. Reads `COMPUTERNAME`,
/// then `HOSTNAME`, then `/etc/hostname` on Unix, else `desktop`.
pub fn local_device_name() -> String {
    let host = ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .find_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|name| !name.trim().is_empty())
        })
        .or_else(host_file_name);
    device_name_for(host.as_deref())
}

#[cfg(unix)]
fn host_file_name() -> Option<String> {
    use std::io::Read;
    let mut name = String::new();
    std::fs::File::open("/etc/hostname")
        .ok()?
        .take(256)
        .read_to_string(&mut name)
        .ok()?;
    Some(name)
}

#[cfg(not(unix))]
fn host_file_name() -> Option<String> {
    None
}

/// Builds the device name from a computer name: whitespace runs become one
/// space, control, zero-width and bidi characters are dropped, and the whole
/// name stays within 64 UTF-16 units.
pub(crate) fn device_name_for(host: Option<&str>) -> String {
    let budget = MAX_DEVICE_NAME_UNITS - DEVICE_NAME_PREFIX.encode_utf16().count();
    let words: Vec<String> = host
        .unwrap_or_default()
        .split_whitespace()
        .map(|word| word.chars().filter(|&c| !hidden(c)).collect::<String>())
        .filter(|word| !word.is_empty())
        .collect();
    let mut name = String::new();
    let mut units = 0;
    for character in words.join(" ").chars() {
        units += character.len_utf16();
        if units > budget {
            break;
        }
        name.push(character);
    }
    let name = name.trim_end();
    format!(
        "{DEVICE_NAME_PREFIX}{}",
        if name.is_empty() { UNNAMED_HOST } else { name }
    )
}

fn hidden(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}'
        )
}

/// Not blank, within `max_units` UTF-16 units, and free of control characters.
fn printable(value: &str, max_units: usize) -> bool {
    value.len() <= max_units * 3
        && value.encode_utf16().count() <= max_units
        && !value
            .trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
            .is_empty()
        && !value.chars().any(char::is_control)
}

pub(crate) fn valid_device_name(name: &str) -> bool {
    printable(name, MAX_DEVICE_NAME_UNITS)
}

pub(crate) fn valid_device_id(id: &str) -> bool {
    printable(id, MAX_DEVICE_ID_UNITS)
}

const INVALID_DEVICE: &str = "The saved trusted device is invalid, so this sign-in was not sent. Forget the trusted device, then sign in with a one-time code.";

/// Builds a sign-in's trusted-device request from `syn_fs_connect`'s optional
/// `trustDevice`, `deviceName` and `deviceId`, checked before any request.
/// With none of them set there is no request, as in older payloads.
pub fn request_from_ipc(
    trust_device: Option<bool>,
    device_name: Option<String>,
    device_id: Option<&str>,
) -> SynologyResult<Option<DeviceTrustRequest>> {
    let enroll = trust_device == Some(true);
    let request =
        (enroll || device_name.is_some() || device_id.is_some()).then_some(DeviceTrustRequest {
            enroll,
            device_name,
        });
    check(request.as_ref(), device_id)?;
    Ok(request)
}

/// A saved device needs a printable name (at most 64 units) and a printable
/// token (at most 1024 units), sent together. The error never repeats a
/// value. A token without a request is never sent, so it is not checked.
pub(crate) fn check(
    request: Option<&DeviceTrustRequest>,
    device_id: Option<&str>,
) -> SynologyResult<()> {
    let Some(request) = request else {
        return Ok(());
    };
    let name_ok = request.device_name.as_deref().is_none_or(valid_device_name);
    let id_ok = device_id.is_none_or(|id| valid_device_id(id) && request.device_name.is_some());
    if name_ok && id_ok {
        Ok(())
    } else {
        Err(SynologyError::auth(INVALID_DEVICE))
    }
}

/// What one sign-in sends about trusted devices.
#[derive(Clone, PartialEq, Eq)]
pub(crate) enum DeviceLogin {
    /// No device parameters.
    Off,
    /// `enable_device_token=yes` and `device_name`, next to `otp_code`.
    Enroll { device_name: String },
    /// `device_name` and `device_id`, without a code.
    Reuse {
        device_name: String,
        device_id: String,
    },
    /// A saved device named for another computer: nothing is sent.
    Mismatch,
}

impl fmt::Debug for DeviceLogin {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Off => formatter.write_str("Off"),
            Self::Enroll { device_name } => formatter
                .debug_struct("Enroll")
                .field("device_name", device_name)
                .finish(),
            Self::Reuse { device_name, .. } => formatter
                .debug_struct("Reuse")
                .field("device_name", device_name)
                .field("device_id", &"<redacted>")
                .finish(),
            Self::Mismatch => formatter.write_str("Mismatch"),
        }
    }
}

impl DeviceLogin {
    /// A code sign-in may enroll; a code-less sign-in may reuse a saved token,
    /// but only one saved under `local_name`. A token without a request (a
    /// library caller's `SynologyConfig.device_token`) is never sent.
    pub(crate) fn plan(
        request: Option<&DeviceTrustRequest>,
        device_id: Option<String>,
        code_sent: bool,
        local_name: &str,
    ) -> Self {
        let Some(request) = request else {
            return Self::Off;
        };
        if code_sent {
            return if request.enroll {
                Self::Enroll {
                    device_name: local_name.to_owned(),
                }
            } else {
                Self::Off
            };
        }
        match device_id {
            None => Self::Off,
            Some(device_id) if request.device_name.as_deref() == Some(local_name) => Self::Reuse {
                device_name: local_name.to_owned(),
                device_id,
            },
            Some(_) => Self::Mismatch,
        }
    }

    pub(crate) fn login_params(&self) -> Vec<(&'static str, Value)> {
        match self {
            Self::Enroll { device_name } => vec![
                ("enable_device_token", json!("yes")),
                ("device_name", json!(device_name)),
            ],
            Self::Reuse {
                device_name,
                device_id,
            } => vec![
                ("device_name", json!(device_name)),
                ("device_id", json!(device_id)),
            ],
            Self::Off | Self::Mismatch => Vec::new(),
        }
    }

    /// A saved device token went to DSM with this sign-in.
    pub(crate) fn sent_token(&self) -> bool {
        matches!(self, Self::Reuse { .. })
    }

    pub(crate) fn is_mismatch(&self) -> bool {
        matches!(self, Self::Mismatch)
    }

    pub(crate) fn second_factor(&self, code_sent: bool) -> SecondFactor {
        if code_sent {
            SecondFactor::Otp
        } else if self.sent_token() {
            SecondFactor::TrustedDevice
        } else {
            SecondFactor::None
        }
    }

    /// The device DSM issued for an enroll sign-in, if its token is usable.
    pub(crate) fn issued(&self, login: &LoginResult) -> Option<TrustedDevice> {
        let Self::Enroll { device_name } = self else {
            return None;
        };
        let device_id = login.device_token().filter(|id| valid_device_id(id))?;
        Some(TrustedDevice {
            device_name: device_name.clone(),
            device_id: device_id.to_owned(),
        })
    }
}
