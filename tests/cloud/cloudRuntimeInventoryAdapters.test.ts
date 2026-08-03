import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../src/types/connection/connection";
import {
  loadCloudRuntimeInventory,
  type CloudInventoryItem,
} from "../../src/utils/session/cloudRuntimeInventoryAdapters";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const connection = {
  id: "saved",
  name: "Cloud",
  protocol: "gcp",
  password: "secret",
  gcpSettings: {
    projectId: "project-a",
    zone: "europe-west1-b",
  },
} as Connection;

interface InventoryCase {
  name: string;
  protocol:
    | "gcp"
    | "azure"
    | "ibm-csp"
    | "digital-ocean"
    | "heroku"
    | "scaleway"
    | "linode"
    | "ovhcloud";
  command: string;
  response: unknown;
  expected: CloudInventoryItem;
  expectedArgs?: Record<string, unknown>;
}

const cases: InventoryCase[] = [
  {
    name: "Google Cloud",
    protocol: "gcp",
    command: "list_gcp_instances",
    response: [
      {
        id: "gcp-1",
        name: "gcp-primary",
        status: "RUNNING",
        zone: "europe-west1-b",
        machineType: "e2-medium",
      },
    ],
    expected: {
      id: "gcp-1",
      name: "gcp-primary",
      status: "RUNNING",
      location: "europe-west1-b",
      type: "e2-medium",
    },
    expectedArgs: {
      sessionId: "backend-session",
      zone: "europe-west1-b",
    },
  },
  {
    name: "Microsoft Azure",
    protocol: "azure",
    command: "azure_list_vm_summaries",
    response: [
      {
        id: "azure-1",
        name: "azure-primary",
        powerState: "running",
        location: "westeurope",
        size: "Standard_B2s",
      },
    ],
    expected: {
      id: "azure-1",
      name: "azure-primary",
      status: "running",
      location: "westeurope",
      type: "Standard_B2s",
    },
  },
  {
    name: "IBM Cloud",
    protocol: "ibm-csp",
    command: "list_ibm_virtual_servers",
    response: [
      {
        id: "ibm-1",
        name: "ibm-primary",
        status: "running",
        zone: "eu-gb-1",
        profile: "bx2-2x8",
      },
    ],
    expected: {
      id: "ibm-1",
      name: "ibm-primary",
      status: "running",
      location: "eu-gb-1",
      type: "bx2-2x8",
    },
    expectedArgs: { sessionId: "backend-session" },
  },
  {
    name: "DigitalOcean",
    protocol: "digital-ocean",
    command: "list_digital_ocean_droplets",
    response: [
      {
        id: 42,
        name: "do-primary",
        status: "active",
        region: { slug: "lon1" },
        size_slug: "s-1vcpu-1gb",
      },
    ],
    expected: {
      id: "42",
      name: "do-primary",
      status: "active",
      location: "lon1",
      type: "s-1vcpu-1gb",
    },
    expectedArgs: { sessionId: "backend-session" },
  },
  {
    name: "Heroku",
    protocol: "heroku",
    command: "list_heroku_dynos",
    response: [
      {
        id: "dyno-1",
        name: "web.1",
        state: "up",
        size: "standard-1x",
      },
    ],
    expected: {
      id: "dyno-1",
      name: "web.1",
      status: "up",
      type: "standard-1x",
    },
    expectedArgs: { sessionId: "backend-session" },
  },
  {
    name: "Scaleway",
    protocol: "scaleway",
    command: "list_scaleway_instances",
    response: [
      {
        id: "scw-1",
        name: "scw-primary",
        state: "running",
        zone: "fr-par-1",
        instance_type: "DEV1-S",
      },
    ],
    expected: {
      id: "scw-1",
      name: "scw-primary",
      status: "running",
      location: "fr-par-1",
      type: "DEV1-S",
    },
    expectedArgs: { sessionId: "backend-session" },
  },
  {
    name: "Linode",
    protocol: "linode",
    command: "list_linode_instances",
    response: [
      {
        id: 7,
        label: "linode-primary",
        status: "running",
        region: "eu-west",
        type_name: "g6-standard-1",
      },
    ],
    expected: {
      id: "7",
      name: "linode-primary",
      status: "running",
      location: "eu-west",
      type: "g6-standard-1",
    },
    expectedArgs: { sessionId: "backend-session" },
  },
  {
    name: "OVHcloud",
    protocol: "ovhcloud",
    command: "list_ovh_instances",
    response: [
      {
        id: "ovh-1",
        name: "ovh-primary",
        status: "ACTIVE",
        region: "UK1",
        flavor: "b2-7",
      },
    ],
    expected: {
      id: "ovh-1",
      name: "ovh-primary",
      status: "ACTIVE",
      location: "UK1",
      type: "b2-7",
    },
    expectedArgs: { sessionId: "backend-session" },
  },
];

describe("cloud runtime inventory adapters", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it.each(cases)(
    "loads and normalizes $name inventory through its registered command",
    async ({ protocol, command, response, expected, expectedArgs }) => {
      invokeMock.mockResolvedValueOnce(response);

      await expect(
        loadCloudRuntimeInventory(protocol, connection, {
          backendSessionId: "backend-session",
        }),
      ).resolves.toEqual([expected]);

      if (expectedArgs) {
        expect(invokeMock).toHaveBeenCalledWith(command, expectedArgs);
      } else {
        expect(invokeMock).toHaveBeenCalledWith(command);
      }
    },
  );

  it("rejects malformed responses instead of inventing inventory", async () => {
    invokeMock.mockResolvedValueOnce({ instances: [] });

    await expect(
      loadCloudRuntimeInventory("gcp", connection, {
        backendSessionId: "backend-session",
      }),
    ).rejects.toThrow("unexpected inventory response");
  });

  it("does not query session inventory without a backend session", async () => {
    await expect(
      loadCloudRuntimeInventory("linode", connection, {}),
    ).rejects.toThrow("requires a verified backend session");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
