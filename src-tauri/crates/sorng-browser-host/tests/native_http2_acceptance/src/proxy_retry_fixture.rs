//! Isolated same-process retry comparison. No forced browser error, account or
//! external network; any observed -130 is recorded rather than synthesized.
use super::*;
use sha1::Digest;
use sorng_browser_host::domain_permissions::WebsiteNetworkPolicy;

struct Live {
    slot: Slot,
    permissions: Arc<WebsitePermissionEngine>,
    closing: bool,
    page_baseline: usize,
    socket_baseline: usize,
    before_context: serde_json::Value,
}

fn permissions(broad: bool) -> Result<Arc<WebsitePermissionEngine>> {
    let own = [
        WebsiteRequestClass::Navigation,
        WebsiteRequestClass::Script,
        WebsiteRequestClass::ImageMedia,
        WebsiteRequestClass::FetchXhr,
        WebsiteRequestClass::Websocket,
    ]
    .into_iter()
    .map(|class| (class, WebsitePermissionDecision::Allow))
    .collect();
    let policy = WebsiteNetworkPolicy {
        source_origin: ORIGIN.into(),
        destination_defaults: [(ORIGIN.into(), own)].into_iter().collect(),
        resource_domain_defaults: Vec::new(),
        allow_all_requests: broad,
        allow_all_scripts: broad,
        https_only: true,
        same_origin_only: false,
        allow_http_downgrade: false,
    };
    let engine = WebsitePermissionEngine::new(None, None, &Default::default())?
        .with_network_policy(policy)?;
    if engine.permits_network_origin(ORIGIN, OTHER_ORIGIN) != broad {
        return Err("fixture policy switch did not change effective permission".into());
    }
    Ok(Arc::new(engine))
}

fn live(slot: Slot, broad: bool) -> Result<Live> {
    let before_context = serde_json::json!(slot.session.lock().unwrap().proxy_diagnostics());
    Ok(Live {
        before_context,
        slot,
        permissions: permissions(broad)?,
        closing: false,
        page_baseline: 0,
        socket_baseline: 0,
    })
}

fn counts(slot: &Slot) -> (usize, usize) {
    let rows = slot.requests.lock().unwrap();
    (
        rows.iter()
            .filter(|r| {
                r["path"]
                    .as_str()
                    .is_some_and(|p| p.split('?').next() == Some("/case-0"))
            })
            .count(),
        rows.iter().filter(|r| r["path"] == "/wss-ok").count(),
    )
}

fn complete(unit: &Live) -> bool {
    let (pages, sockets) = counts(&unit.slot);
    pages > unit.page_baseline
        && sockets > unit.socket_baseline
        && unit.slot.sink.0.lock().unwrap().loaded
        && unit
            .slot
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|r| r["websocket"] == true)
}

fn credentials(slot: &Slot) -> Result<Vec<u8>> {
    slot.session
        .lock()
        .unwrap()
        .with_proxy_credentials(|username, password| {
            let mut digest = sha1::Sha1::new();
            digest.update(username.as_bytes());
            digest.update([0]);
            digest.update(password.as_bytes());
            digest.finalize().to_vec()
        })
        .ok_or_else(|| "fixture proxy credentials unavailable".into())
}

fn global(runtime: &CefRuntime<'_>, checks: &mut usize) -> Result {
    if !runtime.network_policy_configured()? {
        return Err("global deny policy is not configured".into());
    }
    *checks += 1;
    Ok(())
}

fn checked_pump(runtime: &CefRuntime<'_>, checks: &mut usize) -> Result {
    global(runtime, checks)?;
    runtime.work()?;
    global(runtime, checks)
}

fn navigate(unit: &mut Live, phase: usize) -> Result {
    let (pages, sockets) = counts(&unit.slot);
    unit.page_baseline = pages;
    unit.socket_baseline = sockets;
    unit.slot.sink.0.lock().unwrap().loaded = false;
    unit.slot
        .host
        .as_ref()
        .ok_or("fixture host unavailable")?
        .navigate(
            &unit.slot.identity,
            &format!("{ORIGIN}/case-0?permission-phase={phase}"),
        )?;
    Ok(())
}

fn close(unit: &mut Live) -> Result {
    if !unit.closing {
        unit.closing = true;
        unit.slot.tls_owner.current.store(false, Ordering::Release);
        unit.slot
            .session
            .lock()
            .unwrap()
            .revoke(&unit.slot.identity)?;
        if let Some(host) = &unit.slot.host {
            host.close(&unit.slot.identity)?;
        }
    }
    Ok(())
}

fn closed(unit: &Live) -> bool {
    unit.slot
        .host
        .as_ref()
        .is_none_or(|h| h.lifecycle() == Lifecycle::Closed)
}

fn release(unit: &mut Live, asynchronous: &tokio::runtime::Runtime) -> Result {
    drop(unit.slot.host.take());
    drop(unit.slot.context.take());
    asynchronous.block_on(unit.slot.session.lock().unwrap().stop())?;
    if let Some(stop) = unit.slot.stop.take() {
        let _ = stop.send(());
    }
    if let Some(server) = unit.slot.server.take() {
        asynchronous.block_on(server)??;
    }
    Ok(())
}

pub(super) fn execute(
    bootstrap: &mut dyn RuntimeBootstrap,
    paths: &BundlePaths,
    requested: &'static str,
) -> Result {
    let legacy = requested == LEGACY_PATCH_ID;
    if !legacy && !requires_retirement(requested) {
        return Err("proxy retry requires exact revision one, four or five".into());
    }
    if !legacy && std::env::var("SORNG_CEF_HTTP2_EXPECT").as_deref() != Ok("retirement") {
        return Err("proxy retry requires explicit legacy or retirement pin".into());
    }
    let output = PathBuf::from(std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT").ok_or("output")?);
    if !output.is_absolute() || !output.is_dir() || std::fs::read_dir(&output)?.next().is_some() {
        return Err("fresh output required".into());
    }
    let run_id = std::env::var("SORNG_CEF_ACCEPTANCE_RUN_ID")?;
    let clock = Instant::now();
    let asynchronous = tokio::runtime::Runtime::new()?;
    let _entered = asynchronous.enter();
    let (root_der, leaf_der, acceptor) = certificates()?;
    let ids = Arc::new(AtomicUsize::new(0));
    let mut units = vec![
        live(
            create_slot(0, "tab-0", &asynchronous, clock, &acceptor, &ids, true)?,
            false,
        )?,
        live(
            create_slot(1, "tab-1", &asynchronous, clock, &acceptor, &ids, true)?,
            false,
        )?,
    ];
    let original_a = units[0].slot.identity.clone();
    let original_b = units[1].slot.identity.clone();
    let b_endpoint = units[1].slot.session.lock().unwrap().proxy_endpoint();
    let b_credentials = credentials(&units[1].slot)?;
    let mut all_endpoints = units
        .iter()
        .map(|u| u.slot.session.lock().unwrap().proxy_endpoint())
        .collect::<Vec<_>>();
    let mut all_credentials = units
        .iter()
        .map(|u| credentials(&u.slot))
        .collect::<Result<Vec<_>>>()?;
    let mut events = EventLoop::new();
    let parent = Arc::new(
        WindowBuilder::new()
            .with_title("Isolated permission replacement fixture")
            .with_visible(false)
            .build(&events)?,
    );
    let mut settings = cef_runtime::native_settings(&paths.helper, &paths.resources)?;
    settings.root_cache_path = CefString::from(output.join("profile").to_str().ok_or("profile")?);
    settings.log_file = CefString::from(output.join("cef.log").to_str().ok_or("log")?);
    let wake = events.create_proxy();
    let runtime = unsafe {
        CefRuntime::initialize(
            bootstrap,
            &settings,
            Arc::new(move || {
                wake.send_event(())
                    .map_err(|_| cef_runtime::WakeUnavailable)
            }),
            Arc::new(|_| {}),
        )?
    };
    let bridge = unsafe { NativeTlsBridge::from_loaded(requested)? };
    let clean = cef::command_line_get_global().is_some_and(|command| {
        [
            "no-sandbox",
            "disable-web-security",
            "ignore-certificate-errors",
            "ignore-certificate-errors-spki-list",
            "allow-insecure-localhost",
            "proxy-server",
        ]
        .into_iter()
        .all(|name| command.has_switch(Some(&CefString::from(name))) == 0)
    });
    if !clean {
        return Err("unsafe switches in permission fixture".into());
    }
    let mut phase = 0;
    let mut checks = 0;
    let mut snapshots = Vec::new();
    let mut failures = Vec::new();
    let mut initialized = false;
    let mut replacing = false;
    let mut done = false;
    let mut same_row_fresh_attempt = false;
    let mut initial_proxy_failures = Vec::new();
    let mut late_old_cleanup = false;
    events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(1));
        if !matches!(event, Event::MainEventsCleared) { return; }
        let step = (|| -> Result {
            if !initialized {
                runtime.work()?;
                initialized = runtime.network_policy_configured()?;
                if !initialized { return Ok(()); }
            }
            checked_pump(&runtime, &mut checks)?;
            cef_tls_bridge::pump_tls()?;
            for unit in &mut units {
                let pending = std::mem::take(&mut *unit.slot.tls_owner.pending.lock().unwrap());
                for (e, completion, _) in pending {
                    let exact = !unit.closing && unit.slot.tls_owner.current.load(Ordering::Acquire)
                        && e.hostname == "proxy-first.fixture.test" && e.port == 443 && e.origin == ORIGIN
                        && e.ca_mode == NativeTlsCaMode::CustomOnly && e.native_error == 0
                        && e.certificate_status == 0 && !e.fatal_error && e.peer_chain.first() == Some(&leaf_der);
                    if exact { unit.slot.tls_owner.admitted.store(true, Ordering::Release); }
                    completion.complete(if exact { NativeTlsDecision::AdmitNative } else { NativeTlsDecision::Deny });
                }
                if unit.closing { continue; }
                if unit.slot.context.is_none() && unit.slot.host.is_none() {
                    global(&runtime, &mut checks)?;
                    unit.slot.context = Some(unsafe { PrivateRequestContext::create_with_tls_capabilities(
                        unit.slot.session.clone(), unit.slot.identity.clone(), unit.permissions.clone(), &bridge,
                        &NativeTlsConfig { ca_mode: NativeTlsCaMode::CustomOnly, trust_anchors: vec![root_der.clone()], require_scoped_exceptions: false },
                        unit.slot.tls_owner.clone(), sorng_browser_host::native_capabilities::NativeBrowserCapabilities::default(),
                    )? });
                    global(&runtime, &mut checks)?;
                }
                if let Some(context) = &unit.slot.context {
                    match context.status() {
                        PreparationStatus::Failed(_) | PreparationStatus::Revoked => return Err("churn context failed".into()),
                        PreparationStatus::ProxyConfigured => {
                            if !legacy && !context.proxy_application_verified() { return Err("retry actual proxy proof missing".into()); }
                            unit.slot.proxy_application_verified = context.proxy_application_verified();
                            unit.slot.proxy_before_host = serde_json::json!(unit.slot.session.lock().unwrap().proxy_diagnostics());
                            unit.slot.proxy_before_host["upstreamDials"] = serde_json::json!(unit.slot.dials.load(Ordering::Relaxed));
                            unit.slot.host = Some(unsafe { CefBrowserHost::create_owned_engineering_probe(
                                parent.clone(), unit.slot.context.take().unwrap(), unit.slot.session.clone(),
                                unit.slot.identity.clone(), ViewportBounds::new(0., 0., 640., 480.)?, parent.scale_factor(),
                                unit.slot.sink.clone(), Some(unit.slot.sink.clone()),
                            )? });
                            global(&runtime, &mut checks)?;
                        }
                        _ => (),
                    }
                }
                if let Some(host) = &unit.slot.host {
                    if !unit.slot.navigated && host.features_ready(&unit.slot.identity)? {
                        let mut session = unit.slot.session.lock().unwrap();
                        let ready = NativeHostReadiness::Ready { profile_key: session.policy().profile_key().into(), proxy_endpoint: session.proxy_endpoint() };
                        session.report_host(&unit.slot.identity, ready)?;
                        drop(session);
                        navigate(unit, phase)?;
                        unit.slot.navigated = true;
                    }
                }
            }
            if units[1].slot.identity != original_b
                || units[1].slot.session.lock().unwrap().proxy_endpoint() != b_endpoint
                || credentials(&units[1].slot)? != b_credentials
                || !units[1].slot.tls_owner.current.load(Ordering::Acquire) {
                return Err("survivor ownership or transport changed".into());
            }
            let first_proxy_failed = units[0].slot.sink.0.lock().unwrap().errors.contains(&-130);
            if phase == 0 && (complete(&units[0]) || first_proxy_failed) && complete(&units[1]) {
                initial_proxy_failures = units.iter().map(|u| u.slot.sink.0.lock().unwrap().errors.clone()).collect::<Vec<_>>();
                snapshots.push(serde_json::json!({"phase":"before-change","globalPolicy":true,"survivorIdentityAndEndpointUnchanged":true,"survivorCounts":counts(&units[1].slot)}));
                close(&mut units[0])?;
                replacing = true;
                global(&runtime, &mut checks)?;
                navigate(&mut units[1], 1)?;
                phase = 1;
            } else if phase == 1 && closed(&units[0]) && complete(&units[1]) {
                global(&runtime, &mut checks)?;
                let replacement = live(create_slot(2, "tab-0", &asynchronous, clock, &acceptor, &ids, true)?, true)?;
                same_row_fresh_attempt = replacement.slot.identity != original_a
                    && replacement.slot.identity.owner_database_id() == original_a.owner_database_id()
                    && replacement.slot.identity.connection_id() == original_a.connection_id()
                    && replacement.slot.identity.session_id() == original_a.session_id();
                for unit in [replacement, live(create_slot(3, "tab-3", &asynchronous, clock, &acceptor, &ids, true)?, false)?] {
                    all_endpoints.push(unit.slot.session.lock().unwrap().proxy_endpoint());
                    all_credentials.push(credentials(&unit.slot)?);
                    units.push(unit);
                }
                snapshots.push(serde_json::json!({"phase":"after-old-close-before-new-contexts","globalPolicy":true,"survivorIdentityAndEndpointUnchanged":true,"survivorCounts":counts(&units[1].slot)}));
                navigate(&mut units[1], 2)?;
                phase = 2;
            } else if phase == 2 && units.iter().skip(1).all(complete) {
                // The old stopped attempt is released only AFTER its fresh
                // successor has loaded. Its cleanup must not close A2 or B.
                release(&mut units[0], &asynchronous)?;
                late_old_cleanup = true;
                snapshots.push(serde_json::json!({"phase":"fresh-contexts-operational","globalPolicy":true,"survivorIdentityAndEndpointUnchanged":true,"survivorCounts":counts(&units[1].slot)}));
                navigate(&mut units[1], 3)?;
                navigate(&mut units[2], 3)?;
                phase = 3;
            } else if phase == 3 && complete(&units[1]) && complete(&units[2]) {
                snapshots.push(serde_json::json!({"phase":"after-change","globalPolicy":true,"survivorIdentityAndEndpointUnchanged":true,"survivorCounts":counts(&units[1].slot)}));
                done = true;
                *flow = ControlFlow::Exit;
            }
            if clock.elapsed() > Duration::from_secs(50) { return Err("permission churn deadline".into()); }
            Ok(())
        })();
        if let Err(error) = step {
            failures.push(format!("phase-{phase}: {error}"));
            *flow = ControlFlow::Exit;
        }
    });
    for unit in &mut units {
        close(unit)?;
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while !units.iter().all(closed) && Instant::now() < deadline {
        let work = if failures.is_empty() {
            checked_pump(&runtime, &mut checks)
        } else {
            runtime.cleanup_only_work().map_err(Into::into)
        };
        if let Err(error) = work {
            failures.push(format!("close: {error}"));
        }
        cef_tls_bridge::pump_tls()?;
        std::thread::sleep(Duration::from_millis(1));
    }
    let all_closed = units.iter().all(closed);
    let distinct_endpoints = all_endpoints
        .iter()
        .enumerate()
        .all(|(i, x)| !all_endpoints[..i].contains(x));
    let distinct_credentials = all_credentials
        .iter()
        .enumerate()
        .all(|(i, x)| !all_credentials[..i].contains(x));
    let before_admission_zero = units.iter().all(|u| {
        u.slot
            .tls_owner
            .before_admission_bytes
            .load(Ordering::Relaxed)
            == 0
    });
    let proofs = units
        .iter()
        .map(|u| u.slot.proxy_application_verified)
        .collect::<Vec<_>>();
    let proxy_ack_clean = !legacy
        && units.iter().all(|unit| {
            let after = &unit.slot.proxy_before_host;
            let delta = |field: &str| {
                after[field]
                    .as_u64()
                    .zip(unit.before_context[field].as_u64())
                    .and_then(|(a, b)| a.checked_sub(b))
            };
            unit.slot.proxy_application_verified
                && delta("acceptedConnections")
                    .zip(delta("authenticationChallenges"))
                    .is_some_and(|(accepted, challenged)| accepted >= challenged)
                && after["authenticatedRequests"] == 0
                && unit.before_context["authenticatedRequests"] == 0
                && after["upstreamDials"] == 0
                && after["upstreamFailures"] == 0
                && delta("requestRejections") == Some(0)
                && delta("capacityRefusals") == Some(0)
        });
    let boundary_port = units[0]
        .slot
        .session
        .lock()
        .unwrap()
        .proxy_endpoint()
        .port();
    let contexts = units
        .iter()
        .map(|unit| {
            serde_json::json!({
                "errors": unit.slot.sink.0.lock().unwrap().errors,
                "beforeContext": unit.before_context,
                "beforeHost": unit.slot.proxy_before_host,
                "anonymousPendingConnectionsAtSnapshot": unit.slot.proxy_before_host["acceptedConnections"].as_u64()
                    .zip(unit.before_context["acceptedConnections"].as_u64()).and_then(|(a,b)| a.checked_sub(b))
                    .zip(unit.slot.proxy_before_host["authenticationChallenges"].as_u64()
                        .zip(unit.before_context["authenticationChallenges"].as_u64()).and_then(|(a,b)| a.checked_sub(b)))
                    .and_then(|(accepted, challenged)| accepted.checked_sub(challenged)),
                "counts": counts(&unit.slot),
                "relay": unit.slot.session.lock().unwrap().proxy_diagnostics(),
                "alpn": *unit.slot.alpn_observed.lock().unwrap(),
            })
        })
        .collect::<Vec<_>>();
    let mut report = serde_json::json!({"probeKind":"native-owned-proxy-retry","runId":run_id,"patchId":bridge.patch_id(),"loadedBridgeVerified":true,"productionTlsFactory":true,"check":"proxy-retry","expectedProtocol":if legacy {"http/1.1"} else {"h2"},"proxyProofRequired":!legacy,"proxyAckNoApplicationNetwork":proxy_ack_clean,"mode":"proxy-retry","ok":false,"clean":clean,
        "initialProxyFailures":initial_proxy_failures,"contexts":contexts,"forcedError":false,"oldCleanupAfterSuccessorLoad":late_old_cleanup,
        "preHostObservation":"Anonymous loopback proxy TCP may be pending; no authenticated or upstream requests are allowed",
        "globalPolicyChecks":checks,"phases":snapshots,"replacedOldContext":replacing,"sameRowFreshAttempt":same_row_fresh_attempt,
        "distinctEndpoints":distinct_endpoints,"distinctCredentials":distinct_credentials,"actualProxyProofs":proofs,
        "beforeAdmissionBytesZero":before_admission_zero,"closed":all_closed,"failures":failures,"productionReady":false});
    std::fs::write(
        output.join("native-report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    if !all_closed {
        std::process::exit(3);
    }
    for unit in &mut units {
        release(unit, &asynchronous)?;
    }
    if failures.is_empty() {
        if let Err(error) = global(&runtime, &mut checks) {
            failures.push(format!("after-release: {error}"));
        }
    }
    if !legacy {
        let proxy_boundary = proxy_ack_fixture::run(
            &mut || {
                registry_retirement_fixture::pump(&runtime, &mut events)?;
                global(&runtime, &mut checks)
            },
            boundary_port,
        );
        report["proxyBoundaryCases"] = match proxy_boundary {
            Ok(value) => value,
            Err(error) => {
                failures.push(format!("proxy-boundary: {error}"));
                serde_json::json!({"ok":false})
            }
        };
        let retirement = registry_retirement_fixture::run(
            &mut || {
                registry_retirement_fixture::pump(&runtime, &mut events)?;
                global(&runtime, &mut checks)
            },
            &root_der,
        );
        report["registrationRetirementCases"] = match retirement {
            Ok(value) => value,
            Err(error) => {
                failures.push(format!("registry-retirement: {error}"));
                serde_json::json!({"ok":false})
            }
        };
    }
    if !legacy && !proxy_ack_clean {
        failures.push("retry pre-host proxy counters changed".into());
    }
    report["globalPolicyChecks"] = checks.into();
    report["failures"] = serde_json::json!(failures);
    unsafe {
        runtime.shutdown()?;
        cef_tls_bridge::after_cef_shutdown();
        proxy_ack_fixture::after_shutdown();
        registry_retirement_fixture::after_shutdown();
    }
    report["shutdownComplete"] = true.into();
    report["ok"] = (done
        && failures.is_empty()
        && same_row_fresh_attempt
        && distinct_endpoints
        && distinct_credentials
        && before_admission_zero
        && proofs.len() == 4
        && late_old_cleanup
        && proofs.iter().all(|v| *v != legacy))
    .into();
    std::fs::write(
        output.join("native-report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    if report["ok"] == true {
        Ok(())
    } else {
        Err("permission replacement acceptance failed".into())
    }
}
