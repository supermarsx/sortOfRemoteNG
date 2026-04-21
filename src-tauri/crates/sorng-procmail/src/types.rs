//! Shared types for Procmail management.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailConnectionConfig {
    /// SSH host to connect to.
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to procmail binary (default: /usr/bin/procmail).
    pub procmail_bin: Option<String>,
    /// Path to global procmailrc (default: /etc/procmailrc).
    pub procmailrc_path: Option<String>,
    /// Path to procmail log file (default: /var/log/procmail.log).
    pub log_path: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub recipe_count: usize,
    pub log_path: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recipes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailRecipe {
    pub id: String,
    /// Condition lines (each starting with `*`).
    pub condition_lines: Vec<String>,
    /// Action line (delivery target / pipe / forward).
    pub action: String,
    /// Recipe flags (e.g. `HBDfhbcwWieaA`).
    pub flags: String,
    /// Optional lockfile path.
    pub lockfile: Option<String>,
    /// Optional human-readable comment.
    pub comment: Option<String>,
    pub enabled: bool,
    /// Position in the procmailrc file (0-based).
    pub position: usize,
    /// Raw text of this recipe block.
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecipeRequest {
    pub condition_lines: Vec<String>,
    pub action: String,
    pub flags: Option<String>,
    pub lockfile: Option<String>,
    pub comment: Option<String>,
    pub enabled: Option<bool>,
    pub position: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRecipeRequest {
    pub condition_lines: Option<Vec<String>>,
    pub action: Option<String>,
    pub flags: Option<String>,
    pub lockfile: Option<String>,
    pub comment: Option<String>,
    pub enabled: Option<bool>,
    pub position: Option<usize>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rules (named groups of recipes)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailRule {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub recipes: Vec<ProcmailRecipe>,
    pub enabled: bool,
    pub priority: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRuleRequest {
    pub name: String,
    pub description: Option<String>,
    pub recipes: Vec<CreateRecipeRequest>,
    pub enabled: Option<bool>,
    pub priority: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRuleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub recipes: Option<Vec<CreateRecipeRequest>>,
    pub enabled: Option<bool>,
    pub priority: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Variables
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailVariable {
    pub name: String,
    pub value: String,
    pub comment: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Includes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailInclude {
    pub path: String,
    pub comment: Option<String>,
    pub enabled: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailLogEntry {
    pub timestamp: Option<String>,
    pub from_address: Option<String>,
    pub to_folder: Option<String>,
    pub subject: Option<String>,
    pub size_bytes: Option<u64>,
    pub procmail_flags: Option<String>,
    pub result: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailConfig {
    pub recipes: Vec<ProcmailRecipe>,
    pub variables: Vec<ProcmailVariable>,
    pub includes: Vec<ProcmailInclude>,
    pub raw_content: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delivery / Testing
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryTargetType {
    Maildir,
    Mbox,
    Pipe,
    Forward,
    DevNull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryTarget {
    pub target_type: DeliveryTargetType,
    pub path_or_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipeTestResult {
    pub matched: bool,
    pub matching_recipe_id: Option<String>,
    pub delivery_target: Option<DeliveryTarget>,
    pub log_output: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcmailInfo {
    pub version: String,
    pub default_rc: Option<String>,
    pub maildir: Option<String>,
    pub logfile: Option<String>,
}
