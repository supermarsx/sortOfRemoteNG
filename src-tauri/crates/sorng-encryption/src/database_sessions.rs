//! Native-only open-database sessions; never persist keys or return them through IPC.
//! Lifetime follows explicit close/lock, the owning window/state and key generation.
//! Idle locking belongs to the configured auto-lock policy, not a hidden fixed TTL.
use crate::database_protection::{random_id, DatabaseKey};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

const MAX_SESSIONS: usize = 128;
static SESSIONS: OnceLock<Mutex<DatabaseSessions>> = OnceLock::new();
pub fn global() -> &'static Mutex<DatabaseSessions> {
    SESSIONS.get_or_init(Mutex::default)
}
pub fn revoke_owner(owner: u64) {
    // Recover the poisoned guard only to drop all secrets; future operations
    // continue reporting poison rather than silently accepting new sessions.
    let mut sessions = global().lock().unwrap_or_else(|e| e.into_inner());
    sessions.entries.retain(|_, s| s.owner != owner);
    sessions
        .window_epochs
        .retain(|(entry_owner, _), _| *entry_owner != owner);
}
pub fn revoke_window(owner: u64, window: &str) {
    global()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .revoke_window(owner, window);
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
    key: DatabaseKey,
}
#[derive(Default)]
pub struct DatabaseSessions {
    entries: HashMap<String, Session>,
    window_epochs: HashMap<(u64, String), u64>,
    next_window_epoch: u64,
}
impl DatabaseSessions {
    /// Capture before any asynchronous authentication/protection work. A
    /// destroyed/reopened window with the same label gets a different epoch.
    pub fn window_epoch(&mut self, owner: u64, window: &str) -> Result<u64, String> {
        let identity = (owner, window.to_owned());
        if let Some(epoch) = self.window_epochs.get(&identity) {
            return Ok(*epoch);
        }
        self.next_window_epoch = self
            .next_window_epoch
            .checked_add(1)
            .ok_or("database window lifetime exhausted")?;
        self.window_epochs.insert(identity, self.next_window_epoch);
        Ok(self.next_window_epoch)
    }
    pub fn insert_for_window(
        &mut self,
        scope: &SessionScope<'_>,
        key: DatabaseKey,
        window_epoch: u64,
    ) -> Result<String, String> {
        if self
            .window_epochs
            .get(&(scope.owner, scope.window.to_owned()))
            != Some(&window_epoch)
        {
            return Err("database unlock window closed; unlock again in the current window".into());
        }
        self.insert(scope, key)
    }
    pub fn insert(&mut self, scope: &SessionScope<'_>, key: DatabaseKey) -> Result<String, String> {
        self.lock(scope.owner, scope.profile, scope.database, scope.window);
        if self.entries.len() >= MAX_SESSIONS {
            return Err("too many unlocked database sessions; close an existing database".into());
        }
        let id = random_id();
        self.entries.insert(
            id.clone(),
            Session {
                owner: scope.owner,
                profile: scope.profile.into(),
                database: scope.database.into(),
                revision: scope.revision.into(),
                window: scope.window.into(),
                generation: scope.generation,
                key,
            },
        );
        Ok(id)
    }
    pub fn key(&mut self, id: &str, scope: &SessionScope<'_>) -> Result<DatabaseKey, String> {
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
        self.entries.values().any(|s| {
            s.owner == scope.owner
                && s.profile == scope.profile
                && s.database == scope.database
                && s.revision == scope.revision
                && s.window == scope.window
                && s.generation == scope.generation
        })
    }
    /// Window destruction drops every database key for that window, including
    /// abandoned grants whose renderer never received the unlock response.
    pub fn revoke_window(&mut self, owner: u64, window: &str) {
        self.window_epochs.remove(&(owner, window.to_owned()));
        self.entries
            .retain(|_, s| s.owner != owner || s.window != window);
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
    fn sessions_bind_every_identity_without_keys_leaving_native_memory() {
        for mismatch in [
            "owner",
            "profile",
            "database",
            "revision",
            "window",
            "generation",
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

    #[test]
    fn window_close_revokes_all_its_databases_without_touching_other_windows_or_owners() {
        let mut sessions = DatabaseSessions::default();
        let scope = SessionScope {
            owner: 1,
            profile: "window-fixture",
            database: "db",
            revision: "r",
            window: "main",
            generation: 0,
        };
        let side = SessionScope {
            database: "side",
            ..scope
        };
        let detached = SessionScope {
            window: "detached",
            ..scope
        };
        let other = SessionScope { owner: 2, ..scope };
        let main_token = sessions.insert(&scope, DatabaseKey::generate()).unwrap();
        let side_token = sessions.insert(&side, DatabaseKey::generate()).unwrap();
        let detached_token = sessions.insert(&detached, DatabaseKey::generate()).unwrap();
        let other_token = sessions.insert(&other, DatabaseKey::generate()).unwrap();
        sessions.revoke_window(1, "main");
        assert!(sessions.key(&main_token, &scope).is_err());
        assert!(sessions.key(&side_token, &side).is_err());
        assert!(sessions.key(&detached_token, &detached).is_ok());
        assert!(sessions.key(&other_token, &other).is_ok());
    }

    #[test]
    fn last_owner_drop_revokes_keys_but_dropping_a_clone_does_not() {
        let state = crate::EncryptionState::new();
        let clone = state.clone();
        let scope = SessionScope {
            owner: state.database_session_owner(),
            profile: "owner-fixture",
            database: "db",
            revision: "r",
            window: "main",
            generation: 0,
        };
        let token = global()
            .lock()
            .unwrap()
            .insert(&scope, DatabaseKey::generate())
            .unwrap();
        drop(state);
        assert!(global().lock().unwrap().key(&token, &scope).is_ok());
        drop(clone);
        assert!(global().lock().unwrap().key(&token, &scope).is_err());
    }

    #[test]
    fn window_close_rejects_late_grants_even_after_the_label_is_reused() {
        let mut sessions = DatabaseSessions::default();
        let scope = SessionScope {
            owner: 1,
            profile: "p",
            database: "db",
            revision: "r",
            window: "main",
            generation: 0,
        };
        let abandoned = sessions.window_epoch(1, "main").unwrap();
        sessions.revoke_window(1, "main");
        assert!(sessions
            .insert_for_window(&scope, DatabaseKey::generate(), abandoned)
            .is_err());
        let reopened = sessions.window_epoch(1, "main").unwrap();
        assert_ne!(abandoned, reopened);
        let current = sessions
            .insert_for_window(&scope, DatabaseKey::generate(), reopened)
            .unwrap();
        assert!(sessions
            .insert_for_window(&scope, DatabaseKey::generate(), abandoned)
            .is_err());
        assert!(sessions.key(&current, &scope).is_ok());
        assert_eq!(sessions.entries.len(), 1);
    }

    #[test]
    fn open_sessions_stay_bounded_and_replacement_does_not_consume_capacity() {
        let mut sessions = DatabaseSessions::default();
        for index in 0..MAX_SESSIONS {
            let scope = SessionScope {
                owner: 1,
                profile: "p",
                database: &index.to_string(),
                revision: "r",
                window: "main",
                generation: 0,
            };
            sessions.insert(&scope, DatabaseKey::generate()).unwrap();
        }
        let scope = SessionScope {
            owner: 1,
            profile: "p",
            database: "another",
            revision: "r",
            window: "main",
            generation: 0,
        };
        assert!(sessions.insert(&scope, DatabaseKey::generate()).is_err());
        let replacement = SessionScope {
            database: "0",
            ..scope
        };
        let token = sessions
            .insert(&replacement, DatabaseKey::generate())
            .unwrap();
        assert!(sessions.key(&token, &replacement).is_ok());
        sessions.revoke_window(1, "main");
        assert!(sessions.insert(&scope, DatabaseKey::generate()).is_ok());
    }
}
