import { invoke } from "@tauri-apps/api/core";

export interface NativeRuntimeCapabilities {
  cloud: boolean;
  ops: boolean;
  rdp: boolean;
  serial: boolean;
  mysql: boolean;
  postgresql: boolean;
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
];

export const UNAVAILABLE_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  cloud: false,
  ops: false,
  rdp: false,
  serial: false,
  mysql: false,
  postgresql: false,
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
    label: "MySQL",
    cargoFeature: "db-mysql",
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
  if (!requirement || capabilities[requirement.capability]) return null;

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
