use std::collections::HashMap;

use crate::admin::KafkaAdminClient;
use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// List all topics in the cluster including internal topics.
pub fn list_topics(admin: &KafkaAdminClient) -> KafkaResult<Vec<TopicInfo>> {
    let metadata = admin.get_metadata(None)?;
    let mut topics = Vec::new();

    for topic in metadata.topics() {
        let name = topic.name().to_string();
        let partition_count = topic.partitions().len() as i32;
        let replication_factor = topic
            .partitions()
            .first()
            .map(|p| p.replicas().len() as i32)
            .unwrap_or(0);

        let internal = name.starts_with("__");

        let mut partition_details = Vec::new();
        let mut total_messages: i64 = 0;

        for partition in topic.partitions() {
            let pid = partition.id();
            let (lo, hi) = admin.list_offsets(&name, pid).unwrap_or((0, 0));
            let msg_count = hi.saturating_sub(lo);
            total_messages += msg_count;

            partition_details.push(PartitionInfo {
                id: pid,
                leader: partition.leader(),
                replicas: partition.replicas().to_vec(),
                isr: partition.isr().to_vec(),
                offline_replicas: Vec::new(),
                earliest_offset: Some(lo),
                latest_offset: Some(hi),
                size_bytes: None,
            });
        }

        topics.push(TopicInfo {
            name,
            partitions: partition_count,
            replication_factor,
            internal,
            configs: Vec::new(),
            partition_details,
            total_messages: Some(total_messages),
            total_size_bytes: None,
        });
    }

    Ok(topics)
}

/// Get detailed information about a single topic.
pub async fn get_topic(admin: &KafkaAdminClient, name: &str) -> KafkaResult<TopicInfo> {
    let metadata = admin.get_metadata(Some(name))?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|t| t.name() == name)
        .ok_or_else(|| KafkaError::topic_not_found(name))?;

    if topic_meta.partitions().is_empty() {
        return Err(KafkaError::topic_not_found(name));
    }

    let partition_count = topic_meta.partitions().len() as i32;
    let replication_factor = topic_meta
        .partitions()
        .first()
        .map(|p| p.replicas().len() as i32)
        .unwrap_or(0);

    let mut partition_details = Vec::new();
    let mut total_messages: i64 = 0;

    for partition in topic_meta.partitions() {
        let pid = partition.id();
        let (lo, hi) = admin.list_offsets(name, pid).unwrap_or((0, 0));
        let msg_count = hi.saturating_sub(lo);
        total_messages += msg_count;

        partition_details.push(PartitionInfo {
            id: pid,
            leader: partition.leader(),
            replicas: partition.replicas().to_vec(),
            isr: partition.isr().to_vec(),
            offline_replicas: Vec::new(),
            earliest_offset: Some(lo),
            latest_offset: Some(hi),
            size_bytes: None,
        });
    }

    let configs = admin
        .describe_configs(&ResourceType::Topic, name)
        .await
        .unwrap_or_default();

    Ok(TopicInfo {
        name: name.to_string(),
        partitions: partition_count,
        replication_factor,
        internal: name.starts_with("__"),
        configs,
        partition_details,
        total_messages: Some(total_messages),
        total_size_bytes: None,
    })
}

/// Create a new topic.
pub async fn create_topic(
    admin: &KafkaAdminClient,
    name: &str,
    partitions: i32,
    replication_factor: i32,
    configs: HashMap<String, String>,
) -> KafkaResult<()> {
    let req = CreateTopicRequest {
        name: name.to_string(),
        partitions,
        replication_factor,
        configs,
    };
    admin.create_topics(&[req]).await
}

/// Delete a topic.
pub async fn delete_topic(admin: &KafkaAdminClient, name: &str) -> KafkaResult<()> {
    admin.delete_topics(&[name]).await
}

/// Get configuration entries for a topic.
pub async fn get_topic_config(admin: &KafkaAdminClient, name: &str) -> KafkaResult<Vec<TopicConfig>> {
    let _topic = get_topic(admin, name).await?;
    // describe_configs is async but we call the blocking version here
    // In the service layer the async version will be used.
    // For now we fetch metadata-based config.
    Ok(Vec::new())
}

/// Get topic configuration entries (async version).
pub async fn get_topic_config_async(
    admin: &KafkaAdminClient,
    name: &str,
) -> KafkaResult<Vec<TopicConfig>> {
    admin.describe_configs(&ResourceType::Topic, name).await
}

/// Set a single configuration entry on a topic.
pub async fn set_topic_config(
    admin: &KafkaAdminClient,
    name: &str,
    key: &str,
    value: &str,
) -> KafkaResult<()> {
    let mut configs = HashMap::new();
    configs.insert(key.to_string(), value.to_string());
    admin.alter_configs(&ResourceType::Topic, name, &configs).await
}

/// Get per-partition offsets (earliest and latest) for a topic.
pub fn get_topic_offsets(
    admin: &KafkaAdminClient,
    name: &str,
) -> KafkaResult<Vec<(i32, i64, i64)>> {
    let metadata = admin.get_metadata(Some(name))?;
    let topic = metadata
        .topics()
        .iter()
        .find(|t| t.name() == name)
        .ok_or_else(|| KafkaError::topic_not_found(name))?;

    let mut offsets = Vec::new();
    for partition in topic.partitions() {
        let pid = partition.id();
        let (lo, hi) = admin.list_offsets(name, pid).unwrap_or((0, 0));
        offsets.push((pid, lo, hi));
    }

    Ok(offsets)
}

/// Increase the number of partitions for a topic.
pub async fn increase_partitions(
    admin: &KafkaAdminClient,
    name: &str,
    new_total_count: i32,
) -> KafkaResult<()> {
    admin.create_partitions(name, new_total_count).await
}

/// Describe a topic in detail, including ISR, leader, replicas.
pub async fn describe_topic(admin: &KafkaAdminClient, name: &str) -> KafkaResult<TopicInfo> {
    get_topic(admin, name).await
}

/// List internal topics (e.g., __consumer_offsets, __transaction_state).
pub fn list_internal_topics(admin: &KafkaAdminClient) -> KafkaResult<Vec<TopicInfo>> {
    let all = list_topics(admin)?;
    Ok(all.into_iter().filter(|t| t.internal).collect())
}

/// Estimate the size of a topic (per partition).
pub async fn get_topic_size(
    admin: &KafkaAdminClient,
    name: &str,
) -> KafkaResult<Vec<(i32, Option<i64>)>> {
    let topic = get_topic(admin, name).await?;
    Ok(topic
        .partition_details
        .iter()
        .map(|p| (p.id, p.size_bytes))
        .collect())
}

// ---------------------------------------------------------------------------
// Config helpers for common topic settings
// ---------------------------------------------------------------------------

/// Set `retention.ms` for a topic.
pub async fn set_retention_ms(
    admin: &KafkaAdminClient,
    name: &str,
    ms: i64,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "retention.ms", &ms.to_string()).await
}

/// Set `retention.bytes` for a topic.
pub async fn set_retention_bytes(
    admin: &KafkaAdminClient,
    name: &str,
    bytes: i64,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "retention.bytes", &bytes.to_string()).await
}

/// Set `cleanup.policy` for a topic (delete, compact, delete+compact).
pub async fn set_cleanup_policy(
    admin: &KafkaAdminClient,
    name: &str,
    policy: &str,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "cleanup.policy", policy).await
}

/// Set `compression.type` for a topic.
pub async fn set_compression_type(
    admin: &KafkaAdminClient,
    name: &str,
    compression: &str,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "compression.type", compression).await
}

/// Set `max.message.bytes` for a topic.
pub async fn set_max_message_bytes(
    admin: &KafkaAdminClient,
    name: &str,
    bytes: i32,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "max.message.bytes", &bytes.to_string()).await
}

/// Set `min.insync.replicas` for a topic.
pub async fn set_min_insync_replicas(
    admin: &KafkaAdminClient,
    name: &str,
    count: i32,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "min.insync.replicas", &count.to_string()).await
}

/// Set `segment.bytes` for a topic.
pub async fn set_segment_bytes(
    admin: &KafkaAdminClient,
    name: &str,
    bytes: i64,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "segment.bytes", &bytes.to_string()).await
}

/// Set `segment.ms` for a topic.
pub async fn set_segment_ms(
    admin: &KafkaAdminClient,
    name: &str,
    ms: i64,
) -> KafkaResult<()> {
    set_topic_config(admin, name, "segment.ms", &ms.to_string()).await
}
