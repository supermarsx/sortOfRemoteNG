import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNetworkToolkit } from "../../src/hooks/network/useNetworkToolkit";
import type {
  ToolkitReport,
  ToolkitRequest,
} from "../../src/types/network/networkToolkit";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/core", () => mocks);
const request: Omit<ToolkitRequest, "jobId"> = {
  tool: "ping",
  target: "localhost",
  route: "direct",
  timeoutMs: 5000,
  options: {},
};
const report = (jobId = "job"): ToolkitReport => ({
  jobId,
  tool: "ping",
  startedAt: "2026-10-07T12:00:00Z",
  durationMs: 1,
  route: "direct",
  data: { replies: 1 },
});

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.isTauri.mockReturnValue(true);
});
describe("Network Toolkit lifecycle", () => {
  it("makes no request on mount and does not fabricate web-only results", async () => {
    mocks.isTauri.mockReturnValue(false);
    const { result } = renderHook(useNetworkToolkit);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(() => result.current.run(request));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(result.current.error).toContain("desktop app");
  });
  it("runs one job at a time and preserves errors", async () => {
    let reject!: (error: unknown) => void;
    mocks.invoke.mockImplementation(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const { result } = renderHook(useNetworkToolkit);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run(request);
    });
    await act(() => result.current.run(request));
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(true);
    await act(async () => {
      reject("Tool not installed");
      await pending;
    });
    expect(result.current.error).toBe("Tool not installed");
    expect(result.current.report).toBeNull();
    expect(result.current.running).toBe(false);
  });
  it("cancels natively and ignores stale completion after another run starts", async () => {
    const resolves: Array<(r: ToolkitReport) => void> = [];
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === "network_toolkit_cancel"
        ? Promise.resolve(true)
        : new Promise((r) => resolves.push(r)),
    );
    const { result } = renderHook(useNetworkToolkit);
    let old!: Promise<void>, next!: Promise<void>;
    act(() => {
      old = result.current.run(request);
    });
    const job = mocks.invoke.mock.calls[0][1].request.jobId;
    await act(() => result.current.cancel());
    expect(mocks.invoke).toHaveBeenCalledWith("network_toolkit_cancel", {
      jobId: job,
    });
    act(() => {
      next = result.current.run(request);
    });
    await act(async () => {
      resolves[0](report("old"));
      await old;
    });
    expect(result.current.report).toBeNull();
    expect(result.current.running).toBe(true);
    await act(async () => {
      resolves[1](report("new"));
      await next;
    });
    expect(result.current.report?.jobId).toBe("new");
  });
  it("retains ownership until cancellation is acknowledged and permits retry after rejection", async () => {
    let finish!: (value: ToolkitReport) => void;
    let rejectCancel!: (reason: unknown) => void;
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === "network_toolkit_cancel"
        ? new Promise((_, reject) => {
            rejectCancel = reject;
          })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const { result } = renderHook(useNetworkToolkit);
    let run!: Promise<void>, stop!: Promise<void>;
    act(() => {
      run = result.current.run(request);
    });
    const jobId = mocks.invoke.mock.calls[0][1].request.jobId;
    act(() => {
      stop = result.current.cancel();
    });
    expect(result.current.running).toBe(true);
    expect(result.current.error).toContain("requested");
    act(() => {
      expect(result.current.cancel()).toBe(stop);
    });
    await act(() => result.current.run(request));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await act(async () => {
      rejectCancel("IPC unavailable: private details");
      await stop;
    });
    expect(result.current.running).toBe(true);
    expect(result.current.error).toContain("try Cancel again");
    expect(result.current.error).not.toContain("private details");
    mocks.invoke.mockResolvedValueOnce(false); // Native pre-registration cancellation is acknowledged too.
    await act(() => result.current.cancel());
    expect(mocks.invoke).toHaveBeenLastCalledWith("network_toolkit_cancel", {
      jobId,
    });
    expect(result.current.running).toBe(false);
    await act(async () => {
      finish(report(jobId));
      await run;
    });
    expect(result.current.report).toBeNull();
  });
  it("allows cancellation retry after a synchronous invoke failure", async () => {
    let finish!: (value: ToolkitReport) => void;
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "network_toolkit_cancel") throw new Error("IPC unavailable");
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const { result } = renderHook(useNetworkToolkit);
    let run!: Promise<void>;
    act(() => {
      run = result.current.run(request);
    });
    await act(() => result.current.cancel());
    expect(result.current.running).toBe(true);
    mocks.invoke.mockResolvedValueOnce(true);
    await act(() => result.current.cancel());
    expect(result.current.running).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    await act(async () => {
      finish(report());
      await run;
    });
  });
  it("does not let a late cancellation acknowledgement clear a replacement job", async () => {
    const finishes: Array<(value: ToolkitReport) => void> = [];
    let acknowledge!: (accepted: boolean) => void;
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === "network_toolkit_cancel"
        ? new Promise((resolve) => {
            acknowledge = resolve;
          })
        : new Promise((resolve) => {
            finishes.push(resolve);
          }),
    );
    const { result } = renderHook(useNetworkToolkit);
    let old!: Promise<void>, next!: Promise<void>, stop!: Promise<void>;
    act(() => {
      old = result.current.run(request);
    });
    act(() => {
      stop = result.current.cancel();
    });
    await act(async () => {
      finishes[0](report("old"));
      await old;
    });
    expect(result.current.running).toBe(false);
    act(() => {
      next = result.current.run(request);
    });
    await act(async () => {
      acknowledge(true);
      await stop;
    });
    expect(result.current.running).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => {
      finishes[1](report("new"));
      await next;
    });
    expect(result.current.report?.jobId).toBe("new");
  });
  it("stops the owned job on unmount without cancelling another one", async () => {
    let finish!: (r: ToolkitReport) => void;
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === "network_toolkit_cancel"
        ? Promise.resolve(true)
        : new Promise((r) => {
            finish = r;
          }),
    );
    const { result, unmount } = renderHook(useNetworkToolkit);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run(request);
    });
    const jobId = mocks.invoke.mock.calls[0][1].request.jobId;
    unmount();
    expect(mocks.invoke).toHaveBeenLastCalledWith("network_toolkit_cancel", {
      jobId,
    });
    await act(async () => {
      finish(report());
      await pending;
    });
  });
});
