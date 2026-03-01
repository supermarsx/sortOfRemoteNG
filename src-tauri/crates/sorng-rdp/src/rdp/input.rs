use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use smallvec::{SmallVec, smallvec};

use super::types::RdpInputAction;

/// Inline capacity — 95%+ of input events produce exactly 1 `FastPathInputEvent`.
pub(crate) type InputEvents = SmallVec<[FastPathInputEvent; 2]>;

// ---- Convert frontend input to IronRDP FastPathInputEvent ----

pub(crate) fn convert_input(action: &RdpInputAction) -> InputEvents {
    use ironrdp::pdu::input::fast_path::KeyboardFlags;
    use ironrdp::pdu::input::mouse::PointerFlags;
    use ironrdp::pdu::input::mouse_x::PointerXFlags;
    use ironrdp::pdu::input::{MousePdu, MouseXPdu};

    match action {
        RdpInputAction::MouseMove { x, y } => {
            smallvec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: PointerFlags::MOVE,
                number_of_wheel_rotation_units: 0,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::MouseButton {
            x,
            y,
            button,
            pressed,
        } => {
            let (_is_extended, flags) = match button {
                0 => (false, PointerFlags::LEFT_BUTTON),
                1 => (false, PointerFlags::MIDDLE_BUTTON_OR_WHEEL),
                2 => (false, PointerFlags::RIGHT_BUTTON),
                3 => {
                    return smallvec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                        flags: if *pressed {
                            PointerXFlags::DOWN | PointerXFlags::BUTTON1
                        } else {
                            PointerXFlags::BUTTON1
                        },
                        x_position: *x,
                        y_position: *y,
                    })]
                }
                4 => {
                    return smallvec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                        flags: if *pressed {
                            PointerXFlags::DOWN | PointerXFlags::BUTTON2
                        } else {
                            PointerXFlags::BUTTON2
                        },
                        x_position: *x,
                        y_position: *y,
                    })]
                }
                _ => (false, PointerFlags::LEFT_BUTTON),
            };
            let mouse_flags = if *pressed {
                PointerFlags::DOWN | flags
            } else {
                flags
            };
            smallvec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: mouse_flags,
                number_of_wheel_rotation_units: 0,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::Wheel {
            x, y, delta, horizontal,
        } => {
            let flags = if *horizontal {
                PointerFlags::HORIZONTAL_WHEEL
            } else {
                PointerFlags::VERTICAL_WHEEL
            };
            smallvec![FastPathInputEvent::MouseEvent(MousePdu {
                flags,
                number_of_wheel_rotation_units: *delta,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::KeyboardKey {
            scancode,
            pressed,
            extended,
        } => {
            let mut flags = if *pressed {
                KeyboardFlags::empty()
            } else {
                KeyboardFlags::RELEASE
            };
            if *extended {
                flags |= KeyboardFlags::EXTENDED;
            }
            smallvec![FastPathInputEvent::KeyboardEvent(flags, *scancode as u8)]
        }
        RdpInputAction::Unicode { code, pressed } => {
            let flags = if *pressed {
                KeyboardFlags::empty()
            } else {
                KeyboardFlags::RELEASE
            };
            smallvec![FastPathInputEvent::UnicodeKeyboardEvent(flags, *code)]
        }
    }
}
