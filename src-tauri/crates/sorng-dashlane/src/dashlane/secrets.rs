use crate::dashlane::types::{DashlaneError, DashlaneSecret};

/// Create a new secret.
pub fn create_secret(
    title: String,
    content: String,
    category: Option<String>,
) -> DashlaneSecret {
    let now = chrono::Utc::now().to_rfc3339();
    DashlaneSecret {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        content,
        category,
        secured: false,
        created_at: Some(now.clone()),
        modified_at: Some(now),
    }
}

/// Find a secret by ID.
pub fn find_secret_by_id<'a>(
    secrets: &'a [DashlaneSecret],
    id: &str,
) -> Option<&'a DashlaneSecret> {
    secrets.iter().find(|s| s.id == id)
}

/// Search secrets by query string.
pub fn search_secrets(secrets: &[DashlaneSecret], query: &str) -> Vec<DashlaneSecret> {
    let lower = query.to_lowercase();
    secrets
        .iter()
        .filter(|s| {
            s.title.to_lowercase().contains(&lower)
                || s.content.to_lowercase().contains(&lower)
        })
        .cloned()
        .collect()
}

/// Filter secrets by category.
pub fn filter_by_category(secrets: &[DashlaneSecret], category: &str) -> Vec<DashlaneSecret> {
    secrets
        .iter()
        .filter(|s| s.category.as_deref() == Some(category))
        .cloned()
        .collect()
}

/// Get all unique secret categories.
pub fn get_secret_categories(secrets: &[DashlaneSecret]) -> Vec<String> {
    let mut cats: Vec<String> = secrets
        .iter()
        .filter_map(|s| s.category.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    cats.sort();
    cats
}

/// Update a secret.
pub fn update_secret(
    secret: &mut DashlaneSecret,
    title: Option<String>,
    content: Option<String>,
    category: Option<String>,
) {
    if let Some(t) = title {
        secret.title = t;
    }
    if let Some(c) = content {
        secret.content = c;
    }
    if let Some(cat) = category {
        secret.category = Some(cat);
    }
    secret.modified_at = Some(chrono::Utc::now().to_rfc3339());
}

/// Sort secrets by title.
pub fn sort_by_title(secrets: &mut [DashlaneSecret]) {
    secrets.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
}
