import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContext } from "../../src/contexts/ToastContext";
import { useDatabaseOpenNotification } from "../../src/hooks/connection/useDatabaseOpenNotification";
import { isDatabaseOpenCancellation } from "../../src/utils/connection/databaseOpening";
const toast = {
  loading: vi.fn(() => "opening-toast"),
  update: vi.fn(),
  remove: vi.fn(),
  info: vi.fn(() => "info"),
  error: vi.fn(() => "error"),
  success: vi.fn(() => "success"),
  warning: vi.fn(() => "warning"),
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
    {children}
  </ToastContext.Provider>
);
beforeEach(() => vi.clearAllMocks());
describe("database open notification lifecycle", () => {
  it("keeps one indeterminate toast through authentication/decryption until authoritative success", () => {
    const { result } = renderHook(useDatabaseOpenNotification, { wrapper });
    const notify = result.current.begin(
      { id: "db", name: "Vault" },
      "waiting-unlock",
    );
    result.current.begin({ id: "db", name: "Vault" }, "unlocking")("loading");
    expect(toast.loading).toHaveBeenCalledOnce();
    expect(
      toast.update.mock.calls.every(([id]) => id === "opening-toast"),
    ).toBe(true);
    expect(
      toast.update.mock.calls.every(([, patch]) => patch.type === "loading"),
    ).toBe(true);
    notify("success");
    expect(toast.update).toHaveBeenLastCalledWith(
      "opening-toast",
      expect.objectContaining({
        type: "success",
        message: "Opened “Vault”.",
        duration: 4000,
      }),
    );
    const count = toast.update.mock.calls.length;
    notify("failed");
    notify("unconfirmed");
    expect(toast.update).toHaveBeenCalledTimes(count);
    expect(JSON.stringify(toast.update.mock.calls)).not.toContain("%");
  });
  it("cancels previous intents and never reports unconfirmed work as success", () => {
    const { result } = renderHook(useDatabaseOpenNotification, { wrapper });
    const old = result.current.begin(
      { id: "old", name: "Old" },
      "waiting-unlock",
    );
    const next = result.current.begin({ id: "new", name: "New" }, "loading");
    expect(toast.update.mock.calls).toContainEqual([
      "opening-toast",
      expect.objectContaining({
        type: "info",
        message: "Opening “Old” was cancelled.",
      }),
    ]);
    old("success");
    next("unconfirmed");
    expect(toast.update).toHaveBeenLastCalledWith(
      "opening-toast",
      expect.objectContaining({
        type: "info",
        message: expect.stringContaining("without confirmation"),
      }),
    );
    expect(
      toast.update.mock.calls.some(([, patch]) => patch.type === "success"),
    ).toBe(false);
  });
  it("cancels dismissed prompts but lets in-flight loading settle after picker unmount", () => {
    const first = renderHook(useDatabaseOpenNotification, { wrapper });
    first.result.current.begin({ id: "db", name: "Vault" }, "waiting-unlock");
    first.unmount();
    expect(toast.update).toHaveBeenLastCalledWith(
      "opening-toast",
      expect.objectContaining({ type: "info" }),
    );
    const second = renderHook(useDatabaseOpenNotification, { wrapper });
    const notify = second.result.current.begin(
      { id: "db", name: "Vault" },
      "loading",
    );
    second.unmount();
    notify("success");
    expect(toast.update).toHaveBeenLastCalledWith(
      "opening-toast",
      expect.objectContaining({ type: "success" }),
    );
  });
  it("handles a terminal begin transition without dereferencing the cleared intent", () => {
    const { result } = renderHook(useDatabaseOpenNotification, { wrapper });
    result.current.begin({ id: "db", name: "Vault" }, "unlocking");
    result.current.begin({ id: "db", name: "Vault" }, "failed");
    expect(toast.loading).toHaveBeenCalledOnce();
    expect(toast.update).toHaveBeenLastCalledWith(
      "opening-toast",
      expect.objectContaining({ type: "error" }),
    );
  });
  it("distinguishes cancellation/revocation from invalid passwords and corruption", () => {
    for (const error of [
      new DOMException("Cancelled", "AbortError"),
      "User cancelled authentication",
      new Error("The database unlock request is no longer active."),
      new Error("Database access expired. Unlock again."),
    ])
      expect(isDatabaseOpenCancellation(error)).toBe(true);
    for (const error of [
      new Error("Invalid password"),
      "Corrupted database",
      new Error("Disk full"),
    ])
      expect(isDatabaseOpenCancellation(error)).toBe(false);
  });
});
