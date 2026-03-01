//! In-memory vault storage for TOTP entries and groups.
//!
//! Provides CRUD operations, search/filter, sorting, deduplication,
//! backup/restore, and persistence helpers (load/save JSON from disk).

use std::collections::HashMap;

use crate::totp::types::*;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Vault
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// In-memory TOTP vault.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TotpVault {
    pub meta: VaultMeta,
    pub entries: Vec<TotpEntry>,
    pub groups: Vec<TotpGroup>,
}

impl Default for TotpVault {
    fn default() -> Self {
        Self::new()
    }
}

impl TotpVault {
    pub fn new() -> Self {
        Self {
            meta: VaultMeta::default(),
            entries: Vec::new(),
            groups: Vec::new(),
        }
    }

    // ── Entry CRUD ───────────────────────────────────────────────

    /// Add an entry. Returns the entry's ID.
    pub fn add_entry(&mut self, entry: TotpEntry) -> String {
        let id = entry.id.clone();
        self.entries.push(entry);
        self.meta.entry_count = self.entries.len();
        self.touch();
        id
    }

    /// Get an entry by ID (immutable).
    pub fn get_entry(&self, id: &str) -> Option<&TotpEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Get an entry by ID (mutable).
    pub fn get_entry_mut(&mut self, id: &str) -> Option<&mut TotpEntry> {
        self.entries.iter_mut().find(|e| e.id == id)
    }

    /// Update an entry. Returns `true` if found and updated.
    pub fn update_entry(&mut self, updated: TotpEntry) -> bool {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.id == updated.id) {
            *entry = updated;
            entry.updated_at = chrono::Utc::now();
            self.touch();
            true
        } else {
            false
        }
    }

    /// Remove an entry by ID. Returns the removed entry if found.
    pub fn remove_entry(&mut self, id: &str) -> Option<TotpEntry> {
        let pos = self.entries.iter().position(|e| e.id == id)?;
        let entry = self.entries.remove(pos);
        self.meta.entry_count = self.entries.len();
        self.touch();
        Some(entry)
    }

    /// List all entries.
    pub fn list_entries(&self) -> &[TotpEntry] {
        &self.entries
    }

    /// List entries matching a filter.
    pub fn filter_entries(&self, filter: &EntryFilter) -> Vec<&TotpEntry> {
        self.entries.iter().filter(|e| filter.matches(e)).collect()
    }

    /// Search entries by text (matches label, issuer, notes, tags).
    pub fn search(&self, query: &str) -> Vec<&TotpEntry> {
        let q = query.to_lowercase();
        self.entries
            .iter()
            .filter(|e| {
                e.label.to_lowercase().contains(&q)
                    || e.issuer
                        .as_deref()
                        .map_or(false, |i| i.to_lowercase().contains(&q))
                    || e.notes
                        .as_deref()
                        .map_or(false, |n| n.to_lowercase().contains(&q))
                    || e.tags.iter().any(|t| t.to_lowercase().contains(&q))
            })
            .collect()
    }

    // ── Group CRUD ───────────────────────────────────────────────

    /// Add a group. Returns the group's ID.
    pub fn add_group(&mut self, group: TotpGroup) -> String {
        let id = group.id.clone();
        self.groups.push(group);
        self.touch();
        id
    }

    /// Get a group by ID.
    pub fn get_group(&self, id: &str) -> Option<&TotpGroup> {
        self.groups.iter().find(|g| g.id == id)
    }

    /// Update a group. Returns `true` if found.
    pub fn update_group(&mut self, updated: TotpGroup) -> bool {
        if let Some(group) = self.groups.iter_mut().find(|g| g.id == updated.id) {
            *group = updated;
            self.touch();
            true
        } else {
            false
        }
    }

    /// Remove a group and unlink any entries referencing it.
    pub fn remove_group(&mut self, id: &str) -> Option<TotpGroup> {
        let pos = self.groups.iter().position(|g| g.id == id)?;
        let group = self.groups.remove(pos);
        // Unlink entries
        for entry in &mut self.entries {
            if entry.group_id.as_deref() == Some(id) {
                entry.group_id = None;
            }
        }
        self.touch();
        Some(group)
    }

    /// List all groups.
    pub fn list_groups(&self) -> &[TotpGroup] {
        &self.groups
    }

    /// Get entries in a specific group.
    pub fn entries_in_group(&self, group_id: &str) -> Vec<&TotpEntry> {
        self.entries
            .iter()
            .filter(|e| e.group_id.as_deref() == Some(group_id))
            .collect()
    }

    /// Get entries not in any group.
    pub fn ungrouped_entries(&self) -> Vec<&TotpEntry> {
        self.entries
            .iter()
            .filter(|e| e.group_id.is_none())
            .collect()
    }

    // ── Sorting ──────────────────────────────────────────────────

    /// Sort entries by sort_order, then by label.
    pub fn sort_entries(&mut self) {
        self.entries
            .sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.label.cmp(&b.label)));
    }

    /// Sort groups by sort_order, then by name.
    pub fn sort_groups(&mut self) {
        self.groups
            .sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.name.cmp(&b.name)));
    }

    /// Reorder an entry. Moves entry at `from_idx` to `to_idx` and
    /// recalculates sort_order for all entries.
    pub fn reorder_entry(&mut self, from_idx: usize, to_idx: usize) -> bool {
        if from_idx >= self.entries.len() || to_idx >= self.entries.len() {
            return false;
        }
        let entry = self.entries.remove(from_idx);
        self.entries.insert(to_idx, entry);
        for (i, e) in self.entries.iter_mut().enumerate() {
            e.sort_order = i as i32;
        }
        self.touch();
        true
    }

    // ── Favourites ───────────────────────────────────────────────

    /// Toggle favourite status. Returns new status.
    pub fn toggle_favourite(&mut self, id: &str) -> Option<bool> {
        let entry = self.get_entry_mut(id)?;
        entry.favourite = !entry.favourite;
        let fav = entry.favourite;
        self.touch();
        Some(fav)
    }

    /// List favourite entries.
    pub fn favourites(&self) -> Vec<&TotpEntry> {
        self.entries.iter().filter(|e| e.favourite).collect()
    }

    // ── Track usage ──────────────────────────────────────────────

    /// Record that an entry's code was used (bumps use_count, updates last_used_at).
    pub fn record_use(&mut self, id: &str) {
        if let Some(entry) = self.get_entry_mut(id) {
            entry.use_count += 1;
            entry.last_used_at = Some(chrono::Utc::now());
        }
    }

    // ── Deduplication ────────────────────────────────────────────

    /// Find duplicate entries (same issuer + secret).
    pub fn find_duplicates(&self) -> Vec<Vec<&TotpEntry>> {
        let mut map: HashMap<String, Vec<&TotpEntry>> = HashMap::new();
        for entry in &self.entries {
            let key = format!(
                "{}:{}",
                entry.issuer.as_deref().unwrap_or(""),
                entry.normalised_secret()
            );
            map.entry(key).or_default().push(entry);
        }
        map.into_values().filter(|v| v.len() > 1).collect()
    }

    /// Remove duplicate entries, keeping the first occurrence.
    /// Returns number of entries removed.
    pub fn deduplicate(&mut self) -> usize {
        let mut seen: HashMap<String, bool> = HashMap::new();
        let before = self.entries.len();
        self.entries.retain(|e| {
            let key = format!(
                "{}:{}",
                e.issuer.as_deref().unwrap_or(""),
                e.normalised_secret()
            );
            if seen.contains_key(&key) {
                false
            } else {
                seen.insert(key, true);
                true
            }
        });
        let removed = before - self.entries.len();
        if removed > 0 {
            self.meta.entry_count = self.entries.len();
            self.touch();
        }
        removed
    }

    // ── Serialisation ────────────────────────────────────────────

    /// Serialise vault to JSON.
    pub fn to_json(&self) -> Result<String, TotpError> {
        serde_json::to_string_pretty(self).map_err(|e| {
            TotpError::new(TotpErrorKind::ExportFailed, format!("JSON serialise: {}", e))
        })
    }

    /// Deserialise vault from JSON.
    pub fn from_json(json: &str) -> Result<Self, TotpError> {
        serde_json::from_str(json).map_err(|e| {
            TotpError::new(TotpErrorKind::ImportFailed, format!("JSON deserialise: {}", e))
        })
    }

    /// Merge entries from another vault (avoids duplicates by ID).
    pub fn merge(&mut self, other: &TotpVault) -> usize {
        let existing_ids: std::collections::HashSet<String> =
            self.entries.iter().map(|e| e.id.clone()).collect();
        let mut added = 0;
        for entry in &other.entries {
            if !existing_ids.contains(&entry.id) {
                self.entries.push(entry.clone());
                added += 1;
            }
        }
        // Merge groups too
        let existing_group_ids: std::collections::HashSet<String> =
            self.groups.iter().map(|g| g.id.clone()).collect();
        for group in &other.groups {
            if !existing_group_ids.contains(&group.id) {
                self.groups.push(group.clone());
            }
        }
        if added > 0 {
            self.meta.entry_count = self.entries.len();
            self.touch();
        }
        added
    }

    // ── Stats ────────────────────────────────────────────────────

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    pub fn group_count(&self) -> usize {
        self.groups.len()
    }

    /// Collect all unique tags across entries.
    pub fn all_tags(&self) -> Vec<String> {
        let mut tags: Vec<String> = self
            .entries
            .iter()
            .flat_map(|e| e.tags.iter().cloned())
            .collect();
        tags.sort();
        tags.dedup();
        tags
    }

    // ── Internal ─────────────────────────────────────────────────

    fn touch(&mut self) {
        self.meta.updated_at = chrono::Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(label: &str, secret: &str) -> TotpEntry {
        TotpEntry::new(label, secret)
    }

    fn make_entry_with_issuer(label: &str, secret: &str, issuer: &str) -> TotpEntry {
        TotpEntry::new(label, secret).with_issuer(issuer)
    }

    // ── Entry CRUD ───────────────────────────────────────────────

    #[test]
    fn add_and_get_entry() {
        let mut vault = TotpVault::new();
        let entry = make_entry("alice", "AAAA");
        let id = vault.add_entry(entry.clone());
        let found = vault.get_entry(&id).unwrap();
        assert_eq!(found.label, "alice");
        assert_eq!(vault.entry_count(), 1);
    }

    #[test]
    fn update_entry() {
        let mut vault = TotpVault::new();
        let entry = make_entry("alice", "AAAA");
        let id = vault.add_entry(entry);
        let mut updated = vault.get_entry(&id).unwrap().clone();
        updated.label = "Alice Updated".to_string();
        assert!(vault.update_entry(updated));
        assert_eq!(vault.get_entry(&id).unwrap().label, "Alice Updated");
    }

    #[test]
    fn remove_entry() {
        let mut vault = TotpVault::new();
        let entry = make_entry("alice", "AAAA");
        let id = vault.add_entry(entry);
        assert_eq!(vault.entry_count(), 1);
        let removed = vault.remove_entry(&id).unwrap();
        assert_eq!(removed.label, "alice");
        assert_eq!(vault.entry_count(), 0);
    }

    #[test]
    fn remove_nonexistent() {
        let mut vault = TotpVault::new();
        assert!(vault.remove_entry("nope").is_none());
    }

    // ── Search ───────────────────────────────────────────────────

    #[test]
    fn search_by_label() {
        let mut vault = TotpVault::new();
        vault.add_entry(make_entry_with_issuer("alice@work", "A", "Acme"));
        vault.add_entry(make_entry_with_issuer("bob@home", "B", "Home"));
        let results = vault.search("alice");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].label, "alice@work");
    }

    #[test]
    fn search_by_issuer() {
        let mut vault = TotpVault::new();
        vault.add_entry(make_entry_with_issuer("user", "A", "GitHub"));
        vault.add_entry(make_entry_with_issuer("user", "B", "AWS"));
        let results = vault.search("github");
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_by_tag() {
        let mut vault = TotpVault::new();
        let mut entry = make_entry("user", "A");
        entry.tags = vec!["work".into(), "dev".into()];
        vault.add_entry(entry);
        let results = vault.search("dev");
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_empty_query_returns_all() {
        let mut vault = TotpVault::new();
        vault.add_entry(make_entry("a", "A"));
        vault.add_entry(make_entry("b", "B"));
        let results = vault.search("");
        assert_eq!(results.len(), 2);
    }

    // ── Group CRUD ───────────────────────────────────────────────

    #[test]
    fn add_and_get_group() {
        let mut vault = TotpVault::new();
        let group = TotpGroup::new("Work");
        let id = vault.add_group(group);
        let found = vault.get_group(&id).unwrap();
        assert_eq!(found.name, "Work");
    }

    #[test]
    fn remove_group_unlinks_entries() {
        let mut vault = TotpVault::new();
        let group = TotpGroup::new("Work");
        let gid = vault.add_group(group);
        let mut entry = make_entry("user", "A");
        entry.group_id = Some(gid.clone());
        let eid = vault.add_entry(entry);
        vault.remove_group(&gid);
        assert!(vault.get_entry(&eid).unwrap().group_id.is_none());
    }

    #[test]
    fn entries_in_group() {
        let mut vault = TotpVault::new();
        let group = TotpGroup::new("G");
        let gid = vault.add_group(group);
        let mut e1 = make_entry("a", "A");
        e1.group_id = Some(gid.clone());
        let mut e2 = make_entry("b", "B");
        e2.group_id = Some(gid.clone());
        let e3 = make_entry("c", "C");
        vault.add_entry(e1);
        vault.add_entry(e2);
        vault.add_entry(e3);
        assert_eq!(vault.entries_in_group(&gid).len(), 2);
        assert_eq!(vault.ungrouped_entries().len(), 1);
    }

    // ── Sorting ──────────────────────────────────────────────────

    #[test]
    fn sort_entries_by_order() {
        let mut vault = TotpVault::new();
        let mut e1 = make_entry("B", "B");
        e1.sort_order = 2;
        let mut e2 = make_entry("A", "A");
        e2.sort_order = 1;
        vault.add_entry(e1);
        vault.add_entry(e2);
        vault.sort_entries();
        assert_eq!(vault.entries[0].label, "A");
        assert_eq!(vault.entries[1].label, "B");
    }

    #[test]
    fn reorder_entry() {
        let mut vault = TotpVault::new();
        vault.add_entry(make_entry("A", "A"));
        vault.add_entry(make_entry("B", "B"));
        vault.add_entry(make_entry("C", "C"));
        assert!(vault.reorder_entry(2, 0)); // Move C to front
        assert_eq!(vault.entries[0].label, "C");
        assert_eq!(vault.entries[1].label, "A");
        assert_eq!(vault.entries[2].label, "B");
    }

    // ── Favourites ───────────────────────────────────────────────

    #[test]
    fn toggle_favourite() {
        let mut vault = TotpVault::new();
        let entry = make_entry("alice", "A");
        let id = vault.add_entry(entry);
        assert!(!vault.get_entry(&id).unwrap().favourite);
        assert_eq!(vault.toggle_favourite(&id), Some(true));
        assert!(vault.get_entry(&id).unwrap().favourite);
        assert_eq!(vault.toggle_favourite(&id), Some(false));
    }

    #[test]
    fn list_favourites() {
        let mut vault = TotpVault::new();
        let mut e1 = make_entry("a", "A");
        e1.favourite = true;
        let e2 = make_entry("b", "B");
        vault.add_entry(e1);
        vault.add_entry(e2);
        assert_eq!(vault.favourites().len(), 1);
    }

    // ── Usage tracking ───────────────────────────────────────────

    #[test]
    fn record_use_increments() {
        let mut vault = TotpVault::new();
        let entry = make_entry("alice", "A");
        let id = vault.add_entry(entry);
        vault.record_use(&id);
        vault.record_use(&id);
        let e = vault.get_entry(&id).unwrap();
        assert_eq!(e.use_count, 2);
        assert!(e.last_used_at.is_some());
    }

    // ── Deduplication ────────────────────────────────────────────

    #[test]
    fn find_duplicates() {
        let mut vault = TotpVault::new();
        vault.add_entry(make_entry_with_issuer("a", "AAAA", "X"));
        vault.add_entry(make_entry_with_issuer("b", "AAAA", "X"));
        vault.add_entry(make_entry_with_issuer("c", "BBBB", "Y"));
        let dups = vault.find_duplicates();
        assert_eq!(dups.len(), 1);
        assert_eq!(dups[0].len(), 2);
    }

    #[test]
    fn deduplicate_removes_dupes() {
        let mut vault = TotpVault::new();
        vault.add_entry(make_entry_with_issuer("a", "AAAA", "X"));
        vault.add_entry(make_entry_with_issuer("b", "AAAA", "X"));
        vault.add_entry(make_entry_with_issuer("c", "BBBB", "Y"));
        let removed = vault.deduplicate();
        assert_eq!(removed, 1);
        assert_eq!(vault.entry_count(), 2);
    }

    // ── Serialisation ────────────────────────────────────────────

    #[test]
    fn json_roundtrip() {
        let mut vault = TotpVault::new();
        vault.add_entry(make_entry_with_issuer("alice", "AAAA", "GitHub"));
        vault.add_group(TotpGroup::new("Work"));
        let json = vault.to_json().unwrap();
        let restored = TotpVault::from_json(&json).unwrap();
        assert_eq!(restored.entry_count(), 1);
        assert_eq!(restored.group_count(), 1);
    }

    // ── Merge ────────────────────────────────────────────────────

    #[test]
    fn merge_skips_existing_ids() {
        let mut v1 = TotpVault::new();
        let entry = make_entry("a", "A");
        let id = entry.id.clone();
        v1.add_entry(entry);

        let mut v2 = TotpVault::new();
        let mut dup = make_entry("a-dup", "A2");
        dup.id = id; // Same ID
        v2.add_entry(dup);
        v2.add_entry(make_entry("b", "B"));

        let added = v1.merge(&v2);
        assert_eq!(added, 1);
        assert_eq!(v1.entry_count(), 2);
    }

    // ── Tags ─────────────────────────────────────────────────────

    #[test]
    fn all_tags_deduped() {
        let mut vault = TotpVault::new();
        let mut e1 = make_entry("a", "A");
        e1.tags = vec!["work".into(), "dev".into()];
        let mut e2 = make_entry("b", "B");
        e2.tags = vec!["dev".into(), "prod".into()];
        vault.add_entry(e1);
        vault.add_entry(e2);
        let tags = vault.all_tags();
        assert_eq!(tags, vec!["dev", "prod", "work"]);
    }

    // ── Filter ───────────────────────────────────────────────────

    #[test]
    fn filter_entries_by_favourites() {
        let mut vault = TotpVault::new();
        let mut e1 = make_entry("a", "A");
        e1.favourite = true;
        vault.add_entry(e1);
        vault.add_entry(make_entry("b", "B"));

        let filter = EntryFilter {
            favourites_only: true,
            ..Default::default()
        };
        let results = vault.filter_entries(&filter);
        assert_eq!(results.len(), 1);
    }
}
