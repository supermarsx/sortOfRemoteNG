import { describe, it, expect, beforeEach, vi } from "vitest";
import { StrictMode, useEffect } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { useScriptRun } from "../../src/hooks/ssh/useScriptRun";
import type {
  ScriptFinishedEventPayload,
  ScriptOutputEventPayload,
  ScriptRunApi,
} from "../../src/types/ssh/scriptRun";

type Handler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<Handler>>();
  return {
    listeners,
    invoke: vi.fn(
      async (_cmd: string, _args?: Record<string, unknown>) =>
        undefined as unknown,
    ),
    listen: vi.fn(async (name: string, handler: Handler) => {
      const set = listeners.get(name) ?? new Set<Handler>();
      set.add(handler);
      listeners.set(name, set);
      return () => {
        set.delete(handler);
      };
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) =>
    (mocks.invoke as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) =>
    (mocks.listen as (...a: unknown[]) => unknown)(...args),
  emit: vi.fn(async () => undefined),
}));

function listenerCount(): number {
  let n = 0;
  for (const set of mocks.listeners.values()) n += set.size;
  return n;
}

function emit(name: string, payload: unknown): void {
  for (const handler of Array.from(mocks.listeners.get(name) ?? [])) {
    handler({ payload });
  }
}

function output(
  executionId: string,
  sequence: number,
  data: string,
  stream: "stdout" | "stderr" = "stdout",
): void {
  const payload: ScriptOutputEventPayload = {
    execution_id: executionId,
    session_id: "sess-1",
    stream,
    data,
    sequence,
  };
  emit("ssh-script-output", payload);
}

function finished(
  executionId: string,
  overrides: Partial<ScriptFinishedEventPayload> = {},
): void {
  const payload: ScriptFinishedEventPayload = {
    execution_id: executionId,
    session_id: "sess-1",
    exit_code: 0,
    stdout_bytes: 0,
    stderr_bytes: 0,
    truncated: false,
    duration_ms: 42,
    ...overrides,
  };
  emit("ssh-script-finished", payload);
}

/** Let the rAF/timeout batch flush and React commit. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

async function startRun(result: { current: ScriptRunApi }): Promise<string> {
  let id = "";
  await act(async () => {
    id = await result.current.start("sess-1", "echo hi", "bash");
  });
  return id;
}

beforeEach(() => {
  mocks.listeners.clear();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(
    async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "execute_script_stream") return args?.executionId as string;
      return undefined;
    },
  );
  mocks.listen.mockClear();
});

describe("useScriptRun", () => {
  it("starts via execute_script_stream and subscribes before invoking", async () => {
    const { result } = renderHook(() => useScriptRun());
    expect(result.current.status).toBe("idle");

    const id = await startRun(result);

    expect(id).toMatch(/\S+/);
    expect(mocks.invoke).toHaveBeenCalledWith("execute_script_stream", {
      sessionId: "sess-1",
      script: "echo hi",
      interpreter: "bash",
      executionId: id,
    });
    // both listeners registered before invoke was called
    const listenOrder = mocks.listen.mock.invocationCallOrder;
    const invokeOrder = mocks.invoke.mock.invocationCallOrder[0];
    expect(listenOrder.every((o) => o < invokeOrder)).toBe(true);
    expect(listenerCount()).toBe(2);
    expect(result.current.status).toBe("running");
    expect(result.current.executionId).toBe(id);
  });

  it("appends chunks in sequence order and interleaves stdout/stderr by arrival", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);

    act(() => {
      output(id, 0, "a\n");
      output(id, 1, "warn\n", "stderr");
      output(id, 2, "b\n");
    });
    await nextFrame();

    expect(result.current.chunks.map((c) => c.sequence)).toEqual([0, 1, 2]);
    expect(result.current.chunks.map((c) => c.stream)).toEqual([
      "stdout",
      "stderr",
      "stdout",
    ]);
    expect(result.current.text).toBe("a\nb\n");
    expect(result.current.stderrText).toBe("warn\n");
    expect(result.current.notices).toEqual([]);
  });

  it("batches 200 chunks emitted in one tick into at most 2 renders", async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useScriptRun();
    });
    const id = await startRun(result);
    await nextFrame();
    const before = renders;

    act(() => {
      for (let i = 0; i < 200; i += 1) output(id, i, `line-${i}\n`);
    });
    await nextFrame();

    expect(renders - before).toBeLessThanOrEqual(2);
    expect(result.current.chunks).toHaveLength(200);
    expect(result.current.text.endsWith("line-199\n")).toBe(true);
  });

  it("reports a sequence gap as a notice without reordering", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);

    act(() => {
      output(id, 0, "a");
      output(id, 1, "b");
      output(id, 4, "e");
    });
    await nextFrame();

    expect(result.current.chunks.map((c) => c.sequence)).toEqual([0, 1, 4]);
    expect(result.current.notices).toHaveLength(1);
    expect(result.current.notices[0]).toMatch(/gap/i);
    expect(result.current.notices[0]).toMatch(/2 chunks/);
  });

  it("applies the 4 MiB client cap by trimming the head and flagging truncated", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);

    const mib = "x".repeat(1024 * 1024);
    act(() => {
      for (let i = 0; i < 5; i += 1) output(id, i, mib);
    });
    await nextFrame();

    expect(result.current.truncated).toBe(true);
    expect(result.current.chunks.map((c) => c.sequence)).toEqual([1, 2, 3, 4]);
    expect(result.current.text.length).toBe(4 * 1024 * 1024);
    expect(result.current.notices.some((n) => /trimmed/i.test(n))).toBe(true);
  });

  it("finish sets exit code/duration, flushes pending chunks and unsubscribes", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);

    act(() => {
      output(id, 0, "done\n");
      finished(id, { exit_code: 3, duration_ms: 1234, truncated: true });
    });

    expect(result.current.status).toBe("finished");
    expect(result.current.exitCode).toBe(3);
    expect(result.current.durationMs).toBe(1234);
    expect(result.current.truncated).toBe(true);
    expect(result.current.text).toBe("done\n");
    expect(listenerCount()).toBe(0);

    // late events are ignored
    act(() => {
      output(id, 1, "late\n");
    });
    await nextFrame();
    expect(result.current.text).toBe("done\n");
  });

  it("finish with error sets status failed", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);
    act(() => {
      finished(id, { exit_code: null, error: "channel closed" });
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("channel closed");
    expect(result.current.exitCode).toBeNull();
  });

  it("ignores events for other executions", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);
    act(() => {
      output("someone-else", 0, "nope");
      finished("someone-else");
    });
    await nextFrame();
    expect(result.current.chunks).toEqual([]);
    expect(result.current.status).toBe("running");
    expect(result.current.executionId).toBe(id);
  });

  it("cancel invokes cancel_script_execution and resolves to cancelled on finish", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);

    await act(async () => {
      await result.current.cancel();
    });
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_script_execution", {
      executionId: id,
    });
    expect(result.current.status).toBe("running");

    act(() => {
      finished(id, { exit_code: 130 });
    });
    expect(result.current.status).toBe("cancelled");
    expect(result.current.exitCode).toBe(130);
    expect(listenerCount()).toBe(0);
  });

  it("adopts a backend-assigned execution id for event filtering", async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "execute_script_stream") return "backend-id";
      return undefined;
    });
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);
    expect(id).toBe("backend-id");
    expect(result.current.executionId).toBe("backend-id");
    act(() => {
      output("backend-id", 0, "hi");
      finished("backend-id", { exit_code: 0 });
    });
    expect(result.current.text).toBe("hi");
    expect(result.current.status).toBe("finished");
  });

  it("cancel is a no-op when idle", async () => {
    const { result } = renderHook(() => useScriptRun());
    await act(async () => {
      await result.current.cancel();
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("start rejection sets failed, unsubscribes and rethrows", async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "execute_script_stream") throw new Error("no such session");
      return undefined;
    });
    const { result } = renderHook(() => useScriptRun());
    await act(async () => {
      await expect(
        result.current.start("sess-1", "echo", null),
      ).rejects.toThrow("no such session");
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("no such session");
    expect(listenerCount()).toBe(0);
  });

  it("refuses a second start while running, allows one after finish", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);
    await expect(result.current.start("sess-1", "again", null)).rejects.toThrow(
      /already running/,
    );

    act(() => {
      finished(id);
    });
    const id2 = await startRun(result);
    expect(id2).not.toBe(id);
    expect(result.current.status).toBe("running");
    expect(result.current.chunks).toEqual([]);
    expect(listenerCount()).toBe(2);
  });

  it("reset returns to idle and unsubscribes", async () => {
    const { result } = renderHook(() => useScriptRun());
    const id = await startRun(result);
    act(() => {
      output(id, 0, "x");
    });
    await nextFrame();
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.chunks).toEqual([]);
    expect(listenerCount()).toBe(0);
  });

  it("StrictMode double-mount leaves exactly one listener pair after start", async () => {
    let api: ScriptRunApi | null = null;
    function Probe(): null {
      const run = useScriptRun();
      api = run;
      useEffect(() => {
        run.start("sess-1", "echo", "bash").catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await nextFrame();

    // StrictMode runs the effect twice; the first start is torn down on the
    // simulated unmount, the surviving one holds exactly one output + one finished listener.
    expect(listenerCount()).toBe(2);
    // the torn-down first attempt never reached the backend
    expect(
      mocks.invoke.mock.calls.filter(
        ([cmd]) => cmd === "execute_script_stream",
      ),
    ).toHaveLength(1);
    expect(api).not.toBeNull();
    const current = api as unknown as ScriptRunApi;
    expect(current.status).toBe("running");
  });

  it("unmount mid-run unsubscribes and ignores late events", async () => {
    const { result, unmount } = renderHook(() => useScriptRun());
    const id = await startRun(result);
    expect(listenerCount()).toBe(2);

    unmount();
    expect(listenerCount()).toBe(0);

    // Even a handler retained by a stale subscriber would be a no-op.
    expect(() => {
      output(id, 0, "late");
      finished(id);
    }).not.toThrow();
  });

  it("unsubscribes a listen() that resolves after unmount", async () => {
    const releases: Array<() => void> = [];
    mocks.listen.mockImplementation(async (name: string, handler: Handler) => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      const set = mocks.listeners.get(name) ?? new Set<Handler>();
      set.add(handler);
      mocks.listeners.set(name, set);
      return () => {
        set.delete(handler);
      };
    });
    const { result, unmount } = renderHook(() => useScriptRun());
    const pending = result.current.start("sess-1", "echo", null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releases).toHaveLength(2);
    unmount();
    for (const release of releases) release();
    await pending.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listenerCount()).toBe(0);
  });
});
