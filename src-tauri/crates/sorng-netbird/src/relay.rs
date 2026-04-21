//! # NetBird Relay Infrastructure
//!
//! TURN/STUN relay monitoring — health probes, latency measurement,
//! region selection, and relay vs direct connection statistics.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Compute relay stats from the list of relays.
pub fn relay_stats(relays: &[TurnRelay]) -> RelayStats {
    RelayStats {
        total: relays.len() as u32,
        available: relays.iter().filter(|r| r.available).count() as u32,
        avg_latency_ms: avg_latency(relays),
        best_latency_ms: relays
            .iter()
            .filter_map(|r| r.latency_ms)
            .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)),
        protocols: protocol_counts(relays),
    }
}

/// Relay summary statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayStats {
    pub total: u32,
    pub available: u32,
    pub avg_latency_ms: Option<f64>,
    pub best_latency_ms: Option<f64>,
    pub protocols: ProtocolCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolCounts {
    pub udp: u32,
    pub tcp: u32,
    pub tls: u32,
}

fn avg_latency(relays: &[TurnRelay]) -> Option<f64> {
    let latencies: Vec<f64> = relays.iter().filter_map(|r| r.latency_ms).collect();
    if latencies.is_empty() {
        None
    } else {
        Some(latencies.iter().sum::<f64>() / latencies.len() as f64)
    }
}

fn protocol_counts(relays: &[TurnRelay]) -> ProtocolCounts {
    ProtocolCounts {
        udp: relays
            .iter()
            .filter(|r| r.protocol == TurnProtocol::Udp)
            .count() as u32,
        tcp: relays
            .iter()
            .filter(|r| r.protocol == TurnProtocol::Tcp)
            .count() as u32,
        tls: relays
            .iter()
            .filter(|r| r.protocol == TurnProtocol::Tls)
            .count() as u32,
    }
}

/// Select the relay with the lowest latency.
pub fn best_relay(relays: &[TurnRelay]) -> Option<&TurnRelay> {
    relays
        .iter()
        .filter(|r| r.available && r.latency_ms.is_some())
        .min_by(|a, b| {
            a.latency_ms
                .expect("filtered to is_some")
                .partial_cmp(&b.latency_ms.expect("filtered to is_some"))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

/// Group relays by region.
pub fn relays_by_region(
    relays: &[TurnRelay],
) -> std::collections::HashMap<String, Vec<&TurnRelay>> {
    let mut map: std::collections::HashMap<String, Vec<&TurnRelay>> =
        std::collections::HashMap::new();
    for r in relays {
        let region = r.region.clone().unwrap_or_else(|| "unknown".to_string());
        map.entry(region).or_default().push(r);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_relay(uri: &str, available: bool, latency: Option<f64>) -> TurnRelay {
        TurnRelay {
            uri: uri.to_string(),
            username: None,
            available,
            latency_ms: latency,
            region: Some("us-east".to_string()),
            protocol: TurnProtocol::Udp,
        }
    }

    #[test]
    fn test_relay_stats() {
        let relays = vec![
            make_relay("turn:a:3478", true, Some(20.0)),
            make_relay("turn:b:3478", true, Some(40.0)),
            make_relay("turn:c:3478", false, None),
        ];
        let stats = relay_stats(&relays);
        assert_eq!(stats.total, 3);
        assert_eq!(stats.available, 2);
        assert!((stats.avg_latency_ms.unwrap() - 30.0).abs() < 0.01);
        assert!((stats.best_latency_ms.unwrap() - 20.0).abs() < 0.01);
    }

    #[test]
    fn test_best_relay() {
        let relays = vec![
            make_relay("turn:a:3478", true, Some(50.0)),
            make_relay("turn:b:3478", true, Some(10.0)),
        ];
        let best = best_relay(&relays).unwrap();
        assert_eq!(best.uri, "turn:b:3478");
    }

    #[test]
    fn test_relays_by_region() {
        let relays = vec![
            make_relay("turn:a:3478", true, Some(10.0)),
            make_relay("turn:b:3478", true, Some(20.0)),
        ];
        let map = relays_by_region(&relays);
        assert_eq!(map.get("us-east").unwrap().len(), 2);
    }
}
