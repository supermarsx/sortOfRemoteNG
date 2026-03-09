use crate::error::AiAssistError;
use crate::types::*;

use chrono::Utc;
use std::collections::HashMap;

/// Manages a library of command snippets/templates.
pub struct SnippetManager {
    snippets: HashMap<String, CommandSnippet>,
}

impl Default for SnippetManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SnippetManager {
    pub fn new() -> Self {
        let mut mgr = Self {
            snippets: HashMap::new(),
        };
        mgr.load_builtins();
        mgr
    }

    /// Get all snippets sorted by usage count (most popular first).
    pub fn list(&self) -> Vec<&CommandSnippet> {
        let mut list: Vec<&CommandSnippet> = self.snippets.values().collect();
        list.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
        list
    }

    /// Get a snippet by ID.
    pub fn get(&self, id: &str) -> Option<&CommandSnippet> {
        self.snippets.get(id)
    }

    /// Search snippets by query string.
    pub fn search(&self, query: &str) -> Vec<&CommandSnippet> {
        let lower = query.to_lowercase();
        let mut results: Vec<&CommandSnippet> = self
            .snippets
            .values()
            .filter(|s| {
                s.name.to_lowercase().contains(&lower)
                    || s.description.to_lowercase().contains(&lower)
                    || s.tags.iter().any(|t| t.to_lowercase().contains(&lower))
            })
            .collect();
        results.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
        results
    }

    /// Filter snippets by category.
    pub fn by_category(&self, category: &SnippetCategory) -> Vec<&CommandSnippet> {
        self.snippets
            .values()
            .filter(|s| &s.category == category)
            .collect()
    }

    /// Add a custom snippet.
    pub fn add(&mut self, snippet: CommandSnippet) {
        self.snippets.insert(snippet.id.clone(), snippet);
    }

    /// Remove a snippet by ID.
    pub fn remove(&mut self, id: &str) -> Option<CommandSnippet> {
        self.snippets.remove(id)
    }

    /// Increment usage counter for a snippet.
    pub fn record_use(&mut self, id: &str) {
        if let Some(snippet) = self.snippets.get_mut(id) {
            snippet.usage_count += 1;
        }
    }

    /// Render a snippet template with provided parameters.
    pub fn render(
        &self,
        id: &str,
        params: &HashMap<String, String>,
    ) -> Result<String, AiAssistError> {
        let snippet = self
            .snippets
            .get(id)
            .ok_or_else(|| AiAssistError::not_found(&format!("snippet '{}'", id)))?;

        let mut result = snippet.template.clone();

        for param in &snippet.parameters {
            let placeholder = format!("{{{{{}}}}}", param.name);
            let value = params
                .get(&param.name)
                .or(param.default_value.as_ref())
                .ok_or_else(|| {
                    AiAssistError::snippet_error(&format!(
                        "Missing required parameter: {}",
                        param.name
                    ))
                })?;

            // Validate if regex is present
            if let Some(ref regex_str) = param.validation_regex {
                let re = regex::Regex::new(regex_str).map_err(|e| {
                    AiAssistError::snippet_error(&format!("Invalid validation regex: {}", e))
                })?;
                if !re.is_match(value) {
                    return Err(AiAssistError::snippet_error(&format!(
                        "Parameter '{}' value '{}' doesn't match validation pattern",
                        param.name, value
                    )));
                }
            }

            result = result.replace(&placeholder, value);
        }

        Ok(result)
    }

    fn load_builtins(&mut self) {
        let builtins = vec![
            // ── File operations ──
            CommandSnippet {
                id: "find-large-files".to_string(),
                name: "Find Large Files".to_string(),
                description: "Find files larger than a specified size".to_string(),
                template: "find {{path}} -type f -size +{{size}} -exec ls -lh {} + | sort -k5 -rh | head -{{count}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "path".to_string(), description: "Search path".to_string(), default_value: Some("/".to_string()), required: false, placeholder: "/".to_string(), validation_regex: None },
                    SnippetParameter { name: "size".to_string(), description: "Minimum size (e.g., 100M, 1G)".to_string(), default_value: Some("100M".to_string()), required: false, placeholder: "100M".to_string(), validation_regex: Some(r"^\d+[kKmMgGtT]?$".to_string()) },
                    SnippetParameter { name: "count".to_string(), description: "Number of results".to_string(), default_value: Some("20".to_string()), required: false, placeholder: "20".to_string(), validation_regex: Some(r"^\d+$".to_string()) },
                ],
                category: SnippetCategory::FileOperations,
                tags: vec!["find".to_string(), "large".to_string(), "disk".to_string(), "space".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs, OsType::FreeBsd],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
            CommandSnippet {
                id: "backup-dir".to_string(),
                name: "Backup Directory".to_string(),
                description: "Create a timestamped tar.gz backup of a directory".to_string(),
                template: "tar -czf {{dest}}/{{name}}-$(date +%Y%m%d-%H%M%S).tar.gz -C {{source}} .".to_string(),
                parameters: vec![
                    SnippetParameter { name: "source".to_string(), description: "Directory to backup".to_string(), default_value: None, required: true, placeholder: "/path/to/dir".to_string(), validation_regex: None },
                    SnippetParameter { name: "dest".to_string(), description: "Backup destination".to_string(), default_value: Some("/tmp".to_string()), required: false, placeholder: "/tmp".to_string(), validation_regex: None },
                    SnippetParameter { name: "name".to_string(), description: "Backup name prefix".to_string(), default_value: Some("backup".to_string()), required: false, placeholder: "backup".to_string(), validation_regex: None },
                ],
                category: SnippetCategory::FileOperations,
                tags: vec!["backup".to_string(), "tar".to_string(), "archive".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Networking ──
            CommandSnippet {
                id: "port-scan".to_string(),
                name: "Quick Port Scan".to_string(),
                description: "Scan common ports on a host".to_string(),
                template: "for port in {{ports}}; do (echo >/dev/tcp/{{host}}/$port) 2>/dev/null && echo \"Port $port: OPEN\" || echo \"Port $port: closed\"; done".to_string(),
                parameters: vec![
                    SnippetParameter { name: "host".to_string(), description: "Target host".to_string(), default_value: None, required: true, placeholder: "192.168.1.1".to_string(), validation_regex: None },
                    SnippetParameter { name: "ports".to_string(), description: "Space-separated port list".to_string(), default_value: Some("22 80 443 3306 5432 6379 8080".to_string()), required: false, placeholder: "22 80 443".to_string(), validation_regex: None },
                ],
                category: SnippetCategory::Networking,
                tags: vec!["port".to_string(), "scan".to_string(), "network".to_string()],
                shell_compatibility: vec![ShellType::Bash],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Low,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
            CommandSnippet {
                id: "check-ssl-cert".to_string(),
                name: "Check SSL Certificate".to_string(),
                description: "View SSL certificate details and expiry".to_string(),
                template: "echo | openssl s_client -servername {{host}} -connect {{host}}:{{port}} 2>/dev/null | openssl x509 -noout -dates -subject -issuer".to_string(),
                parameters: vec![
                    SnippetParameter { name: "host".to_string(), description: "Hostname".to_string(), default_value: None, required: true, placeholder: "example.com".to_string(), validation_regex: None },
                    SnippetParameter { name: "port".to_string(), description: "Port".to_string(), default_value: Some("443".to_string()), required: false, placeholder: "443".to_string(), validation_regex: Some(r"^\d+$".to_string()) },
                ],
                category: SnippetCategory::Networking,
                tags: vec!["ssl".to_string(), "tls".to_string(), "certificate".to_string(), "security".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs, OsType::FreeBsd],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── System admin ──
            CommandSnippet {
                id: "disk-usage-top".to_string(),
                name: "Top Disk Usage".to_string(),
                description: "Show directories with highest disk usage".to_string(),
                template: "du -sh {{path}}/* 2>/dev/null | sort -rh | head -{{count}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "path".to_string(), description: "Path to analyze".to_string(), default_value: Some("/".to_string()), required: false, placeholder: "/".to_string(), validation_regex: None },
                    SnippetParameter { name: "count".to_string(), description: "Number of results".to_string(), default_value: Some("20".to_string()), required: false, placeholder: "20".to_string(), validation_regex: Some(r"^\d+$".to_string()) },
                ],
                category: SnippetCategory::SystemAdmin,
                tags: vec!["disk".to_string(), "usage".to_string(), "space".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
            CommandSnippet {
                id: "process-memory".to_string(),
                name: "Top Memory Processes".to_string(),
                description: "Show processes using the most memory".to_string(),
                template: "ps aux --sort=-%mem | head -{{count}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "count".to_string(), description: "Number of processes".to_string(), default_value: Some("20".to_string()), required: false, placeholder: "20".to_string(), validation_regex: Some(r"^\d+$".to_string()) },
                ],
                category: SnippetCategory::SystemAdmin,
                tags: vec!["memory".to_string(), "process".to_string(), "top".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
            CommandSnippet {
                id: "watch-logs".to_string(),
                name: "Watch Log File".to_string(),
                description: "Follow a log file in real-time with optional grep filter".to_string(),
                template: "tail -f {{logfile}} | grep --line-buffered '{{pattern}}'".to_string(),
                parameters: vec![
                    SnippetParameter { name: "logfile".to_string(), description: "Log file path".to_string(), default_value: Some("/var/log/syslog".to_string()), required: false, placeholder: "/var/log/syslog".to_string(), validation_regex: None },
                    SnippetParameter { name: "pattern".to_string(), description: "Filter pattern".to_string(), default_value: Some("error\\|warn\\|fail".to_string()), required: false, placeholder: "error".to_string(), validation_regex: None },
                ],
                category: SnippetCategory::Monitoring,
                tags: vec!["log".to_string(), "tail".to_string(), "monitoring".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Docker ──
            CommandSnippet {
                id: "docker-cleanup".to_string(),
                name: "Docker Cleanup".to_string(),
                description: "Remove stopped containers, unused images, and dangling volumes".to_string(),
                template: "docker system prune -af --volumes".to_string(),
                parameters: Vec::new(),
                category: SnippetCategory::Docker,
                tags: vec!["docker".to_string(), "cleanup".to_string(), "prune".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Medium,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
            CommandSnippet {
                id: "docker-exec-shell".to_string(),
                name: "Docker Exec Shell".to_string(),
                description: "Open a shell inside a running container".to_string(),
                template: "docker exec -it {{container}} {{shell}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "container".to_string(), description: "Container name or ID".to_string(), default_value: None, required: true, placeholder: "my-container".to_string(), validation_regex: None },
                    SnippetParameter { name: "shell".to_string(), description: "Shell to use".to_string(), default_value: Some("/bin/bash".to_string()), required: false, placeholder: "/bin/bash".to_string(), validation_regex: None },
                ],
                category: SnippetCategory::Docker,
                tags: vec!["docker".to_string(), "exec".to_string(), "shell".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Low,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Git ──
            CommandSnippet {
                id: "git-undo-last".to_string(),
                name: "Git Undo Last Commit".to_string(),
                description: "Undo the last commit while keeping changes staged".to_string(),
                template: "git reset --soft HEAD~1".to_string(),
                parameters: Vec::new(),
                category: SnippetCategory::Git,
                tags: vec!["git".to_string(), "undo".to_string(), "reset".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh, ShellType::Fish],
                os_compatibility: vec![OsType::Linux, OsType::MacOs, OsType::Windows],
                risk_level: RiskLevel::Low,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
            CommandSnippet {
                id: "git-branch-cleanup".to_string(),
                name: "Git Cleanup Merged Branches".to_string(),
                description: "Delete local branches that have been merged".to_string(),
                template: "git branch --merged | grep -v '\\*\\|main\\|master\\|develop' | xargs -r git branch -d".to_string(),
                parameters: Vec::new(),
                category: SnippetCategory::Git,
                tags: vec!["git".to_string(), "branch".to_string(), "cleanup".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Low,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Text processing ──
            CommandSnippet {
                id: "csv-column-extract".to_string(),
                name: "Extract CSV Column".to_string(),
                description: "Extract a specific column from a CSV file".to_string(),
                template: "awk -F'{{delimiter}}' '{{NR==1 || 1}} {{print ${{column}}}}' {{file}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "file".to_string(), description: "CSV file path".to_string(), default_value: None, required: true, placeholder: "data.csv".to_string(), validation_regex: None },
                    SnippetParameter { name: "column".to_string(), description: "Column number (1-based)".to_string(), default_value: Some("1".to_string()), required: false, placeholder: "1".to_string(), validation_regex: Some(r"^\d+$".to_string()) },
                    SnippetParameter { name: "delimiter".to_string(), description: "Field delimiter".to_string(), default_value: Some(",".to_string()), required: false, placeholder: ",".to_string(), validation_regex: None },
                ],
                category: SnippetCategory::TextProcessing,
                tags: vec!["csv".to_string(), "awk".to_string(), "column".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Security ──
            CommandSnippet {
                id: "check-open-ports".to_string(),
                name: "Check Open Ports".to_string(),
                description: "List all listening ports and their processes".to_string(),
                template: "ss -tlnp || netstat -tlnp".to_string(),
                parameters: Vec::new(),
                category: SnippetCategory::Security,
                tags: vec!["ports".to_string(), "security".to_string(), "network".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
            CommandSnippet {
                id: "failed-logins".to_string(),
                name: "Check Failed Login Attempts".to_string(),
                description: "Show recent failed SSH login attempts".to_string(),
                template: "grep 'Failed password' /var/log/auth.log | tail -{{count}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "count".to_string(), description: "Number of entries".to_string(), default_value: Some("50".to_string()), required: false, placeholder: "50".to_string(), validation_regex: Some(r"^\d+$".to_string()) },
                ],
                category: SnippetCategory::Security,
                tags: vec!["ssh".to_string(), "security".to_string(), "login".to_string(), "audit".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Kubernetes ──
            CommandSnippet {
                id: "k8s-pod-logs".to_string(),
                name: "Kubernetes Pod Logs".to_string(),
                description: "View logs of a Kubernetes pod with optional follow".to_string(),
                template: "kubectl logs {{follow}} -n {{namespace}} {{pod}} {{container}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "pod".to_string(), description: "Pod name".to_string(), default_value: None, required: true, placeholder: "my-pod".to_string(), validation_regex: None },
                    SnippetParameter { name: "namespace".to_string(), description: "Namespace".to_string(), default_value: Some("default".to_string()), required: false, placeholder: "default".to_string(), validation_regex: None },
                    SnippetParameter { name: "container".to_string(), description: "Container name (if multi-container)".to_string(), default_value: Some("".to_string()), required: false, placeholder: "".to_string(), validation_regex: None },
                    SnippetParameter { name: "follow".to_string(), description: "Follow logs (-f or empty)".to_string(), default_value: Some("-f".to_string()), required: false, placeholder: "-f".to_string(), validation_regex: None },
                ],
                category: SnippetCategory::Kubernetes,
                tags: vec!["kubernetes".to_string(), "k8s".to_string(), "logs".to_string(), "pod".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs, OsType::Windows],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Database ──
            CommandSnippet {
                id: "pg-dump".to_string(),
                name: "PostgreSQL Dump".to_string(),
                description: "Create a PostgreSQL database dump".to_string(),
                template: "pg_dump -h {{host}} -p {{port}} -U {{user}} -Fc {{database}} > {{output}}".to_string(),
                parameters: vec![
                    SnippetParameter { name: "host".to_string(), description: "Database host".to_string(), default_value: Some("localhost".to_string()), required: false, placeholder: "localhost".to_string(), validation_regex: None },
                    SnippetParameter { name: "port".to_string(), description: "Database port".to_string(), default_value: Some("5432".to_string()), required: false, placeholder: "5432".to_string(), validation_regex: Some(r"^\d+$".to_string()) },
                    SnippetParameter { name: "user".to_string(), description: "Database user".to_string(), default_value: Some("postgres".to_string()), required: false, placeholder: "postgres".to_string(), validation_regex: None },
                    SnippetParameter { name: "database".to_string(), description: "Database name".to_string(), default_value: None, required: true, placeholder: "mydb".to_string(), validation_regex: None },
                    SnippetParameter { name: "output".to_string(), description: "Output file path".to_string(), default_value: Some("dump.sql".to_string()), required: false, placeholder: "dump.sql".to_string(), validation_regex: None },
                ],
                category: SnippetCategory::Database,
                tags: vec!["postgres".to_string(), "dump".to_string(), "backup".to_string(), "database".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },

            // ── Compression ──
            CommandSnippet {
                id: "parallel-compress".to_string(),
                name: "Parallel Compression".to_string(),
                description: "Compress a directory using pigz (parallel gzip)".to_string(),
                template: "tar cf - {{path}} | pigz -{{level}} > {{output}}.tar.gz".to_string(),
                parameters: vec![
                    SnippetParameter { name: "path".to_string(), description: "Path to compress".to_string(), default_value: None, required: true, placeholder: "/path/to/dir".to_string(), validation_regex: None },
                    SnippetParameter { name: "output".to_string(), description: "Output filename (without extension)".to_string(), default_value: Some("archive".to_string()), required: false, placeholder: "archive".to_string(), validation_regex: None },
                    SnippetParameter { name: "level".to_string(), description: "Compression level (1-9)".to_string(), default_value: Some("6".to_string()), required: false, placeholder: "6".to_string(), validation_regex: Some(r"^[1-9]$".to_string()) },
                ],
                category: SnippetCategory::Compression,
                tags: vec!["compress".to_string(), "pigz".to_string(), "parallel".to_string(), "tar".to_string()],
                shell_compatibility: vec![ShellType::Bash, ShellType::Zsh, ShellType::Sh],
                os_compatibility: vec![OsType::Linux, OsType::MacOs],
                risk_level: RiskLevel::Safe,
                created_at: Utc::now(),
                usage_count: 0,
                is_builtin: true,
            },
        ];

        for snippet in builtins {
            self.snippets.insert(snippet.id.clone(), snippet);
        }
    }
}
