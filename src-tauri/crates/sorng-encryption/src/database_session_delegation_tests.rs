use super::*;

fn scope() -> SessionScope<'static> {
    SessionScope {
        owner: 1,
        profile: "profile",
        database: "database",
        revision: "revision",
        window: "main",
        generation: 3,
    }
}

#[test]
fn delegation_is_target_bound_idempotent_and_reissued_after_target_release() {
    let mut registry = DatabaseSessions::default();
    let source = scope();
    let target = SessionScope {
        window: "detached-one",
        ..scope()
    };
    let source_id = registry.insert(&source, DatabaseKey::generate()).unwrap();
    let epoch = registry.window_epoch(source.owner, target.window).unwrap();
    let delegated = registry
        .delegate_for_window(&source_id, &source, target.window, epoch, "bootstrap-one")
        .unwrap();
    assert_ne!(source_id, delegated);
    assert!(registry.key(&source_id, &target).is_err());
    assert!(registry.key(&delegated, &source).is_err());
    let source_key = registry.key(&source_id, &source).unwrap();
    let target_key = registry.key(&delegated, &target).unwrap();
    assert!(source_key.with_bytes(|s| target_key.with_bytes(|t| s == t)));
    let validity = registry.validity(&delegated, &target).unwrap();
    for _ in 0..256 {
        assert_eq!(
            registry
                .delegate_for_window(&source_id, &source, target.window, epoch, "bootstrap-one")
                .unwrap(),
            delegated
        );
    }
    assert_eq!(registry.entries.len(), 2);
    assert!(validity.is_current());
    registry
        .release(
            &delegated,
            source.owner,
            source.profile,
            source.database,
            target.window,
        )
        .unwrap();
    assert!(!validity.is_current());
    assert!(registry.key(&source_id, &source).is_ok());
    let replacement = registry
        .delegate_for_window(&source_id, &source, target.window, epoch, "bootstrap-one")
        .unwrap();
    assert_ne!(replacement, delegated);
    assert!(registry.key(&replacement, &target).is_ok());
}

#[test]
fn receiver_bootstrap_grants_are_independent_under_delayed_issue_and_release() {
    let mut registry = DatabaseSessions::default();
    let source = scope();
    let target = SessionScope {
        window: "detached-one",
        ..scope()
    };
    let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
    let epoch = registry.window_epoch(source.owner, target.window).unwrap();
    let old = registry
        .delegate_for_window(&token, &source, target.window, epoch, "old-document")
        .unwrap();
    let new = registry
        .delegate_for_window(&token, &source, target.window, epoch, "new-document")
        .unwrap();
    assert_ne!(old, new);
    let old_validity = registry.validity(&old, &target).unwrap();
    let new_validity = registry.validity(&new, &target).unwrap();
    assert_eq!(
        registry
            .delegate_for_window(&token, &source, target.window, epoch, "old-document")
            .unwrap(),
        old
    );
    assert_eq!(
        registry
            .delegate_for_window(&token, &source, target.window, epoch, "new-document")
            .unwrap(),
        new
    );
    registry
        .release(
            &old,
            source.owner,
            source.profile,
            source.database,
            target.window,
        )
        .unwrap();
    assert!(!old_validity.is_current());
    assert!(new_validity.is_current());
    // A delayed old-document request is not a supersession of the new one.
    let late = registry
        .delegate_for_window(&token, &source, target.window, epoch, "old-document")
        .unwrap();
    assert_ne!(late, new);
    assert!(registry.key(&new, &target).is_ok());
    registry
        .release(
            &late,
            source.owner,
            source.profile,
            source.database,
            target.window,
        )
        .unwrap();
    assert!(new_validity.is_current());
    registry.revoke_window(source.owner, source.window);
    assert!(!new_validity.is_current());
}

#[test]
fn receiver_nonces_are_validated_bounded_and_never_authority() {
    let mut registry = DatabaseSessions::default();
    let source = scope();
    let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
    let epoch = registry.window_epoch(source.owner, "detached-one").unwrap();
    for bad in ["", "a/b", "a b", "\n", &"x".repeat(129)] {
        assert!(registry
            .delegate_for_window(&token, &source, "detached-one", epoch, bad)
            .is_err());
    }
    assert_eq!(registry.entries.len(), 1);
    assert!(registry
        .delegate_for_window("unknown", &source, "detached-one", epoch, "valid-nonce")
        .is_err());
    for i in 1..MAX_SESSIONS {
        registry
            .delegate_for_window(
                &token,
                &source,
                "detached-one",
                epoch,
                &format!("document-{i}"),
            )
            .unwrap();
    }
    assert!(registry
        .delegate_for_window(&token, &source, "detached-one", epoch, "document-overflow")
        .is_err());
    assert!(registry
        .delegate_for_window(&token, &source, "detached-one", epoch, "document-1")
        .is_ok());
    registry.revoke_window(source.owner, "detached-one");
    assert_eq!(registry.entries.len(), 1);
    assert!(registry.key(&token, &source).is_ok());
}

#[test]
fn delegation_rejects_every_source_scope_mismatch_and_missing_authority() {
    for mismatch in 0..7 {
        let mut registry = DatabaseSessions::default();
        let source = scope();
        let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
        let epoch = registry.window_epoch(source.owner, "detached-one").unwrap();
        let mut wrong = scope();
        match mismatch {
            0 => wrong.owner += 1,
            1 => wrong.profile = "other",
            2 => wrong.database = "other",
            3 => wrong.revision = "other",
            4 => wrong.window = "detached-thief",
            5 => wrong.generation += 1,
            _ => {
                registry
                    .release(
                        &token,
                        source.owner,
                        source.profile,
                        source.database,
                        source.window,
                    )
                    .unwrap();
            }
        }
        assert!(registry
            .delegate_for_window(&token, &wrong, "detached-one", epoch, "bootstrap-one")
            .is_err());
        assert!(!registry
            .entries
            .values()
            .any(|s| s.window == "detached-one"));
    }
}

#[test]
fn source_removal_revokes_descendants_and_observation_handles_immediately() {
    for removal in 0..8 {
        let mut registry = DatabaseSessions::default();
        let source = scope();
        let target = SessionScope {
            window: "detached-one",
            ..scope()
        };
        let leaf = SessionScope {
            window: "detached-two",
            ..scope()
        };
        let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
        let epoch = registry.window_epoch(source.owner, target.window).unwrap();
        let child = registry
            .delegate_for_window(&token, &source, target.window, epoch, "bootstrap-one")
            .unwrap();
        let leaf_epoch = registry.window_epoch(source.owner, leaf.window).unwrap();
        let grandchild = registry
            .delegate_for_window(&child, &target, leaf.window, leaf_epoch, "bootstrap-one")
            .unwrap();
        let child_validity = registry.validity(&child, &target).unwrap();
        let leaf_validity = registry.validity(&grandchild, &leaf).unwrap();
        match removal {
            0 => registry.lock(source.owner, source.profile, source.database, source.window),
            1 => {
                registry
                    .release(
                        &token,
                        source.owner,
                        source.profile,
                        source.database,
                        source.window,
                    )
                    .unwrap();
            }
            2 => registry.revoke_window(source.owner, source.window),
            3 => registry.revoke_database(source.owner, source.profile, source.database),
            4 => {
                registry.insert(&source, DatabaseKey::generate()).unwrap();
            }
            5 => {
                assert!(registry
                    .key(
                        &token,
                        &SessionScope {
                            generation: 4,
                            ..scope()
                        }
                    )
                    .is_err());
            }
            6 => {
                assert!(registry
                    .key(
                        &token,
                        &SessionScope {
                            revision: "changed",
                            ..scope()
                        }
                    )
                    .is_err());
            }
            // The generic removal/expiry path must invalidate descendants even
            // before lazy pruning, including already-captured native handles.
            _ => {
                registry.entries.remove(&token);
            }
        }
        assert!(!child_validity.is_current(), "removal {removal}");
        assert!(!leaf_validity.is_current(), "removal {removal}");
        assert!(!registry.is_unlocked(&target));
        assert!(!registry.is_unlocked(&leaf));
        assert!(registry.key(&child, &target).is_err());
        assert!(registry.validity(&grandchild, &leaf).is_err());
        assert!(registry
            .entries
            .values()
            .all(|s| s.delegated_from.is_none()));
    }
}

#[test]
fn destroyed_or_reused_target_rejects_late_issue_and_old_idempotency() {
    let mut registry = DatabaseSessions::default();
    let source = scope();
    let target = SessionScope {
        window: "detached-one",
        ..scope()
    };
    let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
    let old_epoch = registry.window_epoch(source.owner, target.window).unwrap();
    let child = registry
        .delegate_for_window(&token, &source, target.window, old_epoch, "bootstrap-one")
        .unwrap();
    let validity = registry.validity(&child, &target).unwrap();
    registry.revoke_window(source.owner, target.window);
    assert!(!validity.is_current());
    assert!(registry
        .delegate_for_window(&token, &source, target.window, old_epoch, "bootstrap-one")
        .is_err());
    let epoch = registry.window_epoch(source.owner, target.window).unwrap();
    assert_ne!(epoch, old_epoch);
    assert!(registry
        .delegate_for_window(&token, &source, target.window, old_epoch, "bootstrap-one")
        .is_err());
    let current = registry
        .delegate_for_window(&token, &source, target.window, epoch, "bootstrap-one")
        .unwrap();
    assert_ne!(current, child);
    assert!(registry.key(&child, &target).is_err());
    assert!(registry.key(&current, &target).is_ok());
    assert!(registry.key(&token, &source).is_ok());
}

#[test]
fn target_release_preserves_source_siblings_and_independently_unlocked_target() {
    let mut registry = DatabaseSessions::default();
    let source = scope();
    let target = SessionScope {
        window: "detached-one",
        ..scope()
    };
    let sibling = SessionScope {
        window: "detached-two",
        ..scope()
    };
    let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
    let independent = registry.insert(&target, DatabaseKey::generate()).unwrap();
    let epoch = registry.window_epoch(source.owner, target.window).unwrap();
    let child = registry
        .delegate_for_window(&token, &source, target.window, epoch, "bootstrap-one")
        .unwrap();
    let sibling_epoch = registry.window_epoch(source.owner, sibling.window).unwrap();
    let other = registry
        .delegate_for_window(
            &token,
            &source,
            sibling.window,
            sibling_epoch,
            "bootstrap-one",
        )
        .unwrap();
    registry
        .release(
            &child,
            source.owner,
            source.profile,
            source.database,
            target.window,
        )
        .unwrap();
    assert!(registry.key(&token, &source).is_ok());
    assert!(registry.key(&other, &sibling).is_ok());
    assert!(registry.key(&independent, &target).is_ok());
    registry.revoke_window(source.owner, source.window);
    assert!(registry.key(&other, &sibling).is_err());
    assert!(registry.key(&independent, &target).is_ok());
}

#[test]
fn delegation_is_bounded_and_never_revives_a_revoked_source() {
    let mut registry = DatabaseSessions::default();
    let source = scope();
    let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
    assert!(registry
        .delegate_for_window(&token, &source, "missing", 42, "bootstrap-one")
        .is_err());
    let self_epoch = registry.window_epoch(source.owner, source.window).unwrap();
    assert!(registry
        .delegate_for_window(&token, &source, source.window, self_epoch, "bootstrap-one")
        .is_err());
    for index in 1..MAX_SESSIONS {
        let target = format!("detached-{index}");
        let epoch = registry.window_epoch(source.owner, &target).unwrap();
        registry
            .delegate_for_window(&token, &source, &target, epoch, "bootstrap-one")
            .unwrap();
    }
    let epoch = registry
        .window_epoch(source.owner, "detached-overflow")
        .unwrap();
    assert!(registry
        .delegate_for_window(&token, &source, "detached-overflow", epoch, "bootstrap-one")
        .is_err());
    let existing_epoch = registry.window_epoch(source.owner, "detached-1").unwrap();
    assert!(registry
        .delegate_for_window(
            &token,
            &source,
            "detached-1",
            existing_epoch,
            "bootstrap-one"
        )
        .is_ok());
    registry
        .release(
            &token,
            source.owner,
            source.profile,
            source.database,
            source.window,
        )
        .unwrap();
    assert!(registry.entries.is_empty());
    assert!(registry
        .delegate_for_window(&token, &source, "detached-overflow", epoch, "bootstrap-one")
        .is_err());
}

#[tokio::test]
async fn master_lock_install_and_owner_teardown_revoke_delegated_handles() {
    for removal in 0..3 {
        let state = crate::EncryptionState::new();
        let source = SessionScope {
            owner: state.database_session_owner(),
            generation: state.key_generation(),
            ..scope()
        };
        let handle = {
            let mut registry = global().lock().unwrap();
            let token = registry.insert(&source, DatabaseKey::generate()).unwrap();
            let epoch = registry.window_epoch(source.owner, "detached-one").unwrap();
            let child = registry
                .delegate_for_window(&token, &source, "detached-one", epoch, "bootstrap-one")
                .unwrap();
            registry
                .validity(
                    &child,
                    &SessionScope {
                        window: "detached-one",
                        ..source
                    },
                )
                .unwrap()
        };
        match removal {
            0 => state.lock().await,
            1 => state.install(crate::MasterDek::generate()).await,
            _ => drop(state),
        }
        assert!(!handle.is_current());
    }
}
