//! Native-owned automation consent. Library payloads arrive from the trusted
//! app shell, but neither their contents nor a renderer boolean grant execution.
use super::{NativeAuthorityError, NativeOwnerLease};
use serde_json::Value;
use sorng_encryption::EncryptionState;
use tauri::{Runtime, WebviewWindow};

pub struct NativeAutomationAuthority {
    scripts: bool,
    macros: bool,
    lease: NativeOwnerLease,
}

impl NativeAutomationAuthority {
    pub(super) fn new(connection: &Value, lease: &NativeOwnerLease) -> Self {
        let (scripts, macros) = saved_consent(connection);
        Self {
            scripts,
            macros,
            lease: lease.clone(),
        }
    }

    /// No cached global enablement: a global revocation takes effect before
    /// another action. Saved connection changes invalidate the immutable lease.
    pub async fn permissions<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        state: &EncryptionState,
    ) -> Result<(bool, bool), NativeAuthorityError> {
        self.lease
            .recheck(window, state)
            .await
            .map_err(|_| NativeAuthorityError::OwnerUnavailable)?;
        let settings =
            crate::app_settings_commands::read_app_settings_inner(self.lease.profile_root(), state)
                .await
                .map_err(|_| NativeAuthorityError::PolicyUnsupported)?
                .unwrap_or(Value::Null);
        self.lease
            .recheck(window, state)
            .await
            .map_err(|_| NativeAuthorityError::OwnerUnavailable)?;
        let (scripts, macros) = global_availability(&settings);
        Ok((self.scripts && scripts, self.macros && macros))
    }
}

fn saved_consent(connection: &Value) -> (bool, bool) {
    let Some(config) = connection.get("httpAutomation").and_then(Value::as_object) else {
        return (false, false);
    };
    if config.get("version") != Some(&Value::from(1))
        || ![
            "scriptInjectionEnabled",
            "interactionMacrosEnabled",
            "forceDark",
        ]
        .iter()
        .all(|key| config.get(*key).is_some_and(Value::is_boolean))
        || config.keys().any(|key| {
            !matches!(
                key.as_str(),
                "version"
                    | "items"
                    | "scriptInjectionEnabled"
                    | "interactionMacrosEnabled"
                    | "forceDark"
                    | "darkMode"
            )
        })
        || !config.get("items").is_some_and(Value::is_array)
    {
        return (false, false);
    }
    (
        config["scriptInjectionEnabled"] == Value::Bool(true),
        config["interactionMacrosEnabled"] == Value::Bool(true),
    )
}

fn global_availability(settings: &Value) -> (bool, bool) {
    // Matches normalizeSessionQuickActions: absent is legacy defaults;
    // present malformed/incomplete availability never enables a capability.
    let Some(config) = settings.get("sessionQuickActions") else {
        return (true, true);
    };
    (
        config.get("allowWebScriptInjection") == Some(&Value::Bool(true)),
        config.get("allowWebMacros") == Some(&Value::Bool(true)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_or_malformed_saved_consent_never_grants_execution() {
        for config in [
            Value::Null,
            json!({}),
            json!({"version":1}),
            json!({"version":1,"items":[],"forceDark":true,
                "scriptInjectionEnabled":"true","interactionMacrosEnabled":true}),
        ] {
            assert_eq!(
                saved_consent(&json!({"httpAutomation":config})),
                (false, false)
            );
        }
    }

    #[test]
    fn script_and_macro_consent_are_independent() {
        let mut connection = json!({"httpAutomation":{"version":1,"items":[],
            "forceDark":true,"scriptInjectionEnabled":true,"interactionMacrosEnabled":false}});
        assert_eq!(saved_consent(&connection), (true, false));
        connection["httpAutomation"]["scriptInjectionEnabled"] = json!(false);
        connection["httpAutomation"]["interactionMacrosEnabled"] = json!(true);
        assert_eq!(saved_consent(&connection), (false, true));
        connection["httpAutomation"]["futureConsent"] = json!(true);
        assert_eq!(saved_consent(&connection), (false, false));
    }

    #[test]
    fn global_defaults_do_not_replace_saved_consent() {
        assert_eq!(global_availability(&Value::Null), (true, true));
        assert_eq!(saved_consent(&json!({})), (false, false));
        assert_eq!(
            global_availability(&json!({"sessionQuickActions":null})),
            (false, false)
        );
        assert_eq!(
            global_availability(&json!({"sessionQuickActions":{
            "allowWebScriptInjection":false,"allowWebMacros":true}})),
            (false, true)
        );
    }
}
