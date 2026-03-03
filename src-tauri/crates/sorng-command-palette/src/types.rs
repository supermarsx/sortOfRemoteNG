use std::collections::HashMap;
use chrono::{DateTime, Utc};

// ═══════════════════════════════════════════════════════════════════════
//  OS / platform classification
// ═══════════════════════════════════════════════════════════════════════

/// High-level operating-system family.
///
/// Use this when a command applies broadly to an OS family regardless of
/// distribution (e.g. any Linux distro, any BSD, any Windows version).
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OsFamily {
    /// Any Linux distribution.
    Linux,
    /// Any Windows version (desktop, server, core).
    Windows,
    /// macOS / Darwin.
    MacOs,
    /// FreeBSD, OpenBSD, NetBSD, etc.
    Bsd,
    /// Generic Unix (Solaris, AIX, HP-UX, …).
    Unix,
}

/// Specific Linux distribution or Windows edition.
///
/// Many commands only work on a particular distro (e.g. `apt` on
/// Debian-family, `zypper` on openSUSE, `dnf` on Fedora/RHEL).
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OsDistro {
    // ── Debian family ────────────────────
    Debian,
    Ubuntu,
    LinuxMint,
    Pop,       // Pop!_OS
    Kali,
    Raspbian,

    // ── Red Hat family ───────────────────
    Rhel,      // Red Hat Enterprise Linux
    CentOs,
    Fedora,
    Rocky,
    Alma,
    Oracle,    // Oracle Linux
    Amazon,    // Amazon Linux

    // ── SUSE family ─────────────────────
    OpenSuse,
    Sles,      // SUSE Linux Enterprise Server

    // ── Arch family ─────────────────────
    Arch,
    Manjaro,
    EndeavourOs,

    // ── Gentoo family ───────────────────
    Gentoo,

    // ── Alpine / musl ───────────────────
    Alpine,

    // ── Other Linux ─────────────────────
    Void,
    NixOs,
    Slackware,
    ClearLinux,

    // ── Windows editions ────────────────
    WindowsDesktop,
    WindowsServer,
    WindowsCore,

    // ── macOS ───────────────────────────
    MacOsDesktop,

    // ── BSD ─────────────────────────────
    FreeBsd,
    OpenBsd,
    NetBsd,

    // ── Catch-all ───────────────────────
    /// Arbitrary distro name not in the enum (use the string value).
    Other(String),
}

/// Describes which OS environments a command / snippet / alias is valid for.
///
/// An *empty* `OsTarget` (no families, no distros, no version constraints)
/// means **universal** — the item works everywhere.
///
/// ## Matching rules
/// 1. If `families` is non-empty the session's OS family must be in the set.
/// 2. If `distros` is non-empty the session's distro must be in the set.
/// 3. If `min_version` / `max_version` are set they are compared lexically
///    against the session's reported version string.
/// 4. If `excluded_families` or `excluded_distros` are non-empty the session
///    must NOT match any of those.
/// 5. `shell_required` optionally restricts to a shell (e.g. "bash", "zsh",
///    "powershell", "fish").
/// 6. `custom_tags` are free-form strings for toolchain requirements
///    (e.g. "systemd", "apt", "snap", "wsl").
///
/// All specified constraints are AND-ed together.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OsTarget {
    /// Accepted OS families (empty = any family).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub families: Vec<OsFamily>,

    /// Accepted specific distros (empty = any distro within accepted families).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub distros: Vec<OsDistro>,

    /// Minimum OS / distro version (lexical compare, e.g. "22.04", "10.0").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,

    /// Maximum OS / distro version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_version: Option<String>,

    /// OS families explicitly excluded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded_families: Vec<OsFamily>,

    /// Distros explicitly excluded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded_distros: Vec<OsDistro>,

    /// Required shell (if any).  E.g. "bash", "zsh", "powershell", "fish".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell_required: Option<String>,

    /// Free-form requirement tags (e.g. "systemd", "apt", "snap", "wsl").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_tags: Vec<String>,
}

/// The OS context of the target host as detected or configured.
///
/// Passed inside `PaletteSessionContext` so the palette can pre-filter
/// items that are incompatible with the session's host.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OsContext {
    /// Detected or configured OS family.
    #[serde(default)]
    pub family: Option<OsFamily>,
    /// Detected or configured distro.
    #[serde(default)]
    pub distro: Option<OsDistro>,
    /// OS / distro version string (e.g. "22.04", "11", "2022").
    #[serde(default)]
    pub version: Option<String>,
    /// Detected shell name (e.g. "bash", "zsh", "powershell").
    #[serde(default)]
    pub shell: Option<String>,
    /// Capability tags detected on the host (e.g. "systemd", "apt", "snap").
    #[serde(default)]
    pub capabilities: Vec<String>,
}

impl OsTarget {
    /// An empty target — matches every host (universal).
    pub fn universal() -> Self {
        Self::default()
    }

    /// Returns `true` if this target has no constraints at all (universal).
    pub fn is_universal(&self) -> bool {
        self.families.is_empty()
            && self.distros.is_empty()
            && self.excluded_families.is_empty()
            && self.excluded_distros.is_empty()
            && self.min_version.is_none()
            && self.max_version.is_none()
            && self.shell_required.is_none()
            && self.custom_tags.is_empty()
    }

    /// Convenience: target a single OS family.
    pub fn family(family: OsFamily) -> Self {
        Self { families: vec![family], ..Default::default() }
    }

    /// Convenience: target one or more distros.
    pub fn distros(distros: Vec<OsDistro>) -> Self {
        Self { distros, ..Default::default() }
    }

    /// Returns true when the given `OsContext` satisfies all constraints.
    pub fn matches(&self, ctx: &OsContext) -> bool {
        // 1. Family whitelist.
        if !self.families.is_empty() {
            match &ctx.family {
                Some(f) if self.families.contains(f) => {}
                _ => return false,
            }
        }
        // 2. Distro whitelist.
        if !self.distros.is_empty() {
            match &ctx.distro {
                Some(d) if self.distros.contains(d) => {}
                _ => return false,
            }
        }
        // 3. Family blacklist.
        if let Some(f) = &ctx.family {
            if self.excluded_families.contains(f) { return false; }
        }
        // 4. Distro blacklist.
        if let Some(d) = &ctx.distro {
            if self.excluded_distros.contains(d) { return false; }
        }
        // 5. Version range (lexical comparison).
        if let Some(ref v) = ctx.version {
            if let Some(ref min) = self.min_version {
                if v.as_str() < min.as_str() { return false; }
            }
            if let Some(ref max) = self.max_version {
                if v.as_str() > max.as_str() { return false; }
            }
        }
        // 6. Shell requirement.
        if let Some(ref required_shell) = self.shell_required {
            match &ctx.shell {
                Some(s) if s.eq_ignore_ascii_case(required_shell) => {}
                _ => return false,
            }
        }
        // 7. Custom capability tags — every required tag must be present.
        if !self.custom_tags.is_empty() {
            for tag in &self.custom_tags {
                if !ctx.capabilities.iter().any(|c| c.eq_ignore_ascii_case(tag)) {
                    return false;
                }
            }
        }
        true
    }
}

impl OsDistro {
    /// Return the `OsFamily` this distro belongs to.
    pub fn family(&self) -> OsFamily {
        match self {
            Self::Debian | Self::Ubuntu | Self::LinuxMint | Self::Pop
            | Self::Kali | Self::Raspbian
            | Self::Rhel | Self::CentOs | Self::Fedora | Self::Rocky
            | Self::Alma | Self::Oracle | Self::Amazon
            | Self::OpenSuse | Self::Sles
            | Self::Arch | Self::Manjaro | Self::EndeavourOs
            | Self::Gentoo | Self::Alpine
            | Self::Void | Self::NixOs | Self::Slackware | Self::ClearLinux => OsFamily::Linux,

            Self::WindowsDesktop | Self::WindowsServer | Self::WindowsCore => OsFamily::Windows,

            Self::MacOsDesktop => OsFamily::MacOs,

            Self::FreeBsd | Self::OpenBsd | Self::NetBsd => OsFamily::Bsd,

            Self::Other(_) => OsFamily::Linux, // best guess
        }
    }

    /// True if this distro uses `apt` / `dpkg`.
    pub fn is_apt_based(&self) -> bool {
        matches!(self, Self::Debian | Self::Ubuntu | Self::LinuxMint
            | Self::Pop | Self::Kali | Self::Raspbian)
    }

    /// True if this distro uses `dnf` or `yum`.
    pub fn is_rpm_based(&self) -> bool {
        matches!(self, Self::Rhel | Self::CentOs | Self::Fedora
            | Self::Rocky | Self::Alma | Self::Oracle | Self::Amazon)
    }

    /// True if this distro uses `zypper`.
    pub fn is_zypper_based(&self) -> bool {
        matches!(self, Self::OpenSuse | Self::Sles)
    }

    /// True if this distro uses `pacman`.
    pub fn is_pacman_based(&self) -> bool {
        matches!(self, Self::Arch | Self::Manjaro | Self::EndeavourOs)
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Palette item categories & kinds
// ═══════════════════════════════════════════════════════════════════════

/// Top-level palette item category — used for grouping in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum PaletteCategory {
    /// Recently-used commands / actions (MRU section).
    Recent,
    /// User-defined or built-in command snippets.
    Snippet,
    /// Shell history entries from past sessions.
    History,
    /// AI-generated command suggestions.
    AiSuggestion,
    /// Natural-language → command translations.
    NaturalLanguage,
    /// Predefined quick-connect or action shortcuts.
    QuickAction,
    /// Alias / abbreviation expansions.
    Alias,
    /// Contextual completions for the current input.
    Completion,
}

/// More granular kind for individual items.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PaletteItemKind {
    ShellCommand,
    Snippet,
    AiCompletion,
    HistoryRecall,
    NlTranslation,
    Alias,
    QuickAction,
    BuiltinAction,
    FileTransfer,
    PortForward,
    TunnelSetup,
    ScriptExecution,
}

/// Source that contributed an item.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PaletteSource {
    Local,
    History,
    Snippet,
    Ai,
    Builtin,
    Fuzzy,
    Combined,
}

/// Risk level for a palette item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
pub enum PaletteRiskLevel {
    Safe,
    Low,
    Medium,
    High,
    Critical,
}

impl Default for PaletteRiskLevel {
    fn default() -> Self { Self::Safe }
}

// ═══════════════════════════════════════════════════════════════════════
//  Palette items
// ═══════════════════════════════════════════════════════════════════════

/// A single item in the command palette result list.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PaletteItem {
    /// Unique identifier (deterministic hash for history/snippets, UUID for AI).
    pub id: String,
    /// Primary display text shown in the palette.
    pub label: String,
    /// Secondary description / subtitle.
    #[serde(default)]
    pub description: Option<String>,
    /// The actual text to insert into the terminal (may differ from label).
    pub insert_text: String,
    /// Category for grouping.
    pub category: PaletteCategory,
    /// Granular kind.
    pub kind: PaletteItemKind,
    /// Where this item came from.
    pub source: PaletteSource,
    /// Relevance score (0.0 – 1.0): used for sorting.
    pub score: f64,
    /// Risk assessment (if known/applicable).
    #[serde(default)]
    pub risk_level: PaletteRiskLevel,
    /// Tags / keywords for search.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Optional documentation / explanation.
    #[serde(default)]
    pub documentation: Option<String>,
    /// Icon hint for the UI (e.g. "terminal", "snippet", "ai", "history").
    #[serde(default)]
    pub icon: Option<String>,
    /// Keyboard shortcut (if any).
    #[serde(default)]
    pub shortcut: Option<String>,
    /// Whether this is pinned / favourited.
    #[serde(default)]
    pub pinned: bool,
    /// OS / platform classification — which hosts this item applies to.
    /// An empty (default) target means universal (works everywhere).
    #[serde(default)]
    pub os_target: OsTarget,
}

// ═══════════════════════════════════════════════════════════════════════
//  Command history
// ═══════════════════════════════════════════════════════════════════════

/// A persisted history entry with frecency metadata.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HistoryEntry {
    /// The raw command string.
    pub command: String,
    /// Which session produced this entry.
    pub session_id: String,
    /// Host the command was run against.
    #[serde(default)]
    pub host: Option<String>,
    /// Username used.
    #[serde(default)]
    pub username: Option<String>,
    /// Working directory when the command was run.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Exit code of the command, if known.
    #[serde(default)]
    pub exit_code: Option<i32>,
    /// Duration of the command in milliseconds.
    #[serde(default)]
    pub duration_ms: Option<u64>,
    /// First time this command was recorded.
    pub first_used: DateTime<Utc>,
    /// Last time this command was used.
    pub last_used: DateTime<Utc>,
    /// Total number of times this command was run.
    pub use_count: u64,
    /// Tags applied by user or auto-detection.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Whether the user marked this as a favourite.
    #[serde(default)]
    pub pinned: bool,
    /// OS / platform the command was run on (for classification recall).
    #[serde(default)]
    pub os_context: Option<OsContext>,
}

/// Frecency score parameters — configurable.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FrecencyConfig {
    /// Weight for recency (0.0 – 1.0).
    #[serde(default = "default_recency_weight")]
    pub recency_weight: f64,
    /// Weight for frequency (0.0 – 1.0).
    #[serde(default = "default_frequency_weight")]
    pub frequency_weight: f64,
    /// Half-life in hours — how quickly recency decays.
    #[serde(default = "default_half_life_hours")]
    pub half_life_hours: f64,
    /// Maximum history entries to persist.
    #[serde(default = "default_max_entries")]
    pub max_entries: usize,
}

fn default_recency_weight() -> f64 { 0.6 }
fn default_frequency_weight() -> f64 { 0.4 }
fn default_half_life_hours() -> f64 { 72.0 }
fn default_max_entries() -> usize { 10_000 }

impl Default for FrecencyConfig {
    fn default() -> Self {
        Self {
            recency_weight: default_recency_weight(),
            frequency_weight: default_frequency_weight(),
            half_life_hours: default_half_life_hours(),
            max_entries: default_max_entries(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Snippets
// ═══════════════════════════════════════════════════════════════════════

/// Full snippet category (superset of sorng-ai-assist's SnippetCategory).
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
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
    Ssh,
    PortForwarding,
    Tunnels,
    FileTransfer,
    Scripting,
    Custom,
}

impl Default for SnippetCategory {
    fn default() -> Self { Self::Custom }
}

/// A command snippet with full template support.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Snippet {
    /// Unique ID (UUID or user-defined slug).
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Longer description of what the snippet does.
    #[serde(default)]
    pub description: String,
    /// Template string with `{{param}}` placeholders.
    pub template: String,
    /// Declared parameters.
    #[serde(default)]
    pub parameters: Vec<SnippetParameter>,
    /// Category for grouping.
    #[serde(default)]
    pub category: SnippetCategory,
    /// Trigger / prefix that auto-expands (e.g., "!port" → snippet expansion).
    #[serde(default)]
    pub trigger: Option<String>,
    /// Free-form tags for search.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Risk level of the command.
    #[serde(default)]
    pub risk_level: PaletteRiskLevel,
    /// Whether this snippet ships with the app.
    #[serde(default)]
    pub is_builtin: bool,
    /// Creation / modification timestamps.
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub updated_at: Option<DateTime<Utc>>,
    /// Usage count (for frecency).
    #[serde(default)]
    pub use_count: u64,
    /// Last time the snippet was used.
    #[serde(default)]
    pub last_used: Option<DateTime<Utc>>,
    /// OS / platform classification — which hosts this snippet works on.
    /// An empty (default) target means universal.
    #[serde(default)]
    pub os_target: OsTarget,
}

/// A single parameter in a snippet template.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SnippetParameter {
    /// Name (matches `{{name}}` in the template).
    pub name: String,
    /// Human label / prompt shown in the UI.
    #[serde(default)]
    pub label: Option<String>,
    /// Description / help text.
    #[serde(default)]
    pub description: Option<String>,
    /// Default value.
    #[serde(default)]
    pub default_value: Option<String>,
    /// Whether this parameter must be filled.
    #[serde(default)]
    pub required: bool,
    /// Placeholder text shown in the input field.
    #[serde(default)]
    pub placeholder: Option<String>,
    /// Optional regex for validation.
    #[serde(default)]
    pub validation_regex: Option<String>,
    /// Fixed set of allowed values (dropdown in UI).
    #[serde(default)]
    pub choices: Vec<String>,
}

/// Result of rendering a snippet with parameters.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SnippetRenderResult {
    /// The rendered command string.
    pub command: String,
    /// Which parameters were substituted.
    pub substituted_params: Vec<String>,
    /// Any parameters that had no value and fell back to default.
    pub defaulted_params: Vec<String>,
    /// Any parameters that were missing entirely.
    pub missing_params: Vec<String>,
}

/// Import/export format for snippet collections.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SnippetCollection {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub snippets: Vec<Snippet>,
    pub exported_at: DateTime<Utc>,
    #[serde(default)]
    pub version: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Aliases
// ═══════════════════════════════════════════════════════════════════════

/// A user-defined alias / abbreviation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Alias {
    /// Short trigger text (e.g. "ll").
    pub trigger: String,
    /// Full expansion (e.g. "ls -la").
    pub expansion: String,
    /// Optional description.
    #[serde(default)]
    pub description: Option<String>,
    /// Whether the alias is active.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Use count.
    #[serde(default)]
    pub use_count: u64,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// OS / platform classification — which hosts this alias works on.
    /// An empty (default) target means universal.
    #[serde(default)]
    pub os_target: OsTarget,
}

fn default_true() -> bool { true }

// ═══════════════════════════════════════════════════════════════════════
//  Session context
// ═══════════════════════════════════════════════════════════════════════

/// Lightweight session context passed with palette queries so we can
/// scope/rank results appropriately.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct PaletteSessionContext {
    /// Active SSH session ID (if any).
    #[serde(default)]
    pub session_id: Option<String>,
    /// Remote host.
    #[serde(default)]
    pub host: Option<String>,
    /// Remote username.
    #[serde(default)]
    pub username: Option<String>,
    /// Current working directory on the remote.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Detected shell type (kept for backward compat; duplicated in os_context).
    #[serde(default)]
    pub shell: Option<String>,
    /// Detected OS as a free-form string (kept for backward compat).
    #[serde(default)]
    pub os: Option<String>,
    /// Structured OS context used for OS-aware pre-filtering.
    #[serde(default)]
    pub os_context: Option<OsContext>,
    /// Recent commands in this session (last N).
    #[serde(default)]
    pub recent_commands: Vec<String>,
    /// Most recent terminal output (for contextual completions).
    #[serde(default)]
    pub recent_output: Option<String>,
    /// Tools known to be installed.
    #[serde(default)]
    pub installed_tools: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Search / query
// ═══════════════════════════════════════════════════════════════════════

/// Query sent by the frontend to the palette.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PaletteQuery {
    /// The text the user has typed in the palette input.
    pub input: String,
    /// Optional session context for scoping.
    #[serde(default)]
    pub context: PaletteSessionContext,
    /// Maximum items to return.
    #[serde(default = "default_max_results")]
    pub max_results: usize,
    /// Optional category filter.
    #[serde(default)]
    pub category_filter: Option<PaletteCategory>,
    /// Whether to include AI-generated suggestions.
    #[serde(default = "default_true")]
    pub include_ai: bool,
    /// Whether to include snippets.
    #[serde(default = "default_true")]
    pub include_snippets: bool,
    /// Whether to include history.
    #[serde(default = "default_true")]
    pub include_history: bool,
    /// Cursor position within the input (for mid-line completions).
    #[serde(default)]
    pub cursor_position: Option<usize>,
    /// When `true`, items whose `os_target` does not match the session's
    /// `os_context` are excluded from results.  Defaults to `true` so the
    /// palette automatically hides irrelevant OS-specific commands.
    #[serde(default = "default_true")]
    pub filter_by_os: bool,
    /// Explicit OS context override for filtering (takes precedence over
    /// `context.os_context`).  Useful for "show me Ubuntu commands"
    /// regardless of the current session.
    #[serde(default)]
    pub os_filter: Option<OsContext>,
}

fn default_max_results() -> usize { 25 }

/// Response returned from unifiedsearch.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PaletteResponse {
    /// Matched items sorted by score descending.
    pub items: Vec<PaletteItem>,
    /// Number of items before truncation.
    pub total_matches: usize,
    /// Processing time in milliseconds.
    pub processing_time_ms: u64,
    /// Whether AI suggestions were included.
    pub ai_used: bool,
    /// Contextual hints (e.g. "showing results for host X").
    #[serde(default)]
    pub hints: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════

/// Service-level configuration.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PaletteConfig {
    /// Master switch.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Frecency scoring config.
    #[serde(default)]
    pub frecency: FrecencyConfig,
    /// Maximum palette results to return.
    #[serde(default = "default_max_results")]
    pub max_results: usize,
    /// Minimum fuzzy-match score (0.0 – 1.0) to include a result.
    #[serde(default = "default_min_score")]
    pub min_score: f64,
    /// Whether to use the LLM for AI suggestions.
    #[serde(default = "default_true")]
    pub ai_enabled: bool,
    /// Maximum time in ms to wait for AI results before returning local-only.
    #[serde(default = "default_ai_timeout_ms")]
    pub ai_timeout_ms: u64,
    /// Whether to show risk badges in the palette.
    #[serde(default = "default_true")]
    pub show_risk: bool,
    /// Auto-expand snippet triggers inline.
    #[serde(default = "default_true")]
    pub auto_expand_triggers: bool,
    /// How many of the user's recent commands to consider.
    #[serde(default = "default_recent_context_size")]
    pub recent_context_size: usize,
}

fn default_min_score() -> f64 { 0.1 }
fn default_ai_timeout_ms() -> u64 { 3000 }
fn default_recent_context_size() -> usize { 20 }

impl Default for PaletteConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            frecency: FrecencyConfig::default(),
            max_results: default_max_results(),
            min_score: default_min_score(),
            ai_enabled: true,
            ai_timeout_ms: default_ai_timeout_ms(),
            show_risk: true,
            auto_expand_triggers: true,
            recent_context_size: default_recent_context_size(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Persistence envelope
// ═══════════════════════════════════════════════════════════════════════

/// Root structure serialised to disk.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PersistentData {
    pub history: Vec<HistoryEntry>,
    pub snippets: Vec<Snippet>,
    pub aliases: Vec<Alias>,
    pub pinned_commands: Vec<String>,
    pub config: PaletteConfig,
    pub saved_at: DateTime<Utc>,
    #[serde(default)]
    pub version: u32,
}

impl Default for PersistentData {
    fn default() -> Self {
        Self {
            history: Vec::new(),
            snippets: Vec::new(),
            aliases: Vec::new(),
            pinned_commands: Vec::new(),
            config: PaletteConfig::default(),
            saved_at: Utc::now(),
            version: 1,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  AI prompt context
// ═══════════════════════════════════════════════════════════════════════

/// Context assembled for LLM calls.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiCompletionContext {
    pub input: String,
    #[serde(default)]
    pub session_context: PaletteSessionContext,
    #[serde(default)]
    pub recent_history: Vec<String>,
    #[serde(default)]
    pub available_snippets: Vec<String>,
    #[serde(default)]
    pub installed_tools: Vec<String>,
}

/// AI-generated suggestion before merging into PaletteItem.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiSuggestion {
    pub command: String,
    pub description: String,
    pub confidence: f64,
    #[serde(default)]
    pub risk: Option<String>,
    #[serde(default)]
    pub explanation: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Stats / analytics
// ═══════════════════════════════════════════════════════════════════════

/// Analytics returned by the stats command.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PaletteStats {
    pub total_history_entries: usize,
    pub unique_commands: usize,
    pub total_snippets: usize,
    pub builtin_snippets: usize,
    pub custom_snippets: usize,
    pub total_aliases: usize,
    pub top_commands: Vec<(String, u64)>,
    pub top_snippets: Vec<(String, u64)>,
    pub commands_by_host: HashMap<String, usize>,
    pub most_active_sessions: Vec<(String, usize)>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Import / Export types
// ═══════════════════════════════════════════════════════════════════════

/// Supported export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    /// Full-fidelity JSON (default, round-trips perfectly).
    Json,
    /// Shell script (executable history / snippets).
    ShellScript,
    /// CSV spreadsheet (history only).
    Csv,
    /// Human-readable Markdown documentation.
    Markdown,
    /// Base64-encoded JSON for clipboard sharing.
    Base64,
}

/// Which data sets to include in an export.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExportScope {
    /// Include command history.
    #[serde(default = "bool_true")]
    pub history: bool,
    /// Include snippets.
    #[serde(default = "bool_true")]
    pub snippets: bool,
    /// Include aliases.
    #[serde(default = "bool_true")]
    pub aliases: bool,
    /// Include pinned commands.
    #[serde(default = "bool_true")]
    pub pinned_commands: bool,
    /// Include config.
    #[serde(default)]
    pub config: bool,
}

fn bool_true() -> bool { true }

impl Default for ExportScope {
    fn default() -> Self {
        Self {
            history: true,
            snippets: true,
            aliases: true,
            pinned_commands: true,
            config: false,
        }
    }
}

/// Filters applied to narrow down which items are exported.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ExportFilter {
    /// Only include history entries matching these hosts.
    #[serde(default)]
    pub hosts: Vec<String>,
    /// Only include items with at least one of these tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Only include snippets in these categories.
    #[serde(default)]
    pub snippet_categories: Vec<SnippetCategory>,
    /// Only include history entries from after this date.
    #[serde(default)]
    pub date_from: Option<DateTime<Utc>>,
    /// Only include history entries from before this date.
    #[serde(default)]
    pub date_to: Option<DateTime<Utc>>,
    /// Only include commands from these session IDs.
    #[serde(default)]
    pub session_ids: Vec<String>,
    /// Filter by minimum risk level (include this level and above).
    #[serde(default)]
    pub min_risk_level: Option<PaletteRiskLevel>,
    /// Filter by maximum risk level (include this level and below).
    #[serde(default)]
    pub max_risk_level: Option<PaletteRiskLevel>,
    /// Only include history entries that exited with one of these codes.
    #[serde(default)]
    pub exit_codes: Vec<i32>,
    /// Minimum use count.
    #[serde(default)]
    pub min_use_count: Option<u64>,
    /// Only include pinned items.
    #[serde(default)]
    pub pinned_only: bool,
    /// Only include builtin snippets (false = only custom, None = all).
    #[serde(default)]
    pub builtin_snippets: Option<bool>,
    /// Simple text query — items whose command/name/template match are kept.
    #[serde(default)]
    pub text_query: Option<String>,
    /// Only include items compatible with this OS context.
    #[serde(default)]
    pub os_filter: Option<OsContext>,
    /// Only include items targeting one of these OS families.
    #[serde(default)]
    pub os_families: Vec<OsFamily>,
    /// Only include items targeting one of these distros.
    #[serde(default)]
    pub os_distros: Vec<OsDistro>,
    /// When true, only include universal (un-constrained) items.
    #[serde(default)]
    pub universal_only: bool,
}

/// Full export request combining format, scope, and filter.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExportRequest {
    /// Output format.
    pub format: ExportFormat,
    /// What data to include.
    #[serde(default)]
    pub scope: ExportScope,
    /// Filtering criteria.
    #[serde(default)]
    pub filter: ExportFilter,
    /// Optional file path to write to (if None, returns content string).
    #[serde(default)]
    pub output_path: Option<String>,
}

/// Result returned after a successful export.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExportResult {
    /// The serialized content (if no output_path was given).
    pub content: Option<String>,
    /// Path written (if output_path was given).
    pub path: Option<String>,
    /// Format used.
    pub format: ExportFormat,
    /// Counts of exported items.
    pub stats: ExportStats,
}

/// Item counts from an export.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ExportStats {
    pub history_entries: usize,
    pub snippets: usize,
    pub aliases: usize,
    pub pinned_commands: usize,
}

// ────────── Shareable Packages ──────────

/// A shareable package bundles exported data with rich metadata for
/// distribution (teams, marketplaces, repositories).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SharePackage {
    /// Package metadata.
    pub metadata: SharePackageMetadata,
    /// The actual palette data.
    pub data: PersistentData,
    /// SHA-256 hex digest of the JSON-serialised `data` field (integrity check).
    pub checksum: String,
}

/// Metadata for a share package.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SharePackageMetadata {
    /// Package name (human-readable).
    pub name: String,
    /// Longer description.
    #[serde(default)]
    pub description: Option<String>,
    /// Author / team name.
    #[serde(default)]
    pub author: Option<String>,
    /// Semantic version string.
    #[serde(default = "default_share_version")]
    pub version: String,
    /// Free-form tags for categorisation.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Timestamp of creation.
    pub created_at: DateTime<Utc>,
    /// URL to project / repository / documentation.
    #[serde(default)]
    pub homepage: Option<String>,
    /// Minimum app version required to use this package.
    #[serde(default)]
    pub min_app_version: Option<String>,
    /// Package format version for forward-compat.
    #[serde(default = "default_package_format_version")]
    pub format_version: u32,
}

fn default_share_version() -> String { "1.0.0".to_string() }
fn default_package_format_version() -> u32 { 1 }

// ────────── Import / Conflict Resolution ──────────

/// Strategy for resolving conflicts when an imported item already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStrategy {
    /// Skip conflicting items (keep existing).
    Skip,
    /// Overwrite existing with imported data.
    Overwrite,
    /// Rename the imported item (suffix `-imported`).
    Rename,
    /// Merge fields intelligently (e.g. higher use_count wins, tags merged).
    Merge,
    /// Keep the entry with the most-recent timestamp.
    NewestWins,
}

impl Default for ConflictStrategy {
    fn default() -> Self { Self::Skip }
}

/// Options controlling an import operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportOptions {
    /// How to handle conflicting items.
    #[serde(default)]
    pub conflict_strategy: ConflictStrategy,
    /// If true, do not actually mutate data — return a preview only.
    #[serde(default)]
    pub dry_run: bool,
    /// Which data types to import (uses ExportScope).
    #[serde(default)]
    pub scope: ExportScope,
    /// Optional filter applied to incoming data before import.
    #[serde(default)]
    pub filter: ExportFilter,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            conflict_strategy: ConflictStrategy::Skip,
            dry_run: false,
            scope: ExportScope::default(),
            filter: ExportFilter::default(),
        }
    }
}

/// A single detected conflict during import.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportConflict {
    /// The type of data (\"history\", \"snippet\", \"alias\").
    pub data_type: String,
    /// Identifier of the conflicting item.
    pub identifier: String,
    /// Brief description of how the items differ.
    pub description: String,
    /// How the conflict was resolved.
    pub resolution: ConflictStrategy,
}

/// Result of an import (or dry-run preview).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportResult {
    /// Whether this was a dry-run.
    pub dry_run: bool,
    /// Items that were (or would be) added.
    pub added: ImportCounts,
    /// Items that were (or would be) updated / merged.
    pub updated: ImportCounts,
    /// Items that were skipped.
    pub skipped: ImportCounts,
    /// Detected conflicts.
    pub conflicts: Vec<ImportConflict>,
    /// Validation warnings (non-fatal).
    pub warnings: Vec<String>,
    /// Validation errors (fatal — import aborted if any).
    pub errors: Vec<String>,
}

/// Counts per data type.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ImportCounts {
    pub history: usize,
    pub snippets: usize,
    pub aliases: usize,
    pub pinned_commands: usize,
}

/// Validation result returned by the `validate` feature.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    /// Summary counts of what the file contains.
    pub content_summary: ExportStats,
    /// Detected format.
    pub detected_format: Option<ExportFormat>,
    /// Package metadata (if the file is a SharePackage).
    pub package_metadata: Option<SharePackageMetadata>,
    /// Whether the checksum matched (for SharePackages).
    pub checksum_valid: Option<bool>,
}

/// A clipboard payload wraps base64-encoded JSON with a small header so we
/// can detect it on paste.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClipboardPayload {
    /// Magic header to identify SortOfRemoteNG palette data.
    pub magic: String,
    /// Format version.
    pub version: u32,
    /// Base64-encoded JSON of `SharePackage` or `PersistentData`.
    pub data: String,
    /// Optional SHA-256 hex of decoded data.
    #[serde(default)]
    pub checksum: Option<String>,
}

impl ClipboardPayload {
    pub const MAGIC: &'static str = "SORNG_PALETTE_V1";
}

/// History-specific export that produces shell-script-friendly output.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HistoryExportOptions {
    /// Include commands as comments with metadata.
    #[serde(default = "bool_true")]
    pub include_metadata_comments: bool,
    /// Filter by host.
    #[serde(default)]
    pub host: Option<String>,
    /// Filter by session.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Date range start.
    #[serde(default)]
    pub from: Option<DateTime<Utc>>,
    /// Date range end.
    #[serde(default)]
    pub to: Option<DateTime<Utc>>,
    /// Only include successful commands (exit_code == 0).
    #[serde(default)]
    pub successful_only: bool,
    /// Sort order.
    #[serde(default)]
    pub sort_by: HistorySortOrder,
}

impl Default for HistoryExportOptions {
    fn default() -> Self {
        Self {
            include_metadata_comments: true,
            host: None,
            session_id: None,
            from: None,
            to: None,
            successful_only: false,
            sort_by: HistorySortOrder::default(),
        }
    }
}

/// How to sort history for export.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistorySortOrder {
    #[default]
    MostRecent,
    MostUsed,
    Alphabetical,
    Chronological,
}
