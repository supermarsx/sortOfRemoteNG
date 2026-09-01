import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_VALUES } from "../../src/components/SettingsDialog/settingsConstants";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { DEFAULT_RDP_SETTINGS } from "../../src/types/connection/connection";
import { mergeRdpSettings } from "../../src/utils/rdp/rdpSettingsMerge";
import { SettingsManager } from "../../src/utils/settings/settingsManager";

describe("RDP frame batching defaults", () => {
  beforeEach(() => {
    SettingsManager.resetInstance();
  });

  it("keeps every frontend default initializer enabled at 33ms", () => {
    const defaults = [
      DEFAULT_RDP_SETTINGS.performance,
      defaultSettings.rdpDefaults,
      SettingsManager.getInstance().getSettings().rdpDefaults,
      DEFAULT_VALUES.rdpDefaults,
    ];

    for (const frameDefaults of defaults) {
      expect(frameDefaults?.frameBatching).toBe(true);
      expect(frameDefaults?.frameBatchIntervalMs).toBe(33);
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
