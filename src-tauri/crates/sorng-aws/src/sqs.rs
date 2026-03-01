//! AWS SQS (Simple Queue Service) client.
//!
//! Mirrors `aws-sdk-sqs` types and operations. SQS uses the AWS Query protocol
//! with XML responses (API version 2012-11-05).
//!
//! Reference: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::error::AwsResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const API_VERSION: &str = "2012-11-05";
const SERVICE: &str = "sqs";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Queue {
    pub queue_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueAttributes {
    pub queue_arn: Option<String>,
    pub approximate_number_of_messages: Option<u64>,
    pub approximate_number_of_messages_not_visible: Option<u64>,
    pub approximate_number_of_messages_delayed: Option<u64>,
    pub visibility_timeout: Option<u32>,
    pub maximum_message_size: Option<u32>,
    pub message_retention_period: Option<u32>,
    pub delay_seconds: Option<u32>,
    pub receive_message_wait_time_seconds: Option<u32>,
    pub created_timestamp: Option<String>,
    pub last_modified_timestamp: Option<String>,
    pub fifo_queue: Option<bool>,
    pub content_based_deduplication: Option<bool>,
    pub redrive_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub message_id: String,
    pub receipt_handle: String,
    pub body: String,
    pub md5_of_body: Option<String>,
    pub attributes: HashMap<String, String>,
    pub message_attributes: HashMap<String, MessageAttributeValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageAttributeValue {
    pub data_type: String,
    pub string_value: Option<String>,
    pub binary_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageResult {
    pub message_id: String,
    pub md5_of_message_body: Option<String>,
    pub sequence_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageBatchEntry {
    pub id: String,
    pub message_body: String,
    pub delay_seconds: Option<u32>,
    pub message_attributes: HashMap<String, MessageAttributeValue>,
    pub message_group_id: Option<String>,
    pub message_deduplication_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageBatchResult {
    pub id: String,
    pub message_id: String,
    pub md5_of_message_body: Option<String>,
}

// ── SQS Client ──────────────────────────────────────────────────────────

pub struct SqsClient {
    client: AwsClient,
}

impl SqsClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── Queues ──────────────────────────────────────────────────────

    pub async fn list_queues(&self, prefix: Option<&str>) -> AwsResult<Vec<String>> {
        let mut params = client::build_query_params("ListQueues", API_VERSION);
        if let Some(p) = prefix {
            params.insert("QueueNamePrefix".to_string(), p.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text_all(&response.body, "QueueUrl"))
    }

    pub async fn create_queue(&self, queue_name: &str, attributes: &HashMap<String, String>) -> AwsResult<String> {
        let mut params = client::build_query_params("CreateQueue", API_VERSION);
        params.insert("QueueName".to_string(), queue_name.to_string());
        for (i, (k, v)) in attributes.iter().enumerate() {
            params.insert(format!("Attribute.{}.Name", i + 1), k.clone());
            params.insert(format!("Attribute.{}.Value", i + 1), v.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "QueueUrl").unwrap_or_default())
    }

    pub async fn delete_queue(&self, queue_url: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteQueue", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn get_queue_url(&self, queue_name: &str) -> AwsResult<String> {
        let mut params = client::build_query_params("GetQueueUrl", API_VERSION);
        params.insert("QueueName".to_string(), queue_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "QueueUrl").unwrap_or_default())
    }

    pub async fn get_queue_attributes(&self, queue_url: &str, attribute_names: &[String]) -> AwsResult<QueueAttributes> {
        let mut params = client::build_query_params("GetQueueAttributes", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        if attribute_names.is_empty() {
            params.insert("AttributeName.1".to_string(), "All".to_string());
        } else {
            for (i, name) in attribute_names.iter().enumerate() {
                params.insert(format!("AttributeName.{}", i + 1), name.clone());
            }
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let attrs = self.parse_attributes(&response.body);
        Ok(QueueAttributes {
            queue_arn: attrs.get("QueueArn").cloned(),
            approximate_number_of_messages: attrs.get("ApproximateNumberOfMessages").and_then(|v| v.parse().ok()),
            approximate_number_of_messages_not_visible: attrs.get("ApproximateNumberOfMessagesNotVisible").and_then(|v| v.parse().ok()),
            approximate_number_of_messages_delayed: attrs.get("ApproximateNumberOfMessagesDelayed").and_then(|v| v.parse().ok()),
            visibility_timeout: attrs.get("VisibilityTimeout").and_then(|v| v.parse().ok()),
            maximum_message_size: attrs.get("MaximumMessageSize").and_then(|v| v.parse().ok()),
            message_retention_period: attrs.get("MessageRetentionPeriod").and_then(|v| v.parse().ok()),
            delay_seconds: attrs.get("DelaySeconds").and_then(|v| v.parse().ok()),
            receive_message_wait_time_seconds: attrs.get("ReceiveMessageWaitTimeSeconds").and_then(|v| v.parse().ok()),
            created_timestamp: attrs.get("CreatedTimestamp").cloned(),
            last_modified_timestamp: attrs.get("LastModifiedTimestamp").cloned(),
            fifo_queue: attrs.get("FifoQueue").map(|v| v == "true"),
            content_based_deduplication: attrs.get("ContentBasedDeduplication").map(|v| v == "true"),
            redrive_policy: attrs.get("RedrivePolicy").cloned(),
        })
    }

    pub async fn set_queue_attributes(&self, queue_url: &str, attributes: &HashMap<String, String>) -> AwsResult<()> {
        let mut params = client::build_query_params("SetQueueAttributes", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        for (i, (k, v)) in attributes.iter().enumerate() {
            params.insert(format!("Attribute.{}.Name", i + 1), k.clone());
            params.insert(format!("Attribute.{}.Value", i + 1), v.clone());
        }
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── Messages ────────────────────────────────────────────────────

    pub async fn send_message(&self, queue_url: &str, message_body: &str, delay_seconds: Option<u32>, message_attributes: &HashMap<String, MessageAttributeValue>, message_group_id: Option<&str>, message_dedup_id: Option<&str>) -> AwsResult<SendMessageResult> {
        let mut params = client::build_query_params("SendMessage", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        params.insert("MessageBody".to_string(), message_body.to_string());
        if let Some(ds) = delay_seconds {
            params.insert("DelaySeconds".to_string(), ds.to_string());
        }
        for (i, (name, attr)) in message_attributes.iter().enumerate() {
            let prefix = format!("MessageAttribute.{}", i + 1);
            params.insert(format!("{}.Name", prefix), name.clone());
            params.insert(format!("{}.Value.DataType", prefix), attr.data_type.clone());
            if let Some(ref sv) = attr.string_value {
                params.insert(format!("{}.Value.StringValue", prefix), sv.clone());
            }
        }
        if let Some(gid) = message_group_id {
            params.insert("MessageGroupId".to_string(), gid.to_string());
        }
        if let Some(did) = message_dedup_id {
            params.insert("MessageDeduplicationId".to_string(), did.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(SendMessageResult {
            message_id: client::xml_text(&response.body, "MessageId").unwrap_or_default(),
            md5_of_message_body: client::xml_text(&response.body, "MD5OfMessageBody"),
            sequence_number: client::xml_text(&response.body, "SequenceNumber"),
        })
    }

    pub async fn receive_message(&self, queue_url: &str, max_number_of_messages: Option<u32>, wait_time_seconds: Option<u32>, visibility_timeout: Option<u32>, attribute_names: &[String]) -> AwsResult<Vec<Message>> {
        let mut params = client::build_query_params("ReceiveMessage", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        if let Some(mn) = max_number_of_messages {
            params.insert("MaxNumberOfMessages".to_string(), mn.to_string());
        }
        if let Some(wt) = wait_time_seconds {
            params.insert("WaitTimeSeconds".to_string(), wt.to_string());
        }
        if let Some(vt) = visibility_timeout {
            params.insert("VisibilityTimeout".to_string(), vt.to_string());
        }
        for (i, name) in attribute_names.iter().enumerate() {
            params.insert(format!("AttributeName.{}", i + 1), name.clone());
        }
        params.insert("MessageAttributeName.1".to_string(), "All".to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_messages(&response.body))
    }

    pub async fn delete_message(&self, queue_url: &str, receipt_handle: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteMessage", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        params.insert("ReceiptHandle".to_string(), receipt_handle.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn change_message_visibility(&self, queue_url: &str, receipt_handle: &str, visibility_timeout: u32) -> AwsResult<()> {
        let mut params = client::build_query_params("ChangeMessageVisibility", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        params.insert("ReceiptHandle".to_string(), receipt_handle.to_string());
        params.insert("VisibilityTimeout".to_string(), visibility_timeout.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn purge_queue(&self, queue_url: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("PurgeQueue", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn send_message_batch(&self, queue_url: &str, entries: &[SendMessageBatchEntry]) -> AwsResult<Vec<SendMessageBatchResult>> {
        let mut params = client::build_query_params("SendMessageBatch", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        for (i, entry) in entries.iter().enumerate() {
            let prefix = format!("SendMessageBatchRequestEntry.{}", i + 1);
            params.insert(format!("{}.Id", prefix), entry.id.clone());
            params.insert(format!("{}.MessageBody", prefix), entry.message_body.clone());
            if let Some(ds) = entry.delay_seconds {
                params.insert(format!("{}.DelaySeconds", prefix), ds.to_string());
            }
            if let Some(ref gid) = entry.message_group_id {
                params.insert(format!("{}.MessageGroupId", prefix), gid.clone());
            }
            if let Some(ref did) = entry.message_deduplication_id {
                params.insert(format!("{}.MessageDeduplicationId", prefix), did.clone());
            }
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_blocks(&response.body, "SendMessageBatchResultEntry").iter().filter_map(|b| {
            Some(SendMessageBatchResult {
                id: client::xml_text(b, "Id")?,
                message_id: client::xml_text(b, "MessageId")?,
                md5_of_message_body: client::xml_text(b, "MD5OfMessageBody"),
            })
        }).collect())
    }

    // ── Dead Letter Queues ──────────────────────────────────────────

    pub async fn list_dead_letter_source_queues(&self, queue_url: &str) -> AwsResult<Vec<String>> {
        let mut params = client::build_query_params("ListDeadLetterSourceQueues", API_VERSION);
        params.insert("QueueUrl".to_string(), queue_url.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text_all(&response.body, "QueueUrl"))
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn parse_messages(&self, xml: &str) -> Vec<Message> {
        client::xml_blocks(xml, "Message").iter().filter_map(|b| {
            Some(Message {
                message_id: client::xml_text(b, "MessageId")?,
                receipt_handle: client::xml_text(b, "ReceiptHandle")?,
                body: client::xml_text(b, "Body").unwrap_or_default(),
                md5_of_body: client::xml_text(b, "MD5OfBody"),
                attributes: HashMap::new(),
                message_attributes: HashMap::new(),
            })
        }).collect()
    }

    fn parse_attributes(&self, xml: &str) -> HashMap<String, String> {
        let mut attrs = HashMap::new();
        for entry in client::xml_blocks(xml, "Attribute") {
            if let (Some(name), Some(value)) = (client::xml_text(&entry, "Name"), client::xml_text(&entry, "Value")) {
                attrs.insert(name, value);
            }
        }
        attrs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_serde() {
        let msg = Message {
            message_id: "msg-123".to_string(),
            receipt_handle: "handle-abc".to_string(),
            body: "{\"event\":\"order.created\"}".to_string(),
            md5_of_body: Some("abc123".to_string()),
            attributes: HashMap::new(),
            message_attributes: HashMap::new(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(back.message_id, "msg-123");
    }

    #[test]
    fn queue_attributes_serde() {
        let qa = QueueAttributes {
            queue_arn: Some("arn:aws:sqs:us-east-1:123:my-queue".to_string()),
            approximate_number_of_messages: Some(42),
            approximate_number_of_messages_not_visible: Some(3),
            approximate_number_of_messages_delayed: Some(0),
            visibility_timeout: Some(30),
            maximum_message_size: Some(262144),
            message_retention_period: Some(345600),
            delay_seconds: Some(0),
            receive_message_wait_time_seconds: Some(20),
            created_timestamp: None,
            last_modified_timestamp: None,
            fifo_queue: Some(false),
            content_based_deduplication: Some(false),
            redrive_policy: None,
        };
        let json = serde_json::to_string(&qa).unwrap();
        assert!(json.contains("42"));
    }
}
