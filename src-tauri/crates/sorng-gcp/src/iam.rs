//! Google Cloud IAM client.
//!
//! Covers service accounts, roles, and IAM policies.
//!
//! API base: `https://iam.googleapis.com/v1`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "iam";
const V1: &str = "/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// IAM service account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IamServiceAccount {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "projectId")]
    pub project_id: String,
    #[serde(default, rename = "uniqueId")]
    pub unique_id: String,
    #[serde(default)]
    pub email: String,
    #[serde(default, rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub etag: Option<String>,
}

/// IAM service account key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IamServiceAccountKey {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "validAfterTime")]
    pub valid_after_time: Option<String>,
    #[serde(default, rename = "validBeforeTime")]
    pub valid_before_time: Option<String>,
    #[serde(default, rename = "keyAlgorithm")]
    pub key_algorithm: String,
    #[serde(default, rename = "keyOrigin")]
    pub key_origin: String,
    #[serde(default, rename = "keyType")]
    pub key_type: String,
    #[serde(default)]
    pub disabled: bool,
}

/// IAM role.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IamRole {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "includedPermissions")]
    pub included_permissions: Vec<String>,
    #[serde(default)]
    pub stage: Option<String>,
    #[serde(default)]
    pub deleted: Option<bool>,
    #[serde(default)]
    pub etag: Option<String>,
}

/// IAM policy binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyBinding {
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub condition: Option<PolicyCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyCondition {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub expression: String,
}

/// IAM policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IamPolicy {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub bindings: Vec<PolicyBinding>,
    #[serde(default)]
    pub etag: Option<String>,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ServiceAccountList {
    #[serde(default)]
    accounts: Vec<IamServiceAccount>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RoleList {
    #[serde(default)]
    roles: Vec<IamRole>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct KeyList {
    #[serde(default)]
    keys: Vec<IamServiceAccountKey>,
}

// ── IAM Client ──────────────────────────────────────────────────────────

pub struct IamClient;

impl IamClient {
    // ── Service Accounts ────────────────────────────────────────────

    /// List service accounts in a project.
    pub async fn list_service_accounts(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<IamServiceAccount>> {
        let path = format!("{}/projects/{}/serviceAccounts", V1, project);
        let resp: ServiceAccountList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.accounts)
    }

    /// Get a service account by email.
    pub async fn get_service_account(
        client: &mut GcpClient,
        project: &str,
        email: &str,
    ) -> GcpResult<IamServiceAccount> {
        let path = format!(
            "{}/projects/{}/serviceAccounts/{}",
            V1, project, email
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a service account.
    pub async fn create_service_account(
        client: &mut GcpClient,
        project: &str,
        account_id: &str,
        display_name: &str,
        description: Option<&str>,
    ) -> GcpResult<IamServiceAccount> {
        let path = format!("{}/projects/{}/serviceAccounts", V1, project);
        let mut sa = serde_json::json!({
            "displayName": display_name,
        });
        if let Some(desc) = description {
            sa["description"] = serde_json::Value::String(desc.to_string());
        }
        let body = serde_json::json!({
            "accountId": account_id,
            "serviceAccount": sa,
        });
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a service account.
    pub async fn delete_service_account(
        client: &mut GcpClient,
        project: &str,
        email: &str,
    ) -> GcpResult<()> {
        let path = format!(
            "{}/projects/{}/serviceAccounts/{}",
            V1, project, email
        );
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    /// Enable a disabled service account.
    pub async fn enable_service_account(
        client: &mut GcpClient,
        project: &str,
        email: &str,
    ) -> GcpResult<()> {
        let path = format!(
            "{}/projects/{}/serviceAccounts/{}:enable",
            V1, project, email
        );
        client
            .post_text(SERVICE, &path, &serde_json::Value::Null)
            .await?;
        Ok(())
    }

    /// Disable a service account.
    pub async fn disable_service_account(
        client: &mut GcpClient,
        project: &str,
        email: &str,
    ) -> GcpResult<()> {
        let path = format!(
            "{}/projects/{}/serviceAccounts/{}:disable",
            V1, project, email
        );
        client
            .post_text(SERVICE, &path, &serde_json::Value::Null)
            .await?;
        Ok(())
    }

    /// List keys for a service account.
    pub async fn list_service_account_keys(
        client: &mut GcpClient,
        project: &str,
        email: &str,
    ) -> GcpResult<Vec<IamServiceAccountKey>> {
        let path = format!(
            "{}/projects/{}/serviceAccounts/{}/keys",
            V1, project, email
        );
        let resp: KeyList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.keys)
    }

    // ── Roles ───────────────────────────────────────────────────────

    /// List predefined roles.
    pub async fn list_roles(
        client: &mut GcpClient,
    ) -> GcpResult<Vec<IamRole>> {
        let path = format!("{}/roles", V1);
        let resp: RoleList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.roles)
    }

    /// List custom roles in a project.
    pub async fn list_project_roles(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<IamRole>> {
        let path = format!("{}/projects/{}/roles", V1, project);
        let resp: RoleList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.roles)
    }

    /// Get a role by name.
    pub async fn get_role(
        client: &mut GcpClient,
        role_name: &str,
    ) -> GcpResult<IamRole> {
        let path = format!("{}/{}", V1, role_name);
        client.get(SERVICE, &path, &[]).await
    }

    // ── Project IAM Policy ──────────────────────────────────────────

    /// Get the IAM policy for a project.
    pub async fn get_project_iam_policy(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<IamPolicy> {
        let path = format!(
            "/v1/projects/{}:getIamPolicy",
            project
        );
        client
            .post(
                "cloudresourcemanager",
                &path,
                &serde_json::json!({}),
            )
            .await
    }

    /// Set the IAM policy for a project.
    pub async fn set_project_iam_policy(
        client: &mut GcpClient,
        project: &str,
        policy: IamPolicy,
    ) -> GcpResult<IamPolicy> {
        let path = format!(
            "/v1/projects/{}:setIamPolicy",
            project
        );
        let body = serde_json::json!({ "policy": policy });
        client
            .post("cloudresourcemanager", &path, &body)
            .await
    }

    /// Test IAM permissions.
    pub async fn test_iam_permissions(
        client: &mut GcpClient,
        project: &str,
        permissions: Vec<String>,
    ) -> GcpResult<Vec<String>> {
        let path = format!(
            "/v1/projects/{}:testIamPermissions",
            project
        );
        let body = serde_json::json!({ "permissions": permissions });
        #[derive(Deserialize)]
        struct TestResult {
            #[serde(default)]
            permissions: Vec<String>,
        }
        let resp: TestResult = client
            .post("cloudresourcemanager", &path, &body)
            .await?;
        Ok(resp.permissions)
    }
}
