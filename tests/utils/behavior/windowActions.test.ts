import { describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../../src/types/connection/connection";
import {
  BehaviorWindowActionRuntime,
  type BehaviorWindowHandle,
} from "../../../src/utils/behavior/windowActions";

const session = (detached = false): ConnectionSession => ({
  id: detached ? "detached-session" : "main-session",
  connectionId: "connection-1",
  name: "Shell",
  status: "connected",
  startTime: new Date(0),
  protocol: "ssh",
  hostname: "host.test",
  layout: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex: 1,
    isDetached: detached,
    windowId: detached ? "detached-1" : undefined,
  },
});

const harness = (minimized = false) => {
  const handle: BehaviorWindowHandle = {
    isMinimized: vi.fn().mockResolvedValue(minimized),
    minimize: vi.fn().mockResolvedValue(undefined),
    unminimize: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  };
  const getWindow = vi.fn().mockResolvedValue(handle);
  const activateSession = vi.fn().mockResolvedValue(true);
  const closeSession = vi.fn().mockResolvedValue(true);
  return {
    handle,
    getWindow,
    activateSession,
    closeSession,
    runtime: new BehaviorWindowActionRuntime({
      getWindow,
      activateSession,
      closeSession,
    }),
  };
};

describe("BehaviorWindowActionRuntime", () => {
  it("activates, restores, and raises the owning main window by default", async () => {
    const value = harness(true);
    await expect(
      value.runtime.focusSession(session(), { type: "focusSession" }),
    ).resolves.toBe(true);
    expect(value.getWindow).toHaveBeenCalledWith("main");
    expect(value.activateSession).toHaveBeenCalledWith("main", "main-session");
    expect(value.handle.unminimize).toHaveBeenCalledOnce();
    expect(value.handle.setFocus).toHaveBeenCalledOnce();
  });

  it("targets the detached owner and honors focus options", async () => {
    const value = harness(true);
    await expect(
      value.runtime.focusSession(session(true), {
        type: "focusSession",
        restoreIfMinimized: false,
        raiseWindow: false,
      }),
    ).resolves.toBe(true);
    expect(value.getWindow).toHaveBeenCalledWith("detached-1");
    expect(value.activateSession).toHaveBeenCalledWith(
      "detached-1",
      "detached-session",
    );
    expect(value.handle.unminimize).not.toHaveBeenCalled();
    expect(value.handle.setFocus).not.toHaveBeenCalled();
  });

  it("executes every owning-window state without pretending a missing window worked", async () => {
    const value = harness(true);
    await expect(
      value.runtime.setOwningWindowState(session(), {
        type: "setOwningWindowState",
        state: "minimized",
      }),
    ).resolves.toBe(true);
    await expect(
      value.runtime.setOwningWindowState(session(), {
        type: "setOwningWindowState",
        state: "restored",
      }),
    ).resolves.toBe(true);
    await expect(
      value.runtime.setOwningWindowState(session(), {
        type: "setOwningWindowState",
        state: "focused",
      }),
    ).resolves.toBe(true);
    expect(value.handle.minimize).toHaveBeenCalledOnce();
    expect(value.handle.unminimize).toHaveBeenCalledOnce();
    expect(value.handle.setFocus).toHaveBeenCalledOnce();

    value.getWindow.mockResolvedValueOnce(undefined);
    await expect(
      value.runtime.setOwningWindowState(session(), {
        type: "setOwningWindowState",
        state: "focused",
      }),
    ).resolves.toBe(false);
  });

  it("guards recursive close actions and releases the guard afterward", async () => {
    let resolveClose!: (accepted: boolean) => void;
    const value = harness();
    value.closeSession.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (resolveClose = resolve)),
    );

    const first = value.runtime.closeTab(session());
    await expect(value.runtime.closeTab(session())).resolves.toBe(false);
    resolveClose(true);
    await expect(first).resolves.toBe(true);
    await expect(value.runtime.closeTab(session())).resolves.toBe(true);
    expect(value.closeSession).toHaveBeenCalledTimes(2);
  });
});
