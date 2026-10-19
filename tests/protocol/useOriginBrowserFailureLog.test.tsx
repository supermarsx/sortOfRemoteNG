import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOriginBrowserFailureLog } from "../../src/hooks/protocol/useOriginBrowserFailureLog";
import type { OriginBrowserState } from "../../src/hooks/protocol/useOriginBrowser";
const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
const state = (
  extra: Partial<OriginBrowserState> = {},
): OriginBrowserState => ({
  phase: "error",
  snapshot: null,
  unavailableReason: null,
  error: "PRIVATE https://account:secret@host/path?token=PRIVATE",
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockResolvedValue(undefined);
});
describe("persistent client browser failures", () => {
  it("logs fixed preflight metadata and observation time once, never the rejected address or display error", async () => {
    const failed = state({
      configurationFailure: { issues: ["url-credentials"] },
    });
    const view = renderHook(
      (value) => useOriginBrowserFailureLog(value, "PRIVATE_OWNER"),
      { initialProps: failed },
    );
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    const [command, { event }] = h.invoke.mock.calls[0];
    expect(command).toBe("application_logs_browser_failure");
    expect(event).toEqual({
      sample: expect.any(Number),
      timestampUnixMs: expect.any(Number),
      failure: { kind: "configuration", issue: "url-credentials" },
    });
    expect(JSON.stringify(h.invoke.mock.calls)).not.toMatch(
      /PRIVATE|https:|token/,
    );
    view.rerender({ ...failed });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    view.rerender(state({ phase: "starting", error: null }));
    view.rerender(failed);
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
  });
  it("persists shell-only deadline and IPC failures without duplicating a native route rejection", async () => {
    const view = renderHook(
      (value) => useOriginBrowserFailureLog(value, "owner"),
      {
        initialProps: state({
          startupFailure: {
            stage: "create",
            category: "runtime",
            code: "start-timeout",
          },
        }),
      },
    );
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(h.invoke.mock.calls[0][1].event.failure).toEqual({
      kind: "startup",
      stage: "create",
      category: "runtime",
      code: "start-timeout",
    });
    view.rerender(
      state({
        startupFailure: {
          stage: "create",
          category: "connection",
          code: "network-route",
        },
      }),
    );
    expect(h.invoke).toHaveBeenCalledTimes(1);
    view.rerender(
      state({ startupFailure: { stage: "listen", category: "ipc" } }),
    );
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
  });
  it("does not recurse or affect browser state when persistent logging is unavailable", async () => {
    h.invoke.mockRejectedValue(new Error("PRIVATE"));
    const view = renderHook(
      (value) => useOriginBrowserFailureLog(value, "owner"),
      { initialProps: state({ operationFailure: "navigation" }) },
    );
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    view.rerender(state({ operationFailure: "navigation" }));
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it("survives a synchronously unavailable bridge without failing the browser render", () => {
    h.invoke.mockImplementation(() => {
      throw new Error("PRIVATE");
    });
    expect(() =>
      renderHook(() =>
        useOriginBrowserFailureLog(
          state({ operationFailure: "state" }),
          "owner",
        ),
      ),
    ).not.toThrow();
  });
});
