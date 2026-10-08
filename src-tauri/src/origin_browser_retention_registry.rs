//! Live attempts and retained snapshots have different lifetimes. A new attempt
//! becomes the only snapshot writer without revoking any other live cookie jar.
use sorng_browser_host::cef_session_retention::{RetentionError, MAX_TOTAL_BYTES};
use sorng_encryption::database_protection::Zeroizing;
use std::{collections::HashMap, sync::Arc};

pub(super) const MAX_ACTIVE: usize = 64;
pub(super) const MAX_TRACKED: usize = 1024;

pub(super) struct Slot<L> {
    pub generation: u64,
    pub binding: String,
    pub memory: Option<Zeroizing<Vec<u8>>>,
    pub expires: u64,
    pub cleanup: L,
    pub database_revision: Option<String>,
    pub notify: Arc<dyn Fn() + Send + Sync>,
}

pub(super) struct Attempt<L> {
    pub scope: String,
    pub binding: String,
    pub lease: L,
}

pub(super) struct Registry<L> {
    next: u64,
    pub slots: HashMap<String, Slot<L>>,
    pub active: HashMap<u64, Attempt<L>>,
}

impl<L> Default for Registry<L> {
    fn default() -> Self {
        Self {
            next: 0,
            slots: HashMap::new(),
            active: HashMap::new(),
        }
    }
}

impl<L> Registry<L> {
    pub fn current(&self, scope: &str, generation: u64) -> bool {
        self.active
            .get(&generation)
            .is_some_and(|a| a.scope == scope)
    }

    pub fn snapshot_current(&self, scope: &str, generation: u64) -> bool {
        self.slots
            .get(scope)
            .is_some_and(|s| s.generation == generation)
    }

    pub fn writer(&self, scope: &str, generation: u64) -> bool {
        self.current(scope, generation) && self.snapshot_current(scope, generation)
    }

    pub fn prune(&mut self) -> Vec<Slot<L>> {
        let retired: Vec<_> = self
            .slots
            .iter()
            .filter(|(scope, s)| {
                !self.active.values().any(|a| &a.scope == *scope)
                    && s.memory.is_none()
                    && s.database_revision.is_none()
            })
            .map(|(scope, _)| scope.clone())
            .collect();
        // Lease destructors can release the last encryption-state owner and
        // acquire its session mutex. Drop them OUTSIDE registry/unlock locks.
        retired
            .into_iter()
            .filter_map(|scope| self.slots.remove(&scope))
            .collect()
    }

    /// Caller holds the native database write coordinator and the unlock fence.
    /// Thus a predecessor's pending commit cannot cross writer handover.
    /// Returned retired leases must be dropped after releasing both fences.
    pub fn admit(
        &mut self,
        scope: String,
        mut slot: Slot<L>,
        lease: L,
        stamp: u64,
    ) -> Result<(u64, Option<Slot<L>>), RetentionError> {
        if self.active.len() >= MAX_ACTIVE
            || (!self.slots.contains_key(&scope) && self.slots.len() >= MAX_TRACKED)
        {
            return Err(RetentionError::Limit);
        }
        let generation = self.next.checked_add(1).ok_or(RetentionError::Limit)?;
        self.next = generation;
        let mut retired = self.slots.remove(&scope);
        if let Some(old) = retired.as_mut() {
            if old.binding == slot.binding && old.expires > stamp {
                slot.memory = old.memory.take();
                // Preserve cleanup deadlines until the successor actually loads
                // or checkpoints this snapshot. Opening tabs is not activity.
                slot.expires = old.expires;
                slot.database_revision = old.database_revision.take();
            }
        }
        self.active.insert(
            generation,
            Attempt {
                scope: scope.clone(),
                binding: slot.binding.clone(),
                lease,
            },
        );
        slot.generation = generation;
        self.slots.insert(scope, slot);
        Ok((generation, retired))
    }

    pub fn memory(&self, scope: &str, generation: u64, stamp: u64) -> Option<Zeroizing<Vec<u8>>> {
        let attempt = self.active.get(&generation).filter(|a| a.scope == scope)?;
        let slot = self.slots.get(scope)?;
        (slot.binding == attempt.binding && slot.expires > stamp)
            .then(|| slot.memory.as_ref().map(|b| Zeroizing::new(b.to_vec())))?
    }

    pub fn save_memory(
        &mut self,
        scope: &str,
        generation: u64,
        bytes: Zeroizing<Vec<u8>>,
    ) -> Result<(), RetentionError> {
        if !self.writer(scope, generation) {
            return Ok(());
        }
        let total: usize = self
            .slots
            .iter()
            .filter(|(id, _)| id.as_str() != scope)
            .map(|(_, s)| s.memory.as_ref().map_or(0, |b| b.len()))
            .sum();
        if bytes.len() > MAX_TOTAL_BYTES.saturating_sub(total) {
            return Err(RetentionError::Limit);
        }
        self.slots
            .get_mut(scope)
            .expect("current writer slot")
            .memory = Some(bytes);
        Ok(())
    }

    pub fn retire(
        &mut self,
        scope: &str,
        generation: u64,
        clear_memory: bool,
    ) -> Option<Attempt<L>> {
        if !self.current(scope, generation) {
            return None;
        }
        let retired = self.active.remove(&generation);
        if clear_memory {
            if let Some(slot) = self
                .slots
                .get_mut(scope)
                .filter(|s| s.generation == generation)
            {
                slot.memory = None;
            }
        }
        retired
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn admit(r: &mut Registry<()>, scope: &str, binding: &str) -> u64 {
        drop(r.prune());
        r.admit(scope.into(), slot(binding), (), 1).unwrap().0
    }
    fn slot(binding: &str) -> Slot<()> {
        Slot {
            generation: 0,
            binding: binding.into(),
            memory: None,
            expires: 100,
            cleanup: (),
            database_revision: None,
            notify: Arc::new(|| {}),
        }
    }
    fn bytes(value: &[u8]) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(value.to_vec())
    }

    #[test]
    fn duplicate_connection_keeps_both_live_attempts_but_only_latest_writes() {
        let mut r = Registry::default();
        let a = admit(&mut r, "db/connection", "unlocked");
        let b = admit(&mut r, "db/connection", "unlocked");
        assert!(r.current("db/connection", a));
        assert!(r.current("db/connection", b));
        assert!(!r.writer("db/connection", a));
        assert!(r.writer("db/connection", b));
        assert!(!r.current("another-db/connection", a));
    }

    #[test]
    fn stale_save_clear_and_drop_cannot_change_successor_tokens() {
        let mut r = Registry::default();
        let a = admit(&mut r, "c", "binding");
        r.save_memory("c", a, bytes(b"old-token")).unwrap();
        let b = admit(&mut r, "c", "binding");
        assert_eq!(&**r.memory("c", b, 1).as_ref().unwrap(), b"old-token");
        r.save_memory("c", b, bytes(b"new-token")).unwrap();
        r.save_memory("c", a, bytes(b"stale-token")).unwrap();
        r.retire("c", a, true);
        assert_eq!(&**r.memory("c", b, 1).as_ref().unwrap(), b"new-token");
        assert!(r.writer("c", b));
    }

    #[test]
    fn closing_latest_writer_never_promotes_an_old_live_jar() {
        let mut r = Registry::default();
        let a = admit(&mut r, "c", "binding");
        let b = admit(&mut r, "c", "binding");
        r.save_memory("c", b, bytes(b"latest")).unwrap();
        r.retire("c", b, false);
        assert!(r.current("c", a));
        assert!(!r.writer("c", a));
        r.save_memory("c", a, bytes(b"stale")).unwrap();
        let c = admit(&mut r, "c", "binding");
        assert_eq!(&**r.memory("c", c, 1).as_ref().unwrap(), b"latest");
        assert!(r.writer("c", c));
        assert!(!r.writer("c", b));
    }

    #[test]
    fn database_connection_window_unlock_and_policy_bind_memory() {
        let mut r = Registry::default();
        let a = admit(&mut r, "db1/c1", "main/epoch1/policy1");
        r.save_memory("db1/c1", a, bytes(b"private")).unwrap();
        for scope in ["db2/c1", "db1/c2"] {
            let b = admit(&mut r, scope, "main/epoch1/policy1");
            assert!(r.memory(scope, b, 1).is_none());
        }
        for binding in [
            "detached/epoch1/policy1",
            "main/epoch2/policy1",
            "main/epoch2/policy2",
        ] {
            let b = admit(&mut r, "db1/c1", binding);
            assert!(r.memory("db1/c1", b, 1).is_none());
            r.save_memory("db1/c1", b, bytes(b"different-owner"))
                .unwrap();
            assert!(r.memory("db1/c1", a, 1).is_none());
        }
    }

    #[test]
    fn limits_count_attempts_not_connections_and_failed_admission_preserves_writer() {
        let mut r = Registry::default();
        let mut latest = 0;
        for _ in 0..MAX_ACTIVE {
            latest = admit(&mut r, "same", "binding");
        }
        assert!(matches!(
            r.admit("same".into(), slot("binding"), (), 1),
            Err(RetentionError::Limit)
        ));
        assert!(r.writer("same", latest));
        r.retire("same", latest, false);
        assert!(r.admit("same".into(), slot("binding"), (), 1).is_ok());
    }

    #[test]
    fn retired_snapshots_have_separate_bounded_capacity() {
        let mut r = Registry::default();
        for i in 0..MAX_TRACKED {
            let scope = i.to_string();
            let a = admit(&mut r, &scope, "binding");
            r.save_memory(&scope, a, bytes(b"x")).unwrap();
            r.retire(&scope, a, false);
        }
        assert!(matches!(
            r.admit("new".into(), slot("binding"), (), 1),
            Err(RetentionError::Limit)
        ));
        assert!(r.admit("0".into(), slot("binding"), (), 1).is_ok());
    }

    #[test]
    fn aggregate_memory_is_bounded_and_replaced_not_merged() {
        let mut r = Registry::default();
        let a = admit(&mut r, "a", "binding");
        let b = admit(&mut r, "b", "binding");
        r.save_memory("a", a, Zeroizing::new(vec![1; MAX_TOTAL_BYTES]))
            .unwrap();
        assert!(matches!(
            r.save_memory("b", b, bytes(b"x")),
            Err(RetentionError::Limit)
        ));
        r.save_memory("a", a, bytes(b"replacement")).unwrap();
        r.save_memory("b", b, bytes(b"x")).unwrap();
        assert_eq!(&**r.memory("a", a, 1).as_ref().unwrap(), b"replacement");
    }

    #[test]
    fn reopening_does_not_extend_idle_expiry_and_expiry_does_not_revoke_live_readers() {
        let mut r = Registry::default();
        let a = admit(&mut r, "c", "binding");
        r.save_memory("c", a, bytes(b"token")).unwrap();
        r.slots.get_mut("c").unwrap().expires = 4;
        let b = admit(&mut r, "c", "binding");
        assert_eq!(r.slots["c"].expires, 4);
        assert!(r.memory("c", b, 4).is_none());
        r.slots.remove("c");
        assert!(r.current("c", a));
        assert!(r.current("c", b));
        assert!(!r.writer("c", b));
    }
}
