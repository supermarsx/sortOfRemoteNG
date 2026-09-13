//! Real managed envelopes with synthetic password/OS-vault slots and profile.
use super::*;
use sorng_encryption::artifact_policy::{self, PolicyDocument, ProtectionMode};

#[tokio::test]
async fn documents_need_either_managed_or_global_encryption_but_never_both() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    for mode in ["database-only", "both", "plaintext-override"] {
        for protector in ["password", "os-vault"] {
            let (root, state, data) = fixture().await;
            if mode != "database-only" {
                state.install(sorng_encryption::MasterDek::generate()).await;
            }
            let vault = FakeVault::default();
            let target = if protector == "password" {
                password_target("aes-256-gcm")
            } else {
                serde_json::from_value(json!({"dataCipher":"aes-256-gcm","keepSlotIds":[],"newSlots":[{"type":"os-vault","label":"Synthetic OS vault"}]})).unwrap()
            };
            let protected = change_inner(
                root.path(),
                &state,
                "main",
                "db",
                "r0",
                data.clone(),
                None,
                Some(data.clone()),
                Some(target),
                false,
                protector == "os-vault",
                &vault,
            )
            .await
            .unwrap();
            if mode == "plaintext-override" {
                let policy = PolicyDocument::default()
                    .with_mode(
                        sorng_encryption::ArtifactKind::Connections,
                        ProtectionMode::Plaintext,
                    )
                    .unwrap();
                std::fs::write(
                    root.path().join(artifact_policy::POLICY_FILENAME),
                    artifact_policy::encode(&state, &policy).await.unwrap(),
                )
                .unwrap();
                artifact_policy::refresh(&state).await;
            }
            let mut private = data.clone();
            private["documents"] = json!({"version":1,"revision":1,"documents":[{"body":"SYNTHETIC_DOCUMENT_PRIVATE"}],"attachments":[],"people":[],"tickets":[]});
            save_inner(
                root.path(),
                &state,
                "main",
                "db",
                protected.session_id.as_deref().unwrap(),
                &protected.security_revision,
                private.clone(),
                Some(data),
            )
            .await
            .unwrap();
            let status = status_inner(root.path(), &state, "main", "db")
                .await
                .unwrap();
            assert_eq!(status.kind, "managed");
            assert!(status.unlocked);
            assert_eq!(status.global_encryption_protected, mode == "both");
            let path = root.path().join("databases/db.json");
            let before = std::fs::read(&path).unwrap();
            assert!(!String::from_utf8_lossy(&before).contains("SYNTHETIC_DOCUMENT_PRIVATE"));
            let snapshot = managed_snapshot(root.path(), &state, "db").await.unwrap();
            // Native session owner/window and compare-and-swap fences remain.
            assert!(save_inner(
                root.path(),
                &state,
                "other-window",
                "db",
                protected.session_id.as_deref().unwrap(),
                &protected.security_revision,
                private.clone(),
                Some(private.clone())
            )
            .await
            .is_err());
            assert!(change_inner(
                root.path(),
                &state,
                "main",
                "db",
                "stale-revision",
                snapshot.data.clone(),
                protected.session_id.clone(),
                None,
                None,
                true,
                false,
                &vault
            )
            .await
            .is_err());
            assert_eq!(std::fs::read(&path).unwrap(), before);
            let removed = change_inner(
                root.path(),
                &state,
                "main",
                "db",
                &protected.security_revision,
                snapshot.data,
                protected.session_id.clone(),
                None,
                None,
                true,
                false,
                &vault,
            )
            .await;
            if mode == "both" {
                let result = removed.unwrap();
                assert!(result.committed);
                assert!(result.session_id.is_none());
                let status = status_inner(root.path(), &state, "main", "db")
                    .await
                    .unwrap();
                assert_eq!(status.kind, "none");
                assert!(status.unlocked && status.global_encryption_protected);
                assert_eq!(
                    managed_snapshot(root.path(), &state, "db")
                        .await
                        .unwrap()
                        .data,
                    private
                );
                assert!(!String::from_utf8_lossy(&std::fs::read(&path).unwrap())
                    .contains("SYNTHETIC_DOCUMENT_PRIVATE"));
                // Retired inner unlock sessions cannot keep writing after change.
                assert!(save_inner(
                    root.path(),
                    &state,
                    "main",
                    "db",
                    protected.session_id.as_deref().unwrap(),
                    &protected.security_revision,
                    private.clone(),
                    Some(private.clone())
                )
                .await
                .is_err());
                state.lock().await;
                assert!(managed_snapshot(root.path(), &state, "db").await.is_err());
            } else {
                let error = removed.err().expect("last layer cannot be removed");
                assert!(error.contains("protected documents"));
                assert!(!error.contains("SYNTHETIC_DOCUMENT_PRIVATE"));
                assert_eq!(std::fs::read(&path).unwrap(), before);
            }
        }
    }
}
