use std::collections::HashMap;
use std::time::Duration;

use rdkafka::message::{Header, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::ClientConfig;

use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Wrapper around rdkafka's FutureProducer providing high-level produce operations.
pub struct KafkaProducerWrapper {
    producer: FutureProducer,
    messages_sent: u64,
    errors: u64,
    total_bytes: u64,
}

impl KafkaProducerWrapper {
    /// Create a new producer from a connection configuration.
    pub fn create(config: &KafkaConnectionConfig) -> KafkaResult<Self> {
        let mut client_config = config.to_client_config();
        client_config
            .set("message.timeout.ms", "30000")
            .set("queue.buffering.max.messages", "100000")
            .set("queue.buffering.max.kbytes", "1048576")
            .set("batch.num.messages", "10000")
            .set("linger.ms", "5")
            .set("acks", "all")
            .set("enable.idempotence", "true")
            .set("retries", "3")
            .set("retry.backoff.ms", "100");

        let producer: FutureProducer = client_config
            .create()
            .map_err(|e| KafkaError::producer_error(format!("Failed to create producer: {}", e)))?;

        Ok(Self {
            producer,
            messages_sent: 0,
            errors: 0,
            total_bytes: 0,
        })
    }

    /// Produce a single message.
    pub async fn produce(&mut self, message: &ProducerMessage) -> KafkaResult<ProduceResult> {
        let mut record = FutureRecord::to(&message.topic);

        if let Some(ref key) = message.key {
            record = record.key(key.as_bytes());
        }

        let payload_bytes;
        if let Some(ref value) = message.value {
            payload_bytes = value.as_bytes().to_vec();
            record = record.payload(&payload_bytes);
        }

        if let Some(partition) = message.partition {
            record = record.partition(partition);
        }

        if let Some(ts) = message.timestamp {
            record = record.timestamp(ts);
        }

        // Build headers
        if !message.headers.is_empty() {
            let mut headers = OwnedHeaders::new();
            for h in &message.headers {
                let val = h.value.as_deref().unwrap_or("");
                headers = headers.insert(Header {
                    key: &h.key,
                    value: Some(val.as_bytes()),
                });
            }
            record = record.headers(headers);
        }

        let delivery_result = self
            .producer
            .send(record, Duration::from_secs(30))
            .await
            .map_err(|(e, _)| KafkaError::producer_error(format!("Produce failed: {}", e)))?;

        self.messages_sent += 1;
        if let Some(ref val) = message.value {
            self.total_bytes += val.len() as u64;
        }
        if let Some(ref key) = message.key {
            self.total_bytes += key.len() as u64;
        }

        Ok(ProduceResult {
            topic: message.topic.clone(),
            partition: delivery_result.0,
            offset: delivery_result.1,
        })
    }

    /// Produce a batch of messages. Returns results for each message.
    pub async fn produce_batch(
        &mut self,
        messages: &[ProducerMessage],
    ) -> Vec<KafkaResult<ProduceResult>> {
        let mut results = Vec::with_capacity(messages.len());
        for msg in messages {
            results.push(self.produce(msg).await);
        }
        results
    }

    /// Flush all pending messages within the given timeout.
    pub fn flush(&self, timeout: Duration) -> KafkaResult<()> {
        self.producer.flush(timeout).map_err(|e| {
            KafkaError::producer_error(format!("Flush failed: {}", e))
        })
    }

    /// Get producer performance metrics.
    pub fn get_producer_metrics(&self) -> HashMap<String, serde_json::Value> {
        let mut metrics = HashMap::new();
        metrics.insert(
            "messages_sent".to_string(),
            serde_json::Value::from(self.messages_sent),
        );
        metrics.insert(
            "errors".to_string(),
            serde_json::Value::from(self.errors),
        );
        metrics.insert(
            "total_bytes".to_string(),
            serde_json::Value::from(self.total_bytes),
        );

        // Try to extract librdkafka statistics if available
        if let Some(stats_json) = self.get_rdkafka_stats() {
            if let Ok(stats) = serde_json::from_str::<serde_json::Value>(&stats_json) {
                metrics.insert("rdkafka_stats".to_string(), stats);
            }
        }

        metrics
    }

    fn get_rdkafka_stats(&self) -> Option<String> {
        // Statistics require enabling statistics.interval.ms in the config
        // and implementing a statistics callback. Return None for now.
        None
    }

    /// Produce a message with explicit headers.
    pub async fn produce_with_headers(
        &mut self,
        topic: &str,
        partition: Option<i32>,
        key: Option<&str>,
        value: Option<&str>,
        headers: &[MessageHeader],
    ) -> KafkaResult<ProduceResult> {
        let msg = ProducerMessage {
            topic: topic.to_string(),
            partition,
            key: key.map(|s| s.to_string()),
            value: value.map(|s| s.to_string()),
            headers: headers.to_vec(),
            timestamp: None,
        };
        self.produce(&msg).await
    }

    /// Produce a tombstone (null value) for a compacted topic — signals key deletion.
    pub async fn produce_tombstone(
        &mut self,
        topic: &str,
        key: &str,
    ) -> KafkaResult<ProduceResult> {
        let msg = ProducerMessage {
            topic: topic.to_string(),
            partition: None,
            key: Some(key.to_string()),
            value: None,
            headers: Vec::new(),
            timestamp: None,
        };
        self.produce(&msg).await
    }

    /// Get the count of successfully sent messages.
    pub fn messages_sent(&self) -> u64 {
        self.messages_sent
    }

    /// Get the count of errors.
    pub fn error_count(&self) -> u64 {
        self.errors
    }

    /// Get total bytes sent.
    pub fn total_bytes_sent(&self) -> u64 {
        self.total_bytes
    }
}
