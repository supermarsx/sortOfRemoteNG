//! AWS SNS (Simple Notification Service) client.
//!
//! Mirrors `aws-sdk-sns` types and operations. SNS uses the AWS Query protocol
//! with XML responses (API version 2010-03-31).
//!
//! Reference: <https://docs.aws.amazon.com/sns/latest/api/>

use crate::client::{self, AwsClient};
use crate::error::AwsResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const API_VERSION: &str = "2010-03-31";
const SERVICE: &str = "sns";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Topic {
    pub topic_arn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicAttributes {
    pub topic_arn: String,
    pub display_name: Option<String>,
    pub owner: Option<String>,
    pub subscriptions_confirmed: Option<u32>,
    pub subscriptions_deleted: Option<u32>,
    pub subscriptions_pending: Option<u32>,
    pub effective_delivery_policy: Option<String>,
    pub policy: Option<String>,
    pub kms_master_key_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub subscription_arn: String,
    pub topic_arn: String,
    pub protocol: String,
    pub endpoint: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageAttribute {
    pub data_type: String,
    pub string_value: Option<String>,
    pub binary_value: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishResponse {
    pub message_id: String,
    pub sequence_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformApplication {
    pub platform_application_arn: String,
    pub attributes: HashMap<String, String>,
}

// ── SNS Client ──────────────────────────────────────────────────────────

pub struct SnsClient {
    client: AwsClient,
}

impl SnsClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── Topics ──────────────────────────────────────────────────────

    pub async fn list_topics(&self, next_token: Option<&str>) -> AwsResult<(Vec<Topic>, Option<String>)> {
        let mut params = client::build_query_params("ListTopics", API_VERSION);
        if let Some(nt) = next_token {
            params.insert("NextToken".to_string(), nt.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let arns = client::xml_blocks(&response.body, "member")
            .iter()
            .filter_map(|b| client::xml_text(b, "TopicArn").map(|arn| Topic { topic_arn: arn }))
            .collect();
        let next = client::xml_text(&response.body, "NextToken");
        Ok((arns, next))
    }

    pub async fn create_topic(&self, name: &str, attributes: &HashMap<String, String>) -> AwsResult<String> {
        let mut params = client::build_query_params("CreateTopic", API_VERSION);
        params.insert("Name".to_string(), name.to_string());
        for (i, (k, v)) in attributes.iter().enumerate() {
            params.insert(format!("Attributes.entry.{}.key", i + 1), k.clone());
            params.insert(format!("Attributes.entry.{}.value", i + 1), v.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "TopicArn").unwrap_or_default())
    }

    pub async fn delete_topic(&self, topic_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteTopic", API_VERSION);
        params.insert("TopicArn".to_string(), topic_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn get_topic_attributes(&self, topic_arn: &str) -> AwsResult<TopicAttributes> {
        let mut params = client::build_query_params("GetTopicAttributes", API_VERSION);
        params.insert("TopicArn".to_string(), topic_arn.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        let attrs = self.parse_attributes(&response.body);
        Ok(TopicAttributes {
            topic_arn: topic_arn.to_string(),
            display_name: attrs.get("DisplayName").cloned(),
            owner: attrs.get("Owner").cloned(),
            subscriptions_confirmed: attrs.get("SubscriptionsConfirmed").and_then(|v| v.parse().ok()),
            subscriptions_deleted: attrs.get("SubscriptionsDeleted").and_then(|v| v.parse().ok()),
            subscriptions_pending: attrs.get("SubscriptionsPending").and_then(|v| v.parse().ok()),
            effective_delivery_policy: attrs.get("EffectiveDeliveryPolicy").cloned(),
            policy: attrs.get("Policy").cloned(),
            kms_master_key_id: attrs.get("KmsMasterKeyId").cloned(),
        })
    }

    pub async fn set_topic_attributes(&self, topic_arn: &str, attribute_name: &str, attribute_value: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("SetTopicAttributes", API_VERSION);
        params.insert("TopicArn".to_string(), topic_arn.to_string());
        params.insert("AttributeName".to_string(), attribute_name.to_string());
        params.insert("AttributeValue".to_string(), attribute_value.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── Subscriptions ───────────────────────────────────────────────

    pub async fn subscribe(&self, topic_arn: &str, protocol: &str, endpoint: &str) -> AwsResult<String> {
        let mut params = client::build_query_params("Subscribe", API_VERSION);
        params.insert("TopicArn".to_string(), topic_arn.to_string());
        params.insert("Protocol".to_string(), protocol.to_string());
        params.insert("Endpoint".to_string(), endpoint.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "SubscriptionArn").unwrap_or_else(|| "pending confirmation".to_string()))
    }

    pub async fn unsubscribe(&self, subscription_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("Unsubscribe", API_VERSION);
        params.insert("SubscriptionArn".to_string(), subscription_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn list_subscriptions(&self, next_token: Option<&str>) -> AwsResult<(Vec<Subscription>, Option<String>)> {
        let mut params = client::build_query_params("ListSubscriptions", API_VERSION);
        if let Some(nt) = next_token {
            params.insert("NextToken".to_string(), nt.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let subs = client::xml_blocks(&response.body, "member").iter().filter_map(|b| {
            Some(Subscription {
                subscription_arn: client::xml_text(b, "SubscriptionArn")?,
                topic_arn: client::xml_text(b, "TopicArn").unwrap_or_default(),
                protocol: client::xml_text(b, "Protocol").unwrap_or_default(),
                endpoint: client::xml_text(b, "Endpoint").unwrap_or_default(),
                owner: client::xml_text(b, "Owner"),
            })
        }).collect();
        let next = client::xml_text(&response.body, "NextToken");
        Ok((subs, next))
    }

    pub async fn list_subscriptions_by_topic(&self, topic_arn: &str) -> AwsResult<Vec<Subscription>> {
        let mut params = client::build_query_params("ListSubscriptionsByTopic", API_VERSION);
        params.insert("TopicArn".to_string(), topic_arn.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_blocks(&response.body, "member").iter().filter_map(|b| {
            Some(Subscription {
                subscription_arn: client::xml_text(b, "SubscriptionArn")?,
                topic_arn: client::xml_text(b, "TopicArn").unwrap_or_default(),
                protocol: client::xml_text(b, "Protocol").unwrap_or_default(),
                endpoint: client::xml_text(b, "Endpoint").unwrap_or_default(),
                owner: client::xml_text(b, "Owner"),
            })
        }).collect())
    }

    // ── Publishing ──────────────────────────────────────────────────

    pub async fn publish(&self, topic_arn: Option<&str>, target_arn: Option<&str>, phone_number: Option<&str>, message: &str, subject: Option<&str>, message_attributes: &HashMap<String, MessageAttribute>) -> AwsResult<PublishResponse> {
        let mut params = client::build_query_params("Publish", API_VERSION);
        if let Some(ta) = topic_arn {
            params.insert("TopicArn".to_string(), ta.to_string());
        }
        if let Some(tg) = target_arn {
            params.insert("TargetArn".to_string(), tg.to_string());
        }
        if let Some(ph) = phone_number {
            params.insert("PhoneNumber".to_string(), ph.to_string());
        }
        params.insert("Message".to_string(), message.to_string());
        if let Some(s) = subject {
            params.insert("Subject".to_string(), s.to_string());
        }
        for (i, (name, attr)) in message_attributes.iter().enumerate() {
            let prefix = format!("MessageAttributes.entry.{}", i + 1);
            params.insert(format!("{}.Name", prefix), name.clone());
            params.insert(format!("{}.Value.DataType", prefix), attr.data_type.clone());
            if let Some(ref sv) = attr.string_value {
                params.insert(format!("{}.Value.StringValue", prefix), sv.clone());
            }
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(PublishResponse {
            message_id: client::xml_text(&response.body, "MessageId").unwrap_or_default(),
            sequence_number: client::xml_text(&response.body, "SequenceNumber"),
        })
    }

    /// Publishes a message in batch to a topic.
    pub async fn publish_batch(&self, topic_arn: &str, entries: &[(String, String)]) -> AwsResult<Vec<String>> {
        let mut params = client::build_query_params("PublishBatch", API_VERSION);
        params.insert("TopicArn".to_string(), topic_arn.to_string());
        for (i, (id, message)) in entries.iter().enumerate() {
            let prefix = format!("PublishBatchRequestEntries.member.{}", i + 1);
            params.insert(format!("{}.Id", prefix), id.clone());
            params.insert(format!("{}.Message", prefix), message.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let ids = client::xml_blocks(&response.body, "member").iter().filter_map(|b| {
            client::xml_text(b, "MessageId")
        }).collect();
        Ok(ids)
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn parse_attributes(&self, xml: &str) -> HashMap<String, String> {
        let mut attrs = HashMap::new();
        for entry in client::xml_blocks(xml, "entry") {
            if let (Some(key), Some(value)) = (client::xml_text(&entry, "key"), client::xml_text(&entry, "value")) {
                attrs.insert(key, value);
            }
        }
        attrs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topic_serde() {
        let t = Topic { topic_arn: "arn:aws:sns:us-east-1:123:my-topic".to_string() };
        let json = serde_json::to_string(&t).unwrap();
        let back: Topic = serde_json::from_str(&json).unwrap();
        assert_eq!(back.topic_arn, "arn:aws:sns:us-east-1:123:my-topic");
    }

    #[test]
    fn subscription_serde() {
        let s = Subscription {
            subscription_arn: "arn:aws:sns:us-east-1:123:my-topic:sub-1".to_string(),
            topic_arn: "arn:aws:sns:us-east-1:123:my-topic".to_string(),
            protocol: "email".to_string(),
            endpoint: "user@example.com".to_string(),
            owner: Some("123456789012".to_string()),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("email"));
    }
}
