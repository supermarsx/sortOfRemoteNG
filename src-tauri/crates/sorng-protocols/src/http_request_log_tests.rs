use super::{ProxyRequestLogEntry, ProxySessionManager};

fn entry(index: usize) -> ProxyRequestLogEntry {
    ProxyRequestLogEntry {
        id: String::new(),
        session_id: "fixture".into(),
        method: "GET".into(),
        url: format!("https://fixture.example.test/{index}"),
        status: 200,
        error: None,
        timestamp: "2026-01-01T00:00:00Z".into(),
    }
}

#[test]
fn retains_newest_ten_thousand_with_stable_unique_ids() {
    let manager = ProxySessionManager::new();
    let mut manager = manager.lock().unwrap();
    for i in 0..10_500 {
        manager.record_request(entry(i));
    }
    let newest = manager.request_log_newest_first();
    assert_eq!(newest.len(), 10_000);
    assert_eq!(newest[0].url, "https://fixture.example.test/10499");
    assert_eq!(newest[9999].url, "https://fixture.example.test/500");
    assert_eq!(
        newest
            .iter()
            .map(|entry| &entry.id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        10_000
    );
    manager.record_request(entry(10_500));
    assert_eq!(manager.request_log_newest_first()[1].id, newest[0].id);
}

#[test]
fn shrink_disable_reenable_and_invalid_settings_are_atomic() {
    let manager = ProxySessionManager::new();
    let mut manager = manager.lock().unwrap();
    for i in 0..8 {
        manager.record_request(entry(i));
    }
    assert_eq!(manager.set_request_log_capacity(3).unwrap(), 3);
    assert_eq!(
        manager
            .request_log_newest_first()
            .iter()
            .map(|entry| entry.url.rsplit('/').next().unwrap())
            .collect::<Vec<_>>(),
        ["7", "6", "5"]
    );
    assert!(manager.set_request_log_capacity(100_001).is_err());
    manager.record_request(entry(8));
    assert_eq!(manager.request_log.len(), 3);
    assert_eq!(manager.set_request_log_capacity(0).unwrap(), 0);
    manager.record_request(entry(9));
    assert!(manager.request_log.is_empty());
    manager.set_request_log_capacity(100_000).unwrap();
    manager.record_request(entry(10));
    assert_eq!(manager.request_log.len(), 1);
    assert_eq!(
        manager.request_log_newest_first()[0].url,
        "https://fixture.example.test/10"
    );
}
