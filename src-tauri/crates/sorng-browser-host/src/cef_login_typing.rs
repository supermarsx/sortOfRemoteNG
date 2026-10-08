//! Paced username/password/extra-input delivery, using the prior approved login
//! stage. Renderer requests contain only field roles, never credential text.
use super::*;
use std::collections::HashSet;
use zeroize::Zeroizing;

#[derive(Default)]
pub(super) struct State {
    used: HashSet<(String, String)>,
    pending: Option<Pending>,
}

struct Pending {
    nonce: String,
    role: String,
    url: String,
    frame: String,
    generation: u64,
    input: NativeAuthTyping,
    next: usize,
    length: usize,
    expires: Instant,
    deadline: f64,
}

impl State {
    pub(super) fn cancel(&mut self) {
        self.pending = None;
    }
}

fn parse(event: &str) -> Option<(&str, NativeLoginStage, &str, usize)> {
    let fields: Vec<_> = event.split('|').collect();
    if event.len() > 128
        || fields.len() != 5
        || fields[0] != "type"
        || !matches!(fields[1], "start" | "key" | "cancel")
    {
        return None;
    }
    let stage = NativeLoginStage::parse(fields[2])?;
    if stage.is_action() || stage == NativeLoginStage::FormPrepare {
        return None;
    }
    let field = fields[3];
    if !matches!(field, "username" | "password")
        && !field
            .strip_prefix("extra")
            .and_then(|v| v.parse::<usize>().ok())
            .is_some_and(|i| i < 16)
    {
        return None;
    }
    let index = fields[4].parse::<usize>().ok().filter(|i| *i <= 4096)?;
    if fields[1] != "key" && index != 0 {
        return None;
    }
    Some((fields[1], stage, field, index))
}

fn field_value(
    credentials: &NativeLoginCredentials<'_>,
    options: Option<&str>,
    field: &str,
) -> Option<Zeroizing<String>> {
    let value = match field {
        "username" => Zeroizing::new(credentials.username.to_owned()),
        "password" => Zeroizing::new(credentials.password.to_owned()),
        _ => {
            let index = field.strip_prefix("extra")?.parse::<usize>().ok()?;
            // Parse only the native-owned options delivered under this grant.
            let options = crate::cef_renderer::parse_login_configuration(options?)?.dictionary()?;
            let fields = options.value(Some(&CefString::from("fields")))?.list()?;
            let field = fields.value(index)?.dictionary()?;
            if field.get_type(Some(&CefString::from("value"))) != ValueType::STRING {
                return None;
            }
            Zeroizing::new(
                CefString::from(&field.string(Some(&CefString::from("value")))).to_string(),
            )
        }
    };
    (!value.is_empty() && value.len() <= 16384 && !value.chars().any(char::is_control))
        .then_some(value)
}

pub(super) fn receive(
    shared: &Arc<Shared>,
    browser: &Browser,
    frame: &Frame,
    nonce: &str,
    event: &str,
    url: &str,
    origin: &str,
) {
    let Some((action, stage, field, index)) = parse(event) else {
        return;
    };
    if !stage_allowed(shared.login_adapter, stage, url)
        || !shared
            .login_budget
            .lock()
            .is_ok_and(|budget| budget.released(origin, stage))
    {
        return;
    }
    let Some(hooks) = &shared.hooks else {
        return;
    };
    let role = format!("type|{}|{field}", stage.wire());
    let request = NativeLoginRequest {
        identity: &shared.identity,
        origin,
        adapter: shared.login_adapter,
        stage,
    };
    let frame_id = CefString::from(&frame.identifier()).to_string();
    let Some(generation) = shared
        .automation
        .lock()
        .ok()
        .filter(|s| s.available())
        .map(|s| s.generation)
    else {
        reply(frame, nonce, origin, &role, if action == "start" { "wait" } else { "cancel" },
            if action == "start" { 200 } else { 0 }, 0.0, false);
        return;
    };
    let current = || {
        shared.current()
            && !shared.input_blocked.load(Ordering::Acquire)
            && shared.state.lock().is_ok_and(|s| {
                s.browser_id == Some(browser.identifier())
                    && s.control.lifecycle() == Lifecycle::Attached
            })
            && frame.is_valid() == 1
            && frame.is_main() == 1
            && CefString::from(&frame.url()).to_string() == url
            && shared
                .automation
                .lock()
                .is_ok_and(|s| s.available() && s.generation == generation)
            && shared.session.lock().is_ok_and(|s| {
                navigation_allowed(&s, &shared.identity, &shared.permissions, url, true)
            })
    };
    let permitted = || {
        if !current() {
            return false;
        }
        let mut allowed = false;
        hooks.with_form_credentials(&request, &mut |credentials, _| {
            allowed |= credentials.identity == &shared.identity
                && credentials.origin == origin
                && credentials.valid_until > Instant::now();
        });
        allowed && current()
    };
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let Ok(mut state) = shared.login_totp.lock() else {
            return;
        };
        let state = &mut state.keyboard;
        if action == "cancel" || !permitted() {
            state.cancel();
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            return;
        }
        if action == "start" {
            if state.pending.is_some()
                || state.used.len() >= 64
                || !state.used.insert((nonce.into(), role.clone()))
            {
                state.cancel();
                return;
            }
            hooks.with_form_credentials(&request, &mut |credentials, options| {
                if state.pending.is_some() || !current() {
                    return;
                }
                let Some(value) = field_value(&credentials, options, field) else {
                    return;
                };
                let now = Instant::now();
                let expires = credentials.valid_until.min(now + Duration::from_secs(30));
                let length = value.encode_utf16().count();
                let Some(input) = NativeAuthTyping::new(
                    NativeAuthTarget {
                        identity: shared.identity.clone(),
                        browser_id: browser.identifier(),
                        frame_id: frame_id.clone(),
                        document_sequence: generation,
                        document_url: url.into(),
                        field_token: nonce.into(),
                    },
                    &value,
                    Duration::from_millis(20),
                    now,
                    expires,
                ) else {
                    return;
                };
                let Ok(wall) = (SystemTime::now() + expires.saturating_duration_since(now))
                    .duration_since(UNIX_EPOCH)
                else {
                    return;
                };
                let deadline = wall.as_millis() as f64;
                let mut expiry =
                    KeyboardExpiry::new(Arc::downgrade(shared), nonce.into(), role.clone());
                if post_delayed_task(
                    ThreadId::UI,
                    Some(&mut expiry),
                    expires.saturating_duration_since(now).as_millis() as i64 + 1,
                ) != 1
                {
                    return;
                }
                if reply(frame, nonce, origin, &role, "probe", 0, deadline, false) {
                    state.pending = Some(Pending {
                        nonce: nonce.into(),
                        role: role.clone(),
                        url: url.into(),
                        frame: frame_id.clone(),
                        generation,
                        input,
                        next: 0,
                        length,
                        expires,
                        deadline,
                    });
                }
            });
            if state.pending.is_none() {
                reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            }
            return;
        }
        let Some(pending) = state.pending.as_mut() else {
            return;
        };
        if pending.nonce != nonce
            || pending.role != role
            || pending.url != url
            || pending.frame != frame_id
            || pending.generation != generation
            || pending.next != index
            || index >= pending.length
            || Instant::now() >= pending.expires
        {
            state.cancel();
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            return;
        }
        let status = pending.input.tick(
            Instant::now(),
            |_| permitted(),
            |target, unit| send_cef_character(browser, target, unit),
        );
        if matches!(status, TypingStatus::Sent | TypingStatus::Complete) {
            pending.next = pending.input.units_sent();
            let (next, deadline) = (pending.next, pending.deadline);
            if status == TypingStatus::Complete {
                state.cancel();
            }
            reply(
                frame,
                nonce,
                origin,
                &role,
                "probe",
                next as i32,
                deadline,
                false,
            );
        } else {
            state.cancel();
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
        }
    }));
    if outcome.is_err() {
        shared.fault(Some(browser), BrowserFault::Callback);
    }
}

wrap_task! {
    struct KeyboardExpiry { shared: std::sync::Weak<Shared>, nonce: String, role: String }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() {
                if let Ok(mut state) = shared.login_totp.lock() {
                    if state.keyboard.pending.as_ref().is_some_and(|p| p.nonce == self.nonce && p.role == self.role && Instant::now() >= p.expires) { state.keyboard.cancel(); }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typing_requests_only_name_previously_approved_fields_not_values() {
        assert!(parse("type|start|form|username|0").is_some());
        assert!(parse("type|key|password|password|31").is_some());
        for event in [
            "type|start|form-submit|password|0",
            "type|start|form|secret-value|0",
            "type|start|form|password|1",
            "type|key|form|extra16|0",
            "type|key|form|password|4097",
        ] {
            assert!(parse(event).is_none());
        }
    }
}
