use std::collections::HashMap;
use std::time::Duration;

use crate::admin::KafkaAdminClient;
use crate::consumer_groups;
use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Get cluster-wide metrics aggregated across all brokers.
pub fn get_cluster_metrics(admin: &KafkaAdminClient) -> KafkaResult<ClusterMetrics> {
    let metadata = admin.get_metadata(None)?;

    let broker_count = metadata.brokers().len() as i32;
    let topic_count = metadata.topics().len() as i32;

    let mut total_partitions: i32 = 0;
    let mut under_replicated: i32 = 0;
    let mut offline_partitions: i32 = 0;

    for topic in metadata.topics() {
        for partition in topic.partitions() {
            total_partitions += 1;

            // Under-replicated: ISR < replicas
            if partition.isr().len() < partition.replicas().len() {
                under_replicated += 1;
            }

            // Offline: leader is -1
            if partition.leader() < 0 {
                offline_partitions += 1;
            }
        }
    }

    // Determine controller count: at most 1 in a healthy cluster
    let active_controllers = if broker_count > 0 { 1 } else { 0 };

    Ok(ClusterMetrics {
        brokers: broker_count,
        topics: topic_count,
        partitions: total_partitions,
        under_replicated_partitions: under_replicated,
        offline_partitions,
        active_controllers,
        // Rate metrics require JMX or statistics callback; provide defaults
        isr_shrinks: 0,
        isr_expands: 0,
        messages_in_per_sec: 0.0,
        bytes_in_per_sec: 0.0,
        bytes_out_per_sec: 0.0,
        fetch_request_rate: 0.0,
        produce_request_rate: 0.0,
        active_connections: 0,
        leader_election_rate: 0.0,
        unclean_leader_elections: 0,
        log_flush_rate: 0.0,
        request_queue_size: 0,
    })
}

/// Get per-broker metrics.
pub fn get_broker_metrics(
    admin: &KafkaAdminClient,
    broker_id: i32,
) -> KafkaResult<BrokerMetrics> {
    let metadata = admin.get_metadata(None)?;

    // Verify broker exists
    let broker = metadata
        .brokers()
        .iter()
        .find(|b| b.id() == broker_id)
        .ok_or_else(|| {
            KafkaError::broker_error(format!("Broker {} not found", broker_id))
        })?;

    let mut under_replicated = 0;
    let mut offline = 0;
    let mut is_controller = false;

    // Count partitions where this broker is a replica but not in ISR
    for topic in metadata.topics() {
        for partition in topic.partitions() {
            if partition.replicas().contains(&broker_id) && !partition.isr().contains(&broker_id) {
                under_replicated += 1;
            }
            if partition.leader() == broker_id && partition.isr().len() < partition.replicas().len()
            {
                // Leader of an under-replicated partition
            }
            if partition.leader() < 0 && partition.replicas().contains(&broker_id) {
                offline += 1;
            }
        }
    }

    // Controller detection: the metadata orig_broker_id is the broker we connected to,
    // not necessarily the controller. In standard Kafka, controller is not directly
    // exposed by rdkafka's metadata.
    let _ = metadata.orig_broker_id();

    Ok(BrokerMetrics {
        cpu_percent: 0.0,
        memory_used_bytes: 0,
        disk_used_bytes: 0,
        request_handler_avg_idle_percent: 0.0,
        network_processor_avg_idle_percent: 0.0,
        under_replicated_partitions: under_replicated,
        is_controller,
        active_controller_count: 0,
        offline_partitions: offline,
        io_in_per_sec: 0.0,
        io_out_per_sec: 0.0,
    })
}

/// Get per-topic metrics.
pub fn get_topic_metrics(
    admin: &KafkaAdminClient,
    topic_name: &str,
) -> KafkaResult<TopicMetrics> {
    let metadata = admin.get_metadata(Some(topic_name))?;
    let topic = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic_name)
        .ok_or_else(|| KafkaError::topic_not_found(topic_name))?;

    // Offset-based heuristic for message throughput estimation
    let mut _total_offset_range: i64 = 0;
    for partition in topic.partitions() {
        let (lo, hi) = admin
            .list_offsets(topic_name, partition.id())
            .unwrap_or((0, 0));
        _total_offset_range += hi.saturating_sub(lo);
    }

    // True rate metrics require JMX or Kafka metrics reporters
    Ok(TopicMetrics::default())
}

/// Get consumer group lag for all partitions of a topic.
pub fn get_consumer_group_lag(
    admin: &KafkaAdminClient,
    group_id: &str,
) -> KafkaResult<Vec<ConsumerGroupOffset>> {
    consumer_groups::get_consumer_group_offsets(admin, group_id)
}

/// Get per-partition metrics for a topic.
pub fn get_partition_metrics(
    admin: &KafkaAdminClient,
    topic_name: &str,
) -> KafkaResult<Vec<PartitionMetricInfo>> {
    let metadata = admin.get_metadata(Some(topic_name))?;
    let topic = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic_name)
        .ok_or_else(|| KafkaError::topic_not_found(topic_name))?;

    let mut partition_metrics = Vec::new();

    for partition in topic.partitions() {
        let pid = partition.id();
        let (lo, hi) = admin.list_offsets(topic_name, pid).unwrap_or((0, 0));
        let messages = hi.saturating_sub(lo);
        let isr_count = partition.isr().len() as i32;
        let replica_count = partition.replicas().len() as i32;
        let under_replicated = isr_count < replica_count;

        partition_metrics.push(PartitionMetricInfo {
            partition_id: pid,
            leader: partition.leader(),
            replica_count,
            isr_count,
            under_replicated,
            earliest_offset: lo,
            latest_offset: hi,
            message_count: messages,
            size_bytes: None,
        });
    }

    partition_metrics.sort_by_key(|p| p.partition_id);
    Ok(partition_metrics)
}

/// Per-partition metric information.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PartitionMetricInfo {
    pub partition_id: i32,
    pub leader: i32,
    pub replica_count: i32,
    pub isr_count: i32,
    pub under_replicated: bool,
    pub earliest_offset: i64,
    pub latest_offset: i64,
    pub message_count: i64,
    pub size_bytes: Option<i64>,
}

/// Get all under-replicated partitions across the cluster.
pub fn get_under_replicated_partitions(
    admin: &KafkaAdminClient,
) -> KafkaResult<Vec<UnderReplicatedPartition>> {
    let metadata = admin.get_metadata(None)?;
    let mut result = Vec::new();

    for topic in metadata.topics() {
        for partition in topic.partitions() {
            let replicas = partition.replicas();
            let isr = partition.isr();
            if isr.len() < replicas.len() {
                let out_of_sync: Vec<i32> = replicas
                    .iter()
                    .filter(|r| !isr.contains(r))
                    .copied()
                    .collect();

                result.push(UnderReplicatedPartition {
                    topic: topic.name().to_string(),
                    partition: partition.id(),
                    leader: partition.leader(),
                    replicas: replicas.to_vec(),
                    isr: isr.to_vec(),
                    out_of_sync_replicas: out_of_sync,
                });
            }
        }
    }

    Ok(result)
}

/// Information about an under-replicated partition.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UnderReplicatedPartition {
    pub topic: String,
    pub partition: i32,
    pub leader: i32,
    pub replicas: Vec<i32>,
    pub isr: Vec<i32>,
    pub out_of_sync_replicas: Vec<i32>,
}

/// Get a summary of cluster health.
pub fn get_cluster_health_summary(
    admin: &KafkaAdminClient,
) -> KafkaResult<ClusterHealthSummary> {
    let cluster_metrics = get_cluster_metrics(admin)?;
    let under_replicated = get_under_replicated_partitions(admin)?;

    let health_status = if cluster_metrics.offline_partitions > 0 {
        "critical"
    } else if cluster_metrics.under_replicated_partitions > 0 {
        "warning"
    } else {
        "healthy"
    };

    Ok(ClusterHealthSummary {
        status: health_status.to_string(),
        broker_count: cluster_metrics.brokers,
        topic_count: cluster_metrics.topics,
        partition_count: cluster_metrics.partitions,
        under_replicated_partitions: cluster_metrics.under_replicated_partitions,
        offline_partitions: cluster_metrics.offline_partitions,
        under_replicated_details: under_replicated,
    })
}

/// Summary of cluster health.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClusterHealthSummary {
    pub status: String,
    pub broker_count: i32,
    pub topic_count: i32,
    pub partition_count: i32,
    pub under_replicated_partitions: i32,
    pub offline_partitions: i32,
    pub under_replicated_details: Vec<UnderReplicatedPartition>,
}

/// Get lag for all consumer groups.
pub fn get_all_consumer_group_lag(
    admin: &KafkaAdminClient,
) -> KafkaResult<HashMap<String, Vec<ConsumerGroupOffset>>> {
    let groups = consumer_groups::list_consumer_groups(admin)?;
    let mut all_lag = HashMap::new();

    for group in &groups {
        if let Ok(offsets) = consumer_groups::get_consumer_group_offsets(admin, &group.group_id) {
            if !offsets.is_empty() {
                all_lag.insert(group.group_id.clone(), offsets);
            }
        }
    }

    Ok(all_lag)
}

/// Get metrics for all brokers in the cluster.
pub fn get_all_broker_metrics(
    admin: &KafkaAdminClient,
) -> KafkaResult<HashMap<i32, BrokerMetrics>> {
    let metadata = admin.get_metadata(None)?;
    let mut result = HashMap::new();

    for broker in metadata.brokers() {
        if let Ok(metrics) = get_broker_metrics(admin, broker.id()) {
            result.insert(broker.id(), metrics);
        }
    }

    Ok(result)
}
