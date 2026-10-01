//! Native-owned, whole-settings-artifact record history. No copies or hashes of
//! content are persisted here: comparisons use the two in-memory snapshots.
//!
//! Keys consist of `/key:<JSON-pointer-escaped property>` and
//! `/id:s:<escaped string ID>` or `/id:n:<integer ID>` segments. Arrays without IDs remain one
//! record; their positions and values never become identities. Metadata is not
//! an independently syncable preferences document.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const KEY: &str = "recordTimestamps";
const EPOCH: &str = "1970-01-01T00:00:00.000Z";
// Fail closed at these limits: never truncate history or discard tombstones.
const MAX_RECORDS: usize = 16_384;
// Match the JS ledger's million-event ceiling; status polling does not consume
// it. The per-record limit must not impose a lower effective global ceiling.
const MAX_RECORD_HISTORY: usize = 1_000_000;
const MAX_TOTAL_HISTORY: usize = 1_000_000;
const MAX_SETTINGS_DEPTH: usize = 64;
const MAX_PATH_BYTES: usize = 4096;
const MAX_VALUE_NODES: usize = 8_000_000;
// The native artifact contains both payload (64 MiB) and metadata (128 MiB).
const MAX_SETTINGS_TEXT_BYTES: usize = 192 * 1024 * 1024;
const MAX_METADATA_TEXT_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Origin {
    Inferred,
    Preserved,
    Recorded,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Operation {
    Created,
    Updated,
    Deleted,
    Restored,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Event {
    at: String,
    operation: Operation,
    origin: Origin,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    created_at: String,
    updated_at: String,
    created_at_origin: Origin,
    updated_at_origin: Origin,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    deleted_at: Option<String>,
    history: Vec<Event>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Ledger {
    version: u32,
    records: BTreeMap<String, Record>,
}

fn invalid() -> String {
    // Never interpolate persisted metadata, IDs or serde errors: malformed
    // documents may contain secret content in otherwise structural fields.
    "invalid or unsupported settings recordTimestamps; nothing was saved".into()
}

fn bounded_tree(value: &Value, max_depth: usize, max_text: usize) -> Result<(), String> {
    fn visit(
        value: &Value,
        depth: usize,
        nodes: &mut usize,
        text: &mut usize,
    ) -> Result<(), String> {
        if depth == 0 || *nodes == 0 {
            return Err(invalid());
        }
        *nodes -= 1;
        match value {
            Value::Object(object) => {
                for (key, child) in object {
                    *text = text.checked_sub(key.len()).ok_or_else(invalid)?;
                    visit(child, depth - 1, nodes, text)?;
                }
            }
            Value::Array(items) => {
                for child in items {
                    visit(child, depth - 1, nodes, text)?;
                }
            }
            Value::String(string) => *text = text.checked_sub(string.len()).ok_or_else(invalid)?,
            _ => {}
        }
        Ok(())
    }
    let mut nodes = MAX_VALUE_NODES;
    let mut text = max_text;
    visit(value, max_depth, &mut nodes, &mut text)
}

fn validate_record(record: &Record) -> Result<(), String> {
    let created = timestamp(&record.created_at).ok_or_else(invalid)?;
    let updated = timestamp(&record.updated_at).ok_or_else(invalid)?;
    if created > updated || record.history.is_empty() || record.history.len() > MAX_RECORD_HISTORY {
        return Err(invalid());
    }
    let first = &record.history[0];
    if first.operation != Operation::Created
        || first.at != record.created_at
        || first.origin != record.created_at_origin
    {
        return Err(invalid());
    }
    let mut previous = created;
    let mut deleted = false;
    for (index, event) in record.history.iter().enumerate().skip(1) {
        let date = timestamp(&event.at).ok_or_else(invalid)?;
        if date < previous {
            return Err(invalid());
        }
        if (event.origin == Origin::Preserved
            || (event.origin == Origin::Inferred && event.operation == Operation::Updated))
            && !(index == 1
                && event.operation == Operation::Updated
                && record.created_at_origin != Origin::Recorded)
        {
            return Err(invalid());
        }
        match (deleted, event.operation) {
            (false, Operation::Updated) => {}
            (false, Operation::Deleted) => deleted = true,
            (true, Operation::Restored) => deleted = false,
            _ => return Err(invalid()),
        }
        previous = date;
    }
    let last = record.history.last().ok_or_else(invalid)?;
    if last.at != record.updated_at
        || last.origin != record.updated_at_origin
        || deleted != record.deleted_at.is_some()
        || record
            .deleted_at
            .as_ref()
            .is_some_and(|date| date != &record.updated_at)
    {
        return Err(invalid());
    }
    Ok(())
}

fn validate_ledger(ledger: &Ledger) -> Result<(), String> {
    if ledger.version != 1 || ledger.records.len() > MAX_RECORDS {
        return Err(invalid());
    }
    let mut history_count = 0usize;
    for (path, record) in &ledger.records {
        if !valid_path(path) {
            return Err(invalid());
        }
        validate_record(record)?;
        count_history(record.history.len(), &mut history_count)?;
    }
    Ok(())
}

fn count_history(length: usize, total: &mut usize) -> Result<(), String> {
    if length > MAX_RECORD_HISTORY {
        return Err(invalid());
    }
    *total = total.checked_add(length).ok_or_else(invalid)?;
    if *total > MAX_TOTAL_HISTORY {
        return Err(invalid());
    }
    Ok(())
}

fn read_ledger(settings: &Value) -> Result<Ledger, String> {
    bounded_tree(settings, MAX_SETTINGS_DEPTH, MAX_SETTINGS_TEXT_BYTES)?;
    if !settings.is_object() {
        return Err("existing settings root must be a JSON object".into());
    }
    let Some(value) = settings.get(KEY) else {
        return Ok(Ledger {
            version: 1,
            records: BTreeMap::new(),
        });
    };
    // Check borrowed structure before cloning/deserializing potentially large
    // vectors, strings or unexpected nested snapshot bodies.
    bounded_tree(value, 6, MAX_METADATA_TEXT_BYTES)?;
    if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(invalid());
    }
    let records = value
        .get("records")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    if records.len() > MAX_RECORDS {
        return Err(invalid());
    }
    let mut total = 0usize;
    for (path, record) in records {
        if !valid_path(path) {
            return Err(invalid());
        }
        let history = record
            .get("history")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        count_history(history.len(), &mut total)?;
    }
    let ledger: Ledger = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    validate_ledger(&ledger)?;
    Ok(ledger)
}

pub(super) fn validate(settings: &Value) -> Result<(), String> {
    read_ledger(settings).map(|_| ())
}

pub(super) fn reject_patch(patch: &Value) -> Result<(), String> {
    if patch.get(KEY).is_some() {
        return Err(
            "recordTimestamps is reserved native settings metadata; omit it from patches".into(),
        );
    }
    bounded_tree(patch, MAX_SETTINGS_DEPTH, MAX_SETTINGS_TEXT_BYTES)?;
    Ok(())
}

fn escape(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn valid_path(path: &str) -> bool {
    path.len() <= MAX_PATH_BYTES
        && path.split('/').count() <= MAX_SETTINGS_DEPTH * 2
        && !path.starts_with("/key:recordTimestamps/")
        && path != "/key:recordTimestamps"
        && path.starts_with("/key:")
        && path.split('/').skip(1).all(|segment| {
            let Some(value) = segment
                .strip_prefix("key:")
                .or_else(|| segment.strip_prefix("id:s:"))
                .or_else(|| segment.strip_prefix("id:n:"))
            else {
                return false;
            };
            let mut chars = value.chars();
            while let Some(ch) = chars.next() {
                if ch == '~' && !matches!(chars.next(), Some('0' | '1')) {
                    return false;
                }
            }
            true
        })
}

fn identity(value: &Value) -> Result<Option<String>, String> {
    Ok(match value.get("id") {
        Some(Value::String(id)) if !id.is_empty() => {
            if id.len() > MAX_PATH_BYTES {
                return Err(invalid());
            }
            Some(format!("s:{}", escape(id)))
        }
        Some(Value::Number(id)) if id.is_i64() || id.is_u64() => Some(format!("n:{id}")),
        _ => None,
    })
}

fn reference_array(path: &str, items: &[Value]) -> bool {
    // References belong to another artifact/scope. Their IDs need not be
    // unique in this array; the owning preference records the complete list.
    path.ends_with("/key:sshQuickActions/key:items")
        || path.ends_with("/key:httpAutomation/key:items")
        || items.iter().all(|item| {
            let Some(object) = item.as_object() else {
                return false;
            };
            let quick_action = matches!(
                item.get("kind").and_then(Value::as_str),
                Some("script" | "macro")
            ) && item.get("id").is_some_and(Value::is_string)
                && object
                    .keys()
                    .all(|key| matches!(key.as_str(), "kind" | "id" | "scope"));
            let document = item.get("databaseId").is_some_and(Value::is_string)
                && item.get("kind").is_some_and(Value::is_string)
                && item.get("id").is_some_and(Value::is_string)
                && (path.ends_with("/key:references")
                    || object.keys().all(|key| {
                        matches!(
                            key.as_str(),
                            "databaseId" | "kind" | "id" | "blockId" | "sheetId" | "address"
                        )
                    }));
            quick_action || document
        })
}

fn cloud_telemetry_field(key: &str) -> bool {
    matches!(
        key,
        "providerStatus" | "targetStatus" | "lastSyncTime" | "lastSyncStatus" | "lastSyncError"
    )
}

fn cloud_telemetry_path(path: &str) -> bool {
    path.strip_prefix("/key:cloudSync/key:")
        .is_some_and(|tail| cloud_telemetry_field(tail.split('/').next().unwrap_or("")))
}

fn collect<'a>(settings: &'a Value) -> Result<BTreeMap<String, &'a Value>, String> {
    fn visit<'a>(
        value: &'a Value,
        path: String,
        records: &mut BTreeMap<String, &'a Value>,
    ) -> Result<(), String> {
        if records.len() >= MAX_RECORDS || !valid_path(&path) {
            return Err(invalid());
        }
        if records.insert(path.clone(), value).is_some() {
            return Err("duplicate settings record identity; nothing was saved".into());
        }
        match value {
            Value::Object(object) => {
                for (key, child) in object {
                    if matches!(key.as_str(), "createdAt" | "updatedAt" | "id") {
                        continue;
                    }
                    if path == "/key:cloudSync" && cloud_telemetry_field(key) {
                        continue;
                    }
                    if key.len() > MAX_PATH_BYTES {
                        return Err(invalid());
                    }
                    let mut child_path = format!("{path}/key:{}", escape(key));
                    if let Some(id) = identity(child)? {
                        child_path.push_str(&format!("/id:{id}"));
                    }
                    visit(child, child_path, records)?;
                }
            }
            Value::Array(items) => {
                if reference_array(&path, items) {
                    return Ok(());
                }
                for item in items {
                    if let Some(id) = identity(item)? {
                        visit(item, format!("{path}/id:{id}"), records)?;
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
    let mut records = BTreeMap::new();
    for (key, value) in settings.as_object().ok_or_else(invalid)? {
        if key == KEY {
            continue;
        }
        if key.len() > MAX_PATH_BYTES {
            return Err(invalid());
        }
        let mut path = format!("/key:{}", escape(key));
        if let Some(id) = identity(value)? {
            path.push_str(&format!("/id:{id}"));
        }
        visit(value, path, &mut records)?;
    }
    Ok(records)
}

/// Frontend-maintained timestamp fields are historical evidence on first
/// observation, not editable content. A frontend stamping an otherwise equal
/// profile must not invent a native record edit.
fn same_content(a: &Value, b: &Value, cloud_sync_owner: bool) -> bool {
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            let keys: BTreeSet<_> = a
                .keys()
                .chain(b.keys())
                .filter(|key| !matches!(key.as_str(), "createdAt" | "updatedAt"))
                .filter(|key| !cloud_sync_owner || !cloud_telemetry_field(key))
                .collect();
            keys.into_iter().all(|key| match (a.get(key), b.get(key)) {
                (Some(a), Some(b)) => same_content(a, b, false),
                _ => false,
            })
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_content(a, b, false))
        }
        _ => a == b,
    }
}

fn initial_record(value: &Value, now: Option<&str>) -> Result<Record, String> {
    let known = |field| {
        value
            .get(field)
            .and_then(Value::as_str)
            .filter(|s| valid_timestamp(s))
    };
    let (mut created_at, created_at_origin) = match now.or_else(|| known("createdAt")) {
        Some(date) if now.is_some() => (date, Origin::Recorded),
        Some(date) => (date, Origin::Preserved),
        None => (EPOCH, Origin::Inferred),
    };
    let (updated_at, updated_at_origin) = match now.or_else(|| known("updatedAt")) {
        Some(date) if now.is_some() => (date, Origin::Recorded),
        Some(date) => (date, Origin::Preserved),
        None => (created_at, Origin::Inferred),
    };
    // Unknown history needs a lower bound, never an invented current edit.
    // For rare pre-epoch evidence the known update bounds inferred creation.
    if created_at_origin == Origin::Inferred && timestamp(created_at) > timestamp(updated_at) {
        created_at = updated_at;
    }
    let mut history = vec![Event {
        at: created_at.into(),
        operation: Operation::Created,
        origin: created_at_origin,
    }];
    if updated_at != created_at || updated_at_origin != created_at_origin {
        history.push(Event {
            at: updated_at.into(),
            operation: Operation::Updated,
            origin: updated_at_origin,
        });
    }
    let record = Record {
        created_at: created_at.into(),
        updated_at: updated_at.into(),
        created_at_origin,
        updated_at_origin,
        deleted_at: None,
        history,
    };
    validate_record(&record)?;
    Ok(record)
}

/// Seed legacy records first, then compare the pending write. Thus the first
/// edit to an old file cannot give its pre-existing records a new creation date.
pub(super) fn reconcile(existing: &Value, next: &mut Value, now: &str) -> Result<(), String> {
    let mut ledger = read_ledger(existing)?;
    bounded_tree(next, MAX_SETTINGS_DEPTH, MAX_SETTINGS_TEXT_BYTES)?;
    let write_time = timestamp(now).ok_or_else(invalid)?;
    let before = collect(existing)?;
    let after = collect(next)?;
    for (path, value) in &before {
        if !ledger.records.contains_key(path) {
            ledger
                .records
                .insert(path.clone(), initial_record(value, None)?);
        }
        let record = ledger.records.get_mut(path).ok_or_else(invalid)?;
        if record.deleted_at.take().is_some() {
            // Restored outside the native boundary before this transaction.
            record.updated_at_origin = Origin::Inferred;
            record.history.push(Event {
                at: record.updated_at.clone(),
                operation: Operation::Restored,
                origin: Origin::Inferred,
            });
        }
    }
    for (path, value) in &after {
        match ledger.records.get_mut(path) {
            None => {
                ledger
                    .records
                    .insert(path.clone(), initial_record(value, Some(now))?);
            }
            Some(record) => {
                let restored = record.deleted_at.is_some();
                let changed = before
                    .get(path)
                    .is_some_and(|old| !same_content(old, value, path == "/key:cloudSync"));
                if restored || changed {
                    // Dates are advisory history, not commit-order authority.
                    // Clock skew may produce tied dates but must not block an
                    // otherwise valid save or change immutable creation time.
                    let effective =
                        if write_time < timestamp(&record.updated_at).ok_or_else(invalid)? {
                            record.updated_at.clone()
                        } else {
                            now.to_owned()
                        };
                    record.updated_at = effective.clone();
                    record.updated_at_origin = Origin::Recorded;
                    record.deleted_at = None;
                    record.history.push(Event {
                        at: effective,
                        origin: Origin::Recorded,
                        operation: if restored {
                            Operation::Restored
                        } else {
                            Operation::Updated
                        },
                    });
                }
            }
        }
    }
    for (path, record) in &mut ledger.records {
        // Keep pre-existing telemetry history intact, but do not append even
        // inferred deletion events just because enumeration now excludes it.
        if cloud_telemetry_path(path) {
            continue;
        }
        if !after.contains_key(path) && record.deleted_at.is_none() {
            // An entry absent already on disk was removed outside this boundary:
            // retain an explicitly inferred tombstone, never date it as this edit.
            let (date, origin) = if before.contains_key(path) {
                let effective = if write_time < timestamp(&record.updated_at).ok_or_else(invalid)? {
                    record.updated_at.clone()
                } else {
                    now.to_owned()
                };
                (effective, Origin::Recorded)
            } else {
                (record.updated_at.clone(), Origin::Inferred)
            };
            record.updated_at = date.clone();
            record.updated_at_origin = origin;
            record.deleted_at = Some(date.clone());
            record.history.push(Event {
                at: date,
                operation: Operation::Deleted,
                origin,
            });
        }
    }
    validate_ledger(&ledger)?;
    let metadata = serde_json::to_value(ledger).map_err(|_| invalid())?;
    bounded_tree(&metadata, 6, MAX_METADATA_TEXT_BYTES)?;
    next.as_object_mut()
        .ok_or_else(invalid)?
        .insert(KEY.into(), metadata);
    Ok(())
}

pub(super) fn migration_needed(settings: &Value) -> Result<bool, String> {
    let mut migrated = settings.clone();
    reconcile(settings, &mut migrated, EPOCH)?;
    Ok(migrated != *settings)
}

// The command source is compiled by both app and commands-core; chrono is only
// a dev dependency in app. Keep production time formatting dependency-free.
pub(super) fn now() -> Result<String, String> {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "system clock predates the Unix epoch".to_string())?;
    let date = format_unix_millis(
        elapsed
            .as_millis()
            .try_into()
            .map_err(|_| "system clock is out of range")?,
    );
    if !valid_timestamp(&date) {
        return Err("system clock is out of range".into());
    }
    Ok(date)
}

fn format_unix_millis(millis: u64) -> String {
    // Gregorian civil_from_days, also used by sorng-encryption's audit clock.
    let seconds = millis / 1000;
    let z = (seconds / 86_400) as i64 + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds / 3600 % 24,
        seconds / 60 % 60,
        seconds % 60,
        millis % 1000
    )
}

fn valid_timestamp(date: &str) -> bool {
    timestamp(date).is_some()
}

/// Compare instants, not RFC3339 spellings: offsets and subsecond evidence must
/// not let reversed history pass. The tuple retains nanosecond precision.
fn timestamp(date: &str) -> Option<(i64, u32)> {
    // Preserve valid RFC3339 evidence verbatim, including offsets/fractions.
    // Restrict to ASCII before slicing so malformed metadata cannot panic.
    if !date.is_ascii() || !(20..=35).contains(&date.len()) {
        return None;
    }
    let number = |range: std::ops::Range<usize>| {
        date.get(range)
            .filter(|s| s.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|s| s.parse::<u32>().ok())
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    ) else {
        return None;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return None,
    };
    if &date[4..5] != "-"
        || &date[7..8] != "-"
        || !matches!(&date[10..11], "T" | "t")
        || &date[13..14] != ":"
        || &date[16..17] != ":"
        || day == 0
        || day > days
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut suffix = &date[19..];
    let mut nanos = 0;
    if let Some(fraction) = suffix.strip_prefix('.') {
        let count = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if count == 0 || count > 9 {
            return None;
        }
        nanos = fraction[..count].parse::<u32>().ok()? * 10u32.pow(9 - count as u32);
        suffix = &fraction[count..];
    }
    let offset = if matches!(suffix, "Z" | "z") {
        0
    } else if suffix.len() == 6
        && matches!(&suffix[..1], "+" | "-")
        && &suffix[3..4] == ":"
        && suffix[1..3]
            .bytes()
            .chain(suffix[4..6].bytes())
            .all(|byte| byte.is_ascii_digit())
        && suffix[1..3].parse::<u32>().is_ok_and(|hour| hour <= 23)
        && suffix[4..6].parse::<u32>().is_ok_and(|minute| minute <= 59)
    {
        let minutes = suffix[1..3].parse::<i64>().ok()? * 60 + suffix[4..6].parse::<i64>().ok()?;
        minutes * 60 * if suffix.starts_with('-') { -1 } else { 1 }
    } else {
        return None;
    };
    // Gregorian days_from_civil, inverse of the UTC write clock above.
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let doy = (153 * month + 2) / 5 + i64::from(day) - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    // Keep leap-second evidence between :59 and the next minute, as chrono
    // does, rather than silently equating it to the following whole second.
    Some((
        days * 86_400 + i64::from(hour * 3600 + minute * 60 + second.min(59)) - offset,
        nanos + if second == 60 { 1_000_000_000 } else { 0 },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIRST: &str = "2026-10-01T10:00:00.000Z";
    const SECOND: &str = "2026-10-01T11:00:00.000Z";

    fn migrate(value: &Value) -> Value {
        let mut next = value.clone();
        reconcile(value, &mut next, FIRST).unwrap();
        next
    }

    #[test]
    fn legacy_settings_cover_preferences_lists_and_nested_id_objects_without_content_history() {
        let legacy = json!({
            "theme": "dark",
            "proxyProfiles": [{"id":"proxy/one~", "password":"never-copy-this", "host":"private-host"}],
            "sshTunnelProfiles": [{"id":"tunnel", "port":22}],
            "cloudSync": {"syncTargets":[{"id":"target", "providerConfig":{"token":"never-copy-this"}}]},
            "vpn": {"selected": {"id":"vpn", "enabled":true}},
            "idless": [{"name":"anonymous-value"}]
        });
        let migrated = migrate(&legacy);
        for path in [
            "/key:theme",
            "/key:proxyProfiles/id:s:proxy~1one~0",
            "/key:sshTunnelProfiles/id:s:tunnel",
            "/key:cloudSync/key:syncTargets/id:s:target",
            "/key:vpn/key:selected/id:s:vpn",
            "/key:vpn/key:selected/id:s:vpn/key:enabled",
            "/key:idless",
        ] {
            assert_eq!(migrated[KEY]["records"][path]["createdAt"], EPOCH, "{path}");
            assert_eq!(
                migrated[KEY]["records"][path]["updatedAtOrigin"],
                "inferred"
            );
        }
        let serialized = migrated[KEY].to_string();
        for forbidden in [
            "never-copy-this",
            "private-host",
            "anonymous-value",
            "digest",
            "sha256",
        ] {
            assert!(!serialized.contains(forbidden));
        }
        assert!(!migration_needed(&migrated).unwrap());
        assert_eq!(migrate(&migrated), migrated);
        let mut content = migrated;
        content.as_object_mut().unwrap().remove(KEY);
        assert_eq!(content, legacy);
    }

    #[test]
    fn known_legacy_dates_are_honored_and_missing_history_is_individually_inferred() {
        let legacy = json!({"profiles":[
            {"id":"both", "createdAt":"2020-02-29T12:01:02+03:00", "updatedAt":"2021-05-04T00:00:00Z"},
            {"id":"created", "createdAt":"2020-01-01T00:00:00Z"},
            {"id":"updated", "updatedAt":"2021-01-01T00:00:00Z"}
        ]});
        let migrated = migrate(&legacy);
        let records = &migrated[KEY]["records"];
        assert_eq!(
            records["/key:profiles/id:s:both"]["createdAt"],
            legacy["profiles"][0]["createdAt"]
        );
        assert_eq!(
            records["/key:profiles/id:s:both"]["updatedAtOrigin"],
            "preserved"
        );
        assert_eq!(
            records["/key:profiles/id:s:created"]["updatedAt"],
            "2020-01-01T00:00:00Z"
        );
        assert_eq!(
            records["/key:profiles/id:s:created"]["updatedAtOrigin"],
            "inferred"
        );
        validate(&migrated).unwrap();
        assert_eq!(
            records["/key:profiles/id:s:updated"]["createdAtOrigin"],
            "inferred"
        );
    }

    #[test]
    fn first_write_seeds_legacy_then_dates_only_changes_and_new_records() {
        let legacy = json!({"theme":"dark", "language":"en", "profiles":[{"id":"old","value":1}]});
        let mut next = json!({"theme":"light", "language":"en", "profiles":[
            {"id":"old","value":2},
            {"id":"new","createdAt":EPOCH,"updatedAt":EPOCH}
        ]});
        reconcile(&legacy, &mut next, FIRST).unwrap();
        let records = &next[KEY]["records"];
        assert_eq!(records["/key:theme"]["createdAt"], EPOCH);
        assert_eq!(records["/key:theme"]["updatedAt"], FIRST);
        assert_eq!(records["/key:language"]["updatedAt"], EPOCH);
        assert_eq!(records["/key:profiles/id:s:old"]["updatedAt"], FIRST);
        assert_eq!(records["/key:profiles/id:s:new"]["createdAt"], FIRST);
    }

    #[test]
    fn creation_is_immutable_and_frontend_timestamp_only_changes_do_not_invent_edits() {
        let legacy = json!({"profile":{"id":"p","createdAt":EPOCH,"updatedAt":EPOCH,"value":1}});
        let before = migrate(&legacy);
        let mut timestamp_only = before.clone();
        timestamp_only["profile"]["createdAt"] = json!(FIRST);
        timestamp_only["profile"]["updatedAt"] = json!(FIRST);
        reconcile(&before, &mut timestamp_only, FIRST).unwrap();
        assert_eq!(timestamp_only[KEY], before[KEY]);
        let mut edited = timestamp_only.clone();
        edited["profile"]["value"] = json!(2);
        reconcile(&timestamp_only, &mut edited, SECOND).unwrap();
        let record = &edited[KEY]["records"]["/key:profile/id:s:p"];
        assert_eq!(record["createdAt"], EPOCH);
        assert_eq!(record["updatedAt"], SECOND);
        assert_eq!(record["history"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn reorder_keeps_id_records_and_delete_restore_retains_creation_and_tombstone_history() {
        let mut initial = json!({"profiles":[{"id":"one","value":1},{"id":"two","value":2}]});
        reconcile(&json!({}), &mut initial, FIRST).unwrap();
        let mut reordered = initial.clone();
        reordered["profiles"].as_array_mut().unwrap().reverse();
        reconcile(&initial, &mut reordered, SECOND).unwrap();
        let key = "/key:profiles/id:s:one";
        assert_eq!(initial[KEY]["records"][key], reordered[KEY]["records"][key]);
        let mut deleted = reordered.clone();
        deleted["profiles"] = json!([{"id":"two","value":2}]);
        reconcile(&reordered, &mut deleted, SECOND).unwrap();
        assert_eq!(deleted[KEY]["records"][key]["deletedAt"], SECOND);
        assert_eq!(
            deleted[KEY]["records"][format!("{key}/key:value")]["deletedAt"],
            SECOND
        );
        assert!(!migration_needed(&deleted).unwrap());
        let mut restored = deleted.clone();
        restored["profiles"] = initial["profiles"].clone();
        reconcile(&deleted, &mut restored, SECOND).unwrap();
        let record = &restored[KEY]["records"][key];
        assert_eq!(record["createdAt"], FIRST);
        assert!(record.get("deletedAt").is_none());
        assert_eq!(record["history"][1]["operation"], "deleted");
        assert_eq!(record["history"][2]["operation"], "restored");
    }

    #[test]
    fn escaped_paths_and_typed_ids_are_distinct_and_duplicates_fail_closed() {
        let before = json!({"a/b":[{"id":1},{"id":"1"},{"id":"a/b"}],"a":{"b":true}});
        let migrated = migrate(&before);
        let records = migrated[KEY]["records"].as_object().unwrap();
        for path in [
            "/key:a~1b/id:n:1",
            "/key:a~1b/id:s:1",
            "/key:a~1b/id:s:a~1b",
            "/key:a/key:b",
        ] {
            assert!(records.contains_key(path));
        }
        let duplicate = json!({"profiles":[{"id":"secret-id"},{"id":"secret-id"}]});
        let error = reconcile(&duplicate, &mut duplicate.clone(), FIRST).unwrap_err();
        assert!(!error.contains("secret-id"));
    }

    #[test]
    fn malformed_and_future_metadata_is_rejected_without_echoing_its_values() {
        let valid = migrate(&json!({"theme":"dark"}));
        for bad in [
            Value::Null,
            json!({}),
            json!({"version":2,"records":{}}),
            json!({"version":1,"records":{},"extra":"private-value"}),
            json!({"version":1,"records":[]}),
        ] {
            let mut settings = valid.clone();
            settings[KEY] = bad;
            let error = validate(&settings).unwrap_err();
            assert!(!error.contains("private-value"));
        }
        for field in ["createdAt", "updatedAt", "createdAtOrigin", "history"] {
            let mut settings = valid.clone();
            settings[KEY]["records"]["/key:theme"][field] = json!("private-value");
            assert!(validate(&settings).is_err());
        }
        assert!(reject_patch(&json!({"recordTimestamps":null})).is_err());
    }

    #[test]
    fn scoped_quick_actions_and_document_references_are_atomic_owner_preferences() {
        let references = json!([
            {"kind":"script","id":"same"},
            {"kind":"script","id":"same","scope":{"kind":"app"}},
            {"kind":"macro","id":"same","scope":{"kind":"app"}},
            {"kind":"script","id":"same","scope":{"kind":"database","databaseId":"one"}},
            {"kind":"script","id":"same","scope":{"kind":"database","databaseId":"two"}}
        ]);
        let legacy = json!({
            "sshQuickActions":{"items":references}, "httpAutomation":{"items":references},
            "otherReferences":references,
            "documents":{"references":[
                {"databaseId":"one","kind":"document","id":"same"},
                {"databaseId":"two","kind":"document","id":"same"},
                {"databaseId":"one","kind":"connection","id":"same"},
                {"databaseId":"one","kind":"cell","id":"same","blockId":"b","sheetId":"s","address":"A1"}
            ]}
        });
        let before = migrate(&legacy);
        let keys: Vec<_> = before[KEY]["records"].as_object().unwrap().keys().collect();
        assert!(keys.iter().all(|key| !key.contains("/id:")));
        for key in [
            "/key:sshQuickActions/key:items",
            "/key:httpAutomation/key:items",
            "/key:documents/key:references",
        ] {
            assert!(before[KEY]["records"].get(key).is_some());
        }
        let mut next = before.clone();
        next["sshQuickActions"]["items"]
            .as_array_mut()
            .unwrap()
            .remove(0);
        reconcile(&before, &mut next, SECOND).unwrap();
        validate(&next).unwrap();
        assert_eq!(
            next[KEY]["records"]["/key:sshQuickActions"]["updatedAt"],
            SECOND
        );
        assert_eq!(
            next[KEY]["records"]["/key:httpAutomation"],
            before[KEY]["records"]["/key:httpAutomation"]
        );
        assert!(next[KEY]["records"]
            .as_object()
            .unwrap()
            .values()
            .all(|record| record.get("deletedAt").is_none()));
        // Actual owned entities with content still require unique identities.
        let owned = json!({"scripts":[{"kind":"script","id":"same","content":"a"},
            {"kind":"script","id":"same","content":"b"}]});
        assert!(reconcile(&owned, &mut owned.clone(), FIRST).is_err());
    }

    #[test]
    fn chronology_and_state_machine_reject_inconsistent_or_impossible_history() {
        let base = migrate(&json!({"theme":"dark"}));
        let key = "/key:theme";
        let event = |date: &str, operation: &str| json!({"at":date,"operation":operation,"origin":"recorded"});
        let mut variants = Vec::new();
        for (field, value) in [
            ("createdAt", json!(SECOND)),
            ("updatedAt", json!(FIRST)),
            ("createdAtOrigin", json!("preserved")),
            ("updatedAtOrigin", json!("recorded")),
            ("deletedAt", json!(EPOCH)),
        ] {
            let mut bad = base.clone();
            bad[KEY]["records"][key][field] = value;
            variants.push(bad);
        }
        for tail in [
            vec![event(FIRST, "created")],
            vec![event(FIRST, "restored")],
            vec![event(FIRST, "deleted"), event(SECOND, "updated")],
            vec![event(FIRST, "deleted"), event(SECOND, "deleted")],
            vec![event(SECOND, "updated"), event(FIRST, "updated")],
        ] {
            let mut bad = base.clone();
            let record = &mut bad[KEY]["records"][key];
            record["history"].as_array_mut().unwrap().extend(tail);
            record["updatedAt"] =
                record["history"].as_array().unwrap().last().unwrap()["at"].clone();
            record["updatedAtOrigin"] = json!("recorded");
            if record["history"].as_array().unwrap().last().unwrap()["operation"] == "deleted" {
                record["deletedAt"] = record["updatedAt"].clone();
            }
            variants.push(bad);
        }
        let mut mismatch = base.clone();
        let record = &mut mismatch[KEY]["records"][key];
        record["history"]
            .as_array_mut()
            .unwrap()
            .push(event(FIRST, "deleted"));
        record["updatedAt"] = json!(FIRST);
        record["updatedAtOrigin"] = json!("recorded");
        record["deletedAt"] = json!(SECOND);
        variants.push(mismatch);
        for operation in ["deleted", "restored", "updated"] {
            let mut bad = base.clone();
            bad[KEY]["records"][key]["history"][0]["operation"] = json!(operation);
            variants.push(bad);
        }
        let mut snapshot = base.clone();
        snapshot[KEY]["records"][key]["history"][0]["snapshot"] =
            json!({"password":"private-body"});
        variants.push(snapshot);
        for bad in variants {
            let before = bad.clone();
            let error = reconcile(&bad, &mut bad.clone(), SECOND).unwrap_err();
            assert!(!error.contains("private-body"));
            assert_eq!(bad, before);
        }
    }

    #[test]
    fn metadata_limits_fail_closed_without_pruning_history_or_inventing_indices() {
        let base = migrate(&json!({"theme":"dark"}));
        let mut excessive = base.clone();
        excessive[KEY]["records"] = Value::Object(
            (0..=MAX_RECORDS)
                .map(|i| (format!("/key:r{i}"), Value::Null))
                .collect(),
        );
        assert!(validate(&excessive).is_err());
        // Exercise the exact shared counter used before allocation and after
        // reconciliation without constructing gigabytes of test-only Values.
        let mut total = 0;
        assert!(count_history(MAX_RECORD_HISTORY + 1, &mut total).is_err());
        count_history(MAX_TOTAL_HISTORY - 1, &mut total).unwrap();
        count_history(1, &mut total).unwrap();
        assert!(count_history(1, &mut total).is_err());
        let mut overflowing = usize::MAX;
        assert!(count_history(1, &mut overflowing).is_err());
        let mut nested = json!(true);
        for _ in 0..MAX_SETTINGS_DEPTH {
            nested = json!({"child":nested});
        }
        assert!(validate(&nested).is_err());
        assert!(reject_patch(&nested).is_err());
        assert!(!valid_path(&format!("/key:{}", "x".repeat(MAX_PATH_BYTES))));
        assert!(!valid_path("/key:recordTimestamps"));
        assert!(bounded_tree(&json!({"key":"secret"}), 6, 8).is_err());
        assert!(bounded_tree(&json!({"key":"secret"}), 6, 9).is_ok());
        let mut next = base.clone();
        next["profiles"] = json!([{"id":"x".repeat(MAX_PATH_BYTES + 1)}]);
        assert!(reconcile(&base, &mut next, SECOND).is_err());
        assert_eq!(next[KEY], base[KEY]);
    }

    #[test]
    fn cloud_telemetry_does_not_consume_history_but_configuration_and_other_fields_do() {
        let initial = migrate(
            &json!({"cloudSync":{"frequency":"custom","customIntervalMinutes":1,
            "syncTargets":[{"id":"target","label":"Original","enabled":true}],
            "providerStatus":{}, "targetStatus":{}, "lastSyncTime":0,
            "lastSyncStatus":"success","lastSyncError":""}, "other":{"lastSyncTime":0}}),
        );
        for older_telemetry_metadata in [false, true] {
            let mut current = initial.clone();
            if older_telemetry_metadata {
                current[KEY]["records"]["/key:cloudSync/key:targetStatus"] =
                    current[KEY]["records"]["/key:cloudSync"].clone();
            }
            let metadata = current[KEY].clone();
            for tick in 0..1000 {
                let mut next = current.clone();
                next["cloudSync"]["providerStatus"] =
                    json!({"sftp":{"status":"success","lastSyncTime":tick}});
                next["cloudSync"]["targetStatus"] =
                    json!({"target":{"status":"failed","error":format!("runtime-{tick}")}});
                next["cloudSync"]["lastSyncTime"] = json!(tick);
                next["cloudSync"]["lastSyncStatus"] =
                    json!(if tick % 2 == 0 { "failed" } else { "success" });
                next["cloudSync"]["lastSyncError"] = json!(format!("runtime-{tick}"));
                reconcile(&current, &mut next, SECOND).unwrap();
                assert_eq!(next[KEY], metadata);
                current = next;
            }
            let mut next = current.clone();
            next["cloudSync"]["frequency"] = json!("hourly");
            next["cloudSync"]["syncTargets"][0]["label"] = json!("Changed");
            next["other"]["lastSyncTime"] = json!(1);
            reconcile(&current, &mut next, SECOND).unwrap();
            validate(&next).unwrap();
            for key in [
                "/key:cloudSync",
                "/key:cloudSync/key:frequency",
                "/key:cloudSync/key:syncTargets/id:s:target",
                "/key:other/key:lastSyncTime",
            ] {
                assert_eq!(next[KEY]["records"][key]["updatedAt"], SECOND);
                assert_eq!(
                    next[KEY]["records"][key]["history"]
                        .as_array()
                        .unwrap()
                        .len(),
                    2
                );
            }
            assert_eq!(
                next[KEY]["records"]["/key:cloudSync/key:customIntervalMinutes"],
                metadata["records"]["/key:cloudSync/key:customIntervalMinutes"]
            );
        }
        assert!(!initial[KEY]["records"]
            .as_object()
            .unwrap()
            .keys()
            .any(|key| cloud_telemetry_path(key)));
    }

    #[test]
    fn inferred_external_deletion_restore_and_known_creation_never_move_history_backwards() {
        let mut created = json!({"profile":{"id":"p","value":1}});
        reconcile(&json!({}), &mut created, FIRST).unwrap();
        let mut removed = created.clone();
        removed.as_object_mut().unwrap().remove("profile");
        let removed = migrate(&removed);
        let key = "/key:profile/id:s:p";
        assert_eq!(removed[KEY]["records"][key]["deletedAt"], FIRST);
        assert_eq!(removed[KEY]["records"][key]["updatedAtOrigin"], "inferred");
        validate(&removed).unwrap();
        let mut restored = removed.clone();
        restored["profile"] = created["profile"].clone();
        let restored = migrate(&restored);
        validate(&restored).unwrap();
        assert_eq!(restored[KEY]["records"][key]["updatedAt"], FIRST);
        assert_eq!(
            restored[KEY]["records"][key]["history"][2]["operation"],
            "restored"
        );
        assert!(!migration_needed(&restored).unwrap());
        let mut edited = restored.clone();
        edited["profile"]["value"] = json!(2);
        reconcile(&restored, &mut edited, EPOCH).unwrap();
        validate(&edited).unwrap();
        assert_eq!(edited[KEY]["records"][key]["updatedAt"], FIRST);
        assert_eq!(edited[KEY]["records"][key]["createdAt"], FIRST);
        assert_eq!(
            edited[KEY]["records"][key]["history"][3]["operation"],
            "updated"
        );
        let mut deleted = edited.clone();
        deleted.as_object_mut().unwrap().remove("profile");
        reconcile(&edited, &mut deleted, EPOCH).unwrap();
        validate(&deleted).unwrap();
        assert_eq!(deleted[KEY]["records"][key]["updatedAt"], FIRST);
        assert_eq!(deleted[KEY]["records"][key]["deletedAt"], FIRST);
        assert_eq!(
            deleted[KEY]["records"][key]["history"][4]["operation"],
            "deleted"
        );
        let mut restored_again = deleted.clone();
        restored_again["profile"] = created["profile"].clone();
        reconcile(&deleted, &mut restored_again, EPOCH).unwrap();
        validate(&restored_again).unwrap();
        assert_eq!(
            restored_again[KEY]["records"][key]["history"][5]["operation"],
            "restored"
        );
        assert_eq!(restored_again[KEY]["records"][key]["createdAt"], FIRST);
        let invalid_dates = json!({"profile":{"createdAt":SECOND,"updatedAt":FIRST}});
        assert!(reconcile(&invalid_dates, &mut invalid_dates.clone(), SECOND).is_err());
        let ancient = migrate(&json!({"profile":{"updatedAt":"1960-01-01T00:00:00Z"}}));
        validate(&ancient).unwrap();
    }

    #[test]
    fn clock_matches_chrono_and_validates_rfc3339_calendar_and_offsets() {
        for millis in [
            0,
            1,
            86_400_000,
            951_782_400_123,
            1_790_848_800_999,
            4_102_444_800_000,
        ] {
            let expected = chrono::DateTime::from_timestamp_millis(millis as i64)
                .unwrap()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            assert_eq!(format_unix_millis(millis), expected);
            assert!(valid_timestamp(&expected));
            let parsed = timestamp(&expected).unwrap();
            assert_eq!(
                parsed,
                (millis as i64 / 1000, (millis % 1000) as u32 * 1_000_000)
            );
        }
        for date in [
            "2026-10-01T10:00:00.000000001+05:30",
            "1960-01-01T00:00:00-03:00",
            "0000-01-01T00:00:00Z",
            "9999-12-31T23:59:59.999999999Z",
            "2016-12-31T23:59:60Z",
        ] {
            let parsed = chrono::DateTime::parse_from_rfc3339(date).unwrap();
            assert_eq!(
                timestamp(date).unwrap(),
                (parsed.timestamp(), parsed.timestamp_subsec_nanos())
            );
        }
        assert!(timestamp("2026-10-01T11:00:00+03:00") < timestamp(FIRST));
        assert!(timestamp("2026-10-01T10:00:00.000000001Z") > timestamp(FIRST));
        assert!(valid_timestamp("2024-02-29T01:02:03.123456+05:30"));
        for invalid in [
            "secret",
            "2023-02-29T00:00:00Z",
            "2024-13-01T00:00:00Z",
            "2024-01-01T24:00:00Z",
            "2024-01-01T00:00:00+24:00",
            "2024-01-01T00:00:00.Z",
            "+024-01-01T00:00:00Z",
            "🦀🦀🦀🦀🦀🦀",
        ] {
            assert!(!valid_timestamp(invalid), "{invalid}");
        }
    }
}
