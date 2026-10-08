//! Deliberately metadata-only HAR 1.2. Unknown wire sizes/timing components are
//! -1 rather than fabricated. Export is data, not a path or filesystem write.
use super::RecordingData;
use serde_json::{json, Value};

pub(super) fn export(data: &RecordingData, iso_time: &dyn Fn(u64) -> String) -> Value {
    let entries: Vec<_> = data.entries.iter().map(|entry| json!({
        "startedDateTime": iso_time(entry.started_unix_ms),
        "time": entry.duration_ms,
        "request": { "method": entry.method, "url": entry.url, "httpVersion": "",
            "cookies": [], "headers": [], "queryString": [], "headersSize": -1, "bodySize": -1 },
        "response": { "status": entry.status, "statusText": "", "httpVersion": "",
            "cookies": [], "headers": [], "content": { "size": entry.received_body_bytes, "mimeType": "" },
            "redirectURL": "", "headersSize": -1, "bodySize": -1 },
        "cache": {}, "timings": { "send": 0, "wait": entry.duration_ms, "receive": 0 },
        "_timingsAggregated": true, "_outcome": entry.outcome,
    })).collect();
    json!({"log": {
        "version": "1.2", "creator": {"name":"sortOfRemoteNG native CEF metadata recorder","version":"1"},
        "entries": entries,
        "_metadataOnly": true,
        "_omitted": ["urlPath","urlQuery","urlFragment","urlCredentials","headers","cookies","requestBodies","responseBodies","detailedTimings"],
        "_droppedEntries": data.snapshot.dropped_entries,
        "_phase": data.snapshot.phase,
    }})
}
