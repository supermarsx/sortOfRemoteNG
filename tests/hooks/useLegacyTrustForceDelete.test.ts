import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLegacyTrustForceDelete } from "../../src/hooks/settings/useLegacyTrustForceDelete";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => invoke,
}));
const token = "11111111-1111-4111-8111-111111111111";
function fixture(refresh: () => Promise<void>) {
  invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "trust_preview_force_delete_legacy")
      return {
        token,
        expiresAt: Date.now() + 300000,
        confirmationPhrase: "FORCE DELETE LEGACY TRUST",
        files: [{ name: "trust_store.json", bytes: 4, sha256: "a".repeat(64) }],
      };
    if (command === "trust_force_delete_legacy")
      return {
        completed: true,
        removedFiles: ["trust_store.json"],
        preservedFiles: ["trust_store.json"],
        recoveryPath: "F:\\temp\\legacy-trust-recovery\\fixture",
        errors: [],
      };
    return true;
  });
  const acquire = vi.fn(() => true),
    release = vi.fn();
  const view = renderHook(() =>
    useLegacyTrustForceDelete({ acquire, release, refresh }),
  );
  return { ...view, acquire, release };
}
afterEach(() => vi.useRealTimers());
it("preserves committed report and always releases the lease after a refresh rejection", async () => {
  const view = fixture(async () => {
    throw new Error("refresh failed");
  });
  await act(() => view.result.current.review());
  act(() => view.result.current.setConfirmation("FORCE DELETE LEGACY TRUST"));
  await act(() => view.result.current.apply());
  expect(view.result.current.result?.completed).toBe(true);
  expect(view.result.current.refreshWarning).toContain(
    "could not be refreshed",
  );
  expect(view.result.current.error).toBe("");
  expect(view.result.current.running).toBe(false);
  expect(view.release).toHaveBeenCalledTimes(1);
  await act(() => view.result.current.review());
  expect(view.acquire).toHaveBeenCalledTimes(2);
  expect(view.result.current.preview).not.toBeNull();
  view.unmount();
});
it("expires and disarms a review without another click or any delete", async () => {
  vi.useFakeTimers();
  const view = fixture(async () => {});
  await act(() => view.result.current.review());
  await act(() => vi.advanceTimersByTimeAsync(300000));
  expect(view.result.current.preview).toBeNull();
  expect(view.result.current.error).toContain("review expired");
  expect(view.release).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("trust_cancel_force_delete_legacy", {
    token,
  });
  expect(invoke).not.toHaveBeenCalledWith(
    "trust_force_delete_legacy",
    expect.anything(),
  );
  view.unmount();
});
