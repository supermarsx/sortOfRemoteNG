use crate::ironrdp::pdu::input::fast_path::FastPathInputEvent;
use smallvec::{smallvec, SmallVec};

use super::types::RdpInputAction;

/// Inline capacity — 95%+ of input events produce exactly 1 `FastPathInputEvent`.
pub type InputEvents = SmallVec<[FastPathInputEvent; 2]>;

// ---- Convert frontend input to IronRDP FastPathInputEvent ----

pub fn convert_input(action: &RdpInputAction) -> InputEvents {
    use crate::ironrdp::pdu::input::fast_path::KeyboardFlags;
    use crate::ironrdp::pdu::input::mouse::PointerFlags;
    use crate::ironrdp::pdu::input::mouse_x::PointerXFlags;
    use crate::ironrdp::pdu::input::{MousePdu, MouseXPdu};

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
            x,
            y,
            delta,
            horizontal,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ironrdp::pdu::input::fast_path::KeyboardFlags;
    use crate::ironrdp::pdu::input::mouse::PointerFlags;
    use crate::ironrdp::pdu::input::mouse_x::PointerXFlags;

    fn single_event(action: RdpInputAction) -> FastPathInputEvent {
        let mut events = convert_input(&action);
        assert_eq!(events.len(), 1);
        events.remove(0)
    }

    fn assert_mouse_event(
        event: &FastPathInputEvent,
        expected_flags: PointerFlags,
        expected_rotation_units: i16,
        expected_x: u16,
        expected_y: u16,
    ) {
        match event {
            FastPathInputEvent::MouseEvent(mouse) => {
                assert_eq!(mouse.flags, expected_flags);
                assert_eq!(
                    mouse.number_of_wheel_rotation_units,
                    expected_rotation_units
                );
                assert_eq!(mouse.x_position, expected_x);
                assert_eq!(mouse.y_position, expected_y);
            }
            other => panic!("expected mouse event, got {other:?}"),
        }
    }

    fn assert_mouse_x_event(
        event: &FastPathInputEvent,
        expected_flags: PointerXFlags,
        expected_x: u16,
        expected_y: u16,
    ) {
        match event {
            FastPathInputEvent::MouseEventEx(mouse) => {
                assert_eq!(mouse.flags, expected_flags);
                assert_eq!(mouse.x_position, expected_x);
                assert_eq!(mouse.y_position, expected_y);
            }
            other => panic!("expected extended mouse event, got {other:?}"),
        }
    }

    fn assert_keyboard_event(
        event: &FastPathInputEvent,
        expected_flags: KeyboardFlags,
        expected_scancode: u8,
    ) {
        match event {
            FastPathInputEvent::KeyboardEvent(flags, scancode) => {
                assert_eq!(*flags, expected_flags);
                assert_eq!(*scancode, expected_scancode);
            }
            other => panic!("expected keyboard event, got {other:?}"),
        }
    }

    fn assert_unicode_event(
        event: &FastPathInputEvent,
        expected_flags: KeyboardFlags,
        expected_code: u16,
    ) {
        match event {
            FastPathInputEvent::UnicodeKeyboardEvent(flags, code) => {
                assert_eq!(*flags, expected_flags);
                assert_eq!(*code, expected_code);
            }
            other => panic!("expected unicode keyboard event, got {other:?}"),
        }
    }

    fn input_backlog_limit() -> usize {
        let session_runner_source = include_str!("session_runner.rs");
        assert!(session_runner_source.contains("INPUT_BACKLOG_LIMIT: usize = 512"));
        512
    }

    fn coalesce_inputs(actions: impl IntoIterator<Item = RdpInputAction>) -> (Vec<FastPathInputEvent>, u64) {
        let mut merged = Vec::new();
        let mut dropped = 0u64;
        let backlog_limit = input_backlog_limit();

        for action in actions {
            let events = convert_input(&action);
            if merged.len() < backlog_limit {
                merged.extend(events);
            } else {
                dropped += events.len() as u64;
            }
        }

        (merged, dropped)
    }

    #[test]
    fn mouse_move_encodes_fast_path_pointer_move() {
        let event = single_event(RdpInputAction::MouseMove { x: 640, y: 360 });

        assert_mouse_event(&event, PointerFlags::MOVE, 0, 640, 360);
    }

    #[test]
    fn mouse_buttons_encode_primary_secondary_and_extended_flags() {
        let left_press = single_event(RdpInputAction::MouseButton {
            x: 10,
            y: 20,
            button: 0,
            pressed: true,
        });
        let middle_release = single_event(RdpInputAction::MouseButton {
            x: 11,
            y: 21,
            button: 1,
            pressed: false,
        });
        let right_press = single_event(RdpInputAction::MouseButton {
            x: 12,
            y: 22,
            button: 2,
            pressed: true,
        });
        let x1_press = single_event(RdpInputAction::MouseButton {
            x: 13,
            y: 23,
            button: 3,
            pressed: true,
        });
        let x2_release = single_event(RdpInputAction::MouseButton {
            x: 14,
            y: 24,
            button: 4,
            pressed: false,
        });

        assert_mouse_event(
            &left_press,
            PointerFlags::DOWN | PointerFlags::LEFT_BUTTON,
            0,
            10,
            20,
        );
        assert_mouse_event(
            &middle_release,
            PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
            0,
            11,
            21,
        );
        assert_mouse_event(
            &right_press,
            PointerFlags::DOWN | PointerFlags::RIGHT_BUTTON,
            0,
            12,
            22,
        );
        assert_mouse_x_event(
            &x1_press,
            PointerXFlags::DOWN | PointerXFlags::BUTTON1,
            13,
            23,
        );
        assert_mouse_x_event(&x2_release, PointerXFlags::BUTTON2, 14, 24);
    }

    #[test]
    fn wheel_events_encode_vertical_and_horizontal_axes() {
        let vertical = single_event(RdpInputAction::Wheel {
            x: 100,
            y: 200,
            delta: 120,
            horizontal: false,
        });
        let horizontal = single_event(RdpInputAction::Wheel {
            x: 101,
            y: 201,
            delta: -120,
            horizontal: true,
        });

        assert_mouse_event(&vertical, PointerFlags::VERTICAL_WHEEL, 120, 100, 200);
        assert_mouse_event(
            &horizontal,
            PointerFlags::HORIZONTAL_WHEEL,
            -120,
            101,
            201,
        );
    }

    #[test]
    fn keyboard_events_preserve_scancode_release_and_extended_bits() {
        let press = single_event(RdpInputAction::KeyboardKey {
            scancode: 0x1E,
            pressed: true,
            extended: false,
        });
        let extended_release = single_event(RdpInputAction::KeyboardKey {
            scancode: 0x53,
            pressed: false,
            extended: true,
        });

        assert_keyboard_event(&press, KeyboardFlags::empty(), 0x1E);
        assert_keyboard_event(
            &extended_release,
            KeyboardFlags::RELEASE | KeyboardFlags::EXTENDED,
            0x53,
        );
    }

    #[test]
    fn unicode_events_encode_press_and_release_without_scancode_translation() {
        let press = single_event(RdpInputAction::Unicode {
            code: 0x20AC,
            pressed: true,
        });
        let release = single_event(RdpInputAction::Unicode {
            code: 0x20AC,
            pressed: false,
        });

        assert_unicode_event(&press, KeyboardFlags::empty(), 0x20AC);
        assert_unicode_event(&release, KeyboardFlags::RELEASE, 0x20AC);
    }

    #[test]
    fn coalescing_boundary_keeps_first_512_single_event_inputs() {
        let backlog_limit = input_backlog_limit() as u16;
        let actions = (0..=backlog_limit).map(|index| RdpInputAction::MouseMove {
            x: index,
            y: index + 1000,
        });

        let (merged, dropped) = coalesce_inputs(actions);

        assert_eq!(merged.len(), backlog_limit as usize);
        assert_eq!(dropped, 1);
        assert_mouse_event(merged.first().expect("first event"), PointerFlags::MOVE, 0, 0, 1000);
        assert_mouse_event(
            merged.last().expect("last retained event"),
            PointerFlags::MOVE,
            0,
            backlog_limit - 1,
            backlog_limit + 999,
        );
    }
}
