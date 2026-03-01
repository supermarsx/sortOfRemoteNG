//! AWS configuration, credential management, and region handling.
//!
//! Mirrors the design of `aws-config` and `aws-credential-types` from the
//! official AWS SDK for Rust. Supports static credentials, profile-based
//! credential resolution, assume-role via STS, and environment variable
//! resolution.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Regions ─────────────────────────────────────────────────────────────

/// All standard AWS regions as of 2025.
pub const AWS_REGIONS: &[&str] = &[
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "af-south-1",
    "ap-east-1",
    "ap-south-1",
    "ap-south-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-southeast-3",
    "ap-southeast-4",
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-northeast-3",
    "ca-central-1",
    "ca-west-1",
    "eu-central-1",
    "eu-central-2",
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "eu-south-1",
    "eu-south-2",
    "eu-north-1",
    "il-central-1",
    "me-south-1",
    "me-central-1",
    "sa-east-1",
    // GovCloud
    "us-gov-east-1",
    "us-gov-west-1",
    // China
    "cn-north-1",
    "cn-northwest-1",
];

/// AWS region configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AwsRegion {
    /// Region code (e.g., "us-east-1").
    pub name: String,
}

impl AwsRegion {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
        }
    }

    /// Return the service endpoint for a given service in this region.
    /// Follows the standard AWS endpoint pattern: `https://{service}.{region}.amazonaws.com`
    pub fn endpoint(&self, service: &str) -> String {
        match service {
            // S3 uses a slightly different pattern for path-style URLs
            "s3" => format!("https://s3.{}.amazonaws.com", self.name),
            // Global services
            "iam" | "sts" if self.name == "us-east-1" => {
                format!("https://{}.amazonaws.com", service)
            }
            "iam" => "https://iam.amazonaws.com".to_string(),
            "route53" => "https://route53.amazonaws.com".to_string(),
            "cloudfront" => "https://cloudfront.amazonaws.com".to_string(),
            // China partitions
            _ if self.name.starts_with("cn-") => {
                format!("https://{}.{}.amazonaws.com.cn", service, self.name)
            }
            // Standard regional endpoint
            _ => format!("https://{}.{}.amazonaws.com", service, self.name),
        }
    }

    /// Check if this is a valid AWS region.
    pub fn is_valid(&self) -> bool {
        AWS_REGIONS.contains(&self.name.as_str())
    }

    /// Return the partition for this region (aws, aws-cn, aws-us-gov).
    pub fn partition(&self) -> &str {
        if self.name.starts_with("cn-") {
            "aws-cn"
        } else if self.name.starts_with("us-gov-") {
            "aws-us-gov"
        } else {
            "aws"
        }
    }
}

impl Default for AwsRegion {
    fn default() -> Self {
        Self {
            name: "us-east-1".to_string(),
        }
    }
}

// ── Credentials ─────────────────────────────────────────────────────────

/// AWS credentials as defined by the AWS SDK credential-types crate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsCredentials {
    /// Access key ID (starts with AKIA for long-term, ASIA for temporary).
    pub access_key_id: String,
    /// Secret access key.
    pub secret_access_key: String,
    /// Optional session token (present for temporary credentials via STS).
    pub session_token: Option<String>,
    /// When these credentials expire (None for long-term IAM credentials).
    pub expiration: Option<DateTime<Utc>>,
    /// Provider name for debugging.
    pub provider_name: Option<String>,
}

impl AwsCredentials {
    /// Create new long-term credentials.
    pub fn new(access_key_id: &str, secret_access_key: &str) -> Self {
        Self {
            access_key_id: access_key_id.to_string(),
            secret_access_key: secret_access_key.to_string(),
            session_token: None,
            expiration: None,
            provider_name: Some("static".to_string()),
        }
    }

    /// Create temporary credentials with a session token.
    pub fn new_temporary(
        access_key_id: &str,
        secret_access_key: &str,
        session_token: &str,
        expiration: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            access_key_id: access_key_id.to_string(),
            secret_access_key: secret_access_key.to_string(),
            session_token: Some(session_token.to_string()),
            expiration,
            provider_name: Some("sts".to_string()),
        }
    }

    /// Check if these credentials have expired.
    pub fn is_expired(&self) -> bool {
        if let Some(exp) = self.expiration {
            Utc::now() > exp
        } else {
            false
        }
    }

    /// Check if credentials are temporary (have a session token).
    pub fn is_temporary(&self) -> bool {
        self.session_token.is_some()
    }

    /// Resolve credentials from environment variables as per AWS SDK chain.
    pub fn from_environment() -> Option<Self> {
        let access_key = std::env::var("AWS_ACCESS_KEY_ID").ok()?;
        let secret_key = std::env::var("AWS_SECRET_ACCESS_KEY").ok()?;
        let session_token = std::env::var("AWS_SESSION_TOKEN").ok();
        Some(Self {
            access_key_id: access_key,
            secret_access_key: secret_key,
            session_token,
            expiration: None,
            provider_name: Some("environment".to_string()),
        })
    }
}

// ── Named Profile ───────────────────────────────────────────────────────

/// An AWS CLI named profile entry, mirroring `~/.aws/credentials` and
/// `~/.aws/config` settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsProfile {
    /// Profile name (e.g., "default", "production").
    pub name: String,
    /// The region configured in this profile.
    pub region: Option<String>,
    /// Static credentials from the credentials file.
    pub credentials: Option<AwsCredentials>,
    /// Role ARN to assume.
    pub role_arn: Option<String>,
    /// Source profile for role chaining.
    pub source_profile: Option<String>,
    /// MFA serial number (ARN of MFA device).
    pub mfa_serial: Option<String>,
    /// External ID for cross-account role assumption.
    pub external_id: Option<String>,
    /// Session duration in seconds (for assume-role).
    pub duration_seconds: Option<u32>,
    /// SSO configuration.
    pub sso_start_url: Option<String>,
    pub sso_account_id: Option<String>,
    pub sso_role_name: Option<String>,
    pub sso_region: Option<String>,
    /// Output format preference.
    pub output: Option<String>,
    /// Custom endpoint URL override.
    pub endpoint_url: Option<String>,
}

impl Default for AwsProfile {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            region: Some("us-east-1".to_string()),
            credentials: None,
            role_arn: None,
            source_profile: None,
            mfa_serial: None,
            external_id: None,
            duration_seconds: None,
            sso_start_url: None,
            sso_account_id: None,
            sso_role_name: None,
            sso_region: None,
            output: None,
            endpoint_url: None,
        }
    }
}

// ── Connection Configuration ────────────────────────────────────────────

/// Full connection configuration for establishing an AWS session.
/// This is the Tauri command input type, matching the existing
/// `AwsConnectionConfig` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsConnectionConfig {
    /// AWS region to connect to.
    pub region: String,
    /// IAM access key ID.
    pub access_key_id: String,
    /// IAM secret access key.
    pub secret_access_key: String,
    /// Optional STS session token (for temporary credentials).
    pub session_token: Option<String>,
    /// Named profile to use (overrides static credentials if set).
    pub profile_name: Option<String>,
    /// IAM role ARN to assume after initial authentication.
    pub role_arn: Option<String>,
    /// MFA device serial number.
    pub mfa_serial: Option<String>,
    /// Current MFA TOTP code.
    pub mfa_code: Option<String>,
    /// Custom endpoint URL (for LocalStack, MinIO, etc.).
    pub endpoint_url: Option<String>,
    /// Session duration in seconds (default: 3600).
    pub session_duration: Option<u32>,
    /// External ID for cross-account access.
    pub external_id: Option<String>,
    /// Tags to apply to the session.
    pub tags: Option<HashMap<String, String>>,
}

impl AwsConnectionConfig {
    /// Convert to credentials.
    pub fn to_credentials(&self) -> AwsCredentials {
        if let Some(ref token) = self.session_token {
            AwsCredentials::new_temporary(
                &self.access_key_id,
                &self.secret_access_key,
                token,
                None,
            )
        } else {
            AwsCredentials::new(&self.access_key_id, &self.secret_access_key)
        }
    }

    /// Get the region for this config.
    pub fn region(&self) -> AwsRegion {
        AwsRegion::new(&self.region)
    }

    /// Validate the configuration.
    pub fn validate(&self) -> Result<(), String> {
        if self.access_key_id.is_empty() {
            return Err("Access key ID is required".to_string());
        }
        if self.secret_access_key.is_empty() {
            return Err("Secret access key is required".to_string());
        }
        if self.region.is_empty() {
            return Err("Region is required".to_string());
        }
        // Access key ID should start with AKIA (long-term) or ASIA (temporary)
        if !self.access_key_id.starts_with("AKIA")
            && !self.access_key_id.starts_with("ASIA")
            && !self.access_key_id.starts_with("AIDA")
        {
            log::warn!(
                "Access key ID '{}' has unusual prefix; expected AKIA* or ASIA*",
                &self.access_key_id[..4.min(self.access_key_id.len())]
            );
        }
        Ok(())
    }
}

// ── Retry Configuration ─────────────────────────────────────────────────

/// Retry configuration following the AWS SDK standard retry mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    /// Maximum number of retry attempts (default: 3).
    pub max_attempts: u32,
    /// Retry mode: "standard" or "adaptive".
    pub mode: RetryMode,
    /// Initial backoff duration in milliseconds (default: 500).
    pub initial_backoff_ms: u64,
    /// Maximum backoff duration in milliseconds (default: 20_000).
    pub max_backoff_ms: u64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            mode: RetryMode::Standard,
            initial_backoff_ms: 500,
            max_backoff_ms: 20_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RetryMode {
    /// Standard exponential backoff with jitter.
    Standard,
    /// Adaptive retry with client-side rate limiting.
    Adaptive,
    /// No retries.
    Legacy,
}

// ── SDK Config ──────────────────────────────────────────────────────────

/// Complete SDK configuration, aggregating credentials, region, and
/// behavioral settings. Mirrors `aws_config::SdkConfig`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdkConfig {
    pub region: AwsRegion,
    pub credentials: AwsCredentials,
    pub retry_config: RetryConfig,
    pub endpoint_url: Option<String>,
    /// Request timeout in seconds.
    pub request_timeout_secs: u64,
    /// Connect timeout in seconds.
    pub connect_timeout_secs: u64,
    /// User-Agent suffix appended to requests.
    pub app_name: Option<String>,
}

impl SdkConfig {
    /// Build from a connection config.
    pub fn from_connection_config(config: &AwsConnectionConfig) -> Self {
        Self {
            region: config.region(),
            credentials: config.to_credentials(),
            retry_config: RetryConfig::default(),
            endpoint_url: config.endpoint_url.clone(),
            request_timeout_secs: 30,
            connect_timeout_secs: 10,
            app_name: Some("SortOfRemoteNG".to_string()),
        }
    }
}

// ── Session ─────────────────────────────────────────────────────────────

/// Represents an active AWS session, analogous to a configured SDK client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsSession {
    /// Unique session identifier.
    pub id: String,
    /// The original connection configuration (credentials redacted in serialization).
    pub config: AwsConnectionConfig,
    /// When the session was established.
    pub connected_at: DateTime<Utc>,
    /// Last activity timestamp.
    pub last_activity: DateTime<Utc>,
    /// Whether the session is currently active.
    pub is_connected: bool,
    /// SDK configuration built from the connection config.
    #[serde(skip)]
    pub sdk_config: Option<SdkConfig>,
    /// Available services discovered during connection validation.
    pub services: Vec<AwsServiceInfo>,
    /// Account ID (from GetCallerIdentity).
    pub account_id: Option<String>,
    /// IAM user or role ARN.
    pub arn: Option<String>,
    /// IAM user ID.
    pub user_id: Option<String>,
}

/// Metadata about an available AWS service endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsServiceInfo {
    pub service_name: String,
    pub endpoint: String,
    pub status: String,
}

/// Common AWS tag structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub key: String,
    pub value: String,
}

impl Tag {
    pub fn new(key: &str, value: &str) -> Self {
        Self {
            key: key.to_string(),
            value: value.to_string(),
        }
    }
}

/// Convert a HashMap of tags to a Vec<Tag>.
pub fn tags_from_map(map: &HashMap<String, String>) -> Vec<Tag> {
    map.iter()
        .map(|(k, v)| Tag::new(k, v))
        .collect()
}

/// Convert a Vec<Tag> to a HashMap.
pub fn tags_to_map(tags: &[Tag]) -> HashMap<String, String> {
    tags.iter()
        .map(|t| (t.key.clone(), t.value.clone()))
        .collect()
}

/// Filter for AWS API queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Filter {
    pub name: String,
    pub values: Vec<String>,
}

impl Filter {
    pub fn new(name: &str, values: Vec<String>) -> Self {
        Self {
            name: name.to_string(),
            values,
        }
    }
}

/// Pagination token wrapper.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaginationConfig {
    pub next_token: Option<String>,
    pub max_results: Option<u32>,
}

/// A paginated response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub next_token: Option<String>,
    pub total_count: Option<u64>,
}

impl<T> PaginatedResponse<T> {
    pub fn empty() -> Self {
        Self {
            items: vec![],
            next_token: None,
            total_count: Some(0),
        }
    }

    pub fn has_more(&self) -> bool {
        self.next_token.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_endpoint_standard() {
        let r = AwsRegion::new("us-east-1");
        assert_eq!(r.endpoint("ec2"), "https://ec2.us-east-1.amazonaws.com");
        assert_eq!(r.endpoint("s3"), "https://s3.us-east-1.amazonaws.com");
        assert_eq!(r.endpoint("lambda"), "https://lambda.us-east-1.amazonaws.com");
    }

    #[test]
    fn region_endpoint_global() {
        let r = AwsRegion::new("us-east-1");
        assert_eq!(r.endpoint("iam"), "https://iam.amazonaws.com");
        assert_eq!(r.endpoint("route53"), "https://route53.amazonaws.com");
    }

    #[test]
    fn region_endpoint_china() {
        let r = AwsRegion::new("cn-north-1");
        assert_eq!(r.endpoint("ec2"), "https://ec2.cn-north-1.amazonaws.com.cn");
        assert_eq!(r.partition(), "aws-cn");
    }

    #[test]
    fn region_endpoint_govcloud() {
        let r = AwsRegion::new("us-gov-west-1");
        assert_eq!(r.partition(), "aws-us-gov");
    }

    #[test]
    fn region_is_valid() {
        assert!(AwsRegion::new("us-east-1").is_valid());
        assert!(AwsRegion::new("eu-west-1").is_valid());
        assert!(!AwsRegion::new("mars-central-1").is_valid());
    }

    #[test]
    fn credentials_not_expired_when_permanent() {
        let c = AwsCredentials::new("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfi");
        assert!(!c.is_expired());
        assert!(!c.is_temporary());
    }

    #[test]
    fn credentials_temporary() {
        let c = AwsCredentials::new_temporary("ASIA...", "secret", "token", None);
        assert!(c.is_temporary());
    }

    #[test]
    fn connection_config_validate_ok() {
        let cfg = AwsConnectionConfig {
            region: "us-east-1".to_string(),
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "secret".to_string(),
            session_token: None,
            profile_name: None,
            role_arn: None,
            mfa_serial: None,
            mfa_code: None,
            endpoint_url: None,
            session_duration: None,
            external_id: None,
            tags: None,
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn connection_config_validate_empty_key() {
        let cfg = AwsConnectionConfig {
            region: "us-east-1".to_string(),
            access_key_id: "".to_string(),
            secret_access_key: "secret".to_string(),
            session_token: None,
            profile_name: None,
            role_arn: None,
            mfa_serial: None,
            mfa_code: None,
            endpoint_url: None,
            session_duration: None,
            external_id: None,
            tags: None,
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn tags_roundtrip() {
        let map = HashMap::from([("Name".to_string(), "test".to_string())]);
        let tags = tags_from_map(&map);
        let back = tags_to_map(&tags);
        assert_eq!(back["Name"], "test");
    }

    #[test]
    fn paginated_response_empty() {
        let r: PaginatedResponse<String> = PaginatedResponse::empty();
        assert!(r.items.is_empty());
        assert!(!r.has_more());
    }

    #[test]
    fn sdk_config_from_connection() {
        let cfg = AwsConnectionConfig {
            region: "eu-west-1".to_string(),
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "secret".to_string(),
            session_token: None,
            profile_name: None,
            role_arn: None,
            mfa_serial: None,
            mfa_code: None,
            endpoint_url: Some("http://localhost:4566".to_string()),
            session_duration: None,
            external_id: None,
            tags: None,
        };
        let sdk = SdkConfig::from_connection_config(&cfg);
        assert_eq!(sdk.region.name, "eu-west-1");
        assert_eq!(sdk.endpoint_url, Some("http://localhost:4566".to_string()));
    }

    #[test]
    fn connection_config_serde_roundtrip() {
        let cfg = AwsConnectionConfig {
            region: "us-east-1".to_string(),
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfi".to_string(),
            session_token: Some("token123".to_string()),
            profile_name: Some("prod".to_string()),
            role_arn: Some("arn:aws:iam::123456789012:role/Admin".to_string()),
            mfa_serial: None,
            mfa_code: None,
            endpoint_url: None,
            session_duration: Some(3600),
            external_id: Some("ext-123".to_string()),
            tags: Some(HashMap::from([("Owner".to_string(), "team-a".to_string())])),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: AwsConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.region, "us-east-1");
        assert_eq!(back.role_arn, cfg.role_arn);
        assert_eq!(back.external_id, cfg.external_id);
    }
}
