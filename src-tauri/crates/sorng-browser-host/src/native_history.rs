//! Bounded, view-local native history receipts. Display URLs are never commands.
use serde::Serialize;

pub const MAX_ENTRIES: usize = 128;
pub const MAX_BYTES: usize = 256 * 1024;

/// CEF represents a valid empty string as `None` from `CefString::as_slice()`.
/// Titles are optional display metadata, not navigation authority. Bound native
/// UTF-16 before allocating and UTF-8 before publishing to the shell.
pub(super) fn decode_title(units: Option<&[u16]>) -> Option<String> {
    let units = units.unwrap_or_default();
    if units.len() > 512 {
        return None;
    }
    let title = String::from_utf16(units).ok()?;
    (title.len() <= 512).then_some(title)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub index: i32,
    pub url: String,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySnapshot {
    pub snapshot_id: String,
    pub current_index: i32,
    pub entries: Vec<HistoryEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Entry {
    pub id: i32,
    pub url: String,
    pub title: String,
}

#[derive(Default)]
pub(super) struct History {
    receipt: Option<(String, i32, Vec<Entry>)>,
}

impl History {
    pub fn publish(
        &mut self,
        token: String,
        current: i32,
        entries: Vec<Entry>,
    ) -> Option<HistorySnapshot> {
        self.receipt = None;
        if token.is_empty()
            || token.len() > 32
            || entries.len() > MAX_ENTRIES
            || (entries.is_empty() && current != -1)
            || (!entries.is_empty() && (current < 0 || current as usize >= entries.len()))
            || entries
                .iter()
                .any(|e| e.id <= 0 || e.url.len() > 16_384 || e.title.len() > 512)
            || entries
                .iter()
                .map(|e| e.url.len() + e.title.len())
                .sum::<usize>()
                > MAX_BYTES
        {
            return None;
        }
        let mut ids = std::collections::HashSet::new();
        if !entries.iter().all(|e| ids.insert(e.id)) {
            return None;
        }
        let snapshot = HistorySnapshot {
            snapshot_id: token.clone(),
            current_index: current,
            entries: entries
                .iter()
                .enumerate()
                .map(|(index, e)| HistoryEntry {
                    index: index as i32,
                    url: e.url.clone(),
                    title: e.title.clone(),
                })
                .collect(),
        };
        self.receipt = Some((token, current, entries));
        Some(snapshot)
    }

    pub fn invalidate(&mut self) {
        self.receipt = None;
    }

    /// Consume once, only after comparing the freshly collected native history.
    /// IDs distinguish repeated URLs and POST/same-document entries.
    pub fn consume(
        &mut self,
        token: &str,
        index: i32,
        current: i32,
        entries: &[Entry],
    ) -> Option<i32> {
        let (expected, old_current, old_entries) = self.receipt.take()?;
        if token != expected
            || current != old_current
            || old_entries != entries
            || index < 0
            || index == current
        {
            return None;
        }
        old_entries.get(index as usize).map(|entry| entry.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_cef_titles_are_valid_display_metadata() {
        assert_eq!(decode_title(None), Some(String::new()));
        assert_eq!(decode_title(Some(&[])), Some(String::new()));
        let page: Vec<_> = "Example Domain".encode_utf16().collect();
        assert_eq!(decode_title(Some(&page)).as_deref(), Some("Example Domain"));
    }

    #[test]
    fn title_decoding_preserves_native_and_shell_bounds() {
        assert_eq!(decode_title(Some(&[b'x' as u16; 512])).unwrap().len(), 512);
        assert!(decode_title(Some(&[b'x' as u16; 513])).is_none());
        assert_eq!(decode_title(Some(&[0x00e9; 256])).unwrap().len(), 512);
        assert!(decode_title(Some(&[0x00e9; 257])).is_none());
        assert!(decode_title(Some(&[0xd800])).is_none());
    }

    #[test]
    fn untitled_entries_keep_exact_single_use_navigation_receipts() {
        let mut history = History::default();
        let mut entries = rows();
        entries[0].title = decode_title(None).unwrap();
        let snapshot = history.publish("1".into(), 2, entries.clone()).unwrap();
        assert!(snapshot.entries[0].title.is_empty());
        assert_eq!(snapshot.entries[0].url, entries[0].url);
        assert_eq!(history.consume("1", 0, 2, &entries), Some(entries[0].id));
        assert_eq!(history.consume("1", 0, 2, &entries), None);
    }

    fn rows() -> Vec<Entry> {
        (1..=3)
            .map(|id| Entry {
                id,
                url: "https://fixture.invalid/repeated".into(),
                title: "Page".into(),
            })
            .collect()
    }
    #[test]
    fn exact_index_preserves_duplicate_urls_and_is_single_use() {
        let mut history = History::default();
        let rows = rows();
        assert_eq!(
            history
                .publish("one".into(), 2, rows.clone())
                .unwrap()
                .entries
                .len(),
            3
        );
        assert_eq!(history.consume("one", 0, 2, &rows), Some(1));
        assert_eq!(history.consume("one", 0, 2, &rows), None);
    }
    #[test]
    fn navigation_close_or_revoke_invalidates_receipt() {
        let mut history = History::default();
        let rows = rows();
        history.publish("one".into(), 2, rows.clone()).unwrap();
        history.invalidate();
        assert_eq!(history.consume("one", 0, 2, &rows), None);
    }
    #[test]
    fn replaced_entries_same_urls_and_titles_are_stale() {
        let mut history = History::default();
        let mut rows = rows();
        history.publish("one".into(), 2, rows.clone()).unwrap();
        rows[0].id = 99;
        assert_eq!(history.consume("one", 0, 2, &rows), None);
    }
    #[test]
    fn changed_current_entry_and_invalid_indices_fail_closed() {
        for (index, current) in [(-1, 2), (3, 2), (2, 2), (0, 1)] {
            let mut history = History::default();
            let rows = rows();
            history.publish("one".into(), 2, rows.clone()).unwrap();
            assert_eq!(history.consume("one", index, current, &rows), None);
        }
    }
    #[test]
    fn another_view_or_replacement_snapshot_cannot_supply_receipt() {
        let mut root = History::default();
        let mut popup = History::default();
        let rows = rows();
        root.publish("root".into(), 2, rows.clone()).unwrap();
        popup.publish("popup".into(), 2, rows.clone()).unwrap();
        assert_eq!(popup.consume("root", 0, 2, &rows), None);
        root.publish("new".into(), 2, rows.clone()).unwrap();
        assert_eq!(root.consume("root", 0, 2, &rows), None);
    }
    #[test]
    fn malformed_oversized_and_duplicate_native_entries_rejected() {
        let mut history = History::default();
        let mut entries = rows();
        entries[1].id = entries[0].id;
        assert!(history.publish("x".into(), 0, entries).is_none());
        assert!(history
            .publish("x".into(), 0, vec![rows()[0].clone(); MAX_ENTRIES + 1])
            .is_none());
        let mut entries = rows();
        entries[0].title = "x".repeat(513);
        assert!(history.publish("x".into(), 0, entries).is_none());
        assert!(history.publish("x".into(), -1, rows()).is_none());
        assert!(history.publish("x".into(), -1, vec![]).is_some());
    }
}
