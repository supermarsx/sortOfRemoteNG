//! Truthful capability reporting for the current PowerShell backend.
//!
//! The existing implementation is a WinRS process-shell client, not a full
//! MS-PSRP runspace engine. Keeping this matrix in the backend prevents a UI
//! or command caller from inferring support merely because an enum variant or
//! placeholder transport exists.

use crate::types::{PsAuthMethod, PsTransportProtocol};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PsCapabilityStatus {
    /// Implemented and covered by the current backend contract.
    Supported,
    /// Some implementation exists, but it is not full remoting support.
    Partial,
    /// The backend rejects this capability rather than pretending it works.
    Unsupported,
}

impl PsCapabilityStatus {
    pub fn is_supported(self) -> bool {
        self == Self::Supported
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PsTransportCapability {
    pub transport: PsTransportProtocol,
    pub status: PsCapabilityStatus,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PsAuthCapability {
    pub auth_method: PsAuthMethod,
    pub status: PsCapabilityStatus,
    pub requires_tls: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PsFeature {
    LegacyWinRsProcessShell,
    PersistentRunspace,
    StandardPowerShellStreams,
    PipelineInput,
    CommandCancellation,
    DisconnectReconnect,
    InteractiveState,
    NetworkPath,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PsFeatureCapability {
    pub feature: PsFeature,
    pub status: PsCapabilityStatus,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PsRemotingCapabilities {
    /// Identifies the implementation so callers cannot mistake WinRS for
    /// native PowerShell Remoting Protocol support.
    pub implementation: String,
    pub transports: Vec<PsTransportCapability>,
    pub authentication: Vec<PsAuthCapability>,
    pub features: Vec<PsFeatureCapability>,
}

impl PsRemotingCapabilities {
    /// Capabilities of the dependency-free backend currently in this crate.
    pub fn current() -> Self {
        use PsCapabilityStatus::{Partial, Supported, Unsupported};

        Self {
            implementation: "legacyWinRsProcessShell".to_string(),
            transports: vec![
                PsTransportCapability {
                    transport: PsTransportProtocol::Http,
                    status: Partial,
                    reason: "WSMan launches independent powershell.exe processes; it is not a persistent PSRP runspace"
                        .to_string(),
                },
                PsTransportCapability {
                    transport: PsTransportProtocol::Https,
                    status: Partial,
                    reason: "WSMan launches independent powershell.exe processes; it is not a persistent PSRP runspace"
                        .to_string(),
                },
                PsTransportCapability {
                    transport: PsTransportProtocol::Ssh,
                    status: Unsupported,
                    reason: "the SSH transport is a placeholder without an authenticated subsystem channel or host-key verification"
                        .to_string(),
                },
            ],
            authentication: vec![
                PsAuthCapability {
                    auth_method: PsAuthMethod::Basic,
                    status: Partial,
                    requires_tls: true,
                    reason: "available only for the legacy process shell and enforced over HTTPS"
                        .to_string(),
                },
                PsAuthCapability {
                    auth_method: PsAuthMethod::Ntlm,
                    status: Partial,
                    requires_tls: false,
                    reason: "NTLM primitives exist, but HTTP challenge handling is not wired end to end"
                        .to_string(),
                },
                PsAuthCapability {
                    auth_method: PsAuthMethod::Negotiate,
                    status: Partial,
                    requires_tls: false,
                    reason: "currently aliases the incomplete NTLM path instead of negotiating Kerberos"
                        .to_string(),
                },
                PsAuthCapability {
                    auth_method: PsAuthMethod::Kerberos,
                    status: Partial,
                    requires_tls: false,
                    reason: "Kerberos token generation exists, but the HTTP challenge exchange is not wired end to end"
                        .to_string(),
                },
                PsAuthCapability {
                    auth_method: PsAuthMethod::CredSsp,
                    status: Unsupported,
                    requires_tls: true,
                    reason: "TLS channel binding and credential delegation are not implemented"
                        .to_string(),
                },
                PsAuthCapability {
                    auth_method: PsAuthMethod::Certificate,
                    status: Unsupported,
                    requires_tls: true,
                    reason: "the HTTP transport cannot attach a client certificate identity"
                        .to_string(),
                },
                PsAuthCapability {
                    auth_method: PsAuthMethod::Default,
                    status: Partial,
                    requires_tls: false,
                    reason: "currently aliases the incomplete Negotiate path".to_string(),
                },
                PsAuthCapability {
                    auth_method: PsAuthMethod::Digest,
                    status: Partial,
                    requires_tls: false,
                    reason: "Digest primitives exist, but HTTP challenge handling is not wired end to end"
                        .to_string(),
                },
            ],
            features: vec![
                PsFeatureCapability {
                    feature: PsFeature::LegacyWinRsProcessShell,
                    status: Supported,
                    reason: "runs encoded powershell.exe commands through a WinRS shell"
                        .to_string(),
                },
                PsFeatureCapability {
                    feature: PsFeature::PersistentRunspace,
                    status: Unsupported,
                    reason: "each invocation starts an independent powershell.exe process"
                        .to_string(),
                },
                PsFeatureCapability {
                    feature: PsFeature::StandardPowerShellStreams,
                    status: Partial,
                    reason: "only WinRS stdout and stderr are transported reliably".to_string(),
                },
                PsFeatureCapability {
                    feature: PsFeature::PipelineInput,
                    status: Unsupported,
                    reason: "the current executor does not maintain a PSRP pipeline input stream"
                        .to_string(),
                },
                PsFeatureCapability {
                    feature: PsFeature::CommandCancellation,
                    status: Unsupported,
                    reason: "the current service command path holds a global mutex during execution"
                        .to_string(),
                },
                PsFeatureCapability {
                    feature: PsFeature::DisconnectReconnect,
                    status: Partial,
                    reason: "WSMan signals exist but are not proven against a persistent PSRP runspace"
                        .to_string(),
                },
                PsFeatureCapability {
                    feature: PsFeature::InteractiveState,
                    status: Unsupported,
                    reason: "interactive lines execute in separate processes and do not preserve state"
                        .to_string(),
                },
                PsFeatureCapability {
                    feature: PsFeature::NetworkPath,
                    status: Unsupported,
                    reason: "serialized proxy settings are not materialized by this backend"
                        .to_string(),
                },
            ],
        }
    }

    pub fn transport(&self, transport: &PsTransportProtocol) -> Option<&PsTransportCapability> {
        self.transports
            .iter()
            .find(|entry| entry.transport == *transport)
    }

    pub fn auth(&self, auth_method: &PsAuthMethod) -> Option<&PsAuthCapability> {
        self.authentication
            .iter()
            .find(|entry| entry.auth_method == *auth_method)
    }

    pub fn feature(&self, feature: PsFeature) -> Option<&PsFeatureCapability> {
        self.features.iter().find(|entry| entry.feature == feature)
    }
}

impl Default for PsRemotingCapabilities {
    fn default() -> Self {
        Self::current()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_placeholders_are_reported_explicitly() {
        let capabilities = PsRemotingCapabilities::current();
        assert_eq!(
            capabilities
                .transport(&PsTransportProtocol::Ssh)
                .unwrap()
                .status,
            PsCapabilityStatus::Unsupported
        );
        for auth in [PsAuthMethod::Certificate, PsAuthMethod::CredSsp] {
            assert_eq!(
                capabilities.auth(&auth).unwrap().status,
                PsCapabilityStatus::Unsupported
            );
        }
        assert_eq!(
            capabilities
                .feature(PsFeature::PersistentRunspace)
                .unwrap()
                .status,
            PsCapabilityStatus::Unsupported
        );
    }

    #[test]
    fn capability_matrix_is_exhaustive_and_serializes_stably() {
        let capabilities = PsRemotingCapabilities::current();
        assert_eq!(capabilities.transports.len(), 3);
        assert_eq!(capabilities.authentication.len(), 8);
        assert_eq!(capabilities.features.len(), 8);

        let value = serde_json::to_value(capabilities).unwrap();
        assert_eq!(value["implementation"], "legacyWinRsProcessShell");
        assert!(value["authentication"][0].get("authMethod").is_some());
        assert_eq!(value["features"][1]["feature"], "persistentRunspace");
    }
}
