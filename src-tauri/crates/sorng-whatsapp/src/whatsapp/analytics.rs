//! WhatsApp messaging analytics via the Cloud API.
//!
//! Retrieve message analytics, conversation analytics, and per-template
//! performance data for your WhatsApp Business Account.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::WhatsAppResult;
use log::{debug, info};
use serde::{Deserialize, Serialize};

/// Conversation analytics summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaConversationAnalytics {
    pub phone_numbers: Vec<String>,
    pub granularity: String,
    pub data_points: Vec<WaConversationDataPoint>,
}

/// A single conversation analytics data point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaConversationDataPoint {
    pub start: String,
    pub end: String,
    pub conversation: u64,
    pub cost: f64,
    pub conversation_type: Option<String>,
    pub conversation_direction: Option<String>,
    pub country: Option<String>,
}

/// Template analytics summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaTemplateAnalytics {
    pub template_id: String,
    pub template_name: String,
    pub sent: u64,
    pub delivered: u64,
    pub read: u64,
    pub clicked: u64,
}

/// Message-level analytics for a time period.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaMessageAnalytics {
    pub sent: u64,
    pub delivered: u64,
    pub read: u64,
    pub failed: u64,
    pub period_start: String,
    pub period_end: String,
}

/// Analytics query parameters.
#[derive(Debug, Clone)]
pub struct WaAnalyticsQuery {
    pub start: String,
    pub end: String,
    pub granularity: WaAnalyticsGranularity,
    pub phone_numbers: Option<Vec<String>>,
    pub country_codes: Option<Vec<String>>,
    pub template_ids: Option<Vec<String>>,
}

/// Granularity for analytics queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WaAnalyticsGranularity {
    HalfHour,
    Daily,
    Monthly,
}

impl WaAnalyticsGranularity {
    pub fn as_str(&self) -> &str {
        match self {
            Self::HalfHour => "HALF_HOUR",
            Self::Daily => "DAILY",
            Self::Monthly => "MONTHLY",
        }
    }
}

/// Analytics API operations.
pub struct WaAnalytics {
    client: CloudApiClient,
}

impl WaAnalytics {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// Get conversation-based analytics for the business account.
    pub async fn get_conversation_analytics(
        &self,
        query: &WaAnalyticsQuery,
    ) -> WhatsAppResult<WaConversationAnalytics> {
        let url = self.client.waba_url("");

        let mut analytics_filter = serde_json::json!([{
            "field": "analytics",
            "filter_params": {
                "start": query.start,
                "end": query.end,
                "granularity": query.granularity.as_str(),
            }
        }]);

        if let Some(ref phones) = query.phone_numbers {
            analytics_filter[0]["filter_params"]["phone_numbers"] =
                serde_json::json!(phones);
        }
        if let Some(ref countries) = query.country_codes {
            analytics_filter[0]["filter_params"]["country_codes"] =
                serde_json::json!(countries);
        }

        let filter_str = analytics_filter.to_string();
        let resp = self
            .client
            .get_with_params(&url, &[("fields", "analytics.filter_params"), ("analytics", &filter_str)])
            .await?;

        let data = &resp["analytics"]["data_points"];
        let data_points: Vec<WaConversationDataPoint> = data
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|dp| parse_conversation_data_point(dp))
                    .collect()
            })
            .unwrap_or_default();

        let phone_numbers: Vec<String> = resp["analytics"]["phone_numbers"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| p.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        debug!(
            "Got {} conversation analytics data points",
            data_points.len()
        );

        Ok(WaConversationAnalytics {
            phone_numbers,
            granularity: query.granularity.as_str().to_string(),
            data_points,
        })
    }

    /// Get template performance analytics.
    pub async fn get_template_analytics(
        &self,
        template_ids: &[&str],
        start: &str,
        end: &str,
    ) -> WhatsAppResult<Vec<WaTemplateAnalytics>> {
        let url = self.client.waba_url("");

        let filter = serde_json::json!([{
            "field": "template_analytics",
            "filter_params": {
                "start": start,
                "end": end,
                "template_ids": template_ids,
            }
        }]);

        let filter_str = filter.to_string();
        let resp = self
            .client
            .get_with_params(&url, &[("fields", "template_analytics"), ("template_analytics", &filter_str)])
            .await?;

        let analytics: Vec<WaTemplateAnalytics> = resp["template_analytics"]["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| {
                        Some(WaTemplateAnalytics {
                            template_id: t["template_id"]
                                .as_str()?
                                .to_string(),
                            template_name: t["template_name"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            sent: t["sent"].as_u64().unwrap_or(0),
                            delivered: t["delivered"].as_u64().unwrap_or(0),
                            read: t["read"].as_u64().unwrap_or(0),
                            clicked: t["clicked"].as_u64().unwrap_or(0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        info!("Got analytics for {} templates", analytics.len());
        Ok(analytics)
    }

    /// Convenience: get daily message counts for a date range.
    pub async fn get_message_stats(
        &self,
        start: &str,
        end: &str,
    ) -> WhatsAppResult<WaMessageAnalytics> {
        let query = WaAnalyticsQuery {
            start: start.to_string(),
            end: end.to_string(),
            granularity: WaAnalyticsGranularity::Daily,
            phone_numbers: None,
            country_codes: None,
            template_ids: None,
        };

        let conv = self.get_conversation_analytics(&query).await?;

        let (sent, delivered, read) = conv
            .data_points
            .iter()
            .fold((0u64, 0u64, 0u64), |(s, d, r), dp| {
                (s + dp.conversation, d + dp.conversation, r)
            });

        Ok(WaMessageAnalytics {
            sent,
            delivered,
            read,
            failed: 0,
            period_start: start.to_string(),
            period_end: end.to_string(),
        })
    }

    /// Get analytics filtered by country.
    pub async fn get_analytics_by_country(
        &self,
        country_codes: &[&str],
        start: &str,
        end: &str,
    ) -> WhatsAppResult<WaConversationAnalytics> {
        let query = WaAnalyticsQuery {
            start: start.to_string(),
            end: end.to_string(),
            granularity: WaAnalyticsGranularity::Daily,
            phone_numbers: None,
            country_codes: Some(
                country_codes.iter().map(|c| c.to_string()).collect(),
            ),
            template_ids: None,
        };

        self.get_conversation_analytics(&query).await
    }
}

fn parse_conversation_data_point(
    v: &serde_json::Value,
) -> Option<WaConversationDataPoint> {
    Some(WaConversationDataPoint {
        start: v["start"].as_str().unwrap_or_default().to_string(),
        end: v["end"].as_str().unwrap_or_default().to_string(),
        conversation: v["conversation"].as_u64().unwrap_or(0),
        cost: v["cost"].as_f64().unwrap_or(0.0),
        conversation_type: v["conversation_type"].as_str().map(String::from),
        conversation_direction: v["conversation_direction"]
            .as_str()
            .map(String::from),
        country: v["country"].as_str().map(String::from),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_granularity_as_str() {
        assert_eq!(WaAnalyticsGranularity::Daily.as_str(), "DAILY");
        assert_eq!(WaAnalyticsGranularity::Monthly.as_str(), "MONTHLY");
        assert_eq!(WaAnalyticsGranularity::HalfHour.as_str(), "HALF_HOUR");
    }

    #[test]
    fn test_parse_conversation_data_point() {
        let json = serde_json::json!({
            "start": "2024-01-01",
            "end": "2024-01-02",
            "conversation": 150,
            "cost": 12.5,
            "conversation_type": "BUSINESS_INITIATED",
            "country": "US"
        });

        let dp = parse_conversation_data_point(&json).unwrap();
        assert_eq!(dp.conversation, 150);
        assert_eq!(dp.cost, 12.5);
        assert_eq!(dp.country.as_deref(), Some("US"));
    }
}
