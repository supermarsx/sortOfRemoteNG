import { invoke } from "@tauri-apps/api/core";

export interface NativeRuntimeCapabilities {
  cloud: boolean;
  ops: boolean;
  rdp: boolean;
  serial: boolean;
  mysql: boolean;
  postgresql: boolean;
  mongodb: boolean;
  /** Added native fields are optional only for older runtime responses. */
  mssql?: boolean;
  sqlite?: boolean;
  redis?: boolean;
  platform?: boolean;
  collab?: boolean;
  softether?: boolean;
  scriptEngine?: boolean;
  opkssh?: boolean;
}

export interface RuntimeCapabilities extends NativeRuntimeCapabilities {
  source: "native" | "unavailable";
}

export type OptionalRuntimeFeature = keyof NativeRuntimeCapabilities;

export interface RuntimeProtocolRequirement {
  capability: OptionalRuntimeFeature;
  label: string;
  cargoFeature: string;
}

const OPTIONAL_CAPABILITY_KEYS: OptionalRuntimeFeature[] = [
  "cloud",
  "ops",
  "rdp",
  "serial",
  "mysql",
  "postgresql",
  "mongodb",
];

const EXTENDED_CAPABILITY_KEYS = [
  "mssql",
  "sqlite",
  "redis",
  "platform",
  "collab",
  "softether",
  "scriptEngine",
  "opkssh",
] as const;

export const UNAVAILABLE_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  cloud: false,
  ops: false,
  rdp: false,
  serial: false,
  mysql: false,
  postgresql: false,
  mongodb: false,
  mssql: false,
  sqlite: false,
  redis: false,
  platform: false,
  collab: false,
  softether: false,
  scriptEngine: false,
  opkssh: false,
  source: "unavailable",
};

const CLOUD_PROTOCOLS = new Set([
  "gcp",
  "azure",
  "ibm-csp",
  "digital-ocean",
  "heroku",
  "scaleway",
  "linode",
  "ovhcloud",
]);

const PROTOCOL_REQUIREMENTS: Record<
  string,
  RuntimeProtocolRequirement | undefined
> = {
  rdp: { capability: "rdp", label: "RDP", cargoFeature: "rdp" },
  serial: {
    capability: "serial",
    label: "Serial",
    cargoFeature: "protocol-serial-dynamic",
  },
  mysql: {
    capability: "mysql",
    label: "MySQL / MariaDB",
    cargoFeature: "db-mysql",
  },
  mongodb: {
    capability: "mongodb",
    label: "MongoDB",
    cargoFeature: "db-mongo",
  },
  postgresql: {
    capability: "postgresql",
    label: "PostgreSQL",
    cargoFeature: "db-postgres",
  },
  winrm: {
    capability: "ops",
    label: "WinRM",
    cargoFeature: "ops",
  },
  idrac: { capability: "ops", label: "iDRAC", cargoFeature: "ops" },
  ilo: { capability: "ops", label: "iLO", cargoFeature: "ops" },
  lenovo: {
    capability: "ops",
    label: "Lenovo management",
    cargoFeature: "ops",
  },
  supermicro: {
    capability: "ops",
    label: "Supermicro management",
    cargoFeature: "ops",
  },
  "voip-phone": { capability: "ops", label: "VoIP phone", cargoFeature: "ops" },
};

// Integration routing follows the app command-crate feature gates, not the
// category shown in the picker. Keep in sync with the registry coverage test.
const OPS_INTEGRATIONS = new Set([
  "lxd",
  "pfsense",
  "netbox",
  "vmwaredesktop",
  "vmware",
  "cpanel",
  "draytek",
  "proxmox",
  "portainer",
  "nginx",
  "haproxy",
  "caddy",
  "traefik",
  "php",
  "nginxproxymgr",
  "prometheus",
  "grafana",
  "budibase",
  "jira",
  "osticket",
  "mailcow",
  "mail",
]);
const INTEGRATION_REQUIREMENTS: Record<string, RuntimeProtocolRequirement> = {
  ansible: {
    capability: "platform",
    label: "Ansible",
    cargoFeature: "platform",
  },
  exchange: { capability: "cloud", label: "Exchange", cargoFeature: "cloud" },
  gdrive: {
    capability: "collab",
    label: "Google Drive",
    cargoFeature: "collab",
  },
  mssql: { capability: "mssql", label: "SQL Server", cargoFeature: "db-mssql" },
};

let cachedCapabilities: RuntimeCapabilities | undefined;
let capabilityLoad: Promise<RuntimeCapabilities> | undefined;

const isNativeRuntimeCapabilities = (
  value: unknown,
): value is NativeRuntimeCapabilities => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return OPTIONAL_CAPABILITY_KEYS.every(
    (key) => typeof candidate[key] === "boolean",
  );
};

export const getRuntimeProtocolRequirement = (
  protocol: string | null | undefined,
): RuntimeProtocolRequirement | null => {
  const normalized = protocol?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("integration:")) {
    const integration = normalized.slice("integration:".length);
    if (OPS_INTEGRATIONS.has(integration)) {
      return {
        capability: "ops",
        label: "This integration",
        cargoFeature: "ops",
      };
    }
    return INTEGRATION_REQUIREMENTS[integration] ?? null;
  }
  if (CLOUD_PROTOCOLS.has(normalized)) {
    return {
      capability: "cloud",
      label: "Cloud",
      cargoFeature: "cloud",
    };
  }
  return PROTOCOL_REQUIREMENTS[normalized] ?? null;
};

export const getRuntimeProtocolUnavailableMessage = (
  protocol: string | null | undefined,
  capabilities: RuntimeCapabilities,
): string | null => {
  const requirement = getRuntimeProtocolRequirement(protocol);
  if (!requirement || capabilities[requirement.capability] === true)
    return null;

  if (capabilities.source === "unavailable") {
    return `${requirement.label} sessions are disabled because this app could not read its native runtime capabilities. Update or reinstall the app, then retry.`;
  }

  return `${requirement.label} sessions are unavailable in this build. Use the full build or rebuild with the "${requirement.cargoFeature}" feature.`;
};

export const filterProtocolOptionsByRuntimeCapabilities = <
  T extends { value: string },
>(
  options: readonly T[],
  capabilities: RuntimeCapabilities,
): T[] =>
  options.filter(
    ({ value }) =>
      getRuntimeProtocolUnavailableMessage(value, capabilities) === null,
  );

export const getRuntimeCapabilitiesSnapshot = (): RuntimeCapabilities =>
  cachedCapabilities ?? UNAVAILABLE_RUNTIME_CAPABILITIES;

export const loadRuntimeCapabilities = (): Promise<RuntimeCapabilities> => {
  if (cachedCapabilities) return Promise.resolve(cachedCapabilities);
  if (capabilityLoad) return capabilityLoad;

  capabilityLoad = invoke<unknown>("get_runtime_capabilities")
    .then((value) => {
      if (!isNativeRuntimeCapabilities(value)) {
        throw new Error("Invalid native runtime capability response");
      }
      cachedCapabilities = { ...value, source: "native" };
      // Older binaries have no extended fields; malformed truthy values must
      // not enable an optional integration either.
      for (const key of EXTENDED_CAPABILITY_KEYS) {
        cachedCapabilities[key] = value[key] === true;
      }
      return cachedCapabilities;
    })
    .catch(() => {
      cachedCapabilities = UNAVAILABLE_RUNTIME_CAPABILITIES;
      return cachedCapabilities;
    })
    .finally(() => {
      capabilityLoad = undefined;
    });

  return capabilityLoad;
};

export const resetRuntimeCapabilitiesCacheForTests = (): void => {
  cachedCapabilities = undefined;
  capabilityLoad = undefined;
};
