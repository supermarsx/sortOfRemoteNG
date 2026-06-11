import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mock Tauri invoke ─────────────────────────────────────────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// ── Mock i18n ─────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
  }),
}));

// ── Mock toast context (avoid pulling the real provider tree) ─────
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

// ── Mock settings context: only `settings.diagnostics` is consumed ─
// pingCount: 0 skips the sequential ping loop (and its timers); only the
// protocol-diagnostics branch is exercised here.
const diagnostics = {
  pingCount: 0,
  pingTimeoutSecs: 5,
  pingIntervalMs: 0,
  tracerouteMaxHops: 30,
  tracerouteTimeoutSecs: 3,
  portCheckTimeoutSecs: 5,
  tcpTimingTimeoutSecs: 10,
  mtuCheckEnabled: false,
  icmpBlockadeEnabled: false,
  serviceFingerprintEnabled: false,
  asymmetricRoutingEnabled: false,
  asymmetricRoutingSamples: 5,
  tlsCheckEnabled: false,
  ipGeoEnabled: false,
  udpProbeEnabled: false,
  udpProbeTimeoutMs: 3000,
  leakageDetectionEnabled: false,
  protocolDiagEnabled: true,
  protocolDiagTimeoutSecs: 15,
  autoRunOnOpen: false,
  showDetailedResults: true,
  expandFailedSteps: true,
};

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { diagnostics } }),
}));

import { invoke } from "@tauri-apps/api/core";
import { useConnectionDiagnostics } from "../../src/hooks/connection/useConnectionDiagnostics";
import type { Connection } from "../../src/types/connection/connection";

// The hook short-circuits unless it detects a Tauri runtime.
beforeEach(() => {
  vi.clearAllMocks();
  (window as any).__TAURI_INTERNALS__ = {};
  // Generic benign response: covers PingResult/PortCheckResult/etc. shapes the
  // hook reads (`.success`, `.resolved_ips`) without us caring about non-RDP
  // probes here. Array-returning commands (traceroute) tolerate the object too
  // since the hook only spreads it into state.
  vi.mocked(invoke).mockResolvedValue({
    success: false,
    resolved_ips: [],
    open: false,
  } as any);
});

const baseRdpConnection: Connection = {
  id: "rdp-1",
  name: "RDP Box",
  protocol: "rdp",
  hostname: "10.0.0.5",
  port: 3389,
  username: "admin",
  password: "s3cret",
  domain: "CORP",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isGroup: false,
};

function rdpInvokeCall() {
  return vi
    .mocked(invoke)
    .mock.calls.find((c) => c[0] === "diagnose_rdp_connection");
}

describe("useConnectionDiagnostics — diagnose_rdp_connection invoke contract", () => {
  it("invokes diagnose_rdp_connection with the `rdpSettings` key (NOT `settings`)", async () => {
    const rdpSettings = {
      security: { enableTls: false, enableNla: false, allowHybridEx: true },
      display: { colorDepth: 16 },
    };
    const connection: Connection = {
      ...baseRdpConnection,
      rdpSettings: rdpSettings as any,
    };

    const { result } = renderHook(() => useConnectionDiagnostics(connection));
    await act(async () => {
      await result.current.runDiagnostics();
    });

    const call = rdpInvokeCall();
    expect(call).toBeDefined();
    const args = call![1] as Record<string, unknown>;

    // The bug: arg was passed under `settings` (dropped by the backend).
    expect(args).not.toHaveProperty("settings");
    // The fix: real config carried under the camelCase `rdpSettings` key.
    expect(args).toHaveProperty("rdpSettings");
    expect(args.rdpSettings).toEqual(rdpSettings);
  });

  it("carries the connection's real security/display config (not defaults)", async () => {
    const rdpSettings = {
      security: { enableNla: false, allowHybridEx: true },
      display: { colorDepth: 24 },
    };
    const connection: Connection = {
      ...baseRdpConnection,
      rdpSettings: rdpSettings as any,
    };

    const { result } = renderHook(() => useConnectionDiagnostics(connection));
    await act(async () => {
      await result.current.runDiagnostics();
    });

    const args = rdpInvokeCall()![1] as any;
    expect(args.rdpSettings.security.enableNla).toBe(false);
    expect(args.rdpSettings.security.allowHybridEx).toBe(true);
    expect(args.rdpSettings.display.colorDepth).toBe(24);
    expect(args.host).toBe("10.0.0.5");
    expect(args.port).toBe(3389);
    expect(args.username).toBe("admin");
    expect(args.domain).toBe("CORP");
  });

  it("sends an explicit empty object (never null) when the connection has no RDP settings", async () => {
    const connection: Connection = { ...baseRdpConnection, rdpSettings: undefined };

    const { result } = renderHook(() => useConnectionDiagnostics(connection));
    await act(async () => {
      await result.current.runDiagnostics();
    });

    const args = rdpInvokeCall()![1] as any;
    expect(args).not.toHaveProperty("settings");
    expect(args).toHaveProperty("rdpSettings");
    expect(args.rdpSettings).toEqual({});
    expect(args.rdpSettings).not.toBeNull();
  });
});
