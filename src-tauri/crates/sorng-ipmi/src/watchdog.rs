//! IPMI Watchdog Timer operations — get, set, and reset the BMC watchdog
//! timer including timer-use types, timeout actions, pre-timeout interrupt,
//! countdown values, and timer control.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, info};

// ═══════════════════════════════════════════════════════════════════════
// Get Watchdog Timer
// ═══════════════════════════════════════════════════════════════════════

/// Get the current watchdog timer configuration and state.
pub fn get_watchdog_timer(session: &mut IpmiSessionHandle) -> IpmiResult<WatchdogTimer> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_WATCHDOG_TIMER,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 8 {
        return Err(IpmiError::WatchdogError(
            "Watchdog timer response too short".into(),
        ));
    }

    parse_watchdog_response(&resp.data)
}

/// Parse the Get Watchdog Timer response bytes.
fn parse_watchdog_response(data: &[u8]) -> IpmiResult<WatchdogTimer> {
    // Byte 0: Timer Use
    let timer_use_byte = data[0];
    let timer_use = WatchdogTimerUse::from_byte(timer_use_byte & 0x07);
    let timer_running = (timer_use_byte & 0x40) != 0;
    let dont_log = (timer_use_byte & 0x80) != 0;

    // Timer use expiration flags (bits [6:3] indicate which uses have expired)
    let use_expiration_flags = (timer_use_byte >> 3) & 0x07;

    // Byte 1: Timer Actions
    let actions_byte = data[1];
    let timeout_action = WatchdogAction::from_byte(actions_byte & 0x07);
    let pre_timeout_interrupt = PreTimeoutInterrupt::from_byte((actions_byte >> 4) & 0x07);

    // Byte 2: Pre-timeout interval (seconds)
    let pre_timeout_interval = data[2];

    // Byte 3: Timer use expiration flags / clear (reserved use)
    let timer_use_expiration_flags_clear = data[3];

    // Bytes 4-5: Initial countdown value (100ms/count, little-endian)
    let initial_countdown = u16::from_le_bytes([data[4], data[5]]);

    // Bytes 6-7: Present countdown value (100ms/count, little-endian)
    let present_countdown = u16::from_le_bytes([data[6], data[7]]);

    Ok(WatchdogTimer {
        timer_use,
        timer_running,
        dont_log,
        timeout_action,
        pre_timeout_interrupt,
        pre_timeout_interval,
        initial_countdown,
        present_countdown,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// Set Watchdog Timer
// ═══════════════════════════════════════════════════════════════════════

/// Set the watchdog timer configuration.
pub fn set_watchdog_timer(
    session: &mut IpmiSessionHandle,
    config: &WatchdogTimerConfig,
) -> IpmiResult<()> {
    info!(
        "Setting watchdog timer: use={:?}, action={:?}, countdown={}",
        config.timer_use, config.timeout_action, config.initial_countdown
    );

    let mut timer_use_byte: u8 = config.timer_use.as_byte() & 0x07;
    if config.dont_log {
        timer_use_byte |= 0x80;
    }
    if config.dont_stop {
        timer_use_byte |= 0x40;
    }

    let actions_byte: u8 =
        (config.timeout_action.as_byte() & 0x07) | ((config.pre_timeout_interrupt.as_byte() & 0x07) << 4);

    let countdown_bytes = config.initial_countdown.to_le_bytes();

    let data = vec![
        timer_use_byte,
        actions_byte,
        config.pre_timeout_interval,
        config.expiration_flags_clear,
        countdown_bytes[0],
        countdown_bytes[1],
    ];

    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::SET_WATCHDOG_TIMER,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
// Reset Watchdog Timer
// ═══════════════════════════════════════════════════════════════════════

/// Reset (kick) the watchdog timer to restart its countdown.
pub fn reset_watchdog_timer(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    debug!("Resetting watchdog timer");

    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::RESET_WATCHDOG_TIMER,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
// Watchdog Timer Configuration Builder
// ═══════════════════════════════════════════════════════════════════════

/// Configuration for setting the watchdog timer.
#[derive(Debug, Clone)]
pub struct WatchdogTimerConfig {
    pub timer_use: WatchdogTimerUse,
    pub dont_log: bool,
    pub dont_stop: bool,
    pub timeout_action: WatchdogAction,
    pub pre_timeout_interrupt: PreTimeoutInterrupt,
    pub pre_timeout_interval: u8,
    pub expiration_flags_clear: u8,
    pub initial_countdown: u16,
}

impl Default for WatchdogTimerConfig {
    fn default() -> Self {
        Self {
            timer_use: WatchdogTimerUse::SmsOs,
            dont_log: false,
            dont_stop: false,
            timeout_action: WatchdogAction::NoAction,
            pre_timeout_interrupt: PreTimeoutInterrupt::None,
            pre_timeout_interval: 0,
            expiration_flags_clear: 0,
            initial_countdown: 6000, // 10 minutes (100ms units)
        }
    }
}

impl WatchdogTimerConfig {
    /// Create a new watchdog timer configuration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the timer use type.
    pub fn timer_use(mut self, use_type: WatchdogTimerUse) -> Self {
        self.timer_use = use_type;
        self
    }

    /// Set whether to log expiration events.
    pub fn dont_log(mut self, dont_log: bool) -> Self {
        self.dont_log = dont_log;
        self
    }

    /// Set whether to stop the timer when setting.
    pub fn dont_stop(mut self, dont_stop: bool) -> Self {
        self.dont_stop = dont_stop;
        self
    }

    /// Set the timeout action.
    pub fn timeout_action(mut self, action: WatchdogAction) -> Self {
        self.timeout_action = action;
        self
    }

    /// Set the pre-timeout interrupt type.
    pub fn pre_timeout_interrupt(mut self, interrupt: PreTimeoutInterrupt) -> Self {
        self.pre_timeout_interrupt = interrupt;
        self
    }

    /// Set the pre-timeout interval in seconds.
    pub fn pre_timeout_interval(mut self, seconds: u8) -> Self {
        self.pre_timeout_interval = seconds;
        self
    }

    /// Set initial countdown in 100ms units.
    pub fn initial_countdown(mut self, count: u16) -> Self {
        self.initial_countdown = count;
        self
    }

    /// Set initial countdown from seconds.
    pub fn countdown_seconds(mut self, seconds: u16) -> Self {
        self.initial_countdown = seconds.saturating_mul(10);
        self
    }

    /// Clear expiration flags for specific timer uses.
    pub fn clear_expiration_flags(mut self, flags: u8) -> Self {
        self.expiration_flags_clear = flags;
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helper enum methods
// ═══════════════════════════════════════════════════════════════════════

impl WatchdogTimerUse {
    /// Convert a byte value to WatchdogTimerUse.
    pub fn from_byte(value: u8) -> Self {
        match value & 0x07 {
            0x01 => Self::BiosFrePost,
            0x02 => Self::BiosPost,
            0x03 => Self::OsLoad,
            0x04 => Self::SmsOs,
            0x05 => Self::Oem,
            _ => Self::Reserved,
        }
    }

    /// Convert to byte value.
    pub fn as_byte(&self) -> u8 {
        match self {
            Self::BiosFrePost => 0x01,
            Self::BiosPost => 0x02,
            Self::OsLoad => 0x03,
            Self::SmsOs => 0x04,
            Self::Oem => 0x05,
            Self::Reserved => 0x00,
        }
    }

    /// Get a human-readable description.
    pub fn description(&self) -> &'static str {
        match self {
            Self::BiosFrePost => "BIOS/FRB2",
            Self::BiosPost => "BIOS/POST",
            Self::OsLoad => "OS Load",
            Self::SmsOs => "SMS/OS",
            Self::Oem => "OEM",
            Self::Reserved => "Reserved",
        }
    }
}

impl WatchdogAction {
    /// Convert a byte value to WatchdogAction.
    pub fn from_byte(value: u8) -> Self {
        match value & 0x07 {
            0x00 => Self::NoAction,
            0x01 => Self::HardReset,
            0x02 => Self::PowerDown,
            0x03 => Self::PowerCycle,
            _ => Self::NoAction,
        }
    }

    /// Convert to byte value.
    pub fn as_byte(&self) -> u8 {
        match self {
            Self::NoAction => 0x00,
            Self::HardReset => 0x01,
            Self::PowerDown => 0x02,
            Self::PowerCycle => 0x03,
        }
    }

    /// Get a human-readable description.
    pub fn description(&self) -> &'static str {
        match self {
            Self::NoAction => "No Action",
            Self::HardReset => "Hard Reset",
            Self::PowerDown => "Power Down",
            Self::PowerCycle => "Power Cycle",
        }
    }
}

impl PreTimeoutInterrupt {
    /// Convert a byte value to PreTimeoutInterrupt.
    pub fn from_byte(value: u8) -> Self {
        match value & 0x07 {
            0x00 => Self::None,
            0x01 => Self::Smi,
            0x02 => Self::Nmi,
            0x03 => Self::MessagingInterrupt,
            _ => Self::None,
        }
    }

    /// Convert to byte value.
    pub fn as_byte(&self) -> u8 {
        match self {
            Self::None => 0x00,
            Self::Smi => 0x01,
            Self::Nmi => 0x02,
            Self::MessagingInterrupt => 0x03,
        }
    }

    /// Get a human-readable description.
    pub fn description(&self) -> &'static str {
        match self {
            Self::None => "None",
            Self::Smi => "SMI",
            Self::Nmi => "NMI / Diagnostic Interrupt",
            Self::MessagingInterrupt => "Messaging Interrupt",
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════

/// Convert a countdown value (100ms units) to a human-readable duration.
pub fn countdown_to_string(countdown: u16) -> String {
    let total_ms = countdown as u64 * 100;
    let seconds = total_ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;

    if hours > 0 {
        format!(
            "{}h {}m {}s",
            hours,
            minutes % 60,
            seconds % 60
        )
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds % 60)
    } else {
        format!("{}.{}s", seconds, (total_ms % 1000) / 100)
    }
}

/// Format a watchdog timer status summary.
pub fn format_watchdog_status(timer: &WatchdogTimer) -> String {
    let running = if timer.timer_running {
        "RUNNING"
    } else {
        "STOPPED"
    };

    format!(
        "Watchdog [{}] Use: {} | Action: {} | Pre-timeout: {} ({}s) | Countdown: {} / {}",
        running,
        timer.timer_use.description(),
        timer.timeout_action.description(),
        timer.pre_timeout_interrupt.description(),
        timer.pre_timeout_interval,
        countdown_to_string(timer.present_countdown),
        countdown_to_string(timer.initial_countdown),
    )
}
