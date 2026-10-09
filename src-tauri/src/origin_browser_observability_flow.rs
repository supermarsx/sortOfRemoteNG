//! Nonblocking observation only: no cleanup, authority renewal or UI dispatch.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub(crate) fn snapshot_authorized<T, R>(
    registry: &Mutex<HashMap<String, Arc<T>>>,
    authorized: impl Fn(&T) -> bool,
    read: impl Fn(&T) -> R,
) -> Result<Vec<R>, ()> {
    // No owner check, nested lock, projection or destructor under the map lock.
    let attempts: Vec<_> = {
        let registry = registry.try_lock().map_err(|_| ())?;
        registry.values().cloned().collect()
    };
    let mut rows = Vec::new();
    for attempt in attempts {
        if !authorized(&attempt) {
            continue;
        }
        let row = read(&attempt);
        if authorized(&attempt) {
            rows.push((attempt, row));
        }
    }
    // A later row's read must not publish an earlier owner's revoked data.
    Ok(rows
        .into_iter()
        .filter_map(|(attempt, row)| authorized(&attempt).then_some(row))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::Cell,
        sync::atomic::{AtomicBool, Ordering},
    };

    struct Owner {
        window: &'static str,
        live: AtomicBool,
    }
    fn registry() -> Mutex<HashMap<String, Arc<Owner>>> {
        Mutex::new(HashMap::from([
            (
                "ours".into(),
                Arc::new(Owner {
                    window: "main",
                    live: AtomicBool::new(true),
                }),
            ),
            (
                "theirs".into(),
                Arc::new(Owner {
                    window: "detached",
                    live: AtomicBool::new(true),
                }),
            ),
        ]))
    }

    #[test]
    fn exact_window_and_live_lease_are_checked_without_holding_registry() {
        let registry = registry();
        let reads = Cell::new(0);
        let rows = snapshot_authorized(
            &registry,
            |owner| {
                assert!(registry.try_lock().is_ok());
                owner.window == "main" && owner.live.load(Ordering::Acquire)
            },
            |owner| {
                assert!(registry.try_lock().is_ok());
                reads.set(reads.get() + 1);
                owner.window
            },
        )
        .unwrap();
        assert_eq!(reads.get(), 1);
        assert_eq!(rows, ["main"]);
        registry.lock().unwrap()["ours"]
            .live
            .store(false, Ordering::Release);
        assert!(snapshot_authorized(
            &registry,
            |owner| owner.window == "main" && owner.live.load(Ordering::Acquire),
            |_| panic!("revoked owners must not be read"),
        )
        .unwrap()
        .is_empty());
    }

    #[test]
    fn busy_and_poisoned_registry_fail_without_waiting_or_repair() {
        let registry = registry();
        let _held = registry.lock().unwrap();
        assert!(snapshot_authorized(&registry, |_| true, |_| ()).is_err());
        drop(_held);
        let _ = std::panic::catch_unwind(|| {
            let _held = registry.lock().unwrap();
            panic!("poison fixture");
        });
        assert!(snapshot_authorized(&registry, |_| true, |_| ()).is_err());
        assert!(registry.is_poisoned());
    }

    #[test]
    fn revocation_during_read_and_before_final_publication_omits_rows() {
        let registry = registry();
        let reads = Cell::new(0);
        let rows = snapshot_authorized(
            &registry,
            |owner| owner.live.load(Ordering::Acquire),
            |_| {
                reads.set(reads.get() + 1);
                if reads.get() == 2 {
                    for owner in registry.lock().unwrap().values() {
                        owner.live.store(false, Ordering::Release);
                    }
                }
            },
        )
        .unwrap();
        assert_eq!(reads.get(), 2);
        assert!(rows.is_empty());
    }
}
