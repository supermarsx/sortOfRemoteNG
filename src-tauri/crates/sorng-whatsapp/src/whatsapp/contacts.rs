//! WhatsApp contacts verification and lookup.
//!
//! Check whether phone numbers are registered on WhatsApp before
//! sending messages.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::WhatsAppResult;
use log::debug;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Contact verification results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaContactCheck {
    pub input: String,
    pub wa_id: Option<String>,
    pub status: WaContactStatus,
}

/// Whether a phone number is registered on WhatsApp.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WaContactStatus {
    Valid,
    Invalid,
    Processing,
}

/// Contacts-related API operations.
pub struct WaContacts {
    client: CloudApiClient,
}

impl WaContacts {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// Verify whether phone numbers are on WhatsApp.
    ///
    /// Uses the contacts endpoint of the Cloud API.
    /// Returns status for each number.
    pub async fn check_contacts(
        &self,
        phone_numbers: &[&str],
    ) -> WhatsAppResult<Vec<WaContactCheck>> {
        let url = self.client.phone_url("contacts");
        let body = json!({
            "blocking": "wait",
            "contacts": phone_numbers,
            "force_check": true,
        });

        let resp = self.client.post_json(&url, &body).await?;

        let contacts: Vec<WaContactCheck> = resp["contacts"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|c| WaContactCheck {
                        input: c["input"].as_str().unwrap_or_default().to_string(),
                        wa_id: c["wa_id"].as_str().map(String::from),
                        status: match c["status"].as_str() {
                            Some("valid") => WaContactStatus::Valid,
                            Some("invalid") => WaContactStatus::Invalid,
                            Some("processing") => WaContactStatus::Processing,
                            _ => WaContactStatus::Invalid,
                        },
                    })
                    .collect()
            })
            .unwrap_or_default();

        debug!("Checked {} contacts", contacts.len());
        Ok(contacts)
    }

    /// Check a single phone number.
    pub async fn is_on_whatsapp(
        &self,
        phone_number: &str,
    ) -> WhatsAppResult<bool> {
        let results = self.check_contacts(&[phone_number]).await?;
        Ok(results
            .first()
            .map(|r| r.status == WaContactStatus::Valid)
            .unwrap_or(false))
    }

    /// Get the WhatsApp ID for a phone number (if registered).
    pub async fn get_wa_id(
        &self,
        phone_number: &str,
    ) -> WhatsAppResult<Option<String>> {
        let results = self.check_contacts(&[phone_number]).await?;
        Ok(results.first().and_then(|r| r.wa_id.clone()))
    }

    /// Batch-check multiple numbers and return only valid ones.
    pub async fn filter_valid_contacts(
        &self,
        phone_numbers: &[&str],
    ) -> WhatsAppResult<Vec<WaContactCheck>> {
        let results = self.check_contacts(phone_numbers).await?;
        Ok(results
            .into_iter()
            .filter(|c| c.status == WaContactStatus::Valid)
            .collect())
    }

    /// Generate a wa.me short link for a phone number.
    pub fn wa_me_link(phone_number: &str, prefilled_message: Option<&str>) -> String {
        let clean = phone_number
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>();

        match prefilled_message {
            Some(msg) => {
                let encoded = urlencoding::encode(msg);
                format!("https://wa.me/{}?text={}", clean, encoded)
            }
            None => format!("https://wa.me/{}", clean),
        }
    }

    /// Generate a WhatsApp click-to-chat link with pre-filled message.
    pub fn click_to_chat_link(
        phone_number: &str,
        message: &str,
    ) -> String {
        Self::wa_me_link(phone_number, Some(message))
    }
}

// urlencoding helper (minimal to avoid extra dependency)
mod urlencoding {
    pub fn encode(input: &str) -> String {
        let mut encoded = String::with_capacity(input.len() * 3);
        for byte in input.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(byte as char);
                }
                _ => {
                    encoded.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        encoded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wa_me_link() {
        let link = WaContacts::wa_me_link("+1-234-567-8900", None);
        assert_eq!(link, "https://wa.me/12345678900");
    }

    #[test]
    fn test_wa_me_link_with_message() {
        let link = WaContacts::wa_me_link("+1234567890", Some("Hello World"));
        assert!(link.starts_with("https://wa.me/1234567890?text="));
        assert!(link.contains("Hello"));
    }

    #[test]
    fn test_click_to_chat() {
        let link = WaContacts::click_to_chat_link("1234567890", "Hi there!");
        assert!(link.starts_with("https://wa.me/1234567890"));
        assert!(link.contains("text="));
    }
}
