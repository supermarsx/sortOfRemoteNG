//! Low-level Telnet protocol constants and frame types.
//!
//! This module provides the byte-level building blocks used by the codec
//! and negotiation layers. All constants follow RFC 854 / 855.

use crate::telnet::types::{TelnetCommand, TelnetOption};

// ── IAC byte constant ───────────────────────────────────────────────────

/// The "Interpret As Command" escape byte (0xFF / 255).
pub const IAC: u8 = 255;
pub const SE: u8 = 240;
pub const SB: u8 = 250;
pub const WILL: u8 = 251;
pub const WONT: u8 = 252;
pub const DO: u8 = 253;
pub const DONT: u8 = 254;
pub const NOP: u8 = 241;
pub const GA: u8 = 249;
pub const EOR: u8 = 239;
pub const BRK: u8 = 243;
pub const IP: u8 = 244;
pub const AO: u8 = 245;
pub const AYT: u8 = 246;
pub const EC: u8 = 247;
pub const EL: u8 = 248;
pub const DM: u8 = 242;

/// CR byte.
pub const CR: u8 = 13;
/// LF byte.
pub const LF: u8 = 10;
/// NUL byte.
pub const NUL: u8 = 0;

// ── Sub-negotiation constants ───────────────────────────────────────────

/// Sub-negotiation: IS (used in TTYPE, etc.).
pub const SN_IS: u8 = 0;
/// Sub-negotiation: SEND.
pub const SN_SEND: u8 = 1;

// ── Parsed telnet frame ─────────────────────────────────────────────────

/// A parsed unit from the telnet byte stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TelnetFrame {
    /// Plain data bytes (no IAC sequences).
    Data(Vec<u8>),

    /// A negotiation command: WILL, WONT, DO, DONT followed by an option byte.
    Negotiation {
        command: TelnetCommand,
        option: u8,
    },

    /// A sub-negotiation payload (everything between SB … SE, excluding the
    /// IAC SB header and IAC SE trailer). The option byte is the first byte.
    SubNegotiation {
        option: u8,
        data: Vec<u8>,
    },

    /// A simple IAC command (NOP, BRK, AYT, GA, …).
    Command(TelnetCommand),
}

// ── Frame builders ──────────────────────────────────────────────────────

/// Build a 3-byte IAC negotiation sequence.
pub fn build_negotiation(cmd: u8, option: u8) -> Vec<u8> {
    vec![IAC, cmd, option]
}

/// Build an IAC SB … IAC SE sub-negotiation frame.
/// `data` is the payload *after* the option byte.
pub fn build_subnegotiation(option: u8, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(5 + data.len());
    buf.push(IAC);
    buf.push(SB);
    buf.push(option);
    // IAC bytes inside sub-neg data must be escaped as IAC IAC.
    for &b in data {
        buf.push(b);
        if b == IAC {
            buf.push(IAC);
        }
    }
    buf.push(IAC);
    buf.push(SE);
    buf
}

/// Build a NAWS sub-negotiation (window size: cols × rows).
pub fn build_naws(cols: u16, rows: u16) -> Vec<u8> {
    let data = [
        (cols >> 8) as u8,
        (cols & 0xFF) as u8,
        (rows >> 8) as u8,
        (rows & 0xFF) as u8,
    ];
    build_subnegotiation(TelnetOption::NAWS as u8, &data)
}

/// Build a TTYPE IS sub-negotiation.
pub fn build_ttype_is(terminal_type: &str) -> Vec<u8> {
    let mut data = vec![SN_IS];
    data.extend_from_slice(terminal_type.as_bytes());
    build_subnegotiation(TelnetOption::TerminalType as u8, &data)
}

/// Build a TSPEED IS sub-negotiation.
pub fn build_tspeed_is(speed: &str) -> Vec<u8> {
    let mut data = vec![SN_IS];
    data.extend_from_slice(speed.as_bytes());
    build_subnegotiation(TelnetOption::TerminalSpeed as u8, &data)
}

/// Build a simple IAC command (e.g. IAC NOP, IAC AYT, IAC BRK).
pub fn build_command(cmd: u8) -> Vec<u8> {
    vec![IAC, cmd]
}

/// Escape IAC bytes in data for transmission.
/// In the telnet protocol, a literal 0xFF in data must be sent as 0xFF 0xFF.
pub fn escape_iac(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    for &b in data {
        out.push(b);
        if b == IAC {
            out.push(IAC);
        }
    }
    out
}

/// Encode a line for transmission with the appropriate line ending.
/// If `crlf` is true, appends CR LF; otherwise appends CR NUL (per RFC 854).
pub fn encode_line(line: &str, crlf: bool) -> Vec<u8> {
    let mut out = escape_iac(line.as_bytes());
    if crlf {
        out.push(CR);
        out.push(LF);
    } else {
        out.push(CR);
        out.push(NUL);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_negotiation_will_echo() {
        let frame = build_negotiation(WILL, 1);
        assert_eq!(frame, vec![IAC, WILL, 1]);
    }

    #[test]
    fn build_negotiation_dont_sga() {
        let frame = build_negotiation(DONT, 3);
        assert_eq!(frame, vec![IAC, DONT, 3]);
    }

    #[test]
    fn build_subneg_basic() {
        let frame = build_subnegotiation(24, &[0, b'v', b't', b'1', b'0', b'0']);
        // IAC SB 24 <data> IAC SE
        assert_eq!(frame[0], IAC);
        assert_eq!(frame[1], SB);
        assert_eq!(frame[2], 24);
        assert_eq!(frame[3..9], [0, b'v', b't', b'1', b'0', b'0']);
        assert_eq!(frame[9], IAC);
        assert_eq!(frame[10], SE);
    }

    #[test]
    fn build_subneg_escapes_iac_in_data() {
        let frame = build_subnegotiation(99, &[1, 255, 2]);
        // 1, 255, 255, 2 (IAC doubled)
        assert_eq!(frame, vec![IAC, SB, 99, 1, 255, 255, 2, IAC, SE]);
    }

    #[test]
    fn build_naws_standard() {
        let frame = build_naws(80, 24);
        assert_eq!(frame[0], IAC);
        assert_eq!(frame[1], SB);
        assert_eq!(frame[2], 31); // NAWS
        assert_eq!(frame[3], 0);  // cols high
        assert_eq!(frame[4], 80); // cols low
        assert_eq!(frame[5], 0);  // rows high
        assert_eq!(frame[6], 24); // rows low
        assert_eq!(frame[7], IAC);
        assert_eq!(frame[8], SE);
    }

    #[test]
    fn build_naws_large_window() {
        let frame = build_naws(300, 100);
        assert_eq!(frame[3], 1);   // 300 >> 8 = 1
        assert_eq!(frame[4], 44);  // 300 & 0xFF = 44
        assert_eq!(frame[5], 0);   // 100 >> 8 = 0
        assert_eq!(frame[6], 100); // 100 & 0xFF = 100
    }

    #[test]
    fn build_ttype_is_xterm() {
        let frame = build_ttype_is("xterm-256color");
        assert_eq!(frame[0], IAC);
        assert_eq!(frame[1], SB);
        assert_eq!(frame[2], 24); // TTYPE
        assert_eq!(frame[3], SN_IS);
        let term_bytes = &frame[4..frame.len() - 2];
        assert_eq!(term_bytes, b"xterm-256color");
        assert_eq!(frame[frame.len() - 2], IAC);
        assert_eq!(frame[frame.len() - 1], SE);
    }

    #[test]
    fn build_tspeed_is_default() {
        let frame = build_tspeed_is("38400,38400");
        assert_eq!(frame[2], 32); // TSPEED
        assert_eq!(frame[3], SN_IS);
    }

    #[test]
    fn build_command_nop() {
        assert_eq!(build_command(NOP), vec![IAC, NOP]);
    }

    #[test]
    fn build_command_ayt() {
        assert_eq!(build_command(AYT), vec![IAC, AYT]);
    }

    #[test]
    fn escape_iac_no_iac() {
        assert_eq!(escape_iac(b"hello"), b"hello".to_vec());
    }

    #[test]
    fn escape_iac_with_iac() {
        let input = [1, 255, 2, 255, 255, 3];
        let escaped = escape_iac(&input);
        assert_eq!(escaped, vec![1, 255, 255, 2, 255, 255, 255, 255, 3]);
    }

    #[test]
    fn encode_line_crlf() {
        let encoded = encode_line("ls", true);
        assert_eq!(encoded, vec![b'l', b's', CR, LF]);
    }

    #[test]
    fn encode_line_crnul() {
        let encoded = encode_line("ls", false);
        assert_eq!(encoded, vec![b'l', b's', CR, NUL]);
    }

    #[test]
    fn encode_line_escapes_iac() {
        // A line containing a literal 0xFF byte
        let line = std::str::from_utf8(&[b'a', b'b']).unwrap();
        let encoded = encode_line(line, true);
        assert_eq!(encoded, vec![b'a', b'b', CR, LF]);
    }

    #[test]
    fn telnet_frame_data_eq() {
        let f1 = TelnetFrame::Data(vec![1, 2, 3]);
        let f2 = TelnetFrame::Data(vec![1, 2, 3]);
        assert_eq!(f1, f2);
    }

    #[test]
    fn telnet_frame_negotiation_eq() {
        let f1 = TelnetFrame::Negotiation { command: TelnetCommand::WILL, option: 1 };
        let f2 = TelnetFrame::Negotiation { command: TelnetCommand::WILL, option: 1 };
        assert_eq!(f1, f2);
    }

    #[test]
    fn telnet_frame_command_neq() {
        let f1 = TelnetFrame::Command(TelnetCommand::NOP);
        let f2 = TelnetFrame::Command(TelnetCommand::AreYouThere);
        assert_ne!(f1, f2);
    }
}
