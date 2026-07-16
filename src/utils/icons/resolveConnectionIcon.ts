import type {
  BuiltInConnectionProtocol,
  Connection,
} from "../../types/connection/connection";
import type { IntegrationDescriptor } from "../../types/integrations/registry";
import {
  getConnectionIconDefinition,
  normalizeConnectionIconKey,
  type ConnectionIconCategory,
  type ConnectionIconKey,
} from "./connectionIconCatalog";

export const GENERIC_CONNECTION_ICON_KEY: ConnectionIconKey = "monitor";

export const PROTOCOL_ICON_DEFAULTS: Readonly<
  Record<BuiltInConnectionProtocol, ConnectionIconKey>
> = Object.freeze({
  rdp: "monitor",
  ssh: "terminal",
  ard: "eye",
  serial: "cable",
  vnc: "eye",
  anydesk: "monitor",
  http: "globe",
  https: "globe",
  telnet: "phone",
  raw: "cable",
  rlogin: "phone",
  mysql: "database",
  postgresql: "database",
  spice: "monitor",
  xdmcp: "monitor",
  x2go: "monitor",
  nx: "monitor",
  ftp: "folder",
  sftp: "folder",
  scp: "folder",
  winrm: "server",
  rustdesk: "monitor",
  smb: "folder",
  gcp: "cloud",
  azure: "cloud",
  "ibm-csp": "cloud",
  "digital-ocean": "cloud",
  heroku: "cloud",
  scaleway: "cloud",
  linode: "cloud",
  ovhcloud: "cloud",
  ilo: "server-cog",
  lenovo: "server-cog",
  supermicro: "server-cog",
});

export type EffectiveConnectionIconSource =
  | "override"
  | "integration"
  | "protocol"
  | "fallback";

export type ConnectionIconOverrideState = "unset" | "valid" | "unknown";

export type ConnectionIconDescriptor = Pick<
  IntegrationDescriptor,
  "key" | "defaultConnectionIconKey"
>;

export interface EffectiveConnectionIcon {
  key: ConnectionIconKey;
  icon: NonNullable<ReturnType<typeof getConnectionIconDefinition>>["icon"];
  source: EffectiveConnectionIconSource;
  overrideState: ConnectionIconOverrideState;
  /** Original trimmed value when a saved override is not in the catalog. */
  unknownOverrideKey?: string;
  integrationKey?: string;
  label: string;
  ariaLabel: string;
  description: string;
  category: ConnectionIconCategory;
  keywords: readonly string[];
}

export type ConnectionIconInput = Pick<Connection, "icon" | "integration"> & {
  /** Accept unknown future protocol strings so callers can reach the fallback. */
  protocol: string;
};

/** Return the stable integration key encoded by the current connection. */
export function getConnectionIntegrationKey(
  connection: ConnectionIconInput,
): string | undefined {
  const settingsKey = connection.integration?.descriptorKey?.trim();
  if (settingsKey) return settingsKey;
  const prefix = "integration:";
  return connection.protocol.startsWith(prefix)
    ? connection.protocol.slice(prefix.length).trim() || undefined
    : undefined;
}

export function getProtocolDefaultIconKey(
  protocol: string | undefined,
): ConnectionIconKey | undefined {
  if (!protocol || protocol.startsWith("integration:")) return undefined;
  return PROTOCOL_ICON_DEFAULTS[protocol as BuiltInConnectionProtocol] as
    | ConnectionIconKey
    | undefined;
}

/**
 * Resolve one effective connection icon with a deterministic precedence:
 * valid explicit override → matching integration descriptor default → built-in
 * protocol default → generic monitor fallback.
 *
 * Unknown persisted keys are retained only as diagnostic metadata and never
 * used for component lookup. Passing no descriptor (or a descriptor for a
 * different integration key) safely falls through to protocol/fallback.
 */
export function resolveEffectiveConnectionIcon(
  connection: ConnectionIconInput,
  descriptor?: ConnectionIconDescriptor,
): EffectiveConnectionIcon {
  const savedOverride = connection.icon?.trim() ?? "";
  const normalizedOverride = normalizeConnectionIconKey(savedOverride);
  const overrideDefinition = getConnectionIconDefinition(normalizedOverride);
  const integrationKey = getConnectionIntegrationKey(connection);

  if (overrideDefinition) {
    return buildResult(
      overrideDefinition.key,
      "override",
      "valid",
      integrationKey,
    );
  }

  const overrideState: ConnectionIconOverrideState = savedOverride
    ? "unknown"
    : "unset";
  const matchingDescriptor =
    descriptor && integrationKey === descriptor.key ? descriptor : undefined;
  const descriptorDefinition = getConnectionIconDefinition(
    matchingDescriptor?.defaultConnectionIconKey,
  );
  if (descriptorDefinition) {
    return buildResult(
      descriptorDefinition.key,
      "integration",
      overrideState,
      integrationKey,
      savedOverride || undefined,
    );
  }

  const protocolKey = getProtocolDefaultIconKey(connection.protocol);
  if (protocolKey) {
    return buildResult(
      protocolKey,
      "protocol",
      overrideState,
      integrationKey,
      savedOverride || undefined,
    );
  }

  return buildResult(
    GENERIC_CONNECTION_ICON_KEY,
    "fallback",
    overrideState,
    integrationKey,
    savedOverride || undefined,
  );
}

function buildResult(
  key: ConnectionIconKey,
  source: EffectiveConnectionIconSource,
  overrideState: ConnectionIconOverrideState,
  integrationKey?: string,
  unknownOverrideKey?: string,
): EffectiveConnectionIcon {
  const definition = getConnectionIconDefinition(key);
  if (!definition) {
    throw new Error(
      `Connection icon catalog is missing required key "${key}".`,
    );
  }
  return {
    key: definition.key,
    icon: definition.icon,
    source,
    overrideState,
    unknownOverrideKey,
    integrationKey,
    label: definition.label,
    ariaLabel: definition.ariaLabel,
    description: definition.description,
    category: definition.category,
    keywords: definition.keywords,
  };
}
