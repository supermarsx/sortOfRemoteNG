import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OriginBrowserViewport } from "../../src/components/protocol/webBrowser/OriginBrowserViewport";
import type { OriginBrowserController } from "../../src/hooks/protocol/useOriginBrowser";
import { originBrowserStartupError } from "../../src/hooks/protocol/originBrowserStartupError";

let measure: ResizeObserverCallback;
let rect: DOMRect;
const disconnect = vi.fn();
const observe = vi.fn();
beforeEach(() => {
  rect = {
    x: 20.5,
    y: 90.25,
    left: 20.5,
    top: 90.25,
    right: 820.75,
    bottom: 690.5,
    width: 800.25,
    height: 600.25,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => rect,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        measure = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.stubGlobal("innerWidth", 1200);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("devicePixelRatio", 2);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function controller(): OriginBrowserController {
  return {
    state: {
      phase: "attached",
      snapshot: null,
      error: null,
      unavailableReason: null,
    },
    setViewport: vi.fn(),
    navigate: vi.fn().mockResolvedValue(true),
    focus: vi.fn().mockResolvedValue(true),
    back: vi.fn().mockResolvedValue(true),
    forward: vi.fn().mockResolvedValue(true),
    reload: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(true),
    zoom: vi.fn().mockResolvedValue(true),
    find: vi.fn().mockResolvedValue(true),
    stopFind: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn(),
  };
}

function fixture() {
  const ctrl = controller();
  const props = {
    controller: ctrl,
    active: true,
    ownerAvailable: true,
    dialogOpen: false,
    title: "Remote fixture",
  };
  const view = render(<OriginBrowserViewport {...props} />);
  return { ctrl, props, ...view };
}

describe("native browser viewport", () => {
  it.each([
    "runtime-missing",
    "policy-unavailable",
    "containment-unverified",
  ] as const)(
    "opens the Web Browser subsection from the %s warning without changing browser policy",
    (reason) => {
      const f = fixture();
      const onOpenSettings = vi.fn();
      f.ctrl.state = {
        ...f.ctrl.state,
        phase: "unavailable",
        unavailableReason: reason,
      };
      f.rerender(
        <OriginBrowserViewport {...f.props} onOpenSettings={onOpenSettings} />,
      );
      const button = screen.getByRole("button", {
        name: "Open Web Browser settings",
      });
      expect(button).toHaveClass("sor-btn", "sor-btn-secondary");
      expect(button).not.toHaveAttribute("title");
      expect(onOpenSettings).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("webBrowser");
      expect(f.ctrl.reconnect).not.toHaveBeenCalled();
      expect(f.ctrl.navigate).not.toHaveBeenCalled();
      expect(f.ctrl.close).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "no automatic fallback",
      );
    },
  );
  it.each(["certificate-policy", "certificate-bridge"] as const)(
    "offers the same settings action for %s startup failures",
    (category) => {
      const f = fixture();
      const onOpenSettings = vi.fn();
      f.ctrl.state = {
        ...f.ctrl.state,
        phase: "error",
        startupFailure: { stage: "create", category },
      };
      f.rerender(
        <OriginBrowserViewport {...f.props} onOpenSettings={onOpenSettings} />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Open Web Browser settings" }),
      );
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("webBrowser");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your existing trust policy is unchanged",
      );
      expect(f.ctrl.reconnect).not.toHaveBeenCalled();
      expect(f.ctrl.close).not.toHaveBeenCalled();
    },
  );
  it("honors loading presentation without hiding busy state or runtime failures", () => {
    const f = fixture();
    f.ctrl.state = { ...f.ctrl.state, phase: "starting" };
    f.rerender(
      <OriginBrowserViewport {...f.props} showLoadingProgress={false} />,
    );
    expect(screen.queryByText("Starting native browser…")).toBeNull();
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
    f.rerender(<OriginBrowserViewport {...f.props} showLoadingProgress />);
    expect(screen.getByText("Starting native browser…")).toBeVisible();
    f.ctrl.state = {
      ...f.ctrl.state,
      phase: "error",
      error: "Native browser operation failed.",
    };
    f.rerender(
      <OriginBrowserViewport {...f.props} showLoadingProgress={false} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Native browser operation failed.",
    );
  });
  it("presents certificate-policy guidance without a missing-host claim or policy-changing action", () => {
    const f = fixture();
    const failure = originBrowserStartupError(
      "create",
      "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported",
    );
    f.ctrl.state = {
      ...f.ctrl.state,
      phase: "error",
      error: failure.message,
      startupFailure: { stage: failure.stage, category: failure.category },
    };
    f.rerender(<OriginBrowserViewport {...f.props} />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveClass("sor-alert-warning", "text-[var(--color-text)]");
    expect(
      screen.getByRole("heading", { name: "HTTPS trust policy not supported" }),
    ).toBeVisible();
    expect(notice).toHaveTextContent(
      "native runtime cannot enforce this connection's saved HTTPS trust policy",
    );
    expect(notice).not.toHaveTextContent(
      "strict certificate verification only",
    );
    expect(notice).toHaveTextContent("Your existing trust policy is unchanged");
    expect(notice).toHaveTextContent(
      "certificate trust configuration and the installed browser runtime",
    );
    expect(notice).toHaveTextContent("inherited global trust policy");
    expect(notice).toHaveTextContent(
      "No settings were changed and no fallback was used",
    );
    expect(
      screen.queryByText(
        /host is unavailable|Experimental native browser unavailable|runtime is missing/,
      ),
    ).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      f.container.querySelector("button,a,input,select,iframe,webview"),
    ).toBeNull();
    fireEvent.pointerDown(screen.getByRole("region"));
    expect(f.ctrl.focus).not.toHaveBeenCalled();
    expect(f.ctrl.navigate).not.toHaveBeenCalled();
    expect(f.ctrl.reconnect).not.toHaveBeenCalled();
    expect(f.ctrl.close).not.toHaveBeenCalled();
  });
  it("explains a missing verifier bridge without suggesting weaker trust settings", () => {
    const f = fixture();
    const failure = originBrowserStartupError(
      "create",
      "The loaded CEF runtime does not provide the required app certificate-verifier bridge. Install or rebuild the patched browser runtime; the saved trust policy was not changed.",
    );
    expect(failure.category).toBe("certificate-bridge");
    f.ctrl.state = {
      ...f.ctrl.state,
      phase: "error",
      error: failure.message,
      startupFailure: { stage: failure.stage, category: failure.category },
    };
    f.rerender(<OriginBrowserViewport {...f.props} />);
    const notice = screen.getByRole("alert");
    expect(
      screen.getByRole("heading", {
        name: "Certificate verifier runtime required",
      }),
    ).toBeVisible();
    expect(notice).toHaveTextContent(
      "Install or rebuild the patched browser runtime",
    );
    expect(notice).toHaveTextContent("Your existing trust policy is unchanged");
    expect(notice).not.toHaveTextContent(
      "strict certificate verification only",
    );
    expect(
      f.container.querySelector("button,a,input,select,iframe,webview"),
    ).toBeNull();
  });
  it("keeps unknown startup errors stage-specific instead of showing certificate or host-unavailable guidance", () => {
    const f = fixture();
    const failure = originBrowserStartupError(
      "status",
      new Error("https://secret.invalid/?token=private"),
    );
    f.ctrl.state = {
      ...f.ctrl.state,
      phase: "error",
      error: failure.message,
      startupFailure: { stage: failure.stage, category: failure.category },
    };
    f.rerender(<OriginBrowserViewport {...f.props} />);
    expect(screen.getByRole("alert")).toHaveClass("sor-alert-error");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "startup failed (status)",
    );
    expect(
      screen.queryByRole("heading", {
        name: "HTTPS trust policy not supported",
      }),
    ).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(f.container.textContent).not.toMatch(
      /secret\.invalid|token=|private|host is unavailable/,
    );
  });
  it("uses the app palette for its shell and semantic notices without imposing remote dark colors", () => {
    const f = fixture();
    const region = screen.getByRole("region");
    expect(region).toHaveClass(
      "bg-[var(--color-background)]",
      "text-[var(--color-text)]",
      "focus-visible:ring-2",
    );
    expect(region).not.toHaveAttribute("style");
    f.ctrl.state = { ...f.ctrl.state, phase: "starting" };
    f.rerender(<OriginBrowserViewport {...f.props} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Starting native browser",
    );
    expect(screen.getByRole("status").querySelector("svg")).toHaveClass(
      "motion-reduce:animate-none",
    );
    f.ctrl.state = {
      ...f.ctrl.state,
      phase: "error",
      error: "Native browser operation failed.",
    };
    f.rerender(<OriginBrowserViewport {...f.props} />);
    expect(screen.getByRole("alert")).toHaveClass(
      "sor-alert-error",
      "text-[var(--color-text)]",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("renders only a layout anchor and measures logical pixels without applying device scale", () => {
    const f = fixture();
    expect(
      f.container.querySelector("iframe,webview,canvas,object,embed"),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "Remote fixture" }),
    ).toHaveAttribute("tabindex", "0");
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith({
      x: 20.5,
      y: 90.25,
      width: 800.25,
      height: 600.25,
    });
    expect(f.ctrl.focus).not.toHaveBeenCalled();
  });

  it("clips bounds to the app viewport and hides a zero-size or invalid surface", () => {
    const f = fixture();
    rect = { ...rect, left: -10, top: -20, right: 2000, bottom: 1000 };
    act(() => measure([], {} as ResizeObserver));
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
    rect = { ...rect, right: 0, bottom: 0 };
    act(() => measure([], {} as ResizeObserver));
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith(null);
    rect = { ...rect, left: NaN, right: Infinity };
    act(() => measure([], {} as ResizeObserver));
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith(null);
  });

  it.each([{ active: false }, { dialogOpen: true }, { ownerAvailable: false }])(
    "hides and blocks focus for %j without closing on a prop change",
    (override) => {
      const f = fixture();
      f.rerender(<OriginBrowserViewport {...f.props} {...override} />);
      const node = f.container.querySelector("[data-origin-browser-viewport]")!;
      expect(node).toHaveAttribute("aria-hidden", "true");
      expect(node).toHaveAttribute("tabindex", "-1");
      expect(f.ctrl.setViewport).toHaveBeenLastCalledWith(null);
      fireEvent.focus(node);
      fireEvent.pointerDown(node);
      expect(f.ctrl.focus).not.toHaveBeenCalled();
      expect(f.ctrl.close).not.toHaveBeenCalled();
    },
  );

  it("forwards explicit focus only while interactive", () => {
    const f = fixture();
    const node = screen.getByRole("region");
    fireEvent.focus(node);
    expect(f.ctrl.focus).toHaveBeenCalledOnce();
    f.ctrl.state = { ...f.ctrl.state, phase: "starting" };
    f.rerender(<OriginBrowserViewport {...f.props} />);
    fireEvent.pointerDown(node);
    expect(f.ctrl.focus).toHaveBeenCalledOnce();
    expect(node).toHaveAttribute("aria-busy", "true");
  });

  it("remeasures on scrolling, window resize and visibility changes", () => {
    const f = fixture();
    rect = { ...rect, left: 40, right: 640 };
    fireEvent.scroll(window);
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith({
      x: 40,
      y: 90.25,
      width: 600,
      height: 600.25,
    });
    rect = { ...rect, right: 740 };
    fireEvent.resize(window);
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith({
      x: 40,
      y: 90.25,
      width: 700,
      height: 600.25,
    });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith(null);
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith({
      x: 40,
      y: 90.25,
      width: 700,
      height: 600.25,
    });
  });

  it("disconnects observers, hides and closes on unmount without leaving scroll listeners", () => {
    const f = fixture();
    f.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(f.ctrl.setViewport).toHaveBeenLastCalledWith(null);
    expect(f.ctrl.close).toHaveBeenCalledOnce();
    vi.mocked(f.ctrl.setViewport).mockClear();
    fireEvent.scroll(window);
    fireEvent.resize(window);
    expect(f.ctrl.setViewport).not.toHaveBeenCalled();
  });

  it("shows unavailable mode without a fallback browsing surface or readiness claim", () => {
    const ctrl = controller();
    ctrl.state = {
      ...ctrl.state,
      phase: "unavailable",
      unavailableReason: "containment-unverified",
    };
    const view = render(
      <OriginBrowserViewport
        controller={ctrl}
        active
        ownerAvailable
        dialogOpen={false}
        title="Unavailable"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Experimental native browser unavailable",
    );
    expect(screen.getByRole("status")).toHaveClass(
      "sor-alert-warning",
      "text-[var(--color-text)]",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Settings → Web Browser; no automatic fallback",
    );
    expect(
      view.container.querySelector("iframe,webview,canvas,object,embed"),
    ).toBeNull();
    expect(screen.getByRole("region")).toHaveAttribute("tabindex", "-1");
    expect(ctrl.navigate).not.toHaveBeenCalled();
  });
});
