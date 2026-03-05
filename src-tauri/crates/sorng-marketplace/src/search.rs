//! Full-text search, tokenisation, and relevance scoring.

use crate::types::MarketplaceListing;

/// Split `text` into lowercase tokens (alphanumeric runs).
pub fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

/// Returns `true` if every token of `query` appears somewhere in the
/// listing's name, display_name, description, tags, or author name.
pub fn matches_query(listing: &MarketplaceListing, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    let query_tokens = tokenize(query);
    if query_tokens.is_empty() {
        return true;
    }

    let hay = build_haystack(listing);
    let hay_lower = hay.to_lowercase();

    query_tokens.iter().all(|qt| hay_lower.contains(qt.as_str()))
}

/// Compute a weighted relevance score for `listing` against `query`.
///
/// Scoring weights:
/// - Exact name match: 100
/// - Name contains token: 40 per token
/// - Display-name contains token: 30 per token
/// - Tag exact match: 25 per token
/// - Author name contains token: 15 per token
/// - Description contains token: 10 per token
/// - Long description contains token: 5 per token
///
/// A small boost is added for verified (+5) and featured (+3) listings.
pub fn calculate_relevance(listing: &MarketplaceListing, query: &str) -> f64 {
    if query.is_empty() {
        return 0.0;
    }

    let query_tokens = tokenize(query);
    if query_tokens.is_empty() {
        return 0.0;
    }

    let name_lower = listing.name.to_lowercase();
    let display_lower = listing.display_name.to_lowercase();
    let desc_lower = listing.description.to_lowercase();
    let long_desc_lower = listing
        .long_description
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let author_lower = listing.author.name.to_lowercase();
    let tags_lower: Vec<String> = listing.tags.iter().map(|t| t.to_lowercase()).collect();

    let mut score: f64 = 0.0;

    // Exact name match (entire query).
    let full_query_lower = query.to_lowercase();
    if name_lower == full_query_lower {
        score += 100.0;
    }

    for qt in &query_tokens {
        if name_lower.contains(qt.as_str()) {
            score += 40.0;
        }
        if display_lower.contains(qt.as_str()) {
            score += 30.0;
        }
        if tags_lower.iter().any(|t| t == qt) {
            score += 25.0;
        }
        if author_lower.contains(qt.as_str()) {
            score += 15.0;
        }
        if desc_lower.contains(qt.as_str()) {
            score += 10.0;
        }
        if long_desc_lower.contains(qt.as_str()) {
            score += 5.0;
        }
    }

    // Bonus for verified / featured.
    if listing.verified {
        score += 5.0;
    }
    if listing.featured {
        score += 3.0;
    }

    score
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Concatenate all searchable text into a single haystack.
fn build_haystack(listing: &MarketplaceListing) -> String {
    let mut parts: Vec<&str> = vec![
        &listing.name,
        &listing.display_name,
        &listing.description,
        &listing.author.name,
    ];
    if let Some(ref ld) = listing.long_description {
        parts.push(ld);
    }
    for tag in &listing.tags {
        parts.push(tag);
    }
    parts.join(" ")
}
