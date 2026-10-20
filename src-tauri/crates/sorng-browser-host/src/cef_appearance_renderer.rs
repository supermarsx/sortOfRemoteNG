//! Per-CEF-browser policy and per-V8-context private appearance closures.
use super::*;
use crate::native_appearance::{self as policy, AppearanceStatus};
use std::sync::LazyLock;

#[path = "native_darkreader.rs"]
mod darkreader;

struct Policy {
    owner: Browser,
    appearance: policy::RevisionedAppearance,
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
        let mut p = p.borrow_mut();
        if let Some(current) = p
            .get(&browser.identifier())
            .filter(|p| same_browser(&p.owner, browser))
        {
            // Extra-info is a creation-time snapshot. Repeated creation callbacks
            // for this owner must not reset newer process policy for child frames.
            return current.extensions_enabled == extensions_enabled;
        }
        p.insert(
            browser.identifier(),
            Policy {
                owner: browser.clone(),
                appearance: policy::RevisionedAppearance::new(json),
                extensions_enabled,
            },
        );
        true
    })
}

fn eligible(frame: &Frame) -> bool {
    if frame.is_valid() != 1 {
        return false;
    }
    let url = CefString::from(&frame.url()).to_string();
    policy::eligible_frame_document(&url, frame.is_main() == 1)
}

fn report(frame: &Frame, nonce: u64, revision: &str, status: &str) {
    if let Some(mut message) = process_message_create(Some(&CefString::from(policy::STATUS))) {
        if let Some(args) = message.argument_list() {
            args.set_string(0, Some(&CefString::from(revision)));
            args.set_string(1, Some(&CefString::from(status)));
            args.set_string(
                2,
                Some(&CefString::from(
                    format!("{}:{nonce}", std::process::id()).as_str(),
                )),
            );
            frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
        }
    }
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
                report(&frame, self.nonce, &revision, &status);
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
            .map(|p| (p.appearance.json.clone(), p.extensions_enabled))
    });
    let Some((json, extensions_enabled)) = saved else {
        return false;
    };
    let nonce = NEXT_DOCUMENT.fetch_add(1, Ordering::Relaxed);
    if !extensions_enabled {
        // Native-only master-disabled path: no V8 evaluation, DarkReader or
        // client closure. Browser process will confirm its native override.
        report(frame, nonce, "0", "fallback");
        return true;
    }
    if context.is_valid() != 1 {
        return false;
    }
    let key = frame_key(browser, frame);
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
    let applied = apply(browser, frame, &json, "0");
    // Root readiness may be deferred, or revision zero may be superseded by an
    // IPC update before JS reports it. Announce the native context immediately;
    // the browser deduplicates this and the eventual JS status by document token.
    report(frame, nonce, "0", "fallback");
    applied
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
        p.appearance.update(&revision, &json)
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

#[cfg(test)]
mod tests {
    use super::*;
    use cef::rc::{ConvertReturnValue, RcImpl};

    fn browser(id: i32) -> Browser {
        extern "C" fn identifier(this: *mut cef::sys::_cef_browser_t) -> i32 {
            RcImpl::<cef::sys::_cef_browser_t, i32>::get(this).interface
        }
        extern "C" fn same(
            this: *mut cef::sys::_cef_browser_t,
            other: *mut cef::sys::_cef_browser_t,
        ) -> i32 {
            if other.is_null() {
                return 0;
            }
            let equal = i32::from(this == other);
            let _other: Browser = other.wrap_result();
            equal
        }
        let raw = cef::sys::_cef_browser_t {
            get_identifier: Some(identifier),
            is_same: Some(same),
            // No browser is launched; unused CEF entries are nullable.
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut cef::sys::_cef_browser_t = RcImpl::new(raw, id).cast();
        raw.wrap_result()
    }

    fn info() -> DictionaryValue {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
        let info = dictionary_value_create().unwrap();
        info.set_string(
            Some(&CefString::from("appearance-json")),
            Some(&CefString::from(policy::DEFAULT_JSON)),
        );
        info.set_bool(Some(&CefString::from("appearance-extensions-enabled")), 1);
        info
    }

    #[test]
    fn repeated_creation_snapshot_preserves_newer_policy_for_late_contexts() {
        let browser = browser(71);
        let info = info();
        assert!(created(&browser, &info));
        let latest = policy::DEFAULT_JSON.replace("#181a1b", "#123456");
        POLICIES.with(|p| {
            assert!(p
                .borrow_mut()
                .get_mut(&71)
                .unwrap()
                .appearance
                .update("42", &latest))
        });
        assert!(created(&browser, &info));
        POLICIES.with(|p| {
            let mut p = p.borrow_mut();
            let policy = p.get_mut(&71).unwrap();
            assert_eq!(policy.appearance.json, latest);
            assert!(!policy.appearance.update("41", policy::DEFAULT_JSON));
        });
        forget_browser(&browser);
    }

    #[test]
    fn replacement_browser_owner_resets_policy_without_late_old_destroy_removing_it() {
        let old = browser(72);
        let successor = browser(72);
        let info = info();
        assert!(created(&old, &info));
        POLICIES.with(|p| {
            assert!(p
                .borrow_mut()
                .get_mut(&72)
                .unwrap()
                .appearance
                .update("42", policy::DEFAULT_JSON))
        });
        assert!(created(&successor, &info));
        forget_browser(&old);
        POLICIES.with(|p| {
            let mut p = p.borrow_mut();
            let policy = p.get_mut(&72).unwrap();
            assert!(same_browser(&policy.owner, &successor));
            assert!(policy.appearance.update("1", policy::DEFAULT_JSON));
        });
        forget_browser(&successor);
    }
}
