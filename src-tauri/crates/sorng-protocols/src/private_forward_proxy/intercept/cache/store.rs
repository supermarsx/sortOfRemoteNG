//! Encrypted on-disk store for one connection (`<connKey>/proxy-v1/`).
//!
//! Layout:
//! - `keys.v1`: binding digest + the wrapped per-connection DEK (`crypto`);
//! - `e/<64 hex>`: one sealed entry per cache key; the name is a keyed hash.
//!
//! A binding mismatch, an unreadable `keys.v1` or a master key that cannot
//! unwrap it wipes the directory and starts over. An entry that fails
//! authentication is a miss and is deleted; an authenticated entry that does
//! not decode is corruption and wipes every entry. LRU by last access within
//! `max_bytes` (file sizes); the order survives reopen through file mtimes.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hyper::body::Bytes;
use hyper::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use rand::RngCore;
use tokio::sync::Notify;
use zeroize::Zeroizing;

use super::crypto::{CacheKeys, KeysFile};
use super::policy::{Entry, StoredHead};
use super::DiskCacheConfig;

const KEYS_FILE: &str = "keys.v1";
const ENTRIES_DIR: &str = "e";
const CODEC_VERSION: u8 = 1;

pub(crate) enum ReadOutcome {
    Miss,
    Hit(Box<Entry>),
}

struct Slot {
    size: u64,
    used: u64,
}

#[derive(Default)]
struct Index {
    map: HashMap<String, Slot>,
    total: u64,
    tick: u64,
}

/// Background writes in flight (tests wait for them to settle).
#[derive(Default)]
pub(crate) struct Pending {
    count: AtomicUsize,
    idle: Notify,
}

impl Pending {
    #[cfg(test)]
    pub(crate) async fn settle(&self) {
        loop {
            let idle = self.idle.notified();
            if self.count.load(Ordering::SeqCst) == 0 {
                return;
            }
            idle.await;
        }
    }
}

/// One registered background write; dropping it marks the write finished.
pub(crate) struct WriteTicket(Arc<DiskStore>);

impl Drop for WriteTicket {
    fn drop(&mut self) {
        let pending = &self.0.pending;
        if pending.count.fetch_sub(1, Ordering::SeqCst) == 1 {
            pending.idle.notify_waiters();
        }
    }
}

pub(crate) struct DiskStore {
    entries: PathBuf,
    binding: [u8; 32],
    master: Zeroizing<[u8; 32]>,
    max_bytes: u64,
    keys: CacheKeys,
    index: Mutex<Index>,
    pub(crate) pending: Pending,
}

impl DiskStore {
    /// Opens (or creates, or wipes and recreates) the store at `dir`.
    pub(crate) fn open(config: &DiskCacheConfig, dir: PathBuf) -> io::Result<Self> {
        let master = Zeroizing::new(*config.key);
        let entries = dir.join(ENTRIES_DIR);
        let keys_path = dir.join(KEYS_FILE);
        let existing = match fs::read(&keys_path) {
            Ok(bytes) => Some(CacheKeys::unwrap(&master, &config.binding, &bytes)),
            Err(err) if err.kind() == io::ErrorKind::NotFound => None,
            Err(err) => return Err(err),
        };
        let keys = match existing {
            Some(KeysFile::Valid(keys)) => keys,
            // Missing, other binding, wrong master key or corrupt: start over.
            _ => {
                wipe_dir(&dir)?;
                let (keys, file) = CacheKeys::generate(&master, &config.binding);
                write_atomic(&dir, KEYS_FILE, &file)?;
                keys
            }
        };
        fs::create_dir_all(&entries)?;
        let store = Self {
            entries,
            binding: config.binding,
            master,
            max_bytes: config.max_bytes,
            keys,
            index: Mutex::new(Index::default()),
            pending: Pending::default(),
        };
        store.rebuild_index()?;
        Ok(store)
    }

    pub(crate) fn begin_write(this: &Arc<Self>) -> WriteTicket {
        this.pending.count.fetch_add(1, Ordering::SeqCst);
        WriteTicket(Arc::clone(this))
    }

    /// Whether another attempt's config may share this store.
    pub(crate) fn accepts(&self, config: &DiskCacheConfig) -> bool {
        self.binding == config.binding && self.master.as_slice() == config.key.as_slice()
    }

    pub(crate) fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    fn lock(&self) -> MutexGuard<'_, Index> {
        self.index.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn rebuild_index(&self) -> io::Result<()> {
        let mut found = Vec::new();
        for item in fs::read_dir(&self.entries)? {
            let item = item?;
            let name = item.file_name().to_string_lossy().into_owned();
            let meta = item.metadata()?;
            if !meta.is_file() || !is_entry_name(&name) {
                // Leftover temp files or foreign content.
                let _ = if meta.is_dir() {
                    fs::remove_dir_all(item.path())
                } else {
                    fs::remove_file(item.path())
                };
                continue;
            }
            let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
            found.push((mtime, name, meta.len()));
        }
        found.sort();
        let mut index = self.lock();
        *index = Index::default();
        for (_, name, size) in found {
            index.tick += 1;
            let used = index.tick;
            index.total += size;
            index.map.insert(name, Slot { size, used });
        }
        let over = index.total > self.max_bytes;
        drop(index);
        if over {
            self.evict_for(0);
        }
        Ok(())
    }

    /// Evicts least recently used entries until `incoming` more bytes fit.
    fn evict_locked(&self, index: &mut Index, incoming: u64) {
        while index.total + incoming > self.max_bytes {
            let Some(victim) = index
                .map
                .iter()
                .min_by_key(|(_, slot)| slot.used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some(slot) = index.map.remove(&victim) {
                index.total -= slot.size;
            }
            let _ = fs::remove_file(self.entries.join(&victim));
        }
    }

    fn evict_for(&self, incoming: u64) {
        let mut index = self.lock();
        self.evict_locked(&mut index, incoming);
    }

    fn forget(&self, name: &str) {
        let mut index = self.lock();
        if let Some(slot) = index.map.remove(name) {
            index.total -= slot.size;
        }
        let _ = fs::remove_file(self.entries.join(name));
    }

    /// Blocking read + decrypt.
    pub(crate) fn read(&self, key: &str) -> ReadOutcome {
        let name = self.keys.entry_name(key);
        if !self.lock().map.contains_key(&name) {
            return ReadOutcome::Miss;
        }
        let path = self.entries.join(&name);
        let Ok(file) = fs::read(&path) else {
            self.forget(&name);
            return ReadOutcome::Miss;
        };
        let Some(plain) = self.keys.open(&name, &file) else {
            // Tampered, truncated or sealed under another key.
            self.forget(&name);
            return ReadOutcome::Miss;
        };
        let Some(entry) = decode(key, &plain) else {
            // Authenticated but undecodable: the store itself is corrupt.
            self.wipe_entries();
            return ReadOutcome::Miss;
        };
        {
            let mut index = self.lock();
            index.tick += 1;
            let tick = index.tick;
            if let Some(slot) = index.map.get_mut(&name) {
                slot.used = tick;
            }
        }
        touch(&path);
        ReadOutcome::Hit(Box::new(entry))
    }

    /// Blocking encrypt + write; `Ok(false)` when the entry cannot fit.
    pub(crate) fn write(&self, key: &str, entry: &Entry) -> io::Result<bool> {
        let name = self.keys.entry_name(key);
        let plain = Zeroizing::new(encode(key, entry));
        let Some(sealed) = self.keys.seal(&name, &plain) else {
            return Ok(false);
        };
        let size = sealed.len() as u64;
        if size > self.max_bytes {
            return Ok(false);
        }
        let mut index = self.lock();
        let previous = index.map.remove(&name);
        if let Some(old) = &previous {
            index.total -= old.size;
        }
        self.evict_locked(&mut index, size);
        if let Err(err) = write_atomic(&self.entries, &name, &sealed) {
            // The previous version (if still there) stays valid.
            if let Some(old) = previous {
                if self.entries.join(&name).is_file() {
                    index.total += old.size;
                    index.map.insert(name, old);
                }
            }
            return Err(err);
        }
        index.tick += 1;
        let used = index.tick;
        index.total += size;
        index.map.insert(name, Slot { size, used });
        Ok(true)
    }

    /// Blocking delete of one key (unsafe-method invalidation, not storable).
    pub(crate) fn remove(&self, key: &str) {
        let name = self.keys.entry_name(key);
        if self.lock().map.contains_key(&name) {
            self.forget(&name);
        }
    }

    pub(crate) fn contains(&self, key: &str) -> bool {
        self.lock().map.contains_key(&self.keys.entry_name(key))
    }

    fn wipe_entries(&self) {
        let mut index = self.lock();
        *index = Index::default();
        let _ = fs::remove_dir_all(&self.entries);
        let _ = fs::create_dir_all(&self.entries);
    }

    #[cfg(test)]
    pub(crate) fn total(&self) -> u64 {
        self.lock().total
    }

    #[cfg(test)]
    pub(crate) fn entry_path(&self, key: &str) -> PathBuf {
        self.entries.join(self.keys.entry_name(key))
    }
}

fn is_entry_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit())
}

fn touch(path: &Path) {
    if let Ok(file) = fs::OpenOptions::new().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

/// Removes everything under `dir` (the store's own directory only).
fn wipe_dir(dir: &Path) -> io::Result<()> {
    match fs::remove_dir_all(dir) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    fs::create_dir_all(dir)
}

fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    let mut suffix = [0u8; 8];
    rand::rngs::OsRng.fill_bytes(&mut suffix);
    let tmp = dir.join(format!("{name}.{}.tmp", hex::encode(suffix)));
    if let Err(err) = fs::write(&tmp, bytes).and_then(|()| fs::rename(&tmp, dir.join(name))) {
        let _ = fs::remove_file(&tmp);
        return Err(err);
    }
    Ok(())
}

// ---- entry codec (plaintext, sealed by `crypto`) ----

fn put(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

fn put_headers(out: &mut Vec<u8>, headers: &HeaderMap) {
    out.extend_from_slice(&(headers.len() as u32).to_le_bytes());
    for (name, value) in headers {
        put(out, name.as_str().as_bytes());
        put(out, value.as_bytes());
    }
}

pub(crate) fn encode(key: &str, entry: &Entry) -> Vec<u8> {
    let head = &entry.head;
    let mut out = Vec::with_capacity(entry.body.len() + 512);
    out.push(CODEC_VERSION);
    put(&mut out, key.as_bytes());
    put(&mut out, head.method.as_str().as_bytes());
    put(&mut out, head.uri.to_string().as_bytes());
    out.extend_from_slice(&head.status.as_u16().to_le_bytes());
    let since = head
        .response_time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    out.extend_from_slice(&since.as_secs().to_le_bytes());
    out.extend_from_slice(&since.subsec_nanos().to_le_bytes());
    put_headers(&mut out, &head.req_headers);
    put_headers(&mut out, &head.res_headers);
    out.extend_from_slice(&(entry.body.len() as u64).to_le_bytes());
    out.extend_from_slice(&entry.body);
    out
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.0.len() < n {
            return None;
        }
        let (head, rest) = self.0.split_at(n);
        self.0 = rest;
        Some(head)
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn bytes(&mut self) -> Option<&'a [u8]> {
        let len = self.u32()? as usize;
        self.take(len)
    }
    fn headers(&mut self) -> Option<HeaderMap> {
        let count = self.u32()? as usize;
        let mut map = HeaderMap::new();
        for _ in 0..count {
            let name = HeaderName::from_bytes(self.bytes()?).ok()?;
            let value = HeaderValue::from_bytes(self.bytes()?).ok()?;
            map.append(name, value);
        }
        Some(map)
    }
}

pub(crate) fn decode(key: &str, plain: &[u8]) -> Option<Entry> {
    let mut r = Reader(plain);
    if r.take(1)? != [CODEC_VERSION] || r.bytes()? != key.as_bytes() {
        return None;
    }
    let method = Method::from_bytes(r.bytes()?).ok()?;
    let uri: Uri = std::str::from_utf8(r.bytes()?).ok()?.parse().ok()?;
    let status = StatusCode::from_u16(r.u16()?).ok()?;
    let secs = r.u64()?;
    let nanos = r.u32()?;
    let response_time = UNIX_EPOCH.checked_add(Duration::new(secs, nanos))?;
    let req_headers = r.headers()?;
    let res_headers = r.headers()?;
    let len = usize::try_from(r.u64()?).ok()?;
    let body = r.take(len)?;
    if !r.0.is_empty() {
        return None;
    }
    Some(Entry {
        head: StoredHead {
            method,
            uri,
            status,
            req_headers,
            res_headers,
            response_time,
        },
        body: Bytes::copy_from_slice(body),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_roundtrip_and_key_check() {
        let mut res = HeaderMap::new();
        res.append("x-multi", HeaderValue::from_static("1"));
        res.append("x-multi", HeaderValue::from_static("2"));
        let entry = Entry {
            head: StoredHead {
                method: Method::GET,
                uri: "/a?b".parse().unwrap(),
                status: StatusCode::OK,
                req_headers: HeaderMap::new(),
                res_headers: res,
                response_time: UNIX_EPOCH + Duration::new(1_700_000_000, 5),
            },
            body: Bytes::from_static(b"hello"),
        };
        let bytes = encode("k", &entry);
        let back = decode("k", &bytes).expect("decode");
        assert_eq!(back.body, entry.body);
        assert_eq!(back.head.uri, entry.head.uri);
        assert_eq!(back.head.res_headers.get_all("x-multi").iter().count(), 2);
        assert_eq!(back.head.response_time, entry.head.response_time);
        assert!(decode("other", &bytes).is_none());
        assert!(decode("k", &bytes[..bytes.len() - 1]).is_none());
    }
}
