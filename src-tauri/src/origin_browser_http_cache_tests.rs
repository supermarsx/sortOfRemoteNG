use super::*;
use sorng_browser_host::cef_http_cache::HttpDiskCacheSpec;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const DAY: u64 = 24 * 60 * 60;
const NOW: u64 = 1_800_000_000;

fn store() -> (tempfile::TempDir, CacheStore) {
    let data = tempfile::tempdir().unwrap();
    let store = CacheStore::open(data.path()).unwrap();
    (data, store)
}

fn digest(seed: u8) -> [u8; 32] {
    [seed; 32]
}

fn take(
    store: &mut CacheStore,
    database: &str,
    connection: &str,
    seed: u8,
) -> Result<((String, String), u64, PathBuf), Refusal> {
    let mut trash = Vec::new();
    let result = store.acquire(database, connection, &digest(seed), u64::MAX, NOW, &mut trash);
    empty_trash(trash);
    result
}

fn housekeeping(store: &mut CacheStore, now: u64) {
    let mut trash = Vec::new();
    store.housekeeping(now, &mut trash).unwrap();
    empty_trash(trash);
}

fn fill(directory: &Path, bytes: usize) {
    let cache = directory.join(NET).join("Cache").join("Cache_Data");
    fs::create_dir_all(&cache).unwrap();
    fs::write(cache.join("data_1"), vec![7u8; bytes]).unwrap();
}

fn stamp(directory: &Path, last_used_at: u64) {
    let mut binding = read_binding(directory).unwrap();
    binding.last_used_at = last_used_at;
    write_binding(directory, &binding).unwrap();
}

fn signal() -> (Arc<AtomicBool>, Released) {
    let flag = Arc::new(AtomicBool::new(false));
    let observed = flag.clone();
    (flag, Box::new(move || observed.load(Ordering::Acquire)))
}

#[test]
fn keys_separate_databases_and_connections_and_never_carry_path_text() {
    let a = connection_key("db-1", "conn").unwrap();
    assert_eq!(a, connection_key("db-1", "conn").unwrap());
    assert_eq!(a.len(), 32);
    assert!(is_key(&a));
    assert_ne!(a, connection_key("db-2", "conn").unwrap());
    assert_ne!(a, connection_key("db-1", "conn2").unwrap());
    assert_ne!(database_key("db-1").unwrap(), database_key("db-2").unwrap());
    // The separator makes ("ab","c") and ("a","bc") distinct.
    assert_ne!(connection_key("ab", "c"), connection_key("a", "bc"));
    // A database key is not a connection key of any split of the same text.
    assert_ne!(database_key("a"), connection_key("a", "a"));
    for hostile in ["../..", "..", "a/b", r"a\b", "C:", "con", "x.delete-pending", "/"] {
        let key = connection_key("db", hostile).unwrap();
        assert!(is_key(&key), "{hostile}");
        assert!(is_key(&database_key(hostile).unwrap()));
    }
    for invalid in ["", "a\0b"] {
        assert_eq!(connection_key("db", invalid), None);
        assert_eq!(connection_key(invalid, "conn"), None);
        assert_eq!(database_key(invalid), None);
    }
    // NUL is the field separator: no id may contain it.
    assert_eq!(connection_key("a\0b", "c"), None);
    assert_eq!(connection_key("a", "b\0c"), None);
    assert_eq!(connection_key("db", &"x".repeat(MAX_ID_BYTES + 1)), None);
    // Pinned value: changing the derivation would orphan every cache.
    let mut expected = Sha256::new();
    expected.update(b"sorng-http-cache-v1\0db\0conn");
    assert_eq!(
        connection_key("db", "conn").unwrap(),
        format!("{:x}", expected.finalize())[..32]
    );
}

#[test]
fn open_creates_a_tagged_private_cache_root_and_leaves_siblings_alone() {
    let (data, store) = store();
    assert_eq!(store.root(), data.path().join(HTTP_CACHE_DIRECTORY_NAME));
    let tag = fs::read(store.root().join(TAG_NAME)).unwrap();
    assert!(tag.starts_with(b"Signature: 8a477f597d28d172789f06886806bc55"));
    assert!(private_dir(store.root()));
    // A damaged tag is rewritten on the next open.
    fs::write(store.root().join(TAG_NAME), b"x").unwrap();
    drop(store);
    let store = CacheStore::open(data.path()).unwrap();
    assert_eq!(fs::read(store.root().join(TAG_NAME)).unwrap(), TAG);
    assert!(CacheStore::open(&data.path().join("missing")).is_err());
}

#[test]
fn one_lease_per_connection_until_the_engine_releases_it() {
    let (_data, mut store) = store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    assert!(directory.ends_with(Path::new(&key.0).join(&key.1)));
    assert!(plain_dir(&directory).unwrap());
    assert!(store.leased("db", "conn"));
    // A concurrent attempt of the same connection gets memory.
    assert_eq!(take(&mut store, "db", "conn", 1).err(), Some(Refusal::InUse));
    // Other connections and databases are independent.
    assert!(take(&mut store, "db", "other", 1).is_ok());
    assert!(take(&mut store, "db-2", "conn", 1).is_ok());
    let (flag, released) = signal();
    store.attach(&key, id, released);
    // Attempt close is not a release: only the engine's state 7 is.
    for _ in 0..3 {
        assert_eq!(store.take_released(NOW + 10), 0);
        assert_eq!(take(&mut store, "db", "conn", 1).err(), Some(Refusal::InUse));
    }
    // A stale release of an older lease id never ends the current one.
    assert!(!store.release(&key, id + 100));
    flag.store(true, Ordering::Release);
    assert_eq!(store.take_released(NOW + 10), 1);
    assert!(!store.leased("db", "conn"));
    assert_eq!(read_binding(&directory).unwrap().last_used_at, NOW + 10);
    assert!(take(&mut store, "db", "conn", 1).is_ok());
}

#[test]
fn a_lease_that_never_reached_the_engine_is_released_at_once() {
    let (_data, mut store) = store();
    let (key, id, _) = take(&mut store, "db", "conn", 1).unwrap();
    assert!(store.release(&key, id));
    assert!(!store.release(&key, id));
    assert!(take(&mut store, "db", "conn", 1).is_ok());
}

#[test]
fn binding_digest_mismatch_wipes_chromium_data_before_leasing() {
    let (_data, mut store) = store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    fill(&directory, 4096);
    let created = read_binding(&directory).unwrap().created_at;
    store.release(&key, id);
    // Same binding: the cache is reused.
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    assert!(directory.join(NET).exists());
    assert_eq!(read_binding(&directory).unwrap().created_at, created);
    store.release(&key, id);
    // Changed security projection, trust policy or route: wiped first.
    let (_, _, directory) = take(&mut store, "db", "conn", 2).unwrap();
    assert!(!directory.join(NET).exists());
    assert_eq!(read_binding(&directory).unwrap().binding_digest, hex::encode(digest(2)));
    // A malformed binding is a mismatch too.
    let (_data, mut store) = self::store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    fill(&directory, 16);
    store.release(&key, id);
    fs::write(directory.join(BINDING), b"{\"v\":1}").unwrap();
    take(&mut store, "db", "conn", 1).unwrap();
    assert!(!directory.join(NET).exists());
}

#[test]
fn binding_digest_covers_every_input() {
    let base = binding_digest(&[1; 32], &[2; 32], &[3; 32], "direct");
    assert_eq!(base, binding_digest(&[1; 32], &[2; 32], &[3; 32], "direct"));
    for changed in [
        binding_digest(&[9; 32], &[2; 32], &[3; 32], "direct"),
        binding_digest(&[1; 32], &[9; 32], &[3; 32], "direct"),
        binding_digest(&[1; 32], &[2; 32], &[9; 32], "direct"),
        binding_digest(&[1; 32], &[2; 32], &[3; 32], "proxy"),
    ] {
        assert_ne!(base, changed);
    }
}

#[test]
fn clearing_a_leased_cache_leaves_a_tombstone_that_release_and_restart_resolve() {
    let (data, mut store) = store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    fill(&directory, 64);
    let (flag, released) = signal();
    store.attach(&key, id, released);
    let mut trash = Vec::new();
    let outcome = store.clear_connection("db", "conn", &mut trash).unwrap();
    empty_trash(trash);
    assert_eq!(outcome, ClearOutcome { cleared: false, pending: true });
    assert!(directory.exists(), "a held directory is never deleted under the engine");
    assert!(plain_file(&store.tombstone(&key)));
    // While pending, no new attempt may reuse it.
    store.take_released(NOW);
    assert_eq!(take(&mut store, "db", "conn", 1).err(), Some(Refusal::InUse));
    // Release, then the housekeeping that follows it, deletes both.
    flag.store(true, Ordering::Release);
    assert_eq!(store.take_released(NOW), 1);
    assert_eq!(take(&mut store, "db", "conn", 1).err(), Some(Refusal::DeletePending));
    housekeeping(&mut store, NOW);
    assert!(!directory.exists());
    assert!(!store.tombstone(&key).exists());
    assert!(take(&mut store, "db", "conn", 1).is_ok());

    // A tombstone left at exit is resolved by the next start's housekeeping.
    let (key, _, directory) = take(&mut store, "db", "next", 1).unwrap();
    fill(&directory, 64);
    let mut trash = Vec::new();
    store.clear_connection("db", "next", &mut trash).unwrap();
    empty_trash(trash);
    drop(store);
    let mut restarted = CacheStore::open(data.path()).unwrap();
    assert_eq!(take(&mut restarted, "db", "next", 1).err(), Some(Refusal::DeletePending));
    housekeeping(&mut restarted, NOW);
    assert!(!directory.exists());
    assert!(!restarted.tombstone(&key).exists());
}

#[test]
fn clearing_an_unleased_cache_deletes_it_now() {
    let (_data, mut store) = store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    fill(&directory, 64);
    store.release(&key, id);
    let mut trash = Vec::new();
    let outcome = store.clear_connection("db", "conn", &mut trash).unwrap();
    empty_trash(trash);
    assert_eq!(outcome, ClearOutcome { cleared: true, pending: false });
    assert!(!directory.exists());
    let mut trash = Vec::new();
    assert_eq!(
        store.clear_connection("db", "conn", &mut trash).unwrap(),
        ClearOutcome::default()
    );
    assert_eq!(
        store.clear_connection("db", "never", &mut trash).unwrap(),
        ClearOutcome::default()
    );
    assert!(trash.is_empty());
}

#[test]
fn database_and_global_clears_spare_leased_entries_and_other_databases() {
    let (data, mut store) = store();
    let (busy, busy_id, busy_dir) = take(&mut store, "db", "busy", 1).unwrap();
    let (idle, idle_id, idle_dir) = take(&mut store, "db", "idle", 1).unwrap();
    let (other, other_id, other_dir) = take(&mut store, "db-2", "conn", 1).unwrap();
    for directory in [&busy_dir, &idle_dir, &other_dir] {
        fill(directory, 64);
    }
    let (_flag, released) = signal();
    store.attach(&busy, busy_id, released);
    store.release(&idle, idle_id);
    store.release(&other, other_id);
    let mut trash = Vec::new();
    let outcome = store.clear_database("db", &mut trash).unwrap();
    empty_trash(trash);
    assert_eq!(outcome, ClearOutcome { cleared: true, pending: true });
    assert!(busy_dir.exists() && store.tombstone(&busy).exists());
    assert!(!idle_dir.exists());
    assert!(other_dir.exists());
    fs::write(data.path().join("sibling.txt"), b"keep").unwrap();
    let mut trash = Vec::new();
    let outcome = store.clear_all(&mut trash).unwrap();
    empty_trash(trash);
    assert_eq!(outcome, ClearOutcome { cleared: true, pending: true });
    assert!(!other_dir.exists());
    assert!(busy_dir.exists());
    assert_eq!(fs::read(data.path().join("sibling.txt")).unwrap(), b"keep");
    assert_eq!(fs::read(store.root().join(TAG_NAME)).unwrap(), TAG);
    // A database with no lease is removed as a whole.
    let mut trash = Vec::new();
    store.release(&busy, busy_id);
    assert_eq!(
        store.clear_database("db", &mut trash).unwrap(),
        ClearOutcome { cleared: true, pending: false }
    );
    empty_trash(trash);
    assert!(!store.root().join(&busy.0).exists());
}

#[test]
fn housekeeping_expires_idle_caches_after_thirty_days() {
    let (_data, mut store) = store();
    let (fresh, fresh_id, fresh_dir) = take(&mut store, "db", "fresh", 1).unwrap();
    let (stale, stale_id, stale_dir) = take(&mut store, "db", "stale", 1).unwrap();
    let (held, held_id, held_dir) = take(&mut store, "db", "held", 1).unwrap();
    store.release(&fresh, fresh_id);
    store.release(&stale, stale_id);
    let (_flag, released) = signal();
    store.attach(&held, held_id, released);
    let now = NOW + 40 * DAY;
    stamp(&fresh_dir, now - 29 * DAY);
    stamp(&stale_dir, now - 31 * DAY);
    stamp(&held_dir, now - 90 * DAY);
    housekeeping(&mut store, now);
    assert!(fresh_dir.exists());
    assert!(!stale_dir.exists());
    assert!(held_dir.exists(), "a leased cache is never expired");
}

#[test]
fn global_limit_evicts_least_recently_used_unleased_caches() {
    let (_data, mut store) = store();
    let mut directories = Vec::new();
    for (index, name) in ["oldest", "middle", "newest", "held"].into_iter().enumerate() {
        let (key, id, directory) = take(&mut store, "db", name, 1).unwrap();
        fill(&directory, 10_000);
        stamp(&directory, NOW - 1000 + index as u64 * 100);
        if name == "held" {
            let (_flag, released) = signal();
            store.attach(&key, id, released);
            stamp(&directory, NOW - 5000);
        } else {
            store.release(&key, id);
        }
        directories.push(directory);
    }
    // Room for two caches: the held one (even though oldest) and the newest.
    store.total_limit = 25_000;
    housekeeping(&mut store, NOW);
    assert!(!directories[0].exists());
    assert!(!directories[1].exists());
    assert!(directories[2].exists());
    assert!(directories[3].exists());
    // Leased caches are never evicted, even alone above the limit.
    store.total_limit = 1;
    housekeeping(&mut store, NOW);
    assert!(!directories[2].exists());
    assert!(directories[3].exists());
}

#[test]
fn housekeeping_removes_unknown_and_malformed_entries_only_inside_the_cache_root() {
    let (data, mut store) = store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    fill(&directory, 64);
    store.release(&key, id);
    let (bad, bad_id, bad_dir) = take(&mut store, "db", "bad", 1).unwrap();
    store.release(&bad, bad_id);
    fs::remove_file(bad_dir.join(BINDING)).unwrap();
    let root = store.root().to_path_buf();
    fs::write(root.join("stray.txt"), b"x").unwrap();
    fs::create_dir(root.join("NOT-A-KEY")).unwrap();
    fs::create_dir(root.join(format!("{TRASH}1-2-3"))).unwrap();
    fs::write(root.join("0123456789abcdef0123456789abcdef"), b"file named like a key").unwrap();
    fs::write(root.join(&key.0).join("stray"), b"x").unwrap();
    fs::write(directory.join("Preferences"), b"{}").unwrap();
    fs::write(root.join(&key.0).join(format!("{}{TOMBSTONE}", "nothex")), b"").unwrap();
    fs::write(data.path().join("outside.txt"), b"keep").unwrap();
    housekeeping(&mut store, NOW);
    let names: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(sorted, vec![key.0.clone(), TAG_NAME.to_owned()]);
    let inner: Vec<_> = fs::read_dir(root.join(&key.0))
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(inner, vec![key.1.clone()]);
    assert!(!bad_dir.exists(), "a cache without a binding is malformed");
    assert!(!directory.join("Preferences").exists());
    assert!(directory.join(NET).exists());
    assert_eq!(fs::read(data.path().join("outside.txt")).unwrap(), b"keep");
}

/// A directory link (symlink, or a junction where symlinks need privilege).
fn link_dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return true;
        }
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
            && fs::symlink_metadata(link).is_ok()
    }
}

#[test]
fn housekeeping_and_clears_never_follow_links_out_of_the_cache() {
    let (_data, mut store) = store();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("precious.txt"), b"keep").unwrap();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    store.release(&key, id);
    let root = store.root().to_path_buf();
    let linked_database = root.join("fedcba9876543210fedcba9876543210");
    let linked_connection = root.join(&key.0).join("0123456789abcdef0123456789abcdef");
    let linked_net = directory.join(NET);
    if !link_dir(outside.path(), &linked_database) {
        eprintln!("directory link fixture unavailable on this machine");
        return;
    }
    assert!(link_dir(outside.path(), &linked_connection));
    assert!(link_dir(outside.path(), &linked_net));
    housekeeping(&mut store, NOW);
    assert!(fs::symlink_metadata(&linked_database).is_err());
    assert!(fs::symlink_metadata(&linked_connection).is_err());
    assert!(fs::symlink_metadata(&linked_net).is_err());
    assert!(directory.join(BINDING).exists());
    assert_eq!(fs::read(outside.path().join("precious.txt")).unwrap(), b"keep");
    // A linked net/ is removed (the link itself) before the engine sees it,
    // with or without a binding change.
    for seed in [1, 9] {
        assert!(link_dir(outside.path(), &linked_net));
        let (key, id, _) = take(&mut store, "db", "conn", seed).unwrap();
        assert!(fs::symlink_metadata(&linked_net).is_err());
        store.release(&key, id);
    }
    assert_eq!(fs::read(outside.path().join("precious.txt")).unwrap(), b"keep");
    // A linked connection directory is refused, never used.
    let (key, id, directory) = take(&mut store, "db", "victim", 1).unwrap();
    store.release(&key, id);
    fs::remove_dir_all(&directory).unwrap();
    assert!(link_dir(outside.path(), &directory));
    assert_eq!(take(&mut store, "db", "victim", 1).err(), Some(Refusal::Storage));
    let mut trash = Vec::new();
    store.clear_all(&mut trash).unwrap();
    empty_trash(trash);
    assert_eq!(fs::read(outside.path().join("precious.txt")).unwrap(), b"keep");
    // A linked cache root is refused outright.
    let data = tempfile::tempdir().unwrap();
    assert!(link_dir(outside.path(), &data.path().join(HTTP_CACHE_DIRECTORY_NAME)));
    assert!(CacheStore::open(data.path()).is_err());
    assert_eq!(fs::read(outside.path().join("precious.txt")).unwrap(), b"keep");
}

#[test]
fn usage_counts_bytes_without_following_links() {
    let (_data, mut store) = store();
    let (_, _, directory) = take(&mut store, "db", "conn", 1).unwrap();
    fill(&directory, 5000);
    let connection = store.usage(Some(("db", "conn")));
    assert!((5000..6000).contains(&connection), "{connection}");
    assert!(store.usage(None) >= connection);
    assert_eq!(store.usage(Some(("db", "absent"))), 0);
    assert_eq!(store.usage(Some(("db", "a\0b"))), 0);
}

#[test]
fn engine_paths_are_ordinary_absolute_paths() {
    #[cfg(windows)]
    {
        assert_eq!(
            ordinary(Path::new(r"\\?\C:\Users\u\AppData\Local\app")),
            Some(PathBuf::from(r"C:\Users\u\AppData\Local\app"))
        );
        assert_eq!(
            ordinary(Path::new(r"C:\Users\u")),
            Some(PathBuf::from(r"C:\Users\u"))
        );
        for refused in [r"\\?\UNC\server\share\x", r"\\server\share\x", r"relative\x", r"\\?\C:/mixed"] {
            assert_eq!(ordinary(Path::new(refused)), None, "{refused}");
        }
    }
    #[cfg(not(windows))]
    {
        assert_eq!(ordinary(Path::new("/home/u")), Some(PathBuf::from("/home/u")));
        assert_eq!(ordinary(Path::new("relative")), None);
    }
    // Every acquired directory is a valid engine spec.
    let (_data, mut store) = store();
    let (_, _, directory) = take(&mut store, "db", "conn", 1).unwrap();
    assert!(HttpDiskCacheSpec::new(directory, 128 * MIB).is_ok());
}

#[cfg(windows)]
#[test]
fn windows_acl_rejects_only_broad_allow_entries() {
    fn ace(kind: u8, sid: &[u8]) -> Vec<u8> {
        let mut ace = vec![kind, 0, 0, 0, 0xff, 0x01, 0x1f, 0x00];
        ace.extend_from_slice(sid);
        let size = ace.len() as u16;
        ace[2..4].copy_from_slice(&size.to_le_bytes());
        ace
    }
    let everyone = [1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
    let authenticated = [1, 1, 0, 0, 0, 0, 0, 5, 11, 0, 0, 0];
    let users = [1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x21, 0x02, 0, 0];
    let system = [1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0];
    let administrators = [1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x20, 0x02, 0, 0];
    // An app-container capability SID (S-1-15-3-...), as the network sandbox adds.
    let capability = [1, 2, 0, 0, 0, 0, 0, 15, 3, 0, 0, 0, 1, 0, 0, 0];
    let user = [1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0xe9, 0x03, 0, 0];
    assert!(!acl::broad(&[ace(0, &system), ace(0, &administrators), ace(0, &user), ace(0, &capability)]));
    for sid in [&everyone[..], &authenticated, &users] {
        assert!(acl::broad(&[ace(0, &user), ace(0, sid)]));
        // A deny entry for a broad group is not a grant.
        assert!(!acl::broad(&[ace(1, sid)]));
    }
    // Real directories: a fresh temp directory under the user profile is private.
    let data = tempfile::tempdir().unwrap();
    assert!(private_dir(data.path()));
}

fn trust_record(host: &str, fingerprint: &str) -> sorng_storage::trust_store::TrustRecord {
    serde_json::from_value(serde_json::json!({
        "host": host,
        "record_type": "tls",
        "identity": {
            "kind": "tls",
            "fingerprint": fingerprint,
            "first_seen": "2026-01-01T00:00:00Z",
            "last_seen": "2026-01-01T00:00:00Z",
            "chain_fingerprints": [fingerprint],
        },
        "user_approved": true,
        "nickname": null,
        "history": [],
    }))
    .unwrap()
}

fn trust_digest(records: &[sorng_storage::trust_store::TrustRecord]) -> [u8; 32] {
    trust_projection(
        records,
        &sorng_storage::trust_store::TrustPolicy::Tofu,
        &Default::default(),
        "conn/1",
    )
}

#[test]
fn trust_binding_covers_scoped_records_and_the_host_level_fallback() {
    use sorng_storage::trust_store::{TrustPolicy, CONNECTION_SCOPE_PREFIX};
    let scoped = trust_record(&format!("{CONNECTION_SCOPE_PREFIX}conn%2F1/nas.local/443"), "aa");
    let fallback = trust_record("nas.local:443", "bb");
    let other = trust_record(&format!("{CONNECTION_SCOPE_PREFIX}other/nas.local/443"), "cc");
    let base = trust_digest(&[scoped.clone(), fallback.clone(), other.clone()]);
    // The database-wide host:port record is what effective_key resolves when
    // this connection has no scoped record: every decision on it is bound.
    let mut revoked = fallback.clone();
    revoked.revoked = true;
    let mut unapproved = fallback.clone();
    unapproved.user_approved = false;
    let mut pinned = fallback.clone();
    pinned.host_policy = Some(TrustPolicy::CertificatePinning);
    let rotated = trust_record("nas.local:443", "dd");
    for changed in [revoked, unapproved, pinned, rotated] {
        assert_ne!(base, trust_digest(&[scoped.clone(), changed, other.clone()]));
    }
    // A new host-level record (approval) and a removed one both change it.
    let added = trust_record("router.local:8443", "ee");
    assert_ne!(base, trust_digest(&[scoped.clone(), fallback.clone(), other.clone(), added]));
    assert_ne!(base, trust_digest(&[scoped.clone(), other.clone()]));
    // Scoped decisions of this connection stay bound.
    let mut scoped_revoked = scoped.clone();
    scoped_revoked.revoked = true;
    assert_ne!(base, trust_digest(&[scoped_revoked, fallback.clone(), other.clone()]));
    // Another connection's scoped record never matches this one.
    let mut other_revoked = other.clone();
    other_revoked.revoked = true;
    assert_eq!(base, trust_digest(&[scoped.clone(), fallback.clone(), other_revoked]));
    // Volatile bookkeeping and order never invalidate the cache.
    let mut visited = fallback.clone();
    visited.nickname = Some("renamed".into());
    visited.tags = vec!["t".into()];
    if let sorng_storage::trust_store::Identity::Tls(tls) = &mut visited.identity {
        tls.last_seen = "2026-09-09T00:00:00Z".into();
    }
    assert_eq!(base, trust_digest(&[other, visited, scoped]));
    // The database policy is bound.
    assert_ne!(
        base,
        trust_projection(
            &[],
            &TrustPolicy::Strict,
            &Default::default(),
            "conn/1"
        )
    );
}

#[test]
fn lease_release_and_drop_never_wait_for_housekeeping_io() {
    use std::sync::mpsc;
    use std::time::Duration;
    let (_data, mut store) = store();
    let (dropped_key, dropped_id, dropped_dir) = take(&mut store, "db", "dropped", 1).unwrap();
    let (released_key, released_id, released_dir) = take(&mut store, "db", "released", 1).unwrap();
    let (held_key, held_id, held_dir) = take(&mut store, "db", "held", 1).unwrap();
    let dropped = store.lease(dropped_key.clone(), dropped_id, dropped_dir, 16 * MIB, digest(1));
    let released = store.lease(released_key.clone(), released_id, released_dir, 16 * MIB, digest(1));
    let held = store.lease(held_key.clone(), held_id, held_dir, 16 * MIB, digest(1));
    // Housekeeping blocks mid-IO until released by this test (no timing).
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel::<()>();
    let resume_rx = Mutex::new(resume_rx);
    store.pause = Some(Box::new(move || {
        let _ = entered_tx.send(());
        let _ = resume_rx.lock().unwrap().recv();
    }));
    let leases = store.leases.clone();
    let worker = std::thread::spawn(move || {
        housekeeping(&mut store, NOW);
        store
    });
    entered_rx.recv().unwrap();
    // The attempt-end paths complete while the walk is still in progress.
    let (done_tx, done_rx) = mpsc::channel();
    std::thread::spawn(move || {
        drop(dropped);
        released.release();
        let _ = done_tx.send(());
    });
    let completed = done_rx.recv_timeout(Duration::from_secs(30)).is_ok();
    resume_tx.send(()).unwrap();
    let mut store = worker.join().unwrap();
    assert!(completed, "lease drop/release waited for housekeeping IO");
    {
        let table = table(&leases);
        assert!(!table.entries.contains_key(&dropped_key));
        assert!(!table.entries.contains_key(&released_key));
        assert!(table.entries.contains_key(&held_key));
    }
    // Ended leases make housekeeping due on the next tick, once.
    assert_eq!(store.take_released(NOW), 1);
    assert_eq!(store.take_released(NOW), 0);
    assert!(store.leased("db", "held"));
    drop(held);
    assert!(!store.leased("db", "held"));
}

#[test]
fn an_attempt_end_releases_the_lease_and_stamps_its_last_use() {
    let (_data, mut store) = store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    let lease = store.lease(key, id, directory.clone(), 128 * MIB, digest(1));
    // Engine-neutral accessors for the proxy store (never handed to CEF).
    assert_eq!(lease.conn_dir(), directory.as_path());
    assert_eq!(lease.directory(), directory.join(PROXY));
    assert_eq!(lease.directory().file_name().unwrap(), "proxy-v1");
    assert_eq!(lease.max_bytes(), 128 * MIB);
    assert_eq!(lease.binding_digest(), digest(1));
    assert_eq!(take(&mut store, "db", "conn", 1).err(), Some(Refusal::InUse));
    drop(lease);
    assert!(!store.leased("db", "conn"));
    assert_eq!(store.take_released(NOW + 50), 1);
    assert_eq!(read_binding(&directory).unwrap().last_used_at, NOW + 50);
    // The single lease per connection is free again.
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    let lease = store.lease(key, id, directory, 128 * MIB, digest(1));
    lease.release();
    assert!(!store.leased("db", "conn"));
}

#[test]
fn proxy_store_is_kept_by_housekeeping_and_wiped_on_binding_mismatch() {
    let (_data, mut store) = store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    let proxy = directory.join(PROXY);
    fs::create_dir_all(proxy.join("e")).unwrap();
    fs::write(proxy.join("keys.v1"), b"wrapped").unwrap();
    fill(&directory, 64);
    fs::write(directory.join("stray"), b"x").unwrap();
    store.release(&key, id);
    housekeeping(&mut store, NOW + 1);
    // binding.v1, proxy-v1/ and the legacy net/ are known children.
    assert!(proxy.join("keys.v1").exists());
    assert!(directory.join(NET).exists());
    assert!(directory.join(BINDING).exists());
    assert!(!directory.join("stray").exists());
    // Same binding keeps the proxy store; another binding crypto-erases it.
    let (key, id, _) = take(&mut store, "db", "conn", 1).unwrap();
    assert!(proxy.join("keys.v1").exists());
    store.release(&key, id);
    take(&mut store, "db", "conn", 2).unwrap();
    assert!(!proxy.exists());
    assert!(!directory.join(NET).exists());
    // A non-directory proxy-v1 is never handed out.
    let (_data, mut store) = self::store();
    let (key, id, directory) = take(&mut store, "db", "conn", 1).unwrap();
    store.release(&key, id);
    fs::write(directory.join(PROXY), b"not a dir").unwrap();
    take(&mut store, "db", "conn", 1).unwrap();
    assert!(!directory.join(PROXY).exists());
}

#[test]
fn clear_commands_refuse_with_exactly_browser_session_open_while_live() {
    use sorng_commands_core::database_protection::native_browser_owner::ClearError;
    assert_eq!(SESSION_OPEN, "browser-session-open");
    let live = |database: &str, connection: &str| database == "db-2" && connection == "conn";
    assert_eq!(
        refuse_open_session(["db-1", "db-2"], "conn", live),
        Err("browser-session-open".to_owned())
    );
    assert_eq!(refuse_open_session(["db-1"], "conn", live), Ok(()));
    assert_eq!(refuse_open_session(["db-2"], "other", live), Ok(()));
    assert_eq!(refuse_open_session([], "conn", live), Ok(()));
    // A retention attempt that became live before the cookie clear.
    assert_eq!(
        cookie_clear_refusal(ClearError::SessionOpen),
        Err("browser-session-open".to_owned())
    );
    for failure in [ClearError::Unavailable, ClearError::WrongConnection] {
        assert_eq!(cookie_clear_refusal(failure), Ok(()));
    }
}

fn open_in<'a>(cell: &Mutex<Status>, disk: &'a mut Disk) -> Result<&'a mut CacheStore, Unavailable> {
    open_store_in(cell, disk)
}

fn cache_root(data: &tempfile::TempDir) -> PathBuf {
    data.path().join(HTTP_CACHE_DIRECTORY_NAME)
}

#[test]
fn provisional_root_failure_does_not_block_the_runtime_root() {
    let early = tempfile::tempdir().unwrap();
    // A non-directory where the cache root belongs: refused, not repaired.
    fs::write(cache_root(&early), b"not a directory").unwrap();
    let runtime = tempfile::tempdir().unwrap();
    let cell = Mutex::new(Status::default());
    let mut disk = Disk::default();
    lock_status(&cell).configure_before_runtime(early.path(), true);
    assert_eq!(open_in(&cell, &mut disk).err(), Some(Unavailable::Runtime));
    assert!(cache_root(&early).is_file());
    lock_status(&cell).configure(runtime.path(), true);
    assert_eq!(open_in(&cell, &mut disk).unwrap().root(), cache_root(&runtime));
    // A non-local provisional root is replaced the same way.
    let cell = Mutex::new(Status::default());
    let mut disk = Disk::default();
    lock_status(&cell).configure_before_runtime(runtime.path(), false);
    assert_eq!(open_in(&cell, &mut disk).err(), Some(Unavailable::NotLocal));
    lock_status(&cell).configure(runtime.path(), true);
    assert!(open_in(&cell, &mut disk).is_ok());
}

#[test]
fn pre_runtime_store_creates_nothing_and_its_clears_and_usage_are_empty() {
    let data = tempfile::tempdir().unwrap();
    let absent = data.path().join("never-created");
    let cell = Mutex::new(Status::default());
    let mut disk = Disk::default();
    for root in [data.path().to_path_buf(), absent.clone()] {
        let cell = Mutex::new(Status::default());
        let mut disk = Disk::default();
        lock_status(&cell).configure_before_runtime(&root, true);
        let store = open_in(&cell, &mut disk).unwrap();
        let mut trash = Vec::new();
        assert_eq!(store.clear_database("db-1", &mut trash).unwrap(), ClearOutcome::default());
        assert_eq!(
            store.clear_connection("db-1", "conn", &mut trash).unwrap(),
            ClearOutcome::default()
        );
        assert_eq!(store.clear_all(&mut trash).unwrap(), ClearOutcome::default());
        assert_eq!(store.usage(None), 0);
        assert_eq!(store.usage(Some(("db-1", "conn"))), 0);
        assert!(trash.is_empty());
    }
    assert!(!data.path().join(HTTP_CACHE_DIRECTORY_NAME).exists());
    assert!(!absent.exists());
    // The runtime root is opened normally: directory and tag are created.
    lock_status(&cell).configure_before_runtime(data.path(), true);
    assert!(open_in(&cell, &mut disk).is_ok());
    assert!(!data.path().join(HTTP_CACHE_DIRECTORY_NAME).exists());
    lock_status(&cell).configure(data.path(), true);
    let store = open_in(&cell, &mut disk).unwrap();
    assert_eq!(store.root(), cache_root(&data));
    assert!(cache_root(&data).join(TAG_NAME).is_file());
}

#[test]
fn runtime_root_replaces_a_different_open_provisional_store() {
    let early = tempfile::tempdir().unwrap();
    let runtime = tempfile::tempdir().unwrap();
    let cell = Mutex::new(Status::default());
    let mut disk = Disk::default();
    lock_status(&cell).configure_before_runtime(early.path(), true);
    assert_eq!(open_in(&cell, &mut disk).unwrap().root(), cache_root(&early));
    lock_status(&cell).configure(runtime.path(), true);
    assert_eq!(open_in(&cell, &mut disk).unwrap().root(), cache_root(&runtime));
    // Later runtime configuration does not move an open runtime store.
    lock_status(&cell).configure(early.path(), true);
    lock_status(&cell).configure_before_runtime(early.path(), true);
    assert_eq!(open_in(&cell, &mut disk).unwrap().root(), cache_root(&runtime));
}

#[test]
fn runtime_root_equal_to_the_provisional_one_reopens_creating_the_cache() {
    let data = tempfile::tempdir().unwrap();
    let cell = Mutex::new(Status::default());
    let mut disk = Disk::default();
    lock_status(&cell).configure_before_runtime(data.path(), true);
    assert!(open_in(&cell, &mut disk).is_ok());
    assert!(!cache_root(&data).exists());
    lock_status(&cell).configure(data.path(), true);
    assert!(lock_status(&cell).reopen);
    assert_eq!(open_in(&cell, &mut disk).unwrap().root(), cache_root(&data));
    assert!(cache_root(&data).join(TAG_NAME).is_file());
}

#[test]
fn provisional_configuration_never_overrides_the_runtime_root() {
    let runtime = tempfile::tempdir().unwrap();
    let early = tempfile::tempdir().unwrap();
    let cell = Mutex::new(Status::default());
    let mut disk = Disk::default();
    lock_status(&cell).configure(runtime.path(), true);
    lock_status(&cell).configure_before_runtime(early.path(), true);
    assert_eq!(open_in(&cell, &mut disk).unwrap().root(), cache_root(&runtime));
}

#[test]
fn database_caches_clear_on_the_provisional_root_before_any_runtime() {
    let data = tempfile::tempdir().unwrap();
    let cell = Mutex::new(Status::default());
    let mut disk = Disk::default();
    lock_status(&cell).configure_before_runtime(data.path(), true);
    let store = open_in(&cell, &mut disk).unwrap();
    let entry = cache_root(&data)
        .join(database_key("db-1").unwrap())
        .join(connection_key("db-1", "conn").unwrap());
    fs::create_dir_all(entry.join("net").join("Cache")).unwrap();
    fs::write(entry.join("net").join("Cache").join("index"), b"x").unwrap();
    let mut trash = Vec::new();
    let outcome = store.clear_database("db-1", &mut trash).unwrap();
    empty_trash(trash);
    assert!(outcome.cleared && !outcome.pending);
    assert!(!entry.exists());
    assert!(!cache_root(&data).join(TAG_NAME).exists(), "pre-runtime never writes");
}
