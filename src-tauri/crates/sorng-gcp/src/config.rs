//! GCP configuration, credential management, project/region/zone handling.
//!
//! Supports service account key authentication, OAuth2 scopes, and the
//! standard GCP region/zone topology.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Regions & Zones ─────────────────────────────────────────────────────

/// All standard GCP regions as of 2025.
pub const GCP_REGIONS: &[&str] = &[
    // Americas
    "us-central1",
    "us-east1",
    "us-east4",
    "us-east5",
    "us-south1",
    "us-west1",
    "us-west2",
    "us-west3",
    "us-west4",
    "northamerica-northeast1",
    "northamerica-northeast2",
    "southamerica-east1",
    "southamerica-west1",
    // Europe
    "europe-central2",
    "europe-north1",
    "europe-southwest1",
    "europe-west1",
    "europe-west2",
    "europe-west3",
    "europe-west4",
    "europe-west6",
    "europe-west8",
    "europe-west9",
    "europe-west10",
    "europe-west12",
    // Asia-Pacific
    "asia-east1",
    "asia-east2",
    "asia-northeast1",
    "asia-northeast2",
    "asia-northeast3",
    "asia-south1",
    "asia-south2",
    "asia-southeast1",
    "asia-southeast2",
    // Middle East & Africa
    "me-central1",
    "me-central2",
    "me-west1",
    "africa-south1",
    // Australia
    "australia-southeast1",
    "australia-southeast2",
];

/// Standard zone suffixes.
pub const ZONE_SUFFIXES: &[&str] = &["-a", "-b", "-c", "-f"];

/// GCP region descriptor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GcpRegion {
    pub name: String,
}

impl GcpRegion {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
        }
    }

    /// Check if this is a valid GCP region.
    pub fn is_valid(&self) -> bool {
        GCP_REGIONS.contains(&self.name.as_str())
    }

    /// Return standard zones for this region (e.g., us-central1-a, us-central1-b, us-central1-c).
    pub fn zones(&self) -> Vec<String> {
        ZONE_SUFFIXES
            .iter()
            .map(|s| format!("{}{}", self.name, s))
            .collect()
    }
}

impl Default for GcpRegion {
    fn default() -> Self {
        Self {
            name: "us-central1".to_string(),
        }
    }
}

// ── Service Account Key ─────────────────────────────────────────────────

/// Parsed service account key JSON file (downloaded from Google Cloud Console).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceAccountKey {
    pub r#type: String,
    pub project_id: String,
    pub private_key_id: String,
    pub private_key: String,
    pub client_email: String,
    pub client_id: String,
    pub auth_uri: String,
    pub token_uri: String,
    pub auth_provider_x509_cert_url: String,
    pub client_x509_cert_url: String,
    #[serde(default)]
    pub universe_domain: Option<String>,
}

impl ServiceAccountKey {
    /// Parse a service account key from a JSON string.
    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json)
            .map_err(|e| format!("Invalid service account key JSON: {}", e))
    }

    /// Validate the key has required fields.
    pub fn validate(&self) -> Result<(), String> {
        if self.r#type != "service_account" {
            return Err(format!("Expected type 'service_account', got '{}'", self.r#type));
        }
        if self.project_id.is_empty() {
            return Err("project_id is empty".to_string());
        }
        if self.private_key.is_empty() {
            return Err("private_key is empty".to_string());
        }
        if self.client_email.is_empty() {
            return Err("client_email is empty".to_string());
        }
        if self.token_uri.is_empty() {
            return Err("token_uri is empty".to_string());
        }
        Ok(())
    }
}

// ── Connection Config ───────────────────────────────────────────────────

/// Configuration for connecting to a GCP project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpConnectionConfig {
    /// GCP project ID.
    pub project_id: String,
    /// The raw JSON of the service account key file.
    pub service_account_key_json: String,
    /// Default region for operations.
    pub region: Option<String>,
    /// Default zone for operations.
    pub zone: Option<String>,
    /// OAuth2 scopes to request.
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    /// Custom API endpoint override (for emulators/testing).
    pub endpoint_override: Option<String>,
}

fn default_scopes() -> Vec<String> {
    vec!["https://www.googleapis.com/auth/cloud-platform".to_string()]
}

impl GcpConnectionConfig {
    /// Validate the connection config.
    pub fn validate(&self) -> Result<(), String> {
        if self.project_id.is_empty() {
            return Err("project_id is required".to_string());
        }
        let key = ServiceAccountKey::from_json(&self.service_account_key_json)?;
        key.validate()?;
        if key.project_id != self.project_id {
            return Err(format!(
                "project_id mismatch: config says '{}' but key says '{}'",
                self.project_id, key.project_id
            ));
        }
        if let Some(ref region) = self.region {
            let r = GcpRegion::new(region);
            if !r.is_valid() {
                return Err(format!("Invalid GCP region: {}", region));
            }
        }
        Ok(())
    }
}

// ── Session ─────────────────────────────────────────────────────────────

/// Available GCP services detected/enabled for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpServiceInfo {
    pub name: String,
    pub available: bool,
}

/// A live GCP session with authentication state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpSession {
    /// Session ID.
    pub id: String,
    /// Project ID.
    pub project_id: String,
    /// Service account email.
    pub service_account_email: String,
    /// Default region.
    pub region: Option<String>,
    /// Default zone.
    pub zone: Option<String>,
    /// When the session was created.
    pub connected_at: DateTime<Utc>,
    /// Last API activity.
    pub last_activity: DateTime<Utc>,
    /// Whether the session is active.
    pub is_connected: bool,
    /// Available services.
    pub services: Vec<GcpServiceInfo>,
    /// Labels/tags.
    pub labels: HashMap<String, String>,
}

// ── Pagination ──────────────────────────────────────────────────────────

/// Standard GCP paginated response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub next_page_token: Option<String>,
    pub total_items: Option<u64>,
}

// ── Common Tags / Labels ────────────────────────────────────────────────

/// GCP resource label (key-value pair).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub key: String,
    pub value: String,
}

/// Filter expression for listing resources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Filter {
    /// Filter expression string (e.g., "status = RUNNING").
    pub expression: String,
}
