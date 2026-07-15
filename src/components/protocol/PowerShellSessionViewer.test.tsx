import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PowerShellSessionModel } from "../../hooks/protocol/usePowerShellSession";
import type { ConnectionSession } from "../../types/connection/connection";

const { hookMock } = vi.hoisted(() => ({ hookMock: vi.fn() }));

vi.mock("../../hooks/protocol/usePowerShellSession", () => ({
  usePowerShellSession: (...args: unknown[]) => hookMock(...args),
}));

import { PowerShellSessionViewer } from "./PowerShellSessionViewer";

const session: ConnectionSession = {
  id: "frontend-ps-1",
  connectionId: "connection-ps-1",
  name: "PowerShell",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "winrm",
  hostname: "ps.example.test",
};

const createModel = (): PowerShellSessionModel => ({
  status: "ready" as const,
  error: null,
  backendSessionId: "backend-ps-1",
  backend: {
    id: "backend-ps-1",
    connectionId: "connection-ps-1",
    host: "ps.example.test",
    port: 22,
    username: "admin",
    runspaceId: "12345678-1234-1234-1234-123456789012",
    phase: "ready" as const,
    activePipelineId: null,
    inputOpen: false,
    terminalErrorCode: null,
    capabilities: {
      transport: "ssh" as const,
      persistentRunspace: true,
      pipelineInput: true,
      pipelineCancellation: true,
      allStreams: true,
      progressRecords: true,
      boundedReplay: true,
      uiReattach: true,
      transportReconnect: false,
      wsmanAvailable: false,
      maxConcurrentPipelines: 1,
    },
    stats: {
      openedAtMs: 1,
      lastActivityAtMs: 1,
      closedAtMs: null,
      pipelinesStarted: 1,
      pipelinesCompleted: 1,
      pipelinesFailed: 0,
      pipelinesCancelled: 0,
      inputObjectsSent: 0,
      eventsEmitted: 8,
      deliveryFailures: 0,
      replayEvictions: 0,
    },
    diagnostics: {
      transport: "ssh" as const,
      hostKeyVerification: "strict",
      authentication: "established",
      runspaceHealth: "healthy",
      activePipeline: null,
      limitations: [],
    },
  },
  events: [
    {
      sessionId: "backend-ps-1",
      sequence: 1,
      timestampMs: 1,
      pipelineId: "pipeline-1",
      kind: "output" as const,
      text: "hello",
      value: "hello",
    },
    {
      sessionId: "backend-ps-1",
      sequence: 2,
      timestampMs: 2,
      pipelineId: "pipeline-1",
      kind: "warning" as const,
      text: "careful",
    },
    {
      sessionId: "backend-ps-1",
      sequence: 3,
      timestampMs: 3,
      pipelineId: "pipeline-1",
      kind: "progress" as const,
      text: "working",
      progress: { activity: "Install", percentComplete: 42 },
    },
  ],
  replayTruncated: false,
  execute: vi.fn().mockResolvedValue({
    sessionId: "backend-ps-1",
    pipelineId: "pipeline-2",
    inputOpen: false,
  }),
  sendInput: vi.fn().mockResolvedValue(undefined),
  endInput: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  reconnect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn(),
});

beforeEach(() => {
  hookMock.mockReset();
  hookMock.mockReturnValue(createModel());
});

describe("PowerShellSessionViewer", () => {
  it("renders separate streams, progress, real stats, and multiline execution", async () => {
    const model = createModel();
    hookMock.mockReturnValue(model);
    render(<PowerShellSessionViewer session={session} />);

    expect(screen.getByRole("status")).toHaveTextContent("ready");
    expect(screen.getByRole("log")).toHaveTextContent("hello");
    expect(screen.getByRole("log")).toHaveTextContent("careful");
    expect(
      screen.getByRole("progressbar", { name: "Install" }),
    ).toHaveAttribute("aria-valuenow", "42");
    expect(
      screen.getByText(/1 completed · 0 failed · 0 cancelled/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PowerShell script"), {
      target: { value: "$x = 1\n$x" },
    });
    fireEvent.click(screen.getByLabelText("Keep pipeline input open"));
    fireEvent.click(screen.getByRole("button", { name: "Run script" }));

    await waitFor(() =>
      expect(model.execute).toHaveBeenCalledWith("$x = 1\n$x", true),
    );
  });

  it("exposes clear, reconnect, disconnect, and cancellation actions", async () => {
    const model = createModel();
    model.status = "running";
    model.backend!.activePipelineId = "pipeline-live";
    model.backend!.phase = "running";
    hookMock.mockReturnValue(model);
    render(<PowerShellSessionViewer session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "New runspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel pipeline" }));

    expect(model.clear).toHaveBeenCalledOnce();
    await waitFor(() => expect(model.reconnect).toHaveBeenCalledOnce());
    await waitFor(() => expect(model.disconnect).toHaveBeenCalledOnce());
    await waitFor(() => expect(model.cancel).toHaveBeenCalledOnce());
  });
});
