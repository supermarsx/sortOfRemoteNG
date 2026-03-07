import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServerStatsPanel } from "../../src/components/ssh/ServerStatsPanel";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { parseServerStatsOutput } from "../../src/utils/ssh/serverStatsParser";
import { buildStatsCollectionScript } from "../../src/utils/ssh/serverStatsCommands";
import type { StatsCollectionOptions } from "../../src/types/monitoring/serverStats";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../src/utils/connection/collectionManager", () => ({
  CollectionManager: {
    getInstance: () => ({
      getAllCollections: vi.fn().mockResolvedValue([]),
      getCurrentCollection: vi.fn().mockReturnValue(null),
    }),
    resetInstance: vi.fn(),
  },
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

const mockSshSessions = [
  {
    id: "session-1",
    name: "Ubuntu Server",
    protocol: "ssh",
    hostname: "192.168.1.100",
    status: "connected",
    backendSessionId: "backend-1",
  },
  {
    id: "session-2",
    name: "CentOS Server",
    protocol: "ssh",
    hostname: "192.168.1.101",
    status: "connected",
    backendSessionId: "backend-2",
  },
  {
    id: "session-rdp",
    name: "Windows RDP",
    protocol: "rdp",
    hostname: "192.168.1.200",
    status: "connected",
  },
];

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: mockSshSessions,
      connections: [],
    },
    dispatch: vi.fn(),
  }),
}));

const mockOnClose = vi.fn();

const renderPanel = (isOpen = true) =>
  render(
    <ConnectionProvider>
      <ServerStatsPanel isOpen={isOpen} onClose={mockOnClose} />
    </ConnectionProvider>,
  );

// ── Component Tests ────────────────────────────────────────────────

describe("ServerStatsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", () => {
      renderPanel(false);
      expect(screen.queryByText("Server Stats")).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderPanel(true);
      expect(screen.getByText("Server Stats")).toBeInTheDocument();
    });

    it("should show empty state when no stats collected", () => {
      renderPanel();
      expect(screen.getByText("No stats collected yet")).toBeInTheDocument();
    });

    it("should render session selector with SSH sessions only", () => {
      renderPanel();
      const select = screen.getByLabelText("Select SSH session");
      expect(select).toBeInTheDocument();
      // Should have the two SSH sessions as options
      const options = select.querySelectorAll("option");
      const optionTexts = Array.from(options).map((o) => o.textContent);
      expect(optionTexts).toContain("Ubuntu Server");
      expect(optionTexts).toContain("CentOS Server");
      expect(optionTexts).not.toContain("Windows RDP");
    });

    it("should show Collect button", () => {
      renderPanel();
      expect(screen.getByText("Collect")).toBeInTheDocument();
    });
  });

  describe("Tab Navigation", () => {
    it("should render tab buttons", () => {
      renderPanel();
      expect(screen.getByTitle("overview")).toBeInTheDocument();
      expect(screen.getByTitle("cpu")).toBeInTheDocument();
      expect(screen.getByTitle("memory")).toBeInTheDocument();
      expect(screen.getByTitle("disk")).toBeInTheDocument();
      expect(screen.getByTitle("system")).toBeInTheDocument();
      expect(screen.getByTitle("firewall")).toBeInTheDocument();
      expect(screen.getByTitle("ports")).toBeInTheDocument();
    });
  });
});

// ── Parser Tests ───────────────────────────────────────────────────

describe("parseServerStatsOutput", () => {
  const SAMPLE_OUTPUT = `===SORNG_STATS_BEGIN===
===CPU_BEGIN===
model name : Intel(R) Xeon(R) CPU E5-2686 v4 @ 2.30GHz
cpu_cores:4
0.45 0.30 0.25 1/236 12345
cpu_stat_1:cpu  100000 200 50000 800000 1000 0 500 0 0 0
cpu_stat_2:cpu  100500 200 50200 800800 1000 0 500 0 0 0
===CPU_END===
===MEM_BEGIN===
MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          4096000 kB
SwapTotal:       4194304 kB
SwapFree:        3145728 kB
===MEM_END===
===DISK_BEGIN===
/dev/sda1      ext4    104857600K 52428800K  47185920K  53% /
/dev/sdb1      xfs     209715200K 104857600K  94371840K  53% /data
---DISK_IO---
   8       0 sda 123456 0 2469120 0 654321 0 5234568 0 0 0 0 0 0 0 0 0 0
===DISK_END===
===SYS_BEGIN===
hostname:web-prod-01
kernel:5.15.0-91-generic
arch:x86_64
server_time:2026-03-03T10:30:00Z
uptime_s:1234567.89
uptime_raw: 10:30:00 up 14 days,  3:27,  2 users,  load average: 0.45, 0.30, 0.25
users:2
os_name:Ubuntu 22.04.3 LTS
os_version:22.04
===SYS_END===
===FW_BEGIN===
fw_backend:ufw
Status: active
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
===FW_END===
===PORTS_BEGIN===
port_tool:ss
Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
tcp   LISTEN 0      128          0.0.0.0:22   0.0.0.0:*     users:(("sshd",pid=1234,fd=3))
tcp   LISTEN 0      511          0.0.0.0:80   0.0.0.0:*     users:(("nginx",pid=5678,fd=6))
tcp   LISTEN 0      511          0.0.0.0:443  0.0.0.0:*     users:(("nginx",pid=5678,fd=7))
---PORT_COUNTS---
established:42
time_wait:7
===PORTS_END===
===SORNG_STATS_END===`;

  it("should parse CPU stats", () => {
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "s1", "test", Date.now());
    expect(snap.cpu.model).toBe("Intel(R) Xeon(R) CPU E5-2686 v4 @ 2.30GHz");
    expect(snap.cpu.coreCount).toBe(4);
    expect(snap.cpu.loadAvg1).toBeCloseTo(0.45);
    expect(snap.cpu.loadAvg5).toBeCloseTo(0.3);
    expect(snap.cpu.loadAvg15).toBeCloseTo(0.25);
    expect(snap.cpu.usagePercent).toBeGreaterThan(0);
  });

  it("should parse memory stats", () => {
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "s1", "test", Date.now());
    expect(snap.memory.totalBytes).toBe(16384000 * 1024);
    expect(snap.memory.freeBytes).toBe(2048000 * 1024);
    expect(snap.memory.availableBytes).toBe(8192000 * 1024);
    expect(snap.memory.swapTotalBytes).toBe(4194304 * 1024);
    expect(snap.memory.usagePercent).toBeGreaterThan(0);
    expect(snap.memory.usagePercent).toBeLessThan(100);
  });

  it("should parse disk partitions", () => {
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "s1", "test", Date.now());
    expect(snap.disk.partitions).toHaveLength(2);
    expect(snap.disk.partitions[0].mountPoint).toBe("/");
    expect(snap.disk.partitions[0].fsType).toBe("ext4");
    expect(snap.disk.partitions[0].usagePercent).toBe(53);
    expect(snap.disk.partitions[1].mountPoint).toBe("/data");
  });

  it("should parse disk I/O stats", () => {
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "s1", "test", Date.now());
    expect(snap.disk.io).not.toBeNull();
    expect(snap.disk.io!.readBytes).toBeGreaterThan(0);
    expect(snap.disk.io!.writeBytes).toBeGreaterThan(0);
  });

  it("should parse system info", () => {
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "s1", "test", Date.now());
    expect(snap.system.hostname).toBe("web-prod-01");
    expect(snap.system.kernelVersion).toBe("5.15.0-91-generic");
    expect(snap.system.architecture).toBe("x86_64");
    expect(snap.system.osName).toBe("Ubuntu 22.04.3 LTS");
    expect(snap.system.osVersion).toBe("22.04");
    expect(snap.system.loggedInUsers).toBe(2);
    expect(snap.system.uptimeSeconds).toBeCloseTo(1234567.89);
  });

  it("should parse firewall config", () => {
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "s1", "test", Date.now());
    expect(snap.firewall.backend).toBe("ufw");
    expect(snap.firewall.active).toBe(true);
    expect(snap.firewall.rules.length).toBeGreaterThanOrEqual(3);
    expect(snap.firewall.rules[0].target).toBe("ALLOW");
  });

  it("should parse port monitor stats", () => {
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "s1", "test", Date.now());
    expect(snap.ports.listeningPorts.length).toBeGreaterThanOrEqual(3);
    expect(snap.ports.establishedConnections).toBe(42);
    expect(snap.ports.timeWaitConnections).toBe(7);

    const sshPort = snap.ports.listeningPorts.find((p) => p.localPort === 22);
    expect(sshPort).toBeDefined();
    expect(sshPort!.processName).toBe("sshd");
    expect(sshPort!.pid).toBe(1234);
  });

  it("should report warnings for missing sections", () => {
    const snap = parseServerStatsOutput("===SORNG_STATS_BEGIN===\n===SORNG_STATS_END===", "s1", "test", Date.now());
    expect(snap.warnings.length).toBeGreaterThan(0);
    expect(snap.cpu.usagePercent).toBe(0);
    expect(snap.memory.totalBytes).toBe(0);
    expect(snap.disk.partitions).toHaveLength(0);
  });

  it("should include collection metadata", () => {
    const start = Date.now();
    const snap = parseServerStatsOutput(SAMPLE_OUTPUT, "session-1", "TestServer", start);
    expect(snap.sessionId).toBe("session-1");
    expect(snap.connectionName).toBe("TestServer");
    expect(snap.collectedAt).toBeDefined();
    expect(snap.collectionDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Build Script Tests ─────────────────────────────────────────────

describe("buildStatsCollectionScript", () => {
  it("should include CPU section when enabled", () => {
    const opts: StatsCollectionOptions = {
      cpu: true, memory: false, disk: false, system: false, firewall: false, ports: false,
    };
    const script = buildStatsCollectionScript(opts);
    expect(script).toContain("===CPU_BEGIN===");
    expect(script).toContain("===CPU_END===");
    expect(script).not.toContain("===MEM_BEGIN===");
    expect(script).not.toContain("===DISK_BEGIN===");
  });

  it("should include all sections when all enabled", () => {
    const opts: StatsCollectionOptions = {
      cpu: true, memory: true, disk: true, system: true, firewall: true, ports: true,
    };
    const script = buildStatsCollectionScript(opts);
    expect(script).toContain("===CPU_BEGIN===");
    expect(script).toContain("===MEM_BEGIN===");
    expect(script).toContain("===DISK_BEGIN===");
    expect(script).toContain("===SYS_BEGIN===");
    expect(script).toContain("===FW_BEGIN===");
    expect(script).toContain("===PORTS_BEGIN===");
  });

  it("should include begin/end markers", () => {
    const opts: StatsCollectionOptions = {
      cpu: true, memory: true, disk: true, system: true, firewall: true, ports: true,
    };
    const script = buildStatsCollectionScript(opts);
    expect(script).toContain("===SORNG_STATS_BEGIN===");
    expect(script).toContain("===SORNG_STATS_END===");
  });

  it("should generate empty script body when nothing enabled", () => {
    const opts: StatsCollectionOptions = {
      cpu: false, memory: false, disk: false, system: false, firewall: false, ports: false,
    };
    const script = buildStatsCollectionScript(opts);
    expect(script).toContain("===SORNG_STATS_BEGIN===");
    expect(script).toContain("===SORNG_STATS_END===");
    expect(script).not.toContain("===CPU_BEGIN===");
  });

  it("should use portable commands for cross-distro support", () => {
    const opts: StatsCollectionOptions = {
      cpu: true, memory: true, disk: true, system: true, firewall: true, ports: true,
    };
    const script = buildStatsCollectionScript(opts);
    // Should use /proc/meminfo (not free command which varies)
    expect(script).toContain("/proc/meminfo");
    // Should use /proc/cpuinfo
    expect(script).toContain("/proc/cpuinfo");
    // Should use df for disk
    expect(script).toContain("df -BK");
    // Should check for ufw, firewall-cmd, nft, iptables
    expect(script).toContain("ufw");
    expect(script).toContain("firewall-cmd");
    expect(script).toContain("nft");
    expect(script).toContain("iptables");
    // Should check for ss and netstat
    expect(script).toContain("ss -tulnp");
    expect(script).toContain("netstat");
    // Should try /etc/os-release, /etc/redhat-release, /etc/alpine-release
    expect(script).toContain("/etc/os-release");
    expect(script).toContain("/etc/redhat-release");
    expect(script).toContain("/etc/alpine-release");
  });
});
