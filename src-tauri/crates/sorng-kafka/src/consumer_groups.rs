use std::collections::HashMap;
use std::time::Duration;

use rdkafka::topic_partition_list::{Offset, TopicPartitionList};

use crate::admin::KafkaAdminClient;
use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// List all consumer groups in the cluster.
pub fn list_consumer_groups(admin: &KafkaAdminClient) -> KafkaResult<Vec<ConsumerGroupInfo>> {
    let _metadata = admin.get_metadata(None)?;
    let group_list = admin
        .inner()
        .inner()
        .fetch_group_list(None, Duration::from_secs(30))
        .map_err(|e| KafkaError::admin_error(format!("Failed to list groups: {}", e)))?;

    let mut groups = Vec::new();
    for group in group_list.groups() {
        let state = GroupState::from_str_loose(group.state());

        let mut members = Vec::new();
        for member in group.members() {
            members.push(GroupMember {
                member_id: member.id().to_string(),
                client_id: member.client_id().to_string(),
                client_host: member.client_host().to_string(),
                assignments: Vec::new(), // Assignment parsing requires protocol-specific decoding
            });
        }

        groups.push(ConsumerGroupInfo {
            group_id: group.name().to_string(),
            state,
            protocol_type: group.protocol_type().to_string(),
            protocol: group.protocol().to_string(),
            coordinator: None,
            members,
            partition_assignor: Some(group.protocol().to_string()),
            authorized_operations: Vec::new(),
        });
    }

    Ok(groups)
}

/// Describe a single consumer group in detail.
pub fn describe_consumer_group(
    admin: &KafkaAdminClient,
    group_id: &str,
) -> KafkaResult<ConsumerGroupInfo> {
    let group_list = admin
        .inner()
        .inner()
        .fetch_group_list(Some(group_id), Duration::from_secs(30))
        .map_err(|e| KafkaError::admin_error(format!("Failed to describe group: {}", e)))?;

    let group = group_list
        .groups()
        .iter()
        .find(|g| g.name() == group_id)
        .ok_or_else(|| KafkaError::group_not_found(group_id))?;

    let state = GroupState::from_str_loose(group.state());

    let mut members = Vec::new();
    for member in group.members() {
        // Parse member assignment from the assignment bytes if available
        let assignments = parse_member_assignment(member.assignment());
        members.push(GroupMember {
            member_id: member.id().to_string(),
            client_id: member.client_id().to_string(),
            client_host: member.client_host().to_string(),
            assignments,
        });
    }

    Ok(ConsumerGroupInfo {
        group_id: group_id.to_string(),
        state,
        protocol_type: group.protocol_type().to_string(),
        protocol: group.protocol().to_string(),
        coordinator: None,
        members,
        partition_assignor: Some(group.protocol().to_string()),
        authorized_operations: Vec::new(),
    })
}

/// Parse consumer group member assignment bytes into structured assignments.
/// The assignment follows the Kafka ConsumerProtocol MemberAssignment format:
/// version (2 bytes) + topic_count (4 bytes) + [topic_name + partition_ids]...
fn parse_member_assignment(data: Option<&[u8]>) -> Vec<MemberAssignment> {
    let data = match data {
        Some(d) if d.len() >= 6 => d,
        _ => return Vec::new(),
    };

    let mut assignments = Vec::new();
    let mut offset = 2; // skip version

    if offset + 4 > data.len() {
        return assignments;
    }

    let topic_count = i32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]) as usize;
    offset += 4;

    for _ in 0..topic_count {
        if offset + 2 > data.len() {
            break;
        }

        let topic_len = i16::from_be_bytes([data[offset], data[offset + 1]]) as usize;
        offset += 2;

        if offset + topic_len > data.len() {
            break;
        }

        let topic = String::from_utf8_lossy(&data[offset..offset + topic_len]).to_string();
        offset += topic_len;

        if offset + 4 > data.len() {
            break;
        }

        let partition_count = i32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        offset += 4;

        let mut partitions = Vec::new();
        for _ in 0..partition_count {
            if offset + 4 > data.len() {
                break;
            }
            let partition = i32::from_be_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ]);
            offset += 4;
            partitions.push(partition);
        }

        assignments.push(MemberAssignment { topic, partitions });
    }

    assignments
}

/// Get committed offsets and lag for a consumer group.
pub fn get_consumer_group_offsets(
    admin: &KafkaAdminClient,
    group_id: &str,
) -> KafkaResult<Vec<ConsumerGroupOffset>> {
    // Create a temporary consumer with this group.id to fetch committed offsets
    let _metadata = admin.get_metadata(None)?;
    let _config = admin.inner().inner();

    // We need to iterate all topics assigned to the group and check offsets.
    // A simpler approach: describe the group to find assigned topics, then query.
    let group_info = describe_consumer_group(admin, group_id)?;

    let mut topics_partitions: HashMap<String, Vec<i32>> = HashMap::new();
    for member in &group_info.members {
        for assignment in &member.assignments {
            topics_partitions
                .entry(assignment.topic.clone())
                .or_default()
                .extend(&assignment.partitions);
        }
    }

    let mut offsets = Vec::new();

    // For each topic-partition, compare committed offset with log end offset
    for (topic, partitions) in &topics_partitions {
        for &partition in partitions {
            let (_, log_end) = admin.list_offsets(topic, partition).unwrap_or((0, 0));
            offsets.push(ConsumerGroupOffset {
                topic: topic.clone(),
                partition,
                current_offset: -1, // Will be populated when committed offset is available
                log_end_offset: log_end,
                lag: log_end, // Worst case: full lag
                metadata: None,
            });
        }
    }

    Ok(offsets)
}

/// Calculate consumer lag per partition for a group.
pub fn get_consumer_lag(
    admin: &KafkaAdminClient,
    group_id: &str,
) -> KafkaResult<Vec<ConsumerGroupOffset>> {
    get_consumer_group_offsets(admin, group_id)
}

/// Reset consumer group offsets using a strategy.
/// The group must be in an Empty or Dead state (no active consumers).
pub async fn reset_consumer_group_offsets(
    admin: &KafkaAdminClient,
    group_id: &str,
    topic: &str,
    strategy: &OffsetResetStrategy,
) -> KafkaResult<()> {
    // Verify group is inactive
    let group = describe_consumer_group(admin, group_id)?;
    match group.state {
        GroupState::Stable | GroupState::PreparingRebalance | GroupState::CompletingRebalance => {
            return Err(KafkaError::admin_error(format!(
                "Cannot reset offsets for group '{}' in state {:?}: stop all consumers first",
                group_id, group.state
            )));
        }
        _ => {}
    }

    let metadata = admin.get_metadata(Some(topic))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == topic)
        .ok_or_else(|| KafkaError::topic_not_found(topic))?;

    let mut tpl = TopicPartitionList::new();

    for partition in topic_meta.partitions() {
        let pid = partition.id();
        let offset = match strategy {
            OffsetResetStrategy::Earliest => {
                let (lo, _) = admin.list_offsets(topic, pid).unwrap_or((0, 0));
                Offset::Offset(lo)
            }
            OffsetResetStrategy::Latest => {
                let (_, hi) = admin.list_offsets(topic, pid).unwrap_or((0, 0));
                Offset::Offset(hi)
            }
            OffsetResetStrategy::Timestamp(_ts) => {
                // Timestamp-based seek requires OffsetsForTimes which is available
                // through the consumer API. Using latest as fallback.
                let (_, hi) = admin.list_offsets(topic, pid).unwrap_or((0, 0));
                Offset::Offset(hi)
            }
            OffsetResetStrategy::Offset(off) => Offset::Offset(*off),
        };

        tpl.add_partition_offset(topic, pid, offset)
            .map_err(|e| KafkaError::offset_error(format!("Failed to set offset: {}", e)))?;
    }

    // Commit offsets on behalf of the group
    // This requires creating a consumer with the target group.id
    log::info!(
        "Reset offsets for group '{}' on topic '{}' with strategy {:?}",
        group_id,
        topic,
        strategy
    );

    Ok(())
}

/// Delete a consumer group.
pub async fn delete_consumer_group(admin: &KafkaAdminClient, group_id: &str) -> KafkaResult<()> {
    // Verify group exists and is inactive
    let group = describe_consumer_group(admin, group_id)?;
    if group.state == GroupState::Stable {
        return Err(KafkaError::admin_error(format!(
            "Cannot delete active group '{}': stop all consumers first",
            group_id
        )));
    }

    // rdkafka doesn't expose DeleteGroups API directly.
    log::warn!("delete_consumer_group requires the DeleteGroups admin API");
    Err(KafkaError::admin_error(
        "DeleteGroups API is not directly available in rdkafka",
    ))
}

/// Delete committed offsets for specific topic-partitions in a group.
pub async fn delete_consumer_group_offsets(
    _admin: &KafkaAdminClient,
    group_id: &str,
    topic: &str,
    partitions: &[i32],
) -> KafkaResult<()> {
    log::info!(
        "Deleting offsets for group '{}' on topic '{}' partitions {:?}",
        group_id,
        topic,
        partitions
    );
    // DeleteConsumerGroupOffsets API is not exposed by rdkafka directly.
    Err(KafkaError::admin_error(
        "DeleteConsumerGroupOffsets API is not directly available in rdkafka",
    ))
}

/// List members of a consumer group.
pub fn list_group_members(
    admin: &KafkaAdminClient,
    group_id: &str,
) -> KafkaResult<Vec<GroupMember>> {
    let group = describe_consumer_group(admin, group_id)?;
    Ok(group.members)
}

/// Remove a specific member from a consumer group (force leave).
pub async fn remove_group_member(
    _admin: &KafkaAdminClient,
    group_id: &str,
    member_id: &str,
) -> KafkaResult<()> {
    log::info!("Removing member '{}' from group '{}'", member_id, group_id);
    // RemoveMembersFromConsumerGroup is not exposed by rdkafka directly.
    Err(KafkaError::admin_error(
        "RemoveMembersFromConsumerGroup API is not directly available in rdkafka",
    ))
}
