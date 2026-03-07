import { describe, it, expect } from "vitest";
import { parseServerStatsOutput } from "../../src/utils/ssh/serverStatsParser";

function buildRawOutput(sections: Record<string, string>): string {
  const parts: string[] = ["===SORNG_STATS_BEGIN==="];
  for (const [key, content] of Object.entries(sections)) {
    parts.push(`===${key}_BEGIN===`);
    parts.push(content);
    parts.push(`===${key}_END===`);
  }
  parts.push("===SORNG_STATS_END===");
  return parts.join("\n");
}

const CPU_SECTION = `model name : Intel(R) Core(TM) i7-9700K
cpu_cores: 8
1.25 0.90 0.75
cpu_stat_1:cpu  100000 200 300 50000 100 0 0 0 0 0
cpu_stat_2:cpu  101000 200 300 50200 100 0 0 0 0 0`;

const MEM_SECTION = `MemTotal:       16384000 kB
MemFree:         4096000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          2048000 kB
SwapTotal:       2048000 kB
SwapFree:        1024000 kB`;

const DISK_SECTION = `Filesystem     Type  1K-blocks      Used Available Use% Mounted on
/dev/sda1      ext4  100000K    60000K    40000K   60% /
---DISK_IO---
   8       0 sda 100 0 2000 0 50 0 1000 0 0 0 0 0 0 0`;

const SYS_SECTION = `hostname: testhost
kernel: 5.15.0-generic
arch: x86_64
server_time: 2024-01-01T00:00:00Z
uptime_s: 86400
os_name: Ubuntu
os_version: 22.04
users: 3`;

const FW_SECTION = `fw_backend:ufw
22/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere`;

const PORTS_SECTION = `port_tool:ss
tcp   LISTEN 0      128           0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=1234,fd=3))
tcp   LISTEN 0      128           0.0.0.0:443       0.0.0.0:*    users:(("nginx",pid=5678,fd=6))
---PORT_COUNTS---
established:15
time_wait:3`;

describe("serverStatsParser", () => {
  describe("parseServerStatsOutput", () => {
    it("parses a complete stats output", () => {
      const raw = buildRawOutput({
        CPU: CPU_SECTION,
        MEM: MEM_SECTION,
        DISK: DISK_SECTION,
        SYS: SYS_SECTION,
        FW: FW_SECTION,
        PORTS: PORTS_SECTION,
      });

      const result = parseServerStatsOutput(raw, "sess-1", "test-conn", Date.now());

      expect(result.sessionId).toBe("sess-1");
      expect(result.connectionName).toBe("test-conn");
    });

    it("parses CPU stats correctly", () => {
      const raw = buildRawOutput({ CPU: CPU_SECTION });
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());

      expect(result.cpu.model).toContain("i7-9700K");
      expect(result.cpu.coreCount).toBe(8);
      expect(result.cpu.loadAvg1).toBe(1.25);
      expect(result.cpu.loadAvg5).toBe(0.9);
      expect(result.cpu.loadAvg15).toBe(0.75);
      expect(result.cpu.usagePercent).toBeGreaterThan(0);
    });

    it("parses memory stats correctly", () => {
      const raw = buildRawOutput({ MEM: MEM_SECTION });
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());

      expect(result.memory.totalBytes).toBe(16384000 * 1024);
      expect(result.memory.freeBytes).toBe(4096000 * 1024);
      expect(result.memory.availableBytes).toBe(8192000 * 1024);
      expect(result.memory.swapTotalBytes).toBe(2048000 * 1024);
      expect(result.memory.swapUsedBytes).toBe(1024000 * 1024);
      expect(result.memory.usagePercent).toBeGreaterThan(0);
    });

    it("parses disk stats correctly", () => {
      const raw = buildRawOutput({ DISK: DISK_SECTION });
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());

      expect(result.disk.partitions).toHaveLength(1);
      expect(result.disk.partitions[0].filesystem).toBe("/dev/sda1");
      expect(result.disk.partitions[0].fsType).toBe("ext4");
      expect(result.disk.partitions[0].mountPoint).toBe("/");
      expect(result.disk.partitions[0].usagePercent).toBe(60);
      expect(result.disk.io).toBeDefined();
      expect(result.disk.io!.readBytes).toBeGreaterThan(0);
    });

    it("parses system info correctly", () => {
      const raw = buildRawOutput({ SYS: SYS_SECTION });
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());

      expect(result.system.hostname).toBe("testhost");
      expect(result.system.kernelVersion).toBe("5.15.0-generic");
      expect(result.system.architecture).toBe("x86_64");
      expect(result.system.osName).toBe("Ubuntu");
      expect(result.system.osVersion).toBe("22.04");
      expect(result.system.loggedInUsers).toBe(3);
      expect(result.system.uptimeSeconds).toBe(86400);
    });

    it("parses firewall rules (ufw backend)", () => {
      const raw = buildRawOutput({ FW: FW_SECTION });
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());

      expect(result.firewall.backend).toBe("ufw");
      expect(result.firewall.active).toBe(true);
      expect(result.firewall.rules.length).toBeGreaterThanOrEqual(1);
    });

    it("parses listening ports (ss tool)", () => {
      const raw = buildRawOutput({ PORTS: PORTS_SECTION });
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());

      expect(result.ports.listeningPorts.length).toBeGreaterThanOrEqual(1);
      expect(result.ports.establishedConnections).toBe(15);
      expect(result.ports.timeWaitConnections).toBe(3);

      const sshPort = result.ports.listeningPorts.find((p) => p.localPort === 22);
      if (sshPort) {
        expect(sshPort.processName).toBe("sshd");
        expect(sshPort.pid).toBe(1234);
      }
    });

    it("adds warnings for missing sections", () => {
      const raw = "===SORNG_STATS_BEGIN===\n===SORNG_STATS_END===";
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("returns default values when section data is empty", () => {
      const raw = "===SORNG_STATS_BEGIN===\n===SORNG_STATS_END===";
      const result = parseServerStatsOutput(raw, "s", "c", Date.now());

      expect(result.cpu.usagePercent).toBe(0);
      expect(result.memory.totalBytes).toBe(0);
      expect(result.disk.partitions).toHaveLength(0);
      expect(result.firewall.backend).toBe("none");
    });

    it("sets collectionDurationMs", () => {
      const raw = buildRawOutput({});
      const start = Date.now() - 500;
      const result = parseServerStatsOutput(raw, "s", "c", start);
      expect(result.collectionDurationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
