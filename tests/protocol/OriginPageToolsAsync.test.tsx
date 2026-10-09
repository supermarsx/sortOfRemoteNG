import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OriginPageTools from "../../src/components/protocol/webBrowser/OriginPageTools";
import type { OriginBrowserController } from "../../src/hooks/protocol/useOriginBrowser";

afterEach(cleanup);
function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function controller(): OriginBrowserController {
  return {
    connectionStatus: "connected",
    state: {
      phase: "attached",
      snapshot: null,
      error: null,
      unavailableReason: null,
    },
    setViewport: vi.fn(),
    navigate: vi.fn(),
    focus: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    openDevTools: vi.fn(),
    close: vi.fn(),
    reconnect: vi.fn(),
    zoom: vi.fn().mockResolvedValue(true),
    find: vi.fn(),
    stopFind: vi.fn(),
  };
}
describe("initial native zoom settlement", () => {
  it("ignores a pending old preference and applies the newly resolved default", async () => {
    const browser = controller();
    const first = deferred();
    vi.mocked(browser.zoom).mockReturnValueOnce(first.promise);
    const view = render(
      <OriginPageTools controller={browser} enabled defaultZoom={125} />,
    );
    view.rerender(
      <OriginPageTools controller={browser} enabled defaultZoom={175} />,
    );
    expect(browser.zoom).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(true));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toHaveTextContent("175%"),
    );
    expect(browser.zoom).toHaveBeenNthCalledWith(2, 175);
  });
  it("does not loop when the one eligible retry is declined", async () => {
    const browser = controller();
    const first = deferred();
    vi.mocked(browser.zoom)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(false);
    const view = render(
      <OriginPageTools controller={browser} enabled defaultZoom={150} />,
    );
    view.rerender(
      <OriginPageTools
        controller={browser}
        enabled={false}
        defaultZoom={150}
      />,
    );
    view.rerender(
      <OriginPageTools controller={browser} enabled defaultZoom={150} />,
    );
    await act(async () => first.resolve(false));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reset zoom" })).toBeEnabled(),
    );
    expect(browser.zoom).toHaveBeenCalledTimes(2);
    view.rerender(
      <OriginPageTools controller={{ ...browser }} enabled defaultZoom={150} />,
    );
    await act(async () => {});
    expect(browser.zoom).toHaveBeenCalledTimes(2);
  });
  it.each(["accepted", "declined", "rejected"])(
    "retries exactly once when a stale %s request settles after re-enabling",
    async (result) => {
      const browser = controller();
      const first = deferred();
      vi.mocked(browser.zoom).mockReturnValueOnce(first.promise);
      const view = render(
        <OriginPageTools controller={browser} enabled defaultZoom={150} />,
      );
      expect(browser.zoom).toHaveBeenCalledTimes(1);
      view.rerender(
        <OriginPageTools
          controller={browser}
          enabled={false}
          defaultZoom={150}
        />,
      );
      view.rerender(
        <OriginPageTools controller={browser} enabled defaultZoom={150} />,
      );
      expect(browser.zoom).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (result === "rejected") first.reject(new Error("declined"));
        else first.resolve(result === "accepted");
      });
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Reset zoom" }),
        ).toHaveTextContent("150%"),
      );
      expect(browser.zoom).toHaveBeenCalledTimes(2);
      expect(browser.zoom).toHaveBeenNthCalledWith(2, 150);
      view.rerender(
        <OriginPageTools
          controller={{ ...browser }}
          enabled
          defaultZoom={150}
        />,
      );
      await act(async () => {});
      expect(browser.zoom).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["declined", "rejected"])(
    "does not automatically loop on a current %s request",
    async (result) => {
      const browser = controller();
      if (result === "rejected")
        vi.mocked(browser.zoom).mockRejectedValue(new Error("declined"));
      else vi.mocked(browser.zoom).mockResolvedValue(false);
      const view = render(
        <OriginPageTools controller={browser} enabled defaultZoom={150} />,
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Reset zoom" }),
        ).toBeEnabled(),
      );
      expect(browser.zoom).toHaveBeenCalledTimes(1);
      view.rerender(
        <OriginPageTools
          controller={{ ...browser }}
          enabled
          defaultZoom={150}
        />,
      );
      await act(async () => {});
      expect(browser.zoom).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toHaveTextContent("Zoom");
      expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    },
  );
});
