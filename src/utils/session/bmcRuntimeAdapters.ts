import { invokeManagement as invoke } from "../security/managementInvoke";

import type { Connection } from "../../types/connection/connection";
import type {
  BmcFirmwareItem as IloFirmwareItem,
  BmcPhysicalDisk as IloPhysicalDisk,
  BmcStorageController as IloStorageController,
  BmcVirtualDisk as IloVirtualDisk,
  IloDashboard,
} from "../../types/hardware/ilo";
import type {
  LenovoFirmwareItem,
  LenovoPhysicalDisk,
  LenovoStorageController,
  LenovoVirtualDisk,
  XccDashboard,
} from "../../types/hardware/lenovo";
import type {
  SmcDashboard,
  SmcFirmwareItem,
  SmcPhysicalDisk,
  SmcStorageController,
  SmcVirtualDisk,
} from "../../types/hardware/supermicro";
import type { BuiltInManagementRuntimeProtocol } from "./builtInManagementRuntimeRegistry";

export type BmcOverviewSectionId =
  | "system"
  | "health"
  | "power"
  | "thermal"
  | "storage"
  | "firmware";

export interface BmcOverviewItem {
  label: string;
  value: string;
}

export interface BmcOverviewSection {
  id: BmcOverviewSectionId;
  title: string;
  status?: string;
  items: BmcOverviewItem[];
  error?: string;
}

export interface BmcOverview {
  refreshedAt: string;
  sections: BmcOverviewSection[];
}

export interface BmcRuntimeAdapter {
  protocol: Exclude<BuiltInManagementRuntimeProtocol, "idrac">;
  displayName: string;
  connect: (connection: Connection) => Promise<void>;
  disconnect: () => Promise<void>;
  loadOverview: () => Promise<BmcOverview>;
}

type ReadResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface FirmwareRecord {
  name: string;
  version: string;
  status?: string;
}

interface ReadOnlyOverviewCommands {
  dashboard: string;
  storageControllers: string;
  virtualDisks: string;
  physicalDisks: string;
  firmwareInventory: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const settle = async <T>(
  operation: () => Promise<T>,
): Promise<ReadResult<T>> => {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
};

const item = (
  label: string,
  value: string | number | boolean | null | undefined,
  suffix = "",
): BmcOverviewItem[] =>
  value === undefined || value === null || value === ""
    ? []
    : [{ label, value: `${value}${suffix}` }];

const dashboardErrorSections = (error: string): BmcOverviewSection[] =>
  (
    [
      ["system", "System"],
      ["health", "Health"],
      ["power", "Power"],
      ["thermal", "Thermal"],
    ] as const
  ).map(([id, title]) => ({
    id,
    title,
    items: [],
    error: `Dashboard read failed: ${error}`,
  }));

const normalizeIloDashboard = (
  dashboard: IloDashboard,
): BmcOverviewSection[] => {
  const system = dashboard.systemInfo;
  const health = dashboard.health;
  const thermal = dashboard.thermalSummary;
  return [
    {
      id: "system",
      title: "System",
      items: [
        ...item("Manufacturer", system?.manufacturer),
        ...item("Model", system?.model),
        ...item("Serial number", system?.serialNumber),
        ...item("BIOS", system?.biosVersion),
        ...item("Hostname", system?.hostname),
      ],
    },
    {
      id: "health",
      title: "Health",
      status: health?.overallHealth,
      items: [
        ...item(
          "Healthy",
          health?.isHealthy === undefined
            ? undefined
            : health.isHealthy
              ? "Yes"
              : "No",
        ),
        ...item("Reported components", health?.components.length),
      ],
    },
    {
      id: "power",
      title: "Power",
      status: dashboard.powerState ?? system?.powerState,
      items: [
        ...item("State", dashboard.powerState ?? system?.powerState),
        ...item("Consumption", dashboard.powerConsumptionWatts, " W"),
      ],
    },
    {
      id: "thermal",
      title: "Thermal",
      items: [
        ...item("Ambient", thermal?.ambientTempCelsius, " C"),
        ...item("Maximum CPU", thermal?.cpuTempMaxCelsius, " C"),
        ...item("Minimum fan", thermal?.fanSpeedMinPercent, "%"),
        ...item("Maximum fan", thermal?.fanSpeedMaxPercent, "%"),
        ...item("Alerts", thermal?.thermalAlerts),
      ],
    },
  ];
};

const normalizeLenovoDashboard = (
  dashboard: XccDashboard,
): BmcOverviewSection[] => {
  const system = dashboard.systemInfo;
  const powerState = dashboard.powerState ?? system?.powerState;
  return [
    {
      id: "system",
      title: "System",
      items: [
        ...item("Generation", dashboard.generation),
        ...item("Manufacturer", system?.manufacturer),
        ...item("Model", system?.model),
        ...item("Serial number", system?.serialNumber),
        ...item("BIOS", system?.biosVersion),
        ...item("Hostname", system?.hostname),
        ...item("Processors", dashboard.cpuCount),
        ...item("Memory", dashboard.totalMemoryGb, " GB"),
      ],
    },
    {
      id: "health",
      title: "Health",
      status: dashboard.healthStatus,
      items: [...item("Overall", dashboard.healthStatus)],
    },
    {
      id: "power",
      title: "Power",
      status: powerState,
      items: [
        ...item("State", powerState),
        ...item("Consumption", dashboard.totalPowerWatts, " W"),
      ],
    },
    {
      id: "thermal",
      title: "Thermal",
      items: [...item("Ambient", dashboard.ambientTempCelsius, " C")],
    },
  ];
};

const normalizeSupermicroDashboard = (
  dashboard: SmcDashboard,
): BmcOverviewSection[] => {
  const system = dashboard.systemInfo;
  const powerState = dashboard.powerState ?? system?.powerState;
  return [
    {
      id: "system",
      title: "System",
      items: [
        ...item("Platform", dashboard.platform),
        ...item("Manufacturer", system?.manufacturer),
        ...item("Model", system?.model),
        ...item("Serial number", system?.serialNumber),
        ...item("BIOS", system?.biosVersion),
        ...item("Hostname", system?.hostname),
        ...item("Processors", dashboard.cpuCount),
        ...item("Memory", dashboard.totalMemoryGb, " GB"),
      ],
    },
    {
      id: "health",
      title: "Health",
      status: dashboard.healthStatus,
      items: [...item("Overall", dashboard.healthStatus)],
    },
    {
      id: "power",
      title: "Power",
      status: powerState,
      items: [
        ...item("State", powerState),
        ...item("Consumption", dashboard.totalPowerWatts, " W"),
      ],
    },
    {
      id: "thermal",
      title: "Thermal",
      items: [...item("Ambient", dashboard.ambientTempCelsius, " C")],
    },
  ];
};

async function loadReadOnlyOverview<
  TDashboard,
  TController,
  TVirtualDisk,
  TPhysicalDisk,
  TFirmware extends FirmwareRecord,
>(
  commands: ReadOnlyOverviewCommands,
  normalizeDashboard: (dashboard: TDashboard) => BmcOverviewSection[],
): Promise<BmcOverview> {
  const [dashboard, controllers, virtualDisks, physicalDisks, firmware] =
    await Promise.all([
      settle(() => invoke<TDashboard>(commands.dashboard)),
      settle(() => invoke<TController[]>(commands.storageControllers)),
      settle(() => invoke<TVirtualDisk[]>(commands.virtualDisks)),
      settle(() => invoke<TPhysicalDisk[]>(commands.physicalDisks)),
      settle(() => invoke<TFirmware[]>(commands.firmwareInventory)),
    ]);

  const dashboardSections = dashboard.ok
    ? normalizeDashboard(dashboard.value)
    : dashboardErrorSections(dashboard.error);

  const storageErrors = [
    controllers.ok ? null : `Controllers: ${controllers.error}`,
    virtualDisks.ok ? null : `Virtual disks: ${virtualDisks.error}`,
    physicalDisks.ok ? null : `Physical disks: ${physicalDisks.error}`,
  ].filter((value): value is string => Boolean(value));
  const storage: BmcOverviewSection = {
    id: "storage",
    title: "Storage",
    items: [
      ...(controllers.ok ? item("Controllers", controllers.value.length) : []),
      ...(virtualDisks.ok
        ? item("Virtual disks", virtualDisks.value.length)
        : []),
      ...(physicalDisks.ok
        ? item("Physical disks", physicalDisks.value.length)
        : []),
    ],
    error: storageErrors.length ? storageErrors.join(" | ") : undefined,
  };

  const firmwareSection: BmcOverviewSection = firmware.ok
    ? {
        id: "firmware",
        title: "Firmware",
        items: [
          ...item("Components", firmware.value.length),
          ...firmware.value.slice(0, 5).map((entry) => ({
            label: entry.name,
            value: `${entry.version}${entry.status ? ` - ${entry.status}` : ""}`,
          })),
        ],
      }
    : {
        id: "firmware",
        title: "Firmware",
        items: [],
        error: `Firmware inventory read failed: ${firmware.error}`,
      };

  return {
    refreshedAt: new Date().toISOString(),
    sections: [...dashboardSections, storage, firmwareSection],
  };
}

export const iloRuntimeAdapter: BmcRuntimeAdapter = {
  protocol: "ilo",
  displayName: "HPE iLO",
  async connect(connection) {
    const settings = connection.iloSettings;
    await invoke<string>("ilo_connect", {
      host: connection.hostname,
      port: connection.port ?? 443,
      username: connection.username ?? "",
      password: connection.password ?? "",
      authMethod: settings?.authMethod ?? "session",
      protocol: settings?.protocol,
      insecure: settings?.insecure ?? true,
      timeoutSecs: settings?.timeoutSecs ?? 30,
      ipmiPort: settings?.ipmiPort ?? 623,
      generation: settings?.generation,
    });
  },
  async disconnect() {
    await invoke<void>("ilo_disconnect");
  },
  loadOverview() {
    return loadReadOnlyOverview<
      IloDashboard,
      IloStorageController,
      IloVirtualDisk,
      IloPhysicalDisk,
      IloFirmwareItem
    >(
      {
        dashboard: "ilo_get_dashboard",
        storageControllers: "ilo_get_storage_controllers",
        virtualDisks: "ilo_get_virtual_disks",
        physicalDisks: "ilo_get_physical_disks",
        firmwareInventory: "ilo_get_firmware_inventory",
      },
      normalizeIloDashboard,
    );
  },
};

export const lenovoRuntimeAdapter: BmcRuntimeAdapter = {
  protocol: "lenovo",
  displayName: "Lenovo XClarity",
  async connect(connection) {
    const settings = connection.lenovoSettings;
    await invoke<string>("lenovo_connect", {
      host: connection.hostname,
      port: connection.port ?? 443,
      username: connection.username ?? "",
      password: connection.password ?? "",
      protocol: settings?.protocol,
      insecure: settings?.insecure ?? true,
      timeoutSecs: settings?.timeoutSecs ?? 30,
      ipmiPort: settings?.ipmiPort ?? 623,
      generation: settings?.generation,
    });
  },
  async disconnect() {
    await invoke<void>("lenovo_disconnect");
  },
  loadOverview() {
    return loadReadOnlyOverview<
      XccDashboard,
      LenovoStorageController,
      LenovoVirtualDisk,
      LenovoPhysicalDisk,
      LenovoFirmwareItem
    >(
      {
        dashboard: "lenovo_get_dashboard",
        storageControllers: "lenovo_get_storage_controllers",
        virtualDisks: "lenovo_get_virtual_disks",
        physicalDisks: "lenovo_get_physical_disks",
        firmwareInventory: "lenovo_get_firmware_inventory",
      },
      normalizeLenovoDashboard,
    );
  },
};

export const supermicroRuntimeAdapter: BmcRuntimeAdapter = {
  protocol: "supermicro",
  displayName: "Supermicro BMC",
  async connect(connection) {
    const settings = connection.supermicroSettings;
    await invoke<void>("smc_connect", {
      config: {
        host: connection.hostname,
        port: connection.port ?? 443,
        username: connection.username ?? "",
        password: connection.password ?? "",
        useSsl: settings?.useSsl ?? true,
        verifyCert: settings?.verifyCert ?? false,
        platform: settings?.platform ?? "unknown",
        authMethod: settings?.authMethod ?? "session",
        timeoutSecs: settings?.timeoutSecs ?? 30,
      },
    });
  },
  async disconnect() {
    await invoke<void>("smc_disconnect");
  },
  loadOverview() {
    return loadReadOnlyOverview<
      SmcDashboard,
      SmcStorageController,
      SmcVirtualDisk,
      SmcPhysicalDisk,
      SmcFirmwareItem
    >(
      {
        dashboard: "smc_get_dashboard",
        storageControllers: "smc_get_storage_controllers",
        virtualDisks: "smc_get_virtual_disks",
        physicalDisks: "smc_get_physical_disks",
        firmwareInventory: "smc_get_firmware_inventory",
      },
      normalizeSupermicroDashboard,
    );
  },
};
