use super::*;
use crate::http::network::ProxyNetworkState;

const ALIAS: &str = "https://example.quickconnect.to/";
const REGIONAL: &str = "https://example.fr3.quickconnect.to/";

fn document(source: &AttemptSession, policy: Option<&'static str>) -> Arc<ProxyNetworkState> {
    let network = Arc::new(ProxyNetworkState::default());
    network.document_issued(1, true);
    let mut headers = HeaderMap::new();
    if let Some(policy) = policy {
        headers.insert("referrer-policy", HeaderValue::from_static(policy));
    }
    network.record_document_referrer(1, &headers, "<html><head></head></html>");
    source.bind_referrer_document(&network);
    network
}

#[test]
fn consumed_handoff_referrer_is_immutable_one_use_and_generation_bound() {
    let mut registry = AttemptRegistry::default();
    let source = start(&mut registry, &config(ALIAS), "source");
    assert_eq!(source.take_handoff_referrer(), None);
    let network = document(&source, None);
    let token = registry
        .prepare_transfer(&source, &Url::parse(REGIONAL).unwrap(), "receipt")
        .unwrap();
    // Native ticket freezes the decision, not a reference to mutable page policy.
    network.record_document_referrer(
        1,
        &HeaderMap::new(),
        "<meta name=referrer content=no-referrer>",
    );
    registry.stop(&source, Some(&token)).unwrap();
    let mut next = config(REGIONAL);
    next.continuation_id = Some(token.clone());
    let target = start(&mut registry, &next, "target");
    assert_eq!(source.take_handoff_referrer(), None);
    assert_eq!(target.take_handoff_referrer(), Some(Some(ALIAS.into())));
    assert_eq!(target.take_handoff_referrer(), None);
    assert!(registry
        .start(&next, &Url::parse(REGIONAL).unwrap(), "replay")
        .is_err());
    let stale = target.clone();
    registry.stop(&target, None).unwrap();
    assert_eq!(stale.take_handoff_referrer(), None);
}

#[test]
fn missing_policy_private_policy_and_downgrade_only_issue_suppressed_hint() {
    for (policy, destination, bind) in [
        (None, REGIONAL, false),
        (Some("no-referrer"), REGIONAL, true),
        (Some("same-origin"), REGIONAL, true),
        (Some("unsafe-url"), "http://example.quickconnect.to/", true),
    ] {
        let mut registry = AttemptRegistry::default();
        let source = start(&mut registry, &config(ALIAS), "source");
        let _network = bind.then(|| document(&source, policy));
        let target = transfer(&mut registry, &source, destination, "target");
        assert_eq!(target.take_handoff_referrer(), Some(None));
    }
}

#[test]
fn transfer_document_selection_and_document_guarded_cookie_access_do_not_deadlock() {
    // Exercise the production document -> attempt ordering concurrently. A
    // timeout fails this regression without blocking the whole test process.
    for _ in 0..16 {
        let mut registry = AttemptRegistry::default();
        let source = start(&mut registry, &config(ALIAS), "source");
        let network = document(&source, None);
        network.document_issued(2, false);
        network.record_document_referrer(2, &HeaderMap::new(), "");
        let barrier = Arc::new(std::sync::Barrier::new(4));
        let (done, completed) = std::sync::mpsc::channel();
        let mut threads = Vec::new();
        {
            let (barrier, done, source, network) = (
                barrier.clone(),
                done.clone(),
                source.clone(),
                network.clone(),
            );
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                let _ = network.with_current_document(1, || {
                    source.provider_control_cookie_header(
                        "example",
                        &Url::parse("https://global.quickconnect.to/Serv.php").unwrap(),
                    )
                });
                done.send(()).unwrap();
            }));
        }
        {
            let (barrier, done, network) = (barrier.clone(), done.clone(), network.clone());
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                network.activate_document(2).unwrap();
                done.send(()).unwrap();
            }));
        }
        {
            let (barrier, done) = (barrier.clone(), done.clone());
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                registry
                    .prepare_transfer(&source, &Url::parse(REGIONAL).unwrap(), "receipt")
                    .unwrap();
                done.send(()).unwrap();
            }));
        }
        barrier.wait();
        for _ in 0..3 {
            completed
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("document selection, cookie access and transfer must complete");
        }
        for thread in threads {
            thread.join().unwrap();
        }
    }
}

#[test]
fn issuer_document_change_refuses_ticket_and_stale_consumer_cannot_take_hint() {
    let mut registry = AttemptRegistry::default();
    let source = start(&mut registry, &config(ALIAS), "source");
    let network = document(&source, Some("no-referrer"));
    let issuer = network.selected_document_sequence().unwrap();
    network.document_issued(2, false);
    network.record_document_referrer(2, &HeaderMap::new(), "");
    network.activate_document(2).unwrap();
    assert!(registry
        .prepare_transfer_with_referrer_suppressed(
            &source,
            &Url::parse(REGIONAL).unwrap(),
            "old-receipt",
            false,
            Some(issuer)
        )
        .is_err());
    assert!(registry.tickets.is_empty());
    let target = transfer(&mut registry, &source, REGIONAL, "target");
    let destination = document(&target, None);
    destination.document_issued(2, false);
    destination.activate_document(2).unwrap();
    assert!(destination
        .with_current_document(1, || target.take_handoff_referrer())
        .is_err());
    assert_eq!(
        destination
            .with_current_document(2, || target.take_handoff_referrer())
            .unwrap(),
        Some(Some(ALIAS.into()))
    );
    assert_eq!(target.take_handoff_referrer(), None);
}
