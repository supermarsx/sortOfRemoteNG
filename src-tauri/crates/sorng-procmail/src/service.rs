// ── sorng-procmail/src/service.rs ─────────────────────────────────────────────
//! Aggregate Procmail façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::ProcmailClient;
use crate::config::ProcmailConfigManager;
use crate::error::{ProcmailError, ProcmailResult};
use crate::includes::IncludeManager;
use crate::logs::ProcmailLogManager;
use crate::recipes::RecipeManager;
use crate::rules::RuleManager;
use crate::types::*;
use crate::variables::VariableManager;

/// Shared Tauri state handle.
pub type ProcmailServiceState = Arc<Mutex<ProcmailService>>;

/// Main Procmail service managing connections.
pub struct ProcmailService {
    connections: HashMap<String, ProcmailClient>,
}

impl ProcmailService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: ProcmailConnectionConfig,
    ) -> ProcmailResult<ProcmailConnectionSummary> {
        let client = ProcmailClient::new(config)?;
        let ver = client.version().await.ok();
        let recipe_count = RecipeManager::list(&client, "").await.map(|r| r.len()).unwrap_or(0);
        let log_path = client.log_path().to_string();
        let summary = ProcmailConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            recipe_count,
            log_path,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> ProcmailResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| {
                ProcmailError::new(
                    crate::error::ProcmailErrorKind::NotConnected,
                    format!("No connection '{}'", id),
                )
            })
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> ProcmailResult<&ProcmailClient> {
        self.connections.get(id).ok_or_else(|| {
            ProcmailError::new(
                crate::error::ProcmailErrorKind::NotConnected,
                format!("No connection '{}'", id),
            )
        })
    }

    // ── Recipes ──────────────────────────────────────────────────

    pub async fn list_recipes(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<Vec<ProcmailRecipe>> {
        RecipeManager::list(self.client(id)?, user).await
    }

    pub async fn get_recipe(
        &self,
        id: &str,
        user: &str,
        recipe_id: &str,
    ) -> ProcmailResult<ProcmailRecipe> {
        RecipeManager::get(self.client(id)?, user, recipe_id).await
    }

    pub async fn create_recipe(
        &self,
        id: &str,
        user: &str,
        req: CreateRecipeRequest,
    ) -> ProcmailResult<ProcmailRecipe> {
        RecipeManager::create(self.client(id)?, user, req).await
    }

    pub async fn update_recipe(
        &self,
        id: &str,
        user: &str,
        recipe_id: &str,
        req: UpdateRecipeRequest,
    ) -> ProcmailResult<ProcmailRecipe> {
        RecipeManager::update(self.client(id)?, user, recipe_id, req).await
    }

    pub async fn delete_recipe(
        &self,
        id: &str,
        user: &str,
        recipe_id: &str,
    ) -> ProcmailResult<()> {
        RecipeManager::delete(self.client(id)?, user, recipe_id).await
    }

    pub async fn enable_recipe(
        &self,
        id: &str,
        user: &str,
        recipe_id: &str,
    ) -> ProcmailResult<()> {
        RecipeManager::enable(self.client(id)?, user, recipe_id).await
    }

    pub async fn disable_recipe(
        &self,
        id: &str,
        user: &str,
        recipe_id: &str,
    ) -> ProcmailResult<()> {
        RecipeManager::disable(self.client(id)?, user, recipe_id).await
    }

    pub async fn reorder_recipe(
        &self,
        id: &str,
        user: &str,
        recipe_id: &str,
        new_position: usize,
    ) -> ProcmailResult<()> {
        RecipeManager::reorder(self.client(id)?, user, recipe_id, new_position).await
    }

    pub async fn test_recipe(
        &self,
        id: &str,
        user: &str,
        message_content: &str,
    ) -> ProcmailResult<RecipeTestResult> {
        RecipeManager::test(self.client(id)?, user, message_content).await
    }

    // ── Rules ────────────────────────────────────────────────────

    pub async fn list_rules(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<Vec<ProcmailRule>> {
        RuleManager::list(self.client(id)?, user).await
    }

    pub async fn get_rule(
        &self,
        id: &str,
        user: &str,
        rule_id: &str,
    ) -> ProcmailResult<ProcmailRule> {
        RuleManager::get(self.client(id)?, user, rule_id).await
    }

    pub async fn create_rule(
        &self,
        id: &str,
        user: &str,
        req: CreateRuleRequest,
    ) -> ProcmailResult<ProcmailRule> {
        RuleManager::create(self.client(id)?, user, req).await
    }

    pub async fn update_rule(
        &self,
        id: &str,
        user: &str,
        rule_id: &str,
        req: UpdateRuleRequest,
    ) -> ProcmailResult<ProcmailRule> {
        RuleManager::update(self.client(id)?, user, rule_id, req).await
    }

    pub async fn delete_rule(
        &self,
        id: &str,
        user: &str,
        rule_id: &str,
    ) -> ProcmailResult<()> {
        RuleManager::delete(self.client(id)?, user, rule_id).await
    }

    pub async fn enable_rule(
        &self,
        id: &str,
        user: &str,
        rule_id: &str,
    ) -> ProcmailResult<()> {
        RuleManager::enable(self.client(id)?, user, rule_id).await
    }

    pub async fn disable_rule(
        &self,
        id: &str,
        user: &str,
        rule_id: &str,
    ) -> ProcmailResult<()> {
        RuleManager::disable(self.client(id)?, user, rule_id).await
    }

    // ── Variables ────────────────────────────────────────────────

    pub async fn list_variables(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<Vec<ProcmailVariable>> {
        VariableManager::list(self.client(id)?, user).await
    }

    pub async fn get_variable(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> ProcmailResult<ProcmailVariable> {
        VariableManager::get(self.client(id)?, user, name).await
    }

    pub async fn set_variable(
        &self,
        id: &str,
        user: &str,
        name: &str,
        value: &str,
    ) -> ProcmailResult<()> {
        VariableManager::set(self.client(id)?, user, name, value).await
    }

    pub async fn delete_variable(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> ProcmailResult<()> {
        VariableManager::delete(self.client(id)?, user, name).await
    }

    // ── Includes ─────────────────────────────────────────────────

    pub async fn list_includes(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<Vec<ProcmailInclude>> {
        IncludeManager::list(self.client(id)?, user).await
    }

    pub async fn add_include(
        &self,
        id: &str,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        IncludeManager::add(self.client(id)?, user, path).await
    }

    pub async fn remove_include(
        &self,
        id: &str,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        IncludeManager::remove(self.client(id)?, user, path).await
    }

    pub async fn enable_include(
        &self,
        id: &str,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        IncludeManager::enable(self.client(id)?, user, path).await
    }

    pub async fn disable_include(
        &self,
        id: &str,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        IncludeManager::disable(self.client(id)?, user, path).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_config(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<ProcmailConfig> {
        ProcmailConfigManager::get_full(self.client(id)?, user).await
    }

    pub async fn set_config(
        &self,
        id: &str,
        user: &str,
        config: &ProcmailConfig,
    ) -> ProcmailResult<()> {
        ProcmailConfigManager::set_full(self.client(id)?, user, config).await
    }

    pub async fn backup_config(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<String> {
        ProcmailConfigManager::backup(self.client(id)?, user).await
    }

    pub async fn restore_config(
        &self,
        id: &str,
        user: &str,
        backup_content: &str,
    ) -> ProcmailResult<()> {
        ProcmailConfigManager::restore(self.client(id)?, user, backup_content).await
    }

    pub async fn validate_config(
        &self,
        id: &str,
        user: &str,
        content: &str,
    ) -> ProcmailResult<RecipeTestResult> {
        ProcmailConfigManager::validate(self.client(id)?, user, content).await
    }

    pub async fn get_raw_config(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<String> {
        ProcmailConfigManager::get_raw(self.client(id)?, user).await
    }

    pub async fn set_raw_config(
        &self,
        id: &str,
        user: &str,
        content: &str,
    ) -> ProcmailResult<()> {
        ProcmailConfigManager::set_raw(self.client(id)?, user, content).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn query_log(
        &self,
        id: &str,
        user: &str,
        lines: Option<usize>,
        filter: Option<String>,
    ) -> ProcmailResult<Vec<ProcmailLogEntry>> {
        ProcmailLogManager::query(self.client(id)?, user, lines, filter.as_deref()).await
    }

    pub async fn list_log_files(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<Vec<String>> {
        ProcmailLogManager::list_log_files(self.client(id)?, user).await
    }

    pub async fn clear_log(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<()> {
        ProcmailLogManager::clear_log(self.client(id)?, user).await
    }

    pub async fn get_log_path(
        &self,
        id: &str,
        user: &str,
    ) -> ProcmailResult<String> {
        ProcmailLogManager::get_log_path(self.client(id)?, user).await
    }

    pub async fn set_log_path(
        &self,
        id: &str,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        ProcmailLogManager::set_log_path(self.client(id)?, user, path).await
    }
}
