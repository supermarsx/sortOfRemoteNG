//! RFC 1143 Q-method option negotiation state machine.
//!
//! Tracks per-option state for both the local and remote sides and produces
//! the correct outgoing bytes in response to received WILL/WONT/DO/DONT
//! commands, avoiding negotiation loops.

use std::collections::HashMap;

use crate::telnet::protocol::{self, WILL, WONT, DO, DONT, IAC};
use crate::telnet::types::{OptionState, QState, TelnetOption};

/// Which side an option pertains to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// The local side (we WILL/WONT something).
    Local,
    /// The remote side (we DO/DONT something).
    Remote,
}

/// Manages option negotiation for all options on a connection.
#[derive(Debug)]
pub struct NegotiationManager {
    /// Per-option state keyed by the raw option byte.
    options: HashMap<u8, OptionState>,
    /// Options we will accept if the remote offers them.
    accepted_remote: Vec<u8>,
    /// Options we want to enable locally.
    desired_local: Vec<u8>,
}

impl NegotiationManager {
    /// Create a new negotiation manager.
    pub fn new() -> Self {
        Self {
            options: HashMap::new(),
            accepted_remote: Vec::new(),
            desired_local: Vec::new(),
        }
    }

    /// Mark an option as one we will accept (DO) if the remote offers (WILL).
    pub fn accept_remote(&mut self, option: u8) {
        if !self.accepted_remote.contains(&option) {
            self.accepted_remote.push(option);
        }
    }

    /// Mark an option as one we want to enable locally (WILL).
    pub fn desire_local(&mut self, option: u8) {
        if !self.desired_local.contains(&option) {
            self.desired_local.push(option);
        }
    }

    fn get_state(&mut self, option: u8) -> &mut OptionState {
        self.options.entry(option).or_default()
    }

    /// Is the given option enabled locally (i.e., we are WILLing)?
    pub fn is_local_enabled(&self, option: u8) -> bool {
        self.options.get(&option).map_or(false, |s| s.local == QState::Yes)
    }

    /// Is the given option enabled remotely (i.e., they are WILLing / we sent DO)?
    pub fn is_remote_enabled(&self, option: u8) -> bool {
        self.options.get(&option).map_or(false, |s| s.remote == QState::Yes)
    }

    /// Return a list of negotiated option descriptions for diagnostics.
    pub fn negotiated_options(&self) -> Vec<String> {
        let mut result = Vec::new();
        for (&opt, state) in &self.options {
            let name = TelnetOption::from_byte(opt)
                .map(|o| format!("{:?}", o))
                .unwrap_or_else(|| format!("Unknown({})", opt));
            if state.local == QState::Yes {
                result.push(format!("local:{}", name));
            }
            if state.remote == QState::Yes {
                result.push(format!("remote:{}", name));
            }
        }
        result.sort();
        result
    }

    /// Generate the initial negotiation bytes to send at connection start.
    /// This requests our desired local options (WILL) and sends DO for
    /// options we want the remote to enable.
    pub fn initial_negotiation(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        for &opt in &self.desired_local.clone() {
            let state = self.get_state(opt);
            if state.local == QState::No {
                state.local = QState::WantYes;
                out.extend_from_slice(&[IAC, WILL, opt]);
            }
        }
        for &opt in &self.accepted_remote.clone() {
            let state = self.get_state(opt);
            if state.remote == QState::No {
                state.remote = QState::WantYes;
                out.extend_from_slice(&[IAC, DO, opt]);
            }
        }
        out
    }

    /// Process an incoming WILL command from the remote.
    /// Returns bytes to send in response (possibly empty).
    pub fn receive_will(&mut self, option: u8) -> Vec<u8> {
        let accepted = self.accepted_remote.contains(&option);
        let state = self.get_state(option);
        match state.remote {
            QState::No => {
                if accepted {
                    state.remote = QState::Yes;
                    protocol::build_negotiation(DO, option)
                } else {
                    protocol::build_negotiation(DONT, option)
                }
            }
            QState::Yes => {
                // Already enabled – ignore (avoid loop).
                Vec::new()
            }
            QState::WantNo => {
                // Error: DONT answered by WILL.  Per RFC 1143, switch to No.
                state.remote = QState::No;
                Vec::new()
            }
            QState::WantNoOpposite => {
                // We had queued a DO after DONT. Now go to WantYes.
                state.remote = QState::Yes;
                Vec::new()
            }
            QState::WantYes => {
                // Our DO was accepted.
                state.remote = QState::Yes;
                Vec::new()
            }
            QState::WantYesOpposite => {
                // We wanted Yes then changed mind. Send DONT.
                state.remote = QState::WantNo;
                protocol::build_negotiation(DONT, option)
            }
        }
    }

    /// Process an incoming WONT command from the remote.
    /// Returns bytes to send in response (possibly empty).
    pub fn receive_wont(&mut self, option: u8) -> Vec<u8> {
        let state = self.get_state(option);
        match state.remote {
            QState::No => {
                // Already disabled – ignore.
                Vec::new()
            }
            QState::Yes => {
                state.remote = QState::No;
                protocol::build_negotiation(DONT, option)
            }
            QState::WantNo => {
                state.remote = QState::No;
                Vec::new()
            }
            QState::WantNoOpposite => {
                state.remote = QState::WantYes;
                protocol::build_negotiation(DO, option)
            }
            QState::WantYes => {
                state.remote = QState::No;
                Vec::new()
            }
            QState::WantYesOpposite => {
                state.remote = QState::No;
                Vec::new()
            }
        }
    }

    /// Process an incoming DO command from the remote (they want us to enable).
    /// Returns bytes to send in response (possibly empty).
    pub fn receive_do(&mut self, option: u8) -> Vec<u8> {
        let desired = self.desired_local.contains(&option);
        let state = self.get_state(option);
        match state.local {
            QState::No => {
                if desired {
                    state.local = QState::Yes;
                    protocol::build_negotiation(WILL, option)
                } else {
                    protocol::build_negotiation(WONT, option)
                }
            }
            QState::Yes => {
                // Already enabled – ignore.
                Vec::new()
            }
            QState::WantNo => {
                // Error: WONT answered by DO.
                state.local = QState::No;
                Vec::new()
            }
            QState::WantNoOpposite => {
                state.local = QState::Yes;
                Vec::new()
            }
            QState::WantYes => {
                state.local = QState::Yes;
                Vec::new()
            }
            QState::WantYesOpposite => {
                state.local = QState::WantNo;
                protocol::build_negotiation(WONT, option)
            }
        }
    }

    /// Process an incoming DONT command from the remote.
    /// Returns bytes to send in response (possibly empty).
    pub fn receive_dont(&mut self, option: u8) -> Vec<u8> {
        let state = self.get_state(option);
        match state.local {
            QState::No => {
                Vec::new()
            }
            QState::Yes => {
                state.local = QState::No;
                protocol::build_negotiation(WONT, option)
            }
            QState::WantNo => {
                state.local = QState::No;
                Vec::new()
            }
            QState::WantNoOpposite => {
                state.local = QState::WantYes;
                protocol::build_negotiation(WILL, option)
            }
            QState::WantYes => {
                state.local = QState::No;
                Vec::new()
            }
            QState::WantYesOpposite => {
                state.local = QState::No;
                Vec::new()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telnet::types::TelnetOption;

    fn mgr_accepting(opts: &[u8]) -> NegotiationManager {
        let mut m = NegotiationManager::new();
        for &o in opts {
            m.accept_remote(o);
        }
        m
    }

    fn mgr_desiring(opts: &[u8]) -> NegotiationManager {
        let mut m = NegotiationManager::new();
        for &o in opts {
            m.desire_local(o);
        }
        m
    }

    // ── receive_will ────────────────────────────────────────────────

    #[test]
    fn will_accepted_option_sends_do() {
        let echo = TelnetOption::Echo as u8;
        let mut m = mgr_accepting(&[echo]);
        let resp = m.receive_will(echo);
        assert_eq!(resp, vec![IAC, DO, echo]);
        assert!(m.is_remote_enabled(echo));
    }

    #[test]
    fn will_refused_option_sends_dont() {
        let echo = TelnetOption::Echo as u8;
        let mut m = NegotiationManager::new();
        let resp = m.receive_will(echo);
        assert_eq!(resp, vec![IAC, DONT, echo]);
        assert!(!m.is_remote_enabled(echo));
    }

    #[test]
    fn will_already_enabled_no_response() {
        let echo = TelnetOption::Echo as u8;
        let mut m = mgr_accepting(&[echo]);
        m.receive_will(echo);
        let resp = m.receive_will(echo);
        assert!(resp.is_empty());
    }

    // ── receive_wont ────────────────────────────────────────────────

    #[test]
    fn wont_from_yes_sends_dont() {
        let echo = TelnetOption::Echo as u8;
        let mut m = mgr_accepting(&[echo]);
        m.receive_will(echo); // now Yes
        let resp = m.receive_wont(echo);
        assert_eq!(resp, vec![IAC, DONT, echo]);
        assert!(!m.is_remote_enabled(echo));
    }

    #[test]
    fn wont_from_no_is_noop() {
        let echo = TelnetOption::Echo as u8;
        let mut m = NegotiationManager::new();
        let resp = m.receive_wont(echo);
        assert!(resp.is_empty());
    }

    // ── receive_do ──────────────────────────────────────────────────

    #[test]
    fn do_desired_option_sends_will() {
        let sga = TelnetOption::SuppressGoAhead as u8;
        let mut m = mgr_desiring(&[sga]);
        let resp = m.receive_do(sga);
        assert_eq!(resp, vec![IAC, WILL, sga]);
        assert!(m.is_local_enabled(sga));
    }

    #[test]
    fn do_undesired_option_sends_wont() {
        let sga = TelnetOption::SuppressGoAhead as u8;
        let mut m = NegotiationManager::new();
        let resp = m.receive_do(sga);
        assert_eq!(resp, vec![IAC, WONT, sga]);
        assert!(!m.is_local_enabled(sga));
    }

    #[test]
    fn do_already_enabled_is_noop() {
        let sga = TelnetOption::SuppressGoAhead as u8;
        let mut m = mgr_desiring(&[sga]);
        m.receive_do(sga);
        let resp = m.receive_do(sga);
        assert!(resp.is_empty());
    }

    // ── receive_dont ────────────────────────────────────────────────

    #[test]
    fn dont_from_yes_sends_wont() {
        let sga = TelnetOption::SuppressGoAhead as u8;
        let mut m = mgr_desiring(&[sga]);
        m.receive_do(sga);
        let resp = m.receive_dont(sga);
        assert_eq!(resp, vec![IAC, WONT, sga]);
        assert!(!m.is_local_enabled(sga));
    }

    #[test]
    fn dont_from_no_is_noop() {
        let mut m = NegotiationManager::new();
        let resp = m.receive_dont(1);
        assert!(resp.is_empty());
    }

    // ── initial negotiation ─────────────────────────────────────────

    #[test]
    fn initial_negotiation_sends_will_and_do() {
        let echo = TelnetOption::Echo as u8;
        let sga = TelnetOption::SuppressGoAhead as u8;
        let ttype = TelnetOption::TerminalType as u8;
        let naws = TelnetOption::NAWS as u8;

        let mut m = NegotiationManager::new();
        m.desire_local(ttype);
        m.desire_local(naws);
        m.accept_remote(echo);
        m.accept_remote(sga);

        let bytes = m.initial_negotiation();
        // Expect: WILL TTYPE, WILL NAWS, DO ECHO, DO SGA
        assert!(bytes.contains(&WILL));
        assert!(bytes.contains(&DO));
        assert!(bytes.len() == 12); // 4 commands × 3 bytes each
    }

    #[test]
    fn initial_negotiation_idempotent() {
        let mut m = NegotiationManager::new();
        m.desire_local(24);
        let bytes1 = m.initial_negotiation();
        let bytes2 = m.initial_negotiation();
        // Second call should produce nothing (already in WantYes).
        assert!(!bytes1.is_empty());
        assert!(bytes2.is_empty());
    }

    // ── negotiated_options ──────────────────────────────────────────

    #[test]
    fn negotiated_options_lists_enabled() {
        let echo = TelnetOption::Echo as u8;
        let sga = TelnetOption::SuppressGoAhead as u8;
        let mut m = mgr_accepting(&[echo, sga]);
        m.desire_local(sga);
        m.receive_will(echo);
        m.receive_do(sga);
        let opts = m.negotiated_options();
        assert!(opts.iter().any(|o| o.contains("Echo")));
        assert!(opts.iter().any(|o| o.contains("SuppressGoAhead")));
    }

    // ── Q-method state transitions ─────────────────────────────────

    #[test]
    fn want_yes_opposite_will() {
        let echo = TelnetOption::Echo as u8;
        let mut m = NegotiationManager::new();
        m.accept_remote(echo);
        // Manually set state to WantYesOpposite
        m.get_state(echo).remote = QState::WantYesOpposite;
        let resp = m.receive_will(echo);
        // Should transition to WantNo and send DONT
        assert_eq!(resp, vec![IAC, DONT, echo]);
    }

    #[test]
    fn want_no_will_error_recovery() {
        let echo = TelnetOption::Echo as u8;
        let mut m = NegotiationManager::new();
        m.get_state(echo).remote = QState::WantNo;
        let resp = m.receive_will(echo);
        // RFC 1143: error case, goes to No
        assert!(resp.is_empty());
        assert!(!m.is_remote_enabled(echo));
    }

    #[test]
    fn want_no_opposite_wont_requeues() {
        let echo = TelnetOption::Echo as u8;
        let mut m = mgr_accepting(&[echo]);
        m.get_state(echo).remote = QState::WantNoOpposite;
        let resp = m.receive_wont(echo);
        // Should transition to WantYes and send DO
        assert_eq!(resp, vec![IAC, DO, echo]);
    }
}
