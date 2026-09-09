use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

fn fixture() -> (tempfile::TempDir, TrustRuntime, ForceDeleteContext) {
    static OWNER: AtomicU64 = AtomicU64::new(10000);
    let root = tempfile::tempdir().unwrap();
    let databases = root.path().join("databases");
    std::fs::create_dir(&databases).unwrap();
    std::fs::write(
        root.path().join(LEGACY_TRUST_FILE),
        b"opaque malformed secret\0\xff",
    )
    .unwrap();
    std::fs::write(
        root.path().join(format!("{LEGACY_TRUST_FILE}.bak")),
        b"previous encrypted bytes",
    )
    .unwrap();
    std::fs::write(
        databases.join("active.trust.json"),
        b"live database trust must survive",
    )
    .unwrap();
    let rt = TrustRuntime {
        databases_dir: databases,
        app_dir: root.path().into(),
        enc_state: None,
        active: RwLock::new(None),
        io: std::sync::Mutex::new(()),
    };
    rt.set_active(Some("active".into()), None).unwrap();
    (
        root,
        rt,
        ForceDeleteContext {
            owner: OWNER.fetch_add(1, Ordering::Relaxed),
            generation: 0,
            window: "force-test".into(),
        },
    )
}
fn remove(path: &Path) -> Result<(), String> {
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[test]
fn force_bypasses_only_coverage_preserves_exact_bytes_and_active_database() {
    let (root, rt, context) = fixture();
    assert!(rt.delete_legacy_stores().is_err());
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    let originals: Vec<_> = preview
        .files
        .iter()
        .map(|f| {
            (
                f.name.clone(),
                std::fs::read(root.path().join(&f.name)).unwrap(),
            )
        })
        .collect();
    let result = rt
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .unwrap();
    assert!(result.completed);
    assert_eq!(result.removed_files.len(), 2);
    assert_eq!(result.preserved_files, result.removed_files);
    let recovery = PathBuf::from(result.recovery_path.unwrap());
    for (name, bytes) in originals {
        assert_eq!(std::fs::read(recovery.join(&name)).unwrap(), bytes);
        assert!(!root.path().join(name).exists());
    }
    assert!(recovery.join("inventory.json").is_file());
    assert_eq!(rt.active_database_id().as_deref(), Some("active"));
    assert_eq!(
        std::fs::read(rt.databases_dir.join("active.trust.json")).unwrap(),
        b"live database trust must survive"
    );
    assert!(rt.force_inventory().unwrap().is_empty()); // Quarantine is not an import source.
    assert!(rt
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .is_err());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&recovery).unwrap().permissions().mode() & 0o077,
            0
        );
        assert_eq!(
            std::fs::metadata(recovery.join(LEGACY_TRUST_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o077,
            0
        );
    }
}

#[test]
fn force_review_is_expiring_cancelable_one_use_and_bound_to_full_native_scope() {
    let (root, rt, context) = fixture();
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    assert!(rt
        .force_delete_legacy(&context, &preview.token, "yes")
        .is_err());
    for other in [
        ForceDeleteContext {
            window: "other".into(),
            ..context.clone()
        },
        ForceDeleteContext {
            owner: context.owner + 100,
            ..context.clone()
        },
        ForceDeleteContext {
            generation: 1,
            ..context.clone()
        },
    ] {
        assert!(rt
            .force_delete_legacy(&other, &preview.token, CONFIRMATION)
            .is_err());
        if other.window != context.window || other.owner != context.owner {
            assert!(!rt
                .cancel_force_delete_legacy(&other, &preview.token)
                .unwrap());
        }
    }
    let (_another_root, another, _) = fixture();
    assert!(another
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .is_err());
    assert!(rt
        .cancel_force_delete_legacy(&context, &preview.token)
        .unwrap());
    assert!(rt
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .is_err());
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    previews()
        .lock()
        .unwrap()
        .get_mut(&preview.token)
        .unwrap()
        .deadline = Instant::now() - Duration::from_secs(1);
    assert!(rt
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .unwrap_err()
        .contains("expired"));
    assert!(root.path().join(LEGACY_TRUST_FILE).exists());
}

#[test]
fn force_refuses_inventory_drift_unknown_siblings_and_directory_targets() {
    let (root, rt, context) = fixture();
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    std::fs::write(root.path().join(LEGACY_TRUST_FILE), b"changed").unwrap();
    assert!(rt
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .is_err());
    assert!(!root.path().join(QUARANTINE).exists());
    let unknown = root.path().join(format!("{LEGACY_TRUST_FILE}.unexpected"));
    std::fs::write(&unknown, b"unknown").unwrap();
    assert!(rt.preview_force_delete_legacy(context.clone()).is_err());
    std::fs::remove_file(unknown).unwrap();
    std::fs::create_dir(root.path().join(LEGACY_RDP_TRUST_FILE)).unwrap();
    assert!(rt.preview_force_delete_legacy(context).is_err());
}

#[test]
fn force_preservation_failure_never_removes_any_original() {
    let (root, rt, context) = fixture();
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    let result = rt
        .force_delete_checked(
            &context,
            &preview.token,
            CONFIRMATION,
            |path| {
                if path.file_name().unwrap() == format!("{LEGACY_TRUST_FILE}.bak").as_str() {
                    Err("injected preservation failure".into())
                } else {
                    Ok(())
                }
            },
            |_| {},
            remove,
            sync_parent,
        )
        .unwrap();
    assert!(!result.completed);
    assert!(result.removed_files.is_empty());
    assert_eq!(result.preserved_files.len(), 1);
    for file in preview.files {
        assert!(root.path().join(file.name).exists());
    }
}

#[test]
fn force_rechecks_all_recovery_bytes_and_manifest_before_first_deletion() {
    for corrupt in [LEGACY_TRUST_FILE, "inventory.json"] {
        let (root, rt, context) = fixture();
        let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
        let result = rt
            .force_delete_checked(
                &context,
                &preview.token,
                CONFIRMATION,
                |_| Ok(()),
                |recovery| std::fs::write(recovery.join(corrupt), b"changed").unwrap(),
                remove,
                sync_parent,
            )
            .unwrap();
        assert!(!result.completed);
        assert!(result.removed_files.is_empty());
        assert!(result.preserved_files.is_empty());
        assert!(!result.errors.is_empty());
        assert!(root.path().join(LEGACY_TRUST_FILE).exists());
    }
}

#[test]
fn force_source_drift_after_preservation_retains_all_sources() {
    let (root, rt, context) = fixture();
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    let result = rt
        .force_delete_checked(
            &context,
            &preview.token,
            CONFIRMATION,
            |_| Ok(()),
            |_| std::fs::write(root.path().join(LEGACY_TRUST_FILE), b"new decision").unwrap(),
            remove,
            sync_parent,
        )
        .unwrap();
    assert_eq!(result.preserved_files.len(), 2);
    assert!(result.removed_files.is_empty());
    assert!(!result.completed);
}

#[test]
fn force_partial_remove_and_post_remove_sync_errors_report_actual_removals() {
    for sync_failure in [false, true] {
        let (root, rt, context) = fixture();
        let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
        let result = rt
            .force_delete_checked(
                &context,
                &preview.token,
                CONFIRMATION,
                |_| Ok(()),
                |_| {},
                |path| {
                    if !sync_failure
                        && path.file_name().unwrap() == format!("{LEGACY_TRUST_FILE}.bak").as_str()
                    {
                        Err("injected remove failure".into())
                    } else {
                        remove(path)
                    }
                },
                |_| {
                    if sync_failure {
                        Err("injected sync failure".into())
                    } else {
                        Ok(())
                    }
                },
            )
            .unwrap();
        assert!(!result.completed);
        assert_eq!(result.removed_files, vec![LEGACY_TRUST_FILE]);
        assert_eq!(result.preserved_files.len(), 2);
        assert!(!root.path().join(LEGACY_TRUST_FILE).exists());
        assert!(root
            .path()
            .join(format!("{LEGACY_TRUST_FILE}.bak"))
            .exists());
    }
}

#[cfg(unix)]
#[test]
fn force_ignores_unrelated_non_utf8_names_but_rejects_links() {
    use std::os::unix::{ffi::OsStringExt, fs::symlink};
    let (root, rt, context) = fixture();
    std::fs::write(
        root.path().join(std::ffi::OsString::from_vec(vec![0xff])),
        b"unrelated",
    )
    .unwrap();
    assert!(rt.preview_force_delete_legacy(context.clone()).is_ok());
    symlink(
        root.path().join(LEGACY_TRUST_FILE),
        root.path().join(LEGACY_RDP_TRUST_FILE),
    )
    .unwrap();
    assert!(rt.preview_force_delete_legacy(context).is_err());
}

#[tokio::test]
async fn force_rechecks_live_generation_and_global_lock_under_coordinator() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (root, mut rt, _) = fixture();
    let state = Arc::new(EncryptionState::new());
    state.install(sorng_encryption::MasterDek::generate()).await;
    rt.enc_state = Some(state.clone());
    let context = ForceDeleteContext {
        owner: state.database_session_owner(),
        generation: state.key_generation(),
        window: "guard-test".into(),
    };
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    state.install(sorng_encryption::MasterDek::generate()).await;
    assert!(rt
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .unwrap_err()
        .contains("session changed"));
    assert!(rt.preview_force_delete_legacy(context.clone()).is_err());
    let context = ForceDeleteContext {
        generation: state.key_generation(),
        ..context
    };
    let preview = rt.preview_force_delete_legacy(context.clone()).unwrap();
    state.lock().await;
    let context = ForceDeleteContext {
        generation: state.key_generation(),
        ..context
    };
    assert!(rt.preview_force_delete_legacy(context.clone()).is_err());
    assert!(rt
        .force_delete_legacy(&context, &preview.token, CONFIRMATION)
        .is_err());
    assert!(root.path().join(LEGACY_TRUST_FILE).exists());
    assert!(!root.path().join(QUARANTINE).exists());
}
