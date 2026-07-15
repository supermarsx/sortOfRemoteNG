import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
}));

import { usePowerShellClient } from "./usePowerShellClient";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("usePowerShellClient contracts", () => {
  it("exposes the fail-closed backend capabilities", () => {
    const { result } = renderHook(() => usePowerShellClient());

    expect(result.current.capabilities.implementation).toBe(
      "legacyWinRsProcessShell",
    );
    expect(result.current.capabilities.transports).toContainEqual(
      expect.objectContaining({ transport: "ssh", status: "unsupported" }),
    );
  });

  it("sends the Rust invoke-command shape without invented script fields", async () => {
    const { result } = renderHook(() => usePowerShellClient());
    const params = {
      scriptBlock: "Get-Service",
      argumentList: ["WinRM"],
      timeoutSec: 15,
    };

    await act(async () => {
      await result.current.invokeCommand("session-1", params);
    });

    expect(invokeMock).toHaveBeenCalledWith("ps_invoke_command", {
      sessionId: "session-1",
      params,
    });
    expect(params).not.toHaveProperty("script");
    expect(params).not.toHaveProperty("scriptPath");
  });

  it("uses invocation terminology while preserving the registered wire argument", async () => {
    const { result } = renderHook(() => usePowerShellClient());

    await act(async () => {
      await result.current.stopCommand("session-1", "invoke-7");
    });

    expect(invokeMock).toHaveBeenCalledWith("ps_stop_command", {
      sessionId: "session-1",
      commandId: "invoke-7",
    });
  });
});
