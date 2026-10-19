//! Fixed frontend diagnostics accepted only from a trusted app window.
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BrowserFailureEvent {
    sample: u32,
    #[serde(rename = "timestampUnixMs")]
    timestamp_unix_ms: u64,
    failure: ClientFailure,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum ClientFailure {
    Configuration {
        issue: ConfigurationIssue,
    },
    Startup {
        stage: StartupStage,
        category: Category,
        code: Option<StartupCode>,
    },
    Operation {
        operation: Operation,
    },
}

#[derive(Debug, Deserialize)]
enum ConfigurationIssue {
    #[serde(rename = "url-missing")]
    UrlMissing,
    #[serde(rename = "url-type")]
    UrlType,
    #[serde(rename = "url-too-long")]
    UrlTooLong,
    #[serde(rename = "url-characters")]
    UrlCharacters,
    #[serde(rename = "url-invalid")]
    UrlInvalid,
    #[serde(rename = "url-scheme")]
    UrlScheme,
    #[serde(rename = "url-credentials")]
    UrlCredentials,
    #[serde(rename = "consent-kind")]
    ConsentKind,
    #[serde(rename = "ownerDatabaseId:missing")]
    DatabaseMissing,
    #[serde(rename = "ownerDatabaseId:type")]
    DatabaseType,
    #[serde(rename = "ownerDatabaseId:too-long")]
    DatabaseTooLong,
    #[serde(rename = "connectionId:missing")]
    ConnectionMissing,
    #[serde(rename = "connectionId:type")]
    ConnectionType,
    #[serde(rename = "connectionId:too-long")]
    ConnectionTooLong,
    #[serde(rename = "sessionId:missing")]
    SessionMissing,
    #[serde(rename = "sessionId:type")]
    SessionType,
    #[serde(rename = "sessionId:too-long")]
    SessionTooLong,
    #[serde(rename = "expectedSecurityRevision:missing")]
    RevisionMissing,
    #[serde(rename = "expectedSecurityRevision:type")]
    RevisionType,
    #[serde(rename = "expectedSecurityRevision:too-long")]
    RevisionTooLong,
    #[serde(rename = "sourceSessionId:missing")]
    SourceMissing,
    #[serde(rename = "sourceSessionId:type")]
    SourceType,
    #[serde(rename = "sourceSessionId:too-long")]
    SourceTooLong,
    #[serde(rename = "grantId:missing")]
    GrantMissing,
    #[serde(rename = "grantId:type")]
    GrantType,
    #[serde(rename = "grantId:too-long")]
    GrantTooLong,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum StartupStage {
    Listen,
    Status,
    OwnerCheck,
    Create,
    Resync,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum StartupCode {
    StartTimeout,
    AttemptLimit,
    OwnerProof,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Category {
    CertificatePolicy,
    CertificateBridge,
    Connection,
    Runtime,
    Ipc,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Operation {
    Presentation,
    Navigation,
    Control,
    State,
    Cleanup,
}

impl BrowserFailureEvent {
    pub(crate) fn message(&self) -> String {
        let detail = match &self.failure {
            ClientFailure::Configuration { issue } => format!("stage=configuration code={issue:?}"),
            ClientFailure::Startup {
                stage,
                category,
                code,
            } => {
                format!("stage={stage:?} category={category:?} code={code:?}")
            }
            ClientFailure::Operation { operation } => format!("stage=operation code={operation:?}"),
        };
        format!(
            "Native browser client failure: timestampUnixMs={} source=frontend sample={} {detail}",
            self.timestamp_unix_ms, self.sample
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_fixed_metadata_can_reach_the_application_log() {
        for failure in [
            json!({"kind":"configuration","issue":"url-credentials"}),
            json!({"kind":"startup","stage":"listen","category":"ipc"}),
            json!({"kind":"startup","stage":"create","category":"runtime","code":"start-timeout"}),
            json!({"kind":"operation","operation":"navigation"}),
        ] {
            let parsed: BrowserFailureEvent = serde_json::from_value(
                json!({"sample":7,"timestampUnixMs":1720000000000u64,"failure":failure}),
            )
            .unwrap();
            assert!(parsed.message().contains("source=frontend sample=7"));
        }
        for mut value in [
            json!({"sample":1,"failure":{"kind":"configuration","issue":"https://PRIVATE/?secret"}}),
            json!({"sample":1,"failure":{"kind":"startup","stage":"listen","category":"ipc","error":"PRIVATE"}}),
            json!({"sample":1,"url":"PRIVATE","failure":{"kind":"operation","operation":"navigation"}}),
            json!({"sample":1,"failure":{"kind":"startup","stage":"create","category":"runtime","code":"PRIVATE"}}),
        ] {
            value["timestampUnixMs"] = json!(1720000000000u64);
            assert!(serde_json::from_value::<BrowserFailureEvent>(value).is_err());
        }
    }
}
