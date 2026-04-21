import { describe, it, expect } from "vitest";
import { buildStatsCollectionScript } from "../../src/utils/ssh/serverStatsCommands";

describe("buildStatsCollectionScript", () => {
  it("returns a script with the header marker", () => {
    const script = buildStatsCollectionScript({
      cpu: false, memory: false, disk: false,
      system: false, firewall: false, ports: false,
    });
    expect(script).toContain("===SORNG_STATS_BEGIN===");
  });

  it("includes CPU section when enabled", () => {
    const script = buildStatsCollectionScript({
      cpu: true, memory: false, disk: false,
      system: false, firewall: false, ports: false,
    });
    expect(script).toContain("===CPU_BEGIN===");
    expect(script).toContain("===CPU_END===");
    expect(script).toContain("/proc/cpuinfo");
  });

  it("includes memory section when enabled", () => {
    const script = buildStatsCollectionScript({
      cpu: false, memory: true, disk: false,
      system: false, firewall: false, ports: false,
    });
    expect(script).toContain("===MEM_BEGIN===");
    expect(script).toContain("/proc/meminfo");
  });

  it("includes disk section when enabled", () => {
    const script = buildStatsCollectionScript({
      cpu: false, memory: false, disk: true,
      system: false, firewall: false, ports: false,
    });
    expect(script).toContain("===DISK_BEGIN===");
    expect(script).toContain("df");
  });

  it("includes system section when enabled", () => {
    const script = buildStatsCollectionScript({
      cpu: false, memory: false, disk: false,
      system: true, firewall: false, ports: false,
    });
    expect(script).toContain("===SYS_BEGIN===");
    expect(script).toContain("hostname");
  });

  it("omits sections when disabled", () => {
    const script = buildStatsCollectionScript({
      cpu: false, memory: false, disk: false,
      system: false, firewall: false, ports: false,
    });
    expect(script).not.toContain("===CPU_BEGIN===");
    expect(script).not.toContain("===MEM_BEGIN===");
    expect(script).not.toContain("===DISK_BEGIN===");
  });

  it("includes all sections when all enabled", () => {
    const script = buildStatsCollectionScript({
      cpu: true, memory: true, disk: true,
      system: true, firewall: true, ports: true,
    });
    expect(script).toContain("===CPU_BEGIN===");
    expect(script).toContain("===MEM_BEGIN===");
    expect(script).toContain("===DISK_BEGIN===");
    expect(script).toContain("===SYS_BEGIN===");
  });
});
