// sorng-replay – HAR replay (HTTP traffic)
//
// Parse HAR JSON, build a waterfall diagram, get entries at a point in
// time, and compute summary statistics.

use std::collections::HashMap;

use crate::error::{ReplayError, ReplayResult};
use crate::types::{HarEntry, HarStats, WaterfallBar};

/// Parse a HAR 1.2 JSON string into a flat Vec of `HarEntry`.
pub fn parse_har(data: &str) -> ReplayResult<Vec<HarEntry>> {
    let root: serde_json::Value =
        serde_json::from_str(data).map_err(|e| ReplayError::ParseError(e.to_string()))?;

    let entries_val = root
        .pointer("/log/entries")
        .ok_or_else(|| ReplayError::ParseError("missing /log/entries".into()))?
        .as_array()
        .ok_or_else(|| ReplayError::ParseError("/log/entries is not an array".into()))?;

    let mut entries: Vec<HarEntry> = Vec::with_capacity(entries_val.len());

    // We need a reference point for relative timestamps.  Use the
    // "startedDateTime" of the first entry (ISO-8601).  If parsing fails,
    // fall back to treating the entries's `time` field as cumulative ms.
    let base_time: Option<chrono::DateTime<chrono::Utc>> = entries_val
        .first()
        .and_then(|e| e.get("startedDateTime"))
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    for entry in entries_val {
        let started = entry
            .get("startedDateTime")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc));

        let timestamp_ms = match (started, base_time) {
            (Some(s), Some(b)) => (s - b).num_milliseconds().max(0) as u64,
            _ => entry
                .get("time")
                .and_then(|v| v.as_f64())
                .map(|t| t as u64)
                .unwrap_or(0),
        };

        let duration_ms = entry
            .get("time")
            .and_then(|v| v.as_f64())
            .map(|t| t.max(0.0) as u64)
            .unwrap_or(0);

        let request = entry.get("request");
        let response = entry.get("response");

        let method = request
            .and_then(|r| r.get("method"))
            .and_then(|v| v.as_str())
            .unwrap_or("GET")
            .to_string();

        let url = request
            .and_then(|r| r.get("url"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let status = response
            .and_then(|r| r.get("status"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u16;

        let request_size = request
            .and_then(|r| r.get("bodySize"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let response_size = response
            .and_then(|r| r.get("bodySize"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let content_type = response
            .and_then(|r| r.get("content"))
            .and_then(|c| c.get("mimeType"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let headers = request
            .and_then(|r| r.get("headers"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|h| {
                        let name = h.get("name")?.as_str()?.to_string();
                        let value = h.get("value")?.as_str()?.to_string();
                        Some((name, value))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        entries.push(HarEntry {
            timestamp_ms,
            method,
            url,
            status,
            duration_ms,
            request_size,
            response_size,
            content_type,
            headers,
        });
    }

    entries.sort_by_key(|e| e.timestamp_ms);
    Ok(entries)
}

/// Colour string based on content type.
fn color_for_content_type(ct: &Option<String>) -> String {
    match ct.as_deref() {
        Some(s) if s.contains("javascript") => "#F7DF1E".to_string(),
        Some(s) if s.contains("css") => "#264DE4".to_string(),
        Some(s) if s.contains("html") => "#E34F26".to_string(),
        Some(s) if s.contains("json") => "#61DAFB".to_string(),
        Some(s) if s.contains("image") => "#4CAF50".to_string(),
        Some(s) if s.contains("font") => "#9C27B0".to_string(),
        Some(s) if s.contains("xml") => "#FF9800".to_string(),
        _ => "#9E9E9E".to_string(),
    }
}

/// Build waterfall bars for a waterfall chart.  All values are in
/// percentages (0.0 – 100.0) of the total timeline span.
pub fn build_waterfall(entries: &[HarEntry]) -> Vec<WaterfallBar> {
    if entries.is_empty() {
        return Vec::new();
    }

    let timeline_end = entries
        .iter()
        .map(|e| e.timestamp_ms + e.duration_ms)
        .max()
        .unwrap_or(1);

    let span = timeline_end as f64;
    if span <= 0.0 {
        return Vec::new();
    }

    entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let start_pct = (e.timestamp_ms as f64 / span) * 100.0;
            let width_pct = (e.duration_ms as f64 / span) * 100.0;
            WaterfallBar {
                entry_index: i,
                start_pct,
                width_pct,
                color: color_for_content_type(&e.content_type),
            }
        })
        .collect()
}

/// Return all entries that are "in progress" at `position_ms`, meaning
/// the entry started before or at that time and hasn't finished yet.
pub fn get_entries_at_time<'a>(entries: &'a [HarEntry], position_ms: u64) -> Vec<&'a HarEntry> {
    entries
        .iter()
        .filter(|e| e.timestamp_ms <= position_ms && e.timestamp_ms + e.duration_ms >= position_ms)
        .collect()
}

/// Compute summary statistics for a set of HAR entries.
pub fn get_stats(entries: &[HarEntry]) -> HarStats {
    let total_requests = entries.len();
    let total_size: u64 = entries.iter().map(|e| e.request_size + e.response_size).sum();

    let avg_duration_ms = if total_requests > 0 {
        entries.iter().map(|e| e.duration_ms).sum::<u64>() as f64 / total_requests as f64
    } else {
        0.0
    };

    let mut by_status: HashMap<u16, usize> = HashMap::new();
    let mut by_content_type: HashMap<String, usize> = HashMap::new();

    for e in entries {
        *by_status.entry(e.status).or_insert(0) += 1;
        let ct = e
            .content_type
            .as_deref()
            .unwrap_or("unknown")
            .to_string();
        *by_content_type.entry(ct).or_insert(0) += 1;
    }

    HarStats {
        total_requests,
        total_size,
        avg_duration_ms,
        by_status,
        by_content_type,
    }
}
