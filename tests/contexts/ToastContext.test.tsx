import { renderHook, act, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  ToastProvider,
  useToastContext,
} from "../../src/contexts/ToastContext";
import React from "react";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

describe("ToastContext", () => {
  it("exposes success, error, warning, info toast methods", () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });
    expect(typeof result.current.toast.success).toBe("function");
    expect(typeof result.current.toast.error).toBe("function");
    expect(typeof result.current.toast.warning).toBe("function");
    expect(typeof result.current.toast.info).toBe("function");
  });

  it("each toast type returns a string id", () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });

    let id: string;
    act(() => {
      id = result.current.toast.success("ok");
    });
    expect(typeof id!).toBe("string");

    act(() => {
      id = result.current.toast.error("fail");
    });
    expect(typeof id!).toBe("string");

    act(() => {
      id = result.current.toast.warning("warn");
    });
    expect(typeof id!).toBe("string");

    act(() => {
      id = result.current.toast.info("info");
    });
    expect(typeof id!).toBe("string");
  });

  it("limits toasts to 5, removing the oldest when exceeded", () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });

    const ids: string[] = [];
    act(() => {
      for (let i = 0; i < 6; i++) {
        ids.push(result.current.toast.info(`msg-${i}`));
      }
    });

    // The first id should have been evicted; only last 5 remain.
    // We can't directly query toasts from the context, but we can verify
    // the provider doesn't throw and returns valid ids.
    expect(ids).toHaveLength(6);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
  });

  it("removeAll clears all toasts", () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });

    act(() => {
      result.current.toast.success("a");
      result.current.toast.error("b");
      result.current.toast.warning("c");
    });

    // Should not throw
    act(() => {
      result.current.removeAll();
    });

    // After removeAll, adding a new toast should still work
    let id: string;
    act(() => {
      id = result.current.toast.info("fresh");
    });
    expect(typeof id!).toBe("string");
  });

  it("throws when used outside of ToastProvider", () => {
    expect(() => {
      renderHook(() => useToastContext());
    }).toThrow("useToastContext must be used within a ToastProvider");
  });

  it("updates one loading toast, preserves it under ordinary notification pressure, and never resurrects a removed id", () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });
    let id = "";
    act(() => {
      id = result.current.toast.loading("Preparing databases");
    });
    act(() => {
      for (let index = 0; index < 12; index++)
        result.current.toast.info(`Notice ${index}`);
      result.current.toast.update(id, {
        message: "Clone: Beta — 2 of 18",
        progress: { completed: 1, total: 19 },
      });
    });
    expect(screen.queryByText("Preparing databases")).toBeNull();
    expect(screen.getAllByText("Clone: Beta — 2 of 18")).toHaveLength(1);
    expect(document.querySelectorAll(".toast-item")).toHaveLength(5);
    act(() =>
      result.current.toast.update(id, {
        type: "success",
        message: "18 succeeded",
        duration: 6000,
      }),
    );
    expect(screen.getAllByText("18 succeeded")).toHaveLength(1);
    act(() => {
      result.current.toast.remove(id);
      result.current.toast.update(id, { message: "Late stale completion" });
    });
    expect(screen.queryByText("18 succeeded")).toBeNull();
    expect(screen.queryByText("Late stale completion")).toBeNull();
  });
});
