import { Profiler } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationLogTimelineView } from "../../src/components/monitoring/ApplicationLogTimelineView";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

const flag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listen.mockResolvedValue(vi.fn());
});
afterEach(() => {
  flag.IS_REACT_ACT_ENVIRONMENT = true;
  cleanup();
  vi.useRealTimers();
});
const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let n = 0; n < 4; n++) await new Promise((r) => setImmediate(r));
};

describe("live application log view cost", () => {
  it("keeps commits and mounted rows bounded while a large log grows", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    flag.IS_REACT_ACT_ENVIRONMENT = false;
    let tick = 0;
    const text = () =>
      Array.from(
        { length: 2000 },
        (_, i) =>
          `[2026-10-15T12:00:00Z][INFO][sorng_ssh] entry ${tick * 50 + i}`,
      ).join("\n");
    mocks.invoke.mockImplementation(async (command, args) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (command === "application_logs_list")
        return {
          files: [
            {
              id: "latest",
              name: `${args.source}.log`,
              modifiedUnixMs: 1791558000000 + tick,
              sizeBytes: 100 + tick,
              encrypted: false,
            },
          ],
          truncated: false,
        };
      return { text: text(), truncated: false };
    });
    let commits = 0;
    const view = render(
      <Profiler id="logs" onRender={() => commits++}>
        <ApplicationLogTimelineView isActive />
      </Profiler>,
    );
    await settle(50);
    const initial = commits;
    const ticks = 6;
    for (let i = 0; i < ticks; i++) {
      tick++;
      await settle(1500);
      for (let step = 0; step < 6; step++) await settle(5);
    }
    const rows = view.container.querySelectorAll("li").length;
    console.log(
      `PERF commitsPerTick=${(commits - initial) / ticks} mountedRows=${rows}`,
    );
    expect((commits - initial) / ticks).toBeLessThanOrEqual(2);
    expect(rows).toBeLessThanOrEqual(300);
  }, 60000);
});
