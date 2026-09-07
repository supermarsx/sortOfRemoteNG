import { describe, expect, it } from "vitest";
import {
  mergeRdpSettings,
  normalizeRdpTargetFps,
} from "../../src/utils/rdp/rdpSettingsMerge";
import type { RDPConnectionSettings } from "../../src/types/connection/connection";

describe("RDP explicit frame rate limit", () => {
  it.each([
    [undefined, {}, 0, false],
    [undefined, { targetFps: 30 }, 0, false],
    [
      { targetFps: 30 },
      { frameRateLimitEnabled: true, targetFps: 144 },
      144,
      true,
    ],
    [undefined, { frameRateLimitEnabled: true, targetFps: 240 }, 240, true],
    [
      { frameRateLimitEnabled: true, targetFps: 144 },
      { targetFps: 30 },
      144,
      true,
    ],
    [
      { frameRateLimitEnabled: false, targetFps: 30 },
      { frameRateLimitEnabled: true, targetFps: 144 },
      0,
      false,
    ],
    [
      { frameRateLimitEnabled: undefined, targetFps: 30 },
      { frameRateLimitEnabled: true, targetFps: 240 },
      240,
      true,
    ],
    [
      { frameRateLimitEnabled: true },
      { frameRateLimitEnabled: true, targetFps: 144 },
      144,
      true,
    ],
    [
      { frameRateLimitEnabled: true, targetFps: 0 },
      { frameRateLimitEnabled: true, targetFps: 144 },
      0,
      true,
    ],
    [{ frameRateLimitEnabled: true }, {}, 0, true],
  ] as Array<
    [
      RDPConnectionSettings["performance"],
      Record<string, unknown>,
      number,
      boolean,
    ]
  >)(
    "resolves connection %j and global %j to %s FPS (enabled %s)",
    (performance, defaults, expected, enabled) => {
      const result = mergeRdpSettings(
        performance ? { performance } : undefined,
        defaults,
      );
      expect(result.performance?.targetFps).toBe(expected);
      expect(result.performance?.frameRateLimitEnabled).toBe(enabled);
    },
  );

  it.each([
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    -1,
    0,
    0.5,
    59.94,
    4294967296,
    "144",
  ])("normalizes invalid native FPS input %s to uncapped", (value) => {
    expect(normalizeRdpTargetFps(value)).toBe(0);
    expect(
      mergeRdpSettings(undefined, {
        frameRateLimitEnabled: true,
        targetFps: value,
      }).performance?.targetFps,
    ).toBe(0);
  });

  it.each([1, 30, 60, 144, 240, 4294967295])(
    "preserves valid u32 FPS %s",
    (targetFps) => {
      expect(normalizeRdpTargetFps(targetFps)).toBe(targetFps);
      expect(
        mergeRdpSettings(undefined, { frameRateLimitEnabled: true, targetFps })
          .performance?.targetFps,
      ).toBe(targetFps);
    },
  );
});
