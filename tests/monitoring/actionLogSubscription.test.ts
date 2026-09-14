import { describe, expect, it, vi } from "vitest";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
const writes = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    setItem: writes,
    getItem: vi.fn().mockResolvedValue(null),
  },
}));
describe("application action-log subscriptions", () => {
  it("notifies on writes/clear without polling and preserves prior snapshots", () => {
    const manager = new SettingsManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribeActionLog(listener);
    const snapshot = manager.getActionLog();
    manager.logAction("info", "Fixture action");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveLength(0);
    expect(manager.getActionLog()).toHaveLength(1);
    manager.clearActionLog();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(manager.getActionLog()).toHaveLength(0);
    unsubscribe();
    manager.logAction("info", "Another action");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(writes).toHaveBeenCalledWith(
      "mremote-action-log",
      expect.any(Array),
    );
  });
  it("isolates observer exceptions from application operations", () => {
    const manager = new SettingsManager();
    manager.subscribeActionLog(() => {
      throw new Error("Observer failure");
    });
    const listener = vi.fn();
    manager.subscribeActionLog(listener);
    expect(() => manager.logAction("info", "Fixture action")).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
