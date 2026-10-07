import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { VncFailureDiagnostics } from "../../src/components/protocol/VncFailureDiagnostics";
import { useVncDiagnostics } from "../../src/hooks/protocol/useVncDiagnostics";
import {
  classifyVncFailure,
  validVncDiagnosticTarget,
  vncDiagnosticTarget,
  vncDiagnosticsText,
} from "../../src/hooks/protocol/vncDiagnostics";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { VncDiagnosticReport } from "../../src/types/protocols/vncDiagnostics";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const connection: Connection = {
  id: "vnc-test",
  name: "Secret connection name",
  hostname: "10.1.192.10",
  protocol: "vnc",
  port: 5901,
  password: "secret-password",
  username: "secret-user",
  isGroup: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const session: ConnectionSession = {
  id: "session",
  connectionId: connection.id,
  name: connection.name,
  hostname: connection.hostname,
  protocol: "vnc",
  status: "error",
  startTime: new Date(),
};
const report: VncDiagnosticReport = {
  code: "refused",
  steps: [
    { stage: "dns", status: "passed", code: "ready", durationMs: 1 },
    { stage: "tcp", status: "failed", code: "refused", durationMs: 2 },
    { stage: "rfb", status: "skipped", code: "refused", durationMs: 0 },
  ],
  durationMs: 3,
  resolvedAddresses: [connection.hostname],
  protocolVersion: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(report);
});

describe("VNC failure diagnostics", () => {
  it.each([
    "user:password",
    "user:password@host",
    "[oops]",
    "vnc://host",
    "host/path",
    "host\n",
    "",
  ])("rejects invalid target %j without IPC", async (host) => {
    const request = { host, port: 5900, route: "direct" as const };
    const { result } = renderHook(() => useVncDiagnostics(request));
    await act(() => result.current.run());
    expect(result.current.report?.code).toBe("invalidTarget");
    expect(invoke).not.toHaveBeenCalled();
    expect(vncDiagnosticsText(request, "Direct", "unknown", null)).toContain(
      "[invalid target omitted]",
    );
  });

  it.each(["::1", "[::1]", "2001:db8::1", "host.example."])(
    "accepts IP literals and absolute DNS names: %s",
    (host) => {
      expect(
        validVncDiagnosticTarget({ host, port: 5900, route: "direct" }),
      ).toBe(true);
    },
  );

  it.each([
    ["actively refused (os error 10061)", "refused"],
    ["Connection timed out (os error 10060)", "timeout"],
    ["No such host (os error 11001)", "dns"],
    ["No route to host", "unreachable"],
    ["Authentication failed", "authentication"],
    ["Unencrypted transport not allowed", "security"],
    ["Invalid RFB version", "protocol"],
  ])("classifies %s", (message, expected) =>
    expect(classifyVncFailure(message)).toBe(expected),
  );

  it("does not probe on render; shows port and refusal guidance, then explicitly probes without credentials", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(
      <VncFailureDiagnostics
        connection={connection}
        session={session}
        error="actively refused (os error 10061)"
        retry={retry}
      />,
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText("10.1.192.10:5901")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "before VNC authentication",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run VNC diagnostics" }),
    );
    await waitFor(() =>
      expect(screen.getByText("TCP: failed (2 ms)")).toBeInTheDocument(),
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("diagnose_vnc", {
      request: { host: "10.1.192.10", port: 5901, route: "direct" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry native VNC" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    { proxyProfileId: "profile" },
    { proxyProfileId: "" },
    { proxyChainId: "chain" },
    { tunnelProfileId: "profile" },
    { tunnelChainId: "chain" },
    { connectionChainId: "chain" },
    { security: { proxy: { enabled: true } } },
    { security: { sshTunnel: { enabled: true } } },
    { security: { openvpn: { enabled: true } } },
    { security: { tunnelChain: [{ enabled: true }] } },
  ])("fails closed for configured route %j", async (route) => {
    const routed = { ...connection, ...route } as Connection;
    const target = vncDiagnosticTarget(routed, session);
    expect(target.request.route).toBe("blocked");
    const { result } = renderHook(() => useVncDiagnostics(target.request));
    await act(() => result.current.run());
    expect(result.current.report?.code).toBe("routeBlocked");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("blocks unknown connection and session route provenance", () => {
    expect(vncDiagnosticTarget(undefined, session).request.route).toBe(
      "blocked",
    );
    expect(
      vncDiagnosticTarget(connection, {
        ...session,
        networkPath: { version: 1, transports: ["ssh"], connectionIds: [] },
      }).request.route,
    ).toBe("blocked");
  });

  it("disables probes and retry for an unsupported tunnel", () => {
    render(
      <VncFailureDiagnostics
        connection={{ ...connection, tunnelProfileId: "secret-profile" }}
        session={session}
        error="refused"
        retry={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Run VNC diagnostics" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Retry native VNC" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/No diagnostic DNS or TCP request was sent/),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("copies only safe facts, omitting raw errors and credentials", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <VncFailureDiagnostics
        connection={connection}
        session={session}
        error="refused password=secret-password https://secret-user:secret-password@host/?token=private"
        retry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const text = writeText.mock.calls[0][0];
    expect(text).toContain("10.1.192.10:5901");
    for (const secret of [
      "secret-password",
      "secret-user",
      "Secret connection name",
      "private",
    ])
      expect(text).not.toContain(secret);
    expect(
      vncDiagnosticsText(
        { host: "user:password@host", port: 5900, route: "direct" },
        "Direct",
        "unknown",
        null,
      ),
    ).not.toContain("password@");
  });

  it("sanitizes missing-command failures and allows retry", async () => {
    vi.mocked(invoke).mockRejectedValue(
      "unknown command diagnose_vnc secret-password",
    );
    const { result } = renderHook(() =>
      useVncDiagnostics({ host: "localhost", port: 5900, route: "direct" }),
    );
    await act(() => result.current.run());
    expect(result.current.report?.code).toBe("unavailable");
    expect(result.current.running).toBe(false);
    vi.mocked(invoke).mockResolvedValue(report);
    await act(() => result.current.run());
    expect(result.current.report?.code).toBe("refused");
  });

  it("deduplicates clicks and discards results after the target changes", async () => {
    let resolve!: (value: VncDiagnosticReport) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, rerender } = renderHook(
      ({ host }) => useVncDiagnostics({ host, port: 5900, route: "direct" }),
      { initialProps: { host: "first.example" } },
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run();
      void result.current.run();
    });
    expect(invoke).toHaveBeenCalledOnce();
    rerender({ host: "second.example" });
    await act(async () => {
      resolve(report);
      await pending;
    });
    expect(result.current.report).toBeNull();
    expect(result.current.running).toBe(false);
  });
});
