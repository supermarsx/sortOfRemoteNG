use std::collections::HashMap;

use crate::admin::KafkaAdminClient;
use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// List all brokers in the cluster.
pub fn list_brokers(admin: &KafkaAdminClient) -> KafkaResult<Vec<BrokerInfo>> {
    let (brokers, _, _) = admin.describe_cluster()?;
    Ok(brokers)
}

/// Get information about a specific broker.
pub fn get_broker(admin: &KafkaAdminClient, broker_id: i32) -> KafkaResult<BrokerInfo> {
    let (brokers, _, _) = admin.describe_cluster()?;
    brokers
        .into_iter()
        .find(|b| b.id == broker_id)
        .ok_or_else(|| KafkaError::broker_error(format!("Broker {} not found", broker_id)))
}

/// Get the controller broker.
pub fn get_controller(admin: &KafkaAdminClient) -> KafkaResult<Option<BrokerInfo>> {
    let (brokers, _, controller_id) = admin.describe_cluster()?;

    match controller_id {
        Some(id) => {
            let controller = brokers.into_iter().find(|b| b.id == id);
            Ok(controller)
        }
        None => {
            // Controller not directly exposed by rdkafka metadata.
            // Return the first broker as a best-effort guess.
            Ok(brokers.into_iter().next())
        }
    }
}

/// Get the cluster ID.
pub fn get_cluster_id(admin: &KafkaAdminClient) -> KafkaResult<Option<String>> {
    let (_, cluster_id, _) = admin.describe_cluster()?;
    Ok(cluster_id)
}

/// Get configuration for a specific broker.
pub async fn get_broker_config(
    admin: &KafkaAdminClient,
    broker_id: i32,
) -> KafkaResult<Vec<TopicConfig>> {
    // Verify broker exists
    let _ = get_broker(admin, broker_id)?;
    let broker_id_str = broker_id.to_string();

    // Use describe_configs with a broker resource specifier.
    // rdkafka's ResourceSpecifier doesn't have a Broker variant,
    // but we can query by treating it as a generic config resource.
    admin
        .describe_configs(&ResourceType::Cluster, &broker_id_str)
        .await
}

/// Update configuration for a specific broker.
pub async fn update_broker_config(
    admin: &KafkaAdminClient,
    broker_id: i32,
    configs: &HashMap<String, String>,
) -> KafkaResult<()> {
    // Verify broker exists
    let _ = get_broker(admin, broker_id)?;
    let broker_id_str = broker_id.to_string();

    admin
        .alter_configs(&ResourceType::Cluster, &broker_id_str, configs)
        .await
}

/// Get the broker count in the cluster.
pub fn get_broker_count(admin: &KafkaAdminClient) -> KafkaResult<i32> {
    let (brokers, _, _) = admin.describe_cluster()?;
    Ok(brokers.len() as i32)
}

/// List all broker IDs in the cluster.
pub fn list_broker_ids(admin: &KafkaAdminClient) -> KafkaResult<Vec<i32>> {
    let (brokers, _, _) = admin.describe_cluster()?;
    Ok(brokers.iter().map(|b| b.id).collect())
}

/// Get the number of partitions led by each broker.
pub fn get_partition_leaders(admin: &KafkaAdminClient) -> KafkaResult<HashMap<i32, i32>> {
    let metadata = admin.get_metadata(None)?;
    let mut leader_counts: HashMap<i32, i32> = HashMap::new();

    // Initialize all brokers with 0
    for broker in metadata.brokers() {
        leader_counts.insert(broker.id(), 0);
    }

    for topic in metadata.topics() {
        for partition in topic.partitions() {
            let leader = partition.leader();
            if leader >= 0 {
                *leader_counts.entry(leader).or_insert(0) += 1;
            }
        }
    }

    Ok(leader_counts)
}

/// Get the number of replicas hosted on each broker.
pub fn get_replica_counts(admin: &KafkaAdminClient) -> KafkaResult<HashMap<i32, i32>> {
    let metadata = admin.get_metadata(None)?;
    let mut replica_counts: HashMap<i32, i32> = HashMap::new();

    for broker in metadata.brokers() {
        replica_counts.insert(broker.id(), 0);
    }

    for topic in metadata.topics() {
        for partition in topic.partitions() {
            for &replica in partition.replicas() {
                *replica_counts.entry(replica).or_insert(0) += 1;
            }
        }
    }

    Ok(replica_counts)
}

/// Check if the cluster load is balanced (partition leaders evenly distributed).
pub fn check_balance(admin: &KafkaAdminClient) -> KafkaResult<BalanceReport> {
    let leader_counts = get_partition_leaders(admin)?;

    if leader_counts.is_empty() {
        return Ok(BalanceReport {
            balanced: true,
            min_partitions: 0,
            max_partitions: 0,
            average_partitions: 0.0,
            broker_loads: HashMap::new(),
        });
    }

    let counts: Vec<i32> = leader_counts.values().copied().collect();
    let min = *counts.iter().min().unwrap_or(&0);
    let max = *counts.iter().max().unwrap_or(&0);
    let avg = counts.iter().sum::<i32>() as f64 / counts.len() as f64;

    // Consider balanced if max - min <= 1 or within 20% of average
    let balanced = (max - min) <= 1 || (max as f64 - avg).abs() / avg < 0.2;

    Ok(BalanceReport {
        balanced,
        min_partitions: min,
        max_partitions: max,
        average_partitions: avg,
        broker_loads: leader_counts,
    })
}

/// Report on cluster partition balance.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BalanceReport {
    pub balanced: bool,
    pub min_partitions: i32,
    pub max_partitions: i32,
    pub average_partitions: f64,
    pub broker_loads: HashMap<i32, i32>,
}

/// Get detailed information about all brokers including their partition load.
pub fn get_brokers_with_load(admin: &KafkaAdminClient) -> KafkaResult<Vec<BrokerWithLoad>> {
    let brokers = list_brokers(admin)?;
    let leader_counts = get_partition_leaders(admin)?;
    let replica_counts = get_replica_counts(admin)?;

    let mut result = Vec::new();
    for broker in brokers {
        let leaders = leader_counts.get(&broker.id).copied().unwrap_or(0);
        let replicas = replica_counts.get(&broker.id).copied().unwrap_or(0);

        result.push(BrokerWithLoad {
            broker,
            leader_partitions: leaders,
            total_replicas: replicas,
        });
    }

    Ok(result)
}

/// Broker info combined with its partition load.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BrokerWithLoad {
    pub broker: BrokerInfo,
    pub leader_partitions: i32,
    pub total_replicas: i32,
}

/// Get topics that have partitions led by a specific broker.
pub fn get_broker_topics(admin: &KafkaAdminClient, broker_id: i32) -> KafkaResult<Vec<String>> {
    let metadata = admin.get_metadata(None)?;
    let mut topics = Vec::new();

    for topic in metadata.topics() {
        let has_partition_on_broker = topic
            .partitions()
            .iter()
            .any(|p| p.leader() == broker_id || p.replicas().contains(&broker_id));

        if has_partition_on_broker {
            topics.push(topic.name().to_string());
        }
    }

    topics.sort();
    topics.dedup();
    Ok(topics)
}
