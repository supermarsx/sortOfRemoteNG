import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NativeHttpObservations from "../../src/components/protocol/webBrowser/NativeHttpObservations";
import {
  parseNativeHttpObservations,
  parseWebNetworkGuardStatus,
} from "../../src/utils/protocol/webNetworkGuard";

const fixture = vi.hoisted(() => ({ invoke: vi.fn(), isActive: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: fixture.isActive }),
}));
const snapshot = () => ({
  scope: "application",
  total: 2,
  documentBlocked: 1,
  recent: [
    {
      sequence: 1,
      method: "GET",
      origin: "https://example.com",
      resourceKind: "document",
      sourceKind: "document",
      documentBlocked: true,
    },
    {
      sequence: 2,
      method: "POST",
      origin: "https://api.example.com",
      resourceKind: "xhr",
      sourceKind: "document",
      documentBlocked: false,
    },
  ],
});
const status = () => ({
  platform: "windows",
  frameNavigation: "enforced",
  allNetworkRequestsMediated: false,
  httpObservations: snapshot(),
});

beforeEach(() => {
  fixture.isActive = true;
  fixture.invoke.mockReset().mockResolvedValue(status());
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("native HTTP diagnostic validation", () => {
  it("constructs a closed snapshot without extra secret-bearing fields", () => {
    const raw = snapshot();
    const parsed = parseNativeHttpObservations({
      ...raw,
      path: "secret-path",
      recent: raw.recent.map((row) => ({
        ...row,
        headers: "secret-header",
        body: "secret-body",
      })),
    });
    expect(parsed).toEqual(raw);
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
  it.each([
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?secret=1",
    "https://example.com#secret",
    "https://EXAMPLE.com",
    "https://example.com:443",
    "file:///private",
    "ws://example.com",
  ])("rejects non-origin or noncanonical diagnostic %s", (origin) => {
    const raw = snapshot();
    raw.recent[0].origin = origin;
    expect(() => parseNativeHttpObservations(raw)).toThrow(
      "observations are unavailable",
    );
  });
  it("bounds counters/categories/cap and does not let malformed diagnostics disable the guard", () => {
    const good = snapshot();
    for (const bad of [
      { ...good, total: -1 },
      { ...good, total: Number.MAX_SAFE_INTEGER + 1 },
      { ...good, documentBlocked: 3 },
      {
        ...good,
        total: 65,
        recent: Array.from({ length: 65 }, () => good.recent[0]),
      },
      { ...good, recent: [{ ...good.recent[0], method: "secret-method" }] },
      { ...good, recent: [{ ...good.recent[0], sourceKind: "secret-source" }] },
      {
        ...good,
        recent: [{ ...good.recent[0], resourceKind: "secret-resource" }],
      },
      { ...good, recent: [{ ...good.recent[1], documentBlocked: true }] },
    ]) {
      expect(() => parseNativeHttpObservations(bad)).toThrow();
      expect(
        parseWebNetworkGuardStatus({ ...status(), httpObservations: bad }),
      ).toEqual({
        platform: "windows",
        frameNavigation: "enforced",
        allNetworkRequestsMediated: false,
      });
    }
    expect(
      parseWebNetworkGuardStatus({
        ...status(),
        platform: "linux",
        frameNavigation: "unsupported",
      }).httpObservations,
    ).toBeUndefined();
  });
});

describe("native HTTP observations disclosure", () => {
  it("does not request while closed; opens/refreshes explicitly and distinguishes native scope", async () => {
    const view = render(<NativeHttpObservations active={false} />);
    expect(fixture.invoke).not.toHaveBeenCalled();
    view.rerender(<NativeHttpObservations active />);
    await screen.findByText(/POST https:\/\/api.example.com/);
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/not native upstream or service traffic/),
    ).toHaveTextContent("not attributed to this tab");
    expect(screen.getByText(/POST https:/)).toHaveTextContent(
      "observed, outcome unknown",
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("POST https://api.example.com");
    expect(rows[1]).toHaveTextContent("GET https://example.com");
    fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    await waitFor(() => expect(fixture.invoke).toHaveBeenCalledTimes(2));
    view.rerender(<NativeHttpObservations active={false} />);
    expect(screen.queryByText(/api.example/)).toBeNull();
  });
  it("does not poll, and clears while hidden or inactive", async () => {
    const view = render(<NativeHttpObservations active />);
    await screen.findByText(/POST https:\/\/api.example.com/);
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByText(/api.example/)).toBeNull();
    fixture.isActive = false;
    view.rerender(<NativeHttpObservations active />);
    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["close", "unmount"])(
    "discards deferred snapshots after %s",
    async (action) => {
      let resolve!: (value: unknown) => void;
      fixture.invoke.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const view = render(<NativeHttpObservations active />);
      if (action === "close")
        view.rerender(<NativeHttpObservations active={false} />);
      else view.unmount();
      await act(async () => resolve(status()));
      expect(screen.queryByText(/api.example/)).toBeNull();
    },
  );
  it("reports unavailable snapshots without disclosing raw IPC errors or fake success", async () => {
    fixture.invoke.mockRejectedValue("private-password-and-query");
    render(<NativeHttpObservations active />);
    await screen.findByText(/requires the updated Windows desktop process/);
    expect(screen.queryByText(/private-password/)).toBeNull();
    expect(screen.queryByText(/observed; /)).toBeNull();
  });
});
