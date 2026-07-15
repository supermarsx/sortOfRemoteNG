import { describe, expect, it } from "vitest";
import {
  resolveConnectionRetryAttempts,
  resolveConnectionRetryDelay,
  resolveConnectionWarnOnClose,
} from "../../../src/utils/behavior/legacyBehavior";

describe("legacy per-connection behavior fallback", () => {
  it("preserves explicit zero retry attempts and delay", () => {
    expect(resolveConnectionRetryAttempts(0, 3)).toBe(0);
    expect(resolveConnectionRetryDelay(0, 5000)).toBe(0);
  });

  it("preserves an explicit false warning override", () => {
    expect(resolveConnectionWarnOnClose(false, true)).toBe(false);
  });

  it("inherits only when the connection value is undefined", () => {
    expect(resolveConnectionRetryAttempts(undefined, 3)).toBe(3);
    expect(resolveConnectionRetryDelay(undefined, 5000)).toBe(5000);
    expect(resolveConnectionWarnOnClose(undefined, true)).toBe(true);
  });
});
