import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeBrowserDownloads } from "../../src/hooks/protocol/useNativeBrowserDownloads";
import { nativeDownload } from "../../src/types/protocols/nativeBrowserDownloads";
import NativeBrowserDownloads from "../../src/components/protocol/webBrowser/NativeBrowserDownloads";

const transport = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: transport.listen }));
vi.mock("../../src/components/ui/overlays/PopoverSurface", () => ({
  PopoverSurface: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <>{children}</> : null),
}));
afterEach(cleanup);
const identity = {
  ownerDatabaseId: "db",
  connectionId: "website",
  sessionId: "tab",
  attemptId: "attempt",
};
const row = (sequence = 1) => ({
  identity,
  downloadId: 1,
  sequence,
  fileName: "report.pdf",
  status: "in-progress",
  receivedBytes: 10,
  totalBytes: 100,
  bytesPerSecond: 2,
  canPause: true,
  canResume: false,
  canCancel: true,
  canReveal: false,
});

describe("native download metadata", () => {
  it("accepts only bounded owner-scoped display fields", () => {
    expect(
      nativeDownload({ ...row(), path: "private", url: "secret" }, identity),
    ).toEqual(row());
    for (const invalid of [
      { ...row(), identity: { ...identity, attemptId: "other" } },
      { ...row(), downloadId: 0 },
      { ...row(), sequence: NaN },
      { ...row(), receivedBytes: -1 },
      { ...row(), totalBytes: Infinity },
      { ...row(), fileName: "bad\nname" },
      { ...row(), fileName: "a".repeat(513) },
      { ...row(), canReveal: "true" },
      { ...row(), status: "running" },
    ])
      expect(nativeDownload(invalid, identity)).toBeNull();
  });
});

describe("native download controller", () => {
  let event: (event: { payload: unknown }) => void;
  let off: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    off = vi.fn();
    transport.listen.mockImplementation(async (_name, listener) => {
      event = listener;
      return off;
    });
    transport.invoke.mockResolvedValue([]);
  });
  it("subscribes before listing and ignores stale progress or other owners", async () => {
    const { result, unmount } = renderHook(() =>
      useNativeBrowserDownloads(identity, true, () => {}),
    );
    await waitFor(() =>
      expect(transport.invoke).toHaveBeenCalledWith(
        "origin_browser_downloads",
        { request: { identity } },
      ),
    );
    expect(transport.listen.mock.invocationCallOrder[0]).toBeLessThan(
      transport.invoke.mock.invocationCallOrder[0],
    );
    act(() => event({ payload: row(4) }));
    act(() => event({ payload: row(2) }));
    act(() =>
      event({
        payload: {
          ...row(6),
          identity: { ...identity, ownerDatabaseId: "different" },
        },
      }),
    );
    expect(result.current.rows).toEqual([row(4)]);
    expect(result.current.activeCount).toBe(1);
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });
  it("keeps root and popup rows distinct under the shared native ID allocation", async () => {
    const { result } = renderHook(() =>
      useNativeBrowserDownloads(identity, true, () => {}),
    );
    await waitFor(() => expect(transport.invoke).toHaveBeenCalledTimes(1));
    const root = row(8);
    const popup = { ...row(1), downloadId: 2, fileName: "popup.pdf" };
    act(() => event({ payload: root }));
    act(() => event({ payload: popup }));
    expect(result.current.rows).toEqual([popup, root]);
    await act(async () => {
      expect(await result.current.act(2, "cancel")).toBe(true);
    });
    expect(transport.invoke).toHaveBeenLastCalledWith(
      "origin_browser_download_control",
      {
        request: { identity, downloadId: 2, action: "cancel" },
      },
    );
  });
  it("shows intentional disabled policy without a spurious refresh error", async () => {
    const openSettings = vi.fn();
    function Panel() {
      const controller = useNativeBrowserDownloads(identity, true, () => {});
      return (
        <NativeBrowserDownloads
          controller={controller}
          allowed={false}
          onOpenSettings={openSettings}
        />
      );
    }
    render(<Panel />);
    await waitFor(() =>
      expect(transport.invoke).toHaveBeenCalledWith(
        "origin_browser_downloads",
        { request: { identity } },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Downloads" }));
    expect(
      screen.getByText(/Website downloads are disabled/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No downloads in this browser session."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(transport.invoke).toHaveBeenCalledTimes(1); // no control grant
  });
  it("sends only identity, id and explicit action and prevents duplicate actions", async () => {
    const assertOwner = vi.fn();
    const { result } = renderHook(() =>
      useNativeBrowserDownloads(identity, true, assertOwner),
    );
    await waitFor(() => expect(transport.invoke).toHaveBeenCalledTimes(1));
    let finish!: () => void;
    transport.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.act(1, "pause");
    });
    expect(await result.current.act(1, "pause")).toBe(false);
    expect(transport.invoke).toHaveBeenLastCalledWith(
      "origin_browser_download_control",
      { request: { identity, downloadId: 1, action: "pause" } },
    );
    await act(async () => {
      finish();
      expect(await pending).toBe(true);
    });
    expect(assertOwner).toHaveBeenCalled();
  });
  it("clears rows and rejects late responses after the owner becomes unavailable", async () => {
    let reply!: (value: unknown) => void;
    transport.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useNativeBrowserDownloads(identity, enabled, () => {}),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(reply).toBeDefined());
    const oldEvent = event;
    rerender({ enabled: false });
    await act(async () => {
      reply([row()]);
      oldEvent({ payload: row(3) });
    });
    expect(result.current.rows).toEqual([]);
    expect(result.current.scope).toBe("");
    expect(await result.current.act(1, "resume")).toBe(false);
  });
  it("redacts backend errors and does not create authority when disabled", async () => {
    transport.invoke.mockRejectedValueOnce(new Error("secret URL/cookie"));
    const { result } = renderHook(() =>
      useNativeBrowserDownloads(identity, true, () => {}),
    );
    await waitFor(() =>
      expect(result.current.error).toContain("could not be refreshed"),
    );
    expect(result.current.error).not.toContain("secret");
    const disabled = renderHook(() =>
      useNativeBrowserDownloads(null, false, () => {
        throw new Error();
      }),
    );
    expect(disabled.result.current.scope).toBe("");
    expect(transport.listen).toHaveBeenCalledTimes(1);
  });
});
