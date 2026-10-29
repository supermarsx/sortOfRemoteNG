//! In-memory LRU store (one per attempt) for when the disk cache is not
//! eligible, disabled, or held by another binding.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use super::policy::Entry;

struct Slot {
    entry: Entry,
    weight: u64,
    used: u64,
}

#[derive(Default)]
struct Inner {
    map: HashMap<String, Slot>,
    total: u64,
    tick: u64,
}

pub(crate) struct MemoryStore {
    max_bytes: u64,
    inner: Mutex<Inner>,
}

impl MemoryStore {
    pub(crate) fn new(max_bytes: u64) -> Self {
        Self {
            max_bytes,
            inner: Mutex::new(Inner::default()),
        }
    }

    pub(crate) fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn get(&self, key: &str) -> Option<Entry> {
        let mut inner = self.lock();
        inner.tick += 1;
        let tick = inner.tick;
        let slot = inner.map.get_mut(key)?;
        slot.used = tick;
        Some(slot.entry.clone())
    }

    /// Inserts (replacing), evicting least recently used entries to fit.
    pub(crate) fn insert(&self, key: String, entry: Entry) -> bool {
        let weight = entry.weight();
        if weight > self.max_bytes {
            return false;
        }
        let mut inner = self.lock();
        if let Some(old) = inner.map.remove(&key) {
            inner.total -= old.weight;
        }
        while inner.total + weight > self.max_bytes {
            let Some(victim) = inner
                .map
                .iter()
                .min_by_key(|(_, slot)| slot.used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some(old) = inner.map.remove(&victim) {
                inner.total -= old.weight;
            }
        }
        inner.tick += 1;
        let used = inner.tick;
        inner.total += weight;
        inner.map.insert(
            key,
            Slot {
                entry,
                weight,
                used,
            },
        );
        true
    }

    pub(crate) fn remove(&self, key: &str) {
        let mut inner = self.lock();
        if let Some(old) = inner.map.remove(key) {
            inner.total -= old.weight;
        }
    }

    #[cfg(test)]
    pub(crate) fn total(&self) -> u64 {
        self.lock().total
    }
}
