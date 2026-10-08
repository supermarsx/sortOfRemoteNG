//! Owner-authorized automation DTOs. These are not a website-to-app API.
//! TypeScript is compiled by the existing frontend prepareWebsiteScript path.
//! Permission values come only from the native saved-configuration authority.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const MAX_SCRIPT_BYTES: usize = 64 * 1024;
pub const MAX_RECORDED_STEPS: usize = 200;
pub const AUTOMATION_TIMEOUT_MS: i64 = 15_000;

/// Deliberately NOT deserializable: UI request fields cannot supply authority.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NativeAutomationPermissions {
    pub scripts: bool,
    pub macros: bool,
}

impl NativeAutomationPermissions {
    /// An additional native saved-policy restriction, never a consent grant.
    /// Cancel remains cleanup-only in NativeAutomationAction::validate.
    pub fn restrict_website_extensions(self, enabled: bool) -> Self {
        Self {
            scripts: self.scripts && enabled,
            macros: self.macros && enabled,
        }
    }
}

/// Matches WebInteractionStep. In particular, a saved fill step has NO value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum NativeAutomationStep {
    Click { selector: String },
    Check { selector: String, checked: bool },
    Fill { selector: String },
}

impl NativeAutomationStep {
    pub fn selector(&self) -> &str {
        match self {
            Self::Click { selector } | Self::Check { selector, .. } | Self::Fill { selector } => {
                selector
            }
        }
    }

    pub fn valid(&self) -> bool {
        static SELECTOR: OnceLock<regex::Regex> = OnceLock::new();
        self.selector().len() <= 512
            && SELECTOR
                .get_or_init(|| {
                    regex::Regex::new(
            r"^html > body(?: > [a-z][a-z0-9-]{0,30}:nth-of-type\([1-9][0-9]{0,3}\)){1,24}$"
        ).expect("constant structural selector")
                })
                .is_match(self.selector())
    }
}

/// Mutations carry a native V8-document receipt, not an origin-only grant.
/// No Debug derive: code and transient fill values must not enter diagnostics.
#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NativeAutomationAction {
    // A struct variant preserves deny_unknown_fields; serde's internally
    // tagged unit variant silently ignores extra authority-looking fields.
    Document {},
    Script {
        document_token: String,
        origin: String,
        request_id: String,
        code: String,
    },
    Step {
        document_token: String,
        origin: String,
        request_id: String,
        step: NativeAutomationStep,
        value: Option<String>,
    },
    RecordStart {
        document_token: String,
        origin: String,
        request_id: String,
    },
    RecordStop {
        document_token: String,
        origin: String,
        request_id: String,
    },
    Cancel {
        document_token: String,
        origin: String,
        request_id: String,
    },
}

pub type NativeAutomationRequest = NativeAutomationAction;

impl NativeAutomationAction {
    pub fn scope(&self) -> Option<(&str, &str, &str)> {
        match self {
            Self::Document {} => None,
            Self::Script {
                document_token,
                origin,
                request_id,
                ..
            }
            | Self::Step {
                document_token,
                origin,
                request_id,
                ..
            }
            | Self::RecordStart {
                document_token,
                origin,
                request_id,
            }
            | Self::RecordStop {
                document_token,
                origin,
                request_id,
            }
            | Self::Cancel {
                document_token,
                origin,
                request_id,
            } => Some((document_token, origin, request_id)),
        }
    }

    pub fn validate(
        &self,
        permissions: NativeAutomationPermissions,
    ) -> Result<(), NativeAutomationFailure> {
        if let Some((token, origin, request)) = self.scope() {
            if token.is_empty()
                || token.len() > 80
                || request.is_empty()
                || request.len() > 128
                || !request
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
                || !canonical_origin(origin)
            {
                return Err(NativeAutomationFailure::InvalidRequest);
            }
        }
        match self {
            Self::Script { code, .. } => {
                if !permissions.scripts {
                    return Err(NativeAutomationFailure::Denied);
                }
                if code.is_empty()
                    || code.len() > MAX_SCRIPT_BYTES
                    || code
                        .chars()
                        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                {
                    return Err(NativeAutomationFailure::InvalidRequest);
                }
            }
            Self::Step { step, value, .. } => {
                if !permissions.macros {
                    return Err(NativeAutomationFailure::Denied);
                }
                if !step.valid()
                    || match step {
                        NativeAutomationStep::Fill { .. } => {
                            value.as_ref().is_none_or(|v| v.len() > 4096)
                        }
                        _ => value.is_some(),
                    }
                {
                    return Err(NativeAutomationFailure::InvalidRequest);
                }
            }
            Self::RecordStart { .. } | Self::RecordStop { .. } if !permissions.macros => {
                return Err(NativeAutomationFailure::Denied)
            }
            // Cancel is cleanup-only and must remain available after permission revocation.
            _ => {}
        }
        Ok(())
    }
}

fn canonical_origin(origin: &str) -> bool {
    origin.len() <= 1024
        && url::Url::parse(origin).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && url.origin().ascii_serialization() == origin
        })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAutomationFailure {
    Denied,
    InvalidRequest,
    StaleDocument,
    Unavailable,
    Busy,
    TimedOut,
    ExecutionFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NativeAutomationReply {
    Document {
        document_token: String,
        origin: String,
    },
    Completed {
        request_id: String,
    },
    RecordingStopped {
        request_id: String,
        steps: Vec<NativeAutomationStep>,
        truncated: bool,
    },
    Failed {
        reason: NativeAutomationFailure,
    },
}

pub type NativeAutomationCompletion = Box<dyn FnOnce(NativeAutomationReply) + Send + 'static>;

#[cfg(any(feature = "cef-host", test))]
#[derive(Default)]
pub(crate) struct Recorder {
    started: bool,
    deadline: Option<std::time::Instant>,
    steps: Vec<NativeAutomationStep>,
    truncated: bool,
}

#[cfg(any(feature = "cef-host", test))]
impl Recorder {
    pub fn start(&mut self, now: std::time::Instant) -> bool {
        if self.started {
            return false;
        }
        self.started = true;
        self.deadline = Some(now + std::time::Duration::from_secs(300));
        true
    }
    pub fn push(&mut self, step: NativeAutomationStep, now: std::time::Instant) {
        if !self.started || !step.valid() {
            return;
        }
        if self.deadline.is_none_or(|deadline| now >= deadline)
            || self.steps.len() >= MAX_RECORDED_STEPS
        {
            self.truncated = true;
            return;
        }
        self.steps.push(step);
    }
    pub fn stop(&mut self, now: std::time::Instant) -> (Vec<NativeAutomationStep>, bool) {
        let old = std::mem::take(self);
        (
            old.steps,
            old.truncated || old.deadline.is_some_and(|deadline| now >= deadline),
        )
    }
    pub fn cancel(&mut self) {
        *self = Self::default();
    }
}

// Adapted from sorng-protocols/web_automation_client.js's existing step and
// recording contract. Unlike that iframe transport, this private factory has
// no window message listener, global native function, credential action, or
// app command dispatcher. Never interpolate script/field values into source.
#[cfg(any(feature = "cef-host", test))]
pub(crate) const AUTOMATION_FACTORY: &str = r#"
(function (notify) {
  'use strict';
  let initialUrl = location.href;
  const selectorPattern = /^html > body(?: > [a-z][a-z0-9-]{0,30}:nth-of-type\([1-9][0-9]{0,3}\)){1,24}$/;
  const compile = Function, promiseResolve = Promise.resolve.bind(Promise);
  let recording = false;
  function sensitive(element) {
    if (!(element instanceof HTMLElement) || element.closest('[contenteditable="true"], [contenteditable=""], iframe')) return true;
    let controls = [element], form = element.form || element.closest('form');
    if (form) controls = controls.concat(Array.prototype.slice.call(form.elements));
    return controls.some(function(control) {
      const type = (control.getAttribute('type') || '').toLowerCase();
      if (control !== element && type === 'hidden') return false;
      if (['password','hidden','file'].includes(type)) return true;
      const hints = ['name','id','autocomplete','aria-label','data-secret'].map(key => control.getAttribute(key) || '').join(' ');
      if (/pass(?:word|phrase|wd)?|secret|token|one.?time|\botp\b|\bmfa\b|\b2fa\b|auth|credential|api.?key|card.?number|cvv|cvc/i.test(hints)) return true;
      return control.labels && Array.prototype.some.call(control.labels, label => /password|passphrase|secret|token|one.?time|authentication|verification code|credit card/i.test(label.textContent || ''));
    });
  }
  function visible(e) {
    if (!e.isConnected || e.closest('[hidden],[inert]')) return false;
    const style = getComputedStyle(e);
    return style.display !== 'none' && style.visibility !== 'hidden' && e.getClientRects().length > 0;
  }
  function usable(e) {
    // :disabled includes disabled fieldsets while preserving the first-legend
    // exception. Property-only checks miss inherited native disabled state.
    return !sensitive(e) && visible(e) && !e.disabled && !e.matches(':disabled') &&
      !((e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) && e.readOnly);
  }
  function fillControl(e) {
    return (e instanceof HTMLInputElement && ['text','search','email','url','tel','number','date','datetime-local','month','week','time','range','color'].includes(e.type)) || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement;
  }
  function clickControl(e) {
    if (e instanceof HTMLInputElement) return e.type === 'button' || e.type === 'submit';
    if (e instanceof HTMLButtonElement && e.type === 'reset') return false;
    if (e instanceof HTMLAnchorElement) {
      if (!e.hasAttribute('href')) return false;
      try {
        const target = new URL(e.href, location.href);
        return ['http:','https:'].includes(target.protocol) && target.origin === location.origin && !target.username && !target.password;
      } catch (_) { return false; }
    }
    return e.matches('a,button,[role=button],[role=link]');
  }
  function assignFill(e, value) {
    const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    // Check native value sanitization off-document first. Invalid dates, absent
    // options and clamped values must not clear/change the original field.
    const probe = e.cloneNode(false);
    if (e instanceof HTMLSelectElement) {
      const option = Array.prototype.find.call(e.options, option => option.value === value);
      if (!option || option.disabled || option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled) return false;
      probe.appendChild(option.cloneNode(true));
    }
    descriptor.set.call(probe, value);
    if (descriptor.get.call(probe) !== value) return false;
    descriptor.set.call(e, value);
    return descriptor.get.call(e) === value;
  }
  function selectorFor(e) {
    const parts = []; let node = e;
    while (node && node !== document.body && parts.length < 24) {
      const tag = node.localName;
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(tag)) return null;
      let index = 1, previous = node.previousElementSibling;
      while (previous) { if (previous.localName === tag) index++; previous = previous.previousElementSibling; }
      if (index > 9999) return null;
      parts.unshift(tag + ':nth-of-type(' + index + ')'); node = node.parentElement;
    }
    if (node !== document.body || !parts.length) return null;
    const selector = 'html > body > ' + parts.join(' > ');
    return selector.length <= 512 && selectorPattern.test(selector) ? selector : null;
  }
  function record(event) {
    if (!recording || !event.isTrusted || location.href !== initialUrl) return;
    const e = event.target instanceof Element ? event.target.closest('a,button,input,textarea,select,[role=button],[role=link]') : null;
    if (!e || !usable(e)) return;
    const selector = selectorFor(e); if (!selector) return;
    if (event.type === 'change') {
      if (e instanceof HTMLInputElement && ['checkbox','radio'].includes(e.type)) notify('', 'step', 'check', selector, !!e.checked);
      else if (fillControl(e)) notify('', 'step', 'fill', selector, false);
    } else if (clickControl(e)) notify('', 'step', 'click', selector, false);
  }
  document.addEventListener('click', record, true);
  document.addEventListener('change', record, true);
  return function(serial, action, codeOrSelector, kind, value, checked) {
    // Native-only generation reset; this is not a public automation action.
    if (action === 'reset') { recording = false; initialUrl = location.href; return true; }
    if (action === 'cancel' || action === 'recordStop') { recording = false; return true; }
    if (location.href !== initialUrl) return false;
    try {
      if (action === 'recordStart') { recording = true; return true; }
      if (action === 'script') {
        // Exactly legacy semantics: completion follows a returned Promise.
        // A synchronous infinite loop cannot be interrupted by this bridge.
        promiseResolve(compile('"use strict";\n' + codeOrSelector)()).then(
          () => notify(serial, 'ok', '', '', false),
          () => notify(serial, 'failed', '', '', false));
        return true;
      }
      if (action !== 'step' || codeOrSelector.length > 512 || !selectorPattern.test(codeOrSelector)) return false;
      const matches = document.querySelectorAll(codeOrSelector);
      if (matches.length !== 1) return false;
      const e = matches[0];
      if (!usable(e)) return false;
      if (kind === 'click') {
        if (!clickControl(e)) return false;
        e.click(); return true;
      }
      if (kind === 'check' && e instanceof HTMLInputElement && ['checkbox','radio'].includes(e.type)) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(e, checked);
      } else if (kind === 'fill' && typeof value === 'string' && value.length <= 4096 && fillControl(e)) {
        if (!assignFill(e, value)) return false;
      } else return false;
      e.dispatchEvent(new Event('input', {bubbles:true}));
      e.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    } catch (_) { return false; }
  };
})
"#;

// Typed, bounded CEF IPC. No JSON evaluator, app command names or arbitrary
// renderer results cross this channel. All strings from a website are ignored.
#[cfg(feature = "cef-host")]
pub(crate) mod wire {
    use super::*;
    use cef::*;
    pub const REQUEST: &str = "sorng.native.automation.request.v1";
    pub const REPLY: &str = "sorng.native.automation.reply.v1";

    pub fn text(args: &ListValue, index: usize, max: usize) -> Option<String> {
        if args.get_type(index) != ValueType::STRING {
            return None;
        }
        string_value(&CefString::from(&args.string(index)), max)
    }
    pub fn string_value(raw: &CefString, max: usize) -> Option<String> {
        // CEF uses a null/zero-length buffer for a present empty string.
        // Its type was checked by the caller: empty is not missing. Document
        // replies, recording notifications and clearing inputs rely on this.
        if raw.as_slice().is_some_and(|units| units.len() > max) {
            return None;
        }
        let value = raw.to_string();
        (value.len() <= max).then_some(value)
    }
    pub fn string(args: &ListValue, index: usize, value: &str) {
        args.set_string(index, Some(&CefString::from(value)));
    }
    pub fn encode_action(
        args: &ListValue,
        serial: &str,
        action: &NativeAutomationAction,
        generation: u64,
    ) {
        args.set_size(10);
        for i in 0..9 {
            string(args, i, "");
        }
        string(args, 0, serial);
        string(args, 9, &generation.to_string());
        if let Some((token, origin, request)) = action.scope() {
            string(args, 2, token);
            string(args, 3, origin);
            string(args, 4, request);
        }
        let kind = match action {
            NativeAutomationAction::Document {} => "document",
            NativeAutomationAction::Script { code, .. } => {
                string(args, 5, code);
                "script"
            }
            NativeAutomationAction::Step { step, value, .. } => {
                string(args, 5, step.selector());
                string(
                    args,
                    6,
                    match step {
                        NativeAutomationStep::Click { .. } => "click",
                        NativeAutomationStep::Check { .. } => "check",
                        NativeAutomationStep::Fill { .. } => "fill",
                    },
                );
                if let Some(value) = value {
                    string(args, 7, value);
                }
                args.set_bool(
                    8,
                    i32::from(matches!(
                        step,
                        NativeAutomationStep::Check { checked: true, .. }
                    )),
                );
                "step"
            }
            NativeAutomationAction::RecordStart { .. } => "recordStart",
            NativeAutomationAction::RecordStop { .. } => "recordStop",
            NativeAutomationAction::Cancel { .. } => "cancel",
        };
        string(args, 1, kind);
    }
    pub fn decode_action(args: &ListValue) -> Option<(String, String, NativeAutomationAction)> {
        if args.size() != 10 {
            return None;
        }
        let serial = text(args, 0, 32)?;
        let generation = text(args, 9, 20)?;
        if generation.parse::<u64>().ok()?.to_string() != generation {
            return None;
        }
        let kind = text(args, 1, 16)?;
        if kind == "document" {
            return Some((serial, generation, NativeAutomationAction::Document {}));
        }
        let document_token = text(args, 2, 80)?;
        let origin = text(args, 3, 1024)?;
        let request_id = text(args, 4, 128)?;
        let action = match kind.as_str() {
            "script" => NativeAutomationAction::Script {
                document_token,
                origin,
                request_id,
                code: text(args, 5, MAX_SCRIPT_BYTES)?,
            },
            "step" => {
                let selector = text(args, 5, 512)?;
                let kind = text(args, 6, 8)?;
                let step = match kind.as_str() {
                    "click" => NativeAutomationStep::Click { selector },
                    "fill" => NativeAutomationStep::Fill { selector },
                    "check" if args.get_type(8) == ValueType::BOOL => NativeAutomationStep::Check {
                        selector,
                        checked: args.bool(8) == 1,
                    },
                    _ => return None,
                };
                let value = if kind == "fill" {
                    Some(text(args, 7, 4096)?)
                } else {
                    None
                };
                NativeAutomationAction::Step {
                    document_token,
                    origin,
                    request_id,
                    step,
                    value,
                }
            }
            "recordStart" => NativeAutomationAction::RecordStart {
                document_token,
                origin,
                request_id,
            },
            "recordStop" => NativeAutomationAction::RecordStop {
                document_token,
                origin,
                request_id,
            },
            "cancel" => NativeAutomationAction::Cancel {
                document_token,
                origin,
                request_id,
            },
            _ => return None,
        };
        action
            .validate(NativeAutomationPermissions {
                scripts: true,
                macros: true,
            })
            .ok()?;
        Some((serial, generation, action))
    }

    pub fn reply(
        frame: &Frame,
        serial: &str,
        token: &str,
        origin: &str,
        request: &str,
        status: &str,
        recording: (&[NativeAutomationStep], bool),
    ) {
        let (steps, truncated) = recording;
        if steps.len() > MAX_RECORDED_STEPS || steps.iter().any(|step| !step.valid()) {
            return;
        }
        let Some(mut message) = process_message_create(Some(&CefString::from(REPLY))) else {
            return;
        };
        let Some(args) = message.argument_list() else {
            return;
        };
        for (i, value) in [serial, token, origin, request, status].iter().enumerate() {
            string(&args, i, value);
        }
        args.set_bool(5, i32::from(truncated));
        args.set_int(6, steps.len() as i32);
        for (i, step) in steps.iter().enumerate() {
            string(
                &args,
                7 + i * 3,
                match step {
                    NativeAutomationStep::Click { .. } => "click",
                    NativeAutomationStep::Check { .. } => "check",
                    NativeAutomationStep::Fill { .. } => "fill",
                },
            );
            string(&args, 8 + i * 3, step.selector());
            args.set_bool(
                9 + i * 3,
                i32::from(matches!(
                    step,
                    NativeAutomationStep::Check { checked: true, .. }
                )),
            );
        }
        frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
    }

    pub fn steps(args: &ListValue) -> Option<Vec<NativeAutomationStep>> {
        if args.get_type(6) != ValueType::INT {
            return None;
        }
        let count = usize::try_from(args.int(6)).ok()?;
        if count > MAX_RECORDED_STEPS || args.size() != 7 + count * 3 {
            return None;
        }
        (0..count)
            .map(|i| {
                let selector = text(args, 8 + i * 3, 512)?;
                if args.get_type(9 + i * 3) != ValueType::BOOL {
                    return None;
                }
                let step = match text(args, 7 + i * 3, 8)?.as_str() {
                    "click" => NativeAutomationStep::Click { selector },
                    "fill" => NativeAutomationStep::Fill { selector },
                    "check" => NativeAutomationStep::Check {
                        selector,
                        checked: args.bool(9 + i * 3) == 1,
                    },
                    _ => return None,
                };
                step.valid().then_some(step)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn script() -> NativeAutomationAction {
        NativeAutomationAction::Script {
            document_token: "42:7".into(),
            origin: "https://fixture.test".into(),
            request_id: "run-1".into(),
            code: "return Promise.resolve();".into(),
        }
    }
    fn fill() -> NativeAutomationStep {
        NativeAutomationStep::Fill {
            selector: "html > body > input:nth-of-type(1)".into(),
        }
    }

    #[test]
    fn native_automation_wire_matches_legacy_camel_case_and_forbids_extra_authority() {
        let value = serde_json::to_value(script()).unwrap();
        assert_eq!(value["action"], "script");
        assert_eq!(value["documentToken"], "42:7");
        assert_eq!(value["requestId"], "run-1");
        let mut extra = value;
        extra["scripts"] = true.into();
        assert!(serde_json::from_value::<NativeAutomationAction>(extra).is_err());
        assert!(
            serde_json::from_str::<NativeAutomationAction>(r#"{"action":"credentials"}"#).is_err()
        );
        assert!(serde_json::from_str::<NativeAutomationAction>(r#"{"action":"reset"}"#).is_err());
        assert!(serde_json::from_str::<NativeAutomationStep>(r#"{"kind":"fill","selector":"html > body > input:nth-of-type(1)","value":"never saved"}"#).is_err());
        let reply = serde_json::to_value(NativeAutomationReply::RecordingStopped {
            request_id: "stop-1".into(),
            steps: vec![fill()],
            truncated: false,
        })
        .unwrap();
        assert_eq!(reply["status"], "recordingStopped");
        assert_eq!(reply["requestId"], "stop-1");
        assert_eq!(reply["steps"][0].as_object().unwrap().len(), 2);
    }

    #[test]
    fn native_automation_permissions_default_deny_and_are_independent() {
        let denied = NativeAutomationPermissions::default();
        assert_eq!(
            script().validate(denied),
            Err(NativeAutomationFailure::Denied)
        );
        assert_eq!(
            script().validate(NativeAutomationPermissions {
                scripts: false,
                macros: true
            }),
            Err(NativeAutomationFailure::Denied)
        );
        assert!(script()
            .validate(NativeAutomationPermissions {
                scripts: true,
                macros: false
            })
            .is_ok());
        let start = NativeAutomationAction::RecordStart {
            document_token: "42:7".into(),
            origin: "https://fixture.test".into(),
            request_id: "start-1".into(),
        };
        assert_eq!(start.validate(denied), Err(NativeAutomationFailure::Denied));
        assert!(NativeAutomationAction::Document {}.validate(denied).is_ok());
        let cancel = NativeAutomationAction::Cancel {
            document_token: "42:7".into(),
            origin: "https://fixture.test".into(),
            request_id: "cancel-1".into(),
        };
        assert!(cancel.validate(denied).is_ok());
    }

    #[test]
    fn native_automation_rejects_noncanonical_origin_and_oversized_script() {
        let allow = NativeAutomationPermissions {
            scripts: true,
            macros: true,
        };
        for origin in [
            "http://fixture.test",
            "https://u:p@fixture.test",
            "https://fixture.test/",
            "https://fixture.test/path",
            "https://fixture.test#secret",
            "null",
        ] {
            let mut action = script();
            if let NativeAutomationAction::Script { origin: target, .. } = &mut action {
                *target = origin.into();
            }
            assert_eq!(
                action.validate(allow),
                Err(NativeAutomationFailure::InvalidRequest)
            );
        }
        for code in ["x".repeat(MAX_SCRIPT_BYTES + 1), "\0".into(), String::new()] {
            let mut action = script();
            if let NativeAutomationAction::Script { code: target, .. } = &mut action {
                *target = code;
            }
            assert_eq!(
                action.validate(allow),
                Err(NativeAutomationFailure::InvalidRequest)
            );
        }
    }

    #[test]
    fn native_automation_selectors_cannot_include_page_attributes_or_values() {
        assert!(fill().valid());
        for selector in [
            "#secret",
            "input[name=password]",
            "html > body > input:nth-of-type(0)",
            "html > body > input:nth-of-type(10000)",
            "html > body > input:nth-of-type(1), iframe",
            "html > body",
        ] {
            assert!(!NativeAutomationStep::Click {
                selector: selector.into()
            }
            .valid());
        }
        let selector = format!("html > body{}", " > div:nth-of-type(1)".repeat(25));
        assert!(!NativeAutomationStep::Fill { selector }.valid());
    }

    #[test]
    fn native_automation_fill_value_is_transient_and_bounded() {
        let allow = NativeAutomationPermissions {
            scripts: false,
            macros: true,
        };
        let mut action = NativeAutomationAction::Step {
            document_token: "42:7".into(),
            origin: "https://fixture.test".into(),
            request_id: "step-1".into(),
            step: fill(),
            value: None,
        };
        assert_eq!(
            action.validate(allow),
            Err(NativeAutomationFailure::InvalidRequest)
        );
        if let NativeAutomationAction::Step { value, .. } = &mut action {
            *value = Some("synthetic".into());
        }
        assert!(action.validate(allow).is_ok());
        if let NativeAutomationAction::Step { value, .. } = &mut action {
            *value = Some("x".repeat(4097));
        }
        assert_eq!(
            action.validate(allow),
            Err(NativeAutomationFailure::InvalidRequest)
        );
        if let NativeAutomationAction::Step { step, value, .. } = &mut action {
            *step = NativeAutomationStep::Click {
                selector: fill().selector().into(),
            };
            *value = Some(String::new());
        }
        assert_eq!(
            action.validate(allow),
            Err(NativeAutomationFailure::InvalidRequest)
        );
    }

    #[test]
    fn native_automation_recorder_is_bounded_expiring_and_cleanup_only() {
        let now = Instant::now();
        let mut recorder = Recorder::default();
        recorder.push(fill(), now);
        assert_eq!(recorder.stop(now), (vec![], false));
        assert!(recorder.start(now));
        assert!(!recorder.start(now));
        for _ in 0..201 {
            recorder.push(fill(), now);
        }
        let (steps, truncated) = recorder.stop(now);
        assert_eq!(steps.len(), 200);
        assert!(truncated);
        assert!(recorder.start(now));
        recorder.push(fill(), now + Duration::from_secs(301));
        assert_eq!(
            recorder.stop(now + Duration::from_secs(301)),
            (vec![], true)
        );
        assert!(recorder.start(now));
        recorder.push(fill(), now);
        recorder.cancel();
        assert_eq!(recorder.stop(now), (vec![], false));
    }

    #[test]
    fn native_automation_dom_contract_runs_without_browser_or_network() {
        // This is a DOM unit test, NOT real CEF/sandbox/route acceptance.
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .unwrap();
        let source = AUTOMATION_DOM_TEST.replace("__FACTORY__", AUTOMATION_FACTORY);
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(source)
            .current_dir(root)
            .output()
            .expect("Node and workspace jsdom are required for DOM contract tests");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[cfg(test)]
const AUTOMATION_DOM_TEST: &str = r#"
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
(async () => {
  const dom = new JSDOM('<!doctype html><html><body><button>Run</button><input><input type="checkbox"><input type="password"><form><input><input type="password"><button>Login</button></form><a href="https://other.invalid">Other</a><div contenteditable="true"><button>Edit</button></div></body></html>', {url:'https://fixture.invalid/page', runScripts:'outside-only'});
  const w = dom.window, events = [], listeners = {};
  const add = w.document.addEventListener.bind(w.document);
  w.document.addEventListener = (kind, callback, ...rest) => { listeners[kind] = callback; add(kind, callback, ...rest); };
  w.HTMLElement.prototype.getClientRects = () => [{}];
  const factory = w.eval('(' + (__FACTORY__).toString() + ')');
  const dispatch = factory((...args) => events.push(args));
  const selector = (tag, n) => `html > body > ${tag}:nth-of-type(${n})`;
  const input = w.document.querySelector('input'), checkbox = w.document.querySelector('input[type=checkbox]'), password = w.document.querySelector('input[type=password]'), button = w.document.querySelector('button');
  let clicks = 0; button.onclick = () => clicks++;
  assert.equal(dispatch('1','step',selector('button',1),'click','',false),true); assert.equal(clicks,1);
  assert.equal(dispatch('2','step',selector('input',1),'fill','synthetic-public-value',false),true); assert.equal(input.value,'synthetic-public-value');
  assert.equal(dispatch('3','step',selector('input',2),'check','',true),true); assert.equal(checkbox.checked,true);
  assert.equal(dispatch('4','step',selector('input',3),'fill','never-set',false),false); assert.equal(password.value,'');
  assert.equal(dispatch('5','step','input[name=password]','fill','never-set',false),false);
  assert.equal(dispatch('6','step',selector('a',1),'click','',false),false);
  assert.equal(dispatch('7','step','html > body > form:nth-of-type(1) > input:nth-of-type(1)','fill','never-set',false),false);
  assert.equal(dispatch('8','step',selector('input',1),'fill','x'.repeat(4097),false),false);
  assert.equal(dispatch('9','recordStart','','','',false),true);
  Object.defineProperty(input,'value',{get(){throw new Error('recorder must never read value');}});
  listeners.change({isTrusted:false,target:input,type:'change'}); assert.equal(events.length,0);
  listeners.change({isTrusted:true,target:input,type:'change'});
  assert.deepEqual(events.pop(),['','step','fill',selector('input',1),false]);
  listeners.change({isTrusted:true,target:password,type:'change'}); assert.equal(events.length,0);
  listeners.click({isTrusted:true,target:w.document.querySelector('form button'),type:'click'}); assert.equal(events.length,0);
  listeners.click({isTrusted:true,target:w.document.querySelector('[contenteditable] button'),type:'click'}); assert.equal(events.length,0);
  listeners.click({isTrusted:true,target:button,type:'click'});
  assert.deepEqual(events.pop(),['','step','click',selector('button',1),false]);
  listeners.change({isTrusted:true,target:checkbox,type:'change'});
  assert.deepEqual(events.pop(),['','step','check',selector('input',2),true]);
  assert.equal(dispatch('10','recordStop','','','',false),true);
  listeners.change({isTrusted:true,target:input,type:'change'}); assert.equal(events.length,0);
  assert.equal(dispatch('11','script',"return Promise.resolve('not returned to native');",'','',false),true);
  await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(events.pop(),['11','ok','','',false]);
  assert.equal(dispatch('12','script',"return Promise.reject(new Error('not returned to native'));",'','',false),true);
  await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(events.pop(),['12','failed','','',false]);
  assert.equal(dispatch('13','script',"throw new Error('not returned to native');",'','',false),false);
  w.history.pushState({},'', '/successor');
  assert.equal(dispatch('14','step',selector('button',1),'click','',false),false);
  assert.equal(dispatch('15','script','window.unwanted=true;','','',false),false);
  assert.equal(dispatch('16','cancel','','','',false),true);
  assert.equal(w.unwanted,undefined);
  assert.equal(dispatch('17','reset','','','',false),true);
  assert.equal(dispatch('18','step',selector('button',1),'click','',false),true);
  assert.equal(dispatch('19','recordStart','','','',false),true);
  assert.equal(dispatch('20','reset','','','',false),true);
  listeners.click({isTrusted:true,target:button,type:'click'}); assert.equal(events.length,0);
  dom.window.close();
  console.log('native automation DOM contract: passed (unit-only, no native acceptance claim)');
})().catch(error => { console.error(error); process.exitCode=1; });
"#;
