import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecoverySettings } from "../../src/hooks/settings/useRecoverySettings";
const mocks = vi.hoisted(() => ({
  revoke: vi.fn(),
  reset: vi.fn(),
  initialize: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../src/utils/recording/scriptRunTrustStore", () => ({
  revokeAllScriptTrust: mocks.revoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      resetStoredSettings: mocks.reset,
      initialize: mocks.initialize,
    }),
  },
}));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: { removeItem: mocks.remove },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("recovery trust reset", () => {
  it.each(["resetSettings", "deleteData"])(
    "refuses %s before changing data if the durable trust clear failed",
    async (action) => {
      mocks.revoke.mockResolvedValue({ ok: false, reason: "failed" });
      const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const view = renderHook(() => useRecoverySettings());
      await act(async () =>
        view.result.current.confirmActions[action].onConfirm(),
      );
      expect(mocks.revoke).toHaveBeenCalledOnce();
      expect(mocks.reset).not.toHaveBeenCalled();
      expect(mocks.initialize).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(
        alert.mock.calls.some(([text]) =>
          String(text).includes("could not be cleared"),
        ),
      ).toBe(true);
    },
  );
});
