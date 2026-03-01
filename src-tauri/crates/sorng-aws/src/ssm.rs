//! AWS SSM (Systems Manager) client.
//!
//! Mirrors `aws-sdk-ssm` types and operations. SSM uses the JSON protocol
//! with target prefix `AmazonSSM`.
//!
//! Reference: <https://docs.aws.amazon.com/systems-manager/latest/APIReference/>

use crate::client::AwsClient;
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "ssm";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum ParameterType {
    String,
    StringList,
    SecureString,
}

impl std::fmt::Display for ParameterType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::String => write!(f, "String"),
            Self::StringList => write!(f, "StringList"),
            Self::SecureString => write!(f, "SecureString"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parameter {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Type")]
    pub parameter_type: Option<String>,
    #[serde(rename = "Value")]
    pub value: Option<String>,
    #[serde(rename = "Version")]
    pub version: Option<i64>,
    #[serde(rename = "ARN")]
    pub arn: Option<String>,
    #[serde(rename = "LastModifiedDate")]
    pub last_modified_date: Option<f64>,
    #[serde(rename = "DataType")]
    pub data_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterMetadata {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Type")]
    pub parameter_type: Option<String>,
    #[serde(rename = "Description")]
    pub description: Option<String>,
    #[serde(rename = "Version")]
    pub version: Option<i64>,
    #[serde(rename = "LastModifiedDate")]
    pub last_modified_date: Option<f64>,
    #[serde(rename = "Tier")]
    pub tier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    #[serde(rename = "CommandId")]
    pub command_id: String,
    #[serde(rename = "DocumentName")]
    pub document_name: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "StatusDetails")]
    pub status_details: Option<String>,
    #[serde(rename = "InstanceIds")]
    pub instance_ids: Vec<String>,
    #[serde(rename = "RequestedDateTime")]
    pub requested_date_time: Option<f64>,
    #[serde(rename = "Comment")]
    pub comment: Option<String>,
    #[serde(rename = "OutputS3BucketName")]
    pub output_s3_bucket_name: Option<String>,
    #[serde(rename = "OutputS3KeyPrefix")]
    pub output_s3_key_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandInvocation {
    #[serde(rename = "CommandId")]
    pub command_id: String,
    #[serde(rename = "InstanceId")]
    pub instance_id: String,
    #[serde(rename = "DocumentName")]
    pub document_name: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "StatusDetails")]
    pub status_details: Option<String>,
    #[serde(rename = "StandardOutputContent")]
    pub standard_output_content: Option<String>,
    #[serde(rename = "StandardErrorContent")]
    pub standard_error_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentDescription {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "DocumentVersion")]
    pub document_version: Option<String>,
    #[serde(rename = "Status")]
    pub status: Option<String>,
    #[serde(rename = "DocumentType")]
    pub document_type: Option<String>,
    #[serde(rename = "Description")]
    pub description: Option<String>,
    #[serde(rename = "Owner")]
    pub owner: Option<String>,
    #[serde(rename = "PlatformTypes")]
    pub platform_types: Vec<String>,
    #[serde(rename = "SchemaVersion")]
    pub schema_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    #[serde(rename = "SessionId")]
    pub session_id: String,
    #[serde(rename = "Target")]
    pub target: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "StartDate")]
    pub start_date: Option<f64>,
    #[serde(rename = "EndDate")]
    pub end_date: Option<f64>,
    #[serde(rename = "Owner")]
    pub owner: Option<String>,
}

/// Managed instance information from SSM inventory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInformation {
    #[serde(rename = "InstanceId")]
    pub instance_id: String,
    #[serde(rename = "PingStatus")]
    pub ping_status: Option<String>,
    #[serde(rename = "LastPingDateTime")]
    pub last_ping_date_time: Option<f64>,
    #[serde(rename = "AgentVersion")]
    pub agent_version: Option<String>,
    #[serde(rename = "IsLatestVersion")]
    pub is_latest_version: Option<bool>,
    #[serde(rename = "PlatformType")]
    pub platform_type: Option<String>,
    #[serde(rename = "PlatformName")]
    pub platform_name: Option<String>,
    #[serde(rename = "PlatformVersion")]
    pub platform_version: Option<String>,
    #[serde(rename = "ComputerName")]
    pub computer_name: Option<String>,
    #[serde(rename = "IPAddress")]
    pub ip_address: Option<String>,
}

// ── SSM Client ──────────────────────────────────────────────────────────

pub struct SsmClient {
    client: AwsClient,
}

impl SsmClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── Parameter Store ─────────────────────────────────────────────

    pub async fn get_parameter(&self, name: &str, with_decryption: bool) -> AwsResult<Parameter> {
        let body = serde_json::json!({
            "Name": name,
            "WithDecryption": with_decryption,
        });
        let response = self.client.json_request(SERVICE, "AmazonSSM.GetParameter", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("Parameter")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No Parameter in response", 200))
    }

    pub async fn get_parameters(&self, names: &[String], with_decryption: bool) -> AwsResult<Vec<Parameter>> {
        let body = serde_json::json!({
            "Names": names,
            "WithDecryption": with_decryption,
        });
        let response = self.client.json_request(SERVICE, "AmazonSSM.GetParameters", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Parameters")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn get_parameters_by_path(&self, path: &str, recursive: bool, with_decryption: bool, max_results: Option<u32>) -> AwsResult<Vec<Parameter>> {
        let mut body = serde_json::json!({
            "Path": path,
            "Recursive": recursive,
            "WithDecryption": with_decryption,
        });
        if let Some(mr) = max_results {
            body["MaxResults"] = serde_json::json!(mr);
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.GetParametersByPath", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Parameters")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn put_parameter(&self, name: &str, value: &str, parameter_type: ParameterType, description: Option<&str>, overwrite: bool) -> AwsResult<i64> {
        let mut body = serde_json::json!({
            "Name": name,
            "Value": value,
            "Type": parameter_type.to_string(),
            "Overwrite": overwrite,
        });
        if let Some(desc) = description {
            body["Description"] = serde_json::Value::String(desc.to_string());
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.PutParameter", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Version").and_then(|v| v.as_i64()).unwrap_or(1))
    }

    pub async fn delete_parameter(&self, name: &str) -> AwsResult<()> {
        let body = serde_json::json!({ "Name": name });
        self.client.json_request(SERVICE, "AmazonSSM.DeleteParameter", &body.to_string()).await?;
        Ok(())
    }

    pub async fn describe_parameters(&self, max_results: Option<u32>) -> AwsResult<Vec<ParameterMetadata>> {
        let mut body = serde_json::json!({});
        if let Some(mr) = max_results {
            body["MaxResults"] = serde_json::json!(mr);
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.DescribeParameters", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Parameters")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    // ── Run Command ─────────────────────────────────────────────────

    pub async fn send_command(&self, document_name: &str, instance_ids: &[String], parameters: &HashMap<String, Vec<String>>, comment: Option<&str>) -> AwsResult<Command> {
        let mut body = serde_json::json!({
            "DocumentName": document_name,
            "InstanceIds": instance_ids,
            "Parameters": parameters,
        });
        if let Some(c) = comment {
            body["Comment"] = serde_json::Value::String(c.to_string());
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.SendCommand", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("Command")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No Command in response", 200))
    }

    pub async fn list_commands(&self, command_id: Option<&str>, instance_id: Option<&str>) -> AwsResult<Vec<Command>> {
        let mut body = serde_json::json!({});
        if let Some(cid) = command_id {
            body["CommandId"] = serde_json::Value::String(cid.to_string());
        }
        if let Some(iid) = instance_id {
            body["InstanceId"] = serde_json::Value::String(iid.to_string());
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.ListCommands", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Commands")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn get_command_invocation(&self, command_id: &str, instance_id: &str) -> AwsResult<CommandInvocation> {
        let body = serde_json::json!({
            "CommandId": command_id,
            "InstanceId": instance_id,
        });
        let response = self.client.json_request(SERVICE, "AmazonSSM.GetCommandInvocation", &body.to_string()).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    // ── Sessions ────────────────────────────────────────────────────

    pub async fn start_session(&self, target: &str, document_name: Option<&str>) -> AwsResult<SessionInfo> {
        let mut body = serde_json::json!({ "Target": target });
        if let Some(dn) = document_name {
            body["DocumentName"] = serde_json::Value::String(dn.to_string());
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.StartSession", &body.to_string()).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    pub async fn terminate_session(&self, session_id: &str) -> AwsResult<()> {
        let body = serde_json::json!({ "SessionId": session_id });
        self.client.json_request(SERVICE, "AmazonSSM.TerminateSession", &body.to_string()).await?;
        Ok(())
    }

    pub async fn describe_sessions(&self, state: &str) -> AwsResult<Vec<SessionInfo>> {
        let body = serde_json::json!({ "State": state });
        let response = self.client.json_request(SERVICE, "AmazonSSM.DescribeSessions", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Sessions")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    // ── Documents ───────────────────────────────────────────────────

    pub async fn list_documents(&self, document_type: Option<&str>) -> AwsResult<Vec<DocumentDescription>> {
        let mut body = serde_json::json!({});
        if let Some(dt) = document_type {
            body["Filters"] = serde_json::json!([{
                "Key": "DocumentType",
                "Values": [dt],
            }]);
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.ListDocuments", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("DocumentIdentifiers")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn describe_document(&self, name: &str) -> AwsResult<DocumentDescription> {
        let body = serde_json::json!({ "Name": name });
        let response = self.client.json_request(SERVICE, "AmazonSSM.DescribeDocument", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("Document")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No Document in response", 200))
    }

    // ── Managed Instances ───────────────────────────────────────────

    pub async fn describe_instance_information(&self, max_results: Option<u32>) -> AwsResult<Vec<InstanceInformation>> {
        let mut body = serde_json::json!({});
        if let Some(mr) = max_results {
            body["MaxResults"] = serde_json::json!(mr);
        }
        let response = self.client.json_request(SERVICE, "AmazonSSM.DescribeInstanceInformation", &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("InstanceInformationList")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_serde() {
        let p = Parameter {
            name: "/app/db/password".to_string(),
            parameter_type: Some("SecureString".to_string()),
            value: Some("s3cret!".to_string()),
            version: Some(3),
            arn: Some("arn:aws:ssm:us-east-1:123:parameter/app/db/password".to_string()),
            last_modified_date: None,
            data_type: Some("text".to_string()),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: Parameter = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "/app/db/password");
        assert_eq!(back.version, Some(3));
    }

    #[test]
    fn command_serde() {
        let cmd = Command {
            command_id: "cmd-abc123".to_string(),
            document_name: "AWS-RunShellScript".to_string(),
            status: "Success".to_string(),
            status_details: Some("Success".to_string()),
            instance_ids: vec!["i-12345".to_string()],
            requested_date_time: None,
            comment: Some("Run health check".to_string()),
            output_s3_bucket_name: None,
            output_s3_key_prefix: None,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("AWS-RunShellScript"));
    }

    #[test]
    fn parameter_type_display() {
        assert_eq!(ParameterType::SecureString.to_string(), "SecureString");
        assert_eq!(ParameterType::StringList.to_string(), "StringList");
    }
}
