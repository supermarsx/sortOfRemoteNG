//! Exercise actual native HTML capture, receipt consumption and protected
//! successor requests. No manually populated referrer hint or real endpoints.
use super::*;

const APP_REFERRER: &str = "http://localhost:3000/application/private?not-a-provider-origin=1";

fn captured_referrers(request: &str) -> Vec<&str> {
    request
        .lines()
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("referer").then_some(value.trim())
        })
        .collect()
}

#[tokio::test]
async fn consumed_source_origin_only_applies_to_first_marked_primary_and_same_operation_redirects()
{
    let peer = cycle_peer(false).await;
    let manager = ProxySessionManager::new();
    let source = open(&peer, manager.clone(), ALIAS, None).await;
    assert_eq!(
        request(&source, "/private-account", true, "document")
            .header("Referer", APP_REFERRER)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    vendor(&source, REGIONAL).await;
    let target = open(&peer, manager, REGIONAL, Some(&source)).await;
    // Child documents and XHR cannot take the pending primary-document hint.
    for (path, destination) in [("/xhr-before", "empty"), ("/child-before", "iframe")] {
        assert_eq!(
            request(&target, path, false, destination)
                .header("Referer", APP_REFERRER)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    // /auth-start performs one same-origin 307 before the foreign 303. Both
    // requests must preserve this operation's origin-only header.
    assert_eq!(
        request(&target, "/auth-start", true, "document")
            .header("Referer", APP_REFERRER)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::ACCEPTED
    );
    assert_eq!(
        request(&target, "/xhr-after", false, "empty")
            .header("Referer", APP_REFERRER)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let captured = peer.requests.lock().unwrap().clone();
    for path in ["/auth-start", "/webman/login.cgi"] {
        let wire = captured
            .iter()
            .find(|request| request.starts_with(&format!("GET {path} ")))
            .unwrap();
        assert_eq!(captured_referrers(wire), [ALIAS]);
        assert!(!captured_referrers(wire)[0].contains("private-account"));
    }
    for path in ["/xhr-before", "/child-before", "/xhr-after"] {
        let wire = captured
            .iter()
            .find(|request| request.starts_with(&format!("GET {path} ")))
            .unwrap();
        assert_eq!(captured_referrers(wire), [APP_REFERRER]);
    }
    assert_eq!(
        target
            .state
            .attempt
            .as_ref()
            .unwrap()
            .take_handoff_referrer(),
        None
    );
}

#[tokio::test]
async fn actual_source_privacy_headers_meta_and_https_downgrade_suppress_handoff_referrer() {
    for (source_path, destination) in [
        ("/no-referrer", REGIONAL),
        ("/same-origin", REGIONAL),
        ("/meta-referrer", REGIONAL),
        ("/", PLAIN_ALIAS),
    ] {
        let peer = cycle_peer(false).await;
        let manager = ProxySessionManager::new();
        let source = open(&peer, manager.clone(), ALIAS, None).await;
        assert_eq!(
            request(&source, source_path, true, "document")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        vendor(&source, destination).await;
        let target = open(&peer, manager, destination, Some(&source)).await;
        assert_eq!(
            request(&target, "/landing", true, "document")
                .header("Referer", APP_REFERRER)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        let captured = peer.requests.lock().unwrap().clone();
        let wire = captured.last().unwrap();
        assert!(
            captured_referrers(wire).is_empty(),
            "{source_path} -> {destination}"
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
    }
}
