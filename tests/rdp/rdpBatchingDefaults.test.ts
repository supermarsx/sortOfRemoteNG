import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_VALUES } from "../../src/components/SettingsDialog/settingsConstants";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { DEFAULT_RDP_SETTINGS } from "../../src/types/connection/connection";
import { mergeRdpSettings } from "../../src/utils/rdp/rdpSettingsMerge";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { PERFORMANCE_PRESETS } from "../../src/hooks/rdp/useRDPOptions";

describe("RDP frame batching defaults", () => {
  beforeEach(() => {
    SettingsManager.resetInstance();
  });

  it("keeps every frontend initializer uncapped with coalescing enabled", () => {
    const defaults = [
      DEFAULT_RDP_SETTINGS.performance,
      defaultSettings.rdpDefaults,
      SettingsManager.getInstance().getSettings().rdpDefaults,
      DEFAULT_VALUES.rdpDefaults,
    ];

    for (const frameDefaults of defaults) {
      expect(frameDefaults?.frameBatching).toBe(true);
      expect(frameDefaults?.frameBatchIntervalMs).toBe(33);
      expect(frameDefaults?.frameRateLimitEnabled).toBe(false);
      expect(frameDefaults?.targetFps).toBe(0);
    }
  });

  it("keeps old persisted 30 FPS / 33ms preferences uncapped", () => {
    const legacy = {
      targetFps: 30,
      frameBatchIntervalMs: 33,
      frameBatching: true,
    };
    const result = mergeRdpSettings({ performance: legacy }, legacy);
    expect(result.performance?.frameRateLimitEnabled).toBe(false);
    expect(result.performance?.targetFps).toBe(0);
    expect(legacy.targetFps).toBe(30);
  });

  it("network presets preserve both uncapped and explicit FPS preferences", () => {
    for (const presets of [PERFORMANCE_PRESETS]) {
      for (const preset of Object.values(presets)) {
        expect(preset).not.toHaveProperty("targetFps");
        expect(preset).not.toHaveProperty("frameRateLimitEnabled");
        expect(preset).not.toHaveProperty("frameBatchIntervalMs");
        const capped = mergeRdpSettings(
          {
            performance: {
              frameRateLimitEnabled: true,
              targetFps: 144,
              ...preset,
            },
          },
          {},
        );
        expect(capped.performance?.targetFps).toBe(144);
        expect(
          mergeRdpSettings({ performance: preset }, {}).performance?.targetFps,
        ).toBe(0);
      }
    }
  });

  it("preserves an explicit user override that disables batching", () => {
    const settings = mergeRdpSettings(undefined, {
      frameBatching: false,
      frameBatchIntervalMs: 16,
    });

    expect(settings.performance?.frameBatching).toBe(false);
    expect(settings.performance?.frameBatchIntervalMs).toBe(16);
  });
});
