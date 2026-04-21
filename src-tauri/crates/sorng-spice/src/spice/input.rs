//! SPICE input channel: keyboard and pointer event encoding.

use crate::spice::types::*;
use bytes::{BufMut, BytesMut};

// ── Keyboard ────────────────────────────────────────────────────────────────

/// Scan-code type for keyboard events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanCodeType {
    /// AT set 1 (PC/XT compatible, used by most SPICE servers).
    At,
    /// XT extended set.
    XtExtended,
}

/// Encoded keyboard event.
#[derive(Debug, Clone)]
pub struct KeyEvent {
    pub scancode: u32,
    pub down: bool,
    pub scancode_type: ScanCodeType,
}

impl KeyEvent {
    /// Create a key press event.
    pub fn press(scancode: u32) -> Self {
        Self {
            scancode,
            down: true,
            scancode_type: ScanCodeType::At,
        }
    }

    /// Create a key release event.
    pub fn release(scancode: u32) -> Self {
        Self {
            scancode,
            down: false,
            scancode_type: ScanCodeType::At,
        }
    }

    /// Encode for SPICE inputs channel.
    /// Message type: INPUTS_KEY_DOWN = 401 (custom client msg), INPUTS_KEY_UP = 402.
    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u32_le(self.scancode);
    }

    /// Type a full key (press + release).
    pub fn typed(scancode: u32) -> Vec<Self> {
        vec![Self::press(scancode), Self::release(scancode)]
    }
}

/// Keyboard modifier state tracking.
#[derive(Debug, Clone, Default)]
pub struct KeyboardState {
    pub scroll_lock: bool,
    pub num_lock: bool,
    pub caps_lock: bool,
}

impl KeyboardState {
    pub fn to_mask(&self) -> u16 {
        let mut mask = 0u16;
        if self.scroll_lock {
            mask |= 1;
        }
        if self.num_lock {
            mask |= 2;
        }
        if self.caps_lock {
            mask |= 4;
        }
        mask
    }

    pub fn from_mask(mask: u16) -> Self {
        Self {
            scroll_lock: mask & 1 != 0,
            num_lock: mask & 2 != 0,
            caps_lock: mask & 4 != 0,
        }
    }

    pub fn toggle(&mut self, modifier: KeyboardModifier) {
        match modifier {
            KeyboardModifier::ScrollLock => self.scroll_lock = !self.scroll_lock,
            KeyboardModifier::NumLock => self.num_lock = !self.num_lock,
            KeyboardModifier::CapsLock => self.caps_lock = !self.caps_lock,
        }
    }

    /// Encode a modifier state update for the inputs channel.
    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u16_le(self.to_mask());
    }
}

// ── Pointer / Mouse ─────────────────────────────────────────────────────────

/// SPICE pointer (mouse) movement mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MouseMode {
    /// Server-side cursor: client sends absolute position.
    Server,
    /// Client-side cursor: client sends relative motion deltas.
    Client,
}

use serde::{Deserialize, Serialize};

/// Pointer event.
#[derive(Debug, Clone)]
pub struct PointerEvent {
    pub x: i32,
    pub y: i32,
    pub button_mask: u8,
    pub mode: MouseMode,
}

impl PointerEvent {
    /// Create a motion event (no button change).
    pub fn motion(x: i32, y: i32, mode: MouseMode) -> Self {
        Self {
            x,
            y,
            button_mask: 0,
            mode,
        }
    }

    /// Create a button press event.
    pub fn button_press(x: i32, y: i32, button_mask: u8, mode: MouseMode) -> Self {
        Self {
            x,
            y,
            button_mask,
            mode,
        }
    }

    /// Encode for SPICE inputs channel.
    pub fn encode(&self, buf: &mut BytesMut) {
        match self.mode {
            MouseMode::Server => {
                // Absolute position
                buf.put_i32_le(self.x);
                buf.put_i32_le(self.y);
                buf.put_u8(self.button_mask);
                buf.put_u8(0); // display_id
            }
            MouseMode::Client => {
                // Relative motion
                buf.put_i32_le(self.x);
                buf.put_i32_le(self.y);
                buf.put_u8(self.button_mask);
            }
        }
    }
}

/// Scroll event.
#[derive(Debug, Clone)]
pub struct ScrollEvent {
    pub x: i32,
    pub y: i32,
    pub delta_x: i32,
    pub delta_y: i32,
}

impl ScrollEvent {
    /// Convert to pointer events with appropriate button mask bits.
    pub fn to_pointer_events(&self, mode: MouseMode) -> Vec<PointerEvent> {
        let mut events = Vec::new();
        if self.delta_y < 0 {
            // Scroll up
            events.push(PointerEvent::button_press(
                self.x,
                self.y,
                MouseButton::SCROLL_UP,
                mode,
            ));
            events.push(PointerEvent::motion(self.x, self.y, mode));
        } else if self.delta_y > 0 {
            // Scroll down
            events.push(PointerEvent::button_press(
                self.x,
                self.y,
                MouseButton::SCROLL_DOWN,
                mode,
            ));
            events.push(PointerEvent::motion(self.x, self.y, mode));
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_event_typed() {
        let events = KeyEvent::typed(0x1E); // 'A' scancode
        assert_eq!(events.len(), 2);
        assert!(events[0].down);
        assert!(!events[1].down);
    }

    #[test]
    fn keyboard_state_mask() {
        let mut state = KeyboardState::default();
        state.toggle(KeyboardModifier::CapsLock);
        assert!(state.caps_lock);
        assert_eq!(state.to_mask(), 4);

        let decoded = KeyboardState::from_mask(state.to_mask());
        assert!(decoded.caps_lock);
        assert!(!decoded.num_lock);
    }

    #[test]
    fn pointer_encode_size() {
        let evt = PointerEvent::motion(100, 200, MouseMode::Server);
        let mut buf = BytesMut::new();
        evt.encode(&mut buf);
        assert_eq!(buf.len(), 10); // 4 + 4 + 1 + 1
    }
}
