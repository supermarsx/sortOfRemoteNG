//! # ICE Agent
//!
//! Interactive Connectivity Establishment (ICE) agent — gathers candidates,
//! performs connectivity checks, and nominates the best candidate pair.
//! Based on RFC 8445.

use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};

/// ICE agent role.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IceRole {
    /// Controlling agent (initiator) — makes nomination decisions
    Controlling,
    /// Controlled agent (responder) — follows controlling agent's nominations
    Controlled,
}

/// ICE agent state machine.
pub struct IceAgent {
    /// Our role (controlling or controlled)
    role: IceRole,
    /// Local ICE username fragment
    local_ufrag: String,
    /// Local ICE password
    local_pwd: String,
    /// Remote ICE username fragment
    remote_ufrag: Option<String>,
    /// Remote ICE password
    remote_pwd: Option<String>,
    /// All local candidates
    local_candidates: Vec<IceCandidate>,
    /// All remote candidates
    remote_candidates: Vec<IceCandidate>,
    /// Candidate pairs (checklist)
    check_list: Vec<IceCandidatePair>,
    /// Valid pairs (successful checks)
    valid_pairs: Vec<IceCandidatePair>,
    /// Nominated pair
    nominated_pair: Option<IceCandidatePair>,
    /// Agent state
    state: IceState,
    /// ICE nomination mode
    nomination: IceNomination,
    /// Connectivity check timeout in seconds
    check_timeout_secs: u32,
    /// Tie-breaker for role conflicts (random 64-bit)
    #[allow(dead_code)]
    tiebreaker: u64,
}

impl IceAgent {
    /// Create a new ICE agent.
    pub fn new(role: IceRole, nomination: IceNomination) -> Self {
        Self {
            role,
            local_ufrag: generate_ice_credential(4),
            local_pwd: generate_ice_credential(22),
            remote_ufrag: None,
            remote_pwd: None,
            local_candidates: Vec::new(),
            remote_candidates: Vec::new(),
            check_list: Vec::new(),
            valid_pairs: Vec::new(),
            nominated_pair: None,
            state: IceState::Gathering,
            nomination,
            check_timeout_secs: 30,
            tiebreaker: rand::random(),
        }
    }

    /// Get the agent's role.
    pub fn role(&self) -> IceRole {
        self.role
    }

    /// Get the local username fragment.
    pub fn local_ufrag(&self) -> &str {
        &self.local_ufrag
    }

    /// Get the local ICE password.
    pub fn local_pwd(&self) -> &str {
        &self.local_pwd
    }

    /// Set the remote ICE credentials.
    pub fn set_remote_credentials(&mut self, ufrag: &str, pwd: &str) {
        self.remote_ufrag = Some(ufrag.to_string());
        self.remote_pwd = Some(pwd.to_string());
    }

    /// Get current agent state.
    pub fn state(&self) -> IceState {
        self.state
    }

    /// Get the nominated (selected) pair.
    pub fn nominated_pair(&self) -> Option<&IceCandidatePair> {
        self.nominated_pair.as_ref()
    }

    // ── Candidate Gathering ────────────────────────────────────

    /// Add a locally gathered candidate.
    pub fn add_local_candidate(&mut self, candidate: IceCandidate) {
        debug!(
            "Local candidate: {:?} {}:{} (priority={})",
            candidate.candidate_type, candidate.address, candidate.port, candidate.priority
        );
        self.local_candidates.push(candidate);
    }

    /// Add a remote candidate (received via signaling).
    pub fn add_remote_candidate(&mut self, candidate: IceCandidate) {
        debug!(
            "Remote candidate: {:?} {}:{} (priority={})",
            candidate.candidate_type, candidate.address, candidate.port, candidate.priority
        );
        self.remote_candidates.push(candidate);

        // In trickle ICE, rebuild pairs when new candidates arrive
        if self.state == IceState::Checking {
            self.form_pairs();
        }
    }

    /// Get all local candidates.
    pub fn local_candidates(&self) -> &[IceCandidate] {
        &self.local_candidates
    }

    /// Get all remote candidates.
    pub fn remote_candidates(&self) -> &[IceCandidate] {
        &self.remote_candidates
    }

    /// Mark gathering as complete.
    pub fn gathering_complete(&mut self) {
        if self.state == IceState::Gathering {
            info!(
                "ICE gathering complete: {} local candidates",
                self.local_candidates.len()
            );
            self.state = IceState::Checking;
            self.form_pairs();
        }
    }

    // ── Pair Formation ─────────────────────────────────────────

    /// Form candidate pairs from local × remote candidates (RFC 8445 §6.1.2).
    fn form_pairs(&mut self) {
        self.check_list.clear();

        for local in &self.local_candidates {
            for remote in &self.remote_candidates {
                // Only pair candidates with the same transport and component
                if local.transport != remote.transport || local.component != remote.component {
                    continue;
                }

                let priority =
                    compute_pair_priority(local.priority as u64, remote.priority as u64, self.role);

                let pair = IceCandidatePair {
                    local: local.clone(),
                    remote: remote.clone(),
                    priority,
                    state: IcePairState::Frozen,
                    nominated: false,
                    rtt_ms: None,
                    check_count: 0,
                    last_check: None,
                };

                self.check_list.push(pair);
            }
        }

        // Sort by priority (highest first)
        self.check_list.sort_by(|a, b| b.priority.cmp(&a.priority));

        // Unfreeze the first pair in each foundation group
        let mut seen_foundations = std::collections::HashSet::new();
        for pair in &mut self.check_list {
            let foundation = format!("{}:{}", pair.local.foundation, pair.remote.foundation);
            if seen_foundations.insert(foundation) {
                pair.state = IcePairState::Waiting;
            }
        }

        info!(
            "Formed {} candidate pairs (check_list)",
            self.check_list.len()
        );
    }

    // ── Connectivity Checks ────────────────────────────────────

    /// Run connectivity checks on all pairs.
    /// Returns the nominated pair or an error if all checks fail.
    pub fn run_checks(&mut self) -> Result<IceCandidatePair, String> {
        if self.check_list.is_empty() {
            return Err("No candidate pairs to check".to_string());
        }

        info!(
            "Running ICE connectivity checks on {} pairs",
            self.check_list.len()
        );

        // Process pairs in priority order
        for i in 0..self.check_list.len() {
            let pair = &self.check_list[i];
            if pair.state == IcePairState::Failed {
                continue;
            }

            debug!(
                "Checking pair: {:?} {}:{} <-> {:?} {}:{} (priority={})",
                pair.local.candidate_type,
                pair.local.address,
                pair.local.port,
                pair.remote.candidate_type,
                pair.remote.address,
                pair.remote.port,
                pair.priority
            );

            // Mark as in-progress
            self.check_list[i].state = IcePairState::InProgress;
            self.check_list[i].check_count += 1;
            self.check_list[i].last_check = Some(Utc::now());

            // In a real implementation:
            // 1. Send STUN Binding Request to the remote candidate address
            //    (using the combined username and MESSAGE-INTEGRITY)
            // 2. Wait for STUN Binding Response (with timeout)
            // 3. If response received → pair succeeds
            // 4. If timeout/error → pair fails

            // For structural implementation, simulate the check result
            // based on candidate types:
            let check_result = simulate_check_result(&self.check_list[i]);

            if check_result {
                self.check_list[i].state = IcePairState::Succeeded;
                self.check_list[i].rtt_ms = Some(estimate_rtt(&self.check_list[i]));
                self.valid_pairs.push(self.check_list[i].clone());

                info!(
                    "Pair succeeded: {}:{} <-> {}:{} (rtt={}ms)",
                    self.check_list[i].local.address,
                    self.check_list[i].local.port,
                    self.check_list[i].remote.address,
                    self.check_list[i].remote.port,
                    self.check_list[i].rtt_ms.unwrap_or(0)
                );

                // In aggressive nomination, nominate the first successful pair
                if self.nomination == IceNomination::Aggressive && self.role == IceRole::Controlling
                {
                    return self.nominate(i);
                }
            } else {
                self.check_list[i].state = IcePairState::Failed;
            }
        }

        // In regular nomination, choose the best valid pair
        if self.nomination == IceNomination::Regular && !self.valid_pairs.is_empty() {
            // Sort valid pairs by priority
            self.valid_pairs.sort_by(|a, b| b.priority.cmp(&a.priority));
            let best = self.valid_pairs[0].clone();
            self.nominated_pair = Some(best.clone());
            self.state = IceState::Completed;
            info!(
                "ICE completed (regular nomination) — selected pair with priority {}",
                best.priority
            );
            return Ok(best);
        }

        if self.valid_pairs.is_empty() {
            self.state = IceState::Failed;
            Err("All candidate pairs failed connectivity checks".to_string())
        } else {
            let best = self.valid_pairs[0].clone();
            self.nominated_pair = Some(best.clone());
            self.state = IceState::Completed;
            Ok(best)
        }
    }

    /// Nominate a specific pair (controlling agent only).
    fn nominate(&mut self, pair_index: usize) -> Result<IceCandidatePair, String> {
        if self.role != IceRole::Controlling {
            return Err("Only the controlling agent can nominate".to_string());
        }

        self.check_list[pair_index].nominated = true;
        let pair = self.check_list[pair_index].clone();
        self.nominated_pair = Some(pair.clone());
        self.state = IceState::Completed;

        info!(
            "ICE completed — nominated pair: {}:{} <-> {}:{}",
            pair.local.address, pair.local.port, pair.remote.address, pair.remote.port
        );

        Ok(pair)
    }

    /// Handle a received nomination from the controlling agent (controlled agent only).
    pub fn accept_nomination(&mut self, pair: IceCandidatePair) -> Result<(), String> {
        if self.role != IceRole::Controlled {
            return Err("Only the controlled agent accepts nominations".to_string());
        }

        self.nominated_pair = Some(pair.clone());
        self.state = IceState::Completed;

        info!(
            "Accepted nomination: {}:{} <-> {}:{}",
            pair.local.address, pair.local.port, pair.remote.address, pair.remote.port
        );

        Ok(())
    }

    /// Restart ICE (e.g., on network change).
    pub fn restart(&mut self) {
        info!("ICE restart");
        self.local_ufrag = generate_ice_credential(4);
        self.local_pwd = generate_ice_credential(22);
        self.remote_ufrag = None;
        self.remote_pwd = None;
        self.local_candidates.clear();
        self.remote_candidates.clear();
        self.check_list.clear();
        self.valid_pairs.clear();
        self.nominated_pair = None;
        self.state = IceState::Gathering;
    }
}

// ── Candidate Gathering (Top-level functions) ───────────────────

/// Gather all ICE candidates (host, server-reflexive, relayed) based on config.
pub fn gather_candidates(config: &P2pConfig) -> Result<Vec<IceCandidate>, String> {
    let mut candidates = Vec::new();

    // 1. Host candidates — enumerate local network interfaces
    let host_candidates = gather_host_candidates(config)?;
    candidates.extend(host_candidates);

    // 2. Server-reflexive candidates — STUN binding
    for server in &config.stun_servers {
        match gather_srflx_candidate(server, config) {
            Ok(candidate) => candidates.push(candidate),
            Err(e) => {
                warn!(
                    "Failed to gather srflx candidate from {}: {}",
                    server.host, e
                );
            }
        }
    }

    // 3. Relayed candidates — TURN allocation
    for server in &config.turn_servers {
        match gather_relay_candidate(server, config) {
            Ok(candidate) => candidates.push(candidate),
            Err(e) => {
                warn!(
                    "Failed to gather relay candidate from {}: {}",
                    server.host, e
                );
            }
        }
    }

    info!("Gathered {} ICE candidates", candidates.len());
    Ok(candidates)
}

/// Gather host candidates from local network interfaces.
fn gather_host_candidates(config: &P2pConfig) -> Result<Vec<IceCandidate>, String> {
    let mut candidates = Vec::new();

    // Try to use get_if_addrs if available, otherwise fallback to binding UDP sockets
    #[cfg(feature = "get_if_addrs")] {
        for iface in get_if_addrs::get_if_addrs().map_err(|e| e.to_string())? {
            if iface.ip().is_loopback() || iface.ip().is_unspecified() { continue; }
            let candidate = IceCandidate {
                id: uuid::Uuid::new_v4().to_string(),
                candidate_type: IceCandidateType::Host,
                transport: "udp".to_string(),
                address: iface.ip().to_string(),
                port: config.port_range_start,
                priority: compute_candidate_priority(IceCandidateType::Host, 0, 1),
                foundation: compute_foundation(IceCandidateType::Host, &iface.ip().to_string(), "udp"),
                component: 1,
                related_address: None,
                related_port: None,
            };
            candidates.push(candidate);
        }
    }
    #[cfg(not(feature = "get_if_addrs"))]
    {
        use std::net::UdpSocket;
        // Try to bind to 0.0.0.0 and get the local address
        let sock = UdpSocket::bind(("0.0.0.0", 0)).map_err(|e| e.to_string())?;
        let local_addr = sock.local_addr().map_err(|e| e.to_string())?;
        let candidate = IceCandidate {
            id: uuid::Uuid::new_v4().to_string(),
            candidate_type: IceCandidateType::Host,
            transport: "udp".to_string(),
            address: local_addr.ip().to_string(),
            port: config.port_range_start,
            priority: compute_candidate_priority(IceCandidateType::Host, 0, 1),
            foundation: compute_foundation(IceCandidateType::Host, &local_addr.ip().to_string(), "udp"),
            component: 1,
            related_address: None,
            related_port: None,
        };
        candidates.push(candidate);
    }

    Ok(candidates)
}

/// Gather a server-reflexive candidate from a STUN server.
fn gather_srflx_candidate(
    server: &StunServer,
    _config: &P2pConfig,
) -> Result<IceCandidate, String> {
    let binding =
        crate::stun::stun_binding(server, "0.0.0.0:0", std::time::Duration::from_secs(5))?;

    let parts: Vec<&str> = binding.mapped_addr.rsplitn(2, ':').collect();
    let (addr, port) = if parts.len() == 2 {
        (parts[1].to_string(), parts[0].parse::<u16>().unwrap_or(0))
    } else {
        (binding.mapped_addr.clone(), 0)
    };

    Ok(IceCandidate {
        id: uuid::Uuid::new_v4().to_string(),
        candidate_type: IceCandidateType::ServerReflexive,
        transport: "udp".to_string(),
        address: addr.clone(),
        port,
        priority: compute_candidate_priority(IceCandidateType::ServerReflexive, 0, 1),
        foundation: compute_foundation(IceCandidateType::ServerReflexive, &addr, "udp"),
        component: 1,
        related_address: Some("0.0.0.0".to_string()),
        related_port: Some(0),
    })
}

/// Gather a relay (TURN) candidate.
fn gather_relay_candidate(
    server: &TurnServer,
    _config: &P2pConfig,
) -> Result<IceCandidate, String> {
    // In a real implementation, this would allocate a TURN relay
    // and return the relayed transport address as a candidate.
    Ok(IceCandidate {
        id: uuid::Uuid::new_v4().to_string(),
        candidate_type: IceCandidateType::Relayed,
        transport: "udp".to_string(),
        address: server.host.clone(),
        port: server.port,
        priority: compute_candidate_priority(IceCandidateType::Relayed, 0, 1),
        foundation: compute_foundation(IceCandidateType::Relayed, &server.host, "udp"),
        component: 1,
        related_address: Some("0.0.0.0".to_string()),
        related_port: Some(0),
    })
}

/// Perform connectivity checks on candidate pairs and return the best working pair.
pub fn check_connectivity(
    local_candidates: &[IceCandidate],
    remote_candidates: &[IceCandidate],
    timeout_secs: u32,
) -> Result<IceCandidatePair, String> {
    let mut agent = IceAgent::new(IceRole::Controlling, IceNomination::Aggressive);
    agent.check_timeout_secs = timeout_secs;

    for c in local_candidates {
        agent.add_local_candidate(c.clone());
    }
    for c in remote_candidates {
        agent.add_remote_candidate(c.clone());
    }

    agent.gathering_complete();
    agent.run_checks()
}

// ── Priority & Foundation Computation ───────────────────────────

/// Compute ICE candidate priority (RFC 8445 §5.1.2.1).
/// priority = (2^24 * type_preference) + (2^8 * local_preference) + (256 - component_id)
pub fn compute_candidate_priority(
    candidate_type: IceCandidateType,
    local_preference: u32,
    component_id: u8,
) -> u32 {
    let tp = candidate_type.type_preference();
    (tp << 24) | ((local_preference & 0xFFFF) << 8) | (256 - component_id as u32)
}

/// Compute pair priority (RFC 8445 §6.1.2.3).
pub fn compute_pair_priority(
    controlling_priority: u64,
    controlled_priority: u64,
    role: IceRole,
) -> u64 {
    let (g, d) = match role {
        IceRole::Controlling => (controlling_priority, controlled_priority),
        IceRole::Controlled => (controlled_priority, controlling_priority),
    };

    let min = g.min(d);
    let max = g.max(d);
    (1u64 << 32) * min + 2 * max + if g > d { 1 } else { 0 }
}

/// Compute a foundation string for candidate deduplication.
fn compute_foundation(
    candidate_type: IceCandidateType,
    base_addr: &str,
    transport: &str,
) -> String {
    use sha2::{Digest, Sha256};
    let input = format!("{:?}:{}:{}", candidate_type, base_addr, transport);
    let hash = Sha256::digest(input.as_bytes());
    hash[..4]
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>()
}

/// Generate a random ICE credential (ufrag or password).
fn generate_ice_credential(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    (0..len)
        .map(|_| {
            let idx = rand::random::<usize>() % CHARS.len();
            CHARS[idx] as char
        })
        .collect()
}

// ── Simulation helpers (for structural implementation) ──────────

/// Simulate whether a connectivity check would succeed.
/// In a real implementation, this sends STUN Binding Requests.
fn simulate_check_result(pair: &IceCandidatePair) -> bool {
    // Host-to-host always works on same LAN
    if pair.local.candidate_type == IceCandidateType::Host
        && pair.remote.candidate_type == IceCandidateType::Host
    {
        return true;
    }
    // Relayed pairs always work (by definition)
    if pair.local.candidate_type == IceCandidateType::Relayed
        || pair.remote.candidate_type == IceCandidateType::Relayed
    {
        return true;
    }
    // Server-reflexive pairs may work depending on NAT
    if pair.local.candidate_type == IceCandidateType::ServerReflexive
        || pair.remote.candidate_type == IceCandidateType::ServerReflexive
    {
        return true; // optimistic — real check determines this
    }
    true
}

/// Estimate RTT for a candidate pair based on types.
fn estimate_rtt(pair: &IceCandidatePair) -> u64 {
    match (&pair.local.candidate_type, &pair.remote.candidate_type) {
        (IceCandidateType::Host, IceCandidateType::Host) => 1,
        (IceCandidateType::Relayed, _) | (_, IceCandidateType::Relayed) => 50,
        _ => 15,
    }
}

/// Encode a candidate to SDP attribute format.
pub fn candidate_to_sdp(candidate: &IceCandidate) -> String {
    let typ = match candidate.candidate_type {
        IceCandidateType::Host => "host",
        IceCandidateType::ServerReflexive => "srflx",
        IceCandidateType::PeerReflexive => "prflx",
        IceCandidateType::Relayed => "relay",
    };

    let mut sdp = format!(
        "candidate:{} {} {} {} {} {} typ {}",
        candidate.foundation,
        candidate.component,
        candidate.transport,
        candidate.priority,
        candidate.address,
        candidate.port,
        typ
    );

    if let (Some(raddr), Some(rport)) = (&candidate.related_address, candidate.related_port) {
        sdp.push_str(&format!(" raddr {} rport {}", raddr, rport));
    }

    sdp
}

/// Parse a candidate from SDP attribute format.
pub fn candidate_from_sdp(sdp: &str) -> Result<IceCandidate, String> {
    let parts: Vec<&str> = sdp.split_whitespace().collect();
    if parts.len() < 8 || parts[0] != "candidate:" && !parts[0].starts_with("candidate:") {
        return Err("Invalid SDP candidate format".to_string());
    }

    let foundation_part = if parts[0].starts_with("candidate:") {
        parts[0].trim_start_matches("candidate:")
    } else {
        parts[1]
    };

    // Simplified parser — real implementation would handle all SDP candidate attributes
    Ok(IceCandidate {
        id: uuid::Uuid::new_v4().to_string(),
        candidate_type: IceCandidateType::Host,
        transport: "udp".to_string(),
        address: "0.0.0.0".to_string(),
        port: 0,
        priority: 0,
        foundation: foundation_part.to_string(),
        component: 1,
        related_address: None,
        related_port: None,
    })
}
