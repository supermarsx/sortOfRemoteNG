//! Native-only unlock leases; never persist keys or return them through IPC.
use crate::database_protection::{random_id, DatabaseKey};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, Weak},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const SESSION_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_SESSIONS: usize = 128;
static SESSIONS: OnceLock<Arc<Mutex<DatabaseSessions>>> = OnceLock::new();
static EXPIRY_WORKER: OnceLock<()> = OnceLock::new();
pub fn global() -> &'static Mutex<DatabaseSessions> {
    let sessions = SESSIONS.get_or_init(|| Arc::new(Mutex::default()));
    EXPIRY_WORKER.get_or_init(|| {
        // One bounded process worker, independent of whichever temporary Tokio
        // executor first used the registry. Drop idle expired keys within one
        // second even if no subsequent window invokes a command.
        let _ = spawn_expiry_worker(Arc::downgrade(sessions), Duration::from_secs(1));
    });
    sessions
}
fn spawn_expiry_worker(
    sessions: Weak<Mutex<DatabaseSessions>>,
    interval: Duration,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || loop {
        std::thread::sleep(interval);
        let Some(sessions) = sessions.upgrade() else {
            break;
        };
        match sessions.lock() {
            Ok(mut sessions) => sessions.prune(Instant::now()),
            Err(poisoned) => poisoned.into_inner().entries.clear(),
        };
    })
}
pub fn revoke_owner(owner: u64) {
    // Recover the poisoned guard only to drop all secrets; future operations
    // continue reporting poison rather than silently accepting new sessions.
    global()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entries
        .retain(|_, s| s.owner != owner);
}
pub struct SessionScope<'a> {
    pub owner: u64,
    pub profile: &'a str,
    pub database: &'a str,
    pub revision: &'a str,
    pub window: &'a str,
    pub generation: u64,
}
struct Session {
    owner: u64,
    profile: String,
    database: String,
    revision: String,
    window: String,
    generation: u64,
    expires: Instant,
    expires_at: u64,
    key: DatabaseKey,
}
#[derive(Default)]
pub struct DatabaseSessions {
    entries: HashMap<String, Session>,
}
impl DatabaseSessions {
    fn prune(&mut self, now: Instant) {
        self.entries.retain(|_, s| s.expires > now);
    }
    pub fn insert(&mut self, scope: &SessionScope<'_>, key: DatabaseKey) -> Result<String, String> {
        self.prune(Instant::now());
        self.lock(scope.owner, scope.profile, scope.database, scope.window);
        if self.entries.len() >= MAX_SESSIONS {
            return Err("too many unlocked database sessions; close an existing database".into());
        }
        let id = random_id();
        let expires_at = (SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "system clock invalid")?
            + SESSION_TTL)
            .as_millis() as u64;
        self.entries.insert(
            id.clone(),
            Session {
                owner: scope.owner,
                profile: scope.profile.into(),
                database: scope.database.into(),
                revision: scope.revision.into(),
                window: scope.window.into(),
                generation: scope.generation,
                expires: Instant::now() + SESSION_TTL,
                expires_at,
                key,
            },
        );
        Ok(id)
    }
    pub fn key(&mut self, id: &str, scope: &SessionScope<'_>) -> Result<DatabaseKey, String> {
        self.prune(Instant::now());
        let session = self
            .entries
            .get(id)
            .ok_or("database is locked or its session expired")?;
        if session.owner != scope.owner
            || session.profile != scope.profile
            || session.database != scope.database
            || session.revision != scope.revision
            || session.window != scope.window
            || session.generation != scope.generation
        {
            // Never let another window invalidate the owner's unrelated token.
            if session.owner == scope.owner
                && session.profile == scope.profile
                && session.window == scope.window
            {
                self.entries.remove(id);
            }
            return Err("database unlock session is stale or belongs to another window".into());
        }
        Ok(session.key.duplicate())
    }
    pub fn is_unlocked(&mut self, scope: &SessionScope<'_>) -> bool {
        self.prune(Instant::now());
        self.entries.values().any(|s| {
            s.owner == scope.owner
                && s.profile == scope.profile
                && s.database == scope.database
                && s.revision == scope.revision
                && s.window == scope.window
                && s.generation == scope.generation
        })
    }
    pub fn expires_at(&mut self, scope: &SessionScope<'_>) -> Option<u64> {
        self.prune(Instant::now());
        self.entries
            .values()
            .find(|s| {
                s.owner == scope.owner
                    && s.profile == scope.profile
                    && s.database == scope.database
                    && s.revision == scope.revision
                    && s.window == scope.window
                    && s.generation == scope.generation
            })
            .map(|s| s.expires_at)
    }
    pub fn lock(&mut self, owner: u64, profile: &str, database: &str, window: &str) {
        self.entries.retain(|_, s| {
            s.owner != owner || s.profile != profile || s.database != database || s.window != window
        });
    }
    /// Drop only one abandoned unlock result, never another window's lease.
    /// Revision/generation need not match: cleanup must also accept stale own
    /// results, while the immutable owner/profile/database/window binding holds.
    pub fn release(
        &mut self,
        id: &str,
        owner: u64,
        profile: &str,
        database: &str,
        window: &str,
    ) -> Result<bool, String> {
        let Some(session) = self.entries.get(id) else {
            return Ok(false);
        };
        if session.owner != owner
            || session.profile != profile
            || session.database != database
            || session.window != window
        {
            return Err("database unlock session belongs to another scope".into());
        }
        Ok(self.entries.remove(id).is_some())
    }
    pub fn revoke_database(&mut self, owner: u64, profile: &str, database: &str) {
        self.entries
            .retain(|_, s| s.owner != owner || s.profile != profile || s.database != database);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_one_abandoned_unlock_preserves_other_sessions_and_rejects_scope_mismatch() {
        let mut sessions = DatabaseSessions::default();
        let scope = SessionScope {
            owner: 1,
            profile: "p",
            database: "db",
            revision: "r",
            window: "main",
            generation: 0,
        };
        let other = SessionScope {
            window: "detached",
            ..scope
        };
        let another_database = SessionScope {
            database: "other",
            ..scope
        };
        let token = sessions.insert(&scope, DatabaseKey::generate()).unwrap();
        let other_token = sessions.insert(&other, DatabaseKey::generate()).unwrap();
        let other_database_token = sessions
            .insert(&another_database, DatabaseKey::generate())
            .unwrap();
        for (owner, profile, database, window) in [
            (2, "p", "db", "main"),
            (1, "q", "db", "main"),
            (1, "p", "other", "main"),
            (1, "p", "db", "detached"),
        ] {
            assert!(sessions
                .release(&token, owner, profile, database, window)
                .is_err());
            assert!(sessions.key(&token, &scope).is_ok());
        }
        assert!(sessions.release(&token, 1, "p", "db", "main").unwrap());
        assert!(!sessions.release(&token, 1, "p", "db", "main").unwrap());
        assert!(sessions.key(&token, &scope).is_err());
        assert!(sessions.key(&other_token, &other).is_ok());
        assert!(sessions
            .key(&other_database_token, &another_database)
            .is_ok());
    }
    #[tokio::test]
    async fn readonly_snapshots_do_not_revoke_live_sessions_but_real_lock_and_install_do() {
        let state = crate::EncryptionState::new();
        state.install(crate::MasterDek::generate()).await;
        let scope = SessionScope {
            owner: state.database_session_owner(),
            profile: "snapshot-fixture",
            database: "db",
            revision: "r",
            window: "main",
            generation: state.key_generation(),
        };
        let token = global()
            .lock()
            .unwrap()
            .insert(&scope, DatabaseKey::generate())
            .unwrap();
        let snapshot = state.snapshot().await.unwrap();
        assert_ne!(snapshot.database_session_owner(), scope.owner);
        assert!(global().lock().unwrap().key(&token, &scope).is_ok());
        snapshot.lock().await;
        assert!(global().lock().unwrap().key(&token, &scope).is_ok());
        state.lock().await;
        assert!(global().lock().unwrap().key(&token, &scope).is_err());
        let scope = SessionScope {
            generation: state.key_generation(),
            ..scope
        };
        let token = global()
            .lock()
            .unwrap()
            .insert(&scope, DatabaseKey::generate())
            .unwrap();
        state.install(crate::MasterDek::generate()).await;
        assert!(global().lock().unwrap().key(&token, &scope).is_err());
    }
    #[test]
    fn leases_bind_every_identity_and_expire_without_keys_leaving_native_memory() {
        for mismatch in [
            "owner",
            "profile",
            "database",
            "revision",
            "window",
            "generation",
            "expired",
        ] {
            let mut sessions = DatabaseSessions::default();
            let original = SessionScope {
                owner: 1,
                profile: "p",
                database: "db",
                revision: "r",
                window: "main",
                generation: 0,
            };
            let token = sessions.insert(&original, DatabaseKey::generate()).unwrap();
            let mut wrong = SessionScope { ..original };
            match mismatch {
                "owner" => wrong.owner = 2,
                "profile" => wrong.profile = "other",
                "database" => wrong.database = "other",
                "revision" => wrong.revision = "other",
                "window" => wrong.window = "other",
                "generation" => wrong.generation = 1,
                "expired" => {
                    sessions.entries.get_mut(&token).unwrap().expires =
                        Instant::now() - Duration::from_secs(1)
                }
                _ => unreachable!(),
            }
            assert!(sessions.key(&token, &wrong).is_err(), "{mismatch}");
        }
    }
    #[test]
    fn explicit_inner_lock_works_without_a_master_key_and_is_window_scoped() {
        let mut sessions = DatabaseSessions::default();
        let scope = SessionScope {
            owner: 1,
            profile: "p",
            database: "db",
            revision: "r",
            window: "main",
            generation: 0,
        };
        let other = SessionScope {
            window: "detached",
            ..scope
        };
        let first = sessions.insert(&scope, DatabaseKey::generate()).unwrap();
        let second = sessions.insert(&other, DatabaseKey::generate()).unwrap();
        sessions.lock(1, "p", "db", "main");
        assert!(sessions.key(&first, &scope).is_err());
        assert!(sessions.key(&second, &other).is_ok());
        sessions.revoke_database(1, "p", "db");
        assert!(sessions.key(&second, &other).is_err());
    }

    #[tokio::test]
    async fn periodic_expiry_drops_idle_keys_without_ipc_and_preserves_other_owner_leases() {
        // A dedicated registry prevents unrelated concurrent test IPC from
        // pruning this deadline and falsely proving periodic cleanup.
        let registry = Arc::new(Mutex::new(DatabaseSessions::default()));
        let worker = spawn_expiry_worker(Arc::downgrade(&registry), Duration::from_millis(20));
        let owner = crate::EncryptionState::new().database_session_owner();
        let other_owner = crate::EncryptionState::new().database_session_owner();
        let scope = SessionScope {
            owner,
            profile: "expiry-fixture",
            database: "db",
            revision: "r",
            window: "main",
            generation: 0,
        };
        let other = SessionScope {
            owner: other_owner,
            ..scope
        };
        let (expired, live) = {
            let mut sessions = registry.lock().unwrap();
            let expired = sessions.insert(&scope, DatabaseKey::generate()).unwrap();
            let live = sessions.insert(&other, DatabaseKey::generate()).unwrap();
            assert!(
                sessions.entries.contains_key(&expired),
                "other owner insertion must not replace this lease"
            );
            sessions.entries.get_mut(&expired).unwrap().expires =
                Instant::now() - Duration::from_secs(1);
            (expired, live)
        };
        tokio::time::timeout(Duration::from_secs(4), async {
            loop {
                // Inspect membership directly; no key()/expires_at() call can
                // prune on behalf of the actual periodic cleanup worker.
                if !registry.lock().unwrap().entries.contains_key(&expired) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("idle expired key was not dropped by cleanup worker");
        let mut sessions = registry.lock().unwrap();
        assert!(sessions.entries.contains_key(&live));
        sessions.revoke_database(owner, scope.profile, scope.database);
        assert!(sessions.entries.contains_key(&live));
        sessions.revoke_database(other_owner, scope.profile, scope.database);
        drop(sessions);
        drop(registry);
        worker.join().unwrap();
    }
}
