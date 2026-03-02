use crate::types::{HistoryEntry, HistoryPattern, HistoryAnalysis, SessionContext};
use crate::error::AiAssistError;
use std::collections::HashMap;
use chrono::Utc;

/// Analyzes command history for patterns, frequent commands, and sequences.
pub struct HistoryAnalyzer;

impl HistoryAnalyzer {
    /// Perform a full analysis of command history.
    pub fn analyze(entries: &[HistoryEntry]) -> HistoryAnalysis {
        let total = entries.len();
        let mut freq: HashMap<String, u64> = HashMap::new();
        let mut error_count: u64 = 0;

        for entry in entries {
            let base = Self::normalize_command(&entry.command);
            *freq.entry(base).or_insert(0) += 1;
            if let Some(code) = entry.exit_code {
                if code != 0 {
                    error_count += 1;
                }
            }
        }

        let unique_commands = freq.len();

        let mut top_commands: Vec<(String, u64)> = freq.into_iter().collect();
        top_commands.sort_by(|a, b| b.1.cmp(&a.1));
        top_commands.truncate(20);

        let patterns = Self::detect_patterns(entries);
        let common_sequences = Self::detect_sequences(entries, 3);

        let time_distribution = Self::time_distribution(entries);

        let error_rate = if total > 0 {
            error_count as f64 / total as f64
        } else {
            0.0
        };

        HistoryAnalysis {
            total_commands: total,
            unique_commands,
            top_commands,
            patterns,
            common_sequences,
            time_distribution,
            error_rate,
        }
    }

    /// Normalize a command to its base form (strip arguments for counting).
    fn normalize_command(cmd: &str) -> String {
        let trimmed = cmd.trim();
        // Take the first word (the actual command)
        let base = trimmed.split_whitespace().next().unwrap_or(trimmed);
        // Remove common prefixes
        let result = base
            .trim_start_matches("sudo ")
            .trim_start_matches("nohup ")
            .trim_start_matches("time ");
        result.to_string()
    }

    /// Detect recurring command patterns.
    fn detect_patterns(entries: &[HistoryEntry]) -> Vec<HistoryPattern> {
        let mut pattern_map: HashMap<String, Vec<&HistoryEntry>> = HashMap::new();

        for entry in entries {
            let pattern = Self::extract_pattern(&entry.command);
            pattern_map.entry(pattern).or_default().push(entry);
        }

        let mut patterns: Vec<HistoryPattern> = Vec::new();

        for (pattern, occurrences) in &pattern_map {
            if occurrences.len() < 2 {
                continue;
            }

            let last = occurrences.last().map(|e| e.timestamp).unwrap_or_else(Utc::now);
            let typical_sequence: Vec<String> = occurrences.iter()
                .take(5)
                .map(|e| e.command.clone())
                .collect();

            let frequency = occurrences.len() as u64;
            let confidence = (frequency as f64 / entries.len() as f64).min(1.0);

            patterns.push(HistoryPattern {
                pattern: pattern.clone(),
                frequency,
                last_used: last,
                typical_sequence,
                confidence,
            });
        }

        patterns.sort_by(|a, b| b.frequency.cmp(&a.frequency));
        patterns.truncate(20);
        patterns
    }

    /// Extract a pattern from a command by replacing specific arguments with placeholders.
    fn extract_pattern(cmd: &str) -> String {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        if parts.is_empty() {
            return String::new();
        }

        let mut pattern_parts: Vec<String> = Vec::new();
        pattern_parts.push(parts[0].to_string());

        for part in &parts[1..] {
            if part.starts_with('-') {
                // Keep flags
                pattern_parts.push(part.to_string());
            } else if part.contains('/') {
                // Replace paths with placeholder
                pattern_parts.push("<path>".to_string());
            } else if part.parse::<f64>().is_ok() {
                // Replace numbers with placeholder
                pattern_parts.push("<num>".to_string());
            } else if part.contains('@') {
                pattern_parts.push("<addr>".to_string());
            } else if part.contains('.') && part.len() > 3 {
                pattern_parts.push("<file>".to_string());
            } else {
                pattern_parts.push("<arg>".to_string());
            }
        }

        pattern_parts.join(" ")
    }

    /// Detect common command sequences (n-grams).
    fn detect_sequences(entries: &[HistoryEntry], min_count: usize) -> Vec<Vec<String>> {
        if entries.len() < 2 {
            return Vec::new();
        }

        let mut bigrams: HashMap<(String, String), usize> = HashMap::new();
        let mut trigrams: HashMap<(String, String, String), usize> = HashMap::new();

        for window in entries.windows(2) {
            let cmd1 = Self::normalize_command(&window[0].command);
            let cmd2 = Self::normalize_command(&window[1].command);
            *bigrams.entry((cmd1, cmd2)).or_insert(0) += 1;
        }

        for window in entries.windows(3) {
            let cmd1 = Self::normalize_command(&window[0].command);
            let cmd2 = Self::normalize_command(&window[1].command);
            let cmd3 = Self::normalize_command(&window[2].command);
            *trigrams.entry((cmd1, cmd2, cmd3)).or_insert(0) += 1;
        }

        let mut sequences: Vec<Vec<String>> = Vec::new();

        for ((a, b), count) in &bigrams {
            if *count >= min_count {
                sequences.push(vec![a.clone(), b.clone()]);
            }
        }

        for ((a, b, c), count) in &trigrams {
            if *count >= min_count {
                sequences.push(vec![a.clone(), b.clone(), c.clone()]);
            }
        }

        sequences.sort_by(|a, b| b.len().cmp(&a.len()));
        sequences.truncate(20);
        sequences
    }

    /// Analyze time distribution of commands (by hour of day).
    fn time_distribution(entries: &[HistoryEntry]) -> Vec<(String, u64)> {
        let mut hourly: HashMap<u32, u64> = HashMap::new();

        for entry in entries {
            let hour = entry.timestamp.format("%H").to_string().parse::<u32>().unwrap_or(0);
            *hourly.entry(hour).or_insert(0) += 1;
        }

        let mut result: Vec<(String, u64)> = hourly.into_iter()
            .map(|(h, c)| (format!("{:02}:00", h), c))
            .collect();
        result.sort_by(|a, b| a.0.cmp(&b.0));
        result
    }

    /// Suggest next commands based on history patterns.
    pub fn suggest_from_history(ctx: &SessionContext, max: usize) -> Vec<(String, f64)> {
        if ctx.history.is_empty() {
            return Vec::new();
        }

        let last_cmd = match ctx.history.last() {
            Some(entry) => Self::normalize_command(&entry.command),
            None => return Vec::new(),
        };

        // Build bigram frequencies from history
        let mut followers: HashMap<String, usize> = HashMap::new();
        for window in ctx.history.windows(2) {
            let prev = Self::normalize_command(&window[0].command);
            if prev == last_cmd {
                let next = window[1].command.clone();
                *followers.entry(next).or_insert(0) += 1;
            }
        }

        let total: usize = followers.values().sum();
        if total == 0 {
            return Vec::new();
        }

        let mut suggestions: Vec<(String, f64)> = followers.into_iter()
            .map(|(cmd, count)| {
                let confidence = count as f64 / total as f64;
                (cmd, confidence)
            })
            .collect();

        suggestions.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        suggestions.truncate(max);
        suggestions
    }
}
