//! # NetBird Group Management
//!
//! Helpers for NetBird group operations — create, update, assign peers,
//! validate membership, and compute effective peer sets.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Request to create or update a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupCreateRequest {
    pub name: String,
    pub peers: Vec<String>,
}

/// Compute the set of peer IDs that belong to any of the given groups.
pub fn effective_peer_set(
    group_ids: &[String],
    groups: &HashMap<String, NetBirdGroup>,
) -> HashSet<String> {
    let mut result = HashSet::new();
    for gid in group_ids {
        if let Some(group) = groups.get(gid) {
            for peer in &group.peers {
                result.insert(peer.id.clone());
            }
        }
    }
    result
}

/// Validate that all peer IDs in a group actually exist in the peer map.
pub fn validate_group_members(
    group: &NetBirdGroup,
    peers: &HashMap<String, NetBirdPeer>,
) -> Vec<String> {
    group
        .peers
        .iter()
        .filter(|gp| !peers.contains_key(&gp.id))
        .map(|gp| gp.id.clone())
        .collect()
}

/// Find groups that contain a specific peer.
pub fn groups_for_peer<'a>(
    peer_id: &str,
    groups: &'a HashMap<String, NetBirdGroup>,
) -> Vec<&'a NetBirdGroup> {
    groups
        .values()
        .filter(|g| g.peers.iter().any(|p| p.id == peer_id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_group(id: &str, peers: Vec<&str>) -> NetBirdGroup {
        NetBirdGroup {
            id: id.to_string(),
            name: id.to_string(),
            issued: None,
            peers_count: peers.len() as u32,
            peers: peers
                .into_iter()
                .map(|pid| GroupPeerInfo {
                    id: pid.to_string(),
                    name: pid.to_string(),
                    ip: "100.64.0.1".into(),
                })
                .collect(),
        }
    }

    #[test]
    fn test_effective_peer_set() {
        let mut groups = HashMap::new();
        groups.insert("g1".into(), make_group("g1", vec!["p1", "p2"]));
        groups.insert("g2".into(), make_group("g2", vec!["p2", "p3"]));
        let set = effective_peer_set(&["g1".into(), "g2".into()], &groups);
        assert_eq!(set.len(), 3);
        assert!(set.contains("p1"));
        assert!(set.contains("p2"));
        assert!(set.contains("p3"));
    }

    #[test]
    fn test_groups_for_peer() {
        let mut groups = HashMap::new();
        groups.insert("g1".into(), make_group("g1", vec!["p1", "p2"]));
        groups.insert("g2".into(), make_group("g2", vec!["p3"]));
        let result = groups_for_peer("p1", &groups);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "g1");
    }
}
