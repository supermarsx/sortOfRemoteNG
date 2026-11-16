/**
 * Static real-time bypass guard. Files on the real-time path must not import
 * any cache/coalescing/scheduling code. The ONLY allowed perf import is
 * utils/perf/realtimeChannel (which itself depends only on metrics).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");

const REALTIME_FILES = [
  "src/hooks/protocol/useSerialSession.ts",
  "src/hooks/protocol/useTelnetSession.ts",
  "src/services/session/sshEventRouter.ts",
  "src/components/ssh/WebTerminal.tsx",
  "src/components/rdp/RDPClient.tsx",
  "src/hooks/rdp/useRDPClient.ts",
  "src/hooks/rdp/useRdpFrameBackpressure.ts",
  "src/components/proxmox/ProxmoxVncConsole.tsx",
  "src/components/rdp/RDPCertTrustPrompt.tsx",
];

const FORBIDDEN = [
  /utils\/perf\/(?!realtimeChannel)/,
  /hooks\/perf\//,
  /["']\.\/(queryStore|cachedInvoke|coalescer|preloadScheduler|laneRegistry|safety|visibility|eventBus|reconcile)["']/,
  /runtime\/batchedLogBuffer/,
  /useBatchedLogStream/,
  /\b(cachedInvoke|queryStore|createFrameCoalescer|createIntervalCoalescer|createLastWriteWins|createCountingCoalescer|schedulePreload|useCoalescedEvent|useQuery|useVisibleInterval)\b/,
];

const read = (rel: string) =>
  readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("real-time bypass guard", () => {
  for (const rel of REALTIME_FILES) {
    it(`${rel} imports no cache/coalescing code`, () => {
      if (!existsSync(resolve(ROOT, rel))) return; // renamed/removed: nothing to guard
      const src = read(rel);
      for (const re of FORBIDDEN) {
        const m = re.exec(src);
        expect(m?.[0], `${rel} matched ${re}`).toBeUndefined();
      }
    });
  }

  it("realtimeChannel.ts depends only on metrics", () => {
    const src = read("src/utils/perf/realtimeChannel.ts");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["./metrics"]);
  });

  it("metrics.ts depends only on metricsTypes", () => {
    const src = read("src/utils/perf/metrics.ts");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["./metricsTypes"]);
  });

  it("perf modules never touch persistent storage", () => {
    for (const rel of [
      "src/utils/perf/queryStore.ts",
      "src/utils/perf/cachedInvoke.ts",
      "src/utils/perf/safety.ts",
      "src/utils/perf/preloadScheduler.ts",
      "src/utils/perf/coalescer.ts",
      "src/utils/perf/eventBus.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(
        /localStorage|sessionStorage|indexedDB|writeFile|writeTextFile/,
      );
    }
  });

  it("the preload scheduler never reaches an unlock/prompt path", () => {
    for (const rel of [
      "src/utils/perf/preloadScheduler.ts",
      "src/utils/perf/queryStore.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(
        /unlockDatabase|unlock_|promptPassword|requestUnlock|encryption_unlock|verifyPassword/,
      );
      expect(src, rel).not.toMatch(
        /from\s+["'][^"']*(tauri\/invoke|@tauri-apps\/api\/core)["']/,
      );
    }
  });
});
