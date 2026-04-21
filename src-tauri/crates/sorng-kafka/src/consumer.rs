use std::collections::HashMap;
use std::time::Duration;

use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::message::{BorrowedMessage, Headers, Message};
use rdkafka::topic_partition_list::{Offset, TopicPartitionList};

use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Wrapper around rdkafka's StreamConsumer providing high-level consume operations.
pub struct KafkaConsumerClient {
    consumer: StreamConsumer,
    subscriptions: Vec<String>,
    group_id: String,
    messages_consumed: u64,
    total_bytes: u64,
    auto_commit: bool,
}

impl KafkaConsumerClient {
    /// Create a new consumer from a connection configuration.
    pub fn create(
        config: &KafkaConnectionConfig,
        group_id: &str,
        auto_commit: bool,
    ) -> KafkaResult<Self> {
        let mut client_config = config.to_client_config();
        client_config
            .set("group.id", group_id)
            .set(
                "enable.auto.commit",
                if auto_commit { "true" } else { "false" },
            )
            .set("auto.offset.reset", "earliest")
            .set("session.timeout.ms", "30000")
            .set("max.poll.interval.ms", "300000")
            .set("fetch.min.bytes", "1")
            .set("fetch.wait.max.ms", "500")
            .set("max.partition.fetch.bytes", "1048576");

        let consumer: StreamConsumer = client_config
            .create()
            .map_err(|e| KafkaError::consumer_error(format!("Failed to create consumer: {}", e)))?;

        Ok(Self {
            consumer,
            subscriptions: Vec::new(),
            group_id: group_id.to_string(),
            messages_consumed: 0,
            total_bytes: 0,
            auto_commit,
        })
    }

    /// Subscribe to one or more topics.
    pub fn subscribe(&mut self, topics: &[&str]) -> KafkaResult<()> {
        self.consumer
            .subscribe(topics)
            .map_err(|e| KafkaError::consumer_error(format!("Failed to subscribe: {}", e)))?;
        self.subscriptions = topics.iter().map(|t| t.to_string()).collect();
        Ok(())
    }

    /// Unsubscribe from all topics.
    pub fn unsubscribe(&mut self) {
        self.consumer.unsubscribe();
        self.subscriptions.clear();
    }

    /// Get currently subscribed topics.
    pub fn subscriptions(&self) -> &[String] {
        &self.subscriptions
    }

    /// Poll for a single message with the given timeout.
    pub async fn poll(&mut self, timeout: Duration) -> KafkaResult<Option<ConsumedMessage>> {
        use tokio::time::timeout as tokio_timeout;

        let result = tokio_timeout(timeout, self.consumer.recv()).await;

        match result {
            Ok(Ok(msg)) => {
                let consumed = self.borrowed_to_consumed(&msg);
                self.messages_consumed += 1;
                if let Some(ref v) = consumed.value {
                    self.total_bytes += v.len() as u64;
                }
                Ok(Some(consumed))
            }
            Ok(Err(e)) => Err(KafkaError::consumer_error(format!("Poll error: {}", e))),
            Err(_) => Ok(None), // Timeout
        }
    }

    /// Consume a batch of messages up to `max_count` within the given timeout.
    pub async fn consume_batch(
        &mut self,
        max_count: usize,
        timeout: Duration,
    ) -> KafkaResult<Vec<ConsumedMessage>> {
        use tokio::time::{timeout as tokio_timeout, Instant};

        let mut messages = Vec::with_capacity(max_count);
        let deadline = Instant::now() + timeout;

        while messages.len() < max_count {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }

            match tokio_timeout(remaining, self.consumer.recv()).await {
                Ok(Ok(msg)) => {
                    let consumed = self.borrowed_to_consumed(&msg);
                    self.messages_consumed += 1;
                    if let Some(ref v) = consumed.value {
                        self.total_bytes += v.len() as u64;
                    }
                    messages.push(consumed);
                }
                Ok(Err(e)) => {
                    if messages.is_empty() {
                        return Err(KafkaError::consumer_error(format!("Consume error: {}", e)));
                    }
                    break;
                }
                Err(_) => break, // Timeout
            }
        }

        Ok(messages)
    }

    /// Manually commit a specific message's offset.
    pub fn commit_message(&self, topic: &str, partition: i32, offset: i64) -> KafkaResult<()> {
        let mut tpl = TopicPartitionList::new();
        tpl.add_partition_offset(topic, partition, Offset::Offset(offset + 1))
            .map_err(|e| KafkaError::consumer_error(format!("Failed to build TPL: {}", e)))?;

        self.consumer
            .commit(&tpl, CommitMode::Sync)
            .map_err(|e| KafkaError::consumer_error(format!("Commit failed: {}", e)))
    }

    /// Commit offsets asynchronously.
    pub fn commit_async(&self, topic: &str, partition: i32, offset: i64) -> KafkaResult<()> {
        let mut tpl = TopicPartitionList::new();
        tpl.add_partition_offset(topic, partition, Offset::Offset(offset + 1))
            .map_err(|e| KafkaError::consumer_error(format!("Failed to build TPL: {}", e)))?;

        self.consumer
            .commit(&tpl, CommitMode::Async)
            .map_err(|e| KafkaError::consumer_error(format!("Async commit failed: {}", e)))
    }

    /// Seek to a specific offset on a topic-partition.
    pub fn seek(&self, topic: &str, partition: i32, offset: i64) -> KafkaResult<()> {
        self.consumer
            .seek(
                topic,
                partition,
                Offset::Offset(offset),
                Duration::from_secs(10),
            )
            .map_err(|e| KafkaError::consumer_error(format!("Seek failed: {}", e)))
    }

    /// Seek to the beginning of a partition.
    pub fn seek_to_beginning(&self, topic: &str, partition: i32) -> KafkaResult<()> {
        self.consumer
            .seek(topic, partition, Offset::Beginning, Duration::from_secs(10))
            .map_err(|e| KafkaError::consumer_error(format!("Seek to beginning failed: {}", e)))
    }

    /// Seek to the end of a partition.
    pub fn seek_to_end(&self, topic: &str, partition: i32) -> KafkaResult<()> {
        self.consumer
            .seek(topic, partition, Offset::End, Duration::from_secs(10))
            .map_err(|e| KafkaError::consumer_error(format!("Seek to end failed: {}", e)))
    }

    /// Get the current position (next offset to be read) for assigned partitions.
    pub fn get_position(&self) -> KafkaResult<Vec<(String, i32, i64)>> {
        let tpl = self
            .consumer
            .position()
            .map_err(|e| KafkaError::consumer_error(format!("Failed to get position: {}", e)))?;

        let mut positions = Vec::new();
        for elem in tpl.elements() {
            if let Offset::Offset(o) = elem.offset() {
                positions.push((elem.topic().to_string(), elem.partition(), o));
            }
        }
        Ok(positions)
    }

    /// Get committed offsets for the consumer group.
    pub fn committed_offsets(&self, timeout: Duration) -> KafkaResult<Vec<(String, i32, i64)>> {
        let assignment = self
            .consumer
            .assignment()
            .map_err(|e| KafkaError::consumer_error(format!("Failed to get assignment: {}", e)))?;

        let committed = self
            .consumer
            .committed_offsets(assignment, timeout)
            .map_err(|e| {
                KafkaError::consumer_error(format!("Failed to get committed offsets: {}", e))
            })?;

        let mut offsets = Vec::new();
        for elem in committed.elements() {
            if let Offset::Offset(o) = elem.offset() {
                offsets.push((elem.topic().to_string(), elem.partition(), o));
            }
        }
        Ok(offsets)
    }

    /// Get the current partition assignment for this consumer.
    pub fn assignment(&self) -> KafkaResult<Vec<(String, i32)>> {
        let tpl = self
            .consumer
            .assignment()
            .map_err(|e| KafkaError::consumer_error(format!("Failed to get assignment: {}", e)))?;

        Ok(tpl
            .elements()
            .iter()
            .map(|e| (e.topic().to_string(), e.partition()))
            .collect())
    }

    /// Pause consumption on the specified topic-partitions.
    pub fn pause(&self, topic_partitions: &[(String, i32)]) -> KafkaResult<()> {
        let mut tpl = TopicPartitionList::new();
        for (topic, partition) in topic_partitions {
            tpl.add_partition(topic, *partition);
        }
        self.consumer
            .pause(&tpl)
            .map_err(|e| KafkaError::consumer_error(format!("Pause failed: {}", e)))
    }

    /// Resume consumption on the specified topic-partitions.
    pub fn resume(&self, topic_partitions: &[(String, i32)]) -> KafkaResult<()> {
        let mut tpl = TopicPartitionList::new();
        for (topic, partition) in topic_partitions {
            tpl.add_partition(topic, *partition);
        }
        self.consumer
            .resume(&tpl)
            .map_err(|e| KafkaError::consumer_error(format!("Resume failed: {}", e)))
    }

    /// Assign specific topic-partitions to this consumer (manual assignment).
    pub fn assign(&self, topic_partitions: &[(String, i32, Option<i64>)]) -> KafkaResult<()> {
        let mut tpl = TopicPartitionList::new();
        for (topic, partition, offset) in topic_partitions {
            let off = match offset {
                Some(o) => Offset::Offset(*o),
                None => Offset::Beginning,
            };
            tpl.add_partition_offset(topic, *partition, off)
                .map_err(|e| {
                    KafkaError::consumer_error(format!("Failed to build assignment TPL: {}", e))
                })?;
        }
        self.consumer
            .assign(&tpl)
            .map_err(|e| KafkaError::consumer_error(format!("Assign failed: {}", e)))
    }

    /// Get the consumer group ID.
    pub fn group_id(&self) -> &str {
        &self.group_id
    }

    /// Get consumer performance metrics.
    pub fn get_consumer_metrics(&self) -> HashMap<String, serde_json::Value> {
        let mut metrics = HashMap::new();
        metrics.insert(
            "messages_consumed".to_string(),
            serde_json::Value::from(self.messages_consumed),
        );
        metrics.insert(
            "total_bytes".to_string(),
            serde_json::Value::from(self.total_bytes),
        );
        metrics.insert(
            "group_id".to_string(),
            serde_json::Value::from(self.group_id.clone()),
        );
        metrics.insert(
            "subscriptions".to_string(),
            serde_json::Value::from(self.subscriptions.clone()),
        );
        metrics.insert(
            "auto_commit".to_string(),
            serde_json::Value::from(self.auto_commit),
        );
        metrics
    }

    /// Convert a borrowed rdkafka message into our ConsumedMessage type.
    fn borrowed_to_consumed(&self, msg: &BorrowedMessage<'_>) -> ConsumedMessage {
        let key = msg.key().map(|k| String::from_utf8_lossy(k).to_string());
        let value = msg
            .payload()
            .map(|v| String::from_utf8_lossy(v).to_string());

        let mut headers = Vec::new();
        if let Some(h) = msg.headers() {
            for idx in 0..h.count() {
                let header = h.get(idx);
                headers.push(MessageHeader {
                    key: header.key.to_string(),
                    value: header.value.map(|v| String::from_utf8_lossy(v).to_string()),
                });
            }
        }

        ConsumedMessage {
            topic: msg.topic().to_string(),
            partition: msg.partition(),
            offset: msg.offset(),
            key,
            value,
            headers,
            timestamp: msg.timestamp().to_millis(),
            timestamp_type: Some(format!("{:?}", msg.timestamp())),
        }
    }
}
