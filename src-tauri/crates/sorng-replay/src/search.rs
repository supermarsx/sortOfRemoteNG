// sorng-replay – Full-text search within recordings

use crate::types::{Annotation, HarEntry, SearchResult, TerminalEventType, TerminalFrame};

/// Search terminal frames for `query`.
///
/// Returns a `SearchResult` for every frame whose output contains the
/// query string.  If `case_sensitive` is false the comparison is
/// performed on lower-cased copies.
pub fn search_terminal(
    frames: &[TerminalFrame],
    query: &str,
    case_sensitive: bool,
) -> Vec<SearchResult> {
    if query.is_empty() {
        return Vec::new();
    }

    let query_cmp = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    let mut results = Vec::new();
    let mut line_counter: u32 = 1;

    for frame in frames {
        if !matches!(frame.event_type, TerminalEventType::Output) {
            continue;
        }

        let haystack = if case_sensitive {
            frame.data.clone()
        } else {
            frame.data.to_lowercase()
        };

        if haystack.contains(&query_cmp) {
            // Build context: up to 120 chars centred on the first hit
            let hit_pos = haystack.find(&query_cmp).unwrap_or(0);
            let ctx_start = hit_pos.saturating_sub(40);
            let ctx_end = (hit_pos + query_cmp.len() + 80).min(frame.data.len());
            let context = frame.data[ctx_start..ctx_end].to_string();

            // Extract actual match text from the original data
            let match_text = frame.data
                [hit_pos..((hit_pos + query.len()).min(frame.data.len()))]
                .to_string();

            results.push(SearchResult {
                position_ms: frame.timestamp_ms,
                context,
                match_text,
                line_number: Some(line_counter),
            });
        }

        // Count newlines for approximate line tracking
        line_counter += frame.data.matches('\n').count() as u32;
    }

    results
}

/// Search HAR entries for `query` across URLs, methods, headers, and
/// content types.
pub fn search_har(entries: &[HarEntry], query: &str) -> Vec<SearchResult> {
    if query.is_empty() {
        return Vec::new();
    }

    let q = query.to_lowercase();
    let mut results = Vec::new();

    for entry in entries {
        let mut matched_in: Vec<String> = Vec::new();

        if entry.url.to_lowercase().contains(&q) {
            matched_in.push(format!("url: {}", entry.url));
        }
        if entry.method.to_lowercase().contains(&q) {
            matched_in.push(format!("method: {}", entry.method));
        }
        if let Some(ref ct) = entry.content_type {
            if ct.to_lowercase().contains(&q) {
                matched_in.push(format!("content-type: {ct}"));
            }
        }
        for (name, value) in &entry.headers {
            if name.to_lowercase().contains(&q) || value.to_lowercase().contains(&q) {
                matched_in.push(format!("{name}: {value}"));
                break; // one header hit is enough per entry
            }
        }

        if !matched_in.is_empty() {
            results.push(SearchResult {
                position_ms: entry.timestamp_ms,
                context: format!("{} {} → {}", entry.method, entry.url, entry.status),
                match_text: matched_in.join("; "),
                line_number: None,
            });
        }
    }

    results
}

/// Search annotation text for `query` (case-insensitive).
pub fn search_annotations(annotations: &[Annotation], query: &str) -> Vec<SearchResult> {
    if query.is_empty() {
        return Vec::new();
    }

    let q = query.to_lowercase();

    annotations
        .iter()
        .filter(|a| a.text.to_lowercase().contains(&q))
        .map(|a| SearchResult {
            position_ms: a.position_ms,
            context: a.text.clone(),
            match_text: query.to_string(),
            line_number: None,
        })
        .collect()
}
