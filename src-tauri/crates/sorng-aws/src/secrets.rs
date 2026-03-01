//! AWS Secrets Manager client.
//!
//! Mirrors `aws-sdk-secretsmanager` types and operations. Uses JSON protocol
//! with target prefix `secretsmanager`.
//!
//! Reference: <https://docs.aws.amazon.com/secretsmanager/latest/apireference/>

use crate::client::AwsClient;
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "secretsmanager";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretValue {
    #[serde(rename = "ARN")]
    pub arn: Option<String>,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "VersionId")]
    pub version_id: Option<String>,
    #[serde(rename = "SecretBinary")]
    pub secret_binary: Option<String>,
    #[serde(rename = "SecretString")]
    pub secret_string: Option<String>,
    #[serde(rename = "VersionStages")]
    pub version_stages: Vec<String>,
    #[serde(rename = "CreatedDate")]
    pub created_date: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretMetadata {
    #[serde(rename = "ARN")]
    pub arn: Option<String>,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Description")]
    pub description: Option<String>,
    #[serde(rename = "KmsKeyId")]
    pub kms_key_id: Option<String>,
    #[serde(rename = "RotationEnabled")]
    pub rotation_enabled: Option<bool>,
    #[serde(rename = "RotationLambdaARN")]
    pub rotation_lambda_arn: Option<String>,
    #[serde(rename = "RotationRules")]
    pub rotation_rules: Option<RotationRules>,
    #[serde(rename = "LastRotatedDate")]
    pub last_rotated_date: Option<f64>,
    #[serde(rename = "LastChangedDate")]
    pub last_changed_date: Option<f64>,
    #[serde(rename = "LastAccessedDate")]
    pub last_accessed_date: Option<f64>,
    #[serde(rename = "Tags")]
    pub tags: Vec<SecretTag>,
    #[serde(rename = "PrimaryRegion")]
    pub primary_region: Option<String>,
    #[serde(rename = "DeletedDate")]
    pub deleted_date: Option<f64>,
    #[serde(rename = "CreatedDate")]
    pub created_date: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationRules {
    #[serde(rename = "AutomaticallyAfterDays")]
    pub automatically_after_days: Option<u32>,
    #[serde(rename = "Duration")]
    pub duration: Option<String>,
    #[serde(rename = "ScheduleExpression")]
    pub schedule_expression: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretTag {
    #[serde(rename = "Key")]
    pub key: String,
    #[serde(rename = "Value")]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretVersionInfo {
    #[serde(rename = "VersionId")]
    pub version_id: String,
    #[serde(rename = "VersionStages")]
    pub version_stages: Vec<String>,
    #[serde(rename = "CreatedDate")]
    pub created_date: Option<f64>,
    #[serde(rename = "KmsKeyIds")]
    pub kms_key_ids: Vec<String>,
}

/// Secret listing entry (from ListSecrets).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretListEntry {
    #[serde(rename = "ARN")]
    pub arn: Option<String>,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Description")]
    pub description: Option<String>,
    #[serde(rename = "LastChangedDate")]
    pub last_changed_date: Option<f64>,
    #[serde(rename = "LastAccessedDate")]
    pub last_accessed_date: Option<f64>,
    #[serde(rename = "Tags")]
    pub tags: Vec<SecretTag>,
    #[serde(rename = "RotationEnabled")]
    pub rotation_enabled: Option<bool>,
    #[serde(rename = "PrimaryRegion")]
    pub primary_region: Option<String>,
}

// ── Secrets Manager Client ──────────────────────────────────────────────

pub struct SecretsManagerClient {
    client: AwsClient,
}

impl SecretsManagerClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    pub async fn get_secret_value(&self, secret_id: &str, version_id: Option<&str>, version_stage: Option<&str>) -> AwsResult<SecretValue> {
        let mut body = serde_json::json!({ "SecretId": secret_id });
        if let Some(vid) = version_id {
            body["VersionId"] = serde_json::Value::String(vid.to_string());
        }
        if let Some(vs) = version_stage {
            body["VersionStage"] = serde_json::Value::String(vs.to_string());
        }
        let response = self.client.json_request(SERVICE, "secretsmanager.GetSecretValue", &body.to_string()).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    pub async fn create_secret(&self, name: &str, secret_string: Option<&str>, secret_binary: Option<&str>, description: Option<&str>, kms_key_id: Option<&str>, tags: &[SecretTag]) -> AwsResult<String> {
        let mut body = serde_json::json!({ "Name": name });
        if let Some(ss) = secret_string {
            body["SecretString"] = serde_json::Value::String(ss.to_string());
        }
        if let Some(sb) = secret_binary {
            body["SecretBinary"] = serde_json::Value::String(sb.to_string());
        }
        if let Some(desc) = description {
            body["Description"] = serde_json::Value::String(desc.to_string());
        }
        if let Some(kms) = kms_key_id {
            body["KmsKeyId"] = serde_json::Value::String(kms.to_string());
        }
        if !tags.is_empty() {
            body["Tags"] = serde_json::to_value(tags).unwrap_or_default();
        }
        let response = self.client.json_request(SERVICE, "secretsmanager.CreateSecret", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("ARN").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }

    pub async fn update_secret(&self, secret_id: &str, secret_string: Option<&str>, secret_binary: Option<&str>, description: Option<&str>) -> AwsResult<String> {
        let mut body = serde_json::json!({ "SecretId": secret_id });
        if let Some(ss) = secret_string {
            body["SecretString"] = serde_json::Value::String(ss.to_string());
        }
        if let Some(sb) = secret_binary {
            body["SecretBinary"] = serde_json::Value::String(sb.to_string());
        }
        if let Some(desc) = description {
            body["Description"] = serde_json::Value::String(desc.to_string());
        }
        let response = self.client.json_request(SERVICE, "secretsmanager.UpdateSecret", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("ARN").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }

    pub async fn put_secret_value(&self, secret_id: &str, secret_string: Option<&str>, secret_binary: Option<&str>, version_stages: Option<&[String]>) -> AwsResult<String> {
        let mut body = serde_json::json!({ "SecretId": secret_id });
        if let Some(ss) = secret_string {
            body["SecretString"] = serde_json::Value::String(ss.to_string());
        }
        if let Some(sb) = secret_binary {
            body["SecretBinary"] = serde_json::Value::String(sb.to_string());
        }
        if let Some(vs) = version_stages {
            body["VersionStages"] = serde_json::to_value(vs).unwrap_or_default();
        }
        let response = self.client.json_request(SERVICE, "secretsmanager.PutSecretValue", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("VersionId").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }

    pub async fn delete_secret(&self, secret_id: &str, force_delete: bool, recovery_window_in_days: Option<u32>) -> AwsResult<()> {
        let mut body = serde_json::json!({ "SecretId": secret_id });
        if force_delete {
            body["ForceDeleteWithoutRecovery"] = serde_json::json!(true);
        }
        if let Some(rw) = recovery_window_in_days {
            body["RecoveryWindowInDays"] = serde_json::json!(rw);
        }
        self.client.json_request(SERVICE, "secretsmanager.DeleteSecret", &body.to_string()).await?;
        Ok(())
    }

    pub async fn restore_secret(&self, secret_id: &str) -> AwsResult<String> {
        let body = serde_json::json!({ "SecretId": secret_id });
        let response = self.client.json_request(SERVICE, "secretsmanager.RestoreSecret", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Name").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }

    pub async fn list_secrets(&self, max_results: Option<u32>, next_token: Option<&str>) -> AwsResult<(Vec<SecretListEntry>, Option<String>)> {
        let mut body = serde_json::json!({});
        if let Some(mr) = max_results {
            body["MaxResults"] = serde_json::json!(mr);
        }
        if let Some(nt) = next_token {
            body["NextToken"] = serde_json::Value::String(nt.to_string());
        }
        let response = self.client.json_request(SERVICE, "secretsmanager.ListSecrets", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        let entries: Vec<SecretListEntry> = result.get("SecretList")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let next = result.get("NextToken").and_then(|v| v.as_str()).map(String::from);
        Ok((entries, next))
    }

    pub async fn describe_secret(&self, secret_id: &str) -> AwsResult<SecretMetadata> {
        let body = serde_json::json!({ "SecretId": secret_id });
        let response = self.client.json_request(SERVICE, "secretsmanager.DescribeSecret", &body.to_string()).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    pub async fn rotate_secret(&self, secret_id: &str, rotation_lambda_arn: Option<&str>, rotation_rules: Option<&RotationRules>) -> AwsResult<String> {
        let mut body = serde_json::json!({ "SecretId": secret_id });
        if let Some(arn) = rotation_lambda_arn {
            body["RotationLambdaARN"] = serde_json::Value::String(arn.to_string());
        }
        if let Some(rules) = rotation_rules {
            body["RotationRules"] = serde_json::to_value(rules).unwrap_or_default();
        }
        let response = self.client.json_request(SERVICE, "secretsmanager.RotateSecret", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("VersionId").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }

    pub async fn tag_resource(&self, secret_id: &str, tags: &[SecretTag]) -> AwsResult<()> {
        let body = serde_json::json!({
            "SecretId": secret_id,
            "Tags": tags,
        });
        self.client.json_request(SERVICE, "secretsmanager.TagResource", &body.to_string()).await?;
        Ok(())
    }

    pub async fn untag_resource(&self, secret_id: &str, tag_keys: &[String]) -> AwsResult<()> {
        let body = serde_json::json!({
            "SecretId": secret_id,
            "TagKeys": tag_keys,
        });
        self.client.json_request(SERVICE, "secretsmanager.UntagResource", &body.to_string()).await?;
        Ok(())
    }

    pub async fn list_secret_version_ids(&self, secret_id: &str) -> AwsResult<Vec<SecretVersionInfo>> {
        let body = serde_json::json!({ "SecretId": secret_id });
        let response = self.client.json_request(SERVICE, "secretsmanager.ListSecretVersionIds", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Versions")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    /// Gets a random password from Secrets Manager (useful for generating credentials).
    pub async fn get_random_password(&self, length: Option<u32>, exclude_characters: Option<&str>) -> AwsResult<String> {
        let mut body = serde_json::json!({});
        if let Some(l) = length {
            body["PasswordLength"] = serde_json::json!(l);
        }
        if let Some(ec) = exclude_characters {
            body["ExcludeCharacters"] = serde_json::Value::String(ec.to_string());
        }
        let response = self.client.json_request(SERVICE, "secretsmanager.GetRandomPassword", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("RandomPassword").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_value_serde() {
        let sv = SecretValue {
            arn: Some("arn:aws:secretsmanager:us-east-1:123:secret:db-creds-abc".to_string()),
            name: "db-creds".to_string(),
            version_id: Some("v1".to_string()),
            secret_binary: None,
            secret_string: Some("{\"username\":\"admin\",\"password\":\"secret\"}".to_string()),
            version_stages: vec!["AWSCURRENT".to_string()],
            created_date: None,
        };
        let json = serde_json::to_string(&sv).unwrap();
        let back: SecretValue = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "db-creds");
    }

    #[test]
    fn rotation_rules_serde() {
        let rr = RotationRules {
            automatically_after_days: Some(30),
            duration: Some("2h".to_string()),
            schedule_expression: Some("rate(30 days)".to_string()),
        };
        let json = serde_json::to_string(&rr).unwrap();
        assert!(json.contains("AutomaticallyAfterDays"));
    }
}
