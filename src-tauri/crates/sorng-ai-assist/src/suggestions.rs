use crate::types::*;
use crate::context::{ContextBuilder, parse_command_line, CommandLineState};
use crate::error::AiAssistError;
use crate::history::HistoryAnalyzer;

use regex::Regex;
use std::collections::HashMap;

/// Provides AI-powered and heuristic-based command suggestions.
pub struct SuggestionEngine;

impl SuggestionEngine {
    /// Generate suggestions by combining AI, history, and builtin sources.
    pub fn generate_suggestions(
        input: &str,
        cursor_pos: usize,
        ctx: &SessionContext,
        config: &AiAssistConfig,
    ) -> Vec<Suggestion> {
        let mut all: Vec<Suggestion> = Vec::new();

        let state = parse_command_line(input);

        // 1. History-based suggestions
        let history_suggestions = Self::history_suggestions(ctx, &state, config.max_suggestions);
        all.extend(history_suggestions);

        // 2. Builtin heuristic suggestions
        let builtin_suggestions = Self::builtin_suggestions(&state, &ctx.shell, &ctx.os);
        all.extend(builtin_suggestions);

        // 3. Fuzzy match from known commands
        if let CommandLineState::PartialCommand(ref partial) = state {
            let fuzzy = Self::fuzzy_match_commands(partial, &ctx.installed_tools);
            all.extend(fuzzy);
        }

        // Deduplicate and sort by confidence
        Self::deduplicate_and_sort(&mut all);
        all.truncate(config.max_suggestions);
        all
    }

    /// Suggestions based on command history patterns.
    fn history_suggestions(
        ctx: &SessionContext,
        _state: &CommandLineState,
        max: usize,
    ) -> Vec<Suggestion> {
        HistoryAnalyzer::suggest_from_history(ctx, max)
            .into_iter()
            .map(|(cmd, confidence)| Suggestion {
                text: cmd.clone(),
                display: cmd,
                kind: SuggestionKind::HistoryRecall,
                description: Some("From history".to_string()),
                confidence: confidence * 0.8, // Slightly lower than AI suggestions
                source: SuggestionSource::History,
                insert_text: None,
                documentation: None,
                risk_level: RiskLevel::Safe,
                tags: vec!["history".to_string()],
            })
            .collect()
    }

    /// Built-in heuristic suggestions based on command line state.
    fn builtin_suggestions(
        state: &CommandLineState,
        shell: &ShellType,
        os: &OsType,
    ) -> Vec<Suggestion> {
        match state {
            CommandLineState::Empty => Self::common_first_commands(shell, os),
            CommandLineState::AfterPipe => Self::common_pipe_targets(),
            CommandLineState::AfterRedirect => Vec::new(),
            CommandLineState::ChainedCommand => Self::common_first_commands(shell, os),
            CommandLineState::PartialFlag { command, partial } => {
                Self::common_flags(command, partial)
            }
            CommandLineState::ExpectingArgument { command, args_so_far } => {
                Self::common_arguments(command, args_so_far)
            }
            _ => Vec::new(),
        }
    }

    fn common_first_commands(shell: &ShellType, _os: &OsType) -> Vec<Suggestion> {
        let commands = vec![
            ("ls", "List directory contents"),
            ("cd", "Change directory"),
            ("cat", "Concatenate and display files"),
            ("grep", "Search text patterns"),
            ("find", "Find files"),
            ("ps", "List processes"),
            ("top", "System monitor"),
            ("df", "Disk free space"),
            ("du", "Disk usage"),
            ("tail", "View file tail"),
            ("head", "View file head"),
            ("mkdir", "Create directory"),
            ("cp", "Copy files"),
            ("mv", "Move/rename files"),
            ("rm", "Remove files"),
            ("chmod", "Change permissions"),
            ("chown", "Change ownership"),
            ("curl", "HTTP client"),
            ("wget", "Download files"),
            ("ssh", "SSH client"),
            ("scp", "Secure copy"),
            ("tar", "Archive manager"),
            ("zip", "Compress files"),
            ("unzip", "Extract zip files"),
            ("docker", "Docker container manager"),
            ("git", "Version control"),
            ("systemctl", "Systemd service control"),
            ("journalctl", "View system logs"),
            ("apt", "Package manager (Debian)"),
            ("yum", "Package manager (RHEL)"),
        ];

        commands.iter().map(|(cmd, desc)| {
            Suggestion {
                text: cmd.to_string(),
                display: cmd.to_string(),
                kind: SuggestionKind::Command,
                description: Some(desc.to_string()),
                confidence: 0.3,
                source: SuggestionSource::Builtin,
                insert_text: None,
                documentation: None,
                risk_level: RiskLevel::Safe,
                tags: Vec::new(),
            }
        }).collect()
    }

    fn common_pipe_targets() -> Vec<Suggestion> {
        let targets = vec![
            ("grep", "Filter output by pattern"),
            ("awk", "Text processing"),
            ("sed", "Stream editor"),
            ("sort", "Sort lines"),
            ("uniq", "Remove duplicate lines"),
            ("wc", "Word/line/byte count"),
            ("head", "First N lines"),
            ("tail", "Last N lines"),
            ("cut", "Cut columns"),
            ("tr", "Translate characters"),
            ("xargs", "Build and execute commands"),
            ("tee", "Write to file and stdout"),
            ("less", "Pager"),
            ("jq", "JSON processor"),
            ("column", "Columnate output"),
        ];

        targets.iter().map(|(cmd, desc)| {
            Suggestion {
                text: cmd.to_string(),
                display: cmd.to_string(),
                kind: SuggestionKind::Pipe,
                description: Some(desc.to_string()),
                confidence: 0.5,
                source: SuggestionSource::Builtin,
                insert_text: Some(format!(" {}", cmd)),
                documentation: None,
                risk_level: RiskLevel::Safe,
                tags: vec!["pipe".to_string()],
            }
        }).collect()
    }

    fn common_flags(command: &str, partial: &str) -> Vec<Suggestion> {
        let flag_db = get_common_flags_db();
        let flags = match flag_db.get(command) {
            Some(f) => f,
            None => return Vec::new(),
        };

        flags.iter()
            .filter(|(flag, _, _)| flag.starts_with(partial))
            .map(|(flag, long, desc)| {
                Suggestion {
                    text: flag.to_string(),
                    display: if long.is_empty() {
                        flag.to_string()
                    } else {
                        format!("{} / {}", flag, long)
                    },
                    kind: SuggestionKind::Flag,
                    description: Some(desc.to_string()),
                    confidence: 0.6,
                    source: SuggestionSource::Builtin,
                    insert_text: None,
                    documentation: None,
                    risk_level: RiskLevel::Safe,
                    tags: Vec::new(),
                }
            })
            .collect()
    }

    fn common_arguments(command: &str, _args_so_far: &[String]) -> Vec<Suggestion> {
        let mut suggestions = Vec::new();

        match command {
            "git" => {
                let subcommands = vec![
                    ("status", "Show working tree status"),
                    ("add", "Add file contents to index"),
                    ("commit", "Record changes to repository"),
                    ("push", "Update remote refs"),
                    ("pull", "Fetch and integrate"),
                    ("branch", "List, create, or delete branches"),
                    ("checkout", "Switch branches"),
                    ("merge", "Join branches"),
                    ("log", "Show commit logs"),
                    ("diff", "Show changes"),
                    ("stash", "Stash changes"),
                    ("rebase", "Reapply commits"),
                    ("clone", "Clone a repository"),
                    ("fetch", "Download objects"),
                    ("reset", "Reset HEAD"),
                    ("tag", "Create/list/delete tags"),
                ];
                for (sub, desc) in subcommands {
                    suggestions.push(Suggestion {
                        text: sub.to_string(),
                        display: sub.to_string(),
                        kind: SuggestionKind::Argument,
                        description: Some(desc.to_string()),
                        confidence: 0.7,
                        source: SuggestionSource::Builtin,
                        insert_text: None,
                        documentation: None,
                        risk_level: RiskLevel::Safe,
                        tags: vec!["git".to_string()],
                    });
                }
            }
            "docker" => {
                let subcommands = vec![
                    ("ps", "List containers"),
                    ("run", "Run a command in a new container"),
                    ("build", "Build an image"),
                    ("pull", "Pull an image"),
                    ("push", "Push an image"),
                    ("images", "List images"),
                    ("exec", "Execute in running container"),
                    ("stop", "Stop containers"),
                    ("start", "Start containers"),
                    ("rm", "Remove containers"),
                    ("rmi", "Remove images"),
                    ("logs", "Fetch container logs"),
                    ("compose", "Docker Compose"),
                    ("network", "Manage networks"),
                    ("volume", "Manage volumes"),
                ];
                for (sub, desc) in subcommands {
                    suggestions.push(Suggestion {
                        text: sub.to_string(),
                        display: sub.to_string(),
                        kind: SuggestionKind::Argument,
                        description: Some(desc.to_string()),
                        confidence: 0.7,
                        source: SuggestionSource::Builtin,
                        insert_text: None,
                        documentation: None,
                        risk_level: RiskLevel::Safe,
                        tags: vec!["docker".to_string()],
                    });
                }
            }
            "systemctl" => {
                let subcommands = vec![
                    ("start", "Start a unit"),
                    ("stop", "Stop a unit"),
                    ("restart", "Restart a unit"),
                    ("reload", "Reload a unit"),
                    ("status", "Show unit status"),
                    ("enable", "Enable a unit"),
                    ("disable", "Disable a unit"),
                    ("daemon-reload", "Reload systemd daemon"),
                    ("list-units", "List loaded units"),
                    ("is-active", "Check if active"),
                ];
                for (sub, desc) in subcommands {
                    suggestions.push(Suggestion {
                        text: sub.to_string(),
                        display: sub.to_string(),
                        kind: SuggestionKind::Argument,
                        description: Some(desc.to_string()),
                        confidence: 0.7,
                        source: SuggestionSource::Builtin,
                        insert_text: None,
                        documentation: None,
                        risk_level: RiskLevel::Safe,
                        tags: vec!["systemctl".to_string()],
                    });
                }
            }
            "kubectl" => {
                let subcommands = vec![
                    ("get", "Display resources"),
                    ("describe", "Show resource details"),
                    ("apply", "Apply configuration"),
                    ("delete", "Delete resources"),
                    ("logs", "Print pod logs"),
                    ("exec", "Execute in a container"),
                    ("port-forward", "Forward ports"),
                    ("scale", "Scale a resource"),
                    ("rollout", "Manage rollouts"),
                    ("config", "Modify kubeconfig"),
                    ("create", "Create a resource"),
                    ("edit", "Edit a resource"),
                    ("top", "Display resource usage"),
                ];
                for (sub, desc) in subcommands {
                    suggestions.push(Suggestion {
                        text: sub.to_string(),
                        display: sub.to_string(),
                        kind: SuggestionKind::Argument,
                        description: Some(desc.to_string()),
                        confidence: 0.7,
                        source: SuggestionSource::Builtin,
                        insert_text: None,
                        documentation: None,
                        risk_level: RiskLevel::Safe,
                        tags: vec!["kubernetes".to_string()],
                    });
                }
            }
            _ => {}
        }

        suggestions
    }

    fn fuzzy_match_commands(partial: &str, installed: &[String]) -> Vec<Suggestion> {
        use fuzzy_matcher::FuzzyMatcher;
        use fuzzy_matcher::skim::SkimMatcherV2;

        let matcher = SkimMatcherV2::default();
        let mut results: Vec<(String, i64)> = installed.iter()
            .filter_map(|tool| {
                matcher.fuzzy_match(tool, partial)
                    .map(|score| (tool.clone(), score))
            })
            .collect();

        results.sort_by(|a, b| b.1.cmp(&a.1));
        results.truncate(10);

        results.into_iter().map(|(tool, score)| {
            let confidence = (score as f64 / 100.0).min(1.0).max(0.1);
            Suggestion {
                text: tool.clone(),
                display: tool,
                kind: SuggestionKind::Command,
                description: Some("Installed tool (fuzzy match)".to_string()),
                confidence,
                source: SuggestionSource::Fuzzy,
                insert_text: None,
                documentation: None,
                risk_level: RiskLevel::Safe,
                tags: vec!["fuzzy".to_string()],
            }
        }).collect()
    }

    fn deduplicate_and_sort(suggestions: &mut Vec<Suggestion>) {
        // Deduplicate by text
        let mut seen: HashMap<String, usize> = HashMap::new();
        let mut unique: Vec<Suggestion> = Vec::new();

        for s in suggestions.drain(..) {
            if let Some(&idx) = seen.get(&s.text) {
                // Keep higher confidence
                if s.confidence > unique[idx].confidence {
                    unique[idx] = s;
                }
            } else {
                seen.insert(s.text.clone(), unique.len());
                unique.push(s);
            }
        }

        unique.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
        *suggestions = unique;
    }
}

/// Database of common flags for well-known commands.
fn get_common_flags_db() -> HashMap<&'static str, Vec<(&'static str, &'static str, &'static str)>> {
    let mut db: HashMap<&str, Vec<(&str, &str, &str)>> = HashMap::new();

    db.insert("ls", vec![
        ("-l", "--long", "Long listing format"),
        ("-a", "--all", "Include hidden files"),
        ("-h", "--human-readable", "Human-readable sizes"),
        ("-R", "--recursive", "List subdirectories recursively"),
        ("-t", "", "Sort by modification time"),
        ("-S", "", "Sort by file size"),
        ("-r", "--reverse", "Reverse sort order"),
    ]);

    db.insert("grep", vec![
        ("-i", "--ignore-case", "Case insensitive"),
        ("-r", "--recursive", "Search recursively"),
        ("-n", "--line-number", "Show line numbers"),
        ("-l", "--files-with-matches", "Only show filenames"),
        ("-v", "--invert-match", "Invert match"),
        ("-c", "--count", "Count matches"),
        ("-E", "--extended-regexp", "Extended regex"),
        ("-w", "--word-regexp", "Match whole words"),
        ("-A", "--after-context", "Lines after match"),
        ("-B", "--before-context", "Lines before match"),
    ]);

    db.insert("find", vec![
        ("-name", "", "Match filename pattern"),
        ("-type", "", "File type (f/d/l)"),
        ("-size", "", "File size"),
        ("-mtime", "", "Modified time"),
        ("-exec", "", "Execute command"),
        ("-delete", "", "Delete matching files"),
        ("-maxdepth", "", "Max directory depth"),
        ("-mindepth", "", "Min directory depth"),
        ("-perm", "", "File permissions"),
    ]);

    db.insert("curl", vec![
        ("-X", "--request", "HTTP method"),
        ("-H", "--header", "Add header"),
        ("-d", "--data", "POST data"),
        ("-o", "--output", "Output to file"),
        ("-s", "--silent", "Silent mode"),
        ("-v", "--verbose", "Verbose output"),
        ("-L", "--location", "Follow redirects"),
        ("-k", "--insecure", "Skip TLS verification"),
        ("-u", "--user", "User:password"),
        ("-I", "--head", "HEAD request only"),
    ]);

    db.insert("tar", vec![
        ("-c", "--create", "Create archive"),
        ("-x", "--extract", "Extract archive"),
        ("-z", "--gzip", "Gzip compression"),
        ("-j", "--bzip2", "Bzip2 compression"),
        ("-v", "--verbose", "Verbose output"),
        ("-f", "--file", "Archive file name"),
        ("-t", "--list", "List archive contents"),
        ("-C", "--directory", "Change to directory"),
    ]);

    db.insert("ssh", vec![
        ("-p", "", "Port"),
        ("-i", "", "Identity file"),
        ("-L", "", "Local port forwarding"),
        ("-R", "", "Remote port forwarding"),
        ("-D", "", "Dynamic port forwarding (SOCKS)"),
        ("-N", "", "No remote command"),
        ("-f", "", "Background before command"),
        ("-v", "", "Verbose mode"),
        ("-o", "", "SSH option"),
        ("-J", "", "Jump host"),
    ]);

    db.insert("chmod", vec![
        ("-R", "--recursive", "Recursive"),
        ("-v", "--verbose", "Verbose"),
        ("-c", "--changes", "Only report changes"),
    ]);

    db.insert("rsync", vec![
        ("-a", "--archive", "Archive mode"),
        ("-v", "--verbose", "Verbose"),
        ("-z", "--compress", "Compress during transfer"),
        ("-P", "--progress", "Show progress"),
        ("-n", "--dry-run", "Dry run"),
        ("-e", "", "Specify remote shell"),
        ("--delete", "", "Delete extraneous files"),
        ("--exclude", "", "Exclude files matching pattern"),
    ]);

    db.insert("apt", vec![
        ("install", "", "Install packages"),
        ("remove", "", "Remove packages"),
        ("update", "", "Update package lists"),
        ("upgrade", "", "Upgrade packages"),
        ("search", "", "Search packages"),
        ("show", "", "Show package details"),
        ("autoremove", "", "Remove unused packages"),
    ]);

    db
}
