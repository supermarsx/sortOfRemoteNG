import type { Connection } from "../../types/connection/connection";
import {
  createDefaultRawSocketSettings,
  normalizeRawSocketSettings,
  type RawSocketTransport,
} from "../../types/protocols/rawSocket";
import { normalizeAdvancedProtocolConnection } from "../../utils/connection/normalizeAdvancedProtocolConnection";
import { normalizePowerShellRemotingSettings } from "../../utils/powershell/normalizePowerShellRemoting";
import { migrateRloginSettings } from "../../utils/rlogin/rloginSettings";

export const ADVANCED_PROTOCOL_PORTABILITY_VERSION = 1 as const;

export const ADVANCED_PROTOCOL_NATIVE_FIELDS = [
  "AdvancedSettingsVersion",
  "RawSocketSettings",
  "RloginSettings",
  "PowerShellRemotingSettings",
] as const;

export type AdvancedProtocolNativeField =
  (typeof ADVANCED_PROTOCOL_NATIVE_FIELDS)[number];

export type NativeAdvancedProtocolRecord = Partial<
  Record<AdvancedProtocolNativeField, string>
>;

const SECRET_FIELD_NAMES = new Set([
  "password",
  "basicauthpassword",
  "rustdeskpassword",
  "proxypassword",
  "privatekey",
  "passphrase",
  "totpsecret",
  "apikey",
  "accesstoken",
  "clientsecret",
  "serviceaccountkey",
  "presharedkey",
  "authkey",
  "authtoken",
  "seedphrase",
  "answer",
]);

const SENSITIVE_REFERENCE_FIELD_NAMES = new Set([
  "savedcredentialid",
  "vaultref",
  "clientcertificateref",
  "credentialref",
  "privatekeycredentialref",
  "privatekeypath",
  "agentsocket",
]);

const RUNTIME_FIELD_NAMES = new Set([
  "backendsessionid",
  "shellid",
  "runtimesessionid",
  "detachedsessionid",
  "channelid",
  "terminalbuffer",
  "transcript",
  "transcripts",
  "replay",
  "replaybuffer",
  "outputsnapshot",
  "lastoutput",
  "commandhistory",
  "runtimestate",
  "backendstate",
]);

const SECRET_HEADER_NAMES =
  /authorization|proxy-authorization|cookie|token|secret|password|api[-_ ]?key/i;
const SECRET_PLACEHOLDER = "***ENCRYPTED***";

const normalizeFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const deepCopy = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, deepCopy(nested)]),
    ) as T;
  }
  return value;
};

export interface ImportedProtocolMapping {
  protocol: Connection["protocol"];
  rawTransport?: RawSocketTransport;
}

/**
 * Canonical protocol mapping used by native and vendor importers. RLogin is
 * deliberately exact-match only: an unknown shell protocol must never be
 * guessed to be plaintext RLogin.
 */
export function mapPortableProtocol(source: unknown): ImportedProtocolMapping {
  const value = String(source ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (["raw-udp", "raw_udp", "raw/udp", "udp"].includes(value)) {
    return { protocol: "raw", rawTransport: "udp" };
  }
  if (["raw", "raw-tcp", "raw_tcp", "raw/tcp", "rawsocket"].includes(value)) {
    return { protocol: "raw", rawTransport: "tcp" };
  }
  if (
    ["powershell", "powershell-remoting", "psremoting", "winrm"].includes(value)
  ) {
    return { protocol: "winrm" };
  }
  if (["rlogin", "r-login"].includes(value)) {
    return { protocol: "rlogin" };
  }

  const aliases: Partial<Record<string, Connection["protocol"]>> = {
    ssh: "ssh",
    ssh1: "ssh",
    ssh2: "ssh",
    telnet: "telnet",
    rdp: "rdp",
    vnc: "vnc",
    http: "http",
    https: "https",
    ftp: "ftp",
    sftp: "sftp",
    scp: "scp",
  };
  if (aliases[value]) return { protocol: aliases[value]! };

  return { protocol: (value || "rdp") as Connection["protocol"] };
}

/** Normalize an imported/synchronized connection and clear local consent. */
export function normalizeImportedAdvancedProtocolConnection(
  connection: Connection,
): Connection {
  const inferredProtocol =
    (typeof connection.protocol === "string" && connection.protocol.trim()) ||
    (connection.rawSocketSettings
      ? "raw"
      : connection.rloginSettings
        ? "rlogin"
        : connection.powerShellRemoting
          ? "winrm"
          : "");
  if (!inferredProtocol) return deepCopy(connection);
  const mapping = mapPortableProtocol(inferredProtocol);
  const canonicalSourceProtocol = inferredProtocol.trim().toLowerCase();
  const forceRawTransport =
    mapping.rawTransport !== undefined &&
    (connection.rawSocketSettings === undefined ||
      canonicalSourceProtocol !== "raw");
  const seeded: Connection = {
    ...deepCopy(connection),
    protocol: mapping.protocol,
    ...(forceRawTransport
      ? {
          rawSocketSettings: normalizeRawSocketSettings(
            connection.rawSocketSettings ??
              createDefaultRawSocketSettings(mapping.rawTransport!),
            mapping.rawTransport,
          ),
        }
      : {}),
  };
  const normalized = normalizeAdvancedProtocolConnection(seeded);

  if (normalized.rloginSettings) {
    normalized.rloginSettings = migrateRloginSettings(
      normalized.rloginSettings,
      { resetPlaintextAcknowledgement: true },
    );
  }
  if (normalized.powerShellRemoting) {
    normalized.powerShellRemoting = normalizePowerShellRemotingSettings(
      normalized.powerShellRemoting,
    ).settings;
  }
  return normalized;
}

type SecretMode = "preserve" | "strip" | "redact";

const sanitizeValue = <T>(
  value: T,
  secretMode: SecretMode,
  fieldName?: string,
): T | undefined => {
  const normalizedField = fieldName ? normalizeFieldName(fieldName) : "";
  if (normalizedField && RUNTIME_FIELD_NAMES.has(normalizedField)) {
    return undefined;
  }
  if (
    secretMode !== "preserve" &&
    normalizedField &&
    (SECRET_FIELD_NAMES.has(normalizedField) ||
      SENSITIVE_REFERENCE_FIELD_NAMES.has(normalizedField))
  ) {
    if (
      secretMode === "redact" &&
      SECRET_FIELD_NAMES.has(normalizedField) &&
      normalizedField.includes("password")
    ) {
      return SECRET_PLACEHOLDER as T;
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, secretMode))
      .filter((item) => item !== undefined) as T;
  }

  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (
        secretMode !== "preserve" &&
        key === "httpHeaders" &&
        isRecord(nestedValue)
      ) {
        next[key] = Object.fromEntries(
          Object.entries(nestedValue).filter(
            ([headerName]) => !SECRET_HEADER_NAMES.test(headerName),
          ),
        );
        continue;
      }
      const sanitized = sanitizeValue(nestedValue, secretMode, key);
      if (sanitized !== undefined) next[key] = sanitized;
    }
    return next as T;
  }

  return value;
};

const resetLocalConsent = (connection: Connection): Connection => {
  const copy = deepCopy(connection);
  if (copy.rloginSettings) {
    copy.rloginSettings = migrateRloginSettings(copy.rloginSettings, {
      resetPlaintextAcknowledgement: true,
    });
  }
  return copy;
};

/** Redact credentials while retaining all non-secret settings for export. */
export function redactConnectionSecretsForExport(
  connection: Connection,
): Connection {
  const reset = resetLocalConsent(connection);
  return sanitizeValue(reset, "redact") ?? reset;
}

export function prepareConnectionForExport(
  connection: Connection,
  includeCredentials: boolean,
): Connection {
  const normalized = normalizeImportedAdvancedProtocolConnection(connection);
  return (
    sanitizeValue(normalized, includeCredentials ? "preserve" : "redact") ??
    normalized
  );
}

/** Remove credentials and sensitive references at import/clone boundaries. */
export function stripConnectionCredentials(connection: Connection): Connection {
  const reset = resetLocalConsent(connection);
  return sanitizeValue(reset, "strip") ?? reset;
}

/**
 * Produce an independent clone. Operational state and RLogin consent never
 * travel; credential-bearing fields follow the existing include-credentials
 * choice.
 */
export function prepareConnectionForClone(
  connection: Connection,
  includeCredentials: boolean,
): Connection {
  const normalized = normalizeImportedAdvancedProtocolConnection(connection);
  return (
    sanitizeValue(normalized, includeCredentials ? "preserve" : "strip") ??
    normalized
  );
}

const stringifySetting = (value: unknown): string =>
  value === undefined ? "" : JSON.stringify(value);

/** Scalar fields used by native XML/CSV to round-trip nested settings. */
export function serializeNativeAdvancedProtocolSettings(
  connection: Connection,
): NativeAdvancedProtocolRecord {
  const safe = resetLocalConsent(connection);
  return {
    AdvancedSettingsVersion: String(ADVANCED_PROTOCOL_PORTABILITY_VERSION),
    RawSocketSettings: stringifySetting(safe.rawSocketSettings),
    RloginSettings: stringifySetting(safe.rloginSettings),
    PowerShellRemotingSettings: stringifySetting(safe.powerShellRemoting),
  };
}

const escapeXml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const escapeCsv = (value: unknown): string => {
  const stringValue = String(value ?? "");
  return /[",\r\n]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
};

export function serializeConnectionsToNativeXml(
  connections: Connection[],
): string {
  const nodes = connections.map((connection) => {
    const advancedSettings =
      serializeNativeAdvancedProtocolSettings(connection);
    const attributes = [
      `Id="${escapeXml(connection.id)}"`,
      `Name="${escapeXml(connection.name)}"`,
      `Type="${escapeXml(String(connection.protocol).toUpperCase())}"`,
      `Server="${escapeXml(connection.hostname)}"`,
      `Port="${escapeXml(connection.port)}"`,
      `Username="${escapeXml(connection.username)}"`,
      `Domain="${escapeXml(connection.domain)}"`,
      `Description="${escapeXml(connection.description)}"`,
      `ParentId="${escapeXml(connection.parentId)}"`,
      `IsGroup="${Boolean(connection.isGroup)}"`,
      `Tags="${escapeXml((connection.tags ?? []).join(","))}"`,
      `CreatedAt="${escapeXml(connection.createdAt)}"`,
      `UpdatedAt="${escapeXml(connection.updatedAt)}"`,
      ...ADVANCED_PROTOCOL_NATIVE_FIELDS.map(
        (field) => `${field}="${escapeXml(advancedSettings[field])}"`,
      ),
    ];
    return `  <Connection ${attributes.join(" ")} />`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sortOfRemoteNG>\n${nodes.join("\n")}\n</sortOfRemoteNG>`;
}

export interface NativeCsvDataset {
  databaseId: string;
  databaseName: string;
  connections: Connection[];
}

export function serializeDatasetsToNativeCsv(
  datasets: NativeCsvDataset[],
): string {
  const includeDatabaseColumns = datasets.length > 1;
  const headers = [
    ...(includeDatabaseColumns ? ["Database", "DatabaseId"] : []),
    "ID",
    "Name",
    "Protocol",
    "Hostname",
    "Port",
    "Username",
    "Domain",
    "Description",
    "ParentId",
    "IsGroup",
    "Tags",
    "CreatedAt",
    "UpdatedAt",
    ...ADVANCED_PROTOCOL_NATIVE_FIELDS,
  ];
  const rows = datasets.flatMap((dataset) =>
    dataset.connections.map((connection) => {
      const advancedSettings =
        serializeNativeAdvancedProtocolSettings(connection);
      return [
        ...(includeDatabaseColumns
          ? [dataset.databaseName, dataset.databaseId]
          : []),
        connection.id,
        connection.name,
        connection.protocol,
        connection.hostname,
        connection.port,
        connection.username,
        connection.domain,
        connection.description,
        connection.parentId,
        Boolean(connection.isGroup),
        (connection.tags ?? []).join(";"),
        connection.createdAt,
        connection.updatedAt,
        ...ADVANCED_PROTOCOL_NATIVE_FIELDS.map(
          (field) => advancedSettings[field] ?? "",
        ),
      ].map(escapeCsv);
    }),
  );
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

const getCaseInsensitive = (
  record: Record<string, unknown>,
  ...keys: string[]
): unknown => {
  const entries = new Map(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const key of keys) {
    const value = entries.get(key.toLowerCase());
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
};

const parseSetting = (value: unknown): unknown => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export function parseNativeAdvancedProtocolSettings(
  record: Record<string, unknown>,
): Pick<
  Connection,
  "rawSocketSettings" | "rloginSettings" | "powerShellRemoting"
> {
  const rawSocketSettings = parseSetting(
    getCaseInsensitive(record, "RawSocketSettings", "RawSettings"),
  );
  const rloginSettings = parseSetting(
    getCaseInsensitive(record, "RloginSettings", "RLoginSettings"),
  );
  const powerShellRemoting = parseSetting(
    getCaseInsensitive(
      record,
      "PowerShellRemotingSettings",
      "PowerShellRemoting",
      "WinRMSettings",
    ),
  );

  return {
    ...(rawSocketSettings !== undefined ? { rawSocketSettings } : {}),
    ...(rloginSettings !== undefined ? { rloginSettings } : {}),
    ...(powerShellRemoting !== undefined ? { powerShellRemoting } : {}),
  } as Pick<
    Connection,
    "rawSocketSettings" | "rloginSettings" | "powerShellRemoting"
  >;
}

export function formatPortableProtocolLabel(value: {
  protocol: string;
  rawSocketSettings?: Connection["rawSocketSettings"];
}): string {
  switch (value.protocol) {
    case "raw":
      return `RAW/${normalizeRawSocketSettings(value.rawSocketSettings).connection.transport.toUpperCase()}`;
    case "rlogin":
      return "RLogin";
    case "winrm":
      return "PowerShell Remoting";
    default:
      return String(value.protocol).toUpperCase();
  }
}

export function hasAdvancedProtocolSettings(connection: Connection): boolean {
  return (
    connection.protocol === "raw" ||
    connection.protocol === "rlogin" ||
    connection.protocol === "winrm" ||
    connection.rawSocketSettings !== undefined ||
    connection.rloginSettings !== undefined ||
    connection.powerShellRemoting !== undefined
  );
}
