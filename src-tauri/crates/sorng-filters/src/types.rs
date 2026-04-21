use std::fmt;

use serde::{Deserialize, Serialize};

// ── SmartFilter ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFilter {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub conditions: Vec<FilterCondition>,
    pub logic: FilterLogic,
    pub sort_by: Option<SortField>,
    pub sort_order: SortOrder,
    pub limit: Option<usize>,
    pub pinned: bool,
    pub built_in: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl SmartFilter {
    pub fn new(name: &str, description: &str) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            description: description.to_string(),
            icon: None,
            color: None,
            conditions: Vec::new(),
            logic: FilterLogic::And,
            sort_by: None,
            sort_order: SortOrder::Ascending,
            limit: None,
            pinned: false,
            built_in: false,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

// ── FilterCondition ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub field: FilterField,
    pub operator: FilterOperator,
    pub value: FilterValue,
    pub negate: bool,
}

// ── FilterField ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FilterField {
    Protocol,
    Hostname,
    Port,
    Username,
    Name,
    Description,
    Tags,
    ColorTag,
    Favorite,
    ParentFolder,
    Status,
    LastConnected,
    CreatedAt,
    UpdatedAt,
    ConnectionCount,
    HasProxy,
    HasTunnel,
    HasJumpHost,
    AuthType,
    Domain,
    MacAddress,
    Custom(String),
}

impl FilterField {
    /// Return the JSON key name used to extract this field from a connection object.
    pub fn json_key(&self) -> &str {
        match self {
            FilterField::Protocol => "protocol",
            FilterField::Hostname => "hostname",
            FilterField::Port => "port",
            FilterField::Username => "username",
            FilterField::Name => "name",
            FilterField::Description => "description",
            FilterField::Tags => "tags",
            FilterField::ColorTag => "colorTag",
            FilterField::Favorite => "favorite",
            FilterField::ParentFolder => "parentFolder",
            FilterField::Status => "status",
            FilterField::LastConnected => "lastConnected",
            FilterField::CreatedAt => "createdAt",
            FilterField::UpdatedAt => "updatedAt",
            FilterField::ConnectionCount => "connectionCount",
            FilterField::HasProxy => "hasProxy",
            FilterField::HasTunnel => "hasTunnel",
            FilterField::HasJumpHost => "hasJumpHost",
            FilterField::AuthType => "authType",
            FilterField::Domain => "domain",
            FilterField::MacAddress => "macAddress",
            FilterField::Custom(key) => key.as_str(),
        }
    }
}

// ── FilterOperator ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FilterOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    GreaterThan,
    LessThan,
    GreaterOrEqual,
    LessOrEqual,
    In,
    NotIn,
    Matches,
    Exists,
    IsEmpty,
    Between,
    OlderThan,
    NewerThan,
}

// ── FilterValue ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterValue {
    String(String),
    Number(f64),
    Boolean(bool),
    StringList(Vec<String>),
    Date(String),
    Duration(DurationValue),
    Null,
}

// ── DurationValue / DurationUnit ────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurationValue {
    pub amount: u64,
    pub unit: DurationUnit,
}

impl DurationValue {
    /// Convert to a chrono Duration.
    pub fn to_chrono_duration(&self) -> chrono::Duration {
        match self.unit {
            DurationUnit::Seconds => chrono::Duration::seconds(self.amount as i64),
            DurationUnit::Minutes => chrono::Duration::minutes(self.amount as i64),
            DurationUnit::Hours => chrono::Duration::hours(self.amount as i64),
            DurationUnit::Days => chrono::Duration::days(self.amount as i64),
            DurationUnit::Weeks => chrono::Duration::weeks(self.amount as i64),
            DurationUnit::Months => chrono::Duration::days(self.amount as i64 * 30),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DurationUnit {
    Seconds,
    Minutes,
    Hours,
    Days,
    Weeks,
    Months,
}

// ── FilterLogic ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterLogic {
    And,
    Or,
    /// A custom boolean expression referencing condition indices, e.g. "(0 AND 1) OR 2".
    Custom(String),
}

// ── SortField ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SortField {
    Name,
    Protocol,
    Hostname,
    LastConnected,
    CreatedAt,
    UpdatedAt,
    ConnectionCount,
    Port,
    Status,
    ColorTag,
    Favorite,
}

impl SortField {
    pub fn json_key(&self) -> &str {
        match self {
            SortField::Name => "name",
            SortField::Protocol => "protocol",
            SortField::Hostname => "hostname",
            SortField::LastConnected => "lastConnected",
            SortField::CreatedAt => "createdAt",
            SortField::UpdatedAt => "updatedAt",
            SortField::ConnectionCount => "connectionCount",
            SortField::Port => "port",
            SortField::Status => "status",
            SortField::ColorTag => "colorTag",
            SortField::Favorite => "favorite",
        }
    }
}

// ── SortOrder ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum SortOrder {
    #[default]
    Ascending,
    Descending,
}

// ── SmartGroup ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartGroup {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub filter_id: String,
    pub parent_id: Option<String>,
    pub position: i32,
    pub show_in_tree: bool,
}

impl SmartGroup {
    pub fn new(name: &str, filter_id: &str) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            icon: None,
            color: None,
            filter_id: filter_id.to_string(),
            parent_id: None,
            position: 0,
            show_in_tree: true,
        }
    }
}

// ── FilterResult ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterResult {
    pub matching_ids: Vec<String>,
    pub total_evaluated: usize,
    pub match_count: usize,
    pub duration_ms: f64,
}

// ── FilterPreset / PresetCategory ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterPreset {
    pub id: String,
    pub name: String,
    pub category: PresetCategory,
    pub filter: SmartFilter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PresetCategory {
    RecentlyUsed,
    Favorites,
    ByProtocol,
    ByStatus,
    ByAge,
    Security,
    Performance,
    Custom,
}

// ── FiltersConfig ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiltersConfig {
    pub max_filters: usize,
    pub max_smart_groups: usize,
    pub auto_refresh_interval_ms: u64,
    pub cache_results: bool,
    pub cache_ttl_seconds: u64,
}

impl Default for FiltersConfig {
    fn default() -> Self {
        Self {
            max_filters: 200,
            max_smart_groups: 100,
            auto_refresh_interval_ms: 30_000,
            cache_results: true,
            cache_ttl_seconds: 60,
        }
    }
}

// ── FilterStats ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterStats {
    pub total_filters: usize,
    pub total_smart_groups: usize,
    pub total_evaluations: u64,
    pub avg_evaluation_ms: f64,
    pub cache_hit_rate: f64,
}

impl fmt::Display for FilterStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "filters={}, groups={}, evals={}, avg_ms={:.2}, cache_hit={:.1}%",
            self.total_filters,
            self.total_smart_groups,
            self.total_evaluations,
            self.avg_evaluation_ms,
            self.cache_hit_rate * 100.0,
        )
    }
}
