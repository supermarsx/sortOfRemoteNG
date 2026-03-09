use chrono::Utc;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use regex::Regex;
use std::collections::HashMap;
use uuid::Uuid;

use crate::types::*;

/// Helper to build an OsTarget for Linux / macOS / BSD (i.e. any Unix-like).
fn unix_target() -> OsTarget {
    OsTarget {
        families: vec![
            OsFamily::Linux,
            OsFamily::MacOs,
            OsFamily::Bsd,
            OsFamily::Unix,
        ],
        ..Default::default()
    }
}

/// Helper to build a Linux-only OsTarget.
fn linux_target() -> OsTarget {
    OsTarget::family(OsFamily::Linux)
}

/// Full snippet lifecycle management: CRUD, search, rendering, import/export,
/// trigger expansion, built-in library, and usage tracking.
pub struct SnippetEngine {
    /// All snippets keyed by ID.
    snippets: HashMap<String, Snippet>,
    /// Fuzzy matcher (reusable).
    matcher: SkimMatcherV2,
    /// Whether data has been modified since last save.
    dirty: bool,
}

impl Default for SnippetEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SnippetEngine {
    // ───────── Construction ─────────

    pub fn new() -> Self {
        let mut engine = Self {
            snippets: HashMap::new(),
            matcher: SkimMatcherV2::default(),
            dirty: false,
        };
        engine.load_builtins();
        engine
    }

    pub fn load(&mut self, snippets: Vec<Snippet>) {
        for s in snippets {
            self.snippets.insert(s.id.clone(), s);
        }
        self.dirty = false;
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }
    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }

    // ───────── CRUD ─────────

    /// Add a new snippet.  Auto-generates an ID if empty.
    pub fn add(&mut self, mut snippet: Snippet) -> String {
        if snippet.id.is_empty() {
            snippet.id = Uuid::new_v4().to_string();
        }
        let id = snippet.id.clone();
        self.snippets.insert(id.clone(), snippet);
        self.dirty = true;
        id
    }

    /// Get a snippet by ID.
    pub fn get(&self, id: &str) -> Option<&Snippet> {
        self.snippets.get(id)
    }

    /// Update an existing snippet (matched by id).
    pub fn update(&mut self, snippet: Snippet) -> bool {
        if self.snippets.contains_key(&snippet.id) {
            let mut s = snippet;
            s.updated_at = Some(Utc::now());
            self.snippets.insert(s.id.clone(), s);
            self.dirty = true;
            true
        } else {
            false
        }
    }

    /// Remove a snippet by ID.
    pub fn remove(&mut self, id: &str) -> Option<Snippet> {
        let removed = self.snippets.remove(id);
        if removed.is_some() {
            self.dirty = true;
        }
        removed
    }

    /// List all snippets.
    pub fn list(&self) -> Vec<&Snippet> {
        self.snippets.values().collect()
    }

    /// List snippets in a category.
    pub fn by_category(&self, category: &SnippetCategory) -> Vec<&Snippet> {
        self.snippets
            .values()
            .filter(|s| &s.category == category)
            .collect()
    }

    /// List snippets compatible with a given OS context.
    pub fn by_os(&self, ctx: &OsContext) -> Vec<&Snippet> {
        self.snippets
            .values()
            .filter(|s| s.os_target.matches(ctx))
            .collect()
    }

    /// List snippets that are universal (no OS constraints).
    pub fn universal(&self) -> Vec<&Snippet> {
        self.snippets
            .values()
            .filter(|s| s.os_target.is_universal())
            .collect()
    }

    /// List snippets targeting a specific OS family.
    pub fn by_os_family(&self, family: &OsFamily) -> Vec<&Snippet> {
        self.snippets
            .values()
            .filter(|s| s.os_target.is_universal() || s.os_target.families.contains(family))
            .collect()
    }

    /// Record that a snippet was used (increments counter, updates last_used).
    pub fn record_use(&mut self, id: &str) -> bool {
        if let Some(s) = self.snippets.get_mut(id) {
            s.use_count += 1;
            s.last_used = Some(Utc::now());
            self.dirty = true;
            true
        } else {
            false
        }
    }

    // ───────── Search ─────────

    /// Fuzzy-search snippets by name, description, template, tags, and trigger.
    pub fn search(&self, query: &str, max: usize) -> Vec<(&Snippet, f64)> {
        if query.is_empty() {
            // Return all sorted by usage.
            let mut all: Vec<(&Snippet, f64)> = self
                .snippets
                .values()
                .map(|s| (s, s.use_count as f64))
                .collect();
            all.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            all.truncate(max);
            return all;
        }

        let mut results: Vec<(&Snippet, f64)> = Vec::new();

        for snippet in self.snippets.values() {
            let mut best_score: i64 = 0;

            // Match against name.
            if let Some(s) = self.matcher.fuzzy_match(&snippet.name, query) {
                best_score = best_score.max(s);
            }
            // Match against description.
            if let Some(s) = self.matcher.fuzzy_match(&snippet.description, query) {
                best_score = best_score.max(s);
            }
            // Match against template.
            if let Some(s) = self.matcher.fuzzy_match(&snippet.template, query) {
                best_score = best_score.max(s / 2); // template matches are less precise
            }
            // Match against trigger.
            if let Some(ref trigger) = snippet.trigger {
                if let Some(s) = self.matcher.fuzzy_match(trigger, query) {
                    best_score = best_score.max(s * 2); // trigger matches are highly relevant
                }
            }
            // Match against tags.
            for tag in &snippet.tags {
                if let Some(s) = self.matcher.fuzzy_match(tag, query) {
                    best_score = best_score.max(s);
                }
            }

            if best_score > 0 {
                let norm = (best_score as f64 / 200.0).clamp(0.0, 1.0);
                results.push((snippet, norm));
            }
        }

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(max);
        results
    }

    /// Check if an input matches any snippet trigger and expand it.
    pub fn try_expand_trigger(&self, input: &str) -> Option<(String, &Snippet)> {
        let trimmed = input.trim();
        for snippet in self.snippets.values() {
            if let Some(ref trigger) = snippet.trigger {
                if trimmed == trigger || trimmed.starts_with(&format!("{} ", trigger)) {
                    return Some((trigger.clone(), snippet));
                }
            }
        }
        None
    }

    // ───────── Rendering ─────────

    /// Render a snippet template with the given parameters.
    pub fn render(
        &self,
        id: &str,
        params: &HashMap<String, String>,
    ) -> Result<SnippetRenderResult, String> {
        let snippet = self
            .snippets
            .get(id)
            .ok_or_else(|| format!("Snippet '{}' not found", id))?;

        self.render_template(&snippet.template, &snippet.parameters, params)
    }

    /// Render an arbitrary template string (useful for previews / testing).
    pub fn render_template(
        &self,
        template: &str,
        declared_params: &[SnippetParameter],
        provided: &HashMap<String, String>,
    ) -> Result<SnippetRenderResult, String> {
        let mut result = template.to_string();
        let mut substituted = Vec::new();
        let mut defaulted = Vec::new();
        let mut missing = Vec::new();

        // Find all {{param}} placeholders.
        let placeholder_re =
            Regex::new(r"\{\{(\w+)\}\}").map_err(|e| format!("Regex error: {}", e))?;

        for cap in placeholder_re.captures_iter(template) {
            let full_match = cap.get(0).unwrap().as_str();
            let param_name = &cap[1];

            if let Some(value) = provided.get(param_name) {
                // Validate if a regex is specified.
                if let Some(declared) = declared_params.iter().find(|p| p.name == param_name) {
                    if let Some(ref vr) = declared.validation_regex {
                        let re = Regex::new(vr).map_err(|e| {
                            format!("Invalid validation regex for '{}': {}", param_name, e)
                        })?;
                        if !re.is_match(value) {
                            return Err(format!(
                                "Parameter '{}' value '{}' does not match validation pattern '{}'",
                                param_name, value, vr
                            ));
                        }
                    }
                }
                result = result.replace(full_match, value);
                substituted.push(param_name.to_string());
            } else if let Some(declared) = declared_params.iter().find(|p| p.name == param_name) {
                if let Some(ref default_val) = declared.default_value {
                    result = result.replace(full_match, default_val);
                    defaulted.push(param_name.to_string());
                } else if declared.required {
                    missing.push(param_name.to_string());
                } else {
                    // Optional with no default — remove placeholder.
                    result = result.replace(full_match, "");
                    defaulted.push(param_name.to_string());
                }
            } else {
                // Undeclared parameter — leave as-is or remove.
                missing.push(param_name.to_string());
            }
        }

        if !missing.is_empty() {
            // Check if any are required.
            let required_missing: Vec<&str> = missing
                .iter()
                .filter(|name| {
                    declared_params
                        .iter()
                        .any(|p| p.name == **name && p.required)
                })
                .map(|s| s.as_str())
                .collect();
            if !required_missing.is_empty() {
                return Err(format!(
                    "Missing required parameters: {}",
                    required_missing.join(", ")
                ));
            }
        }

        Ok(SnippetRenderResult {
            command: result,
            substituted_params: substituted,
            defaulted_params: defaulted,
            missing_params: missing,
        })
    }

    // ───────── Import / Export ─────────

    /// Export all custom (non-builtin) snippets as a collection.
    pub fn export_custom(&self) -> SnippetCollection {
        SnippetCollection {
            name: "Custom Snippets Export".to_string(),
            description: Some("Exported from command palette".to_string()),
            snippets: self
                .snippets
                .values()
                .filter(|s| !s.is_builtin)
                .cloned()
                .collect(),
            exported_at: Utc::now(),
            version: Some("1".to_string()),
        }
    }

    /// Export all snippets in a category.
    pub fn export_category(&self, category: &SnippetCategory) -> SnippetCollection {
        SnippetCollection {
            name: format!("{:?} Snippets", category),
            description: None,
            snippets: self
                .snippets
                .values()
                .filter(|s| &s.category == category)
                .cloned()
                .collect(),
            exported_at: Utc::now(),
            version: Some("1".to_string()),
        }
    }

    /// Import a collection, optionally overwriting existing IDs.
    pub fn import_collection(&mut self, collection: SnippetCollection, overwrite: bool) -> usize {
        let mut count = 0;
        for snippet in collection.snippets {
            if overwrite || !self.snippets.contains_key(&snippet.id) {
                self.snippets.insert(snippet.id.clone(), snippet);
                count += 1;
            }
        }
        if count > 0 {
            self.dirty = true;
        }
        count
    }

    /// Return all entries for persistence.
    pub fn all_snippets(&self) -> Vec<Snippet> {
        self.snippets.values().cloned().collect()
    }

    /// Return all user (non-builtin) snippets for persistence.
    pub fn user_snippets(&self) -> Vec<Snippet> {
        self.snippets
            .values()
            .filter(|s| !s.is_builtin)
            .cloned()
            .collect()
    }

    // ───────── Stats ─────────

    pub fn stats(&self) -> (usize, usize, usize, Vec<(String, u64)>) {
        let total = self.snippets.len();
        let builtin = self.snippets.values().filter(|s| s.is_builtin).count();
        let custom = total - builtin;
        let mut top: Vec<(String, u64)> = self
            .snippets
            .values()
            .map(|s| (s.name.clone(), s.use_count))
            .collect();
        top.sort_by(|a, b| b.1.cmp(&a.1));
        top.truncate(10);
        (total, builtin, custom, top)
    }

    // ───────── Built-in snippets ─────────

    fn load_builtins(&mut self) {
        let builtins = vec![
            Snippet {
                id: "builtin-find-files".to_string(),
                name: "Find files by pattern".to_string(),
                description: "Recursively find files matching a name pattern".to_string(),
                template: "find {{path}} -name '{{pattern}}'".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "path".to_string(),
                        label: Some("Search path".to_string()),
                        description: Some("Directory to search in".to_string()),
                        default_value: Some(".".to_string()),
                        required: false,
                        placeholder: Some("/var/log".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "pattern".to_string(),
                        label: Some("File pattern".to_string()),
                        description: Some("Glob pattern to match filenames".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("*.log".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::FileOperations,
                trigger: Some("!find".to_string()),
                tags: vec!["find".to_string(), "search".to_string(), "files".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: unix_target(), // find(1) is POSIX
            },
            Snippet {
                id: "builtin-disk-usage".to_string(),
                name: "Disk usage summary".to_string(),
                description: "Show disk usage sorted by size for a directory".to_string(),
                template: "du -sh {{path}}/* | sort -rh | head -n {{count}}".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "path".to_string(),
                        label: Some("Directory".to_string()),
                        description: Some("Directory to analyse".to_string()),
                        default_value: Some(".".to_string()),
                        required: false,
                        placeholder: Some("/home".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "count".to_string(),
                        label: Some("Number of results".to_string()),
                        description: Some("Top N largest items".to_string()),
                        default_value: Some("20".to_string()),
                        required: false,
                        placeholder: Some("20".to_string()),
                        validation_regex: Some(r"^\d+$".to_string()),
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::SystemAdmin,
                trigger: Some("!du".to_string()),
                tags: vec!["disk".to_string(), "usage".to_string(), "size".to_string(), "storage".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: unix_target(), // du(1) + sort -rh are POSIX/GNU
            },
            Snippet {
                id: "builtin-port-check".to_string(),
                name: "Check open ports".to_string(),
                description: "List listening TCP ports with process info".to_string(),
                template: "ss -tlnp | grep '{{filter}}'".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "filter".to_string(),
                        label: Some("Filter text".to_string()),
                        description: Some("Filter output by port, process, or address".to_string()),
                        default_value: Some(":".to_string()),
                        required: false,
                        placeholder: Some(":8080".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Networking,
                trigger: Some("!ports".to_string()),
                tags: vec!["ports".to_string(), "network".to_string(), "listen".to_string(), "ss".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: linux_target(), // ss is Linux-specific
            },
            Snippet {
                id: "builtin-tail-log".to_string(),
                name: "Tail log file".to_string(),
                description: "Follow a log file in real time with optional grep filter".to_string(),
                template: "tail -f {{file}} | grep --line-buffered '{{pattern}}'".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "file".to_string(),
                        label: Some("Log file".to_string()),
                        description: Some("Path to the log file".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("/var/log/syslog".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "pattern".to_string(),
                        label: Some("Filter pattern".to_string()),
                        description: Some("Grep pattern to filter lines".to_string()),
                        default_value: Some(".".to_string()),
                        required: false,
                        placeholder: Some("error|warn".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Monitoring,
                trigger: Some("!tail".to_string()),
                tags: vec!["log".to_string(), "tail".to_string(), "follow".to_string(), "grep".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: unix_target(), // tail + grep are POSIX
            },
            Snippet {
                id: "builtin-ssh-tunnel".to_string(),
                name: "SSH local port forward".to_string(),
                description: "Create an SSH tunnel for local port forwarding".to_string(),
                template: "ssh -L {{local_port}}:{{remote_host}}:{{remote_port}} {{user}}@{{gateway}} -N".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "local_port".to_string(),
                        label: Some("Local port".to_string()),
                        description: Some("Port on your local machine".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("8080".to_string()),
                        validation_regex: Some(r"^\d{1,5}$".to_string()),
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "remote_host".to_string(),
                        label: Some("Remote host".to_string()),
                        description: Some("Host accessible from the gateway".to_string()),
                        default_value: Some("localhost".to_string()),
                        required: true,
                        placeholder: Some("db-server".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "remote_port".to_string(),
                        label: Some("Remote port".to_string()),
                        description: Some("Port on the remote host".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("5432".to_string()),
                        validation_regex: Some(r"^\d{1,5}$".to_string()),
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "user".to_string(),
                        label: Some("SSH user".to_string()),
                        description: Some("Username for the gateway".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("admin".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "gateway".to_string(),
                        label: Some("Gateway host".to_string()),
                        description: Some("SSH gateway / bastion host".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("bastion.example.com".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Ssh,
                trigger: Some("!tunnel".to_string()),
                tags: vec!["ssh".to_string(), "tunnel".to_string(), "forward".to_string(), "port".to_string()],
                risk_level: PaletteRiskLevel::Low,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: OsTarget::default(), // universal (OpenSSH is everywhere)
            },
            Snippet {
                id: "builtin-scp-download".to_string(),
                name: "SCP download file".to_string(),
                description: "Download a file from a remote server via SCP".to_string(),
                template: "scp {{user}}@{{host}}:{{remote_path}} {{local_path}}".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "user".to_string(),
                        label: Some("Username".to_string()),
                        description: None,
                        default_value: None,
                        required: true,
                        placeholder: Some("root".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "host".to_string(),
                        label: Some("Host".to_string()),
                        description: None,
                        default_value: None,
                        required: true,
                        placeholder: Some("server.example.com".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "remote_path".to_string(),
                        label: Some("Remote path".to_string()),
                        description: Some("File path on the remote server".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("/var/log/app.log".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "local_path".to_string(),
                        label: Some("Local path".to_string()),
                        description: Some("Where to save locally".to_string()),
                        default_value: Some("./".to_string()),
                        required: false,
                        placeholder: Some("./downloads/".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::FileTransfer,
                trigger: Some("!scp".to_string()),
                tags: vec!["scp".to_string(), "download".to_string(), "file".to_string(), "transfer".to_string()],
                risk_level: PaletteRiskLevel::Low,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: OsTarget::default(), // universal
            },
            Snippet {
                id: "builtin-process-kill".to_string(),
                name: "Find and kill process".to_string(),
                description: "Find a process by name and kill it".to_string(),
                template: "pkill -{{signal}} -f '{{pattern}}'".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "signal".to_string(),
                        label: Some("Signal".to_string()),
                        description: Some("Signal to send to the process".to_string()),
                        default_value: Some("TERM".to_string()),
                        required: false,
                        placeholder: Some("TERM".to_string()),
                        validation_regex: None,
                        choices: vec!["TERM".to_string(), "KILL".to_string(), "HUP".to_string(), "INT".to_string()],
                    },
                    SnippetParameter {
                        name: "pattern".to_string(),
                        label: Some("Process pattern".to_string()),
                        description: Some("Regex to match process command line".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("nginx".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::SystemAdmin,
                trigger: Some("!kill".to_string()),
                tags: vec!["process".to_string(), "kill".to_string(), "signal".to_string(), "pkill".to_string()],
                risk_level: PaletteRiskLevel::Medium,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: unix_target(), // pkill is POSIX-ish
            },
            Snippet {
                id: "builtin-docker-logs".to_string(),
                name: "Docker container logs".to_string(),
                description: "Follow logs from a Docker container".to_string(),
                template: "docker logs -f --tail {{lines}} {{container}}".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "lines".to_string(),
                        label: Some("Tail lines".to_string()),
                        description: Some("Number of recent lines to show initially".to_string()),
                        default_value: Some("100".to_string()),
                        required: false,
                        placeholder: Some("100".to_string()),
                        validation_regex: Some(r"^\d+$".to_string()),
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "container".to_string(),
                        label: Some("Container".to_string()),
                        description: Some("Container name or ID".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("my-app".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Docker,
                trigger: Some("!dockerlog".to_string()),
                tags: vec!["docker".to_string(), "logs".to_string(), "container".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: OsTarget::default(), // universal (Docker runs everywhere)
            },
            Snippet {
                id: "builtin-git-log-pretty".to_string(),
                name: "Git pretty log".to_string(),
                description: "Show a compact, coloured Git log with graph".to_string(),
                template: "git log --oneline --graph --decorate --all -n {{count}}".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "count".to_string(),
                        label: Some("Commits".to_string()),
                        description: Some("Number of commits to show".to_string()),
                        default_value: Some("30".to_string()),
                        required: false,
                        placeholder: Some("30".to_string()),
                        validation_regex: Some(r"^\d+$".to_string()),
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Git,
                trigger: Some("!gitlog".to_string()),
                tags: vec!["git".to_string(), "log".to_string(), "history".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: OsTarget::default(), // universal
            },
            Snippet {
                id: "builtin-tar-extract".to_string(),
                name: "Extract tar archive".to_string(),
                description: "Extract a .tar.gz or .tar.bz2 archive".to_string(),
                template: "tar -xvf {{archive}} -C {{destination}}".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "archive".to_string(),
                        label: Some("Archive file".to_string()),
                        description: Some("Path to the archive".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("backup.tar.gz".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "destination".to_string(),
                        label: Some("Destination".to_string()),
                        description: Some("Directory to extract into".to_string()),
                        default_value: Some(".".to_string()),
                        required: false,
                        placeholder: Some("./extracted".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Compression,
                trigger: Some("!untar".to_string()),
                tags: vec!["tar".to_string(), "extract".to_string(), "archive".to_string(), "compress".to_string()],
                risk_level: PaletteRiskLevel::Low,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: unix_target(), // tar(1) is POSIX
            },
            Snippet {
                id: "builtin-ssl-check".to_string(),
                name: "Check SSL certificate".to_string(),
                description: "Show SSL certificate details and expiry for a domain".to_string(),
                template: "echo | openssl s_client -servername {{domain}} -connect {{domain}}:{{port}} 2>/dev/null | openssl x509 -noout -dates -subject".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "domain".to_string(),
                        label: Some("Domain".to_string()),
                        description: Some("Domain to check".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("example.com".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "port".to_string(),
                        label: Some("Port".to_string()),
                        description: Some("HTTPS port".to_string()),
                        default_value: Some("443".to_string()),
                        required: false,
                        placeholder: Some("443".to_string()),
                        validation_regex: Some(r"^\d{1,5}$".to_string()),
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Security,
                trigger: Some("!ssl".to_string()),
                tags: vec!["ssl".to_string(), "tls".to_string(), "certificate".to_string(), "openssl".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: unix_target(), // openssl + shell piping
            },
            Snippet {
                id: "builtin-system-info".to_string(),
                name: "System information summary".to_string(),
                description: "Quick overview of CPU, memory, disk, and OS".to_string(),
                template: "echo '=== OS ===' && uname -a && echo '=== CPU ===' && nproc && echo '=== Memory ===' && free -h && echo '=== Disk ===' && df -h /".to_string(),
                parameters: Vec::new(),
                category: SnippetCategory::SystemAdmin,
                trigger: Some("!sysinfo".to_string()),
                tags: vec!["system".to_string(), "info".to_string(), "cpu".to_string(), "memory".to_string(), "disk".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: linux_target(), // free(1) is Linux-specific
            },
            Snippet {
                id: "builtin-k8s-pods".to_string(),
                name: "Kubernetes pod status".to_string(),
                description: "Show all pods with status in a namespace".to_string(),
                template: "kubectl get pods -n {{namespace}} -o wide".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "namespace".to_string(),
                        label: Some("Namespace".to_string()),
                        description: Some("Kubernetes namespace".to_string()),
                        default_value: Some("default".to_string()),
                        required: false,
                        placeholder: Some("production".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::Kubernetes,
                trigger: Some("!pods".to_string()),
                tags: vec!["kubernetes".to_string(), "k8s".to_string(), "pods".to_string(), "kubectl".to_string()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: OsTarget::default(), // universal
            },
            Snippet {
                id: "builtin-user-add".to_string(),
                name: "Add system user".to_string(),
                description: "Create a new user with home directory and shell".to_string(),
                template: "sudo useradd -m -s {{shell}} {{username}}".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "username".to_string(),
                        label: Some("Username".to_string()),
                        description: Some("Username for the new account".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("jdoe".to_string()),
                        validation_regex: Some(r"^[a-z_][a-z0-9_-]*$".to_string()),
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "shell".to_string(),
                        label: Some("Shell".to_string()),
                        description: Some("Login shell for the user".to_string()),
                        default_value: Some("/bin/bash".to_string()),
                        required: false,
                        placeholder: Some("/bin/bash".to_string()),
                        validation_regex: None,
                        choices: vec!["/bin/bash".to_string(), "/bin/zsh".to_string(), "/bin/sh".to_string(), "/usr/bin/fish".to_string(), "/usr/sbin/nologin".to_string()],
                    },
                ],
                category: SnippetCategory::UserManagement,
                trigger: Some("!useradd".to_string()),
                tags: vec!["user".to_string(), "add".to_string(), "useradd".to_string(), "account".to_string()],
                risk_level: PaletteRiskLevel::High,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: linux_target(), // useradd is Linux-specific
            },
            Snippet {
                id: "builtin-rsync-backup".to_string(),
                name: "Rsync backup".to_string(),
                description: "Backup a directory with rsync preserving permissions".to_string(),
                template: "rsync -avz --progress {{source}} {{destination}}".to_string(),
                parameters: vec![
                    SnippetParameter {
                        name: "source".to_string(),
                        label: Some("Source".to_string()),
                        description: Some("Source directory (local or remote)".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("/var/www/".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                    SnippetParameter {
                        name: "destination".to_string(),
                        label: Some("Destination".to_string()),
                        description: Some("Destination directory (local or remote)".to_string()),
                        default_value: None,
                        required: true,
                        placeholder: Some("user@backup:/backups/www/".to_string()),
                        validation_regex: None,
                        choices: Vec::new(),
                    },
                ],
                category: SnippetCategory::FileTransfer,
                trigger: Some("!rsync".to_string()),
                tags: vec!["rsync".to_string(), "backup".to_string(), "sync".to_string(), "copy".to_string()],
                risk_level: PaletteRiskLevel::Low,
                is_builtin: true,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 0,
                last_used: None,
                os_target: unix_target(), // rsync is *nix
            },
        ];

        for snippet in builtins {
            self.snippets.insert(snippet.id.clone(), snippet);
        }
    }
}
