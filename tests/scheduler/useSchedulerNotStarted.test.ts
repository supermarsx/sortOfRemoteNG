import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useScheduler } from "../../src/hooks/scheduler/useScheduler";

const mockInvoke = vi.mocked(invoke);

// What Tauri 2.11.5 answers when a command's managed state is absent
// (tauri/src/state.rs, `State::from_command`). It is prose: the backend sends
// no code for it, so the hook can only recognise how the sentence starts.
const stateNotManaged = (command: string) =>
  `state not managed for field \`state\` on command \`${command}\`. You must call \`.manage()\` before using this command`;

const NOT_STARTED =
  "Scheduled tasks are not running because the scheduler did not start, usually because the saved schedule could not be read. See the notice shown at startup.";

describe("useScheduler when the scheduler was skipped at startup", () => {
  it("says so in plain words instead of showing Tauri's missing-state text", async () => {
    const { result } = renderHook(() => useScheduler());

    mockInvoke.mockRejectedValueOnce(stateNotManaged("sched_list_tasks"));
    await act(async () => {
      await result.current.fetchTasks();
    });
    expect(result.current.error).toBe(NOT_STARTED);

    mockInvoke.mockRejectedValueOnce(
      new Error(stateNotManaged("sched_get_config")),
    );
    await act(async () => {
      await result.current.loadConfig();
    });
    expect(result.current.error).toBe(NOT_STARTED);

    mockInvoke.mockRejectedValueOnce(stateNotManaged("sched_validate_cron"));
    await act(async () => {
      expect(await result.current.validateCron("*/5 * * * *")).toBe(
        NOT_STARTED,
      );
    });
  });

  it("leaves every other rejection exactly as it arrived", async () => {
    const { result } = renderHook(() => useScheduler());
    for (const text of [
      "Backend unavailable",
      // The phrase inside another message is not the missing-state answer.
      "task failed: state not managed by this scheduler",
      "",
    ]) {
      mockInvoke.mockRejectedValueOnce(text);
      await act(async () => {
        await result.current.fetchTasks();
      });
      expect(result.current.error).toBe(text);
    }
  });

  it("is only as good as the Tauri sentence it was read from", () => {
    // The match was taken from the pinned Tauri source. When this pin moves,
    // read `State::from_command` in the new version and update both the hook
    // and `stateNotManaged` above before changing the version here.
    expect(readFileSync("src-tauri/Cargo.toml", "utf8")).toMatch(
      /^tauri = \{ version = "=2\.11\.5"/mu,
    );
  });
});
