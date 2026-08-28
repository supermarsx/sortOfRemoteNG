import { type LucideIcon } from "lucide-react";

import { CLOUD_ICONS } from "./catalog/cloud";
import { COMMUNICATION_ICONS } from "./catalog/communication";
import { DATABASE_ICONS } from "./catalog/databases";
import { DEVOPS_MONITORING_ICONS } from "./catalog/devopsMonitoring";
import { FILES_ICONS } from "./catalog/files";
import { GENERIC_SHAPE_ICONS } from "./catalog/genericShapes";
import { NETWORK_ICONS } from "./catalog/network";
import { OPERATING_SYSTEM_ICONS } from "./catalog/operatingSystems";
import { REMOTE_PROTOCOL_ICONS } from "./catalog/remoteProtocols";
import { SECURITY_ICONS } from "./catalog/security";
import { SERVERS_DEVICES_ICONS } from "./catalog/serversDevices";
import { VENDORS_HARDWARE_ICONS } from "./catalog/vendorsHardware";
import { VIRTUALIZATION_ICONS } from "./catalog/virtualization";
import { VOICE_TELEPHONY_ICONS } from "./catalog/voiceTelephony";
import { WEB_APPLICATION_ICONS } from "./catalog/webApplications";

export {
  CONNECTION_ICON_CATEGORIES,
  type ConnectionIconCategory,
  type ConnectionIconDefinition,
} from "./catalog/types";

import type {
  ConnectionIconCategory,
  ConnectionIconDefinition,
} from "./catalog/types";

/**
 * Broad, categorized catalog of string-keyed connection icons.
 *
 * The entries live in one module per category under `./catalog/`; this file owns
 * the composed catalog and the lookup helpers that consumers import. Category
 * modules are spread in `CONNECTION_ICON_CATEGORIES` order, so an entry's index
 * — and therefore picker and recommendation ordering — stays stable when a
 * later category grows.
 *
 * The original ten saved keys (`monitor`, `terminal`, `globe`, `database`,
 * `server`, `shield`, `cloud`, `folder`, `star`, `drive`) retain their exact
 * key/component pairing for backward compatibility.
 */
export const CONNECTION_ICON_CATALOG = [
  ...REMOTE_PROTOCOL_ICONS,
  ...SERVERS_DEVICES_ICONS,
  ...NETWORK_ICONS,
  ...CLOUD_ICONS,
  ...DATABASE_ICONS,
  ...DEVOPS_MONITORING_ICONS,
  ...SECURITY_ICONS,
  ...FILES_ICONS,
  ...COMMUNICATION_ICONS,
  ...GENERIC_SHAPE_ICONS,
  ...OPERATING_SYSTEM_ICONS,
  ...VIRTUALIZATION_ICONS,
  ...VENDORS_HARDWARE_ICONS,
  ...VOICE_TELEPHONY_ICONS,
  ...WEB_APPLICATION_ICONS,
] as const;

export type ConnectionIconKey = (typeof CONNECTION_ICON_CATALOG)[number]["key"];

const CONNECTION_ICON_BY_KEY = new Map<
  ConnectionIconKey,
  ConnectionIconDefinition<ConnectionIconKey>
>(CONNECTION_ICON_CATALOG.map((definition) => [definition.key, definition]));

export const CONNECTION_ICON_REGISTRY = Object.freeze(
  Object.fromEntries(
    CONNECTION_ICON_CATALOG.map(({ key, icon }) => [key, icon]),
  ),
) as Readonly<Record<ConnectionIconKey, LucideIcon>>;

export function normalizeConnectionIconKey(key: string | undefined): string {
  return key?.trim().toLowerCase() ?? "";
}

export function isConnectionIconKey(key: string | undefined): boolean {
  return CONNECTION_ICON_BY_KEY.has(
    normalizeConnectionIconKey(key) as ConnectionIconKey,
  );
}

export function getConnectionIconDefinition(
  key: string | undefined,
): ConnectionIconDefinition<ConnectionIconKey> | undefined {
  return CONNECTION_ICON_BY_KEY.get(
    normalizeConnectionIconKey(key) as ConnectionIconKey,
  );
}

export function getConnectionIconsByCategory(
  category: ConnectionIconCategory,
): readonly ConnectionIconDefinition<ConnectionIconKey>[] {
  return CONNECTION_ICON_CATALOG.filter(
    (definition) => definition.category === category,
  );
}
