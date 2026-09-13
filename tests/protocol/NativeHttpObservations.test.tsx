import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
const PROXY = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const NEXT_PROXY = "http://pabcdef0123456789abcdef0123456789.localhost:43124";
const trafficStatus = () => ({
  ...status(),
  httpObservations: {
    scope: "application",
    total: 7,
    documentBlocked: 1,
    recent: [
      "http://ipc.localhost",
      PROXY,
      NEXT_PROXY,
      "https://blocked.example.com",
      "https://api.example.com",
      "http://ipc.localhost.example.com",
      "https://ipc.localhost",
    ].map((origin, index) => ({
      sequence: index + 1,
      method: "POST",
      origin,
      resourceKind: index === 3 ? "document" : "xhr",
      sourceKind: "document",
      documentBlocked: index === 3,
    })),
  },
});
function chooseFilter(name: string) {
  fireEvent.click(
    screen.getByRole("combobox", { name: "Filter native observations" }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name }));
}

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
  it("defaults to the exact active proxy, keeps blocked requests visible, and explicitly reveals IPC", async () => {
    fixture.invoke.mockResolvedValue(trafficStatus());
    render(<NativeHttpObservations active proxyOrigin={PROXY} />);
    const list = await screen.findByRole("list", {
      name: "Filtered native observations",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list).toHaveTextContent(`POST ${PROXY}`);
    expect(list).not.toHaveTextContent("ipc.localhost");
    const blocked = screen.getByRole("list", {
      name: "Blocked documents outside filter",
    });
    expect(blocked).toHaveTextContent("https://blocked.example.com");
    expect(blocked).toHaveTextContent("document blocked");
    expect(screen.getByText(/App IPC may already have evicted/)).toBeVisible();
    expect(screen.getByText(/Matching an origin/)).toHaveTextContent(
      "does not establish tab ownership",
    );
    chooseFilter("Other website traffic");
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(list).not.toHaveTextContent(PROXY);
    expect(list).toHaveTextContent(NEXT_PROXY);
    expect(list).toHaveTextContent("http://ipc.localhost.example.com");
    expect(
      screen.queryByRole("list", { name: "Blocked documents outside filter" }),
    ).toBeNull();
    chooseFilter("All, including app IPC");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent("https://ipc.localhost");
    expect(rows[6]).toHaveTextContent("http://ipc.localhost");
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });
  it("without a proxy defaults to non-IPC rows without assigning them to this tab", async () => {
    fixture.invoke.mockResolvedValue(trafficStatus());
    render(<NativeHttpObservations active />);
    const list = await screen.findByRole("list", {
      name: "Filtered native observations",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(list).toHaveTextContent(PROXY);
    expect(list).toHaveTextContent(NEXT_PROXY);
    expect(
      within(list).queryByText(/^POST https?:\/\/ipc\.localhost —/),
    ).toBeNull();
    expect(screen.getByText(/No active proxy origin/)).toHaveTextContent(
      "not assigned to a tab",
    );
    expect(
      screen.getByRole("combobox", { name: "Filter native observations" }),
    ).toHaveTextContent("Website traffic (excluding app IPC)");
  });
  it("never hides an IPC-origin document denial behind the IPC filter", async () => {
    const value = trafficStatus();
    value.httpObservations.documentBlocked = 2;
    value.httpObservations.recent[0].resourceKind = "document";
    value.httpObservations.recent[0].documentBlocked = true;
    fixture.invoke.mockResolvedValue(value);
    render(<NativeHttpObservations active proxyOrigin={PROXY} />);
    const blocked = await screen.findByRole("list", {
      name: "Blocked documents outside filter",
    });
    expect(blocked).toHaveTextContent("POST http://ipc.localhost");
    expect(within(blocked).getAllByRole("listitem")).toHaveLength(2);
  });
  it("clears stale rows and resets the filter on origin change without requesting another snapshot", async () => {
    fixture.invoke.mockResolvedValue(trafficStatus());
    const view = render(<NativeHttpObservations active proxyOrigin={PROXY} />);
    await screen.findByRole("list", { name: "Filtered native observations" });
    chooseFilter("All, including app IPC");
    view.rerender(<NativeHttpObservations active proxyOrigin={NEXT_PROXY} />);
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Filter native observations" }),
    ).toHaveTextContent("Current proxy origin");
    expect(screen.getByText(/Refresh to read a snapshot/)).toBeVisible();
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    const list = await screen.findByRole("list", {
      name: "Filtered native observations",
    });
    expect(list).toHaveTextContent(NEXT_PROXY);
    expect(list).not.toHaveTextContent(PROXY);
    expect(fixture.invoke).toHaveBeenCalledTimes(2);
  });
  it("discards a deferred old-origin snapshot even after an origin ABA transition", async () => {
    let resolve!: (value: unknown) => void;
    fixture.invoke.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<NativeHttpObservations active proxyOrigin={PROXY} />);
    view.rerender(<NativeHttpObservations active proxyOrigin={NEXT_PROXY} />);
    view.rerender(<NativeHttpObservations active proxyOrigin={PROXY} />);
    await act(async () => resolve(trafficStatus()));
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Refresh snapshot" }),
    ).toBeEnabled();
  });
  it("does not display or reinterpret a malformed secret-bearing proxy URL", async () => {
    render(
      <NativeHttpObservations
        active
        proxyOrigin="https://private-user:private-secret@example.com/path"
      />,
    );
    await screen.findByRole("list", { name: "Filtered native observations" });
    expect(screen.queryByText(/private-user|private-secret/)).toBeNull();
    expect(screen.getByText(/No active proxy origin/)).toBeVisible();
  });
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
