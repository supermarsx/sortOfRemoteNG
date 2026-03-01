use crate::dashlane::types::{DashlaneError, SecureNote, NoteColor};

/// Filter secure notes by query string.
pub fn search_notes(notes: &[SecureNote], query: &str) -> Vec<SecureNote> {
    let lower = query.to_lowercase();
    notes
        .iter()
        .filter(|n| {
            n.title.to_lowercase().contains(&lower)
                || n.content.to_lowercase().contains(&lower)
        })
        .cloned()
        .collect()
}

/// Find a secure note by ID.
pub fn find_note_by_id<'a>(notes: &'a [SecureNote], id: &str) -> Option<&'a SecureNote> {
    notes.iter().find(|n| n.id == id)
}

/// Filter notes by category.
pub fn filter_by_category(notes: &[SecureNote], category: &str) -> Vec<SecureNote> {
    notes
        .iter()
        .filter(|n| n.category.as_deref() == Some(category))
        .cloned()
        .collect()
}

/// Get only secured (protected) notes.
pub fn get_secured_notes(notes: &[SecureNote]) -> Vec<SecureNote> {
    notes.iter().filter(|n| n.secured).cloned().collect()
}

/// Create a new secure note.
pub fn create_note(
    title: String,
    content: String,
    category: Option<String>,
    secured: bool,
    color: Option<NoteColor>,
) -> SecureNote {
    let now = chrono::Utc::now().to_rfc3339();
    SecureNote {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        content,
        category,
        secured,
        created_at: Some(now.clone()),
        modified_at: Some(now),
        color,
    }
}

/// Update an existing secure note.
pub fn update_note(
    note: &mut SecureNote,
    title: Option<String>,
    content: Option<String>,
    category: Option<String>,
    secured: Option<bool>,
    color: Option<NoteColor>,
) {
    if let Some(t) = title {
        note.title = t;
    }
    if let Some(c) = content {
        note.content = c;
    }
    if let Some(cat) = category {
        note.category = Some(cat);
    }
    if let Some(s) = secured {
        note.secured = s;
    }
    if let Some(col) = color {
        note.color = Some(col);
    }
    note.modified_at = Some(chrono::Utc::now().to_rfc3339());
}

/// Sort notes by title.
pub fn sort_by_title(notes: &mut [SecureNote]) {
    notes.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
}

/// Sort notes by modification date (newest first).
pub fn sort_by_modified(notes: &mut [SecureNote]) {
    notes.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
}

/// Get all note categories.
pub fn get_note_categories(notes: &[SecureNote]) -> Vec<String> {
    let mut cats: Vec<String> = notes
        .iter()
        .filter_map(|n| n.category.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    cats.sort();
    cats
}
