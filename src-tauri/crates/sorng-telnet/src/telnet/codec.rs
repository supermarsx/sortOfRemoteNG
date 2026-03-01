//! Telnet byte-stream codec.
//!
//! Parses an incoming byte stream into [`TelnetFrame`]s and provides an
//! encoder that escapes outgoing data appropriately.
//!
//! The parser is a state machine that handles:
//!  - Plain data (bytes not part of any IAC sequence)
//!  - IAC escaping (0xFF 0xFF → data byte 0xFF)
//!  - Negotiation commands (IAC WILL/WONT/DO/DONT <option>)
//!  - Sub-negotiation (IAC SB <option> … IAC SE)
//!  - Simple commands (IAC NOP, IAC AYT, IAC BRK, etc.)

use crate::telnet::protocol::{IAC, SB, SE, WILL, WONT, DO, DONT};
use crate::telnet::types::TelnetCommand;
use crate::telnet::protocol::TelnetFrame;

/// Parser state.
#[derive(Debug, Clone, PartialEq, Eq)]
enum State {
    /// Normal data.
    Data,
    /// Just saw IAC, waiting for the next byte.
    Iac,
    /// Saw IAC + negotiation command, waiting for option byte.
    Negotiation(u8),
    /// Inside a sub-negotiation (after IAC SB <option>).
    SubNegotiation { option: u8, buf: Vec<u8> },
    /// Saw IAC inside a sub-negotiation payload.
    SubNegotiationIac { option: u8, buf: Vec<u8> },
}

/// Stateful telnet byte-stream codec.
///
/// Feed bytes via [`decode`] and collect [`TelnetFrame`]s.
/// The codec retains partial state between calls so it tolerates
/// arbitrary chunking of the TCP stream.
#[derive(Debug)]
pub struct TelnetCodec {
    state: State,
    /// Accumulated data bytes (flushed when an IAC or end-of-buffer is hit).
    data_buf: Vec<u8>,
}

impl TelnetCodec {
    pub fn new() -> Self {
        Self {
            state: State::Data,
            data_buf: Vec::with_capacity(1024),
        }
    }

    /// Decode a chunk of bytes from the network.
    /// Returns zero or more parsed frames.
    pub fn decode(&mut self, input: &[u8]) -> Vec<TelnetFrame> {
        let mut frames = Vec::new();

        for &byte in input {
            match std::mem::replace(&mut self.state, State::Data) {
                State::Data => {
                    if byte == IAC {
                        self.flush_data(&mut frames);
                        self.state = State::Iac;
                    } else {
                        self.data_buf.push(byte);
                    }
                }
                State::Iac => {
                    match byte {
                        IAC => {
                            // Escaped 0xFF → literal data byte.
                            self.data_buf.push(IAC);
                            self.state = State::Data;
                        }
                        WILL | WONT | DO | DONT => {
                            self.state = State::Negotiation(byte);
                        }
                        SB => {
                            // Start of sub-negotiation; next byte is the option.
                            // We handle this in a slight simplification: put the
                            // option byte as the first byte collected. We'll
                            // actually transition properly on the next byte.
                            self.state = State::Negotiation(SB);
                        }
                        _ => {
                            // Simple command.
                            if let Some(cmd) = TelnetCommand::from_byte(byte) {
                                frames.push(TelnetFrame::Command(cmd));
                            }
                            self.state = State::Data;
                        }
                    }
                }
                State::Negotiation(cmd) => {
                    if cmd == SB {
                        // `byte` is the option code.
                        self.state = State::SubNegotiation {
                            option: byte,
                            buf: Vec::new(),
                        };
                    } else {
                        let command = TelnetCommand::from_byte(cmd)
                            .unwrap_or(TelnetCommand::NOP);
                        frames.push(TelnetFrame::Negotiation {
                            command,
                            option: byte,
                        });
                        self.state = State::Data;
                    }
                }
                State::SubNegotiation { option, mut buf } => {
                    if byte == IAC {
                        self.state = State::SubNegotiationIac { option, buf };
                    } else {
                        buf.push(byte);
                        self.state = State::SubNegotiation { option, buf };
                    }
                }
                State::SubNegotiationIac { option, mut buf } => {
                    match byte {
                        SE => {
                            frames.push(TelnetFrame::SubNegotiation {
                                option,
                                data: buf,
                            });
                            self.state = State::Data;
                        }
                        IAC => {
                            // Escaped IAC inside sub-negotiation.
                            buf.push(IAC);
                            self.state = State::SubNegotiation { option, buf };
                        }
                        _ => {
                            // Erroneous byte after IAC inside SB – recover
                            // by treating it as the end of sub-neg.
                            frames.push(TelnetFrame::SubNegotiation {
                                option,
                                data: buf,
                            });
                            // Process this byte as an IAC-following byte.
                            match byte {
                                WILL | WONT | DO | DONT => {
                                    self.state = State::Negotiation(byte);
                                }
                                SB => {
                                    self.state = State::Negotiation(SB);
                                }
                                _ => {
                                    if let Some(cmd) = TelnetCommand::from_byte(byte) {
                                        frames.push(TelnetFrame::Command(cmd));
                                    }
                                    self.state = State::Data;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Flush remaining data.
        self.flush_data(&mut frames);
        frames
    }

    /// Push accumulated data bytes as a `Data` frame.
    fn flush_data(&mut self, frames: &mut Vec<TelnetFrame>) {
        if !self.data_buf.is_empty() {
            let data = std::mem::take(&mut self.data_buf);
            frames.push(TelnetFrame::Data(data));
        }
    }

    /// Reset the codec state (e.g. on reconnect).
    pub fn reset(&mut self) {
        self.state = State::Data;
        self.data_buf.clear();
    }
}

impl Default for TelnetCodec {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telnet::protocol::*;

    fn decode_all(input: &[u8]) -> Vec<TelnetFrame> {
        let mut codec = TelnetCodec::new();
        codec.decode(input)
    }

    // ── Plain data ──────────────────────────────────────────────────

    #[test]
    fn decode_plain_data() {
        let frames = decode_all(b"hello world");
        assert_eq!(frames, vec![TelnetFrame::Data(b"hello world".to_vec())]);
    }

    #[test]
    fn decode_empty_input() {
        let frames = decode_all(b"");
        assert!(frames.is_empty());
    }

    // ── IAC escape ──────────────────────────────────────────────────

    #[test]
    fn decode_iac_escape() {
        let frames = decode_all(&[b'A', IAC, IAC, b'B']);
        assert_eq!(frames, vec![
            TelnetFrame::Data(vec![b'A']),
            TelnetFrame::Data(vec![IAC, b'B']),
        ]);
    }

    // ── Negotiation ─────────────────────────────────────────────────

    #[test]
    fn decode_will() {
        let frames = decode_all(&[IAC, WILL, 1]);
        assert_eq!(frames, vec![TelnetFrame::Negotiation {
            command: TelnetCommand::WILL,
            option: 1,
        }]);
    }

    #[test]
    fn decode_wont() {
        let frames = decode_all(&[IAC, WONT, 3]);
        assert_eq!(frames, vec![TelnetFrame::Negotiation {
            command: TelnetCommand::WONT,
            option: 3,
        }]);
    }

    #[test]
    fn decode_do() {
        let frames = decode_all(&[IAC, DO, 24]);
        assert_eq!(frames, vec![TelnetFrame::Negotiation {
            command: TelnetCommand::DO,
            option: 24,
        }]);
    }

    #[test]
    fn decode_dont() {
        let frames = decode_all(&[IAC, DONT, 31]);
        assert_eq!(frames, vec![TelnetFrame::Negotiation {
            command: TelnetCommand::DONT,
            option: 31,
        }]);
    }

    // ── Sub-negotiation ─────────────────────────────────────────────

    #[test]
    fn decode_subneg_ttype_send() {
        // IAC SB TTYPE SEND IAC SE
        let frames = decode_all(&[IAC, SB, 24, 1, IAC, SE]);
        assert_eq!(frames, vec![TelnetFrame::SubNegotiation {
            option: 24,
            data: vec![1],
        }]);
    }

    #[test]
    fn decode_subneg_with_escaped_iac() {
        // IAC SB 99 data(0x01 0xFF 0xFF 0x02) IAC SE
        let frames = decode_all(&[IAC, SB, 99, 1, IAC, IAC, 2, IAC, SE]);
        assert_eq!(frames, vec![TelnetFrame::SubNegotiation {
            option: 99,
            data: vec![1, IAC, 2],
        }]);
    }

    #[test]
    fn decode_subneg_empty_payload() {
        let frames = decode_all(&[IAC, SB, 42, IAC, SE]);
        assert_eq!(frames, vec![TelnetFrame::SubNegotiation {
            option: 42,
            data: vec![],
        }]);
    }

    // ── Simple commands ─────────────────────────────────────────────

    #[test]
    fn decode_nop() {
        let frames = decode_all(&[IAC, NOP]);
        assert_eq!(frames, vec![TelnetFrame::Command(TelnetCommand::NOP)]);
    }

    #[test]
    fn decode_ayt() {
        let frames = decode_all(&[IAC, AYT]);
        assert_eq!(frames, vec![TelnetFrame::Command(TelnetCommand::AreYouThere)]);
    }

    #[test]
    fn decode_ga() {
        let frames = decode_all(&[IAC, GA]);
        assert_eq!(frames, vec![TelnetFrame::Command(TelnetCommand::GoAhead)]);
    }

    // ── Mixed sequences ─────────────────────────────────────────────

    #[test]
    fn decode_mixed_data_and_commands() {
        let input = [
            b'H', b'i',
            IAC, WILL, 1,     // WILL ECHO
            b'!',
            IAC, DO, 3,       // DO SGA
            b'.',
        ];
        let frames = decode_all(&input);
        assert_eq!(frames.len(), 5);
        assert_eq!(frames[0], TelnetFrame::Data(vec![b'H', b'i']));
        assert_eq!(frames[1], TelnetFrame::Negotiation { command: TelnetCommand::WILL, option: 1 });
        assert_eq!(frames[2], TelnetFrame::Data(vec![b'!']));
        assert_eq!(frames[3], TelnetFrame::Negotiation { command: TelnetCommand::DO, option: 3 });
        assert_eq!(frames[4], TelnetFrame::Data(vec![b'.']));
    }

    #[test]
    fn decode_negotiation_burst() {
        // Multiple negotiation commands back-to-back with no data between.
        let input = [
            IAC, WILL, 1,
            IAC, WILL, 3,
            IAC, DO, 24,
            IAC, DO, 31,
        ];
        let frames = decode_all(&input);
        assert_eq!(frames.len(), 4);
    }

    // ── Chunked input ───────────────────────────────────────────────

    #[test]
    fn decode_chunked_negotiation() {
        let mut codec = TelnetCodec::new();
        // Split IAC WILL 1 across two chunks.
        let f1 = codec.decode(&[IAC]);
        assert!(f1.is_empty());
        let f2 = codec.decode(&[WILL]);
        assert!(f2.is_empty());
        let f3 = codec.decode(&[1, b'X']);
        assert_eq!(f3.len(), 2);
        assert_eq!(f3[0], TelnetFrame::Negotiation { command: TelnetCommand::WILL, option: 1 });
        assert_eq!(f3[1], TelnetFrame::Data(vec![b'X']));
    }

    #[test]
    fn decode_chunked_subneg() {
        let mut codec = TelnetCodec::new();
        let f1 = codec.decode(&[IAC, SB, 24]);
        assert!(f1.is_empty());
        let f2 = codec.decode(&[1]); // SEND
        assert!(f2.is_empty());
        let f3 = codec.decode(&[IAC, SE]);
        assert_eq!(f3, vec![TelnetFrame::SubNegotiation {
            option: 24,
            data: vec![1],
        }]);
    }

    // ── Reset ───────────────────────────────────────────────────────

    #[test]
    fn codec_reset() {
        let mut codec = TelnetCodec::new();
        codec.decode(&[IAC]); // partial state
        codec.reset();
        // After reset, should parse clean.
        let frames = codec.decode(b"hello");
        assert_eq!(frames, vec![TelnetFrame::Data(b"hello".to_vec())]);
    }

    // ── Error recovery ──────────────────────────────────────────────

    #[test]
    fn subneg_iac_then_unexpected_byte_recovers() {
        // Inside subneg, IAC followed by something other than SE or IAC.
        // Codec should emit the subneg frame and process the unexpected byte.
        let input = [IAC, SB, 99, 42, IAC, WILL, 1];
        let frames = decode_all(&input);
        // Expect: SubNeg(99, [42]) then Negotiation(WILL, 1)
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0], TelnetFrame::SubNegotiation { option: 99, data: vec![42] });
        assert_eq!(frames[1], TelnetFrame::Negotiation { command: TelnetCommand::WILL, option: 1 });
    }
}
