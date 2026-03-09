// ── sorng-budibase/src/service.rs ──────────────────────────────────────────────
//! Aggregate Budibase façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::BudibaseClient;
use crate::error::{BudibaseError, BudibaseResult};
use crate::types::*;

use crate::apps::AppManager;
use crate::automations::AutomationManager;
use crate::datasources::DatasourceManager;
use crate::queries::QueryManager;
use crate::rows::RowManager;
use crate::tables::TableManager;
use crate::users::UserManager;
use crate::views::ViewManager;

/// Shared Tauri state handle.
pub type BudibaseServiceState = Arc<Mutex<BudibaseService>>;

/// Main Budibase service managing connections.
pub struct BudibaseService {
    connections: HashMap<String, BudibaseClient>,
}

impl Default for BudibaseService {
    fn default() -> Self {
        Self::new()
    }
}

impl BudibaseService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: BudibaseConnectionConfig,
    ) -> BudibaseResult<BudibaseConnectionStatus> {
        let client = BudibaseClient::from_config(&config)?;
        let status = client.ping().await?;
        self.connections.insert(id, client);
        Ok(status)
    }

    pub fn disconnect(&mut self, id: &str) -> BudibaseResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| BudibaseError::session(&format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> BudibaseResult<&BudibaseClient> {
        self.connections
            .get(id)
            .ok_or_else(|| BudibaseError::session(&format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> BudibaseResult<BudibaseConnectionStatus> {
        self.client(id)?.ping().await
    }

    /// Set an app ID scope on an existing connection.
    pub fn set_app_context(&mut self, id: &str, app_id: Option<String>) -> BudibaseResult<()> {
        let client = self
            .connections
            .get_mut(id)
            .ok_or_else(|| BudibaseError::session(&format!("No connection '{}'", id)))?;
        client.app_id = app_id;
        Ok(())
    }

    // ── Apps ──────────────────────────────────────────────────────

    pub async fn list_apps(&self, id: &str) -> BudibaseResult<Vec<BudibaseApp>> {
        AppManager::list(self.client(id)?).await
    }

    pub async fn search_apps(
        &self,
        id: &str,
        name: Option<String>,
    ) -> BudibaseResult<Vec<BudibaseApp>> {
        AppManager::search(self.client(id)?, name.as_deref()).await
    }

    pub async fn get_app(&self, id: &str, app_id: &str) -> BudibaseResult<BudibaseApp> {
        AppManager::get(self.client(id)?, app_id).await
    }

    pub async fn create_app(&self, id: &str, req: CreateAppRequest) -> BudibaseResult<BudibaseApp> {
        AppManager::create(self.client(id)?, &req).await
    }

    pub async fn update_app(
        &self,
        id: &str,
        app_id: &str,
        req: UpdateAppRequest,
    ) -> BudibaseResult<BudibaseApp> {
        AppManager::update(self.client(id)?, app_id, &req).await
    }

    pub async fn delete_app(&self, id: &str, app_id: &str) -> BudibaseResult<()> {
        AppManager::delete(self.client(id)?, app_id).await
    }

    pub async fn publish_app(&self, id: &str, app_id: &str) -> BudibaseResult<AppPublishResponse> {
        AppManager::publish(self.client(id)?, app_id).await
    }

    pub async fn unpublish_app(&self, id: &str, app_id: &str) -> BudibaseResult<()> {
        AppManager::unpublish(self.client(id)?, app_id).await
    }

    // ── Tables ────────────────────────────────────────────────────

    pub async fn list_tables(&self, id: &str) -> BudibaseResult<Vec<BudibaseTable>> {
        TableManager::list(self.client(id)?).await
    }

    pub async fn get_table(&self, id: &str, table_id: &str) -> BudibaseResult<BudibaseTable> {
        TableManager::get(self.client(id)?, table_id).await
    }

    pub async fn create_table(
        &self,
        id: &str,
        req: CreateTableRequest,
    ) -> BudibaseResult<BudibaseTable> {
        TableManager::create(self.client(id)?, &req).await
    }

    pub async fn update_table(
        &self,
        id: &str,
        table_id: &str,
        req: UpdateTableRequest,
    ) -> BudibaseResult<BudibaseTable> {
        TableManager::update(self.client(id)?, table_id, &req).await
    }

    pub async fn delete_table(
        &self,
        id: &str,
        table_id: &str,
        rev: Option<String>,
    ) -> BudibaseResult<()> {
        TableManager::delete(self.client(id)?, table_id, rev.as_deref()).await
    }

    pub async fn get_table_schema(
        &self,
        id: &str,
        table_id: &str,
    ) -> BudibaseResult<std::collections::HashMap<String, TableFieldSchema>> {
        TableManager::get_schema(self.client(id)?, table_id).await
    }

    // ── Rows ──────────────────────────────────────────────────────

    pub async fn list_rows(&self, id: &str, table_id: &str) -> BudibaseResult<Vec<BudibaseRow>> {
        RowManager::list(self.client(id)?, table_id).await
    }

    pub async fn search_rows(
        &self,
        id: &str,
        table_id: &str,
        req: RowSearchRequest,
    ) -> BudibaseResult<RowSearchResponse> {
        RowManager::search(self.client(id)?, table_id, &req).await
    }

    pub async fn get_row(
        &self,
        id: &str,
        table_id: &str,
        row_id: &str,
    ) -> BudibaseResult<BudibaseRow> {
        RowManager::get(self.client(id)?, table_id, row_id).await
    }

    pub async fn create_row(
        &self,
        id: &str,
        table_id: &str,
        row: BudibaseRow,
    ) -> BudibaseResult<BudibaseRow> {
        RowManager::create(self.client(id)?, table_id, &row).await
    }

    pub async fn update_row(
        &self,
        id: &str,
        table_id: &str,
        row_id: &str,
        row: BudibaseRow,
    ) -> BudibaseResult<BudibaseRow> {
        RowManager::update(self.client(id)?, table_id, row_id, &row).await
    }

    pub async fn delete_row(&self, id: &str, table_id: &str, row_id: &str) -> BudibaseResult<()> {
        RowManager::delete(self.client(id)?, table_id, row_id).await
    }

    pub async fn bulk_create_rows(
        &self,
        id: &str,
        table_id: &str,
        rows: Vec<BudibaseRow>,
    ) -> BudibaseResult<BulkRowResponse> {
        RowManager::bulk_create(self.client(id)?, table_id, &rows).await
    }

    pub async fn bulk_delete_rows(
        &self,
        id: &str,
        table_id: &str,
        req: BulkRowDeleteRequest,
    ) -> BudibaseResult<BulkRowResponse> {
        RowManager::bulk_delete(self.client(id)?, table_id, &req).await
    }

    // ── Views ─────────────────────────────────────────────────────

    pub async fn list_views(&self, id: &str, table_id: &str) -> BudibaseResult<Vec<BudibaseView>> {
        ViewManager::list(self.client(id)?, table_id).await
    }

    pub async fn get_view(&self, id: &str, view_id: &str) -> BudibaseResult<BudibaseView> {
        ViewManager::get(self.client(id)?, view_id).await
    }

    pub async fn create_view(
        &self,
        id: &str,
        req: CreateViewRequest,
    ) -> BudibaseResult<BudibaseView> {
        ViewManager::create(self.client(id)?, &req).await
    }

    pub async fn update_view(
        &self,
        id: &str,
        view_id: &str,
        req: CreateViewRequest,
    ) -> BudibaseResult<BudibaseView> {
        ViewManager::update(self.client(id)?, view_id, &req).await
    }

    pub async fn delete_view(&self, id: &str, view_id: &str) -> BudibaseResult<()> {
        ViewManager::delete(self.client(id)?, view_id).await
    }

    pub async fn query_view(&self, id: &str, view_id: &str) -> BudibaseResult<ViewQueryResponse> {
        ViewManager::query(self.client(id)?, view_id).await
    }

    // ── Users ─────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> BudibaseResult<Vec<BudibaseUser>> {
        UserManager::list(self.client(id)?).await
    }

    pub async fn search_users(
        &self,
        id: &str,
        email: Option<String>,
        bookmark: Option<String>,
    ) -> BudibaseResult<UserSearchResponse> {
        UserManager::search(self.client(id)?, email.as_deref(), bookmark.as_deref()).await
    }

    pub async fn get_user(&self, id: &str, user_id: &str) -> BudibaseResult<BudibaseUser> {
        UserManager::get(self.client(id)?, user_id).await
    }

    pub async fn create_user(
        &self,
        id: &str,
        req: CreateUserRequest,
    ) -> BudibaseResult<BudibaseUser> {
        UserManager::create(self.client(id)?, &req).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        user_id: &str,
        req: UpdateUserRequest,
    ) -> BudibaseResult<BudibaseUser> {
        UserManager::update(self.client(id)?, user_id, &req).await
    }

    pub async fn delete_user(&self, id: &str, user_id: &str) -> BudibaseResult<()> {
        UserManager::delete(self.client(id)?, user_id).await
    }

    // ── Queries ───────────────────────────────────────────────────

    pub async fn list_queries(&self, id: &str) -> BudibaseResult<Vec<BudibaseQuery>> {
        QueryManager::list(self.client(id)?).await
    }

    pub async fn get_query(&self, id: &str, query_id: &str) -> BudibaseResult<BudibaseQuery> {
        QueryManager::get(self.client(id)?, query_id).await
    }

    pub async fn execute_query(
        &self,
        id: &str,
        query_id: &str,
        req: ExecuteQueryRequest,
    ) -> BudibaseResult<QueryExecutionResponse> {
        QueryManager::execute(self.client(id)?, query_id, &req).await
    }

    pub async fn create_query(
        &self,
        id: &str,
        query: BudibaseQuery,
    ) -> BudibaseResult<BudibaseQuery> {
        QueryManager::create(self.client(id)?, &query).await
    }

    pub async fn update_query(
        &self,
        id: &str,
        query_id: &str,
        query: BudibaseQuery,
    ) -> BudibaseResult<BudibaseQuery> {
        QueryManager::update(self.client(id)?, query_id, &query).await
    }

    pub async fn delete_query(&self, id: &str, query_id: &str) -> BudibaseResult<()> {
        QueryManager::delete(self.client(id)?, query_id).await
    }

    // ── Automations ───────────────────────────────────────────────

    pub async fn list_automations(&self, id: &str) -> BudibaseResult<Vec<BudibaseAutomation>> {
        AutomationManager::list(self.client(id)?).await
    }

    pub async fn get_automation(
        &self,
        id: &str,
        automation_id: &str,
    ) -> BudibaseResult<BudibaseAutomation> {
        AutomationManager::get(self.client(id)?, automation_id).await
    }

    pub async fn create_automation(
        &self,
        id: &str,
        req: CreateAutomationRequest,
    ) -> BudibaseResult<BudibaseAutomation> {
        AutomationManager::create(self.client(id)?, &req).await
    }

    pub async fn update_automation(
        &self,
        id: &str,
        automation_id: &str,
        req: BudibaseAutomation,
    ) -> BudibaseResult<BudibaseAutomation> {
        AutomationManager::update(self.client(id)?, automation_id, &req).await
    }

    pub async fn delete_automation(&self, id: &str, automation_id: &str) -> BudibaseResult<()> {
        AutomationManager::delete(self.client(id)?, automation_id).await
    }

    pub async fn trigger_automation(
        &self,
        id: &str,
        automation_id: &str,
        req: TriggerAutomationRequest,
    ) -> BudibaseResult<TriggerAutomationResponse> {
        AutomationManager::trigger(self.client(id)?, automation_id, &req).await
    }

    pub async fn get_automation_logs(
        &self,
        id: &str,
        req: AutomationLogSearchRequest,
    ) -> BudibaseResult<AutomationLogSearchResponse> {
        AutomationManager::get_logs(self.client(id)?, &req).await
    }

    // ── Datasources ───────────────────────────────────────────────

    pub async fn list_datasources(&self, id: &str) -> BudibaseResult<Vec<BudibaseDatasource>> {
        DatasourceManager::list(self.client(id)?).await
    }

    pub async fn get_datasource(
        &self,
        id: &str,
        datasource_id: &str,
    ) -> BudibaseResult<BudibaseDatasource> {
        DatasourceManager::get(self.client(id)?, datasource_id).await
    }

    pub async fn create_datasource(
        &self,
        id: &str,
        req: CreateDatasourceRequest,
    ) -> BudibaseResult<BudibaseDatasource> {
        DatasourceManager::create(self.client(id)?, &req).await
    }

    pub async fn update_datasource(
        &self,
        id: &str,
        datasource_id: &str,
        req: UpdateDatasourceRequest,
    ) -> BudibaseResult<BudibaseDatasource> {
        DatasourceManager::update(self.client(id)?, datasource_id, &req).await
    }

    pub async fn delete_datasource(
        &self,
        id: &str,
        datasource_id: &str,
        rev: Option<String>,
    ) -> BudibaseResult<()> {
        DatasourceManager::delete(self.client(id)?, datasource_id, rev.as_deref()).await
    }

    pub async fn test_datasource(
        &self,
        id: &str,
        datasource_id: &str,
    ) -> BudibaseResult<DatasourceTestResponse> {
        DatasourceManager::test_connection(self.client(id)?, datasource_id).await
    }
}
