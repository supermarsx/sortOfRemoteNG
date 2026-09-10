use super::{login_responses, method, ok, Nas};
use crate::{
    error::{SynologyError, SynologyErrorKind},
    instances::SynologyInstances,
    scoped_files::FileStationLogin,
};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::Notify;

async fn login(registry: &SynologyInstances, instance: &str, request: &str, nas: &Nas) -> String {
    match registry
        .connect(instance, request, nas.config())
        .await
        .unwrap()
    {
        FileStationLogin::Connected { session_id, .. } => session_id,
        _ => panic!("fixture must connect"),
    }
}
#[tokio::test]
async fn independent_nas_receipts_never_fall_back_or_retarget_admin_and_files() {
    let mut a = login_responses(false);
    a.push(ok(json!({"files":[],"offset":0,"total":11})));
    let mut b = login_responses(false);
    b.push(ok(json!({"files":[],"offset":0,"total":22})));
    let (a, b) = (Nas::start(a).await, Nas::start(b).await);
    let registry = SynologyInstances::new();
    let (aid, bid) = tokio::join!(
        login(&registry, "instance-a", "login-a", &a),
        login(&registry, "instance-b", "login-b", &b)
    );
    assert_ne!(aid, bid);
    for (instance, receipt, nas, total) in
        [("instance-a", &aid, &a, 11), ("instance-b", &bid, &b, 22)]
    {
        let service = registry
            .resolve(Some(instance), Some(receipt))
            .await
            .unwrap();
        assert_eq!(service.get_config().unwrap().port, nas.port);
        let result = service
            .fs_list(receipt, Some("/share"), 0, 100, "name", "asc")
            .await;
        assert_eq!(service.finish(result).unwrap().total, total);
    }
    assert!(registry
        .resolve(Some("instance-a"), Some(&bid))
        .await
        .is_err());
    assert!(registry.resolve(Some("unknown"), Some(&aid)).await.is_err());
    assert!(registry.resolve(Some("instance-a"), None).await.is_err());
    assert!(registry.resolve(None, Some(&aid)).await.is_err());
    assert!(!registry.resolve(None, None).await.unwrap().is_connected());
    assert_eq!(a.requests().len(), 4);
    assert_eq!(b.requests().len(), 4);
}
#[tokio::test]
async fn blocked_login_does_not_block_other_nas_and_cancelled_authenticated_candidate_logs_out() {
    for pause_at in [2, 3] {
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let mut responses = login_responses(false);
        if pause_at == 2 {
            responses.remove(2);
        }
        responses.push(ok(json!({})));
        let a = Nas::start_paused(
            responses,
            Some((pause_at, entered.clone(), release.clone())),
        )
        .await;
        let b = Nas::start(login_responses(false)).await;
        let registry = Arc::new(SynologyInstances::new());
        let captured = registry.clone();
        let config = a.config();
        let pending =
            tokio::spawn(async move { captured.connect("instance-a", "request-a", config).await });
        entered.notified().await;
        let bid = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            login(&registry, "instance-b", "request-b", &b),
        )
        .await
        .unwrap();
        assert!(!registry
            .cancel_connect("instance-a", "wrong-request")
            .unwrap());
        assert!(registry.cancel_connect("instance-a", "request-a").unwrap());
        release.notify_one();
        assert!(pending.await.unwrap().unwrap_err().contains("cancelled"));
        assert_eq!(a.requests().last().map(method).as_deref(), Some("logout"));
        assert!(registry
            .resolve(Some("instance-b"), Some(&bid))
            .await
            .is_ok());
    }
}
#[tokio::test]
async fn replacing_one_instance_revokes_old_transfer_and_late_receipt_but_not_other_nas() {
    let a = Nas::start(login_responses(false)).await;
    let b = Nas::start(login_responses(false)).await;
    let replacement = Nas::start(login_responses(false)).await;
    let registry = SynologyInstances::new();
    let aid = login(&registry, "a", "a1", &a).await;
    let bid = login(&registry, "b", "b1", &b).await;
    let old = registry.resolve(Some("a"), Some(&aid)).await.unwrap();
    let transfer = old.fs_transfer_context(&aid).unwrap();
    drop(old);
    let newer = login(&registry, "a", "a2", &replacement).await;
    assert!(!registry.disconnect("a", &aid).unwrap());
    assert!(registry.resolve(Some("a"), Some(&aid)).await.is_err());
    assert!(registry.resolve(Some("a"), Some(&newer)).await.is_ok());
    assert!(registry.resolve(Some("b"), Some(&bid)).await.is_ok());
    let error = transfer
        .upload_selected(std::path::Path::new("not-a-real-file"), "/share", None)
        .await
        .unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::SessionExpired));
}
#[tokio::test]
async fn disconnect_revokes_before_waiting_for_admin_and_rejects_its_late_result() {
    let nas = Nas::start(login_responses(false)).await;
    let registry = SynologyInstances::new();
    let receipt = login(&registry, "a", "request", &nas).await;
    let held = registry.resolve(Some("a"), Some(&receipt)).await.unwrap();
    assert!(registry.disconnect("a", &receipt).unwrap());
    assert!(held.finish(Ok("late private result")).is_err());
    assert!(!registry.disconnect("a", &receipt).unwrap());
    drop(held);
    assert!(registry.resolve(Some("a"), Some(&receipt)).await.is_err());
}
#[tokio::test]
async fn invalid_session_response_revokes_only_its_named_receipt_and_legacy_can_reconnect() {
    let nas = Nas::start(login_responses(false)).await;
    let registry = SynologyInstances::new();
    let receipt = login(&registry, "a", "request", &nas).await;
    let held = registry.resolve(Some("a"), Some(&receipt)).await.unwrap();
    let result: Result<(), _> = Err(SynologyError::from_dsm_code(119, "SYNO.Core.System"));
    assert!(held.finish(result).is_err());
    drop(held);
    assert!(registry.resolve(Some("a"), Some(&receipt)).await.is_err());
    let legacy = registry.resolve(None, None).await.unwrap();
    assert!(legacy
        .finish::<()>(Err(SynologyError::session_expired("expired")))
        .is_err());
    drop(legacy);
    assert!(registry.resolve(None, None).await.is_ok());
}
#[tokio::test]
async fn stale_login_completion_cannot_publish_over_a_newer_attempt() {
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let mut responses = login_responses(false);
    responses.push(ok(json!({})));
    let old = Nas::start_paused(responses, Some((3, entered.clone(), release.clone()))).await;
    let new = Nas::start(login_responses(false)).await;
    let registry = Arc::new(SynologyInstances::new());
    let captured = registry.clone();
    let config = old.config();
    let pending = tokio::spawn(async move { captured.connect("same", "old", config).await });
    entered.notified().await;
    let receipt = login(&registry, "same", "new", &new).await;
    release.notify_one();
    assert!(pending.await.unwrap().is_err());
    let service = registry
        .resolve(Some("same"), Some(&receipt))
        .await
        .unwrap();
    assert_eq!(service.get_config().unwrap().port, new.port);
}
#[test]
fn common_errors_are_not_misclassified_as_authentication_challenges() {
    for code in [117, 118] {
        assert!(matches!(
            SynologyError::from_dsm_code(code, "SYNO.API.Auth").kind,
            SynologyErrorKind::SystemBusy
        ));
    }
    assert!(matches!(
        SynologyError::from_dsm_code(115, "SYNO.FileStation.Upload").kind,
        SynologyErrorKind::PermissionDenied
    ));
    for code in [119, 150] {
        assert!(matches!(
            SynologyError::from_dsm_code(code, "SYNO.Core.System").kind,
            SynologyErrorKind::SessionExpired
        ));
    }
    assert!(matches!(
        SynologyError::from_dsm_code(403, "SYNO.API.Auth").kind,
        SynologyErrorKind::TwoFactorRequired
    ));
    assert!(matches!(
        SynologyError::from_dsm_code(403, "SYNO.FileStation.List").kind,
        SynologyErrorKind::ApiError(403)
    ));
}
