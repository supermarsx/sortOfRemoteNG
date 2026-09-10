import type { ConnectionTypeCategory } from "../../types/integrations/registry";
import {
  filterProtocolOptionsByRuntimeCapabilities,
  type RuntimeCapabilities,
} from "../runtime/runtimeCapabilities";

export const PROTOCOL_CATEGORY_ORDER: readonly ConnectionTypeCategory[] = [
  "remote-desktop",
  "console",
  "lights-out",
  "virtualization",
  "networking",
  "web-server",
  "mail-server",
  "database",
  "file-storage",
  "cloud",
  "monitoring",
  "vault",
  "management",
  "business-app",
];

/** Picker taxonomy, not a runtime gate. Native management tools retain their
 * routes and saved records; browser applications are configured under HTTP(S). */
const MANAGEMENT_IDENTITIES = new Set([
  "gcp",
  "azure",
  "ibm-csp",
  "digital-ocean",
  "heroku",
  "scaleway",
  "linode",
  "ovhcloud",
  "voip-phone",
  "synology",
]);
export function isProtocolPickerConnectionType(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    !MANAGEMENT_IDENTITIES.has(normalized) &&
    (!normalized.startsWith("integration:") ||
      normalized === "integration:mssql")
  );
}

export const getRuntimeProtocolOptions = <
  T extends { value: string; category: ConnectionTypeCategory },
>(
  builtInOptions: readonly T[],
  integrationOptions: readonly T[],
  capabilities: RuntimeCapabilities,
): T[] =>
  filterProtocolOptionsByRuntimeCapabilities(
    [...builtInOptions, ...integrationOptions].filter((option) =>
      isProtocolPickerConnectionType(option.value),
    ),
    capabilities,
  );

export const getUnavailableCurrentProtocolOption = <
  T extends { value: string },
>(
  runtimeOptions: readonly T[],
  allOptions: readonly T[],
  currentValue: string | null | undefined,
): T | null => {
  if (
    !currentValue ||
    runtimeOptions.some(({ value }) => value === currentValue)
  ) {
    return null;
  }
  return allOptions.find(({ value }) => value === currentValue) ?? null;
};
