//! AWS IAM (Identity and Access Management) service client.
//!
//! Mirrors `aws-sdk-iam` types and operations. IAM uses the AWS Query protocol
//! with XML responses. IAM is a global service with a single endpoint.
//!
//! Reference: <https://docs.aws.amazon.com/IAM/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const API_VERSION: &str = "2010-05-08";
const SERVICE: &str = "iam";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub user_name: String,
    pub user_id: String,
    pub arn: String,
    pub path: String,
    pub create_date: String,
    pub password_last_used: Option<String>,
    pub permissions_boundary: Option<String>,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub group_name: String,
    pub group_id: String,
    pub arn: String,
    pub path: String,
    pub create_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub role_name: String,
    pub role_id: String,
    pub arn: String,
    pub path: String,
    pub create_date: String,
    pub assume_role_policy_document: Option<String>,
    pub description: Option<String>,
    pub max_session_duration: Option<u32>,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    pub policy_name: String,
    pub policy_id: String,
    pub arn: String,
    pub path: String,
    pub default_version_id: Option<String>,
    pub attachment_count: u32,
    pub is_attachable: bool,
    pub description: Option<String>,
    pub create_date: String,
    pub update_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyVersion {
    pub version_id: String,
    pub document: String,
    pub is_default_version: bool,
    pub create_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachedPolicy {
    pub policy_name: String,
    pub policy_arn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessKey {
    pub access_key_id: String,
    pub user_name: String,
    pub status: String,
    pub create_date: String,
    pub secret_access_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaDevice {
    pub user_name: String,
    pub serial_number: String,
    pub enable_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceProfile {
    pub instance_profile_name: String,
    pub instance_profile_id: String,
    pub arn: String,
    pub path: String,
    pub create_date: String,
    pub roles: Vec<Role>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDocument {
    #[serde(rename = "Version")]
    pub version: String,
    #[serde(rename = "Statement")]
    pub statement: Vec<PolicyStatement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyStatement {
    #[serde(rename = "Effect")]
    pub effect: String,
    #[serde(rename = "Action")]
    pub action: serde_json::Value,
    #[serde(rename = "Resource")]
    pub resource: serde_json::Value,
    #[serde(rename = "Condition", skip_serializing_if = "Option::is_none")]
    pub condition: Option<serde_json::Value>,
    #[serde(rename = "Principal", skip_serializing_if = "Option::is_none")]
    pub principal: Option<serde_json::Value>,
    #[serde(rename = "Sid", skip_serializing_if = "Option::is_none")]
    pub sid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserInput {
    pub user_name: String,
    pub path: Option<String>,
    pub permissions_boundary: Option<String>,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoleInput {
    pub role_name: String,
    pub assume_role_policy_document: String,
    pub description: Option<String>,
    pub max_session_duration: Option<u32>,
    pub path: Option<String>,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePolicyInput {
    pub policy_name: String,
    pub policy_document: String,
    pub description: Option<String>,
    pub path: Option<String>,
}

/// Account password policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordPolicy {
    pub minimum_password_length: u32,
    pub require_symbols: bool,
    pub require_numbers: bool,
    pub require_uppercase_characters: bool,
    pub require_lowercase_characters: bool,
    pub allow_users_to_change_password: bool,
    pub max_password_age: Option<u32>,
    pub password_reuse_prevention: Option<u32>,
    pub hard_expiry: bool,
}

/// Account summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSummary {
    pub users: u32,
    pub groups: u32,
    pub roles: u32,
    pub policies: u32,
    pub users_quota: u32,
    pub groups_quota: u32,
    pub roles_quota: u32,
    pub policies_quota: u32,
    pub mfa_devices: u32,
    pub access_keys_per_user_quota: u32,
    pub account_mfa_enabled: bool,
}

// ── IAM Client ──────────────────────────────────────────────────────────

pub struct IamClient {
    client: AwsClient,
}

impl IamClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── Users ───────────────────────────────────────────────────────

    pub async fn list_users(&self, path_prefix: Option<&str>, max_items: Option<u32>, marker: Option<&str>) -> AwsResult<(Vec<User>, Option<String>)> {
        let mut params = client::build_query_params("ListUsers", API_VERSION);
        if let Some(p) = path_prefix {
            params.insert("PathPrefix".to_string(), p.to_string());
        }
        if let Some(m) = max_items {
            params.insert("MaxItems".to_string(), m.to_string());
        }
        if let Some(mk) = marker {
            params.insert("Marker".to_string(), mk.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let users = self.parse_users(&response.body);
        let next_marker = client::xml_text(&response.body, "Marker");
        Ok((users, next_marker))
    }

    pub async fn get_user(&self, user_name: &str) -> AwsResult<User> {
        let mut params = client::build_query_params("GetUser", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_users(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "NoSuchEntity", &format!("User {} not found", user_name), 404))
    }

    pub async fn create_user(&self, input: &CreateUserInput) -> AwsResult<User> {
        let mut params = client::build_query_params("CreateUser", API_VERSION);
        params.insert("UserName".to_string(), input.user_name.clone());
        if let Some(ref p) = input.path {
            params.insert("Path".to_string(), p.clone());
        }
        if let Some(ref pb) = input.permissions_boundary {
            params.insert("PermissionsBoundary".to_string(), pb.clone());
        }
        let tags: Vec<crate::config::Tag> = input.tags.iter().map(|(k, v)| crate::config::Tag::new(k, v)).collect();
        client::add_tags(&mut params, &tags, "Tags.member");
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_users(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No user in CreateUser response", 200))
    }

    pub async fn delete_user(&self, user_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteUser", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── Groups ──────────────────────────────────────────────────────

    pub async fn list_groups(&self) -> AwsResult<Vec<Group>> {
        let params = client::build_query_params("ListGroups", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_groups(&response.body))
    }

    pub async fn create_group(&self, group_name: &str, path: Option<&str>) -> AwsResult<Group> {
        let mut params = client::build_query_params("CreateGroup", API_VERSION);
        params.insert("GroupName".to_string(), group_name.to_string());
        if let Some(p) = path {
            params.insert("Path".to_string(), p.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_groups(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No group in CreateGroup response", 200))
    }

    pub async fn delete_group(&self, group_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteGroup", API_VERSION);
        params.insert("GroupName".to_string(), group_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn add_user_to_group(&self, user_name: &str, group_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("AddUserToGroup", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        params.insert("GroupName".to_string(), group_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn remove_user_from_group(&self, user_name: &str, group_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("RemoveUserFromGroup", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        params.insert("GroupName".to_string(), group_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── Roles ───────────────────────────────────────────────────────

    pub async fn list_roles(&self) -> AwsResult<Vec<Role>> {
        let params = client::build_query_params("ListRoles", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_roles(&response.body))
    }

    pub async fn get_role(&self, role_name: &str) -> AwsResult<Role> {
        let mut params = client::build_query_params("GetRole", API_VERSION);
        params.insert("RoleName".to_string(), role_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_roles(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "NoSuchEntity", &format!("Role {} not found", role_name), 404))
    }

    pub async fn create_role(&self, input: &CreateRoleInput) -> AwsResult<Role> {
        let mut params = client::build_query_params("CreateRole", API_VERSION);
        params.insert("RoleName".to_string(), input.role_name.clone());
        params.insert("AssumeRolePolicyDocument".to_string(), input.assume_role_policy_document.clone());
        if let Some(ref desc) = input.description {
            params.insert("Description".to_string(), desc.clone());
        }
        if let Some(dur) = input.max_session_duration {
            params.insert("MaxSessionDuration".to_string(), dur.to_string());
        }
        if let Some(ref p) = input.path {
            params.insert("Path".to_string(), p.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_roles(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No role in CreateRole response", 200))
    }

    pub async fn delete_role(&self, role_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteRole", API_VERSION);
        params.insert("RoleName".to_string(), role_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── Policies ────────────────────────────────────────────────────

    pub async fn list_policies(&self, scope: Option<&str>, only_attached: Option<bool>) -> AwsResult<Vec<Policy>> {
        let mut params = client::build_query_params("ListPolicies", API_VERSION);
        if let Some(s) = scope {
            params.insert("Scope".to_string(), s.to_string());
        }
        if let Some(a) = only_attached {
            params.insert("OnlyAttached".to_string(), a.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_policies(&response.body))
    }

    pub async fn create_policy(&self, input: &CreatePolicyInput) -> AwsResult<Policy> {
        let mut params = client::build_query_params("CreatePolicy", API_VERSION);
        params.insert("PolicyName".to_string(), input.policy_name.clone());
        params.insert("PolicyDocument".to_string(), input.policy_document.clone());
        if let Some(ref desc) = input.description {
            params.insert("Description".to_string(), desc.clone());
        }
        if let Some(ref p) = input.path {
            params.insert("Path".to_string(), p.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_policies(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No policy in CreatePolicy response", 200))
    }

    pub async fn delete_policy(&self, policy_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeletePolicy", API_VERSION);
        params.insert("PolicyArn".to_string(), policy_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn get_policy_version(&self, policy_arn: &str, version_id: &str) -> AwsResult<PolicyVersion> {
        let mut params = client::build_query_params("GetPolicyVersion", API_VERSION);
        params.insert("PolicyArn".to_string(), policy_arn.to_string());
        params.insert("VersionId".to_string(), version_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(PolicyVersion {
            version_id: client::xml_text(&response.body, "VersionId").unwrap_or_default(),
            document: client::xml_text(&response.body, "Document").unwrap_or_default(),
            is_default_version: client::xml_text(&response.body, "IsDefaultVersion")
                .map(|v| v == "true").unwrap_or(false),
            create_date: client::xml_text(&response.body, "CreateDate").unwrap_or_default(),
        })
    }

    // ── Policy Attachments ──────────────────────────────────────────

    pub async fn attach_user_policy(&self, user_name: &str, policy_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("AttachUserPolicy", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        params.insert("PolicyArn".to_string(), policy_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn detach_user_policy(&self, user_name: &str, policy_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DetachUserPolicy", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        params.insert("PolicyArn".to_string(), policy_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn attach_role_policy(&self, role_name: &str, policy_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("AttachRolePolicy", API_VERSION);
        params.insert("RoleName".to_string(), role_name.to_string());
        params.insert("PolicyArn".to_string(), policy_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn detach_role_policy(&self, role_name: &str, policy_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DetachRolePolicy", API_VERSION);
        params.insert("RoleName".to_string(), role_name.to_string());
        params.insert("PolicyArn".to_string(), policy_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn attach_group_policy(&self, group_name: &str, policy_arn: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("AttachGroupPolicy", API_VERSION);
        params.insert("GroupName".to_string(), group_name.to_string());
        params.insert("PolicyArn".to_string(), policy_arn.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn list_attached_user_policies(&self, user_name: &str) -> AwsResult<Vec<AttachedPolicy>> {
        let mut params = client::build_query_params("ListAttachedUserPolicies", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_attached_policies(&response.body))
    }

    pub async fn list_attached_role_policies(&self, role_name: &str) -> AwsResult<Vec<AttachedPolicy>> {
        let mut params = client::build_query_params("ListAttachedRolePolicies", API_VERSION);
        params.insert("RoleName".to_string(), role_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_attached_policies(&response.body))
    }

    // ── Access Keys ─────────────────────────────────────────────────

    pub async fn list_access_keys(&self, user_name: &str) -> AwsResult<Vec<AccessKey>> {
        let mut params = client::build_query_params("ListAccessKeys", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_access_keys(&response.body))
    }

    pub async fn create_access_key(&self, user_name: &str) -> AwsResult<AccessKey> {
        let mut params = client::build_query_params("CreateAccessKey", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(AccessKey {
            access_key_id: client::xml_text(&response.body, "AccessKeyId").unwrap_or_default(),
            user_name: user_name.to_string(),
            status: "Active".to_string(),
            create_date: chrono::Utc::now().to_rfc3339(),
            secret_access_key: client::xml_text(&response.body, "SecretAccessKey"),
        })
    }

    pub async fn delete_access_key(&self, user_name: &str, access_key_id: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteAccessKey", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        params.insert("AccessKeyId".to_string(), access_key_id.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── MFA Devices ─────────────────────────────────────────────────

    pub async fn list_mfa_devices(&self, user_name: &str) -> AwsResult<Vec<MfaDevice>> {
        let mut params = client::build_query_params("ListMFADevices", API_VERSION);
        params.insert("UserName".to_string(), user_name.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        let blocks = client::xml_blocks(&response.body, "member");
        Ok(blocks.iter().filter_map(|block| {
            Some(MfaDevice {
                user_name: client::xml_text(block, "UserName")?,
                serial_number: client::xml_text(block, "SerialNumber")?,
                enable_date: client::xml_text(block, "EnableDate").unwrap_or_default(),
            })
        }).collect())
    }

    // ── Instance Profiles ───────────────────────────────────────────

    pub async fn list_instance_profiles(&self) -> AwsResult<Vec<InstanceProfile>> {
        let params = client::build_query_params("ListInstanceProfiles", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_instance_profiles(&response.body))
    }

    // ── Account ─────────────────────────────────────────────────────

    pub async fn get_account_summary(&self) -> AwsResult<AccountSummary> {
        let params = client::build_query_params("GetAccountSummary", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        let get_entry = |key: &str| -> u32 {
            client::xml_blocks(&response.body, "entry")
                .iter()
                .find_map(|block| {
                    let k = client::xml_text(block, "key")?;
                    if k == key { client::xml_text(block, "value")?.parse().ok() } else { None }
                })
                .unwrap_or(0)
        };
        Ok(AccountSummary {
            users: get_entry("Users"),
            groups: get_entry("Groups"),
            roles: get_entry("Roles"),
            policies: get_entry("Policies"),
            users_quota: get_entry("UsersQuota"),
            groups_quota: get_entry("GroupsQuota"),
            roles_quota: get_entry("RolesQuota"),
            policies_quota: get_entry("PoliciesQuota"),
            mfa_devices: get_entry("MFADevices"),
            access_keys_per_user_quota: get_entry("AccessKeysPerUserQuota"),
            account_mfa_enabled: get_entry("AccountMFAEnabled") == 1,
        })
    }

    // ── XML Parsers ─────────────────────────────────────────────────

    fn parse_users(&self, xml: &str) -> Vec<User> {
        let blocks = client::xml_blocks(xml, "member");
        blocks.iter().filter_map(|block| {
            let user_name = client::xml_text(block, "UserName")?;
            Some(User {
                user_name,
                user_id: client::xml_text(block, "UserId").unwrap_or_default(),
                arn: client::xml_text(block, "Arn").unwrap_or_default(),
                path: client::xml_text(block, "Path").unwrap_or_else(|| "/".to_string()),
                create_date: client::xml_text(block, "CreateDate").unwrap_or_default(),
                password_last_used: client::xml_text(block, "PasswordLastUsed"),
                permissions_boundary: client::xml_text(block, "PermissionsBoundary"),
                tags: HashMap::new(),
            })
        }).collect()
    }

    fn parse_groups(&self, xml: &str) -> Vec<Group> {
        let blocks = client::xml_blocks(xml, "member");
        blocks.iter().filter_map(|block| {
            let group_name = client::xml_text(block, "GroupName")?;
            Some(Group {
                group_name,
                group_id: client::xml_text(block, "GroupId").unwrap_or_default(),
                arn: client::xml_text(block, "Arn").unwrap_or_default(),
                path: client::xml_text(block, "Path").unwrap_or_else(|| "/".to_string()),
                create_date: client::xml_text(block, "CreateDate").unwrap_or_default(),
            })
        }).collect()
    }

    fn parse_roles(&self, xml: &str) -> Vec<Role> {
        let blocks = client::xml_blocks(xml, "member");
        blocks.iter().filter_map(|block| {
            let role_name = client::xml_text(block, "RoleName")?;
            Some(Role {
                role_name,
                role_id: client::xml_text(block, "RoleId").unwrap_or_default(),
                arn: client::xml_text(block, "Arn").unwrap_or_default(),
                path: client::xml_text(block, "Path").unwrap_or_else(|| "/".to_string()),
                create_date: client::xml_text(block, "CreateDate").unwrap_or_default(),
                assume_role_policy_document: client::xml_text(block, "AssumeRolePolicyDocument"),
                description: client::xml_text(block, "Description"),
                max_session_duration: client::xml_text(block, "MaxSessionDuration").and_then(|v| v.parse().ok()),
                tags: HashMap::new(),
            })
        }).collect()
    }

    fn parse_policies(&self, xml: &str) -> Vec<Policy> {
        let blocks = client::xml_blocks(xml, "member");
        blocks.iter().filter_map(|block| {
            let policy_name = client::xml_text(block, "PolicyName")?;
            Some(Policy {
                policy_name,
                policy_id: client::xml_text(block, "PolicyId").unwrap_or_default(),
                arn: client::xml_text(block, "Arn").unwrap_or_default(),
                path: client::xml_text(block, "Path").unwrap_or_else(|| "/".to_string()),
                default_version_id: client::xml_text(block, "DefaultVersionId"),
                attachment_count: client::xml_text(block, "AttachmentCount").and_then(|v| v.parse().ok()).unwrap_or(0),
                is_attachable: client::xml_text(block, "IsAttachable").map(|v| v == "true").unwrap_or(true),
                description: client::xml_text(block, "Description"),
                create_date: client::xml_text(block, "CreateDate").unwrap_or_default(),
                update_date: client::xml_text(block, "UpdateDate"),
            })
        }).collect()
    }

    fn parse_attached_policies(&self, xml: &str) -> Vec<AttachedPolicy> {
        let blocks = client::xml_blocks(xml, "member");
        blocks.iter().filter_map(|block| {
            Some(AttachedPolicy {
                policy_name: client::xml_text(block, "PolicyName")?,
                policy_arn: client::xml_text(block, "PolicyArn")?,
            })
        }).collect()
    }

    fn parse_access_keys(&self, xml: &str) -> Vec<AccessKey> {
        let blocks = client::xml_blocks(xml, "member");
        blocks.iter().filter_map(|block| {
            Some(AccessKey {
                access_key_id: client::xml_text(block, "AccessKeyId")?,
                user_name: client::xml_text(block, "UserName").unwrap_or_default(),
                status: client::xml_text(block, "Status").unwrap_or_else(|| "Active".to_string()),
                create_date: client::xml_text(block, "CreateDate").unwrap_or_default(),
                secret_access_key: None,
            })
        }).collect()
    }

    fn parse_instance_profiles(&self, xml: &str) -> Vec<InstanceProfile> {
        let blocks = client::xml_blocks(xml, "member");
        blocks.iter().filter_map(|block| {
            Some(InstanceProfile {
                instance_profile_name: client::xml_text(block, "InstanceProfileName")?,
                instance_profile_id: client::xml_text(block, "InstanceProfileId").unwrap_or_default(),
                arn: client::xml_text(block, "Arn").unwrap_or_default(),
                path: client::xml_text(block, "Path").unwrap_or_else(|| "/".to_string()),
                create_date: client::xml_text(block, "CreateDate").unwrap_or_default(),
                roles: self.parse_roles(block),
            })
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_serde() {
        let user = User {
            user_name: "alice".to_string(),
            user_id: "AIDAEXAMPLE".to_string(),
            arn: "arn:aws:iam::123456789012:user/alice".to_string(),
            path: "/".to_string(),
            create_date: "2024-01-01T00:00:00Z".to_string(),
            password_last_used: None,
            permissions_boundary: None,
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&user).unwrap();
        let back: User = serde_json::from_str(&json).unwrap();
        assert_eq!(back.user_name, "alice");
    }

    #[test]
    fn role_serde() {
        let role = Role {
            role_name: "AdminRole".to_string(),
            role_id: "AROAEXAMPLE".to_string(),
            arn: "arn:aws:iam::123456789012:role/AdminRole".to_string(),
            path: "/".to_string(),
            create_date: "2024-01-01T00:00:00Z".to_string(),
            assume_role_policy_document: Some("{\"Version\":\"2012-10-17\"}".to_string()),
            description: Some("Admin role".to_string()),
            max_session_duration: Some(3600),
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&role).unwrap();
        let back: Role = serde_json::from_str(&json).unwrap();
        assert_eq!(back.role_name, "AdminRole");
    }

    #[test]
    fn policy_document_serde() {
        let doc = PolicyDocument {
            version: "2012-10-17".to_string(),
            statement: vec![PolicyStatement {
                sid: Some("AllowS3".to_string()),
                effect: "Allow".to_string(),
                action: serde_json::json!("s3:*"),
                resource: serde_json::json!("*"),
                condition: None,
                principal: None,
            }],
        };
        let json = serde_json::to_string(&doc).unwrap();
        assert!(json.contains("2012-10-17"));
        assert!(json.contains("AllowS3"));
    }
}
