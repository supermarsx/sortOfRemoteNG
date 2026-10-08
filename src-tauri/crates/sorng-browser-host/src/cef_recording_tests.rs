// Exercise the actual CEF resource handler with library-owned test vtables.
// No browser, network destination, desktop capture, or engine initialization.
mod recording_observer_tests {
    use super::*;
    struct Owner(BrowserIdentity, AtomicBool);
    impl recording::RecordingOwner for Owner {
        fn current(&self, identity: &BrowserIdentity) -> bool {
            identity == &self.0 && self.1.load(Ordering::Acquire)
        }
    }

    #[tokio::test]
    async fn native_recording_observes_native_worker_completion_and_preserves_admission() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        for permitted in [true, false] {
            let (session, identity) = session().await;
            report_synthetic_ready(&mut session.lock().unwrap(), &identity);
            let owner = Arc::new(Owner(identity.clone(), AtomicBool::new(true)));
            let record = recording::Recording::start(&identity, owner.clone()).unwrap();
            let session = Arc::new(session);
            let mut request = navigation_mocks::request(ResourceType::XHR);
            let mut response = navigation_mocks::response();
            let (mut callback, calls) = navigation_mocks::callback();
            let mut disabled = 0;
            let permissions = if permitted {
                Arc::new(allow_classes(&[WebsiteRequestClass::FetchXhr]))
            } else {
                deny_permissions()
            };
            let handler = context_resource_handler(
                session,
                identity.clone(),
                permissions,
                Some(&request),
                0,
                0,
                Some(&CefString::from("https://fixture.invalid")),
                true,
                false,
                Some(&mut disabled),
            );
            assert_eq!(
                handler.on_before_resource_load(
                    None,
                    None,
                    Some(&mut request),
                    Some(&mut callback)
                ),
                if permitted {
                    ReturnValue::CONTINUE
                } else {
                    ReturnValue::CANCEL
                }
            );
            handler.on_resource_load_complete(
                None,
                None,
                Some(&mut request),
                Some(&mut response),
                UrlrequestStatus::SUCCESS,
                321,
            );
            assert_eq!(calls.load(Ordering::Relaxed), 0);
            assert_eq!(disabled, i32::from(!permitted));
            record.stop().unwrap();
            let data = record.export().unwrap();
            assert_eq!(data.entries.len(), usize::from(permitted));
            if permitted {
                assert_eq!(data.entries[0].url, "https://fixture.invalid/");
                assert_eq!(data.entries[0].received_body_bytes, 321);
            }
            recording::discard(&identity);
        }
    }

    #[tokio::test]
    async fn native_recording_late_cef_callback_after_owner_lock_cannot_export() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let (session, identity) = session().await;
        report_synthetic_ready(&mut session.lock().unwrap(), &identity);
        let owner = Arc::new(Owner(identity.clone(), AtomicBool::new(true)));
        let record = recording::Recording::start(&identity, owner.clone()).unwrap();
        let mut request = navigation_mocks::request(ResourceType::XHR);
        let (mut callback, _) = navigation_mocks::callback();
        let mut disabled = 0;
        let handler = context_resource_handler(
            Arc::new(session),
            identity.clone(),
            Arc::new(allow_classes(&[WebsiteRequestClass::FetchXhr])),
            Some(&request),
            0,
            0,
            Some(&CefString::from("https://fixture.invalid")),
            true,
            false,
            Some(&mut disabled),
        );
        assert_eq!(
            handler.on_before_resource_load(None, None, Some(&mut request), Some(&mut callback)),
            ReturnValue::CONTINUE
        );
        owner.1.store(false, Ordering::Release);
        handler.on_resource_load_complete(
            None,
            None,
            Some(&mut request),
            None,
            UrlrequestStatus::CANCELED,
            100,
        );
        assert!(matches!(
            record.export(),
            Err(recording::RecordingError::OwnerUnavailable)
        ));
        assert!(recording::find(&identity).is_none());
        recording::discard(&identity);
    }
}
