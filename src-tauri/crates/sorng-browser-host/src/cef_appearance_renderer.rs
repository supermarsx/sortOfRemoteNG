//! Per-CEF-browser policy and per-V8-context private appearance closures.
use super::*;
use crate::native_appearance::{self as policy, AppearanceStatus};
use std::sync::LazyLock;

#[path = "native_darkreader.rs"]
mod darkreader;

struct Policy {
    owner: Browser,
    json: String,
    extensions_enabled: bool,
}
struct AppearanceDocument {
    owner: Browser,
    context: V8Context,
    controller: V8Value,
    revision: String,
    nonce: u64,
}
thread_local! {
    static POLICIES: RefCell<HashMap<i32, Policy>> = RefCell::new(HashMap::new());
    static DOCS: RefCell<HashMap<DocumentKey, AppearanceDocument>> = RefCell::new(HashMap::new());
}
static SOURCE: LazyLock<Option<String>> = LazyLock::new(|| {
    let engine = darkreader::adapt(include_str!(
        "../../sorng-protocols/src/vendor/darkreader/darkreader.js"
    ))?;
    Some(
        include_str!("native_appearance_bootstrap.js.in")
            .replace("/* BUNDLED_DARKREADER */", &engine)
            .replace(
                "/* NATIVE_APPEARANCE_CLIENT */",
                include_str!("native_appearance_client.js"),
            ),
    )
});

pub(super) fn created(browser: &Browser, info: &DictionaryValue) -> bool {
    let key = CefString::from("appearance-json");
    let json = if info.has_key(Some(&key)) == 1 {
        if info.get_type(Some(&key)) != ValueType::STRING {
            return false;
        }
        let value = CefString::from(&info.string(Some(&key)));
        if !value
            .as_slice()
            .is_some_and(|v| v.len() <= policy::MAX_JSON)
        {
            return false;
        }
        value.to_string()
    } else {
        policy::DEFAULT_JSON.into()
    };
    if policy::wire::parse(&json).is_none() {
        return false;
    }
    let extension_key = CefString::from("appearance-extensions-enabled");
    // Missing/invalid native master permission never authorizes injection.
    let extensions_enabled = info.get_type(Some(&extension_key)) == ValueType::BOOL
        && info.bool(Some(&extension_key)) == 1;
    POLICIES.with(|p| {
        p.borrow_mut().insert(
            browser.identifier(),
            Policy {
                owner: browser.clone(),
                json,
                extensions_enabled,
            },
        )
    });
    true
}

fn eligible(frame: &Frame) -> bool {
    if frame.is_valid() != 1 {
        return false;
    }
    let url = CefString::from(&frame.url()).to_string();
    policy::eligible_document(&url)
}

wrap_v8_handler! {
    struct AppearanceSignal { key: DocumentKey, nonce: u64 }
    impl V8Handler {
        fn execute(&self, _name: Option<&CefString>, _object: Option<&mut V8Value>, arguments: Option<&[Option<V8Value>]>,
            _retval: Option<&mut Option<V8Value>>, _exception: Option<&mut CefString>) -> i32 {
            let Some(args) = arguments.filter(|args| args.len()==2) else { return 1; };
            let text = |index:usize| args[index].as_ref().filter(|v| v.is_string()==1)
                .map(|v| CefString::from(&v.string_value()).to_string()).filter(|v| v.len()<=20);
            let (Some(revision),Some(status))=(text(0),text(1)) else {return 1;};
            if AppearanceStatus::parse(&status).is_none() {return 1;}
            let Some(mut context) = v8_context_get_current_context() else {return 1;};
            let frame = DOCS.with(|docs| docs.borrow().get(&self.key).and_then(|doc| {
                (doc.nonce==self.nonce && doc.revision==revision
                    && doc.context.is_same(Some(&mut context))==1).then(|| doc.context.frame()).flatten()
            }));
            if let Some(frame)=frame {
                if let Some(mut message)=process_message_create(Some(&CefString::from(policy::STATUS))) {
                    if let Some(args)=message.argument_list() {
                        args.set_string(0,Some(&CefString::from(revision.as_str())));
                        args.set_string(1,Some(&CefString::from(status.as_str())));
                        frame.send_process_message(ProcessId::BROWSER,Some(&mut message));
                    }
                }
            }
            1
        }
    }
}

fn apply(browser: &Browser, frame: &Frame, json: &str, revision: &str) -> bool {
    let Some((_, value)) = policy::wire::parse(json) else {
        return false;
    };
    let data = DOCS.with(|docs| {
        let mut docs = docs.borrow_mut();
        let doc = docs.get_mut(&frame_key(browser, frame))?;
        if !same_browser(&doc.owner, browser) {
            return None;
        }
        doc.revision = revision.into();
        Some((doc.context.clone(), doc.controller.clone()))
    });
    let Some((mut context, controller)) = data else {
        return false;
    };
    if context.is_valid() != 1 || context.enter() != 1 {
        return false;
    }
    let result = (|| {
        let args = login_configuration_v8(&value)?;
        let revision = v8_value_create_string(Some(&CefString::from(revision)))?;
        let main = v8_value_create_bool(frame.is_main())?;
        controller
            .value_bykey(Some(&CefString::from("apply")))?
            .execute_function_with_context(
                Some(&mut context),
                Some(&mut controller.clone()),
                Some(&[Some(args), Some(revision), Some(main)]),
            )
    })();
    context.exit();
    result.is_some()
}

pub(super) fn install(browser: &Browser, frame: &Frame, context: &mut V8Context) -> bool {
    if !eligible(frame) {
        return true;
    }
    let saved = POLICIES.with(|p| {
        p.borrow()
            .get(&browser.identifier())
            .filter(|p| same_browser(&p.owner, browser))
            .map(|p| (p.json.clone(), p.extensions_enabled))
    });
    let Some((json, extensions_enabled)) = saved else {
        return false;
    };
    if !extensions_enabled {
        // Native-only master-disabled path: no V8 evaluation, DarkReader or
        // client closure. Browser process will confirm its native override.
        if let Some(mut message) = process_message_create(Some(&CefString::from(policy::STATUS))) {
            if let Some(args) = message.argument_list() {
                args.set_string(0, Some(&CefString::from("0")));
                args.set_string(1, Some(&CefString::from("fallback")));
                frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
            }
        }
        return true;
    }
    if context.is_valid() != 1 {
        return false;
    }
    let key = frame_key(browser, frame);
    let nonce = NEXT_DOCUMENT.fetch_add(1, Ordering::Relaxed);
    let mut signal = AppearanceSignal::new(key.clone(), nonce);
    let Some(notify) = v8_value_create_function(
        Some(&CefString::from("nativeAppearanceReady")),
        Some(&mut signal),
    ) else {
        return false;
    };
    let mut factory = None;
    let mut exception = None;
    let Some(source) = SOURCE.as_ref() else {
        return false;
    };
    if context.eval(
        Some(&CefString::from(source.as_str())),
        None,
        0,
        Some(&mut factory),
        Some(&mut exception),
    ) != 1
    {
        return false;
    }
    let Some(controller) = factory.and_then(|factory| {
        factory.execute_function_with_context(Some(context), None, Some(&[Some(notify)]))
    }) else {
        return false;
    };
    if controller.is_object() != 1 {
        return false;
    }
    DOCS.with(|docs| {
        docs.borrow_mut().insert(
            key,
            AppearanceDocument {
                owner: browser.clone(),
                context: context.clone(),
                controller,
                revision: "0".into(),
                nonce,
            },
        )
    });
    apply(browser, frame, &json, "0")
}

pub(super) fn receive(
    browser: &Browser,
    frame: &Frame,
    source: ProcessId,
    message: &ProcessMessage,
) -> bool {
    if source != ProcessId::BROWSER
        || CefString::from(&message.name()).to_string() != policy::REQUEST
    {
        return false;
    }
    let Some(args) = message.argument_list().filter(|a| a.size() == 2) else {
        return true;
    };
    let (Some(revision), Some(json)) = (
        message_text(&args, 0, 20),
        message_text(&args, 1, policy::MAX_JSON),
    ) else {
        return true;
    };
    if revision.is_empty()
        || !revision.bytes().all(|v| v.is_ascii_digit())
        || policy::wire::parse(&json).is_none()
    {
        return true;
    }
    let current = POLICIES.with(|p| {
        let mut p = p.borrow_mut();
        let Some(p) = p.get_mut(&browser.identifier()) else {
            return false;
        };
        if !same_browser(&p.owner, browser) || !p.extensions_enabled {
            return false;
        }
        p.json = json.clone();
        true
    });
    if current {
        apply(browser, frame, &json, &revision);
    }
    true
}

pub(super) fn forget_context(context: &mut V8Context) {
    // Context destruction itself releases its DOM/engine observers. Never keep
    // a V8 object alive past CEF's exact context-release notification.
    DOCS.with(|docs| {
        docs.borrow_mut()
            .retain(|_, doc| doc.context.is_same(Some(context)) != 1)
    });
}
pub(super) fn forget_browser(browser: &Browser) {
    DOCS.with(|docs| {
        docs.borrow_mut()
            .retain(|_, doc| !same_browser(&doc.owner, browser))
    });
    POLICIES.with(|p| {
        p.borrow_mut()
            .retain(|_, p| !same_browser(&p.owner, browser))
    });
}
