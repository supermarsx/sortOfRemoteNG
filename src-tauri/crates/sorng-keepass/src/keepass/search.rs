// ── sorng-keepass / search ─────────────────────────────────────────────────────
//
// Advanced entry search with field matching, regex support, tag filtering,
// expiry queries, sorting, and pagination.

use chrono::{Utc, DateTime};

use super::types::*;
use super::service::KeePassService;

impl KeePassService {
    // ─── Search ──────────────────────────────────────────────────────

    /// Search entries in one or all open databases.
    pub fn search_entries(
        &self,
        db_id: Option<&str>,
        query: SearchQuery,
    ) -> Result<SearchResult, String> {
        let start = std::time::Instant::now();
        let mut matched: Vec<EntrySummary> = Vec::new();

        let db_ids: Vec<String> = if let Some(id) = db_id {
            vec![id.to_string()]
        } else {
            self.list_databases().iter().map(|d| d.id.clone()).collect()
        };

        let now = Utc::now();
        for id in &db_ids {
            let db = self.get_database(id)?;
            for entry in db.entries.values() {
                if self.entry_matches_query(entry, &query) {
                    matched.push(Self::entry_to_summary(entry, &now));
                }
            }
        }

        // Sort results
        if let Some(ref sort_field) = query.sort_by {
            let ascending = query.sort_ascending.unwrap_or(true);
            matched.sort_by(|a, b| {
                let cmp = match sort_field {
                    SearchSortField::Title => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
                    SearchSortField::Username => a.username.to_lowercase().cmp(&b.username.to_lowercase()),
                    SearchSortField::Url => a.url.to_lowercase().cmp(&b.url.to_lowercase()),
                    SearchSortField::Created => a.created_at.cmp(&b.created_at),
                    SearchSortField::Modified => a.modified_at.cmp(&b.modified_at),
                    SearchSortField::ExpiryTime => {
                        let a_exp = a.expiry_time.as_deref().unwrap_or("");
                        let b_exp = b.expiry_time.as_deref().unwrap_or("");
                        a_exp.cmp(b_exp)
                    }
                    SearchSortField::Accessed => {
                        let a_val = a.last_accessed_at.as_deref().unwrap_or("");
                        let b_val = b.last_accessed_at.as_deref().unwrap_or("");
                        a_val.cmp(b_val)
                    }
                };
                if ascending { cmp } else { cmp.reverse() }
            });
        }

        let total = matched.len();

        // Pagination
        let offset = query.offset.unwrap_or(0);
        let limit = query.limit.unwrap_or(total);
        let paginated: Vec<EntrySummary> = matched.into_iter()
            .skip(offset)
            .take(limit)
            .collect();

        let elapsed = start.elapsed();

        Ok(SearchResult {
            entries: paginated,
            total_matches: total,
            search_time_ms: elapsed.as_millis() as u64,
            has_more: offset + limit < total,
        })
    }

    /// Quick text search across all standard fields.
    pub fn quick_search(
        &self,
        db_id: &str,
        term: &str,
    ) -> Result<Vec<EntrySummary>, String> {
        let query = SearchQuery {
            text: Some(term.to_string()),
            fields: Some(vec![
                SearchField::Title,
                SearchField::Username,
                SearchField::Url,
                SearchField::Notes,
                SearchField::Tags,
            ]),
            is_regex: false,
            case_sensitive: false,
            tags: None,
            group_uuid: None,
            include_subgroups: true,
            exclude_expired: false,
            only_expired: false,
            expires_within_days: None,
            has_attachments: None,
            has_otp: None,
            has_url: None,
            password_strength_max: None,
            created_after: None,
            created_before: None,
            modified_after: None,
            modified_before: None,
            sort_by: Some(SearchSortField::Title),
            sort_ascending: Some(true),
            offset: None,
            limit: None,
        };

        let result = self.search_entries(Some(db_id), query)?;
        Ok(result.entries)
    }

    /// Find entries with a specific URL (for browser integration).
    pub fn find_entries_for_url(
        &self,
        db_id: &str,
        url: &str,
    ) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        let domain = Self::extract_domain(url);
        let mut results = Vec::new();

        let now = Utc::now();

        for entry in db.entries.values() {
            if !entry.url.is_empty() {
                let entry_domain = Self::extract_domain(&entry.url);
                if entry_domain == domain {
                    results.push(Self::entry_to_summary(entry, &now));
                }
            }
        }

        // Sort by title
        results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

        Ok(results)
    }

    /// Find duplicate entries (same title+username+url).
    pub fn find_duplicates(
        &self,
        db_id: &str,
    ) -> Result<Vec<Vec<EntrySummary>>, String> {
        let db = self.get_database(db_id)?;

        let mut groups: std::collections::HashMap<String, Vec<&KeePassEntry>> = std::collections::HashMap::new();

        for entry in db.entries.values() {
            let key = format!(
                "{}|{}|{}",
                entry.title.to_lowercase(),
                entry.username.to_lowercase(),
                Self::extract_domain(&entry.url).to_lowercase(),
            );
            groups.entry(key).or_default().push(entry);
        }

        let now = Utc::now();
        let mut duplicates: Vec<Vec<EntrySummary>> = groups
            .into_values()
            .filter(|v| v.len() > 1)
            .map(|entries| {
                entries.iter().map(|e| Self::entry_to_summary(e, &now)).collect()
            })
            .collect();

        // Sort groups by first entry title
        duplicates.sort_by(|a, b| {
            let a_title = a.first().map(|e| &e.title).unwrap_or(&String::new()).to_lowercase();
            let b_title = b.first().map(|e| &e.title).unwrap_or(&String::new()).to_lowercase();
            a_title.cmp(&b_title)
        });

        Ok(duplicates)
    }

    /// Find entries expiring within the given number of days.
    pub fn find_expiring_entries(
        &self,
        db_id: &str,
        days: u32,
    ) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        let now = Utc::now();
        let threshold = now + chrono::Duration::days(days as i64);
        let mut results = Vec::new();

        for entry in db.entries.values() {
            if entry.times.expires {
                if let Some(ref expiry) = entry.times.expiry_time {
                    if let Ok(exp_dt) = DateTime::parse_from_rfc3339(expiry) {
                        let exp_utc: DateTime<Utc> = exp_dt.into();
                        if exp_utc <= threshold {
                            results.push(Self::entry_to_summary(entry, &now));
                        }
                    }
                }
            }
        }

        // Sort by expiry time
        results.sort_by(|a, b| {
            let a_exp = a.expiry_time.as_deref().unwrap_or("");
            let b_exp = b.expiry_time.as_deref().unwrap_or("");
            a_exp.cmp(b_exp)
        });

        Ok(results)
    }

    /// Find entries with weak passwords.
    pub fn find_weak_passwords(
        &self,
        db_id: &str,
        max_strength: PasswordStrength,
    ) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        let now = Utc::now();
        let max_level = match max_strength {
            PasswordStrength::VeryWeak => 0,
            PasswordStrength::Weak => 1,
            PasswordStrength::Fair => 2,
            PasswordStrength::Strong => 3,
            PasswordStrength::VeryStrong => 4,
        };

        let mut results = Vec::new();

        for entry in db.entries.values() {
            if entry.password.is_empty() {
                continue;
            }
            let entropy = Self::estimate_entropy(&entry.password);
            let strength = Self::entropy_to_strength(entropy);
            let level = match strength {
                PasswordStrength::VeryWeak => 0,
                PasswordStrength::Weak => 1,
                PasswordStrength::Fair => 2,
                PasswordStrength::Strong => 3,
                PasswordStrength::VeryStrong => 4,
            };
            if level <= max_level {
                results.push(Self::entry_to_summary(entry, &now));
            }
        }

        Ok(results)
    }

    /// Find entries without passwords.
    pub fn find_entries_without_password(
        &self,
        db_id: &str,
    ) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        let now = Utc::now();
        let mut results: Vec<EntrySummary> = db.entries.values()
            .filter(|e| e.password.is_empty())
            .map(|e| Self::entry_to_summary(e, &now))
            .collect();

        results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(results)
    }

    /// Collect all unique tags across all entries in a database.
    pub fn get_all_tags(
        &self,
        db_id: &str,
    ) -> Result<Vec<TagCount>, String> {
        let db = self.get_database(db_id)?;
        let mut tag_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        for entry in db.entries.values() {
            for tag in &entry.tags {
                *tag_counts.entry(tag.clone()).or_default() += 1;
            }
        }

        let mut tags: Vec<TagCount> = tag_counts
            .into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect();

        tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));

        Ok(tags)
    }

    /// Find entries by tag.
    pub fn find_entries_by_tag(
        &self,
        db_id: &str,
        tag: &str,
    ) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        let lower_tag = tag.to_lowercase();
        let now = Utc::now();
        let mut results: Vec<EntrySummary> = db.entries.values()
            .filter(|e| e.tags.iter().any(|t| t.to_lowercase() == lower_tag))
            .map(|e| Self::entry_to_summary(e, &now))
            .collect();

        results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(results)
    }

    // ─── Internal Matching Logic ─────────────────────────────────────

    fn entry_matches_query(&self, entry: &KeePassEntry, query: &SearchQuery) -> bool {
        // Text search
        if let Some(ref text) = query.text {
            if !text.is_empty() {
                let fields = query.fields.as_ref().map(|v| v.as_slice()).unwrap_or(&[
                    SearchField::Title,
                    SearchField::Username,
                    SearchField::Url,
                    SearchField::Notes,
                ]);

                let matched_any = if query.is_regex {
                    // Regex search
                    let _pattern = if query.case_sensitive {
                        text.clone()
                    } else {
                        format!("(?i){}", text)
                    };
                    // Simple regex matching (limited without regex crate)
                    fields.iter().any(|f| {
                        let value = self.get_entry_field_value(entry, f);
                        Self::simple_pattern_match(&value, text, !query.case_sensitive)
                    })
                } else {
                    let search = if query.case_sensitive {
                        text.clone()
                    } else {
                        text.to_lowercase()
                    };

                    fields.iter().any(|f| {
                        let value = self.get_entry_field_value(entry, f);
                        let compare = if query.case_sensitive {
                            value
                        } else {
                            value.to_lowercase()
                        };
                        compare.contains(&search)
                    })
                };

                if !matched_any {
                    return false;
                }
            }
        }

        // Tag filter
        if let Some(ref tags) = query.tags {
            if !tags.is_empty() {
                let has_all_tags = tags.iter().all(|t| {
                    let lower = t.to_lowercase();
                    entry.tags.iter().any(|et| et.to_lowercase() == lower)
                });
                if !has_all_tags {
                    return false;
                }
            }
        }

        // Group filter
        if let Some(ref group_uuid) = query.group_uuid {
            if query.include_subgroups {
                // Would need to check if entry's group is a descendant — simplified
                if entry.group_uuid != *group_uuid {
                    // Check if it's a descendant (simplified: just check direct match)
                    // For full descendant check, we'd need database context
                    // This is a simplified version
                    return false;
                }
            } else if entry.group_uuid != *group_uuid {
                return false;
            }
        }

        // Expiry filters
        if query.exclude_expired || query.only_expired {
            let is_expired = Self::is_entry_expired(entry);
            if query.exclude_expired && is_expired {
                return false;
            }
            if query.only_expired && !is_expired {
                return false;
            }
        }

        if let Some(days) = query.expires_within_days {
            if !entry.times.expires {
                return false;
            }
            if let Some(ref expiry) = entry.times.expiry_time {
                if let Ok(exp_dt) = DateTime::parse_from_rfc3339(expiry) {
                    let exp_utc: DateTime<Utc> = exp_dt.into();
                    let threshold = Utc::now() + chrono::Duration::days(days as i64);
                    if exp_utc > threshold {
                        return false;
                    }
                }
            } else {
                return false;
            }
        }

        // Attachment filter
        if let Some(has_attachments) = query.has_attachments {
            let entry_has = !entry.attachments.is_empty();
            if has_attachments != entry_has {
                return false;
            }
        }

        // OTP filter
        if let Some(has_otp) = query.has_otp {
            let entry_has = entry.otp.is_some();
            if has_otp != entry_has {
                return false;
            }
        }

        // URL filter
        if let Some(has_url) = query.has_url {
            let entry_has = !entry.url.is_empty();
            if has_url != entry_has {
                return false;
            }
        }

        // Password strength filter
        if let Some(ref max_strength) = query.password_strength_max {
            if !entry.password.is_empty() {
                let entropy = Self::estimate_entropy(&entry.password);
                let strength = Self::entropy_to_strength(entropy);
                let max_level = Self::strength_level(max_strength);
                let cur_level = Self::strength_level(&strength);
                if cur_level > max_level {
                    return false;
                }
            }
        }

        // Date filters
        if let Some(ref after) = query.created_after {
            if entry.times.created < *after {
                return false;
            }
        }
        if let Some(ref before) = query.created_before {
            if entry.times.created > *before {
                return false;
            }
        }
        if let Some(ref after) = query.modified_after {
            if entry.times.last_modified < *after {
                return false;
            }
        }
        if let Some(ref before) = query.modified_before {
            if entry.times.last_modified > *before {
                return false;
            }
        }

        true
    }

    fn get_entry_field_value(&self, entry: &KeePassEntry, field: &SearchField) -> String {
        match field {
            SearchField::Title => entry.title.clone(),
            SearchField::Username => entry.username.clone(),
            SearchField::Password => entry.password.clone(),
            SearchField::Url => entry.url.clone(),
            SearchField::Notes => entry.notes.clone(),
            SearchField::Tags => entry.tags.join(" "),
            SearchField::CustomFields => {
                entry.custom_fields.iter()
                    .map(|(key, cf)| format!("{} {}", key, cf.value))
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            SearchField::Uuid => entry.uuid.clone(),
            SearchField::Attachments => {
                entry.attachments.iter()
                    .map(|a| a.filename.clone())
                    .collect::<Vec<_>>()
                    .join(" ")
            }
        }
    }

    fn is_entry_expired(entry: &KeePassEntry) -> bool {
        if !entry.times.expires {
            return false;
        }
        if let Some(ref expiry) = entry.times.expiry_time {
            if let Ok(exp_dt) = DateTime::parse_from_rfc3339(expiry) {
                let exp_utc: DateTime<Utc> = exp_dt.into();
                return exp_utc <= Utc::now();
            }
        }
        false
    }

    /// Simple wildcard-style pattern match.
    pub(crate) fn simple_pattern_match(text: &str, pattern: &str, case_insensitive: bool) -> bool {
        let (t, p) = if case_insensitive {
            (text.to_lowercase(), pattern.to_lowercase())
        } else {
            (text.to_string(), pattern.to_string())
        };

        if p.contains('*') || p.contains('?') {
            // Simple glob matching
            let parts: Vec<&str> = p.split('*').collect();
            if parts.len() == 1 {
                // Only ? wildcards
                if t.len() != p.len() {
                    return false;
                }
                return t.chars().zip(p.chars()).all(|(tc, pc)| pc == '?' || tc == pc);
            }

            let mut pos = 0;
            for (i, part) in parts.iter().enumerate() {
                if part.is_empty() {
                    continue;
                }
                if let Some(found) = t[pos..].find(part) {
                    if i == 0 && found != 0 {
                        return false; // Must match from start
                    }
                    pos += found + part.len();
                } else {
                    return false;
                }
            }
            true
        } else {
            t.contains(&p)
        }
    }

    fn strength_level(s: &PasswordStrength) -> u8 {
        match s {
            PasswordStrength::VeryWeak => 0,
            PasswordStrength::Weak => 1,
            PasswordStrength::Fair => 2,
            PasswordStrength::Strong => 3,
            PasswordStrength::VeryStrong => 4,
        }
    }

    pub(crate) fn extract_domain(url: &str) -> String {
        let cleaned = url
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .trim_start_matches("www.");

        if let Some(slash) = cleaned.find('/') {
            cleaned[..slash].to_lowercase()
        } else {
            cleaned.to_lowercase()
        }
    }
}
