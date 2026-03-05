// sorng-replay – Annotation & bookmark management

use chrono::Utc;
use uuid::Uuid;

use crate::types::{Annotation, Bookmark};

/// In-memory store for annotations and bookmarks belonging to a session.
#[derive(Debug, Clone, Default)]
pub struct AnnotationManager {
    pub annotations: Vec<Annotation>,
    pub bookmarks: Vec<Bookmark>,
}

impl AnnotationManager {
    pub fn new() -> Self {
        Self::default()
    }

    // ── Annotations ───────────────────────────────────────────────────

    /// Add a new annotation and return its generated id.
    pub fn add_annotation(
        &mut self,
        position_ms: u64,
        text: String,
        author: Option<String>,
        color: Option<String>,
        icon: Option<String>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        self.annotations.push(Annotation {
            id: id.clone(),
            position_ms,
            text,
            author,
            created_at: Utc::now(),
            color,
            icon,
        });
        self.annotations
            .sort_by_key(|a| a.position_ms);
        id
    }

    /// Remove an annotation by id.  Returns `true` if found.
    pub fn remove_annotation(&mut self, id: &str) -> bool {
        let before = self.annotations.len();
        self.annotations.retain(|a| a.id != id);
        self.annotations.len() < before
    }

    /// Update the text (and optionally colour / icon) of an existing annotation.
    pub fn update_annotation(
        &mut self,
        id: &str,
        text: Option<String>,
        color: Option<String>,
        icon: Option<String>,
    ) -> bool {
        if let Some(ann) = self.annotations.iter_mut().find(|a| a.id == id) {
            if let Some(t) = text {
                ann.text = t;
            }
            if let Some(c) = color {
                ann.color = Some(c);
            }
            if let Some(i) = icon {
                ann.icon = Some(i);
            }
            true
        } else {
            false
        }
    }

    /// Return annotations whose position falls within [start_ms, end_ms].
    pub fn get_annotations_in_range(&self, start_ms: u64, end_ms: u64) -> Vec<&Annotation> {
        self.annotations
            .iter()
            .filter(|a| a.position_ms >= start_ms && a.position_ms <= end_ms)
            .collect()
    }

    /// Look up a single annotation by id.
    pub fn get_by_id(&self, id: &str) -> Option<&Annotation> {
        self.annotations.iter().find(|a| a.id == id)
    }

    /// Return all annotations (sorted by position).
    pub fn list_all(&self) -> &[Annotation] {
        &self.annotations
    }

    // ── Bookmarks ─────────────────────────────────────────────────────

    /// Add a bookmark and return its generated id.
    pub fn add_bookmark(&mut self, position_ms: u64, label: String) -> String {
        let id = Uuid::new_v4().to_string();
        self.bookmarks.push(Bookmark {
            id: id.clone(),
            position_ms,
            label,
            created_at: Utc::now(),
        });
        self.bookmarks.sort_by_key(|b| b.position_ms);
        id
    }

    /// Remove a bookmark by id.  Returns `true` if found.
    pub fn remove_bookmark(&mut self, id: &str) -> bool {
        let before = self.bookmarks.len();
        self.bookmarks.retain(|b| b.id != id);
        self.bookmarks.len() < before
    }

    /// Return all bookmarks (sorted by position).
    pub fn get_bookmarks(&self) -> &[Bookmark] {
        &self.bookmarks
    }

    /// Return the bookmark nearest to `position_ms`.
    pub fn get_nearest_bookmark(&self, position_ms: u64) -> Option<&Bookmark> {
        self.bookmarks
            .iter()
            .min_by_key(|b| (b.position_ms as i64 - position_ms as i64).unsigned_abs())
    }
}
