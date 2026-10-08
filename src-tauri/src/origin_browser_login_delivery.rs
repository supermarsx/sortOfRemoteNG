//! Last native-owner boundary before a staged form credential delivery.
use sorng_browser_host::native_features::{
    NativeLoginCredentials, NativeLoginRequest, NativeLoginStage,
};
use std::time::Instant;

pub(super) fn project<'a>(
    request: &NativeLoginRequest<'_>,
    credentials: NativeLoginCredentials<'a>,
    now: Instant,
) -> Option<NativeLoginCredentials<'a>> {
    let origin = url::Url::parse(request.origin).ok()?;
    if !request.adapter.accepts_stage(request.stage)
        || request.identity != credentials.identity
        || request.origin != credentials.origin
        || origin.scheme() != "https"
        || origin.origin().ascii_serialization() != request.origin
        || credentials.valid_until <= now
        || (request.stage.is_action() && !credentials.auto_submit)
    {
        return None;
    }
    let (username, password) = match request.stage {
        NativeLoginStage::Form | NativeLoginStage::BoundPassword => {
            (credentials.username, credentials.password)
        }
        NativeLoginStage::Identifier => (credentials.username, ""),
        NativeLoginStage::Password => ("", credentials.password),
        NativeLoginStage::FormPrepare
        | NativeLoginStage::FormSubmit
        | NativeLoginStage::IdentifierSubmit
        | NativeLoginStage::PasswordSubmit => ("", ""),
    };
    Some(NativeLoginCredentials {
        username,
        password,
        ..credentials
    })
}

/// Parse only timing/selector metadata: serde skips secret field values rather
/// than cloning them into a JSON tree merely to remove them again.
pub(super) fn form_metadata(raw: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Metadata {
        version: u8,
        form_selector: Option<String>,
        fill_delay_ms: u32,
        submit_delay_ms: u32,
        detection_timeout_ms: u32,
        submit: bool,
        #[serde(rename = "fields")]
        _fields: serde::de::IgnoredAny,
    }
    if raw.len() > 131_072 {
        return None;
    }
    let metadata: Metadata = serde_json::from_str(raw).ok()?;
    let options = sorng_protocols::themed_autologin::HttpFormAutomation {
        version: metadata.version,
        form_selector: metadata.form_selector,
        fill_delay_ms: metadata.fill_delay_ms,
        submit_delay_ms: metadata.submit_delay_ms,
        detection_timeout_ms: metadata.detection_timeout_ms,
        submit: metadata.submit,
        fields: Vec::new(),
    };
    options.validate().ok()?;
    serde_json::to_string(&options).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_browser_host::native_features::NativeLoginAdapter;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use std::time::Duration;

    #[test]
    fn native_login_delivery_minimizes_each_provider_and_form_stage() {
        let policy =
            OriginBrowserPolicy::new("db", "connection", "tab", "https://example.test").unwrap();
        let now = Instant::now();
        for (adapter, stage, user, password) in [
            (
                NativeLoginAdapter::Google,
                NativeLoginStage::Identifier,
                "user",
                "",
            ),
            (
                NativeLoginAdapter::Google,
                NativeLoginStage::Password,
                "",
                "secret",
            ),
            (
                NativeLoginAdapter::Google,
                NativeLoginStage::IdentifierSubmit,
                "",
                "",
            ),
            (
                NativeLoginAdapter::Google,
                NativeLoginStage::PasswordSubmit,
                "",
                "",
            ),
            (
                NativeLoginAdapter::ChatGpt,
                NativeLoginStage::BoundPassword,
                "user",
                "secret",
            ),
            (
                NativeLoginAdapter::ModularForm,
                NativeLoginStage::Form,
                "user",
                "secret",
            ),
            (
                NativeLoginAdapter::ModularForm,
                NativeLoginStage::FormPrepare,
                "",
                "",
            ),
            (
                NativeLoginAdapter::ModularForm,
                NativeLoginStage::FormSubmit,
                "",
                "",
            ),
        ] {
            let request = NativeLoginRequest {
                identity: policy.identity(),
                origin: policy.source_origin(),
                adapter,
                stage,
            };
            let delivered = project(
                &request,
                NativeLoginCredentials {
                    identity: policy.identity(),
                    origin: policy.source_origin(),
                    valid_until: now + Duration::from_secs(1),
                    username: "user",
                    password: "secret",
                    auto_submit: true,
                },
                now,
            )
            .unwrap();
            assert_eq!((delivered.username, delivered.password), (user, password));
        }
    }

    #[test]
    fn native_login_delivery_rejects_stale_owner_origin_expiry_and_unapproved_submit() {
        let policy =
            OriginBrowserPolicy::new("db", "connection", "tab", "https://example.test").unwrap();
        let other =
            OriginBrowserPolicy::new("db", "connection", "tab", "https://example.test").unwrap();
        let now = Instant::now();
        for case in 0..7 {
            let request = NativeLoginRequest {
                identity: if case == 0 {
                    other.identity()
                } else {
                    policy.identity()
                },
                origin: if case == 1 {
                    "https://other.test"
                } else if case == 5 {
                    "http://example.test"
                } else if case == 6 {
                    "https://example.test/path"
                } else {
                    policy.source_origin()
                },
                adapter: if case == 3 {
                    NativeLoginAdapter::Manual
                } else {
                    NativeLoginAdapter::ModularForm
                },
                stage: if case == 4 {
                    NativeLoginStage::FormSubmit
                } else {
                    NativeLoginStage::Form
                },
            };
            assert!(project(
                &request,
                NativeLoginCredentials {
                    identity: policy.identity(),
                    origin: if case >= 5 {
                        request.origin
                    } else {
                        policy.source_origin()
                    },
                    valid_until: if case == 2 {
                        now
                    } else {
                        now + Duration::from_secs(1)
                    },
                    username: "user",
                    password: "secret",
                    auto_submit: false,
                },
                now
            )
            .is_none());
        }
    }

    #[test]
    fn native_login_delivery_metadata_preserves_saved_delays_without_extra_field_secrets() {
        let raw = r##"{"version":1,"formSelector":"#login","fillDelayMs":3000,"submitDelayMs":4000,"detectionTimeoutMs":17000,"submit":false,"fields":[{"selector":"#token","value":"secret-marker"}]}"##;
        let metadata = form_metadata(raw).unwrap();
        assert!(!metadata.contains("secret-marker"));
        let value: serde_json::Value = serde_json::from_str(&metadata).unwrap();
        assert_eq!(value["fillDelayMs"], 3000);
        assert_eq!(value["submitDelayMs"], 4000);
        assert_eq!(value["detectionTimeoutMs"], 17000);
        assert_eq!(value["submit"], false);
        assert_eq!(value["fields"], serde_json::json!([]));
        assert!(form_metadata(&raw.replace("17000", "1000")).is_none());
        assert!(form_metadata(&raw.replace("\"version\":1", "\"version\":2")).is_none());
    }
}
