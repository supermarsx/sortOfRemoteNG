//! AWS CloudFormation client.
//!
//! Mirrors `aws-sdk-cloudformation` types and operations.  CloudFormation uses
//! the AWS Query protocol with XML responses (API version 2010-05-15).
//!
//! Reference: <https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::error::AwsResult;
use serde::{Deserialize, Serialize};

const API_VERSION: &str = "2010-05-15";
const SERVICE: &str = "cloudformation";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StackStatus {
    CreateInProgress,
    CreateFailed,
    CreateComplete,
    RollbackInProgress,
    RollbackFailed,
    RollbackComplete,
    DeleteInProgress,
    DeleteFailed,
    DeleteComplete,
    UpdateInProgress,
    UpdateCompleteCleanupInProgress,
    UpdateComplete,
    UpdateFailed,
    UpdateRollbackInProgress,
    UpdateRollbackFailed,
    UpdateRollbackCompleteCleanupInProgress,
    UpdateRollbackComplete,
    ReviewInProgress,
    ImportInProgress,
    ImportComplete,
    ImportRollbackInProgress,
    ImportRollbackFailed,
    ImportRollbackComplete,
    Other(String),
}

impl From<&str> for StackStatus {
    fn from(s: &str) -> Self {
        match s {
            "CREATE_IN_PROGRESS" => Self::CreateInProgress,
            "CREATE_FAILED" => Self::CreateFailed,
            "CREATE_COMPLETE" => Self::CreateComplete,
            "ROLLBACK_IN_PROGRESS" => Self::RollbackInProgress,
            "ROLLBACK_FAILED" => Self::RollbackFailed,
            "ROLLBACK_COMPLETE" => Self::RollbackComplete,
            "DELETE_IN_PROGRESS" => Self::DeleteInProgress,
            "DELETE_FAILED" => Self::DeleteFailed,
            "DELETE_COMPLETE" => Self::DeleteComplete,
            "UPDATE_IN_PROGRESS" => Self::UpdateInProgress,
            "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS" => Self::UpdateCompleteCleanupInProgress,
            "UPDATE_COMPLETE" => Self::UpdateComplete,
            "UPDATE_FAILED" => Self::UpdateFailed,
            "UPDATE_ROLLBACK_IN_PROGRESS" => Self::UpdateRollbackInProgress,
            "UPDATE_ROLLBACK_FAILED" => Self::UpdateRollbackFailed,
            "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS" => Self::UpdateRollbackCompleteCleanupInProgress,
            "UPDATE_ROLLBACK_COMPLETE" => Self::UpdateRollbackComplete,
            "REVIEW_IN_PROGRESS" => Self::ReviewInProgress,
            "IMPORT_IN_PROGRESS" => Self::ImportInProgress,
            "IMPORT_COMPLETE" => Self::ImportComplete,
            "IMPORT_ROLLBACK_IN_PROGRESS" => Self::ImportRollbackInProgress,
            "IMPORT_ROLLBACK_FAILED" => Self::ImportRollbackFailed,
            "IMPORT_ROLLBACK_COMPLETE" => Self::ImportRollbackComplete,
            other => Self::Other(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stack {
    pub stack_id: String,
    pub stack_name: String,
    pub description: Option<String>,
    pub stack_status: StackStatus,
    pub stack_status_reason: Option<String>,
    pub creation_time: Option<String>,
    pub last_updated_time: Option<String>,
    pub deletion_time: Option<String>,
    pub outputs: Vec<Output>,
    pub parameters: Vec<Parameter>,
    pub tags: Vec<StackTag>,
    pub capabilities: Vec<String>,
    pub role_arn: Option<String>,
    pub enable_termination_protection: bool,
    pub parent_id: Option<String>,
    pub root_id: Option<String>,
    pub timeout_in_minutes: Option<u32>,
    pub notification_arns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackSummary {
    pub stack_id: String,
    pub stack_name: String,
    pub stack_status: StackStatus,
    pub stack_status_reason: Option<String>,
    pub creation_time: Option<String>,
    pub last_updated_time: Option<String>,
    pub deletion_time: Option<String>,
    pub template_description: Option<String>,
    pub parent_id: Option<String>,
    pub root_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Output {
    pub output_key: String,
    pub output_value: String,
    pub description: Option<String>,
    pub export_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parameter {
    pub parameter_key: String,
    pub parameter_value: String,
    pub use_previous_value: Option<bool>,
    pub resolved_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackTag {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackEvent {
    pub stack_id: String,
    pub event_id: String,
    pub stack_name: String,
    pub logical_resource_id: Option<String>,
    pub physical_resource_id: Option<String>,
    pub resource_type: Option<String>,
    pub resource_status: Option<String>,
    pub resource_status_reason: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackResource {
    pub logical_resource_id: String,
    pub physical_resource_id: Option<String>,
    pub resource_type: String,
    pub resource_status: String,
    pub resource_status_reason: Option<String>,
    pub timestamp: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeSet {
    pub change_set_id: String,
    pub change_set_name: String,
    pub stack_id: Option<String>,
    pub stack_name: Option<String>,
    pub status: String,
    pub status_reason: Option<String>,
    pub execution_status: Option<String>,
    pub creation_time: Option<String>,
    pub description: Option<String>,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    pub change_type: String,
    pub resource_change: Option<ResourceChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceChange {
    pub action: String,
    pub logical_resource_id: String,
    pub physical_resource_id: Option<String>,
    pub resource_type: String,
    pub replacement: Option<String>,
    pub scope: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateParameter {
    pub parameter_key: String,
    pub default_value: Option<String>,
    pub description: Option<String>,
    pub no_echo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Export {
    pub name: String,
    pub value: String,
    pub exporting_stack_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStackInput {
    pub stack_name: String,
    pub template_body: Option<String>,
    pub template_url: Option<String>,
    pub parameters: Vec<Parameter>,
    pub tags: Vec<StackTag>,
    pub capabilities: Vec<String>,
    pub role_arn: Option<String>,
    pub on_failure: Option<String>,
    pub timeout_in_minutes: Option<u32>,
    pub notification_arns: Vec<String>,
    pub enable_termination_protection: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStackInput {
    pub stack_name: String,
    pub template_body: Option<String>,
    pub template_url: Option<String>,
    pub use_previous_template: Option<bool>,
    pub parameters: Vec<Parameter>,
    pub tags: Vec<StackTag>,
    pub capabilities: Vec<String>,
    pub role_arn: Option<String>,
    pub notification_arns: Vec<String>,
}

// ── CloudFormation Client ───────────────────────────────────────────────

pub struct CloudFormationClient {
    client: AwsClient,
}

impl CloudFormationClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── Stacks ──────────────────────────────────────────────────────

    pub async fn list_stacks(&self, status_filter: &[String]) -> AwsResult<Vec<StackSummary>> {
        let mut params = client::build_query_params("ListStacks", API_VERSION);
        for (i, status) in status_filter.iter().enumerate() {
            params.insert(format!("StackStatusFilter.member.{}", i + 1), status.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_stack_summaries(&response.body))
    }

    pub async fn describe_stacks(&self, stack_name: Option<&str>) -> AwsResult<Vec<Stack>> {
        let mut params = client::build_query_params("DescribeStacks", API_VERSION);
        if let Some(name) = stack_name {
            params.insert("StackName".to_string(), name.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_stacks(&response.body))
    }

    pub async fn create_stack(&self, input: &CreateStackInput) -> AwsResult<String> {
        let mut params = client::build_query_params("CreateStack", API_VERSION);
        params.insert("StackName".to_string(), input.stack_name.clone());
        if let Some(ref body) = input.template_body {
            params.insert("TemplateBody".to_string(), body.clone());
        }
        if let Some(ref url) = input.template_url {
            params.insert("TemplateURL".to_string(), url.clone());
        }
        for (i, param) in input.parameters.iter().enumerate() {
            let prefix = format!("Parameters.member.{}", i + 1);
            params.insert(format!("{}.ParameterKey", prefix), param.parameter_key.clone());
            params.insert(format!("{}.ParameterValue", prefix), param.parameter_value.clone());
        }
        for (i, tag) in input.tags.iter().enumerate() {
            let prefix = format!("Tags.member.{}", i + 1);
            params.insert(format!("{}.Key", prefix), tag.key.clone());
            params.insert(format!("{}.Value", prefix), tag.value.clone());
        }
        for (i, cap) in input.capabilities.iter().enumerate() {
            params.insert(format!("Capabilities.member.{}", i + 1), cap.clone());
        }
        if let Some(ref role) = input.role_arn {
            params.insert("RoleARN".to_string(), role.clone());
        }
        if let Some(ref on_failure) = input.on_failure {
            params.insert("OnFailure".to_string(), on_failure.clone());
        }
        if let Some(timeout) = input.timeout_in_minutes {
            params.insert("TimeoutInMinutes".to_string(), timeout.to_string());
        }
        for (i, arn) in input.notification_arns.iter().enumerate() {
            params.insert(format!("NotificationARNs.member.{}", i + 1), arn.clone());
        }
        if let Some(etp) = input.enable_termination_protection {
            params.insert("EnableTerminationProtection".to_string(), etp.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "StackId").unwrap_or_default())
    }

    pub async fn update_stack(&self, input: &UpdateStackInput) -> AwsResult<String> {
        let mut params = client::build_query_params("UpdateStack", API_VERSION);
        params.insert("StackName".to_string(), input.stack_name.clone());
        if let Some(ref body) = input.template_body {
            params.insert("TemplateBody".to_string(), body.clone());
        }
        if let Some(ref url) = input.template_url {
            params.insert("TemplateURL".to_string(), url.clone());
        }
        if let Some(upt) = input.use_previous_template {
            params.insert("UsePreviousTemplate".to_string(), upt.to_string());
        }
        for (i, param) in input.parameters.iter().enumerate() {
            let prefix = format!("Parameters.member.{}", i + 1);
            params.insert(format!("{}.ParameterKey", prefix), param.parameter_key.clone());
            params.insert(format!("{}.ParameterValue", prefix), param.parameter_value.clone());
        }
        for (i, tag) in input.tags.iter().enumerate() {
            let prefix = format!("Tags.member.{}", i + 1);
            params.insert(format!("{}.Key", prefix), tag.key.clone());
            params.insert(format!("{}.Value", prefix), tag.value.clone());
        }
        for (i, cap) in input.capabilities.iter().enumerate() {
            params.insert(format!("Capabilities.member.{}", i + 1), cap.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "StackId").unwrap_or_default())
    }

    pub async fn delete_stack(&self, stack_name: &str, retain_resources: &[String]) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteStack", API_VERSION);
        params.insert("StackName".to_string(), stack_name.to_string());
        for (i, resource) in retain_resources.iter().enumerate() {
            params.insert(format!("RetainResources.member.{}", i + 1), resource.clone());
        }
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── Stack Events ────────────────────────────────────────────────

    pub async fn describe_stack_events(&self, stack_name: &str) -> AwsResult<Vec<StackEvent>> {
        let mut params = client::build_query_params("DescribeStackEvents", API_VERSION);
        params.insert("StackName".to_string(), stack_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_stack_events(&response.body))
    }

    // ── Stack Resources ─────────────────────────────────────────────

    pub async fn describe_stack_resources(&self, stack_name: &str) -> AwsResult<Vec<StackResource>> {
        let mut params = client::build_query_params("DescribeStackResources", API_VERSION);
        params.insert("StackName".to_string(), stack_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_stack_resources(&response.body))
    }

    pub async fn describe_stack_resource(&self, stack_name: &str, logical_resource_id: &str) -> AwsResult<Option<StackResource>> {
        let mut params = client::build_query_params("DescribeStackResource", API_VERSION);
        params.insert("StackName".to_string(), stack_name.to_string());
        params.insert("LogicalResourceId".to_string(), logical_resource_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        let resources = self.parse_stack_resources(&response.body);
        Ok(resources.into_iter().next())
    }

    // ── Templates ───────────────────────────────────────────────────

    pub async fn get_template(&self, stack_name: &str) -> AwsResult<String> {
        let mut params = client::build_query_params("GetTemplate", API_VERSION);
        params.insert("StackName".to_string(), stack_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "TemplateBody").unwrap_or_default())
    }

    pub async fn validate_template(&self, template_body: &str) -> AwsResult<Vec<TemplateParameter>> {
        let mut params = client::build_query_params("ValidateTemplate", API_VERSION);
        params.insert("TemplateBody".to_string(), template_body.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_blocks(&response.body, "member").iter().filter_map(|b| {
            Some(TemplateParameter {
                parameter_key: client::xml_text(b, "ParameterKey")?,
                default_value: client::xml_text(b, "DefaultValue"),
                description: client::xml_text(b, "Description"),
                no_echo: client::xml_text(b, "NoEcho").map_or(false, |v| v == "true"),
            })
        }).collect())
    }

    pub async fn get_template_summary(&self, stack_name: Option<&str>, template_body: Option<&str>) -> AwsResult<Vec<TemplateParameter>> {
        let mut params = client::build_query_params("GetTemplateSummary", API_VERSION);
        if let Some(name) = stack_name {
            params.insert("StackName".to_string(), name.to_string());
        }
        if let Some(body) = template_body {
            params.insert("TemplateBody".to_string(), body.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_blocks(&response.body, "member").iter().filter_map(|b| {
            Some(TemplateParameter {
                parameter_key: client::xml_text(b, "ParameterKey")?,
                default_value: client::xml_text(b, "DefaultValue"),
                description: client::xml_text(b, "Description"),
                no_echo: client::xml_text(b, "NoEcho").map_or(false, |v| v == "true"),
            })
        }).collect())
    }

    // ── Change Sets ─────────────────────────────────────────────────

    pub async fn create_change_set(&self, stack_name: &str, change_set_name: &str, template_body: Option<&str>, template_url: Option<&str>, parameters: &[Parameter], capabilities: &[String], description: Option<&str>) -> AwsResult<String> {
        let mut params = client::build_query_params("CreateChangeSet", API_VERSION);
        params.insert("StackName".to_string(), stack_name.to_string());
        params.insert("ChangeSetName".to_string(), change_set_name.to_string());
        if let Some(body) = template_body {
            params.insert("TemplateBody".to_string(), body.to_string());
        }
        if let Some(url) = template_url {
            params.insert("TemplateURL".to_string(), url.to_string());
        }
        for (i, param) in parameters.iter().enumerate() {
            let prefix = format!("Parameters.member.{}", i + 1);
            params.insert(format!("{}.ParameterKey", prefix), param.parameter_key.clone());
            params.insert(format!("{}.ParameterValue", prefix), param.parameter_value.clone());
        }
        for (i, cap) in capabilities.iter().enumerate() {
            params.insert(format!("Capabilities.member.{}", i + 1), cap.clone());
        }
        if let Some(desc) = description {
            params.insert("Description".to_string(), desc.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_text(&response.body, "Id").unwrap_or_default())
    }

    pub async fn describe_change_set(&self, change_set_name: &str, stack_name: &str) -> AwsResult<ChangeSet> {
        let mut params = client::build_query_params("DescribeChangeSet", API_VERSION);
        params.insert("ChangeSetName".to_string(), change_set_name.to_string());
        params.insert("StackName".to_string(), stack_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        let body = &response.body;
        let changes = client::xml_blocks(body, "member").iter().filter_map(|b| {
            let rc_block = client::xml_block(b, "ResourceChange")?;
            Some(Change {
                change_type: client::xml_text(b, "Type").unwrap_or_default(),
                resource_change: Some(ResourceChange {
                    action: client::xml_text(&rc_block, "Action").unwrap_or_default(),
                    logical_resource_id: client::xml_text(&rc_block, "LogicalResourceId").unwrap_or_default(),
                    physical_resource_id: client::xml_text(&rc_block, "PhysicalResourceId"),
                    resource_type: client::xml_text(&rc_block, "ResourceType").unwrap_or_default(),
                    replacement: client::xml_text(&rc_block, "Replacement"),
                    scope: client::xml_text_all(&rc_block, "member"),
                }),
            })
        }).collect();

        Ok(ChangeSet {
            change_set_id: client::xml_text(body, "ChangeSetId").unwrap_or_default(),
            change_set_name: client::xml_text(body, "ChangeSetName").unwrap_or_default(),
            stack_id: client::xml_text(body, "StackId"),
            stack_name: client::xml_text(body, "StackName"),
            status: client::xml_text(body, "Status").unwrap_or_default(),
            status_reason: client::xml_text(body, "StatusReason"),
            execution_status: client::xml_text(body, "ExecutionStatus"),
            creation_time: client::xml_text(body, "CreationTime"),
            description: client::xml_text(body, "Description"),
            changes,
        })
    }

    pub async fn execute_change_set(&self, change_set_name: &str, stack_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("ExecuteChangeSet", API_VERSION);
        params.insert("ChangeSetName".to_string(), change_set_name.to_string());
        params.insert("StackName".to_string(), stack_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn delete_change_set(&self, change_set_name: &str, stack_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteChangeSet", API_VERSION);
        params.insert("ChangeSetName".to_string(), change_set_name.to_string());
        params.insert("StackName".to_string(), stack_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn list_change_sets(&self, stack_name: &str) -> AwsResult<Vec<ChangeSet>> {
        let mut params = client::build_query_params("ListChangeSets", API_VERSION);
        params.insert("StackName".to_string(), stack_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_blocks(&response.body, "member").iter().filter_map(|b| {
            Some(ChangeSet {
                change_set_id: client::xml_text(b, "ChangeSetId")?,
                change_set_name: client::xml_text(b, "ChangeSetName")?,
                stack_id: client::xml_text(b, "StackId"),
                stack_name: client::xml_text(b, "StackName"),
                status: client::xml_text(b, "Status").unwrap_or_default(),
                status_reason: client::xml_text(b, "StatusReason"),
                execution_status: client::xml_text(b, "ExecutionStatus"),
                creation_time: client::xml_text(b, "CreationTime"),
                description: client::xml_text(b, "Description"),
                changes: vec![],
            })
        }).collect())
    }

    // ── Exports ─────────────────────────────────────────────────────

    pub async fn list_exports(&self) -> AwsResult<Vec<Export>> {
        let params = client::build_query_params("ListExports", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(client::xml_blocks(&response.body, "member").iter().filter_map(|b| {
            Some(Export {
                name: client::xml_text(b, "Name")?,
                value: client::xml_text(b, "Value")?,
                exporting_stack_id: client::xml_text(b, "ExportingStackId").unwrap_or_default(),
            })
        }).collect())
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn parse_stacks(&self, xml: &str) -> Vec<Stack> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(Stack {
                stack_id: client::xml_text(b, "StackId")?,
                stack_name: client::xml_text(b, "StackName")?,
                description: client::xml_text(b, "Description"),
                stack_status: client::xml_text(b, "StackStatus").map_or(StackStatus::Other("UNKNOWN".into()), |s| StackStatus::from(s.as_str())),
                stack_status_reason: client::xml_text(b, "StackStatusReason"),
                creation_time: client::xml_text(b, "CreationTime"),
                last_updated_time: client::xml_text(b, "LastUpdatedTime"),
                deletion_time: client::xml_text(b, "DeletionTime"),
                outputs: self.parse_outputs(b),
                parameters: self.parse_parameters(b),
                tags: self.parse_tags(b),
                capabilities: client::xml_text_all(b, "member"),
                role_arn: client::xml_text(b, "RoleARN"),
                enable_termination_protection: client::xml_text(b, "EnableTerminationProtection").map_or(false, |v| v == "true"),
                parent_id: client::xml_text(b, "ParentId"),
                root_id: client::xml_text(b, "RootId"),
                timeout_in_minutes: client::xml_text(b, "TimeoutInMinutes").and_then(|v| v.parse().ok()),
                notification_arns: client::xml_text_all(b, "member"),
            })
        }).collect()
    }

    fn parse_stack_summaries(&self, xml: &str) -> Vec<StackSummary> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(StackSummary {
                stack_id: client::xml_text(b, "StackId")?,
                stack_name: client::xml_text(b, "StackName")?,
                stack_status: client::xml_text(b, "StackStatus").map_or(StackStatus::Other("UNKNOWN".into()), |s| StackStatus::from(s.as_str())),
                stack_status_reason: client::xml_text(b, "StackStatusReason"),
                creation_time: client::xml_text(b, "CreationTime"),
                last_updated_time: client::xml_text(b, "LastUpdatedTime"),
                deletion_time: client::xml_text(b, "DeletionTime"),
                template_description: client::xml_text(b, "TemplateDescription"),
                parent_id: client::xml_text(b, "ParentId"),
                root_id: client::xml_text(b, "RootId"),
            })
        }).collect()
    }

    fn parse_stack_events(&self, xml: &str) -> Vec<StackEvent> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(StackEvent {
                stack_id: client::xml_text(b, "StackId")?,
                event_id: client::xml_text(b, "EventId")?,
                stack_name: client::xml_text(b, "StackName")?,
                logical_resource_id: client::xml_text(b, "LogicalResourceId"),
                physical_resource_id: client::xml_text(b, "PhysicalResourceId"),
                resource_type: client::xml_text(b, "ResourceType"),
                resource_status: client::xml_text(b, "ResourceStatus"),
                resource_status_reason: client::xml_text(b, "ResourceStatusReason"),
                timestamp: client::xml_text(b, "Timestamp"),
            })
        }).collect()
    }

    fn parse_stack_resources(&self, xml: &str) -> Vec<StackResource> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(StackResource {
                logical_resource_id: client::xml_text(b, "LogicalResourceId")?,
                physical_resource_id: client::xml_text(b, "PhysicalResourceId"),
                resource_type: client::xml_text(b, "ResourceType")?,
                resource_status: client::xml_text(b, "ResourceStatus")?,
                resource_status_reason: client::xml_text(b, "ResourceStatusReason"),
                timestamp: client::xml_text(b, "Timestamp"),
                description: client::xml_text(b, "Description"),
            })
        }).collect()
    }

    fn parse_outputs(&self, xml: &str) -> Vec<Output> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(Output {
                output_key: client::xml_text(b, "OutputKey")?,
                output_value: client::xml_text(b, "OutputValue")?,
                description: client::xml_text(b, "Description"),
                export_name: client::xml_text(b, "ExportName"),
            })
        }).collect()
    }

    fn parse_parameters(&self, xml: &str) -> Vec<Parameter> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(Parameter {
                parameter_key: client::xml_text(b, "ParameterKey")?,
                parameter_value: client::xml_text(b, "ParameterValue")?,
                use_previous_value: client::xml_text(b, "UsePreviousValue").map(|v| v == "true"),
                resolved_value: client::xml_text(b, "ResolvedValue"),
            })
        }).collect()
    }

    fn parse_tags(&self, xml: &str) -> Vec<StackTag> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(StackTag {
                key: client::xml_text(b, "Key")?,
                value: client::xml_text(b, "Value")?,
            })
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_status_from_str() {
        assert!(matches!(StackStatus::from("CREATE_COMPLETE"), StackStatus::CreateComplete));
        assert!(matches!(StackStatus::from("DELETE_IN_PROGRESS"), StackStatus::DeleteInProgress));
        assert!(matches!(StackStatus::from("UPDATE_ROLLBACK_COMPLETE"), StackStatus::UpdateRollbackComplete));
        assert!(matches!(StackStatus::from("CUSTOM_STATUS"), StackStatus::Other(_)));
    }

    #[test]
    fn stack_serde() {
        let stack = Stack {
            stack_id: "arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/guid".into(),
            stack_name: "my-stack".into(),
            description: Some("A test stack".into()),
            stack_status: StackStatus::CreateComplete,
            stack_status_reason: None,
            creation_time: Some("2024-01-01T00:00:00Z".into()),
            last_updated_time: None,
            deletion_time: None,
            outputs: vec![Output {
                output_key: "VpcId".into(),
                output_value: "vpc-12345".into(),
                description: None,
                export_name: Some("MyVpcId".into()),
            }],
            parameters: vec![Parameter {
                parameter_key: "InstanceType".into(),
                parameter_value: "t3.micro".into(),
                use_previous_value: None,
                resolved_value: None,
            }],
            tags: vec![StackTag { key: "env".into(), value: "prod".into() }],
            capabilities: vec!["CAPABILITY_IAM".into()],
            role_arn: None,
            enable_termination_protection: false,
            parent_id: None,
            root_id: None,
            timeout_in_minutes: Some(60),
            notification_arns: vec![],
        };
        let json = serde_json::to_string(&stack).unwrap();
        assert!(json.contains("my-stack"));
    }
}
