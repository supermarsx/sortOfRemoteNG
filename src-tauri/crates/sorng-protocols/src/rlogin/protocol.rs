use super::types::{LocalFlowAction, TerminalMode};

const XON: u8 = 0x11;
const XOFF: u8 = 0x13;

/// Result of applying local terminal semantics to one arbitrary input chunk.
/// `wire_bytes` remains byte-for-byte transparent except for explicitly local
/// flow-control and escape sequences.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessedInput {
    pub wire_bytes: Vec<u8>,
    pub local_flow_actions: Vec<LocalFlowAction>,
    pub disconnect_requested: bool,
}

#[derive(Debug, Clone)]
pub struct InputProcessor {
    escape_enabled: bool,
    escape_byte: u8,
    local_flow_control: bool,
    at_line_start: bool,
    pending_escape: bool,
}

impl InputProcessor {
    pub fn new(escape_enabled: bool, escape_byte: u8, local_flow_control: bool) -> Self {
        Self {
            escape_enabled,
            escape_byte,
            local_flow_control,
            at_line_start: true,
            pending_escape: false,
        }
    }

    pub fn process(&mut self, input: &[u8], terminal_mode: TerminalMode) -> ProcessedInput {
        let mut result = ProcessedInput {
            wire_bytes: Vec::with_capacity(input.len()),
            local_flow_actions: Vec::new(),
            disconnect_requested: false,
        };

        for &byte in input {
            if self.pending_escape {
                self.pending_escape = false;
                if byte == b'.' {
                    result.disconnect_requested = true;
                    break;
                }
                if byte == self.escape_byte {
                    self.push_wire_byte(self.escape_byte, &mut result.wire_bytes);
                    continue;
                }

                self.push_wire_byte(self.escape_byte, &mut result.wire_bytes);
                self.process_regular_byte(byte, terminal_mode, &mut result);
                continue;
            }

            if self.escape_enabled && self.at_line_start && byte == self.escape_byte {
                self.pending_escape = true;
                continue;
            }

            self.process_regular_byte(byte, terminal_mode, &mut result);
        }

        result
    }

    pub fn has_pending_escape(&self) -> bool {
        self.pending_escape
    }

    fn process_regular_byte(
        &mut self,
        byte: u8,
        terminal_mode: TerminalMode,
        result: &mut ProcessedInput,
    ) {
        if self.local_flow_control && terminal_mode == TerminalMode::Cooked {
            match byte {
                XOFF => {
                    result.local_flow_actions.push(LocalFlowAction::PauseOutput);
                    return;
                }
                XON => {
                    result
                        .local_flow_actions
                        .push(LocalFlowAction::ResumeOutput);
                    return;
                }
                _ => {}
            }
        }

        self.push_wire_byte(byte, &mut result.wire_bytes);
    }

    fn push_wire_byte(&mut self, byte: u8, output: &mut Vec<u8>) {
        output.push(byte);
        self.at_line_start = byte == b'\r' || byte == b'\n';
    }
}
