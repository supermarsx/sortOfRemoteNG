//! WhatsApp Business Profile management via the Cloud API.
//!
//! Get and update the business profile information displayed to
//! customers when they interact with your WhatsApp Business number.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Extended business profile fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaBusinessProfileDetails {
    pub messaging_product: String,
    pub address: Option<String>,
    pub description: Option<String>,
    pub vertical: Option<String>,
    pub email: Option<String>,
    pub websites: Vec<String>,
    pub profile_picture_url: Option<String>,
    pub about: Option<String>,
}

/// Fields that can be updated on the business profile.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WaUpdateBusinessProfileRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websites: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_picture_handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
}

/// Business profile API operations.
pub struct WaBusinessProfileManager {
    client: CloudApiClient,
}

impl WaBusinessProfileManager {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// Get the business profile for the configured phone number.
    pub async fn get(&self) -> WhatsAppResult<WaBusinessProfileDetails> {
        let url = self.client.phone_url("whatsapp_business_profile");
        let resp = self
            .client
            .get_with_params(
                &url,
                &[("fields", "about,address,description,email,profile_picture_url,websites,vertical")],
            )
            .await?;

        let data = resp["data"]
            .as_array()
            .and_then(|arr| arr.first())
            .unwrap_or(&resp);

        Ok(WaBusinessProfileDetails {
            messaging_product: data["messaging_product"]
                .as_str()
                .unwrap_or("whatsapp")
                .to_string(),
            address: data["address"].as_str().map(String::from),
            description: data["description"].as_str().map(String::from),
            vertical: data["vertical"].as_str().map(String::from),
            email: data["email"].as_str().map(String::from),
            websites: data["websites"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|w| w.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            profile_picture_url: data["profile_picture_url"]
                .as_str()
                .map(String::from),
            about: data["about"].as_str().map(String::from),
        })
    }

    /// Update the business profile.
    ///
    /// Only provided fields will be updated; omitted fields remain
    /// unchanged.
    pub async fn update(
        &self,
        request: &WaUpdateBusinessProfileRequest,
    ) -> WhatsAppResult<()> {
        let url = self.client.phone_url("whatsapp_business_profile");

        let mut body = json!({
            "messaging_product": "whatsapp",
        });

        if let Some(ref addr) = request.address {
            body["address"] = json!(addr);
        }
        if let Some(ref desc) = request.description {
            body["description"] = json!(desc);
        }
        if let Some(ref vert) = request.vertical {
            body["vertical"] = json!(vert);
        }
        if let Some(ref email) = request.email {
            body["email"] = json!(email);
        }
        if let Some(ref sites) = request.websites {
            body["websites"] = json!(sites);
        }
        if let Some(ref handle) = request.profile_picture_handle {
            body["profile_picture_handle"] = json!(handle);
        }
        if let Some(ref about) = request.about {
            body["about"] = json!(about);
        }

        self.client.post_json(&url, &body).await?;
        info!("Updated business profile");
        Ok(())
    }

    /// Set only the business profile "about" text.
    pub async fn set_about(&self, about: &str) -> WhatsAppResult<()> {
        self.update(&WaUpdateBusinessProfileRequest {
            about: Some(about.to_string()),
            ..Default::default()
        })
        .await
    }

    /// Set only the business profile description.
    pub async fn set_description(
        &self,
        description: &str,
    ) -> WhatsAppResult<()> {
        self.update(&WaUpdateBusinessProfileRequest {
            description: Some(description.to_string()),
            ..Default::default()
        })
        .await
    }

    /// Set the profile picture by uploading a media handle.
    pub async fn set_profile_picture(
        &self,
        media_handle: &str,
    ) -> WhatsAppResult<()> {
        self.update(&WaUpdateBusinessProfileRequest {
            profile_picture_handle: Some(media_handle.to_string()),
            ..Default::default()
        })
        .await
    }

    /// Set business websites (max 2).
    pub async fn set_websites(
        &self,
        websites: Vec<String>,
    ) -> WhatsAppResult<()> {
        if websites.len() > 2 {
            return Err(WhatsAppError::internal(
                "WhatsApp Business API allows max 2 websites",
            ));
        }
        self.update(&WaUpdateBusinessProfileRequest {
            websites: Some(websites),
            ..Default::default()
        })
        .await
    }

    /// Get just the profile picture URL.
    pub async fn get_profile_picture_url(&self) -> WhatsAppResult<Option<String>> {
        let profile = self.get().await?;
        Ok(profile.profile_picture_url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_request_default() {
        let req = WaUpdateBusinessProfileRequest::default();
        assert!(req.address.is_none());
        assert!(req.description.is_none());
        assert!(req.about.is_none());
    }

    #[test]
    fn test_update_request_serialization() {
        let req = WaUpdateBusinessProfileRequest {
            about: Some("Test business".into()),
            email: Some("test@example.com".into()),
            ..Default::default()
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["about"], "Test business");
        assert_eq!(json["email"], "test@example.com");
        // None fields should be excluded
        assert!(json.get("address").is_none());
    }
}
