import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { createDefaultPowerShellRemotingSettings } from "../../utils/powershell/normalizePowerShellRemoting";
import type {
  PowerShellBackendSession,
  PowerShellEventEnvelope,
} from "./powerShellSessionRuntime";

const mocks = vi.hoisted(() => {
  const channels: Array<{ emit(message: unknown): void }> = [];
  class MockChannel<T> {
    constructor(private readonly callback: (message: T) => void) {
      channels.push(this as unknown as { emit(message: unknown): void });
    }

    emit(message: T): void {
      this.callback(message);
    }
  }
  return {
    MockChannel,
    channels,
    invoke: vi.fn(),
    dispatch: vi.fn(),
    useConnections: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  Channel: mocks.MockChannel,
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import { usePowerShellSession } from "./usePowerShellSession";

const settings = createDefaultPowerShellRemotingSettings();
settings.transport = "ssh";
settings.credential.username = "admin";
settings.ssh.authMethod = "password";
settings.ssh.hostTrust = { mode: "pinned", fingerprint: "SHA256:test" };

const connection: Connection = {
  id: "connection-ps-1",
  name: "PowerShell",
  protocol: "winrm",
  hostname: "ps.example.test",
  port: 22,
  username: "admin",
  password: "secret",
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  powerShellRemoting: settings,
};

const frontendSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-ps-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "winrm",
  hostname: connection.hostname,
  ...patch,
});

const backendSession = (id = "backend-ps-1"): PowerShellBackendSession => ({
  id,
  connectionId: connection.id,
  host: connection.hostname,
  port: 22,
  username: "admin",
  runspaceId: "runspace-1",
  phase: "ready",
  activePipelineId: null,
  inputOpen: false,
  terminalErrorCode: null,
  capabilities: {
    transport: "ssh",
    supportedTransports: ["ssh", "wsman"],
    persistentRunspace: true,
    pipelineInput: true,
    pipelineCancellation: true,
    allStreams: true,
    progressRecords: true,
    boundedReplay: true,
    uiReattach: true,
    transportReconnect: false,
    wsmanAvailable: true,
    wsmanContractVerified: true,
    wsmanLiveWindowsVerified: false,
    maxConcurrentPipelines: 1,
  },
  stats: {
    openedAtMs: 1,
    lastActivityAtMs: 1,
    closedAtMs: null,
    pipelinesStarted: 0,
    pipelinesCompleted: 0,
    pipelinesFailed: 0,
    pipelinesCancelled: 0,
    inputObjectsSent: 0,
    eventsEmitted: 0,
    deliveryFailures: 0,
    replayEvictions: 0,
  },
  diagnostics: {
    transport: "ssh",
    hostKeyVerification: "strict",
    authentication: "established",
    runspaceHealth: "healthy",
    activePipeline: null,
    contractVerification: "adapter_tests_verified",
    liveInteroperability: "live_target_dependent",
    limitations: [],
  },
});

beforeEach(() => {
  mocks.channels.length = 0;
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "open_powershell_session")
      return Promise.resolve("backend-ps-1");
    if (command === "get_powershell_session")
      return Promise.resolve(backendSession());
    if (command === "start_powershell_pipeline") {
      return Promise.resolve({
        sessionId: "backend-ps-1",
        pipelineId: "pipeline-1",
        inputOpen: true,
      });
    }
    return Promise.resolve(undefined);
  });
});

describe("usePowerShellSession", () => {
  it("opens the strict backend, receives sequenced streams, and controls a pipeline", async () => {
    const { result, unmount } = renderHook(() =>
      usePowerShellSession(frontendSession()),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mocks.invoke).toHaveBeenCalledWith(
      "open_powershell_session",
      expect.objectContaining({
        options: {
          transport: "ssh",
          options: expect.objectContaining({
            host: "ps.example.test",
            auth: { type: "password", password: "secret" },
            hostKeyPolicy: {
              type: "pinned_sha256",
              fingerprint: "SHA256:test",
            },
          }),
        },
        eventChannel: expect.any(mocks.MockChannel),
      }),
    );

    const channel = mocks.channels[0];
    await act(async () => {
      channel.emit({
        replayed: false,
        event: {
          sessionId: "backend-ps-1",
          sequence: 1,
          timestampMs: 1,
          pipelineId: "pipeline-1",
          kind: "warning",
          text: "careful",
        },
      } satisfies PowerShellEventEnvelope);
      channel.emit({
        replayed: true,
        event: {
          sessionId: "backend-ps-1",
          sequence: 1,
          timestampMs: 1,
          pipelineId: "pipeline-1",
          kind: "warning",
          text: "duplicate",
        },
      } satisfies PowerShellEventEnvelope);
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].text).toBe("careful");

    await act(async () => {
      await result.current.execute("$input", true);
      await result.current.sendInput({ type: "string", value: "hello" });
      await result.current.endInput();
      await result.current.cancel();
    });
    expect(mocks.invoke).toHaveBeenCalledWith("start_powershell_pipeline", {
      sessionId: "backend-ps-1",
      script: "$input",
      acceptsInput: true,
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_powershell_pipeline_input",
      {
        sessionId: "backend-ps-1",
        input: { type: "string", value: "hello" },
      },
    );
    expect(mocks.invoke).toHaveBeenCalledWith("end_powershell_pipeline_input", {
      sessionId: "backend-ps-1",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_powershell_pipeline", {
      sessionId: "backend-ps-1",
    });

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).toHaveBeenCalledWith("close_powershell_session", {
      sessionId: "backend-ps-1",
    });
  });

  it("reattaches with bounded replay and preserves the actor for a detached window", async () => {
    mocks.invoke.mockImplementation(
      (command: string, args: Record<string, unknown>) => {
        if (command === "get_powershell_session") {
          return Promise.resolve(backendSession());
        }
        if (command === "attach_powershell_session") {
          const channel = args.eventChannel as { emit(message: unknown): void };
          channel.emit({
            replayed: true,
            event: {
              sessionId: "backend-ps-1",
              sequence: 5,
              timestampMs: 5,
              pipelineId: "pipeline-1",
              kind: "output",
              text: "retained",
            },
          });
          return Promise.resolve({
            sessionId: "backend-ps-1",
            oldestSequence: 5,
            nextSequence: 6,
            truncated: true,
            evictedEvents: 4,
            events: [
              {
                sessionId: "backend-ps-1",
                sequence: 5,
                timestampMs: 5,
                pipelineId: "pipeline-1",
                kind: "output",
                text: "retained",
              },
            ],
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result, unmount } = renderHook(() =>
      usePowerShellSession(
        frontendSession({
          status: "connected",
          backendSessionId: "backend-ps-1",
        }),
      ),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.replayTruncated).toBe(true);

    window.dispatchEvent(
      new CustomEvent("sorng:session-will-detach", {
        detail: { sessionId: "frontend-ps-1" },
      }),
    );
    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).toHaveBeenCalledWith("detach_powershell_session", {
      sessionId: "backend-ps-1",
    });
  });

  it("opens direct WSMan with the union payload and surfaces the runspace-open phase failure", async () => {
    const wsmanSettings = createDefaultPowerShellRemotingSettings();
    wsmanSettings.transport = "wsman";
    wsmanSettings.credential.username = "LAB\\alice";
    wsmanSettings.credential.domain = "LAB";
    wsmanSettings.wsman.authMethod = "ntlm";
    const wsmanConnection: Connection = {
      ...connection,
      port: 5986,
      powerShellRemoting: wsmanSettings,
    };
    mocks.useConnections.mockReturnValue({
      state: { connections: [wsmanConnection], sessions: [] },
      dispatch: mocks.dispatch,
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "open_powershell_session") {
        return Promise.reject(
          new Error("The PowerShell WSMan runspace could not be opened."),
        );
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() =>
      usePowerShellSession(frontendSession()),
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.transport).toBe("wsman");
    expect(result.current.error).toMatch(/WSMan runspace could not be opened/i);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "open_powershell_session",
      expect.objectContaining({
        options: {
          transport: "wsman",
          options: expect.objectContaining({
            endpoint: "https://ps.example.test:5986/wsman",
            authentication: "ntlm",
            tlsTrust: "trust_center",
            networkPath: "direct",
          }),
        },
        eventChannel: expect.any(mocks.MockChannel),
      }),
    );
  });
});
