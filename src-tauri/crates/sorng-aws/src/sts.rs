//! AWS STS (Security Token Service) client.
//!
//! Mirrors `aws-sdk-sts` types and operations. STS uses the AWS Query protocol
//! with XML responses (API version 2011-06-15). STS supports global and regional endpoints.
//!
//! Reference: <https://docs.aws.amazon.com/STS/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};

const API_VERSION: &str = "2011-06-15";
const SERVICE: &str = "sts";

// ── Types ───────────────────────────────────────────────────────────────

/// Temporary security credentials returned by STS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: String,
    pub expiration: String,
}

/// The identifiers for the temporary security credentials that the operation returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssumedRoleUser {
    pub assumed_role_id: String,
    pub arn: String,
}

/// Contains the response to a successful `GetCallerIdentity` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallerIdentity {
    pub account: String,
    pub arn: String,
    pub user_id: String,
}

/// parameters for `AssumeRole`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssumeRoleInput {
    pub role_arn: String,
    pub role_session_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_identity: Option<String>,
}

/// Parameters for `AssumeRoleWithWebIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssumeRoleWithWebIdentityInput {
    pub role_arn: String,
    pub role_session_name: String,
    pub web_identity_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
}

/// Parameters for `AssumeRoleWithSAML`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssumeRoleWithSamlInput {
    pub role_arn: String,
    pub principal_arn: String,
    pub saml_assertion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
}

/// Response from AssumeRole and similar operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssumeRoleOutput {
    pub credentials: Credentials,
    pub assumed_role_user: AssumedRoleUser,
    pub packed_policy_size: Option<u32>,
    pub source_identity: Option<String>,
}

/// Parameters for `GetSessionToken`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetSessionTokenInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_code: Option<String>,
}

/// Response from `GetAccessKeyInfo`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessKeyInfo {
    pub account: String,
}

/// Federation token information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedUser {
    pub federated_user_id: String,
    pub arn: String,
}

/// Response from `GetFederationToken`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetFederationTokenOutput {
    pub credentials: Credentials,
    pub federated_user: FederatedUser,
    pub packed_policy_size: Option<u32>,
}

// ── STS Client ──────────────────────────────────────────────────────────

pub struct StsClient {
    client: AwsClient,
}

impl StsClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    /// Returns details about the IAM user or role whose credentials are used
    /// to call the operation. This is the AWS equivalent of `whoami`.
    pub async fn get_caller_identity(&self) -> AwsResult<CallerIdentity> {
        let params = client::build_query_params("GetCallerIdentity", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(CallerIdentity {
            account: client::xml_text(&response.body, "Account").unwrap_or_default(),
            arn: client::xml_text(&response.body, "Arn").unwrap_or_default(),
            user_id: client::xml_text(&response.body, "UserId").unwrap_or_default(),
        })
    }

    /// Assumes a role, returning temporary credentials for the assumed role.
    /// 
    /// This is the most commonly used STS operation, enabling cross-account
    /// access and privilege escalation patterns.
    pub async fn assume_role(&self, input: &AssumeRoleInput) -> AwsResult<AssumeRoleOutput> {
        let mut params = client::build_query_params("AssumeRole", API_VERSION);
        params.insert("RoleArn".to_string(), input.role_arn.clone());
        params.insert("RoleSessionName".to_string(), input.role_session_name.clone());
        if let Some(dur) = input.duration_seconds {
            params.insert("DurationSeconds".to_string(), dur.to_string());
        }
        if let Some(ref ext) = input.external_id {
            params.insert("ExternalId".to_string(), ext.clone());
        }
        if let Some(ref policy) = input.policy {
            params.insert("Policy".to_string(), policy.clone());
        }
        if let Some(ref serial) = input.serial_number {
            params.insert("SerialNumber".to_string(), serial.clone());
        }
        if let Some(ref code) = input.token_code {
            params.insert("TokenCode".to_string(), code.clone());
        }
        if let Some(ref src_id) = input.source_identity {
            params.insert("SourceIdentity".to_string(), src_id.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_assume_role_response(&response.body)
    }

    /// Assumes a role using a web identity token from an OIDC provider (Cognito, Google, etc.).
    pub async fn assume_role_with_web_identity(&self, input: &AssumeRoleWithWebIdentityInput) -> AwsResult<AssumeRoleOutput> {
        let mut params = client::build_query_params("AssumeRoleWithWebIdentity", API_VERSION);
        params.insert("RoleArn".to_string(), input.role_arn.clone());
        params.insert("RoleSessionName".to_string(), input.role_session_name.clone());
        params.insert("WebIdentityToken".to_string(), input.web_identity_token.clone());
        if let Some(dur) = input.duration_seconds {
            params.insert("DurationSeconds".to_string(), dur.to_string());
        }
        if let Some(ref prov) = input.provider_id {
            params.insert("ProviderId".to_string(), prov.clone());
        }
        if let Some(ref policy) = input.policy {
            params.insert("Policy".to_string(), policy.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_assume_role_response(&response.body)
    }

    /// Assumes a role using a SAML authentication response.
    pub async fn assume_role_with_saml(&self, input: &AssumeRoleWithSamlInput) -> AwsResult<AssumeRoleOutput> {
        let mut params = client::build_query_params("AssumeRoleWithSAML", API_VERSION);
        params.insert("RoleArn".to_string(), input.role_arn.clone());
        params.insert("PrincipalArn".to_string(), input.principal_arn.clone());
        params.insert("SAMLAssertion".to_string(), input.saml_assertion.clone());
        if let Some(dur) = input.duration_seconds {
            params.insert("DurationSeconds".to_string(), dur.to_string());
        }
        if let Some(ref policy) = input.policy {
            params.insert("Policy".to_string(), policy.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_assume_role_response(&response.body)
    }

    /// Returns a set of temporary credentials for an already-authenticated user.
    /// Useful for MFA-protected operations.
    pub async fn get_session_token(&self, input: &GetSessionTokenInput) -> AwsResult<Credentials> {
        let mut params = client::build_query_params("GetSessionToken", API_VERSION);
        if let Some(dur) = input.duration_seconds {
            params.insert("DurationSeconds".to_string(), dur.to_string());
        }
        if let Some(ref serial) = input.serial_number {
            params.insert("SerialNumber".to_string(), serial.clone());
        }
        if let Some(ref code) = input.token_code {
            params.insert("TokenCode".to_string(), code.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_credentials(&response.body)
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "Failed to parse credentials", 200))
    }

    /// Returns the account ID number associated with the given access key.
    pub async fn get_access_key_info(&self, access_key_id: &str) -> AwsResult<AccessKeyInfo> {
        let mut params = client::build_query_params("GetAccessKeyInfo", API_VERSION);
        params.insert("AccessKeyId".to_string(), access_key_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(AccessKeyInfo {
            account: client::xml_text(&response.body, "Account").unwrap_or_default(),
        })
    }

    /// Returns temporary credentials for a federated user.
    pub async fn get_federation_token(&self, name: &str, duration_seconds: Option<u32>, policy: Option<&str>) -> AwsResult<GetFederationTokenOutput> {
        let mut params = client::build_query_params("GetFederationToken", API_VERSION);
        params.insert("Name".to_string(), name.to_string());
        if let Some(dur) = duration_seconds {
            params.insert("DurationSeconds".to_string(), dur.to_string());
        }
        if let Some(p) = policy {
            params.insert("Policy".to_string(), p.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let creds = self.parse_credentials(&response.body)
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "Failed to parse credentials", 200))?;
        Ok(GetFederationTokenOutput {
            credentials: creds,
            federated_user: FederatedUser {
                federated_user_id: client::xml_text(&response.body, "FederatedUserId").unwrap_or_default(),
                arn: client::xml_text(&response.body, "Arn").unwrap_or_default(),
            },
            packed_policy_size: client::xml_text(&response.body, "PackedPolicySize")
                .and_then(|v| v.parse().ok()),
        })
    }

    // ── XML Parsers ─────────────────────────────────────────────────

    fn parse_assume_role_response(&self, xml: &str) -> AwsResult<AssumeRoleOutput> {
        let creds = self.parse_credentials(xml)
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "Failed to parse credentials in AssumeRole response", 200))?;
        Ok(AssumeRoleOutput {
            credentials: creds,
            assumed_role_user: AssumedRoleUser {
                assumed_role_id: client::xml_text(xml, "AssumedRoleId").unwrap_or_default(),
                arn: client::xml_text(xml, "Arn").unwrap_or_default(),
            },
            packed_policy_size: client::xml_text(xml, "PackedPolicySize")
                .and_then(|v| v.parse().ok()),
            source_identity: client::xml_text(xml, "SourceIdentity"),
        })
    }

    fn parse_credentials(&self, xml: &str) -> Option<Credentials> {
        let block = client::xml_block(xml, "Credentials")?;
        Some(Credentials {
            access_key_id: client::xml_text(&block, "AccessKeyId")?,
            secret_access_key: client::xml_text(&block, "SecretAccessKey")?,
            session_token: client::xml_text(&block, "SessionToken")?,
            expiration: client::xml_text(&block, "Expiration")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_serde() {
        let creds = Credentials {
            access_key_id: "ASIAEXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI".to_string(),
            session_token: "FwoGZXIvYXdzEBY".to_string(),
            expiration: "2024-01-01T01:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&creds).unwrap();
        let back: Credentials = serde_json::from_str(&json).unwrap();
        assert_eq!(back.access_key_id, "ASIAEXAMPLE");
    }

    #[test]
    fn caller_identity_serde() {
        let id = CallerIdentity {
            account: "123456789012".to_string(),
            arn: "arn:aws:iam::123456789012:user/alice".to_string(),
            user_id: "AIDAEXAMPLE".to_string(),
        };
        let json = serde_json::to_string(&id).unwrap();
        assert!(json.contains("123456789012"));
    }

    #[test]
    fn assume_role_input_serde() {
        let input = AssumeRoleInput {
            role_arn: "arn:aws:iam::123456789012:role/AdminRole".to_string(),
            role_session_name: "session1".to_string(),
            duration_seconds: Some(3600),
            external_id: Some("ext-12345".to_string()),
            policy: None,
            serial_number: None,
            token_code: None,
            source_identity: None,
        };
        let json = serde_json::to_string(&input).unwrap();
        let back: AssumeRoleInput = serde_json::from_str(&json).unwrap();
        assert_eq!(back.duration_seconds, Some(3600));
        assert_eq!(back.external_id, Some("ext-12345".to_string()));
    }
}
