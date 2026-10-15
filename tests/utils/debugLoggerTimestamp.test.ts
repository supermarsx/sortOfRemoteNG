import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ settings: { logLevel: "debug" } }));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => mocked.settings }),
  },
}));
import { debugLog } from "../../src/utils/core/debugLogger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("debug log emission timestamps", () => {
  it("prefixes each enabled emission with its current ISO timestamp and retains argument identity", () => {
    mocked.settings.logLevel = "debug";
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const object = { fixture: true };
    const error = new Error("synthetic diagnostic");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T14:00:00.125Z"));
    debugLog("first", object, error);
    vi.setSystemTime(new Date("2026-10-15T14:00:01.250Z"));
    debugLog("second", object);
    expect(output.mock.calls).toEqual([
      ["[2026-10-15T14:00:00.125Z]", "first", object, error],
      ["[2026-10-15T14:00:01.250Z]", "second", object],
    ]);
    expect(output.mock.calls[0][2]).toBe(object);
    expect(output.mock.calls[0][3]).toBe(error);
  });
  it.each(["info", "warn", "error"])(
    "does not emit when configured at %s",
    (logLevel) => {
      mocked.settings.logLevel = logLevel;
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      debugLog("suppressed synthetic diagnostic");
      expect(output).not.toHaveBeenCalled();
    },
  );
});
