import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../types/connection/connection";
import {
  iloRuntimeAdapter,
  lenovoRuntimeAdapter,
  supermicroRuntimeAdapter,
} from "./bmcRuntimeAdapters";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

const connection = (protocol: "ilo" | "lenovo" | "supermicro") =>
  ({
    id: `${protocol}-connection`,
    name: `${protocol} host`,
    protocol,
    hostname: `${protocol}.example.test`,
    port: 8443,
    username: "operator",
    password: "connection-secret",
    iloSettings:
      protocol === "ilo"
        ? {
            authMethod: "basic",
            protocol: "redfish",
            insecure: false,
            timeoutSecs: 41,
            ipmiPort: 624,
            generation: "ilo5",
          }
        : undefined,
    lenovoSettings:
      protocol === "lenovo"
        ? {
            protocol: "legacyRest",
            insecure: false,
            timeoutSecs: 42,
            ipmiPort: 625,
            generation: "xcc2",
          }
        : undefined,
    supermicroSettings:
      protocol === "supermicro"
        ? {
            useSsl: true,
            verifyCert: true,
            platform: "x13",
            authMethod: "basic",
            timeoutSecs: 43,
          }
        : undefined,
  }) as Connection;

const responseFor = (command: string): unknown => {
  if (command === "ilo_get_dashboard") {
    return {
      systemInfo: {
        id: "system",
        manufacturer: "HPE",
        model: "ProLiant",
        serialNumber: "ILO-SERIAL",
        biosVersion: "U32",
        powerState: "On",
      },
      health: { overallHealth: "OK", isHealthy: true, components: [] },
      powerState: "On",
      powerConsumptionWatts: 180,
      thermalSummary: { ambientTempCelsius: 23, thermalAlerts: 0 },
    };
  }
  if (command === "lenovo_get_dashboard") {
    return {
      generation: "xcc2",
      systemInfo: {
        manufacturer: "Lenovo",
        model: "ThinkSystem",
        serialNumber: "LENOVO-SERIAL",
      },
      powerState: "On",
      healthStatus: "Normal",
      ambientTempCelsius: 22,
      totalPowerWatts: 170,
    };
  }
  if (command === "smc_get_dashboard") {
    return {
      platform: "x13",
      systemInfo: {
        manufacturer: "Supermicro",
        model: "SuperServer",
        serialNumber: "SMC-SERIAL",
      },
      powerState: "On",
      healthStatus: "OK",
      ambientTempCelsius: 21,
      totalPowerWatts: 160,
    };
  }
  if (command.endsWith("_get_storage_controllers")) {
    return [{ name: "Controller 0", status: "OK" }];
  }
  if (command.endsWith("_get_virtual_disks")) return [];
  if (command.endsWith("_get_physical_disks")) {
    return [
      { name: "Disk 0", status: "OK" },
      { name: "Disk 1", status: "OK" },
    ];
  }
  if (command.endsWith("_get_firmware_inventory")) {
    return [{ name: "BMC", version: "1.2.3", status: "Current" }];
  }
  return undefined;
};

describe("BMC runtime inventory adapters", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string) =>
      responseFor(command),
    );
  });

  it("preserves Lenovo's flat nine-field connect payload and secret boundary", async () => {
    await lenovoRuntimeAdapter.connect(connection("lenovo"));

    expect(mocks.invoke).toHaveBeenCalledWith("lenovo_connect", {
      host: "lenovo.example.test",
      port: 8443,
      username: "operator",
      password: "connection-secret",
      protocol: "legacyRest",
      insecure: false,
      timeoutSecs: 42,
      ipmiPort: 625,
      generation: "xcc2",
    });
    expect(mocks.invoke.mock.calls[0]?.[1]).not.toHaveProperty("config");
  });

  it.each([
    [iloRuntimeAdapter, "ilo"],
    [lenovoRuntimeAdapter, "lenovo"],
    [supermicroRuntimeAdapter, "smc"],
  ] as const)(
    "uses only registered read commands for the %s overview",
    async (adapter, prefix) => {
      const overview = await adapter.loadOverview();
      const commands = mocks.invoke.mock.calls.map(([command]) => command);

      expect(commands).toEqual(
        expect.arrayContaining([
          `${prefix}_get_dashboard`,
          `${prefix}_get_storage_controllers`,
          `${prefix}_get_virtual_disks`,
          `${prefix}_get_physical_disks`,
          `${prefix}_get_firmware_inventory`,
        ]),
      );
      expect(commands).toHaveLength(5);
      expect(commands.every((command) => command.includes("_get_"))).toBe(true);
      expect(overview.sections.map((section) => section.id)).toEqual([
        "system",
        "health",
        "power",
        "thermal",
        "storage",
        "firmware",
      ]);
      expect(
        overview.sections.find((section) => section.id === "storage")?.items,
      ).toEqual(
        expect.arrayContaining([
          { label: "Controllers", value: "1" },
          { label: "Virtual disks", value: "0" },
          { label: "Physical disks", value: "2" },
        ]),
      );
    },
  );

  it("retains a truthful category error when a provider read fails", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "ilo_get_firmware_inventory") {
        throw new Error("firmware endpoint unavailable");
      }
      return responseFor(command);
    });

    const overview = await iloRuntimeAdapter.loadOverview();
    const firmware = overview.sections.find(
      (section) => section.id === "firmware",
    );

    expect(firmware?.items).toEqual([]);
    expect(firmware?.error).toContain("firmware endpoint unavailable");
  });
});
