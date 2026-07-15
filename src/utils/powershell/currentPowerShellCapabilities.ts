import type {
  PsAuthCapability,
  PsAuthMethod,
  PsFeature,
  PsFeatureCapability,
  PsRemotingCapabilities,
  PsTransportCapability,
  PsTransportProtocol,
} from "../../types/powershell";
import type {
  PowerShellRemotingSettings,
  PowerShellRemotingTransport,
} from "../../types/powershellRemoting";

/**
 * Checked-in mirror of `PsRemotingCapabilities::current()`.
 *
 * There is deliberately no frontend capability RPC yet: the current Tauri
 * command registry does not expose one. Keeping this fixture explicit makes
 * unsupported UI choices fail closed until that registry gains a real query.
 */
export const CURRENT_POWER_SHELL_REMOTING_CAPABILITIES = {
  implementation: "legacyWinRsProcessShell",
  transports: [
    {
      transport: "http",
      status: "partial",
      reason:
        "WSMan launches independent powershell.exe processes; it is not a persistent PSRP runspace",
    },
    {
      transport: "https",
      status: "partial",
      reason:
        "WSMan launches independent powershell.exe processes; it is not a persistent PSRP runspace",
    },
    {
      transport: "ssh",
      status: "unsupported",
      reason:
        "the SSH transport is a placeholder without an authenticated subsystem channel or host-key verification",
    },
  ],
  authentication: [
    {
      authMethod: "basic",
      status: "partial",
      requiresTls: true,
      reason:
        "available only for the legacy process shell and enforced over HTTPS",
    },
    {
      authMethod: "ntlm",
      status: "partial",
      requiresTls: false,
      reason:
        "NTLM primitives exist, but HTTP challenge handling is not wired end to end",
    },
    {
      authMethod: "negotiate",
      status: "partial",
      requiresTls: false,
      reason:
        "currently aliases the incomplete NTLM path instead of negotiating Kerberos",
    },
    {
      authMethod: "kerberos",
      status: "partial",
      requiresTls: false,
      reason:
        "Kerberos token generation exists, but the HTTP challenge exchange is not wired end to end",
    },
    {
      authMethod: "credSsp",
      status: "unsupported",
      requiresTls: true,
      reason:
        "TLS channel binding and credential delegation are not implemented",
    },
    {
      authMethod: "certificate",
      status: "unsupported",
      requiresTls: true,
      reason: "the HTTP transport cannot attach a client certificate identity",
    },
    {
      authMethod: "default",
      status: "partial",
      requiresTls: false,
      reason: "currently aliases the incomplete Negotiate path",
    },
    {
      authMethod: "digest",
      status: "partial",
      requiresTls: false,
      reason:
        "Digest primitives exist, but HTTP challenge handling is not wired end to end",
    },
  ],
  features: [
    {
      feature: "legacyWinRsProcessShell",
      status: "supported",
      reason: "runs encoded powershell.exe commands through a WinRS shell",
    },
    {
      feature: "persistentRunspace",
      status: "unsupported",
      reason: "each invocation starts an independent powershell.exe process",
    },
    {
      feature: "standardPowerShellStreams",
      status: "partial",
      reason: "only WinRS stdout and stderr are transported reliably",
    },
    {
      feature: "pipelineInput",
      status: "unsupported",
      reason:
        "the current executor does not maintain a PSRP pipeline input stream",
    },
    {
      feature: "commandCancellation",
      status: "unsupported",
      reason:
        "the current service command path holds a global mutex during execution",
    },
    {
      feature: "disconnectReconnect",
      status: "partial",
      reason:
        "WSMan signals exist but are not proven against a persistent PSRP runspace",
    },
    {
      feature: "interactiveState",
      status: "unsupported",
      reason:
        "interactive lines execute in separate processes and do not preserve state",
    },
    {
      feature: "networkPath",
      status: "unsupported",
      reason: "serialized proxy settings are not materialized by this backend",
    },
  ],
} as const satisfies PsRemotingCapabilities;

export function getPowerShellTransportCapability(
  capabilities: PsRemotingCapabilities,
  transport: PowerShellRemotingTransport,
  wsmanScheme: PowerShellRemotingSettings["wsman"]["scheme"] = "https",
): PsTransportCapability | undefined {
  const wireTransport: PsTransportProtocol =
    transport === "ssh" ? "ssh" : wsmanScheme;
  return capabilities.transports.find(
    (entry) => entry.transport === wireTransport,
  );
}

export function getPowerShellAuthCapability(
  capabilities: PsRemotingCapabilities,
  authMethod: PsAuthMethod,
): PsAuthCapability | undefined {
  return capabilities.authentication.find(
    (entry) => entry.authMethod === authMethod,
  );
}

export function getPowerShellFeatureCapability(
  capabilities: PsRemotingCapabilities,
  feature: PsFeature,
): PsFeatureCapability | undefined {
  return capabilities.features.find((entry) => entry.feature === feature);
}
