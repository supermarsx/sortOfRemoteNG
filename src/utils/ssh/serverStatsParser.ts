// ─── Server Stats Parser ────────────────────────────────────────────────────
// Parses the raw stdout from the stats collection script into typed objects.

import type {
  CpuStats,
  MemoryStats,
  DiskStats,
  DiskPartition,
  DiskIoStats,
  SystemInfo,
  FirewallConfig,
  FirewallRule,
  PortMonitorStats,
  ListeningPort,
  ServerStatsSnapshot,
} from "../../types/monitoring/serverStats";

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSection(raw: string, begin: string, end: string): string {
  const startIdx = raw.indexOf(begin);
  if (startIdx < 0) return "";
  const contentStart = startIdx + begin.length;
  if (!end) return raw.slice(contentStart).trim();
  const endIdx = raw.indexOf(end, contentStart);
  if (endIdx < 0) return "";
  return raw.slice(contentStart, endIdx).trim();
}

function parseKb(val: string): number {
  const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
  return isNaN(num) ? 0 : num * 1024; // /proc/meminfo reports in kB
}

function parseDfBytes(val: string): number {
  // df -BK outputs values like "1234K"
  const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
  return isNaN(num) ? 0 : num * 1024;
}

// ─── CPU ────────────────────────────────────────────────────────────────────

function parseCpu(section: string): CpuStats {
  const lines = section.split("\n").map((l) => l.trim());

  // Model
  const modelLine = lines.find((l) => l.startsWith("model name"));
  const model = modelLine ? modelLine.split(":").slice(1).join(":").trim() : "unknown";

  // Core count
  const coreLine = lines.find((l) => l.startsWith("cpu_cores:"));
  const coreCount = coreLine ? parseInt(coreLine.split(":")[1], 10) || 1 : 1;

  // Load averages
  const loadLine = lines.find(
    (l) => !l.startsWith("cpu_") && !l.startsWith("model") && /^\d/.test(l),
  );
  let loadAvg1 = 0,
    loadAvg5 = 0,
    loadAvg15 = 0;
  if (loadLine) {
    const parts = loadLine.split(/\s+/);
    loadAvg1 = parseFloat(parts[0]) || 0;
    loadAvg5 = parseFloat(parts[1]) || 0;
    loadAvg15 = parseFloat(parts[2]) || 0;
  }

  // CPU usage from two /proc/stat snapshots
  let usagePercent = 0;
  const stat1 = lines.find((l) => l.startsWith("cpu_stat_1:"));
  const stat2 = lines.find((l) => l.startsWith("cpu_stat_2:"));
  if (stat1 && stat2) {
    const extract = (line: string) => {
      const nums = line
        .replace(/^cpu_stat_[12]:cpu\s+/, "")
        .split(/\s+/)
        .map(Number);
      const idle = nums[3] + (nums[4] || 0); // idle + iowait
      const total = nums.reduce((a, b) => a + b, 0);
      return { idle, total };
    };
    const s1 = extract(stat1);
    const s2 = extract(stat2);
    const totalDelta = s2.total - s1.total;
    const idleDelta = s2.idle - s1.idle;
    usagePercent =
      totalDelta > 0
        ? Math.round(((totalDelta - idleDelta) / totalDelta) * 10000) / 100
        : 0;
  }

  return { usagePercent, coreCount, loadAvg1, loadAvg5, loadAvg15, model };
}

// ─── Memory ─────────────────────────────────────────────────────────────────

function parseMemory(section: string): MemoryStats {
  const kv: Record<string, number> = {};
  for (const line of section.split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/i);
    if (match) kv[match[1]] = parseInt(match[2], 10) * 1024;
  }
  const totalBytes = kv["MemTotal"] || 0;
  const freeBytes = kv["MemFree"] || 0;
  const availableBytes = kv["MemAvailable"] || freeBytes + (kv["Buffers"] || 0) + (kv["Cached"] || 0);
  const usedBytes = totalBytes - freeBytes;
  const usagePercent = totalBytes > 0 ? Math.round(((totalBytes - availableBytes) / totalBytes) * 10000) / 100 : 0;
  const swapTotalBytes = kv["SwapTotal"] || 0;
  const swapFreeBytes = kv["SwapFree"] || 0;
  const swapUsedBytes = swapTotalBytes - swapFreeBytes;
  const swapUsagePercent = swapTotalBytes > 0 ? Math.round((swapUsedBytes / swapTotalBytes) * 10000) / 100 : 0;

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    usagePercent,
    swapTotalBytes,
    swapUsedBytes,
    swapUsagePercent,
  };
}

// ─── Disk ───────────────────────────────────────────────────────────────────

function parseDisk(section: string): DiskStats {
  const ioSection = extractSection(section, "---DISK_IO---", "");
  const dfSection = section.split("---DISK_IO---")[0].trim();

  const partitions: DiskPartition[] = [];
  for (const line of dfSection.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Filesystem")) continue;
    // df -BK -T columns: Filesystem Type 1K-blocks Used Available Use% Mounted
    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue;
    const usageStr = parts[5].replace("%", "");
    partitions.push({
      filesystem: parts[0],
      fsType: parts[1],
      totalBytes: parseDfBytes(parts[2]),
      usedBytes: parseDfBytes(parts[3]),
      availableBytes: parseDfBytes(parts[4]),
      usagePercent: parseInt(usageStr, 10) || 0,
      mountPoint: parts.slice(6).join(" "),
    });
  }

  // Disk I/O — aggregate all devices for a simple read/write total
  let io: DiskIoStats | null = null;
  if (ioSection) {
    let readSectors = 0;
    let writeSectors = 0;
    for (const line of ioSection.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 14) {
        readSectors += parseInt(parts[5], 10) || 0;
        writeSectors += parseInt(parts[9], 10) || 0;
      }
    }
    if (readSectors > 0 || writeSectors > 0) {
      io = {
        readBytes: readSectors * 512,
        writeBytes: writeSectors * 512,
      };
    }
  }

  return { partitions, io };
}

// ─── System Info ────────────────────────────────────────────────────────────

function parseSystem(section: string): SystemInfo {
  const kv: Record<string, string> = {};
  for (const line of section.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      kv[key] = val;
    }
  }

  const uptimeRaw = kv["uptime_raw"] || "";
  const uptimeMatch = uptimeRaw.match(/up\s+(.+?),\s+\d+\s+user/);
  const uptime = uptimeMatch ? uptimeMatch[1].trim() : uptimeRaw;

  return {
    hostname: kv["hostname"] || "unknown",
    kernelVersion: kv["kernel"] || "unknown",
    architecture: kv["arch"] || "unknown",
    serverTime: kv["server_time"] || new Date().toISOString(),
    uptimeSeconds: parseFloat(kv["uptime_s"] || "0"),
    uptime: uptime || formatUptime(parseFloat(kv["uptime_s"] || "0")),
    osName: kv["os_name"] || "unknown",
    osVersion: kv["os_version"] || "unknown",
    loggedInUsers: parseInt(kv["users"] || "0", 10),
  };
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "unknown";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

// ─── Firewall ───────────────────────────────────────────────────────────────

function parseFirewall(section: string): FirewallConfig {
  const lines = section.split("\n").map((l) => l.trim());
  const backendLine = lines.find((l) => l.startsWith("fw_backend:"));
  const backend = (backendLine?.split(":")[1] || "none") as FirewallConfig["backend"];
  const errorLine = lines.find((l) => l.startsWith("fw_error:"));
  const active = !errorLine && backend !== "none";

  const rawOutput = lines
    .filter((l) => !l.startsWith("fw_backend:") && !l.startsWith("fw_error:"))
    .join("\n")
    .trim();

  const rules: FirewallRule[] = [];
  let ruleNum = 0;

  if (backend === "iptables") {
    let currentChain = "INPUT";
    for (const line of rawOutput.split("\n")) {
      if (line.startsWith("Chain ")) {
        const chainMatch = line.match(/^Chain (\S+)/);
        if (chainMatch) currentChain = chainMatch[1];
        continue;
      }
      if (line.startsWith("num") || !line.trim()) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 5 && /^\d+$/.test(parts[0])) {
        ruleNum++;
        rules.push({
          ruleNumber: parseInt(parts[0], 10),
          chain: currentChain,
          target: parts[1] || "",
          protocol: parts[2] || "all",
          source: parts[4] || "0.0.0.0/0",
          destination: parts[5] || "0.0.0.0/0",
          options: parts.slice(6).join(" "),
        });
      }
    }
  } else if (backend === "ufw") {
    for (const line of rawOutput.split("\n")) {
      // Simple UFW rule lines look like: "22/tcp ALLOW IN Anywhere"
      const ufwMatch = line.match(
        /^(\S+)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT)?\s*(.*)/,
      );
      if (ufwMatch) {
        ruleNum++;
        rules.push({
          ruleNumber: ruleNum,
          chain: ufwMatch[3] === "OUT" ? "OUTPUT" : "INPUT",
          target: ufwMatch[2],
          protocol: ufwMatch[1].includes("/") ? ufwMatch[1].split("/")[1] : "all",
          source: ufwMatch[4] || "Anywhere",
          destination: "0.0.0.0/0",
          options: ufwMatch[1],
        });
      }
    }
  }
  // For nftables / firewalld we capture raw output but don't deep-parse

  return { backend, active, rules, rawOutput };
}

// ─── Ports ──────────────────────────────────────────────────────────────────

function parsePorts(section: string): PortMonitorStats {
  const lines = section.split("\n").map((l) => l.trim());
  const toolLine = lines.find((l) => l.startsWith("port_tool:"));
  const tool = toolLine?.split(":")[1] || "none";

  const listeningPorts: ListeningPort[] = [];
  let established = 0;
  let timeWait = 0;

  const countsIdx = section.indexOf("---PORT_COUNTS---");
  const portLines =
    countsIdx >= 0 ? section.slice(0, countsIdx).split("\n") : lines;

  if (tool === "ss") {
    for (const line of portLines) {
      if (line.startsWith("port_tool:") || !line.trim()) continue;
      // ss -tulnp header: Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
      const parts = line.split(/\s+/);
      if (parts.length >= 5 && /^(tcp|udp)/.test(parts[0]) && parts[1] === "LISTEN") {
        const localParts = parts[4].split(":");
        const port = parseInt(localParts[localParts.length - 1], 10);
        const addr = localParts.slice(0, -1).join(":") || "0.0.0.0";
        const processMatch = (parts.slice(6).join(" ") || "").match(
          /users:\(\("([^"]+)",pid=(\d+)/,
        );
        if (!isNaN(port)) {
          listeningPorts.push({
            protocol: parts[0],
            localAddress: addr,
            localPort: port,
            processName: processMatch ? processMatch[1] : "",
            pid: processMatch ? parseInt(processMatch[2], 10) : 0,
            state: "LISTEN",
          });
        }
      }
    }
  } else if (tool === "netstat") {
    for (const line of portLines) {
      if (line.startsWith("port_tool:") || !line.trim()) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 4 && /^(tcp|udp)/.test(parts[0])) {
        const localParts = parts[3].split(":");
        const port = parseInt(localParts[localParts.length - 1], 10);
        const addr = localParts.slice(0, -1).join(":") || "0.0.0.0";
        if (!isNaN(port)) {
          listeningPorts.push({
            protocol: parts[0],
            localAddress: addr,
            localPort: port,
            processName: parts.length >= 7 ? parts[6].split("/")[1] || "" : "",
            pid: parts.length >= 7 ? parseInt(parts[6].split("/")[0], 10) || 0 : 0,
            state: parts.length >= 6 ? parts[5] : "LISTEN",
          });
        }
      }
    }
  }

  // Parse counts
  if (countsIdx >= 0) {
    const countLines = section.slice(countsIdx).split("\n");
    for (const cl of countLines) {
      if (cl.startsWith("established:")) established = parseInt(cl.split(":")[1], 10) || 0;
      if (cl.startsWith("time_wait:")) timeWait = parseInt(cl.split(":")[1], 10) || 0;
    }
  }

  return {
    listeningPorts,
    establishedConnections: established,
    timeWaitConnections: timeWait,
  };
}

// ─── Main parser ────────────────────────────────────────────────────────────

export function parseServerStatsOutput(
  raw: string,
  sessionId: string,
  connectionName: string,
  startTime: number,
): ServerStatsSnapshot {
  const warnings: string[] = [];
  const w = (msg: string) => warnings.push(msg);

  const cpuSection = extractSection(raw, "===CPU_BEGIN===", "===CPU_END===");
  const memSection = extractSection(raw, "===MEM_BEGIN===", "===MEM_END===");
  const diskSection = extractSection(raw, "===DISK_BEGIN===", "===DISK_END===");
  const sysSection = extractSection(raw, "===SYS_BEGIN===", "===SYS_END===");
  const fwSection = extractSection(raw, "===FW_BEGIN===", "===FW_END===");
  const portSection = extractSection(raw, "===PORTS_BEGIN===", "===PORTS_END===");

  let cpu: CpuStats = { usagePercent: 0, coreCount: 0, loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, model: "unknown" };
  let memory: MemoryStats = { totalBytes: 0, usedBytes: 0, freeBytes: 0, availableBytes: 0, usagePercent: 0, swapTotalBytes: 0, swapUsedBytes: 0, swapUsagePercent: 0 };
  let disk: DiskStats = { partitions: [], io: null };
  let system: SystemInfo = { uptime: "unknown", uptimeSeconds: 0, kernelVersion: "unknown", osName: "unknown", osVersion: "unknown", hostname: "unknown", architecture: "unknown", serverTime: new Date().toISOString(), loggedInUsers: 0 };
  let firewall: FirewallConfig = { backend: "none", active: false, rules: [], rawOutput: "" };
  let ports: PortMonitorStats = { listeningPorts: [], establishedConnections: 0, timeWaitConnections: 0 };

  try { if (cpuSection) cpu = parseCpu(cpuSection); else w("CPU data unavailable"); } catch { w("Failed to parse CPU data"); }
  try { if (memSection) memory = parseMemory(memSection); else w("Memory data unavailable"); } catch { w("Failed to parse memory data"); }
  try { if (diskSection) disk = parseDisk(diskSection); else w("Disk data unavailable"); } catch { w("Failed to parse disk data"); }
  try { if (sysSection) system = parseSystem(sysSection); else w("System data unavailable"); } catch { w("Failed to parse system data"); }
  try { if (fwSection) firewall = parseFirewall(fwSection); else w("Firewall data unavailable"); } catch { w("Failed to parse firewall data"); }
  try { if (portSection) ports = parsePorts(portSection); else w("Port data unavailable"); } catch { w("Failed to parse port data"); }

  return {
    collectedAt: new Date().toISOString(),
    sessionId,
    connectionName,
    cpu,
    memory,
    disk,
    system,
    firewall,
    ports,
    collectionDurationMs: Date.now() - startTime,
    warnings,
  };
}
