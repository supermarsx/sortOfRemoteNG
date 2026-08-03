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

export const getRuntimeProtocolOptions = <
  T extends { value: string; category: ConnectionTypeCategory },
>(
  builtInOptions: readonly T[],
  integrationOptions: readonly T[],
  capabilities: RuntimeCapabilities,
): T[] => [
  ...filterProtocolOptionsByRuntimeCapabilities(builtInOptions, capabilities),
  ...integrationOptions,
];

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
