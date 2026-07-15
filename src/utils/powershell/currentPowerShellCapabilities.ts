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
export const LEGACY_POWER_SHELL_REMOTING_CAPABILITIES = {
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

/** Shipping live-session capabilities exposed by the strict PSRP service. */
export const CURRENT_POWER_SHELL_REMOTING_CAPABILITIES = {
  implementation: "dualTransportPsrpRunspace",
  transports: [
    {
      transport: "http",
      status: "partial",
      reason:
        "direct PSRP-over-WSMan with explicit NTLM is deterministic-contract verified; live Windows interoperability is unverified and HTTP has no transport confidentiality",
    },
    {
      transport: "https",
      status: "partial",
      reason:
        "direct PSRP-over-WSMan with Basic or explicit NTLM and Trust Center TLS is deterministic-contract verified; live Windows interoperability is unverified",
    },
    {
      transport: "ssh",
      status: "supported",
      reason:
        "strict PowerShell OutOfProcess remoting over a verified SSH subsystem and persistent PSRP runspace",
    },
  ],
  authentication: [
    {
      authMethod: "basic",
      status: "partial",
      requiresTls: true,
      reason:
        "available only over direct HTTPS with Trust Center verification; deterministic-contract verified and live Windows unverified",
    },
    {
      authMethod: "ntlm",
      status: "partial",
      requiresTls: false,
      reason:
        "explicit NTLM challenge exchange is deterministic-contract verified; live Windows acceptance is unverified and HTTPS is recommended",
    },
    ...(
      [
        [
          "negotiate",
          "Negotiate/SPNEGO is not claimed; select NTLM explicitly",
        ],
        ["kerberos", "Kerberos is not integrated with the WSMan HTTP exchange"],
        [
          "credSsp",
          "CredSSP channel binding and delegation are not implemented",
        ],
        [
          "certificate",
          "client certificate identities are not attached by the adapter",
        ],
        [
          "default",
          "backend-default authentication is ambiguous; select NTLM explicitly",
        ],
        ["digest", "Digest is not integrated with the WSMan HTTP exchange"],
      ] as const
    ).map(([authMethod, reason]) => ({
      authMethod,
      status: "unsupported" as const,
      requiresTls: authMethod === "credSsp" || authMethod === "certificate",
      reason,
    })),
  ] as PsAuthCapability[],
  features: [
    {
      feature: "legacyWinRsProcessShell",
      status: "unsupported",
      reason: "the live viewer uses PSRP rather than the legacy process shell",
    },
    {
      feature: "persistentRunspace",
      status: "supported",
      reason: "sequential pipelines reuse one remote runspace",
    },
    {
      feature: "standardPowerShellStreams",
      status: "supported",
      reason:
        "output, error, warning, verbose, debug, information, and progress are delivered separately",
    },
    {
      feature: "pipelineInput",
      status: "supported",
      reason: "streaming input and explicit end-input are wired",
    },
    {
      feature: "commandCancellation",
      status: "supported",
      reason: "the per-session actor sends a real transport stop signal",
    },
    {
      feature: "disconnectReconnect",
      status: "partial",
      reason:
        "viewer detach and bounded replay are supported; transport reconnect creates a new runspace",
    },
    {
      feature: "interactiveState",
      status: "supported",
      reason: "sequential commands preserve runspace state",
    },
    {
      feature: "networkPath",
      status: "unsupported",
      reason:
        "live SSH and WSMan sessions currently require direct endpoints; configured connection paths and proxies fail closed",
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
