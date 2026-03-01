//! Google Cloud Pub/Sub client.
//!
//! Covers topics, subscriptions, and message publishing/pulling.
//!
//! API base: `https://pubsub.googleapis.com/v1`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "pubsub";
const V1: &str = "/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// Pub/Sub topic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Topic {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "messageRetentionDuration")]
    pub message_retention_duration: Option<String>,
    #[serde(default, rename = "kmsKeyName")]
    pub kms_key_name: Option<String>,
    #[serde(default, rename = "schemaSettings")]
    pub schema_settings: Option<serde_json::Value>,
}

/// Pub/Sub subscription.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub topic: String,
    #[serde(default, rename = "ackDeadlineSeconds")]
    pub ack_deadline_seconds: u32,
    #[serde(default, rename = "messageRetentionDuration")]
    pub message_retention_duration: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "pushConfig")]
    pub push_config: Option<PushConfig>,
    #[serde(default, rename = "retryPolicy")]
    pub retry_policy: Option<serde_json::Value>,
    #[serde(default, rename = "deadLetterPolicy")]
    pub dead_letter_policy: Option<serde_json::Value>,
    #[serde(default, rename = "expirationPolicy")]
    pub expiration_policy: Option<serde_json::Value>,
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub detached: bool,
    #[serde(default, rename = "enableExactlyOnceDelivery")]
    pub enable_exactly_once_delivery: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushConfig {
    #[serde(default, rename = "pushEndpoint")]
    pub push_endpoint: String,
    #[serde(default)]
    pub attributes: HashMap<String, String>,
}

/// A published/received message.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PubsubMessage {
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub attributes: HashMap<String, String>,
    #[serde(default, rename = "messageId")]
    pub message_id: Option<String>,
    #[serde(default, rename = "publishTime")]
    pub publish_time: Option<String>,
    #[serde(default, rename = "orderingKey")]
    pub ordering_key: Option<String>,
}

/// Received message wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceivedMessage {
    #[serde(default, rename = "ackId")]
    pub ack_id: String,
    #[serde(default)]
    pub message: PubsubMessage,
    #[serde(default, rename = "deliveryAttempt")]
    pub delivery_attempt: Option<u32>,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TopicList {
    #[serde(default)]
    topics: Vec<Topic>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SubscriptionList {
    #[serde(default)]
    subscriptions: Vec<Subscription>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PullResponse {
    #[serde(default, rename = "receivedMessages")]
    received_messages: Vec<ReceivedMessage>,
}

#[derive(Debug, Deserialize)]
struct PublishResponse {
    #[serde(default, rename = "messageIds")]
    message_ids: Vec<String>,
}

// ── Pub/Sub Client ──────────────────────────────────────────────────────

pub struct PubSubClient;

impl PubSubClient {
    // ── Topics ──────────────────────────────────────────────────────

    /// List topics in a project.
    pub async fn list_topics(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Topic>> {
        let path = format!("{}/projects/{}/topics", V1, project);
        let resp: TopicList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.topics)
    }

    /// Get a topic.
    pub async fn get_topic(
        client: &mut GcpClient,
        project: &str,
        topic_name: &str,
    ) -> GcpResult<Topic> {
        let path = format!("{}/projects/{}/topics/{}", V1, project, topic_name);
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a topic.
    pub async fn create_topic(
        client: &mut GcpClient,
        project: &str,
        topic_name: &str,
        labels: Option<HashMap<String, String>>,
    ) -> GcpResult<Topic> {
        let path = format!("{}/projects/{}/topics/{}", V1, project, topic_name);
        let body = if let Some(lbls) = labels {
            serde_json::json!({ "labels": lbls })
        } else {
            serde_json::json!({})
        };
        client.put(SERVICE, &path, &body).await
    }

    /// Delete a topic.
    pub async fn delete_topic(
        client: &mut GcpClient,
        project: &str,
        topic_name: &str,
    ) -> GcpResult<()> {
        let path = format!("{}/projects/{}/topics/{}", V1, project, topic_name);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    /// Publish messages to a topic.
    pub async fn publish(
        client: &mut GcpClient,
        project: &str,
        topic_name: &str,
        messages: Vec<PubsubMessage>,
    ) -> GcpResult<Vec<String>> {
        let path = format!(
            "{}/projects/{}/topics/{}:publish",
            V1, project, topic_name
        );
        let body = serde_json::json!({ "messages": messages });
        let resp: PublishResponse = client.post(SERVICE, &path, &body).await?;
        Ok(resp.message_ids)
    }

    // ── Subscriptions ───────────────────────────────────────────────

    /// List subscriptions in a project.
    pub async fn list_subscriptions(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Subscription>> {
        let path = format!("{}/projects/{}/subscriptions", V1, project);
        let resp: SubscriptionList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.subscriptions)
    }

    /// Get a subscription.
    pub async fn get_subscription(
        client: &mut GcpClient,
        project: &str,
        subscription_name: &str,
    ) -> GcpResult<Subscription> {
        let path = format!(
            "{}/projects/{}/subscriptions/{}",
            V1, project, subscription_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a subscription.
    pub async fn create_subscription(
        client: &mut GcpClient,
        project: &str,
        subscription_name: &str,
        topic: &str,
        ack_deadline_seconds: Option<u32>,
    ) -> GcpResult<Subscription> {
        let path = format!(
            "{}/projects/{}/subscriptions/{}",
            V1, project, subscription_name
        );
        let body = serde_json::json!({
            "topic": format!("projects/{}/topics/{}", project, topic),
            "ackDeadlineSeconds": ack_deadline_seconds.unwrap_or(10),
        });
        client.put(SERVICE, &path, &body).await
    }

    /// Delete a subscription.
    pub async fn delete_subscription(
        client: &mut GcpClient,
        project: &str,
        subscription_name: &str,
    ) -> GcpResult<()> {
        let path = format!(
            "{}/projects/{}/subscriptions/{}",
            V1, project, subscription_name
        );
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    /// Pull messages from a subscription.
    pub async fn pull(
        client: &mut GcpClient,
        project: &str,
        subscription_name: &str,
        max_messages: u32,
    ) -> GcpResult<Vec<ReceivedMessage>> {
        let path = format!(
            "{}/projects/{}/subscriptions/{}:pull",
            V1, project, subscription_name
        );
        let body = serde_json::json!({ "maxMessages": max_messages });
        let resp: PullResponse = client.post(SERVICE, &path, &body).await?;
        Ok(resp.received_messages)
    }

    /// Acknowledge received messages.
    pub async fn acknowledge(
        client: &mut GcpClient,
        project: &str,
        subscription_name: &str,
        ack_ids: Vec<String>,
    ) -> GcpResult<()> {
        let path = format!(
            "{}/projects/{}/subscriptions/{}:acknowledge",
            V1, project, subscription_name
        );
        let body = serde_json::json!({ "ackIds": ack_ids });
        client.post_text(SERVICE, &path, &body).await?;
        Ok(())
    }
}
