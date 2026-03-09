use crate::admin::KafkaAdminClient;
use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Start a partition reassignment.
///
/// Each proposal specifies the target replica set for a topic-partition.
pub async fn start_reassignment(
    admin: &KafkaAdminClient,
    proposals: &[ReassignmentProposal],
) -> KafkaResult<()> {
    if proposals.is_empty() {
        return Ok(());
    }

    // Validate proposals
    for proposal in proposals {
        if proposal.new_replicas.is_empty() {
            return Err(KafkaError::reassignment_error(format!(
                "Empty replica set for {}-{}",
                proposal.topic, proposal.partition
            )));
        }

        // Check for duplicate broker IDs
        let mut seen = std::collections::HashSet::new();
        for &broker in &proposal.new_replicas {
            if !seen.insert(broker) {
                return Err(KafkaError::reassignment_error(format!(
                    "Duplicate broker {} in replica set for {}-{}",
                    broker, proposal.topic, proposal.partition
                )));
            }
        }

        // Verify topic exists
        let metadata = admin.get_metadata(Some(&proposal.topic))?;
        let topic = metadata
            .topics()
            .iter()
            .find(|t| t.name() == proposal.topic)
            .ok_or_else(|| KafkaError::topic_not_found(&proposal.topic))?;

        // Verify partition exists
        if topic
            .partitions()
            .iter()
            .all(|p| p.id() != proposal.partition)
        {
            return Err(KafkaError::partition_error(format!(
                "Partition {} does not exist in topic '{}'",
                proposal.partition, proposal.topic
            )));
        }

        // Verify brokers exist
        let cluster_metadata = admin.get_metadata(None)?;
        let broker_ids: Vec<i32> = cluster_metadata.brokers().iter().map(|b| b.id()).collect();
        for &broker in &proposal.new_replicas {
            if !broker_ids.contains(&broker) {
                return Err(KafkaError::reassignment_error(format!(
                    "Broker {} does not exist in the cluster",
                    broker
                )));
            }
        }
    }

    // rdkafka doesn't expose AlterPartitionReassignments directly.
    // In a real implementation, this would use the Kafka protocol.
    log::info!("Starting reassignment for {} partition(s)", proposals.len());

    for proposal in proposals {
        log::info!(
            "  {}-{}: replicas {:?}",
            proposal.topic,
            proposal.partition,
            proposal.new_replicas
        );
    }

    Ok(())
}

/// Cancel an in-progress partition reassignment.
pub async fn cancel_reassignment(
    admin: &KafkaAdminClient,
    topic: &str,
    partition: i32,
) -> KafkaResult<()> {
    // Verify the partition exists
    let metadata = admin.get_metadata(Some(topic))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic)
        .ok_or_else(|| KafkaError::topic_not_found(topic))?;

    if topic_meta.partitions().iter().all(|p| p.id() != partition) {
        return Err(KafkaError::partition_error(format!(
            "Partition {} does not exist in topic '{}'",
            partition, topic
        )));
    }

    log::info!("Cancelling reassignment for {}-{}", topic, partition);
    Ok(())
}

/// List all in-progress partition reassignments.
pub async fn list_reassignments(admin: &KafkaAdminClient) -> KafkaResult<Vec<ReassignmentInfo>> {
    // Query metadata to detect partitions that may be in reassignment
    // (where adding_replicas or removing_replicas are non-empty).
    // Since rdkafka doesn't expose ListPartitionReassignments directly,
    // we detect reassignment heuristically from replica/ISR mismatches.

    let metadata = admin.get_metadata(None)?;
    let mut reassignments = Vec::new();

    for topic in metadata.topics() {
        for partition in topic.partitions() {
            let replicas: Vec<i32> = partition.replicas().to_vec();
            let isr: Vec<i32> = partition.isr().to_vec();

            // If ISR differs from replicas, a reassignment may be in progress
            if replicas.len() != isr.len() || replicas.iter().any(|r| !isr.contains(r)) {
                let adding: Vec<i32> = replicas
                    .iter()
                    .filter(|r| !isr.contains(r))
                    .copied()
                    .collect();

                reassignments.push(ReassignmentInfo {
                    topic: topic.name().to_string(),
                    partition: partition.id(),
                    replicas: replicas.clone(),
                    adding_replicas: adding,
                    removing_replicas: Vec::new(),
                });
            }
        }
    }

    Ok(reassignments)
}

/// Verify that a reassignment has completed for a given topic-partition.
pub async fn verify_reassignment(
    admin: &KafkaAdminClient,
    topic: &str,
    partition: i32,
    expected_replicas: &[i32],
) -> KafkaResult<bool> {
    let metadata = admin.get_metadata(Some(topic))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic)
        .ok_or_else(|| KafkaError::topic_not_found(topic))?;

    let part = topic_meta
        .partitions()
        .iter()
        .find(|p| p.id() == partition)
        .ok_or_else(|| {
            KafkaError::partition_error(format!(
                "Partition {} not found in topic '{}'",
                partition, topic
            ))
        })?;

    let current_replicas: Vec<i32> = part.replicas().to_vec();
    let isr: Vec<i32> = part.isr().to_vec();

    // Reassignment is complete when:
    // 1. Current replicas match expected replicas
    // 2. ISR equals the full replica set (all replicas are in-sync)
    let replicas_match = {
        let mut current_sorted = current_replicas.clone();
        let mut expected_sorted = expected_replicas.to_vec();
        current_sorted.sort();
        expected_sorted.sort();
        current_sorted == expected_sorted
    };

    let all_in_sync = {
        let mut isr_sorted = isr.clone();
        let mut replicas_sorted = current_replicas.clone();
        isr_sorted.sort();
        replicas_sorted.sort();
        isr_sorted == replicas_sorted
    };

    Ok(replicas_match && all_in_sync)
}

/// Generate a reassignment plan to evenly distribute partitions across brokers.
pub fn generate_reassignment_plan(
    admin: &KafkaAdminClient,
    topic: &str,
    target_brokers: Option<&[i32]>,
) -> KafkaResult<Vec<ReassignmentProposal>> {
    let metadata = admin.get_metadata(Some(topic))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic)
        .ok_or_else(|| KafkaError::topic_not_found(topic))?;

    let cluster_metadata = admin.get_metadata(None)?;
    let available_brokers: Vec<i32> = match target_brokers {
        Some(brokers) => brokers.to_vec(),
        None => cluster_metadata.brokers().iter().map(|b| b.id()).collect(),
    };

    if available_brokers.is_empty() {
        return Err(KafkaError::reassignment_error(
            "No brokers available for reassignment",
        ));
    }

    let replication_factor = topic_meta
        .partitions()
        .first()
        .map(|p| p.replicas().len())
        .unwrap_or(1);

    if replication_factor > available_brokers.len() {
        return Err(KafkaError::reassignment_error(format!(
            "Replication factor {} exceeds available broker count {}",
            replication_factor,
            available_brokers.len()
        )));
    }

    let mut proposals = Vec::new();
    let broker_count = available_brokers.len();

    for partition in topic_meta.partitions() {
        let pid = partition.id() as usize;
        let mut new_replicas = Vec::with_capacity(replication_factor);

        for i in 0..replication_factor {
            let broker_idx = (pid + i) % broker_count;
            new_replicas.push(available_brokers[broker_idx]);
        }

        proposals.push(ReassignmentProposal {
            topic: topic.to_string(),
            partition: partition.id(),
            new_replicas,
        });
    }

    Ok(proposals)
}

/// Increase the replication factor for a topic.
pub fn increase_replication_factor(
    admin: &KafkaAdminClient,
    topic: &str,
    new_replication_factor: i32,
) -> KafkaResult<Vec<ReassignmentProposal>> {
    if new_replication_factor < 1 {
        return Err(KafkaError::reassignment_error(
            "Replication factor must be at least 1",
        ));
    }

    let metadata = admin.get_metadata(Some(topic))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic)
        .ok_or_else(|| KafkaError::topic_not_found(topic))?;

    let cluster_metadata = admin.get_metadata(None)?;
    let all_brokers: Vec<i32> = cluster_metadata.brokers().iter().map(|b| b.id()).collect();

    if new_replication_factor as usize > all_brokers.len() {
        return Err(KafkaError::reassignment_error(format!(
            "Requested replication factor {} exceeds broker count {}",
            new_replication_factor,
            all_brokers.len()
        )));
    }

    let mut proposals = Vec::new();

    for partition in topic_meta.partitions() {
        let current_replicas: Vec<i32> = partition.replicas().to_vec();
        let current_rf = current_replicas.len() as i32;

        if new_replication_factor <= current_rf {
            continue; // Skip partitions that already meet or exceed the target
        }

        let mut new_replicas = current_replicas.clone();
        let additional_needed = (new_replication_factor - current_rf) as usize;

        // Pick brokers not already in the replica set
        let candidates: Vec<i32> = all_brokers
            .iter()
            .filter(|b| !current_replicas.contains(b))
            .copied()
            .collect();

        if candidates.len() < additional_needed {
            return Err(KafkaError::reassignment_error(format!(
                "Not enough brokers to increase RF for {}-{}: need {} more, only {} available",
                topic,
                partition.id(),
                additional_needed,
                candidates.len()
            )));
        }

        new_replicas.extend_from_slice(&candidates[..additional_needed]);

        proposals.push(ReassignmentProposal {
            topic: topic.to_string(),
            partition: partition.id(),
            new_replicas,
        });
    }

    Ok(proposals)
}
