import type { Connection } from "../../types/connection/connection";
import { normalizeCloudConnectionForPersistence } from "../connection/cloudConnectionContract";
import { invokeManagement as invoke } from "../security/managementInvoke";
import type {
  BuiltInCloudRuntimeHandle,
  BuiltInCloudRuntimeProtocol,
} from "./builtInCloudRuntimeRegistry";

export interface CloudInventoryItem {
  id: string;
  name: string;
  status: string;
  location?: string;
  type?: string;
}

interface CloudInventoryDefinition {
  label: string;
  load: (
    connection: Connection,
    handle: BuiltInCloudRuntimeHandle,
  ) => Promise<CloudInventoryItem[]>;
}

type InventoryRecord = Record<string, unknown>;

const MAX_INVENTORY_ITEMS = 500;
const MAX_INVENTORY_TEXT_LENGTH = 512;

const isInventoryRecord = (value: unknown): value is InventoryRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedInventoryText = (
  value: string,
  key: string,
  provider: string,
  index: number,
): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_INVENTORY_TEXT_LENGTH) {
    throw new Error(
      `${provider} returned an invalid ${key} for inventory row ${index + 1}.`,
    );
  }
  return trimmed;
};

const inventoryText = (
  row: InventoryRecord,
  key: string,
  provider: string,
  index: number,
): string => {
  const value = row[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return boundedInventoryText(value, key, provider, index);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(
    `${provider} returned an invalid ${key} for inventory row ${index + 1}.`,
  );
};

const optionalInventoryText = (
  row: InventoryRecord,
  key: string,
  provider: string,
  index: number,
): string | undefined => {
  const value = row[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return boundedInventoryText(value, key, provider, index);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(
    `${provider} returned an invalid ${key} for inventory row ${index + 1}.`,
  );
};

const normalizeInventory = (
  provider: string,
  response: unknown,
  normalize: (row: InventoryRecord, index: number) => CloudInventoryItem,
): CloudInventoryItem[] => {
  if (!Array.isArray(response)) {
    throw new Error(`${provider} returned an unexpected inventory response.`);
  }
  if (response.length > MAX_INVENTORY_ITEMS) {
    throw new Error(
      `${provider} returned more than ${MAX_INVENTORY_ITEMS} inventory rows. Narrow the provider query before retrying.`,
    );
  }
  return response.map((row, index) => {
    if (!isInventoryRecord(row)) {
      throw new Error(
        `${provider} returned an invalid inventory row ${index + 1}.`,
      );
    }
    return normalize(row, index);
  });
};

const requireInventorySessionId = (
  provider: string,
  handle: BuiltInCloudRuntimeHandle,
): string => {
  if (!handle.backendSessionId) {
    throw new Error(
      `${provider} inventory requires a verified backend session.`,
    );
  }
  const sessionId = handle.backendSessionId.trim();
  if (
    sessionId.length === 0 ||
    sessionId.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/.test(sessionId)
  ) {
    throw new Error(`${provider} returned an invalid backend session ID.`);
  }
  return sessionId;
};

const loadSessionInventory = async (
  provider: string,
  command: string,
  handle: BuiltInCloudRuntimeHandle,
  normalize: (row: InventoryRecord, index: number) => CloudInventoryItem,
): Promise<CloudInventoryItem[]> => {
  const response = await invoke<unknown>(command, {
    sessionId: requireInventorySessionId(provider, handle),
  });
  return normalizeInventory(provider, response, normalize);
};

const gcpInventory: CloudInventoryDefinition = {
  label: "Compute Engine instances",
  async load(connection, handle) {
    const normalized = normalizeCloudConnectionForPersistence(connection);
    const response = await invoke<unknown>("list_gcp_instances", {
      sessionId: requireInventorySessionId("Google Cloud", handle),
      zone: normalized.gcpSettings?.zone || null,
    });
    return normalizeInventory("Google Cloud", response, (row, index) => ({
      id: inventoryText(row, "id", "Google Cloud", index),
      name: inventoryText(row, "name", "Google Cloud", index),
      status: inventoryText(row, "status", "Google Cloud", index),
      location: optionalInventoryText(row, "zone", "Google Cloud", index),
      type: optionalInventoryText(row, "machineType", "Google Cloud", index),
    }));
  },
};

const azureInventory: CloudInventoryDefinition = {
  label: "virtual machines",
  async load() {
    const response = await invoke<unknown>("azure_list_vm_summaries");
    return normalizeInventory("Microsoft Azure", response, (row, index) => ({
      id: inventoryText(row, "id", "Microsoft Azure", index),
      name: inventoryText(row, "name", "Microsoft Azure", index),
      status: inventoryText(row, "powerState", "Microsoft Azure", index),
      location: optionalInventoryText(
        row,
        "location",
        "Microsoft Azure",
        index,
      ),
      type: optionalInventoryText(row, "size", "Microsoft Azure", index),
    }));
  },
};

const ibmInventory: CloudInventoryDefinition = {
  label: "virtual servers",
  load: (_connection, handle) =>
    loadSessionInventory(
      "IBM Cloud",
      "list_ibm_virtual_servers",
      handle,
      (row, index) => ({
        id: inventoryText(row, "id", "IBM Cloud", index),
        name: inventoryText(row, "name", "IBM Cloud", index),
        status: inventoryText(row, "status", "IBM Cloud", index),
        location: optionalInventoryText(row, "zone", "IBM Cloud", index),
        type: optionalInventoryText(row, "profile", "IBM Cloud", index),
      }),
    ),
};

const digitalOceanInventory: CloudInventoryDefinition = {
  label: "droplets",
  load: (_connection, handle) =>
    loadSessionInventory(
      "DigitalOcean",
      "list_digital_ocean_droplets",
      handle,
      (row, index) => {
        const region = row.region;
        if (
          region !== undefined &&
          region !== null &&
          !isInventoryRecord(region)
        ) {
          throw new Error(
            `DigitalOcean returned an invalid region for inventory row ${index + 1}.`,
          );
        }
        return {
          id: inventoryText(row, "id", "DigitalOcean", index),
          name: inventoryText(row, "name", "DigitalOcean", index),
          status: inventoryText(row, "status", "DigitalOcean", index),
          location: region
            ? optionalInventoryText(region, "slug", "DigitalOcean", index)
            : undefined,
          type: optionalInventoryText(row, "size_slug", "DigitalOcean", index),
        };
      },
    ),
};

const herokuInventory: CloudInventoryDefinition = {
  label: "dynos",
  load: (_connection, handle) =>
    loadSessionInventory(
      "Heroku",
      "list_heroku_dynos",
      handle,
      (row, index) => ({
        id: inventoryText(row, "id", "Heroku", index),
        name: inventoryText(row, "name", "Heroku", index),
        status: inventoryText(row, "state", "Heroku", index),
        type: optionalInventoryText(row, "size", "Heroku", index),
      }),
    ),
};

const scalewayInventory: CloudInventoryDefinition = {
  label: "instances",
  load: (_connection, handle) =>
    loadSessionInventory(
      "Scaleway",
      "list_scaleway_instances",
      handle,
      (row, index) => ({
        id: inventoryText(row, "id", "Scaleway", index),
        name: inventoryText(row, "name", "Scaleway", index),
        status: inventoryText(row, "state", "Scaleway", index),
        location: optionalInventoryText(row, "zone", "Scaleway", index),
        type: optionalInventoryText(row, "instance_type", "Scaleway", index),
      }),
    ),
};

const linodeInventory: CloudInventoryDefinition = {
  label: "instances",
  load: (_connection, handle) =>
    loadSessionInventory(
      "Linode",
      "list_linode_instances",
      handle,
      (row, index) => ({
        id: inventoryText(row, "id", "Linode", index),
        name: inventoryText(row, "label", "Linode", index),
        status: inventoryText(row, "status", "Linode", index),
        location: optionalInventoryText(row, "region", "Linode", index),
        type: optionalInventoryText(row, "type_name", "Linode", index),
      }),
    ),
};

const ovhInventory: CloudInventoryDefinition = {
  label: "instances",
  load: (_connection, handle) =>
    loadSessionInventory(
      "OVHcloud",
      "list_ovh_instances",
      handle,
      (row, index) => ({
        id: inventoryText(row, "id", "OVHcloud", index),
        name: inventoryText(row, "name", "OVHcloud", index),
        status: inventoryText(row, "status", "OVHcloud", index),
        location: optionalInventoryText(row, "region", "OVHcloud", index),
        type: optionalInventoryText(row, "flavor", "OVHcloud", index),
      }),
    ),
};

const inventoryDefinitionFor = (
  protocol: BuiltInCloudRuntimeProtocol,
): CloudInventoryDefinition => {
  switch (protocol) {
    case "gcp":
      return gcpInventory;
    case "azure":
      return azureInventory;
    case "ibm-csp":
      return ibmInventory;
    case "digital-ocean":
      return digitalOceanInventory;
    case "heroku":
      return herokuInventory;
    case "scaleway":
      return scalewayInventory;
    case "linode":
      return linodeInventory;
    case "ovhcloud":
      return ovhInventory;
  }
};

export const cloudInventoryLabel = (
  protocol: BuiltInCloudRuntimeProtocol,
): string => inventoryDefinitionFor(protocol).label;

export const loadCloudRuntimeInventory = (
  protocol: BuiltInCloudRuntimeProtocol,
  connection: Connection,
  handle: BuiltInCloudRuntimeHandle,
): Promise<CloudInventoryItem[]> =>
  inventoryDefinitionFor(protocol).load(connection, handle);
