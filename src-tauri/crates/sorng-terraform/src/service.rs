// ── sorng-terraform/src/service.rs ────────────────────────────────────────────
//! Aggregate Terraform façade — single entry point that holds connections
//! and delegates to the domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::apply::ApplyManager;
use crate::client::TerraformClient;
use crate::drift::DriftDetector;
use crate::error::TerraformResult;
use crate::graph::GraphManager;
use crate::hcl::HclAnalyzer;
use crate::init::InitManager;
use crate::modules::ModulesManager;
use crate::output::OutputManager;
use crate::plan::PlanManager;
use crate::providers::ProvidersManager;
use crate::state::StateManager;
use crate::types::*;
use crate::validate::ValidateManager;
use crate::workspace::WorkspaceManager;

/// Shared Tauri state handle.
pub type TerraformServiceState = Arc<Mutex<TerraformService>>;

/// Main Terraform service managing connections and delegating operations.
pub struct TerraformService {
    /// Active Terraform connections keyed by a user-chosen id.
    connections: HashMap<String, TerraformClient>,
    /// Execution history.
    history: Vec<ExecutionHistoryEntry>,
}

impl TerraformService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            history: Vec::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: TerraformConnectionConfig,
    ) -> TerraformResult<TerraformInfo> {
        let client = TerraformClient::from_config(&config).await?;
        let info = client.detect_info().await?;
        self.connections.insert(id, client);
        Ok(info)
    }

    pub fn disconnect(&mut self, id: &str) -> TerraformResult<()> {
        self.connections.remove(id).ok_or_else(|| {
            crate::error::TerraformError::connection_not_found(id)
        })?;
        Ok(())
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    pub async fn is_available(&self, id: &str) -> TerraformResult<bool> {
        let client = self.client(id)?;
        match client.detect_info().await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    pub async fn get_info(&self, id: &str) -> TerraformResult<TerraformInfo> {
        let client = self.client(id)?;
        client.detect_info().await
    }

    // ── Init ─────────────────────────────────────────────────────────

    pub async fn init(
        &mut self,
        id: &str,
        options: &InitOptions,
    ) -> TerraformResult<InitResult> {
        let client = self.client(id)?;
        let result = InitManager::init(client, options).await?;
        self.record(id, CommandType::Init, &["init"]);
        Ok(result)
    }

    pub async fn init_no_backend(&mut self, id: &str) -> TerraformResult<InitResult> {
        let client = self.client(id)?;
        let result = InitManager::init_no_backend(client).await?;
        self.record(id, CommandType::Init, &["init", "-backend=false"]);
        Ok(result)
    }

    // ── Plan ─────────────────────────────────────────────────────────

    pub async fn plan(
        &mut self,
        id: &str,
        options: &PlanOptions,
    ) -> TerraformResult<PlanResult> {
        let client = self.client(id)?;
        let result = PlanManager::plan(client, options).await?;
        self.record(id, CommandType::Plan, &["plan"]);
        Ok(result)
    }

    pub async fn show_plan_json(&self, id: &str, plan_file: &str) -> TerraformResult<PlanSummary> {
        let client = self.client(id)?;
        PlanManager::show_plan_json(client, plan_file).await
    }

    pub async fn show_plan_text(&self, id: &str, plan_file: &str) -> TerraformResult<String> {
        let client = self.client(id)?;
        PlanManager::show_plan_text(client, plan_file).await
    }

    // ── Apply / Destroy / Refresh ────────────────────────────────────

    pub async fn apply(
        &mut self,
        id: &str,
        options: &ApplyOptions,
    ) -> TerraformResult<ApplyResult> {
        let client = self.client(id)?;
        let result = ApplyManager::apply(client, options).await?;
        self.record(id, CommandType::Apply, &["apply"]);
        Ok(result)
    }

    pub async fn destroy(
        &mut self,
        id: &str,
        options: &ApplyOptions,
    ) -> TerraformResult<ApplyResult> {
        let client = self.client(id)?;
        let result = ApplyManager::destroy(client, options).await?;
        self.record(id, CommandType::Destroy, &["destroy"]);
        Ok(result)
    }

    pub async fn refresh(
        &mut self,
        id: &str,
        options: &ApplyOptions,
    ) -> TerraformResult<ApplyResult> {
        let client = self.client(id)?;
        let result = ApplyManager::refresh(client, options).await?;
        self.record(id, CommandType::Refresh, &["apply", "-refresh-only"]);
        Ok(result)
    }

    // ── State management ─────────────────────────────────────────────

    pub async fn state_list(
        &self,
        id: &str,
        filter: Option<&str>,
    ) -> TerraformResult<Vec<String>> {
        let client = self.client(id)?;
        StateManager::list(client, filter).await
    }

    pub async fn state_show(&self, id: &str, address: &str) -> TerraformResult<StateResource> {
        let client = self.client(id)?;
        StateManager::show(client, address).await
    }

    pub async fn state_show_json(&self, id: &str) -> TerraformResult<StateSnapshot> {
        let client = self.client(id)?;
        StateManager::show_json(client).await
    }

    pub async fn state_pull(&self, id: &str) -> TerraformResult<String> {
        let client = self.client(id)?;
        StateManager::pull(client).await
    }

    pub async fn state_push(
        &mut self,
        id: &str,
        state_file: &str,
        force: bool,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = StateManager::push(client, state_file, force).await?;
        self.record(id, CommandType::StatePush, &["state", "push"]);
        Ok(result)
    }

    pub async fn state_mv(
        &mut self,
        id: &str,
        source: &str,
        destination: &str,
        dry_run: bool,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = StateManager::mv(client, source, destination, dry_run).await?;
        self.record(id, CommandType::StateMv, &["state", "mv"]);
        Ok(result)
    }

    pub async fn state_rm(
        &mut self,
        id: &str,
        addresses: &[&str],
        dry_run: bool,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = StateManager::rm(client, addresses, dry_run).await?;
        self.record(id, CommandType::StateRm, &["state", "rm"]);
        Ok(result)
    }

    pub async fn state_import(
        &mut self,
        id: &str,
        options: &ImportOptions,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = StateManager::import(client, options).await?;
        self.record(id, CommandType::Import, &["import"]);
        Ok(result)
    }

    pub async fn state_taint(
        &mut self,
        id: &str,
        address: &str,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = StateManager::taint(client, address).await?;
        self.record(id, CommandType::Taint, &["taint"]);
        Ok(result)
    }

    pub async fn state_untaint(
        &mut self,
        id: &str,
        address: &str,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = StateManager::untaint(client, address).await?;
        self.record(id, CommandType::Untaint, &["untaint"]);
        Ok(result)
    }

    pub async fn state_force_unlock(
        &mut self,
        id: &str,
        lock_id: &str,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = StateManager::force_unlock(client, lock_id).await?;
        self.record(id, CommandType::ForceUnlock, &["force-unlock"]);
        Ok(result)
    }

    // ── Workspace management ─────────────────────────────────────────

    pub async fn workspace_list(&self, id: &str) -> TerraformResult<Vec<WorkspaceInfo>> {
        let client = self.client(id)?;
        WorkspaceManager::list(client).await
    }

    pub async fn workspace_show(&self, id: &str) -> TerraformResult<String> {
        let client = self.client(id)?;
        WorkspaceManager::show(client).await
    }

    pub async fn workspace_new(
        &mut self,
        id: &str,
        name: &str,
    ) -> TerraformResult<String> {
        let client = self.client(id)?;
        let result = WorkspaceManager::new_workspace(client, name).await?;
        self.record(id, CommandType::WorkspaceNew, &["workspace", "new", name]);
        Ok(result)
    }

    pub async fn workspace_select(
        &mut self,
        id: &str,
        name: &str,
    ) -> TerraformResult<String> {
        let client = self.client(id)?;
        let result = WorkspaceManager::select(client, name).await?;
        self.record(id, CommandType::WorkspaceSelect, &["workspace", "select", name]);
        Ok(result)
    }

    pub async fn workspace_delete(
        &mut self,
        id: &str,
        name: &str,
        force: bool,
    ) -> TerraformResult<String> {
        let client = self.client(id)?;
        let result = WorkspaceManager::delete(client, name, force).await?;
        self.record(id, CommandType::WorkspaceDelete, &["workspace", "delete", name]);
        Ok(result)
    }

    // ── Validate / Format ────────────────────────────────────────────

    pub async fn validate(&self, id: &str) -> TerraformResult<ValidationResult> {
        let client = self.client(id)?;
        ValidateManager::validate(client).await
    }

    pub async fn fmt(
        &mut self,
        id: &str,
        recursive: bool,
        diff: bool,
    ) -> TerraformResult<FmtResult> {
        let client = self.client(id)?;
        let result = ValidateManager::fmt(client, false, recursive, diff).await?;
        self.record(id, CommandType::Fmt, &["fmt"]);
        Ok(result)
    }

    pub async fn fmt_check(&self, id: &str) -> TerraformResult<FmtResult> {
        let client = self.client(id)?;
        ValidateManager::fmt_check(client).await
    }

    // ── Outputs ──────────────────────────────────────────────────────

    pub async fn output_list(
        &self,
        id: &str,
    ) -> TerraformResult<HashMap<String, OutputValue>> {
        let client = self.client(id)?;
        OutputManager::list(client).await
    }

    pub async fn output_get(
        &self,
        id: &str,
        name: &str,
    ) -> TerraformResult<OutputValue> {
        let client = self.client(id)?;
        OutputManager::get(client, name).await
    }

    pub async fn output_get_raw(
        &self,
        id: &str,
        name: &str,
    ) -> TerraformResult<String> {
        let client = self.client(id)?;
        OutputManager::get_raw(client, name).await
    }

    // ── Providers ────────────────────────────────────────────────────

    pub async fn providers_list(&self, id: &str) -> TerraformResult<Vec<ProviderInfo>> {
        let client = self.client(id)?;
        ProvidersManager::list(client).await
    }

    pub async fn providers_schemas(
        &self,
        id: &str,
    ) -> TerraformResult<Vec<ProviderSchema>> {
        let client = self.client(id)?;
        ProvidersManager::schemas(client).await
    }

    pub async fn providers_lock(
        &mut self,
        id: &str,
        platforms: &[String],
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let refs: Vec<&str> = platforms.iter().map(|s| s.as_str()).collect();
        let result = ProvidersManager::lock(client, &refs).await?;
        self.record(id, CommandType::ProvidersLock, &["providers", "lock"]);
        Ok(result)
    }

    pub async fn providers_mirror(
        &mut self,
        id: &str,
        target_dir: &str,
        platforms: &[String],
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let refs: Vec<&str> = platforms.iter().map(|s| s.as_str()).collect();
        let result = ProvidersManager::mirror(client, target_dir, &refs).await?;
        self.record(id, CommandType::ProvidersMirror, &["providers", "mirror"]);
        Ok(result)
    }

    pub async fn providers_parse_lock_file(
        &self,
        id: &str,
    ) -> TerraformResult<Vec<ProviderLockEntry>> {
        let client = self.client(id)?;
        ProvidersManager::parse_lock_file(client).await
    }

    // ── Modules ──────────────────────────────────────────────────────

    pub async fn modules_get(
        &mut self,
        id: &str,
        update: bool,
    ) -> TerraformResult<StateOperationResult> {
        let client = self.client(id)?;
        let result = ModulesManager::get(client, update).await?;
        self.record(id, CommandType::Get, &["get"]);
        Ok(result)
    }

    pub async fn modules_list_installed(
        &self,
        id: &str,
    ) -> TerraformResult<Vec<ModuleRef>> {
        let client = self.client(id)?;
        ModulesManager::list_installed(client).await
    }

    pub async fn modules_search_registry(
        &self,
        id: &str,
        options: &RegistrySearchOptions,
    ) -> TerraformResult<Vec<RegistryModule>> {
        let client = self.client(id)?;
        ModulesManager::search_registry(client, options).await
    }

    // ── Graph ────────────────────────────────────────────────────────

    pub async fn graph_generate(
        &self,
        id: &str,
        graph_type: Option<&str>,
    ) -> TerraformResult<GraphResult> {
        let client = self.client(id)?;
        GraphManager::generate(client, graph_type).await
    }

    pub async fn graph_plan(
        &self,
        id: &str,
        plan_file: &str,
    ) -> TerraformResult<GraphResult> {
        let client = self.client(id)?;
        GraphManager::generate_plan_graph(client, plan_file).await
    }

    // ── HCL Analysis ─────────────────────────────────────────────────

    pub async fn hcl_analyse(&self, id: &str) -> TerraformResult<HclAnalysis> {
        let client = self.client(id)?;
        HclAnalyzer::analyse_dir(&client.working_dir).await
    }

    pub fn hcl_analyse_file(&self, content: &str, filename: &str) -> HclAnalysis {
        HclAnalyzer::analyse_file(content, filename)
    }

    pub fn hcl_summarise(&self, analysis: &HclAnalysis) -> ConfigurationSummary {
        HclAnalyzer::summarise(analysis)
    }

    // ── Drift detection ──────────────────────────────────────────────

    pub async fn drift_detect(&mut self, id: &str) -> TerraformResult<DriftResult> {
        let client = self.client(id)?;
        let result = DriftDetector::detect(client).await?;
        self.record(id, CommandType::Refresh, &["plan", "-refresh-only"]);
        Ok(result)
    }

    pub async fn drift_has_drift(&self, id: &str) -> TerraformResult<bool> {
        let client = self.client(id)?;
        DriftDetector::has_drift(client).await
    }

    pub fn drift_compare_snapshots(
        &self,
        before: &StateSnapshot,
        after: &StateSnapshot,
    ) -> Vec<DriftedResource> {
        DriftDetector::compare_snapshots(before, after)
    }

    // ── History ──────────────────────────────────────────────────────

    pub fn history_list(&self) -> Vec<ExecutionHistoryEntry> {
        self.history.clone()
    }

    pub fn history_get(&self, exec_id: &str) -> Option<ExecutionHistoryEntry> {
        self.history.iter().find(|e| e.id == exec_id).cloned()
    }

    pub fn history_clear(&mut self) {
        self.history.clear();
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn client(&self, id: &str) -> TerraformResult<&TerraformClient> {
        self.connections.get(id).ok_or_else(|| {
            crate::error::TerraformError::connection_not_found(id)
        })
    }

    fn record(&mut self, connection_id: &str, cmd_type: CommandType, args: &[&str]) {
        let now = chrono::Utc::now();
        self.history.push(ExecutionHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            connection_id: connection_id.to_string(),
            command_type: cmd_type,
            args: args.iter().map(|s| s.to_string()).collect(),
            exit_code: 0,
            stdout_snippet: String::new(),
            stderr_snippet: String::new(),
            started_at: now,
            duration_ms: 0,
            workspace: None,
            working_dir: String::new(),
            success: true,
        });

        // Cap history at 500 entries.
        if self.history.len() > 500 {
            self.history.drain(..self.history.len() - 500);
        }
    }
}
