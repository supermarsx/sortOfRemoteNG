//! Renderer-only feature callbacks. Native functions are closure arguments, not
//! window properties. Credentials cross CEF IPC only to the bound main frame.

use crate::native_automation::{
    self as automation, wire as automation_wire, NativeAutomationAction, NativeAutomationStep,
};
use crate::native_features::{
    https_origin, stage_allowed, NativeLoginAdapter, NativeLoginDeliveryStatus as Delivery,
    NativeLoginStage, FEATURE_PROTOCOL_PIN, MAX_CREDENTIAL_BYTES,
};
use cef::rc::Rc;
use cef::*;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;
#[path = "cef_appearance_renderer.rs"]
mod appearance;
#[path = "cef_manual_input_renderer.rs"]
mod manual_input;

pub(crate) const LOGIN_REQUEST: &str = "sorng.native.login.request.v1";
pub(crate) const LOGIN_DELIVERY: &str = "sorng.native.login.delivery.v1";
pub(crate) const LOGIN_DELIVERY_STATUS: &str = "sorng.native.login.delivery-status.v1";
pub(crate) const FEATURE_STATUS: &str = "sorng.native.features.status.v1";
static NEXT_DOCUMENT: AtomicU64 = AtomicU64::new(1);
type DocumentKey = (i32, String);

struct Document {
    owner: Browser,
    context: V8Context,
    deliver: V8Value,
    otp: Option<V8Value>,
    otp_challenge: Option<String>,
    typing: Option<V8Value>,
    scope: DocumentScope,
}

struct BrowserAdapter {
    owner: Browser,
    adapter: NativeLoginAdapter,
    factory_json: String,
}

pub(crate) const MAX_LOGIN_CONFIGURATION_BYTES: usize = 32 * 1024;
pub(crate) const DEFAULT_FORM_OPTIONS: &str = r#"{"version":1,"fillDelayMs":0,"submitDelayMs":0,"detectionTimeoutMs":8000,"submit":true,"fields":[]}"#;

/// CEF parses data, not page JavaScript. No website JSON.parse, getters or
/// prototype setters participate; disallow prototype-bearing keys recursively.
pub(crate) fn parse_login_configuration(json: &str) -> Option<Value> {
    if json.len() > MAX_LOGIN_CONFIGURATION_BYTES {
        return None;
    }
    let value = parse_json(Some(&CefString::from(json)), JsonParserOptions::RFC)?;
    if value.get_type() != ValueType::DICTIONARY {
        return None;
    }
    fn valid(value: &Value, depth: usize, remaining: &mut usize) -> bool {
        if depth > 8 || *remaining == 0 {
            return false;
        }
        *remaining -= 1;
        match value.get_type() {
            ValueType::NULL | ValueType::BOOL | ValueType::INT => true,
            ValueType::DOUBLE => value.double().is_finite(),
            ValueType::STRING => {
                CefString::from(&value.string()).to_string().len() <= MAX_LOGIN_CONFIGURATION_BYTES
            }
            ValueType::LIST => value.list().is_some_and(|list| {
                list.size() <= *remaining
                    && (0..list.size()).all(|index| {
                        list.value(index)
                            .is_some_and(|value| valid(&value, depth + 1, remaining))
                    })
            }),
            ValueType::DICTIONARY => value.dictionary().is_some_and(|dict| {
                if dict.size() > *remaining {
                    return false;
                }
                let mut keys = CefStringList::new();
                if dict.keys(Some(&mut keys)) != 1 {
                    return false;
                }
                keys.into_iter().all(|key| {
                    key.len() <= 512
                        && !matches!(key.as_str(), "__proto__" | "constructor" | "prototype")
                        && dict
                            .value(Some(&CefString::from(key.as_str())))
                            .is_some_and(|value| valid(&value, depth + 1, remaining))
                })
            }),
            _ => false,
        }
    }
    valid(&value, 0, &mut 1024).then_some(value)
}

fn login_configuration_v8(value: &Value) -> Option<V8Value> {
    // Only recursively validated native CEF values reach this converter.
    match value.get_type() {
        ValueType::NULL => v8_value_create_null(),
        ValueType::BOOL => v8_value_create_bool(value.bool()),
        ValueType::INT => v8_value_create_int(value.int()),
        ValueType::DOUBLE => v8_value_create_double(value.double()),
        ValueType::STRING => v8_value_create_string(Some(&CefString::from(&value.string()))),
        ValueType::LIST => {
            let list = value.list()?;
            let result = v8_value_create_array(i32::try_from(list.size()).ok()?)?;
            for index in 0..list.size() {
                let mut child = login_configuration_v8(&list.value(index)?)?;
                if result.set_value_byindex(index as i32, Some(&mut child)) != 1 {
                    return None;
                }
            }
            Some(result)
        }
        ValueType::DICTIONARY => {
            let dict = value.dictionary()?;
            let result = v8_value_create_object(None, None)?;
            let mut keys = CefStringList::new();
            if dict.keys(Some(&mut keys)) != 1 {
                return None;
            }
            for key in keys {
                let key = CefString::from(key.as_str());
                let mut child = login_configuration_v8(&dict.value(Some(&key))?)?;
                if result.set_value_bykey(
                    Some(&key),
                    Some(&mut child),
                    V8Propertyattribute::default(),
                ) != 1
                {
                    return None;
                }
            }
            Some(result)
        }
        _ => None,
    }
}

struct AutomationDocument {
    owner: Browser,
    context: V8Context,
    dispatch: V8Value,
    token: String,
    generation: Option<u64>,
    ready: bool,
    origin: String,
    url: String,
    used: HashSet<String>,
    pending: HashMap<String, (String, Instant)>,
    recorder: automation::Recorder,
}

impl AutomationDocument {
    // Only called after native current-context/origin verification. A new
    // browser navigation generation clears recording and unfinished replies,
    // including when history returns to exactly the same URL/V8 context.
    fn acquire_generation(&mut self, generation: u64, url: &str) -> Option<bool> {
        if self.generation.is_some_and(|current| generation < current) {
            return None;
        }
        if self.generation == Some(generation) {
            return (self.url == url).then_some(!self.ready);
        }
        self.pending.clear();
        self.recorder.cancel();
        self.generation = Some(generation);
        self.ready = false;
        self.url = url.to_owned();
        Some(true)
    }
    fn current_context(&self, browser: &Browser, frame: &Frame) -> bool {
        same_browser(&self.owner, browser)
            && self.context.is_valid() == 1
            && frame_origin(frame).as_deref() == Some(self.origin.as_str())
            && frame
                .v8_context()
                .is_some_and(|mut current| self.context.is_same(Some(&mut current)) == 1)
    }

    fn current(&self, browser: &Browser, frame: &Frame) -> bool {
        self.ready
            && self.current_context(browser, frame)
            && CefString::from(&frame.url()).to_string() == self.url
    }
}

/// Document-local authority, kept separately from V8 handles so the exact
/// request/reply fencing can be regression-tested without executing a website.
struct DocumentScope {
    nonce: String,
    origin: String,
    requested: HashSet<NativeLoginStage>,
    delivered: HashSet<NativeLoginStage>,
    adapter: NativeLoginAdapter,
}

impl DocumentScope {
    fn claim(
        &mut self,
        nonce: &str,
        origin: &str,
        stage: NativeLoginStage,
        url: &str,
    ) -> Result<(), Delivery> {
        if self.nonce != nonce {
            return Err(Delivery::RendererNonceMismatch);
        }
        if self.origin != origin {
            return Err(Delivery::RendererOriginMismatch);
        }
        if !self.requested.contains(&stage) {
            return Err(Delivery::RendererStageNotRequested);
        }
        if !stage_allowed(self.adapter, stage, url) {
            return Err(Delivery::RendererStageNotAllowed);
        }
        // Consume BEFORE executing website events. Reentrancy/replay cannot
        // receive the same credential grant twice.
        if !self.delivered.insert(stage) {
            return Err(Delivery::RendererReplay);
        }
        Ok(())
    }
}

thread_local! {
    // CEF guarantees these callbacks on the renderer thread. No Send/Sync cast
    // or browser-process V8 access, and release callbacks remove V8 references.
    static DOCUMENTS: RefCell<HashMap<DocumentKey, Document>> = RefCell::new(HashMap::new());
    static ADAPTERS: RefCell<HashMap<i32, BrowserAdapter>> = RefCell::new(HashMap::new());
    static AUTOMATION_DOCUMENTS: RefCell<HashMap<DocumentKey, AutomationDocument>> = RefCell::new(HashMap::new());
}

fn same_browser(owner: &Browser, browser: &Browser) -> bool {
    owner.is_same(Some(&mut browser.clone())) == 1
}

fn forget_browser(browser: &Browser) {
    manual_input::forget_browser(browser);
    appearance::forget_browser(browser);
    AUTOMATION_DOCUMENTS.with(|documents| {
        documents
            .borrow_mut()
            .retain(|_, doc| !same_browser(&doc.owner, browser))
    });
    // CEF 682c378 include/cef_render_process_handler.h: OnBrowserCreated may
    // precede OnBrowserDestroyed for the SAME identifier on cross-origin
    // navigation. Numeric-ID cleanup can erase a successor between request and
    // reply (run16's missing-document symptom). IsSame fences the owner instance.
    DOCUMENTS.with(|documents| {
        documents
            .borrow_mut()
            .retain(|_, document| !same_browser(&document.owner, browser));
    });
    ADAPTERS.with(|adapters| {
        adapters
            .borrow_mut()
            .retain(|_, policy| !same_browser(&policy.owner, browser));
    });
}

fn forget_context(context: &mut V8Context) {
    manual_input::forget_context(context);
    appearance::forget_context(context);
    AUTOMATION_DOCUMENTS.with(|documents| {
        documents
            .borrow_mut()
            .retain(|_, doc| doc.context.is_same(Some(context)) != 1)
    });
    // Release by context identity, not a potentially retired frame wrapper.
    // CEF requires all references to this exact context to leave here.
    DOCUMENTS.with(|documents| {
        documents
            .borrow_mut()
            .retain(|_, document| document.context.is_same(Some(context)) != 1);
    });
}

fn frame_key(browser: &Browser, frame: &Frame) -> DocumentKey {
    (
        browser.identifier(),
        CefString::from(&frame.identifier()).to_string(),
    )
}

fn frame_origin(frame: &Frame) -> Option<String> {
    (frame.is_main() == 1 && frame.is_valid() == 1)
        .then(|| https_origin(&CefString::from(&frame.url()).to_string()))?
}

fn feature_origin(frame: &Frame) -> Option<String> {
    if frame.is_main() != 1 || frame.is_valid() != 1 {
        return None;
    }
    let url = CefString::from(&frame.url()).to_string();
    if url == "about:blank" {
        Some(url)
    } else {
        https_origin(&url)
    }
}

pub(crate) fn forced_dark_configured(command_line: &CommandLine) -> bool {
    command_line.has_switch(Some(&CefString::from("force-dark-mode"))) == 1
        && CefString::from(&command_line.switch_value(Some(&CefString::from("enable-features"))))
            .to_string()
            .split(',')
            .any(|name| name == "WebContentsForceDark")
        && !CefString::from(&command_line.switch_value(Some(&CefString::from("disable-features"))))
            .to_string()
            .split(',')
            .any(|name| name.split([':', '<']).next() == Some("WebContentsForceDark"))
}

pub(crate) fn message_text(args: &ListValue, index: usize, max: usize) -> Option<String> {
    if args.get_type(index) != ValueType::STRING {
        return None;
    }
    let value = CefString::from(&args.string(index)).to_string();
    (value.len() <= max).then_some(value)
}

wrap_v8_handler! {
    struct LoginSignal { key: DocumentKey, nonce: String }
    impl V8Handler {
        fn execute(&self, _name: Option<&CefString>, _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>, _retval: Option<&mut Option<V8Value>>,
            _exception: Option<&mut CefString>) -> i32 {
            let Some(mut current) = v8_context_get_current_context() else { return 1; };
            let event = arguments.and_then(|args| args.first()).and_then(Option::as_ref)
                .filter(|value| value.is_string() == 1)
                .map(|value| CefString::from(&value.string_value()).to_string()).unwrap_or_else(|| "form".into());
            let send = DOCUMENTS.with(|documents| {
                let mut documents = documents.borrow_mut();
                let document = documents.get_mut(&self.key)?;
                if document.scope.nonce != self.nonce
                    || document.context.is_same(Some(&mut current)) != 1 { return None; }
                let frame = document.context.frame()?;
                if frame_origin(&frame).as_deref() != Some(&document.scope.origin) { return None; }
                if event.starts_with("type|") {
                    let fields: Vec<_> = event.split('|').collect();
                    if fields.len() != 5 || event.len() > 128 || document.typing.is_none()
                        || !matches!(fields[1], "start" | "key" | "cancel") { return None; }
                    let stage = NativeLoginStage::parse(fields[2])?;
                    if !document.scope.delivered.contains(&stage) || stage.is_action() || stage == NativeLoginStage::FormPrepare
                        || !stage_allowed(document.scope.adapter, stage, &CefString::from(&frame.url()).to_string()) { return None; }
                    return Some((frame, document.scope.origin.clone()));
                }
                if event.starts_with("totp|") {
                    let fields: Vec<_> = event.split('|').collect();
                    if fields.len() != 4 || event.len() > 256 || document.otp.is_none()
                        || document.otp_challenge.as_deref() != Some(fields[2])
                        || !matches!(fields[1], "start" | "key" | "finish" | "cancel")
                        || fields[3].parse::<u8>().is_err() { return None; }
                    return Some((frame, document.scope.origin.clone()));
                }
                if matches!(event.as_str(), "google-completed" | "google-rejected" | "form-completed" | "form-rejected") {
                    let supported = if event.starts_with("google-") { document.scope.adapter == NativeLoginAdapter::Google }
                        else { document.scope.adapter.accepts_stage(NativeLoginStage::Form) || document.scope.adapter.reviewed_provider() };
                    if supported && !document.scope.delivered.is_empty() {
                        return Some((frame, document.scope.origin.clone()));
                    }
                    return None;
                }
                let stage = NativeLoginStage::parse(&event)?;
                if !stage_allowed(document.scope.adapter, stage, &CefString::from(&frame.url()).to_string())
                    || !document.scope.requested.insert(stage) { return None; }
                Some((frame, document.scope.origin.clone()))
            });
            if let Some((frame, origin)) = send {
                if matches!(event.as_str(), "google-completed" | "google-rejected" | "form-completed" | "form-rejected") {
                    report(&frame, if event.ends_with("-completed") { "login-completed" } else { "login-rejected" });
                    return 1;
                }
                let request_name = if event.starts_with("totp|") || event.starts_with("type|") { crate::native_totp::REQUEST } else { LOGIN_REQUEST };
                if let Some(mut message) = process_message_create(Some(&CefString::from(request_name))) {
                    if let Some(args) = message.argument_list() {
                        args.set_string(0, Some(&CefString::from(self.nonce.as_str())));
                        args.set_string(1, Some(&CefString::from(origin.as_str())));
                        args.set_string(2, Some(&CefString::from(event.as_str())));
                        frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
                    }
                }
            }
            1
        }
    }
}

fn report(frame: &Frame, status: &str) {
    let Some(origin) = feature_origin(frame) else {
        return;
    };
    let Some(mut message) = process_message_create(Some(&CefString::from(FEATURE_STATUS))) else {
        return;
    };
    let Some(args) = message.argument_list() else {
        return;
    };
    args.set_string(0, Some(&CefString::from(origin.as_str())));
    args.set_string(1, Some(&CefString::from(status)));
    args.set_string(2, Some(&CefString::from(FEATURE_PROTOCOL_PIN)));
    frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
}

fn install(browser: &Browser, frame: &Frame, context: &mut V8Context) -> bool {
    if !command_line_get_global().is_some_and(|line| forced_dark_configured(&line)) {
        return false;
    }
    let Some((adapter, factory_json)) = ADAPTERS.with(|adapters| {
        adapters
            .borrow()
            .get(&browser.identifier())
            .filter(|policy| same_browser(&policy.owner, browser))
            .map(|policy| (policy.adapter, policy.factory_json.clone()))
    }) else {
        return false;
    };
    let Some(origin) = feature_origin(frame) else {
        return false;
    };
    if context.is_valid() != 1 {
        return false;
    }
    let key = frame_key(browser, frame);
    let nonce = format!(
        "{}:{}",
        std::process::id(),
        NEXT_DOCUMENT.fetch_add(1, Ordering::Relaxed)
    );
    let mut signal = LoginSignal::new(key.clone(), nonce.clone());
    let Some(notify) = v8_value_create_function(
        Some(&CefString::from("nativeLoginReady")),
        Some(&mut signal),
    ) else {
        return false;
    };
    // Only constant, non-secret source is compiled. Credential strings are V8
    // argument values; they cannot appear in DevTools script source/error URLs.
    let script = crate::native_features::login_profiles::form_client_source();
    let mut factory = None;
    let mut exception = None;
    if context.eval(
        Some(&CefString::from(script.as_str())),
        None,
        0,
        Some(&mut factory),
        Some(&mut exception),
    ) != 1
    {
        return false;
    }
    let Some(factory) = factory.filter(|value| value.is_function() == 1) else {
        return false;
    };
    let Some(configuration) =
        parse_login_configuration(&factory_json).and_then(|value| login_configuration_v8(&value))
    else {
        return false;
    };
    // Preserve native timing metadata; provider identity always comes from
    // the selected enum, never a website or configurable script string.
    if adapter.reviewed_provider() {
        let Some(mut provider) = v8_value_create_string(Some(&CefString::from(adapter.wire())))
        else {
            return false;
        };
        if configuration.set_value_bykey(
            Some(&CefString::from("provider")),
            Some(&mut provider),
            V8Propertyattribute::default(),
        ) != 1
        {
            return false;
        }
    }
    let otp_configuration = configuration.value_bykey(Some(&CefString::from("mfa")))
        .filter(|value| value.is_object() == 1);
    let otp_challenge = otp_configuration.as_ref()
        .and_then(|value| value.value_bykey(Some(&CefString::from("id"))))
        .filter(|value| value.is_string() == 1)
        .map(|value| CefString::from(&value.string_value()).to_string());
    let otp = otp_configuration.and_then(|configuration| factory.execute_function_with_context(
        Some(context), None, Some(&[Some(notify.clone()), Some(configuration),
            v8_value_create_string(Some(&CefString::from("approved-otp")))])))
        .filter(|value| value.is_function() == 1);
    if otp_challenge.is_some() && otp.is_none() { return false; }
    let Some(deliver) = factory
        .execute_function_with_context(
            Some(context),
            None,
            Some(&[
                Some(notify),
                Some(configuration),
                v8_value_create_string(Some(&CefString::from(adapter.wire()))),
                v8_value_create_bool(1),
            ]),
        )
        .filter(|value| value.is_function() == 1)
    else {
        return false;
    };
    let typing = deliver.value_bykey(Some(&CefString::from("nativeTyping")))
        .filter(|value| value.is_function() == 1);
    DOCUMENTS.with(|documents| {
        documents.borrow_mut().insert(
            key,
            Document {
                owner: browser.clone(),
                context: context.clone(),
                deliver,
                otp,
                otp_challenge,
                typing,
                scope: DocumentScope {
                    nonce,
                    origin,
                    requested: HashSet::new(),
                    delivered: HashSet::new(),
                    adapter,
                },
            },
        );
    });
    true
}

fn receive(browser: &Browser, frame: &Frame, source: ProcessId, message: &ProcessMessage) -> i32 {
    if appearance::receive(browser, frame, source, message) { return 1; }
    if source == ProcessId::BROWSER && CefString::from(&message.name()).to_string() == crate::native_totp::DELIVERY {
        receive_totp(browser, frame, message);
        return 1;
    }
    if source == ProcessId::BROWSER
        && CefString::from(&message.name()).to_string() == automation_wire::REQUEST
    {
        receive_automation(browser, frame, message);
        return 1;
    }
    if source != ProcessId::BROWSER
        || CefString::from(&message.name()).to_string() != LOGIN_DELIVERY
    {
        return 0;
    }
    report_delivery(frame, Delivery::RendererReceived);
    let outcome = receive_delivery(browser, frame, message).unwrap_or_else(|outcome| outcome);
    report_delivery(frame, outcome);
    1
}

fn receive_totp(browser: &Browser, frame: &Frame, message: &ProcessMessage) {
    let Some(origin) = frame_origin(frame) else { return; };
    let Some(args) = message.argument_list().filter(|args| args.size() == 7) else { return; };
    let (Some(nonce), Some(command), Some(challenge)) =
        (message_text(&args, 0, 80), message_text(&args, 2, 8), message_text(&args, 6, 128)) else { return; };
    if message_text(&args, 1, 1024).as_deref() != Some(&origin)
        || !matches!(command.as_str(), "probe" | "submit" | "wait" | "cancel")
        || args.get_type(3) != ValueType::INT || args.get_type(4) != ValueType::DOUBLE
        || !args.double(4).is_finite() || args.get_type(5) != ValueType::BOOL { return; }
    let prepared = DOCUMENTS.with(|documents| {
        let documents = documents.borrow();
        let doc = documents.get(&frame_key(browser, frame))?;
        if !same_browser(&doc.owner, browser) || doc.scope.nonce != nonce || doc.scope.origin != origin
            || !frame.v8_context().is_some_and(|mut c| doc.context.is_same(Some(&mut c)) == 1) { return None; }
        let dispatch = if challenge.starts_with("type|") {
            let parts: Vec<_> = challenge.split('|').collect();
            if parts.len() != 3 { return None; }
            let stage = NativeLoginStage::parse(parts[1])?;
            if !doc.scope.delivered.contains(&stage) { return None; }
            doc.typing.clone()?
        } else {
            if doc.otp_challenge.as_deref() != Some(&challenge) { return None; }
            doc.otp.clone()?
        };
        Some((doc.context.clone(), dispatch))
    });
    let Some((mut context, dispatch)) = prepared else { return; };
    if context.is_valid() != 1 || context.enter() != 1 { return; }
    let values = [v8_value_create_string(Some(&CefString::from(command.as_str()))),
        v8_value_create_int(args.int(3)), v8_value_create_double(args.double(4)), v8_value_create_bool(args.bool(5)),
        v8_value_create_string(Some(&CefString::from(challenge.as_str())))];
    // No RefCell or native lock is held across a reentrant V8 callback.
    let _ = dispatch.execute_function_with_context(Some(&mut context), None, Some(&values));
    context.exit();
}

// This callback can acknowledge only a previously native-dispatched operation,
// or append one strictly typed value-free step to a native-started recorder.
// It cannot request permissions, credentials, navigation, or app operations.
wrap_v8_handler! {
    struct AutomationSignal { key: DocumentKey, token: String }
    impl V8Handler {
        fn execute(&self, _name: Option<&CefString>, _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>, _retval: Option<&mut Option<V8Value>>,
            _exception: Option<&mut CefString>) -> i32 {
            let Some(args) = arguments.filter(|args| args.len() == 5) else { return 1; };
            let read = |index: usize, max: usize| -> Option<String> {
                let value = args.get(index)?.as_ref().filter(|value| value.is_string() == 1)?;
                automation_wire::string_value(&CefString::from(&value.string_value()), max)
            };
            let (Some(serial), Some(status)) = (read(0, 32), read(1, 8)) else { return 1; };
            let Some(mut current) = v8_context_get_current_context() else { return 1; };
            let Some(frame) = current.frame() else { return 1; };
            let Some(browser) = current.browser() else { return 1; };
            let response = AUTOMATION_DOCUMENTS.with(|documents| {
                let mut documents = documents.borrow_mut();
                let doc = documents.get_mut(&self.key)?;
                if doc.token != self.token || doc.context.is_same(Some(&mut current)) != 1 || !doc.current(&browser, &frame) { return None; }
                if status == "step" {
                    if manual_input::sensitive(&browser, &frame) { return None; }
                    if !serial.is_empty() { return None; }
                    let selector = read(3, 512)?;
                    let step = match read(2, 8)?.as_str() {
                        "click" => NativeAutomationStep::Click { selector },
                        "fill" => NativeAutomationStep::Fill { selector },
                        "check" => NativeAutomationStep::Check { selector, checked: args[4].as_ref().filter(|v| v.is_bool() == 1)?.bool_value() == 1 },
                        _ => return None,
                    };
                    doc.recorder.push(step, Instant::now());
                    return None;
                }
                if !matches!(status.as_str(), "ok" | "failed") { return None; }
                let (request, deadline) = doc.pending.remove(&serial)?;
                if Instant::now() >= deadline { return None; }
                Some((doc.token.clone(), doc.origin.clone(), request))
            });
            if let Some((token, origin, request)) = response {
                automation_wire::reply(&frame, &serial, &token, &origin, &request, &status, (&[], false));
            }
            1
        }
    }
}

fn install_automation(browser: &Browser, frame: &Frame, context: &mut V8Context) {
    let Some(origin) = frame_origin(frame) else {
        return;
    };
    if context.is_valid() != 1
        || !ADAPTERS.with(|adapters| {
            adapters
                .borrow()
                .get(&browser.identifier())
                .is_some_and(|entry| same_browser(&entry.owner, browser))
        })
    {
        return;
    }
    let key = frame_key(browser, frame);
    let token = format!(
        "{}:{}",
        std::process::id(),
        NEXT_DOCUMENT.fetch_add(1, Ordering::Relaxed)
    );
    let mut signal = AutomationSignal::new(key.clone(), token.clone());
    let Some(notify) = v8_value_create_function(
        Some(&CefString::from("nativeAutomationResult")),
        Some(&mut signal),
    ) else {
        return;
    };
    let (mut factory, mut exception) = (None, None);
    if context.eval(
        Some(&CefString::from(automation::AUTOMATION_FACTORY)),
        None,
        0,
        Some(&mut factory),
        Some(&mut exception),
    ) != 1
    {
        return;
    }
    let Some(factory) = factory.filter(|value| value.is_function() == 1) else {
        return;
    };
    let Some(dispatch) = factory
        .execute_function_with_context(Some(context), None, Some(&[Some(notify)]))
        .filter(|value| value.is_function() == 1)
    else {
        return;
    };
    AUTOMATION_DOCUMENTS.with(|documents| {
        documents.borrow_mut().insert(
            key,
            AutomationDocument {
                owner: browser.clone(),
                context: context.clone(),
                dispatch,
                token,
                generation: None,
                ready: false,
                origin,
                url: CefString::from(&frame.url()).to_string(),
                used: HashSet::new(),
                pending: HashMap::new(),
                recorder: automation::Recorder::default(),
            },
        )
    });
}

fn receive_automation(browser: &Browser, frame: &Frame, message: &ProcessMessage) {
    if frame_origin(frame).is_none() {
        return;
    }
    let Some(args) = message.argument_list() else {
        return;
    };
    let Some((serial, generation, action)) = automation_wire::decode_action(&args) else {
        return;
    };
    let Ok(generation) = generation.parse::<u64>() else {
        return;
    };
    let key = frame_key(browser, frame);
    let prepared = AUTOMATION_DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        let doc = documents.get_mut(&key)?;
        if !doc.current_context(browser, frame) {
            return None;
        }
        let reset = if matches!(action, NativeAutomationAction::Document {}) {
            doc.acquire_generation(generation, &CefString::from(&frame.url()).to_string())?
        } else {
            false
        };
        if let Some((token, origin, request)) = action.scope() {
            if Some(generation) != doc.generation
                || !doc.current(browser, frame)
                || token != doc.token
                || origin != doc.origin
            {
                return None;
            }
            // Bounded replay protection lives with the actual V8 context.
            if !matches!(action, NativeAutomationAction::Cancel { .. })
                && (doc.used.len() >= 4096 || !doc.used.insert(request.to_owned()))
            {
                return None;
            }
            doc.pending
                .retain(|_, (_, deadline)| Instant::now() < *deadline);
            if doc.pending.len() >= 4 && !matches!(action, NativeAutomationAction::Cancel { .. }) {
                return None;
            }
            if matches!(action, NativeAutomationAction::Script { .. }) {
                doc.pending.insert(
                    serial.clone(),
                    (
                        request.to_owned(),
                        Instant::now()
                            + Duration::from_millis(automation::AUTOMATION_TIMEOUT_MS as u64),
                    ),
                );
            }
            if matches!(action, NativeAutomationAction::RecordStart { .. })
                && !doc.recorder.start(Instant::now())
            {
                return None;
            }
        }
        Some((
            doc.context.clone(),
            doc.dispatch.clone(),
            doc.token.clone(),
            doc.origin.clone(),
            reset,
        ))
    });
    let Some((mut context, dispatch, token, origin, reset)) = prepared else {
        let (token, origin, request) = action.scope().unwrap_or(("", "", ""));
        automation_wire::reply(
            frame,
            &serial,
            token,
            origin,
            request,
            "stale",
            (&[], false),
        );
        return;
    };
    if matches!(action, NativeAutomationAction::Document {}) && !reset {
        automation_wire::reply(
            frame,
            &serial,
            &token,
            &origin,
            "",
            "document",
            (&[], false),
        );
        return;
    }
    let request = action
        .scope()
        .map(|(_, _, request)| request)
        .unwrap_or_default();
    if context.enter() != 1 {
        automation_wire::reply(
            frame,
            &serial,
            &token,
            &origin,
            request,
            "failed",
            (&[], false),
        );
        return;
    }
    let values = [
        v8_value_create_string(Some(&CefString::from(serial.as_str()))),
        v8_value_create_string(Some(&CefString::from(
            if matches!(action, NativeAutomationAction::Document {}) {
                "reset".into()
            } else {
                automation_wire::text(&args, 1, 16).unwrap_or_default()
            }
            .as_str(),
        ))),
        v8_value_create_string(Some(&CefString::from(
            automation_wire::text(&args, 5, automation::MAX_SCRIPT_BYTES)
                .unwrap_or_default()
                .as_str(),
        ))),
        v8_value_create_string(Some(&CefString::from(
            automation_wire::text(&args, 6, 8)
                .unwrap_or_default()
                .as_str(),
        ))),
        v8_value_create_string(Some(&CefString::from(
            automation_wire::text(&args, 7, 4096)
                .unwrap_or_default()
                .as_str(),
        ))),
        v8_value_create_bool(i32::from(
            args.get_type(8) == ValueType::BOOL && args.bool(8) == 1,
        )),
    ];
    let success = dispatch
        .execute_function_with_context(Some(&mut context), None, Some(&values))
        .is_some_and(|value| value.is_bool() == 1 && value.bool_value() == 1);
    context.exit();
    if matches!(action, NativeAutomationAction::Document {}) {
        AUTOMATION_DOCUMENTS.with(|documents| {
            if let Some(doc) = documents
                .borrow_mut()
                .get_mut(&key)
                .filter(|doc| doc.token == token && doc.generation == Some(generation))
            {
                doc.ready = success;
            }
        });
        automation_wire::reply(
            frame,
            &serial,
            &token,
            &origin,
            "",
            if success { "document" } else { "failed" },
            (&[], false),
        );
        return;
    }
    if matches!(action, NativeAutomationAction::Script { .. }) && success {
        return;
    }
    let (steps, truncated) = AUTOMATION_DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        let Some(doc) = documents.get_mut(&key).filter(|doc| doc.token == token) else {
            return (Vec::new(), false);
        };
        doc.pending.remove(&serial);
        match action {
            NativeAutomationAction::RecordStop { .. } => doc.recorder.stop(Instant::now()),
            NativeAutomationAction::Cancel { .. } => {
                doc.recorder.cancel();
                doc.pending.clear();
                (Vec::new(), false)
            }
            NativeAutomationAction::RecordStart { .. } if !success => {
                doc.recorder.cancel();
                (Vec::new(), false)
            }
            _ => (Vec::new(), false),
        }
    });
    let status = if !success {
        "failed"
    } else if matches!(action, NativeAutomationAction::RecordStop { .. }) {
        "stopped"
    } else {
        "ok"
    };
    automation_wire::reply(
        frame,
        &serial,
        &token,
        &origin,
        request,
        status,
        (&steps, truncated),
    );
}

fn report_delivery(frame: &Frame, status: Delivery) {
    let (Some(origin), Some(code)) = (frame_origin(frame), status.renderer_wire()) else {
        return;
    };
    let Some(mut message) = process_message_create(Some(&CefString::from(LOGIN_DELIVERY_STATUS)))
    else {
        return;
    };
    let Some(args) = message.argument_list() else {
        return;
    };
    args.set_string(0, Some(&CefString::from(origin.as_str())));
    args.set_string(1, Some(&CefString::from(FEATURE_PROTOCOL_PIN)));
    args.set_int(2, code);
    frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
}

// No Debug: this transient packet contains credential and extra-field values.
struct LoginDeliveryPayload {
    nonce: String,
    stage: NativeLoginStage,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
    auto_submit: i32,
    deadline: f64,
    options: Value,
}

fn login_delivery_payload(args: &ListValue, origin: &str) -> Option<LoginDeliveryPayload> {
    if args.size() != 8
        || args.get_type(4) != ValueType::BOOL
        || args.get_type(5) != ValueType::DOUBLE
    {
        return None;
    }
    let nonce = message_text(args, 0, 80).filter(|value| !value.is_empty())?;
    if message_text(args, 1, 1024).as_deref() != Some(origin) {
        return None;
    }
    let stage = message_text(args, 6, 16).and_then(|value| NativeLoginStage::parse(&value))?;
    let username = Zeroizing::new(message_text(args, 2, MAX_CREDENTIAL_BYTES)?);
    let password = Zeroizing::new(message_text(args, 3, MAX_CREDENTIAL_BYTES)?);
    // A staged provider receives only the field required for that stage.
    if match stage {
        NativeLoginStage::Form | NativeLoginStage::BoundPassword => {
            username.is_empty() || password.is_empty()
        }
        NativeLoginStage::FormPrepare
        | NativeLoginStage::FormSubmit
        | NativeLoginStage::IdentifierSubmit
        | NativeLoginStage::PasswordSubmit => !username.is_empty() || !password.is_empty(),
        NativeLoginStage::Identifier => username.is_empty() || !password.is_empty(),
        NativeLoginStage::Password => password.is_empty() || !username.is_empty(),
    } {
        return None;
    }
    let deadline = args.double(5);
    if !deadline.is_finite() || deadline <= 0.0 {
        return None;
    }
    let options_json = Zeroizing::new(message_text(args, 7, MAX_LOGIN_CONFIGURATION_BYTES)?);
    if matches!(
        stage,
        NativeLoginStage::Identifier | NativeLoginStage::Password | NativeLoginStage::BoundPassword
    ) && options_json.as_str() != DEFAULT_FORM_OPTIONS
    {
        return None;
    }
    let options = parse_login_configuration(&options_json)?;
    if stage == NativeLoginStage::FormPrepare || stage.is_action() {
        let fields = options
            .dictionary()?
            .value(Some(&CefString::from("fields")))?
            .list()?;
        if fields.size() != 0 {
            return None;
        }
    }
    Some(LoginDeliveryPayload {
        nonce,
        stage,
        username,
        password,
        auto_submit: args.bool(4),
        deadline,
        options,
    })
}

fn receive_delivery(
    browser: &Browser,
    frame: &Frame,
    message: &ProcessMessage,
) -> Result<Delivery, Delivery> {
    let Some(origin) = frame_origin(frame) else {
        return Err(Delivery::RendererRejectedFrame);
    };
    let Some(payload) = message
        .argument_list()
        .and_then(|args| login_delivery_payload(&args, &origin))
    else {
        return Err(Delivery::RendererRejectedPayload);
    };
    let document = DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        let key = frame_key(browser, frame);
        let document = documents
            .get_mut(&key)
            .ok_or(Delivery::RendererMissingDocument)?;
        if !same_browser(&document.owner, browser) {
            return Err(Delivery::RendererRejectedDocument);
        }
        if !frame
            .v8_context()
            .is_some_and(|mut current| document.context.is_same(Some(&mut current)) == 1)
        {
            return Err(Delivery::RendererRejectedContext);
        }
        document.scope.claim(
            &payload.nonce,
            &origin,
            payload.stage,
            &CefString::from(&frame.url()).to_string(),
        )?;
        Ok((
            document.context.clone(),
            document.deliver.clone(),
            document.scope.adapter,
        ))
    });
    let (mut context, deliver, adapter) = document?;
    if context.is_valid() != 1 {
        return Err(Delivery::RendererRejectedContext);
    }
    // Process-message callbacks have no current V8 context. Enter before
    // constructing V8 values, then balance the scope even when a page throws.
    if context.enter() != 1 {
        return Err(Delivery::RendererRejectedContext);
    }
    let options = if adapter == NativeLoginAdapter::Google || adapter.reviewed_provider() {
        v8_value_create_string(Some(&CefString::from(payload.stage.wire())))
    } else {
        login_configuration_v8(&payload.options)
    };
    let Some(options) = options else {
        context.exit();
        return Err(Delivery::RendererRejectedPayload);
    };
    let values = [
        v8_value_create_string(Some(&CefString::from(origin.as_str()))),
        v8_value_create_string(Some(&CefString::from(payload.username.as_str()))),
        v8_value_create_string(Some(&CefString::from(payload.password.as_str()))),
        v8_value_create_bool(payload.auto_submit),
        v8_value_create_double(payload.deadline),
        Some(options),
        v8_value_create_string(Some(&CefString::from(payload.stage.wire()))),
    ];
    report_delivery(frame, Delivery::RendererExecuting);
    let result = deliver.execute_function_with_context(Some(&mut context), None, Some(&values));
    let completed = result.is_some_and(|value| value.is_bool() == 1 && value.bool_value() == 1);
    context.exit();
    // A true return only accepts deferred processing. Completion comes from
    // the fixed form/google callback after the actual adapter finishes.
    if !completed {
        report(frame, "login-rejected");
    }
    // CEF/V8 owns transient copies; no persistence, logs or secret source code.
    Ok(if completed {
        Delivery::RendererAccepted
    } else {
        Delivery::RendererRejected
    })
}

wrap_render_process_handler! {
    struct WebsiteRenderer;
    impl RenderProcessHandler {
        fn on_browser_created(&self, browser: Option<&mut Browser>, extra_info: Option<&mut DictionaryValue>) {
            let (Some(browser), Some(info)) = (browser, extra_info) else { return; };
            if !matches!(info.size(), 3..=5) || info.get_type(Some(&CefString::from("feature-pin"))) != ValueType::STRING
                || info.get_type(Some(&CefString::from("login-adapter"))) != ValueType::STRING
                || CefString::from(&info.string(Some(&CefString::from("feature-pin")))).to_string() != FEATURE_PROTOCOL_PIN { return; }
            let selected = CefString::from(&info.string(Some(&CefString::from("login-adapter")))).to_string();
            if info.get_type(Some(&CefString::from("login-factory-json"))) != ValueType::STRING { return; }
            let factory_json = CefString::from(&info.string(Some(&CefString::from("login-factory-json")))).to_string();
            if parse_login_configuration(&factory_json).is_none() { return; }
            // A failed optional appearance install keeps native prepaint dark;
            // it must not disable login or prevent the browser from opening.
            let _ = appearance::created(browser, info);
            let adapter = NativeLoginAdapter::from_wire(&selected);
            ADAPTERS.with(|adapters| adapters.borrow_mut().insert(browser.identifier(), BrowserAdapter {
                owner: browser.clone(), adapter, factory_json,
            }));
        }
        fn on_context_created(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>, context: Option<&mut V8Context>) {
            if let (Some(browser), Some(frame), Some(context)) = (browser, frame, context) {
                let _ = appearance::install(browser, frame, context);
                manual_input::install(browser, frame, context);
                if feature_origin(frame).is_some() {
                    let installed = install(browser, frame, context);
                    if installed { install_automation(browser, frame, context); }
                    report(frame, if installed { "installed" } else { "installation-failed" });
                }
            }
        }
        fn on_context_released(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>, context: Option<&mut V8Context>) {
            if let Some(context) = context { forget_context(context); }
        }
        fn on_browser_destroyed(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                forget_browser(browser);
            }
        }
        fn on_process_message_received(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>, source_process: ProcessId, message: Option<&mut ProcessMessage>) -> i32 {
            match (browser, frame, message) {
                (Some(browser), Some(frame), Some(message)) => {
                    if manual_input::receive(browser, frame, source_process, message) { 1 }
                    else { receive(browser, frame, source_process, message) }
                },
                _ => 0,
            }
        }
    }
}

pub(crate) fn handler() -> RenderProcessHandler {
    WebsiteRenderer::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Rust-owned CEF vtables reproduce renderer instance identity without
    // creating a browser, launching a process, or touching real credentials.
    mod lifecycle_mocks {
        use super::*;
        use cef::rc::{ConvertReturnValue, RcImpl};
        use cef::sys::{_cef_browser_t, _cef_v8_context_t, _cef_v8_value_t};
        use std::os::raw::c_int;

        pub(super) fn browser(id: c_int) -> Browser {
            extern "C" fn identifier(this: *mut _cef_browser_t) -> c_int {
                RcImpl::<_cef_browser_t, c_int>::get(this).interface
            }
            extern "C" fn same(this: *mut _cef_browser_t, other: *mut _cef_browser_t) -> c_int {
                if other.is_null() {
                    return 0;
                }
                let same = i32::from(this == other);
                // Generated bindings transfer one reference for CEF arguments.
                let _other: Browser = other.wrap_result();
                same
            }
            let raw = _cef_browser_t {
                get_identifier: Some(identifier),
                is_same: Some(same),
                // SAFETY: Unused CEF entries are nullable. RcImpl owns the base.
                ..unsafe { std::mem::zeroed() }
            };
            let raw: *mut _cef_browser_t = RcImpl::new(raw, id).cast();
            raw.wrap_result()
        }

        pub(super) fn context() -> V8Context {
            extern "C" fn same(
                this: *mut _cef_v8_context_t,
                other: *mut _cef_v8_context_t,
            ) -> c_int {
                if other.is_null() {
                    return 0;
                }
                let same = i32::from(this == other);
                let _other: V8Context = other.wrap_result();
                same
            }
            let raw = _cef_v8_context_t {
                is_same: Some(same),
                // SAFETY: No V8 execution; RcImpl supplies all refcount methods.
                ..unsafe { std::mem::zeroed() }
            };
            let raw: *mut _cef_v8_context_t = RcImpl::new(raw, ()).cast();
            raw.wrap_result()
        }

        pub(super) fn document(owner: &Browser, context: &V8Context) -> Document {
            // SAFETY: This placeholder is only retained/released, never invoked.
            let raw: _cef_v8_value_t = unsafe { std::mem::zeroed() };
            let raw: *mut _cef_v8_value_t = RcImpl::new(raw, ()).cast();
            let mut scope = document_scope(NativeLoginAdapter::Generic, "https://fixture.test");
            scope.requested.insert(NativeLoginStage::Form);
            Document {
                owner: owner.clone(),
                context: context.clone(),
                deliver: raw.wrap_result(),
                otp: None,
                otp_challenge: None,
                typing: None,
                scope,
            }
        }
    }

    fn automation_document(owner: &Browser, context: &V8Context) -> AutomationDocument {
        let login = lifecycle_mocks::document(owner, context);
        AutomationDocument {
            owner: login.owner,
            context: login.context,
            dispatch: login.deliver,
            token: "123:7".into(),
            generation: None,
            ready: false,
            origin: "https://fixture.test".into(),
            url: "https://fixture.test/page".into(),
            used: HashSet::new(),
            pending: HashMap::new(),
            recorder: automation::Recorder::default(),
        }
    }

    #[test]
    fn native_automation_generation_reset_discards_recording_and_old_async_completion() {
        let owner = lifecycle_mocks::browser(101);
        let context = lifecycle_mocks::context();
        let mut doc = automation_document(&owner, &context);
        assert_eq!(
            doc.acquire_generation(1, "https://fixture.test/page"),
            Some(true)
        );
        doc.ready = true;
        assert!(doc.recorder.start(Instant::now()));
        doc.recorder.push(
            NativeAutomationStep::Fill {
                selector: "html > body > input:nth-of-type(1)".into(),
            },
            Instant::now(),
        );
        doc.pending.insert(
            "old-operation".into(),
            ("request-1".into(), Instant::now() + Duration::from_secs(15)),
        );
        // A routine document getter cannot stop an existing recording.
        assert_eq!(
            doc.acquire_generation(1, "https://fixture.test/page"),
            Some(false)
        );
        assert_eq!(doc.pending.len(), 1);
        assert_eq!(
            doc.acquire_generation(1, "https://fixture.test/other"),
            None
        );
        // Away/back can have the same context and exact URL; generation wins.
        assert_eq!(
            doc.acquire_generation(3, "https://fixture.test/page"),
            Some(true)
        );
        assert!(doc.pending.is_empty());
        assert_eq!(doc.recorder.stop(Instant::now()), (vec![], false));
        assert!(!doc.ready);
        assert_eq!(doc.acquire_generation(2, "https://fixture.test/page"), None);
        // Failed installation must be retried, never acknowledged as ready.
        assert_eq!(
            doc.acquire_generation(3, "https://fixture.test/page"),
            Some(true)
        );
    }

    #[test]
    fn native_automation_old_browser_and_context_release_preserve_successor_instance() {
        let old = lifecycle_mocks::browser(102);
        let successor = lifecycle_mocks::browser(102);
        let mut old_context = lifecycle_mocks::context();
        let mut current_context = lifecycle_mocks::context();
        let old_key = (102, "old-frame".into());
        let key = (102, "successor-frame".into());
        AUTOMATION_DOCUMENTS.with(|docs| {
            docs.borrow_mut()
                .insert(old_key.clone(), automation_document(&old, &old_context));
            docs.borrow_mut().insert(
                key.clone(),
                automation_document(&successor, &current_context),
            );
        });
        forget_browser(&old);
        forget_context(&mut old_context);
        AUTOMATION_DOCUMENTS.with(|docs| {
            assert!(!docs.borrow().contains_key(&old_key));
            assert!(same_browser(&docs.borrow()[&key].owner, &successor));
        });
        assert!(old_context.has_one_ref());
        forget_context(&mut current_context);
        assert!(current_context.has_one_ref());
        AUTOMATION_DOCUMENTS.with(|docs| assert!(!docs.borrow().contains_key(&key)));
    }

    #[test]
    fn native_automation_wire_accepts_empty_document_request_and_fill_values() {
        native_api();
        let args = list_value_create().unwrap();
        automation_wire::string(&args, 0, "");
        // CEF represents a present empty STRING with a null/zero-length buffer.
        // Document replies deliberately have an empty request ID, and clearing
        // an ordinary input is a legitimate macro operation.
        assert_eq!(automation_wire::text(&args, 0, 32), Some(String::new()));
        assert_eq!(automation_wire::text(&args, 1, 32), None);
        args.set_null(0);
        assert_eq!(automation_wire::text(&args, 0, 32), None);
        let action = NativeAutomationAction::Step {
            document_token: "123:7".into(),
            origin: "https://fixture.test".into(),
            request_id: "clear-input".into(),
            step: NativeAutomationStep::Fill {
                selector: "html > body > input:nth-of-type(1)".into(),
            },
            value: Some(String::new()),
        };
        automation_wire::encode_action(&args, "1", &action, 3);
        assert!(
            matches!(automation_wire::decode_action(&args), Some((_, _, NativeAutomationAction::Step { value: Some(value), .. })) if value.is_empty())
        );
        automation_wire::string(&args, 0, "a".repeat(33).as_str());
        assert_eq!(automation_wire::text(&args, 0, 32), None);
    }

    #[test]
    fn native_automation_typed_cef_wire_bounds_generation_and_action_shape() {
        native_api();
        let message =
            process_message_create(Some(&CefString::from(automation_wire::REQUEST))).unwrap();
        let args = message.argument_list().unwrap();
        let action = NativeAutomationAction::Step {
            document_token: "123:7".into(),
            origin: "https://fixture.test".into(),
            request_id: "request-1".into(),
            step: NativeAutomationStep::Fill {
                selector: "html > body > input:nth-of-type(1)".into(),
            },
            value: Some("synthetic".into()),
        };
        automation_wire::encode_action(&args, "1", &action, 3);
        let (serial, generation, decoded) = automation_wire::decode_action(&args).unwrap();
        assert_eq!((serial.as_str(), generation.as_str()), ("1", "3"));
        assert!(
            matches!(decoded, NativeAutomationAction::Step { value: Some(value), .. } if value == "synthetic")
        );
        automation_wire::string(&args, 9, "03");
        assert!(automation_wire::decode_action(&args).is_none());
        automation_wire::string(&args, 9, "3");
        automation_wire::string(&args, 5, "input[name=password]");
        assert!(automation_wire::decode_action(&args).is_none());
        automation_wire::encode_action(&args, "1", &action, 3);
        automation_wire::string(&args, 1, "credentials");
        assert!(automation_wire::decode_action(&args).is_none());
        automation_wire::encode_action(&args, "1", &action, 3);
        args.set_size(11);
        assert!(automation_wire::decode_action(&args).is_none());
    }

    #[test]
    fn native_automation_typed_cef_recorded_steps_reject_unknown_kind_and_overflow() {
        native_api();
        let args = list_value_create().unwrap();
        args.set_size(10);
        args.set_int(6, 1);
        automation_wire::string(&args, 7, "fill");
        automation_wire::string(&args, 8, "html > body > input:nth-of-type(1)");
        args.set_bool(9, 0);
        assert_eq!(automation_wire::steps(&args).unwrap().len(), 1);
        automation_wire::string(&args, 7, "password");
        assert!(automation_wire::steps(&args).is_none());
        args.set_int(6, 201);
        assert!(automation_wire::steps(&args).is_none());
        args.set_int(6, -1);
        assert!(automation_wire::steps(&args).is_none());
    }

    #[test]
    fn late_old_browser_destroy_preserves_same_id_successor_login_and_adapter() {
        let mut old = lifecycle_mocks::browser(17);
        let mut successor = lifecycle_mocks::browser(17);
        assert_eq!(old.identifier(), successor.identifier());
        assert!(!same_browser(&old, &successor));
        let old_context = lifecycle_mocks::context();
        let successor_context = lifecycle_mocks::context();
        let old_key = (17, "old-frame".into());
        let successor_key = (17, "successor-frame".into());
        DOCUMENTS.with(|documents| {
            let mut documents = documents.borrow_mut();
            documents.insert(
                old_key.clone(),
                lifecycle_mocks::document(&old, &old_context),
            );
            documents.insert(
                successor_key.clone(),
                lifecycle_mocks::document(&successor, &successor_context),
            );
        });
        ADAPTERS.with(|adapters| {
            adapters.borrow_mut().insert(
                17,
                BrowserAdapter {
                    owner: successor.clone(),
                    adapter: NativeLoginAdapter::Generic,
                    factory_json: "{}".into(),
                },
            )
        });
        let renderer = handler();
        // Pinned CEF ordering: successor created/requests login, THEN old dies.
        renderer.on_browser_destroyed(Some(&mut old));
        DOCUMENTS.with(|documents| {
            let mut documents = documents.borrow_mut();
            assert!(!documents.contains_key(&old_key));
            let document = documents
                .get_mut(&successor_key)
                .expect("successor must survive");
            assert!(same_browser(&document.owner, &successor));
            assert_eq!(
                document.scope.claim(
                    "synthetic-document",
                    "https://fixture.test",
                    NativeLoginStage::Form,
                    "https://fixture.test/login"
                ),
                Ok(())
            );
            assert_eq!(
                document.scope.claim(
                    "synthetic-document",
                    "https://fixture.test",
                    NativeLoginStage::Form,
                    "https://fixture.test/login"
                ),
                Err(Delivery::RendererReplay)
            );
        });
        ADAPTERS.with(|adapters| assert!(same_browser(&adapters.borrow()[&17].owner, &successor)));
        assert!(old_context.has_one_ref());
        assert!(!successor_context.has_one_ref());
        renderer.on_browser_destroyed(Some(&mut successor));
        DOCUMENTS.with(|documents| assert!(!documents.borrow().contains_key(&successor_key)));
        ADAPTERS.with(|adapters| assert!(!adapters.borrow().contains_key(&17)));
        assert!(successor_context.has_one_ref());
    }

    #[test]
    fn context_release_drops_exact_context_without_frame_key_or_successor_loss() {
        let owner = lifecycle_mocks::browser(23);
        let mut old_context = lifecycle_mocks::context();
        let mut successor_context = lifecycle_mocks::context();
        let old_key = (23, "retired-frame-identifier".into());
        let successor_key = (23, "current-frame-identifier".into());
        DOCUMENTS.with(|documents| {
            let mut documents = documents.borrow_mut();
            documents.insert(
                old_key.clone(),
                lifecycle_mocks::document(&owner, &old_context),
            );
            documents.insert(
                successor_key.clone(),
                lifecycle_mocks::document(&owner, &successor_context),
            );
        });
        let renderer = handler();
        renderer.on_context_released(None, None, Some(&mut old_context));
        DOCUMENTS.with(|documents| {
            assert!(!documents.borrow().contains_key(&old_key));
            assert!(documents.borrow().contains_key(&successor_key));
        });
        assert!(old_context.has_one_ref());
        assert!(!successor_context.has_one_ref());
        // Duplicate/stale release cannot erase the successor.
        renderer.on_context_released(None, None, Some(&mut old_context));
        DOCUMENTS.with(|documents| assert!(documents.borrow().contains_key(&successor_key)));
        renderer.on_context_released(None, None, Some(&mut successor_context));
        DOCUMENTS.with(|documents| assert!(!documents.borrow().contains_key(&successor_key)));
        assert!(successor_context.has_one_ref());
    }

    fn document_scope(adapter: NativeLoginAdapter, origin: &str) -> DocumentScope {
        DocumentScope {
            nonce: "synthetic-document".into(),
            origin: origin.into(),
            adapter,
            requested: HashSet::new(),
            delivered: HashSet::new(),
        }
    }

    #[test]
    fn document_delivery_requires_exact_nonce_origin_requested_stage_and_single_use() {
        let origin = "https://fixture.test";
        let mut scope = document_scope(NativeLoginAdapter::Generic, origin);
        let stage = NativeLoginStage::Form;
        assert_eq!(
            scope.claim("synthetic-document", origin, stage, origin),
            Err(Delivery::RendererStageNotRequested)
        );
        scope.requested.insert(stage);
        assert_eq!(
            scope.claim("old-document", origin, stage, origin),
            Err(Delivery::RendererNonceMismatch)
        );
        assert_eq!(
            scope.claim("synthetic-document", "https://other.test", stage, origin),
            Err(Delivery::RendererOriginMismatch)
        );
        assert_eq!(
            scope.claim("synthetic-document", origin, stage, "http://fixture.test"),
            Err(Delivery::RendererStageNotAllowed)
        );
        assert!(scope.delivered.is_empty());
        assert_eq!(
            scope.claim("synthetic-document", origin, stage, origin),
            Ok(())
        );
        assert_eq!(
            scope.claim("synthetic-document", origin, stage, origin),
            Err(Delivery::RendererReplay)
        );
    }

    #[test]
    fn google_document_delivery_does_not_transfer_stage_or_document_authority() {
        let origin = "https://accounts.google.com";
        let identifier = "https://accounts.google.com/v3/signin/identifier";
        let password = "https://accounts.google.com/v3/signin/challenge/pwd";
        let mut scope = document_scope(NativeLoginAdapter::Google, origin);
        scope.requested.insert(NativeLoginStage::Identifier);
        assert_eq!(
            scope.claim(
                "synthetic-document",
                origin,
                NativeLoginStage::Identifier,
                password
            ),
            Err(Delivery::RendererStageNotAllowed)
        );
        assert_eq!(
            scope.claim(
                "synthetic-document",
                origin,
                NativeLoginStage::Identifier,
                identifier
            ),
            Ok(())
        );
        assert_eq!(
            scope.claim(
                "synthetic-document",
                origin,
                NativeLoginStage::Password,
                password
            ),
            Err(Delivery::RendererStageNotRequested)
        );
        scope.requested.insert(NativeLoginStage::Password);
        assert_eq!(
            scope.claim(
                "synthetic-document",
                origin,
                NativeLoginStage::Password,
                password
            ),
            Ok(())
        );
        let mut successor = document_scope(NativeLoginAdapter::Google, origin);
        successor.nonce = "successor-document".into();
        successor.requested.insert(NativeLoginStage::Password);
        assert_eq!(
            successor.claim(
                "synthetic-document",
                origin,
                NativeLoginStage::Password,
                password
            ),
            Err(Delivery::RendererNonceMismatch)
        );
        assert!(successor.delivered.is_empty());
    }

    fn native_api() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        crate::bootstrap_platform::select_pinned_api().unwrap();
    }

    #[test]
    fn native_login_configuration_is_bounded_object_data_not_executable_source() {
        native_api();
        for json in [
            "{}",
            DEFAULT_FORM_OPTIONS,
            r##"{"selectors":{"username":"#user","password":"#pass"},"readiness":{"timeoutMs":8000},"readinessProfile":"cpanel"}"##,
            r#"{"fields":[{"value":""}]}"#,
        ] {
            assert!(parse_login_configuration(json).is_some());
        }
        for json in [
            "null",
            "[]",
            "true",
            "function(){return {}}",
            r#"{"x":Infinity}"#,
            r#"{"__proto__":{"polluted":true}}"#,
            r#"{"fields":[{"constructor":{"prototype":{}}}]}"#,
        ] {
            assert!(parse_login_configuration(json).is_none());
        }
        assert!(parse_login_configuration(&format!(
            r#"{{"value":"{}"}}"#,
            "x".repeat(MAX_LOGIN_CONFIGURATION_BYTES)
        ))
        .is_none());
        let deeply_nested = format!("{}0{}", "{\"child\":".repeat(10), "}".repeat(10));
        assert!(parse_login_configuration(&deeply_nested).is_none());
        let wide = format!("{{\"fields\":[{}]}}", vec!["0"; 1025].join(","));
        assert!(parse_login_configuration(&wide).is_none());
    }

    fn login_payload_fixture() -> ListValue {
        let args = list_value_create().unwrap();
        for (index, value) in [
            (0, "synthetic-document"),
            (1, "https://fixture.test"),
            (2, "synthetic-user"),
            (3, "synthetic-password"),
            (6, "form"),
            (7, DEFAULT_FORM_OPTIONS),
        ] {
            args.set_string(index, Some(&CefString::from(value)));
        }
        args.set_bool(4, 0);
        args.set_double(5, 2_000_000_000_000.0);
        args
    }

    // Chromium base::Value fatally rejects non-finite doubles at construction.
    // A Rust-owned getter facade tests our defensive reader without asking CEF
    // to construct an impossible JSON value. All other reads use the real list.
    fn login_payload_with_mock_deadline(deadline: f64) -> ListValue {
        use cef::rc::{ConvertReturnValue, RcImpl};
        use cef::sys::{_cef_list_value_t, cef_string_userfree_t, cef_value_type_t};
        struct Payload {
            inner: ListValue,
            deadline: f64,
        }
        extern "C" fn size(this: *mut _cef_list_value_t) -> usize {
            RcImpl::<_cef_list_value_t, Payload>::get(this).interface.inner.size()
        }
        extern "C" fn kind(this: *mut _cef_list_value_t, index: usize) -> cef_value_type_t {
            RcImpl::<_cef_list_value_t, Payload>::get(this).interface.inner.get_type(index).into()
        }
        extern "C" fn string(this: *mut _cef_list_value_t, index: usize) -> cef_string_userfree_t {
            RcImpl::<_cef_list_value_t, Payload>::get(this).interface.inner.string(index).into()
        }
        extern "C" fn boolean(this: *mut _cef_list_value_t, index: usize) -> i32 {
            RcImpl::<_cef_list_value_t, Payload>::get(this).interface.inner.bool(index)
        }
        extern "C" fn double(this: *mut _cef_list_value_t, index: usize) -> f64 {
            let payload = &RcImpl::<_cef_list_value_t, Payload>::get(this).interface;
            if index == 5 { payload.deadline } else { payload.inner.double(index) }
        }
        let raw = _cef_list_value_t {
            get_size: Some(size),
            get_type: Some(kind),
            get_string: Some(string),
            get_bool: Some(boolean),
            get_double: Some(double),
            // SAFETY: Only these reader methods are used. RcImpl provides the
            // reference-counted base and retains the real list until drop.
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_list_value_t = RcImpl::new(raw, Payload {
            inner: login_payload_fixture(), deadline,
        }).cast();
        raw.wrap_result()
    }

    #[test]
    fn native_login_delivery_requires_new_payload_shape_and_bounded_native_options() {
        native_api();
        let args = login_payload_fixture();
        let payload = login_delivery_payload(&args, "https://fixture.test").unwrap();
        assert_eq!(payload.auto_submit, 0);
        assert_eq!(payload.stage, NativeLoginStage::Form);
        assert_eq!(payload.options.get_type(), ValueType::DICTIONARY);
        assert!(login_delivery_payload(&args, "https://other.test").is_none());
        args.set_size(7); // Old helper contract cannot deliver without options.
        assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        args.set_string(7, Some(&CefString::from("{\"__proto__\":{}}")));
        assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        args.set_string(7, Some(&CefString::from(DEFAULT_FORM_OPTIONS)));
        for deadline in [0.0, -1.0] {
            assert_eq!(args.set_double(5, deadline), 1);
            assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        }
        args.set_double(5, 2_000_000_000_000.0);
        args.set_string(0, Some(&CefString::from("")));
        assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
    }

    #[test]
    fn native_login_delivery_rejects_non_finite_deadline_getters_without_cef_value_construction() {
        native_api();
        // Positive control ensures the facade reaches the real payload parser,
        // instead of passing negative tests through a missing mock method.
        let valid = login_payload_with_mock_deadline(2_000_000_000_000.0);
        let payload = login_delivery_payload(&valid, "https://fixture.test").unwrap();
        assert_eq!(payload.deadline, 2_000_000_000_000.0);
        assert_eq!(payload.options.get_type(), ValueType::DICTIONARY);
        for deadline in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let args = login_payload_with_mock_deadline(deadline);
            assert!(!args.double(5).is_finite());
            assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        }
    }

    #[test]
    fn native_login_staged_delivery_never_transports_the_other_stage_secret() {
        native_api();
        let args = login_payload_fixture();
        args.set_string(6, Some(&CefString::from("identifier")));
        assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        args.set_string(3, Some(&CefString::from("")));
        let identifier = login_delivery_payload(&args, "https://fixture.test").unwrap();
        assert!(identifier.password.is_empty());
        args.set_string(
            7,
            Some(&CefString::from(
                r#"{"fields":[{"value":"synthetic-extra-secret"}]}"#,
            )),
        );
        assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        args.set_string(7, Some(&CefString::from(DEFAULT_FORM_OPTIONS)));
        args.set_string(6, Some(&CefString::from("password")));
        args.set_string(3, Some(&CefString::from("synthetic-password")));
        assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        args.set_string(2, Some(&CefString::from("")));
        let password = login_delivery_payload(&args, "https://fixture.test").unwrap();
        assert!(password.username.is_empty());
        args.set_string(6, Some(&CefString::from("arbitrary-provider-stage")));
        assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
    }

    #[test]
    fn deferred_form_packets_never_carry_credential_or_extra_field_values() {
        native_api();
        for stage in ["form-prepare", "form-submit", "id-submit", "pw-submit"] {
            let args = login_payload_fixture();
            args.set_string(6, Some(&CefString::from(stage)));
            assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
            args.set_string(2, Some(&CefString::from("")));
            args.set_string(3, Some(&CefString::from("")));
            assert!(login_delivery_payload(&args, "https://fixture.test").is_some());
            args.set_string(
                7,
                Some(&CefString::from(
                    r##"{"fields":[{"selector":"#realm","value":"secret"}]}"##,
                )),
            );
            assert!(login_delivery_payload(&args, "https://fixture.test").is_none());
        }
    }

    #[test]
    fn missing_or_conflicting_dark_switches_cannot_acknowledge_installation() {
        native_api();
        let line = command_line_create().unwrap();
        assert!(!forced_dark_configured(&line));
        line.append_switch(Some(&CefString::from("force-dark-mode")));
        assert!(!forced_dark_configured(&line));
        line.append_switch_with_value(
            Some(&CefString::from("enable-features")),
            Some(&CefString::from("WebContentsForceDark")),
        );
        assert!(forced_dark_configured(&line));
        line.append_switch_with_value(
            Some(&CefString::from("disable-features")),
            Some(&CefString::from("WebContentsForceDark")),
        );
        assert!(!forced_dark_configured(&line));
    }

    #[test]
    fn native_message_parser_rejects_wrong_types_and_oversized_values() {
        native_api();
        let message = process_message_create(Some(&CefString::from(LOGIN_DELIVERY))).unwrap();
        let args = message.argument_list().unwrap();
        args.set_int(0, 123);
        assert_eq!(message_text(&args, 0, 80), None);
        args.set_string(0, Some(&CefString::from("x".repeat(81).as_str())));
        assert_eq!(message_text(&args, 0, 80), None);
        args.set_string(0, Some(&CefString::from("nonce")));
        assert_eq!(message_text(&args, 0, 80).as_deref(), Some("nonce"));
    }

    #[test]
    fn renderer_callback_does_not_accept_messages_without_native_browser_and_frame() {
        native_api();
        let renderer = handler();
        let mut message = process_message_create(Some(&CefString::from(LOGIN_DELIVERY))).unwrap();
        assert_eq!(
            renderer.on_process_message_received(
                None,
                None,
                ProcessId::BROWSER,
                Some(&mut message)
            ),
            0
        );
        renderer.on_context_created(None, None, None);
        renderer.on_context_released(None, None, None);
        renderer.on_browser_destroyed(None);
    }
}
