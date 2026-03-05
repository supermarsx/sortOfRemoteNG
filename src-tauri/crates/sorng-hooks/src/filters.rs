//! Event filtering logic and a fluent builder.

use std::collections::HashMap;

use crate::types::*;

// ─── Individual Filter Predicates ───────────────────────────────────

/// Returns `true` when the event's `connection_id` is in the
/// allow-list, or when the allow-list is empty / absent.
pub fn matches_connection_ids(ids: &[String], event: &HookEventData) -> bool {
    match &event.connection_id {
        Some(cid) => ids.iter().any(|id| id == cid),
        None => false,
    }
}

/// Returns `true` when the event metadata contains a `protocol` key
/// whose value is in the allow-list.
pub fn matches_protocols(protocols: &[String], event: &HookEventData) -> bool {
    match event.metadata.get("protocol") {
        Some(proto) => protocols.iter().any(|p| p == proto),
        None => false,
    }
}

/// Returns `true` when at least one of the event's `tags` metadata
/// (comma-separated string) matches an entry in `tags`.
pub fn matches_tags(tags: &[String], event: &HookEventData) -> bool {
    match event.metadata.get("tags") {
        Some(event_tags) => {
            let event_tag_list: Vec<&str> = event_tags.split(',').map(|t| t.trim()).collect();
            tags.iter()
                .any(|t| event_tag_list.iter().any(|et| et == t))
        }
        None => false,
    }
}

/// Simple glob-like hostname matching.  Supports a leading `*` as a
/// wildcard prefix (e.g. `*.example.com`).
pub fn matches_hostname_pattern(pattern: &str, event: &HookEventData) -> bool {
    match event.metadata.get("hostname") {
        Some(hostname) => {
            if let Some(suffix) = pattern.strip_prefix('*') {
                hostname.ends_with(suffix)
            } else {
                hostname == pattern
            }
        }
        None => false,
    }
}

/// Returns `true` when **every** key-value pair in `required` is
/// present in the event metadata with an equal value.
pub fn matches_metadata(required: &HashMap<String, String>, event: &HookEventData) -> bool {
    required
        .iter()
        .all(|(k, v)| event.metadata.get(k).map_or(false, |mv| mv == v))
}

// ─── Composite Filter ───────────────────────────────────────────────

/// Apply a [`HookFilter`] to an event.  All specified criteria are
/// combined with AND logic — the event must satisfy every non-`None`
/// predicate.
pub fn apply_filter(filter: &HookFilter, event: &HookEventData) -> bool {
    if let Some(ref ids) = filter.connection_ids {
        if !ids.is_empty() && !matches_connection_ids(ids, event) {
            return false;
        }
    }
    if let Some(ref protocols) = filter.protocols {
        if !protocols.is_empty() && !matches_protocols(protocols, event) {
            return false;
        }
    }
    if let Some(ref tags) = filter.tags {
        if !tags.is_empty() && !matches_tags(tags, event) {
            return false;
        }
    }
    if let Some(ref pattern) = filter.hostname_pattern {
        if !pattern.is_empty() && !matches_hostname_pattern(pattern, event) {
            return false;
        }
    }
    if let Some(ref meta) = filter.metadata_match {
        if !meta.is_empty() && !matches_metadata(meta, event) {
            return false;
        }
    }
    true
}

// ─── Filter Builder ─────────────────────────────────────────────────

/// Fluent builder for constructing a [`HookFilter`].
pub struct FilterBuilder {
    filter: HookFilter,
}

impl FilterBuilder {
    pub fn new() -> Self {
        Self {
            filter: HookFilter::default(),
        }
    }

    pub fn connection_id(mut self, id: impl Into<String>) -> Self {
        self.filter
            .connection_ids
            .get_or_insert_with(Vec::new)
            .push(id.into());
        self
    }

    pub fn connection_ids(mut self, ids: Vec<String>) -> Self {
        self.filter
            .connection_ids
            .get_or_insert_with(Vec::new)
            .extend(ids);
        self
    }

    pub fn protocol(mut self, proto: impl Into<String>) -> Self {
        self.filter
            .protocols
            .get_or_insert_with(Vec::new)
            .push(proto.into());
        self
    }

    pub fn protocols(mut self, protos: Vec<String>) -> Self {
        self.filter
            .protocols
            .get_or_insert_with(Vec::new)
            .extend(protos);
        self
    }

    pub fn tag(mut self, tag: impl Into<String>) -> Self {
        self.filter
            .tags
            .get_or_insert_with(Vec::new)
            .push(tag.into());
        self
    }

    pub fn tags(mut self, tags: Vec<String>) -> Self {
        self.filter
            .tags
            .get_or_insert_with(Vec::new)
            .extend(tags);
        self
    }

    pub fn hostname_pattern(mut self, pattern: impl Into<String>) -> Self {
        self.filter.hostname_pattern = Some(pattern.into());
        self
    }

    pub fn metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.filter
            .metadata_match
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), value.into());
        self
    }

    /// Consume the builder and produce a [`HookFilter`].
    pub fn build(self) -> HookFilter {
        self.filter
    }
}

impl Default for FilterBuilder {
    fn default() -> Self {
        Self::new()
    }
}
