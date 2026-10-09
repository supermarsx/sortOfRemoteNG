//! Fixed journal schema for locally observed TLS bridge failures. These names
//! are not claims about a server certificate or the engine's internal cause.
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TlsBridgeFailure {
    ContextCreation,
    InvalidEvidence,
    InvalidState,
    OwnerUnavailable,
    Callback,
    CompleteRejected,
    RevokeRejected,
    EngineRevoked,
    EngineFailure,
    PoisonedState,
    WrongThread,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_failure_reasons_are_fixed_names_only() {
        for (reason, expected) in [
            (TlsBridgeFailure::ContextCreation, "context-creation"),
            (TlsBridgeFailure::InvalidEvidence, "invalid-evidence"),
            (TlsBridgeFailure::InvalidState, "invalid-state"),
            (TlsBridgeFailure::OwnerUnavailable, "owner-unavailable"),
            (TlsBridgeFailure::Callback, "callback"),
            (TlsBridgeFailure::CompleteRejected, "complete-rejected"),
            (TlsBridgeFailure::RevokeRejected, "revoke-rejected"),
            (TlsBridgeFailure::EngineRevoked, "engine-revoked"),
            (TlsBridgeFailure::EngineFailure, "engine-failure"),
            (TlsBridgeFailure::PoisonedState, "poisoned-state"),
            (TlsBridgeFailure::WrongThread, "wrong-thread"),
        ] {
            assert_eq!(serde_json::to_value(reason).unwrap(), expected);
        }
    }
}
