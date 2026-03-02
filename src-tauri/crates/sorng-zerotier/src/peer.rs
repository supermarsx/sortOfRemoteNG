//! # ZeroTier Peer Management
//!
//! Peer information, path quality, direct/relay detection,
//! bonding status, latency measurement.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Extended peer detail with computed metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerDetail {
    pub address: String,
    pub version: Option<String>,
    pub role: ZtPeerRole,
    pub latency_ms: i32,
    pub connection_quality: ConnectionQuality,
    pub active_paths: Vec<PathDetail>,
    pub is_bonded: bool,
    pub total_paths: usize,
    pub preferred_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionQuality {
    Excellent,
    Good,
    Fair,
    Poor,
    Unreachable,
}

/// Detailed path information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathDetail {
    pub address: String,
    pub active: bool,
    pub preferred: bool,
    pub age_ms: u64,
    pub link_quality: Option<f64>,
    pub is_ipv6: bool,
    pub is_trusted: bool,
}

/// Build peer detail from raw peer.
pub fn build_peer_detail(peer: &ZtPeer) -> PeerDetail {
    let version = match (peer.version_major, peer.version_minor, peer.version_rev) {
        (Some(major), Some(minor), Some(rev)) => Some(format!("{}.{}.{}", major, minor, rev)),
        _ => None,
    };

    let active_paths: Vec<PathDetail> = peer
        .paths
        .iter()
        .filter(|p| p.active)
        .map(|p| PathDetail {
            address: p.address.clone(),
            active: p.active,
            preferred: p.preferred,
            age_ms: p.last_receive,
            link_quality: p.link_quality,
            is_ipv6: p.address.contains('[') || p.address.matches(':').count() > 1,
            is_trusted: p.trusted_path_id.is_some(),
        })
        .collect();

    let preferred_path = active_paths
        .iter()
        .find(|p| p.preferred)
        .map(|p| p.address.clone());

    let connection_quality = classify_quality(peer.latency, &active_paths);

    PeerDetail {
        address: peer.address.clone(),
        version,
        role: peer.role,
        latency_ms: peer.latency,
        connection_quality,
        active_paths,
        is_bonded: peer.is_bonded,
        total_paths: peer.paths.len(),
        preferred_path,
    }
}

/// Classify connection quality based on latency and path count.
fn classify_quality(latency: i32, active_paths: &[PathDetail]) -> ConnectionQuality {
    if active_paths.is_empty() {
        return ConnectionQuality::Unreachable;
    }

    let best_link = active_paths
        .iter()
        .filter_map(|p| p.link_quality)
        .fold(0.0f64, f64::max);

    match (latency, best_link) {
        (l, q) if l >= 0 && l < 20 && q > 0.9 => ConnectionQuality::Excellent,
        (l, q) if l >= 0 && l < 50 && q > 0.7 => ConnectionQuality::Good,
        (l, _) if l >= 0 && l < 150 => ConnectionQuality::Fair,
        (l, _) if l >= 150 => ConnectionQuality::Poor,
        (-1, _) => ConnectionQuality::Fair, // Unknown latency but has paths
        _ => ConnectionQuality::Poor,
    }
}

/// Build all peer details.
pub fn build_all_peer_details(peers: &[ZtPeer]) -> Vec<PeerDetail> {
    peers.iter().map(build_peer_detail).collect()
}

/// Filter peers by quality.
pub fn filter_by_quality(peers: &[PeerDetail], min_quality: ConnectionQuality) -> Vec<&PeerDetail> {
    let quality_rank = |q: &ConnectionQuality| match q {
        ConnectionQuality::Excellent => 4,
        ConnectionQuality::Good => 3,
        ConnectionQuality::Fair => 2,
        ConnectionQuality::Poor => 1,
        ConnectionQuality::Unreachable => 0,
    };

    let min_rank = quality_rank(&min_quality);
    peers
        .iter()
        .filter(|p| quality_rank(&p.connection_quality) >= min_rank)
        .collect()
}

/// Group peers by role.
pub fn group_by_role(peers: &[PeerDetail]) -> HashMap<String, Vec<&PeerDetail>> {
    let mut groups: HashMap<String, Vec<&PeerDetail>> = HashMap::new();
    for peer in peers {
        let role_name = match peer.role {
            ZtPeerRole::Leaf => "Leaf",
            ZtPeerRole::Moon => "Moon",
            ZtPeerRole::Planet => "Planet",
        };
        groups.entry(role_name.to_string()).or_default().push(peer);
    }
    groups
}

/// Compute aggregate peer stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerAggregateStats {
    pub total_peers: usize,
    pub reachable_peers: usize,
    pub direct_peers: usize,
    pub bonded_peers: usize,
    pub avg_latency_ms: f64,
    pub min_latency_ms: i32,
    pub max_latency_ms: i32,
    pub avg_link_quality: f64,
    pub quality_distribution: HashMap<String, usize>,
}

pub fn compute_peer_stats(peers: &[PeerDetail]) -> PeerAggregateStats {
    let reachable: Vec<&PeerDetail> = peers
        .iter()
        .filter(|p| p.connection_quality != ConnectionQuality::Unreachable)
        .collect();

    let bonded = peers.iter().filter(|p| p.is_bonded).count();
    let direct = peers.iter().filter(|p| p.preferred_path.is_some()).count();

    let latencies: Vec<i32> = reachable
        .iter()
        .filter(|p| p.latency_ms >= 0)
        .map(|p| p.latency_ms)
        .collect();

    let avg_latency = if !latencies.is_empty() {
        latencies.iter().sum::<i32>() as f64 / latencies.len() as f64
    } else {
        0.0
    };

    let link_qualities: Vec<f64> = peers
        .iter()
        .flat_map(|p| p.active_paths.iter())
        .filter_map(|p| p.link_quality)
        .collect();

    let avg_link = if !link_qualities.is_empty() {
        link_qualities.iter().sum::<f64>() / link_qualities.len() as f64
    } else {
        0.0
    };

    let mut quality_dist = HashMap::new();
    for peer in peers {
        let key = format!("{:?}", peer.connection_quality);
        *quality_dist.entry(key).or_insert(0usize) += 1;
    }

    PeerAggregateStats {
        total_peers: peers.len(),
        reachable_peers: reachable.len(),
        direct_peers: direct,
        bonded_peers: bonded,
        avg_latency_ms: avg_latency,
        min_latency_ms: latencies.iter().copied().min().unwrap_or(-1),
        max_latency_ms: latencies.iter().copied().max().unwrap_or(-1),
        avg_link_quality: avg_link,
        quality_distribution: quality_dist,
    }
}
