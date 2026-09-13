//! Vendor receipt ownership must not depend on HTTP-loop classification.
//! All traffic uses the existing synthetic CONNECT/TLS protected handler.
use super::*;

async fn private_source_with_unselected_child(
    peer: &CyclePeer,
    manager: ProxySessionManagerState,
    marked_child: bool,
) -> FixtureProxy {
    let source = open(peer, manager, ALIAS, None).await;
    assert_eq!(
        request(&source, "/no-referrer", true, "document")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    // A real successful non-root document carries an explicit no-referrer
    // header. Its vendor handoff has no root-only HTTP-cycle evidence.
    assert!(source.state.network.document_is_current(1));
    assert_eq!(
        source
            .state
            .attempt
            .as_ref()
            .unwrap()
            .root_document_sequence(),
        None
    );
    assert_eq!(
        request(&source, "/child", marked_child, "iframe")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert!(source.state.network.document_is_current(1));
    assert_eq!(source.state.document_sequence.load(Ordering::SeqCst), 2);
    source
}

#[tokio::test]
async fn noncycle_vendor_receipt_rejects_newly_selected_child_before_peek_or_consume() {
    for marked_child in [false, true] {
        let peer = cycle_peer(false).await;
        let manager = ProxySessionManager::new();
        let source =
            private_source_with_unselected_child(&peer, manager.clone(), marked_child).await;
        vendor(&source, REGIONAL).await;
        let receipt = manager
            .lock()
            .unwrap()
            .review_redirect(&source.state.session_id, None)
            .unwrap();
        assert_eq!(receipt.document_sequence, 3);
        assert_eq!(receipt.destination_url, REGIONAL);
        // Selecting an already-issued permissive child does not increment
        // the global request counter. The issuing primary must still fence it.
        assert!(source.state.network.activate_document(2).unwrap());
        assert_eq!(source.state.document_sequence.load(Ordering::SeqCst), 3);
        // Exercise consumption directly, not only a peek which discards stale
        // state as a side effect. No continuation may be issued for the child.
        assert!(manager
            .lock()
            .unwrap()
            .review_redirect(&source.state.session_id, Some(&receipt.receipt_id))
            .is_none());
        assert!(manager
            .lock()
            .unwrap()
            .review_redirect(&source.state.session_id, None)
            .is_none());
        assert!(source.state.network.activate_document(1).is_err());
        assert_eq!(
            source
                .state
                .attempt
                .as_ref()
                .unwrap()
                .take_handoff_referrer(),
            None
        );
        assert_eq!(peer.requests.lock().unwrap().len(), 2);
    }
}

#[tokio::test]
async fn unselected_child_does_not_replace_noncycle_source_privacy_policy() {
    let peer = cycle_peer(false).await;
    let manager = ProxySessionManager::new();
    let source = private_source_with_unselected_child(&peer, manager.clone(), true).await;
    vendor(&source, REGIONAL).await;
    // With the issuing primary still selected, the real receipt remains usable
    // and its captured no-referrer policy survives native stop/start.
    let target = open(&peer, manager, REGIONAL, Some(&source)).await;
    assert_eq!(
        target
            .state
            .attempt
            .as_ref()
            .unwrap()
            .take_handoff_referrer(),
        Some(None)
    );
    assert_eq!(
        target
            .state
            .attempt
            .as_ref()
            .unwrap()
            .take_handoff_referrer(),
        None
    );
    assert_eq!(peer.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn absent_or_foreign_vendor_referrer_keeps_navigation_but_suppresses_handoff_hint() {
    for referrer in [None, Some("https://other.invalid/private?do-not-forward=1")] {
        let peer = cycle_peer(false).await;
        let manager = ProxySessionManager::new();
        let source = open(&peer, manager.clone(), ALIAS, None).await;
        assert_eq!(
            request(&source, "/", true, "document")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        let request = client()
            .get(format!("{}{}", source.base, quickconnect::PATH))
            .query(&[("destination", REGIONAL)])
            .header("Host", &source.state.proxy_authority)
            .header("Sec-Fetch-Dest", "iframe")
            .header("Sec-Fetch-Mode", "navigate")
            .header("Sec-Fetch-Site", "same-origin");
        let request = if let Some(referrer) = referrer {
            request.header("Referer", referrer)
        } else {
            request
        };
        assert_eq!(request.send().await.unwrap().status(), StatusCode::ACCEPTED);
        let target = open(&peer, manager, REGIONAL, Some(&source)).await;
        assert_eq!(
            target
                .state
                .attempt
                .as_ref()
                .unwrap()
                .take_handoff_referrer(),
            Some(None)
        );
        assert_eq!(
            target
                .state
                .attempt
                .as_ref()
                .unwrap()
                .take_handoff_referrer(),
            None
        );
        // Generating/consuming the receipt did not issue a target request.
        assert_eq!(peer.requests.lock().unwrap().len(), 1);
    }
}
