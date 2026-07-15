import { describe, expect, it } from "vitest";
import type {
  PsCancelInvocationRequest,
  PsCancelOutcome,
  PsCommandOutput,
  PsInvokeCommandParams,
  PsRemotingCapabilities,
  PsSession,
} from "./powershell";
import { CURRENT_POWER_SHELL_REMOTING_CAPABILITIES } from "../utils/powershell/currentPowerShellCapabilities";

const RUST_SESSION_FIXTURE = {
  id: "session-1",
  shellId: "shell-1",
  name: "Production",
  computerName: "server.example.test",
  state: "opened",
  availability: "available",
  configurationName: "microsoft.powershell",
  psVersion: "5.1",
  osVersion: "10.0",
  createdAt: "2026-07-15T00:00:00Z",
  lastActivity: "2026-07-15T00:01:00Z",
  idleSeconds: 0,
  commandCount: 1,
  transport: "https",
  authMethod: "negotiate",
  supportsDisconnect: false,
  reconnectCount: 0,
  runspaceId: null,
  port: 5986,
} as const satisfies PsSession;

const RUST_INVOKE_FIXTURE = {
  sessionId: "session-1",
  scriptBlock: "Get-Process",
  argumentList: [],
  parameters: {},
  asJob: false,
  throttleLimit: 32,
  inputObject: [],
  invokeAndDisconnect: false,
  hideComputerName: false,
  filePath: null,
  commandName: null,
  timeoutSec: 30,
} as const satisfies PsInvokeCommandParams;

const RUST_OUTPUT_FIXTURE = {
  invocationId: "invoke-1",
  sessionId: "session-1",
  command: "Get-Process",
  state: "completed",
  streams: [],
  output: [],
  errors: [],
  hadErrors: false,
  startedAt: "2026-07-15T00:01:00Z",
  completedAt: "2026-07-15T00:01:01Z",
  durationMs: 1000,
  rawClixml: null,
} as const satisfies PsCommandOutput;

describe("sorng-powershell JSON contracts", () => {
  it("keeps the Rust capability matrix exhaustive and stable", () => {
    const capabilities: PsRemotingCapabilities = JSON.parse(
      JSON.stringify(CURRENT_POWER_SHELL_REMOTING_CAPABILITIES),
    );

    expect(capabilities.implementation).toBe("legacyWinRsProcessShell");
    expect(capabilities.transports).toHaveLength(3);
    expect(capabilities.authentication).toHaveLength(8);
    expect(capabilities.features).toHaveLength(8);
    expect(capabilities.transports).toContainEqual(
      expect.objectContaining({ transport: "ssh", status: "unsupported" }),
    );
    expect(capabilities.authentication).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authMethod: "certificate",
          status: "unsupported",
        }),
        expect.objectContaining({
          authMethod: "credSsp",
          status: "unsupported",
        }),
      ]),
    );
  });

  it("uses the exact session, invocation, and output serde field names", () => {
    expect(Object.keys(RUST_SESSION_FIXTURE)).toEqual([
      "id",
      "shellId",
      "name",
      "computerName",
      "state",
      "availability",
      "configurationName",
      "psVersion",
      "osVersion",
      "createdAt",
      "lastActivity",
      "idleSeconds",
      "commandCount",
      "transport",
      "authMethod",
      "supportsDisconnect",
      "reconnectCount",
      "runspaceId",
      "port",
    ]);
    expect(RUST_INVOKE_FIXTURE.scriptBlock).toBe("Get-Process");
    expect(RUST_OUTPUT_FIXTURE).toHaveProperty("invocationId", "invoke-1");
    expect(RUST_OUTPUT_FIXTURE).not.toHaveProperty("commandId");
    expect(RUST_OUTPUT_FIXTURE).not.toHaveProperty("finishedAt");
  });

  it("names cancellation by invocation and models the actor outcome", () => {
    const request = {
      sessionId: "session-1",
      invocationId: "invoke-1",
    } satisfies PsCancelInvocationRequest;
    const outcomes: PsCancelOutcome[] = ["requested", "notRunning"];

    expect(request.invocationId).toBe("invoke-1");
    expect(outcomes).toEqual(["requested", "notRunning"]);
  });
});
