import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SystemInfoPanel from "../../src/components/windows/panels/SystemInfoPanel";
import type { WinmgmtContext } from "../../src/components/windows/WinmgmtWrapper";
import type { SystemInfo } from "../../src/types/windows/winmgmt";

const { systemInfoT } = vi.hoisted(() => ({
  systemInfoT: vi.fn(
    (
      key: string,
      fallback: string = key,
      variables?: Record<string, unknown>,
    ) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
        String(variables?.[token] ?? `{{${token}}}`),
      ),
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: systemInfoT }),
}));

const systemInfo = {
  computerSystem: {
    name: "host-01",
    domain: "example.test",
    manufacturer: "Example Systems",
    model: "Model A",
    systemType: "x64-based PC",
    totalPhysicalMemory: 17_179_869_184,
    numberOfProcessors: 1,
    numberOfLogicalProcessors: 8,
    domainRole: "Member Workstation",
    dnsHostName: "host-01.example.test",
    userName: "EXAMPLE\operator",
  },
  operatingSystem: {
    caption: "Windows 11 Enterprise",
    version: "10.0",
    buildNumber: "26100",
    osArchitecture: "64-bit",
    installDate: "2026-01-01",
    lastBootUpTime: "2026-06-01",
    windowsDirectory: "C:\Windows",
    numberOfProcesses: 120,
    numberOfUsers: 2,
  },
  bios: {
    manufacturer: "Example Firmware",
    name: "Example BIOS",
    version: "1.0.0",
    serialNumber: "SERIAL-1",
    smbiosBiosVersion: "3.5",
  },
  processors: [
    {
      deviceId: "CPU0",
      name: "Example CPU",
      numberOfCores: 4,
      numberOfLogicalProcessors: 8,
      currentClockSpeed: 3000,
      maxClockSpeed: 4500,
      l2CacheSize: 2048,
      l3CacheSize: 16384,
      loadPercentage: 25,
    },
  ],
  logicalDisks: [
    {
      deviceId: "C:",
      volumeName: "System",
      fileSystem: "NTFS",
      size: 1_000_000_000,
      freeSpace: 500_000_000,
      usedPercent: 50,
    },
  ],
  networkAdapters: [
    {
      interfaceIndex: 1,
      netConnectionId: "Ethernet",
      description: "Primary adapter",
      macAddress: "00:11:22:33:44:55",
      ipAddresses: ["192.0.2.10"],
      defaultIpGateway: ["192.0.2.1"],
      dnsServers: ["192.0.2.53"],
      dhcpEnabled: true,
      speed: 1_000_000_000,
    },
    {
      interfaceIndex: 2,
      netConnectionId: "Backup",
      description: "Backup adapter",
      macAddress: null,
      ipAddresses: [],
      defaultIpGateway: [],
      dnsServers: [],
      dhcpEnabled: false,
      speed: null,
    },
  ],
  physicalMemory: [
    {
      deviceLocator: "DIMM 0",
      capacity: 17_179_869_184,
      memoryType: "DDR5",
      formFactor: "DIMM",
      speed: 5600,
      manufacturer: "Example Memory",
    },
  ],
} as unknown as SystemInfo;

describe("SystemInfoPanel translations", () => {
  it("routes visible copy through translation and preserves technical labels", async () => {
    systemInfoT.mockClear();
    const cmd = vi.fn().mockResolvedValue(systemInfo);
    const ctx = { cmd } as unknown as WinmgmtContext;

    render(<SystemInfoPanel ctx={ctx} />);

    expect(await screen.findByText("Network Adapters (2)")).toBeInTheDocument();
    expect(cmd).toHaveBeenCalledWith("winmgmt_system_info");

    const ownedFallbacks: Array<[string, string]> = [
      ["windows.systemInfo.refresh","Refresh"],
      ["windows.systemInfo.title","System Information"],
      ["windows.systemInfo.sections.computerSystem","Computer System"],
      ["windows.systemInfo.fields.name","Name"],
      ["windows.systemInfo.fields.domain","Domain"],
      ["windows.systemInfo.fields.manufacturer","Manufacturer"],
      ["windows.systemInfo.fields.model","Model"],
      ["windows.systemInfo.fields.systemType","System Type"],
      ["windows.systemInfo.fields.totalMemory","Total Memory"],
      ["windows.systemInfo.fields.processors","Processors"],
      ["windows.systemInfo.fields.domainRole","Domain Role"],
      ["windows.systemInfo.fields.currentUser","Current User"],
      ["windows.systemInfo.sections.operatingSystem","Operating System"],
      ["windows.systemInfo.fields.os","OS"],
      ["windows.systemInfo.fields.version","Version"],
      ["windows.systemInfo.fields.architecture","Architecture"],
      ["windows.systemInfo.fields.installed","Installed"],
      ["windows.systemInfo.fields.lastBoot","Last Boot"],
      ["windows.systemInfo.fields.windowsDirectory","Windows Dir"],
      ["windows.systemInfo.fields.processes","Processes"],
      ["windows.systemInfo.fields.users","Users"],
      ["windows.systemInfo.fields.serialNumber","Serial Number"],
      ["windows.systemInfo.fields.cores","Cores"],
      ["windows.systemInfo.fields.speed","Speed"],
      ["windows.systemInfo.fields.l2Cache","L2 Cache"],
      ["windows.systemInfo.fields.l3Cache","L3 Cache"],
      ["windows.systemInfo.fields.load","Load"],
      ["windows.systemInfo.fields.drive","Drive"],
      ["windows.systemInfo.fields.label","Label"],
      ["windows.systemInfo.fields.fileSystem","FS"],
      ["windows.systemInfo.fields.size","Size"],
      ["windows.systemInfo.fields.free","Free"],
      ["windows.systemInfo.fields.used","Used"],
      ["windows.systemInfo.fields.gateway","Gateway"],
      ["windows.systemInfo.fields.slot","Slot"],
      ["windows.systemInfo.fields.type","Type"],
    ];
    for (const [key, fallback] of ownedFallbacks) {
      expect(systemInfoT).toHaveBeenCalledWith(key, fallback);
    }

    expect(systemInfoT).toHaveBeenCalledWith(
      "windows.systemInfo.sections.processorsCount",
      "Processors ({{count}})",
      { count: 1 },
    );
    expect(systemInfoT).toHaveBeenCalledWith(
      "windows.systemInfo.values.versionWithBuild",
      "{{version}} (Build {{build}})",
      { version: "10.0", build: "26100" },
    );
    expect(systemInfoT).toHaveBeenCalledWith(
      "windows.systemInfo.values.speedWithMaximum",
      "{{current}} MHz (max {{maximum}} MHz)",
      { current: 3000, maximum: 4500 },
    );
    expect(systemInfoT).toHaveBeenCalledWith(
      "windows.systemInfo.values.enabled",
      "Enabled",
    );
    expect(systemInfoT).toHaveBeenCalledWith(
      "windows.systemInfo.values.disabled",
      "Disabled",
    );

    const technicalFallbacks = [
      "DNS Hostname",
      "BIOS",
      "SMBIOS Version",
      "MAC",
      "IP",
      "DNS",
      "DHCP",
    ];
    for (const fallback of technicalFallbacks) {
      expect(
        systemInfoT.mock.calls.some((call) => call[1] === fallback),
      ).toBe(false);
    }
  });
});
