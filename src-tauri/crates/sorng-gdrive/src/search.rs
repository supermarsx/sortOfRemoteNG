//! Google Drive search query builder.
//!
//! Provides a fluent API for constructing the `q` parameter used in
//! `files.list` and other list endpoints.
//!
//! # Example
//! ```ignore
//! use sorng_gdrive::search::SearchQueryBuilder;
//!
//! let q = SearchQueryBuilder::new()
//!     .name_contains("report")
//!     .mime_type_eq("application/pdf")
//!     .not_trashed()
//!     .in_parent("folder123")
//!     .build();
//! // q = "name contains 'report' and mimeType = 'application/pdf' and trashed = false and 'folder123' in parents"
//! ```

use crate::types::mime_types;

/// Fluent builder for Drive search queries.
#[derive(Debug, Clone, Default)]
pub struct SearchQueryBuilder {
    clauses: Vec<String>,
}

impl SearchQueryBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a raw query clause.
    pub fn raw(mut self, clause: &str) -> Self {
        self.clauses.push(clause.to_string());
        self
    }

    // ── Name ─────────────────────────────────────────────────────

    /// `name contains 'value'`
    pub fn name_contains(mut self, value: &str) -> Self {
        self.clauses
            .push(format!("name contains '{}'", escape(value)));
        self
    }

    /// `name = 'value'`
    pub fn name_eq(mut self, value: &str) -> Self {
        self.clauses.push(format!("name = '{}'", escape(value)));
        self
    }

    /// `name != 'value'`
    pub fn name_ne(mut self, value: &str) -> Self {
        self.clauses.push(format!("name != '{}'", escape(value)));
        self
    }

    // ── MIME type ────────────────────────────────────────────────

    /// `mimeType = 'value'`
    pub fn mime_type_eq(mut self, value: &str) -> Self {
        self.clauses
            .push(format!("mimeType = '{}'", escape(value)));
        self
    }

    /// `mimeType != 'value'`
    pub fn mime_type_ne(mut self, value: &str) -> Self {
        self.clauses
            .push(format!("mimeType != '{}'", escape(value)));
        self
    }

    /// Only folders.
    pub fn folders_only(self) -> Self {
        self.mime_type_eq(mime_types::FOLDER)
    }

    /// Exclude folders.
    pub fn exclude_folders(self) -> Self {
        self.mime_type_ne(mime_types::FOLDER)
    }

    // ── Trashed ──────────────────────────────────────────────────

    /// `trashed = false`
    pub fn not_trashed(mut self) -> Self {
        self.clauses.push("trashed = false".to_string());
        self
    }

    /// `trashed = true`
    pub fn trashed(mut self) -> Self {
        self.clauses.push("trashed = true".to_string());
        self
    }

    // ── Parents ──────────────────────────────────────────────────

    /// `'parent_id' in parents`
    pub fn in_parent(mut self, parent_id: &str) -> Self {
        self.clauses
            .push(format!("'{}' in parents", escape(parent_id)));
        self
    }

    // ── Full text ────────────────────────────────────────────────

    /// `fullText contains 'value'`
    pub fn full_text_contains(mut self, value: &str) -> Self {
        self.clauses
            .push(format!("fullText contains '{}'", escape(value)));
        self
    }

    // ── Starred ──────────────────────────────────────────────────

    /// `starred = true`
    pub fn starred(mut self) -> Self {
        self.clauses.push("starred = true".to_string());
        self
    }

    // ── Ownership ────────────────────────────────────────────────

    /// `'email' in owners`
    pub fn owned_by(mut self, email: &str) -> Self {
        self.clauses
            .push(format!("'{}' in owners", escape(email)));
        self
    }

    /// `'email' in writers`
    pub fn writable_by(mut self, email: &str) -> Self {
        self.clauses
            .push(format!("'{}' in writers", escape(email)));
        self
    }

    /// `'email' in readers`
    pub fn readable_by(mut self, email: &str) -> Self {
        self.clauses
            .push(format!("'{}' in readers", escape(email)));
        self
    }

    // ── Shared with me ──────────────────────────────────────────

    /// `sharedWithMe = true`
    pub fn shared_with_me(mut self) -> Self {
        self.clauses.push("sharedWithMe = true".to_string());
        self
    }

    // ── Visibility ───────────────────────────────────────────────

    /// `visibility = 'limited'`
    pub fn visibility(mut self, vis: &str) -> Self {
        self.clauses
            .push(format!("visibility = '{}'", escape(vis)));
        self
    }

    // ── Time filters ─────────────────────────────────────────────

    /// `modifiedTime > 'datetime'` (RFC 3339 string).
    pub fn modified_after(mut self, datetime: &str) -> Self {
        self.clauses
            .push(format!("modifiedTime > '{}'", datetime));
        self
    }

    /// `modifiedTime < 'datetime'`
    pub fn modified_before(mut self, datetime: &str) -> Self {
        self.clauses
            .push(format!("modifiedTime < '{}'", datetime));
        self
    }

    /// `createdTime > 'datetime'`
    pub fn created_after(mut self, datetime: &str) -> Self {
        self.clauses
            .push(format!("createdTime > '{}'", datetime));
        self
    }

    /// `createdTime < 'datetime'`
    pub fn created_before(mut self, datetime: &str) -> Self {
        self.clauses
            .push(format!("createdTime < '{}'", datetime));
        self
    }

    // ── Properties ───────────────────────────────────────────────

    /// `properties has { key='key' and value='value' }`
    pub fn has_property(mut self, key: &str, value: &str) -> Self {
        self.clauses.push(format!(
            "properties has {{ key='{}' and value='{}' }}",
            escape(key),
            escape(value)
        ));
        self
    }

    /// `appProperties has { key='key' and value='value' }`
    pub fn has_app_property(mut self, key: &str, value: &str) -> Self {
        self.clauses.push(format!(
            "appProperties has {{ key='{}' and value='{}' }}",
            escape(key),
            escape(value)
        ));
        self
    }

    // ── Build ────────────────────────────────────────────────────

    /// Join all clauses with " and " and return the query string.
    pub fn build(&self) -> String {
        self.clauses.join(" and ")
    }

    /// Return whether the query is empty.
    pub fn is_empty(&self) -> bool {
        self.clauses.is_empty()
    }

    /// Number of clauses.
    pub fn len(&self) -> usize {
        self.clauses.len()
    }
}

/// Escape single-quotes in a Drive query value.
fn escape(s: &str) -> String {
    s.replace('\'', "\\'")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_query() {
        let q = SearchQueryBuilder::new().build();
        assert!(q.is_empty());
    }

    #[test]
    fn single_clause() {
        let q = SearchQueryBuilder::new().name_contains("report").build();
        assert_eq!(q, "name contains 'report'");
    }

    #[test]
    fn multiple_clauses() {
        let q = SearchQueryBuilder::new()
            .name_contains("report")
            .not_trashed()
            .build();
        assert_eq!(q, "name contains 'report' and trashed = false");
    }

    #[test]
    fn name_eq() {
        let q = SearchQueryBuilder::new().name_eq("exact.txt").build();
        assert_eq!(q, "name = 'exact.txt'");
    }

    #[test]
    fn name_ne() {
        let q = SearchQueryBuilder::new().name_ne("bad.txt").build();
        assert_eq!(q, "name != 'bad.txt'");
    }

    #[test]
    fn mime_type_eq() {
        let q = SearchQueryBuilder::new()
            .mime_type_eq("application/pdf")
            .build();
        assert_eq!(q, "mimeType = 'application/pdf'");
    }

    #[test]
    fn folders_only() {
        let q = SearchQueryBuilder::new().folders_only().build();
        assert!(q.contains(mime_types::FOLDER));
    }

    #[test]
    fn exclude_folders() {
        let q = SearchQueryBuilder::new().exclude_folders().build();
        assert!(q.contains("mimeType !="));
    }

    #[test]
    fn in_parent() {
        let q = SearchQueryBuilder::new().in_parent("folder123").build();
        assert_eq!(q, "'folder123' in parents");
    }

    #[test]
    fn full_text() {
        let q = SearchQueryBuilder::new()
            .full_text_contains("budget")
            .build();
        assert_eq!(q, "fullText contains 'budget'");
    }

    #[test]
    fn starred() {
        let q = SearchQueryBuilder::new().starred().build();
        assert_eq!(q, "starred = true");
    }

    #[test]
    fn trashed() {
        let q = SearchQueryBuilder::new().trashed().build();
        assert_eq!(q, "trashed = true");
    }

    #[test]
    fn owned_by() {
        let q = SearchQueryBuilder::new()
            .owned_by("user@example.com")
            .build();
        assert_eq!(q, "'user@example.com' in owners");
    }

    #[test]
    fn shared_with_me() {
        let q = SearchQueryBuilder::new().shared_with_me().build();
        assert_eq!(q, "sharedWithMe = true");
    }

    #[test]
    fn time_filters() {
        let q = SearchQueryBuilder::new()
            .modified_after("2024-01-01T00:00:00Z")
            .modified_before("2024-12-31T23:59:59Z")
            .build();
        assert!(q.contains("modifiedTime >"));
        assert!(q.contains("modifiedTime <"));
    }

    #[test]
    fn created_time_filters() {
        let q = SearchQueryBuilder::new()
            .created_after("2024-01-01T00:00:00Z")
            .created_before("2024-06-01T00:00:00Z")
            .build();
        assert!(q.contains("createdTime > '2024-01-01T00:00:00Z'"));
        assert!(q.contains("createdTime < '2024-06-01T00:00:00Z'"));
    }

    #[test]
    fn property_filter() {
        let q = SearchQueryBuilder::new()
            .has_property("category", "finance")
            .build();
        assert!(q.contains("properties has"));
        assert!(q.contains("key='category'"));
        assert!(q.contains("value='finance'"));
    }

    #[test]
    fn app_property_filter() {
        let q = SearchQueryBuilder::new()
            .has_app_property("sync_id", "abc")
            .build();
        assert!(q.contains("appProperties has"));
    }

    #[test]
    fn escape_single_quotes() {
        let q = SearchQueryBuilder::new()
            .name_contains("it's a test")
            .build();
        assert!(q.contains("it\\'s a test"));
    }

    #[test]
    fn raw_clause() {
        let q = SearchQueryBuilder::new()
            .raw("modifiedTime > '2024-01-01'")
            .build();
        assert_eq!(q, "modifiedTime > '2024-01-01'");
    }

    #[test]
    fn complex_query() {
        let q = SearchQueryBuilder::new()
            .name_contains("quarterly")
            .mime_type_eq("application/pdf")
            .not_trashed()
            .in_parent("reports_folder")
            .modified_after("2024-01-01T00:00:00Z")
            .build();

        assert!(q.contains("name contains 'quarterly'"));
        assert!(q.contains("mimeType = 'application/pdf'"));
        assert!(q.contains("trashed = false"));
        assert!(q.contains("'reports_folder' in parents"));
        assert!(q.contains("modifiedTime > '2024-01-01T00:00:00Z'"));
        // All connected by " and "
        assert_eq!(q.matches(" and ").count(), 4);
    }

    #[test]
    fn len_and_is_empty() {
        let b = SearchQueryBuilder::new();
        assert!(b.is_empty());
        assert_eq!(b.len(), 0);

        let b2 = b.name_eq("test").not_trashed();
        assert!(!b2.is_empty());
        assert_eq!(b2.len(), 2);
    }

    #[test]
    fn visibility_filter() {
        let q = SearchQueryBuilder::new().visibility("limited").build();
        assert_eq!(q, "visibility = 'limited'");
    }
}
