import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeSecureClipboardMiB,
  useSecureClipboardConfig,
} from "../../src/hooks/security/useSecureClipboardConfig";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => invoke,
}));

beforeEach(() => invoke.mockReset());
describe("secure clipboard size policy", () => {
  it("defaults to 150 MiB and bounds persisted values", () => {
    expect(normalizeSecureClipboardMiB(undefined)).toBe(150);
    expect(normalizeSecureClipboardMiB(NaN)).toBe(150);
    expect(normalizeSecureClipboardMiB(0)).toBe(0.0625);
    expect(normalizeSecureClipboardMiB(900)).toBe(512);
  });
  it("preserves the other native preferences while applying changes", async () => {
    invoke.mockResolvedValue({
      enabled: true,
      clearOnExit: true,
      maxValueBytes: 1,
    });
    const hook = renderHook(({ limit }) => useSecureClipboardConfig(limit), {
      initialProps: { limit: 150 },
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("secure_clip_update_config", {
        config: {
          enabled: true,
          clearOnExit: true,
          maxValueBytes: 150 * 1024 * 1024,
        },
      }),
    );
    act(() => hook.rerender({ limit: 1 }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("secure_clip_update_config", {
        config: {
          enabled: true,
          clearOnExit: true,
          maxValueBytes: 1024 * 1024,
        },
      }),
    );
  });
  it("does not write a config that already matches", async () => {
    invoke.mockResolvedValue({ maxValueBytes: 150 * 1024 * 1024 });
    renderHook(() => useSecureClipboardConfig(150));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("secure_clip_get_config"),
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
