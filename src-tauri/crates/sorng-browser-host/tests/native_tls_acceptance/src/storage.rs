//! Same-origin storage measurements through the production patched TLS factory.
//! Fixture-only; uses no saved app identities, profile, sign-in or credentials.
use super::*;
use serde_json::{json, Value};
use std::path::Path;
use tao::window::Window;

const NAMES: [&str; 3] = ["storage-a", "storage-b", "storage-a-reconnect"];
const PLAN: &str = include_str!("../../native_acceptance/fixtures/storage-plan.json");

pub(super) struct Evidence {
    current: Option<usize>,
    document_cookies: Option<Value>,
    proofs: Vec<Value>,
    protocol_errors: usize,
}
impl Evidence {
    fn new() -> Self {
        Self {
            current: None,
            document_cookies: None,
            proofs: vec![],
            protocol_errors: 0,
        }
    }
}
fn plan() -> Vec<Value> {
    serde_json::from_str(PLAN).expect("checked fixed storage plan")
}
fn marker(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Null) => Value::Null,
        Some(Value::String(s)) if ["a-one", "a-two", "a-three", "b-one"].contains(&s.as_str()) => {
            json!(s)
        }
        _ => json!("unexpected-or-missing"),
    }
}
fn cookie(header: &str, name: &str) -> Value {
    let values: Vec<_> = header
        .lines()
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("cookie"))
        .flat_map(|(_, value)| value.split(';'))
        .filter_map(|part| part.trim().split_once('='))
        .filter(|(key, _)| *key == name)
        .map(|(_, value)| value)
        .collect();
    match values.as_slice() {
        [] => Value::Null,
        [value] => marker(Some(&json!(value))),
        _ => json!("duplicate"),
    }
}
fn snapshot(value: &Value) -> Value {
    json!({"cookie":marker(value.get("cookie")),"localStorage":marker(value.get("localStorage")),"indexedDb":marker(value.get("indexedDb"))})
}

/// Called by the TLS fixture AFTER its per-socket ledger accounts for bytes.
/// Expected values stay native-side; pages receive only the next fixed write.
pub(super) fn response(
    state: &State,
    path: &str,
    header: &str,
    body: &[u8],
) -> Option<(String, String)> {
    let evidence = state.storage.as_ref()?;
    if !path.starts_with("/storage-") {
        return None;
    }
    let mut evidence = evidence.lock().unwrap();
    let steps = plan();
    let Some(index) = evidence.current else {
        evidence.protocol_errors += 1;
        return Some(("{}".into(), String::new()));
    };
    let step = &steps[index];
    let name = step["name"].as_str().unwrap();
    let slot = step["slot"].as_u64().unwrap() as usize;
    if NAMES[slot] != state.name {
        evidence.protocol_errors += 1;
        return Some(("{}".into(), String::new()));
    }
    if path == format!("/storage-page/{name}") && evidence.document_cookies.is_none() {
        evidence.document_cookies = Some(
            json!({"native":cookie(header,"isolation_native"),"script":cookie(header,"isolation_script")}),
        );
        let config = json!({"name":name,"write":step["write"]});
        return Some((
            include_str!("../../native_acceptance/fixtures/storage.html")
                .replace("__STORAGE_CONFIG__", &config.to_string()),
            String::new(),
        ));
    }
    if path == format!("/storage-cookie/{name}") && evidence.document_cookies.is_some() {
        if let Some(write) = step["write"].as_str() {
            return Some(("{}".into(), format!("Set-Cookie: isolation_native={write}; Secure; HttpOnly; SameSite=Strict; Path=/\r\n")));
        }
    }
    if path == format!("/storage-proof/{name}")
        && evidence.document_cookies.is_some()
        && evidence.proofs.len() == index
    {
        let proof: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
        let before = snapshot(&proof["before"]);
        let after = snapshot(&proof["after"]);
        let sent = json!({"native":cookie(header,"isolation_native"),"script":cookie(header,"isolation_script")});
        let initial = evidence.document_cookies.clone().unwrap();
        let passed = proof["ok"] == true
            && proof["step"] == name
            && proof["origin"] == ORIGIN
            && proof["secure"] == true
            && proof["top"] == true
            && proof["tauriAbsent"] == true
            && proof["httpOnlyHidden"] == true
            && ["cookie", "localStorage", "indexedDb"]
                .iter()
                .all(|key| before[*key] == step["before"] && after[*key] == step["after"])
            && ["native", "script"]
                .iter()
                .all(|key| initial[*key] == step["before"] && sent[*key] == step["after"]);
        evidence.proofs.push(json!({"name":name,"slot":slot,"before":before,"after":after,
            "initialCookies":initial,"sentCookies":sent,"passed":passed,
            "originExact":proof["origin"]==ORIGIN,"secure":proof["secure"]==true,"top":proof["top"]==true,
            "tauriAbsent":proof["tauriAbsent"]==true,"httpOnlyHidden":proof["httpOnlyHidden"]==true}));
        return Some(("{}".into(), String::new()));
    }
    evidence.protocol_errors += 1;
    Some(("{}".into(), String::new()))
}

struct Attempt {
    identity: BrowserIdentity,
    session: Arc<Mutex<OriginBrowserSession>>,
    state: Arc<Mutex<State>>,
    hooks: Arc<Hooks>,
    fixture: Option<fixture::Fixture>,
    context: Option<PrivateRequestContext>,
    browser: Option<CefBrowserHost<'static>>,
    ready: bool,
    installed: bool,
}
impl Attempt {
    fn new(
        slot: usize,
        evidence: Arc<Mutex<Evidence>>,
        certificates: Arc<fixture::Certificates>,
        asynchronous: &tokio::runtime::Runtime,
    ) -> Result<Self> {
        let mut state = State::new(NAMES[slot]);
        state.storage = Some(evidence);
        let state = Arc::new(Mutex::new(state));
        let fixture =
            asynchronous.block_on(fixture::Fixture::start(certificates, state.clone()))?;
        let address = fixture.address;
        let observed = state.clone();
        let dialer: Arc<dyn RouteDialer> = Arc::new(move |authority: Authority| -> DialFuture {
            let observed = observed.clone();
            Box::pin(async move {
                {
                    let mut state = observed.lock().unwrap();
                    state.route_dials += 1;
                    if authority.host() != "accounts.google.com" || authority.port() != 443 {
                        state.unexpected_route = true;
                        return Err(std::io::Error::other("fixture-only route"));
                    }
                }
                Ok(Box::new(tokio::net::TcpStream::connect(address).await?) as BoxedStream)
            })
        });
        // Reconnect keeps the database, connection and session IDs; policy.new
        // supplies a fresh attempt. Distinct connection B shares the SAME origin.
        let connection = if slot == 1 {
            "connection-b"
        } else {
            "connection-a"
        };
        let policy = OriginBrowserPolicy::new("storage-fixture", connection, connection, ORIGIN)?;
        let identity = policy.identity().clone();
        let session = Arc::new(Mutex::new(asynchronous.block_on(
            OriginBrowserSession::start(policy, dialer, ProxyLimits::default()),
        )?));
        let hooks = Arc::new(Hooks {
            state: state.clone(),
            identity: identity.clone(),
            current: AtomicBool::new(true),
        });
        Ok(Self {
            identity,
            session,
            state,
            hooks,
            fixture: Some(fixture),
            context: None,
            browser: None,
            ready: false,
            installed: false,
        })
    }
    fn advance(
        &mut self,
        runtime: &CefRuntime<'_>,
        bridge: &NativeTlsBridge,
        certificates: &fixture::Certificates,
        parent: &Arc<Window>,
    ) -> Result<bool> {
        if self.context.is_none() && self.browser.is_none() {
            if !runtime.network_policy_configured()? {
                return Ok(false);
            }
            let defaults = [
                "navigation",
                "frame",
                "script",
                "stylesheet",
                "image-media",
                "font",
                "fetch-xhr",
                "websocket",
            ]
            .into_iter()
            .filter_map(|name| {
                WebsiteRequestClass::parse(name)
                    .map(|class| (class, WebsitePermissionDecision::Allow))
            })
            .collect();
            let permissions = Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?);
            self.context = Some(unsafe {
                PrivateRequestContext::create_with_tls(
                    self.session.clone(),
                    self.identity.clone(),
                    permissions,
                    bridge,
                    &NativeTlsConfig {
                        ca_mode: NativeTlsCaMode::CustomOnly,
                        trust_anchors: vec![certificates.root.clone()],
                        require_scoped_exceptions: false,
                    },
                    self.hooks.clone(),
                )?
            });
        }
        if let Some(context) = &self.context {
            match context.status() {
                PreparationStatus::Failed(_) | PreparationStatus::Revoked => {
                    return Err("storage TLS context preparation failed".into())
                }
                PreparationStatus::ProxyConfigured => {
                    self.installed = context.tls_hooks_installed();
                    if !self.installed {
                        return Err("storage TLS factory installation unacknowledged".into());
                    }
                    self.browser = Some(unsafe {
                        CefBrowserHost::create_owned_engineering_probe(
                            parent.clone(),
                            self.context.take().unwrap(),
                            self.session.clone(),
                            self.identity.clone(),
                            ViewportBounds::new(0., 0., 800., 600.)?,
                            parent.scale_factor(),
                            self.hooks.clone(),
                            Some(self.hooks.clone()),
                        )?
                    });
                }
                _ => {}
            }
        }
        if let Some(browser) = &self.browser {
            if !self.ready && browser.features_ready(&self.identity)? {
                let mut session = self.session.lock().unwrap();
                let ready = NativeHostReadiness::Ready {
                    profile_key: session.policy().profile_key().into(),
                    proxy_endpoint: session.proxy_endpoint(),
                };
                session.report_host(&self.identity, ready)?;
                self.ready = true;
            }
        }
        decide(&self.state, certificates, &self.session, &self.identity)?;
        Ok(self.live())
    }
    fn live(&self) -> bool {
        self.ready
            && self
                .browser
                .as_ref()
                .is_some_and(|b| matches!(b.lifecycle(), Lifecycle::Attached | Lifecycle::Hidden))
    }
}

fn pump(
    events: &mut EventLoop<()>,
    runtime: &CefRuntime<'_>,
    limit: Duration,
    mut step: impl FnMut() -> Result<bool>,
) -> Result {
    let started = Instant::now();
    let mut result = Ok(());
    events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(5));
        if !matches!(event, Event::MainEventsCleared) {
            return;
        }
        let tick = (|| -> Result<bool> {
            runtime.work()?;
            cef_tls_bridge::pump_tls()?;
            if started.elapsed() > limit {
                return Err("storage native phase deadline".into());
            }
            step()
        })();
        match tick {
            Ok(true) => *flow = ControlFlow::Exit,
            Ok(false) => {}
            Err(error) => {
                result = Err(error);
                *flow = ControlFlow::Exit;
            }
        }
    });
    result
}

/// Revocation is observed while the renderer still exists; then wait for
/// OnBeforeClose, drop native owners, stop the relay and drain fixture tasks.
fn close(
    attempt: &mut Attempt,
    events: &mut EventLoop<()>,
    runtime: &CefRuntime<'_>,
    certificates: &fixture::Certificates,
    asynchronous: &tokio::runtime::Runtime,
) -> Result<Value> {
    {
        let mut state = attempt.state.lock().unwrap();
        state.revoked = true;
        attempt.session.lock().unwrap().revoke(&attempt.identity)?;
    }
    attempt.hooks.current.store(false, Ordering::Release);
    let rejected = attempt.browser.as_ref().is_some_and(|browser| {
        browser
            .navigate(&attempt.identity, &format!("{ORIGIN}/pulse"))
            .is_err()
    });
    let revoked = Instant::now();
    let mut close_sent = false;
    pump(events, runtime, Duration::from_secs(6), || {
        decide(
            &attempt.state,
            certificates,
            &attempt.session,
            &attempt.identity,
        )?;
        if revoked.elapsed() < Duration::from_millis(750) {
            return Ok(false);
        }
        if let Some(browser) = &attempt.browser {
            if !close_sent {
                if browser.lifecycle() != Lifecycle::Closed {
                    browser.close(&attempt.identity)?;
                }
                close_sent = true;
            }
            Ok(browser.lifecycle() == Lifecycle::Closed)
        } else {
            Ok(true)
        }
    })?;
    let closed = attempt
        .browser
        .as_ref()
        .is_some_and(|b| b.lifecycle() == Lifecycle::Closed);
    attempt.state.lock().unwrap().revoke_observed_ms = revoked.elapsed().as_millis();
    drop(attempt.browser.take());
    drop(attempt.context.take());
    cef_tls_bridge::pump_tls()?;
    asynchronous.block_on(attempt.session.lock().unwrap().stop())?;
    if let Some(fixture) = attempt.fixture.take() {
        asynchronous.block_on(fixture.stop())?;
    }
    let mut report = attempt
        .state
        .lock()
        .unwrap()
        .report(attempt.installed, closed, rejected);
    report["relayStopped"] = true.into();
    Ok(report)
}

fn checkpoint(output: &Path, report: &mut Value, evidence: &Arc<Mutex<Evidence>>) -> Result {
    let evidence = evidence.lock().unwrap();
    report["steps"] = json!(evidence.proofs);
    report["protocolErrors"] = json!(evidence.protocol_errors);
    std::fs::write(
        output.join("storage-progress.json"),
        serde_json::to_vec_pretty(report)?,
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run(
    runtime: &CefRuntime<'_>,
    bridge: &NativeTlsBridge,
    certificates: Arc<fixture::Certificates>,
    asynchronous: &tokio::runtime::Runtime,
    events: &mut EventLoop<()>,
    parent: Arc<Window>,
    output: &Path,
    run_id: &str,
) -> Result<Value> {
    let evidence = Arc::new(Mutex::new(Evidence::new()));
    let mut report = json!({"schema":1,"status":"running","runId":run_id,"origin":ORIGIN,
        "factory":"production-create-with-tls","productionReady":false,"publicProviderAcceptance":false,
        "identities":null,"steps":[],"contexts":[],"protocolErrors":0,"failures":[],
        "limits":["ephemeral contexts only; no retained-cookie import","A reconnect measured; B reconnect not run","no app IPC or saved database authority","not a disk-erasure or public-provider test"]});
    let mut attempts: Vec<Option<Attempt>> = (0..3).map(|_| None).collect();
    let started = Instant::now();
    checkpoint(output, &mut report, &evidence)?;
    let probes = (|| -> Result {
        attempts[0] = Some(Attempt::new(
            0,
            evidence.clone(),
            certificates.clone(),
            asynchronous,
        )?);
        attempts[1] = Some(Attempt::new(
            1,
            evidence.clone(),
            certificates.clone(),
            asynchronous,
        )?);
        for (index, step) in plan().iter().enumerate() {
            if started.elapsed() > Duration::from_secs(100) {
                return Err("storage overall deadline".into());
            }
            if index == 8 {
                pump(events, runtime, Duration::from_secs(8), || {
                    for slot in [0, 1] {
                        attempts[slot].as_mut().unwrap().advance(
                            runtime,
                            bridge,
                            &certificates,
                            &parent,
                        )?;
                    }
                    Ok(attempts[0]
                        .as_ref()
                        .unwrap()
                        .state
                        .lock()
                        .unwrap()
                        .pulse_requests
                        > 0)
                })?;
                let closed = close(
                    attempts[0].as_mut().unwrap(),
                    events,
                    runtime,
                    &certificates,
                    asynchronous,
                )?;
                report["contexts"].as_array_mut().unwrap().push(closed);
                // Retain the identity for reconnect comparison but never reuse
                // its native browser, context, proxy or request-context handle.
            }
            if index == 9 {
                attempts[2] = Some(Attempt::new(
                    2,
                    evidence.clone(),
                    certificates.clone(),
                    asynchronous,
                )?);
                let a = &attempts[0].as_ref().unwrap().identity;
                let b = &attempts[1].as_ref().unwrap().identity;
                let next = &attempts[2].as_ref().unwrap().identity;
                report["identities"] = json!({"sameOwner":a.owner_database_id()==b.owner_database_id(),
                    "distinctConnections":a.connection_id()!=b.connection_id(),
                    "reconnectSameOwner":a.owner_database_id()==next.owner_database_id(),
                    "reconnectSameConnection":a.connection_id()==next.connection_id(),
                    "reconnectSameSession":a.session_id()==next.session_id(),
                    "freshAttempts":a.attempt_id()!=b.attempt_id() && a.attempt_id()!=next.attempt_id() && b.attempt_id()!=next.attempt_id()});
            }
            let slots: &[usize] = if index < 8 {
                &[0, 1]
            } else if index == 8 {
                &[1]
            } else {
                &[1, 2]
            };
            pump(events, runtime, Duration::from_secs(12), || {
                let mut ready = true;
                for &slot in slots {
                    ready &= attempts[slot].as_mut().unwrap().advance(
                        runtime,
                        bridge,
                        &certificates,
                        &parent,
                    )?;
                }
                Ok(ready)
            })?;
            {
                let mut evidence = evidence.lock().unwrap();
                evidence.current = Some(index);
                evidence.document_cookies = None;
            }
            let slot = step["slot"].as_u64().unwrap() as usize;
            let attempt = attempts[slot].as_ref().unwrap();
            attempt.browser.as_ref().unwrap().navigate(
                &attempt.identity,
                &format!("{ORIGIN}/storage-page/{}", step["name"].as_str().unwrap()),
            )?;
            pump(events, runtime, Duration::from_secs(12), || {
                for &slot in slots {
                    attempts[slot].as_mut().unwrap().advance(
                        runtime,
                        bridge,
                        &certificates,
                        &parent,
                    )?;
                }
                let mut observed = evidence.lock().unwrap();
                let Some(proof) = observed.proofs.get_mut(index) else {
                    return Ok(false);
                };
                let live: Vec<_> = slots
                    .iter()
                    .copied()
                    .filter(|slot| attempts[*slot].as_ref().unwrap().live())
                    .collect();
                proof["liveSlots"] = json!(live);
                if proof["passed"] != true || live.as_slice() != slots {
                    return Err("storage value or simultaneous lifecycle mismatch".into());
                }
                Ok(true)
            })?;
            checkpoint(output, &mut report, &evidence)?;
        }
        // Each surviving renderer must actually issue a pulse before revocation.
        pump(events, runtime, Duration::from_secs(8), || {
            for slot in [1, 2] {
                attempts[slot].as_mut().unwrap().advance(
                    runtime,
                    bridge,
                    &certificates,
                    &parent,
                )?;
            }
            Ok([1, 2].iter().all(|slot| {
                attempts[*slot]
                    .as_ref()
                    .unwrap()
                    .state
                    .lock()
                    .unwrap()
                    .pulse_requests
                    > 0
            }))
        })?;
        Ok(())
    })();
    if let Err(error) = probes {
        report["failures"]
            .as_array_mut()
            .unwrap()
            .push(json!(error.to_string()));
    }
    for attempt in attempts.iter_mut().flatten() {
        if attempt.fixture.is_none() {
            continue;
        }
        match close(attempt, events, runtime, &certificates, asynchronous) {
            Ok(closed) => report["contexts"].as_array_mut().unwrap().push(closed),
            Err(error) => {
                report["status"] = "failed".into();
                report["failures"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(format!("ordered cleanup failed: {error}")));
                let _ = checkpoint(output, &mut report, &evidence);
                // No shutdown or Rust unwinding with live native browser refs.
                // The external runner records exit 3 and incomplete shutdown.
                std::process::exit(3);
            }
        }
    }
    report["status"] = if report["failures"].as_array().unwrap().is_empty()
        && evidence.lock().unwrap().protocol_errors == 0
    {
        "completed"
    } else {
        "failed"
    }
    .into();
    checkpoint(output, &mut report, &evidence)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cookie_matching_is_exact_and_duplicates_fail_closed() {
        assert_eq!(
            cookie(
                "Cookie: prefix_isolation_native=a-one\r\n",
                "isolation_native"
            ),
            Value::Null
        );
        assert_eq!(
            cookie(
                "cOoKiE: isolation_native=a-one; other=value\r\n",
                "isolation_native"
            ),
            "a-one"
        );
        assert_eq!(
            cookie(
                "Cookie: isolation_native=a-one; isolation_native=b-one\r\n",
                "isolation_native"
            ),
            "duplicate"
        );
        assert_eq!(
            cookie(
                "Cookie: isolation_native=a-one-extra\r\n",
                "isolation_native"
            ),
            "unexpected-or-missing"
        );
    }
    #[test]
    fn missing_storage_values_cannot_pass_as_empty() {
        let value = snapshot(&json!({}));
        assert!(["cookie", "localStorage", "indexedDb"]
            .iter()
            .all(|key| value[*key] != Value::Null));
    }
}
