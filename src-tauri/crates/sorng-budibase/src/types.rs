// ── sorng-budibase/src/types.rs ────────────────────────────────────────────────
//! Comprehensive Budibase REST API types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for connecting to a Budibase instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseConnectionConfig {
    /// User-chosen identifier for this connection.
    pub name: String,
    /// Budibase host URL (e.g. "https://budibase.example.com").
    pub host: String,
    /// API key for authentication.
    pub api_key: String,
    /// Optional app ID to scope operations to a specific app.
    #[serde(default)]
    pub app_id: Option<String>,
    /// Request timeout in seconds.
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    /// Whether to skip TLS certificate verification.
    #[serde(default)]
    pub skip_tls_verify: bool,
}

/// Connection health / status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseConnectionStatus {
    pub connected: bool,
    pub host: String,
    pub version: Option<String>,
    pub tenant_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Apps
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseApp {
    #[serde(rename = "_id")]
    pub id: Option<String>,
    pub name: String,
    pub url: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub deployed: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub version: Option<String>,
    pub tenant_id: Option<String>,
    pub locked_by: Option<String>,
    pub icon: Option<BudibaseAppIcon>,
    #[serde(default)]
    pub features: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseAppIcon {
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_template: Option<bool>,
    #[serde(default)]
    pub file_import: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<BudibaseAppIcon>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPublishResponse {
    #[serde(rename = "_id")]
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppExportResponse {
    pub data: Vec<u8>,
    pub filename: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tables
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseTable {
    #[serde(rename = "_id")]
    pub id: Option<String>,
    #[serde(rename = "_rev")]
    pub rev: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub table_type: Option<String>,
    pub source_id: Option<String>,
    pub source_type: Option<String>,
    pub primary_display: Option<String>,
    #[serde(default)]
    pub schema: HashMap<String, TableFieldSchema>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub views: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFieldSchema {
    #[serde(rename = "type")]
    pub field_type: String,
    pub name: Option<String>,
    #[serde(default)]
    pub constraints: Option<FieldConstraints>,
    pub visible: Option<bool>,
    pub order: Option<i32>,
    pub width: Option<i32>,
    pub formula: Option<String>,
    pub relationship_type: Option<String>,
    pub table_id: Option<String>,
    pub field_name: Option<String>,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub auto_column: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldConstraints {
    #[serde(rename = "type")]
    pub constraint_type: Option<String>,
    pub presence: Option<bool>,
    pub length: Option<FieldLengthConstraint>,
    pub numericality: Option<FieldNumericConstraint>,
    pub inclusion: Option<Vec<String>>,
    pub datetime: Option<FieldDateConstraint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldLengthConstraint {
    pub minimum: Option<i64>,
    pub maximum: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldNumericConstraint {
    pub greater_than_or_equal_to: Option<f64>,
    pub less_than_or_equal_to: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDateConstraint {
    pub latest: Option<String>,
    pub earliest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableRequest {
    pub name: String,
    #[serde(default)]
    pub schema: HashMap<String, TableFieldSchema>,
    pub primary_display: Option<String>,
    #[serde(rename = "type")]
    pub table_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTableRequest {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "_rev")]
    pub rev: Option<String>,
    pub name: String,
    #[serde(default)]
    pub schema: HashMap<String, TableFieldSchema>,
    pub primary_display: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rows
// ═══════════════════════════════════════════════════════════════════════════════

/// Generic row represented as a JSON map.
pub type BudibaseRow = HashMap<String, serde_json::Value>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowSearchRequest {
    pub query: RowSearchQuery,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paginate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort: Option<RowSort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowSearchQuery {
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub equal: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub not_equal: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub contains: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub not_contains: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub range: HashMap<String, RangeFilter>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub empty: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub not_empty: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub one_of: HashMap<String, Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuzzy: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub string: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeFilter {
    pub low: Option<serde_json::Value>,
    pub high: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowSort {
    pub column: String,
    pub order: Option<String>,
    #[serde(rename = "type")]
    pub sort_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowSearchResponse {
    #[serde(default)]
    pub rows: Vec<BudibaseRow>,
    pub total_rows: Option<i64>,
    pub has_next_page: Option<bool>,
    pub bookmark: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkRowDeleteRequest {
    pub rows: Vec<BudibaseRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkRowResponse {
    #[serde(default)]
    pub successful: Vec<BudibaseRow>,
    #[serde(default)]
    pub failed: Vec<BudibaseRow>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Views
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseView {
    pub id: Option<String>,
    pub name: String,
    pub table_id: String,
    #[serde(rename = "type")]
    pub view_type: Option<String>,
    pub query: Option<serde_json::Value>,
    pub schema: Option<HashMap<String, serde_json::Value>>,
    pub primary_display: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateViewRequest {
    pub name: String,
    pub table_id: String,
    #[serde(rename = "type")]
    pub view_type: Option<String>,
    pub query: Option<serde_json::Value>,
    pub schema: Option<HashMap<String, serde_json::Value>>,
    pub primary_display: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewQueryResponse {
    #[serde(default)]
    pub rows: Vec<BudibaseRow>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseUser {
    #[serde(rename = "_id")]
    pub id: Option<String>,
    pub email: String,
    #[serde(default)]
    pub roles: HashMap<String, String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub builder: Option<BudibaseBuilderRole>,
    #[serde(default)]
    pub admin: Option<BudibaseAdminRole>,
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub force_reset_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseBuilderRole {
    #[serde(default)]
    pub global: bool,
    #[serde(default)]
    pub apps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseAdminRole {
    #[serde(default)]
    pub global: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub email: String,
    pub password: Option<String>,
    #[serde(default)]
    pub roles: HashMap<String, String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub builder: Option<BudibaseBuilderRole>,
    pub admin: Option<BudibaseAdminRole>,
    #[serde(default)]
    pub force_reset_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
    #[serde(rename = "_id")]
    pub id: String,
    pub email: Option<String>,
    pub password: Option<String>,
    #[serde(default)]
    pub roles: HashMap<String, String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub builder: Option<BudibaseBuilderRole>,
    pub admin: Option<BudibaseAdminRole>,
    #[serde(default)]
    pub force_reset_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSearchResponse {
    #[serde(default)]
    pub data: Vec<BudibaseUser>,
    pub has_next_page: Option<bool>,
    pub bookmark: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Queries  (saved data-source queries)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseQuery {
    #[serde(rename = "_id")]
    pub id: Option<String>,
    pub name: String,
    pub datasource_id: String,
    pub query_verb: Option<String>,
    pub fields: Option<serde_json::Value>,
    pub parameters: Option<Vec<QueryParameter>>,
    pub transformer: Option<String>,
    pub readable: Option<bool>,
    pub schema: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryParameter {
    pub name: String,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryRequest {
    #[serde(default)]
    pub parameters: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pagination: Option<QueryPagination>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPagination {
    pub limit: Option<i32>,
    pub page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryExecutionResponse {
    #[serde(default)]
    pub data: Vec<serde_json::Value>,
    pub pagination: Option<QueryPagination>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Automations
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseAutomation {
    #[serde(rename = "_id")]
    pub id: Option<String>,
    #[serde(rename = "_rev")]
    pub rev: Option<String>,
    pub name: Option<String>,
    pub app_id: Option<String>,
    pub definition: Option<AutomationDefinition>,
    #[serde(rename = "type")]
    pub automation_type: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDefinition {
    pub trigger: Option<serde_json::Value>,
    #[serde(default)]
    pub steps: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationRequest {
    pub name: String,
    pub definition: AutomationDefinition,
    #[serde(rename = "type")]
    pub automation_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerAutomationRequest {
    #[serde(default)]
    pub fields: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerAutomationResponse {
    pub message: Option<String>,
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationLog {
    #[serde(rename = "_id")]
    pub id: Option<String>,
    pub automation_id: String,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub trigger: Option<serde_json::Value>,
    #[serde(default)]
    pub steps: Vec<AutomationStepLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStepLog {
    pub step_id: Option<String>,
    pub status: Option<String>,
    pub outputs: Option<serde_json::Value>,
    pub inputs: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationLogSearchRequest {
    pub automation_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub page: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationLogSearchResponse {
    #[serde(default)]
    pub data: Vec<AutomationLog>,
    pub has_next_page: Option<bool>,
    pub bookmark: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Datasources
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudibaseDatasource {
    #[serde(rename = "_id")]
    pub id: Option<String>,
    #[serde(rename = "_rev")]
    pub rev: Option<String>,
    pub name: String,
    pub source: String,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
    pub plus: Option<bool>,
    #[serde(rename = "type")]
    pub datasource_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatasourceRequest {
    pub name: String,
    pub source: String,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
    pub plus: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDatasourceRequest {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "_rev")]
    pub rev: Option<String>,
    pub name: Option<String>,
    pub source: Option<String>,
    pub config: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasourceTestResponse {
    pub connected: bool,
    pub error: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pagination helpers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationParams {
    pub page: Option<i32>,
    pub limit: Option<i32>,
    pub bookmark: Option<String>,
}
