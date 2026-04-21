import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, f?: string) => f || k,
  }),
}));

// Mock the classifier — keep real classification logic by re-implementing a thin version
vi.mock("../../src/utils/windows/winmgmtErrorClassifier", () => {
  function classifyWinmgmtError(raw: string) {
    const msg = raw.toLowerCase();
    if (msg.includes("session limit")) return "session_limit";
    if (msg.includes("http 401") || msg.includes("authentication failed"))
      return "auth_failure";
    if (msg.includes("access denied") || msg.includes("http 403"))
      return "access_denied";
    if (msg.includes("connection refused")) return "winrm_disabled";
    if (msg.includes("tls") || msg.includes("certificate")) return "tls_cert";
    if (msg.includes("timed out") || msg.includes("timeout")) return "timeout";
    if (msg.includes("dns") || msg.includes("unreachable")) return "network";
    if (msg.includes("invalid namespace")) return "wmi_namespace";
    if (msg.includes("soap fault")) return "soap_fault";
    return "unknown";
  }

  function buildWinmgmtDiagnostics(category: string) {
    return [
      {
        title: `Diagnostic for ${category}`,
        description: "Test description",
        remediation: ["Step 1"],
        severity: "high",
        icon: null,
      },
    ];
  }

  const WINMGMT_ERROR_CATEGORY_LABELS: Record<string, string> = {
    network: "Network / Connectivity",
    winrm_disabled: "WinRM Not Listening",
    auth_failure: "Authentication Failure",
    access_denied: "Access Denied",
    tls_cert: "TLS / Certificate",
    soap_fault: "WS-Management Protocol Error",
    timeout: "Connection Timeout",
    session_limit: "Session Limit",
    wmi_namespace: "WMI Namespace Error",
    unknown: "Connection Error",
  };

  return {
    classifyWinmgmtError,
    buildWinmgmtDiagnostics,
    WINMGMT_ERROR_CATEGORY_LABELS,
  };
});

import { useWinmgmtErrorScreen } from "../../src/hooks/windows/useWinmgmtErrorScreen";

// ── Helpers ────────────────────────────────────────────────────────

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function renderErrorScreen(
  overrides?: Partial<Parameters<typeof useWinmgmtErrorScreen>[0]>,
) {
  const defaults = {
    hostname: "10.0.0.50",
    errorMessage: "HTTP 401 Unauthorized",
    connectionId: "conn-1",
    connectionConfig: { hostname: "10.0.0.50", port: 5985 },
  };
  return renderHook(() =>
    useWinmgmtErrorScreen({ ...defaults, ...overrides }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useWinmgmtErrorScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
    // Stub clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  // ── Classification ──────────────────────────────────────────

  it("classifies HTTP 401 as auth_failure", () => {
    const { result } = renderErrorScreen({
      errorMessage: "HTTP 401 Unauthorized",
    });
    expect(result.current.category).toBe("auth_failure");
  });

  it("classifies access denied as access_denied", () => {
    const { result } = renderErrorScreen({
      errorMessage: "Access Denied to resource",
    });
    expect(result.current.category).toBe("access_denied");
  });

  it("classifies connection refused as winrm_disabled", () => {
    const { result } = renderErrorScreen({
      errorMessage: "Connection refused on port 5985",
    });
    expect(result.current.category).toBe("winrm_disabled");
  });

  it("classifies timed out as timeout", () => {
    const { result } = renderErrorScreen({
      errorMessage: "Request timed out after 30s",
    });
    expect(result.current.category).toBe("timeout");
  });

  it("classifies unknown errors as unknown", () => {
    const { result } = renderErrorScreen({
      errorMessage: "Something totally unexpected",
    });
    expect(result.current.category).toBe("unknown");
  });

  // ── Diagnostics ─────────────────────────────────────────────

  it("provides diagnostics array based on category", () => {
    const { result } = renderErrorScreen({
      errorMessage: "HTTP 401 Unauthorized",
    });
    expect(result.current.diagnostics.length).toBeGreaterThan(0);
    expect(result.current.diagnostics[0].title).toContain("auth_failure");
  });

  // ── handleCopy ──────────────────────────────────────────────

  it("handleCopy writes error info to clipboard", async () => {
    const { result } = renderErrorScreen();

    await act(async () => {
      await result.current.handleCopy();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("10.0.0.50"),
    );
    expect(result.current.copied).toBe(true);
  });

  it("copied resets after timeout", async () => {
    vi.useFakeTimers();
    const { result } = renderErrorScreen();

    await act(async () => {
      await result.current.handleCopy();
    });
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(2500));
    expect(result.current.copied).toBe(false);

    vi.useRealTimers();
  });

  // ── toggleCause ─────────────────────────────────────────────

  it("toggleCause expands/collapses a cause index", () => {
    const { result } = renderErrorScreen();
    // Default is expanded on index 0
    expect(result.current.expandedCause).toBe(0);

    act(() => result.current.toggleCause(0));
    expect(result.current.expandedCause).toBeNull();

    act(() => result.current.toggleCause(1));
    expect(result.current.expandedCause).toBe(1);
  });

  // ── toggleRawError ──────────────────────────────────────────

  it("toggleRawError toggles showRawError", () => {
    const { result } = renderErrorScreen();
    expect(result.current.showRawError).toBe(false);

    act(() => result.current.toggleRawError());
    expect(result.current.showRawError).toBe(true);

    act(() => result.current.toggleRawError());
    expect(result.current.showRawError).toBe(false);
  });

  // ── runDeepDiagnostics ──────────────────────────────────────

  it("runDeepDiagnostics invokes backend and sets report", async () => {
    const mockReport = {
      host: "10.0.0.50",
      port: 5985,
      protocol: "HTTP",
      resolvedIp: "10.0.0.50",
      steps: [
        {
          name: "DNS",
          status: "pass",
          message: "Resolved",
          durationMs: 5,
          detail: null,
        },
        {
          name: "Port",
          status: "fail",
          message: "Refused",
          durationMs: 10,
          detail: "Connection refused",
        },
      ],
      summary: "Port check failed",
      rootCauseHint: "WinRM not running",
      totalDurationMs: 15,
    };
    mockInvoke.mockResolvedValueOnce(mockReport);
    const { result } = renderErrorScreen();

    await act(async () => {
      await result.current.runDeepDiagnostics();
    });

    expect(result.current.diagnosticReport).toEqual(mockReport);
    expect(result.current.isRunningDiagnostics).toBe(false);
    expect(result.current.diagnosticError).toBeNull();
    // Should auto-expand the first failing step (index 1)
    expect(result.current.expandedStep).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith("diagnose_winrm_connection", {
      config: { hostname: "10.0.0.50", port: 5985 },
    });
  });

  it("runDeepDiagnostics sets diagnosticError on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("backend crash"));
    const { result } = renderErrorScreen();

    await act(async () => {
      await result.current.runDeepDiagnostics();
    });

    expect(result.current.diagnosticReport).toBeNull();
    expect(result.current.diagnosticError).toBe("backend crash");
    expect(result.current.isRunningDiagnostics).toBe(false);
  });

  it("runDeepDiagnostics is a no-op without connectionConfig", async () => {
    const { result } = renderErrorScreen({
      connectionConfig: undefined,
    });

    await act(async () => {
      await result.current.runDeepDiagnostics();
    });

    expect(mockInvoke).not.toHaveBeenCalledWith(
      "diagnose_winrm_connection",
      expect.anything(),
    );
    expect(result.current.diagnosticReport).toBeNull();
  });

  // ── toggleStep ──────────────────────────────────────────────

  it("toggleStep expands/collapses diagnostic steps", () => {
    const { result } = renderErrorScreen();
    expect(result.current.expandedStep).toBeNull();

    act(() => result.current.toggleStep(2));
    expect(result.current.expandedStep).toBe(2);

    act(() => result.current.toggleStep(2));
    expect(result.current.expandedStep).toBeNull();
  });
});
