//! Private constant renderer controller. Carries tokens/lengths, never text.
use super::*;
use crate::native_manual_input as wire;

struct ManualDocument {
    owner: Browser,
    context: V8Context,
    dispatch: V8Value,
    sensitive: bool,
}
thread_local! { static DOCS: RefCell<HashMap<DocumentKey, ManualDocument>> = RefCell::new(HashMap::new()); }

pub(super) fn install(browser: &Browser, frame: &Frame, context: &mut V8Context) {
    if frame_origin(frame).is_none() || context.is_valid() != 1 {
        return;
    }
    let mut dispatch = None;
    let mut exception = None;
    if context.eval(
        Some(&CefString::from(include_str!(
            "native_manual_input_client.js"
        ))),
        None,
        0,
        Some(&mut dispatch),
        Some(&mut exception),
    ) != 1
    {
        return;
    }
    if let Some(dispatch) = dispatch.filter(|f| f.is_function() == 1) {
        DOCS.with(|docs| {
            docs.borrow_mut().insert(
                frame_key(browser, frame),
                ManualDocument {
                    owner: browser.clone(),
                    context: context.clone(),
                    dispatch,
                    sensitive: false,
                },
            )
        });
    }
}
pub(super) fn sensitive(browser: &Browser, frame: &Frame) -> bool {
    DOCS.with(|docs| {
        docs.borrow()
            .get(&frame_key(browser, frame))
            .is_some_and(|d| same_browser(&d.owner, browser) && d.sensitive)
    })
}
pub(super) fn forget_context(context: &mut V8Context) {
    DOCS.with(|docs| {
        docs.borrow_mut()
            .retain(|_, d| d.context.is_same(Some(context)) != 1)
    });
}
pub(super) fn forget_browser(browser: &Browser) {
    DOCS.with(|docs| {
        docs.borrow_mut()
            .retain(|_, d| !same_browser(&d.owner, browser))
    });
}
pub(super) fn receive(
    browser: &Browser,
    frame: &Frame,
    source: ProcessId,
    message: &ProcessMessage,
) -> bool {
    if CefString::from(&message.name()).to_string() != wire::REQUEST {
        return false;
    }
    if source != ProcessId::BROWSER || frame_origin(frame).is_none() {
        return true;
    }
    let Some(args) = message.argument_list().filter(|a| a.size() == 4) else {
        return true;
    };
    let (Some(id), Some(action), Some(serial)) = (
        message_text(&args, 0, 80),
        message_text(&args, 1, 16),
        message_text(&args, 3, 32),
    ) else {
        return true;
    };
    if !wire::valid_token(&id)
        || !matches!(action.as_str(), "capture" | "restore" | "check" | "cancel")
        || args.get_type(2) != ValueType::INT
        || !(0..=4096).contains(&args.int(2))
    {
        return true;
    }
    let data = DOCS.with(|docs| {
        let mut docs = docs.borrow_mut();
        let doc = docs.get_mut(&frame_key(browser, frame))?;
        let mut current = frame.v8_context()?;
        if !same_browser(&doc.owner, browser)
            || doc.context.is_valid() != 1
            || doc.context.is_same(Some(&mut current)) != 1
        {
            return None;
        }
        // Recording is suppressed before dispatching anything that can focus or type.
        doc.sensitive = action != "cancel";
        Some((doc.context.clone(), doc.dispatch.clone()))
    });
    let success = data.is_some_and(|(mut context, dispatch)| {
        if context.enter() != 1 {
            return false;
        }
        let result = dispatch
            .execute_function_with_context(
                Some(&mut context),
                None,
                Some(&[
                    v8_value_create_string(Some(&CefString::from(action.as_str()))),
                    v8_value_create_string(Some(&CefString::from(id.as_str()))),
                    v8_value_create_int(args.int(2)),
                ]),
            )
            .is_some_and(|r| r.is_bool() == 1 && r.bool_value() == 1);
        context.exit();
        result
    });
    if let Some(mut reply) = process_message_create(Some(&CefString::from(wire::RESPONSE))) {
        if let Some(out) = reply.argument_list() {
            out.set_string(0, Some(&CefString::from(id.as_str())));
            out.set_string(1, Some(&CefString::from(serial.as_str())));
            out.set_bool(2, i32::from(success));
            frame.send_process_message(ProcessId::BROWSER, Some(&mut reply));
        }
    }
    true
}
