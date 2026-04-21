// ── sorng-terraform/src/workspace.rs ──────────────────────────────────────────
//! Terraform workspace management — new, select, list, delete, show.

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::WorkspaceInfo;

pub struct WorkspaceManager;

impl WorkspaceManager {
    /// List all workspaces and indicate which is current.
    pub async fn list(client: &TerraformClient) -> TerraformResult<Vec<WorkspaceInfo>> {
        let args = ["workspace", "list", "-no-color"];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::workspace_failed(format!(
                "workspace list failed: {}",
                output.stderr
            )));
        }

        let workspaces = output
            .stdout
            .lines()
            .map(|line| {
                let trimmed = line.trim();
                let is_current = trimmed.starts_with('*');
                let name = trimmed.trim_start_matches('*').trim().to_string();
                WorkspaceInfo { name, is_current }
            })
            .filter(|w| !w.name.is_empty())
            .collect();

        Ok(workspaces)
    }

    /// Show the current workspace name.
    pub async fn show(client: &TerraformClient) -> TerraformResult<String> {
        let args = ["workspace", "show"];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::workspace_failed(format!(
                "workspace show failed: {}",
                output.stderr
            )));
        }

        Ok(output.stdout.trim().to_string())
    }

    /// Create a new workspace.
    pub async fn new_workspace(client: &TerraformClient, name: &str) -> TerraformResult<String> {
        let args = ["workspace", "new", "-no-color", name];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::workspace_failed(format!(
                "workspace new '{}' failed: {}",
                name, output.stderr
            )));
        }

        Ok(output.stdout.trim().to_string())
    }

    /// Select (switch to) an existing workspace.
    pub async fn select(client: &TerraformClient, name: &str) -> TerraformResult<String> {
        let args = ["workspace", "select", "-no-color", name];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::workspace_failed(format!(
                "workspace select '{}' failed: {}",
                name, output.stderr
            )));
        }

        Ok(output.stdout.trim().to_string())
    }

    /// Delete a workspace (must not be the currently selected one).
    pub async fn delete(
        client: &TerraformClient,
        name: &str,
        force: bool,
    ) -> TerraformResult<String> {
        let mut args = vec!["workspace", "delete", "-no-color"];
        if force {
            args.push("-force");
        }
        args.push(name);

        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::workspace_failed(format!(
                "workspace delete '{}' failed: {}",
                name, output.stderr
            )));
        }

        Ok(output.stdout.trim().to_string())
    }
}
