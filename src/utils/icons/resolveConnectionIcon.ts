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
import { FOLDER_OPEN_ICONS } from "./catalog/folders";
import {
  getRuntimeIconEntry,
  type SelectableConnectionIconKey,
} from "./iconLibraryRuntime";

export const GENERIC_CONNECTION_ICON_KEY: ConnectionIconKey = "monitor";

export const PROTOCOL_ICON_DEFAULTS: Readonly<
  Record<BuiltInConnectionProtocol, ConnectionIconKey>
> = Object.freeze({
  rdp: "microsoft",
  ssh: "ssh",
  ard: "apple",
  serial: "serial",
  vnc: "vnc",
  anydesk: "anydesk",
  http: "globe",
  https: "https",
  telnet: "telnet",
  raw: "raw-socket",
  rlogin: "rlogin",
  mysql: "mysql",
  mongodb: "mongodb",
  postgresql: "postgresql",
  spice: "spice",
  xdmcp: "xdmcp",
  x2go: "x2go",
  nx: "nomachine",
  ftp: "ftp",
  sftp: "sftp",
  scp: "scp",
  winrm: "powershell",
  rustdesk: "rustdesk",
  smb: "smb",
  gcp: "googlecloud",
  azure: "azure",
  "ibm-csp": "ibm",
  "digital-ocean": "digitalocean",
  heroku: "heroku",
  scaleway: "scaleway",
  linode: "linode",
  ovhcloud: "ovh",
  idrac: "dell",
  ilo: "hpe",
  lenovo: "lenovo",
  supermicro: "supermicro",
  "voip-phone": "voip",
  synology: "synology",
});

export type EffectiveConnectionIconSource =
  "override" | "folder" | "integration" | "protocol" | "fallback";

export type ConnectionIconOverrideState = "unset" | "valid" | "unknown";

export type ConnectionIconDescriptor = Pick<
  IntegrationDescriptor,
  "key" | "defaultConnectionIconKey"
>;

export interface EffectiveConnectionIcon {
  key: SelectableConnectionIconKey;
  icon: NonNullable<ReturnType<typeof getConnectionIconDefinition>>["icon"];
  source: EffectiveConnectionIconSource;
  overrideState: ConnectionIconOverrideState;
  /** Original trimmed value when a saved override is not in the catalog. */
  unknownOverrideKey?: string;
  integrationKey?: string;
  label: string;
  ariaLabel: string;
  description: string;
  category: ConnectionIconCategory | "custom";
  keywords: readonly string[];
}

/** Expansion affects presentation only, never the saved icon or its resolution. */
export function getExpandedFolderIcon(
  resolved: EffectiveConnectionIcon,
  expanded: boolean,
): EffectiveConnectionIcon["icon"] {
  if (!expanded || resolved.category !== "folders") return resolved.icon;
  return (
    FOLDER_OPEN_ICONS[resolved.key as keyof typeof FOLDER_OPEN_ICONS] ??
    resolved.icon
  );
}

export type ConnectionIconInput = Pick<Connection, "icon" | "integration"> & {
  isGroup?: boolean;
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

/** Shared automatic icon for selectors, history and protocol-only columns. */
export function getProtocolDefaultIcon(
  protocol: string,
  descriptor?: ConnectionIconDescriptor,
): EffectiveConnectionIcon["icon"] {
  return resolveEffectiveConnectionIcon({ protocol }, descriptor).icon;
}

export function getProtocolDefaultIconKey(
  protocol: string | undefined,
): ConnectionIconKey | undefined {
  if (!protocol || protocol.startsWith("integration:")) return undefined;
  return PROTOCOL_ICON_DEFAULTS[protocol as BuiltInConnectionProtocol] as
    ConnectionIconKey | undefined;
}

/**
 * Resolve one effective connection icon with a deterministic precedence:
 * valid explicit override → folder default → matching integration default → built-in
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
  const custom = getRuntimeIconEntry(normalizedOverride);
  if (custom?.kind === "custom")
    return {
      key: custom.key,
      icon: custom.icon,
      source: "override",
      overrideState: "valid",
      integrationKey,
      label: custom.label,
      ariaLabel: `${custom.label} icon`,
      description: custom.notes || "Imported custom icon",
      category: "custom",
      keywords: custom.keywords,
    };

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
  if (connection.isGroup) {
    return buildResult(
      "folder",
      "folder",
      overrideState,
      undefined,
      savedOverride || undefined,
    );
  }
  // Compared case-insensitively: connections persisted before the normaliser
  // stopped case-folding integration protocols carry a lowercased descriptor
  // key, and the registry now resolves those to the real descriptor. A strict
  // compare here would drop the integration icon for exactly those records.
  const matchingDescriptor =
    descriptor && integrationKey?.toLowerCase() === descriptor.key.toLowerCase()
      ? descriptor
      : undefined;
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
    label: getRuntimeIconEntry(key)?.label ?? definition.label,
    ariaLabel: `${getRuntimeIconEntry(key)?.label ?? definition.label} icon`,
    description: getRuntimeIconEntry(key)?.notes || definition.description,
    category: definition.category,
    keywords: definition.keywords,
  };
}
