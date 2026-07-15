import type { PsAuthMethod } from "../../types/powershell";
import {
  POWERSHELL_REMOTING_SCHEMA_VERSION,
  type NormalizedPowerShellRemotingSettings,
  type PowerShellCredentialSource,
  type PowerShellNetworkPathMode,
  type PowerShellProxyMode,
  type PowerShellRemotingSettings,
  type PowerShellSettingsIssue,
  type PowerShellSshAuthMethod,
  type PowerShellSshHostTrustMode,
  type PowerShellTlsTrustMode,
  type PowerShellWsmanScheme,
} from "../../types/powershellRemoting";

const AUTH_METHODS = new Set<PsAuthMethod>([
  "basic",
  "ntlm",
  "negotiate",
  "kerberos",
  "credSsp",
  "certificate",
  "default",
  "digest",
]);

const CREDENTIAL_SOURCES = new Set<PowerShellCredentialSource>([
  "saved",
  "prompt",
  "vault",
]);
const TLS_TRUST_MODES = new Set<PowerShellTlsTrustMode>([
  "system",
  "tofu",
  "pinned",
  "alwaysTrust",
]);
const SSH_TRUST_MODES = new Set<PowerShellSshHostTrustMode>([
  "strict",
  "tofu",
  "pinned",
]);
const SSH_AUTH_METHODS = new Set<PowerShellSshAuthMethod>([
  "password",
  "privateKey",
  "agent",
]);
const PROXY_MODES = new Set<PowerShellProxyMode>(["none", "http", "socks5"]);
const NETWORK_PATH_MODES = new Set<PowerShellNetworkPathMode>([
  "direct",
  "connectionPath",
]);

const SECRET_FIELD_NAMES = new Set([
  "password",
  "passphrase",
  "privatekey",
  "privatekeyvalue",
  "clientsecret",
  "accesstoken",
  "refreshtoken",
]);

export function createDefaultPowerShellRemotingSettings(): PowerShellRemotingSettings {
  return {
    schemaVersion: POWERSHELL_REMOTING_SCHEMA_VERSION,
    transport: "wsman",
    credential: {
      source: "prompt",
      username: "",
      domain: null,
      savedCredentialId: null,
      vaultRef: null,
    },
    wsman: {
      scheme: "https",
      port: 5986,
      path: "/wsman",
      connectionUri: null,
      configurationName: "microsoft.powershell",
      applicationName: "wsman",
      authMethod: "negotiate",
      tls: {
        trustMode: "system",
        pinnedFingerprint: null,
        skipHostnameCheck: false,
        skipRevocationCheck: false,
        clientCertificateRef: null,
      },
      proxy: {
        mode: "none",
        url: null,
        credentialRef: null,
      },
    },
    ssh: {
      port: 22,
      subsystem: "powershell",
      authMethod: "agent",
      privateKeyPath: null,
      privateKeyCredentialRef: null,
      agentSocket: null,
      hostTrust: {
        mode: "strict",
        fingerprint: null,
      },
      keepaliveSec: 30,
      compression: true,
    },
    session: {
      connectTimeoutSec: 30,
      openTimeoutSec: 180,
      operationTimeoutSec: 180,
      cancelTimeoutSec: 60,
      idleTimeoutSec: 7200,
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        delaySec: 5,
      },
      outputBufferingMode: "block",
      maxReceivedDataSizeMb: 50,
      maxReceivedObjectSizeMb: 10,
    },
    networkPath: {
      mode: "direct",
      pathId: null,
      summary: null,
    },
    windowsTools: {
      enabled: false,
      settingsSource: "separateWinrmSettings",
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringOr(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integerOr(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function enumOr<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  return typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : fallback;
}

function normalizeWsmanPath(value: unknown): string {
  const raw = stringOr(value, "/wsman");
  const withoutQuery = raw.split(/[?#]/, 1)[0];
  const collapsed = withoutQuery.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const withLeadingSlash = collapsed.startsWith("/")
    ? collapsed
    : `/${collapsed}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/$/, "")
    : withLeadingSlash;
}

function containsInlineSecret(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => containsInlineSecret(entry, seen));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) =>
      (SECRET_FIELD_NAMES.has(key.toLowerCase()) &&
        entry !== null &&
        entry !== undefined &&
        entry !== "") ||
      containsInlineSecret(entry, seen),
  );
}

function normalizeAuthMethod(value: unknown, warnings: string[]): PsAuthMethod {
  if (typeof value === "string") {
    const alias = value.toLowerCase() === "credssp" ? "credSsp" : value;
    if (AUTH_METHODS.has(alias as PsAuthMethod)) return alias as PsAuthMethod;
    warnings.push(
      `Unknown PowerShell authentication method '${value}' was reset.`,
    );
  }
  return "negotiate";
}

function normalizeProxyMode(value: unknown): PowerShellProxyMode {
  if (value === "noProxyServer") return "none";
  return enumOr(value, PROXY_MODES, "none");
}

/**
 * Normalize current settings and the two historic shapes previously used by
 * the frontend (`PsRemotingConfig` and the WMI-oriented WinRM editor object).
 * Unknown keys and inline secrets are deliberately discarded.
 */
export function normalizePowerShellRemotingSettings(
  input: unknown,
): NormalizedPowerShellRemotingSettings {
  const defaults = createDefaultPowerShellRemotingSettings();
  const raw = asRecord(input);
  const warnings: string[] = [];
  const rawVersion = raw.schemaVersion;
  const isCurrent = rawVersion === POWERSHELL_REMOTING_SCHEMA_VERSION;
  const isObject = input !== null && typeof input === "object";

  let migratedFromVersion: number | "legacy" | undefined;
  if (isObject && !isCurrent) {
    migratedFromVersion =
      typeof rawVersion === "number" ? rawVersion : "legacy";
    warnings.push(
      typeof rawVersion === "number"
        ? `PowerShell Remoting settings schema ${rawVersion} was migrated to schema ${POWERSHELL_REMOTING_SCHEMA_VERSION}.`
        : "Legacy PowerShell Remoting settings were migrated to the current schema.",
    );
  } else if (!isObject) {
    warnings.push(
      "Missing PowerShell Remoting settings were replaced with safe defaults.",
    );
  }

  if (containsInlineSecret(input)) {
    warnings.push(
      "Inline passwords, passphrases, tokens, and private-key values were omitted; use a saved credential, prompt, or vault reference.",
    );
  }

  const credentialRaw = asRecord(raw.credential);
  const wsmanRaw = asRecord(raw.wsman);
  const tlsRaw = asRecord(wsmanRaw.tls);
  const proxyRaw = asRecord(wsmanRaw.proxy ?? raw.proxy);
  const sshRaw = asRecord(raw.ssh);
  const sshTrustRaw = asRecord(sshRaw.hostTrust);
  const sessionRaw = asRecord(raw.session);
  const legacySessionRaw = asRecord(raw.sessionOption);
  const reconnectRaw = asRecord(sessionRaw.reconnect);
  const networkPathRaw = asRecord(raw.networkPath);
  const windowsToolsRaw = asRecord(raw.windowsTools);

  const legacyTransport = raw.transport;
  const transport =
    legacyTransport === "ssh"
      ? "ssh"
      : legacyTransport === "wsman" ||
          legacyTransport === "http" ||
          legacyTransport === "https"
        ? "wsman"
        : defaults.transport;

  const inferredScheme: PowerShellWsmanScheme =
    legacyTransport === "http" ||
    raw.useSsl === false ||
    raw.preferSsl === false
      ? "http"
      : "https";
  const scheme = enumOr(
    wsmanRaw.scheme,
    new Set<PowerShellWsmanScheme>(["http", "https"]),
    inferredScheme,
  );
  const defaultPort = scheme === "https" ? 5986 : 5985;
  const legacyPort =
    raw.port ?? (scheme === "https" ? raw.httpsPort : raw.httpPort);

  const source = enumOr(
    credentialRaw.source,
    CREDENTIAL_SOURCES,
    credentialRaw.vaultRef || raw.vaultRef
      ? "vault"
      : credentialRaw.savedCredentialId || raw.credentialId
        ? "saved"
        : "prompt",
  );
  const vaultRaw = asRecord(credentialRaw.vaultRef ?? raw.vaultRef);

  const legacySkipCa = boolOr(raw.skipCaCheck, false);
  const settings: PowerShellRemotingSettings = {
    schemaVersion: POWERSHELL_REMOTING_SCHEMA_VERSION,
    transport,
    credential: {
      source,
      username: stringOr(credentialRaw.username ?? raw.username, ""),
      domain: optionalString(credentialRaw.domain ?? raw.domain),
      savedCredentialId: optionalString(
        credentialRaw.savedCredentialId ?? raw.credentialId,
      ),
      vaultRef:
        source === "vault"
          ? {
              integrationId: optionalString(vaultRaw.integrationId),
              secretId: stringOr(vaultRaw.secretId, ""),
            }
          : null,
    },
    wsman: {
      scheme,
      port: integerOr(wsmanRaw.port ?? legacyPort, defaultPort, 1, 65535),
      path: normalizeWsmanPath(wsmanRaw.path ?? raw.uriPath),
      connectionUri: optionalString(
        wsmanRaw.connectionUri ?? raw.connectionUri,
      ),
      configurationName: stringOr(
        wsmanRaw.configurationName ?? raw.configurationName,
        defaults.wsman.configurationName,
      ),
      applicationName: stringOr(
        wsmanRaw.applicationName ?? raw.applicationName,
        defaults.wsman.applicationName,
      ),
      authMethod: normalizeAuthMethod(
        wsmanRaw.authMethod ?? raw.authMethod,
        warnings,
      ),
      tls: {
        trustMode: enumOr(
          tlsRaw.trustMode,
          TLS_TRUST_MODES,
          legacySkipCa ? "alwaysTrust" : defaults.wsman.tls.trustMode,
        ),
        pinnedFingerprint: optionalString(tlsRaw.pinnedFingerprint),
        skipHostnameCheck: boolOr(
          tlsRaw.skipHostnameCheck ?? raw.skipCnCheck,
          false,
        ),
        skipRevocationCheck: boolOr(
          tlsRaw.skipRevocationCheck ?? raw.skipRevocationCheck,
          false,
        ),
        clientCertificateRef: optionalString(tlsRaw.clientCertificateRef),
      },
      proxy: {
        mode: normalizeProxyMode(proxyRaw.mode ?? proxyRaw.accessType),
        url: optionalString(proxyRaw.url),
        credentialRef: optionalString(proxyRaw.credentialRef),
      },
    },
    ssh: {
      port: integerOr(sshRaw.port, defaults.ssh.port, 1, 65535),
      subsystem: stringOr(sshRaw.subsystem, defaults.ssh.subsystem),
      authMethod: enumOr(
        sshRaw.authMethod,
        SSH_AUTH_METHODS,
        defaults.ssh.authMethod,
      ),
      privateKeyPath: optionalString(
        sshRaw.privateKeyPath ?? credentialRaw.sshKeyPath,
      ),
      privateKeyCredentialRef: optionalString(sshRaw.privateKeyCredentialRef),
      agentSocket: optionalString(sshRaw.agentSocket),
      hostTrust: {
        mode: enumOr(
          sshTrustRaw.mode,
          SSH_TRUST_MODES,
          defaults.ssh.hostTrust.mode,
        ),
        fingerprint: optionalString(sshTrustRaw.fingerprint),
      },
      keepaliveSec: integerOr(
        sshRaw.keepaliveSec,
        defaults.ssh.keepaliveSec,
        0,
        3600,
      ),
      compression: boolOr(sshRaw.compression, defaults.ssh.compression),
    },
    session: {
      connectTimeoutSec: integerOr(
        sessionRaw.connectTimeoutSec ?? raw.timeoutSec,
        defaults.session.connectTimeoutSec,
        1,
        86400,
      ),
      openTimeoutSec: integerOr(
        sessionRaw.openTimeoutSec ?? legacySessionRaw.openTimeoutSec,
        defaults.session.openTimeoutSec,
        1,
        86400,
      ),
      operationTimeoutSec: integerOr(
        sessionRaw.operationTimeoutSec ??
          legacySessionRaw.operationTimeoutSec ??
          raw.timeoutSec,
        defaults.session.operationTimeoutSec,
        1,
        86400,
      ),
      cancelTimeoutSec: integerOr(
        sessionRaw.cancelTimeoutSec ?? legacySessionRaw.cancelTimeoutSec,
        defaults.session.cancelTimeoutSec,
        1,
        86400,
      ),
      idleTimeoutSec: integerOr(
        sessionRaw.idleTimeoutSec ?? legacySessionRaw.idleTimeoutSec,
        defaults.session.idleTimeoutSec,
        1,
        604800,
      ),
      reconnect: {
        enabled: boolOr(
          reconnectRaw.enabled ?? raw.enableReconnect,
          defaults.session.reconnect.enabled,
        ),
        maxAttempts: integerOr(
          reconnectRaw.maxAttempts ?? legacySessionRaw.maxConnectionRetryCount,
          defaults.session.reconnect.maxAttempts,
          0,
          100,
        ),
        delaySec: integerOr(
          reconnectRaw.delaySec ?? legacySessionRaw.maxConnectionRetryDelaySec,
          defaults.session.reconnect.delaySec,
          0,
          3600,
        ),
      },
      outputBufferingMode: enumOr(
        sessionRaw.outputBufferingMode ?? legacySessionRaw.outputBufferingMode,
        new Set(["none", "drop", "block"] as const),
        defaults.session.outputBufferingMode,
      ),
      maxReceivedDataSizeMb: integerOr(
        sessionRaw.maxReceivedDataSizeMb ??
          legacySessionRaw.maxReceivedDataSizeMb,
        defaults.session.maxReceivedDataSizeMb,
        1,
        4096,
      ),
      maxReceivedObjectSizeMb: integerOr(
        sessionRaw.maxReceivedObjectSizeMb ??
          legacySessionRaw.maxReceivedObjectSizeMb,
        defaults.session.maxReceivedObjectSizeMb,
        1,
        4096,
      ),
    },
    networkPath: {
      mode: enumOr(
        networkPathRaw.mode,
        NETWORK_PATH_MODES,
        defaults.networkPath.mode,
      ),
      pathId: optionalString(networkPathRaw.pathId),
      summary: optionalString(networkPathRaw.summary),
    },
    windowsTools: {
      enabled: boolOr(windowsToolsRaw.enabled, defaults.windowsTools.enabled),
      settingsSource: "separateWinrmSettings",
    },
  };

  if (
    !isCurrent &&
    (raw.wmiNamespace !== undefined || raw.namespace !== undefined)
  ) {
    warnings.push(
      "The WMI namespace was not migrated; WMI and Windows Tools remain in their separate WinRM settings.",
    );
  }
  if (
    !isCurrent &&
    proxyRaw.accessType !== undefined &&
    proxyRaw.url === undefined
  ) {
    warnings.push(
      "The legacy WinHTTP proxy selector had no concrete endpoint and was reset; choose a connection network path or explicit proxy.",
    );
  }

  return {
    settings,
    warnings,
    issues: validatePowerShellRemotingSettings(settings),
    ...(migratedFromVersion === undefined ? {} : { migratedFromVersion }),
  };
}

function formatHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) throw new Error("A target host is required.");
  if (/[\/@?#]/.test(trimmed)) {
    throw new Error(
      "The target host must not include credentials, a path, query, or fragment.",
    );
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
  return trimmed.includes(":") ? `[${trimmed}]` : trimmed;
}

function canonicalHttpEndpoint(
  settings: PowerShellRemotingSettings,
  targetHost: string,
): string {
  const configured = settings.wsman.connectionUri;
  if (!configured) {
    return `${settings.wsman.scheme}://${formatHost(targetHost)}:${settings.wsman.port}${normalizeWsmanPath(settings.wsman.path)}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("The custom WSMan connection URI is not a valid URL.");
  }
  const scheme = parsed.protocol.replace(/:$/, "");
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("A WSMan connection URI must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credentials must not be embedded in the connection URI.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "The WSMan connection URI must not contain a query or fragment.",
    );
  }

  const port = parsed.port
    ? integerOr(parsed.port, scheme === "https" ? 5986 : 5985, 1, 65535)
    : scheme === "https"
      ? 5986
      : 5985;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  return `${scheme}://${formatHost(hostname)}:${port}${normalizeWsmanPath(parsed.pathname)}`;
}

/** Return a stable, credential-free endpoint suitable for preview and logs. */
export function canonicalPowerShellEndpoint(
  settings: PowerShellRemotingSettings,
  targetHost: string,
): string {
  if (settings.transport === "ssh") {
    const subsystem = encodeURIComponent(settings.ssh.subsystem.trim());
    return `ssh://${formatHost(targetHost)}:${settings.ssh.port}/${subsystem}`;
  }
  return canonicalHttpEndpoint(settings, targetHost);
}

export function validatePowerShellRemotingSettings(
  settings: PowerShellRemotingSettings,
  targetHost = "host.invalid",
): PowerShellSettingsIssue[] {
  const issues: PowerShellSettingsIssue[] = [];
  const add = (issue: PowerShellSettingsIssue) => issues.push(issue);

  if (settings.schemaVersion !== POWERSHELL_REMOTING_SCHEMA_VERSION) {
    add({
      path: "schemaVersion",
      code: "unsupportedSchema",
      severity: "error",
      message: `PowerShell Remoting schema ${settings.schemaVersion} is not supported.`,
    });
  }
  if (settings.wsman.port < 1 || settings.wsman.port > 65535) {
    add({
      path: "wsman.port",
      code: "invalidPort",
      severity: "error",
      message: "The WSMan port must be between 1 and 65535.",
    });
  }
  if (settings.ssh.port < 1 || settings.ssh.port > 65535) {
    add({
      path: "ssh.port",
      code: "invalidPort",
      severity: "error",
      message: "The SSH port must be between 1 and 65535.",
    });
  }
  if (
    settings.transport === "wsman" &&
    settings.wsman.authMethod === "basic" &&
    settings.wsman.scheme === "http"
  ) {
    add({
      path: "wsman.authMethod",
      code: "basicRequiresTls",
      severity: "error",
      message: "Basic authentication is blocked over HTTP. Select HTTPS first.",
    });
  }
  if (
    settings.credential.source === "saved" &&
    !settings.credential.savedCredentialId
  ) {
    add({
      path: "credential.savedCredentialId",
      code: "missingCredentialReference",
      severity: "error",
      message: "Choose a saved credential or use Prompt on connect.",
    });
  }
  if (
    settings.credential.source === "vault" &&
    !settings.credential.vaultRef?.secretId
  ) {
    add({
      path: "credential.vaultRef.secretId",
      code: "missingCredentialReference",
      severity: "error",
      message: "Choose a vault secret before connecting.",
    });
  }
  if (
    settings.wsman.tls.trustMode === "pinned" &&
    !settings.wsman.tls.pinnedFingerprint
  ) {
    add({
      path: "wsman.tls.pinnedFingerprint",
      code: "missingFingerprint",
      severity: "error",
      message: "Pinned TLS trust requires a certificate fingerprint.",
    });
  }
  if (
    settings.ssh.hostTrust.mode === "pinned" &&
    !settings.ssh.hostTrust.fingerprint
  ) {
    add({
      path: "ssh.hostTrust.fingerprint",
      code: "missingFingerprint",
      severity: "error",
      message: "Pinned SSH host trust requires a host-key fingerprint.",
    });
  }
  if (
    settings.ssh.authMethod === "privateKey" &&
    !settings.ssh.privateKeyPath &&
    !settings.ssh.privateKeyCredentialRef
  ) {
    add({
      path: "ssh.privateKeyPath",
      code: "missingPrivateKey",
      severity: "error",
      message:
        "Private-key authentication requires a key path or credential reference.",
    });
  }
  if (settings.wsman.proxy.mode !== "none" && !settings.wsman.proxy.url) {
    add({
      path: "wsman.proxy.url",
      code: "missingProxyUrl",
      severity: "error",
      message: "The selected proxy mode requires a proxy URL.",
    });
  }

  try {
    canonicalPowerShellEndpoint(settings, targetHost);
  } catch (error) {
    add({
      path: "wsman.connectionUri",
      code: "invalidEndpoint",
      severity: "error",
      message:
        error instanceof Error ? error.message : "The endpoint is invalid.",
    });
  }

  return issues;
}
