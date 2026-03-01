//! WhatsApp phone number management via the Cloud API.
//!
//! List, get info, request verification codes, and verify phone numbers
//! associated with the WhatsApp Business Account.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Detailed phone number information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaPhoneNumberDetails {
    pub id: String,
    pub display_phone_number: String,
    pub verified_name: String,
    pub quality_rating: Option<String>,
    pub messaging_limit_tier: Option<String>,
    pub status: Option<String>,
    pub name_status: Option<String>,
    pub code_verification_status: Option<String>,
    pub platform_type: Option<String>,
    pub throughput: Option<WaPhoneNumberThroughput>,
    pub is_official_business_account: bool,
    pub is_pin_enabled: bool,
}

/// Throughput information for a phone number.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaPhoneNumberThroughput {
    pub level: String,
}

/// Phone number management operations.
pub struct WaPhoneNumbers {
    client: CloudApiClient,
}

impl WaPhoneNumbers {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// List all phone numbers for the business account.
    pub async fn list(&self) -> WhatsAppResult<Vec<WaPhoneNumberDetails>> {
        let url = self.client.waba_url("phone_numbers");

        let resp = self
            .client
            .get_with_params(
                &url,
                &[(
                    "fields",
                    "id,display_phone_number,verified_name,quality_rating,\
                     messaging_limit_tier,status,name_status,\
                     code_verification_status,platform_type,throughput,\
                     is_official_business_account,is_pin_enabled",
                )],
            )
            .await?;

        let numbers: Vec<WaPhoneNumberDetails> = resp["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|n| parse_phone_number_details(n))
                    .collect()
            })
            .unwrap_or_default();

        debug!("Listed {} phone numbers", numbers.len());
        Ok(numbers)
    }

    /// Get details for a specific phone number by ID.
    pub async fn get(&self, phone_number_id: &str) -> WhatsAppResult<WaPhoneNumberDetails> {
        let url = self.client.url(phone_number_id);
        let resp = self
            .client
            .get_with_params(
                &url,
                &[(
                    "fields",
                    "id,display_phone_number,verified_name,quality_rating,\
                     messaging_limit_tier,status,name_status,\
                     code_verification_status,platform_type,throughput,\
                     is_official_business_account,is_pin_enabled",
                )],
            )
            .await?;

        parse_phone_number_details(&resp).ok_or_else(|| {
            WhatsAppError::internal(format!(
                "Failed to parse phone number {}",
                phone_number_id
            ))
        })
    }

    /// Request a verification code via SMS or voice call.
    pub async fn request_verification_code(
        &self,
        phone_number_id: &str,
        code_method: VerificationCodeMethod,
        language: &str,
    ) -> WhatsAppResult<()> {
        let url = format!("{}/request_code", self.client.url(phone_number_id));

        let method_str = match code_method {
            VerificationCodeMethod::Sms => "SMS",
            VerificationCodeMethod::Voice => "VOICE",
        };

        let body = json!({
            "code_method": method_str,
            "language": language,
        });

        self.client.post_json(&url, &body).await?;
        info!(
            "Requested {} verification code for phone {}",
            method_str, phone_number_id
        );
        Ok(())
    }

    /// Verify a phone number with the received code.
    pub async fn verify_code(
        &self,
        phone_number_id: &str,
        code: &str,
    ) -> WhatsAppResult<()> {
        let url = format!("{}/verify_code", self.client.url(phone_number_id));

        let body = json!({ "code": code });

        self.client.post_json(&url, &body).await?;
        info!("Verified phone {}", phone_number_id);
        Ok(())
    }

    /// Get the quality rating for a phone number.
    pub async fn get_quality_rating(
        &self,
        phone_number_id: &str,
    ) -> WhatsAppResult<Option<String>> {
        let details = self.get(phone_number_id).await?;
        Ok(details.quality_rating)
    }

    /// Get the messaging limit tier for a phone number.
    pub async fn get_messaging_limit(
        &self,
        phone_number_id: &str,
    ) -> WhatsAppResult<Option<String>> {
        let details = self.get(phone_number_id).await?;
        Ok(details.messaging_limit_tier)
    }

    /// Register a phone number with the Cloud API.
    ///
    /// This is the initial step to start using a phone number with
    /// the Cloud API after porting from the On-Premises API.
    pub async fn register(
        &self,
        phone_number_id: &str,
        pin: &str,
    ) -> WhatsAppResult<()> {
        let url = format!("{}/register", self.client.url(phone_number_id));

        let body = json!({
            "messaging_product": "whatsapp",
            "pin": pin,
        });

        self.client.post_json(&url, &body).await?;
        info!("Registered phone {} with Cloud API", phone_number_id);
        Ok(())
    }

    /// Deregister a phone number from the Cloud API.
    pub async fn deregister(
        &self,
        phone_number_id: &str,
    ) -> WhatsAppResult<()> {
        let url = format!("{}/deregister", self.client.url(phone_number_id));
        self.client.post_json(&url, &json!({})).await?;
        info!("Deregistered phone {}", phone_number_id);
        Ok(())
    }
}

/// How to deliver the verification code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VerificationCodeMethod {
    Sms,
    Voice,
}

fn parse_phone_number_details(v: &serde_json::Value) -> Option<WaPhoneNumberDetails> {
    let id = v["id"].as_str()?.to_string();
    let display = v["display_phone_number"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let verified_name = v["verified_name"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    let throughput = v["throughput"]["level"].as_str().map(|l| {
        WaPhoneNumberThroughput {
            level: l.to_string(),
        }
    });

    Some(WaPhoneNumberDetails {
        id,
        display_phone_number: display,
        verified_name,
        quality_rating: v["quality_rating"].as_str().map(String::from),
        messaging_limit_tier: v["messaging_limit_tier"]
            .as_str()
            .map(String::from),
        status: v["status"].as_str().map(String::from),
        name_status: v["name_status"].as_str().map(String::from),
        code_verification_status: v["code_verification_status"]
            .as_str()
            .map(String::from),
        platform_type: v["platform_type"].as_str().map(String::from),
        throughput,
        is_official_business_account: v["is_official_business_account"]
            .as_bool()
            .unwrap_or(false),
        is_pin_enabled: v["is_pin_enabled"].as_bool().unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_phone_number_details() {
        let json = serde_json::json!({
            "id": "12345",
            "display_phone_number": "+1 555-0123",
            "verified_name": "Test Business",
            "quality_rating": "GREEN",
            "messaging_limit_tier": "TIER_250",
            "status": "CONNECTED",
            "is_official_business_account": true,
            "is_pin_enabled": false,
            "throughput": { "level": "STANDARD" }
        });

        let details = parse_phone_number_details(&json).unwrap();
        assert_eq!(details.id, "12345");
        assert_eq!(details.display_phone_number, "+1 555-0123");
        assert_eq!(details.quality_rating.as_deref(), Some("GREEN"));
        assert!(details.is_official_business_account);
        assert_eq!(details.throughput.unwrap().level, "STANDARD");
    }

    #[test]
    fn test_parse_phone_number_minimal() {
        let json = serde_json::json!({
            "id": "999",
        });
        let details = parse_phone_number_details(&json).unwrap();
        assert_eq!(details.id, "999");
        assert!(!details.is_pin_enabled);
    }
}
