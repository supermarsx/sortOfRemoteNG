use super::types::TerminalMode;
use serde::{Deserialize, Serialize};

pub const URGENT_DISCARD_OUTPUT: u8 = 0x02;
pub const URGENT_RAW_MODE: u8 = 0x10;
pub const URGENT_COOKED_MODE: u8 = 0x20;
pub const URGENT_WINDOW_UPDATE: u8 = 0x80;
const KNOWN_URGENT_BITS: u8 =
    URGENT_DISCARD_OUTPUT | URGENT_RAW_MODE | URGENT_COOKED_MODE | URGENT_WINDOW_UPDATE;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UrgentAction {
    DiscardOutput,
    EnterRawMode,
    EnterCookedMode,
    SendWindowUpdate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UrgentUpdate {
    pub actions: Vec<UrgentAction>,
    pub unknown_bits: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UrgentState {
    pub terminal_mode: TerminalMode,
    pub window_updates_enabled: bool,
}

impl Default for UrgentState {
    fn default() -> Self {
        Self {
            terminal_mode: TerminalMode::Cooked,
            window_updates_enabled: false,
        }
    }
}

impl UrgentState {
    /// Apply an urgent byte as a bit mask.  The fixed action order is discard,
    /// raw, cooked, and window update; therefore a malformed byte containing
    /// both mode flags deterministically ends in cooked mode.
    pub fn apply(&mut self, byte: u8) -> UrgentUpdate {
        let mut actions = Vec::with_capacity(4);
        if byte & URGENT_DISCARD_OUTPUT != 0 {
            actions.push(UrgentAction::DiscardOutput);
        }
        if byte & URGENT_RAW_MODE != 0 {
            self.terminal_mode = TerminalMode::Raw;
            actions.push(UrgentAction::EnterRawMode);
        }
        if byte & URGENT_COOKED_MODE != 0 {
            self.terminal_mode = TerminalMode::Cooked;
            actions.push(UrgentAction::EnterCookedMode);
        }
        if byte & URGENT_WINDOW_UPDATE != 0 {
            self.window_updates_enabled = true;
            actions.push(UrgentAction::SendWindowUpdate);
        }

        UrgentUpdate {
            actions,
            unknown_bits: byte & !KNOWN_URGENT_BITS,
        }
    }
}
