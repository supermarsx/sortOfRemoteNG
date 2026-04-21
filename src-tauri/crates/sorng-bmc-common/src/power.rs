//! Standardised power-action enum shared across BMC vendors.

use serde::{Deserialize, Serialize};

/// Vendor-neutral power action.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PowerAction {
    On,
    ForceOff,
    GracefulShutdown,
    GracefulRestart,
    ForceRestart,
    Nmi,
    PushPowerButton,
    PowerCycle,
}

impl PowerAction {
    /// Redfish `ResetType` string (DMTF standard, same for all vendors).
    pub fn to_redfish(&self) -> &str {
        match self {
            Self::On => "On",
            Self::ForceOff => "ForceOff",
            Self::GracefulShutdown => "GracefulShutdown",
            Self::GracefulRestart => "GracefulRestart",
            Self::ForceRestart => "ForceRestart",
            Self::Nmi => "Nmi",
            Self::PushPowerButton => "PushPowerButton",
            Self::PowerCycle => "PowerCycle",
        }
    }

    /// IPMI chassis control action byte.
    pub fn to_ipmi(&self) -> u8 {
        match self {
            Self::On => 0x01,
            Self::ForceOff | Self::GracefulShutdown => 0x00,
            Self::ForceRestart | Self::GracefulRestart => 0x03,
            Self::Nmi => 0x04,
            Self::PushPowerButton | Self::PowerCycle => 0x02,
        }
    }
}
