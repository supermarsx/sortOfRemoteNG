//! Keyboard and pointer input handling for ARD/VNC sessions.
//!
//! Translates high-level input actions into RFB wire events.

use super::errors::ArdError;
use super::rfb::RfbConnection;
use super::types::ArdInputAction;

/// Tracking state for the pointer (mouse cursor).
pub struct PointerState {
    pub x: u16,
    pub y: u16,
    pub button_mask: u8,
}

impl Default for PointerState {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            button_mask: 0,
        }
    }
}

/// VNC button mask constants.
pub mod buttons {
    pub const LEFT: u8 = 0x01;
    pub const MIDDLE: u8 = 0x02;
    pub const RIGHT: u8 = 0x04;
    pub const SCROLL_UP: u8 = 0x08;
    pub const SCROLL_DOWN: u8 = 0x10;
    pub const SCROLL_LEFT: u8 = 0x20;
    pub const SCROLL_RIGHT: u8 = 0x40;
}

/// Convert a zero-based button index to a button mask.
pub fn button_index_to_mask(index: u8) -> u8 {
    match index {
        0 => buttons::LEFT,
        1 => buttons::MIDDLE,
        2 => buttons::RIGHT,
        3 => buttons::SCROLL_UP,
        4 => buttons::SCROLL_DOWN,
        5 => buttons::SCROLL_LEFT,
        6 => buttons::SCROLL_RIGHT,
        _ => 0,
    }
}

/// Dispatch a high-level action to the appropriate RFB wire event.
pub fn send_input(
    conn: &mut RfbConnection,
    action: &ArdInputAction,
    pointer: &mut PointerState,
) -> Result<(), ArdError> {
    match action {
        ArdInputAction::MouseMove { x, y } => {
            pointer.x = *x;
            pointer.y = *y;
            conn.send_pointer_event(pointer.button_mask, pointer.x, pointer.y)?;
        }
        ArdInputAction::MouseButton {
            button,
            pressed,
            x,
            y,
        } => {
            pointer.x = *x;
            pointer.y = *y;
            let mask = button_index_to_mask(*button);
            if *pressed {
                pointer.button_mask |= mask;
            } else {
                pointer.button_mask &= !mask;
            }
            conn.send_pointer_event(pointer.button_mask, pointer.x, pointer.y)?;
        }
        ArdInputAction::KeyboardKey { keysym, pressed } => {
            conn.send_key_event(*pressed, *keysym)?;
        }
        ArdInputAction::Scroll { dx, dy, x, y } => {
            pointer.x = *x;
            pointer.y = *y;

            if *dy < 0 {
                for _ in 0..(-dy).min(10) {
                    conn.send_pointer_event(
                        pointer.button_mask | buttons::SCROLL_UP,
                        pointer.x,
                        pointer.y,
                    )?;
                    conn.send_pointer_event(pointer.button_mask, pointer.x, pointer.y)?;
                }
            } else if *dy > 0 {
                for _ in 0..(*dy).min(10) {
                    conn.send_pointer_event(
                        pointer.button_mask | buttons::SCROLL_DOWN,
                        pointer.x,
                        pointer.y,
                    )?;
                    conn.send_pointer_event(pointer.button_mask, pointer.x, pointer.y)?;
                }
            }

            if *dx < 0 {
                for _ in 0..(-dx).min(10) {
                    conn.send_pointer_event(
                        pointer.button_mask | buttons::SCROLL_LEFT,
                        pointer.x,
                        pointer.y,
                    )?;
                    conn.send_pointer_event(pointer.button_mask, pointer.x, pointer.y)?;
                }
            } else if *dx > 0 {
                for _ in 0..(*dx).min(10) {
                    conn.send_pointer_event(
                        pointer.button_mask | buttons::SCROLL_RIGHT,
                        pointer.x,
                        pointer.y,
                    )?;
                    conn.send_pointer_event(pointer.button_mask, pointer.x, pointer.y)?;
                }
            }
        }
    }
    Ok(())
}

/// Common X11 keysym constants.
pub mod keysyms {
    pub const BACKSPACE: u32 = 0xFF08;
    pub const TAB: u32 = 0xFF09;
    pub const RETURN: u32 = 0xFF0D;
    pub const ESCAPE: u32 = 0xFF1B;
    pub const DELETE: u32 = 0xFFFF;
    pub const HOME: u32 = 0xFF50;
    pub const LEFT: u32 = 0xFF51;
    pub const UP: u32 = 0xFF52;
    pub const RIGHT: u32 = 0xFF53;
    pub const DOWN: u32 = 0xFF54;
    pub const PAGE_UP: u32 = 0xFF55;
    pub const PAGE_DOWN: u32 = 0xFF56;
    pub const END: u32 = 0xFF57;
    pub const INSERT: u32 = 0xFF63;
    pub const F1: u32 = 0xFFBE;
    pub const F2: u32 = 0xFFBF;
    pub const F3: u32 = 0xFFC0;
    pub const F4: u32 = 0xFFC1;
    pub const F5: u32 = 0xFFC2;
    pub const F6: u32 = 0xFFC3;
    pub const F7: u32 = 0xFFC4;
    pub const F8: u32 = 0xFFC5;
    pub const F9: u32 = 0xFFC6;
    pub const F10: u32 = 0xFFC7;
    pub const F11: u32 = 0xFFC8;
    pub const F12: u32 = 0xFFC9;
    pub const SHIFT_L: u32 = 0xFFE1;
    pub const SHIFT_R: u32 = 0xFFE2;
    pub const CONTROL_L: u32 = 0xFFE3;
    pub const CONTROL_R: u32 = 0xFFE4;
    pub const META_L: u32 = 0xFFE7;
    pub const META_R: u32 = 0xFFE8;
    pub const ALT_L: u32 = 0xFFE9;
    pub const ALT_R: u32 = 0xFFEA;
    pub const SUPER_L: u32 = 0xFFEB;
    pub const SUPER_R: u32 = 0xFFEC;
    pub const CAPS_LOCK: u32 = 0xFFE5;
    pub const NUM_LOCK: u32 = 0xFF7F;
    pub const SCROLL_LOCK: u32 = 0xFF14;
    pub const PRINT_SCREEN: u32 = 0xFF61;
    pub const PAUSE: u32 = 0xFF13;
}

/// Convert a character/codepoint to an X11 keysym.
pub fn ascii_to_keysym(ch: char) -> u32 {
    let code = ch as u32;
    if (0x20..=0x7E).contains(&code) {
        // Latin-1 ASCII range maps directly
        code
    } else {
        // Unicode → X11 keysym convention: 0x01000000 + codepoint
        0x0100_0000 + code
    }
}

/// Type a string by sending key press+release for each character.
pub fn type_string(conn: &mut RfbConnection, text: &str) -> Result<(), ArdError> {
    for ch in text.chars() {
        let keysym = ascii_to_keysym(ch);
        conn.send_key_event(true, keysym)?;
        conn.send_key_event(false, keysym)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_index_mapping() {
        assert_eq!(button_index_to_mask(0), buttons::LEFT);
        assert_eq!(button_index_to_mask(1), buttons::MIDDLE);
        assert_eq!(button_index_to_mask(2), buttons::RIGHT);
        assert_eq!(button_index_to_mask(3), buttons::SCROLL_UP);
        assert_eq!(button_index_to_mask(7), 0);
    }

    #[test]
    fn ascii_keysym_conversion() {
        assert_eq!(ascii_to_keysym('a'), 0x61);
        assert_eq!(ascii_to_keysym('A'), 0x41);
        assert_eq!(ascii_to_keysym(' '), 0x20);
        assert_eq!(ascii_to_keysym('~'), 0x7E);
    }

    #[test]
    fn unicode_keysym_conversion() {
        let ch = '\u{00E9}'; // é
        assert_eq!(ascii_to_keysym(ch), 0x0100_00E9);
    }

    #[test]
    fn pointer_default() {
        let p = PointerState::default();
        assert_eq!(p.x, 0);
        assert_eq!(p.y, 0);
        assert_eq!(p.button_mask, 0);
    }
}
