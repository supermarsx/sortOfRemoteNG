//! Native configuration hardening, deliberately not an OS traffic attestation.
//! CEF 682c378 global_preference_manager_impl.cc maps PreferenceManager to
//! Chromium local_state. SystemNetworkContextManager uses its proxy monitor;
//! the global RequestContext is a separate profile and must be fenced too.
//! No command-line proxy: that would make private proxy prefs unmodifiable.
use cef::*;

// This is a syntactically valid, single proxy with no DIRECT alternative.
// The process-wide ^NOTFOUND rule rejects its name before DNS or a socket.
// No listening port, credentials, external account or background worker exists.
const DENY_PROXY: &str = "http://sorng-unowned-context.invalid:9";
const PROXY_FIELDS: [(&str, &str); 3] = [
    ("mode", "fixed_servers"),
    ("server", DENY_PROXY),
    ("bypass_list", "<-loopback>"),
];

fn expected(value: Option<Value>) -> bool {
    value.and_then(|v| v.dictionary()).is_some_and(|dict| {
        dict.size() == PROXY_FIELDS.len()
            && PROXY_FIELDS.iter().all(|(key, expected)| {
                let key = CefString::from(*key);
                dict.get_type(Some(&key)) == ValueType::STRING
                    && CefString::from(&dict.string(Some(&key))).to_string() == *expected
            })
    })
}

fn install(preferences: &impl ImplPreferenceManager) -> Result<(), ()> {
    let name = CefString::from("proxy");
    if preferences.has_preference(Some(&name)) != 1
        || preferences.can_set_preference(Some(&name)) != 1
    {
        return Err(());
    }
    let mut dict = dictionary_value_create().ok_or(())?;
    for (key, value) in PROXY_FIELDS {
        if dict.set_string(Some(&CefString::from(key)), Some(&CefString::from(value))) != 1 {
            return Err(());
        }
    }
    let mut value = value_create().ok_or(())?;
    if value.set_dictionary(Some(&mut dict)) != 1 {
        return Err(());
    }
    // Allocated output struct required by the pinned binding; do not surface
    // native error text or enumerate unrelated preferences in diagnostics.
    let mut error = CefString::from("");
    if preferences.set_preference(Some(&name), Some(&mut value), Some(&mut error)) != 1
        || !expected(preferences.preference(Some(&name)))
    {
        return Err(());
    }
    Ok(())
}

pub(super) fn install_global_policy() -> Result<(), ()> {
    if currently_on(ThreadId::UI) != 1 {
        return Err(());
    }
    let system = preference_manager_get_global().ok_or(())?;
    let global = request_context_get_global_context().ok_or(())?;
    if global.is_global() != 1 {
        return Err(());
    }
    install(&system)?;
    install(&global)?;
    verify_global_policy()
}

pub(super) fn verify_global_policy() -> Result<(), ()> {
    if currently_on(ThreadId::UI) != 1 {
        return Err(());
    }
    let command = command_line_get_global().ok_or(())?;
    if CefString::from(&command.switch_value(Some(&CefString::from("host-resolver-rules"))))
        .to_string()
        != super::NATIVE_HOST_RESOLVER_RULES
        || command.has_switch(Some(&CefString::from("disable-quic"))) != 1
        || CefString::from(
            &command.switch_value(Some(&CefString::from("force-webrtc-ip-handling-policy"))),
        )
        .to_string()
            != "disable_non_proxied_udp"
    {
        return Err(());
    }
    let system = preference_manager_get_global().ok_or(())?;
    let global = request_context_get_global_context().ok_or(())?;
    let name = CefString::from("proxy");
    if global.is_global() != 1
        || !expected(system.preference(Some(&name)))
        || !expected(global.preference(Some(&name)))
    {
        return Err(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denying_proxy_readback_rejects_direct_pac_bypass_and_extra_fields() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        crate::bootstrap_platform::select_pinned_api().unwrap();
        let mut dict = dictionary_value_create().unwrap();
        for (key, value) in PROXY_FIELDS {
            assert_eq!(
                dict.set_string(Some(&CefString::from(key)), Some(&CefString::from(value))),
                1
            );
        }
        let wrap = |dict: &mut DictionaryValue| {
            let value = value_create().unwrap();
            assert_eq!(value.set_dictionary(Some(dict)), 1);
            Some(value)
        };
        assert!(expected(wrap(&mut dict)));
        for (key, value) in [
            ("mode", "direct"),
            ("mode", "pac_script"),
            ("server", "direct://"),
            ("bypass_list", "*"),
        ] {
            let mut altered = dict.copy(0).unwrap();
            altered.set_string(Some(&CefString::from(key)), Some(&CefString::from(value)));
            assert!(!expected(wrap(&mut altered)));
        }
        dict.set_string(
            Some(&CefString::from("pac_url")),
            Some(&CefString::from("http://unowned.invalid/proxy.pac")),
        );
        assert!(!expected(wrap(&mut dict)));
        assert!(!expected(None));
    }
}
