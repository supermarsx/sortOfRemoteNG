import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContentArea from "../../src/components/protocol/webBrowser/ContentArea";
import type { WebBrowserMgr } from "../../src/components/protocol/webBrowser/types";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";
import {
  EMPTY_WEB_FRAME_SANDBOX,
  PROXY_WEB_FRAME_SANDBOX,
  navigateWebBrowserFrame,
  clearWebBrowserFrame,
} from "../../src/utils/protocol/webBrowserFrame";

const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43081/";

function manager(overrides: Partial<WebBrowserMgr> = {}): WebBrowserMgr {
  return {
    session: { name: "Popup browser" },
    iframeRef: { current: null },
    shouldMountIframe: false,
    proxyAlive: true,
    isLoading: true,
    showLoadingIndicator: false,
    handleIframeLoad: vi.fn(),
    ...overrides,
  } as WebBrowserMgr;
}

afterEach(cleanup);

describe("ContentArea frame mounting boundary", () => {
  it("hides only the optional loading bar while preserving the dark paint shield", () => {
    const mgr = manager({
      showLoadingIndicator: true,
      waitingForDarkPaint: true,
      websiteDarkBootstrap: {
        backgroundColor: "#111111",
        textColor: "#eeeeee",
      },
      browserSettings: normalizeWebBrowserSettings(undefined),
    });
    const view = render(<ContentArea mgr={mgr} />);
    expect(view.getByTestId("web-navigation-progress")).toBeVisible();
    view.rerender(
      <ContentArea
        mgr={{
          ...mgr,
          browserSettings: {
            ...mgr.browserSettings,
            showLoadingProgress: false,
          },
        }}
      />,
    );
    expect(view.queryByTestId("web-navigation-progress")).toBeNull();
    expect(view.getByTestId("web-dark-paint-shield")).toBeVisible();
  });
  it("creates no browsing context before the controller permits mounting", () => {
    const attachIframe = vi.fn();
    const { container } = render(
      <ContentArea mgr={manager({ attachIframe })} />,
    );

    expect(container.querySelector("iframe")).toBeNull();
    expect(attachIframe).not.toHaveBeenCalled();
  });

  it("has a connected, script-denied initial document without explicit blank navigation", () => {
    const snapshots: unknown[] = [];
    const attachIframe = (frame: HTMLIFrameElement | null) => {
      if (!frame) return;
      snapshots.push({
        connected: frame.isConnected,
        src: frame.getAttribute("src"),
        sandbox: frame.getAttribute("sandbox"),
      });
    };
    render(
      <ContentArea mgr={manager({ shouldMountIframe: true, attachIframe })} />,
    );

    // This proves React's insertion/ref order, not WebView2 script execution:
    // jsdom does not enforce the browser's iframe sandbox.
    expect(snapshots).toEqual([
      { connected: true, src: null, sandbox: EMPTY_WEB_FRAME_SANDBOX },
    ]);
  });

  it("keeps scripts denied when the controller rejects an unapproved target", () => {
    const attachIframe = (frame: HTMLIFrameElement | null) => {
      if (!frame) return;
      expect(() =>
        navigateWebBrowserFrame(frame, "https://unapproved.example/", proxy),
      ).toThrow("isolated protected proxy origin");
    };
    const { getByTitle } = render(
      <ContentArea mgr={manager({ shouldMountIframe: true, attachIframe })} />,
    );

    expect(getByTitle("Popup browser")).not.toHaveAttribute("src");
    expect(getByTitle("Popup browser")).toHaveAttribute("sandbox", "");
  });

  it("ignores initial and recovery blank loads but delivers the validated proxy load", () => {
    const mgr = manager({ shouldMountIframe: true });
    const { getByTitle } = render(<ContentArea mgr={mgr} />);
    const frame = getByTitle("Popup browser") as HTMLIFrameElement;

    fireEvent.load(frame);
    expect(mgr.handleIframeLoad).not.toHaveBeenCalled();
    navigateWebBrowserFrame(frame, `${proxy}control`, proxy);
    fireEvent.load(frame);
    expect(mgr.handleIframeLoad).toHaveBeenCalledTimes(1);
    clearWebBrowserFrame(frame);
    fireEvent.load(frame);
    expect(mgr.handleIframeLoad).toHaveBeenCalledTimes(1);
    expect(frame).toHaveAttribute("sandbox", EMPTY_WEB_FRAME_SANDBOX);
  });

  it("does not reset an approved proxy document or reattach it on ordinary rerenders", () => {
    const attachIframe = vi.fn((frame: HTMLIFrameElement | null) => {
      if (frame) navigateWebBrowserFrame(frame, `${proxy}control`, proxy);
    });
    const mgr = manager({ shouldMountIframe: true, attachIframe });
    const { getByTitle, rerender } = render(<ContentArea mgr={mgr} />);
    const frame = getByTitle("Popup browser");
    const setAttribute = vi.spyOn(frame, "setAttribute");

    rerender(<ContentArea mgr={{ ...mgr, isLoading: false }} />);

    expect(getByTitle("Popup browser")).toBe(frame);
    expect(frame).toHaveAttribute("src", `${proxy}control`);
    expect(frame).toHaveAttribute("sandbox", PROXY_WEB_FRAME_SANDBOX);
    expect(attachIframe).toHaveBeenCalledTimes(1);
    expect(
      setAttribute.mock.calls.filter(
        ([name]) => name === "src" || name === "sandbox",
      ),
    ).toEqual([]);
    setAttribute.mockRestore();
  });

  it("starts a replacement frame restricted after the previous frame is retired", () => {
    const initialSandboxes: (string | null)[] = [];
    const attachIframe = (frame: HTMLIFrameElement | null) => {
      if (!frame) return;
      initialSandboxes.push(frame.getAttribute("sandbox"));
      navigateWebBrowserFrame(frame, `${proxy}control`, proxy);
    };
    const mgr = manager({ shouldMountIframe: true, attachIframe });
    const { container, getByTitle, rerender } = render(
      <ContentArea mgr={mgr} />,
    );
    const retired = getByTitle("Popup browser");

    rerender(<ContentArea mgr={{ ...mgr, shouldMountIframe: false }} />);
    expect(container.querySelector("iframe")).toBeNull();
    rerender(<ContentArea mgr={mgr} />);

    expect(getByTitle("Popup browser")).not.toBe(retired);
    expect(initialSandboxes).toEqual(["", ""]);
    expect(getByTitle("Popup browser")).toHaveAttribute(
      "src",
      `${proxy}control`,
    );
  });
});
