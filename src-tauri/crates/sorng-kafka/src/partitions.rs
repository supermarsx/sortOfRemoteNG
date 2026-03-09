use crate::admin::KafkaAdminClient;
use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Get information about a specific partition of a topic.
pub fn get_partition_info(
    admin: &KafkaAdminClient,
    topic: &str,
    partition_id: i32,
) -> KafkaResult<PartitionInfo> {
    let metadata = admin.get_metadata(Some(topic))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic)
        .ok_or_else(|| KafkaError::topic_not_found(topic))?;

    let part = topic_meta
        .partitions()
        .iter()
        .find(|p| p.id() == partition_id)
        .ok_or_else(|| {
            KafkaError::partition_error(format!(
                "Partition {} not found in topic '{}'",
                partition_id, topic
            ))
        })?;

    let (lo, hi) = admin.list_offsets(topic, partition_id).unwrap_or((0, 0));

    Ok(PartitionInfo {
        id: part.id(),
        leader: part.leader(),
        replicas: part.replicas().to_vec(),
        isr: part.isr().to_vec(),
        offline_replicas: Vec::new(),
        earliest_offset: Some(lo),
        latest_offset: Some(hi),
        size_bytes: None,
    })
}

/// List all partitions for a topic.
pub fn list_partitions(admin: &KafkaAdminClient, topic: &str) -> KafkaResult<Vec<PartitionInfo>> {
    let metadata = admin.get_metadata(Some(topic))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic)
        .ok_or_else(|| KafkaError::topic_not_found(topic))?;

    let mut partitions = Vec::new();
    for part in topic_meta.partitions() {
        let pid = part.id();
        let (lo, hi) = admin.list_offsets(topic, pid).unwrap_or((0, 0));

        partitions.push(PartitionInfo {
            id: pid,
            leader: part.leader(),
            replicas: part.replicas().to_vec(),
            isr: part.isr().to_vec(),
            offline_replicas: Vec::new(),
            earliest_offset: Some(lo),
            latest_offset: Some(hi),
            size_bytes: None,
        });
    }

    partitions.sort_by_key(|p| p.id);
    Ok(partitions)
}

/// Get the earliest and latest offsets for a single partition.
pub fn get_partition_offsets(
    admin: &KafkaAdminClient,
    topic: &str,
    partition: i32,
) -> KafkaResult<(i64, i64)> {
    admin.list_offsets(topic, partition)
}

/// Get the leader broker for a partition.
pub fn get_partition_leader(
    admin: &KafkaAdminClient,
    topic: &str,
    partition: i32,
) -> KafkaResult<i32> {
    let info = get_partition_info(admin, topic, partition)?;
    Ok(info.leader)
}

/// Get the replica set for a partition.
pub fn get_partition_replicas(
    admin: &KafkaAdminClient,
    topic: &str,
    partition: i32,
) -> KafkaResult<Vec<i32>> {
    let info = get_partition_info(admin, topic, partition)?;
    Ok(info.replicas)
}

/// Trigger preferred leader election for the given topic-partition pairs.
/// Each tuple is (topic, partition_id).
pub async fn preferred_leader_election(
    _admin: &KafkaAdminClient,
    _topic_partitions: &[(String, i32)],
) -> KafkaResult<()> {
    // rdkafka doesn't expose ElectLeaders API directly.
    // This would require protocol-level support.
    log::warn!("preferred_leader_election is not directly supported by rdkafka");
    Err(KafkaError::admin_error(
        "Preferred leader election requires direct protocol support not available in rdkafka",
    ))
}

/// Get under-replicated partitions for a specific topic.
pub fn get_under_replicated_partitions(
    admin: &KafkaAdminClient,
    topic: &str,
) -> KafkaResult<Vec<PartitionInfo>> {
    let partitions = list_partitions(admin, topic)?;
    let under_replicated: Vec<PartitionInfo> = partitions
        .into_iter()
        .filter(|p| {
            // A partition is under-replicated if ISR count < replica count
            p.isr.len() < p.replicas.len()
        })
        .collect();

    Ok(under_replicated)
}

/// Get all offline partitions across all topics.
pub fn get_offline_partitions(
    admin: &KafkaAdminClient,
) -> KafkaResult<Vec<(String, PartitionInfo)>> {
    let metadata = admin.get_metadata(None)?;
    let mut offline = Vec::new();

    for topic in metadata.topics() {
        let topic_name = topic.name().to_string();
        for part in topic.partitions() {
            // A partition is "offline" if the leader is -1
            if part.leader() < 0 {
                let pid = part.id();
                let (lo, hi) = admin.list_offsets(&topic_name, pid).unwrap_or((0, 0));

                offline.push((
                    topic_name.clone(),
                    PartitionInfo {
                        id: pid,
                        leader: part.leader(),
                        replicas: part.replicas().to_vec(),
                        isr: part.isr().to_vec(),
                        offline_replicas: part.replicas().to_vec(),
                        earliest_offset: Some(lo),
                        latest_offset: Some(hi),
                        size_bytes: None,
                    },
                ));
            }
        }
    }

    Ok(offline)
}

/// Count total under-replicated partitions across the entire cluster.
pub fn count_under_replicated_partitions(admin: &KafkaAdminClient) -> KafkaResult<i32> {
    let metadata = admin.get_metadata(None)?;
    let mut count = 0;

    for topic in metadata.topics() {
        for part in topic.partitions() {
            if part.isr().len() < part.replicas().len() {
                count += 1;
            }
        }
    }

    Ok(count)
}

/// Count total offline partitions across the entire cluster.
pub fn count_offline_partitions(admin: &KafkaAdminClient) -> KafkaResult<i32> {
    let metadata = admin.get_metadata(None)?;
    let mut count = 0;

    for topic in metadata.topics() {
        for part in topic.partitions() {
            if part.leader() < 0 {
                count += 1;
            }
        }
    }

    Ok(count)
}
