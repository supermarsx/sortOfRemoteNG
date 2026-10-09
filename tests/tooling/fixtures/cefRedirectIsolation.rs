// Appended to the shared endpoint doubles by cefRedirectIsolation.node-test.mjs.
// Runs extracted production callbacks, not CEF. Only one test uses loopback
// sockets; its transport gate models admission and is NOT live CEF evidence.
#[cfg(test)]
mod redirect_isolation_tests {
    use super::*;
    use std::io::ErrorKind;
    use std::net::{TcpListener, TcpStream};
    use std::time::Duration;

    const DENIED: &str = "https://cdn.invalid/denied";

    fn metadata() -> (Browser, Frame) {
        let browser = Browser { valid: 1, id: 42 };
        let frame = Frame {
            valid: 1,
            main: 1,
            owner: Some(browser.clone()),
        };
        (browser, frame)
    }

    fn redirect(h: &ResourceRequestHandler, req: &mut Request, url: &mut CefString) {
        let (mut browser, mut frame) = metadata();
        h.on_resource_redirect(
            Some(&mut browser),
            Some(&mut frame),
            Some(req),
            Some(&mut Response(302)),
            Some(url),
        );
    }

    #[test]
    fn ordinary_resources_isolate_denial_and_never_revive() {
        for kind in [
            ResourceType::SCRIPT,
            ResourceType::STYLESHEET,
            ResourceType::FONT_RESOURCE,
            ResourceType::IMAGE,
            ResourceType::MEDIA,
            ResourceType::FAVICON,
            ResourceType::XHR,
            ResourceType::SUB_RESOURCE,
        ] {
            for target in [
                DENIED,
                "https://foreign.invalid/denied",
                "http://fixture.invalid/",
                "data:text/plain,denied",
                "file:///denied",
                "wss://fixture.invalid/socket",
            ] {
                let session = session();
                let permissions = engine(&[native_request_class(kind).unwrap()], true);
                let mut req = request(XML);
                req.kind = kind;
                let h = handler(
                    session.clone(),
                    permissions.clone(),
                    &req,
                    Some(SITE),
                    false,
                );
                assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
                let mut url = CefString::from(target);
                redirect(&h, &mut req, &mut url);
                assert!(!session.lock().unwrap().revoked, "{kind:?} {target}");
                assert_eq!(url.to_string(), redirect_policy::INERT_REDIRECT_TARGET);
                assert!(h.denied.load(Ordering::Acquire));
                for follow in [target, redirect_policy::INERT_REDIRECT_TARGET, XML] {
                    req.url = follow.into();
                    assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
                }
                // Restart can replace the old handler: inert URLs must fail
                // independently even without the old handler's denied flag.
                req.url = url.to_string();
                let fresh = handler(
                    session.clone(),
                    permissions.clone(),
                    &req,
                    Some(SITE),
                    false,
                );
                assert_eq!(load(&fresh, &mut req), ReturnValue::CANCEL);
                req.url = XML.into();
                let unrelated = handler(session.clone(), permissions, &req, Some(SITE), false);
                assert_eq!(load(&unrelated, &mut req), ReturnValue::CONTINUE);
                assert!(!session.lock().unwrap().revoked);
            }
        }
    }

    #[test]
    fn missing_or_unverified_callback_metadata_revokes() {
        for fault in 0..13 {
            let session = session();
            let mut req = request(XML);
            let h = handler(
                session.clone(),
                engine(&["fetch-xhr"], true),
                &req,
                Some(SITE),
                false,
            );
            let (mut browser, mut frame) = metadata();
            let mut response = Response(302);
            let mut url = CefString::from(DENIED);
            match fault {
                5 => browser.valid = 0,
                6 => browser.id = 0,
                7 => frame.valid = 0,
                8 => frame.main = 2,
                9 => frame.owner = None,
                10 => frame.owner.as_mut().unwrap().id = 43,
                11 => url.1 = false, // Failed mutable write.
                12 => url.2 = true,  // Reported success without mutation.
                _ => {}
            }
            h.on_resource_redirect(
                (fault != 0).then_some(&mut browser),
                (fault != 1).then_some(&mut frame),
                (fault != 2).then_some(&mut req),
                (fault != 3).then_some(&mut response),
                (fault != 4).then_some(&mut url),
            );
            assert!(session.lock().unwrap().revoked, "fault {fault}");
            assert_eq!(
                session.lock().unwrap().failure,
                Some(BrowserSessionFailure::RedirectDenied)
            );
            assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
        }
    }

    #[test]
    fn only_verified_redirect_responses_can_isolate() {
        for status in [0, 200, 301, 302, 303, 304, 307, 308, 404, 500] {
            let session = session();
            let mut req = request(XML);
            let h = handler(
                session.clone(),
                engine(&["fetch-xhr"], true),
                &req,
                Some(SITE),
                false,
            );
            let (mut browser, mut frame) = metadata();
            let mut url = CefString::from(DENIED);
            h.on_resource_redirect(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut req),
                Some(&mut Response(status)),
                Some(&mut url),
            );
            assert_eq!(
                !session.lock().unwrap().revoked,
                matches!(status, 301 | 302 | 303 | 307 | 308)
            );
            assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
        }
    }

    #[test]
    fn verified_main_and_subframe_redirect_denial_preserves_unrelated_requests() {
        for (kind, main) in [(ResourceType::MAIN_FRAME, 1), (ResourceType::SUB_FRAME, 0)] {
            let session = session();
            let mut req = request(XML);
            req.kind = kind;
            let h = context_resource_handler(
                session.clone(),
                7,
                engine(&["navigation", "frame"], true),
                Some(&req),
                1,
                0,
                Some(&CefString::from("null")),
                false,
                true,
                Some(&mut 0),
            );
            assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
            let (mut browser, mut frame) = metadata();
            frame.main = main;
            let mut denied = CefString::from(DENIED);
            h.on_resource_redirect(
                Some(&mut browser),
                Some(&mut frame),
                Some(&mut req),
                Some(&mut Response(302)),
                Some(&mut denied),
            );
            assert!(!session.lock().unwrap().revoked, "{kind:?}");
            assert_eq!(denied.to_string(), redirect_policy::INERT_REDIRECT_TARGET);
            for target in [DENIED, redirect_policy::INERT_REDIRECT_TARGET, XML] {
                req.url = target.into();
                assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
            }
            req.url = redirect_policy::INERT_REDIRECT_TARGET.into();
            let fresh = context_resource_handler(
                session.clone(),
                7,
                engine(&["navigation", "frame"], true),
                Some(&req),
                1,
                0,
                Some(&CefString::from("null")),
                false,
                true,
                Some(&mut 0),
            );
            assert_eq!(load(&fresh, &mut req), ReturnValue::CANCEL);
            let mut unrelated = request(XML);
            let allowed = handler(
                session.clone(),
                engine(&["fetch-xhr"], true),
                &unrelated,
                Some(SITE),
                false,
            );
            assert_eq!(load(&allowed, &mut unrelated), ReturnValue::CONTINUE);
            assert!(!session.lock().unwrap().revoked);
        }
    }

    #[test]
    fn workers_downloads_disabled_prior_denials_and_changed_metadata_revoke() {
        for fault in 0..7 {
            let session = session();
            let mut req = request(XML);
            if fault == 6 {
                req.kind = ResourceType::WORKER;
            }
            let h = context_resource_handler(
                session.clone(),
                7,
                engine(&["fetch-xhr", "worker"], true),
                Some(&req),
                0,
                i32::from(fault == 1),
                Some(&CefString::from(if fault == 3 {
                    "https://foreign.invalid"
                } else {
                    SITE
                })),
                fault == 0,
                false,
                Some(&mut i32::from(fault == 2)),
            );
            if fault == 4 {
                req.kind = ResourceType::XHR;
            }
            if fault == 5 {
                req.url = "https://foreign.invalid/changed".into();
            }
            redirect(&h, &mut req, &mut CefString::from(DENIED));
            assert!(session.lock().unwrap().revoked, "fault {fault}");
            assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
        }
    }

    #[test]
    fn frame_redirect_isolation_requires_initial_and_current_native_evidence() {
        for (kind, main) in [(ResourceType::MAIN_FRAME, 1), (ResourceType::SUB_FRAME, 0)] {
            for fault in 0..12 {
                let session = session();
                let mut req = request(XML);
                req.kind = kind;
                let h = context_resource_handler(
                    session.clone(),
                    7,
                    engine(&["navigation", "frame"], true),
                    Some(&req),
                    1,
                    i32::from(fault == 1),
                    Some(&CefString::from(SITE)),
                    fault == 2,
                    fault != 0,
                    Some(&mut i32::from(fault == 3)),
                );
                let (mut browser, mut frame) = metadata();
                frame.main = if fault == 4 { 1 - main } else { main };
                if fault == 5 {
                    frame.owner.as_mut().unwrap().id += 1;
                }
                if fault == 6 {
                    req.kind = ResourceType::SCRIPT;
                }
                let mut url = CefString::from(DENIED);
                if fault == 7 {
                    url.1 = false;
                }
                if fault == 8 {
                    url.2 = true;
                }
                h.on_resource_redirect(
                    Some(&mut browser),
                    (fault != 9).then_some(&mut frame),
                    Some(&mut req),
                    Some(&mut Response(if fault == 10 { 200 } else { 302 })),
                    (fault != 11).then_some(&mut url),
                );
                assert!(session.lock().unwrap().revoked, "{kind:?} fault {fault}");
                assert_eq!(
                    session.lock().unwrap().failure,
                    Some(BrowserSessionFailure::RedirectDenied)
                );
                assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
            }
        }
    }

    #[test]
    fn revoked_redirect_does_not_replace_first_cause_and_poison_is_native_state() {
        let session = session();
        let mut req = request(XML);
        let h = handler(
            session.clone(),
            engine(&["fetch-xhr"], true),
            &req,
            Some(SITE),
            false,
        );
        session
            .lock()
            .unwrap()
            .revoke_for(&7, BrowserSessionFailure::NativeState)
            .unwrap();
        redirect(&h, &mut req, &mut CefString::from(DENIED));
        assert_eq!(
            session.lock().unwrap().failure,
            Some(BrowserSessionFailure::NativeState)
        );
        let poisoned = super::session();
        let _ = std::panic::catch_unwind(|| {
            let _guard = poisoned.lock().unwrap();
            panic!("synthetic session poison");
        });
        assert!(lock_attempt(&poisoned, &7).is_none());
        assert_eq!(
            poisoned.lock().err().unwrap().into_inner().failure,
            Some(BrowserSessionFailure::NativeState)
        );
    }

    #[test]
    fn stale_attempt_cancels_without_revoking_its_successor() {
        let session = session();
        let mut req = request(XML);
        let h = handler(
            session.clone(),
            engine(&["fetch-xhr"], true),
            &req,
            Some(SITE),
            false,
        );
        session.lock().unwrap().identity = 8;
        redirect(&h, &mut req, &mut CefString::from(DENIED));
        assert!(h.denied.load(Ordering::Acquire));
        assert!(!session.lock().unwrap().revoked);
        assert_eq!(session.lock().unwrap().failure, None);
        assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
    }

    #[test]
    fn allowed_redirect_is_unchanged_and_resource_in_subframe_can_isolate() {
        let session = session();
        let mut req = request(XML);
        let h = handler(
            session.clone(),
            engine(&["fetch-xhr"], true),
            &req,
            Some(SITE),
            false,
        );
        let approved = "https://fixture.invalid/approved";
        let mut url = CefString::from(approved);
        redirect(&h, &mut req, &mut url);
        assert_eq!(url.to_string(), approved);
        assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
        let (mut browser, mut frame) = metadata();
        frame.main = 0;
        h.on_resource_redirect(
            Some(&mut browser),
            Some(&mut frame),
            Some(&mut req),
            Some(&mut Response(302)),
            Some(&mut CefString::from(DENIED)),
        );
        assert!(!session.lock().unwrap().revoked);
        assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
    }

    #[test]
    fn loopback_gate_sends_zero_denied_connections_while_unrelated_allowed_survives() {
        // The endpoints stand in for destinations. They intentionally do NOT
        // exercise TLS, CEF, URL parsing, or the real app proxy transport.
        let denied_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let allowed_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        denied_listener.set_nonblocking(true).unwrap();
        allowed_listener.set_nonblocking(true).unwrap();
        let session = session();
        let permissions = engine(&["fetch-xhr"], true);
        let mut req = request(XML);
        let h = handler(
            session.clone(),
            permissions.clone(),
            &req,
            Some(SITE),
            false,
        );
        let mut destination = CefString::from(DENIED);
        redirect(&h, &mut req, &mut destination);
        assert_eq!(
            destination.to_string(),
            redirect_policy::INERT_REDIRECT_TARGET
        );
        for target in [DENIED, destination.to_string().as_str()] {
            req.url = target.into();
            // No connection attempt is made unless the production callback
            // returns CONTINUE; test both old and replacement handler paths.
            let fresh = handler(
                session.clone(),
                permissions.clone(),
                &req,
                Some(SITE),
                false,
            );
            for candidate in [&h, &fresh] {
                if load(candidate, &mut req) == ReturnValue::CONTINUE {
                    TcpStream::connect_timeout(
                        &denied_listener.local_addr().unwrap(),
                        Duration::from_secs(1),
                    )
                    .unwrap();
                }
            }
        }
        assert_eq!(
            denied_listener.accept().unwrap_err().kind(),
            ErrorKind::WouldBlock
        );
        req.url = XML.into();
        let allowed = handler(session.clone(), permissions, &req, Some(SITE), false);
        assert_eq!(load(&allowed, &mut req), ReturnValue::CONTINUE);
        TcpStream::connect_timeout(
            &allowed_listener.local_addr().unwrap(),
            Duration::from_secs(1),
        )
        .unwrap();
        assert!(allowed_listener.accept().is_ok());
        assert!(!session.lock().unwrap().revoked);
    }
}
