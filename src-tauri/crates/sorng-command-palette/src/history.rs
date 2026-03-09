use chrono::Utc;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use std::collections::HashMap;

use crate::types::*;

/// Manages command history with frecency-based ranking, deduplication,
/// contextual filtering, and fuzzy search.
pub struct HistoryEngine {
    /// All history entries keyed by a normalised command string.
    entries: Vec<HistoryEntry>,
    /// Frecency config.
    config: FrecencyConfig,
    /// Re-usable fuzzy matcher.
    matcher: SkimMatcherV2,
    /// Whether data has been modified since last save.
    dirty: bool,
}

impl HistoryEngine {
    // ───────── Construction ─────────

    pub fn new(config: FrecencyConfig) -> Self {
        Self {
            entries: Vec::new(),
            config,
            matcher: SkimMatcherV2::default(),
            dirty: false,
        }
    }

    pub fn load(&mut self, entries: Vec<HistoryEntry>) {
        self.entries = entries;
        self.dirty = false;
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }

    // ───────── Recording ─────────

    /// Record a command execution.  Deduplicates by normalised command string,
    /// incrementing `use_count` and updating timestamps for existing entries.
    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        command: &str,
        session_id: &str,
        host: Option<&str>,
        username: Option<&str>,
        cwd: Option<&str>,
        exit_code: Option<i32>,
        duration_ms: Option<u64>,
    ) {
        let normalised = normalise_command(command);
        if normalised.is_empty() {
            return;
        }

        let now = Utc::now();

        // Try to find an existing entry for this exact command.
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| normalise_command(&e.command) == normalised)
        {
            entry.use_count += 1;
            entry.last_used = now;
            entry.session_id = session_id.to_string();
            if let Some(h) = host {
                entry.host = Some(h.to_string());
            }
            if let Some(u) = username {
                entry.username = Some(u.to_string());
            }
            if let Some(c) = cwd {
                entry.cwd = Some(c.to_string());
            }
            entry.exit_code = exit_code;
            entry.duration_ms = duration_ms;
        } else {
            self.entries.push(HistoryEntry {
                command: command.to_string(),
                session_id: session_id.to_string(),
                host: host.map(|s| s.to_string()),
                username: username.map(|s| s.to_string()),
                cwd: cwd.map(|s| s.to_string()),
                exit_code,
                duration_ms,
                first_used: now,
                last_used: now,
                use_count: 1,
                tags: Vec::new(),
                pinned: false,
                os_context: None,
            });
        }

        // Enforce max entries.
        self.enforce_limit();
        self.dirty = true;
    }

    // ───────── Frecency scoring ─────────

    /// Compute the frecency score for a single entry.  Higher is better.
    pub fn frecency_score(&self, entry: &HistoryEntry) -> f64 {
        let now = Utc::now();
        let hours_ago = (now - entry.last_used).num_seconds().max(0) as f64 / 3600.0;

        // Exponential recency decay
        let recency = (-hours_ago.ln().max(0.0) / self.config.half_life_hours).exp();

        // Log-scaled frequency (diminishing returns).
        let frequency = (entry.use_count as f64).ln_1p();

        // Pinned items get a bonus.
        let pin_bonus: f64 = if entry.pinned { 0.3 } else { 0.0 };

        let score = self.config.recency_weight * recency
            + self.config.frequency_weight * frequency
            + pin_bonus;

        // Clamp to 0..1 range.
        score.clamp(0.0, 1.0)
    }

    // ───────── Querying ─────────

    /// Search history with a fuzzy query and return results sorted by
    /// combined score (fuzzy_score × frecency).
    pub fn search(&self, query: &str, max: usize) -> Vec<(HistoryEntry, f64)> {
        if query.is_empty() {
            // No query — return top frecency entries.
            return self.top_frecency(max);
        }

        let mut results: Vec<(HistoryEntry, f64)> = Vec::new();

        for entry in &self.entries {
            if let Some(fuzzy_score) = self.matcher.fuzzy_match(&entry.command, query) {
                // Normalise skim score (typically 0..200+) to 0..1 range.
                let norm_fuzzy = (fuzzy_score as f64 / 200.0).clamp(0.0, 1.0);
                let frecency = self.frecency_score(entry);
                let combined = 0.5 * norm_fuzzy + 0.5 * frecency;
                results.push((entry.clone(), combined));
            }
        }

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(max);
        results
    }

    /// Return entries sorted by frecency (no fuzzy filter).
    pub fn top_frecency(&self, max: usize) -> Vec<(HistoryEntry, f64)> {
        let mut scored: Vec<(HistoryEntry, f64)> = self
            .entries
            .iter()
            .map(|e| (e.clone(), self.frecency_score(e)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(max);
        scored
    }

    /// Get entries filtered by host.
    pub fn by_host(&self, host: &str, max: usize) -> Vec<(HistoryEntry, f64)> {
        let mut scored: Vec<(HistoryEntry, f64)> = self
            .entries
            .iter()
            .filter(|e| e.host.as_deref() == Some(host))
            .map(|e| (e.clone(), self.frecency_score(e)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(max);
        scored
    }

    /// Get entries filtered by session.
    pub fn by_session(&self, session_id: &str, max: usize) -> Vec<(HistoryEntry, f64)> {
        let mut scored: Vec<(HistoryEntry, f64)> = self
            .entries
            .iter()
            .filter(|e| e.session_id == session_id)
            .map(|e| (e.clone(), self.frecency_score(e)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(max);
        scored
    }

    /// Get commands that frequently follow the given command
    /// (bigram prediction).
    pub fn predict_next(&self, last_command: &str, max: usize) -> Vec<(String, f64)> {
        let norm = normalise_command(last_command);
        let mut followers: HashMap<String, u64> = HashMap::new();

        // Walk through entries pairwise (sorted by last_used ascending).
        let mut sorted: Vec<&HistoryEntry> = self.entries.iter().collect();
        sorted.sort_by_key(|e| e.last_used);

        for window in sorted.windows(2) {
            if normalise_command(&window[0].command) == norm {
                *followers.entry(window[1].command.clone()).or_insert(0) += 1;
            }
        }

        let total: u64 = followers.values().sum();
        if total == 0 {
            return Vec::new();
        }

        let mut pairs: Vec<(String, f64)> = followers
            .into_iter()
            .map(|(cmd, count)| (cmd, count as f64 / total as f64))
            .collect();
        pairs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        pairs.truncate(max);
        pairs
    }

    // ───────── Mutation ─────────

    /// Pin / unpin a command.
    pub fn set_pinned(&mut self, command: &str, pinned: bool) -> bool {
        let norm = normalise_command(command);
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| normalise_command(&e.command) == norm)
        {
            entry.pinned = pinned;
            self.dirty = true;
            true
        } else {
            false
        }
    }

    /// Tag a history entry.
    pub fn add_tag(&mut self, command: &str, tag: &str) -> bool {
        let norm = normalise_command(command);
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| normalise_command(&e.command) == norm)
        {
            if !entry.tags.contains(&tag.to_string()) {
                entry.tags.push(tag.to_string());
                self.dirty = true;
            }
            true
        } else {
            false
        }
    }

    /// Remove a specific command from history.
    pub fn remove(&mut self, command: &str) -> bool {
        let norm = normalise_command(command);
        let before = self.entries.len();
        self.entries
            .retain(|e| normalise_command(&e.command) != norm);
        let removed = self.entries.len() < before;
        if removed {
            self.dirty = true;
        }
        removed
    }

    /// Clear all history.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.dirty = true;
    }

    // ───────── Analytics ─────────

    /// Return high-level stats.
    #[allow(clippy::type_complexity)]
    pub fn stats(&self) -> (usize, usize, Vec<(String, u64)>, HashMap<String, usize>) {
        let total = self.entries.len();

        let mut cmd_counts: HashMap<String, u64> = HashMap::new();
        let mut host_counts: HashMap<String, usize> = HashMap::new();

        for e in &self.entries {
            *cmd_counts.entry(normalise_command(&e.command)).or_insert(0) += e.use_count;
            if let Some(ref h) = e.host {
                *host_counts.entry(h.clone()).or_insert(0) += 1;
            }
        }

        let unique = cmd_counts.len();
        let mut top: Vec<(String, u64)> = cmd_counts.into_iter().collect();
        top.sort_by(|a, b| b.1.cmp(&a.1));
        top.truncate(20);

        (total, unique, top, host_counts)
    }

    /// Import a pre-built history entry (for loading from disk).
    /// Deduplicates by normalised command; if already present, keeps the one
    /// with the higher use_count and the more recent last_used.
    pub fn import_entry(&mut self, entry: HistoryEntry) {
        let norm = normalise_command(&entry.command);
        if norm.is_empty() {
            return;
        }
        if let Some(existing) = self
            .entries
            .iter_mut()
            .find(|e| normalise_command(&e.command) == norm)
        {
            if entry.use_count > existing.use_count {
                existing.use_count = entry.use_count;
            }
            if entry.last_used > existing.last_used {
                existing.last_used = entry.last_used;
                existing.session_id = entry.session_id;
                existing.host = entry.host.or(existing.host.take());
                existing.username = entry.username.or(existing.username.take());
                existing.cwd = entry.cwd.or(existing.cwd.take());
                existing.exit_code = entry.exit_code.or(existing.exit_code);
                existing.duration_ms = entry.duration_ms.or(existing.duration_ms);
            }
            // Merge tags.
            for tag in entry.tags {
                if !existing.tags.contains(&tag) {
                    existing.tags.push(tag);
                }
            }
            existing.pinned = existing.pinned || entry.pinned;
        } else {
            self.entries.push(entry);
        }
        self.dirty = true;
    }

    /// Return all entries (for persistence).
    pub fn entries(&self) -> &[HistoryEntry] {
        &self.entries
    }

    // ───────── Internal ─────────

    fn enforce_limit(&mut self) {
        if self.entries.len() > self.config.max_entries {
            // Pre-compute scores to avoid borrowing self inside the closure.
            let config = self.config.clone();
            let scores: Vec<f64> = self
                .entries
                .iter()
                .map(|e| Self::frecency_score_static(e, &config))
                .collect();
            let mut indices: Vec<usize> = (0..self.entries.len()).collect();
            indices.sort_by(|&a, &b| {
                scores[b]
                    .partial_cmp(&scores[a])
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            indices.truncate(self.config.max_entries);
            indices.sort_unstable(); // Restore order.
            let mut new_entries = Vec::with_capacity(indices.len());
            for i in indices {
                new_entries.push(self.entries[i].clone());
            }
            self.entries = new_entries;
        }
    }

    /// Static frecency scoring (avoids &self borrow).
    fn frecency_score_static(entry: &HistoryEntry, config: &FrecencyConfig) -> f64 {
        let now = chrono::Utc::now();
        let hours_since = (now - entry.last_used).num_minutes() as f64 / 60.0;
        let recency = (-hours_since / config.half_life_hours).exp();
        let frequency = (entry.use_count as f64).ln_1p();
        config.recency_weight * recency + config.frequency_weight * frequency
    }
}

/// Normalise a command for deduplication: trim whitespace, collapse multiple
/// spaces, lowercase.
fn normalise_command(cmd: &str) -> String {
    cmd.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
