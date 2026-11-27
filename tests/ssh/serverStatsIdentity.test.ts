import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseServerStatsIdentity } from "../../src/utils/ssh/serverStatsIdentity";
import { parseServerStatsOutput } from "../../src/utils/ssh/serverStatsParser";
import { buildStatsCollectionScript } from "../../src/utils/ssh/serverStatsCommands";
import { ServerStatsHistoryStore } from "../../src/utils/ssh/serverStatsHistory";
import { buildRows, filterRows } from "../../src/utils/ssh/serverStatsTable";

const machine = "ab".repeat(16);
const boot = "12345678-1234-1234-1234-123456789abc";
const section = (bootId = boot, ns = "uts:[42],pid:[43]") =>
  `kind:linux\nmachine:${machine}\nboot:${bootId}\nnamespace:${ns}`;
const snapshot = (bootId = boot, ns = "uts:[42],pid:[43]") =>
  parseServerStatsOutput(
    `===IDENTITY_BEGIN===\n${section(bootId, ns)}\n===IDENTITY_END===`,
    "source",
    "alias",
    Date.now(),
  );
const sessions = [
  {
    id: "a",
    connectionId: "c1",
    name: "Private alias",
    hostname: "192.0.2.10",
    status: "connected",
  },
  {
    id: "b",
    connectionId: "c2",
    name: "Public alias",
    hostname: "server.example",
    status: "connected",
  },
];
describe("observed server identity", () => {
  const shell =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/bash";
  it.skipIf(!existsSync(shell))(
    "parses identity produced by the actual shell collector on Linux and BSD",
    () => {
      for (const os of ["Linux", "FreeBSD"]) {
        const prelude = `
uname() { echo ${os}; }
cat() { case "$1" in /etc/machine-id) echo ${machine};; /proc/sys/kernel/random/boot_id) echo ${boot};; *) return 1;; esac; }
readlink() { case "$1" in /proc/self/ns/uts) echo 'uts:[42]';; /proc/self/ns/pid) echo 'pid:[43]';; *) return 1;; esac; }
sysctl() { case "$2" in kern.hostuuid) echo ${boot};; kern.boottime) echo '{ sec = 1234567890, usec = 123 }';; *) return 1;; esac; }
`;
        const script = buildStatsCollectionScript({
          cpu: false,
          memory: false,
          disk: false,
          system: false,
          firewall: false,
          ports: false,
        });
        const output = execFileSync(
          shell,
          ["--noprofile", "--norc", "-c", prelude + script],
          { encoding: "utf8", windowsHide: true, timeout: 10000 },
        );
        const parsed = parseServerStatsOutput(
          output,
          "session",
          "name",
          Date.now(),
        );
        expect(parsed.serverIdentity).toBe(
          os === "Linux"
            ? `linux:${machine}:${boot}:uts:[42],pid:[43]`
            : `bsd:${boot}:1234567890`,
        );
      }
    },
  );
  it("collects identity even when all optional stats sections are disabled", () => {
    const script = buildStatsCollectionScript({
      cpu: false,
      memory: false,
      disk: false,
      system: false,
      firewall: false,
      ports: false,
    });
    expect(script).toContain("===IDENTITY_BEGIN===");
    expect(script).toContain("/proc/sys/kernel/random/boot_id");
    expect(script).toContain("/proc/self/ns/uts");
  });
  it("rejects incomplete, placeholder and malformed identity instead of guessing", () => {
    expect(parseServerStatsIdentity(section())).toBeTruthy();
    for (const bad of [
      "",
      "hostname:server",
      section().replace(machine, "0".repeat(32)),
      section().replace(boot, "bad"),
      section().replace("uts:[42],pid:[43]", "unavailable"),
    ])
      expect(parseServerStatsIdentity(bad)).toBeNull();
  });
  it("groups aliases only after observing the same machine, boot and namespace", () => {
    const store = new ServerStatsHistoryStore(3);
    const first = snapshot();
    first.cpu.usagePercent = 20;
    const second = snapshot();
    second.cpu.usagePercent = 40;
    store.record("a", first, 1000);
    store.record("b", second, 2000);
    store.flush();
    const rows = buildRows(sessions, [], store.getSnapshot(), 2000);
    expect(rows).toHaveLength(1);
    expect(rows[0].aliases?.map((alias) => alias.sessionId)).toEqual([
      "a",
      "b",
    ]);
    expect(rows[0].entry?.latest.cpu).toBe(40); // newest sample, never summed
    expect(filterRows(rows, "192.0.2.10")).toHaveLength(1);
  });
  it("keeps different boots, containers and unidentified equal hostnames separate", () => {
    for (const other of [
      snapshot("87654321-1234-1234-1234-123456789abc"),
      snapshot(boot, "uts:[99],pid:[43]"),
      { ...snapshot(), serverIdentity: undefined },
    ]) {
      const store = new ServerStatsHistoryStore(3);
      store.record("a", snapshot(), 1000);
      store.record("b", other, 2000);
      store.flush();
      expect(
        buildRows(
          sessions.map((s) => ({ ...s, hostname: "same-name" })),
          [],
          store.getSnapshot(),
          2000,
        ),
      ).toHaveLength(2);
    }
  });
  it("resets history and I/O rate baselines when the observed server changes", () => {
    const store = new ServerStatsHistoryStore(3);
    store.record("a", snapshot(), 1000);
    store.record("a", snapshot(), 2000);
    expect(store.get("a")?.series.cpu).toHaveLength(2);
    store.record("a", snapshot("87654321-1234-1234-1234-123456789abc"), 3000);
    expect(store.get("a")?.series.cpu).toHaveLength(1);
    expect(store.get("a")?.latest.diskRead).toBeNull();
    store.flush();
  });
});
