import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeBrowserAppearance } from "../../src/hooks/protocol/useNativeBrowserAppearance";

const request = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: request }));
const identity = {
  ownerDatabaseId: "owner",
  connectionId: "connection",
  sessionId: "session",
  attemptId: "attempt",
};
const receipt = { status: "applied", followingAppTheme: true };
const palette = (background: string) => {
  document.body.style.setProperty("--color-background", background);
  document.body.style.setProperty("--color-text", "#eeeeee");
};
beforeEach(() => {
  request.mockReset();
  palette("#111111");
  request.mockResolvedValue(receipt);
});
afterEach(() => {
  cleanup();
  document.body.style.removeProperty("--color-background");
  document.body.style.removeProperty("--color-text");
});

describe("native appearance color bridge", () => {
  it("only sends owner identity and shell palette, not settings or arbitrary CSS", async () => {
    const guard = vi.fn();
    const { result } = renderHook(() =>
      useNativeBrowserAppearance(identity, true, guard),
    );
    await waitFor(() => expect(result.current?.receipt).toEqual(receipt));
    expect(request).toHaveBeenLastCalledWith("origin_browser_appearance", {
      request: {
        identity,
        appPalette: { backgroundColor: "#111111", textColor: "#eeeeee" },
      },
    });
    expect(guard).toHaveBeenCalled();
  });
  it("serializes palette changes and settles on the latest without concurrent updates", async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useNativeBrowserAppearance(identity, true, () => {}),
    );
    await act(async () => {
      palette("#223344");
    });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(receipt);
    });
    await waitFor(() => expect(result.current?.receipt).toEqual(receipt));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.lastCall?.[1].request.appPalette.backgroundColor).toBe(
      "#223344",
    );
  });
  it("discards a late receipt after losing its owner and does not repeat a failed request", async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useNativeBrowserAppearance(identity, enabled, () => {}),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    await act(async () => {
      finish(receipt);
    });
    expect(result.current).toBeNull();
    request.mockRejectedValue(new Error("must-not-show-secret-source"));
    rerender({ enabled: true });
    await waitFor(() =>
      expect(result.current?.error).toContain("could not be applied"),
    );
    expect(result.current?.error).not.toContain("must-not-show");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
