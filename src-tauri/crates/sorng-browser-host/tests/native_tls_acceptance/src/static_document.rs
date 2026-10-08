//! Exercise production automation on a script-free HTTPS document.
use crate::{BrowserIdentity, CefBrowserHost, Result, ORIGIN};
use sorng_browser_host::{
    cef_browser::BrowserEvent,
    native_automation::{
        NativeAutomationAction, NativeAutomationPermissions, NativeAutomationReply,
        NativeAutomationStep,
    },
};
use std::{
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

pub(super) const PATH: &str = "/script-free";
pub(super) const PAGE: &str = include_str!("script_free.html");

#[derive(Default)]
pub(super) struct Evidence {
    pub page_requests: usize,
    load_complete: bool,
    document_received: bool,
    click_completed: bool,
    clear_fill_completed: bool,
    script_completed: bool,
    failure: Option<String>,
}

impl Evidence {
    pub fn observe(&mut self, event: &BrowserEvent) {
        // The bootstrap's readiness acknowledgment is insufficient: wait for
        // this exact HTTPS navigation to finish without a native load fault.
        if !self.document_received && event.display.url == format!("{ORIGIN}{PATH}") {
            self.load_complete = !event.state.loading && event.state.fault.is_none();
        }
    }

    pub fn report(&self) -> serde_json::Value {
        serde_json::json!({
            "status": if self.failure.is_some() { "failed" }
                else if self.script_completed { "completed" } else { "incomplete" },
            "pageRequests": self.page_requests,
            "loadComplete": self.load_complete,
            "documentReceived": self.document_received,
            "clickCompleted": self.click_completed,
            "clearFillCompleted": self.clear_fill_completed,
            "scriptCompleted": self.script_completed,
            "failure": self.failure,
        })
    }
}

#[derive(Clone, Copy)]
enum Phase {
    Load,
    Document,
    Click,
    ClearFill,
    Script,
    Complete,
}

pub(super) struct Probe {
    evidence: Arc<Mutex<Evidence>>,
    phase: Phase,
    pending: Option<(Instant, mpsc::Receiver<NativeAutomationReply>)>,
    token: String,
    started: Instant,
}

impl Probe {
    pub fn new(evidence: Arc<Mutex<Evidence>>) -> Self {
        Self {
            evidence,
            phase: Phase::Load,
            pending: None,
            token: String::new(),
            started: Instant::now(),
        }
    }

    pub fn fail(&mut self, error: String) {
        self.evidence.lock().unwrap().failure = Some(error);
    }

    pub fn failed(&self) -> bool {
        self.evidence.lock().unwrap().failure.is_some()
    }

    pub fn advance(
        &mut self,
        browser: &CefBrowserHost<'_>,
        identity: &BrowserIdentity,
    ) -> Result<bool> {
        if self.started.elapsed() > Duration::from_secs(25) {
            return Err("script-free automation phase deadline".into());
        }
        if let Some((sent, receiver)) = &self.pending {
            let reply = match receiver.try_recv() {
                Ok(reply) => reply,
                Err(mpsc::TryRecvError::Empty) if sent.elapsed() < Duration::from_secs(17) => {
                    return Ok(false);
                }
                Err(_) => return Err("script-free native automation callback missing".into()),
            };
            self.pending = None;
            let mut evidence = self.evidence.lock().unwrap();
            match (self.phase, reply) {
                (
                    Phase::Document,
                    NativeAutomationReply::Document {
                        document_token,
                        origin,
                    },
                ) if !document_token.is_empty() && origin == ORIGIN => {
                    self.token = document_token;
                    evidence.document_received = true;
                    self.phase = Phase::Click;
                }
                (Phase::Click, NativeAutomationReply::Completed { request_id })
                    if request_id == "static-click" =>
                {
                    evidence.click_completed = true;
                    self.phase = Phase::ClearFill;
                }
                (Phase::ClearFill, NativeAutomationReply::Completed { request_id })
                    if request_id == "static-clear-fill" =>
                {
                    evidence.clear_fill_completed = true;
                    self.phase = Phase::Script;
                }
                (Phase::Script, NativeAutomationReply::Completed { request_id })
                    if request_id == "static-script" =>
                {
                    if evidence.page_requests != 1 || !evidence.load_complete {
                        return Err("script-free HTTPS document observation mismatch".into());
                    }
                    evidence.script_completed = true;
                    self.phase = Phase::Complete;
                }
                (_, NativeAutomationReply::Failed { reason }) => {
                    return Err(format!("script-free native automation failed: {reason:?}").into());
                }
                _ => return Err("script-free native automation reply/scope mismatch".into()),
            }
        }
        let (action, permissions) = match self.phase {
            Phase::Load => {
                let evidence = self.evidence.lock().unwrap();
                if evidence.page_requests == 0 || !evidence.load_complete {
                    return Ok(false);
                }
                self.phase = Phase::Document;
                // The first request must only ask for a receipt. No eval,
                // DevTools, click, fetch or page script may prime the context.
                (NativeAutomationAction::Document {}, NativeAutomationPermissions::default())
            }
            Phase::Click => (
                NativeAutomationAction::Step {
                    document_token: self.token.clone(),
                    origin: ORIGIN.into(),
                    request_id: "static-click".into(),
                    step: NativeAutomationStep::Click {
                        selector: "html > body > details:nth-of-type(1) > summary:nth-of-type(1)".into(),
                    },
                    value: None,
                },
                NativeAutomationPermissions { scripts: false, macros: true },
            ),
            Phase::Script => (
                NativeAutomationAction::Script {
                    document_token: self.token.clone(),
                    origin: ORIGIN.into(),
                    request_id: "static-script".into(),
                    // A successful click reply alone does not prove a DOM
                    // effect. An exception must fail the native script reply.
                    code: format!(
                        "if (location.href !== '{ORIGIN}{PATH}' || !isSecureContext || top !== window || \
                         document.scripts.length !== 0 || typeof window.__TAURI_INTERNALS__ !== 'undefined' || \
                         document.querySelector('#native-click')?.open !== true || \
                         document.querySelector('#native-clear')?.defaultValue !== 'clear-me' || \
                         document.querySelector('#native-clear')?.value !== '') \
                         throw new Error('static automation assertion');"
                    ),
                },
                NativeAutomationPermissions { scripts: true, macros: false },
            ),
            Phase::ClearFill => (
                NativeAutomationAction::Step {
                    document_token: self.token.clone(),
                    origin: ORIGIN.into(),
                    request_id: "static-clear-fill".into(),
                    step: NativeAutomationStep::Fill {
                        selector: "html > body > input:nth-of-type(1)".into(),
                    },
                    // An empty STRING is a legitimate wire value, distinct
                    // from a missing argument; it must clear the initial text.
                    value: Some(String::new()),
                },
                NativeAutomationPermissions { scripts: false, macros: true },
            ),
            Phase::Complete => return Ok(true),
            Phase::Document => return Err("script-free document request lost completion".into()),
        };
        let (sender, receiver) = mpsc::channel();
        browser.automation(
            identity,
            action,
            permissions,
            Box::new(move |reply| {
                let _ = sender.send(reply);
            }),
        )?;
        self.pending = Some((Instant::now(), receiver));
        Ok(false)
    }
}
