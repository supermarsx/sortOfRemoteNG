use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── Shell & OS context ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ShellType {
    #[default]
    Bash,
    Zsh,
    Fish,
    PowerShell,
    Cmd,
    Sh,
    Ash,
    Dash,
    Csh,
    Tcsh,
    Ksh,
    Nushell,
    Unknown,
}

impl ShellType {
    pub fn display_name(&self) -> &str {
        match self {
            Self::Bash => "Bash",
            Self::Zsh => "Zsh",
            Self::Fish => "Fish",
            Self::PowerShell => "PowerShell",
            Self::Cmd => "CMD",
            Self::Sh => "sh",
            Self::Ash => "ash",
            Self::Dash => "dash",
            Self::Csh => "csh",
            Self::Tcsh => "tcsh",
            Self::Ksh => "ksh",
            Self::Nushell => "Nushell",
            Self::Unknown => "Unknown",
        }
    }

    pub fn from_path(path: &str) -> Self {
        let lower = path.to_lowercase();
        if lower.contains("bash") {
            Self::Bash
        } else if lower.contains("zsh") {
            Self::Zsh
        } else if lower.contains("fish") {
            Self::Fish
        } else if lower.contains("pwsh") || lower.contains("powershell") {
            Self::PowerShell
        } else if lower.contains("cmd") {
            Self::Cmd
        } else if lower.contains("ash") {
            Self::Ash
        } else if lower.contains("dash") {
            Self::Dash
        } else if lower.contains("csh") {
            Self::Csh
        } else if lower.contains("tcsh") {
            Self::Tcsh
        } else if lower.contains("ksh") {
            Self::Ksh
        } else if lower.contains("nu") {
            Self::Nushell
        } else if lower.ends_with("/sh") || lower == "sh" {
            Self::Sh
        } else {
            Self::Unknown
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum OsType {
    #[default]
    Linux,
    MacOs,
    Windows,
    FreeBsd,
    OpenBsd,
    NetBsd,
    Solaris,
    Aix,
    Unknown,
}

impl OsType {
    pub fn display_name(&self) -> &str {
        match self {
            Self::Linux => "Linux",
            Self::MacOs => "macOS",
            Self::Windows => "Windows",
            Self::FreeBsd => "FreeBSD",
            Self::OpenBsd => "OpenBSD",
            Self::NetBsd => "NetBSD",
            Self::Solaris => "Solaris",
            Self::Aix => "AIX",
            Self::Unknown => "Unknown",
        }
    }
}

// ─── Suggestion types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionKind {
    Command,
    Flag,
    Argument,
    Path,
    Variable,
    Pipe,
    Redirect,
    Alias,
    Function,
    Snippet,
    HistoryRecall,
    NaturalLanguage,
    Fix,
    Refactor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suggestion {
    pub text: String,
    pub display: String,
    pub kind: SuggestionKind,
    pub description: Option<String>,
    pub confidence: f64,
    pub source: SuggestionSource,
    pub insert_text: Option<String>,
    pub documentation: Option<String>,
    pub risk_level: RiskLevel,
    pub tags: Vec<String>,
}

impl Suggestion {
    pub fn command(text: &str, description: &str, confidence: f64) -> Self {
        Self {
            text: text.to_string(),
            display: text.to_string(),
            kind: SuggestionKind::Command,
            description: Some(description.to_string()),
            confidence,
            source: SuggestionSource::Ai,
            insert_text: None,
            documentation: None,
            risk_level: RiskLevel::Safe,
            tags: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionSource {
    Ai,
    History,
    Builtin,
    ManPage,
    Snippet,
    Fuzzy,
    Combined,
}

// ─── Completions ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub session_id: String,
    pub input: String,
    pub cursor_position: usize,
    pub cwd: Option<String>,
    pub shell: ShellType,
    pub os: OsType,
    pub env_vars: Vec<(String, String)>,
    pub recent_commands: Vec<String>,
    pub recent_output: Option<String>,
    pub max_suggestions: usize,
}

impl Default for CompletionRequest {
    fn default() -> Self {
        Self {
            session_id: String::new(),
            input: String::new(),
            cursor_position: 0,
            cwd: None,
            shell: ShellType::default(),
            os: OsType::default(),
            env_vars: Vec::new(),
            recent_commands: Vec::new(),
            recent_output: None,
            max_suggestions: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub suggestions: Vec<Suggestion>,
    pub context_used: Vec<String>,
    pub processing_time_ms: u64,
    pub from_cache: bool,
}

// ─── Error explanations ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorExplanation {
    pub original_error: String,
    pub summary: String,
    pub detailed_explanation: String,
    pub probable_causes: Vec<String>,
    pub suggested_fixes: Vec<SuggestedFix>,
    pub related_commands: Vec<String>,
    pub documentation_links: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedFix {
    pub description: String,
    pub command: Option<String>,
    pub risk_level: RiskLevel,
    pub auto_applicable: bool,
    pub steps: Vec<String>,
}

// ─── Man page / help ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManPageInfo {
    pub command: String,
    pub synopsis: String,
    pub description: String,
    pub common_flags: Vec<FlagInfo>,
    pub examples: Vec<CommandExample>,
    pub see_also: Vec<String>,
    pub source: ManPageSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlagInfo {
    pub flag: String,
    pub long_flag: Option<String>,
    pub description: String,
    pub takes_value: bool,
    pub required: bool,
    pub common: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandExample {
    pub description: String,
    pub command: String,
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ManPageSource {
    Builtin,
    AiGenerated,
    Cached,
    TldrPages,
}

// ─── Risk assessment ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum RiskLevel {
    #[default]
    Safe,
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    pub fn numeric(&self) -> u8 {
        match self {
            Self::Safe => 0,
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
            Self::Critical => 4,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::Safe => "Safe",
            Self::Low => "Low Risk",
            Self::Medium => "Medium Risk",
            Self::High => "High Risk",
            Self::Critical => "Critical / Destructive",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub command: String,
    pub risk_level: RiskLevel,
    pub reasons: Vec<String>,
    pub affected_scope: AffectedScope,
    pub reversible: bool,
    pub confirmation_required: bool,
    pub safer_alternatives: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AffectedScope {
    #[default]
    None,
    CurrentDirectory,
    UserHome,
    System,
    Network,
    MultiHost,
    Unknown,
}

// ─── Snippets / templates ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSnippet {
    pub id: String,
    pub name: String,
    pub description: String,
    pub template: String,
    pub parameters: Vec<SnippetParameter>,
    pub category: SnippetCategory,
    pub tags: Vec<String>,
    pub shell_compatibility: Vec<ShellType>,
    pub os_compatibility: Vec<OsType>,
    pub risk_level: RiskLevel,
    pub created_at: DateTime<Utc>,
    pub usage_count: u64,
    pub is_builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetParameter {
    pub name: String,
    pub description: String,
    pub default_value: Option<String>,
    pub required: bool,
    pub placeholder: String,
    pub validation_regex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SnippetCategory {
    FileOperations,
    Networking,
    SystemAdmin,
    Docker,
    Kubernetes,
    Git,
    Database,
    TextProcessing,
    Monitoring,
    Security,
    Compression,
    UserManagement,
    PackageManagement,
    Custom,
}

// ─── Natural language ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaturalLanguageQuery {
    pub query: String,
    pub shell: ShellType,
    pub os: OsType,
    pub cwd: Option<String>,
    pub constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaturalLanguageResult {
    pub query: String,
    pub commands: Vec<GeneratedCommand>,
    pub explanation: String,
    pub confidence: f64,
    pub alternatives: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedCommand {
    pub command: String,
    pub explanation: String,
    pub risk_level: RiskLevel,
    pub shell_specific: bool,
}

// ─── History analysis ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub command: String,
    pub timestamp: DateTime<Utc>,
    pub cwd: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryPattern {
    pub pattern: String,
    pub frequency: u64,
    pub last_used: DateTime<Utc>,
    pub typical_sequence: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryAnalysis {
    pub total_commands: usize,
    pub unique_commands: usize,
    pub top_commands: Vec<(String, u64)>,
    pub patterns: Vec<HistoryPattern>,
    pub common_sequences: Vec<Vec<String>>,
    pub time_distribution: Vec<(String, u64)>,
    pub error_rate: f64,
}

// ─── Session context ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionContext {
    pub session_id: String,
    pub host: String,
    pub username: String,
    pub shell: ShellType,
    pub os: OsType,
    pub cwd: String,
    pub env_vars: Vec<(String, String)>,
    pub history: Vec<HistoryEntry>,
    pub last_output: Option<String>,
    pub last_exit_code: Option<i32>,
    pub connection_started: DateTime<Utc>,
    pub sudo_available: bool,
    pub installed_tools: Vec<String>,
}

impl SessionContext {
    pub fn new(session_id: &str, host: &str, username: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            host: host.to_string(),
            username: username.to_string(),
            shell: ShellType::default(),
            os: OsType::default(),
            cwd: String::from("~"),
            env_vars: Vec::new(),
            history: Vec::new(),
            last_output: None,
            last_exit_code: None,
            connection_started: Utc::now(),
            sudo_available: false,
            installed_tools: Vec::new(),
        }
    }

    pub fn recent_commands(&self, n: usize) -> Vec<String> {
        self.history
            .iter()
            .rev()
            .take(n)
            .map(|h| h.command.clone())
            .collect()
    }

    pub fn add_command(&mut self, cmd: &str, exit_code: Option<i32>, duration_ms: Option<u64>) {
        self.history.push(HistoryEntry {
            command: cmd.to_string(),
            timestamp: Utc::now(),
            cwd: Some(self.cwd.clone()),
            exit_code,
            duration_ms,
            session_id: self.session_id.clone(),
        });
    }
}

// ─── AI assist config ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAssistConfig {
    pub enabled: bool,
    pub llm_provider: Option<String>,
    pub llm_model: Option<String>,
    pub max_suggestions: usize,
    pub min_confidence: f64,
    pub auto_complete: bool,
    pub risk_warnings: bool,
    pub max_risk_level: RiskLevel,
    pub history_context_size: usize,
    pub cache_ttl_seconds: u64,
    pub snippet_directories: Vec<String>,
    pub custom_aliases: Vec<(String, String)>,
    pub disabled_features: Vec<String>,
}

impl Default for AiAssistConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            llm_provider: None,
            llm_model: None,
            max_suggestions: 10,
            min_confidence: 0.3,
            auto_complete: true,
            risk_warnings: true,
            max_risk_level: RiskLevel::High,
            history_context_size: 50,
            cache_ttl_seconds: 3600,
            snippet_directories: Vec::new(),
            custom_aliases: Vec::new(),
            disabled_features: Vec::new(),
        }
    }
}
